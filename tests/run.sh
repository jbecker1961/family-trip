#!/bin/sh
# Headless check of the app's screens and logic on a Mac (no browser, no Firebase):
# strips the imports, renames $ (reserved in JXA), adds browser/Firebase stand-ins and runs the scenario.
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/trip-test-run.js"
{ cat stubs.js; grep -v '^import \|^boot();\|serviceWorker' ../app.js | sed -E 's/^(const|let) /var /; s/\$\(/qq(/g; s/^var \$=/var qq=/'; cat scenario.js; } > "$OUT"
osascript -l JavaScript "$OUT"
