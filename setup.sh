#!/usr/bin/env zsh
# setup.sh — full OPTFLOW install
# Run: chmod +x setup.sh && ./setup.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "━━━ OPTFLOW Setup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Homebrew ───────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo "\n⚠  Homebrew is not installed."
  echo "   Homebrew is required to install Node.js."
  printf "   Install Homebrew now? [y/N] "
  read -r answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    echo "→ Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -f /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
      echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
    fi
    echo "   ✓ Homebrew installed"
  else
    echo "   ✗ Skipping Homebrew. Install Node.js manually: https://nodejs.org"
  fi
else
  echo "✓ Homebrew already installed"
fi

# ── Node.js / npm ──────────────────────────────────────────
if ! command -v node &>/dev/null; then
  if command -v brew &>/dev/null; then
    echo "\n→ Installing Node.js via Homebrew..."
    brew install node
    echo "   ✓ Node.js installed ($(node --version))"
  else
    echo "\n⚠  Node.js not found and Homebrew unavailable. Install: https://nodejs.org"
  fi
else
  echo "✓ Node.js already installed ($(node --version))"
fi

# ── Python dependencies ────────────────────────────────────
echo "\n→ Installing Python dependencies..."
pip3 install \
  yfinance \
  pandas \
  numpy \
  scipy \
  rich \
  fastapi \
  "uvicorn[standard]" \
  aiohttp \
  websockets \
  python-dotenv \
  python-multipart \
  requests \
  httpx \
  --break-system-packages --quiet
echo "   ✓ Python deps installed"

# ── .env template ──────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cat > "$SCRIPT_DIR/.env" <<EOF
# Polygon.io API key — https://polygon.io (free tier = 15min delayed)
# Starter plan ($29/mo) = real-time REST. Leave blank to use yfinance fallback.
POLYGON_API_KEY=
EOF
  echo "   ✓ Created .env — add POLYGON_API_KEY when ready"
else
  echo "   ✓ .env already exists"
fi

# ── Frontend npm install ────────────────────────────────────
if command -v npm &>/dev/null; then
  echo "\n→ Installing frontend dependencies..."
  cd "$SCRIPT_DIR/frontend"
  npm install --silent
  cd "$SCRIPT_DIR"
  echo "   ✓ Frontend deps installed"
else
  echo "\n⚠  npm not found — skipping frontend install"
  echo "   After installing Node, run: cd frontend && npm install"
fi

# ── Make cli.py executable ─────────────────────────────────
chmod +x "$SCRIPT_DIR/cli.py"

# ── Shell alias ────────────────────────────────────────────
ALIAS_LINE="alias options='python3 ${SCRIPT_DIR}/cli.py'"
if ! grep -qF "alias options=" ~/.zshrc 2>/dev/null; then
  printf "\n# OPTFLOW options terminal\n$ALIAS_LINE\n" >> ~/.zshrc
  echo "   ✓ Added 'options' alias to ~/.zshrc"
else
  echo "   ✓ 'options' alias already in ~/.zshrc"
fi

# ── Done ───────────────────────────────────────────────────
echo "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Setup complete!\n"
echo "Start the stack (two terminal tabs):\n"
echo "  Tab 1 — API server:"
echo "    cd $SCRIPT_DIR && uvicorn api:app --reload --port 8000\n"
echo "  Tab 2 — React UI:"
echo "    cd $SCRIPT_DIR/frontend && npm run dev\n"
echo "  Then open: http://localhost:5173\n"
echo "CLI (after: source ~/.zshrc):"
echo "  options chain SPY"
echo "  options chain QQQ --expiry 2025-06-20"
echo "  options portfolio --file positions.json"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
