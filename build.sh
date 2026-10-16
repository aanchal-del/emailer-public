#!/bin/bash
# Build the public static site into _deploy/ — drag that folder onto
# https://app.netlify.com/drop to publish it.
#
# Deliberately EXCLUDED, and why:
#   .env      your Anthropic API key
#   .venv/    local Python environment
#   server.py the vision proxy (Netlify has no Python runtime; a public proxy
#             would also let anyone spend your API credits)
#   reference/ the Amex handbook — internal material, not for a public URL
#   _*.pdf    local test fixtures
#
# The app probes for the vision server and the handbook at runtime, so the
# deployed copy correctly presents itself as browser-only.
set -euo pipefail
cd "$(dirname "$0")"

OUT="_deploy"
rm -rf "$OUT"
mkdir -p "$OUT"

cp index.html app.js rules.js styles.css "$OUT/"
cp -R vendor "$OUT/"

# Netlify: long-cache the pinned vendor bundle, never cache the app shell.
cat > "$OUT/_headers" <<'EOF'
/vendor/*
  Cache-Control: public, max-age=31536000, immutable
/*
  Cache-Control: no-cache
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
EOF

if grep -rlq "sk-ant" "$OUT" 2>/dev/null; then
  echo "ABORT: an API key reached the build output." >&2
  exit 1
fi

# Zip for Netlify Drop. Files must sit at the ZIP ROOT — a wrapping folder inside
# the archive makes Netlify serve a 404 instead of the site.
ZIP="emailer-site.zip"
rm -f "$ZIP"
( cd "$OUT" && zip -qr "../$ZIP" . -x '.DS_Store' '__MACOSX/*' )

echo "Built $OUT/ and $ZIP"
find "$OUT" -type f | sort | sed 's/^/  /'
echo
echo "Folder: $(du -sh "$OUT" | cut -f1)   Zip: $(du -h "$ZIP" | cut -f1)"
echo "Verified: no API key in the build output."
echo
echo "Zip root (index.html must be top-level, not inside a folder):"
unzip -l "$ZIP" | sed 's/^/  /'
