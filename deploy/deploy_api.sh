#!/usr/bin/env bash
#
# deploy_api.sh
# Run this on the single host that will run the Ledger API + SQLite
# database (this project runs it on Web01 — see README for why a
# single data host is used even though the frontend is on two web
# servers).
#
# Usage: ./deploy_api.sh

set -e

if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs build-essential
fi

if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
fi

mkdir -p /opt/ledger-api
cp -r ./backend/* /opt/ledger-api/
cd /opt/ledger-api
npm install --omit=dev

# Start (or restart, if already running) the API under pm2 so it
# survives reboots and terminal exits without needing systemctl.
pm2 start server.js --name ledger-api --update-env || pm2 restart ledger-api
pm2 save

echo "Ledger API running on port 3000 (managed by pm2, process name: ledger-api)"
