#!/bin/bash
# Ntopia update — pull, migrate, restart
set -e
cd "$(dirname "$0")"

echo "=== 1/4 Pulling latest code ==="
git pull

echo "=== 2/4 Installing dependencies ==="
npm install --omit=dev

echo "=== 3/4 Running database migrations ==="
node migrate.js

echo "=== 4/4 Restarting ==="
if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q ntopia; then
  pm2 restart ntopia
  echo "Updated. Run: pm2 logs ntopia"
elif command -v docker &>/dev/null && docker compose ps 2>/dev/null | grep -q ntopia; then
  docker compose up -d --build
  echo "Updated. Run: docker compose logs -f"
else
  echo "⚠  Could not detect pm2 or docker. Please restart manually."
fi
