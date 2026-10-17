#!/usr/bin/env bash
# Checks that this Mac/Linux laptop is ready to work on the project. Safe to run any time: it only looks, never installs.
# Usage:  bash setup/setup-check.sh [lane]
# Lanes: lane-a (music to data / ML), lane-b (live audio), lane-c (vision + visuals), lane-d (create), commands, playback, shell, server-core, design, deploy
# Every MISSING line says exactly how to fix it. Exit code 0 = ready, 1 = something to fix.
# Works with the old bash 3.2 that ships with macOS (no fancy features).

LANE="${1:-}"
PROBLEMS=0

if [ -t 1 ]; then RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'; else RED=""; GREEN=""; YELLOW=""; OFF=""; fi

ok()      { printf '%sOK%s       %s\n' "$GREEN" "$OFF" "$1"; }
missing() { PROBLEMS=$((PROBLEMS + 1)); printf '%sMISSING%s  %s\n' "$RED" "$OFF" "$1"; [ -n "${2:-}" ] && printf '         Fix:  %s\n' "$2"; [ -n "${3:-}" ] && printf '         More: %s\n' "$3"; return 0; }
note()    { printf '%sNOTE%s     %s\n' "$YELLOW" "$OFF" "$1"; [ -n "${2:-}" ] && printf '         %s\n' "$2"; return 0; }
have()    { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"
case "$OS" in
  Darwin) OSNAME="macOS" ;;
  Linux)  OSNAME="Linux" ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "This is a Windows computer. Use the Windows check instead (it knows where Windows keeps things):"
    if [ -n "$LANE" ]; then LANEARG=" -Lane $LANE"; else LANEARG=""; fi
    echo "  powershell -NoProfile -ExecutionPolicy Bypass -File setup/setup-check.ps1$LANEARG"
    exit 2 ;;
  *)      OSNAME="$OS" ;;
esac
echo "Checking this computer ($OSNAME) ..."
echo

# Install hints per system
if [ "$OS" = "Darwin" ]; then
  HINT_GIT="brew install git   (no Homebrew? https://brew.sh)"
  HINT_NODE="brew install node"
  HINT_UV="brew install uv"
  HINT_GH="brew install gh"
  HINT_CHROME="brew install --cask google-chrome"
else
  HINT_GIT="sudo apt install git   (Fedora: sudo dnf install git)"
  HINT_NODE="Use your package manager or https://nodejs.org (need version 20 or newer)"
  HINT_UV="pipx install uv   (or: pip install --user uv)"
  HINT_GH="https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
  HINT_CHROME="https://www.google.com/chrome/"
fi

# --- Git ---
if have git; then ok "$(git --version)"; else missing "Git is not installed" "$HINT_GIT" "https://git-scm.com/downloads"; fi

# --- Node 20 or newer ---
if have node; then
  NV="$(node -v | sed 's/^v//')"
  NMAJOR="${NV%%.*}"
  if [ "${NMAJOR:-0}" -ge 20 ] 2>/dev/null; then ok "Node.js $NV"; else missing "Node.js $NV is too old (need 20 or newer)" "$HINT_NODE" "https://nodejs.org"; fi
else
  missing "Node.js is not installed" "$HINT_NODE" "https://nodejs.org"
fi

# --- Python and uv ---
PYV=""
if have python3; then PYV="$(python3 --version 2>&1)"; elif have python; then PYV="$(python --version 2>&1)"; fi
case "$PYV" in
  "Python 3."*)
    PYMINOR="$(echo "$PYV" | sed -E 's/Python 3\.([0-9]+).*/\1/')"
    if [ "${PYMINOR:-0}" -ge 11 ] 2>/dev/null; then ok "$PYV"; else missing "$PYV is too old (need 3.11 or newer)" "uv can fetch one for you after it is installed: uv python install 3.12" "https://docs.astral.sh/uv/"; fi ;;
  *) note "Python 3 not found on its own" "That is fine: uv installs and manages Python for the project (uv python install 3.12)" ;;
esac
if have uv; then ok "$(uv --version)"; else missing "uv (Python tool) is not installed" "$HINT_UV" "https://docs.astral.sh/uv/getting-started/installation/"; fi

# --- Claude Code ---
if have claude; then ok "Claude Code $(claude --version 2>/dev/null | head -n 1)"; else missing "Claude Code is not installed" "npm install -g @anthropic-ai/claude-code   (needs Node.js first)" "https://docs.claude.com/en/docs/claude-code/setup"; fi

# --- GitHub CLI and sign-in ---
GH_READY=0
if have gh; then
  ok "$(gh --version | head -n 1)"
  if gh auth status >/dev/null 2>&1; then ok "Signed in to GitHub"; GH_READY=1
  else missing "Not signed in to GitHub" "gh auth login   (choose GitHub.com, HTTPS, then 'Login with a web browser')" "https://cli.github.com/manual/gh_auth_login"; fi
else
  missing "GitHub CLI (gh) is not installed" "$HINT_GH" "https://cli.github.com"
fi

# --- Access to the project repository ---
if [ "$GH_READY" = "1" ]; then
  PUSH="$(gh api repos/sadie2488/SwampHacks --jq .permissions.push 2>/dev/null)"
  case "$PUSH" in
    true)  ok "You can push to the project repository" ;;
    false) missing "You are signed in but can't push to the project repository" "Ask the repo owner (sadie2488) to add your GitHub username as a collaborator, then accept the email invite" "https://github.com/sadie2488/SwampHacks/settings/access" ;;
    *)     missing "Could not check access to the project repository" "Check your internet, then run this again. If it keeps failing: gh auth status" "" ;;
  esac
fi

# --- Chrome ---
CHROME=0
if [ "$OS" = "Darwin" ] && [ -d "/Applications/Google Chrome.app" ]; then CHROME=1; fi
if have google-chrome || have google-chrome-stable || have chromium || have chromium-browser; then CHROME=1; fi
if [ "$CHROME" = "1" ]; then ok "Google Chrome"; else missing "Google Chrome is not installed" "$HINT_CHROME" "https://www.google.com/chrome/"; fi

# --- Task-specific ---
[ -n "$LANE" ] && { echo; echo "Extra checks for lane: $LANE"; }
if [ "$LANE" = "lane-c" ] || [ "$LANE" = "commands" ]; then
  CAM=0
  if [ "$OS" = "Darwin" ]; then
    system_profiler SPCameraDataType 2>/dev/null | grep -q "Model ID" && CAM=1
  else
    ls /dev/video* >/dev/null 2>&1 && CAM=1
  fi
  if [ "$CAM" = "1" ]; then ok "Webcam found"; else missing "No webcam found" "Use a laptop with a webcam or plug one in. On a Mac, allow Terminal and Chrome under System Settings > Privacy & Security > Camera" ""; fi
fi
if [ "$LANE" = "lane-c" ]; then
  if ls -d /Applications/TouchDesigner*.app >/dev/null 2>&1; then ok "TouchDesigner"; else note "TouchDesigner not found (only needed to build or view the visuals)" "Free non-commercial version: https://derivative.ca/download"; fi
fi
if [ "$LANE" = "lane-a" ]; then
  if have nvidia-smi; then
    GPU="$(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>/dev/null | head -n 1)"
    if [ -n "$GPU" ]; then ok "NVIDIA GPU: $GPU"; else missing "nvidia-smi is installed but found no GPU" "Update the NVIDIA driver: https://www.nvidia.com/Download/index.aspx" ""; fi
  else
    note "No NVIDIA driver found (model training will use the slow CPU path)" "If this laptop has an NVIDIA GPU: https://www.nvidia.com/Download/index.aspx"
  fi
fi
if [ "$LANE" = "lane-b" ] || [ "$LANE" = "lane-d" ]; then
  note "Microphone: the first time the app asks, click Allow in Chrome. Use headphones when practising so the song doesn't leak into the mic"
fi

echo
if [ "$PROBLEMS" -eq 0 ]; then
  printf '%sRESULT: READY. Everything needed is installed.%s\n' "$GREEN" "$OFF"
  exit 0
else
  printf '%sRESULT: %s thing(s) to fix. Do the "Fix" lines above, then run this check again.%s\n' "$RED" "$PROBLEMS" "$OFF"
  exit 1
fi
