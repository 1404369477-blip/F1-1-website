#!/bin/bash
# SNAP 快照轮换一轮:本机 VACUUM INTO 快照 → 成功后仅把密文镜像到 iCloud Drive。
# 由 com.f1plus1.backup-snapshot LaunchAgent 每 900 秒调用一次。
# 依据 ADR-F1PLUS1-DATA-REDERIVABILITY-RPO-RETIER-001 v2(accepted)。
set -euo pipefail

NODE="$HOME/.local/node-v24.18.0-darwin-arm64/bin/node"
APP_ROOT="$HOME/F1-1-website/app"
SOURCE_DB="$APP_ROOT/.local/f1plus1-rss-real-private.sqlite"
PROJECTION_ROOT="$HOME/Library/Application Support/F1Plus1/Public/projection"
BACKUP_ROOT="$HOME/F1-1-website/backups/snap"
KEY_FILE="$HOME/Library/Application Support/F1Plus1/Backup/backup-snapshot.key"
OFFHOST_ROOT="$HOME/Library/Mobile Documents/com~apple~CloudDocs/F1Plus1-Backups/snap"
LOG_FILE="$HOME/Library/Application Support/F1Plus1/Backup/backup-cycle.log"
RETAIN="${BACKUP_RETAIN:-8}"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG_FILE"
}

report="$("$NODE" --experimental-transform-types "$APP_ROOT/scripts/backup-snapshot-once.ts" \
  --source-db "$SOURCE_DB" \
  --projection-root "$PROJECTION_ROOT" \
  --output-dir "$BACKUP_ROOT" \
  --key-file "$KEY_FILE" \
  --retain "$RETAIN")" || {
  log "SNAPSHOT_FAILED ${report:-no-report}"
  exit 1
}
log "SNAPSHOT ${report}"

# 仅镜像密文与清单;.staging / run.lock 永不离开本机。
# 顺序:objects → packages → latest.json,保证异机端指针永远指向已存在的对象。
mkdir -p "$OFFHOST_ROOT"
rsync -a --delete "$BACKUP_ROOT/objects/" "$OFFHOST_ROOT/objects/"
rsync -a --delete "$BACKUP_ROOT/packages/" "$OFFHOST_ROOT/packages/"
cp "$BACKUP_ROOT/latest.json" "$OFFHOST_ROOT/latest.json.tmp"
mv "$OFFHOST_ROOT/latest.json.tmp" "$OFFHOST_ROOT/latest.json"
log "OFFHOST_MIRROR_OK"
