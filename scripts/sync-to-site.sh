#!/usr/bin/env bash
# Copies the demo into the portfolio site repository. site/ mirrors the site's paths exactly.
# Usage: scripts/sync-to-site.sh [path-to-site-repo]
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/site"
SITE="${1:-$SRC/../../neuromorphic-inference-lab-site}"

if [ ! -f "$SITE/index.html" ] || [ ! -d "$SITE/functions" ]; then
  echo "Not the site repository: $SITE" >&2
  exit 1
fi

mkdir -p "$SITE/config/panel" "$SITE/functions/api/panel" "$SITE/demos/hiring-panel/recordings" "$SITE/test"
cp "$SRC"/config/panel/*.js "$SITE/config/panel/"
cp "$SRC"/functions/api/panel/*.js "$SITE/functions/api/panel/"
cp "$SRC"/demos/hiring-panel/index.html "$SRC"/demos/hiring-panel/app.js "$SITE/demos/hiring-panel/"
cp "$SRC"/demos/hiring-panel/recordings/*.json "$SITE/demos/hiring-panel/recordings/"
cp "$SRC"/test/panel-*.js "$SITE/test/"
echo "Synced into $(cd "$SITE" && pwd)"
