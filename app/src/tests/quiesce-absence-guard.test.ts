import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, test } from "vitest";

import { assertQuiesceLeaseAbsent, QuiesceAbsenceError } from "../server/admin-service/quiesce-absence-guard.ts";
import {
  inspectExistingPrivateDatabase,
  openExistingSafeDatabase,
  openExistingSafeDatabaseForTest,
  openSafeDatabase,
  openSafeDatabaseForTest,
  type DbOpenTestHooks
} from "../server/db/database.ts";

function canonicalTempRoot(prefix: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  mkdirSync(root, { mode: 0o700, recursive: true });
  return root;
}

function freshRoot(): { root: string; dbPath: string } {
  const root = canonicalTempRoot("qag-");
  return { root, dbPath: join(root, "state.sqlite") };
}

function expectQuiesceAbsent(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error(`expected QuiesceAbsenceError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(QuiesceAbsenceError);
    expect((error as QuiesceAbsenceError).code).toBe(code);
  }
}

describe("B2a quiesce absence guard for writable DB open", () => {
  test("no lease allows an open and guard.assertAbsent enforces continuity", () => {
    const { dbPath } = freshRoot();
    const guard = assertQuiesceLeaseAbsent(dbPath);
    expect(guard.leasePath).toBe(`${dbPath}.quiesce`);
    guard.assertAbsent();
    writeFileSync(`${dbPath}.quiesce`, "x", { mode: 0o600 });
    expectQuiesceAbsent(() => guard.assertAbsent(), "QUIESCE_LEASE_PRESENT");
  });

  test("any present lease entry is rejected regardless of content", () => {
    for (const kind of ["regular", "malformed", "expired", "directory", "symlink", "hardlink"] as const) {
      const { root, dbPath } = freshRoot();
      const lease = `${dbPath}.quiesce`;
      if (kind === "directory") mkdirSync(lease, { mode: 0o700 });
      else if (kind === "symlink") symlinkSync(dbPath, lease);
      else if (kind === "hardlink") {
        const source = join(root, "source");
        writeFileSync(source, "x", { mode: 0o600 });
        linkSync(source, lease);
      } else {
        writeFileSync(lease, kind === "expired" ? '{"expiresAt":"2020-01-01T00:00:00.000Z"}' : "not json", { mode: 0o600 });
      }
      expectQuiesceAbsent(() => assertQuiesceLeaseAbsent(dbPath), "QUIESCE_LEASE_PRESENT");
    }
  });

  test("openSafeDatabase rejects a lease present before open and creates no DB drift", () => {
    const { root, dbPath } = freshRoot();
    writeFileSync(`${dbPath}.quiesce`, "x", { mode: 0o600 });
    expect(() => openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root })).toThrow(/QUIESCE_LEASE_PRESENT/);
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
  });

  test("openSafeDatabaseForTest rejects a lease appearing in the pre/post window and closes the connection", () => {
    const { root, dbPath } = freshRoot();
    const hooks: DbOpenTestHooks = {
      betweenOpenAndPostGuard: (openedPath: string) => {
        writeFileSync(`${openedPath}.quiesce`, "x", { mode: 0o600 });
      }
    };
    expect(() => openSafeDatabaseForTest(dbPath, { appRoot: root, allowTestRoot: root }, hooks)).toThrow(/QUIESCE_LEASE_PRESENT/);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
  });

  test("openExistingSafeDatabase rejects lease pre-open and in the pre/post window", () => {
    const { root, dbPath } = freshRoot();
    const db = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
    db.close();
    const identity = inspectExistingPrivateDatabase(dbPath, basename(dbPath));
    writeFileSync(`${dbPath}.quiesce`, "x", { mode: 0o600 });
    expect(() => openExistingSafeDatabase(dbPath, basename(dbPath), identity, [0])).toThrow(/QUIESCE_LEASE_PRESENT/);

    const { root: root2, dbPath: dbPath2 } = freshRoot();
    const db2 = openSafeDatabase(dbPath2, { appRoot: root2, allowTestRoot: root2 });
    db2.close();
    const identity2 = inspectExistingPrivateDatabase(dbPath2, basename(dbPath2));
    const hooks: DbOpenTestHooks = {
      betweenOpenAndPostGuard: (openedPath: string) => writeFileSync(`${openedPath}.quiesce`, "x", { mode: 0o600 })
    };
    expect(() => openExistingSafeDatabaseForTest(dbPath2, basename(dbPath2), identity2, [0], hooks)).toThrow(/QUIESCE_LEASE_PRESENT/);
  });

test("production open entries expose no hook parameter; ForTest requires NODE_ENV=test", () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  expect(openSafeDatabase.length).toBe(2);
  expect(openExistingSafeDatabase.length).toBe(4);
  const saved = process.env.NODE_ENV;
  mutableEnv.NODE_ENV = "development";
    try {
      const { root, dbPath } = freshRoot();
      const hooks: DbOpenTestHooks = { betweenOpenAndPostGuard: () => undefined };
      expect(() => openSafeDatabaseForTest(dbPath, { appRoot: root, allowTestRoot: root }, hooks)).toThrow(/TEST_HOOKS_FORBIDDEN/);
      const db = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
      db.close();
      const identity = inspectExistingPrivateDatabase(dbPath, basename(dbPath));
      expect(() => openExistingSafeDatabaseForTest(dbPath, basename(dbPath), identity, [0], hooks)).toThrow(/TEST_HOOKS_FORBIDDEN/);
    } finally {
      if (saved === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = saved;
    }
  });

  test("non-canonical parent, ancestor symlink, and non-canonical db path are rejected", () => {
    const base = realpathSync(tmpdir());
    const root = mkdtempSync(join(base, "qag-nc-"));
    mkdirSync(root, { mode: 0o700, recursive: true });
    const realDir = join(root, "real");
    mkdirSync(realDir, { mode: 0o700 });
    const linkDir = join(root, "link");
    symlinkSync(realDir, linkDir);
    expectQuiesceAbsent(() => assertQuiesceLeaseAbsent(join(linkDir, "state.sqlite")), "QUIESCE_ABSENCE_PARENT_NOT_CANONICAL");
    const aliasRoot = join(tmpdir(), `qag-alias-${Date.now()}`);
    mkdirSync(aliasRoot, { mode: 0o700, recursive: true });
    expectQuiesceAbsent(() => assertQuiesceLeaseAbsent(join(aliasRoot, "state.sqlite")), "QUIESCE_ABSENCE_PARENT_NOT_CANONICAL");
    expectQuiesceAbsent(() => assertQuiesceLeaseAbsent("state.sqlite"), "QUIESCE_ABSENCE_PATH_NOT_ABSOLUTE");
    expectQuiesceAbsent(() => assertQuiesceLeaseAbsent(`${root}/sub/../state.sqlite`), "QUIESCE_ABSENCE_PATH_NOT_ABSOLUTE");
  });

  test("guard binds the lease to the exact db basename, not a fixed name", () => {
    const { root, dbPath } = freshRoot();
    writeFileSync(join(root, "live.sqlite.quiesce"), "x", { mode: 0o600 });
    const guard = assertQuiesceLeaseAbsent(dbPath);
    guard.assertAbsent();
    writeFileSync(`${dbPath}.quiesce`, "x", { mode: 0o600 });
    expectQuiesceAbsent(() => assertQuiesceLeaseAbsent(dbPath), "QUIESCE_LEASE_PRESENT");
  });

});
