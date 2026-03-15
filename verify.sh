#!/usr/bin/env zsh
# verify.sh — verify OPTFLOW file structure, report issues, optionally fix
#
# Usage:
#   ./verify.sh          — check only, no changes
#   ./verify.sh --fix    — auto-resolve all warnings and misplacements

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

FIX=0; [[ "$1" == "--fix" ]] && FIX=1
PASS=0; FAIL=0; WARN=0; FIXED=0

green()  { printf "  \033[92m✓\033[0m %s\n" "$1"; }
red()    { printf "  \033[91m✗\033[0m %s\n" "$1"; }
yellow() { printf "  \033[93m!\033[0m %s\n" "$1"; }
bold()   { printf "\n\033[1m%s\033[0m\n" "$1"; }

confirm() {
  # confirm <description>  → returns 0 if should proceed
  if [[ $FIX -eq 1 ]]; then return 0; fi
  printf "    Fix: %s [y/N] " "$1"; read -r a; [[ "$a" =~ ^[Yy]$ ]]
}

untrack() {
  # untrack <file>  — remove from git index if tracked
  git ls-files --error-unmatch "$1" &>/dev/null 2>&1 && \
    git rm --cached "$1" &>/dev/null 2>&1 && \
    echo "    Untracked $1 from git" || true
}

echo "\n━━━ OPTFLOW Structure Verification ━━━━━━━━━━━━━━━━━━━\n"

# ══════════════════════════════════════════════════════════════
# 1. REQUIRED FILES
# ══════════════════════════════════════════════════════════════
bold "1. Required files"

REQUIRED=(
  # Single root entry point
  "run.py"
  # Common — backend + entry point logic
  "common/__init__.py"
  "common/paths.py"
  "common/api.py"
  "common/config_routes.py"
  "common/data_feeds.py"
  "common/options_chain.py"
  "common/portfolio.py"
  "common/tradier.py"
  "common/launch.py"
  "common/launch_windows.py"
  "common/stop.py"
  "common/cli.py"
  # Frontend
  "frontend/src/App.jsx"
  "frontend/src/main.jsx"
  "frontend/vite.config.js"
  "frontend/package.json"
  "frontend/index.html"
  # Platform launchers
  "platform/macos/OPTFLOW.command"
  "platform/macos/setup.sh"
  "platform/windows/OPTFLOW.bat"
  "platform/windows/setup_windows.bat"
  # Repo
  ".gitignore"
  "README.md"
  # User data
  "user_data/.gitkeep"
)

for f in "${REQUIRED[@]}"; do
  if [[ -f "$ROOT/$f" ]]; then
    green "$f"; (( PASS++ ))
  else
    red "$f  ← MISSING"; (( FAIL++ ))
  fi
done

# ══════════════════════════════════════════════════════════════
# 2. DEAD / MISPLACED FILES
# ══════════════════════════════════════════════════════════════
bold "2. Dead or misplaced files"

# Backend files that should be in common/ not root
SHOULD_BE_IN_COMMON=(
  "api.py"
  "config_routes.py"
  "data_feeds.py"
  "options_chain.py"
  "portfolio.py"
  "tradier.py"
  "paths.py"
)

# Fully dead files (including superseded shims)
DEAD=(
  "launcher.html"
  "options_scanner.py"
  "setup.sh"
  "setup_windows.bat"
  "OPTFLOW.command"
  "OPTFLOW.bat"
  "main.py"
  "launch.py"
  "launch_windows.py"
  "stop.py"
  "cli.py"
  "platform/README.md"
  ".env.example"
)

FOUND=0
for f in "${SHOULD_BE_IN_COMMON[@]}"; do
  if [[ -f "$ROOT/$f" ]]; then
    yellow "$ROOT/$f should be in common/ (the root-level copy is stale)"
    (( WARN++ )); (( FOUND++ ))
    if confirm "Remove stale root/$f?"; then
      untrack "$f"; rm -f "$ROOT/$f"
      green "Removed stale $f"; (( FIXED++ ))
    fi
  fi
done

for f in "${DEAD[@]}"; do
  if [[ -f "$ROOT/$f" ]]; then
    yellow "$f is dead code — no longer used"
    (( WARN++ )); (( FOUND++ ))
    if confirm "Remove $f?"; then
      untrack "$f"; rm -f "$ROOT/$f"
      green "Removed $f"; (( FIXED++ ))
    fi
  fi
done

[[ $FOUND -eq 0 ]] && green "No dead or misplaced files"

# ══════════════════════════════════════════════════════════════
# 3. PERSONAL FILES → user_data/
# ══════════════════════════════════════════════════════════════
bold "3. user_data/ (personal files)"

[[ -d "$ROOT/user_data" ]] || { mkdir -p "$ROOT/user_data"; touch "$ROOT/user_data/.gitkeep"; }
green "user_data/ exists"; (( PASS++ ))

# .env
if [[ -f "$ROOT/user_data/.env" ]]; then
  green "user_data/.env present"; (( PASS++ ))
elif [[ -f "$ROOT/.env" ]]; then
  yellow ".env at root — should be user_data/.env"; (( WARN++ ))
  if confirm "Move .env → user_data/.env?"; then
    untrack ".env"; mv "$ROOT/.env" "$ROOT/user_data/.env"
    green "Moved .env → user_data/.env"; (( FIXED++ ))
  fi
else
  if [[ -f "$ROOT/common/.env.example" ]]; then
    cp "$ROOT/common/.env.example" "$ROOT/user_data/.env"
  elif [[ -f "$ROOT/.env.example" ]]; then
    cp "$ROOT/.env.example" "$ROOT/user_data/.env"
    green "Created user_data/.env from .env.example"; (( FIXED++ ))
  else
    yellow "user_data/.env missing — add API keys after creating it"; (( WARN++ ))
  fi
fi

# positions.json
if [[ -f "$ROOT/user_data/positions.json" ]]; then
  green "user_data/positions.json present"; (( PASS++ ))
elif [[ -f "$ROOT/positions.json" ]]; then
  yellow "positions.json at root — should be user_data/positions.json"; (( WARN++ ))
  if confirm "Move positions.json → user_data/positions.json?"; then
    untrack "positions.json"; mv "$ROOT/positions.json" "$ROOT/user_data/positions.json"
    green "Moved positions.json → user_data/positions.json"; (( FIXED++ ))
  fi
else
  echo "[]" > "$ROOT/user_data/positions.json"
  green "Created empty user_data/positions.json"; (( FIXED++ ))
fi

# ══════════════════════════════════════════════════════════════
# 4. GIT HYGIENE
# ══════════════════════════════════════════════════════════════
bold "4. Git hygiene"

if git rev-parse --git-dir &>/dev/null 2>&1; then
  CLEAN=1

  # Secrets must never be tracked
  for f in ".env" "user_data/.env" "user_data/positions.json" "positions.json"; do
    if git ls-files --error-unmatch "$f" &>/dev/null 2>&1; then
      red "$f is tracked — run: git rm --cached $f"; (( FAIL++ )); CLEAN=0
      if confirm "Untrack $f now?"; then
        git rm --cached "$f" &>/dev/null && green "Untracked $f" && (( FIXED++ ))
      fi
    fi
  done

  # sync.sh and verify.sh must never be tracked
  for f in "sync.sh" "verify.sh"; do
    if git ls-files --error-unmatch "$f" &>/dev/null 2>&1; then
      yellow "$f should not be in git (personal script)"; (( WARN++ )); CLEAN=0
      if confirm "Untrack $f?"; then
        git rm --cached "$f" &>/dev/null && green "Untracked $f" && (( FIXED++ ))
      fi
    fi
  done

  # No compiled files
  COMPILED=$(git ls-files | grep -E "\.pyc$|__pycache__" 2>/dev/null || true)
  if [[ -n "$COMPILED" ]]; then
    yellow "Compiled files tracked: $COMPILED"; (( WARN++ )); CLEAN=0
    if confirm "Untrack compiled files?"; then
      echo "$COMPILED" | xargs git rm --cached 2>/dev/null && (( FIXED++ ))
    fi
  fi

  [[ $CLEAN -eq 1 ]] && green "No secrets or generated files tracked"
else
  yellow "Not a git repository — skipping git checks"
fi

# ══════════════════════════════════════════════════════════════
# 5. DEPENDENCIES
# ══════════════════════════════════════════════════════════════
bold "5. Dependencies"

[[ -d "$ROOT/frontend/node_modules" ]] \
  && { green "frontend/node_modules present"; (( PASS++ )); } \
  || { yellow "Run: cd frontend && npm install"; (( WARN++ )); }

python3 -c "import fastapi,uvicorn,aiohttp,dotenv,httpx,yfinance,rich" 2>/dev/null \
  && { green "Python packages OK"; (( PASS++ )); } \
  || { yellow "Missing Python packages — run platform setup script"; (( WARN++ )); }

# ══════════════════════════════════════════════════════════════
# 6. PYTHON SYNTAX
# ══════════════════════════════════════════════════════════════
bold "6. Python syntax"

PY_FILES=(
  "run.py"
  "common/api.py" "common/config_routes.py" "common/data_feeds.py"
  "common/options_chain.py" "common/portfolio.py" "common/tradier.py"
  "common/paths.py" "common/launch.py" "common/launch_windows.py"
  "common/stop.py" "common/cli.py"
)
for f in "${PY_FILES[@]}"; do
  [[ ! -f "$ROOT/$f" ]] && continue
  ERR=$(python3 -m py_compile "$ROOT/$f" 2>&1)
  if [[ -z "$ERR" ]]; then
    green "$f"; (( PASS++ ))
  else
    red "$f — $ERR"; (( FAIL++ ))
  fi
done

# ══════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════
echo "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  \033[92m✓ %d passed\033[0m  \033[91m✗ %d failed\033[0m  \033[93m! %d warnings\033[0m" $PASS $FAIL $WARN
[[ $FIXED -gt 0 ]] && printf "  \033[96m⚙ %d fixed\033[0m" $FIXED
echo "\n"

if [[ $FAIL -gt 0 ]]; then
  echo "  Some files are missing or have syntax errors."
  echo "  Download them from the Claude session and retry."
  [[ $FIX -eq 0 && $WARN -gt 0 ]] && \
    echo "  Run ./verify.sh --fix to auto-resolve warnings."
  exit 1
elif [[ $WARN -gt 0 && $FIX -eq 0 ]]; then
  echo "  Structure OK. Run ./verify.sh --fix to resolve warnings."
else
  echo "  All checks passed — ready to push."
  echo "  Run: ./sync.sh"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
