#!/bin/bash
# M5 observer holds no AES decryption key and opens no business database.
set -euo pipefail
umask 077
NODE="${3:?pinned Node24 binary required}"
RUNTIME="${1:?fixed runtime required}"
EXPECTED_ROOT="${2:?runtime digest required}"
TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_ROOT="$HOME/Library/Application Support/F1Plus1/BackupObserver"
LOG_FILE="$STATE_ROOT/observer.log"
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt 5242880 ]; then mv -f "$LOG_FILE" "$LOG_FILE.previous"; fi
result=0
"$NODE" "$TOOLS_DIR/bounded-backup-command.mjs" 30 "$NODE" "$TOOLS_DIR/verify-backup-runtime.mjs" "$RUNTIME" "$EXPECTED_ROOT" > "$STATE_ROOT/last-run.json" 2> "$STATE_ROOT/last-error.json" || result=$?
if [ "$result" -eq 0 ]; then
"$NODE" "$TOOLS_DIR/bounded-backup-command.mjs" 255 "$NODE" --experimental-transform-types "$TOOLS_DIR/backup-off-host-transfer.mjs" \
  --runtime-root "$RUNTIME" --expected-hash "$EXPECTED_ROOT" \
  --cache-root "$STATE_ROOT/cipher-cache" \
  --receipt-dir "$HOME/Library/Mobile Documents/com~apple~CloudDocs/F1Plus1-Backups/observer-receipts" \
  --signing-key-file "$STATE_ROOT/signing-private.pem" > "$STATE_ROOT/last-run.json" 2> "$STATE_ROOT/last-error.json" || result=$?
fi
printf '%s exit=%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$result" "$(cat "$STATE_ROOT/last-run.json")" "$(cat "$STATE_ROOT/last-error.json")" >> "$LOG_FILE"
exit "$result"
