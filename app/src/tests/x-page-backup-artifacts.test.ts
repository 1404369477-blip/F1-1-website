import { afterEach, describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { canonicalJson } from "../server/db/profile.ts";
import { prepareXPageArtifactBackup, restoreXPageArtifactBackup, type XPageArtifactBackup } from "../server/x-page/backup-artifacts.ts";
import * as privateArtifact from "../server/x-page/private-artifact-file.ts";
import { verifyTrustedXCapture, verifyXCaptureArtifacts, xCaptureSha256 } from "../server/x-page/trusted-capture.ts";
import { createXPageFileEvidencePort } from "../server/x-page/capture-artifacts.ts";
import { readTrustedXPageInput } from "../server/x-page/trusted-importer.ts";
import { issueXPageAutomaticFences } from "../server/x-page/content-authority.ts";
import { xPageBackupFixture, backupCandidateRuntime, backupProjectionReceiver, backupProjectionSender } from "./helpers/x-page-backup.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
async function fixture() { const e = await xPageBackupFixture(); cleanups.push(e.close); return e; }
async function ready() {
  const e = await fixture(), capture = e.captures({ text: "Complete synthetic F1 body. ".repeat(100) });
  e.admit("x_f1", capture.capture); e.live(); const imported = e.importCapture(capture.capture);
  const target = { candidateId: imported.candidateId, sourceRevision: imported.sourceRevision, inputContentHash: imported.sourceVersionHash };
  return { ...e, captured: capture, imported, target };
}
type Ready = Awaited<ReturnType<typeof ready>>;
async function packed(e: Ready) {
  const snapshot = await e.snapshot(), value = prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() });
  return { snapshot, value };
}
function restore(e: Ready, saved: Awaited<ReturnType<typeof packed>>, value: XPageArtifactBackup = saved.value, destinationRoot = join(e.root, "restored-artifacts")) {
  return restoreXPageArtifactBackup({ snapshot: saved.snapshot, manifestJson: value.manifestJson,
    expectedManifestSha256: value.manifestSha256, members: value.members, destinationRoot, now: e.now() });
}
function memberPath(e: Ready, folder: string): string {
  const hash = folder === "captures" || folder === "verifier-receipts" ? e.captured.captureSha256 : folder === "raw-tool-output" ? e.captured.rawToolOutputSha256
    : folder === "tool-receipts" ? e.captured.toolReceiptSha256 : e.captured.captureArtifactSha256;
  return join(e.files.artifactPath, folder, hash + ".json");
}
const folders = ["captures", "tool-receipts", "artifacts", "raw-tool-output", "verifier-receipts"];

describe("X artifact closure for the authenticated encrypted outer backup", () => {
  test("collects admission, duplicate receipts and all historical candidate revisions from one mixed RSS/X snapshot", async () => {
    const e = await ready();
    const duplicate = e.captures({ text: e.captured.capture.post.text });
    expect(e.importCapture(duplicate.capture, { sourceRevision: 1, sourceVersionHash: e.target.inputContentHash }).decision).toBe("duplicate");
    e.advanceNow(1000);
    const edited = e.captures({ text: e.captured.capture.post.text + " Historical revision remains available.", observedAt: e.now().toISOString() });
    const updated = e.importCapture(edited.capture, { sourceRevision: 1, sourceVersionHash: e.target.inputContentHash }); expect(updated.sourceRevision).toBe(2);
    // Deliberate unreferenced garbage, symlink and private key. None is selected.
    const garbage = join(e.files.artifactPath, "raw-tool-output", "e".repeat(64) + ".json");
    symlinkSync(e.files.config.producerPublicKey.path, garbage);
    writeFileSync(join(e.files.artifactPath, "producer-private.pem"), e.files.producer.keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    const saved = await packed(e), manifest = JSON.parse(saved.value.manifestJson);
    expect(e.database.prepare("SELECT count(*) n FROM pending_review_candidate WHERE source_id='motorsport-f1-news'").get()!.n).toBe(1);
    expect(manifest.references.map((item: { kind: string }) => item.kind)).toEqual(["admission", "capture", "capture", "receipt", "receipt", "receipt"]);
    expect(manifest.captures.map((item: { captureSha256: string }) => item.captureSha256).sort()).toEqual([e.captured.captureSha256, duplicate.captureSha256, edited.captureSha256].sort());
    expect(manifest.members).toHaveLength(15);
    expect(manifest.totalBytes).toBe(saved.value.members.reduce((sum, member) => sum + Buffer.byteLength(member.contentUtf8), 0));
    expect(manifest.encryptionBoundary).toBe("authenticated-encrypted-outer-backup-required");
    expect(saved.value.manifestJson).not.toContain("PRIVATE KEY"); expect(saved.value.members.some(member => member.contentUtf8.includes("PRIVATE KEY"))).toBe(false);
    expect(saved.value.members.some(member => member.relativePath.endsWith("e".repeat(64) + ".json"))).toBe(false);
    for (const member of saved.value.members) expect(xCaptureSha256(Buffer.from(member.contentUtf8))).toBe(manifest.members.find((item: { relativePath: string }) => item.relativePath === member.relativePath).sha256);
    expect(xCaptureSha256(readFileSync(saved.snapshot.path))).toBe(saved.snapshot.expectedSha256);
  });

  test("accepts an exact 0017 snapshot with no X references without enumerating the artifact directory", async () => {
    const e = await fixture(), snapshot = await e.snapshot();
    const result = prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() });
    expect(JSON.parse(result.manifestJson)).toMatchObject({ references: [], captures: [], members: [], totalBytes: 0 });
  });

  test.each(folders)("missing referenced %s fails the entire backup", async folder => {
    const e = await ready(), snapshot = await e.snapshot(); unlinkSync(memberPath(e, folder));
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow(/MISSING/);
  });
  test.each(folders)("corrupt referenced %s fails the entire backup", async folder => {
    const e = await ready(), snapshot = await e.snapshot(); writeFileSync(memberPath(e, folder), "{}");
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow();
  });
  test.each(["symlink", "hardlink", "permissions", "bom"])("rejects %s at a selected raw-file boundary", async kind => {
    const e = await ready(), snapshot = await e.snapshot(), path = memberPath(e, "raw-tool-output"), original = readFileSync(path);
    if (kind === "permissions") chmodSync(path, 0o644);
    else if (kind === "bom") writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]));
    else { const other = join(e.root, "raw-copy.json"); writeFileSync(other, original, { mode: 0o600 }); unlinkSync(path);
      if (kind === "symlink") symlinkSync(other, path); else linkSync(other, path); }
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow(/UNSAFE|ENCODING_CHANGED/);
  });
  test("rejects a selected parent symlink without traversing it", async () => {
    const e = await ready(), snapshot = await e.snapshot(), path = join(e.files.artifactPath, "raw-tool-output"), moved = join(e.root, "raw-directory");
    renameSync(path, moved); symlinkSync(moved, path);
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow("PRIVATE_FILE_UNSAFE");
  });

  test("detects replacing bytes after successful signature validation and uses no later reread for output", async () => {
    const e = await ready(), snapshot = await e.snapshot(), path = memberPath(e, "raw-tool-output");
    const original = privateArtifact.readXCapturePrivateFile; let reads = 0;
    vi.spyOn(privateArtifact, "readXCapturePrivateFile").mockImplementation((file, limit) => {
      const value = original(file, limit);
      if (file === path && ++reads === 2) { const replacement = join(e.root, "replacement.json"); writeFileSync(replacement, readFileSync(path), { mode: 0o600 }); renameSync(replacement, path); }
      return value;
    });
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow("X_BACKUP_ARTIFACT_CHANGED");
    expect(reads).toBeGreaterThanOrEqual(3);
  });
  test("requires a closed snapshot with the exact pinned bytes and no sidecars", async () => {
    const e = await ready(), snapshot = await e.snapshot();
    expect(() => prepareXPageArtifactBackup({ snapshot: { ...snapshot, expectedSha256: "0".repeat(64) }, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow("X_BACKUP_SNAPSHOT_HASH_MISMATCH");
    writeFileSync(snapshot.path + "-wal", "synthetic-sidecar", { mode: 0o600 });
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow("X_BACKUP_SNAPSHOT_SIDECAR_PRESENT");
  });
  test("fails when the exact schema is intact but a current capture/receipt edge is missing", async () => {
    const e = await ready(); e.fixtureMutation(database => database.prepare("DELETE FROM x_page_candidate_capture_v1 WHERE candidate_id=?").run(e.target.candidateId));
    const snapshot = await e.snapshot();
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow("X_BACKUP_REFERENCE_GRAPH_INCOMPLETE");
  });
  test("fails on an invalid admission operation rather than skipping its artifact references", async () => {
    const e = await ready(); e.fixtureMutation(database => database.exec("UPDATE internal_operation SET state='terminal_failed' WHERE policy_id='p-x-page-source-admit-paused'"));
    const snapshot = await e.snapshot();
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow("X_BACKUP_ADMISSION_GRAPH_INVALID");
  });
  test.each(["historical", "duplicate"])("does not omit a missing %s-only envelope when the latest candidate is intact", async kind => {
    const e = await fixture(), admission = e.captures({ text: "Separate admission sample.", publishedAt: "2026-09-06T23:30:00.000Z" });
    e.admit("x_f1", admission.capture); e.live();
    const first = e.captures({ text: "First imported complete body." }), imported = e.importCapture(first.capture);
    const duplicate = e.captures({ text: first.capture.post.text }); e.importCapture(duplicate.capture, { sourceRevision: 1, sourceVersionHash: imported.sourceVersionHash });
    e.advanceNow(1000); const edited = e.captures({ text: "Edited current body.", observedAt: e.now().toISOString() });
    expect(e.importCapture(edited.capture, { sourceRevision: 1, sourceVersionHash: imported.sourceVersionHash }).sourceRevision).toBe(2);
    const snapshot = await e.snapshot(), missing = kind === "historical" ? first.captureSha256 : duplicate.captureSha256;
    unlinkSync(join(e.files.artifactPath, "captures", missing + ".json"));
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow("X_BACKUP_ARTIFACT_MISSING");
  });
  test("rejects a mismatched durable capture proof even when its selected files verify", async () => {
    const e = await ready(); e.fixtureMutation(database => database.exec("UPDATE x_page_source_admission_v1 SET capture_proof_sha256='" + "0".repeat(64) + "'"));
    const snapshot = await e.snapshot();
    expect(() => prepareXPageArtifactBackup({ snapshot, runtimeTrust: e.runtimeTrust, now: e.now() })).toThrow("X_BACKUP_CAPTURE_PROOF_MISMATCH");
  });
  test("preserves expired historical signatures without renewing current source authority", async () => {
    const e = await ready(); e.advanceNow(25 * 60 * 60_000);
    const saved = await packed(e), restored = restore(e, saved);
    e.files.config.artifactRoot = { ...restored.proposal.restoredRoot }; e.files.repinConfig(); const rebound = e.files.load();
    const history = e.receiptLedger.readAdmissionTrust(e.captured.capture.evidence.producerId, e.captured.capture.evidence.receiptId);
    const receipt = e.receiptLedger.read(e.captured.capture.evidence.producerId, e.captured.capture.evidence.receiptId)!;
    const evidence = createXPageFileEvidencePort({ runtimeTrust: rebound, now: e.now });
    const historical = evidence.forHistoricalAdmission!({ ...history, acceptedAt: receipt.acceptedAt });
    const verified = verifyTrustedXCapture({ capture: e.captured.capture, trust: history.trust, now: new Date(receipt.acceptedAt) });
    expect(verifyXCaptureArtifacts(verified, historical).captureSha256).toBe(e.captured.captureSha256);
    expect(() => readTrustedXPageInput({ database: e.database, target: e.target, trust: rebound.trust, receiptLedger: e.receiptLedger,
      evidencePort: evidence, now: e.now() })).toThrow("X_PAGE_SOURCE_AUTHORIZATION_EXPIRED");
  });

  test("restores a pending candidate and continues B historical verification plus real C draft/review/publish", async () => {
    const e = await ready(), saved = await packed(e), before = readFileSync(saved.snapshot.path);
    rmSync(e.files.artifactPath, { recursive: true });
    const restored = restore(e, saved);
    expect(readFileSync(saved.snapshot.path)).toEqual(before);
    expect(restored.proposal).toMatchObject({ status: "verified-files-awaiting-deployment-binding", previousRoot: e.runtimeTrust.artifactRoot,
      databaseSha256: saved.snapshot.expectedSha256, artifactManifestSha256: saved.value.manifestSha256 });
    expect(restored.proposal.restoredRoot.inode).not.toBe(e.runtimeTrust.artifactRoot.inode);
    expect(() => e.files.load()).toThrow();
    // Explicit isolated configuration binding. No production deployment is signed.
    e.files.config.artifactRoot = { ...restored.proposal.restoredRoot }; e.files.repinConfig(); const rebound = e.files.load();
    expect(rebound.configurationSha256).not.toBe(e.runtimeTrust.configurationSha256);
    const runtime = backupCandidateRuntime({ runtime: e.openRestored(saved.snapshot.path), trust: rebound, target: e.target, privateDir: e.root });
    expect(readTrustedXPageInput({ database: runtime.database, target: runtime.target, trust: runtime.trust,
      receiptLedger: runtime.receiptLedger, evidencePort: runtime.evidencePort, now: e.now() }).verified.captureSha256).toBe(e.captured.captureSha256);
    issueXPageAutomaticFences(runtime); await runtime.refine();
    const review = runtime.reviewer.reviewXPageAutomaticCandidate(e.target); issueXPageAutomaticFences({ ...runtime, publicationId: review.publicationId });
    expect(runtime.publisher.publishXPageAutomaticCandidate(e.target).kind).toBe("publish"); expect(runtime.calls).toBe(1);
    expect(runtime.database.prepare("SELECT count(*) n FROM projection_outbox").get()!.n).toBe(1);
    expect(runtime.database.prepare("SELECT count(*) n FROM pending_review_candidate WHERE source_id='motorsport-f1-news'").get()!.n).toBe(1);
  });

  test.each(["pin", "missing", "extra", "duplicate", "content", "traversal"])("rejects restored %s before creating a root", async kind => {
    const e = await ready(), saved = await packed(e), root = join(e.root, "invalid-restore");
    const value = { ...saved.value, members: [...saved.value.members] };
    if (kind === "pin") value.manifestSha256 = "0".repeat(64);
    if (kind === "missing") value.members.pop();
    if (kind === "extra") value.members.push({ relativePath: "raw-tool-output/" + "d".repeat(64) + ".json", contentUtf8: "{}" });
    if (kind === "duplicate") value.members[1] = value.members[0];
    if (kind === "content") value.members[0] = { ...value.members[0], contentUtf8: "{}" };
    if (kind === "traversal") value.members[0] = { ...value.members[0], relativePath: "../private.pem" };
    expect(() => restore(e, saved, value, root)).toThrow(); expect(existsSync(root)).toBe(false);
  });
  test("preserves existing destinations and cleans its own root when an authenticated manifest omits a DB reference", async () => {
    const e = await ready(), saved = await packed(e), existing = join(e.root, "existing-root"); mkdirSync(existing, { mode: 0o700 });
    writeFileSync(join(existing, "keep.txt"), "preserve", { mode: 0o600 }); expect(() => restore(e, saved, saved.value, existing)).toThrow("X_RESTORE_DESTINATION_EXISTS");
    expect(readFileSync(join(existing, "keep.txt"), "utf8")).toBe("preserve");
    const manifest = JSON.parse(saved.value.manifestJson); manifest.references.pop(); const manifestJson = canonicalJson(manifest);
    const altered = { ...saved.value, manifestJson, manifestSha256: xCaptureSha256(manifestJson) }, root = join(e.root, "closure-rejected");
    expect(() => restore(e, saved, altered, root)).toThrow("X_RESTORE_REFERENCE_CLOSURE_MISMATCH"); expect(existsSync(root)).toBe(false);
  });
  test("does not clean a root whose inode was replaced during a failed restore", async () => {
    const e = await ready(), saved = await packed(e), root = join(e.root, "swap-root"), moved = join(e.root, "owned-root-moved");
    const original = privateArtifact.readXCapturePrivateFile; let replaced = false;
    vi.spyOn(privateArtifact, "readXCapturePrivateFile").mockImplementation((path, limit) => {
      const value = original(path, limit);
      if (!replaced && path.startsWith(root + "/")) { replaced = true; renameSync(root, moved); mkdirSync(root, { mode: 0o700 });
        writeFileSync(join(root, "foreign.txt"), "untouched", { mode: 0o600 }); throw new Error("SYNTHETIC_ROOT_REPLACED"); }
      return value;
    });
    expect(() => restore(e, saved, saved.value, root)).toThrow("SYNTHETIC_ROOT_REPLACED");
    expect(readFileSync(join(root, "foreign.txt"), "utf8")).toBe("untouched"); expect(existsSync(moved)).toBe(true);
  });
  test("never follows a replaced child directory while cleaning a failed restore", async () => {
    const e = await ready(), saved = await packed(e), root = join(e.root, "child-swap-root"), moved = join(e.root, "moved-child-directory");
    const original = privateArtifact.readXCapturePrivateFile; let protectedPath = "", protectedBytes = Buffer.alloc(0);
    vi.spyOn(privateArtifact, "readXCapturePrivateFile").mockImplementation((path, limit) => {
      const value = original(path, limit);
      if (!protectedPath && path.startsWith(root + "/")) {
        protectedBytes = readFileSync(path); protectedPath = join(moved, basename(path));
        renameSync(dirname(path), moved); symlinkSync(moved, dirname(path)); throw new Error("SYNTHETIC_CHILD_REPLACED");
      }
      return value;
    });
    expect(() => restore(e, saved, saved.value, root)).toThrow("SYNTHETIC_CHILD_REPLACED");
    expect(readFileSync(protectedPath)).toEqual(protectedBytes);
  });
  test("cleans only the newly restored root when the snapshot changes after artifact verification", async () => {
    const e = await ready(), saved = await packed(e), root = join(e.root, "snapshot-race-root");
    const original = privateArtifact.readXCapturePrivateFile; let changed = false;
    vi.spyOn(privateArtifact, "readXCapturePrivateFile").mockImplementation((path, limit) => {
      const value = original(path, limit);
      if (!changed && path.startsWith(root + "/")) { changed = true; writeFileSync(saved.snapshot.path, Buffer.concat([readFileSync(saved.snapshot.path), Buffer.from("x")])); }
      return value;
    });
    expect(() => restore(e, saved, saved.value, root)).toThrow("X_BACKUP_SNAPSHOT_HASH_MISMATCH"); expect(existsSync(root)).toBe(false);
  });

  test("retains already signed projection bytes and reconciles pending X work after artifact-root restoration", async () => {
    const e = await ready(), runtime = backupCandidateRuntime({ runtime: e, trust: e.runtimeTrust, target: e.target, privateDir: e.root });
    e.fixtureMutation(database => {
      database.exec("INSERT INTO budget_account VALUES('acct-projection','request',100,0,0,1)");
      database.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)")
        .run(createHash("sha256").update("127.0.0.1:3102/internal/projections").digest("hex"), "0".repeat(64), "0".repeat(64));
    });
    issueXPageAutomaticFences(runtime); await runtime.refine(); const review = runtime.reviewer.reviewXPageAutomaticCandidate(e.target);
    issueXPageAutomaticFences({ ...runtime, publicationId: review.publicationId }); const publication = runtime.publisher.publishXPageAutomaticCandidate(e.target);
    if (publication.kind !== "publish") throw new Error("SYNTHETIC_PUBLISH_REQUIRED");
    const receiver = backupProjectionReceiver(join(e.root, "public-projection"), e.now), first = backupProjectionSender(e, receiver, true);
    expect(await first.sender.tick()).toMatchObject({ outcome: "reconcile_wait" }); expect(first.counts()).toEqual({ posts: 1, gets: 0 });
    const outbox = e.database.prepare("SELECT * FROM projection_outbox WHERE delivery_id=?").get(publication.deliveryId)!;
    const signedFile = join(receiver.root, "generations", String(outbox.snapshot_manifest_hash) + ".json"), signedBefore = readFileSync(signedFile);
    const saved = await packed(e), dbBefore = readFileSync(saved.snapshot.path); rmSync(e.files.artifactPath, { recursive: true });
    const restored = restore(e, saved); expect(readFileSync(saved.snapshot.path)).toEqual(dbBefore);
    e.files.config.artifactRoot = { ...restored.proposal.restoredRoot }; e.files.repinConfig(); e.files.load();
    const reopened = e.openRestored(saved.snapshot.path); e.advanceNow(16 * 60_000); const next = backupProjectionSender(reopened, receiver);
    expect(await next.sender.tick()).toMatchObject({ outcome: "succeeded", deliveryId: publication.deliveryId });
    expect(next.counts()).toEqual({ posts: 0, gets: 1 }); expect(readFileSync(signedFile)).toEqual(signedBefore);
    expect(reopened.database.prepare("SELECT task_envelope_json,task_envelope_hash,snapshot_generation FROM projection_outbox WHERE delivery_id=?").get(publication.deliveryId))
      .toEqual({ task_envelope_json: outbox.task_envelope_json, task_envelope_hash: outbox.task_envelope_hash, snapshot_generation: outbox.snapshot_generation });
    expect(first.packet()).toContain("signature");
  });
});
