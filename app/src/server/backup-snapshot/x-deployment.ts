import { dirname, relative, resolve, sep } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { z } from "zod";
import { readXCapturePrivateFile } from "../x-page/private-artifact-file.ts";
import { loadXPageRuntimeTrust } from "../x-page/deployment-trust.ts";
import { X_PAGE_ADMISSION_SCHEMA_SHA256 } from "../x-page/admission-schema-identity.ts";
import { xCaptureSha256 } from "../x-page/trusted-capture.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const DeploymentPins = z.object({ schemaVersion: z.literal("admin-service-deployment-v3"), reviewSchemaSha256: z.literal(X_PAGE_ADMISSION_SCHEMA_SHA256),
  reviewDatabasePath: z.string(), publicProjectionRoot: z.string(), dataRoot: z.string(), targetReleaseAppRoot: z.string(),
  reviewDatabaseIdentity: z.object({ dev: z.number().int().nonnegative().safe(), ino: z.number().int().nonnegative().safe(),
    uid: z.number().int().nonnegative().safe(), nlink: z.literal(1) }).strict(),
  xPageTrustConfigurationPath: z.string(), xPageTrustConfigurationSha256: Hash }).passthrough();
function assert(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

/** The caller supplies the expected SHA from its trusted deployment invocation.
 * Only the already pinned deployment may select B's configuration and release
 * adapter. No caller-supplied artifact root or capture metadata is accepted. */
export function loadXPageBackupDeploymentTrust(input: Readonly<{ deploymentManifestPath: string; expectedDeploymentManifestSha256: string;
  sourceDbPath: string; projectionRoot: string;
}>) {
  Hash.parse(input.expectedDeploymentManifestSha256);
  const file = readXCapturePrivateFile(input.deploymentManifestPath, 256 * 1024);
  assert(file && xCaptureSha256(file.text) === input.expectedDeploymentManifestSha256, "X_BACKUP_DEPLOYMENT_IDENTITY_INVALID");
  const deployment = DeploymentPins.parse(JSON.parse(file.text));
  assert(deployment.reviewDatabasePath === resolve(input.sourceDbPath) && deployment.publicProjectionRoot === resolve(input.projectionRoot), "X_BACKUP_DEPLOYMENT_TARGET_MISMATCH");
  const db = lstatSync(input.sourceDbPath), expectedDb = deployment.reviewDatabaseIdentity;
  assert(realpathSync(input.sourceDbPath) === input.sourceDbPath && db.isFile() && !db.isSymbolicLink() && !(db.mode & 0o077)
    && db.uid === process.getuid?.() && db.dev === expectedDb.dev && db.ino === expectedDb.ino
    && db.uid === expectedDb.uid && db.nlink === expectedDb.nlink, "X_BACKUP_DEPLOYMENT_DATABASE_IDENTITY_INVALID");
  const config = deployment.xPageTrustConfigurationPath, dataRoot = deployment.dataRoot, rel = relative(dataRoot, config);
  assert(resolve(config) === config && resolve(dataRoot) === dataRoot && rel !== "" && !rel.startsWith(sep)
    && rel !== ".." && !rel.startsWith(".." + sep), "X_BACKUP_CONFIGURATION_PATH_INVALID");
  const directories: Array<{ path: string; device: number; inode: number }> = [];
  for (let path = dirname(config); ; path = dirname(path)) {
    const stat = lstatSync(path);
    assert(realpathSync(path) === path && stat.isDirectory() && !stat.isSymbolicLink()
      && stat.uid === process.getuid?.() && !(stat.mode & 0o077), "X_BACKUP_CONFIGURATION_DIRECTORY_INVALID");
    directories.push({ path, device: stat.dev, inode: stat.ino }); if (path === dataRoot) break;
  }
  const trust = loadXPageRuntimeTrust({ configurationPath: config, expectedConfigurationSha256: deployment.xPageTrustConfigurationSha256,
    expectedDeploymentManifestSha256: input.expectedDeploymentManifestSha256, releaseAppRoot: deployment.targetReleaseAppRoot });
  for (const before of directories) {
    const after = lstatSync(before.path);
    assert(realpathSync(before.path) === before.path && after.dev === before.device && after.ino === before.inode, "X_BACKUP_CONFIGURATION_DIRECTORY_CHANGED");
  }
  const after = readXCapturePrivateFile(input.deploymentManifestPath, 256 * 1024);
  assert(after?.identity === file.identity && after.text === file.text, "X_BACKUP_DEPLOYMENT_CHANGED");
  return Object.freeze({ runtimeTrust: trust, sourceDatabaseIdentity: Object.freeze(expectedDb) });
}
