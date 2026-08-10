import { DatabaseSync, constants as sqliteConstants } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { ConfigError, assertNodeVersion } from "../config/env.ts";

export type SqliteDatabase = DatabaseSync;

export type DatabaseOptions = {
  appRoot: string;
  allowTestRoot?: string;
};

export type SqliteRuntime = {
  sqliteVersion: string;
  journalMode: string;
  synchronous: number;
  busyTimeout: number;
  foreignKeys: number;
  tempStore: number;
  userVersion: number;
};

type MigrationFile = {
  file: string;
  hash: string;
  sql: string;
  version: number;
};

const MIGRATION_OBJECTS = new Map<number, readonly string[]>([
  [1, ["migration_ledger", "fixture_seed_ledger"]],
  [
    2,
    [
      "source_config_fixture",
      "source_config_fixture_canonical_unique",
      "source_config_fixture_status_idx",
      "source_config_fixture_lifecycle_idx",
      "source_config_fixture_epoch_idx",
      "source_seed_ledger"
    ]
  ],
  [
    3,
    [
      "fixture_profile_ledger",
      "public_captured_item",
      "public_content",
      "public_summary",
      "public_media_candidate",
      "public_release_bundle",
      "public_review_decision",
      "public_publication",
      "published_projection",
      "public_publication_published_idx"
    ]
  ]
]);

// These receipts are generated from sqlite_schema plus table/index/foreign-key
// PRAGMAs under the pinned Node 24.18.0 / SQLite 3.53.1 runtime. They are static
// so a modified migration file cannot redefine the accepted on-disk contract.
const EXPECTED_SCHEMA_SHA256 = new Map<number, string>([
  [1, "512ac36dd348860362380372bb3c1ae3001272fe68d64a9233068493a1b36f5e"],
  [2, "f1beab525006000a5877327fefde6981f05798439ab246319c3a5a63629f2f1a"],
  [3, "ad2f86e03d9aa8727fe7555729e65a18e4c3986a572ca88cb52cc96245afd23b"]
]);

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function assertCurrentOwner(uid: number, label: string): void {
  const currentUid = process.getuid?.();
  if (currentUid === undefined || uid !== currentUid) {
    throw new ConfigError("DB_OWNER", `${label} must be owned by the current local user`);
  }
}

function assertPrivateFile(path: string, label: string): void {
  const stat = lstatSync(/* turbopackIgnore: true */ path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new ConfigError("DB_PATH", `${label} must be a regular single-link file`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new ConfigError("DB_PERMISSIONS", `${label} must be mode 600 or stricter`);
  }
  assertCurrentOwner(stat.uid, label);
}

function assertPrivateSidecars(dbPath: string): void {
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`, `${dbPath}.journal`, `${dbPath}.backup`, `${dbPath}-backup`]) {
    if (existsSync(/* turbopackIgnore: true */ sidecar)) {
      assertPrivateFile(sidecar, sidecar.split("/").pop() ?? "sqlite sidecar");
    }
  }
}

function assertRegularDirectory(path: string, label: string): void {
  const stat = lstatSync(/* turbopackIgnore: true */ path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ConfigError("DB_PATH", `${label} must be a real directory`);
  }
  assertCurrentOwner(stat.uid, label);
}

function assertNoSymlinkChain(path: string, label: string, anchor?: string): void {
  const absolute = resolve(/* turbopackIgnore: true */ path);
  const root = anchor ? resolve(/* turbopackIgnore: true */ anchor) : (absolute.startsWith(sep) ? sep : ".");
  if (anchor && !isInside(root, absolute)) {
    throw new ConfigError("DB_PATH", `${label} is outside its security anchor`);
  }
  let current = root;
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    current = current === sep ? `${sep}${part}` : `${current}${sep}${part}`;
    if (!existsSync(/* turbopackIgnore: true */ current)) continue;
    const stat = lstatSync(/* turbopackIgnore: true */ current);
    if (stat.isSymbolicLink()) {
      throw new ConfigError("DB_PATH", `${label} contains a symlink component`);
    }
  }
}

function ensurePrivateDirectory(path: string, label: string, allowedRoot: string): void {
  const absolute = resolve(/* turbopackIgnore: true */ path);
  if (!isInside(allowedRoot, absolute)) {
    throw new ConfigError("DB_PATH", `${label} is outside the allowed local root`);
  }
  assertNoSymlinkChain(absolute, label, allowedRoot);
  const root = resolve(/* turbopackIgnore: true */ allowedRoot);
  assertRegularDirectory(root, "allowed database root");
  const rel = relative(root, absolute);
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(/* turbopackIgnore: true */ current, part);
    if (!existsSync(/* turbopackIgnore: true */ current)) {
      try {
        mkdirSync(/* turbopackIgnore: true */ current, { mode: 0o700 });
      } catch (error) {
        throw new ConfigError("DB_PATH", `cannot create ${label}: ${String(error)}`);
      }
    }
    assertRegularDirectory(current, label);
    chmodSync(/* turbopackIgnore: true */ current, 0o700);
  }
  assertRegularDirectory(absolute, label);
}

type FileIdentity = { dev: number; ino: number; size: number; nlink: number };
type DirectoryIdentity = { dev: number; ino: number };

function assertPrivateDirectoryIdentity(path: string, label: string): DirectoryIdentity {
  const stat = lstatSync(/* turbopackIgnore: true */ path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ConfigError("DB_PATH", `${label} must be a real directory`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new ConfigError("DB_PERMISSIONS", `${label} must be mode 700 or stricter`);
  }
  assertCurrentOwner(stat.uid, label);
  return { dev: stat.dev, ino: stat.ino };
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function readDirectoryIdentity(path: string, label: string): DirectoryIdentity {
  const stat = lstatSync(/* turbopackIgnore: true */ path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ConfigError("DB_PATH", `${label} must be a real directory`);
  }
  assertCurrentOwner(stat.uid, label);
  return { dev: stat.dev, ino: stat.ino };
}

function assertPrivateIdentity(path: string, label: string): FileIdentity {
  const stat = lstatSync(/* turbopackIgnore: true */ path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new ConfigError("DB_PATH", `${label} must be a regular single-link file`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new ConfigError("DB_PERMISSIONS", `${label} must be mode 600 or stricter`);
  }
  assertCurrentOwner(stat.uid, label);
  return { dev: stat.dev, ino: stat.ino, size: stat.size, nlink: stat.nlink };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.nlink === right.nlink;
}

function openStableDatabasePath(path: string): { guardFd: number; identity: FileIdentity } {
  const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  if (typeof noFollow !== "number") {
    throw new ConfigError("DB_PATH", "O_NOFOLLOW is unavailable; refusing an unguarded database open");
  }
  const flags = fsConstants.O_RDWR | noFollow;
  let guardFd: number;
  try {
    if (existsSync(/* turbopackIgnore: true */ path)) {
      guardFd = openSync(/* turbopackIgnore: true */ path, flags);
    } else {
      guardFd = openSync(/* turbopackIgnore: true */ path, flags | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    }
  } catch (error) {
    throw new ConfigError("DB_PATH", `database path cannot be opened without following symlinks: ${String(error)}`);
  }
  try {
    const fdStat = fstatSync(guardFd);
    if (!fdStat.isFile() || fdStat.nlink !== 1 || (fdStat.mode & 0o077) !== 0) {
      throw new ConfigError("DB_PATH", "database guard is not a private regular file");
    }
    assertCurrentOwner(fdStat.uid, "database guard");
    const pathIdentity = assertPrivateIdentity(path, "database");
    const identity: FileIdentity = {
      dev: fdStat.dev,
      ino: fdStat.ino,
      size: fdStat.size,
      nlink: fdStat.nlink
    };
    if (!sameIdentity(identity, pathIdentity)) {
      throw new ConfigError("DB_PATH", "database path changed during no-follow open");
    }
    return { guardFd, identity };
  } catch (error) {
    closeSync(guardFd);
    throw error;
  }
}

function countMatchingDescriptors(identity: FileIdentity): number {
  let matchingDescriptors = 0;
  try {
    for (const entry of readdirSync("/dev/fd")) {
      if (!/^[0-9]+$/.test(entry)) continue;
      try {
        const stat = fstatSync(Number(entry));
        if (stat.dev === identity.dev && stat.ino === identity.ino) matchingDescriptors += 1;
      } catch {
        // Descriptors can close while /dev/fd is enumerated; ignore only that entry.
      }
    }
  } catch {
    throw new ConfigError("DB_PATH", "open descriptor identity verification is unavailable");
  }
  return matchingDescriptors;
}

function assertSqliteConnectionIdentity(
  database: SqliteDatabase,
  expectedPath: string,
  identity: FileIdentity,
  guardedDescriptorCount: number
): void {
  const location = database.location();
  if (!location) throw new ConfigError("DB_PATH", "SQLite did not expose a file-backed main database location");
  let expectedRealPath: string;
  let locationRealPath: string;
  try {
    expectedRealPath = realpathSync(/* turbopackIgnore: true */ expectedPath);
    locationRealPath = realpathSync(/* turbopackIgnore: true */ location);
  } catch {
    throw new ConfigError("DB_PATH", "SQLite main database location cannot be canonicalized");
  }
  if (locationRealPath !== expectedRealPath || !sameIdentity(identity, assertPrivateIdentity(locationRealPath, "SQLite main database"))) {
    throw new ConfigError("DB_PATH", "SQLite main database location is not the guarded database inode");
  }
  // SQLite must add its own descriptor after the O_NOFOLLOW guard baseline.
  if (countMatchingDescriptors(identity) <= guardedDescriptorCount) {
    throw new ConfigError("DB_PATH", "SQLite did not keep the guarded database inode open");
  }
}

export function openSafeDatabase(dbPath: string, options: DatabaseOptions): SqliteDatabase {
  assertNodeVersion();
  process.umask(0o077);
  const appRoot = resolve(/* turbopackIgnore: true */ options.appRoot);
  const absolutePath = isAbsolute(dbPath)
    ? resolve(/* turbopackIgnore: true */ dbPath)
    : resolve(/* turbopackIgnore: true */ appRoot, dbPath);
  const localRoot = resolve(/* turbopackIgnore: true */ appRoot, ".local");
  const allowedRoot = options.allowTestRoot
    ? resolve(/* turbopackIgnore: true */ options.allowTestRoot)
    : localRoot;
  assertRegularDirectory(appRoot, "app root");
  const appRootBefore = readDirectoryIdentity(appRoot, "app root");
  if (!isInside(allowedRoot, absolutePath)) {
    throw new ConfigError("DB_PATH", "database path is outside the allowed local root");
  }
  if (dirname(absolutePath) !== allowedRoot || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.sqlite$/.test(basename(absolutePath))) {
    throw new ConfigError("DB_PATH", "database path must be one SQLite basename directly under the allowed root");
  }
  const parent = dirname(absolutePath);
  const rootForPath = options.allowTestRoot ? allowedRoot : localRoot;
  if (!existsSync(/* turbopackIgnore: true */ rootForPath)) {
    const parentOfRoot = dirname(rootForPath);
    assertNoSymlinkChain(parentOfRoot, "database root parent", appRoot);
    mkdirSync(/* turbopackIgnore: true */ rootForPath, { mode: 0o700 });
  }
  assertRegularDirectory(rootForPath, "database root");
  chmodSync(/* turbopackIgnore: true */ rootForPath, 0o700);
  ensurePrivateDirectory(parent, "database parent", rootForPath);
  const rootBefore = assertPrivateDirectoryIdentity(rootForPath, "database root");
  const parentBefore = assertPrivateDirectoryIdentity(parent, "database parent");
  // Valid private WAL/SHM files may remain after a crash or belong to another
  // local connection. Validate them before SQLite can perform recovery.
  assertPrivateSidecars(absolutePath);
  const opened = openStableDatabasePath(absolutePath);
  const guardedDescriptorCount = countMatchingDescriptors(opened.identity);
  let database: SqliteDatabase | undefined;
  try {
    database = new DatabaseSync(absolutePath, {
      allowExtension: false,
      defensive: true,
      timeout: 250
    } as ConstructorParameters<typeof DatabaseSync>[1]);
    database.prepare("PRAGMA schema_version").get();
    assertSqliteConnectionIdentity(database, absolutePath, opened.identity, guardedDescriptorCount);
    const appRootAfterOpen = readDirectoryIdentity(appRoot, "app root");
    const rootAfterOpen = assertPrivateDirectoryIdentity(rootForPath, "database root");
    const parentAfter = assertPrivateDirectoryIdentity(parent, "database parent");
    const pathAfter = assertPrivateIdentity(absolutePath, "database");
    if (
      !sameDirectoryIdentity(appRootBefore, appRootAfterOpen) ||
      !sameDirectoryIdentity(rootBefore, rootAfterOpen) ||
      !sameDirectoryIdentity(parentBefore, parentAfter) ||
      !sameIdentity(opened.identity, pathAfter)
    ) {
      database.close();
      database = undefined;
      throw new ConfigError("DB_PATH", "database or parent changed during stable open");
    }
    chmodSync(/* turbopackIgnore: true */ absolutePath, 0o600);
    database.exec("PRAGMA foreign_keys=ON;");
    database.exec("PRAGMA journal_mode=WAL;");
    database.exec("PRAGMA synchronous=FULL;");
    database.exec("PRAGMA busy_timeout=250;");
    database.exec("PRAGMA temp_store=MEMORY;");
    database.exec("PRAGMA trusted_schema=OFF;");
    const securityConstants = sqliteConstants as unknown as Record<string, number>;
    const authorizerDatabase = database as SqliteDatabase & {
      setAuthorizer(callback: (actionCode: number) => number): void;
    };
    authorizerDatabase.setAuthorizer((actionCode) =>
      actionCode === securityConstants.SQLITE_ATTACH || actionCode === securityConstants.SQLITE_DETACH
        ? securityConstants.SQLITE_DENY
        : securityConstants.SQLITE_OK
    );
    const runtime = readSqliteRuntime(database);
    const [major, minor, patch] = runtime.sqliteVersion.split(".").map(Number);
    const versionNumber = major * 1_000_000 + minor * 1_000 + patch;
    if (!Number.isFinite(versionNumber) || versionNumber < 3_051_003) {
      throw new ConfigError("SQLITE_VERSION", "SQLite must be at least 3.51.3");
    }
    if (
      runtime.journalMode !== "wal" ||
      runtime.synchronous !== 2 ||
      runtime.busyTimeout !== 250 ||
      runtime.foreignKeys !== 1 ||
      runtime.tempStore !== 2
    ) {
      throw new ConfigError("SQLITE_PRAGMA", "required SQLite connection pragmas were not applied");
    }
    assertPrivateIdentity(absolutePath, "database");
    assertPrivateSidecars(absolutePath);
    const appRootAfter = readDirectoryIdentity(appRoot, "app root");
    const rootAfter = assertPrivateDirectoryIdentity(rootForPath, "database root");
    const parentFinal = assertPrivateDirectoryIdentity(parent, "database parent");
    if (
      !sameDirectoryIdentity(appRootBefore, appRootAfter) ||
      !sameDirectoryIdentity(rootBefore, rootAfter) ||
      !sameDirectoryIdentity(parentBefore, parentFinal) ||
      !sameIdentity(opened.identity, assertPrivateIdentity(absolutePath, "database"))
    ) {
      database.close();
      database = undefined;
      throw new ConfigError("DB_PATH", "database path identities changed while applying SQLite pragmas");
    }
    return database;
  } catch (error) {
    if (database) database.close();
    throw error;
  } finally {
    closeSync(opened.guardFd);
  }
}

export function readSqliteRuntime(database: SqliteDatabase): SqliteRuntime {
  const versionRow = database.prepare("SELECT sqlite_version() AS sqlite_version").get() as Record<string, unknown>;
  const journalRow = database.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
  const synchronousRow = database.prepare("PRAGMA synchronous").get() as Record<string, unknown>;
  const timeoutRow = database.prepare("PRAGMA busy_timeout").get() as Record<string, unknown>;
  const foreignKeysRow = database.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>;
  const tempStoreRow = database.prepare("PRAGMA temp_store").get() as Record<string, unknown>;
  const userVersionRow = database.prepare("PRAGMA user_version").get() as Record<string, unknown>;
  return {
    sqliteVersion: String(versionRow.sqlite_version),
    journalMode: String(journalRow.journal_mode).toLowerCase(),
    synchronous: Number(synchronousRow.synchronous),
    busyTimeout: Number(timeoutRow.timeout ?? timeoutRow.busy_timeout),
    foreignKeys: Number(foreignKeysRow.foreign_keys),
    tempStore: Number(tempStoreRow.temp_store),
    userVersion: Number(userVersionRow.user_version)
  };
}

export function withImmediateTransaction<T>(database: SqliteDatabase, callback: () => T): T {
  const retryDelaysMs = [25, 50] as const;
  let acquired = false;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      database.exec("BEGIN IMMEDIATE;");
      acquired = true;
      break;
    } catch (error) {
      const candidate = error as { code?: unknown; errcode?: unknown; message?: unknown };
      const lockContention =
        candidate.code === "ERR_SQLITE_ERROR" &&
        (candidate.errcode === 5 || candidate.errcode === 6 || /(?:busy|locked)/i.test(String(candidate.message)));
      if (!lockContention) throw error;
      if (attempt === retryDelaysMs.length) {
        throw new ConfigError("LOCK_CONTENTION", `BEGIN IMMEDIATE remained busy after ${attempt + 1} bounded attempts`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelaysMs[attempt]);
    }
  }
  if (!acquired) throw new ConfigError("LOCK_CONTENTION", "BEGIN IMMEDIATE did not acquire a transaction");
  try {
    const result = callback();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // Preserve the original failure; rollback is best effort after a failed statement.
    }
    throw error;
  }
}

export type MigrationResult = {
  applied: string[];
  userVersion: number;
  sqliteVersion: string;
};

export type OrderedMigration = Readonly<{
  file: string;
  hash: string;
  path: string;
  sql: string;
  version: number;
}>;

export type OrderedMigrationContract = Readonly<{
  migrations: readonly OrderedMigration[];
  objectManifest: Readonly<Record<number, readonly string[]>>;
  schemaFingerprints: Readonly<Record<number, string>>;
}>;

function hasTable(database: SqliteDatabase, table: string): boolean {
  const row = database.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table) as Record<string, unknown> | undefined;
  return row?.present === 1;
}

function normalizeSchemaSql(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).trim().replace(/\s+/g, " ");
}

function readSchemaSnapshot(database: SqliteDatabase): unknown {
  const schemaRows = database.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
  ).all() as Array<Record<string, unknown>>;
  const tables = schemaRows
    .filter((row) => row.type === "table")
    .map((row) => String(row.name))
    .sort()
    .map((table) => {
      const columns = database.prepare(
        'SELECT cid, name, type, "notnull" AS not_null, dflt_value, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid'
      ).all(table) as Array<Record<string, unknown>>;
      const indexes = (database.prepare(
        'SELECT name, "unique" AS is_unique, origin, partial FROM pragma_index_list(?) ORDER BY name'
      ).all(table) as Array<Record<string, unknown>>).map((index) => {
        const name = String(index.name);
        const columnsForIndex = database.prepare(
          'SELECT seqno, cid, name, "desc" AS descending, coll, key FROM pragma_index_xinfo(?) ORDER BY seqno'
        ).all(name) as Array<Record<string, unknown>>;
        return {
          name,
          unique: Number(index.is_unique),
          origin: String(index.origin),
          partial: Number(index.partial),
          columns: columnsForIndex.map((column) => [
            Number(column.seqno),
            Number(column.cid),
            column.name === null ? null : String(column.name),
            Number(column.descending),
            column.coll === null ? null : String(column.coll),
            Number(column.key)
          ])
        };
      });
      const foreignKeys = database.prepare(
        'SELECT id, seq, "table" AS target_table, "from" AS source_column, "to" AS target_column, on_update, on_delete, match FROM pragma_foreign_key_list(?) ORDER BY id, seq'
      ).all(table) as Array<Record<string, unknown>>;
      return {
        table,
        columns: columns.map((column) => [
          Number(column.cid),
          String(column.name),
          String(column.type),
          Number(column.not_null),
          column.dflt_value === null ? null : String(column.dflt_value),
          Number(column.pk),
          Number(column.hidden)
        ]),
        indexes,
        foreignKeys: foreignKeys.map((foreignKey) => [
          Number(foreignKey.id),
          Number(foreignKey.seq),
          String(foreignKey.target_table),
          foreignKey.source_column === null ? null : String(foreignKey.source_column),
          foreignKey.target_column === null ? null : String(foreignKey.target_column),
          String(foreignKey.on_update),
          String(foreignKey.on_delete),
          String(foreignKey.match)
        ])
      };
    });
  return {
    objects: schemaRows.map((row) => [
      String(row.type),
      String(row.name),
      String(row.tbl_name),
      normalizeSchemaSql(row.sql)
    ]),
    tables
  };
}

export function readDatabaseSchemaFingerprint(database: SqliteDatabase): string {
  return createHash("sha256").update(JSON.stringify(readSchemaSnapshot(database))).digest("hex");
}

function assertSchemaVersion(database: SqliteDatabase, version: number): void {
  const expected = EXPECTED_SCHEMA_SHA256.get(version);
  if (!expected) {
    throw new ConfigError("MIGRATION_SCHEMA", `no accepted schema receipt exists for migration version ${version}`);
  }
  const actual = readDatabaseSchemaFingerprint(database);
  if (actual !== expected) {
    throw new ConfigError("MIGRATION_SCHEMA", `schema fingerprint ${actual} does not match version ${version}`);
  }
}

function assertMigrationObjectsAbsent(database: SqliteDatabase, migration: MigrationFile): void {
  const names = MIGRATION_OBJECTS.get(migration.version);
  if (!names) throw new ConfigError("MIGRATION_SCHEMA", `migration ${migration.file} has no declared object manifest`);
  for (const name of names) {
    const row = database.prepare("SELECT type, name FROM sqlite_schema WHERE name = ?").get(name) as Record<string, unknown> | undefined;
    if (row) {
      throw new ConfigError("MIGRATION_PRECLAIM", `${String(row.type)} ${name} existed before ${migration.file}`);
    }
  }
}

function assertIntegrityCheck(database: SqliteDatabase): void {
  const rows = database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
  if (rows.length !== 1 || String(Object.values(rows[0])[0]).toLowerCase() !== "ok") {
    throw new ConfigError("SQLITE_INTEGRITY", "SQLite integrity_check did not return exactly one ok row");
  }
}

function isCanonicalTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isAuditableSqliteVersion(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) return false;
  const [major, minor, patch] = value.split(".").map(Number);
  return major * 1_000_000 + minor * 1_000 + patch >= 3_051_003;
}

function assertMigrationLedger(
  database: SqliteDatabase,
  migrations: readonly MigrationFile[],
  current: number
): void {
  const ledgerPresent = hasTable(database, "migration_ledger");
  if (current === 0) {
    if (ledgerPresent) {
      const row = database.prepare("SELECT COUNT(*) AS count FROM migration_ledger").get() as Record<string, unknown>;
      if (Number(row.count) !== 0) {
        throw new ConfigError("MIGRATION_LEDGER", "migration ledger has records while user_version is zero");
      }
    }
    return;
  }
  if (!ledgerPresent) {
    throw new ConfigError("MIGRATION_LEDGER", "migration ledger is missing for a non-zero user_version");
  }
  const records = database.prepare(
    "SELECT migration_id, applied_at, sqlite_version, migration_sha256, append_only FROM migration_ledger ORDER BY migration_id"
  ).all() as Array<Record<string, unknown>>;
  if (records.length !== current) {
    throw new ConfigError("MIGRATION_LEDGER", `expected ${current} migration ledger records, found ${records.length}`);
  }
  let previousAppliedAt = -Infinity;
  for (let index = 0; index < current; index += 1) {
    const migration = migrations[index];
    const record = records[index];
    if (record.migration_id !== migration.file) {
      throw new ConfigError("MIGRATION_LEDGER", `migration ledger record ${index + 1} is out of order or unknown`);
    }
    if (record.migration_sha256 !== migration.hash) {
      throw new ConfigError("MIGRATION_DRIFT", `applied migration ${migration.file} does not match its recorded hash`);
    }
    const appliedAt = typeof record.applied_at === "string" ? Date.parse(record.applied_at) : Number.NaN;
    if (
      Number(record.append_only) !== 1 ||
      !isCanonicalTimestamp(record.applied_at) ||
      appliedAt < previousAppliedAt ||
      !isAuditableSqliteVersion(record.sqlite_version)
    ) {
      throw new ConfigError("MIGRATION_LEDGER", `migration ledger record ${index + 1} is not the accepted append-only receipt`);
    }
    previousAppliedAt = appliedAt;
  }
}

function readMigrations(migrationsDir: string): MigrationFile[] {
  const files = readdirSync(/* turbopackIgnore: true */ migrationsDir)
    .filter((file: string) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(file))
    .sort();
  return files.map((file, index) => {
    const version = Number(file.slice(0, 4));
    if (version !== index + 1) {
      throw new ConfigError("MIGRATION_ORDER", `migration ${file} is not a contiguous append-only version`);
    }
    const sql = readFileSync(/* turbopackIgnore: true */ resolve(migrationsDir, file), "utf8");
    return { file, version, sql, hash: createHash("sha256").update(sql).digest("hex") };
  });
}

export function assertMigrationState(database: SqliteDatabase, migrationsDir: string, expectedVersion?: number): void {
  const migrations = readMigrations(migrationsDir);
  const current = readSqliteRuntime(database).userVersion;
  if (current < 0 || current > migrations.length || (expectedVersion !== undefined && current !== expectedVersion)) {
    throw new ConfigError("MIGRATION_VERSION", `database user_version ${current} is not an accepted migration state`);
  }
  if (current === 0) {
    assertMigrationLedger(database, migrations, current);
    return;
  }
  assertSchemaVersion(database, current);
  assertMigrationLedger(database, migrations, current);
  assertIntegrityCheck(database);
}

export function migrateDatabase(database: SqliteDatabase, migrationsDir: string): MigrationResult {
  const migrations = readMigrations(migrationsDir);
  const runtimeBefore = readSqliteRuntime(database);
  let current = runtimeBefore.userVersion;
  const maxVersion = migrations.length;
  if (current < 0 || current > maxVersion) {
    throw new ConfigError("MIGRATION_VERSION", `database user_version ${current} is ahead of known migrations`);
  }
  if (current > 0) assertSchemaVersion(database, current);
  assertMigrationLedger(database, migrations, current);
  const applied: string[] = [];
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    if (migration.version !== current + 1) {
      throw new ConfigError("MIGRATION_ORDER", `migration ${migration.file} is not the next append-only version`);
    }
    assertMigrationObjectsAbsent(database, migration);
    withImmediateTransaction(database, () => {
      database.exec(migration.sql);
      assertSchemaVersion(database, migration.version);
      assertIntegrityCheck(database);
      database.exec(`PRAGMA user_version=${migration.version};`);
      const sqliteVersion = readSqliteRuntime(database).sqliteVersion;
      database.prepare(
        "INSERT INTO migration_ledger (migration_id, applied_at, sqlite_version, migration_sha256, append_only) VALUES (?, ?, ?, ?, 1)"
      ).run(migration.file, new Date().toISOString(), sqliteVersion, migration.hash);
    });
    current = migration.version;
    applied.push(migration.file);
    assertSchemaVersion(database, current);
    assertMigrationLedger(database, migrations, current);
  }
  if (current > 0) assertSchemaVersion(database, current);
  assertMigrationLedger(database, migrations, current);
  if (current > 0) assertIntegrityCheck(database);
  const runtimeAfter = readSqliteRuntime(database);
  return { applied, userVersion: runtimeAfter.userVersion, sqliteVersion: runtimeAfter.sqliteVersion };
}

export function readOrderedMigrations(paths: readonly string[]): readonly OrderedMigration[] {
  return paths.map((path, index) => {
    const file = basename(path);
    const match = /^(\d{4})_[a-z0-9_-]+\.sql$/.exec(file);
    const version = match ? Number(match[1]) : Number.NaN;
    if (!match || version !== index + 1) {
      throw new ConfigError("MIGRATION_ORDER", `selected migration ${file} is not contiguous`);
    }
    const sql = readFileSync(/* turbopackIgnore: true */ path, "utf8");
    return Object.freeze({
      file,
      hash: createHash("sha256").update(sql).digest("hex"),
      path,
      sql,
      version
    });
  });
}

export function orderedMigrationRoot(migrations: readonly OrderedMigration[]): string {
  return createHash("sha256").update(JSON.stringify({
    ordered: migrations.map((migration) => ({
      relative_path: migration.path.replaceAll("\\", "/"),
      sha256: migration.hash
    }))
  })).digest("hex");
}

function assertSelectedSchema(database: SqliteDatabase, contract: OrderedMigrationContract, version: number): void {
  const expected = contract.schemaFingerprints[version];
  if (!expected || readDatabaseSchemaFingerprint(database) !== expected) {
    throw new ConfigError("MIGRATION_SCHEMA", `selected schema fingerprint does not match version ${version}`);
  }
}

function assertSelectedLedger(
  database: SqliteDatabase,
  migrations: readonly OrderedMigration[],
  current: number
): void {
  if (!hasTable(database, "migration_ledger")) {
    if (current === 0) return;
    throw new ConfigError("MIGRATION_LEDGER", "selected migration ledger is missing");
  }
  const records = database.prepare(
    "SELECT migration_id, applied_at, sqlite_version, migration_sha256, append_only FROM migration_ledger ORDER BY migration_id"
  ).all() as Array<Record<string, unknown>>;
  if (records.length !== current) throw new ConfigError("MIGRATION_LEDGER", "selected migration ledger length drifted");
  let previousAppliedAt = -Infinity;
  for (let index = 0; index < current; index += 1) {
    const record = records[index];
    const migration = migrations[index];
    const appliedAt = typeof record.applied_at === "string" ? Date.parse(record.applied_at) : Number.NaN;
    if (
      record.migration_id !== migration.file ||
      record.migration_sha256 !== migration.hash ||
      Number(record.append_only) !== 1 ||
      !isCanonicalTimestamp(record.applied_at) ||
      !isAuditableSqliteVersion(record.sqlite_version) ||
      appliedAt < previousAppliedAt
    ) {
      throw new ConfigError("MIGRATION_LEDGER", `selected migration receipt ${index + 1} drifted`);
    }
    previousAppliedAt = appliedAt;
  }
}

function assertSelectedObjectsAbsent(database: SqliteDatabase, names: readonly string[]): void {
  for (const name of names) {
    const row = database.prepare("SELECT 1 AS present FROM sqlite_schema WHERE name = ?").get(name) as Record<string, unknown> | undefined;
    if (row?.present === 1) throw new ConfigError("MIGRATION_PRECLAIM", `selected migration object ${name} already exists`);
  }
}

export function assertOrderedMigrationState(
  database: SqliteDatabase,
  contract: OrderedMigrationContract,
  expectedVersion = contract.migrations.length
): void {
  const current = readSqliteRuntime(database).userVersion;
  if (current !== expectedVersion || current < 0 || current > contract.migrations.length) {
    throw new ConfigError("MIGRATION_VERSION", "selected migration version drifted");
  }
  assertSelectedLedger(database, contract.migrations, current);
  if (current > 0) {
    assertSelectedSchema(database, contract, current);
    assertIntegrityCheck(database);
  }
}

export function migrateOrderedDatabase(
  database: SqliteDatabase,
  contract: OrderedMigrationContract
): MigrationResult {
  let current = readSqliteRuntime(database).userVersion;
  if (current < 0 || current > contract.migrations.length) {
    throw new ConfigError("MIGRATION_VERSION", "selected database is ahead of its migration contract");
  }
  assertSelectedLedger(database, contract.migrations, current);
  if (current > 0) assertSelectedSchema(database, contract, current);
  const applied: string[] = [];
  for (const migration of contract.migrations) {
    if (migration.version <= current) continue;
    const names = contract.objectManifest[migration.version];
    if (!names) throw new ConfigError("MIGRATION_SCHEMA", `selected migration ${migration.file} lacks an object manifest`);
    assertSelectedObjectsAbsent(database, names);
    withImmediateTransaction(database, () => {
      database.exec(migration.sql);
      assertSelectedSchema(database, contract, migration.version);
      assertIntegrityCheck(database);
      database.exec(`PRAGMA user_version=${migration.version};`);
      database.prepare(
        "INSERT INTO migration_ledger (migration_id, applied_at, sqlite_version, migration_sha256, append_only) VALUES (?, ?, ?, ?, 1)"
      ).run(migration.file, new Date().toISOString(), readSqliteRuntime(database).sqliteVersion, migration.hash);
    });
    current = migration.version;
    applied.push(migration.file);
    assertSelectedLedger(database, contract.migrations, current);
  }
  assertOrderedMigrationState(database, contract);
  return { applied, userVersion: current, sqliteVersion: readSqliteRuntime(database).sqliteVersion };
}

export function closeDatabase(database: SqliteDatabase): void {
  database.close();
}
