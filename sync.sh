#!/usr/bin/env zsh
# sync.sh — push OPTFLOW changes to GitHub after each session
# Usage: ./sync.sh
#    or: ./sync.sh "describe what changed"

set -e
cd "$(dirname "$0")"

# ── Safety checks ──────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo "[ERROR] git not found"; exit 1
fi

if ! git rev-parse --git-dir &>/dev/null; then
  echo "[ERROR] Not a git repository. Run: git init && git remote add origin <url>"; exit 1
fi

# ── Ensure sensitive files are never committed ─────────────────
for f in .env positions.json .optflow.pid .optflow_api.pid .optflow_ui.pid; do
  if git ls-files --error-unmatch "$f" &>/dev/null 2>&1; then
    echo "[WARN] Untracking $f (should not be in repo)"
    git rm --cached "$f"
  fi
done

# ── Stage all changes ──────────────────────────────────────────
git add -A

# ── Check if there's anything to commit ───────────────────────
if git diff --cached --quiet; then
  echo "[INFO] Nothing to commit — repo is up to date."
  exit 0
fi

# ── Commit message ─────────────────────────────────────────────
if [[ -n "$1" ]]; then
  MSG="$1"
else
  # Show what's changing
  echo ""
  echo "Changed files:"
  git diff --cached --name-only | sed 's/^/  /'
  echo ""
  printf "Commit message (or press Enter for default): "
  read MSG
  if [[ -z "$MSG" ]]; then
    MSG="Session update — $(date '+%Y-%m-%d %H:%M')"
  fi
fi

# ── Commit and push ────────────────────────────────────────────
git commit -m "$MSG"
git push origin main

echo ""
echo "[OK] Synced to GitHub: $MSG"
