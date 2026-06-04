#!/usr/bin/env bash
set -e

echo "=== Claude Skills Runner ==="
echo "Starting web UI and scheduler..."

# Ensure data dirs exist
mkdir -p /data/runs /data/skills

# Copy built-in skills if not already present
if [ ! -f /data/skills/madplan.md ]; then
  cp /app/skills/*.md /data/skills/ 2>/dev/null || true
fi

# Start the Node.js web server + scheduler
exec node /app/server.js
