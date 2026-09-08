#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")"

APP_NAME="G1Code AI IDE"
OS_NAME="macOS"
if [[ "$OSTYPE" != "darwin"* ]]; then
  OS_NAME="Linux / Unix"
fi

echo ""
echo "  ========================================================"
echo "    ${APP_NAME} — Web & Localhost Runner"
echo "                 ${OS_NAME} Edition"
echo "  ========================================================"
echo ""

# Check for node in PATH or common version manager locations
if ! command -v node >/dev/null 2>&1; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck source=/dev/null
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  elif [ -s "$HOME/.asdf/asdf.sh" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.asdf/asdf.sh"
  elif [ -s "$HOME/.fnm/fnm" ]; then
    export PATH="$HOME/.fnm:$PATH"
    eval "$(fnm env 2>/dev/null || true)"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  [ERROR] Node.js was not found on your system."
  echo "  Please install Node.js (v20+ recommended) from https://nodejs.org/"
  echo "  or via Homebrew (brew install node)."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "  [ERROR] npm was not found. Please ensure Node.js is installed with npm."
  exit 1
fi

echo "  [OK] Node.js $(node -v)"
echo "  [OK] npm v$(npm -v)"
echo ""

# Check if node_modules exists and key packages are present
NEED_INSTALL=0
if [ ! -d "node_modules" ] || \
   [ ! -d "node_modules/vite" ] || \
   [ ! -d "node_modules/tsx" ] || \
   [ ! -d "node_modules/better-sqlite3" ] || \
   [ ! -d "node_modules/concurrently" ]; then
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  echo "  [..] Installing required project dependencies..."
  if ! npm install --loglevel=error; then
    echo "  [WARN] Standard install failed. Trying npm ci..."
    npm ci --loglevel=error || npm install --loglevel=error
  fi
  echo "  [OK] Dependencies installed successfully."
else
  echo "  [OK] Dependencies verified and ready."
fi

echo ""
echo "  ========================================================"
echo "    Starting Backend API Server + Web UI Dashboard"
echo "    - Backend API:       http://127.0.0.1:3131"
echo "    - Web UI Dashboard:  http://localhost:5173"
echo "    Press Ctrl+C to stop all servers"
echo "  ========================================================"
echo ""

BACKEND_URL="http://127.0.0.1:3131"
FRONTEND_URL="http://localhost:5173"

# Kill any existing server processes so we always get fresh log output
kill_existing() {
  local pids
  # Backend on port 3131
  pids=$(lsof -ti tcp:3131 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  [..] Stopping existing backend (pid $pids)..."
    echo "$pids" | xargs kill -TERM 2>/dev/null || true
    sleep 1
  fi
  # Frontend on port 5173
  pids=$(lsof -ti tcp:5173 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  [..] Stopping existing frontend (pid $pids)..."
    echo "$pids" | xargs kill -TERM 2>/dev/null || true
    sleep 1
  fi
}

kill_existing

# Open the browser automatically once the frontend is ready.
open_browser() {
  for _ in {1..30}; do
    if curl -fsS "$FRONTEND_URL" >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then
        open "$FRONTEND_URL"
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$FRONTEND_URL" 2>/dev/null
      fi
      break
    fi
    sleep 0.5
  done
}

open_browser &
npm run dev:ui
