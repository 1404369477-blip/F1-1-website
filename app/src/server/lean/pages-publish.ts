import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { PAGES_BRANCH, PAGES_CNAME, PAGES_DEPLOY_KEY, PAGES_HTTPS_REMOTE, PAGES_KNOWN_HOSTS, PAGES_REMOTE, PAGES_TOKEN_PATH, PAGES_UI_DIRECTORY, PAGES_WORKFLOW, leanPath } from "./config.ts";
import { renderPermanentStoryPage, type SiteBundle } from "./site-bundle.ts";
import type { PublicationArtifacts } from "./publication.ts";

const GIT_TIMEOUT_MS = 120_000;

type Git = (args: string[], allowFailure?: boolean) => { status: number; stdout: string };

function localRefGit(checkout: string, args: string[]): string {
  const result = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: checkout, encoding: "utf8", timeout: 10_000,
    env: { NODE_ENV: "production", PATH: "/usr/bin:/bin", HOME: checkout, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }
  });
  if (result.status !== 0 || result.error) throw new Error("PUBLISH_LOCAL_REF_FAILED");
  return result.stdout.trim();
}

/** Parentless candidates need a durable local ref before a push whose response may be lost. */
export function protectPublicationCommit(checkout: string, commit: string): void {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("PUBLISH_COMMIT_INVALID");
  localRefGit(checkout, ["update-ref", `refs/lean-publications/${commit}`, commit]);
}

/** Call only after the publication state has been saved; preserve both current pending and confirmed commits. */
export function prunePublicationRefs(checkout: string, keep: readonly string[]): void {
  if (!existsSync(join(checkout, ".git"))) return;
  const retained = new Set(keep);
  const refs = localRefGit(checkout, ["for-each-ref", "--format=%(refname)", "refs/lean-publications/"]);
  for (const ref of refs.split("\n").filter(Boolean)) {
    const match = /^refs\/lean-publications\/([a-f0-9]{40,64})$/.exec(ref);
    if (match && !retained.has(match[1])) localRefGit(checkout, ["update-ref", "-d", ref]);
  }
}

function readToken(): string | null {
  if (!existsSync(PAGES_TOKEN_PATH)) return null;
  const token = readFileSync(PAGES_TOKEN_PATH, "utf8").trim();
  if (token === "") return null;
  if (!/^[A-Za-z0-9_]+$/.test(token)) throw new Error("PAGES_TOKEN_INVALID");
  return token;
}

/** HTTPS with the repo-scoped token when configured; otherwise the SSH deploy key. */
function createGit(cwd: string): { git: Git; remote: string } {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
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
    if (!allowFailure && (result.error || status !== 0)) throw new Error(`GIT_${args[0]?.toUpperCase()}_FAILED`);
    return { status, stdout: (result.stdout ?? "").trim() };
  };
  return { git, remote: token === null ? PAGES_REMOTE : PAGES_HTTPS_REMOTE };
}

const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
/** Changes to shell, detail template or workflow must trigger publication even if stories are unchanged. */
export function siteShellFingerprint(options?: { uiDirectory?: string; workflowPath?: string }): string {
  const ui = options?.uiDirectory ?? PAGES_UI_DIRECTORY;
  const workflow = options?.workflowPath ?? PAGES_WORKFLOW;
  const detail = join(ui, "stories/index.html");
  return createHash("sha256").update(JSON.stringify([
    sha256File(join(dirname(ui), "ui.build-receipt.json")), sha256File(workflow),
    existsSync(detail) ? sha256File(detail) : null
  ])).digest("hex");
}

/** Binds the shell/workflow receipt and one fully rendered, publicly reachable story document. */
export function publicationArtifacts(bundle: SiteBundle, options?: { uiDirectory?: string; workflowPath?: string }): PublicationArtifacts {
  const ui = options?.uiDirectory ?? PAGES_UI_DIRECTORY;
  const workflow = options?.workflowPath ?? PAGES_WORKFLOW;
  const detail = join(ui, "stories/index.html");
  const first = bundle.storyPages?.entries().next().value;
  return {
    uiManifestSha256: sha256File(join(dirname(ui), "ui.build-receipt.json")),
    workflowSha256: sha256File(workflow),
    storyTemplateSha256: existsSync(detail) ? sha256File(detail) : null,
    story: first ? { path: first[0].replace(/index\.html$/, ""), sha256: createHash("sha256").update(renderPermanentStoryPage(readFileSync(detail, "utf8"), first[1])).digest("hex") } : null
  };
}

const GENERATION_ID = /^[0-9a-f]{64}$/;

/**
 * actions/deploy-pages clamps its wait at 600000ms while status stays on syncing_files.
 * These match the guard in app/scripts/pages-workflow.yml. A tree over the budget is
 * rejected before push instead of being uploaded and aborted ten minutes later.
 * Headroom above the projected one-generation, 3-day-picture tree (~13k files, ~250MiB).
 */
export const PAGES_ARTIFACT_MAX_FILES = 20_000;
export const PAGES_ARTIFACT_MAX_BYTES = 320 * 1024 * 1024;

export type GenerationRecord = { id: string; publishedAt: string; generatedAt?: string };

/** Only the newest publish is uploaded. Each extra copy is another full response tree for Pages to sync. */
export function retainedGenerationIds(entries: readonly GenerationRecord[]): string[] {
  const sorted = [...entries].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
  return sorted[0] ? [sorted[0].id] : [];
}

export function measureSiteTree(root: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        files += 1;
        bytes += statSync(path).size;
      }
    }
  };
  if (existsSync(root)) walk(root);
  return { files, bytes };
}

export function assertPagesArtifactWithinBudget(measurement: { files: number; bytes: number }): void {
  if (measurement.files > PAGES_ARTIFACT_MAX_FILES || measurement.bytes > PAGES_ARTIFACT_MAX_BYTES) {
    console.error(`PUBLISH_ARTIFACT_TOO_LARGE files=${measurement.files} bytes=${measurement.bytes}`);
    throw new Error("PUBLISH_ARTIFACT_TOO_LARGE");
  }
}

/**
 * Replaces gh-pages with a single parentless commit of the UI shell plus `bundle`.
 * Without history, pictures that left the site are garbage-collected instead of growing the repository forever.
 */
export function publishBundle(checkout: string, bundle: SiteBundle, beforePush?: (commit: string) => void): string {
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
  protectPublicationCommit(checkout, commit);
  beforePush?.(commit);
  git(["push", "--force", "--porcelain", remote, `${commit}:refs/heads/${PAGES_BRANCH}`]);
  git(["reset", "-q", "--soft", commit]);
  return commit;
}

/** Re-triggers deployment of the exact staged generation. Never substitutes the current cycle's content. */
export function retryPublishedBundle(checkout: string, bundleId: string, attempt: number, previousCommit: string, beforePush: (commit: string) => void): string {
  if (!/^[a-f0-9]{40,64}$/.test(previousCommit)) throw new Error("PUBLISH_COMMIT_INVALID");
  const { git, remote } = createGit(checkout);
  const publication = JSON.parse(git(["show", `${previousCommit}:.sync/publication.json`]).stdout) as { bundleId?: string };
  const pointer = JSON.parse(git(["show", `${previousCommit}:site/_public/current.json`]).stdout) as { bundleId?: string };
  if (publication.bundleId !== bundleId || pointer.bundleId !== bundleId) throw new Error("PUBLISH_STAGED_BUNDLE_CHANGED");
  // Retry the immutable candidate commit, independent of changes to the working tree or index.
  const tree = git(["rev-parse", `${previousCommit}^{tree}`]).stdout;
  const commit = git(["-c", "user.name=F1+1 Lean Publisher", "-c", "user.email=pages@users.noreply.github.com",
    "commit-tree", tree, "-m", `Retry deployment ${bundleId} attempt ${attempt}`]).stdout;
  protectPublicationCommit(checkout, commit);
  beforePush(commit);
  git(["push", "--force", "--porcelain", remote, `${commit}:refs/heads/${PAGES_BRANCH}`]);
  git(["reset", "-q", "--soft", commit]);
  return commit;
}

/** Writes the complete gh-pages tree (UI shell, bundle, workflow) into `root`, replacing everything but `.git`. */
export function stageSite(root: string, bundle: SiteBundle, options?: { now?: Date; uiDirectory?: string; workflowPath?: string }): void {
  const now = options?.now ?? new Date();
  const uiDirectory = options?.uiDirectory ?? PAGES_UI_DIRECTORY;
  const workflowPath = options?.workflowPath ?? PAGES_WORKFLOW;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(root)) if (name !== ".git") rmSync(join(root, name), { recursive: true, force: true });

  const site = join(root, "site");
  cpSync(uiDirectory, site, { recursive: true });
  for (const [path, bytes] of bundle.files) {
    mkdirSync(dirname(join(site, path)), { recursive: true });
    writeFileSync(join(site, path), bytes);
  }
  if (bundle.storyPages && bundle.storyPages.size > 0) {
    const template = readFileSync(join(site, "stories/index.html"), "utf8");
    for (const [path, story] of bundle.storyPages) {
      if (!/^stories\/public-[a-z0-9-]{1,120}\/index\.html$/.test(path)) throw new Error("STORY_PAGE_PATH_INVALID");
      mkdirSync(dirname(join(site, path)), { recursive: true });
      writeFileSync(join(site, path), renderPermanentStoryPage(template, story));
    }
  }
  if (bundle.mediaFiles.size > 0) mkdirSync(join(site, "media"), { recursive: true });
  for (const [path, file] of bundle.mediaFiles) cpSync(file, join(site, path));
  publishCurrentGenerationOnly(site, bundle.bundleId, now);
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
    workflowSha256: sha256File(workflowPath),
    storyTemplateSha256: existsSync(join(uiDirectory, "stories/index.html")) ? sha256File(join(uiDirectory, "stories/index.html")) : null
  }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  cpSync(workflowPath, join(root, ".github/workflows/pages.yml"));
  mkdirSync(join(root, ".sync"));
  writeFileSync(join(root, ".sync/publication.json"), JSON.stringify({
    schemaVersion: "lean-publication-v1",
    bundleId: bundle.bundleId,
    contentFingerprint: bundle.contentFingerprint
  }));
  // Budget the directory Actions uploads (`site/`), not the checkout around it.
  assertPagesArtifactWithinBudget(measureSiteTree(site));
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

function publishCurrentGenerationOnly(site: string, currentId: string, now: Date): void {
  if (!GENERATION_ID.test(currentId)) throw new Error("PUBLISH_BUNDLE_ID_INVALID");
  const destination = join(site, "_public/generations");
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(destination)) {
    if (name !== currentId && name !== "manifest.json") rmSync(join(destination, name), { recursive: true, force: true });
  }
  const kept = retainedGenerationIds([{ id: currentId, publishedAt: now.toISOString() }]);
  if (kept.length !== 1 || kept[0] !== currentId) throw new Error("PUBLISH_GENERATION_RETENTION_INVALID");
  const generations = [{ id: currentId, publishedAt: now.toISOString(), generatedAt: generatedAtFrom(join(destination, currentId), now.toISOString()) }];
  writeFileSync(join(destination, "manifest.json"), `${JSON.stringify({ schemaVersion: "public-generations-manifest-v1", generations }, null, 2)}\n`);
}
