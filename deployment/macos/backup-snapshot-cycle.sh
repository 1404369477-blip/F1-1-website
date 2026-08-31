#!/bin/bash
# SNAP 快照轮换一轮:本机 VACUUM INTO 快照 → 成功后仅把密文镜像到 iCloud Drive
# → 隔离恢复演练 → 通过 gateway 登记 backup_recovery_point 并刷新 recovery-fence。
# 由 com.f1plus1.backup-snapshot LaunchAgent 每 900 秒调用一次。
# 依据 ADR-F1PLUS1-DATA-REDERIVABILITY-RPO-RETIER-001 v2(accepted);
# 登记环节为用户 2026-08-31 批准的生产接线(TASK-20260830-C917F4 产物)。
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

# 恢复点登记:隔离演练本轮包 → gateway 合法 INSERT backup_recovery_point → 刷新 fence。
# release/manifest 哈希在运行时从部署清单推导,避免重新部署后脚本失配。
# 过渡态:登记 CLI 及其 internal-operation 依赖图只存在于源码仓库(生产树是公开站
# 应用,无控制面代码);下次 release 切换应把该工具链纳入发布物后改回 $APP_ROOT。
REGISTER_APP_ROOT="$HOME/Documents/F1+1/app"
ADMIN_ROOT="$HOME/Library/Application Support/F1Plus1/Admin"
DEPLOYMENT_MANIFEST="$ADMIN_ROOT/deployment.json"
DRILL_ROOT="$HOME/F1-1-website/backups/register-drill.tmp"
DRILL_REPORT="$HOME/F1-1-website/backups/register-drill-report.json"

RELEASE_SHA="$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).fullReleaseManifestSha256)' "$DEPLOYMENT_MANIFEST")"
MANIFEST_SHA="$(shasum -a 256 "$DEPLOYMENT_MANIFEST" | cut -d' ' -f1)"

rm -rf "$DRILL_ROOT"
"$NODE" --experimental-transform-types "$APP_ROOT/scripts/backup-restore-drill.ts" \
  --backup-root "$BACKUP_ROOT" \
  --restore-root "$DRILL_ROOT" \
  --key-file "$KEY_FILE" \
  --expected-user-version 10 > "$DRILL_REPORT" || {
  log "REGISTER_DRILL_FAILED"
  rm -rf "$DRILL_ROOT"
  exit 1
}

receipt="$("$NODE" --experimental-transform-types "$REGISTER_APP_ROOT/scripts/backup-recovery-point-register.ts" \
  --backup-root "$BACKUP_ROOT" \
  --db "$SOURCE_DB" \
  --drill-report "$DRILL_REPORT" \
  --restore-root "$DRILL_ROOT" \
  --release-sha256 "$RELEASE_SHA" \
  --manifest-sha256 "$MANIFEST_SHA" \
  --budget-account-id backup-private \
  --fence-path "$ADMIN_ROOT/recovery-fence.json" \
  --off-host-verified \
  --allow-production)" || {
  log "REGISTER_FAILED ${receipt:-no-receipt}"
  rm -rf "$DRILL_ROOT"
  exit 1
}
rm -rf "$DRILL_ROOT"
log "REGISTER ${receipt}"
