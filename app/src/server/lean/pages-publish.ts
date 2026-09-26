import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { PAGES_BRANCH, PAGES_CNAME, PAGES_DEPLOY_KEY, PAGES_HTTPS_REMOTE, PAGES_KNOWN_HOSTS, PAGES_REMOTE, PAGES_TOKEN_PATH, PAGES_UI_DIRECTORY, PAGES_WORKFLOW, leanPath } from "./config.ts";
import type { SiteBundle } from "./site-bundle.ts";

const GIT_TIMEOUT_MS = 120_000;

type Git = (args: string[], allowFailure?: boolean) => { status: number; stdout: string };

function readToken(): string | null {
  if (!existsSync(PAGES_TOKEN_PATH)) return null;
  const token = readFileSync(PAGES_TOKEN_PATH, "utf8").trim();
  if (token === "") return null;
  if (!/^[A-Za-z0-9_]+$/.test(token)) throw new Error("PAGES_TOKEN_INVALID");
  return token;
}

/** HTTPS with the repo-scoped token when configured; otherwise the SSH deploy key. */
function createGit(cwd: string): { git: Git; remote: string } {
  const env: Record<string, string> = {
    HOME: cwd,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: `/usr/bin/ssh -F /dev/null -p 443 -i ${PAGES_DEPLOY_KEY} -o UserKnownHostsFile=${PAGES_KNOWN_HOSTS} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15`
  };
  const token = readToken();
  if (token !== null) {
    // Passed through the environment so the token never appears in the process list.
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  const git: Git = (args, allowFailure = false) => {
    const result = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      { cwd, env, encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const status = result.status ?? -1;
    if (!allowFailure && (result.error || status !== 0)) throw new Error(`GIT_${args[0]?.toUpperCase()}_FAILED: ${(result.stderr ?? result.error?.message ?? "").slice(0, 800)}`);
    return { status, stdout: (result.stdout ?? "").trim() };
  };
  return { git, remote: token === null ? PAGES_REMOTE : PAGES_HTTPS_REMOTE };
}

const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const GENERATION_KEEP_COUNT = 6;
const GENERATION_KEEP_MS = 60 * 60 * 1000;
const GENERATION_ID = /^[0-9a-f]{64}$/;
const MEDIA_REF = /media\/[a-f0-9]{16,}\.webp/g;

export type GenerationRecord = { id: string; publishedAt: string; generatedAt?: string };

/** Keeps the larger of the newest six publishes and every publish from the last hour. */
export function retainedGenerationIds(entries: readonly GenerationRecord[], now: Date): string[] {
  const sorted = [...entries].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
  const newest = sorted.slice(0, GENERATION_KEEP_COUNT).map((entry) => entry.id);
  const recent = sorted.filter((entry) => {
    const at = Date.parse(entry.publishedAt);
    return Number.isFinite(at) && now.getTime() - at <= GENERATION_KEEP_MS;
  }).map((entry) => entry.id);
  return [...new Set(recent.length > newest.length ? recent : newest)];
}

function readGenerationManifest(directory: string): GenerationRecord[] {
  const path = join(directory, "manifest.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { generations?: GenerationRecord[] };
    return Array.isArray(parsed.generations)
      ? parsed.generations.filter((entry) => typeof entry?.id === "string" && GENERATION_ID.test(entry.id) && typeof entry.publishedAt === "string")
      : [];
  } catch {
    return [];
  }
}

function mediaRefsUnder(directory: string): string[] {
  const found = new Set<string>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(MEDIA_REF)) found.add(match[0]);
    }
  };
  if (existsSync(directory)) walk(directory);
  return [...found];
}

/**
 * Replaces gh-pages with a single parentless commit of the UI shell plus `bundle`.
 * Without history, pictures that left the site are garbage-collected instead of growing the repository forever.
 */
export function publishBundle(checkout: string, bundle: SiteBundle): string {
  mkdirSync(checkout, { recursive: true, mode: 0o700 });
  const { git, remote } = createGit(checkout);
  if (!existsSync(join(checkout, ".git"))) git(["init", `--initial-branch=${PAGES_BRANCH}`]);
  // The fetched tip lets the push skip every blob GitHub already has.
  git(["fetch", "--no-tags", "--depth=1", remote, PAGES_BRANCH]);
  git(["reset", "--hard", "FETCH_HEAD"]);
  stageSite(checkout, bundle);
  git(["add", "--all"]);
  const tree = git(["write-tree"]).stdout;
  const commit = git(["-c", "user.name=F1+1 Lean Publisher", "-c", "user.email=pages@users.noreply.github.com",
    "commit-tree", tree, "-m", `Publish ${bundle.itemCount} stories (${bundle.bundleId.slice(0, 12)})`]).stdout;
  git(["push", "--force", "--porcelain", remote, `${commit}:refs/heads/${PAGES_BRANCH}`]);
  git(["reset", "-q", "--soft", commit]);
  return commit;
}

/** Writes the complete gh-pages tree (UI shell, bundle, workflow) into `root`, replacing everything but `.git`. */
export function stageSite(root: string, bundle: SiteBundle, options?: { now?: Date; uiDirectory?: string }): void {
  const now = options?.now ?? new Date();
  const uiDirectory = options?.uiDirectory ?? PAGES_UI_DIRECTORY;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const previousSite = join(root, "site");
  const scratch = mkdtempSync(join(tmpdir(), "f1-generations-"));
  try {
    const previousGenerations = join(previousSite, "_public/generations");
    if (existsSync(previousGenerations)) cpSync(previousGenerations, join(scratch, "generations"), { recursive: true });
    if (existsSync(join(previousSite, "media"))) cpSync(join(previousSite, "media"), join(scratch, "media"), { recursive: true });
    for (const name of readdirSync(root)) if (name !== ".git") rmSync(join(root, name), { recursive: true, force: true });

    const site = join(root, "site");
    cpSync(uiDirectory, site, { recursive: true });
    for (const [path, bytes] of bundle.files) {
      mkdirSync(dirname(join(site, path)), { recursive: true });
      writeFileSync(join(site, path), bytes);
    }
    if (bundle.mediaFiles.size > 0) mkdirSync(join(site, "media"));
    for (const [path, file] of bundle.mediaFiles) cpSync(file, join(site, path));
    restoreGenerations(site, scratch, bundle.bundleId, now);
    writeFileSync(join(site, ".nojekyll"), "");
    // The Pages workflow reads CNAME from the branch root. The published site root is `site/`, so both copies are required.
    writeFileSync(join(root, "CNAME"), `${PAGES_CNAME}\n`);
    writeFileSync(join(site, "CNAME"), `${PAGES_CNAME}\n`);
    const calendarFile = leanPath("f1-calendar.json");
    if (existsSync(calendarFile)) {
      mkdirSync(join(site, "data"), { recursive: true });
      cpSync(calendarFile, join(site, "data/f1-calendar.json"));
    }
    writeFileSync(join(site, "_deployment.json"), JSON.stringify({
      schemaVersion: "public-static-deployment-v1",
      bundleId: bundle.bundleId,
      uiManifestSha256: sha256File(join(dirname(uiDirectory), "ui.build-receipt.json")),
      workflowSha256: sha256File(PAGES_WORKFLOW)
    }));
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    cpSync(PAGES_WORKFLOW, join(root, ".github/workflows/pages.yml"));
    mkdirSync(join(root, ".sync"));
    writeFileSync(join(root, ".sync/publication.json"), JSON.stringify({
      schemaVersion: "lean-publication-v1",
      bundleId: bundle.bundleId,
      contentFingerprint: bundle.contentFingerprint
    }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function generatedAtFrom(directory: string, fallback: string): string {
  const indexPath = join(directory, "index.json");
  if (!existsSync(indexPath)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as { generatedAt?: string };
    return typeof parsed.generatedAt === "string" ? parsed.generatedAt : fallback;
  } catch {
    return fallback;
  }
}

function realPublishedAt(directory: string, publishedAt: string | undefined): string {
  if (publishedAt && !publishedAt.startsWith("1970-01-01")) return publishedAt;
  const generated = generatedAtFrom(directory, "");
  if (generated !== "" && !generated.startsWith("1970-01-01")) return generated;
  if (existsSync(directory)) {
    const mtime = statSync(directory).mtime.toISOString();
    if (!mtime.startsWith("1970-01-01")) return mtime;
  }
  return publishedAt ?? new Date(0).toISOString();
}

function restoreGenerations(site: string, scratch: string, currentId: string, now: Date): void {
  const scratchGenerations = join(scratch, "generations");
  const known = readGenerationManifest(scratchGenerations);
  const seen = new Set(known.map((entry) => entry.id));
  if (existsSync(scratchGenerations)) {
    for (const name of readdirSync(scratchGenerations)) {
      if (!GENERATION_ID.test(name) || seen.has(name)) continue;
      const directory = join(scratchGenerations, name);
      known.push({ id: name, publishedAt: realPublishedAt(directory, undefined), generatedAt: generatedAtFrom(directory, new Date(0).toISOString()) });
    }
  }
  const currentDir = join(site, `_public/generations/${currentId}`);
  const records = [
    ...known.filter((entry) => entry.id !== currentId).map((entry) => {
      const directory = join(scratchGenerations, entry.id);
      const publishedAt = realPublishedAt(directory, entry.publishedAt);
      return { ...entry, publishedAt, generatedAt: entry.generatedAt ?? generatedAtFrom(directory, publishedAt) };
    }),
    { id: currentId, publishedAt: now.toISOString(), generatedAt: generatedAtFrom(currentDir, now.toISOString()) }
  ];
  const keep = new Set(retainedGenerationIds(records, now));
  keep.add(currentId);
  const destination = join(site, "_public/generations");
  mkdirSync(destination, { recursive: true });
  for (const id of keep) {
    if (id === currentId) continue;
    const from = join(scratchGenerations, id);
    if (!existsSync(from)) continue;
    cpSync(from, join(destination, id), { recursive: true });
    for (const ref of mediaRefsUnder(from)) {
      const target = join(site, ref);
      if (existsSync(target)) continue;
      const source = join(scratch, ref);
      if (!existsSync(source)) continue;
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target);
    }
  }
  const generations = records.filter((entry) => keep.has(entry.id)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  writeFileSync(join(destination, "manifest.json"), `${JSON.stringify({ schemaVersion: "public-generations-manifest-v1", generations }, null, 2)}\n`);
}
