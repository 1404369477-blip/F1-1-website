import { constants as sqliteConstants } from "node:sqlite";

export type SqliteAuthorizerProfile =
  | "migration_0007_offline_or_authorized"
  | "owner_supervisor_writer"
  | "gateway_owner_writer"
  | "worker_or_repository"
  | "public_or_browser";

export type GatewaySqlMethod =
  | "read_only"
  | "request"
  | "authorize"
  | "authorize_write"
  | "commit_attempt"
  | "response"
  | "reconcile"
  | "phase_control"
  | "recovery_control"
  | "fence_issue"
  | "backup_insert"
  | "legacy_collect"
  | "legacy_refine"
  | "legacy_review"
  | "legacy_publish"
  | "legacy_projection"
  | "legacy_source"
  | "x_manual"
  | "authority_v2"
  | "source_registry"
  | "bilingual";

type AuthorizerCallback = (actionCode: number, arg1?: string | null, arg2?: string | null, dbName?: string | null, triggerName?: string | null) => number;
type AuthorizerDatabase = {
  setAuthorizer(callback: AuthorizerCallback | null): void;
};

const c = sqliteConstants as unknown as Record<string, number>;
const OK = c.SQLITE_OK;
const DENY = c.SQLITE_DENY;

const PROTECTED_TABLES = new Set([
  "owner_authorization_handoff", "internal_operation_policy", "internal_control_action_policy",
  "internal_required_fence_policy", "gateway_entity_policy", "internal_operation",
  "operation_entity_binding", "operation_fence_binding", "gateway_write_permit", "internal_control",
  "internal_external_attempt", "route_registry", "budget_account", "budget_reservation",
  "generic_fence_receipt", "internal_operation_outbox", "internal_operation_audit",
  "backup_recovery_point", "projection_recovery_anchor"
  , "x_manual_source_registry", "x_manual_operation", "x_manual_write_permit",
  "x_manual_submission", "x_manual_audit",
  "quick_launch_authority_v2", "quick_launch_authority_permit_v2", "quick_launch_authority_audit_v2",
  "source_registry_v1", "source_registry_rss_config_v1", "source_registry_health_v1",
  "source_registry_history_v1", "source_registry_outbox_v1", "source_registry_mutation_permit_v1",
  "source_registry_migration_identity_v1", "bilingual_authority_capability_v1",
  "bilingual_authority_permit_v1", "bilingual_authority_audit_v1", "bilingual_authority_bridge_marker_v1",
  "bilingual_candidate_lineage_v1", "bilingual_lineage_safety_decision_v1", "bilingual_operation_link_v1", "bilingual_language_slot_v1",
  "bilingual_model_receipt_v1", "bilingual_language_slot_draft_v1", "bilingual_bundle_v1",
  "bilingual_approval_v1", "bilingual_publication_v1", "bilingual_public_projection_v1",
  "bilingual_public_projection_active_v1", "bilingual_publication_outbox_v1"
]);

const LEGACY_MUTATION_TABLES = new Set([
  "source", "ingest_run", "pending_review_candidate", "rss_media_candidate", "machine_summary_draft",
  "review_bundle", "review_decision", "publication", "published_projection", "projection_outbox",
  "projection_delivery_receipt", "admin_operation", "audit_event"
]);

const CLOSED_FUNCTIONS = new Set([
  "abs", "char", "coalesce", "count", "date", "datetime", "glob", "hex", "ifnull", "instr", "json",
  "json_array_length", "json_extract", "json_type", "json_valid", "length", "lower", "max", "min",
  "json_array", "json_object", "like", "nullif", "printf", "quote", "replace", "round", "strftime", "substr", "trim", "typeof", "unixepoch",
  "upper", "sqlite_version"
]);

const MIGRATION_CREATE_ACTIONS = new Set([
  c.SQLITE_CREATE_TABLE, c.SQLITE_CREATE_INDEX, c.SQLITE_CREATE_TRIGGER, c.SQLITE_CREATE_VIEW,
  c.SQLITE_DROP_TEMP_TABLE, c.SQLITE_DROP_TEMP_INDEX, c.SQLITE_DROP_TEMP_TRIGGER, c.SQLITE_DROP_TEMP_VIEW
]);

const READ_ACTIONS = new Set([c.SQLITE_READ, c.SQLITE_SELECT, c.SQLITE_TRANSACTION]);
const ABSOLUTE_DENY_ACTIONS = new Set([
  c.SQLITE_ATTACH, c.SQLITE_DETACH, c.SQLITE_CREATE_VTABLE, c.SQLITE_DROP_VTABLE,
  c.SQLITE_DROP_TABLE, c.SQLITE_DROP_INDEX, c.SQLITE_DROP_TRIGGER, c.SQLITE_DROP_VIEW,
  c.SQLITE_ALTER_TABLE, c.SQLITE_REINDEX, c.SQLITE_ANALYZE, c.SQLITE_SAVEPOINT
]);

const METHOD_TABLE_ACTIONS: Readonly<Record<GatewaySqlMethod, ReadonlyMap<string, ReadonlySet<number>>>> = {
  read_only: new Map(),
  request: new Map([
    ["internal_operation", new Set([c.SQLITE_INSERT])],
    ["operation_entity_binding", new Set([c.SQLITE_INSERT])],
    ["operation_fence_binding", new Set([c.SQLITE_INSERT])],
    ["budget_reservation", new Set([c.SQLITE_INSERT])],
    ["budget_account", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])],
    ["x_manual_operation", new Set([c.SQLITE_INSERT])],
    ["x_manual_audit", new Set([c.SQLITE_INSERT])],
    // Consuming the one-time supervisor handoff is part of the same
    // request transaction.  Every other handoff column is immutable by the
    // schema trigger, so this permits only the guarded consumed-by update.
    ["owner_authorization_handoff", new Set([c.SQLITE_UPDATE])]
  ]),
  authorize: new Map([
    ["owner_authorization_handoff", new Set([c.SQLITE_UPDATE])],
    ["operation_fence_binding", new Set([c.SQLITE_UPDATE])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
    , ["x_manual_audit", new Set([c.SQLITE_INSERT])]
  ]),
  authorize_write: new Map([["gateway_write_permit", new Set([c.SQLITE_INSERT])]]),
  commit_attempt: new Map([
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_external_attempt", new Set([c.SQLITE_INSERT])],
    ["budget_reservation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ]),
  response: new Map([
    ["internal_external_attempt", new Set([c.SQLITE_UPDATE])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["operation_fence_binding", new Set([c.SQLITE_UPDATE])],
    ["budget_reservation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_outbox", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])],
    ["legacy_collect", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])]
  ]),
  reconcile: new Map([
    ["internal_external_attempt", new Set([c.SQLITE_UPDATE])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["operation_fence_binding", new Set([c.SQLITE_UPDATE])],
    ["budget_reservation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ]),
  phase_control: new Map([
    ["internal_control", new Set([c.SQLITE_UPDATE])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ]),
  recovery_control: new Map([
    ["internal_control", new Set([c.SQLITE_UPDATE])],
    ["projection_recovery_anchor", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ]),
  fence_issue: new Map([
    ["generic_fence_receipt", new Set([c.SQLITE_INSERT])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ]),
  backup_insert: new Map([
    ["backup_recovery_point", new Set([c.SQLITE_INSERT])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ]),
  legacy_collect: new Map([
    ...LEGACY_MUTATION_TABLES,
    "internal_operation",
    "internal_operation_audit",
  ].map((table) => [table, new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])] as const)),
  legacy_refine: new Map([["machine_summary_draft", new Set([c.SQLITE_INSERT])], ["internal_operation", new Set([c.SQLITE_UPDATE])], ["internal_operation_audit", new Set([c.SQLITE_INSERT])]]),
  legacy_review: new Map([
    ...LEGACY_MUTATION_TABLES,
    "internal_operation",
    "internal_operation_audit",
  ].map((table) => [table, new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])] as const)),
  legacy_publish: new Map([
    ...LEGACY_MUTATION_TABLES,
    "internal_operation",
    "internal_operation_audit",
  ].map((table) => [table, new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])] as const)),
  legacy_projection: new Map([
    ...LEGACY_MUTATION_TABLES,
    "internal_operation",
    "internal_operation_audit",
  ].map((table) => [table, new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])] as const)),
  legacy_source: new Map([["source", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE, c.SQLITE_DELETE])], ["internal_operation", new Set([c.SQLITE_UPDATE])], ["internal_operation_audit", new Set([c.SQLITE_INSERT])]]),
  x_manual: new Map([
    ["x_manual_write_permit", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["x_manual_submission", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["x_manual_audit", new Set([c.SQLITE_INSERT])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ]),
  authority_v2: new Map([
    ["quick_launch_authority_permit_v2", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["quick_launch_authority_v2", new Set([c.SQLITE_UPDATE])],
    ["quick_launch_authority_audit_v2", new Set([c.SQLITE_INSERT])],
    ["bilingual_authority_bridge_marker_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["bilingual_authority_permit_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["bilingual_authority_capability_v1", new Set([c.SQLITE_UPDATE])],
    ["bilingual_authority_audit_v1", new Set([c.SQLITE_INSERT])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ]),
  source_registry: new Map([
    ["source_registry_mutation_permit_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["source_registry_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["source_registry_history_v1", new Set([c.SQLITE_INSERT])],
    ["source_registry_outbox_v1", new Set([c.SQLITE_INSERT])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ]),
  bilingual: new Map([
    ["bilingual_operation_link_v1", new Set([c.SQLITE_INSERT])],
    ["bilingual_candidate_lineage_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["bilingual_lineage_safety_decision_v1", new Set([c.SQLITE_INSERT])],
    ["gateway_write_permit", new Set([c.SQLITE_UPDATE])],
    ["bilingual_language_slot_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["bilingual_model_receipt_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["bilingual_language_slot_draft_v1", new Set([c.SQLITE_INSERT])],
    ["bilingual_bundle_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["bilingual_approval_v1", new Set([c.SQLITE_INSERT])],
    ["bilingual_publication_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["bilingual_public_projection_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["bilingual_public_projection_active_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["bilingual_publication_outbox_v1", new Set([c.SQLITE_INSERT, c.SQLITE_UPDATE])],
    ["internal_operation", new Set([c.SQLITE_UPDATE])],
    ["internal_operation_audit", new Set([c.SQLITE_INSERT])]
  ])
};

type InstalledAuthorizer = Readonly<{
  profile: SqliteAuthorizerProfile;
  database: object;
  setContext(method: GatewaySqlMethod | null): void;
  getContext(): GatewaySqlMethod | null;
  uninstall(): void;
}>;

const installed = new WeakMap<object, InstalledAuthorizer>();

function allowPragma(profile: SqliteAuthorizerProfile, name: string | null, value: string | null): boolean {
  if (name === null) return false;
  const normalized = name.toLowerCase();
  const readOnly = new Set(["database_list", "foreign_key_check", "foreign_keys", "integrity_check", "journal_mode", "recursive_triggers", "schema_version", "synchronous", "table_info", "table_xinfo", "user_version", "wal_checkpoint", "busy_timeout", "temp_store", "trusted_schema"]);
  if (value === null || value.length === 0) return readOnly.has(normalized);
  if (profile !== "migration_0007_offline_or_authorized") return false;
  return new Set(["foreign_keys", "journal_mode", "recursive_triggers", "synchronous", "busy_timeout", "temp_store", "trusted_schema", "user_version"]).has(normalized);
}

function actionAllowed(profile: SqliteAuthorizerProfile, method: GatewaySqlMethod | null, action: number, table: string | null, arg1: string | null, arg2: string | null): boolean {
  if (action === c.SQLITE_FUNCTION) return CLOSED_FUNCTIONS.has((arg2 ?? arg1 ?? "").toLowerCase());
  if (action === c.SQLITE_PRAGMA) return allowPragma(profile, arg1, arg2);
  if (ABSOLUTE_DENY_ACTIONS.has(action)) return false;
  if (READ_ACTIONS.has(action)) return true;
  if (profile === "migration_0007_offline_or_authorized") {
    if (MIGRATION_CREATE_ACTIONS.has(action)) return true;
    return action === c.SQLITE_INSERT || action === c.SQLITE_UPDATE || action === c.SQLITE_DELETE;
  }
  if (profile === "owner_supervisor_writer") {
    return table === "owner_authorization_handoff" && action === c.SQLITE_INSERT;
  }
  if (profile !== "gateway_owner_writer" || method === null || table === null) return false;
  // A successful gateway mutation consumes exactly one immutable permit. The
  // table trigger enforces that only consumed_at changes and only once.
  if (table === "gateway_write_permit" && action === c.SQLITE_UPDATE) return true;
  const actions = METHOD_TABLE_ACTIONS[method].get(table);
  if (actions?.has(action)) return true;
  // Trigger bodies run under the same closed gateway method. They may update
  // the derived budget/version row but may never widen to an unrelated table.
  if (table === "budget_account" && (method === "request" || method === "commit_attempt" || method === "response" || method === "reconcile")) return action === c.SQLITE_UPDATE;
  return false;
}

export function installSqliteAuthorizer(database: object, profile: SqliteAuthorizerProfile): InstalledAuthorizer {
  const existing = installed.get(database);
  if (existing) throw new Error("SQLITE_AUTHORIZER_ALREADY_INSTALLED");
  const target = database as AuthorizerDatabase;
  if (typeof target.setAuthorizer !== "function") throw new Error("SQLITE_AUTHORIZER_UNAVAILABLE");
  let method: GatewaySqlMethod | null = null;
  const callback: AuthorizerCallback = (action, arg1 = null, arg2 = null, dbName = null, triggerName = null): number => {
    try {
      if (dbName !== null && dbName !== "main" && dbName !== "temp") return DENY;
      if (triggerName !== null && triggerName.length > 256) return DENY;
      return actionAllowed(profile, method, action, arg1, arg1, arg2) ? OK : DENY;
    } catch {
      return DENY;
    }
  };
  try {
    target.setAuthorizer(callback);
  } catch (error) {
    throw new Error(`SQLITE_AUTHORIZER_INSTALL_FAILED:${String(error)}`);
  }
  const value: InstalledAuthorizer = {
    profile,
    database,
    setContext(next) { method = next; },
    getContext() { return method; },
    uninstall() {
      try { target.setAuthorizer(null); } finally { installed.delete(database); }
    }
  };
  installed.set(database, value);
  return value;
}

export function getInstalledSqliteAuthorizer(database: object): InstalledAuthorizer | null {
  return installed.get(database) ?? null;
}

export function withSqliteAuthorizerContext<T>(database: object, method: GatewaySqlMethod, callback: () => T): T {
  const authorizer = installed.get(database);
  if (!authorizer || authorizer.profile !== "gateway_owner_writer") throw new Error("SQLITE_AUTHORIZER_GATEWAY_REQUIRED");
  const previous = authorizer.getContext();
  authorizer.setContext(method);
  try { return callback(); } finally { authorizer.setContext(previous); }
}

const writerLeases = new Map<string, symbol>();
const memoryDatabaseKeys = new WeakMap<object, string>();
let nextMemoryDatabaseKey = 1;

export function acquireSingleWriter(database: { location(): string | null }): () => void {
  const location = database.location();
  // `:memory:` databases intentionally have no filesystem location.  They
  // still need a per-connection lease for tests and disposable candidates;
  // assigning a stable object key preserves the second-writer invariant
  // without conflating independent in-memory databases.
  let key: string;
  if (typeof location === "string" && location.length > 0) {
    key = location;
  } else {
    const objectKey = database as object;
    key = memoryDatabaseKeys.get(objectKey) ?? `:memory:${nextMemoryDatabaseKey++}`;
    memoryDatabaseKeys.set(objectKey, key);
  }
  if (writerLeases.has(key)) throw new Error("SECOND_WRITER_DENIED");
  const token = Symbol(key);
  writerLeases.set(key, token);
  return () => { if (writerLeases.get(key) === token) writerLeases.delete(key); };
}

export function assertSqliteAuthorizerReady(database: object): void {
  const authorizer = installed.get(database);
  if (!authorizer) throw new Error("SQLITE_AUTHORIZER_NOT_INSTALLED");
  if (authorizer.profile !== "gateway_owner_writer") throw new Error("SQLITE_AUTHORIZER_WRONG_PROFILE");
}

export const SQLITE_AUTHORIZER_PROTECTED_TABLES = PROTECTED_TABLES;
