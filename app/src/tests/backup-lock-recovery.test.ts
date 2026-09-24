import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runBackupLockRecoveryCli } from "../../scripts/backup-lock-recover.ts";
import { inspectBackupLock, recoverBackupLock } from "../server/backup-snapshot/lock-recovery.ts";

const roots: string[] = [];
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(pid?: number) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "f1-lock-recovery-"));
  roots.push(root);
  const lockPid = pid ?? Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  const raw = `${JSON.stringify({ pid: lockPid, startedAt: "2026-08-30T00:00:00.000Z" })}\n`;
  writeFileSync(join(root, "run.lock"), raw, { mode: 0o600 });
  mkdirSync(join(root, "staging"), { mode: 0o700 });
  writeFileSync(join(root, "staging", "retained"), "do not touch", { mode: 0o600 });
  const proof = `${JSON.stringify({ schemaVersion: "backup-lock-stop-evidence-v1", backupRootSha256: sha(root),
    lockSha256: sha(raw), pid: lockPid, schedulerStopped: true, manualWritersStopped: true,
    observedAt: new Date().toISOString(), evidenceRef: "isolated-test-scheduler-never-started" })}\n`;
  const stopEvidencePath = join(root, "stop-proof.json");
  writeFileSync(stopEvidencePath, proof, { mode: 0o600 });
  return { root, raw, input: { backupRoot: root, expectedLockSha256: sha(raw), expectedPid: lockPid,
    stopEvidencePath, expectedStopEvidenceSha256: sha(proof) } };
}

function argv(input: ReturnType<typeof fixture>["input"]): string[] {
  return ["--backup-root", input.backupRoot, "--recover", "--expected-lock-sha256", input.expectedLockSha256,
    "--expected-pid", String(input.expectedPid), "--stop-evidence", input.stopEvidencePath,
    "--expected-stop-evidence-sha256", input.expectedStopEvidenceSha256];
}

describe("controlled backup stale-lock recovery", () => {
  it("defaults to a read-only inspection and refuses live PIDs", () => {
    const { root, raw, input } = fixture(process.pid);
    const filesBefore = readdirSync(root).sort();
    expect(runBackupLockRecoveryCli(["--backup-root", root])).toMatchObject({ ok: true, mode: "inspect", status: "live", pid: process.pid });
    expect(readdirSync(root).sort()).toEqual(filesBefore);
    expect(() => recoverBackupLock(input)).toThrow("LOCK_HELD");
    expect(readFileSync(join(root, "run.lock"), "utf8")).toBe(raw);
  });

  it("quarantines a dead PID with exact identity and external stop proof, preserving staging", () => {
    const { root, raw, input } = fixture();
    expect(inspectBackupLock(root).status).toBe("dead");
    const receipt = recoverBackupLock(input);
    expect(receipt.status).toBe("quarantined");
    expect(existsSync(join(root, "run.lock"))).toBe(false);
    expect(readFileSync(join(root, receipt.incidentDirectory, "run.lock"), "utf8")).toBe(raw);
    expect(readFileSync(join(root, receipt.incidentDirectory, "stop-evidence.json"))).toEqual(readFileSync(input.stopEvidencePath));
    expect(readFileSync(join(root, "staging", "retained"), "utf8")).toBe("do not touch");
    const filesBefore = readdirSync(root).sort();
    expect(runBackupLockRecoveryCli(argv(input))).toMatchObject({ ok: false });
    expect(readdirSync(root).sort()).toEqual(filesBefore);
    expect(inspectBackupLock(root).status).toBe("absent");
  });

  it("rejects mismatched hashes/PIDs, absent or stale stop proof, and invalid locks", () => {
    const { root, raw, input } = fixture();
    expect(() => recoverBackupLock({ ...input, expectedLockSha256: "f".repeat(64) })).toThrow("LOCK_IDENTITY_MISMATCH");
    expect(() => recoverBackupLock({ ...input, expectedPid: input.expectedPid + 1 })).toThrow("LOCK_IDENTITY_MISMATCH");
    expect(() => recoverBackupLock({ ...input, expectedStopEvidenceSha256: "f".repeat(64) })).toThrow("STOP_EVIDENCE_HASH_MISMATCH");
    expect(runBackupLockRecoveryCli(["--backup-root", root, "--recover"])).toMatchObject({ ok: false, reasonCode: "RECOVERY_ARGUMENT_REQUIRED" });
    const oldProof = JSON.parse(readFileSync(input.stopEvidencePath, "utf8"));
    oldProof.observedAt = "2026-01-01T00:00:00.000Z";
    const oldRaw = JSON.stringify(oldProof);
    writeFileSync(input.stopEvidencePath, oldRaw);
    expect(() => recoverBackupLock({ ...input, expectedStopEvidenceSha256: sha(oldRaw) })).toThrow("STOP_EVIDENCE_EXPIRED");
    expect(readFileSync(join(root, "run.lock"), "utf8")).toBe(raw);
    writeFileSync(join(root, "run.lock"), "{invalid}");
    expect(() => inspectBackupLock(root)).toThrow("LOCK_INVALID");
  });

  it("refuses symlinks and EPERM rather than treating an unverifiable PID as dead", () => {
    const { root, input } = fixture();
    vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
    expect(() => recoverBackupLock(input)).toThrow("PID_STATE_UNVERIFIED");
    vi.restoreAllMocks();
    unlinkSync(join(root, "run.lock"));
    symlinkSync(input.stopEvidencePath, join(root, "run.lock"));
    expect(() => recoverBackupLock(input)).toThrow("LOCK_FILE_INVALID");
    expect(existsSync(input.stopEvidencePath)).toBe(true);
  });

  it("refuses a lock replacement during verification and never auto-clears another recovery guard", () => {
    const { root, input } = fixture();
    let probes = 0;
    vi.spyOn(process, "kill").mockImplementation(() => {
      probes += 1;
      if (probes === 2) writeFileSync(join(root, "run.lock"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    });
    expect(() => recoverBackupLock(input)).toThrow("LOCK_CHANGED");
    expect(JSON.parse(readFileSync(join(root, "run.lock"), "utf8")).pid).toBe(process.pid);
    vi.restoreAllMocks();
    mkdirSync(join(root, ".lock-recovery.guard"), { mode: 0o700 });
    expect(() => recoverBackupLock(input)).toThrow("RECOVERY_BUSY");
    expect(existsSync(join(root, ".lock-recovery.guard"))).toBe(true);
  });

  it("serializes two concurrent CLI recoveries without losing or overwriting evidence", async () => {
    const { root, raw, input } = fixture();
    const run = (): Promise<Record<string, unknown>> => new Promise((resolveRun, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/backup-lock-recover.ts", ...argv(input)], { cwd: process.cwd() });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.on("error", reject);
      child.on("close", () => { try { resolveRun(JSON.parse(stdout)); } catch (error) { reject(error); } });
    });
    const reports = await Promise.all([run(), run()]);
    expect(reports.filter((report) => report.ok)).toHaveLength(1);
    const incidents = readdirSync(root).filter((name) => name.startsWith("lock-incident-"));
    expect(incidents).toHaveLength(1);
    expect(readFileSync(join(root, incidents[0]!, "run.lock"), "utf8")).toBe(raw);
    expect(readFileSync(join(root, "staging", "retained"), "utf8")).toBe("do not touch");
  });
});
