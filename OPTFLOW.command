#!/usr/bin/env zsh
# OPTFLOW.command — double-click in Finder to launch
# First time: chmod +x OPTFLOW.command

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Homebrew PATH (Apple Silicon)
[[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"

# Check python3
if ! command -v python3 &>/dev/null; then
  osascript -e 'display alert "OPTFLOW" message "python3 not found. Run setup.sh first." as critical'
  exit 1
fi

# Free both ports cleanly — uvicorn is no longer a daemon, safe to kill
for port in 8000 5173; do
  pids=$(lsof -ti :$port 2>/dev/null)
  [[ -n "$pids" ]] && echo "[OPTFLOW] Freeing port $port" && echo "$pids" | xargs kill -9 2>/dev/null && sleep 0.3
done

# Remove stale PID file
rm -f "$SCRIPT_DIR/.optflow.pid"

# Launch
python3 "$SCRIPT_DIR/launch.py"
