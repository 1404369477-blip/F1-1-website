#!/bin/bash
# One bounded production cycle, using the 2026-09-06 accepted backup-only successor.
set -euo pipefail
umask 077
NODE="$HOME/.local/node-v24.18.0-darwin-arm64/bin/node"
RUNTIME="${1:?fixed runtime root required}"
EXPECTED_ROOT="${2:?runtime digest required}"
TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="$HOME/F1-1-website/backups"
BACKUP_ROOT="$BASE/snap"
ADMIN_ROOT="$HOME/Library/Application Support/F1Plus1/Admin"
STATE_ROOT="$HOME/Library/Application Support/F1Plus1/Backup"
DEPLOYMENT="$ADMIN_ROOT/deployment.json"
OFFHOST_ROOT="$HOME/Library/Mobile Documents/com~apple~CloudDocs/F1Plus1-Backups/snap"
RECEIPTS_ROOT="$BASE/off-host-receipts"
KEY_FILE="$STATE_ROOT/backup-snapshot.key"
PUBLIC_KEY="$STATE_ROOT/m5-observer-public.pem"
LOG_FILE="$STATE_ROOT/backup-cycle.log"
CYCLE_LOCK="$BASE/cycle.lock"
RETAIN=24
STAGE="RUNTIME_VERIFY"
ARCHIVE_STATUS="not_attempted"
DRILL_ROOT=""
LOCKED=0
log() {
  if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt 5242880 ]; then mv -f "$LOG_FILE" "$LOG_FILE.previous"; fi
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG_FILE"
}
status() {
  "$NODE" -e 'const fs=require("node:fs"),[p,stage,ok,archiveStatus]=process.argv.slice(1);const tmp=p+"."+process.pid+".tmp";fs.writeFileSync(tmp,JSON.stringify({schemaVersion:"backup-cycle-status-v2",observedAt:new Date().toISOString(),stage,ok:ok==="true",archiveStatus})+"\n",{mode:384,flag:"wx"});fs.renameSync(tmp,p);' "$STATE_ROOT/last-cycle.json" "$STAGE" "$1" "$ARCHIVE_STATUS"
}
finish() {
  local result=$?
  trap - EXIT
  set +e
  if [ "$result" -ne 0 ]; then
    # Keep a bounded receipt set; encrypted packages remain in the normal retention set.
    for name in snapshot drill application-drill register; do
      if [ -f "$STATE_ROOT/last-$name.json" ]; then cp "$STATE_ROOT/last-$name.json" "$STATE_ROOT/last-failure-$name.json"; fi
    done
    if [ -f "$STATE_ROOT/last-drill.json.failure.log" ]; then cp "$STATE_ROOT/last-drill.json.failure.log" "$STATE_ROOT/last-failure-application.log"; fi
  fi
  if [ -n "$DRILL_ROOT" ]; then
    case "$DRILL_ROOT" in "$BASE"/cycle-drill.*) rm -rf -- "$DRILL_ROOT" || result=1 ;; *) result=1 ;; esac
  fi
  if [ "$LOCKED" -eq 1 ]; then
    if [ "$(cat "$CYCLE_LOCK/pid")" = "$$" ]; then rm -- "$CYCLE_LOCK/pid" || result=1; rmdir "$CYCLE_LOCK" || result=1; else result=1; fi
  fi
  if [ "$result" -ne 0 ]; then
    status false; cp "$STATE_ROOT/last-cycle.json" "$STATE_ROOT/last-failure-cycle.json"
    log "CYCLE_FAILED stage=$STAGE package=${PACKAGE_ID:-none} runtime=$EXPECTED_ROOT"
  else
    STAGE="COMPLETE"; status true || result=1
    log "CYCLE_OK package=${PACKAGE_ID:-none}"
  fi
  exit "$result"
}
trap finish EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
for agent_log in "$STATE_ROOT/backup-agent.stdout.log" "$STATE_ROOT/backup-agent.stderr.log"; do
  if [ -L "$agent_log" ]; then STAGE="AGENT_LOG_PATH_REJECTED"; exit 1; fi
  if [ -f "$agent_log" ] && [ "$(wc -c < "$agent_log")" -gt 5242880 ]; then mv -f "$agent_log" "$agent_log.previous"; fi
done
run() {
  local seconds=$1; shift
  "$NODE" "$TOOLS_DIR/bounded-backup-command.mjs" "$seconds" "$@"
}
get_deployment() {
  "$NODE" -e 'const fs=require("node:fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))[process.argv[2]];if(typeof v!=="string"||!v.length||/[\r\n]/.test(v))process.exit(1);process.stdout.write(v);' "$DEPLOYMENT" "$1"
}
run 30 "$NODE" "$TOOLS_DIR/verify-backup-runtime.mjs" "$RUNTIME" "$EXPECTED_ROOT" > "$STATE_ROOT/last-runtime.json" 2> "$STATE_ROOT/last-runtime-error.log"
mkdir "$CYCLE_LOCK" || { STAGE="CYCLE_LOCK_BUSY"; exit 1; }
LOCKED=1
printf '%s\n' "$$" > "$CYCLE_LOCK/pid"
"$NODE" - "$RECEIPTS_ROOT" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),root=process.argv[2];
const parent=fs.lstatSync(root);
if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&63))throw Error('OFF_HOST_RECEIPTS_DIRECTORY_REJECTED');
for(const name of fs.readdirSync(root)){
  const complete=/^([0-9]{13})_[a-f0-9]{16}\.json$/.exec(name);
  const temporary=/^\.[0-9]{13}_[a-f0-9]{16}\.[a-f0-9]{32}\.tmp$/.test(name);
  if(!complete&&!temporary)continue;
  const file=path.join(root,name),s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.nlink!==1||(s.mode&63))continue;
  if((complete&&Date.now()-Number(complete[1])>7*86400000)||(temporary&&Date.now()-s.mtimeMs>86400000))fs.unlinkSync(file);
}
NODE
STAGE="SNAPSHOT"
X_SNAPSHOT_ARGS=()
if [ "$(get_deployment reviewSchemaSha256)" = "4aa8876e5e197232a7e1ff2b04a21c7a66789734c2f58c619a29f4ed33c3ff72" ]; then
  X_DEPLOYMENT_SHA="$("$NODE" -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$DEPLOYMENT")"
  X_SNAPSHOT_ARGS=(--deployment-manifest "$DEPLOYMENT" --deployment-manifest-sha256 "$X_DEPLOYMENT_SHA")
fi
run 180 "$NODE" --experimental-transform-types "$RUNTIME/scripts/backup-snapshot-once.ts" \
  --source-db "$(get_deployment reviewDatabasePath)" --projection-root "$(get_deployment publicProjectionRoot)" \
  --output-dir "$BACKUP_ROOT" --key-file "$KEY_FILE" --retain "$RETAIN" "${X_SNAPSHOT_ARGS[@]}" > "$STATE_ROOT/last-snapshot.json"
log "SNAPSHOT $(cat "$STATE_ROOT/last-snapshot.json")"
PACKAGE_ID="$("$NODE" -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!v.ok||!/^[0-9]{13}_[a-f0-9]{16}$/.test(v.packageId))process.exit(1);process.stdout.write(v.packageId)' "$STATE_ROOT/last-snapshot.json")"
STAGE="OFFHOST_INDEPENDENT_READ"
deadline=$((SECONDS + 315))
while [ ! -f "$RECEIPTS_ROOT/$PACKAGE_ID.json" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then exit 1; fi
  sleep 2
done
STAGE="RESTORE_DRILL"
DRILL_ROOT="$(mktemp -d "$BASE/cycle-drill.XXXXXXXX")"
mkdir -p "$STATE_ROOT/application-receipts"
"$NODE" - "$STATE_ROOT/application-receipts" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),root=process.argv[2];
for(const name of fs.readdirSync(root)){
  const m=/^([0-9]{13})_[a-f0-9]{16}\.json$/.exec(name);
  if(!m || Date.now()-Number(m[1])<=7*86400000)continue;
  const file=path.join(root,name),s=fs.lstatSync(file);
  if(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&s.nlink===1&&!(s.mode&18))fs.unlinkSync(file);
}
NODE
APPLICATION_RECEIPT="$STATE_ROOT/application-receipts/$PACKAGE_ID.json"
run 180 "$NODE" --experimental-transform-types "$TOOLS_DIR/backup-application-drill.mjs" \
  "$RUNTIME" "$EXPECTED_ROOT" "$DEPLOYMENT" "$BACKUP_ROOT" "$DRILL_ROOT" "$KEY_FILE" \
  "$STATE_ROOT/application-drill-private.pem" "$STATE_ROOT/last-drill.json" "$APPLICATION_RECEIPT" > "$STATE_ROOT/last-application-drill.json"
log "APPLICATION_DRILL $(cat "$STATE_ROOT/last-application-drill.json")"
SCHEMA_SHA="$("$NODE" -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1])).payload;if(!/^[a-f0-9]{64}$/.test(v.schemaSha256))process.exit(1);process.stdout.write(v.schemaSha256)' "$APPLICATION_RECEIPT")"
STAGE="REGISTER"
MANIFEST_SHA="$(shasum -a 256 "$DEPLOYMENT" | cut -d' ' -f1)"
run 45 "$NODE" --experimental-transform-types "$RUNTIME/scripts/backup-recovery-point-register.ts" \
  --backup-root "$BACKUP_ROOT" --db "$(get_deployment reviewDatabasePath)" \
  --drill-report "$STATE_ROOT/last-drill.json" --restore-root "$DRILL_ROOT" --key-file "$KEY_FILE" \
  --release-sha256 "$(get_deployment fullReleaseManifestSha256)" --manifest-sha256 "$MANIFEST_SHA" \
  --schema-sha256 "$SCHEMA_SHA" --budget-account-id backup-private --retention-policy-id snap-cycle-v2 \
  --projection-signing-key-id "$(get_deployment projectionSigningKeyId)" --projection-public-key "$(get_deployment projectionVerifyKeyPath)" \
  --off-host-receipt "$RECEIPTS_ROOT/$PACKAGE_ID.json" --off-host-public-key "$PUBLIC_KEY" \
  --application-drill-receipt "$APPLICATION_RECEIPT" --application-drill-public-key "$STATE_ROOT/application-drill-public.pem" \
  --fence-path "$ADMIN_ROOT/recovery-fence.json" --allow-production > "$STATE_ROOT/last-register.json"
log "REGISTER $(cat "$STATE_ROOT/last-register.json")"
STAGE="ICLOUD_ARCHIVE"
# The independent M5 copy and signed read above are the off-host registration gate.
# iCloud is an additional bounded archive; failures remain visible without undoing that proof.
if run 60 /bin/bash -c '
  set -euo pipefail; umask 077
  source_root=$1; archive_root=$2
  mkdir -p "$archive_root/objects" "$archive_root/packages"
  for directory in "$archive_root" "$archive_root/objects" "$archive_root/packages"; do test ! -L "$directory"; done
  /usr/bin/rsync -a --delete-after "$source_root/objects/" "$archive_root/objects/"
  /usr/bin/rsync -a --delete-after "$source_root/packages/" "$archive_root/packages/"
  cp "$source_root/latest.json" "$archive_root/latest.json.tmp"
  mv "$archive_root/latest.json.tmp" "$archive_root/latest.json"
' archive "$BACKUP_ROOT" "$OFFHOST_ROOT" > "$STATE_ROOT/last-archive.stdout" 2> "$STATE_ROOT/last-archive.stderr"; then
  ARCHIVE_STATUS="archived"; log "ICLOUD_ARCHIVE_OK package=$PACKAGE_ID"
else
  ARCHIVE_STATUS="failed"; log "ICLOUD_ARCHIVE_FAILED package=$PACKAGE_ID independent_m5_copy=verified"
fi
STAGE="REGISTERED_CLEANUP_PENDING"
