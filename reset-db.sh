#!/bin/bash
# Reset Ntopia database to fresh state

DATA_DIR="$(dirname "$0")/data"

echo "Resetting Ntopia database..."
rm -f "$DATA_DIR"/ntopia.db "$DATA_DIR"/ntopia.db-wal "$DATA_DIR"/ntopia.db-shm
# Remove old split-DB files if they still exist
rm -f "$DATA_DIR"/core.db "$DATA_DIR"/core.db-wal "$DATA_DIR"/core.db-shm "$DATA_DIR"/core.db.migrated
rm -f "$DATA_DIR"/volatile.db "$DATA_DIR"/volatile.db-wal "$DATA_DIR"/volatile.db-shm "$DATA_DIR"/volatile.db.migrated
rm -f "$DATA_DIR"/social.db "$DATA_DIR"/social.db-wal "$DATA_DIR"/social.db-shm "$DATA_DIR"/social.db.migrated
rm -rf "$DATA_DIR/sessions"/*
echo "Done. Database and sessions cleared."
echo "Start server to recreate the database."
echo "Default owner account created on first run (check OWNER_PASSWORD in .env)."
