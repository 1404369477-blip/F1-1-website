import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectRetentionSet, runSnapshotOnce, type SnapshotStage } from "../server/backup-snapshot/core.ts";
import { cacheFixture, clonePackages } from "./helpers/backup-cache-fixture.ts";

const roots: string[] = [];
const fixture = () => { const f = cacheFixture(); roots.push(f.root); return f; };
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });
const node = process.execPath;
const childScript = fileURLToPath(new URL("./helpers/backup-snapshot-interrupt-child.ts", import.meta.url));

function mutateObject(f: ReturnType<typeof fixture>, replace: boolean): void {
  const object = join(f.layout().objectsDir, readdirSync(f.layout().objectsDir)[0]);
  const bytes = readFileSync(object);
  if (replace) { renameSync(object, object + ".saved"); writeFileSync(object, bytes, { mode: 0o600 }); }
  else { bytes[bytes.length - 1] ^= 1; writeFileSync(object, bytes); }
}

function interruptedInput(f: ReturnType<typeof fixture>): string {
  const path = join(f.root, "child-input.json");
  writeFileSync(path, JSON.stringify({ ...f.input, key: undefined, keyHex: f.input.key.toString("hex") }), { mode: 0o600 });
  return path;
}

async function reachedStage(child: ReturnType<typeof spawn>, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(Error("STAGE_NOT_REACHED: " + stderr.slice(-600))); }, 5000);
    child.stderr!.on("data", chunk => {
      stderr += chunk.toString();
      if (stderr.split("\n").some(line => { try { return JSON.parse(line).stage === expected; } catch { return false; } })) { clearTimeout(timer); resolve(); }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); if (!stderr.includes(`"stage":"${expected}"`)) reject(Error(`CHILD_EXIT_${code}: ${stderr.slice(-600)}`)); });
  });
}

describe("run-scoped authenticated object reuse", () => {
  it("authenticates a 25-package/10-object set exactly once per unique ciphertext while retaining 24 packages", () => {
    const f = fixture();
    for (let n = 0; n < 10; n++) { f.change(String(n)); f.take(); }
    clonePackages(f, 25);
    const objectsBefore = readdirSync(f.layout().objectsDir), calls = vi.spyOn(crypto, "createDecipheriv");
    syncBuiltinESMExports();
    const result = f.take({ now: () => new Date("2026-09-11T00:00:00.000Z") });
    expect(calls).toHaveBeenCalledTimes(10);
    expect(result.verification?.objectsAuthenticated).toBe(10);
    expect(result.verification?.cacheHits).toBe(42);
    expect(readdirSync(f.layout().packagesDir)).toHaveLength(24);
    expect(readdirSync(f.layout().objectsDir)).toEqual(objectsBefore);
    calls.mockRestore(); syncBuiltinESMExports();
    expect(collectRetentionSet(f.input.outputDir, f.input.key)).toHaveLength(24);
  });

  it("does not carry authentication results into the next invocation", () => {
    const f = fixture(); f.take(); f.take(); mutateObject(f, false);
    const packages = readdirSync(f.layout().packagesDir), latest = readFileSync(f.layout().latestPath);
    expect(() => f.take()).toThrow("DECRYPT_FAILED");
    expect(readdirSync(f.layout().packagesDir)).toEqual(packages);
    expect(readFileSync(f.layout().latestPath)).toEqual(latest);
    expect(existsSync(f.layout().lockPath)).toBe(false);
  });

  it("parses and binds every shared-object package manifest before creating another package", () => {
    const f = fixture(); f.take(); f.take(); f.take();
    const path = join(f.layout().packagesDir, readdirSync(f.layout().packagesDir)[2], "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")); manifest.members[0].bytes += 1;
    writeFileSync(path, JSON.stringify(manifest));
    expect(() => f.take()).toThrow();
    expect(readdirSync(f.layout().packagesDir)).toHaveLength(3);
    expect(readdirSync(f.layout().objectsDir)).toHaveLength(1);
    expect(existsSync(f.layout().lockPath)).toBe(false);
  });

  it.each([false, true])("rejects an authenticated object's later mutation or replacement (replace=%s)", replace => {
    const f = fixture(); f.take();
    expect(() => f.take({ testOnlyAfterDatabaseSnapshot: () => mutateObject(f, replace) })).toThrow("OBJECT_IDENTITY_CHANGED");
    expect(readdirSync(f.layout().packagesDir)).toHaveLength(1);
    expect(existsSync(f.layout().lockPath)).toBe(false);
  });

  it("rejects a same-byte manifest replacement between preflight and rotation", () => {
    const f = fixture(); const first = f.take();
    const path = join(f.layout().packagesDir, first.packageId!, "manifest.json");
    expect(() => f.take({ testOnlyAfterDatabaseSnapshot: () => { const bytes = readFileSync(path); renameSync(path, path + ".saved"); writeFileSync(path, bytes, { mode: 0o600 }); } })).toThrow("MANIFEST_IDENTITY_CHANGED");
    expect(readdirSync(f.layout().packagesDir)).toHaveLength(2);
    expect(existsSync(f.layout().lockPath)).toBe(false);
  });
});

describe("lock identity and interruption boundaries", () => {
  it("normal exception cleanup releases only its own lock", () => {
    const f = fixture();
    expect(() => f.take({ testOnlyAfterObjectWrite: () => { throw Error("TEST_FAILURE"); } })).toThrow("TEST_FAILURE");
    expect(existsSync(f.layout().lockPath)).toBe(false);
    expect(readdirSync(f.layout().objectsDir)).toEqual([]);
  });

  it("does not release a same-PID, same-content replacement lock on failure", () => {
    const f = fixture(); let replacementInode = 0;
    expect(() => f.take({ onStage: event => {
      if (event.stage !== "CAPTURE_DATABASE" || event.failure) return;
      const lock = f.layout().lockPath, bytes = readFileSync(lock);
      renameSync(lock, lock + ".original"); writeFileSync(lock, bytes, { mode: 0o600 }); replacementInode = lstatSync(lock).ino;
      throw Error("TEST_REPLACED_LOCK");
    } })).toThrow("LOCK_IDENTITY_CHANGED");
    expect(lstatSync(f.layout().lockPath).ino).toBe(replacementInode);
    expect(() => f.take()).toThrow("LOCK_HELD");
  });

  it("allows ctime-only metadata changes while rechecking the held inode and complete lock body", () => {
    const f = fixture();
    const result = f.take({ onStage: event => { if (event.stage === "CAPTURE_DATABASE" && !event.failure) chmodSync(f.layout().lockPath,0o600); } });
    expect(result.ok).toBe(true); expect(existsSync(f.layout().lockPath)).toBe(false);
  });

  it("rejects same-inode lock body modification even if mtime is reset", () => {
    const f = fixture();
    expect(() => f.take({ onStage: event => {
      if (event.stage !== "CAPTURE_DATABASE" || event.failure) return;
      const lock=f.layout().lockPath, prior=lstatSync(lock), body=JSON.parse(readFileSync(lock,"utf8"));
      body.startedAt="2020-01-01T00:00:00.000Z"; writeFileSync(lock,JSON.stringify(body)+"\n"); utimesSync(lock,prior.atime,prior.mtime);
    } })).toThrow("LOCK_IDENTITY_CHANGED");
    expect(existsSync(f.layout().lockPath)).toBe(true);
  });

  it("fails closed if the held descriptor's pathname is detached during the run", () => {
    const f = fixture();
    expect(() => f.take({ onStage: event => { if(event.stage==="CAPTURE_DATABASE" && !event.failure)unlinkSync(f.layout().lockPath); } })).toThrow("LOCK_IDENTITY_CHANGED");
    expect(existsSync(f.layout().lockPath)).toBe(false);
  });

  it.each(["PUBLISH_PACKAGE", "ROTATE_RETENTION"] as SnapshotStage[])("SIGKILL at %s leaves a fail-closed lock and preserves the publication boundary", async stage => {
    const f = fixture();
    const child = spawn(node, ["--experimental-transform-types", childScript, interruptedInput(f), stage], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await reachedStage(child, stage);
      const before = readFileSync(f.layout().lockPath); const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      expect(existsSync(f.layout().latestPath)).toBe(stage === "ROTATE_RETENTION");
      expect(() => runSnapshotOnce(f.input)).toThrow("STALE_LOCK");
      expect(readFileSync(f.layout().lockPath)).toEqual(before);
    } finally { child.kill("SIGKILL"); }
  });

  it("does not remove another live process lock", async () => {
    const f = fixture(), child = spawn(node, ["--experimental-transform-types", childScript, interruptedInput(f), "VERIFY_RETAINED"], { stdio: ["ignore", "pipe", "pipe"] });
    try { await reachedStage(child, "VERIFY_RETAINED"); const lock = readFileSync(f.layout().lockPath); expect(() => f.take()).toThrow("LOCK_HELD"); expect(readFileSync(f.layout().lockPath)).toEqual(lock); }
    finally { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
  });
});

