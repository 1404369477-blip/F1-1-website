import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigError, loadAppConfig, type EnvRecord } from "../server/config/env";
import {
  CLOSED_RECEIPT_VALIDATOR_REVISION,
  CLOSED_RECEIPT_PATHS,
  PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256,
  generateClosedReceipt,
  readValidatorArtifactSha256,
  secureArtifactSha256,
  type ClosedProfileReceipt,
  type PublicDataReceipt
} from "../server/db/closed-receipt";
import { closeDatabase, migrateDatabase, openSafeDatabase } from "../server/db/database";
import { PUBLIC_GRAPH_SHA256, PUBLIC_ROOT_HASHES, seedPublicSyntheticFixture } from "../server/db/public-synthetic";
import { M3_PROFILE_COUNTS, PUBLIC_PROFILE_COUNTS, canonicalJson } from "../server/db/profile";
import { assertLegacyClosedReceipts } from "../server/db/public-multimedia-synthetic";
import { runReceiptIntegrityBoundary, safeReasonCode } from "../server/security/cli";
import { redactLogEvent } from "../server/security/log";

const canonicalAppRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const canonicalProjectRoot = resolve(canonicalAppRoot, "..");
const temporaryRoots: string[] = [];

function tempProject(prefix: string): { appRoot: string; projectRoot: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), prefix));
  const appRoot = join(projectRoot, "app");
  mkdirSync(join(appRoot, ".local"), { recursive: true, mode: 0o700 });
  temporaryRoots.push(projectRoot);
  return { appRoot, projectRoot };
}

function copyPinnedFile(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  copyFileSync(source, target);
  chmodSync(target, 0o600);
}

function copyRegularRootFiles(source: string, target: string): void {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isFile()) copyPinnedFile(join(source, entry.name), join(target, entry.name));
  }
}

function preparePinnedWorkspace(roots: { appRoot: string; projectRoot: string }): void {
  copyRegularRootFiles(resolve(canonicalAppRoot, "migrations"), resolve(roots.appRoot, "migrations"));
  copyPinnedFile(
    resolve(canonicalAppRoot, "scripts/profile-closed-receipt.ts"),
    resolve(roots.appRoot, "scripts/profile-closed-receipt.ts")
  );
  copyPinnedFile(
    resolve(canonicalAppRoot, "scripts/source-management-closed-receipt.ts"),
    resolve(roots.appRoot, "scripts/source-management-closed-receipt.ts")
  );
  copyPinnedFile(
    resolve(canonicalAppRoot, "src/server/db/closed-receipt.ts"),
    resolve(roots.appRoot, "src/server/db/closed-receipt.ts")
  );
  copyPinnedFile(
    resolve(canonicalProjectRoot, "data/m3-base-shadow-import-v0/main-source-record-batch.json"),
    resolve(roots.projectRoot, "data/m3-base-shadow-import-v0/main-source-record-batch.json")
  );
  for (const file of ["source-seed-enriched.json", "implementation-mapping.json"]) {
    copyPinnedFile(
      resolve(canonicalProjectRoot, "data/m4-vs0-seed-enrichment-v0", file),
      resolve(roots.projectRoot, "data/m4-vs0-seed-enrichment-v0", file)
    );
  }
  copyPinnedFile(
    resolve(canonicalProjectRoot, "data/mvp-contract-v0/schema.json"),
    resolve(roots.projectRoot, "data/mvp-contract-v0/schema.json")
  );
  copyRegularRootFiles(
    resolve(canonicalProjectRoot, "data/mvp-contract-v0.4-public-synthetic"),
    resolve(roots.projectRoot, "data/mvp-contract-v0.4-public-synthetic")
  );
}

function publicEnv(): EnvRecord {
  return {
    APP_ENV: "test",
    APP_PORT: "3010",
    APP_BIND_HOST: "127.0.0.1",
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:3010",
    F1_DATA_PROFILE: "public-synthetic",
    F1_DB_PATH: ".local/f1plus1-public-synthetic.sqlite",
    SOURCE_CONFIG_PROVIDER: "fixture",
    SOURCE_FIXTURE_PATH: "../data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json",
    ADAPTER_MODE: "mock",
    SUMMARY_MODE: "fixture",
    MEDIA_MODE: "fixture",
    PUBLISH_MODE: "manual_only",
    REAL_FEISHU_IO: "false",
    REAL_EXTERNAL_IO: "false",
    REAL_FORM_SUBMIT: "false",
    ADMIN_ACCESS_MODE: "local_dev_only",
    LOG_LEVEL: "info"
  };
}

function createPublicDatabase(roots: { appRoot: string; projectRoot: string }): void {
  const config = loadAppConfig(publicEnv(), roots);
  const database = openSafeDatabase(config.dbPath, { appRoot: roots.appRoot });
  try {
    migrateDatabase(database, resolve(roots.appRoot, "migrations"));
    seedPublicSyntheticFixture(database, config, roots.appRoot, roots.projectRoot);
  } finally {
    closeDatabase(database);
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function receiptPath(projectRoot: string, path: string): string {
  return resolve(projectRoot, path);
}

function receiptSha256(core: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(core)).digest("hex");
}

function rewriteReceiptValidatorIdentity(
  path: string,
  rootKey: "validatorArtifactSha256" | "receiptValidatorArtifactSha256",
  revisionKey: "validatorRevision" | "receiptValidatorRevision",
  root = PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256,
  mutate?: (core: Record<string, unknown>) => void
): void {
  const receipt = readJson<Record<string, unknown>>(path);
  delete receipt.receiptSha256;
  delete receipt[revisionKey];
  receipt[rootKey] = root;
  mutate?.(receipt);
  writeFileSync(path, `${canonicalJson({ ...receipt, receiptSha256: receiptSha256(receipt) })}\n`, { mode: 0o600 });
}

function crashReceiptProcess(
  roots: { appRoot: string; projectRoot: string },
  profileId: "m3-shadow" | "public-synthetic",
  crashAt: "after-first-install" | "after-all-installs" | "during-recovery"
): void {
  const moduleUrl = pathToFileURL(resolve(canonicalAppRoot, "src/server/db/closed-receipt.ts")).href;
  const source = [
    `import { generateClosedReceipt } from ${JSON.stringify(moduleUrl)};`,
    `generateClosedReceipt(${JSON.stringify(profileId)}, ${JSON.stringify({
      appRoot: roots.appRoot,
      projectRoot: roots.projectRoot,
      testOnlyReceiptSetCrashAt: crashAt
    })});`
  ].join("\n");
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    source
  ], { cwd: canonicalAppRoot, encoding: "utf8" });
  expect(result.status).toBeNull();
  expect(result.signal).toBe("SIGKILL");
}

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe("profile-scoped closed receipts", () => {
  it("restores M3, closes both old profiles, and repeats with zero logical drift", () => {
    const roots = tempProject("f1plus1-closed-receipt-");
    preparePinnedWorkspace(roots);
    createPublicDatabase(roots);

    const firstM3 = generateClosedReceipt("m3-shadow", { ...roots, now: () => new Date("2026-08-09T08:00:00.000Z") });
    const firstPublic = generateClosedReceipt("public-synthetic", { ...roots, now: () => new Date("2026-08-09T08:00:01.000Z") });
    const interruptedDirectory = resolve(roots.appRoot, ".local/.m3-restore-AbC123");
    mkdirSync(interruptedDirectory, { mode: 0o700 });
    linkSync(
      resolve(roots.appRoot, ".local/f1plus1.sqlite"),
      resolve(interruptedDirectory, "f1plus1.sqlite")
    );
    expect(lstatSync(resolve(roots.appRoot, ".local/f1plus1.sqlite")).nlink).toBe(2);
    const secondM3 = generateClosedReceipt("m3-shadow", { ...roots, now: () => new Date("2026-08-09T08:00:02.000Z") });
    const secondPublic = generateClosedReceipt("public-synthetic", { ...roots, now: () => new Date("2026-08-09T08:00:03.000Z") });

    expect(firstM3.restoredM3).toBe(true);
    expect(secondM3.restoredM3).toBe(false);
    expect(firstM3.dbReceipt.rowCounts).toEqual(M3_PROFILE_COUNTS);
    expect(firstM3.dbReceipt.fixtureGraphSha256).toBe("e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17");
    expect(firstPublic.dbReceipt.rowCounts).toEqual(PUBLIC_PROFILE_COUNTS);
    expect(firstPublic.dbReceipt.fixtureGraphSha256).toBe(PUBLIC_GRAPH_SHA256);
    expect(firstPublic.dbReceipt.profileLedgerRootSha256).toBe(PUBLIC_ROOT_HASHES.ledger);
    expect(firstPublic.dataReceipt?.artifactRevision).toBe(firstPublic.dbReceipt.artifactRevision);
    expect(firstPublic.dataReceipt?.manifestSha256).toBe(PUBLIC_ROOT_HASHES.manifest);
    expect(firstM3.dbReceipt.validatorRevision).toBe(CLOSED_RECEIPT_VALIDATOR_REVISION);
    expect(firstPublic.dataReceipt?.receiptValidatorRevision).toBe(CLOSED_RECEIPT_VALIDATOR_REVISION);
    expect(existsSync(interruptedDirectory)).toBe(false);

    for (const [first, second] of [[firstM3.dbReceipt, secondM3.dbReceipt], [firstPublic.dbReceipt, secondPublic.dbReceipt]] as const) {
      expect(second.closedDbSha256).toBe(first.closedDbSha256);
      expect(second.schemaFingerprintSha256).toBe(first.schemaFingerprintSha256);
      expect(second.migrationLedgerRootSha256).toBe(first.migrationLedgerRootSha256);
      expect(second.profileLedgerRootSha256).toBe(first.profileLedgerRootSha256);
      expect(second.logicalContentRootSha256).toBe(first.logicalContentRootSha256);
      expect(second.receiptSha256).not.toBe(first.receiptSha256);
      expect(second.validatedAt).not.toBe(first.validatedAt);
    }
    const { validatedAt: firstDataTime, receiptSha256: firstDataHash, ...firstDataStable } = firstPublic.dataReceipt!;
    const { validatedAt: secondDataTime, receiptSha256: secondDataHash, ...secondDataStable } = secondPublic.dataReceipt!;
    expect(secondDataStable).toEqual(firstDataStable);
    expect(secondDataTime).not.toBe(firstDataTime);
    expect(secondDataHash).not.toBe(firstDataHash);

    for (const path of Object.values(CLOSED_RECEIPT_PATHS)) {
      const stat = lstatSync(receiptPath(roots.projectRoot, path));
      expect(stat.mode & 0o777).toBe(0o600);
      expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1).toBe(true);
    }
    expect(lstatSync(resolve(roots.projectRoot, "app/.local/receipts")).mode & 0o777).toBe(0o700);
    expect(lstatSync(resolve(roots.projectRoot, "app/.local/validator-migrations")).mode & 0o777).toBe(0o700);
    expect(lstatSync(resolve(roots.appRoot, ".local/f1plus1.sqlite")).mode & 0o777).toBe(0o600);
    for (const database of ["f1plus1.sqlite", "f1plus1-public-synthetic.sqlite"]) {
      expect(lstatSync(resolve(roots.appRoot, `.local/${database}`)).nlink).toBe(1);
      expect(() => lstatSync(resolve(roots.appRoot, `.local/${database}-wal`))).toThrow();
      expect(() => lstatSync(resolve(roots.appRoot, `.local/${database}-shm`))).toThrow();
    }
    const storedM3 = readJson<ClosedProfileReceipt>(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.m3));
    const storedPublicData = readJson<PublicDataReceipt>(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.publicData));
    expect(storedM3.validatedAt).toBe("2026-08-09T08:00:02.000Z");
    expect(storedPublicData.validatedAt).toBe("2026-08-09T08:00:03.000Z");
  });

  it("performs the one exact legacy-root migration and binds the refreshed set to the scoped validator", () => {
    const roots = tempProject("f1plus1-closed-migration-");
    preparePinnedWorkspace(roots);
    createPublicDatabase(roots);
    const now = new Date();
    generateClosedReceipt("m3-shadow", { ...roots, now: () => now });
    generateClosedReceipt("public-synthetic", { ...roots, now: () => now });

    rewriteReceiptValidatorIdentity(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.m3), "validatorArtifactSha256", "validatorRevision");
    rewriteReceiptValidatorIdentity(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.public), "validatorArtifactSha256", "validatorRevision");
    rewriteReceiptValidatorIdentity(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.publicData), "receiptValidatorArtifactSha256", "receiptValidatorRevision");
    unlinkSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.m3ValidatorMarker));
    unlinkSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.publicValidatorMarker));
    const oldM3Bytes = readFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.m3));
    const oldPublicBytes = readFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.public));
    const oldPublicDataBytes = readFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.publicData));

    crashReceiptProcess(roots, "m3-shadow", "after-first-install");
    expect(existsSync(resolve(roots.projectRoot, "app/.local/receipts/.m3-receipt-v2.transaction/journal.json"))).toBe(true);
    const migratedM3 = generateClosedReceipt("m3-shadow", { ...roots, now: () => new Date(now.getTime() + 1_000) });
    crashReceiptProcess(roots, "public-synthetic", "after-all-installs");
    expect(existsSync(resolve(roots.projectRoot, "app/.local/receipts/.public-receipt-v2.transaction/journal.json"))).toBe(true);
    const migratedPublic = generateClosedReceipt("public-synthetic", { ...roots, now: () => new Date(now.getTime() + 2_000) });
    const validatorRoot = readValidatorArtifactSha256();
    expect(validatorRoot).not.toBe(PREVIOUS_CLOSED_RECEIPT_VALIDATOR_SHA256);
    expect(migratedM3.dbReceipt).toMatchObject({
      validatorRevision: CLOSED_RECEIPT_VALIDATOR_REVISION,
      validatorArtifactSha256: validatorRoot,
      externalCalls: 0
    });
    expect(migratedPublic.dbReceipt.validatorArtifactSha256).toBe(validatorRoot);
    expect(migratedPublic.dataReceipt).toMatchObject({
      receiptValidatorRevision: CLOSED_RECEIPT_VALIDATOR_REVISION,
      receiptValidatorArtifactSha256: validatorRoot,
      externalCalls: 0
    });
    expect(() => assertLegacyClosedReceipts(roots.projectRoot))
      .toThrow(/RECEIPT_TAMPER.*closed receipt binding changed/);

    const migratedM3Bytes = readFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.m3));
    writeFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.m3), oldM3Bytes, { mode: 0o600 });
    expect(() => generateClosedReceipt("m3-shadow", { ...roots, now: () => new Date(now.getTime() + 3_000) }))
      .toThrow(/RECEIPT_MIGRATION_REPLAY/);
    expect(readFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.m3))).toEqual(oldM3Bytes);
    writeFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.m3), migratedM3Bytes, { mode: 0o600 });

    writeFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.public), oldPublicBytes, { mode: 0o600 });
    writeFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.publicData), oldPublicDataBytes, { mode: 0o600 });
    expect(() => generateClosedReceipt("public-synthetic", { ...roots, now: () => new Date(now.getTime() + 4_000) }))
      .toThrow(/RECEIPT_MIGRATION_REPLAY/);
    expect(readFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.public))).toEqual(oldPublicBytes);
    expect(readFileSync(receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.publicData))).toEqual(oldPublicDataBytes);
  });

  it("rejects an unknown old root with zero writes and restores both public receipts after a set failure", () => {
    const roots = tempProject("f1plus1-closed-set-");
    preparePinnedWorkspace(roots);
    createPublicDatabase(roots);
    const first = new Date();
    generateClosedReceipt("public-synthetic", { ...roots, now: () => first });
    const publicPath = receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.public);
    const dataPath = receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.publicData);
    const currentSetBytes = [readFileSync(publicPath), readFileSync(dataPath)];

    rewriteReceiptValidatorIdentity(publicPath, "validatorArtifactSha256", "validatorRevision", "1".repeat(64));
    rewriteReceiptValidatorIdentity(dataPath, "receiptValidatorArtifactSha256", "receiptValidatorRevision", "1".repeat(64));
    const unknownRootBytes = [readFileSync(publicPath), readFileSync(dataPath)];
    expect(() => generateClosedReceipt("public-synthetic", { ...roots, now: () => new Date(first.getTime() + 1_000) }))
      .toThrow(/RECEIPT_OLD_BYTE_DRIFT/);
    expect(readFileSync(publicPath)).toEqual(unknownRootBytes[0]);
    expect(readFileSync(dataPath)).toEqual(unknownRootBytes[1]);

    writeFileSync(publicPath, currentSetBytes[0], { mode: 0o600 });
    writeFileSync(dataPath, currentSetBytes[1], { mode: 0o600 });
    crashReceiptProcess(roots, "public-synthetic", "after-first-install");
    expect(existsSync(resolve(roots.projectRoot, "app/.local/receipts/.public-receipt-v2.transaction/journal.json"))).toBe(true);
    crashReceiptProcess(roots, "public-synthetic", "during-recovery");
    expect(existsSync(resolve(roots.projectRoot, "app/.local/receipts/.public-receipt-v2.transaction/journal.json"))).toBe(true);
    writeFileSync(publicPath, "third-state\n", { mode: 0o600 });
    expect(() => generateClosedReceipt("public-synthetic", { ...roots, now: () => new Date(first.getTime() + 2_000) }))
      .toThrow(/RECEIPT_ROLLBACK/);
    expect(existsSync(resolve(roots.projectRoot, "app/.local/receipts/.public-receipt-v2.transaction/journal.json"))).toBe(true);
    writeFileSync(publicPath, currentSetBytes[0], { mode: 0o600 });
    const recovered = generateClosedReceipt("public-synthetic", {
      ...roots,
      now: () => new Date(first.getTime() + 3_000)
    });
    expect(recovered.dbReceipt.validatorRevision).toBe(CLOSED_RECEIPT_VALIDATOR_REVISION);
    expect(existsSync(resolve(roots.projectRoot, "app/.local/receipts/.public-receipt-v2.transaction"))).toBe(false);
    expect(readdirSync(resolve(roots.projectRoot, "app/.local/receipts")).some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });

  it("keeps legacy and source-management entries separate and exposes only the coarse receipt reason", () => {
    const legacyEntry = readFileSync(resolve(canonicalAppRoot, "scripts/profile-closed-receipt.ts"), "utf8");
    const sourceEntry = readFileSync(resolve(canonicalAppRoot, "scripts/source-management-closed-receipt.ts"), "utf8");
    const packageJson = readJson<{ scripts: Record<string, string> }>(resolve(canonicalAppRoot, "package.json"));
    expect(legacyEntry).not.toContain("source-management");
    expect(legacyEntry).not.toContain("generateSourceManagementClosedReceipt");
    expect(sourceEntry).toContain("generateSourceManagementClosedReceipt");
    expect(sourceEntry).toContain("SOURCE_MANAGEMENT_PROFILE_ID");
    expect(packageJson.scripts["profile:closed-receipt"]).toContain("scripts/profile-closed-receipt.ts");
    expect(packageJson.scripts["profile:source-management-closed-receipt"]).toContain("scripts/source-management-closed-receipt.ts");
    const internal = new ConfigError("RECEIPT_OLD_BYTE_DRIFT", "/private/tmp/secret payload");
    expect(safeReasonCode(internal)).toBe("RECEIPT_INTEGRITY");
    let bounded: unknown;
    try {
      runReceiptIntegrityBoundary(() => {
        throw new ConfigError("MIGRATION_DRIFT", "/private/tmp/migration.sql");
      });
    } catch (error) {
      bounded = error;
    }
    expect(safeReasonCode(bounded)).toBe("RECEIPT_INTEGRITY");
    expect(redactLogEvent({
      event: "cli_failure",
      status: "rejected",
      reasonCode: safeReasonCode(internal),
      externalCalls: 0
    })).toEqual({ event: "cli_failure", status: "rejected", reasonCode: "RECEIPT_INTEGRITY", externalCalls: 0 });
  });

  it("rejects ATTACH, cross-profile bytes, symlinks, path escape, receipt tamper, and old-byte drift", () => {
    const roots = tempProject("f1plus1-closed-negative-");
    preparePinnedWorkspace(roots);
    createPublicDatabase(roots);

    const isolated = mkdtempSync(join(tmpdir(), "f1plus1-attach-"));
    temporaryRoots.push(isolated);
    const database = openSafeDatabase(join(isolated, "state.sqlite"), { appRoot: isolated, allowTestRoot: isolated });
    try {
      expect(() => database.exec(`ATTACH DATABASE '${join(isolated, "other.sqlite")}' AS other`)).toThrow();
    } finally {
      closeDatabase(database);
    }

    renameSync(
      resolve(roots.appRoot, ".local/f1plus1-public-synthetic.sqlite"),
      resolve(roots.appRoot, ".local/f1plus1.sqlite")
    );
    expect(() => generateClosedReceipt("m3-shadow", roots)).toThrow(/PROFILE_LEDGER_MIX|PROFILE_MIX/);
    renameSync(
      resolve(roots.appRoot, ".local/f1plus1.sqlite"),
      resolve(roots.appRoot, ".local/f1plus1-public-synthetic.sqlite")
    );

    const outside = resolve(roots.projectRoot, "outside.sqlite");
    writeFileSync(outside, "outside", { mode: 0o600 });
    symlinkSync(outside, resolve(roots.appRoot, ".local/f1plus1.sqlite"));
    expect(() => generateClosedReceipt("m3-shadow", roots)).toThrow(/RECEIPT_PATH/);
    rmSync(resolve(roots.appRoot, ".local/f1plus1.sqlite"));
    expect(() => generateClosedReceipt("m3-shadow", { appRoot: roots.projectRoot, projectRoot: roots.projectRoot })).toThrow(/RECEIPT_PATH/);

    const externalReceipts = resolve(roots.projectRoot, "external-receipts");
    mkdirSync(externalReceipts, { mode: 0o755 });
    const externalModeBefore = lstatSync(externalReceipts).mode & 0o777;
    const temporaryReceiptDirectory = resolve(roots.appRoot, ".local/receipts");
    rmSync(temporaryReceiptDirectory, { recursive: true, force: true });
    symlinkSync(externalReceipts, temporaryReceiptDirectory);
    expect(() => generateClosedReceipt("m3-shadow", roots)).toThrow(/RECEIPT_PATH/);
    expect(lstatSync(externalReceipts).mode & 0o777).toBe(externalModeBefore);
    rmSync(resolve(roots.appRoot, ".local/receipts"));

    const validatorScript = resolve(roots.appRoot, "scripts/profile-closed-receipt.ts");
    const outsideValidator = resolve(roots.projectRoot, "outside-validator.ts");
    copyPinnedFile(validatorScript, outsideValidator);
    rmSync(validatorScript);
    symlinkSync(outsideValidator, validatorScript);
    expect(() => secureArtifactSha256(validatorScript, roots.projectRoot)).toThrow(/RECEIPT_VALIDATOR/);
    rmSync(validatorScript);
    copyPinnedFile(resolve(canonicalAppRoot, "scripts/profile-closed-receipt.ts"), validatorScript);

    const closed = generateClosedReceipt("public-synthetic", { ...roots, now: () => new Date("2026-08-09T08:01:00.000Z") });
    const publicReceiptPath = receiptPath(roots.projectRoot, CLOSED_RECEIPT_PATHS.public);
    const receipt = readJson<ClosedProfileReceipt>(publicReceiptPath);
    const canonicalBytes = readFileSync(publicReceiptPath, "utf8");
    writeFileSync(
      publicReceiptPath,
      canonicalBytes.replace(
        `"artifactRevision":"${receipt.artifactRevision}"`,
        `"artifactRevision":"${receipt.artifactRevision}","artifactRevision":"${receipt.artifactRevision}"`
      ),
      { mode: 0o600 }
    );
    expect(() => generateClosedReceipt("public-synthetic", roots)).toThrow(/RECEIPT_TAMPER/);

    writeFileSync(publicReceiptPath, `${JSON.stringify({ ...receipt, receiptSha256: "0".repeat(64) })}\n`, { mode: 0o600 });
    expect(() => generateClosedReceipt("public-synthetic", roots)).toThrow(/RECEIPT_TAMPER/);

    writeFileSync(publicReceiptPath, canonicalBytes, { mode: 0o600 });
    appendFileSync(resolve(roots.appRoot, ".local/f1plus1-public-synthetic.sqlite"), Buffer.from([0]));
    expect(() => generateClosedReceipt("public-synthetic", roots)).toThrow(/RECEIPT_OLD_BYTE_DRIFT/);

    writeFileSync(resolve(roots.appRoot, ".local/f1plus1-public-synthetic.sqlite-wal"), "committed-frame", { mode: 0o600 });
    writeFileSync(resolve(roots.appRoot, ".local/f1plus1-public-synthetic.sqlite-shm"), Buffer.alloc(32_768), { mode: 0o600 });
    const mainBeforeRejectedWal = readFileSync(resolve(roots.appRoot, ".local/f1plus1-public-synthetic.sqlite"));
    const walBeforeRejectedWal = readFileSync(resolve(roots.appRoot, ".local/f1plus1-public-synthetic.sqlite-wal"));
    expect(() => generateClosedReceipt("public-synthetic", roots)).toThrow(/RECEIPT_SIDECAR/);
    expect(readFileSync(resolve(roots.appRoot, ".local/f1plus1-public-synthetic.sqlite"))).toEqual(mainBeforeRejectedWal);
    expect(readFileSync(resolve(roots.appRoot, ".local/f1plus1-public-synthetic.sqlite-wal"))).toEqual(walBeforeRejectedWal);
  });
});
