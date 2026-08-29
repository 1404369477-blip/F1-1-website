import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson, sha256 } from "./bilingual-core.ts";
import { BILINGUAL_SOURCE_SCHEMA8_SHA256, bilingualSchemaFingerprint } from "./bilingual-migration.ts";

export const RECENT_THREE_AUTHORITY_SQL = `SELECT c.candidate_id,c.source_id,c.canonical_url,c.source_payload_hash,c.source_revision,
  s.feed_url,s.enabled AS source_enabled,s.stop_epoch,
  b.bundle_id,b.bundle_revision,b.bundle_hash,d.decision_id,d.approved_bundle_hash,
  p.publication_id,p.public_id,p.publish_generation,p.published_at,
  projection.projection_id,projection.projection_hash
FROM publication p
JOIN published_projection projection ON projection.publication_id=p.publication_id AND projection.public_id=p.public_id
JOIN review_bundle b ON b.bundle_id=p.bundle_id AND b.bundle_hash=p.approved_bundle_hash
JOIN review_decision d ON d.decision_id=p.decision_id AND d.bundle_id=b.bundle_id AND d.decision='approved' AND d.approved_bundle_hash=b.bundle_hash
JOIN pending_review_candidate c ON c.candidate_id=b.candidate_id AND c.source_revision=b.source_revision AND c.source_payload_hash=b.source_payload_hash
JOIN source s ON s.source_id=c.source_id AND s.enabled=1
WHERE p.publication_status='published'
ORDER BY p.published_at DESC,p.public_id ASC LIMIT 3` as const;

export type BackfillDatabaseIdentity = Readonly<{ pathSha256: string; fileSha256: string; device: string; inode: string; uid: number; nlink: number; size: number; userVersion: 8; schemaFingerprint: string; dataVersion: number; pageCount: number; freelistCount: number; journalMode: string }>;
export type BackfillAuthority = Readonly<{
  routeId: string; routeEndpointIdentitySha256: string; routeReleaseSha256: string; routeManifestSha256: string; routeVersion: number;
  budgetAccountId: string; budgetUnitKind: string; budgetHardLimit: number; budgetConsumedUnits: number; budgetReservedUnits: number; budgetVersion: number;
  promptSchemaVersion: string; promptSha256: string;
}>;
export type BackfillCandidate = Readonly<{ candidateId: string; publicId: string; sourceId: string; sourceFeedUrl: string; sourceEnabled: 1; sourceStopEpoch: number; sourceRevision: number; sourcePayloadHash: string; canonicalUrl: string; bundleId: string; bundleRevision: number; bundleHash: string; decisionId: string; approvedBundleHash: string; publicationId: string; publicationRevision: number; projectionId: string; projectionHash: string; publishedAt: string; authorityHash: string }>;
export type AuthorityQueryReceipt = Readonly<{ kind: "existing_only_schema8_recent_three"; database: BackfillDatabaseIdentity; sqlHash: string; operationId: string; queriedAt: string; authority: BackfillAuthority; itemsHash: string; receiptHash: string }>;
export type BackfillSelection = Readonly<{ sourceDatabasePath: string; receipt: AuthorityQueryReceipt; items: readonly [BackfillCandidate, BackfillCandidate, BackfillCandidate] }>;
const trustedAuthoritySelections = new WeakSet<object>();

function hashFile(path: string): string { return createHash("sha256").update(path).digest("hex"); }
function databaseIdentity(path: string, database: DatabaseSync): BackfillDatabaseIdentity {
  const info = statSync(path, { bigint: true });
  const userVersion = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
  if (userVersion !== 8) throw new Error("BACKFILL_SCHEMA8_REQUIRED");
  const pragmaNumber = (name: string): number => Number(Object.values(database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0]);
  const journalMode = String(Object.values(database.prepare("PRAGMA journal_mode").get() as Record<string, unknown>)[0]);
  return Object.freeze({ pathSha256: hashFile(path), fileSha256: createHash("sha256").update(readFileSync(path)).digest("hex"), device: info.dev.toString(), inode: info.ino.toString(), uid: Number(info.uid), nlink: Number(info.nlink), size: Number(info.size), userVersion: 8, schemaFingerprint: bilingualSchemaFingerprint(database), dataVersion: pragmaNumber("data_version"), pageCount: pragmaNumber("page_count"), freelistCount: pragmaNumber("freelist_count"), journalMode });
}
function openExistingOnly(pathInput: string): { path: string; database: DatabaseSync; identity: BackfillDatabaseIdentity } {
  if (!isAbsolute(pathInput)) throw new Error("BACKFILL_ABSOLUTE_PATH_REQUIRED");
  const requestedPath = resolve(pathInput);
  if (lstatSync(requestedPath).isSymbolicLink()) throw new Error("BACKFILL_EXISTING_ONLY_IDENTITY_INVALID");
  const path = realpathSync(requestedPath);
  if (!statSync(path).isFile() || statSync(path).nlink !== 1) throw new Error("BACKFILL_EXISTING_ONLY_IDENTITY_INVALID");
  const database = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  database.exec("PRAGMA query_only=ON; PRAGMA foreign_keys=ON;");
  const attached = database.prepare("PRAGMA database_list").all() as Array<Record<string, unknown>>;
  if (attached.some((row) => row.name !== "main" && row.name !== "temp")) { database.close(); throw new Error("BACKFILL_ATTACHED_DATABASE_FORBIDDEN"); }
  const identity = databaseIdentity(path, database);
  if (identity.schemaFingerprint !== BILINGUAL_SOURCE_SCHEMA8_SHA256) { database.close(); throw new Error("BACKFILL_SCHEMA8_FINGERPRINT_DRIFT"); }
  return { path, database, identity };
}

function rowCandidate(row: Record<string, unknown>): BackfillCandidate {
  const core = {
    candidateId: String(row.candidate_id), publicId: String(row.public_id), sourceId: String(row.source_id), sourceFeedUrl: String(row.feed_url), sourceEnabled: Number(row.source_enabled) as 1, sourceStopEpoch: Number(row.stop_epoch), sourceRevision: Number(row.source_revision), sourcePayloadHash: String(row.source_payload_hash), canonicalUrl: String(row.canonical_url),
    bundleId: String(row.bundle_id), bundleRevision: Number(row.bundle_revision), bundleHash: String(row.bundle_hash), decisionId: String(row.decision_id), approvedBundleHash: String(row.approved_bundle_hash),
    publicationId: String(row.publication_id), publicationRevision: Number(row.publish_generation), projectionId: String(row.projection_id), projectionHash: String(row.projection_hash), publishedAt: String(row.published_at)
  };
  return Object.freeze({ ...core, authorityHash: sha256(canonicalJson(core)) });
}

export function queryRecentThreeFromExistingOnly(input: Readonly<{ sourceDatabasePath: string; routeId: string; budgetAccountId: string; promptSchemaVersion: string; promptSha256: string; operationId: string; queriedAt: string }>): BackfillSelection {
  const opened = openExistingOnly(input.sourceDatabasePath);
  try {
    opened.database.exec("BEGIN");
    const route = opened.database.prepare("SELECT route_id,endpoint_identity_sha256,release_sha256,manifest_sha256,version FROM route_registry WHERE route_id=? AND route_class='model' AND endpoint_class='model_refine' AND state='active'").get(input.routeId) as Record<string, unknown> | undefined;
    const budget = opened.database.prepare("SELECT account_id,unit_kind,hard_limit,consumed_units,reserved_units,version FROM budget_account WHERE account_id=?").get(input.budgetAccountId) as Record<string, unknown> | undefined;
    if (!route || !budget || Number(budget.hard_limit) - Number(budget.consumed_units) - Number(budget.reserved_units) < 3) throw new Error("BACKFILL_ROUTE_OR_BUDGET_AUTHORITY_CLOSED");
    const rows = opened.database.prepare(RECENT_THREE_AUTHORITY_SQL).all() as Array<Record<string, unknown>>;
    if (rows.length !== 3) throw new Error("BACKFILL_EXACTLY_THREE_REQUIRED");
    const items = rows.map(rowCandidate) as [BackfillCandidate, BackfillCandidate, BackfillCandidate];
    const authority: BackfillAuthority = Object.freeze({ routeId: String(route.route_id), routeEndpointIdentitySha256: String(route.endpoint_identity_sha256), routeReleaseSha256: String(route.release_sha256), routeManifestSha256: String(route.manifest_sha256), routeVersion: Number(route.version), budgetAccountId: String(budget.account_id), budgetUnitKind: String(budget.unit_kind), budgetHardLimit: Number(budget.hard_limit), budgetConsumedUnits: Number(budget.consumed_units), budgetReservedUnits: Number(budget.reserved_units), budgetVersion: Number(budget.version), promptSchemaVersion: input.promptSchemaVersion, promptSha256: input.promptSha256 });
    const receiptCore = { kind: "existing_only_schema8_recent_three" as const, database: opened.identity, sqlHash: sha256(RECENT_THREE_AUTHORITY_SQL), operationId: input.operationId, queriedAt: input.queriedAt, authority, itemsHash: sha256(canonicalJson(items)) };
    opened.database.exec("COMMIT");
    if (canonicalJson(databaseIdentity(opened.path, opened.database)) !== canonicalJson(opened.identity)) throw new Error("BACKFILL_DATABASE_IDENTITY_DRIFT");
    const selection: BackfillSelection = Object.freeze({ sourceDatabasePath: opened.path, receipt: Object.freeze({ ...receiptCore, receiptHash: sha256(canonicalJson(receiptCore)) }), items: Object.freeze(items) });
    trustedAuthoritySelections.add(selection);
    return selection;
  } catch (error) { try { opened.database.exec("ROLLBACK"); } catch { /* no active read transaction */ } throw error; }
  finally { opened.database.close(); }
}

const DISPOSABLE_SCHEMA = `
CREATE TABLE bilingual_backfill_meta(schema_id TEXT PRIMARY KEY CHECK(schema_id='bilingual-backfill-disposable-v1')) STRICT;
INSERT INTO bilingual_backfill_meta VALUES('bilingual-backfill-disposable-v1');
CREATE TABLE bilingual_backfill_operation(operation_id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,request_hash TEXT NOT NULL UNIQUE,authority_receipt_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('staged','complete')),created_at TEXT NOT NULL) STRICT;
CREATE TABLE bilingual_backfill_attempt(attempt_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL REFERENCES bilingual_backfill_operation(operation_id),language TEXT NOT NULL CHECK(language IN('zh-CN','en')),route_id TEXT NOT NULL,budget_account_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state='queued'),UNIQUE(operation_id,language)) STRICT;
CREATE TABLE bilingual_backfill_receipt(receipt_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE REFERENCES bilingual_backfill_operation(operation_id),candidate_authority_hash TEXT NOT NULL,source_database_identity_hash TEXT NOT NULL,route_authority_hash TEXT NOT NULL,budget_authority_hash TEXT NOT NULL,prompt_authority_hash TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
CREATE TRIGGER bilingual_backfill_meta_no_update BEFORE UPDATE ON bilingual_backfill_meta BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;
CREATE TRIGGER bilingual_backfill_meta_no_delete BEFORE DELETE ON bilingual_backfill_meta BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;
CREATE TRIGGER bilingual_backfill_operation_transition BEFORE UPDATE ON bilingual_backfill_operation WHEN NEW.operation_id<>OLD.operation_id OR NEW.candidate_id<>OLD.candidate_id OR NEW.request_hash<>OLD.request_hash OR NEW.authority_receipt_hash<>OLD.authority_receipt_hash OR NEW.created_at<>OLD.created_at OR OLD.state<>'staged' OR NEW.state<>'complete' BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;
CREATE TRIGGER bilingual_backfill_operation_no_delete BEFORE DELETE ON bilingual_backfill_operation BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;
CREATE TRIGGER bilingual_backfill_attempt_no_update BEFORE UPDATE ON bilingual_backfill_attempt BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;
CREATE TRIGGER bilingual_backfill_attempt_no_delete BEFORE DELETE ON bilingual_backfill_attempt BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;
CREATE TRIGGER bilingual_backfill_receipt_no_update BEFORE UPDATE ON bilingual_backfill_receipt BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;
CREATE TRIGGER bilingual_backfill_receipt_no_delete BEFORE DELETE ON bilingual_backfill_receipt BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;`;
const DISPOSABLE_TABLES = Object.freeze(["bilingual_backfill_meta", "bilingual_backfill_operation", "bilingual_backfill_attempt", "bilingual_backfill_receipt"]);
const DISPOSABLE_TRIGGERS = Object.freeze(["bilingual_backfill_meta_no_update", "bilingual_backfill_meta_no_delete", "bilingual_backfill_operation_transition", "bilingual_backfill_operation_no_delete", "bilingual_backfill_attempt_no_update", "bilingual_backfill_attempt_no_delete", "bilingual_backfill_receipt_no_update", "bilingual_backfill_receipt_no_delete"]);
export const BILINGUAL_DISPOSABLE_SCHEMA_SHA256 = "a74e8d066cf0f3581447e094a86275ad94ab2010fa093ebeb3cc3d7b885c5f5a";

export function bilingualDisposableSchemaFingerprint(database: DatabaseSync): string {
  const expectedNames = [...DISPOSABLE_TABLES, ...DISPOSABLE_TRIGGERS].sort();
  const rows = database.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN (${expectedNames.map(() => "?").join(",")}) ORDER BY type,name,tbl_name,sql`).all(...expectedNames) as Array<Record<string, unknown>>;
  return sha256(canonicalJson(rows.map((row) => ({ type: String(row.type), name: String(row.name), tbl_name: String(row.tbl_name), sql: String(row.sql) }))));
}

function assertDisposableSchema(database: DatabaseSync): void {
  const names = (database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as Array<Record<string, unknown>>).map((row) => String(row.name));
  if (canonicalJson(names) !== canonicalJson([...DISPOSABLE_TABLES].sort())) throw new Error("BACKFILL_DISPOSABLE_SCHEMA_INVALID");
  const triggers = (database.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name").all() as Array<Record<string, unknown>>).map((row) => String(row.name));
  if (canonicalJson(triggers) !== canonicalJson([...DISPOSABLE_TRIGGERS].sort())) throw new Error("BACKFILL_DISPOSABLE_SCHEMA_INVALID");
  if (bilingualDisposableSchemaFingerprint(database) !== BILINGUAL_DISPOSABLE_SCHEMA_SHA256) throw new Error("BACKFILL_DISPOSABLE_SCHEMA_INVALID");
  if (database.prepare("SELECT 1 FROM bilingual_backfill_meta WHERE schema_id='bilingual-backfill-disposable-v1'").get() === undefined || database.prepare("PRAGMA foreign_key_check").get() !== undefined) throw new Error("BACKFILL_DISPOSABLE_SCHEMA_INVALID");
}

function resolveDisposableTarget(pathInput: string, sourcePath: string): Readonly<{ path: string; existed: boolean }> {
  if (!isAbsolute(pathInput)) throw new Error("BACKFILL_DISPOSABLE_ABSOLUTE_PATH_REQUIRED");
  const requested = resolve(pathInput);
  const parent = realpathSync(dirname(requested));
  const path = join(parent, basename(requested));
  const existed = existsSync(path);
  if (existed && lstatSync(path).isSymbolicLink()) throw new Error("BACKFILL_DISPOSABLE_IDENTITY_INVALID");
  const canonicalSource = realpathSync(sourcePath);
  if (path === canonicalSource) throw new Error("BACKFILL_SOURCE_TARGET_ALIAS_FORBIDDEN");
  if (existed) {
    const targetInfo = statSync(path); const sourceInfo = statSync(canonicalSource);
    if (!targetInfo.isFile() || targetInfo.nlink !== 1 || (targetInfo.dev === sourceInfo.dev && targetInfo.ino === sourceInfo.ino)) throw new Error("BACKFILL_SOURCE_TARGET_ALIAS_FORBIDDEN");
    const existing = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    try { assertDisposableSchema(existing); } finally { existing.close(); }
  }
  return Object.freeze({ path, existed });
}

function readCurrentAuthority(database: DatabaseSync, candidateId: string): BackfillCandidate | null {
  const row = database.prepare(`${RECENT_THREE_AUTHORITY_SQL.replace(/ORDER BY[\s\S]*$/u, "")} AND c.candidate_id=?`).get(candidateId) as Record<string, unknown> | undefined;
  return row ? rowCandidate(row) : null;
}

export type DisposableApplyResult = Readonly<{ candidateId: string; operationId: string; attemptIds: readonly [string, string]; replay: boolean; committed: boolean }>;
export function applyRecentThreeToDisposable(selection: BackfillSelection, disposableDatabasePath: string, options: Readonly<{ failCandidateId?: string }> = {}): readonly DisposableApplyResult[] {
  if (!trustedAuthoritySelections.has(selection)) throw new Error("BACKFILL_CALLER_FIXTURE_FORBIDDEN");
  const targetIdentity = resolveDisposableTarget(disposableDatabasePath, selection.sourceDatabasePath);
  const opened = openExistingOnly(selection.sourceDatabasePath);
  let target: DatabaseSync;
  try {
    target = new DatabaseSync(targetIdentity.path, { allowExtension: false });
    const targetInfo = statSync(targetIdentity.path); const sourceInfo = statSync(opened.path);
    if (lstatSync(targetIdentity.path).isSymbolicLink() || !targetInfo.isFile() || targetInfo.nlink !== 1) throw new Error("BACKFILL_DISPOSABLE_IDENTITY_INVALID");
    if (targetInfo.dev === sourceInfo.dev && targetInfo.ino === sourceInfo.ino) throw new Error("BACKFILL_SOURCE_TARGET_ALIAS_FORBIDDEN");
    target.exec("PRAGMA foreign_keys=ON;");
    if (!targetIdentity.existed) {
      target.exec("BEGIN IMMEDIATE");
      try { target.exec(DISPOSABLE_SCHEMA); target.exec("COMMIT"); }
      catch (error) { target.exec("ROLLBACK"); throw error; }
    }
    assertDisposableSchema(target);
  } catch (error) {
    try { target!.close(); } catch { /* initialization did not complete */ }
    opened.database.close();
    if (!targetIdentity.existed && existsSync(targetIdentity.path)) unlinkSync(targetIdentity.path);
    throw error;
  }
  const results: DisposableApplyResult[] = [];
  try {
    opened.database.exec("BEGIN");
    const { receiptHash, ...receiptCore } = selection.receipt;
    if (sha256(canonicalJson(receiptCore)) !== receiptHash || canonicalJson(opened.identity) !== canonicalJson(selection.receipt.database)) throw new Error("BACKFILL_AUTHORITY_RECEIPT_DRIFT");
    for (const item of selection.items) {
      const current = readCurrentAuthority(opened.database, item.candidateId);
      if (!current || current.authorityHash !== item.authorityHash) throw new Error("BACKFILL_ITEM_CAS_DRIFT");
      const requestHash = sha256(canonicalJson({ receiptHash, itemAuthorityHash: item.authorityHash }));
      const operationId = `backfill-${requestHash.slice(0, 48)}`;
      const attempts = [`attempt-${sha256(`${operationId}\nzh-CN`).slice(0, 48)}`, `attempt-${sha256(`${operationId}\nen`).slice(0, 48)}`] as const;
      const receiptId = `receipt-${requestHash.slice(0, 48)}`;
      const sourceDatabaseIdentityHash = sha256(canonicalJson(selection.receipt.database));
      const routeAuthorityHash = sha256(canonicalJson({ routeId: selection.receipt.authority.routeId, endpoint: selection.receipt.authority.routeEndpointIdentitySha256, release: selection.receipt.authority.routeReleaseSha256, manifest: selection.receipt.authority.routeManifestSha256, version: selection.receipt.authority.routeVersion }));
      const budgetAuthorityHash = sha256(canonicalJson({ accountId: selection.receipt.authority.budgetAccountId, hard: selection.receipt.authority.budgetHardLimit, consumed: selection.receipt.authority.budgetConsumedUnits, reserved: selection.receipt.authority.budgetReservedUnits, version: selection.receipt.authority.budgetVersion }));
      const promptAuthorityHash = sha256(canonicalJson({ schema: selection.receipt.authority.promptSchemaVersion, sha256: selection.receipt.authority.promptSha256 }));
      const existing = target.prepare("SELECT operation_id,candidate_id,authority_receipt_hash,state,created_at FROM bilingual_backfill_operation WHERE request_hash=?").get(requestHash) as Record<string, unknown> | undefined;
      if (existing) {
        const existingAttempts = target.prepare("SELECT attempt_id,language,route_id,budget_account_id,state FROM bilingual_backfill_attempt WHERE operation_id=? ORDER BY language").all(operationId) as Array<Record<string, unknown>>;
        const existingReceipt = target.prepare("SELECT receipt_id,operation_id,candidate_authority_hash,source_database_identity_hash,route_authority_hash,budget_authority_hash,prompt_authority_hash,created_at FROM bilingual_backfill_receipt WHERE operation_id=?").get(operationId) as Record<string, unknown> | undefined;
        const expectedAttempts = [{ attempt_id: attempts[1], language: "en", route_id: selection.receipt.authority.routeId, budget_account_id: selection.receipt.authority.budgetAccountId, state: "queued" }, { attempt_id: attempts[0], language: "zh-CN", route_id: selection.receipt.authority.routeId, budget_account_id: selection.receipt.authority.budgetAccountId, state: "queued" }];
        const expectedReceipt = { receipt_id: receiptId, operation_id: operationId, candidate_authority_hash: item.authorityHash, source_database_identity_hash: sourceDatabaseIdentityHash, route_authority_hash: routeAuthorityHash, budget_authority_hash: budgetAuthorityHash, prompt_authority_hash: promptAuthorityHash, created_at: selection.receipt.queriedAt };
        if (String(existing.operation_id) !== operationId || String(existing.candidate_id) !== item.candidateId || String(existing.authority_receipt_hash) !== receiptHash || existing.state !== "complete" || existing.created_at !== selection.receipt.queriedAt || canonicalJson(existingAttempts) !== canonicalJson(expectedAttempts) || !existingReceipt || canonicalJson(existingReceipt) !== canonicalJson(expectedReceipt)) throw new Error("BACKFILL_REPLAY_RECEIPT_DRIFT");
        results.push(Object.freeze({ candidateId: item.candidateId, operationId, attemptIds: attempts, replay: true, committed: true })); continue;
      }
      target.exec("BEGIN IMMEDIATE");
      try {
        target.prepare("INSERT INTO bilingual_backfill_operation VALUES(?,?,?,?,?,?)").run(operationId, item.candidateId, requestHash, receiptHash, "staged", selection.receipt.queriedAt);
        target.prepare("INSERT INTO bilingual_backfill_attempt VALUES(?,?,?,?,?,?)").run(attempts[0], operationId, "zh-CN", selection.receipt.authority.routeId, selection.receipt.authority.budgetAccountId, "queued");
        target.prepare("INSERT INTO bilingual_backfill_attempt VALUES(?,?,?,?,?,?)").run(attempts[1], operationId, "en", selection.receipt.authority.routeId, selection.receipt.authority.budgetAccountId, "queued");
        target.prepare("INSERT INTO bilingual_backfill_receipt VALUES(?,?,?,?,?,?,?,?)").run(receiptId, operationId, item.authorityHash, sourceDatabaseIdentityHash, routeAuthorityHash, budgetAuthorityHash, promptAuthorityHash, selection.receipt.queriedAt);
        if (options.failCandidateId === item.candidateId) throw new Error("BACKFILL_INJECTED_ITEM_FAILURE");
        const completed = target.prepare("UPDATE bilingual_backfill_operation SET state='complete' WHERE operation_id=? AND state='staged'").run(operationId);
        if (completed.changes !== 1) throw new Error("BACKFILL_OPERATION_COMPLETION_CAS_FAILED");
        target.exec("COMMIT"); results.push(Object.freeze({ candidateId: item.candidateId, operationId, attemptIds: attempts, replay: false, committed: true }));
      } catch (error) { target.exec("ROLLBACK"); if (options.failCandidateId === item.candidateId) { results.push(Object.freeze({ candidateId: item.candidateId, operationId, attemptIds: attempts, replay: false, committed: false })); continue; } throw error; }
    }
    opened.database.exec("COMMIT");
    if (canonicalJson(databaseIdentity(opened.path, opened.database)) !== canonicalJson(opened.identity)) throw new Error("BACKFILL_DATABASE_IDENTITY_DRIFT");
    return Object.freeze(results);
  } catch (error) { try { opened.database.exec("ROLLBACK"); } catch { /* no active read transaction */ } throw error; }
  finally { target.close(); opened.database.close(); }
}
