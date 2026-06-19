#!/usr/bin/env bash
# Wipe the database — destroys all data irreversibly.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "This will DELETE all data (users, posts, comments, everything)."
read -p "Type 'yes' to confirm: " confirm
if [ "$confirm" != "yes" ]; then echo "Aborted."; exit 0; fi

# If running in Docker, wipe the volume
if docker ps --format '{{.Names}}' | grep -q neo-ntopia; then
  echo "Stopping containers..."
  docker compose -f "$PROJECT_DIR/docker-compose.yml" down
  echo "Removing data volume..."
  docker volume rm ntopia_ntopia_data 2>/dev/null || true
  echo "Done. Run 'bash script/deploy.sh' to start fresh."
else
  rm -f "$PROJECT_DIR/data/ntopia.db" "$PROJECT_DIR/data/ntopia.db-wal" "$PROJECT_DIR/data/ntopia.db-shm"
  echo "Local DB deleted."
fi
