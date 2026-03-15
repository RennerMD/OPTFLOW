#!/usr/bin/env zsh
# platform/macos/setup.sh — macOS first-time setup
# Run from project root: chmod +x platform/macos/setup.sh && ./platform/macos/setup.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "━━━ OPTFLOW Setup (macOS) ━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Homebrew ───────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo "\n⚠  Homebrew not found."
  printf "   Install Homebrew now? [y/N] "
  read -r ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
    echo "   ✓ Homebrew installed"
  else
    echo "   Skipping — install Node.js manually: https://nodejs.org"
  fi
else
  echo "✓ Homebrew $(brew --version | head -1)"
fi

# ── Node.js ────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  if command -v brew &>/dev/null; then
    echo "\n→ Installing Node.js..."
    brew install node
    echo "   ✓ Node.js $(node --version)"
  else
    echo "\n⚠  Node.js not found. Install from https://nodejs.org"
  fi
else
  echo "✓ Node.js $(node --version)"
fi

# ── Python packages ────────────────────────────────────────────
echo "\n→ Installing Python packages..."
pip3 install \
  fastapi "uvicorn[standard]" aiohttp websockets \
  python-dotenv python-multipart requests httpx \
  yfinance pandas numpy scipy rich \
  --break-system-packages --quiet
echo "   ✓ Python packages installed"

# ── Frontend ───────────────────────────────────────────────────
if command -v npm &>/dev/null; then
  echo "\n→ Installing frontend dependencies..."
  cd "$ROOT/frontend" && npm install --silent && cd "$ROOT"
  echo "   ✓ Frontend packages installed"
else
  echo "\n⚠  npm not found — run: cd frontend && npm install"
fi

# ── .env ───────────────────────────────────────────────────────
if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env" 2>/dev/null || cat > "$ROOT/.env" <<'EOF'
POLYGON_API_KEY=
TRADIER_TOKEN=
TRADIER_SANDBOX=false
EOF
  echo "✓ Created .env — add API keys via the sidebar after launch"
else
  echo "✓ .env already exists"
fi

# ── Permissions ────────────────────────────────────────────────
chmod +x "$SCRIPT_DIR/OPTFLOW.command"
chmod +x "$ROOT/sync.sh" "$ROOT/stop.py" 2>/dev/null || true

echo "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Setup complete!\n"
echo "Launch:  double-click platform/macos/OPTFLOW.command"
echo "     or: python3 launch.py"
echo "\nDashboard opens at http://127.0.0.1:5173"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
