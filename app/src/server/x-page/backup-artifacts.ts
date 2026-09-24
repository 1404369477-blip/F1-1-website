import { createHash, createPublicKey } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, rmdirSync, unlinkSync, writeSync, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { canonicalJson } from "../db/profile.ts";
import { assertXPageAdmissionSchema } from "./admission-migration.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "./admission-schema-identity.ts";
import { createXPageFileEvidencePort } from "./capture-artifacts.ts";
import { assertXCaptureArtifactRoot, type LoadedXPageRuntimeTrust } from "./deployment-trust.ts";
import { readXCapturePrivateFile } from "./private-artifact-file.ts";
import { SqliteXPageProducerReceiptLedger } from "./producer-receipt-ledger.ts";
import { readXPageHistoricalAdmission } from "./source-authority.ts";
import { verifyTrustedXCapture, verifyXCaptureArtifacts, xCaptureSha256, type VerifiedXCapture, type XCaptureProof } from "./trusted-capture.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/);
const Time = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const Root = z.object({ path: z.string().min(1).max(4096), device: z.number().int().nonnegative(), inode: z.number().int().positive() }).strict();
const MemberPath = z.string().regex(/^(captures|tool-receipts|artifacts|raw-tool-output|verifier-receipts)\/[0-9a-f]{64}\.json$/);
const MAX_BYTES = 512 * 1024 * 1024, MAX_MEMBERS = 100_000;
const LIMITS = { captures: 256 * 1024, "tool-receipts": 64 * 1024, artifacts: 256 * 1024,
  "raw-tool-output": 4 * 1024 * 1024, "verifier-receipts": 64 * 1024 } as const;
type Folder = keyof typeof LIMITS;
type ArtifactRoot = LoadedXPageRuntimeTrust["artifactRoot"];
type Row = Record<string, unknown>;
const Reference = z.object({ kind: z.enum(["admission", "receipt", "capture"]), referenceId: Id, admissionId: Id,
  captureSha256: Hash, captureProofSha256: Hash, acceptedAt: Time }).strict();
const CaptureGraph = z.object({ captureSha256: Hash, toolReceiptSha256: Hash, captureArtifactSha256: Hash,
  rawToolOutputSha256: Hash, verifierReceiptSha256: Hash }).strict();
export const XPageArtifactBackupManifestSchema = z.object({
  schemaVersion: z.literal("x-page-artifact-backup-v1"),
  encryptionBoundary: z.literal("authenticated-encrypted-outer-backup-required"),
  database: z.object({ relativePath: z.literal("db/snapshot.sqlite"), sha256: Hash, bytes: z.number().int().positive(),
    schemaSha256: z.literal(X_PAGE_ADMISSION_SCHEMA_SHA256) }).strict(),
  artifactFormat: z.literal("utf8-json-visible-dom-v1"), sourceRoot: Root, sourceConfigurationSha256: Hash,
  capturedAt: Time, references: z.array(Reference).max(500_000), captures: z.array(CaptureGraph).max(MAX_MEMBERS),
  members: z.array(z.object({ relativePath: MemberPath, sha256: Hash, bytes: z.number().int().positive().max(LIMITS["raw-tool-output"]) }).strict()).max(MAX_MEMBERS),
  totalBytes: z.number().int().nonnegative().max(MAX_BYTES),
}).strict();
export type XPageArtifactBackupManifest = Readonly<z.infer<typeof XPageArtifactBackupManifestSchema>>;
/** Exact UTF-8 bytes represented by immutable strings. No serializer or file
 * reread may replace these contents while constructing the encrypted package. */
export type XPageArtifactBackupMember = Readonly<{ relativePath: string; contentUtf8: string }>;
export type XPageArtifactBackup = Readonly<{ manifestJson: string; manifestSha256: string;
  members: readonly XPageArtifactBackupMember[] }>;
export type XPageArtifactSnapshotInput = Readonly<{ path: string; expectedSha256: string }>;
export type XPageArtifactRebindingProposal = Readonly<{
  schemaVersion: "x-page-artifact-root-rebinding-proposal-v1";
  status: "verified-files-awaiting-deployment-binding";
  databaseSha256: string; artifactManifestSha256: string; sourceConfigurationSha256: string;
  previousRoot: ArtifactRoot; restoredRoot: ArtifactRoot; memberCount: number; totalBytes: number;
  requiredAction: "pin-new-root-in-new-runtime-configuration-and-verified-deployment";
}>;

function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
function sorted(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function proofHash(proof: XCaptureProof): string { return xCaptureSha256(`f1plus1-x-page-capture-proof-v1\n${canonicalJson(proof)}`); }
function identity(stat: Stats): string { return [stat.dev, stat.ino, stat.uid, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs].join(":"); }
function directory(path: string): Stats {
  const stat = lstatSync(path);
  assert(resolve(path) === path && realpathSync(path) === path && stat.isDirectory() && !stat.isSymbolicLink()
    && stat.uid === process.getuid?.() && !(stat.mode & 0o077), "X_BACKUP_DIRECTORY_UNSAFE");
  return stat;
}
function directoryIdentity(path: string): string {
  const stat = directory(path); return [stat.dev, stat.ino, stat.uid, stat.mode].join(":");
}
function absent(path: string): boolean {
  try { lstatSync(path); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
}
function snapshotFile(input: XPageArtifactSnapshotInput): Readonly<{ identity: string; bytes: number }> {
  Hash.parse(input.expectedSha256);
  assert(resolve(input.path) === input.path, "X_BACKUP_SNAPSHOT_PATH_INVALID");
  const parent = directoryIdentity(dirname(input.path));
  assert(["-wal", "-shm", "-journal"].every(suffix => absent(input.path + suffix)), "X_BACKUP_SNAPSHOT_SIDECAR_PRESENT");
  const initial = lstatSync(input.path);
  assert(initial.isFile() && !initial.isSymbolicLink() && initial.nlink === 1 && initial.uid === process.getuid?.()
    && !(initial.mode & 0o077) && initial.size > 0 && initial.size <= 2 * 1024 * 1024 * 1024, "X_BACKUP_SNAPSHOT_UNSAFE");
  const fd = openSync(input.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    assert(identity(fstatSync(fd)) === identity(initial), "X_BACKUP_SNAPSHOT_CHANGED");
    const bytes = Buffer.alloc(64 * 1024), hash = createHash("sha256"); let length = 0;
    for (;;) { const size = readSync(fd, bytes, 0, bytes.length, null); if (!size) break; length += size;
      assert(length <= initial.size, "X_BACKUP_SNAPSHOT_CHANGED"); hash.update(bytes.subarray(0, size)); }
    assert(length === initial.size && identity(fstatSync(fd)) === identity(initial) && identity(lstatSync(input.path)) === identity(initial)
      && directoryIdentity(dirname(input.path)) === parent, "X_BACKUP_SNAPSHOT_CHANGED");
    assert(hash.digest("hex") === input.expectedSha256, "X_BACKUP_SNAPSHOT_HASH_MISMATCH");
    return Object.freeze({ identity: identity(initial), bytes: length });
  } finally { closeSync(fd); }
}
function withSnapshot<T>(input: XPageArtifactSnapshotInput, action: (database: DatabaseSync, bytes: number) => T): T {
  const before = snapshotFile(input), database = new DatabaseSync(input.path, { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON; BEGIN");
    assertXPageAdmissionSchema(database);
    assert(database.prepare("PRAGMA integrity_check").all().every(row => row.integrity_check === "ok")
      && !database.prepare("PRAGMA foreign_key_check").get(), "X_BACKUP_DATABASE_INVALID");
    const result = action(database, before.bytes);
    database.exec("ROLLBACK");
    assert(snapshotFile(input).identity === before.identity, "X_BACKUP_SNAPSHOT_CHANGED");
    return result;
  } finally { database.close(); }
}

type CachedMember = Readonly<{ relativePath: string; contentUtf8: string; sha256: string; bytes: number; identity: string }>;
function collect(database: DatabaseSync, artifactRoot: ArtifactRoot, now: Date) {
  assertXCaptureArtifactRoot(artifactRoot);
  const references: Array<z.infer<typeof Reference>> = [], graphs = new Map<string, z.infer<typeof CaptureGraph>>();
  const cache = new Map<string, CachedMember>(), verifiedContexts = new Map<string, VerifiedXCapture>();
  const ledger = new SqliteXPageProducerReceiptLedger(database); let totalBytes = 0;
  const read = (folder: Folder, hash: string, expectedSha256?: string): CachedMember => {
    Hash.parse(hash); const relativePath = `${folder}/${hash}.json`, prior = cache.get(relativePath);
    if (prior) { assert(expectedSha256 === undefined || prior.sha256 === expectedSha256, "X_BACKUP_ARTIFACT_HASH_MISMATCH"); return prior; }
    const file = readXCapturePrivateFile(join(artifactRoot.path, relativePath), LIMITS[folder]);
    assert(file, "X_BACKUP_ARTIFACT_MISSING");
    const sha256 = xCaptureSha256(file.text), bytes = Buffer.byteLength(file.text, "utf8");
    assert(bytes > 0 && (expectedSha256 === undefined || sha256 === expectedSha256), "X_BACKUP_ARTIFACT_HASH_MISMATCH");
    totalBytes += bytes; assert(totalBytes <= MAX_BYTES && cache.size < MAX_MEMBERS, "X_BACKUP_ARTIFACT_LIMIT_EXCEEDED");
    const member = Object.freeze({ relativePath, contentUtf8: file.text, sha256, bytes, identity: file.identity });
    cache.set(relativePath, member); return member;
  };
  const verifyReference = (reference: z.infer<typeof Reference>): VerifiedXCapture => {
    Reference.parse(reference); assert(Date.parse(reference.acceptedAt) <= now.getTime(), "X_BACKUP_ADMISSION_TIME_INVALID");
    references.push(Object.freeze(reference)); assert(references.length <= 500_000, "X_BACKUP_REFERENCE_LIMIT_EXCEEDED");
    const contextKey = canonicalJson({ admissionId: reference.admissionId, captureSha256: reference.captureSha256,
      captureProofSha256: reference.captureProofSha256, acceptedAt: reference.acceptedAt });
    const cached = verifiedContexts.get(contextKey); if (cached) return cached;
    const historical = readXPageHistoricalAdmission(database, reference.admissionId), metadata = historical.metadata;
    const toolId = z.enum(["codex-browser-visible-dom-v1", "codex-chrome-visible-dom-v1"]).parse(metadata.toolId);
    // All historical keys and times come from the authenticated SQLite graph.
    // The current storage root is the only physical binding supplied here.
    const runtimeTrust: LoadedXPageRuntimeTrust = { trust: historical.trust, artifactRoot, artifactFormat: "utf8-json-visible-dom-v1", toolId,
      configurationSha256: metadata.configurationSha256,
      verifier: { verifierId: metadata.verifierId, keyId: metadata.verifierKeyId, publicKey: createPublicKey(metadata.verifierPublicKeySpkiPem) } };
    const port = createXPageFileEvidencePort({ runtimeTrust, now: () => now }).forHistoricalAdmission!({
      ...historical, acceptedAt: reference.acceptedAt });
    const captureFile = read("captures", reference.captureSha256, reference.captureSha256);
    const verified = verifyTrustedXCapture({ capture: JSON.parse(captureFile.contentUtf8), trust: historical.trust, now: new Date(reference.acceptedAt) });
    const evidence = verified.capture.evidence, tool = read("tool-receipts", evidence.toolReceiptSha256, evidence.toolReceiptSha256);
    read("artifacts", evidence.captureArtifactSha256, evidence.captureArtifactSha256);
    const rawHash = Hash.parse(JSON.parse(tool.contentUtf8).rawToolOutputSha256); read("raw-tool-output", rawHash, rawHash);
    const verifier = read("verifier-receipts", reference.captureSha256);
    const proof = verifyXCaptureArtifacts(verified, port);
    assert(proofHash(proof) === reference.captureProofSha256 && proof.verifierReceiptSha256 === verifier.sha256,
      "X_BACKUP_CAPTURE_PROOF_MISMATCH");
    const graph = Object.freeze({ captureSha256: verified.captureSha256, toolReceiptSha256: evidence.toolReceiptSha256,
      captureArtifactSha256: evidence.captureArtifactSha256, rawToolOutputSha256: rawHash, verifierReceiptSha256: verifier.sha256 });
    assert(!graphs.has(reference.captureSha256) || canonicalJson(graphs.get(reference.captureSha256)) === canonicalJson(graph), "X_BACKUP_CAPTURE_GRAPH_CONFLICT");
    graphs.set(reference.captureSha256, graph); verifiedContexts.set(contextKey, verified); return verified;
  };
  for (const row of database.prepare(`SELECT a.*,op.state,op.policy_id,op.owner_process FROM x_page_source_admission_v1 a
    LEFT JOIN internal_operation op ON op.operation_id=a.operation_id ORDER BY a.admission_id`).all()) {
    assert(row.state === "succeeded" && row.policy_id === "p-x-page-source-admit-paused" && row.owner_process === "system_supervisor"
      && xCaptureSha256(String(row.admission_json)) === row.admission_sha256, "X_BACKUP_ADMISSION_GRAPH_INVALID");
    const core = JSON.parse(String(row.admission_json));
    assert(core.schemaVersion === "x-page-source-admission-v1" && canonicalJson(core) === row.admission_json
      && core.sourceId === row.source_id && core.registryRevision === row.registry_revision && core.operationId === row.operation_id
      && core.admittedAt === row.admitted_at, "X_BACKUP_ADMISSION_GRAPH_INVALID");
    const verified = verifyReference({ kind: "admission", referenceId: String(row.admission_id), admissionId: String(row.admission_id),
      captureSha256: String(row.capture_sha256), captureProofSha256: String(row.capture_proof_sha256), acceptedAt: String(row.admitted_at) });
    assert(canonicalJson(verified.capture) === canonicalJson(core.capture) && proofHash(core.captureProof) === row.capture_proof_sha256
      && ([verified.capture.evidence.sourceId, verified.capture.evidence.observedSourceId] as string[]).includes(String(row.source_id)), "X_BACKUP_ADMISSION_CAPTURE_MISMATCH");
  }
  const receipts = new Map<string, { row: Row; receipt: NonNullable<ReturnType<typeof ledger.read>>; verified: VerifiedXCapture }>();
  for (const row of database.prepare("SELECT * FROM x_page_producer_receipt_v1 ORDER BY receipt_entity_id").all()) {
    const receipt = ledger.read(String(row.producer_id), String(row.receipt_id)); assert(receipt, "X_BACKUP_RECEIPT_MISSING");
    const verified = verifyReference({ kind: "receipt", referenceId: String(row.receipt_entity_id), admissionId: String(row.admission_id),
      captureSha256: receipt.captureSha256, captureProofSha256: receipt.captureProofSha256, acceptedAt: receipt.acceptedAt });
    assert(receipt.producerId === verified.capture.evidence.producerId && receipt.receiptId === verified.capture.evidence.receiptId
      && receipt.sourceId === verified.capture.evidence.sourceId && receipt.observedSourceId === verified.capture.evidence.observedSourceId
      && receipt.capturedSourceVersionHash === verified.normalized.sourceVersionHash && receipt.result.captureSha256 === receipt.captureSha256
      && receipt.result.sourceId === receipt.sourceId && receipt.result.candidateId === `xpage-${verified.normalized.identity}`
      && receipt.result.sourceVersionHash === verified.normalized.sourceVersionHash, "X_BACKUP_RECEIPT_CAPTURE_MISMATCH");
    receipts.set(String(row.operation_id), { row, receipt, verified });
  }
  for (const row of database.prepare("SELECT * FROM x_page_candidate_capture_v1 ORDER BY capture_id").all()) {
    const saved = receipts.get(String(row.operation_id)); assert(saved, "X_BACKUP_CAPTURE_RECEIPT_MISSING");
    const { receipt, verified } = saved;
    assert(receipt.result.decision !== "duplicate" && receipt.result.candidateId === row.candidate_id && receipt.result.sourceRevision === row.source_revision
      && receipt.sourceId === row.source_id && verified.captureSha256 === row.evidence_sha256 && canonicalJson(verified.capture) === row.evidence_json
      && verified.normalized.sourceVersionHash === row.source_version_hash && canonicalJson(verified.normalized) === row.normalized_json
      && verified.normalized.text === row.complete_text && verified.normalized.statusId === row.status_id
      && verified.normalized.authorHandle === row.author_handle && verified.normalized.observedAt === row.observed_at, "X_BACKUP_CAPTURE_GRAPH_INVALID");
    verifyReference({ kind: "capture", referenceId: String(row.capture_id), admissionId: String(saved.row.admission_id),
      captureSha256: receipt.captureSha256, captureProofSha256: receipt.captureProofSha256, acceptedAt: receipt.acceptedAt });
  }
  // Missing edges must fail the whole snapshot, including older drafts/bundles
  // and duplicate receipts whose envelope is not the candidate's first capture.
  for (const sql of [
    `SELECT 1 FROM pending_review_candidate c JOIN source s ON s.source_id=c.source_id LEFT JOIN x_page_candidate_capture_v1 cap
      ON cap.candidate_id=c.candidate_id AND cap.source_revision=c.source_revision AND cap.source_version_hash=c.source_payload_hash
      WHERE s.source_kind='x_page' AND cap.capture_id IS NULL LIMIT 1`,
    `SELECT 1 FROM x_page_producer_receipt_v1 r LEFT JOIN x_page_candidate_capture_v1 cap ON cap.candidate_id=r.candidate_id
      AND cap.source_revision=r.source_revision AND cap.source_version_hash=r.captured_source_version_hash WHERE cap.capture_id IS NULL LIMIT 1`,
    `SELECT 1 FROM review_bundle b JOIN pending_review_candidate c ON c.candidate_id=b.candidate_id JOIN source s ON s.source_id=c.source_id
      LEFT JOIN x_page_candidate_capture_v1 cap ON cap.candidate_id=b.candidate_id AND cap.source_revision=b.source_revision AND cap.source_version_hash=b.source_payload_hash
      WHERE s.source_kind='x_page' AND (cap.capture_id IS NULL OR json_extract(b.public_payload_json,'$.xCaptureSha256') IS NOT cap.evidence_sha256) LIMIT 1`,
    `SELECT 1 FROM machine_summary_draft d JOIN pending_review_candidate c ON c.candidate_id=d.candidate_id JOIN source s ON s.source_id=c.source_id
      LEFT JOIN x_page_candidate_capture_v1 cap ON cap.candidate_id=d.candidate_id AND cap.source_revision=d.source_revision AND cap.source_version_hash=d.source_payload_hash
      WHERE s.source_kind='x_page' AND cap.capture_id IS NULL LIMIT 1`,
  ]) assert(!database.prepare(sql).get(), "X_BACKUP_REFERENCE_GRAPH_INCOMPLETE");
  assertXCaptureArtifactRoot(artifactRoot);
  for (const file of cache.values()) {
    const folder = file.relativePath.split("/")[0] as Folder;
    const current = readXCapturePrivateFile(join(artifactRoot.path, file.relativePath), LIMITS[folder]);
    assert(current?.identity === file.identity && current.text === file.contentUtf8, "X_BACKUP_ARTIFACT_CHANGED");
  }
  assertXCaptureArtifactRoot(artifactRoot);
  return { references: references.sort((a, b) => sorted(`${a.kind}:${a.referenceId}`, `${b.kind}:${b.referenceId}`)),
    captures: [...graphs.values()].sort((a, b) => sorted(a.captureSha256, b.captureSha256)),
    cache: [...cache.values()].sort((a, b) => sorted(a.relativePath, b.relativePath)), totalBytes };
}

/** Read-only closure of one closed SQLite snapshot. The caller MUST place this
 * manifest and these exact cached members in the authenticated encrypted backup
 * containing that same db/snapshot.sqlite; this function does not encrypt, sign,
 * activate a deployment, read a private key, or inspect unreferenced files. */
export function prepareXPageArtifactBackup(input: Readonly<{ snapshot: XPageArtifactSnapshotInput; runtimeTrust: LoadedXPageRuntimeTrust; now: Date }>): XPageArtifactBackup {
  const at = new Date(input.now.getTime()); Time.parse(at.toISOString());
  const root = Object.freeze(Root.parse(input.runtimeTrust.artifactRoot)); Hash.parse(input.runtimeTrust.configurationSha256);
  assert(input.runtimeTrust.artifactFormat === "utf8-json-visible-dom-v1", "X_BACKUP_ARTIFACT_FORMAT_INVALID");
  return withSnapshot(input.snapshot, (database, bytes) => {
    const closed = collect(database, root, at);
    const manifest = XPageArtifactBackupManifestSchema.parse({ schemaVersion: "x-page-artifact-backup-v1", encryptionBoundary: "authenticated-encrypted-outer-backup-required",
      database: { relativePath: "db/snapshot.sqlite", sha256: input.snapshot.expectedSha256, bytes, schemaSha256: X_PAGE_ADMISSION_SCHEMA_SHA256 },
      artifactFormat: input.runtimeTrust.artifactFormat, sourceRoot: root, sourceConfigurationSha256: input.runtimeTrust.configurationSha256,
      capturedAt: at.toISOString(), references: closed.references, captures: closed.captures,
      members: closed.cache.map(({ relativePath, sha256, bytes }) => ({ relativePath, sha256, bytes })), totalBytes: closed.totalBytes });
    const manifestJson = canonicalJson(manifest);
    return Object.freeze({ manifestJson, manifestSha256: xCaptureSha256(manifestJson),
      members: Object.freeze(closed.cache.map(({ relativePath, contentUtf8 }) => Object.freeze({ relativePath, contentUtf8 }))) });
  });
}

function parseArchive(input: Readonly<{ manifestJson: string; expectedManifestSha256: string; members: readonly XPageArtifactBackupMember[] }>) {
  Hash.parse(input.expectedManifestSha256);
  assert(Buffer.byteLength(input.manifestJson, "utf8") <= 64 * 1024 * 1024 && xCaptureSha256(input.manifestJson) === input.expectedManifestSha256, "X_RESTORE_MANIFEST_HASH_MISMATCH");
  const manifest = XPageArtifactBackupManifestSchema.parse(JSON.parse(input.manifestJson));
  assert(canonicalJson(manifest) === input.manifestJson && resolve(manifest.sourceRoot.path) === manifest.sourceRoot.path, "X_RESTORE_MANIFEST_INVALID");
  assert(input.members.length === manifest.members.length, "X_RESTORE_MEMBER_SET_MISMATCH");
  const cache = new Map<string, XPageArtifactBackupMember>(); let totalBytes = 0;
  for (const item of input.members) {
    const relativePath = MemberPath.parse(item.relativePath), contentUtf8 = z.string().parse(item.contentUtf8);
    assert(!cache.has(relativePath), "X_RESTORE_DUPLICATE_MEMBER");
    const bytes = Buffer.byteLength(contentUtf8, "utf8"), folder = relativePath.split("/")[0] as Folder;
    assert(bytes > 0 && bytes <= LIMITS[folder] && (totalBytes += bytes) <= MAX_BYTES, "X_RESTORE_MEMBER_LIMIT_EXCEEDED");
    // A UTF-8 round trip is exact for the accepted artifact format. Reject lone
    // UTF-16 surrogates in caller-provided strings rather than silently replace.
    assert(Buffer.from(contentUtf8, "utf8").toString("utf8") === contentUtf8, "X_RESTORE_MEMBER_ENCODING_INVALID");
    cache.set(relativePath, Object.freeze({ relativePath, contentUtf8 }));
  }
  let previous = "";
  for (const member of manifest.members) {
    const file = cache.get(member.relativePath);
    assert(sorted(previous, member.relativePath) < 0 && file && Buffer.byteLength(file.contentUtf8, "utf8") === member.bytes
      && xCaptureSha256(file.contentUtf8) === member.sha256, "X_RESTORE_MEMBER_HASH_MISMATCH");
    previous = member.relativePath;
  }
  assert(totalBytes === manifest.totalBytes, "X_RESTORE_TOTAL_BYTES_MISMATCH");
  return { manifest, cache };
}

/** Restore into a newly created private root after the outer package has
 * authenticated/decrypted the DB, manifest pin and members. No existing path is
 * adopted, and failure cleanup removes only paths still owned by this call.
 * The returned proposal grants no producer, source, signing or runtime authority. */
export function restoreXPageArtifactBackup(input: Readonly<{ snapshot: XPageArtifactSnapshotInput; manifestJson: string;
  expectedManifestSha256: string; members: readonly XPageArtifactBackupMember[]; destinationRoot: string; now: Date;
}>): Readonly<{ proposal: XPageArtifactRebindingProposal; proposalJson: string; proposalSha256: string }> {
  const { manifest, cache } = parseArchive(input), at = new Date(input.now.getTime()); Time.parse(at.toISOString());
  assert(manifest.database.sha256 === input.snapshot.expectedSha256 && Date.parse(manifest.capturedAt) <= at.getTime(), "X_RESTORE_SNAPSHOT_BINDING_INVALID");
  assert(resolve(input.destinationRoot) === input.destinationRoot && input.destinationRoot !== manifest.sourceRoot.path, "X_RESTORE_NEW_ROOT_REQUIRED");
  const parent = dirname(input.destinationRoot), parentIdentity = directoryIdentity(parent);
  assert(absent(input.destinationRoot), "X_RESTORE_DESTINATION_EXISTS");
  let cleanup: (() => void) | undefined;
  try { return withSnapshot(input.snapshot, (database, bytes) => {
    assert(bytes === manifest.database.bytes, "X_RESTORE_SNAPSHOT_BINDING_INVALID");
    mkdirSync(input.destinationRoot, { mode: 0o700 });
    const stat = directory(input.destinationRoot), root = Object.freeze({ path: input.destinationRoot, device: stat.dev, inode: stat.ino });
    const ownedFiles: Array<{ path: string; dev: number; ino: number }> = [], ownedDirectories: typeof ownedFiles = [];
    const ownRoot = () => { try { const current = directory(root.path); return current.dev === root.device && current.ino === root.inode
      && directoryIdentity(parent) === parentIdentity; } catch { return false; } };
    const clean = () => {
      for (const file of ownedFiles.reverse()) { if (!ownRoot()) return;
        try {
          const ownedParent = ownedDirectories.find(folder => folder.path === dirname(file.path)), currentParent = directory(dirname(file.path));
          if (!ownedParent || currentParent.dev !== ownedParent.dev || currentParent.ino !== ownedParent.ino) continue;
          const current = lstatSync(file.path); if (current.isFile() && !current.isSymbolicLink() && current.dev === file.dev && current.ino === file.ino) unlinkSync(file.path);
        } catch { /* preserve an unexpected replacement or linked parent */ } }
      for (const folder of ownedDirectories.reverse()) { if (!ownRoot()) return;
        try { const current = lstatSync(folder.path); if (current.isDirectory() && !current.isSymbolicLink() && current.dev === folder.dev && current.ino === folder.ino) rmdirSync(folder.path); } catch { /* preserve a nonempty or replaced directory */ } }
      if (ownRoot()) { try { rmdirSync(root.path); } catch { /* preserve unexpected contents for inspection */ } }
    };
    cleanup = clean;
    try {
      const created = new Set<string>();
      for (const member of manifest.members) {
        assert(ownRoot(), "X_RESTORE_ROOT_CHANGED");
        const folder = join(root.path, member.relativePath.split("/")[0]);
        if (!created.has(folder)) { mkdirSync(folder, { mode: 0o700 }); const current = directory(folder);
          ownedDirectories.push({ path: folder, dev: current.dev, ino: current.ino }); created.add(folder); }
        const expectedFolder = ownedDirectories.find(item => item.path === folder)!, currentFolder = directory(folder);
        assert(currentFolder.dev === expectedFolder.dev && currentFolder.ino === expectedFolder.ino, "X_RESTORE_DIRECTORY_CHANGED");
        const path = join(root.path, member.relativePath), content = Buffer.from(cache.get(member.relativePath)!.contentUtf8, "utf8");
        const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
          const opened = fstatSync(fd); ownedFiles.push({ path, dev: opened.dev, ino: opened.ino });
          // O_NOFOLLOW protects only the final path component. A directory can
          // be replaced between the check above and openSync; validate the
          // opened descriptor and every owned directory before writing bytes.
          const openedFolder = directory(folder), namedBeforeWrite = lstatSync(path);
          assert(ownRoot() && openedFolder.dev === expectedFolder.dev && openedFolder.ino === expectedFolder.ino
            && opened.isFile() && opened.uid === process.getuid?.() && opened.nlink === 1 && !(opened.mode & 0o077)
            && opened.size === 0 && !namedBeforeWrite.isSymbolicLink() && identity(namedBeforeWrite) === identity(opened),
          "X_RESTORE_FILE_CHANGED");
          let offset = 0; while (offset < content.length) offset += writeSync(fd, content, offset, content.length - offset);
          fsyncSync(fd); const finished = fstatSync(fd), named = lstatSync(path);
          assert(ownRoot() && finished.dev === opened.dev && finished.ino === opened.ino && finished.nlink === 1 && !(finished.mode & 0o077)
            && named.dev === opened.dev && named.ino === opened.ino && !named.isSymbolicLink(), "X_RESTORE_FILE_CHANGED");
        } finally { closeSync(fd); }
      }
      const closed = collect(database, root, at);
      assert(canonicalJson(closed.references) === canonicalJson(manifest.references) && canonicalJson(closed.captures) === canonicalJson(manifest.captures)
        && canonicalJson(closed.cache.map(({ relativePath, sha256, bytes }) => ({ relativePath, sha256, bytes }))) === canonicalJson(manifest.members)
        && closed.totalBytes === manifest.totalBytes, "X_RESTORE_REFERENCE_CLOSURE_MISMATCH");
      for (const path of [...ownedDirectories.map(item => item.path), root.path]) { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
      assert(ownRoot(), "X_RESTORE_ROOT_CHANGED");
      const proposal: XPageArtifactRebindingProposal = Object.freeze({ schemaVersion: "x-page-artifact-root-rebinding-proposal-v1",
        status: "verified-files-awaiting-deployment-binding", databaseSha256: input.snapshot.expectedSha256, artifactManifestSha256: input.expectedManifestSha256,
        sourceConfigurationSha256: manifest.sourceConfigurationSha256, previousRoot: Object.freeze({ ...manifest.sourceRoot }), restoredRoot: root,
        memberCount: manifest.members.length, totalBytes: manifest.totalBytes, requiredAction: "pin-new-root-in-new-runtime-configuration-and-verified-deployment" });
      const proposalJson = canonicalJson(proposal);
      return Object.freeze({ proposal, proposalJson, proposalSha256: xCaptureSha256(proposalJson) });
    } catch (error) { clean(); throw error; }
  }); } catch (error) { cleanup?.(); throw error; }
}

/** Verify an already restored root against outer-authenticated manifest and DB
 * pins. This reads historical evidence only and grants no runtime authority. */
export function verifyRestoredXPageArtifactBackup(input: Readonly<{ snapshot: XPageArtifactSnapshotInput; manifestJson: string;
  expectedManifestSha256: string; artifactRoot: string; now: Date;
}>): Readonly<{ proposal: XPageArtifactRebindingProposal; proposalJson: string; proposalSha256: string }> {
  const at = new Date(input.now.getTime()); Time.parse(at.toISOString()); Hash.parse(input.expectedManifestSha256);
  assert(Buffer.byteLength(input.manifestJson, "utf8") <= 64 * 1024 * 1024
    && xCaptureSha256(input.manifestJson) === input.expectedManifestSha256, "X_RESTORE_MANIFEST_HASH_MISMATCH");
  const manifest = XPageArtifactBackupManifestSchema.parse(JSON.parse(input.manifestJson));
  assert(canonicalJson(manifest) === input.manifestJson && manifest.database.sha256 === input.snapshot.expectedSha256
    && Date.parse(manifest.capturedAt) <= at.getTime(), "X_RESTORE_SNAPSHOT_BINDING_INVALID");
  const stat = directory(input.artifactRoot), root = Object.freeze({ path: input.artifactRoot, device: stat.dev, inode: stat.ino });
  return withSnapshot(input.snapshot, (database, bytes) => {
    assert(bytes === manifest.database.bytes, "X_RESTORE_SNAPSHOT_BINDING_INVALID");
    const closed = collect(database, root, at);
    assert(canonicalJson(closed.references) === canonicalJson(manifest.references) && canonicalJson(closed.captures) === canonicalJson(manifest.captures)
      && canonicalJson(closed.cache.map(({ relativePath, sha256, bytes }) => ({ relativePath, sha256, bytes }))) === canonicalJson(manifest.members)
      && closed.totalBytes === manifest.totalBytes, "X_RESTORE_REFERENCE_CLOSURE_MISMATCH");
    const proposal: XPageArtifactRebindingProposal = Object.freeze({ schemaVersion: "x-page-artifact-root-rebinding-proposal-v1",
      status: "verified-files-awaiting-deployment-binding", databaseSha256: input.snapshot.expectedSha256, artifactManifestSha256: input.expectedManifestSha256,
      sourceConfigurationSha256: manifest.sourceConfigurationSha256, previousRoot: Object.freeze({ ...manifest.sourceRoot }), restoredRoot: root,
      memberCount: manifest.members.length, totalBytes: manifest.totalBytes, requiredAction: "pin-new-root-in-new-runtime-configuration-and-verified-deployment" });
    const proposalJson = canonicalJson(proposal);
    return Object.freeze({ proposal, proposalJson, proposalSha256: xCaptureSha256(proposalJson) });
  });
}
