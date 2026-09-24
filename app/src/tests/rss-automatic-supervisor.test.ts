import {afterEach,describe,expect,test,vi} from "vitest";
import type {DatabaseSync,SQLInputValue} from "node:sqlite";
import {xPageSchema12} from "./helpers/x-page-database.ts";
import {seedRssAutomaticBackup,withRssSyntheticSeed} from "./helpers/rss-automatic-backup.ts";
import {applyRssAutomaticMigration} from "../server/rss-automatic/migration.ts";
import {createRssAutomaticHandoffProvider} from "../server/rss-automatic/supervisor.ts";
import {RSS_AUTOMATIC_SCHEMA_SHA256} from "../server/rss-automatic/schema-identity.ts";
import {fullV10Capabilities,type ReleaseRuntimeGate} from "../server/internal-operation/release.ts";
import {getInstalledSqliteAuthorizer,installSqliteAuthorizer} from "../server/internal-operation/authorizer.ts";

const NOW="2026-09-07T00:00:00.000Z",ZERO="0".repeat(64);
const databases:DatabaseSync[]=[];
afterEach(()=>{vi.useRealTimers();for(const db of databases.splice(0))db.close();});
// Release manifest verification is covered by rss-automatic-runtime.test.ts;
// this fixture supplies that boundary's closed interface to the supervisor.
const gate:ReleaseRuntimeGate={receipt:{schemaVersion:"f1plus1-release-activation-v10",activationId:"synthetic",pairId:"synthetic",
 releaseId:"synthetic",role:"full_v10",manifestSha256:ZERO,sourcePreimageSha256:ZERO,schemaSha256:RSS_AUTOMATIC_SCHEMA_SHA256,
 capabilitiesSha256:ZERO,activatedAt:NOW,previousActivationId:null},capabilities:fullV10Capabilities({schemaSha256:RSS_AUTOMATIC_SCHEMA_SHA256}),
 allows:()=>true,run:(_action,callback)=>callback()};
function ready(){vi.useFakeTimers();vi.setSystemTime(new Date(NOW));const db=xPageSchema12();databases.push(db);applyRssAutomaticMigration(db,{applyEnabled:true});
 withRssSyntheticSeed(db,()=>db.prepare("UPDATE internal_control SET phase='live',global_stop_state='clear',recovery_state='ready',deletion_fence_state='clear',publication_fence_state='clear',writer_authority_receipt_sha256=?").run("1".repeat(64)));return db;}
function provider(db:DatabaseSync,releaseGate=gate){return createRssAutomaticHandoffProvider({supervisorDatabase:db,releaseGate,expectedDeploymentManifestSha256:ZERO,expectedBackupReleaseSha256:ZERO,ownerProcess:"rss_refiner"});}
const seed=(db:DatabaseSync,backupOverrides:Record<string,SQLInputValue>={},operationOverrides:Record<string,SQLInputValue>={})=>seedRssAutomaticBackup(db,{releaseSha256:ZERO,manifestSha256:ZERO,nowIso:NOW,backupOverrides,operationOverrides});
describe("continuous RSS supervisor admission",()=>{
 test("issues distinct short one-use grants without a finite pool and restores the read-only authorizer",()=>{const db=ready();seed(db);installSqliteAuthorizer(db,"worker_or_repository");const grant=provider(db);
  const receipts=Array.from({length:120},()=>grant());expect(new Set(receipts.map(value=>value.handoffId)).size).toBe(120);
  expect(receipts.every(value=>Date.parse(value.expiresAt)-Date.parse(value.verifiedAt)===60_000)).toBe(true);
  expect(db.prepare("SELECT count(*) n FROM owner_authorization_handoff WHERE handoff_id LIKE 'rss-auto-handoff-%' AND consumed_by_operation_id IS NULL").get()!.n).toBe(120);
  expect(getInstalledSqliteAuthorizer(db)?.profile).toBe("worker_or_repository");expect(()=>db.exec("UPDATE internal_control SET version=version+1")).toThrow();
 });
 test("missing backup never issues a handoff",()=>{const db=ready();expect(()=>provider(db)()).toThrow("BACKUP_REQUIRED");expect(db.prepare("SELECT count(*) n FROM owner_authorization_handoff").get()!.n).toBe(0);});
 test("binds backup release and deployment identities separately from grant identities",()=>{const db=ready();const deployment="d".repeat(64),backupRelease="b".repeat(64);seedRssAutomaticBackup(db,{releaseSha256:backupRelease,manifestSha256:deployment,nowIso:NOW});
  expect(()=>provider(db)()).toThrow("BACKUP_REQUIRED");
  const grant=createRssAutomaticHandoffProvider({supervisorDatabase:db,releaseGate:gate,expectedDeploymentManifestSha256:deployment,expectedBackupReleaseSha256:backupRelease,ownerProcess:"rss_refiner"})();
  expect(grant.manifestSha256).toBe(gate.receipt.manifestSha256);
  expect(grant.releaseSha256).toBe(gate.receipt.sourcePreimageSha256);
 });
 test.each([
  ["expired",{recovery_point_at:"2026-09-06T23:44:59.000Z",completed_at:"2026-09-06T23:44:59.000Z"},{},"BACKUP_STALE"],
  ["future completion",{completed_at:"2026-09-07T00:00:01.000Z"},{},"BACKUP_STALE"],
  ["different release",{release_sha256:"a".repeat(64)},{},"BACKUP_REQUIRED"],
  ["different manifest",{deployment_manifest_sha256:"a".repeat(64)},{},"BACKUP_REQUIRED"],
  ["different writer",{writer_epoch:9},{},"BACKUP_REQUIRED"],
  ["different recovery",{recovery_epoch:9},{},"BACKUP_REQUIRED"],
  ["different authority",{writer_authority_receipt_sha256:"a".repeat(64)},{},"BACKUP_REQUIRED"],
  ["wrong backup owner",{},{owner_process:"rss_refiner"},"BACKUP_REQUIRED"],
  ["nonterminal backup",{},{state:"authorized",result_hash:null},"BACKUP_REQUIRED"],
  ["mismatched operation release",{},{expected_release_sha256:"a".repeat(64)},"BACKUP_REQUIRED"],
 ] as Array<[string,Record<string,SQLInputValue>,Record<string,SQLInputValue>,string]>)("rejects %s recovery evidence",(_name,backupOverrides,operationOverrides,code)=>{const db=ready();seed(db,backupOverrides,operationOverrides);expect(()=>provider(db)()).toThrow(code);expect(db.prepare("SELECT count(*) n FROM owner_authorization_handoff WHERE handoff_id LIKE 'rss-auto-handoff-%'").get()!.n).toBe(0);});
 test("the database rejects an off-host-unverified backup before admission",()=>{const db=ready();expect(()=>seed(db,{off_host_verified:0})).toThrow("CHECK constraint failed");expect(()=>provider(db)()).toThrow("BACKUP_REQUIRED");});
 test("closed release and a fresh stop reject before issuance",()=>{const db=ready();seed(db);
  expect(()=>provider(db,{...gate,capabilities:{...gate.capabilities,automaticPublish:false}})).toThrow("RELEASE_CLOSED");
  const grant=provider(db);withRssSyntheticSeed(db,()=>db.exec("UPDATE internal_control SET global_stop_state='stopped'"));expect(()=>grant()).toThrow();
  expect(db.prepare("SELECT count(*) n FROM owner_authorization_handoff WHERE handoff_id LIKE 'rss-auto-handoff-%'").get()!.n).toBe(0);
 });
});
