#!/usr/bin/env zsh
# OPTFLOW.command — macOS double-click launcher
# Make executable once: chmod +x platform/macos/OPTFLOW.command
# Or copy to the OPTFLOW root: cp platform/macos/OPTFLOW.command .

# Resolve the OPTFLOW root (two levels up from platform/macos/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

# Homebrew PATH (Apple Silicon)
[[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"

# Check python3
if ! command -v python3 &>/dev/null; then
  osascript -e 'display alert "OPTFLOW" message "python3 not found. Run setup.sh first." as critical'
  exit 1
fi

# Free both ports cleanly
for port in 8000 5173; do
  pids=$(lsof -ti :$port 2>/dev/null)
  [[ -n "$pids" ]] && echo "[OPTFLOW] Freeing port $port" && echo "$pids" | xargs kill -9 2>/dev/null && sleep 0.3
done

rm -f "$ROOT/.optflow.pid"

python3 "$ROOT/run.py" launch
