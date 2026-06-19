#!/usr/bin/env bash
# ============================================================
# Ntopia 2.0 — local dev
#   Kills anything on :3000, then starts backend.
#   Every step self-checks; fails early if something is wrong.
# ============================================================
set -eumo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Kill anything already on our port
fuser -k 3000/tcp 2>/dev/null || true

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
log()  { printf "${GREEN}[dev]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[dev]${NC} %s\n" "$*"; }
die()  { printf "${RED}[dev] FATAL: %s${NC}\n" "$*"; exit 1; }

RESET_DB=false
if [ "${1:-}" = "--reset" ]; then
  RESET_DB=true
  shift
fi

check() { "$@" >/dev/null 2>&1 || die "$*  ← 失败"; }

cleanup() {
  log "Shutting down..."
  # Kill process groups so children (node --watch, vite hmr) die too
  [ -n "${BACKEND_PID:-}" ] && kill -TERM -${BACKEND_PID} 2>/dev/null || true
  fuser -k 3000/tcp 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# ═══════════════════════════════════════════════════════════════
# 1. Dependencies
# ═══════════════════════════════════════════════════════════════
log "1/6 Checking Node..."
check node -v

if [ ! -d node_modules ]; then
  log "Installing backend deps..."
  npm install --silent || die "npm install failed"
fi

# ═══════════════════════════════════════════════════════════════
# 2. Module sanity check (no DB needed)
# ═══════════════════════════════════════════════════════════════
log "2/6 Verifying modules..."
node -e "
  require('./src/config');
  require('./src/util/time');
  require('./src/util/markdown');
  require('./src/lib/auth');
  require('./src/lib/res');
  require('./src/repo');
  require('./src/service');
  require('./src/router');
" || die "Module loading failed — check require paths"

# ═══════════════════════════════════════════════════════════════
# 3. .env
# ═══════════════════════════════════════════════════════════════
log "3/6 Checking .env..."
if [ ! -f .env ]; then
  if [ -f ../.env ]; then cp ../.env .env; else cp .env.example .env; fi
  log "  .env created — review settings before production"
fi

# ═══════════════════════════════════════════════════════════════
# 4. DB init + verify
# ═══════════════════════════════════════════════════════════════
log "4/6 Database..."
if [ "$RESET_DB" = true ]; then
  warn "  --reset: removing old database"
  rm -f data/ntopia.db data/ntopia.db-wal data/ntopia.db-shm
fi
node -e "
  require('dotenv').config();
  const { initDB, getDB } = require('./src/database');
  initDB();
  const db = getDB();
  const u = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (!u || u.c < 1) throw new Error('No users — owner not seeded');
  console.log('  DB OK: ' + u.c + ' user(s), ' + db.prepare('SELECT COUNT(*) as c FROM categories').get().c + ' categories');
  process.exit(0);
" || die "Database init failed"

# ═══════════════════════════════════════════════════════════════
# 5. Tests
# ═══════════════════════════════════════════════════════════════
log "5/6 Running tests..."
node --test test/*.test.js 2>&1 | tail -2
if [ "${PIPESTATUS[0]}" -ne 0 ]; then die "Tests failed"; fi

# ═══════════════════════════════════════════════════════════════
# 6. Start backend + verify
# ═══════════════════════════════════════════════════════════════
PORT=${PORT:-3000}

log "6/6 Starting services..."
node server.js &
BACKEND_PID=$!

# Wait for backend to respond
log "  Waiting for backend..."
ok=false
for i in $(seq 1 20); do
  if curl -sf http://localhost:$PORT/ >/dev/null 2>&1; then
    log "  Backend ready (port $PORT)"
    ok=true
    break
  fi
  sleep 0.5
done
if [ "$ok" != true ]; then die "Backend did not start — check server.js"; fi

echo ""
log "══════════════════════════════════════════════"
log "  Ntopia → http://localhost:$PORT"
log "  Press Ctrl-C to stop"
log "══════════════════════════════════════════════"
echo ""

wait
