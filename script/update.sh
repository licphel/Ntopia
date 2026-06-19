#!/usr/bin/env bash
# ============================================================
# Ntopia 2.0 — update and redeploy
#   Pulls latest code, rebuilds Docker image, restarts.
#   Zero-downtime if DB schema is backward-compatible.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
NC='\033[0m'

log() { printf "${GREEN}[update]${NC} %s\n" "$*"; }

cd "$PROJECT_DIR"

log "Pulling latest code..."
if git rev-parse --git-dir &>/dev/null; then
  git pull --ff-only || log "git pull skipped (not fast-forward)"
else
  log "Not a git repo — skipping pull"
fi

log "Rebuilding image..."
docker compose build --pull

log "Restarting services..."
docker compose up -d --wait --force-recreate

log "Cleaning old images..."
docker image prune -f 2>/dev/null || true

echo ""
docker compose ps
echo ""
log "Update complete."
