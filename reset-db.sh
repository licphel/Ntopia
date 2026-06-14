#!/bin/bash
# Reset Ntopia database to fresh state
# Deletes SQLite DB and session files

DATA_DIR="$(dirname "$0")/data"

echo "Resetting Ntopia database..."

rm -f "$DATA_DIR/core.db" "$DATA_DIR/volatile.db"
rm -rf "$DATA_DIR/sessions"/*

echo "Done. Database and sessions cleared."
echo "Default admin: admin / 123456"
echo "Restart server to recreate."
