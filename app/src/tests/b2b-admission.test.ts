import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import {
  inspectExistingPrivateDatabase,
  openExistingSafeDatabase,
  openExistingSafeDatabaseForTest,
  openSafeDatabase,
  withGuardedWriteTransaction,
  withGuardedWriteTransactionForTest,
  withImmediateTransaction,
  type DbOpenTestHooks,
  type GuardedWriteTestHooks
} from "../server/db/database.ts";

function freshRoot(): { root: string; dbPath: string } {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "b2b-"));
  mkdirSync(root, { mode: 0o700, recursive: true });
  return { root, dbPath: join(root, "state.sqlite") };
}

function openGuarded(dbPath: string, root: string): DatabaseSync {
  const seed = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
  seed.close();
  const identity = inspectExistingPrivateDatabase(dbPath, basename(dbPath));
  return openExistingSafeDatabase(dbPath, basename(dbPath), identity, [0]);
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(name) !== undefined;
}

describe("B2b transaction admission primitive", () => {
  test("guarded existing connection commits when no lease is present", () => {
    const { root, dbPath } = freshRoot();
    const db = openGuarded(dbPath, root);
    try {
      let committed = false;
      withGuardedWriteTransaction(db, () => {
        db.exec("CREATE TABLE admitted(x INTEGER); INSERT INTO admitted VALUES (1);");
        committed = true;
      });
      expect(committed).toBe(true);
      expect(tableExists(db, "admitted")).toBe(true);
      expect(Number((db.prepare("SELECT count(*) AS c FROM admitted").get() as Record<string, unknown>).c)).toBe(1);
    } finally {
      db.close();
    }
  });

  test("lease present before BEGIN rejects, callback not run, no commit", () => {
    const { root, dbPath } = freshRoot();
    const db = openGuarded(dbPath, root);
    try {
      writeFileSync(`${dbPath}.quiesce`, "x", { mode: 0o600 });
      let called = 0;
      expect(() => withGuardedWriteTransaction(db, () => { called += 1; db.exec("CREATE TABLE noop(x)"); })).toThrow(/QUIESCE_LEASE_PRESENT/);
      expect(called).toBe(0);
      expect(tableExists(db, "noop")).toBe(false);
    } finally {
      db.close();
    }
  });

  test("lease appears after BEGIN but before the callback rolls back and callback not run", () => {
    const { root, dbPath } = freshRoot();
    const db = openGuarded(dbPath, root);
    try {
      let called = 0;
      const hooks: GuardedWriteTestHooks = {
        betweenBeginAndCallback: (leasePath: string) => {
          writeFileSync(leasePath, "x", { mode: 0o600 });
        }
      };
      expect(() => withGuardedWriteTransactionForTest(db, () => { called += 1; db.exec("CREATE TABLE late(x)"); }, hooks)).toThrow(/QUIESCE_LEASE_PRESENT/);
      expect(called).toBe(0);
      expect(tableExists(db, "late")).toBe(false);
    } finally {
      db.close();
    }
  });

  test("unknown lstat failure (non-ENOENT) fails closed and rolls back", () => {
    const { root, dbPath } = freshRoot();
    const db = openGuarded(dbPath, root);
    const parent = dirname(dbPath);
    try {
      let called = 0;
      const hooks: GuardedWriteTestHooks = {
        betweenBeginAndCallback: () => {
          chmodSync(parent, 0o600);
        }
      };
      expect(() => withGuardedWriteTransactionForTest(db, () => { called += 1; db.exec("CREATE TABLE unknown(x)"); }, hooks)).toThrow(/QUIESCE_LEASE_PRESENT/);
      expect(called).toBe(0);
      expect(tableExists(db, "unknown")).toBe(false);
    } finally {
      chmodSync(parent, 0o700);
      db.close();
    }
  });

  test("openSafe and in-memory connections have no admission; original helper still works", () => {
    const { root, dbPath } = freshRoot();
    const db = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
    try {
      expect(() => withGuardedWriteTransaction(db, () => {})).toThrow(/QUIESCE_WRITER_ADMISSION_UNAVAILABLE/);
      withImmediateTransaction(db, () => {
        db.exec("CREATE TABLE plain(x INTEGER); INSERT INTO plain VALUES (1);");
      });
      expect(Number((db.prepare("SELECT count(*) AS c FROM plain").get() as Record<string, unknown>).c)).toBe(1);
    } finally {
      db.close();
    }

    const mem = new DatabaseSync(":memory:");
    try {
      expect(() => withGuardedWriteTransaction(mem, () => {})).toThrow(/QUIESCE_WRITER_ADMISSION_UNAVAILABLE/);
      withImmediateTransaction(mem, () => {
        mem.exec("CREATE TABLE mem(x INTEGER); INSERT INTO mem VALUES (7);");
      });
      expect(Number((mem.prepare("SELECT count(*) AS c FROM mem").get() as Record<string, unknown>).c)).toBe(1);
    } finally {
      mem.close();
    }
  });

  test("closing a guarded connection does not require a manual detach", () => {
    const { root, dbPath } = freshRoot();
    const db = openGuarded(dbPath, root);
    withGuardedWriteTransaction(db, () => {
      db.exec("CREATE TABLE done(x INTEGER);");
    });
    db.close();

    const fresh = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
    try {
      expect(() => withGuardedWriteTransaction(fresh, () => {})).toThrow(/QUIESCE_WRITER_ADMISSION_UNAVAILABLE/);
    } finally {
      fresh.close();
    }
  });

  test("lease appearing after post-open checks but before final admission fails open and returns no connection", () => {
    const { root, dbPath } = freshRoot();
    const seed = openSafeDatabase(dbPath, { appRoot: root, allowTestRoot: root });
    seed.close();
    const identity = inspectExistingPrivateDatabase(dbPath, basename(dbPath));
    const hooks: DbOpenTestHooks = {
      beforeFinalAdmission: (openedPath: string) => {
        writeFileSync(`${openedPath}.quiesce`, "x", { mode: 0o600 });
      }
    };
    expect(() => openExistingSafeDatabaseForTest(dbPath, basename(dbPath), identity, [0], hooks)).toThrow(/QUIESCE_LEASE_PRESENT/);
    expect(existsSync(`${dbPath}.quiesce`)).toBe(true);
  });
});
