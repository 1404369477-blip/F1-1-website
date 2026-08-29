import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import ts from "typescript";

import { canonicalJsonV1 } from "../internal-operation/gateway.ts";
import { reviewRealSchemaFingerprint } from "../review-real/migration.ts";

const HASH = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UINT53_MAX = Number.MAX_SAFE_INTEGER;
const OBSERVATION_WINDOW_MS = 61_000;
const SCHEMA_VERSION = "auto-automation-zero-vector-v1" as const;
const PROCESS_IDENTITY_SCHEMA = "auto-process-identity-set-v1" as const;
const SCHEDULE_INVENTORY_SCHEMA = "auto-zero-schedule-inventory-v1" as const;
const MIGRATION_MANIFEST_SCHEMA = "auto-zero-migration-manifest-v1" as const;
const MIGRATION_PATH_PATTERN = /^migrations\/rss-real\/000[1-9]_.*\.sql$|^migrations\/rss-real\/0010_.*\.sql$/u;

const REVIEW_NONTERMINAL = ["requested", "authorized", "attempt_committed", "in_flight", "reconcile_required"] as const;
const REVIEW_TERMINAL = ["succeeded", "blocked", "terminal_failed", "cancelled"] as const;
const PUBLISH_OUTBOX_NONTERMINAL = ["pending", "leased", "reconcile_required"] as const;
const PUBLISH_OUTBOX_TERMINAL = ["succeeded", "terminal_failed", "cancelled"] as const;
const LEGACY_TERMINAL = ["completed", "failed"] as const;
const LEGACY_PUBLICATION_NONTERMINAL = ["queued", "reconcile_wait"] as const;
const LEGACY_PUBLICATION_TERMINAL = ["published", "terminal_failed", "emergency_stopped", "superseded"] as const;
const LEGACY_OUTBOX_NONTERMINAL = ["pending", "leased", "retryable_failed", "reconcile_wait"] as const;
const LEGACY_OUTBOX_TERMINAL = ["succeeded", "terminal_failed", "cancelled"] as const;

export type AutomationName = "automatic_review" | "automatic_publish";
export type OwnerProcess = "automatic_reviewer" | "automatic_publisher";

export type ReviewDatabaseIdentity = Readonly<{
  pathSha256: string;
  device: number;
  inode: number;
  userVersion: 10;
  schemaSha256: string;
}>;

export type AutoZeroMigrationManifestEntry = Readonly<{
  userVersion: number;
  path: string;
  sha256: string;
}>;

export type AutoZeroMigrationManifest = Readonly<{
  schemaVersion: typeof MIGRATION_MANIFEST_SCHEMA;
  chain: "rss-real-schema10";
  migrationInputs: readonly AutoZeroMigrationManifestEntry[];
}>;

/**
 * Read the migration identity from an evidence-owned manifest.  AutoZero is
 * intentionally agnostic to the current 0009/0010 bytes: the release owner
 * writes the trusted candidate manifest first, and the observer binds its
 * evidence to that exact list.  Keeping this reader here also makes stale
 * pins fail closed instead of silently falling back to an old constant.
 */
export function readAutoZeroMigrationManifest(path: string): AutoZeroMigrationManifest {
  assert(typeof path === "string" && path.startsWith("/"), "AUTO_ZERO_MIGRATION_MANIFEST_PATH_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    fail("AUTO_ZERO_MIGRATION_MANIFEST_INVALID");
  }
  assert(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), "AUTO_ZERO_MIGRATION_MANIFEST_INVALID");
  const value = parsed as Record<string, unknown>;
  assertExactKeys(value, ["schemaVersion", "chain", "migrationInputs"], "AUTO_ZERO_MIGRATION_MANIFEST_KEYS_INVALID");
  assert(value.schemaVersion === MIGRATION_MANIFEST_SCHEMA && value.chain === "rss-real-schema10", "AUTO_ZERO_MIGRATION_MANIFEST_SCHEMA_INVALID");
  assert(Array.isArray(value.migrationInputs) && value.migrationInputs.length === 10, "AUTO_ZERO_MIGRATION_MANIFEST_CHAIN_INVALID");
  const entries = value.migrationInputs.map((entry) => {
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), "AUTO_ZERO_MIGRATION_MANIFEST_ENTRY_INVALID");
    assertExactKeys(entry, ["userVersion", "path", "sha256"], "AUTO_ZERO_MIGRATION_MANIFEST_ENTRY_KEYS_INVALID");
    const item = entry as Record<string, unknown>;
    const userVersion = item.userVersion;
    const migrationPath = item.path;
    const migrationHash = item.sha256;
    assert(typeof userVersion === "number" && Number.isSafeInteger(userVersion) && userVersion >= 1 && userVersion <= 10, "AUTO_ZERO_MIGRATION_MANIFEST_VERSION_INVALID");
    assert(typeof migrationPath === "string" && MIGRATION_PATH_PATTERN.test(migrationPath), "AUTO_ZERO_MIGRATION_MANIFEST_PATH_INVALID");
    assert(typeof migrationHash === "string", "AUTO_ZERO_MIGRATION_MANIFEST_HASH_INVALID");
    assertHash(migrationHash, "AUTO_ZERO_MIGRATION_MANIFEST_HASH_INVALID");
    return Object.freeze({ userVersion, path: migrationPath, sha256: migrationHash });
  }).sort((left, right) => left.userVersion - right.userVersion);
  assert(entries.every((entry, index) => entry.userVersion === index + 1), "AUTO_ZERO_MIGRATION_MANIFEST_VERSION_ORDER_INVALID");
  assert(new Set(entries.map((entry) => entry.path)).size === entries.length, "AUTO_ZERO_MIGRATION_MANIFEST_PATH_DUPLICATE");
  return Object.freeze({ schemaVersion: MIGRATION_MANIFEST_SCHEMA, chain: "rss-real-schema10", migrationInputs: Object.freeze(entries) });
}

export type AutoAutomationZeroCounts = Readonly<{
  activeProcessInstances: number;
  registeredSchedules: number;
  activeOwnerHandoffs: number;
  prohibitedOperations: number;
  prohibitedEffects: number;
}>;

export type AutoAutomationZeroEvidence = Readonly<{
  processReceiptSha256: string;
  staticScheduleReceiptSha256: string;
  runtimeScheduleReceiptSha256: string;
  handoffSqlReceiptSha256: string;
  operationSqlReceiptSha256: string;
  effectSqlReceiptSha256: string;
}>;

export type AutomaticReviewZeroDatum = Readonly<{
  automation: "automatic_review";
  ownerProcess: "automatic_reviewer";
  operationKind: "review";
  capabilityClass: "db_mutation";
  egressChannel: "none";
  producers: readonly [
    "app/src/server/admin-service/runtime.ts::automaticReviewTick",
    "ReviewRepository.automaticReviewBatch",
    "system-auto-review-v1"
  ];
  legacyOperationIdPrefixes: readonly ["auto-review-revision-", "auto-review-approve-", "auto-review-reject-"];
  allowedSchema7OutboxKinds: readonly [];
  schema7OperationNonterminalStates: typeof REVIEW_NONTERMINAL;
  schema7OperationTerminalStates: typeof REVIEW_TERMINAL;
  legacyOperationTerminalStates: typeof LEGACY_TERMINAL;
  counts: AutoAutomationZeroCounts;
  evidence: AutoAutomationZeroEvidence;
  state: "pass" | "fail" | "unknown";
}>;

export type AutomaticPublishZeroDatum = Readonly<{
  automation: "automatic_publish";
  ownerProcess: "automatic_publisher";
  operationKind: "publish";
  capabilityClass: "db_mutation";
  egressChannel: "none";
  producers: readonly [
    "app/src/server/admin-service/runtime.ts::automaticPublishTick",
    "ReviewRepository.automaticPublishBatch",
    "system-auto-publish-v1"
  ];
  legacyOperationIdPrefixes: readonly ["auto-publish-batch-"];
  allowedSchema7OutboxKinds: readonly ["projection_delivery", "withdraw_delivery"];
  schema7OperationNonterminalStates: typeof REVIEW_NONTERMINAL;
  schema7OperationTerminalStates: typeof REVIEW_TERMINAL;
  schema7OutboxNonterminalStates: typeof PUBLISH_OUTBOX_NONTERMINAL;
  schema7OutboxTerminalStates: typeof PUBLISH_OUTBOX_TERMINAL;
  legacyOperationTerminalStates: typeof LEGACY_TERMINAL;
  legacyPublicationNonterminalStates: typeof LEGACY_PUBLICATION_NONTERMINAL;
  legacyPublicationTerminalStates: typeof LEGACY_PUBLICATION_TERMINAL;
  legacyOutboxNonterminalStates: typeof LEGACY_OUTBOX_NONTERMINAL;
  legacyOutboxTerminalStates: typeof LEGACY_OUTBOX_TERMINAL;
  counts: AutoAutomationZeroCounts;
  evidence: AutoAutomationZeroEvidence;
  state: "pass" | "fail" | "unknown";
}>;

export type AutoAutomationZeroDatum = AutomaticReviewZeroDatum | AutomaticPublishZeroDatum;

export type AutoAutomationZeroVector = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION;
  domain: Readonly<{
    quickLaunchCutoverAt: string;
    observedAt: string;
    releaseSha256: string;
    manifestSha256: string;
    autoProcessIdentitySetSha256: string;
    scheduleInventorySha256: string;
    reviewDatabaseIdentity: ReviewDatabaseIdentity;
  }>;
  automaticReview: AutomaticReviewZeroDatum;
  automaticPublish: AutomaticPublishZeroDatum;
  state: "pass" | "fail" | "unknown";
}>;

export type AutoScheduleFinding = Readonly<{
  automation: AutomationName;
  findingClass:
    | "embedded_interval"
    | "embedded_timeout"
    | "startup_direct_call"
    | "embedded_async_scheduler"
    | "independent_process"
    | "launchagent"
    | "cron"
    | "plist"
    | "manifest_scheduler"
    | "owner_handoff_issuer";
  producer:
    | "app/src/server/admin-service/runtime.ts::automaticReviewTick"
    | "ReviewRepository.automaticReviewBatch"
    | "app/src/server/admin-service/runtime.ts::automaticPublishTick"
    | "ReviewRepository.automaticPublishBatch"
    | "f1plus1-owner-supervisor-v1";
  locatorSha256: string;
}>;

export type AutoZeroRuntimeScheduleObservation = Readonly<{
  observedAt: string;
  durationMs: number;
  registeredSchedules: readonly AutoScheduleFinding[];
  registrySealed: boolean;
  runtimeError: string | null;
}>;

export type AutoZeroProcessRecord = Readonly<{
  automation: AutomationName;
  ownerProcess: OwnerProcess;
  pid: number;
  pidStartTime: string;
  executableRealpathSha256: string;
  executableBytesSha256: string;
  argvSha256: string;
  parentPid: number;
  launchAgentLabel: string | null;
  classification: "manifest_exact_auto_owner";
}>;

export type AutoProcessIdentityAllowlistEntry = Readonly<{
  automation: AutomationName;
  ownerProcess: OwnerProcess;
  executableRealpathSha256: string;
  executableBytesSha256: string;
  argvSha256: string;
  launchAgentLabel: string | null;
}>;

export type AutoScheduleInventoryScope = Readonly<{
  kind: "release_closure" | "launchagent_directory" | "plist_directory" | "user_cron" | "system_cron" | "manifest_registry";
  locatorSha256: string;
}>;

export type AutoZeroScheduleInventory = Readonly<{
  schemaVersion: typeof SCHEDULE_INVENTORY_SCHEMA;
  asOf: string;
  releaseClosureSha256: string;
  inspectedEntryCount: number;
  scope: readonly AutoScheduleInventoryScope[];
  findings: readonly AutoScheduleFinding[];
  complete: true;
}>;

export type AutoZeroCollectorInput = Readonly<{
  releaseRoot: string;
  releasePaths?: readonly string[];
  quickLaunchCutoverAt: string;
  observedAt: string;
  releaseSha256: string;
  manifestSha256: string;
  autoProcessIdentitySetSha256: string;
  scheduleInventorySha256: string;
  targetUid: number;
  reviewDatabasePath: string;
  expectedReviewDatabaseIdentity: ReviewDatabaseIdentity;
  processIdentityAllowlist: readonly AutoProcessIdentityAllowlistEntry[];
  scheduleInventory: AutoZeroScheduleInventory;
  runtimeScheduleObservation?: AutoZeroRuntimeScheduleObservation;
}>;

type QueryEvidence = Readonly<{
  sql: string;
  rows: readonly Record<string, unknown>[];
  rowsSha256: string;
  count: number;
  error: string | null;
}>;

type StaticScan = Readonly<{
  findings: readonly AutoScheduleFinding[];
  receipt: Readonly<Record<string, unknown>>;
  unknown: boolean;
}>;

type DatabaseScan = Readonly<{
  identity: ReviewDatabaseIdentity;
  reviewHandoff: QueryEvidence;
  publishHandoff: QueryEvidence;
  reviewHandoffCount: number;
  publishHandoffCount: number;
  reviewOperation: QueryEvidence;
  publishOperation: QueryEvidence;
  reviewEffect: QueryEvidence;
  publishEffect: QueryEvidence;
  review: Readonly<{ prohibitedOperations: number; prohibitedEffects: number; unknown: boolean }>;
  publish: Readonly<{ prohibitedOperations: number; prohibitedEffects: number; unknown: boolean }>;
  unknown: boolean;
}>;

function fail(code: string): never {
  throw new Error(code);
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) fail(code);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertHash(value: string, code: string): void {
  assert(HASH.test(value), code);
}

function assertTimestamp(value: string, code: string): void {
  assert(UTC.test(value) && Number.isFinite(Date.parse(value)), code);
  assert(new Date(Date.parse(value)).toISOString() === value, code);
}

function assertUInt53(value: number, code: string): void {
  assert(Number.isSafeInteger(value) && value >= 0 && value <= UINT53_MAX, code);
}

function assertExactKeys(value: object, keys: readonly string[], code: string): void {
  assert(JSON.stringify(Object.keys(value)) === JSON.stringify(keys), code);
}

function compareCanonical(left: unknown, right: unknown): number {
  return canonicalJsonV1(left).localeCompare(canonicalJsonV1(right));
}

function normalizeProcessIdentityAllowlist(entries: readonly AutoProcessIdentityAllowlistEntry[]): readonly AutoProcessIdentityAllowlistEntry[] {
  assert(Array.isArray(entries) && entries.length >= 2, "AUTO_ZERO_PROCESS_ALLOWLIST_EMPTY");
  const normalized = entries.map((entry) => {
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), "AUTO_ZERO_PROCESS_ALLOWLIST_ENTRY_INVALID");
    assertExactKeys(entry, ["automation", "ownerProcess", "executableRealpathSha256", "executableBytesSha256", "argvSha256", "launchAgentLabel"], "AUTO_ZERO_PROCESS_ALLOWLIST_KEYS_INVALID");
    const expectedOwner = entry.automation === "automatic_review" ? "automatic_reviewer" : entry.automation === "automatic_publish" ? "automatic_publisher" : null;
    assert(expectedOwner !== null && entry.ownerProcess === expectedOwner, "AUTO_ZERO_PROCESS_ALLOWLIST_OWNER_INVALID");
    for (const hash of [entry.executableRealpathSha256, entry.executableBytesSha256, entry.argvSha256]) assertHash(hash, "AUTO_ZERO_PROCESS_ALLOWLIST_HASH_INVALID");
    assert(entry.launchAgentLabel === null || (typeof entry.launchAgentLabel === "string" && Buffer.byteLength(entry.launchAgentLabel, "utf8") >= 1 && Buffer.byteLength(entry.launchAgentLabel, "utf8") <= 256), "AUTO_ZERO_PROCESS_ALLOWLIST_LABEL_INVALID");
    return Object.freeze({ ...entry });
  }).sort(compareCanonical);
  assert(new Set(normalized.map((entry) => canonicalJsonV1(entry))).size === normalized.length, "AUTO_ZERO_PROCESS_ALLOWLIST_DUPLICATE");
  assert(normalized.some((entry) => entry.automation === "automatic_review") && normalized.some((entry) => entry.automation === "automatic_publish"), "AUTO_ZERO_PROCESS_ALLOWLIST_DOMAIN_INCOMPLETE");
  return Object.freeze(normalized);
}

export function autoProcessIdentitySetSha256(entries: readonly AutoProcessIdentityAllowlistEntry[]): string {
  return sha256(canonicalJsonV1({ schemaVersion: PROCESS_IDENTITY_SCHEMA, entries: normalizeProcessIdentityAllowlist(entries) }));
}

const REQUIRED_SCHEDULE_SCOPES: readonly AutoScheduleInventoryScope["kind"][] = Object.freeze([
  "release_closure", "launchagent_directory", "plist_directory", "user_cron", "system_cron", "manifest_registry"
]);

function normalizeScheduleInventory(inventory: AutoZeroScheduleInventory): AutoZeroScheduleInventory {
  assert(inventory !== null && typeof inventory === "object" && !Array.isArray(inventory), "AUTO_ZERO_SCHEDULE_INVENTORY_INVALID");
  assertExactKeys(inventory, ["schemaVersion", "asOf", "releaseClosureSha256", "inspectedEntryCount", "scope", "findings", "complete"], "AUTO_ZERO_SCHEDULE_INVENTORY_KEYS_INVALID");
  assert(inventory.schemaVersion === SCHEDULE_INVENTORY_SCHEMA && inventory.complete === true, "AUTO_ZERO_SCHEDULE_INVENTORY_INCOMPLETE");
  assertTimestamp(inventory.asOf, "AUTO_ZERO_SCHEDULE_INVENTORY_TIME_INVALID");
  assertHash(inventory.releaseClosureSha256, "AUTO_ZERO_SCHEDULE_INVENTORY_RELEASE_INVALID");
  assertUInt53(inventory.inspectedEntryCount, "AUTO_ZERO_SCHEDULE_INVENTORY_COUNT_INVALID");
  assert(Array.isArray(inventory.scope) && Array.isArray(inventory.findings), "AUTO_ZERO_SCHEDULE_INVENTORY_ROWS_INVALID");
  const scope = inventory.scope.map((entry) => {
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), "AUTO_ZERO_SCHEDULE_SCOPE_INVALID");
    assertExactKeys(entry, ["kind", "locatorSha256"], "AUTO_ZERO_SCHEDULE_SCOPE_KEYS_INVALID");
    assert(REQUIRED_SCHEDULE_SCOPES.includes(entry.kind), "AUTO_ZERO_SCHEDULE_SCOPE_KIND_INVALID");
    assertHash(entry.locatorSha256, "AUTO_ZERO_SCHEDULE_SCOPE_HASH_INVALID");
    return Object.freeze({ ...entry });
  }).sort(compareCanonical);
  assert(scope.length === REQUIRED_SCHEDULE_SCOPES.length && new Set(scope.map((entry) => entry.kind)).size === REQUIRED_SCHEDULE_SCOPES.length, "AUTO_ZERO_SCHEDULE_SCOPE_INCOMPLETE");
  assert(inventory.inspectedEntryCount >= scope.length, "AUTO_ZERO_SCHEDULE_INVENTORY_COUNT_INVALID");
  const findings = inventory.findings.map((entry) => {
    assert(isScheduleFinding(entry), "AUTO_ZERO_SCHEDULE_FINDING_INVALID");
    return Object.freeze({ ...entry });
  }).sort(compareCanonical);
  return Object.freeze({ ...inventory, scope: Object.freeze(scope), findings: Object.freeze(findings) });
}

export function scheduleInventorySha256(inventory: AutoZeroScheduleInventory): string {
  return sha256(canonicalJsonV1(normalizeScheduleInventory(inventory)));
}

function canonicalRows(rows: readonly Record<string, unknown>[]): string {
  return rows.map((row) => canonicalJsonV1(row)).join("\n");
}

function queryEvidence(database: DatabaseSync, sql: string, params: Readonly<Record<string, string>> = {}): QueryEvidence {
  try {
    // node:sqlite rejects bindings that are not referenced by the statement.
    // The collector intentionally keeps one common parameter object for the
    // named-query family, so bind only names that occur in this exact query.
    const names = new Set(Array.from(sql.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g), (match) => match[1]));
    const boundParams = Object.fromEntries(Object.entries(params).filter(([name]) => names.has(name)));
    const rows = database.prepare(sql).all(boundParams) as Array<Record<string, unknown>>;
    const ordered = rows.map((row) => Object.freeze({ ...row }));
    return Object.freeze({
      sql,
      rows: Object.freeze(ordered),
      rowsSha256: sha256(canonicalRows(ordered)),
      count: ordered.length,
      error: null
    });
  } catch (error) {
    return Object.freeze({
      sql,
      rows: Object.freeze([]),
      rowsSha256: sha256(""),
      count: 0,
      error: error instanceof Error ? error.message : "QUERY_FAILED"
    });
  }
}

function queryCount(query: QueryEvidence): number {
  return query.rows.reduce((total, row) => {
    const value = row.prohibited_count ?? row.count ?? 0;
    const numeric = typeof value === "number" ? value : Number(value);
    return total + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
}

function mergeQueryEvidence(queries: readonly QueryEvidence[]): QueryEvidence {
  const rows = queries.flatMap((query) => query.rows);
  return Object.freeze({
    sql: queries.map((query) => query.sql).join("\n"),
    rows: Object.freeze(rows),
    // The contract binds the evidence to the ordered row JSON itself.  Hashing
    // child hashes here would leave the merged receipt unverifiable without
    // trusting the child implementation's ordering.
    rowsSha256: sha256(canonicalRows(rows)),
    count: queries.reduce((total, query) => total + query.count, 0),
    error: queries.find((query) => query.error !== null)?.error ?? null
  });
}

function queryUnknown(query: QueryEvidence): boolean {
  return query.error !== null || query.rows.some((row) => {
    const identityMismatch = row.identity_mismatch_count;
    const channelMismatch = row.channel_mismatch_count;
    const unexpected = row.unexpected_type_count;
    const unexpectedProvenance = row.unexpected_provenance_count;
    const issuerMismatch = row.issuer_mismatch_count;
    const values = [identityMismatch, channelMismatch, unexpected, unexpectedProvenance, issuerMismatch]
      .filter((value) => value !== undefined);
    return values.some((value) => {
      const numeric = Number(value);
      return !Number.isSafeInteger(numeric) || numeric < 0 || numeric > UINT53_MAX || numeric > 0;
    });
  });
}

function canonicalPath(root: string, value: string): string {
  const absolute = resolve(root, value);
  const relativePath = relative(root, absolute).split(sep).join("/");
  assert(relativePath !== "" && relativePath !== ".." && !relativePath.startsWith("../"), "AUTO_ZERO_RELEASE_PATH_OUTSIDE_ROOT");
  return relativePath;
}

function listSourceFiles(root: string, declaredPaths?: readonly string[]): readonly string[] {
  if (declaredPaths !== undefined) {
    return Object.freeze([...new Set(declaredPaths.map((path) => canonicalPath(root, path)))].filter((path) => /\.(?:[cm]?tsx?|[cm]?js)$/.test(path)).sort());
  }
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (name === "node_modules" || name === ".next" || name === ".git") continue;
      const child = resolve(directory, name);
      const stat = lstatSync(child);
      if (stat.isDirectory()) walk(child);
      else if (stat.isFile() && /\.(?:[cm]?tsx?|[cm]?js)$/.test(name)) found.push(relative(root, child).split(sep).join("/"));
    }
  };
  walk(root);
  return Object.freeze(found.sort());
}

function sourceKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".ts")) return ts.ScriptKind.TS;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function nodeText(source: ts.SourceFile, node: ts.Node): string {
  return node.getText(source);
}

function sourceOffsetBytes(source: ts.SourceFile, node: ts.Node): number {
  return Buffer.byteLength(source.text.slice(0, node.getStart(source)), "utf8");
}

function producerForName(name: string): Readonly<{ automation: AutomationName; producer: AutoScheduleFinding["producer"] }> | null {
  if (name.includes("automaticReviewTick") || name.includes("automaticReviewBatch")) {
    return Object.freeze({ automation: "automatic_review", producer: name.includes("automaticReviewBatch") ? "ReviewRepository.automaticReviewBatch" : "app/src/server/admin-service/runtime.ts::automaticReviewTick" });
  }
  if (name.includes("automaticPublishTick") || name.includes("automaticPublishBatch")) {
    return Object.freeze({ automation: "automatic_publish", producer: name.includes("automaticPublishBatch") ? "ReviewRepository.automaticPublishBatch" : "app/src/server/admin-service/runtime.ts::automaticPublishTick" });
  }
  return null;
}

function finding(
  source: ts.SourceFile,
  node: ts.Node,
  findingClass: AutoScheduleFinding["findingClass"],
  producer: Readonly<{ automation: AutomationName; producer: AutoScheduleFinding["producer"] }>
): AutoScheduleFinding {
  const canonicalLocator = `${source.fileName}::${ts.SyntaxKind[node.kind]}::${sourceOffsetBytes(source, node)}`;
  return Object.freeze({
    automation: producer.automation,
    findingClass,
    producer: producer.producer,
    locatorSha256: sha256(`${findingClass}\n${producer.producer}\n${canonicalLocator}`)
  });
}

function scanStaticSchedule(root: string, paths: readonly string[] | undefined, asOf: string): StaticScan {
  const files = listSourceFiles(root, paths);
  const findings: AutoScheduleFinding[] = [];
  let unknown = false;
  const callGraph: string[] = [];
  for (const path of files) {
    const absolute = resolve(root, path);
    let text: string;
    try { text = readFileSync(absolute, "utf8"); }
    catch { unknown = true; continue; }
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, sourceKind(path));
    if (((source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics?.length ?? 0) > 0) unknown = true;
    // Resolve the small class of callback aliases that commonly hides a
    // scheduler registration (`const tick = automaticReviewTick`).  This is
    // intentionally conservative: an alias containing a forbidden producer
    // is retained as a finding rather than treated as an unrelated callback.
    const aliases = new Map<string, string>();
    const collectAliases = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) aliases.set(node.name.text, node.name.text);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        aliases.set(node.name.text, node.initializer.getText(source));
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(source);
    const expandAlias = (value: string): string => {
      let current = value.trim();
      const seen = new Set<string>();
      while (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(current) && aliases.has(current) && !seen.has(current)) {
        seen.add(current);
        current = aliases.get(current)!;
      }
      return current;
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) callGraph.push(`${path}::${ts.SyntaxKind[node.kind]}::${sourceOffsetBytes(source, node)}`);
      if (ts.isCallExpression(node)) {
        const callee = nodeText(source, node.expression);
        const argumentsText = node.arguments.map((argument) => expandAlias(nodeText(source, argument))).join("\n");
        // A production closure contains this scanner itself.  Its string
        // comparisons mention the forbidden producer names, but those string
        // literals are not calls or callback registrations.  Strip literals
        // before producer matching while retaining identifier aliases such as
        // `setInterval(automaticReviewTick, ...)`.
        const callbackIdentifiers = argumentsText.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/gu, "");
        callGraph.push(`${path}::${ts.SyntaxKind[node.kind]}::${sourceOffsetBytes(source, node)}::${callee}`);
        if (/handoff/i.test(callee) && /automatic_reviewer|automatic_publisher/.test(callbackIdentifiers)) {
          const automation: AutomationName = callbackIdentifiers.includes("automatic_reviewer") ? "automatic_review" : "automatic_publish";
          findings.push(finding(source, node, "owner_handoff_issuer", { automation, producer: "f1plus1-owner-supervisor-v1" }));
        }
        const producer = producerForName(`${callee}\n${callbackIdentifiers}`);
        if (producer !== null) {
          const isTimer = callee === "setInterval" || callee.endsWith(".setInterval") || callee === "setTimeout" || callee.endsWith(".setTimeout");
          const isAsyncScheduler = callee === "queueMicrotask" || callee === "setImmediate" || callee.endsWith(".queueMicrotask") || callee.endsWith(".setImmediate") || callee.includes("schedule");
          if (isTimer) findings.push(finding(source, node, callee.includes("setTimeout") ? "embedded_timeout" : "embedded_interval", producer));
          else if (isAsyncScheduler) findings.push(finding(source, node, "embedded_async_scheduler", producer));
          else findings.push(finding(source, node, "startup_direct_call", producer));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const uniqueFindings = Object.freeze([...new Map(findings.map((item) => [item.locatorSha256, item])).values()]);
  const receipt = Object.freeze({
    schemaVersion: "auto-zero-static-schedule-receipt-v1",
    releaseRoot: resolve(root),
    asOf,
    sourceFileCount: files.length,
    callGraphNodeCount: callGraph.length,
    callGraph: Object.freeze(callGraph.slice().sort()),
    findings: uniqueFindings,
    forbiddenCallReachability: Object.freeze(uniqueFindings.filter((item) => item.findingClass === "startup_direct_call").map((item) => item.locatorSha256).sort())
  });
  return Object.freeze({ findings: uniqueFindings, receipt, unknown });
}

const SQL = Object.freeze({
  handoff: `SELECT COUNT(*) AS prohibited_count, COALESCE(SUM(CASE WHEN h.release_sha256 <> :releaseSha256 OR h.manifest_sha256 <> :manifestSha256 THEN 1 ELSE 0 END), 0) AS identity_mismatch_count, COALESCE(SUM(CASE WHEN h.issuer <> 'f1plus1-owner-supervisor-v1' THEN 1 ELSE 0 END), 0) AS issuer_mismatch_count FROM owner_authorization_handoff AS h LEFT JOIN internal_operation AS op ON op.operation_id = h.consumed_by_operation_id WHERE h.owner_process = :owner AND (h.verified_at >= :cutoverAt OR (h.consumed_by_operation_id IS NULL AND h.expires_at > :observedAt) OR op.state IN ('requested','authorized','attempt_committed','in_flight','reconcile_required'));`,
  operation: `SELECT COUNT(*) AS prohibited_count, COALESCE(SUM(CASE WHEN created_at >= :cutoverAt AND (expected_release_sha256 <> :releaseSha256 OR expected_manifest_sha256 <> :manifestSha256) THEN 1 ELSE 0 END), 0) AS identity_mismatch_count, COALESCE(SUM(CASE WHEN capability_class <> 'db_mutation' OR egress_class <> 'none' THEN 1 ELSE 0 END), 0) AS channel_mismatch_count FROM internal_operation WHERE owner_process = :owner AND operation_kind = :operationKind AND (created_at >= :cutoverAt OR state IN ('requested','authorized','attempt_committed','in_flight','reconcile_required'));`,
  reviewLegacyOperation: `SELECT COUNT(DISTINCT op.operation_id) AS prohibited_count FROM admin_operation AS op WHERE op.operation_type IN ('revision','approve','reject') AND (op.operation_id GLOB 'auto-review-revision-*' OR op.operation_id GLOB 'auto-review-approve-*' OR op.operation_id GLOB 'auto-review-reject-*' OR EXISTS (SELECT 1 FROM audit_event AS ae WHERE ae.operation_id = op.operation_id AND ae.actor_ref = 'system-auto-review-v1')) AND (op.created_at >= :cutoverAt OR op.operation_status NOT IN ('completed','failed'));`,
  reviewLegacyActorWithoutPrefix: `SELECT COUNT(DISTINCT op.operation_id) AS unexpected_provenance_count FROM admin_operation AS op JOIN audit_event AS ae ON ae.operation_id = op.operation_id WHERE ae.actor_ref = 'system-auto-review-v1' AND NOT (op.operation_id GLOB 'auto-review-revision-*' OR op.operation_id GLOB 'auto-review-approve-*' OR op.operation_id GLOB 'auto-review-reject-*');`,
  reviewLegacyEffect: `SELECT COUNT(*) AS prohibited_count FROM audit_event WHERE actor_ref = 'system-auto-review-v1' AND event_type IN ('review_revision_saved','review_approved','review_rejected') AND created_at >= :cutoverAt;`,
  reviewSchemaOutbox: `SELECT COUNT(*) AS prohibited_count FROM internal_operation_outbox AS ob JOIN internal_operation AS op ON op.operation_id = ob.operation_id WHERE op.owner_process = 'automatic_reviewer' AND op.operation_kind = 'review';`,
  publishLegacyOperation: `SELECT COUNT(DISTINCT op.operation_id) AS prohibited_count FROM admin_operation AS op WHERE op.operation_type = 'publish' AND (op.operation_id GLOB 'auto-publish-batch-*' OR EXISTS (SELECT 1 FROM audit_event AS ae WHERE ae.operation_id = op.operation_id AND ae.actor_ref = 'system-auto-publish-v1')) AND (op.created_at >= :cutoverAt OR op.operation_status NOT IN ('completed','failed'));`,
  publishLegacyActorWithoutPrefix: `SELECT COUNT(DISTINCT op.operation_id) AS unexpected_provenance_count FROM admin_operation AS op JOIN audit_event AS ae ON ae.operation_id = op.operation_id WHERE ae.actor_ref = 'system-auto-publish-v1' AND NOT (op.operation_id GLOB 'auto-publish-batch-*');`,
  publishLegacyEffect: `WITH auto_publication AS (SELECT DISTINCT ae.entity_id AS publication_id, op.created_at AS operation_created_at FROM admin_operation AS op JOIN audit_event AS ae ON ae.operation_id = op.operation_id WHERE ae.actor_ref = 'system-auto-publish-v1' AND op.operation_type = 'publish' AND ae.entity_type = 'publication' AND ae.event_type IN ('publication_published','publication_superseded','emergency_stopped')) SELECT (SELECT COUNT(*) FROM auto_publication AS ap JOIN publication AS p ON p.publication_id = ap.publication_id WHERE ap.operation_created_at >= :cutoverAt OR p.publication_status IN ('queued','reconcile_wait')) + (SELECT COUNT(*) FROM auto_publication AS ap JOIN projection_outbox AS ob ON ob.publication_id = ap.publication_id WHERE ob.created_at >= :cutoverAt OR ob.status IN ('pending','leased','retryable_failed','reconcile_wait')) AS prohibited_count;`,
  publishSchemaOutbox: `SELECT COUNT(*) AS prohibited_count, COALESCE(SUM(CASE WHEN ob.outbox_kind NOT IN ('projection_delivery','withdraw_delivery') THEN 1 ELSE 0 END), 0) AS unexpected_type_count FROM internal_operation_outbox AS ob JOIN internal_operation AS op ON op.operation_id = ob.operation_id WHERE op.owner_process = 'automatic_publisher' AND op.operation_kind = 'publish' AND (ob.created_at >= :cutoverAt OR ob.state IN ('pending','leased','reconcile_required'));`,
  statusOperations: `SELECT DISTINCT owner_process, operation_kind, capability_class, egress_class, state FROM internal_operation WHERE owner_process IN ('automatic_reviewer','automatic_publisher') ORDER BY owner_process, operation_kind, capability_class, egress_class, state;`,
  statusOutbox: `SELECT DISTINCT ob.outbox_kind, ob.state, op.owner_process, op.operation_kind FROM internal_operation_outbox AS ob JOIN internal_operation AS op ON op.operation_id = ob.operation_id WHERE op.owner_process IN ('automatic_reviewer','automatic_publisher') ORDER BY ob.outbox_kind, ob.state, op.owner_process, op.operation_kind;`,
  statusLegacyOperations: `SELECT DISTINCT operation_type, operation_status FROM admin_operation WHERE operation_id GLOB 'auto-review-revision-*' OR operation_id GLOB 'auto-review-approve-*' OR operation_id GLOB 'auto-review-reject-*' OR operation_id GLOB 'auto-publish-batch-*' ORDER BY operation_type, operation_status;`,
  statusLegacyOperationDomain: `SELECT DISTINCT operation_id, operation_type, operation_status FROM admin_operation WHERE operation_id GLOB 'auto-review-revision-*' OR operation_id GLOB 'auto-review-approve-*' OR operation_id GLOB 'auto-review-reject-*' OR operation_id GLOB 'auto-publish-batch-*' ORDER BY operation_id, operation_type, operation_status;`,
  statusAudit: `SELECT DISTINCT actor_ref, event_type, entity_type FROM audit_event WHERE actor_ref IN ('system-auto-review-v1','system-auto-publish-v1') ORDER BY actor_ref, event_type, entity_type;`,
  statusAuditProvenance: `SELECT DISTINCT ae.actor_ref, op.operation_id, op.operation_type FROM audit_event AS ae JOIN admin_operation AS op ON op.operation_id = ae.operation_id WHERE ae.actor_ref IN ('system-auto-review-v1','system-auto-publish-v1') ORDER BY ae.actor_ref, op.operation_id, op.operation_type;`,
  statusPublication: `WITH auto_publication AS (SELECT DISTINCT ae.entity_id AS publication_id FROM audit_event AS ae JOIN admin_operation AS op ON op.operation_id = ae.operation_id WHERE ae.actor_ref = 'system-auto-publish-v1' AND op.operation_type = 'publish' AND ae.entity_type = 'publication') SELECT DISTINCT p.publication_status FROM publication AS p JOIN auto_publication AS ap ON ap.publication_id = p.publication_id ORDER BY p.publication_status;`,
  statusLegacyOutbox: `WITH auto_publication AS (SELECT DISTINCT ae.entity_id AS publication_id FROM audit_event AS ae JOIN admin_operation AS op ON op.operation_id = ae.operation_id WHERE ae.actor_ref = 'system-auto-publish-v1' AND op.operation_type = 'publish' AND ae.entity_type = 'publication') SELECT DISTINCT ob.operation_type, ob.status FROM projection_outbox AS ob JOIN auto_publication AS ap ON ap.publication_id = ob.publication_id ORDER BY ob.operation_type, ob.status;`
});

function namedParams(input: AutoZeroCollectorInput, owner: OwnerProcess, operationKind: "review" | "publish"): Record<string, string> {
  return { cutoverAt: input.quickLaunchCutoverAt, observedAt: input.observedAt, releaseSha256: input.releaseSha256, manifestSha256: input.manifestSha256, owner, operationKind };
}

function validateStatusRows(
  queries: readonly QueryEvidence[],
  review: boolean,
  publish: boolean
): boolean {
  let unknown = queries.some((query) => query.error !== null);
  const operationStates = new Set([...REVIEW_NONTERMINAL, ...REVIEW_TERMINAL]);
  const outboxStates = new Set([...PUBLISH_OUTBOX_NONTERMINAL, ...PUBLISH_OUTBOX_TERMINAL]);
  const legacyOpStates = new Set(LEGACY_TERMINAL);
  const publicationStates = new Set([...LEGACY_PUBLICATION_NONTERMINAL, ...LEGACY_PUBLICATION_TERMINAL]);
  const legacyOutboxStates = new Set([...LEGACY_OUTBOX_NONTERMINAL, ...LEGACY_OUTBOX_TERMINAL]);
  for (const row of queries[0]?.rows ?? []) {
    if (!operationStates.has(String(row.state) as typeof REVIEW_NONTERMINAL[number])) unknown = true;
    const owner = String(row.owner_process);
    const kind = String(row.operation_kind);
    const channel = String(row.capability_class) === "db_mutation" && String(row.egress_class) === "none";
    if ((owner !== "automatic_reviewer" && owner !== "automatic_publisher") || (kind !== "review" && kind !== "publish") || !channel) unknown = true;
  }
  for (const row of queries[1]?.rows ?? []) {
    if (!outboxStates.has(String(row.state) as typeof PUBLISH_OUTBOX_NONTERMINAL[number])) unknown = true;
    const owner = String(row.owner_process);
    const kind = String(row.operation_kind);
    const outboxKind = String(row.outbox_kind);
    if (owner !== "automatic_reviewer" && owner !== "automatic_publisher") unknown = true;
    if ((owner === "automatic_reviewer" && kind !== "review") || (owner === "automatic_publisher" && (kind !== "publish" || !["projection_delivery", "withdraw_delivery"].includes(outboxKind)))) unknown = true;
  }
  for (const row of queries[2]?.rows ?? []) if (!legacyOpStates.has(String(row.operation_status) as typeof LEGACY_TERMINAL[number])) unknown = true;
  for (const row of queries[6]?.rows ?? []) {
    const operationId = String(row.operation_id);
    const operationType = String(row.operation_type);
    const expectedType = operationId.startsWith("auto-review-revision-") ? "revision" : operationId.startsWith("auto-review-approve-") ? "approve" : operationId.startsWith("auto-review-reject-") ? "reject" : operationId.startsWith("auto-publish-batch-") ? "publish" : null;
    if (expectedType === null || operationType !== expectedType || !legacyOpStates.has(String(row.operation_status) as typeof LEGACY_TERMINAL[number])) unknown = true;
  }
  for (const row of queries[3]?.rows ?? []) {
    const actor = String(row.actor_ref);
    const event = String(row.event_type);
    const entityType = String(row.entity_type);
    if (actor === "system-auto-review-v1") {
      if (!["review_revision_saved", "review_approved", "review_rejected"].includes(event)) unknown = true;
      if ((event === "review_revision_saved" && entityType !== "bundle") || (event !== "review_revision_saved" && entityType !== "decision")) unknown = true;
    }
    if (actor === "system-auto-publish-v1") {
      const publicationEvent = ["publication_published", "publication_superseded", "emergency_stopped"].includes(event);
      const deliveryEvent = event.startsWith("projection_delivery_");
      if (!publicationEvent && !deliveryEvent) unknown = true;
      if ((publicationEvent && entityType !== "publication") || (deliveryEvent && entityType !== "delivery")) unknown = true;
    }
  }
  for (const row of queries[4]?.rows ?? []) if (!publicationStates.has(String(row.publication_status) as typeof LEGACY_PUBLICATION_NONTERMINAL[number])) unknown = true;
  for (const row of queries[5]?.rows ?? []) if (String(row.operation_type) !== "snapshot_sync" || !legacyOutboxStates.has(String(row.status) as typeof LEGACY_OUTBOX_NONTERMINAL[number])) unknown = true;
  for (const row of queries[7]?.rows ?? []) {
    const actor = String(row.actor_ref);
    const operationType = String(row.operation_type);
    if ((actor === "system-auto-review-v1" && !["revision", "approve", "reject"].includes(operationType)) || (actor === "system-auto-publish-v1" && operationType !== "publish")) unknown = true;
  }
  if (!review && !publish) unknown = true;
  return unknown;
}

function openDatabase(path: string, expected: ReviewDatabaseIdentity): Readonly<{ database: DatabaseSync; identity: ReviewDatabaseIdentity }> {
  const absolute = resolve(path);
  const stat = statSync(absolute);
  assert(stat.isFile(), "AUTO_ZERO_DATABASE_NOT_REGULAR");
  const database = new DatabaseSync(absolute, { readOnly: true });
  try {
    const userVersion = Number((database.prepare("PRAGMA user_version").get() as Record<string, unknown>).user_version);
    assert(userVersion === 10, "AUTO_ZERO_DATABASE_VERSION_UNKNOWN");
    const identity = Object.freeze({
      pathSha256: sha256(absolute),
      device: Number(stat.dev),
      inode: Number(stat.ino),
      userVersion: 10 as const,
      schemaSha256: reviewRealSchemaFingerprint(database)
    });
    assertUInt53(identity.device, "AUTO_ZERO_DATABASE_DEVICE_INVALID");
    assertUInt53(identity.inode, "AUTO_ZERO_DATABASE_INODE_INVALID");
    assert(identity.inode >= 1, "AUTO_ZERO_DATABASE_INODE_INVALID");
    assertHash(identity.pathSha256, "AUTO_ZERO_DATABASE_PATH_HASH_INVALID");
    assertHash(identity.schemaSha256, "AUTO_ZERO_DATABASE_SCHEMA_HASH_INVALID");
    assert(canonicalJsonV1(identity) === canonicalJsonV1(expected), "AUTO_ZERO_DATABASE_IDENTITY_MISMATCH");
    return Object.freeze({ database, identity });
  } catch (error) {
    database.close();
    throw error;
  }
}

function scanDatabase(input: AutoZeroCollectorInput): DatabaseScan {
  const opened = openDatabase(input.reviewDatabasePath, input.expectedReviewDatabaseIdentity);
  const { database, identity } = opened;
  try {
    const params = namedParams(input, "automatic_reviewer", "review");
    const publishParams = namedParams(input, "automatic_publisher", "publish");
    const reviewHandoff = queryEvidence(database, SQL.handoff, params);
    const reviewOperation = queryEvidence(database, SQL.operation, params);
    const reviewLegacyOperation = queryEvidence(database, SQL.reviewLegacyOperation, { cutoverAt: params.cutoverAt! });
    const reviewLegacyActorWithoutPrefix = queryEvidence(database, SQL.reviewLegacyActorWithoutPrefix);
    const reviewLegacyEffect = queryEvidence(database, SQL.reviewLegacyEffect, { cutoverAt: params.cutoverAt! });
    const reviewSchemaOutbox = queryEvidence(database, SQL.reviewSchemaOutbox, { cutoverAt: params.cutoverAt! });
    const publishHandoff = queryEvidence(database, SQL.handoff, publishParams);
    const publishOperation = queryEvidence(database, SQL.operation, publishParams);
    const publishLegacyOperation = queryEvidence(database, SQL.publishLegacyOperation, { cutoverAt: publishParams.cutoverAt! });
    const publishLegacyActorWithoutPrefix = queryEvidence(database, SQL.publishLegacyActorWithoutPrefix);
    const publishLegacyEffect = queryEvidence(database, SQL.publishLegacyEffect, { cutoverAt: publishParams.cutoverAt! });
    const publishSchemaOutbox = queryEvidence(database, SQL.publishSchemaOutbox, { cutoverAt: publishParams.cutoverAt! });
    const statusQueries = [
      queryEvidence(database, SQL.statusOperations),
      queryEvidence(database, SQL.statusOutbox),
      queryEvidence(database, SQL.statusLegacyOperations),
      queryEvidence(database, SQL.statusAudit),
      queryEvidence(database, SQL.statusPublication),
      queryEvidence(database, SQL.statusLegacyOutbox),
      queryEvidence(database, SQL.statusLegacyOperationDomain),
      queryEvidence(database, SQL.statusAuditProvenance)
    ] as const;
    const reviewUnknown = validateStatusRows(statusQueries, true, false);
    const publishUnknown = validateStatusRows(statusQueries, false, true);
    const reviewOperationReceipt = mergeQueryEvidence([reviewOperation, reviewLegacyOperation, reviewLegacyActorWithoutPrefix, statusQueries[0], statusQueries[2], statusQueries[6]]);
    const publishOperationReceipt = mergeQueryEvidence([publishOperation, publishLegacyOperation, publishLegacyActorWithoutPrefix, statusQueries[0], statusQueries[2], statusQueries[6]]);
    const reviewEffectReceipt = mergeQueryEvidence([reviewLegacyEffect, reviewSchemaOutbox, statusQueries[1], statusQueries[3], statusQueries[4], statusQueries[5]]);
    const publishEffectReceipt = mergeQueryEvidence([publishLegacyEffect, publishSchemaOutbox, statusQueries[1], statusQueries[3], statusQueries[4], statusQueries[5]]);
    return Object.freeze({
      identity,
      reviewHandoff,
      publishHandoff,
      reviewOperation: reviewOperationReceipt,
      publishOperation: publishOperationReceipt,
      reviewEffect: reviewEffectReceipt,
      publishEffect: publishEffectReceipt,
      reviewHandoffCount: queryCount(reviewHandoff),
      publishHandoffCount: queryCount(publishHandoff),
      review: Object.freeze({ prohibitedOperations: queryCount(reviewOperation) + queryCount(reviewLegacyOperation), prohibitedEffects: queryCount(reviewLegacyEffect) + queryCount(reviewSchemaOutbox), unknown: reviewUnknown || queryUnknown(reviewHandoff) || queryUnknown(reviewOperation) || queryUnknown(reviewLegacyOperation) || queryUnknown(reviewLegacyActorWithoutPrefix) || queryUnknown(reviewLegacyEffect) || queryUnknown(reviewSchemaOutbox) }),
      publish: Object.freeze({ prohibitedOperations: queryCount(publishOperation) + queryCount(publishLegacyOperation), prohibitedEffects: queryCount(publishLegacyEffect) + queryCount(publishSchemaOutbox), unknown: publishUnknown || queryUnknown(publishHandoff) || queryUnknown(publishOperation) || queryUnknown(publishLegacyOperation) || queryUnknown(publishLegacyActorWithoutPrefix) || queryUnknown(publishLegacyEffect) || queryUnknown(publishSchemaOutbox) }),
      unknown: [...statusQueries, reviewHandoff, reviewOperation, reviewLegacyOperation, reviewLegacyActorWithoutPrefix, reviewLegacyEffect, reviewSchemaOutbox, publishHandoff, publishOperation, publishLegacyOperation, publishLegacyActorWithoutPrefix, publishLegacyEffect, publishSchemaOutbox].some((query) => queryUnknown(query))
    });
  } finally {
    database.close();
  }
}

type ProcessScan = Readonly<{
  targetUid: number;
  records: readonly AutoZeroProcessRecord[];
  inspectedProcessCount: number;
  complete: boolean;
  unknownReasons: readonly string[];
}>;

function processReceipt(input: AutoZeroCollectorInput, scan: ProcessScan, automation: AutomationName): Readonly<{ count: number; receipt: Readonly<Record<string, unknown>>; scheduleFindings: readonly AutoScheduleFinding[]; unknown: boolean }> {
  const owner: OwnerProcess = automation === "automatic_review" ? "automatic_reviewer" : "automatic_publisher";
  const records = scan.records;
  const allRecordsValid = records.every((record) => isProcessRecord(record));
  const owned = records.filter((record) => isProcessRecord(record) && record.ownerProcess === owner);
  const unique = new Map(owned.map((record) => [`${record.pid}\n${record.pidStartTime}`, record]));
  const producer: AutoScheduleFinding["producer"] = automation === "automatic_review" ? "ReviewRepository.automaticReviewBatch" : "ReviewRepository.automaticPublishBatch";
  const scheduleFindings = Object.freeze([...unique.values()].map((record) => Object.freeze({
    automation,
    findingClass: "independent_process" as const,
    producer,
    locatorSha256: sha256(`independent_process\n${producer}\n${canonicalJsonV1({ executableRealpathSha256: record.executableRealpathSha256, argvSha256: record.argvSha256, pidStartTime: record.pidStartTime })}`)
  })));
  const unknown = !scan.complete || !allRecordsValid || owned.some((record) => record.classification !== "manifest_exact_auto_owner" || record.automation !== automation);
  const receipt = Object.freeze({ schemaVersion: "auto-zero-process-receipt-v1", automation, ownerProcess: owner, targetUid: scan.targetUid, inspectedProcessCount: scan.inspectedProcessCount, complete: scan.complete, unknownReasons: scan.unknownReasons, records: Object.freeze([...unique.values()]), registeredSchedules: scheduleFindings, asOf: input.observedAt });
  return Object.freeze({ count: unique.size, receipt, scheduleFindings, unknown });
}

function isProcessRecord(value: AutoZeroProcessRecord): boolean {
  if (value === null || typeof value !== "object") return false;
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify([
    "automation", "ownerProcess", "pid", "pidStartTime", "executableRealpathSha256", "executableBytesSha256",
    "argvSha256", "parentPid", "launchAgentLabel", "classification"
  ])) return false;
  if (value.automation !== "automatic_review" && value.automation !== "automatic_publish") return false;
  if (!Number.isSafeInteger(value.pid) || value.pid < 1 || value.pid > 4_194_304) return false;
  if (!Number.isSafeInteger(value.parentPid) || value.parentPid < 0 || value.parentPid > 4_194_304) return false;
  try { assertTimestamp(value.pidStartTime, "PROCESS_TIMESTAMP_INVALID"); } catch { return false; }
  if (!HASH.test(value.executableRealpathSha256) || !HASH.test(value.executableBytesSha256) || !HASH.test(value.argvSha256)) return false;
  if (value.launchAgentLabel !== null && (typeof value.launchAgentLabel !== "string" || Buffer.byteLength(value.launchAgentLabel, "utf8") < 1 || Buffer.byteLength(value.launchAgentLabel, "utf8") > 256)) return false;
  return value.classification === "manifest_exact_auto_owner" && (value.ownerProcess === "automatic_reviewer" || value.ownerProcess === "automatic_publisher");
}

type PsRow = Readonly<{ uid: number; pid: number; parentPid: number; pidStartTime: string; argv: string }>;

function psSnapshot(targetUid: number): ReadonlyMap<number, PsRow> {
  const result = spawnSync("/bin/ps", ["-ww", "-axo", "uid=,pid=,ppid=,lstart=,command="], { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") throw new Error("AUTO_ZERO_PROCESS_OBSERVER_FAILED");
  const rows = new Map<number, PsRow>();
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
    if (match === null || Number(match[1]) !== targetUid) continue;
    const pid = Number(match[2]);
    const parentPid = Number(match[3]);
    const parsedStart = Date.parse(match[4]!.trim());
    if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isSafeInteger(parentPid) || parentPid < 0 || !Number.isFinite(parsedStart)) continue;
    rows.set(pid, Object.freeze({ uid: targetUid, pid, parentPid, pidStartTime: new Date(parsedStart).toISOString(), argv: match[5]!.trim() }));
  }
  return rows;
}

function launchAgentLabels(targetUid: number): ReadonlyMap<number, string> {
  const result = spawnSync("/bin/launchctl", ["print", `gui/${targetUid}`], { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") throw new Error("AUTO_ZERO_LAUNCHCTL_OBSERVER_FAILED");
  const labels = new Map<number, string>();
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(?:\([^)]*\)|\S+)\s+(\S+)\s*$/);
    if (match !== null && Number(match[1]) > 0) labels.set(Number(match[1]), match[2]!);
  }
  return labels;
}

function executableForPid(pid: number): string {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string" || result.stdout.trim().length === 0) throw new Error("AUTO_ZERO_PROCESS_EXECUTABLE_UNREADABLE");
  return realpathSync(result.stdout.trim());
}

function processLooksRelevant(row: PsRow, label: string | null, allowlist: readonly AutoProcessIdentityAllowlistEntry[]): boolean {
  const argvHash = sha256(row.argv);
  if (allowlist.some((entry) => entry.argvSha256 === argvHash || (entry.launchAgentLabel !== null && entry.launchAgentLabel === label))) return true;
  return /automatic[_-](?:reviewer|publisher)|system-auto-(?:review|publish)|automatic(?:Review|Publish)Batch/i.test(`${row.argv}\n${label ?? ""}`);
}

export function observeAutoProcessRecords(targetUid: number, entries: readonly AutoProcessIdentityAllowlistEntry[]): ProcessScan {
  assertUInt53(targetUid, "AUTO_ZERO_TARGET_UID_INVALID");
  const allowlist = normalizeProcessIdentityAllowlist(entries);
  const first = psSnapshot(targetUid);
  const labels = launchAgentLabels(targetUid);
  const second = psSnapshot(targetUid);
  const records: AutoZeroProcessRecord[] = [];
  const unknownReasons: string[] = [];
  let inspectedProcessCount = 0;
  const allPids = new Set([...first.keys(), ...second.keys()]);
  for (const pid of [...allPids].sort((left, right) => left - right)) {
    const before = first.get(pid);
    const after = second.get(pid);
    const reference = before ?? after;
    if (reference === undefined || (reference.parentPid === process.pid && reference.argv.includes("/bin/ps"))) continue;
    const label = labels.get(pid) ?? null;
    const relevant = processLooksRelevant(reference, label, allowlist);
    if (before === undefined || after === undefined || before.pidStartTime !== after.pidStartTime || before.parentPid !== after.parentPid || before.argv !== after.argv) {
      if (relevant) unknownReasons.push(`AUTO_ZERO_PROCESS_RACE:${pid}`);
      continue;
    }
    inspectedProcessCount += 1;
    const argvSha256 = sha256(after.argv);
    const potential = relevant || allowlist.some((entry) => entry.argvSha256 === argvSha256);
    if (!potential) continue;
    try {
      const executableRealpath = executableForPid(pid);
      const reread = psSnapshot(targetUid).get(pid);
      if (reread === undefined || reread.pidStartTime !== after.pidStartTime || reread.parentPid !== after.parentPid || reread.argv !== after.argv) {
        unknownReasons.push(`AUTO_ZERO_PROCESS_RACE:${pid}`);
        continue;
      }
      const identity = {
        executableRealpathSha256: sha256(executableRealpath),
        executableBytesSha256: sha256(readFileSync(executableRealpath)),
        argvSha256,
        launchAgentLabel: label
      };
      const matches = allowlist.filter((entry) => entry.executableRealpathSha256 === identity.executableRealpathSha256 && entry.executableBytesSha256 === identity.executableBytesSha256 && entry.argvSha256 === identity.argvSha256 && entry.launchAgentLabel === identity.launchAgentLabel);
      if (matches.length !== 1) {
        unknownReasons.push(`AUTO_ZERO_PROCESS_UNCLASSIFIED:${pid}`);
        continue;
      }
      const match = matches[0]!;
      records.push(Object.freeze({ automation: match.automation, ownerProcess: match.ownerProcess, pid, pidStartTime: after.pidStartTime, ...identity, parentPid: after.parentPid, classification: "manifest_exact_auto_owner" }));
    } catch {
      unknownReasons.push(`AUTO_ZERO_PROCESS_UNREADABLE:${pid}`);
    }
  }
  return Object.freeze({ targetUid, records: Object.freeze(records), inspectedProcessCount, complete: unknownReasons.length === 0, unknownReasons: Object.freeze([...new Set(unknownReasons)].sort()) });
}

function runtimeReceipt(input: AutoZeroCollectorInput, automation: AutomationName): Readonly<{ count: number; receipt: Readonly<Record<string, unknown>>; unknown: boolean }> {
  const observation = input.runtimeScheduleObservation;
  const inventory = normalizeScheduleInventory(input.scheduleInventory);
  if (observation === undefined) {
    const receipt = Object.freeze({ schemaVersion: "auto-zero-runtime-schedule-receipt-v1", automation, observedAt: input.observedAt, durationMs: 0, registeredSchedules: Object.freeze([]), registrySealed: false, scheduleInventory: Object.freeze([]) });
    return Object.freeze({ count: 0, receipt, unknown: true });
  }
  assertTimestamp(observation.observedAt, "AUTO_ZERO_RUNTIME_OBSERVED_AT_INVALID");
  const durationMs = observation.durationMs;
  assertUInt53(durationMs, "AUTO_ZERO_RUNTIME_DURATION_INVALID");
  const registeredSchedules = Array.isArray(observation.registeredSchedules) ? observation.registeredSchedules : [];
  const allFindingsValid = Array.isArray(observation.registeredSchedules) && registeredSchedules.every((item) => isScheduleFinding(item));
  const runtimeErrorValid = observation.runtimeError === null || typeof observation.runtimeError === "string";
  const inventoryRows = inventory.findings;
  const inventoryValid = inventory.releaseClosureSha256 === input.releaseSha256 && Math.abs(Date.parse(inventory.asOf) - Date.parse(input.observedAt)) <= 5_000;
  const findings = [...registeredSchedules, ...inventoryRows].filter((item) => isScheduleFinding(item) && item.automation === automation);
  const unique = new Map(findings.map((item) => [item.locatorSha256, item]));
  const unknown = !allFindingsValid || !runtimeErrorValid || observation.runtimeError !== null || !inventoryValid || observation.registrySealed !== true || durationMs < OBSERVATION_WINDOW_MS || Math.abs(Date.parse(observation.observedAt) - Date.parse(input.observedAt)) > 5_000;
  const receipt = Object.freeze({ schemaVersion: "auto-zero-runtime-schedule-receipt-v1", automation, observedAt: observation.observedAt, durationMs, registeredSchedules: Object.freeze([...unique.values()]), registrySealed: observation.registrySealed, runtimeError: observation.runtimeError, scheduleInventory: Object.freeze(inventoryRows.filter((item) => isScheduleFinding(item) && item.automation === automation)) });
  return Object.freeze({ count: unique.size, receipt, unknown });
}

const FINDING_CLASSES = new Set<AutoScheduleFinding["findingClass"]>([
  "embedded_interval", "embedded_timeout", "startup_direct_call", "embedded_async_scheduler",
  "independent_process", "launchagent", "cron", "plist", "manifest_scheduler", "owner_handoff_issuer"
]);

function isScheduleFinding(value: AutoScheduleFinding): boolean {
  if (value === null || typeof value !== "object" || !HASH.test(value.locatorSha256) || !FINDING_CLASSES.has(value.findingClass)) return false;
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(["automation", "findingClass", "producer", "locatorSha256"])) return false;
  if (value.automation === "automatic_review") return value.producer === "app/src/server/admin-service/runtime.ts::automaticReviewTick" || value.producer === "ReviewRepository.automaticReviewBatch" || value.producer === "f1plus1-owner-supervisor-v1";
  if (value.automation === "automatic_publish") return value.producer === "app/src/server/admin-service/runtime.ts::automaticPublishTick" || value.producer === "ReviewRepository.automaticPublishBatch" || value.producer === "f1plus1-owner-supervisor-v1";
  return false;
}

function digestReceipt(receipt: Readonly<Record<string, unknown>>, asOf?: string): string {
  const serialized = canonicalJsonV1(asOf === undefined ? receipt : { ...receipt, asOf });
  return sha256(serialized);
}

function makeDatum(input: Readonly<{
  automation: AutomationName;
  counts: AutoAutomationZeroCounts;
  evidence: AutoAutomationZeroEvidence;
  unknown: boolean;
}>): AutoAutomationZeroDatum {
  for (const count of Object.values(input.counts)) assertUInt53(count, "AUTO_ZERO_COUNT_INVALID");
  for (const hash of Object.values(input.evidence)) assertHash(hash, "AUTO_ZERO_EVIDENCE_HASH_INVALID");
  if (input.automation === "automatic_review") {
    return Object.freeze({
      automation: "automatic_review",
      ownerProcess: "automatic_reviewer",
      operationKind: "review",
      capabilityClass: "db_mutation",
      egressChannel: "none",
      producers: ["app/src/server/admin-service/runtime.ts::automaticReviewTick", "ReviewRepository.automaticReviewBatch", "system-auto-review-v1"] as const,
      legacyOperationIdPrefixes: ["auto-review-revision-", "auto-review-approve-", "auto-review-reject-"] as const,
      allowedSchema7OutboxKinds: [] as const,
      schema7OperationNonterminalStates: REVIEW_NONTERMINAL,
      schema7OperationTerminalStates: REVIEW_TERMINAL,
      legacyOperationTerminalStates: LEGACY_TERMINAL,
      counts: input.counts,
      evidence: input.evidence,
      state: input.unknown ? "unknown" : Object.values(input.counts).some((count) => count > 0) ? "fail" : "pass"
    });
  }
  return Object.freeze({
    automation: "automatic_publish",
    ownerProcess: "automatic_publisher",
    operationKind: "publish",
    capabilityClass: "db_mutation",
    egressChannel: "none",
    producers: ["app/src/server/admin-service/runtime.ts::automaticPublishTick", "ReviewRepository.automaticPublishBatch", "system-auto-publish-v1"] as const,
    legacyOperationIdPrefixes: ["auto-publish-batch-"] as const,
    allowedSchema7OutboxKinds: ["projection_delivery", "withdraw_delivery"] as const,
    schema7OperationNonterminalStates: REVIEW_NONTERMINAL,
    schema7OperationTerminalStates: REVIEW_TERMINAL,
    schema7OutboxNonterminalStates: PUBLISH_OUTBOX_NONTERMINAL,
    schema7OutboxTerminalStates: PUBLISH_OUTBOX_TERMINAL,
    legacyOperationTerminalStates: LEGACY_TERMINAL,
    legacyPublicationNonterminalStates: LEGACY_PUBLICATION_NONTERMINAL,
    legacyPublicationTerminalStates: LEGACY_PUBLICATION_TERMINAL,
    legacyOutboxNonterminalStates: LEGACY_OUTBOX_NONTERMINAL,
    legacyOutboxTerminalStates: LEGACY_OUTBOX_TERMINAL,
    counts: input.counts,
    evidence: input.evidence,
    state: input.unknown ? "unknown" : Object.values(input.counts).some((count) => count > 0) ? "fail" : "pass"
  });
}

function unknownVector(input: AutoZeroCollectorInput, reason: string): AutoAutomationZeroVector {
  // A missing table, unreadable snapshot, or incomplete observer receipt is a
  // machine-readable UNKNOWN.  Returning a closed DTO here lets the CLI emit
  // a durable NO_DEPLOY receipt instead of turning an evidence gap into a
  // process-level exception that could be mistaken for a clean run.
  const identity = Object.freeze({
    pathSha256: typeof input.expectedReviewDatabaseIdentity?.pathSha256 === "string" && HASH.test(input.expectedReviewDatabaseIdentity.pathSha256)
      ? input.expectedReviewDatabaseIdentity.pathSha256 : sha256("unknown-db-path"),
    device: Number.isSafeInteger(input.expectedReviewDatabaseIdentity?.device) && input.expectedReviewDatabaseIdentity.device >= 0
      ? input.expectedReviewDatabaseIdentity.device : 0,
    inode: Number.isSafeInteger(input.expectedReviewDatabaseIdentity?.inode) && input.expectedReviewDatabaseIdentity.inode >= 1
      ? input.expectedReviewDatabaseIdentity.inode : 1,
    userVersion: 10,
    schemaSha256: typeof input.expectedReviewDatabaseIdentity?.schemaSha256 === "string" && HASH.test(input.expectedReviewDatabaseIdentity.schemaSha256)
      ? input.expectedReviewDatabaseIdentity.schemaSha256 : sha256("unknown-db-schema")
  }) as ReviewDatabaseIdentity;
  const base = sha256(`auto-zero-unknown-v1\n${reason}`);
  const evidence = Object.freeze({
    processReceiptSha256: sha256(`${base}\nprocess`),
    staticScheduleReceiptSha256: sha256(`${base}\nstatic`),
    runtimeScheduleReceiptSha256: sha256(`${base}\nruntime`),
    handoffSqlReceiptSha256: sha256(`${base}\nhandoff`),
    operationSqlReceiptSha256: sha256(`${base}\noperation`),
    effectSqlReceiptSha256: sha256(`${base}\neffect`)
  });
  const counts = Object.freeze({
    activeProcessInstances: 0,
    registeredSchedules: 0,
    activeOwnerHandoffs: 0,
    prohibitedOperations: 0,
    prohibitedEffects: 0
  });
  const automaticReview = makeDatum({ automation: "automatic_review", counts, evidence, unknown: true }) as AutomaticReviewZeroDatum;
  const automaticPublish = makeDatum({ automation: "automatic_publish", counts, evidence, unknown: true }) as AutomaticPublishZeroDatum;
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    domain: Object.freeze({
      quickLaunchCutoverAt: input.quickLaunchCutoverAt,
      observedAt: input.observedAt,
      releaseSha256: input.releaseSha256,
      manifestSha256: input.manifestSha256,
      autoProcessIdentitySetSha256: input.autoProcessIdentitySetSha256,
      scheduleInventorySha256: input.scheduleInventorySha256,
      reviewDatabaseIdentity: identity
    }),
    automaticReview,
    automaticPublish,
    state: "unknown"
  });
}

export function collectAutoAutomationZeroVector(input: AutoZeroCollectorInput): AutoAutomationZeroVector {
  assertTimestamp(input.quickLaunchCutoverAt, "AUTO_ZERO_CUTOVER_INVALID");
  assertTimestamp(input.observedAt, "AUTO_ZERO_OBSERVED_AT_INVALID");
  assert(Date.parse(input.observedAt) >= Date.parse(input.quickLaunchCutoverAt), "AUTO_ZERO_OBSERVED_BEFORE_CUTOVER");
  for (const hash of [input.releaseSha256, input.manifestSha256, input.autoProcessIdentitySetSha256, input.scheduleInventorySha256]) assertHash(hash, "AUTO_ZERO_DOMAIN_HASH_INVALID");
  let staticScan: StaticScan;
  let database: DatabaseScan;
  let reviewProcess: ReturnType<typeof processReceipt>;
  let publishProcess: ReturnType<typeof processReceipt>;
  let reviewRuntime: ReturnType<typeof runtimeReceipt>;
  let publishRuntime: ReturnType<typeof runtimeReceipt>;
  try {
    assertUInt53(input.targetUid, "AUTO_ZERO_TARGET_UID_INVALID");
    assert(input.autoProcessIdentitySetSha256 === autoProcessIdentitySetSha256(input.processIdentityAllowlist), "AUTO_ZERO_PROCESS_ALLOWLIST_HASH_MISMATCH");
    assert(input.scheduleInventorySha256 === scheduleInventorySha256(input.scheduleInventory), "AUTO_ZERO_SCHEDULE_INVENTORY_HASH_MISMATCH");
    assert(input.scheduleInventory.releaseClosureSha256 === input.releaseSha256, "AUTO_ZERO_SCHEDULE_INVENTORY_RELEASE_MISMATCH");
    staticScan = scanStaticSchedule(input.releaseRoot, input.releasePaths, input.observedAt);
    database = scanDatabase(input);
    const processScan = observeAutoProcessRecords(input.targetUid, input.processIdentityAllowlist);
    reviewProcess = processReceipt(input, processScan, "automatic_review");
    publishProcess = processReceipt(input, processScan, "automatic_publish");
    reviewRuntime = runtimeReceipt(input, "automatic_review");
    publishRuntime = runtimeReceipt(input, "automatic_publish");
  } catch (error) {
    return unknownVector(input, error instanceof Error ? error.message : "AUTO_ZERO_EVIDENCE_UNKNOWN");
  }
  const staticReview = staticScan.findings.filter((finding_) => finding_.automation === "automatic_review");
  const staticPublish = staticScan.findings.filter((finding_) => finding_.automation === "automatic_publish");
  const staticReviewReceipt = Object.freeze({ ...staticScan.receipt, automation: "automatic_review", findings: Object.freeze(staticReview), forbiddenCallReachability: Object.freeze(staticReview.filter((item) => item.findingClass === "startup_direct_call").map((item) => item.locatorSha256).sort()) });
  const staticPublishReceipt = Object.freeze({ ...staticScan.receipt, automation: "automatic_publish", findings: Object.freeze(staticPublish), forbiddenCallReachability: Object.freeze(staticPublish.filter((item) => item.findingClass === "startup_direct_call").map((item) => item.locatorSha256).sort()) });
  const reviewEvidence = Object.freeze({
    processReceiptSha256: digestReceipt(reviewProcess.receipt, input.observedAt),
    staticScheduleReceiptSha256: digestReceipt(staticReviewReceipt, input.observedAt),
    runtimeScheduleReceiptSha256: digestReceipt(reviewRuntime.receipt, input.observedAt),
    handoffSqlReceiptSha256: digestReceipt(database.reviewHandoff, input.observedAt),
    operationSqlReceiptSha256: digestReceipt(database.reviewOperation, input.observedAt),
    effectSqlReceiptSha256: digestReceipt(database.reviewEffect, input.observedAt)
  });
  const publishEvidence = Object.freeze({
    processReceiptSha256: digestReceipt(publishProcess.receipt, input.observedAt),
    staticScheduleReceiptSha256: digestReceipt(staticPublishReceipt, input.observedAt),
    runtimeScheduleReceiptSha256: digestReceipt(publishRuntime.receipt, input.observedAt),
    handoffSqlReceiptSha256: digestReceipt(database.publishHandoff, input.observedAt),
    operationSqlReceiptSha256: digestReceipt(database.publishOperation, input.observedAt),
    effectSqlReceiptSha256: digestReceipt(database.publishEffect, input.observedAt)
  });
  const reviewUnknown = staticScan.unknown || database.review.unknown || reviewProcess.unknown || reviewRuntime.unknown;
  const publishUnknown = staticScan.unknown || database.publish.unknown || publishProcess.unknown || publishRuntime.unknown;
  const reviewRuntimeFindings = reviewRuntime.receipt.registeredSchedules as readonly AutoScheduleFinding[];
  const publishRuntimeFindings = publishRuntime.receipt.registeredSchedules as readonly AutoScheduleFinding[];
  const reviewScheduleCount = new Set([...staticReview, ...reviewRuntimeFindings, ...reviewProcess.scheduleFindings].map((item) => item.locatorSha256)).size;
  const publishScheduleCount = new Set([...staticPublish, ...publishRuntimeFindings, ...publishProcess.scheduleFindings].map((item) => item.locatorSha256)).size;
  const automaticReview = makeDatum({
    automation: "automatic_review",
    unknown: reviewUnknown,
    counts: {
      activeProcessInstances: reviewProcess.count,
      registeredSchedules: reviewScheduleCount,
      activeOwnerHandoffs: database.reviewHandoffCount,
      prohibitedOperations: database.review.prohibitedOperations,
      prohibitedEffects: database.review.prohibitedEffects
    },
    evidence: reviewEvidence
  }) as AutomaticReviewZeroDatum;
  const automaticPublish = makeDatum({
    automation: "automatic_publish",
    unknown: publishUnknown,
    counts: {
      activeProcessInstances: publishProcess.count,
      registeredSchedules: publishScheduleCount,
      activeOwnerHandoffs: database.publishHandoffCount,
      prohibitedOperations: database.publish.prohibitedOperations,
      prohibitedEffects: database.publish.prohibitedEffects
    },
    evidence: publishEvidence
  }) as AutomaticPublishZeroDatum;
  const domain = Object.freeze({
    quickLaunchCutoverAt: input.quickLaunchCutoverAt,
    observedAt: input.observedAt,
    releaseSha256: input.releaseSha256,
    manifestSha256: input.manifestSha256,
    autoProcessIdentitySetSha256: input.autoProcessIdentitySetSha256,
    scheduleInventorySha256: input.scheduleInventorySha256,
    reviewDatabaseIdentity: database.identity
  });
  const state = automaticReview.state === "pass" && automaticPublish.state === "pass" ? "pass" : automaticReview.state === "unknown" || automaticPublish.state === "unknown" ? "unknown" : "fail";
  return Object.freeze({ schemaVersion: SCHEMA_VERSION, domain, automaticReview, automaticPublish, state });
}

export function assertAutoAutomationZeroVector(value: AutoAutomationZeroVector): void {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "AUTO_ZERO_OBJECT_INVALID");
  assertExactKeys(value, ["schemaVersion", "domain", "automaticReview", "automaticPublish", "state"], "AUTO_ZERO_VECTOR_KEYS_INVALID");
  assert(value.schemaVersion === SCHEMA_VERSION, "AUTO_ZERO_SCHEMA_VERSION_INVALID");
  assert(value.domain !== null && typeof value.domain === "object" && !Array.isArray(value.domain), "AUTO_ZERO_DOMAIN_OBJECT_INVALID");
  assertExactKeys(value.domain, ["quickLaunchCutoverAt", "observedAt", "releaseSha256", "manifestSha256", "autoProcessIdentitySetSha256", "scheduleInventorySha256", "reviewDatabaseIdentity"], "AUTO_ZERO_DOMAIN_KEYS_INVALID");
  assert(value.domain.reviewDatabaseIdentity !== null && typeof value.domain.reviewDatabaseIdentity === "object" && !Array.isArray(value.domain.reviewDatabaseIdentity), "AUTO_ZERO_DB_IDENTITY_OBJECT_INVALID");
  assertExactKeys(value.domain.reviewDatabaseIdentity, ["pathSha256", "device", "inode", "userVersion", "schemaSha256"], "AUTO_ZERO_DB_IDENTITY_KEYS_INVALID");
  assertTimestamp(value.domain.quickLaunchCutoverAt, "AUTO_ZERO_DOMAIN_CUTOVER_INVALID");
  assertTimestamp(value.domain.observedAt, "AUTO_ZERO_DOMAIN_OBSERVED_INVALID");
  assert(Date.parse(value.domain.observedAt) >= Date.parse(value.domain.quickLaunchCutoverAt), "AUTO_ZERO_DOMAIN_TIME_ORDER_INVALID");
  for (const hash of [value.domain.releaseSha256, value.domain.manifestSha256, value.domain.autoProcessIdentitySetSha256, value.domain.scheduleInventorySha256, value.domain.reviewDatabaseIdentity.pathSha256, value.domain.reviewDatabaseIdentity.schemaSha256]) assertHash(hash, "AUTO_ZERO_DOMAIN_HASH_INVALID");
  assert(value.domain.reviewDatabaseIdentity.userVersion === 10, "AUTO_ZERO_DOMAIN_DB_VERSION_INVALID");
  assertUInt53(value.domain.reviewDatabaseIdentity.device, "AUTO_ZERO_DOMAIN_DB_DEVICE_INVALID");
  assertUInt53(value.domain.reviewDatabaseIdentity.inode, "AUTO_ZERO_DOMAIN_DB_INODE_INVALID");
  assert(value.domain.reviewDatabaseIdentity.inode >= 1, "AUTO_ZERO_DOMAIN_DB_INODE_INVALID");
  for (const datum of [value.automaticReview, value.automaticPublish]) {
    assert(datum !== null && typeof datum === "object" && !Array.isArray(datum), "AUTO_ZERO_DATUM_OBJECT_INVALID");
    assert(datum.automation === "automatic_review" || datum.automation === "automatic_publish", "AUTO_ZERO_DATUM_AUTOMATION_INVALID");
    assertExactKeys(datum, datum.automation === "automatic_review"
      ? ["automation", "ownerProcess", "operationKind", "capabilityClass", "egressChannel", "producers", "legacyOperationIdPrefixes", "allowedSchema7OutboxKinds", "schema7OperationNonterminalStates", "schema7OperationTerminalStates", "legacyOperationTerminalStates", "counts", "evidence", "state"]
      : ["automation", "ownerProcess", "operationKind", "capabilityClass", "egressChannel", "producers", "legacyOperationIdPrefixes", "allowedSchema7OutboxKinds", "schema7OperationNonterminalStates", "schema7OperationTerminalStates", "schema7OutboxNonterminalStates", "schema7OutboxTerminalStates", "legacyOperationTerminalStates", "legacyPublicationNonterminalStates", "legacyPublicationTerminalStates", "legacyOutboxNonterminalStates", "legacyOutboxTerminalStates", "counts", "evidence", "state"], "AUTO_ZERO_DATUM_KEYS_INVALID");
    assert(datum.counts !== null && typeof datum.counts === "object" && !Array.isArray(datum.counts), "AUTO_ZERO_COUNTS_OBJECT_INVALID");
    assert(datum.evidence !== null && typeof datum.evidence === "object" && !Array.isArray(datum.evidence), "AUTO_ZERO_EVIDENCE_OBJECT_INVALID");
    if (datum.automation === "automatic_review") {
      assert(datum.ownerProcess === "automatic_reviewer" && datum.operationKind === "review" && datum.capabilityClass === "db_mutation" && datum.egressChannel === "none", "AUTO_ZERO_REVIEW_DOMAIN_INVALID");
      assert(JSON.stringify(datum.producers) === JSON.stringify(["app/src/server/admin-service/runtime.ts::automaticReviewTick", "ReviewRepository.automaticReviewBatch", "system-auto-review-v1"]), "AUTO_ZERO_REVIEW_PRODUCERS_INVALID");
      assert(JSON.stringify(datum.legacyOperationIdPrefixes) === JSON.stringify(["auto-review-revision-", "auto-review-approve-", "auto-review-reject-"]), "AUTO_ZERO_REVIEW_PREFIXES_INVALID");
      assert(Array.isArray(datum.allowedSchema7OutboxKinds) && datum.allowedSchema7OutboxKinds.length === 0, "AUTO_ZERO_REVIEW_OUTBOX_KINDS_INVALID");
      assert(JSON.stringify(datum.schema7OperationNonterminalStates) === JSON.stringify(REVIEW_NONTERMINAL) && JSON.stringify(datum.schema7OperationTerminalStates) === JSON.stringify(REVIEW_TERMINAL) && JSON.stringify(datum.legacyOperationTerminalStates) === JSON.stringify(LEGACY_TERMINAL), "AUTO_ZERO_REVIEW_STATES_INVALID");
    } else {
      assert(datum.ownerProcess === "automatic_publisher" && datum.operationKind === "publish" && datum.capabilityClass === "db_mutation" && datum.egressChannel === "none", "AUTO_ZERO_PUBLISH_DOMAIN_INVALID");
      assert(JSON.stringify(datum.producers) === JSON.stringify(["app/src/server/admin-service/runtime.ts::automaticPublishTick", "ReviewRepository.automaticPublishBatch", "system-auto-publish-v1"]), "AUTO_ZERO_PUBLISH_PRODUCERS_INVALID");
      assert(JSON.stringify(datum.legacyOperationIdPrefixes) === JSON.stringify(["auto-publish-batch-"]), "AUTO_ZERO_PUBLISH_PREFIXES_INVALID");
      assert(JSON.stringify(datum.allowedSchema7OutboxKinds) === JSON.stringify(["projection_delivery", "withdraw_delivery"]), "AUTO_ZERO_PUBLISH_OUTBOX_KINDS_INVALID");
      assert(JSON.stringify(datum.schema7OperationNonterminalStates) === JSON.stringify(REVIEW_NONTERMINAL) && JSON.stringify(datum.schema7OperationTerminalStates) === JSON.stringify(REVIEW_TERMINAL) && JSON.stringify(datum.schema7OutboxNonterminalStates) === JSON.stringify(PUBLISH_OUTBOX_NONTERMINAL) && JSON.stringify(datum.schema7OutboxTerminalStates) === JSON.stringify(PUBLISH_OUTBOX_TERMINAL) && JSON.stringify(datum.legacyOperationTerminalStates) === JSON.stringify(LEGACY_TERMINAL) && JSON.stringify(datum.legacyPublicationNonterminalStates) === JSON.stringify(LEGACY_PUBLICATION_NONTERMINAL) && JSON.stringify(datum.legacyPublicationTerminalStates) === JSON.stringify(LEGACY_PUBLICATION_TERMINAL) && JSON.stringify(datum.legacyOutboxNonterminalStates) === JSON.stringify(LEGACY_OUTBOX_NONTERMINAL) && JSON.stringify(datum.legacyOutboxTerminalStates) === JSON.stringify(LEGACY_OUTBOX_TERMINAL), "AUTO_ZERO_PUBLISH_STATES_INVALID");
    }
    assertExactKeys(datum.counts, ["activeProcessInstances", "registeredSchedules", "activeOwnerHandoffs", "prohibitedOperations", "prohibitedEffects"], "AUTO_ZERO_COUNTS_KEYS_INVALID");
    assertExactKeys(datum.evidence, ["processReceiptSha256", "staticScheduleReceiptSha256", "runtimeScheduleReceiptSha256", "handoffSqlReceiptSha256", "operationSqlReceiptSha256", "effectSqlReceiptSha256"], "AUTO_ZERO_EVIDENCE_KEYS_INVALID");
    assertUInt53(datum.counts.activeProcessInstances, "AUTO_ZERO_COUNT_INVALID");
    assertUInt53(datum.counts.registeredSchedules, "AUTO_ZERO_COUNT_INVALID");
    assertUInt53(datum.counts.activeOwnerHandoffs, "AUTO_ZERO_COUNT_INVALID");
    assertUInt53(datum.counts.prohibitedOperations, "AUTO_ZERO_COUNT_INVALID");
    assertUInt53(datum.counts.prohibitedEffects, "AUTO_ZERO_COUNT_INVALID");
    for (const hash of Object.values(datum.evidence)) assertHash(hash, "AUTO_ZERO_EVIDENCE_HASH_INVALID");
    assert(datum.state === "pass" || datum.state === "fail" || datum.state === "unknown", "AUTO_ZERO_DATUM_STATE_INVALID");
    const expectedState = Object.values(datum.counts).some((count) => count > 0) ? "fail" : datum.state;
    assert(expectedState === datum.state || datum.state === "unknown", "AUTO_ZERO_DATUM_STATE_INVALID");
  }
  assert(value.state === "pass" || value.state === "fail" || value.state === "unknown", "AUTO_ZERO_VECTOR_STATE_INVALID");
  if (value.state === "pass") assert(value.automaticReview.state === "pass" && value.automaticPublish.state === "pass", "AUTO_ZERO_VECTOR_PASS_INVALID");
  const hasUnknown = value.automaticReview.state === "unknown" || value.automaticPublish.state === "unknown";
  const hasFailure = [value.automaticReview, value.automaticPublish].some((datum) => Object.values(datum.counts).some((count) => count > 0) || datum.state === "fail");
  const expectedVectorState = hasUnknown ? "unknown" : hasFailure ? "fail" : "pass";
  assert(value.state === expectedVectorState, "AUTO_ZERO_VECTOR_STATE_INCONSISTENT");
}

export { SQL as AUTO_ZERO_NAMED_SQL };
