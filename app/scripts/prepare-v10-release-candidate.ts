import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import {
  ADMIN_RELEASE_MANIFEST_PATH,
  ADMIN_RELEASE_RUNTIME_FILE_COUNT,
  ADMIN_RELEASE_RUNTIME_FILES,
  ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
  adminReleaseRuntimePathSetSha256,
  assertAdminReleaseRuntimePathContract,
  readVerifiedAdminReleaseManifest
} from "../src/server/admin-service/release-manifest.ts";
import {
  PUBLIC_RELEASE_RUNTIME_FILE_COUNT,
  PUBLIC_RELEASE_RUNTIME_FILES,
  PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
  assertPublicReleaseRuntimePathContract
} from "../src/server/public/release-manifest.ts";
import { canonicalJsonV1 } from "../src/server/internal-operation/gateway.ts";
import {
  assertReleasePair,
  buildReleasePairReceipt,
  collectReleaseFiles,
  fallbackV10Capabilities,
  fullV10Capabilities,
  releaseIdForRole,
  releasePathRoot,
  releaseSourcePreimageSha256,
  type ReleaseCandidateManifest
} from "../src/server/internal-operation/release.ts";
import {
  SOURCE_REGISTRY_MIGRATION_SHA256,
  SOURCE_REGISTRY_SCHEMA10_SHA256,
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256
} from "../src/server/rss/source-registry-migration.ts";

const appRoot = resolve(new URL("../", import.meta.url).pathname);
const repoRoot = resolve(appRoot, "..");
const targetNodePath = process.env.ADMIN_TARGET_NODE_PATH;
const candidateRootInput = process.env.F1_V10_CANDIDATE_ROOT;

if (targetNodePath !== "/Users/chanai/.local/node-v24.18.0-darwin-arm64/bin/node") {
  throw new Error("ADMIN_TARGET_NODE_PATH_MISMATCH");
}
if (process.execPath !== targetNodePath || process.version !== "v24.18.0") {
  throw new Error(`NODE_TOOLCHAIN_DRIFT:${process.execPath}:${process.version}`);
}
const expectedUid = process.getuid?.();
if (expectedUid === undefined) throw new Error("PROCESS_UID_UNAVAILABLE");
if (!candidateRootInput) throw new Error("F1_V10_CANDIDATE_ROOT_REQUIRED");

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

type CommandReceipt = Readonly<{
  command: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  outputSha256: string;
  outputTail: string;
}>;

function command(name: string, args: readonly string[], cwd: string, environmentOverrides: Partial<NodeJS.ProcessEnv> = {}): CommandReceipt {
  const result = spawnSync(name, [...args], {
    cwd,
    env: { ...exactEnvironment, ...environmentOverrides },
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024
  });
  const output = String(result.stdout ?? "") + String(result.stderr ?? "");
  return Object.freeze({
    command: [name, ...args].join(" "),
    status: result.status,
    signal: result.signal,
    outputSha256: sha256(output),
    outputTail: output.slice(-8000)
  });
}

function mustPass(label: string, result: CommandReceipt): void {
  if (result.status !== 0) throw new Error(`${label}_FAILED:${result.outputTail}`);
}

function assertSymlinkInsideRoot(rootReal: string, path: string): void {
  let resolved;
  try {
    resolved = realpathSync(resolve(dirname(path), readlinkSync(path)));
  } catch (error) {
    throw new Error(`SYMLINK_BROKEN:${path}:${(error as NodeJS.ErrnoException).code ?? "UNKNOWN"}`);
  }
  const relativeToRoot = relative(rootReal, resolved);
  if (relativeToRoot === ".." || relativeToRoot.startsWith("../")) {
    throw new Error(`SYMLINK_ESCAPES_ROOT:${path}:${readlinkSync(path)}`);
  }
  void statSync(resolved);
}

function assertContainedSymlinks(root: string): void {
  const rootReal = realpathSync(root);
  const queue: string[] = [root];
  while (queue.length > 0) {
    const path = queue.pop()!;
    const descriptor = statSync(path);
    if (descriptor.uid !== expectedUid) throw new Error(`COPY_UID_DRIFT:${path}`);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        assertSymlinkInsideRoot(rootReal, child);
        continue;
      }
      if (entry.isDirectory()) queue.push(child);
      else if (!entry.isFile()) throw new Error(`UNSUPPORTED_COPY_ENTRY:${child}`);
    }
  }
}

function pathRoot(root: string): string {
  const paths: string[] = [];
  const rootReal = realpathSync(root);
  const visit = (path: string): void => {
    const relativePath = path === root ? "" : path.slice(root.length + 1);
    if (relativePath) paths.push(relativePath);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        const child = join(path, entry.name);
        assertSymlinkInsideRoot(rootReal, child);
        paths.push(`${relative(root, child)}\0symlink\0${readlinkSync(child)}`);
        continue;
      }
      if (entry.isDirectory()) visit(join(path, entry.name));
      else if (entry.isFile()) continue;
      else throw new Error(`UNSUPPORTED_HASH_ENTRY:${join(path, entry.name)}`);
    }
  };
  visit(root);
  return createHash("sha256").update(paths.sort().map((path) => `${path}\n`).join("")).digest("hex");
}

if (process.version !== "v24.18.0") throw new Error("NODE_VERSION_DRIFT:" + process.version);
const npmPath = resolve(dirname(process.execPath), "npm");
const exactEnvironment = Object.freeze({
  ...process.env,
  PATH: dirname(process.execPath) + ":" + (process.env.PATH ?? "/usr/bin:/bin")
});
const npmVersion = execFileSync(npmPath, ["--version"], { encoding: "utf8", env: exactEnvironment }).trim();
if (npmVersion !== "11.16.0") throw new Error("NPM_VERSION_DRIFT:" + npmVersion);
if (
  SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256 !== "d3a8e3de9ade121766af72e648b1cc5986bfd93556c091563ae66e58b0eedebd" ||
  SOURCE_REGISTRY_MIGRATION_SHA256 !== "83c1aa4e350bc32fee594ffa4bec9caa85201ae120c29e21834c32463e36bb7a" ||
  SOURCE_REGISTRY_SCHEMA10_SHA256 !== "e802727799654dd3e02f1b8abe6ce071dc7c96a09d9a6110c52be080d13dda4f"
) throw new Error("SCHEMA10_PIN_DRIFT");
assertAdminReleaseRuntimePathContract();
assertPublicReleaseRuntimePathContract();
if (
  ADMIN_RELEASE_RUNTIME_FILE_COUNT !== 153 ||
  ADMIN_RELEASE_RUNTIME_FILES.length !== 153 ||
  adminReleaseRuntimePathSetSha256() !== ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256 ||
  PUBLIC_RELEASE_RUNTIME_FILE_COUNT !== 89 ||
  PUBLIC_RELEASE_RUNTIME_FILES.length !== 89
) throw new Error("RELEASE_RUNTIME_CLOSURE_DRIFT");

const candidateRoot = resolve(candidateRootInput);
const releasesParent = dirname(candidateRoot);
const candidateName = candidateRoot.split("/").pop() ?? "";
if (!candidateName || candidateRoot.startsWith(".") || candidateRoot.includes("..")) {
  throw new Error("CANDIDATE_NAME_INVALID");
}
if (releasesParent !== "/Users/chanai/F1-1-website/releases") {
  throw new Error("CANDIDATE_PARENT_INVALID");
}
const parentDescriptor = statSync(releasesParent);
if (!parentDescriptor.isDirectory() || parentDescriptor.uid !== expectedUid) {
  throw new Error("RELEASES_PARENT_INVALID");
}
try {
  statSync(candidateRoot);
  throw new Error("CANDIDATE_ROOT_ALREADY_EXISTS");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

let stageRoot: string | undefined;
let candidateStageRoot: string | undefined;
try {
  stageRoot = mkdtempSync(join(tmpdir(), "f1plus1-v10-candidate-stage-"));
  chmodSync(stageRoot, 0o700);
  const stageAppRoot = resolve(stageRoot, "app");
  mkdirSync(stageAppRoot, { recursive: true, mode: 0o700 });
  const stageCopy = command("rsync", [
    "-a", "--delete",
    "--exclude", "node_modules",
    "--exclude", ".next",
    "--exclude", ".local",
    "--exclude", ".env",
    "--exclude", ".env.*",
    appRoot + "/",
    stageAppRoot + "/"
  ], appRoot);
  mustPass("STAGE_COPY", stageCopy);
  // The global .env* exclusion intentionally keeps secret-bearing files out.
  // The public env contract is a pinned admin runtime closure input and is
  // therefore restored explicitly for the disposable stage.
  copyFileSync(resolve(appRoot, ".env.example"), resolve(stageAppRoot, ".env.example"));
  const projectAssetDirectory = resolve(stageRoot, "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic");
  mkdirSync(projectAssetDirectory, { recursive: true, mode: 0o700 });
  copyFileSync(
    resolve(repoRoot, "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json"),
    resolve(projectAssetDirectory, "runtime-graph.public-multimedia-pagination-synthetic.json")
  );
  const packageJsonPath = resolve(stageAppRoot, "package.json");
  const packageLockPath = resolve(stageAppRoot, "package-lock.json");
  const stagedPackageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
  const stagedPackageLock = JSON.parse(readFileSync(packageLockPath, "utf8")) as {
    packages?: Record<string, Record<string, unknown>>;
  };
  if (!stagedPackageLock.packages || typeof stagedPackageLock.packages !== "object") throw new Error("PACKAGE_LOCK_ROOT_MISSING");
  stagedPackageLock.packages[""]!.scripts = structuredClone(stagedPackageJson.scripts);
  writeFileSync(packageLockPath, `${JSON.stringify(stagedPackageLock, null, 2)}\n`, { mode: 0o600 });
  const packageLockSyncOutputSha256 = sha256(readFileSync(packageLockPath));

  const gitCommands = [
    ["init", "-q"],
    ["config", "user.name", "F1+1 V10 Candidate Prepare"],
    ["config", "user.email", "v10-candidate@example.invalid"],
    ["commit", "--allow-empty", "-q", "-m", "synthetic release parent"],
    ["add", "--", "app", "data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json"],
    ["commit", "-q", "-m", "v10 release candidate"]
  ] as const;
  let syntheticGit!: CommandReceipt;
  for (const args of gitCommands) {
    syntheticGit = command("/usr/bin/git", args, stageRoot);
    mustPass("STAGE_GIT", syntheticGit);
  }

  const releaseBuild = command(process.execPath, ["--experimental-strip-types", "scripts/admin-release-build.ts"], stageAppRoot);
  mustPass("RELEASE_BUILD", releaseBuild);
  const officialManifestBytes = readFileSync(resolve(stageAppRoot, ADMIN_RELEASE_MANIFEST_PATH));
  const officialManifestSha256 = sha256(officialManifestBytes);
  const officialVerifier = command(
    process.execPath,
    ["--experimental-strip-types", "scripts/admin-verify-release-stage.ts"],
    stageAppRoot,
    { ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256: officialManifestSha256 }
  );
  mustPass("OFFICIAL_STAGE_VERIFIER", officialVerifier);

  const runtimePaths = [...new Set([...ADMIN_RELEASE_RUNTIME_FILES, ...PUBLIC_RELEASE_RUNTIME_FILES])];
  const files = collectReleaseFiles(stageAppRoot, runtimePaths);
  const sourceCommitSha1 = execFileSync("/usr/bin/git", ["-C", stageRoot, "rev-parse", "HEAD"], { encoding: "utf8", env: exactEnvironment }).trim();
  const sourceTreeSha1 = execFileSync("/usr/bin/git", ["-C", stageRoot, "rev-parse", "HEAD^{tree}"], { encoding: "utf8", env: exactEnvironment }).trim();
  const packageRootSha256 = (JSON.parse(officialManifestBytes.toString("utf8")) as { releaseRootSha256?: unknown }).releaseRootSha256;
  if (typeof packageRootSha256 !== "string" || !/^[0-9a-f]{64}$/.test(packageRootSha256)) {
    throw new Error("RELEASE_PACKAGE_ROOT_MISSING");
  }
  const identity = {
    schemaVersion: 10 as const,
    sourceCommitSha1,
    sourceTreeSha1,
    schemaSha256: SOURCE_REGISTRY_SCHEMA10_SHA256,
    migration0009RawSha256: SOURCE_REGISTRY_SOURCE_0009_RAW_SHA256,
    migration0010RawSha256: SOURCE_REGISTRY_MIGRATION_SHA256,
    adminRuntimeFileCount: 153 as const,
    adminRuntimePathSetSha256: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
    publicRuntimeFileCount: 89 as const,
    publicRuntimePathSetSha256: PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256,
    packageLockSha256: files.find((file) => file.path === "package-lock.json")!.sha256,
    packageRootSha256,
    pathRootSha256: releasePathRoot(files)
  };
  const sourcePreimageSha256 = releaseSourcePreimageSha256(identity);
  const base = { ...identity, sourcePreimageSha256, files };
  const full = Object.freeze({
    ...base,
    role: "full_v10" as const,
    releaseId: releaseIdForRole("full_v10", sourcePreimageSha256),
    capabilities: fullV10Capabilities()
  }) satisfies ReleaseCandidateManifest;
  const fallback = Object.freeze({
    ...base,
    role: "manual_only_fallback_v10" as const,
    releaseId: releaseIdForRole("manual_only_fallback_v10", sourcePreimageSha256),
    capabilities: fallbackV10Capabilities()
  }) satisfies ReleaseCandidateManifest;
  const pairReceipt = buildReleasePairReceipt(full, fallback, new Date().toISOString());
  assertReleasePair(full, fallback, pairReceipt);
  const releaseDirectory = resolve(stageAppRoot, ".local/release");
  mkdirSync(releaseDirectory, { recursive: true, mode: 0o700 });
  const fullJson = canonicalJsonV1(full);
  const fallbackJson = canonicalJsonV1(fallback);
  const pairJson = canonicalJsonV1(pairReceipt);
  writeFileSync(resolve(releaseDirectory, "full_v10.manifest.json"), fullJson, { mode: 0o600 });
  writeFileSync(resolve(releaseDirectory, "manual_only_fallback_v10.manifest.json"), fallbackJson, { mode: 0o600 });
  writeFileSync(resolve(releaseDirectory, "release-pair.receipt.json"), pairJson, { mode: 0o600 });
  for (const name of ["full_v10.manifest.json", "manual_only_fallback_v10.manifest.json", "release-pair.receipt.json"]) {
    chmodSync(resolve(releaseDirectory, name), 0o600);
  }

  const receiptCore = Object.freeze({
    schemaVersion: "f1plus1-v10-candidate-prepare-receipt-v1" as const,
    status: "V10_CANDIDATE_PASS_NO_DEPLOY" as const,
    deployDecision: "NO_DEPLOY_NO_PRODUCTION_ACTION" as const,
    candidate: { root: candidateRoot, appRoot: resolve(candidateRoot, "app") },
    source: { repoRoot, stageRoot, syntheticGitCommit: sourceCommitSha1 },
    tree: { syntheticGitTree: sourceTreeSha1, stageAppRootSha256BeforeCopy: pathRoot(stageAppRoot) },
    toolchain: { nodePath: process.execPath, node: process.version, npm: npmVersion },
    releaseIds: { full: full.releaseId, fallback: fallback.releaseId, pair: pairReceipt.pairId },
    hashes: {
      officialAdminManifest: officialManifestSha256,
      fullManifest: pairReceipt.fullManifestSha256,
      fallbackManifest: pairReceipt.fallbackManifestSha256,
      pair: sha256(pairJson),
      sourcePreimage: sourcePreimageSha256,
      stageAppRoot: pathRoot(stageAppRoot)
    },
    closures: {
      adminRuntimeFileCount: 153,
      publicRuntimeFileCount: 89,
      adminRuntimePathSet: ADMIN_RELEASE_RUNTIME_PATH_SET_SHA256,
      publicRuntimePathSet: PUBLIC_RELEASE_RUNTIME_PATH_SET_SHA256
    },
    commands: { stageCopy, syntheticGit, releaseBuild, officialVerifier },
    productionWrites: 0,
    serviceActions: 0,
    launchAgentChanges: 0
  });
  const coreJson = canonicalJsonV1(receiptCore);
  writeFileSync(resolve(releaseDirectory, "prepare-receipt-core.json"), coreJson, { mode: 0o600 });

  candidateStageRoot = join(releasesParent, `.${candidateName}.prepare-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    statSync(candidateStageRoot);
    throw new Error("ATOMIC_STAGE_COLLISION");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(candidateStageRoot, { recursive: true, mode: 0o700 });
  execFileSync("rsync", ["-a", stageAppRoot + "/", resolve(candidateStageRoot, "app") + "/"], { env: exactEnvironment });
  execFileSync("rsync", ["-a", resolve(stageRoot, "data") + "/", resolve(candidateStageRoot, "data") + "/"], { env: exactEnvironment });
  chmodSync(candidateStageRoot, 0o700);
  assertContainedSymlinks(candidateStageRoot);
  const candidateAppRoot = resolve(candidateStageRoot, "app");
  let candidateVerifierOutputSha256 = "";
  try {
    readVerifiedAdminReleaseManifest(
      candidateAppRoot,
      resolve(candidateAppRoot, ADMIN_RELEASE_MANIFEST_PATH),
      officialManifestSha256,
      targetNodePath,
      process.execPath
    );
    candidateVerifierOutputSha256 = sha256(canonicalJsonV1({
      implementation: "readVerifiedAdminReleaseManifest",
      appRoot: candidateAppRoot,
      manifestPath: resolve(candidateAppRoot, ADMIN_RELEASE_MANIFEST_PATH),
      expectedSha256: officialManifestSha256,
      targetNodePath,
      localNodePath: process.execPath,
      status: "PASS"
    }));
  } catch (error) {
    const reasonCode = (error as { code?: unknown }).code;
    throw new Error(`OFFICIAL_CANDIDATE_VERIFIER:${(error as Error).name}:${typeof reasonCode === "string" ? reasonCode : "UNKNOWN"}:${(error as Error).message}`);
  }
  const finalReceipt = Object.freeze({
    ...receiptCore,
    candidateVerification: Object.freeze({
      status: "PASS" as const,
      candidateAppRootSha256: pathRoot(candidateAppRoot),
      verifierOutputSha256: candidateVerifierOutputSha256
    })
  });
  const finalReceiptJson = canonicalJsonV1(finalReceipt);
  writeFileSync(resolve(candidateStageRoot, "prepare-receipt.json"), finalReceiptJson, { mode: 0o600 });
  renameSync(candidateStageRoot, candidateRoot);
  candidateStageRoot = undefined;
  process.stdout.write(canonicalJsonV1({
    status: finalReceipt.status,
    candidateRoot,
    fullReleaseId: full.releaseId,
    fallbackReleaseId: fallback.releaseId,
    pairId: pairReceipt.pairId,
    officialAdminManifestSha256: officialManifestSha256,
    fullManifestSha256: pairReceipt.fullManifestSha256,
    fallbackManifestSha256: pairReceipt.fallbackManifestSha256,
    pairSha256: sha256(pairJson),
    sourceCommitSha1,
    sourceTreeSha1,
    sourcePreimageSha256,
    stageAppRootSha256: receiptCore.tree.stageAppRootSha256BeforeCopy,
    candidateAppRootSha256: finalReceipt.candidateVerification.candidateAppRootSha256,
    prepareReceiptSha256: sha256(finalReceiptJson)
  }) + "\n");
} finally {
  if (stageRoot?.startsWith(tmpdir())) rmSync(stageRoot, { recursive: true, force: true });
  if (candidateStageRoot?.startsWith(releasesParent)) rmSync(candidateStageRoot, { recursive: true, force: true });
}
