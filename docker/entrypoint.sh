#!/usr/bin/env sh
set -eu

mkdir -p /app/runtime /app/data

if [ ! -f /app/runtime/config.yaml ]; then
  cp /app/config.example.yaml /app/runtime/config.yaml
fi

ln -sf /app/runtime/config.yaml /app/config.yaml

exec python /app/ci_monitor.py web
