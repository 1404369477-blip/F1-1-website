import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { isPublicStaticShellDirectory, isPublicStaticShellPath, PublicStaticShellBuildSchema } from "../src/features/stories/public-static-artifact.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output") throw new Error("PUBLIC_STATIC_OUTPUT_REQUIRED");
if (process.version !== "v24.18.0") throw new Error("PUBLIC_STATIC_NODE_VERSION_INVALID");
const outputRoot = resolve(args[1]);
if (existsSync(outputRoot)) throw new Error("PUBLIC_STATIC_OUTPUT_EXISTS");

const result = spawnSync(process.execPath, [join(appRoot, "node_modules/next/dist/bin/next"), "build", "public-site"], {
  cwd: appRoot,
  env: {
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1"
  },
  stdio: "inherit"
});
if (result.status !== 0) throw new Error("PUBLIC_STATIC_BUILD_FAILED");

const sourceRoot = join(appRoot, "public-site/out");
const hashes: Record<string, string> = {};
function inspect(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(sourceRoot, path).split("\\").join("/");
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("PUBLIC_STATIC_ARTIFACT_SYMLINK");
    if (stat.isDirectory()) {
      if (!isPublicStaticShellDirectory(name)) throw new Error("PUBLIC_STATIC_ARTIFACT_DIRECTORY_INVALID");
      inspect(path);
      continue;
    }
    if (!stat.isFile() || !isPublicStaticShellPath(name)) throw new Error("PUBLIC_STATIC_ARTIFACT_FILE_INVALID");
    const bytes = readFileSync(path);
    if (/\.(?:html|txt|js|css)$/u.test(name)) {
      const text = bytes.toString("utf8");
      if (/-----BEGIN (?:PRIVATE|OPENSSH|RSA|EC) (?:PRIVATE )?KEY-----|f1plus1-rss-real-private|projection-deployment\.json|\.ts\.net|sourceMappingURL\s*=/u.test(text)) throw new Error("PUBLIC_STATIC_ARTIFACT_PRIVATE_CONTENT");
    }
    hashes[name] = createHash("sha256").update(bytes).digest("hex");
  }
}
inspect(sourceRoot);
for (const required of ["index.html", "stories/index.html", "404.html"]) if (!hashes[required]) throw new Error("PUBLIC_STATIC_ARTIFACT_REQUIRED_MISSING");
mkdirSync(dirname(outputRoot), { recursive: true });
cpSync(sourceRoot, outputRoot, { recursive: true, errorOnExist: true, force: false });
writeFileSync(join(outputRoot, ".nojekyll"), "", { flag: "wx" });
hashes[".nojekyll"] = createHash("sha256").update("").digest("hex");
const files = Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)).map(([path, sha256]) => ({ path, sha256, bytes: lstatSync(join(outputRoot, path)).size }));
const receipt = PublicStaticShellBuildSchema.parse({ schemaVersion: "public-static-shell-build-v1", basePath: "/f1plus1", nodeVersion: process.version, files });
const receiptPath = `${outputRoot}.build-receipt.json`;
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ event: "PUBLIC_STATIC_BUILD_READY", outputRoot, receiptPath, fileCount: Object.keys(hashes).length })}\n`);
