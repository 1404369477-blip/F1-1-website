import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ADMIN_RELEASE_RUNTIME_FILES, ADMIN_RUNTIME_CLOSURE_SPEC, assertAdminReleaseRuntimePathContract } from "../server/admin-service/release-manifest.ts";
import { AdminDeploymentManifestSchema, assertXPageDeploymentTrustConfiguration } from "../server/admin-service/deployment.ts";
import { PUBLIC_RELEASE_RUNTIME_FILES, PUBLIC_RUNTIME_CLOSURE_SPEC, assertPublicReleaseRuntimePathContract } from "../server/public/release-manifest.ts";
import { deriveRuntimeLocalClosure } from "../server/release/local-closure.ts";
import { assertFullCapabilities, assertReleaseCandidate, buildReleaseSwitchReceipt, loadReleaseRuntimeGate, observeReleaseRuntime, releaseSchemaForBuildOptions } from "../server/internal-operation/release.ts";
import { canonicalJson } from "../server/db/profile.ts";
import { SOURCE_REGISTRY_SCHEMA10_SHA256 } from "../server/rss/source-registry-migration.ts";
import { RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 } from "../server/rss-automatic/source-epoch-schema-identity.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../server/x-page/admission-schema-identity.ts";
import { loadXPageRuntimeTrust } from "../server/x-page/deployment-trust.ts";
import { xPageAdmissionFixture } from "./helpers/x-page-admission.ts";
import { testXArtifactEnvironment } from "./helpers/x-page-artifacts.ts";
import { testReleaseHash, writeXPageReleasePair, xPageDeploymentFixture, xPageReleasePair } from "./helpers/x-page-release.ts";

const APP_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function privateRoot() { const root = mkdtempSync(join(realpathSync(tmpdir()), "x-release-contract-")); cleanup.push(() => rmSync(root, { force: true, recursive: true })); chmodSync(root, 0o700); return root; }
function deployment() {
  const root = privateRoot(), configPath = join(root, "trust.json");
  writeFileSync(configPath, "synthetic configuration bytes\n", { mode: 0o600 });
  const pair = xPageReleasePair(APP_ROOT);
  return { root, pair, manifest: xPageDeploymentFixture({ appRoot: APP_ROOT, dataRoot: root, pair, configPath, configSha256: testReleaseHash(readFileSync(configPath)) }) };
}

describe("0017 production release and deployment contract", () => {
  test("requires the explicit X flag and produces a paired exact schema with closed fallback automation", () => {
    expect(releaseSchemaForBuildOptions(["--x-page-production"])).toBe(X_PAGE_ADMISSION_SCHEMA_SHA256);
    expect(releaseSchemaForBuildOptions(["--rss-automatic"])).toBe(RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256);
    expect(releaseSchemaForBuildOptions([])).toBe(SOURCE_REGISTRY_SCHEMA10_SHA256);
    for (const args of [["--x-page"], ["--x-page-production", "--rss-automatic"], ["--x-page-production", "--x-page-production"]]) expect(() => releaseSchemaForBuildOptions(args)).toThrow("RELEASE_BUILD_OPTIONS_INVALID");
    const pair = xPageReleasePair(APP_ROOT);
    expect(pair.full.schemaSha256).toBe(X_PAGE_ADMISSION_SCHEMA_SHA256); expect(pair.fallback.schemaSha256).toBe(X_PAGE_ADMISSION_SCHEMA_SHA256);
    expect(pair.full.sourcePreimageSha256).toBe(pair.fallback.sourcePreimageSha256); expect(pair.full.files).toEqual(pair.fallback.files);
    for (const action of ["collector_network", "model_network", "automatic_review", "automatic_publish", "phase_enter", "phase_resume"] as const) { expect(pair.fullGate.allows(action)).toBe(true); expect(pair.fallbackGate.allows(action)).toBe(false); }
    expect(pair.fallbackGate.allows("delivery_sender")).toBe(true);
    expect(() => assertFullCapabilities({ ...pair.full, capabilities: { ...pair.full.capabilities, automaticReview: false, automaticPublish: false } })).toThrow("FULL_AUTOMATION_REGISTRATION_OPEN");
    expect(() => assertReleaseCandidate({ ...pair.full, schemaSha256: "f".repeat(64) })).toThrow("RELEASE_SCHEMA_IDENTITY_MISMATCH");
  });

  test("closes both AST runtime graphs, includes the real implementation and excludes experimental migration and producer fixtures", () => {
    assertAdminReleaseRuntimePathContract(); assertPublicReleaseRuntimePathContract();
    for (const [spec, paths] of [[ADMIN_RUNTIME_CLOSURE_SPEC, ADMIN_RELEASE_RUNTIME_FILES], [PUBLIC_RUNTIME_CLOSURE_SPEC, PUBLIC_RELEASE_RUNTIME_FILES]] as const) expect(deriveRuntimeLocalClosure(APP_ROOT, spec).filter((path) => !(paths as readonly string[]).includes(path))).toEqual([]);
    const paths = xPageReleasePair(APP_ROOT).full.files.map((file) => file.path);
    for (const path of ["migrations/rss-real/0017_x_page_production_admission.sql", "src/server/x-page/deployment-trust.ts", "src/server/x-page/capture-artifacts.ts", "src/server/x-page/import-port.ts", "src/server/x-page/automatic-worker.ts"]) expect(paths).toContain(path);
    expect(paths.some((path) => path.startsWith("src/tests/") || path.includes("test-adapter") || path.includes("0015_x") || path === "src/server/x-page/file-clone-migration.ts")).toBe(false);
    expect(() => assertAdminReleaseRuntimePathContract(ADMIN_RELEASE_RUNTIME_FILES.filter((path) => path !== "src/server/x-page/import-port.ts"))).toThrow();
  });

  test("loads externally anchored full and fallback files and refuses substituted package identities", () => {
    const pair = xPageReleasePair(APP_ROOT), input = writeXPageReleasePair(privateRoot(), pair);
    expect(loadReleaseRuntimeGate(input).gate.receipt.schemaSha256).toBe(X_PAGE_ADMISSION_SCHEMA_SHA256);
    expect(loadReleaseRuntimeGate({ ...input, activeRole: "manual_only_fallback_v10" }).gate.allows("automatic_publish")).toBe(false);
    expect(() => loadReleaseRuntimeGate({ ...input, expectedPackageRootSha256: "e".repeat(64) })).toThrow("RELEASE_EXTERNAL_ANCHOR_MISMATCH");
    expect(() => loadReleaseRuntimeGate({ ...input, fullManifestSha256: "e".repeat(64) })).toThrow("RELEASE_FULL_MANIFEST_FILE_INVALID");
  });

  test("observes a real 0017 file DB across full/fallback/rollback without rewriting histories", async () => {
    const env = await xPageAdmissionFixture(); cleanup.push(env.close); const pair = xPageReleasePair(APP_ROOT), lkg = "e".repeat(64);
    const full = observeReleaseRuntime(env.database, pair.fullGate, lkg), fallback = observeReleaseRuntime(env.database, pair.fallbackGate, lkg), rollback = observeReleaseRuntime(env.database, pair.rollbackGate, lkg);
    expect(buildReleaseSwitchReceipt(pair.receipt, full, fallback, rollback).schemaVersion).toBe("f1plus1-release-switch-v10");
    expect(() => observeReleaseRuntime(env.database, xPageReleasePair(APP_ROOT, RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256).fullGate, lkg)).toThrow("RELEASE_DATABASE_SCHEMA_IDENTITY_MISMATCH");
  });

  test("requires all three X pins and the retained RSS cutoff only on the exact successor", () => {
    const { manifest } = deployment(); expect(AdminDeploymentManifestSchema.parse(manifest)).toEqual(manifest); assertXPageDeploymentTrustConfiguration(manifest);
    for (const field of ["rssAutomaticCutoffIso", "xPageAutomaticCutoffIso", "xPageTrustConfigurationPath", "xPageTrustConfigurationSha256"] as const) expect(AdminDeploymentManifestSchema.safeParse({ ...manifest, [field]: undefined }).success).toBe(false);
    for (const role of ["full_v10", "manual_only_fallback_v10"]) expect(AdminDeploymentManifestSchema.safeParse({ ...manifest, activeReleaseRole: role }).success).toBe(true);
    const legacy = { ...manifest, reviewSchemaSha256: RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256, xPageAutomaticCutoffIso: undefined, xPageTrustConfigurationPath: undefined, xPageTrustConfigurationSha256: undefined };
    expect(AdminDeploymentManifestSchema.safeParse(legacy).success).toBe(true);
    expect(AdminDeploymentManifestSchema.safeParse({ ...manifest, reviewSchemaSha256: RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 }).success).toBe(false);
    expect(AdminDeploymentManifestSchema.safeParse({ ...manifest, reviewSchemaSha256: "f".repeat(64) }).success).toBe(false);
  });

  test("binds the final deployment hash to independently loaded real-file trust without a circular configuration pin", () => {
    const files = testXArtifactEnvironment(); cleanup.push(files.cleanup); const pair = xPageReleasePair(APP_ROOT);
    const relative = "src/server/x-page/normalize.ts", adapterSha256 = testReleaseHash(readFileSync(join(APP_ROOT, relative)));
    const config = { ...files.config, adapterRelativePath: relative, producerTrust: { ...files.config.producerTrust, adapterSha256 } };
    const configSha256 = files.put(files.configPath, config);
    const manifest = xPageDeploymentFixture({ appRoot: APP_ROOT, dataRoot: files.root, pair, configPath: files.configPath, configSha256 });
    assertXPageDeploymentTrustConfiguration(manifest);
    const deploymentSha256 = testReleaseHash(canonicalJson(manifest));
    const loaded = loadXPageRuntimeTrust({ configurationPath: manifest.xPageTrustConfigurationPath!, expectedConfigurationSha256: manifest.xPageTrustConfigurationSha256!, expectedDeploymentManifestSha256: deploymentSha256, releaseAppRoot: APP_ROOT });
    expect(loaded.trust.deploymentManifestSha256).toBe(deploymentSha256); expect(loaded.configurationSha256).toBe(configSha256);
    expect(Object.hasOwn(config.producerTrust, "deploymentManifestSha256")).toBe(false);
    files.put(files.configPath, { ...config, producerTrust: { ...config.producerTrust, deploymentManifestSha256: deploymentSha256 } });
    expect(() => assertXPageDeploymentTrustConfiguration(manifest)).toThrow("ADMIN_X_PAGE_TRUST_CONFIG_IDENTITY_INVALID");
  });

  test("rejects altered bytes, BOM normalization and group-readable configuration files", () => {
    const { manifest } = deployment(), path = manifest.xPageTrustConfigurationPath!;
    writeFileSync(path, "changed\n"); expect(() => assertXPageDeploymentTrustConfiguration(manifest)).toThrow("ADMIN_X_PAGE_TRUST_CONFIG_IDENTITY_INVALID");
    writeFileSync(path, "\uFEFFsynthetic configuration bytes\n"); expect(() => assertXPageDeploymentTrustConfiguration(manifest)).toThrow("X_CAPTURE_FILE_ENCODING_CHANGED");
    writeFileSync(path, "synthetic configuration bytes\n"); chmodSync(path, 0o640); expect(() => assertXPageDeploymentTrustConfiguration(manifest)).toThrow("PRIVATE_FILE_UNSAFE");
  });

  test("rejects parent aliases, non-private ancestors and paths outside the private data root", () => {
    const { root, manifest } = deployment(), parent = join(root, "group-readable"), nested = join(parent, "private");
    mkdirSync(nested, { recursive: true, mode: 0o700 }); const path = join(nested, "trust.json"); copyFileSync(manifest.xPageTrustConfigurationPath!, path);
    chmodSync(parent, 0o750); expect(() => assertXPageDeploymentTrustConfiguration({ ...manifest, xPageTrustConfigurationPath: path })).toThrow("ADMIN_X_PAGE_TRUST_DIRECTORY_INVALID");
    chmodSync(parent, 0o700); const alias = join(root, "alias"); symlinkSync(parent, alias);
    expect(() => assertXPageDeploymentTrustConfiguration({ ...manifest, xPageTrustConfigurationPath: join(alias, "private/trust.json") })).toThrow("ADMIN_X_PAGE_TRUST_DIRECTORY_INVALID");
    expect(AdminDeploymentManifestSchema.safeParse({ ...manifest, xPageTrustConfigurationPath: join(dirname(root), "outside.json") }).success).toBe(false);
  });

  test("accepts a deliberately relocated private trust configuration only after the new deployment pins it", () => {
    const { manifest } = deployment(), next = privateRoot(), path = join(next, "trust.json"); copyFileSync(manifest.xPageTrustConfigurationPath!, path);
    const changed = AdminDeploymentManifestSchema.parse({ ...manifest, dataRoot: next, xPageTrustConfigurationPath: path });
    expect(testReleaseHash(canonicalJson(changed))).not.toBe(testReleaseHash(canonicalJson(manifest))); expect(() => assertXPageDeploymentTrustConfiguration(changed)).not.toThrow();
  });
});
