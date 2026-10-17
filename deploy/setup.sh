#!/usr/bin/env bash
# Sets up the SwampHacks music app on a NEW Ubuntu 24.04 server. Run it ON the server, as root.
# Safe to run again: every step checks first and skips what is already done.
#
#   DOMAIN=yourdomain.com bash /opt/swamphacks/app/deploy/setup.sh
#
# What it never does: it never writes a key, never touches Vultr, never opens your private env file.
# Steps are in deploy/README.md.
set -euo pipefail

# ---- Things you may change (or set on the command line, like DOMAIN=... above) ------------------
DOMAIN="${DOMAIN:-example.com}"                                        # your website address
REPO_URL="${REPO_URL:-https://github.com/sadie2488/SwampHacks.git}"    # where the code comes from
BRANCH="${BRANCH:-main}"                                               # which version of the code to run
NODE_MAJOR="${NODE_MAJOR:-22}"                                         # Node is only used to build the website
SWAP_SIZE="${SWAP_SIZE:-2G}"                                           # safety net for a 2 GB server
SKIP_DNS_CHECK="${SKIP_DNS_CHECK:-0}"                                  # 1 = do not check the domain points here

# ---- Fixed places (the same paths are written in swamphacks-server.service and Caddyfile) -------
APP_USER=swamphacks
APP_HOME=/opt/swamphacks
APP_DIR=$APP_HOME/app
ENV_DIR=/etc/swamphacks
ENV_FILE=$ENV_DIR/server.env
CONF_FILE=$ENV_DIR/deploy.conf
SERVICE=swamphacks-server

say()  { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*"; }
die()  { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

# A brand-new server often runs its own updates for the first minutes; wait for them instead of failing.
aptget() { apt-get -o DPkg::Lock::Timeout=300 "$@"; }

# Run a command as the app user, with its own home folder.
as_app() {
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="/usr/local/bin:/usr/bin:/bin" "$@"
}

main() {
  # ---- 0. Checks before touching anything ------------------------------------------------------
  say "Checking this computer"
  [ "$(id -u)" -eq 0 ] || die "This must run as root. Log in as root, or put 'sudo' in front: sudo bash deploy/setup.sh"

  local os_id os_name os_version
  os_id="$( . /etc/os-release 2>/dev/null && printf '%s' "${ID:-}" )" || true
  os_name="$( . /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-unknown}" )" || true
  os_version="$( . /etc/os-release 2>/dev/null && printf '%s' "${VERSION_ID:-}" )" || true
  [ "$os_id" = "ubuntu" ] || die "This script is for Ubuntu, but this computer is: $os_name. Create a new server with Ubuntu 24.04 and try again."
  [ "$os_version" = "24.04" ] || warn "Made for Ubuntu 24.04, this is $os_name. It may still work."

  # Running it a second time without DOMAIN=...: reuse the address saved by the first run.
  if [ "$DOMAIN" = "example.com" ] && [ -f "$CONF_FILE" ]; then
    local saved_domain
    saved_domain="$(sed -n 's/^DOMAIN=//p' "$CONF_FILE" | head -n 1)"
    if [ -n "$saved_domain" ]; then
      DOMAIN="$saved_domain"
      note "Using the website address saved last time: $DOMAIN"
    fi
  fi
  [ "$DOMAIN" != "example.com" ] || die "Tell me your website address first, for example: DOMAIN=yourdomain.com bash deploy/setup.sh"
  [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "'$DOMAIN' does not look like a website address. Use lower-case letters, like: yourdomain.com"
  [[ "$DOMAIN" == *.* ]] || die "'$DOMAIN' needs a dot in it, like: yourdomain.com"

  if [ "$SKIP_DNS_CHECK" != "1" ]; then
    local domain_ips my_ips ip found=0
    domain_ips="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)"
    my_ips="$(hostname -I 2>/dev/null || true)"
    for ip in $domain_ips; do
      case " $my_ips " in *" $ip "*) found=1 ;; esac
    done
    if [ "$found" -ne 1 ]; then
      die "$DOMAIN does not point at this server yet (it points at: ${domain_ips:-nothing}; this server is: ${my_ips:-unknown}). At GoDaddy, add an A record for @ with this server's address, wait a few minutes, then run this again. To skip this check: SKIP_DNS_CHECK=1"
    fi
    note "$DOMAIN points at this server. Good."
  fi

  export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

  # ---- 1. Basic programs -----------------------------------------------------------------------
  say "Installing basic programs (git, curl, ffmpeg for m4a/aac songs)"
  aptget update -y
  aptget install -y ca-certificates curl gnupg git ffmpeg libsndfile1

  # ---- 2. Swap file (extra memory on disk, so a build or a long song cannot freeze a 2 GB server) -
  say "Checking the swap file"
  if [ -z "$(swapon --show --noheadings 2>/dev/null)" ]; then
    if [ ! -f /swapfile ]; then
      fallocate -l "$SWAP_SIZE" /swapfile
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
    fi
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
    note "Added a $SWAP_SIZE swap file."
  else
    note "Swap is already on."
  fi

  # ---- 3. Node (only to build the website) -----------------------------------------------------
  say "Checking Node $NODE_MAJOR"
  local node_ok=0
  if command -v node >/dev/null 2>&1; then
    [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ] && node_ok=1
  fi
  if [ "$node_ok" -eq 0 ]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    aptget install -y nodejs
  else
    note "Node $(node -v) is already installed."
  fi

  # ---- 4. Caddy (the web front door that also gets the HTTPS certificate) ----------------------
  say "Checking Caddy"
  if ! command -v caddy >/dev/null 2>&1; then
    aptget install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    aptget update -y
    aptget install -y caddy
  else
    note "Caddy is already installed."
  fi

  # ---- 5. uv (installs the Python parts) -------------------------------------------------------
  say "Checking uv"
  if ! command -v uv >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL=/usr/local/bin sh
  else
    note "uv is already installed."
  fi
  command -v uv >/dev/null 2>&1 || die "uv did not install. Check the lines above."

  # ---- 6. The app's own user and folders -------------------------------------------------------
  say "Creating the '$APP_USER' user and folders"
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$APP_HOME" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
  mkdir -p "$APP_HOME"
  chown "$APP_USER:$APP_USER" "$APP_HOME"
  chmod 755 "$APP_HOME"   # Caddy must be able to walk through this folder to read the website files

  # ---- 7. The code ------------------------------------------------------------------------------
  say "Getting the code ($BRANCH)"
  if [ -d "$APP_DIR/.git" ]; then
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    as_app git -C "$APP_DIR" remote set-url origin "$REPO_URL"
    as_app git -C "$APP_DIR" fetch --prune origin
    as_app git -C "$APP_DIR" checkout -f -B "$BRANCH" "origin/$BRANCH"
  elif [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
    die "$APP_DIR exists but is not a copy of the code. Move it away (mv $APP_DIR $APP_DIR.old) and run this again."
  else
    as_app git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR" \
      || die "Could not download the code from $REPO_URL (branch $BRANCH). If the repository is private, ask the lead for a way in."
  fi
  note "Code is at commit $(as_app git -C "$APP_DIR" rev-parse --short HEAD)."

  # ---- 8. Build the website ---------------------------------------------------------------------
  say "Building the website (takes a few minutes)"
  as_app bash -c 'cd "$1/web" && npm ci --no-audit --no-fund && npx vite build' _ "$APP_DIR"
  [ -f "$APP_DIR/web/dist/index.html" ] || die "The website build did not make web/dist/index.html. Read the lines above."

  # ---- 9. Install the server's Python parts -----------------------------------------------------
  say "Installing the server (this includes the song analysis tools)"
  as_app bash -c 'cd "$1/server" && UV_COMPILE_BYTECODE=1 uv sync --no-dev --frozen' _ "$APP_DIR"
  as_app "$APP_DIR/server/.venv/bin/python" -c "import fastapi, uvicorn, librosa" \
    || die "The server's Python parts did not install correctly. Read the lines above."

  # ---- 10. The private key file (empty; you fill it in by hand) ---------------------------------
  say "Preparing the private key file"
  install -d -m 750 -o root -g "$APP_USER" "$ENV_DIR"
  if [ ! -e "$ENV_FILE" ]; then
    : > "$ENV_FILE"
    note "Made an empty $ENV_FILE. You add the keys by hand (see the README)."
  else
    note "$ENV_FILE already exists. Left exactly as it is."
  fi
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  # Not secret: lets update.sh know the website address.
  printf 'DOMAIN=%s\nREPO_URL=%s\nBRANCH=%s\n' "$DOMAIN" "$REPO_URL" "$BRANCH" > "$CONF_FILE"
  chmod 644 "$CONF_FILE"

  # ---- 11. Server service and Caddy settings ----------------------------------------------------
  say "Installing the service and the Caddy settings"
  install -m 644 "$APP_DIR/deploy/swamphacks-server.service" "/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload

  # Swap the placeholder address for yours (DOMAIN was checked above, so it holds only letters, digits, dots, dashes).
  sed "s/example\\.com/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile.new
  caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null \
    || { rm -f /etc/caddy/Caddyfile.new; die "Caddy says its settings file has a mistake (message above). Tell the lead."; }
  mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
  chown root:caddy /etc/caddy/Caddyfile
  chmod 644 /etc/caddy/Caddyfile

  # Ubuntu servers from Vultr may have their own firewall (ufw) on. Open the three doors we need.
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
    ufw allow 22/tcp >/dev/null
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    note "The server's own firewall (ufw) now allows ports 22, 80 and 443."
  fi

  # ---- 12. Start everything ---------------------------------------------------------------------
  say "Starting the server and Caddy"
  systemctl enable "$SERVICE" caddy >/dev/null 2>&1
  systemctl restart "$SERVICE"
  systemctl reload-or-restart caddy

  say "Checking that the server answers"
  if curl -fsS --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:8000/api/health; then
    printf '\n'
    note "OK: the server is running."
  else
    printf '\n'
    journalctl -u "$SERVICE" -n 30 --no-pager || true
    die "The server did not answer. The last log lines are above."
  fi

  say "Waiting for the HTTPS certificate (up to 2 minutes)"
  local tries=0
  until curl -fsS --max-time 3 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 15 ]; then
      warn "No HTTPS answer yet. Caddy keeps trying by itself. Look at the reason with: journalctl -u caddy -n 40 --no-pager"
      break
    fi
    sleep 5
  done
  [ "$tries" -lt 15 ] && note "OK: https://$DOMAIN answers."

  cat <<EOF

==> Done. What to do next:
    1. Put the keys in $ENV_FILE (see the README, step "Add the keys").
    2. Then run: systemctl restart $SERVICE
    3. Open https://$DOMAIN/api/health in a browser. It should show {"status":"ok"}.
EOF
}

# Everything is inside main() and the last line ends with exit, so bash never reads this file again
# after main starts (the code download above may replace this very file).
main "$@"; exit $?
