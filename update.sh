#!/bin/bash
# Ntopia update script — pull latest code and restart
set -e
cd "$(dirname "$0")"
git pull
npm install
pm2 restart ntopia
echo "Updated. pm2 logs ntopia to check."
