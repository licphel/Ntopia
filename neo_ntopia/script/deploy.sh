#!/usr/bin/env bash
# ============================================================
# Ntopia 2.0 — one-click Docker deploy
#   Installs Docker on Ubuntu 26+, builds image,
#   runs app + nginx via docker compose.
#   Safe to re-run — skips installed steps.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log()  { printf "${GREEN}[deploy]${NC} %s\n" "$*"; }
err()  { printf "${RED}[deploy]${NC} %s\n" "$*"; exit 1; }

check() { "$@" >/dev/null 2>&1 || err "$*  ← FAILED"; }

# ── 1. Pre-flight checks ─────────────────────────────────────
preflight() {
  log "Pre-flight..."
  check node -v
  check npm -v
  [ -f package.json ] || err "package.json missing — wrong directory?"
  [ -f Dockerfile ]  || err "Dockerfile missing — wrong directory?"
  log "  OK"
}

# ── 2. Install Docker ────────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    log "Docker $(docker --version | awk '{print $3}' | tr -d ',') — OK"
    return
  fi

  log "Installing Docker..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc

  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
    https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
  log "Docker installed — re-login if this is the first install"
}

# ── 2. Prepare .env ──────────────────────────────────────────
setup_env() {
  cd "$PROJECT_DIR"
  if [ ! -f .env ]; then
    if [ -f ../.env ]; then
      cp ../.env .env
      log ".env copied from parent project"
    else
      cp .env.example .env
      log ".env created from .env.example — EDIT IT"
    fi
  else
    log ".env exists"
  fi
}

# ── 3. Build & start ─────────────────────────────────────────
deploy() {
  cd "$PROJECT_DIR"

  log "Building image..."
  docker compose build --pull

  log "Starting..."
  docker compose up -d --wait

  # Verify health
  log "Health check..."
  sleep 3
  if curl -sf http://localhost:3000/ >/dev/null 2>&1; then
    log "  Backend responding OK"
  else
    log "  Backend not responding — check logs: docker compose logs app"
  fi

  echo ""
  docker compose ps
  echo ""
  log "Deploy done.  http://localhost"
  echo "  Logs:   docker compose logs -f"
  echo "  Stop:   docker compose down"
  echo "  Update: ./script/update.sh"
}

# ── Main ─────────────────────────────────────────────────────
main() {
  echo ""
  echo "  ╔══════════════════════════════╗"
  echo "  ║   Ntopia 2.0 — Deploy        ║"
  echo "  ╚══════════════════════════════╝"
  echo ""

  preflight
  install_docker
  setup_env
  deploy
}

main "$@"
