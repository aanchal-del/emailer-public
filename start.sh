#!/bin/bash
# Launch Emailer locally. Serving (not file://) is required so the PDF worker loads.
cd "$(dirname "$0")" || exit 1
PORT="${1:-8099}"
echo "Press Ctrl+C to stop."
# Open the browser once the server is up
( sleep 1; open "http://localhost:$PORT/workspace.html" ) &
# Prefer the local venv — it has the Anthropic SDK for the optional vision pass.
PY="./.venv/bin/python"; [ -x "$PY" ] || PY="python3"
"$PY" server.py "$PORT"
