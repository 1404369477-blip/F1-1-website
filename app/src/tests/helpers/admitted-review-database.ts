import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename as pathBasename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  inspectExistingPrivateDatabase,
  openExistingSafeDatabase,
  openSafeDatabase
} from "../../server/db/database.ts";

export type AdmittedReviewDatabaseOptions = Readonly<{
  finalVersion: number;
  seed: (database: DatabaseSync) => void;
  basename?: string;
}>;

export type AdmittedReviewFixture = Readonly<{
  database: DatabaseSync;
  path: string;
  root: string;
  /** Idempotently close and unregister the admitted connection while keeping
   * the managed temp root registered until disposeAdmittedReviewDatabases. */
  close(): void;
}>;

const registeredDatabases = new Set<DatabaseSync>();
const registeredRoots = new Set<string>();

function validateBasename(basename: string): void {
  if (basename !== pathBasename(basename) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.sqlite$/.test(basename)) {
    throw new Error("ADMITTED_REVIEW_BASENAME_INVALID");
  }
}

export function openAdmittedReviewFixture(options: AdmittedReviewDatabaseOptions): AdmittedReviewFixture {
  const basename = options.basename ?? "state.sqlite";
  validateBasename(basename);
  const root = mkdtempSync(join(realpathSync(tmpdir()), "admitted-review-"));
  const path = join(root, basename);
  let seedDatabase: DatabaseSync | undefined;
  try {
    seedDatabase = openSafeDatabase(path, { appRoot: root, allowTestRoot: root });
    options.seed(seedDatabase);
  } catch (error) {
    try {
      seedDatabase?.close();
    } catch {
      // preserve the seed failure
    }
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // root cleanup is best effort on the failure path
    }
    throw error;
  }
  try {
    seedDatabase.close();
  } catch {
    // the seed failure path above already closed it; otherwise close once
  }
  let database: DatabaseSync | undefined;
  try {
    const identity = inspectExistingPrivateDatabase(path, basename);
    database = openExistingSafeDatabase(path, basename, identity, [options.finalVersion]);
  } catch (error) {
    try {
      database?.close();
    } catch {
      // the failed opener already closed its in-progress connection
    }
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // root/database/sidecar cleanup is best effort on the failure path
    }
    throw error;
  }
  registeredDatabases.add(database);
  registeredRoots.add(root);
  return Object.freeze({
    database,
    path,
    root,
    close(): void {
      if (!registeredDatabases.has(database)) return;
      try {
        database.close();
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown };
        const alreadyClosed = candidate?.code === "ERR_INVALID_STATE" && candidate?.message === "database is not open";
        if (!alreadyClosed) throw error;
      }
      registeredDatabases.delete(database);
    }
  });
}

export function openAdmittedReviewDatabase(options: AdmittedReviewDatabaseOptions): DatabaseSync {
  return openAdmittedReviewFixture(options).database;
}

export function disposeAdmittedReviewDatabases(): void {
  const errors: unknown[] = [];
  for (const database of registeredDatabases) {
    try {
      database.close();
    } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown };
      const alreadyClosed = candidate?.code === "ERR_INVALID_STATE" && candidate?.message === "database is not open";
      if (!alreadyClosed) errors.push(error);
    }
  }
  registeredDatabases.clear();
  for (const root of registeredRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  registeredRoots.clear();
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new Error(`ADMITTED_REVIEW_DISPOSE_ERRORS: ${errors.map((error) => error instanceof Error ? error.message : String(error)).join(", ")}`);
  }
}
