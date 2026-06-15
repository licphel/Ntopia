#!/bin/bash
# Reset Ntopia database to fresh state

DATA_DIR="$(dirname "$0")/data"

echo "Resetting Ntopia database..."
rm -f "$DATA_DIR"/*.db "$DATA_DIR"/*.db-wal "$DATA_DIR"/*.db-shm
rm -rf "$DATA_DIR/sessions"/*
echo "Done. Database and sessions cleared."
echo "Default admin: admin / 123456"
echo "Restart server to recreate."
