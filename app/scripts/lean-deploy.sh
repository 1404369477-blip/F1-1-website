#!/bin/zsh
# Copies the lean pipeline into a runtime directory outside iCloud-synced ~/Documents.
set -euo pipefail

SOURCE_APP="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_APP="${LEAN_RUNTIME_APP:-/Users/chanai/F1-1-website/lean-runtime/app}"
NODE_BIN="/Users/chanai/.local/node-v24.18.0-darwin-arm64/bin"

mkdir -p "$RUNTIME_APP/src/server" "$RUNTIME_APP/src/features/stories" "$RUNTIME_APP/scripts"
rm -rf "$RUNTIME_APP/src/server/lean"
cp -R "$SOURCE_APP/src/server/lean" "$RUNTIME_APP/src/server/lean"
cp "$SOURCE_APP/src/features/stories/public-static-schema.ts" "$RUNTIME_APP/src/features/stories/"
cp "$SOURCE_APP"/scripts/lean-cycle.ts "$SOURCE_APP"/scripts/lean-seed.ts "$RUNTIME_APP/scripts/"

cat > "$RUNTIME_APP/package.json" <<'JSON'
{
  "name": "f1-plus-1-lean-runtime",
  "private": true,
  "type": "module",
  "dependencies": {
    "fast-xml-parser": "5.10.1",
    "sharp": "0.34.5",
    "zod": "4.4.3"
  }
}
JSON

if [[ ! -d "$RUNTIME_APP/node_modules/fast-xml-parser" || ! -d "$RUNTIME_APP/node_modules/zod" || ! -d "$RUNTIME_APP/node_modules/sharp" ]]; then
  (cd "$RUNTIME_APP" && PATH="$NODE_BIN:$PATH" npm install --omit=dev --no-audit --no-fund)
fi

echo "lean runtime ready: $RUNTIME_APP"
