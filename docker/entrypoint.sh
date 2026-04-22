#!/usr/bin/env sh
set -eu

mkdir -p /app/data

# All settings live in SQLite: /app/data/monitor.db (meta `app_config_json`)
export CICD_MON_DATA_DIR="/app/data"

cd /app
exec python /app/ci_monitor.py web
