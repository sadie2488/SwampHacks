#!/usr/bin/env bash
# Puts the newest code on the running server. Run it ON the server, as root.
#
#   bash /opt/swamphacks/app/deploy/update.sh            # newest version of the branch chosen at setup (main)
#   bash /opt/swamphacks/app/deploy/update.sh 1a2b3c4    # go to one exact older version (a rollback)
#
# It downloads the code, rebuilds the website, updates the server's Python parts, refreshes the
# service and Caddy settings if they changed, restarts the server, and checks that it answers.
# It never touches your private key file.
set -euo pipefail

APP_USER=swamphacks
APP_HOME=/opt/swamphacks
APP_DIR=$APP_HOME/app
ENV_DIR=/etc/swamphacks
CONF_FILE=$ENV_DIR/deploy.conf
SERVICE=swamphacks-server

say()  { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

as_app() {
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="/usr/local/bin:/usr/bin:/bin" "$@"
}

main() {
  [ "$(id -u)" -eq 0 ] || die "This must run as root. Log in as root, or put 'sudo' in front: sudo bash deploy/update.sh"
  [ -f "$CONF_FILE" ] || die "$CONF_FILE is missing, so setup has not been run on this server yet. Run deploy/setup.sh first."
  [ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a copy of the code. Run deploy/setup.sh first."

  local DOMAIN="" REPO_URL="" BRANCH="main"
  # shellcheck disable=SC1090
  . "$CONF_FILE"
  [ -n "$DOMAIN" ] || die "$CONF_FILE has no DOMAIN line. Run deploy/setup.sh again."

  local ref="${1:-}"

  say "Getting the code"
  local before after
  before="$(as_app git -C "$APP_DIR" rev-parse --short HEAD)"
  as_app git -C "$APP_DIR" fetch --prune origin
  if [ -n "$ref" ]; then
    as_app git -C "$APP_DIR" checkout -f --detach "$ref" || die "Could not find version '$ref'. List versions with: runuser -u $APP_USER -- git -C $APP_DIR log --oneline -10"
  else
    as_app git -C "$APP_DIR" checkout -f -B "$BRANCH" "origin/$BRANCH"
  fi
  after="$(as_app git -C "$APP_DIR" rev-parse --short HEAD)"
  if [ "$before" = "$after" ]; then
    note "Already on $after (nothing new). Rebuilding anyway."
  else
    note "Moved from $before to $after."
  fi

  say "Rebuilding the website (takes a few minutes)"
  as_app bash -c 'cd "$1/web" && npm ci --no-audit --no-fund && npx vite build' _ "$APP_DIR"
  [ -f "$APP_DIR/web/dist/index.html" ] || die "The website build did not make web/dist/index.html. Read the lines above."

  say "Updating the server's Python parts"
  as_app bash -c 'cd "$1/server" && UV_COMPILE_BYTECODE=1 uv sync --no-dev --frozen' _ "$APP_DIR"

  say "Refreshing the service and Caddy settings if they changed"
  if ! cmp -s "$APP_DIR/deploy/swamphacks-server.service" "/etc/systemd/system/$SERVICE.service"; then
    install -m 644 "$APP_DIR/deploy/swamphacks-server.service" "/etc/systemd/system/$SERVICE.service"
    systemctl daemon-reload
    note "Service settings updated."
  fi
  sed "s/example\\.com/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile.new
  if ! cmp -s /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile; then
    caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null \
      || { rm -f /etc/caddy/Caddyfile.new; die "Caddy says its new settings file has a mistake (message above). Nothing was changed. Tell the lead."; }
    mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
    chown root:caddy /etc/caddy/Caddyfile
    chmod 644 /etc/caddy/Caddyfile
    systemctl reload caddy
    note "Caddy settings updated."
  else
    rm -f /etc/caddy/Caddyfile.new
  fi

  say "Restarting the server"
  systemctl restart "$SERVICE"

  say "Checking that the server answers"
  if curl -fsS --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:8000/api/health >/dev/null; then
    note "OK: the server answers on this computer (version $after)."
  else
    printf '\nNOT OK: the server did not answer. The last log lines:\n'
    journalctl -u "$SERVICE" -n 30 --no-pager || true
    die "The update did not work. To go back to the last good version: bash $APP_DIR/deploy/update.sh $before"
  fi
  if curl -fsS --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    note "OK: https://$DOMAIN answers too."
  else
    note "The server is fine, but https://$DOMAIN did not answer from here. Look at: journalctl -u caddy -n 40 --no-pager"
  fi
}

# Everything is inside main() and the last line ends with exit, so bash never reads this file again
# after main starts (the code download below may replace this very file).
main "$@"; exit $?
