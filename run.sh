#!/usr/bin/env bash
set -e

echo "=== Claude Skills Runner ==="
echo "Starting web UI and scheduler..."

mkdir -p /data/runs /data/skills

# Always update built-in skills to latest version
cp /app/skills/*.md /data/skills/ 2>/dev/null || true

exec node /app/server.js
