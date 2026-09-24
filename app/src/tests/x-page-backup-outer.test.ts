import { afterEach, expect, test, vi } from "vitest";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupLayout, canonicalJson, parseManifest, runRestoreDrill, runSnapshotOnce, verifyRestoredTree } from "../server/backup-snapshot/core.ts";
import { issueXPageAutomaticFences } from "../server/x-page/content-authority.ts";
import { issueRssAutomaticFences } from "../server/rss-automatic/admission.ts";
import { refineOneCandidate } from "../server/rss/refinement.ts";
import { ProjectionReceiver } from "../server/review-real/projection.ts";
import { xPageBackupFixture, backupCandidateRuntime, backupProjectionReceiver, backupProjectionSender } from "./helpers/x-page-backup.ts";
import * as artifacts from "../server/x-page/backup-artifacts.ts";
import { createOffHostReadReceipt } from "../server/backup-snapshot/off-host-receipt.ts";
import { createSignedApplicationDrillReceipt } from "../server/backup-snapshot/application-drill-receipt.ts";
import { readSnapLatestAndManifest, verifyBackupPackageBinding } from "../server/internal-operation/backup-package-binding.ts";
import { runBackupRecoveryPointRegister, readStoredBackupRecoveryPoint } from "../server/internal-operation/backup-recovery-point-register.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../server/x-page/admission-schema-identity.ts";
import { loadXPageBackupDeploymentTrust } from "../server/backup-snapshot/x-deployment.ts";
import { runBackupSnapshotCli } from "../../scripts/backup-snapshot-once.ts";
import { selectApplicationDrillRecords, verifyApplicationDrillDetail } from "../server/backup-snapshot/application-public-check.ts";
import { PublicRealSnapshotReader } from "../server/public/snapshot-adapter.ts";
import { handlePublicStory } from "../server/public/http.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) close(); });
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function ready() {
  const e = await xPageBackupFixture(); cleanup.push(e.close);
  const capture = e.captures({ text: "Complete synthetic encrypted backup source body. ".repeat(60) });
  e.admit("x_f1", capture.capture); e.live(); const imported = e.importCapture(capture.capture);
  const target = { candidateId: imported.candidateId, sourceRevision: imported.sourceRevision, inputContentHash: imported.sourceVersionHash };
  const runtime = backupCandidateRuntime({ runtime: e, target, trust: e.runtimeTrust, privateDir: e.root });
  e.fixtureMutation(database => {
    database.exec("INSERT INTO budget_account VALUES('acct-projection','request',100,0,0,1)");
    database.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)")
      .run(sha("127.0.0.1:3102/internal/projections"), "0".repeat(64), "0".repeat(64));
  });
  issueXPageAutomaticFences(runtime); await runtime.refine(); const review = runtime.reviewer.reviewXPageAutomaticCandidate(target);
  issueXPageAutomaticFences({ ...runtime, publicationId: review.publicationId }); const publication = runtime.publisher.publishXPageAutomaticCandidate(target);
  const receiver = backupProjectionReceiver(join(e.root, "public"), e.now), delivery = backupProjectionSender(e, receiver);
  expect(await delivery.sender.tick()).toMatchObject({ outcome: "succeeded" });
  const key = randomBytes(32), outputDir = join(e.root, "encrypted"), restoreRoot = join(e.root, "restored");
  const sourceDbPath = String(e.database.prepare("PRAGMA database_list").get()!.file);
  const input = { sourceDbPath, projectionRoot: receiver.root, outputDir, key, retain: 2,
    projectionBoundary: "confirmed-delivery-v1" as const, xPageRuntimeTrust: e.runtimeTrust, now: e.now };
  return { e, runtime, target, capture, publication, receiver, delivery, input, key, outputDir, restoreRoot };
}
function saved(input: ReturnType<typeof runSnapshotOnce>, outputDir: string) {
  return parseManifest(readFileSync(join(backupLayout(outputDir).packagesDir, input.packageId!, "manifest.json"), "utf8"));
}

test("encrypts the exact mixed database and artifact closure; restores RSS/X and preserves a pending generation", async () => {
  const f = await ready(), { e } = f;
  e.advanceNow(1000); const rss = { ...e, target: e.target, supervisorPort: e.port("system_supervisor") };
  issueRssAutomaticFences(rss);
  await refineOneCandidate({ database: e.database, mutationPort: e.port("rss_refiner"), target: e.target, apiKeyPath: e.keyPath,
    budgetAccountId: "acct-rss", now: e.now, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      titleZh: "备份中的赛事新闻", summaryZh: "这条赛事新闻与完整原帖一同进入恢复后的公开快照。", keyPointsZh: ["混合保存与恢复"] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 12 } }), { status: 200 }) });
  const review = f.runtime.reviewer.reviewAutomaticCandidate(e.target); issueRssAutomaticFences({ ...rss, publicationId: review.publicationId });
  f.runtime.publisher.publishAutomaticCandidate(e.target); e.advanceNow(1000); expect(await f.delivery.sender.tick()).toMatchObject({ outcome: "succeeded" });
  e.advanceNow(1000); const pendingCapture = e.captures({ publishedAt: "2026-09-06T23:01:00.000Z", observedAt: e.now().toISOString(), text: "New complete pending X body." });
  const pending = e.importCapture(pendingCapture.capture), pendingTarget = { candidateId: pending.candidateId, sourceRevision: pending.sourceRevision, inputContentHash: pending.sourceVersionHash };
  const pendingRuntime = backupCandidateRuntime({ runtime: e, target: pendingTarget, trust: e.runtimeTrust, privateDir: e.root });
  issueXPageAutomaticFences(pendingRuntime); await pendingRuntime.refine(); const pendingReview = pendingRuntime.reviewer.reviewXPageAutomaticCandidate(pendingTarget);
  issueXPageAutomaticFences({ ...pendingRuntime, publicationId: pendingReview.publicationId }); const pendingPublication = pendingRuntime.publisher.publishXPageAutomaticCandidate(pendingTarget);
  if (pendingPublication.kind !== "publish") throw new Error("SYNTHETIC_PUBLISH_REQUIRED");
  const before = e.database.prepare("SELECT * FROM projection_outbox WHERE delivery_id=?").get(pendingPublication.deliveryId);
  const snapshot = runSnapshotOnce(f.input), manifest = saved(snapshot, f.outputDir);
  expect(manifest.schemaVersion).toBe("backup-snapshot-manifest-v2");
  expect(manifest.xArtifacts?.databaseSha256).toBe(manifest.members.find(member => member.relativePath === "db/snapshot.sqlite")!.sha256);
  expect(manifest.members.filter(member => member.relativePath.startsWith("x-page-artifacts/files/"))).toHaveLength(10);
  rmSync(e.files.artifactPath, { recursive: true });
  const restored = runRestoreDrill({ backupRoot: f.outputDir, restoreRoot: f.restoreRoot, key: f.key });
  expect(restored.xArtifactRebinding).toMatchObject({ status: "verified-files-awaiting-deployment-binding", memberCount: 10 });
  expect(restored.checks?.x_artifact_files_verified).toBe("10");
  const check = new DatabaseSync(join(f.restoreRoot, "db/snapshot.sqlite"), { readOnly: true });
  try {
    expect(check.prepare("SELECT * FROM projection_outbox WHERE delivery_id=?").get(pendingPublication.deliveryId)).toEqual(before);
    expect(check.prepare("SELECT count(*) n FROM published_projection").get()!.n).toBe(3);
  } finally { check.close(); }
  const active = JSON.parse(readFileSync(join(f.restoreRoot, "projection/active.json"), "utf8")); expect(active.snapshotGeneration).toBe(2);
  const records = JSON.parse(readFileSync(join(f.restoreRoot, "projection/generations", active.snapshotManifestHash + ".json"), "utf8")).package.taskEnvelope.snapshot.records;
  expect(new Set(records.map((record: { source: { platform: string } }) => record.source.platform))).toEqual(new Set(["rss", "x"]));
  const publicKeyPath = join(e.root, "restored-public-verify.pem");
  writeFileSync(publicKeyPath, f.receiver.keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  const publicReader = new PublicRealSnapshotReader({ projectionRoot: join(f.restoreRoot, "projection"), signingKeyId: f.receiver.signingKeyId, verifyKeyPath: publicKeyPath });
  const selected = selectApplicationDrillRecords(records); expect(selected.map(record => record.source.platform)).toEqual(["rss", "x"]);
  // The X story remains selected even if a feed page contains only RSS rows.
  expect(selectApplicationDrillRecords([...Array(20).fill(selected[0]), selected[1]])).toEqual(selected);
  for (const record of selected) {
    const response = handlePublicStory(record.publicId, publicReader, new Request("http://127.0.0.1/api/public/stories/" + record.publicId));
    expect(response.status).toBe(200); const dto = await response.json(); verifyApplicationDrillDetail(record, dto);
    expect(() => verifyApplicationDrillDetail(record, { ...dto, story: { ...dto.story, bodyZh: ["错误正文"] } })).toThrow();
    expect(() => verifyApplicationDrillDetail(record, { ...dto, story: { ...dto.story, originalLink: { enabled: true, url: "https://x.com/f1/status/1", reason: null } } })).toThrow();
  }
  expect(runRestoreDrill({ backupRoot: f.outputDir, restoreRoot: f.restoreRoot, key: f.key, verifyOnly: true }).checks).toEqual(restored.checks);
  e.files.config.artifactRoot = { ...restored.xArtifactRebinding!.restoredRoot }; e.files.repinConfig(); e.files.load();
  const reopened = e.openRestored(join(f.restoreRoot, "db/snapshot.sqlite")); e.advanceNow(1000);
  const newReceiver = { ...f.receiver, root: join(f.restoreRoot, "projection"), receiver: new ProjectionReceiver({
    root: join(f.restoreRoot, "projection"), signingKeyId: f.receiver.signingKeyId, publicKey: f.receiver.keys.publicKey, now: () => e.now().getTime() }) };
  const continued = backupProjectionSender(reopened, newReceiver);
  expect(await continued.sender.tick()).toMatchObject({ outcome: "succeeded", deliveryId: pendingPublication.deliveryId });
  expect(continued.counts()).toEqual({ posts: 1, gets: 0 });
  const after = reopened.database.prepare("SELECT task_envelope_json,task_envelope_hash,snapshot_generation FROM projection_outbox WHERE delivery_id=?").get(pendingPublication.deliveryId)!;
  expect(after).toEqual({ task_envelope_json: before!.task_envelope_json, task_envelope_hash: before!.task_envelope_hash, snapshot_generation: before!.snapshot_generation });
});

test.each(["missing", "extra", "tampered"] as const)("rejects %s restored artifact material", async kind => {
  const f = await ready(), snapshot = runSnapshotOnce(f.input), manifest = saved(snapshot, f.outputDir);
  runRestoreDrill({ backupRoot: f.outputDir, restoreRoot: f.restoreRoot, key: f.key });
  const member = manifest.members.find(member => member.relativePath.startsWith("x-page-artifacts/files/"))!;
  const path = join(f.restoreRoot, member.relativePath);
  if (kind === "missing") rmSync(path);
  if (kind === "tampered") writeFileSync(path, "{}", { mode: 0o600 });
  if (kind === "extra") writeFileSync(join(f.restoreRoot, "x-page-artifacts/files/captures", "0".repeat(64) + ".json"), "{}", { mode: 0o600 });
  expect(() => runRestoreDrill({ backupRoot: f.outputDir, restoreRoot: f.restoreRoot, key: f.key, verifyOnly: true })).toThrow();
});

test("rejects 0017 with old format, missing trust and non-whitelisted members", async () => {
  const f = await ready(); expect(() => runSnapshotOnce({ ...f.input, xPageRuntimeTrust: undefined })).toThrow("X_BACKUP_RUNTIME_TRUST_REQUIRED");
  const snapshot = runSnapshotOnce(f.input), manifest = saved(snapshot, f.outputDir);
  const { xArtifacts: omitted, ...legacy } = manifest; expect(omitted).toBeDefined();
  const old = { ...legacy, schemaVersion: "backup-snapshot-manifest-v1",
    members: manifest.members.filter(member => !member.relativePath.startsWith("x-page-artifacts/")) };
  old.contentHash = sha(canonicalJson(old.members)); const parsedOld = parseManifest(canonicalJson(old));
  runRestoreDrill({ backupRoot: f.outputDir, restoreRoot: f.restoreRoot, key: f.key });
  expect(() => verifyRestoredTree(f.restoreRoot, parsedOld)).toThrow("X_BACKUP_COMPLETE_FORMAT_REQUIRED");
  const extra = { ...manifest, members: [...manifest.members, { relativePath: "x-page-artifacts/private-key.pem", bytes: 1, sha256: sha("x") }] };
  extra.contentHash = sha(canonicalJson(extra.members)); expect(() => parseManifest(canonicalJson(extra))).toThrow("X_BACKUP_MEMBER_WHITELIST_REJECTED");
  const wrongRoot = join(f.e.root, "empty-artifacts"); mkdirSync(wrongRoot, { mode: 0o700 });
  expect(() => runSnapshotOnce({ ...f.input, now: () => new Date(f.e.now().getTime() + 1000),
    xPageRuntimeTrust: { ...f.e.runtimeTrust, artifactRoot: { ...f.e.runtimeTrust.artifactRoot, path: wrongRoot } } })).toThrow();
});

test("encrypts immutable validated cached bytes when original artifact files disappear immediately after collection", async () => {
  const f = await ready(), prepare = artifacts.prepareXPageArtifactBackup;
  vi.spyOn(artifacts, "prepareXPageArtifactBackup").mockImplementation(input => {
    const value = prepare(input); rmSync(f.e.files.artifactPath, { recursive: true }); return value;
  });
  runSnapshotOnce(f.input);
  expect(runRestoreDrill({ backupRoot: f.outputDir, restoreRoot: f.restoreRoot, key: f.key }).xArtifactRebinding?.memberCount).toBe(5);
});

test("snapshot CLI derives the artifact root only from the pinned private deployment and B configuration", async () => {
  const f = await ready(), path = join(f.e.files.root, "deployment.json"), keyPath = join(f.e.root, "backup.key");
  const dbStat = lstatSync(f.input.sourceDbPath);
  const deployment = { schemaVersion: "admin-service-deployment-v3", reviewSchemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256,
    reviewDatabasePath: f.input.sourceDbPath, publicProjectionRoot: f.input.projectionRoot, dataRoot: f.e.files.root,
    reviewDatabaseIdentity: { dev: dbStat.dev, ino: dbStat.ino, uid: dbStat.uid, nlink: 1 as const },
    targetReleaseAppRoot: f.e.files.releaseRoot, xPageTrustConfigurationPath: f.e.files.configPath,
    xPageTrustConfigurationSha256: f.e.runtimeTrust.configurationSha256 };
  const raw = canonicalJson(deployment), pin = sha(raw); writeFileSync(path, raw, { mode: 0o600 }); writeFileSync(keyPath, f.key, { mode: 0o600 });
  const pins = { deploymentManifestPath: path, expectedDeploymentManifestSha256: pin, sourceDbPath: f.input.sourceDbPath, projectionRoot: f.input.projectionRoot };
  expect(loadXPageBackupDeploymentTrust(pins).runtimeTrust.artifactRoot).toEqual(f.e.runtimeTrust.artifactRoot);
  expect(() => loadXPageBackupDeploymentTrust({ ...pins, expectedDeploymentManifestSha256: "0".repeat(64) })).toThrow("X_BACKUP_DEPLOYMENT_IDENTITY_INVALID");
  expect(() => loadXPageBackupDeploymentTrust({ ...pins, projectionRoot: f.e.root })).toThrow("X_BACKUP_DEPLOYMENT_TARGET_MISMATCH");
  expect(() => runSnapshotOnce({ ...f.input, sourceDatabaseIdentity: { ...deployment.reviewDatabaseIdentity, ino: dbStat.ino + 1 } }))
    .toThrow("X_BACKUP_DEPLOYMENT_DATABASE_IDENTITY_INVALID");
  const args = ["--source-db", f.input.sourceDbPath, "--projection-root", f.input.projectionRoot, "--output-dir", f.outputDir,
    "--key-file", keyPath, "--deployment-manifest", path, "--deployment-manifest-sha256", pin];
  expect(runBackupSnapshotCli(args.slice(0, -2), { NODE_ENV: "test" })).toMatchObject({ ok: false, code: "X_BACKUP_DEPLOYMENT_PINS_REQUIRED" });
  expect(runBackupSnapshotCli(args, { NODE_ENV: "test" })).toMatchObject({ ok: true });
});

test("REGISTER re-decrypts all X artifacts and commits their manifest into the existing recovery receipt", async () => {
  const f = await ready(), { e } = f;
  e.fixtureMutation(database => database.exec("INSERT INTO budget_account VALUES('backup-private','request',100,0,0,1)"));
  const snapshot = runSnapshotOnce(f.input), drillReport = runRestoreDrill({ backupRoot: f.outputDir, restoreRoot: f.restoreRoot, key: f.key });
  const observer = generateKeyPairSync("ed25519"), appObserver = generateKeyPairSync("ed25519"), at = e.now().getTime();
  // Signed synthetic observers exercise acceptance and causal binding. They do
  // not claim a real off-host run or boot of the deployed application.
  const offHostReceipt = createOffHostReadReceipt({ backupRoot: f.outputDir, packageId: snapshot.packageId!,
    privateKeyPem: observer.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), now: () => new Date(at + 10) });
  const snap = readSnapLatestAndManifest(f.outputDir), active = JSON.parse(readFileSync(join(f.restoreRoot, "projection/active.json"), "utf8"));
  const binding = { database: e.database, backupRoot: f.outputDir, restoreRoot: f.restoreRoot, drillReport, snapshotKey: f.key,
    projectionSigningKeyId: f.receiver.signingKeyId, projectionPublicKeyPem: f.receiver.keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    offHostReceipt, offHostPublicKeyPem: observer.publicKey.export({ type: "spki", format: "pem" }).toString() };
  expect(verifyBackupPackageBinding({ ...binding, now: new Date(at + 100) }).checks.x_artifact_files_verified).toBe("5");
  expect(() => verifyBackupPackageBinding({ ...binding, now: new Date(at + 100), drillReport: { ...drillReport, xArtifactRebinding: undefined } }))
    .toThrow("DRILL_X_ARTIFACT_PROOF_MISMATCH");
  const applicationDrill = createSignedApplicationDrillReceipt({ schemaVersion: "f1plus1-application-drill-v1", packageId: snapshot.packageId!,
    contentHash: snap.manifest.contentHash, manifestSha256: snap.manifestSha256, databaseSnapshotSha256: snap.manifest.xArtifacts!.databaseSha256,
    restoreRootSha256: sha(f.restoreRoot), releaseSha256: "0".repeat(64), deploymentManifestSha256: "0".repeat(64), schemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256,
    projectionGeneration: active.snapshotGeneration, projectionManifestSha256: active.snapshotManifestHash, bootable: true, businessPointVerified: true,
    incidentDeclaredAt: new Date(at + 20).toISOString(), adminAvailableAt: new Date(at + 40).toISOString(), publicAvailableAt: new Date(at + 50).toISOString(),
    completedAt: new Date(at + 70).toISOString(), elapsedMs: 50, adminResponseSha256: sha("synthetic-admin-probe"), publicResponseSha256: sha("synthetic-public-probe"),
    adminRuntimeSha256: "0".repeat(64), publicRuntimeSha256: "0".repeat(64) }, appObserver.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  vi.spyOn(Date, "now").mockReturnValue(at + 100);
  e.gateway.close();
  const receipt = runBackupRecoveryPointRegister({ ...binding, applicationDrill,
    applicationDrillPublicKeyPem: appObserver.publicKey.export({ type: "spki", format: "pem" }).toString(), releaseSha256: "0".repeat(64),
    manifestSha256: "0".repeat(64), schemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256, budgetAccountId: "backup-private", now: () => new Date(at + 100) });
  expect(receipt).toMatchObject({ decision: "SUCCESS", validBackupRecoveryPoint: true, activationApplied: false });
  const stored = readStoredBackupRecoveryPoint(e.database, receipt.recoveryPointId)!;
  expect(stored.fileManifestSha256).toBe(sha("f1plus1-snap-file-manifest-v1\n" + canonicalJson(snap.manifest.members)));
  expect(stored.totalBytes).toBe(snap.manifest.members.reduce((sum, member) => sum + member.bytes, 0));
  expect(stored.backupManifestSha256).toBe(snap.manifestSha256);
});
