import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { inspectBackup } from "../server/site-status/backup.ts";
import { sampleDatabase } from "../server/site-status/database.ts";
import { verifyOffHostReceipt } from "../server/backup-snapshot/off-host-receipt.ts";
import { verifyApplicationDrillReceipt } from "../server/backup-snapshot/application-drill-receipt.ts";
import { parseManifest } from "../server/backup-snapshot/core.ts";
import { addBackupFixture, createSiteStatusFixture, TEST_NOW, testHash, testSqliteMasterFingerprint, writeFixtureJson } from "./site-status-fixtures.ts";

const fixtures: ReturnType<typeof createSiteStatusFixture>[] = [];
function fixture(offsetMs = -300_000, options?: Parameters<typeof addBackupFixture>[2]) {
  const database = createSiteStatusFixture(); fixtures.push(database); return { database, backup: addBackupFixture(database, offsetMs, options) };
}
afterEach(() => { for (const value of fixtures.splice(0)) { value.db.close(); rmSync(value.root, { recursive: true, force: true }); } });

describe("registered backup point and signed evidence", () => {
  it("accepts the existing production signature format and registration binding without reading any ciphertext", () => {
    const { database, backup } = fixture();
    // Independent production verifiers accept these same signed fixtures.
    expect(verifyOffHostReceipt({ receipt: backup.offReceipt, publicKeyPem: readFileSync(backup.backupConfig.offHostPublicKeyPath, "utf8"),
      expected: backup.offReceipt.payload, now: TEST_NOW }).receiptSha256).toHaveLength(64);
    expect(verifyApplicationDrillReceipt({ receipt: backup.appReceipt, publicKeyPem: readFileSync(backup.backupConfig.applicationDrillPublicKeyPath, "utf8"),
      expected: backup.appReceipt.payload, now: TEST_NOW }).receiptSha256).toHaveLength(64);
    const before = testHash(readFileSync(database.config.databasePath)), sample = sampleDatabase(database.config, TEST_NOW);
    const result = inspectBackup(backup.backupConfig, sample, TEST_NOW);
    expect(result).toMatchObject({ status: "healthy", reasons: [], manifestVerified: true, offHostSignatureVerified: true,
      applicationSignatureVerified: true, offHostCiphertextReread: false, restoreExecuted: false });
    expect(result.point?.ageMs).toBe(300_000);
    expect(JSON.stringify(result)).not.toContain(backup.packageId);
    expect(JSON.stringify(result)).not.toContain(database.root);
    expect(testHash(readFileSync(database.config.databasePath))).toBe(before);
  });

  it("accepts the producer's 363-member history format and independently binds both schema digest algorithms", () => {
    const { database, backup } = fixture(-300_000, { historicalGenerationCount: 360 });
    const manifest = parseManifest(readFileSync(backup.manifestPath, "utf8"));
    expect(manifest.members).toHaveLength(363);
    expect(manifest.members.filter(member => member.relativePath.startsWith("projection/generations/"))).toHaveLength(361);
    expect(manifest.sqliteMasterSha256).toBe(testSqliteMasterFingerprint(database.db));
    expect(manifest.sqliteMasterSha256).not.toBe(database.config.expectedSchemaSha256);
    const result = inspectBackup(backup.backupConfig, sampleDatabase(database.config, TEST_NOW), TEST_NOW);
    expect(result).toMatchObject({ status: "healthy", reasons: [], manifestVerified: true,
      offHostSignatureVerified: true, applicationSignatureVerified: true, offHostCiphertextReread: false });
  });

  it("rejects the deployment's canonical schema digest substituted for the producer's sqlite_master digest", () => {
    const database = createSiteStatusFixture(); fixtures.push(database);
    const backup = addBackupFixture(database, -300_000, { sqliteMasterSha256: database.config.expectedSchemaSha256 });
    // All manifest/receipt/registration hashes are otherwise internally consistent and signed.
    expect(inspectBackup(backup.backupConfig, sampleDatabase(database.config, TEST_NOW), TEST_NOW))
      .toMatchObject({ status: "failed", manifestVerified: false, reasons: ["BACKUP_MANIFEST_MISMATCH"] });
  });

  it.each(["duplicate", "traversal", "absolute", "backslash", "missing-db", "missing-active", "missing-current-generation", "oversized-member"])("rejects an authenticated manifest with %s members", (kind) => {
    const { database, backup } = fixture(-300_000, { historicalGenerationCount: 1, mutateMembers: members => {
      if (kind === "duplicate") members.push({ ...members[0] });
      else if (kind === "oversized-member") members.push({ relativePath: `projection/generations/${"9".repeat(64)}.json`, bytes: 0x1_0000_0000, sha256: "9".repeat(64) });
      else if (kind.startsWith("missing-")) {
        const path = kind === "missing-db" ? "db/snapshot.sqlite" : kind === "missing-active" ? "projection/active.json" : `projection/generations/${"e".repeat(64)}.json`;
        members.splice(members.findIndex(member => member.relativePath === path), 1);
      } else members.push({ relativePath: kind === "traversal" ? "projection/generations/../private.json" : kind === "absolute" ? "/private.json" : "projection\\private.json", bytes: 128, sha256: "9".repeat(64) });
    } });
    expect(inspectBackup(backup.backupConfig, sampleDatabase(database.config, TEST_NOW), TEST_NOW))
      .toMatchObject({ status: "failed", manifestVerified: false, reasons: ["BACKUP_MANIFEST_MISMATCH"] });
  });

  it("rejects a manifest exceeding the bounded history member count", () => {
    const { database, backup } = fixture(-300_000, { historicalGenerationCount: 19_998 });
    expect(inspectBackup(backup.backupConfig, sampleDatabase(database.config, TEST_NOW), TEST_NOW))
      .toMatchObject({ status: "failed", manifestVerified: false, reasons: ["BACKUP_MANIFEST_MISMATCH"] });
  });

  it("keeps authentic old signatures distinct from a stale recovery point", () => {
    const { database, backup } = fixture(-900_001);
    const result = inspectBackup(backup.backupConfig, sampleDatabase(database.config, TEST_NOW), TEST_NOW);
    expect(result).toMatchObject({ status: "failed", manifestVerified: true, offHostSignatureVerified: true, applicationSignatureVerified: true });
    expect(result.reasons).toEqual(["BACKUP_POINT_STALE"]);
  });

  it("does not let missing pruned files hide a known stale point", () => {
    const { database, backup } = fixture(-12 * 60 * 60 * 1000);
    rmSync(backup.manifestPath);
    const result = inspectBackup(backup.backupConfig, sampleDatabase(database.config, TEST_NOW), TEST_NOW);
    expect(result.status).toBe("failed");
    expect(result.reasons).toEqual(["BACKUP_POINT_STALE", "BACKUP_EVIDENCE_MISSING"]);
  });

  it.each(["offhost", "application"])("rejects a missing or altered %s signature", (which) => {
    const { database, backup } = fixture(), path = which === "offhost" ? backup.offPath : backup.appPath;
    const receipt = which === "offhost" ? backup.offReceipt : backup.appReceipt;
    writeFixtureJson(path, { payload: receipt.payload });
    const sample = sampleDatabase(database.config, TEST_NOW);
    expect(inspectBackup(backup.backupConfig, sample, TEST_NOW).status).toBe("failed");
    writeFixtureJson(path, { ...receipt, signature: "a".repeat(86) });
    const result = inspectBackup(backup.backupConfig, sample, TEST_NOW);
    expect(result.reasons).toContain(which === "offhost" ? "BACKUP_OFFHOST_SIGNATURE_INVALID" : "BACKUP_APPLICATION_SIGNATURE_INVALID");
  });

  it.each(["manifest", "pointer", "generation", "offhost-binding", "application-binding", "key"])("rejects a %s mismatch", (which) => {
    const { database, backup } = fixture();
    if (which === "manifest") writeFileSync(backup.manifestPath, "{\"private\":\"MUST_NOT_LEAK\"}");
    if (which === "pointer") database.db.prepare("UPDATE backup_recovery_point SET projection_pointer_sha256=?").run("0".repeat(64));
    if (which === "generation") database.db.prepare("UPDATE backup_recovery_point SET projection_manifest_sha256=?").run("0".repeat(64));
    if (which === "offhost-binding") database.db.prepare("UPDATE backup_recovery_point SET remote_receipt_sha256=?").run("0".repeat(64));
    if (which === "application-binding") database.db.prepare("UPDATE internal_operation SET request_hash=?").run("0".repeat(64));
    const config = which === "key" ? { ...backup.backupConfig, expectedOffHostPublicKeySha256: "0".repeat(64) } : backup.backupConfig;
    const result = inspectBackup(config, sampleDatabase(database.config, TEST_NOW), TEST_NOW);
    expect(result.status).toBe("failed");
    expect(result.reasons).toContain(["manifest", "pointer", "generation"].includes(which) ? "BACKUP_MANIFEST_MISMATCH" : which === "key" ? "BACKUP_KEY_MISMATCH" : "BACKUP_RECEIPT_BINDING_MISMATCH");
    expect(JSON.stringify(result)).not.toMatch(/MUST_NOT_LEAK|register-backup|test-backup-operation/);
  });

  it("rejects symlinked or oversized evidence without following its contents", () => {
    const { database, backup } = fixture(), sample = sampleDatabase(database.config, TEST_NOW);
    rmSync(backup.offPath); symlinkSync(backup.appPath, backup.offPath);
    expect(inspectBackup(backup.backupConfig, sample, TEST_NOW).status).toBe("failed");
    rmSync(backup.offPath); writeFileSync(backup.offPath, Buffer.alloc(65 * 1024));
    expect(inspectBackup(backup.backupConfig, sample, TEST_NOW).status).toBe("failed");
  });

  it("rejects old database observations and copies lacking the private registration context", () => {
    const { database, backup } = fixture(), sample = sampleDatabase(database.config, TEST_NOW);
    expect(inspectBackup(backup.backupConfig, sample, new Date(TEST_NOW.getTime() + 60_001))).toMatchObject({ status: "unknown", reasons: ["BACKUP_DATABASE_SAMPLE_STALE"] });
    expect(inspectBackup(backup.backupConfig, { ...sample }, TEST_NOW)).toMatchObject({ status: "unknown", reasons: ["BACKUP_DATABASE_UNKNOWN"] });
    expect(inspectBackup(backup.backupConfig, sampleDatabase({ ...database.config, expectedSchemaSha256: "0".repeat(64) }, TEST_NOW), TEST_NOW))
      .toMatchObject({ status: "unknown", reasons: ["BACKUP_DATABASE_UNKNOWN"], point: null });
  });
});
