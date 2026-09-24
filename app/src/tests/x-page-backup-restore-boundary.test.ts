import { afterEach, expect, test, vi } from "vitest";
import { constants, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { prepareXPageArtifactBackup, restoreXPageArtifactBackup } from "../server/x-page/backup-artifacts.ts";
import { xPageBackupFixture } from "./helpers/x-page-backup.ts";
import { runSnapshotOnce, runRestoreDrill } from "../server/backup-snapshot/core.ts";

const hook = vi.hoisted(() => ({ beforeOpen: null as null | ((path: unknown, flags: unknown) => void),
  afterOpen: null as null | ((path: unknown, flags: unknown) => void) }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, openSync: (...args: Parameters<typeof actual.openSync>) => {
    hook.beforeOpen?.(args[0], args[1]); const fd = actual.openSync(...args); hook.afterOpen?.(args[0], args[1]); return fd;
  } };
});
afterEach(() => { hook.beforeOpen = null; hook.afterOpen = null; });

test.each(["child-before-open", "root-before-open", "parent-before-open", "child-after-open"] as const)(
  "rejects %s without writing artifact bytes to a substituted directory", async scenario => {
    const e = await xPageBackupFixture();
    try {
      const capture = e.captures({ text: "Synthetic authenticated artifact boundary body. ".repeat(60) });
      e.admit("x_f1", capture.capture); e.live(); e.importCapture(capture.capture);
      const snapshot = await e.snapshot(), saved = prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() });
      const parent = join(e.root, "restore-parent"), destinationRoot = join(parent, "files"), foreign = join(e.root, "foreign");
      mkdirSync(parent, { mode: 0o700 }); mkdirSync(foreign, { mode: 0o700 });
      let injected = false, foreignPath = "", movedPath = "";
      const replace = (path: unknown, flags: unknown) => {
        if (injected || typeof path !== "string" || !path.startsWith(destinationRoot + "/") || typeof flags !== "number" || !(flags & constants.O_CREAT)) return;
        injected = true;
        const folderName = basename(dirname(path));
        const replaced = scenario.startsWith("parent") ? parent : scenario.startsWith("root") ? destinationRoot : dirname(path);
        const foreignFolder = scenario.startsWith("parent") ? join(foreign, "files", folderName)
          : scenario.startsWith("root") ? join(foreign, folderName) : foreign;
        mkdirSync(foreignFolder, { mode: 0o700, recursive: true });
        const moved = join(e.root, "owned-moved"); renameSync(replaced, moved); symlinkSync(foreign, replaced);
        foreignPath = join(foreignFolder, basename(path));
        movedPath = join(moved, basename(path));
      };
      if (scenario.endsWith("after-open")) hook.afterOpen = replace; else hook.beforeOpen = replace;
      expect(() => restoreXPageArtifactBackup({ snapshot, manifestJson: saved.manifestJson, expectedManifestSha256: saved.manifestSha256,
        members: saved.members, destinationRoot, now: e.now() })).toThrow();
      hook.beforeOpen = null; hook.afterOpen = null;
      expect(injected).toBe(true);
      expect(existsSync(foreignPath) ? readFileSync(foreignPath).length : 0).toBe(0);
      if (scenario === "child-after-open") expect(readFileSync(movedPath).length).toBe(0);
    } finally { hook.beforeOpen = null; hook.afterOpen = null; e.close(); }
  });

test.each(["db/snapshot.sqlite", "x-page-artifacts/manifest.json"])("outer restore rejects a directory replacement before opening %s", async memberPath => {
  const e = await xPageBackupFixture();
  try {
    const capture = e.captures(); e.admit("x_f1", capture.capture); e.live(); e.importCapture(capture.capture);
    const source = await e.snapshot(), projectionRoot = join(e.root, "synthetic-projection"), outputDir = join(e.root, "encrypted");
    mkdirSync(join(projectionRoot, "generations"), { mode: 0o700, recursive: true });
    const hash = "1".repeat(64);
    // The generic archive API isolates file-write boundaries here; no signed
    // application-public or REGISTER proof is claimed by this pointer double.
    writeFileSync(join(projectionRoot, "active.json"), JSON.stringify({ snapshotManifestHash: hash }), { mode: 0o600 });
    writeFileSync(join(projectionRoot, "generations", hash + ".json"), "{}", { mode: 0o600 });
    const key = randomBytes(32); runSnapshotOnce({ sourceDbPath: source.path, projectionRoot, outputDir, key, retain: 1, xPageRuntimeTrust: e.runtimeTrust, now: e.now });
    const restoreRoot = join(e.root, "outer-restored"), target = join(restoreRoot, memberPath), foreign = join(e.root, "foreign-outer");
    mkdirSync(foreign, { mode: 0o700 }); let injected = false;
    hook.beforeOpen = (path, flags) => {
      if (!injected && path === target && typeof flags === "number" && flags & constants.O_CREAT) {
        injected = true; renameSync(dirname(target), join(e.root, "moved-outer")); symlinkSync(foreign, dirname(target));
      }
    };
    expect(() => runRestoreDrill({ backupRoot: outputDir, restoreRoot, key })).toThrow();
    hook.beforeOpen = null; expect(injected).toBe(true);
    const foreignFile = join(foreign, basename(target)); expect(existsSync(foreignFile) ? readFileSync(foreignFile).length : 0).toBe(0);
  } finally { hook.beforeOpen = null; e.close(); }
});
