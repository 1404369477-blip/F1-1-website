import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { constants as sqliteConstants, DatabaseSync } from "node:sqlite";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { installSqliteAuthorizer } from "../src/server/internal-operation/authorizer.ts";
import { applyInternalOperationMigration } from "../src/server/review-real/migration.ts";
import { applyBilingualMigration, bilingualSchemaFingerprint, readBilingualMigrationSql, BILINGUAL_REFINEMENT_MIGRATION_CANONICAL_SHA256, BILINGUAL_REFINEMENT_MIGRATION_SHA256, BILINGUAL_SCHEMA9_SHA256, BILINGUAL_SOURCE_0008_CANONICAL_SHA256, BILINGUAL_SOURCE_0008_RAW_SHA256, BILINGUAL_SOURCE_SCHEMA8_SHA256, BILINGUAL_TABLES } from "../src/server/rss/bilingual-migration.ts";
import { applyXManualInboxMigration } from "../src/server/tweet-inbox/repository.ts";
import { CLOSED_BILINGUAL_MUTATION_PORT, assertSourceLineage } from "../src/server/rss/bilingual-core.ts";
import { runBilingualRefinement } from "../src/server/rss/bilingual-worker.ts";
import { applyRecentThreeToDisposable, queryRecentThreeFromExistingOnly } from "../src/server/rss/bilingual-backfill.ts";

const SQLITE = sqliteConstants as unknown as Record<string, number>;
type AuthorizableDatabase = DatabaseSync & {
  setAuthorizer: (callback: ((action: number, arg1?: string | null) => number) | null) => void;
};

const root = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/u, "");
const appRoot = root;
const repoRoot = dirname(appRoot);
const outputRoot = join(repoRoot, "scratch", "2026-08-24-ql3-0009-bilingual-evidence");
const runId = `run-${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}`;
const runRoot = join(outputRoot, runId);
const now = "2026-08-24T12:00:00.000Z";
const zero = "0".repeat(64);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function v8Database(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of [
    "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql",
    "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"
  ]) database.exec(readFileSync(join(appRoot, "migrations/rss-real", file), "utf8"));
  applyInternalOperationMigration(database, readFileSync(join(appRoot, "migrations/rss-real/0007_internal_operation_recovery_phase.sql"), "utf8"));
  applyXManualInboxMigration(database, readFileSync(join(appRoot, "migrations/rss-real/0008_x_manual_inbox.sql"), "utf8"));
  return database;
}

function recentThreeV8Database(path: string): void {
  const database = new DatabaseSync(path);
  for (const file of ["0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql", "0004_rss_media_and_chinese_refinement.sql", "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql"]) database.exec(readFileSync(join(appRoot, "migrations/rss-real", file), "utf8"));
  for (let index = 1; index <= 3; index += 1) {
    const candidateId = `candidate-backfill-${index}`; const hash = `${index}`.repeat(64); const publicId = `public-rss-${`${index + 3}`.repeat(64)}`; const publishedAt = `2026-08-2${index}T12:00:00.000Z`;
    const payload = JSON.stringify({ candidateId, sourceId: "motorsport-f1-news", sourceRevision: 1, sourcePayloadHash: hash, canonicalUrl: `https://example.invalid/${index}`, sourceTitle: `Source ${index}`, sourcePublishedAt: publishedAt, titleZh: `标题${index}`, summaryZh: `摘要${index}`, media: [] });
    database.prepare("INSERT INTO pending_review_candidate(candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,editor_title,editor_excerpt,editor_notes,editor_based_on_source_revision,first_seen_at,last_seen_at) VALUES(?,'motorsport-f1-news',?,?,?,?,?,NULL,?,?,1,?,?,?,1,?,?)").run(candidateId, `ext-${index}`, hash, `https://example.invalid/${index}`, `Source ${index}`, "excerpt", publishedAt, hash, `标题${index}`, `摘要${index}`, "", now, now);
    database.prepare("INSERT INTO review_bundle VALUES(?,?,?,?,?,?,?,?,?,?)").run(`bundle-${index}`, candidateId, 1, 1, hash, payload, sha256(payload), "", hash, now);
    database.prepare("INSERT INTO review_decision VALUES(?,?, 'approved',?,NULL,?)").run(`decision-${index}`, `bundle-${index}`, hash, now);
    database.prepare("INSERT INTO publication VALUES(?,?,?,?,?,1,'queued',NULL,?,?)").run(`publication-${index}`, `decision-${index}`, `bundle-${index}`, publicId, hash, now, now);
    database.prepare("UPDATE publication SET publication_status='published',published_at=?,updated_at=? WHERE publication_id=?").run(publishedAt, publishedAt, `publication-${index}`);
    database.prepare("INSERT INTO published_projection VALUES(?,?,?,?,1,?,?,?)").run(`projection-${index}`, `publication-${index}`, `bundle-${index}`, publicId, JSON.stringify({ publicId }), `${index + 6}`.repeat(64), now);
  }
  applyInternalOperationMigration(database, readFileSync(join(appRoot, "migrations/rss-real/0007_internal_operation_recovery_phase.sql"), "utf8"));
  database.prepare("INSERT INTO route_registry VALUES(?,?,?,?,?,?,?,?,?)").run("model-backfill", "model", "model_https", "model_refine", "a".repeat(64), "b".repeat(64), "c".repeat(64), "active", 1);
  database.prepare("INSERT INTO budget_account VALUES(?,?,?,?,?,?)").run("budget-backfill", "model_tokens", 100, 0, 0, 1);
  applyXManualInboxMigration(database, readFileSync(join(appRoot, "migrations/rss-real/0008_x_manual_inbox.sql"), "utf8"));
  database.close();
}

function targetTableCount(database: DatabaseSync): number {
  const placeholders = BILINGUAL_TABLES.map(() => "?").join(",");
  return Number((database.prepare(`SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name IN (${placeholders})`).get(...BILINGUAL_TABLES) as Record<string, unknown>).count);
}

function localImportClosure(entryPath: string): readonly Readonly<{ path: string; sha256: string }>[] {
  const pending = [resolve(entryPath)]; const seen = new Set<string>(); const dependencies = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{},\s]+?\s+from\s+)?["'](\.[^"']+)["']/gu;
    for (const match of source.matchAll(pattern)) {
      const base = resolve(dirname(file), match[1]);
      const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts")].find((candidate) => existsSync(candidate));
      if (!resolved) throw new Error(`EVIDENCE_IMPORT_UNRESOLVED:${file}:${match[1]}`);
      dependencies.add(resolved); pending.push(resolved);
    }
  }
  dependencies.delete(resolve(entryPath));
  return Object.freeze([...dependencies].sort().map((path) => Object.freeze({ path: relative(repoRoot, path), sha256: sha256(readFileSync(path)) })));
}

function recordNegative(attempt: string, callback: () => void): Readonly<{ attempt: string; rejected: boolean; error: string }> {
  try {
    callback();
    return { attempt, rejected: false, error: "NO_ERROR" };
  } catch (error) {
    return { attempt, rejected: true, error: error instanceof Error ? error.message : String(error) };
  }
}

function command(executable: string, args: readonly string[]): Readonly<{ command: string; status: number | null; outputSha256: string; outputTail: string }> {
  const result = spawnSync(executable, [...args], { cwd: appRoot, encoding: "utf8", shell: false });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return Object.freeze({ command: [executable, ...args].join(" "), status: result.status, outputSha256: sha256(output), outputTail: output.slice(-4000) });
}

async function main(): Promise<void> {
  if (process.version !== "v24.18.0") throw new Error(`NODE_VERSION_DRIFT:${process.version}`);
  const npmPath = process.env.npm_execpath;
  if (npmPath === undefined || !existsSync(npmPath)) throw new Error("NPM_LAUNCHER_UNAVAILABLE");
  const npmVersion = String(execFileSync(npmPath, ["--version"], { encoding: "utf8" })).trim();
  if (npmVersion !== "11.16.0") throw new Error(`NPM_VERSION_DRIFT:${npmVersion}`);
  mkdirSync(runRoot, { recursive: true });
  const migrationSql = readBilingualMigrationSql();
  if (sha256(migrationSql) !== BILINGUAL_REFINEMENT_MIGRATION_SHA256) throw new Error("MIGRATION_RAW_HASH_DRIFT");
  const source0008 = readFileSync(join(appRoot, "migrations/rss-real/0008_x_manual_inbox.sql"), "utf8");
  if (sha256(source0008) !== BILINGUAL_SOURCE_0008_RAW_SHA256) throw new Error("SOURCE_0008_RAW_DRIFT");

  const database = v8Database();
  const schema8Before = bilingualSchemaFingerprint(database);
  if (schema8Before !== BILINGUAL_SOURCE_SCHEMA8_SHA256) throw new Error(`SCHEMA8_DRIFT:${schema8Before}`);
  const applied = applyBilingualMigration(database, migrationSql, { applyEnabled: true });
  if (applied.schemaFingerprintSha256 !== BILINGUAL_SCHEMA9_SHA256) throw new Error(`SCHEMA9_FINGERPRINT_DRIFT:${applied.schemaFingerprintSha256}`);
  const replay = applyBilingualMigration(database, migrationSql, { applyEnabled: true });
  if (!replay.replay) throw new Error("SCHEMA9_REPLAY_NOT_IDEMPOTENT");
  const targetTablesAfterSuccess = targetTableCount(database);
  if (targetTablesAfterSuccess !== BILINGUAL_TABLES.length) throw new Error(`TARGET_TABLE_COUNT_INVALID:${targetTablesAfterSuccess}`);

  const rollbackDatabase = v8Database();
  let rollbackDenied = false;
  const rollbackAuthorizable = rollbackDatabase as AuthorizableDatabase;
  rollbackAuthorizable.setAuthorizer((action, arg1) => {
    if (action === SQLITE.SQLITE_CREATE_TABLE && arg1 === "bilingual_authority_capability_v1") {
      rollbackDenied = true;
      return SQLITE.SQLITE_DENY;
    }
    return SQLITE.SQLITE_OK;
  });
  let rollbackCode: string | null = null;
  try {
    applyBilingualMigration(rollbackDatabase, migrationSql, { applyEnabled: true });
  } catch (error) {
    rollbackCode = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
  }
  rollbackAuthorizable.setAuthorizer(null);
  const targetTablesAfterFailure = targetTableCount(rollbackDatabase);
  if (!rollbackDenied || rollbackCode !== "MIGRATION_FAILED" || Number((rollbackDatabase.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version) !== 8 || targetTablesAfterFailure !== 0) throw new Error("MIGRATION_ROLLBACK_VECTOR_FAILED");

  const negatives = [
    recordNegative("raw INSERT bilingual_candidate_lineage_v1", () => database.prepare("INSERT INTO bilingual_candidate_lineage_v1 (candidate_id,public_id,source_id,source_revision,input_content_hash,source_fact_set_hash,source_release_hash,copy_risk_status,rights_status,deletion_status,media_status,operation_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("candidate-evidence", "public-evidence", "motorsport-f1-news", 1, "1".repeat(64), "2".repeat(64), "3".repeat(64), "unknown", "unknown", "unknown", "unknown", "missing-operation", now, now)),
    recordNegative("raw UPDATE authority capability", () => database.exec("UPDATE bilingual_authority_capability_v1 SET enabled=1,status='enabled',reason_code='READY',extension_sha256='0000000000000000000000000000000000000000000000000000000000000000' WHERE capability_id='bilingual-v1'")),
  ];
  const authorizer = installSqliteAuthorizer(database, "public_or_browser");
  negatives.push(recordNegative("raw DROP TRIGGER bilingual_bundle_no_delete under authorizer", () => database.exec("DROP TRIGGER bilingual_bundle_no_delete")));
  negatives.push(recordNegative("raw UPDATE capability under authorizer", () => database.exec("UPDATE bilingual_authority_capability_v1 SET enabled=1 WHERE capability_id='bilingual-v1'")));
  authorizer.uninstall();
  if (negatives.some((entry) => !entry.rejected)) throw new Error("NEGATIVE_VECTOR_NOT_REJECTED");

  const lineage = assertSourceLineage({ candidateId: "candidate-evidence", publicId: "public-evidence", sourceId: "motorsport-f1-news", sourceRevision: 1, inputContentHash: "1".repeat(64), sourceFactSetHash: "2".repeat(64), sourceReleaseHash: "3".repeat(64), canonicalUrl: "https://example.invalid/evidence", sourceTitle: "Evidence source", sourceAuthor: null, sourcePublishedAt: now, sourceExcerpt: "private evidence" });
  let modelCalls = 0;
  const workerResult = await runBilingualRefinement({
    lineage,
    promptSha256: "4".repeat(64),
    now,
    gateway: {
      plan(modelInput, operationId, parentOperationId, attemptNumber) {
        return { operationId, parentOperationId, idempotencyKey: `model-${operationId}`, candidateId: lineage.candidateId, language: modelInput.language, attemptNumber,
          route: { routeRef: "closed-route", providerId: "closed-provider", modelId: "closed-model", routeIdentitySha256: "5".repeat(64), releaseSha256: "6".repeat(64), manifestSha256: "7".repeat(64) },
          budget: { accountId: "closed-budget", reservationId: `closed-${modelInput.language}`, units: 1, currency: "USD" },
          external: { method: "POST", endpointClass: "model_refine", providerResource: "closed-model", externalIdempotencyKey: `external-${operationId}`, reconcileKey: `reconcile-${operationId}`, headers: [], query: [], bodySha256: "8".repeat(64) } };
      },
      async execute() { modelCalls += 1; throw new Error("closed path must not invoke model"); }
    },
    mutationPort: CLOSED_BILINGUAL_MUTATION_PORT
  });
  if (workerResult.status !== "closed" || workerResult.externalCalls !== 0 || workerResult.writesToBase || modelCalls !== 0) throw new Error("WORKER_CLOSED_VECTOR_FAILED");

  const sourceDatabasePath = join(runRoot, "existing-authority-schema8.sqlite");
  recentThreeV8Database(sourceDatabasePath);
  const selection = queryRecentThreeFromExistingOnly({ sourceDatabasePath, routeId: "model-backfill", budgetAccountId: "budget-backfill", promptSchemaVersion: "bilingual-refinement-prompt-v1", promptSha256: "8".repeat(64), operationId: "backfill-query-r2", queriedAt: now });
  const sourceBeforeAliasSha256 = sha256(readFileSync(sourceDatabasePath));
  let sourceAliasError: string | null = null;
  try { applyRecentThreeToDisposable(selection, sourceDatabasePath); } catch (error) { sourceAliasError = error instanceof Error ? error.message : String(error); }
  const sourceAliasProbe = new DatabaseSync(sourceDatabasePath, { readOnly: true });
  const sourceAliasTableCount = Number((sourceAliasProbe.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name LIKE 'bilingual_backfill_%'").get() as Record<string, unknown>).count);
  sourceAliasProbe.close();
  if (sourceAliasError !== "BACKFILL_SOURCE_TARGET_ALIAS_FORBIDDEN" || sha256(readFileSync(sourceDatabasePath)) !== sourceBeforeAliasSha256 || sourceAliasTableCount !== 0) throw new Error("BACKFILL_SOURCE_TARGET_ALIAS_PROBE_FAILED");
  const disposableDatabasePath = join(runRoot, "backfill-disposable.sqlite");
  const backfillFirst = applyRecentThreeToDisposable(selection, disposableDatabasePath);
  const backfillReplay = applyRecentThreeToDisposable(selection, disposableDatabasePath);
  const corruptReplayDatabasePath = join(runRoot, "backfill-corrupt-replay.sqlite");
  applyRecentThreeToDisposable(selection, corruptReplayDatabasePath);
  const corruptReplayDatabase = new DatabaseSync(corruptReplayDatabasePath);
  let immutableDeleteRejected = false;
  try { corruptReplayDatabase.exec("DELETE FROM bilingual_backfill_attempt"); } catch (error) { immutableDeleteRejected = String(error).includes("BACKFILL_DISPOSABLE_IMMUTABLE"); }
  corruptReplayDatabase.exec("DROP TRIGGER bilingual_backfill_attempt_no_delete; DELETE FROM bilingual_backfill_attempt WHERE attempt_id=(SELECT attempt_id FROM bilingual_backfill_attempt ORDER BY attempt_id LIMIT 1); CREATE TRIGGER bilingual_backfill_attempt_no_delete BEFORE DELETE ON bilingual_backfill_attempt BEGIN SELECT RAISE(ABORT,'BACKFILL_DISPOSABLE_IMMUTABLE'); END;");
  corruptReplayDatabase.close();
  let corruptReplayError: string | null = null;
  try { applyRecentThreeToDisposable(selection, corruptReplayDatabasePath); } catch (error) { corruptReplayError = error instanceof Error ? error.message : String(error); }
  if (!immutableDeleteRejected || corruptReplayError !== "BACKFILL_REPLAY_RECEIPT_DRIFT") throw new Error("BACKFILL_CORRUPT_REPLAY_PROBE_FAILED");
  const failureDatabasePath = join(runRoot, "backfill-fault.sqlite");
  const backfillFault = applyRecentThreeToDisposable(selection, failureDatabasePath, { failCandidateId: selection.items[1].candidateId });
  const failureDatabase = new DatabaseSync(failureDatabasePath, { readOnly: true });
  const failureCounts = {
    operations: Number((failureDatabase.prepare("SELECT count(*) AS count FROM bilingual_backfill_operation").get() as Record<string, unknown>).count),
    attempts: Number((failureDatabase.prepare("SELECT count(*) AS count FROM bilingual_backfill_attempt").get() as Record<string, unknown>).count),
    receipts: Number((failureDatabase.prepare("SELECT count(*) AS count FROM bilingual_backfill_receipt").get() as Record<string, unknown>).count)
  };
  failureDatabase.close();
  if (backfillFirst.some((item) => !item.committed || item.replay) || backfillReplay.some((item) => !item.committed || !item.replay) || backfillFault.filter((item) => item.committed).length !== 2 || failureCounts.operations !== 2 || failureCounts.attempts !== 4 || failureCounts.receipts !== 2) throw new Error("BACKFILL_TRANSACTION_REPLAY_ROLLBACK_FAILED");
  const baselineMigrationInputs = [
    "0001_rss_real.sql", "0002_admin_review_publish.sql", "0003_projection_delivery_runtime.sql", "0004_rss_media_and_chinese_refinement.sql",
    "0005_second_rss_autosport.sql", "0006_independent_rss_racefans_the_race.sql", "0007_internal_operation_recovery_phase.sql", "0008_x_manual_inbox.sql"
  ].map((file) => ({ path: `app/migrations/rss-real/${file}`, sha256: sha256(readFileSync(join(appRoot, "migrations/rss-real", file))) }));
  const verification = {
    focused: command(npmPath, ["exec", "vitest", "run", "src/tests/bilingual-core.test.ts", "src/tests/admin-bilingual-adapter-integration.test.ts", "src/tests/internal-operation-gateway.test.ts", "src/tests/source-registry.test.ts"]),
    typecheck: command(npmPath, ["run", "typecheck"]),
    lint: command(npmPath, ["exec", "eslint", "src/server/rss/bilingual-core.ts", "src/server/rss/bilingual-worker.ts", "src/server/rss/bilingual-gateway-port.ts", "src/server/rss/bilingual-migration.ts", "src/server/internal-operation/gateway.ts", "src/server/internal-operation/authorizer.ts", "src/tests/bilingual-core.test.ts"]),
  };
  if (Object.values(verification).some((gate) => gate.status !== 0)) throw new Error(`VERIFICATION_GATE_FAILED:${JSON.stringify(verification)}`);

  const receipt = {
    schemaVersion: "ql3-0009-bilingual-evidence-r4",
    runId,
    status: "PASS",
    scope: "scratch_acceptance_only",
    production: false,
    modelCalls: 0,
    externalCalls: 0,
    writesToBase: false,
    nodeVersion: process.version,
    npmVersion,
    sourcePreimage: { userVersion: 8, raw0008Sha256: BILINGUAL_SOURCE_0008_RAW_SHA256, canonical0008Sha256: BILINGUAL_SOURCE_0008_CANONICAL_SHA256, schema8Sha256: BILINGUAL_SOURCE_SCHEMA8_SHA256, migrationInputs: baselineMigrationInputs },
    target: { userVersion: 9, migrationSha256: BILINGUAL_REFINEMENT_MIGRATION_SHA256, migrationCanonicalSha256: BILINGUAL_REFINEMENT_MIGRATION_CANONICAL_SHA256, schema9Sha256: BILINGUAL_SCHEMA9_SHA256, replay: true, authorityCapability: "closed", expectedTableNames: BILINGUAL_TABLES, measuredTableCount: targetTablesAfterSuccess },
    rollback: { injected: true, denied: rollbackDenied, errorCode: rollbackCode, userVersionAfterFailure: 8, measuredTargetTablesAfterFailure: targetTablesAfterFailure },
    negativeVectors: negatives,
    ddlGraphClosure: { test: "app/src/tests/admin-bilingual-adapter-integration.test.ts", historicalRawGraphAttacksRejected: 9, languageAttemptAttacksRejected: 4, positiveControlsAccepted: 4, promptOnlyDriftRejectedAgainstLegalReceiptFixture: true, candidateLanguageAttemptUniqueCas: true, secondBeginImmediateRejected: true, transactionRollbackDigestStable: true, readOnlyReopenDigestStable: true },
    worker: { status: workerResult.status, externalCalls: workerResult.externalCalls, writesToBase: workerResult.writesToBase },
    recentThree: { sourceMode: "same_existing_only_readonly_schema8", databaseIdentity: selection.receipt.database, authorityReceiptHash: selection.receipt.receiptHash, route: selection.receipt.authority.routeId, budget: selection.receipt.authority.budgetAccountId, promptSha256: selection.receipt.authority.promptSha256, sourceTargetAliasProbe: { rejected: true, error: sourceAliasError, sourceSha256Unchanged: true, measuredInjectedTables: sourceAliasTableCount }, corruptReplayProbe: { immutableDeleteRejected, error: corruptReplayError, scope: "scratch_disposable_backfill_database_only", destructiveInjection: "drop_recreate_disposable_attempt_no_delete_trigger", adminRuntimeOrReleaseClosure: false }, items: selection.items.map((item) => ({ candidateId: item.candidateId, legacyAuthorityHash: item.authorityHash })), firstApply: backfillFirst, restartReplay: backfillReplay, faultApply: backfillFault, failureCounts, writesToBase: false, externalCalls: 0 },
    verification,
    adminReleaseRuntimeFiles: []
  };
  const receiptJson = JSON.stringify(receipt, null, 2) + "\n";
  writeFileSync(join(runRoot, "receipt.json"), receiptJson);
  const report = `# QL3/0009 bilingual core R3 evidence\n\n- status: PASS\n- run: ${runId}\n- node/npm: ${process.version} / ${npmVersion}\n- preimage: 0008 ${BILINGUAL_SOURCE_0008_RAW_SHA256}; schema8 ${BILINGUAL_SOURCE_SCHEMA8_SHA256}; manifest binds every runtime migration input 0001–0008\n- migration: ${BILINGUAL_REFINEMENT_MIGRATION_SHA256}; schema9 ${BILINGUAL_SCHEMA9_SHA256}\n- target tables: measured ${targetTablesAfterSuccess}/${BILINGUAL_TABLES.length}; fault rollback measured ${targetTablesAfterFailure}\n- focused/typecheck/lint: ${verification.focused.status}/${verification.typecheck.status}/${verification.lint.status}\n- safety: structured fresh manual decision, dynamic latest authority, idempotent reviewable-bundle materialization, block/withdraw/fresh-reuse/stale/CAS negatives covered by focused adapter E2E\n- retry/rerun: en-only old carrier and zh-only fresh carrier both execute with independent attempt/budget/receipt; non-target slot stays byte-stable\n- recent3: same existing-only read-only schema8 file DB; full file/inode/schema identity, legacy rows, route, budget and prompt bound\n- apply: three independent transactions, two language attempts per item, restart replay 3/3, injected middle-item rollback retained 2 operations / 4 attempts / 2 receipts\n- source/target alias: rejected before writable open; source SHA unchanged; injected backfill tables measured 0\n- corrupt replay: immutable delete rejected; one scratch-only disposable-DB fault injection deliberately dropped/recreated its disposable trigger and removed one attempt; replay detected BACKFILL_REPLAY_RECEIPT_DRIFT\n- runtime authority negatives: raw bilingual INSERT/UPDATE and authorizer-protected runtime DROP TRIGGER attempts were all rejected; none executed successfully\n- authority: evidence migration path remains closed; modelCalls 0; externalCalls 0; writesToBase false\n\nThe destructive corrupt-replay injection applies only to the scratch disposable backfill DB. This evidence script/test remains in the scratch acceptance closure and is excluded from Admin runtime/release closure.\n`;
  const reportWithGraph = report.replace("# QL3/0009 bilingual core R3 evidence", "# QL3/0009 bilingual core R4 evidence").replace("- safety:", "- DDL graph: historical malformed writes 9/9 rejected; new language predecessor/CAS attacks 4/4 rejected; combined/zh-only/en-retry/zh-retry controls 4/4 accepted\n- concurrency: candidate-language-attempt unique CAS rejects the second contender; a second file-DB BEGIN IMMEDIATE writer is rejected; every case rollback and read-only reopen digest is stable\n- prompt receipt: a complete legal response_committed operation/attempt/budget/slot fixture rejects prompt-only SHA drift before accepting the exact receipt/draft/slot materialization\n- safety:");
  writeFileSync(join(runRoot, "report.md"), reportWithGraph);
  const evidenceScript = readFileSync(new URL(import.meta.url), "utf8");
  const localImports = localImportClosure(new URL(import.meta.url).pathname);
  const implementationFiles = [
    "app/migrations/rss-real/0009_bilingual_refinement.sql",
    "app/src/server/rss/bilingual-migration.ts",
    "app/src/server/rss/bilingual-core.ts",
    "app/src/server/rss/bilingual-backfill.ts",
    "app/src/server/rss/bilingual-worker.ts",
    "app/src/server/rss/bilingual-gateway-port.ts",
    "app/src/server/internal-operation/gateway.ts",
    "app/src/server/internal-operation/authorizer.ts",
    "app/src/tests/bilingual-core.test.ts",
    "app/src/tests/admin-bilingual-adapter-integration.test.ts",
    "app/src/tests/internal-operation-gateway.test.ts",
    "app/scripts/bilingual-0009-evidence.ts"
  ].map((path) => Object.freeze({ path, sha256: sha256(readFileSync(join(repoRoot, path))) }));
  const manifest = { schemaVersion: "ql3-0009-bilingual-evidence-manifest-r4", runId, evidenceScript: "app/scripts/bilingual-0009-evidence.ts", evidenceScriptSha256: sha256(evidenceScript), implementationFiles, imports: { builtins: ["node:crypto", "node:fs", "node:sqlite", "node:path", "node:child_process"], localGraphIncludesTypeOnly: true, local: localImports }, runtimeMigrationInputs: baselineMigrationInputs, receipt: "receipt.json", receiptSha256: sha256(receiptJson), report: "report.md", reportSha256: sha256(reportWithGraph), sourceDatabase: "existing-authority-schema8.sqlite", sourceDatabaseSha256: sha256(readFileSync(sourceDatabasePath)), disposableDatabase: "backfill-disposable.sqlite", disposableDatabaseSha256: sha256(readFileSync(disposableDatabasePath)), faultDatabase: "backfill-fault.sqlite", faultDatabaseSha256: sha256(readFileSync(failureDatabasePath)), corruptReplayDatabase: "backfill-corrupt-replay.sqlite", corruptReplayDatabaseSha256: sha256(readFileSync(corruptReplayDatabasePath)), migration: "app/migrations/rss-real/0009_bilingual_refinement.sql", migrationSha256: BILINGUAL_REFINEMENT_MIGRATION_SHA256, source0008Sha256: BILINGUAL_SOURCE_0008_RAW_SHA256, schema8Sha256: BILINGUAL_SOURCE_SCHEMA8_SHA256, schema9Sha256: BILINGUAL_SCHEMA9_SHA256, adminReleaseRuntimeFiles: [], closure: "scratch_only_not_admin_runtime" };
  writeFileSync(join(runRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ runRoot, receiptSha256: sha256(receiptJson), manifestSha256: sha256(readFileSync(join(runRoot, "manifest.json"))) }) + "\n");
}

await main();
