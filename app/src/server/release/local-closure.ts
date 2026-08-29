import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync
} from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import { ConfigError } from "../config/env.ts";

export type StaticAssetReference = Readonly<{
  from: string;
  request: string;
  target: string;
}>;

export type RuntimeClosureSpec = Readonly<{
  entrypoints: readonly string[];
  requiredFiles: readonly string[];
  migrations: readonly string[];
  staticAssets?: readonly StaticAssetReference[];
}>;

export type RuntimeClosureEdge = Readonly<{
  from: string;
  request: string;
  to: string;
  kind: "es-module" | "dynamic-import" | "require" | "import-equals" | "new-url" | "css" | "html";
}>;

export type RuntimeClosureGraph = Readonly<{
  files: readonly string[];
  edges: readonly RuntimeClosureEdge[];
}>;

export type StableFileSnapshot = Readonly<{
  bytes: Buffer;
  mode: number;
  size: number;
  dev: number;
  ino: number;
}>;

type TsApi = typeof import("typescript");
type TsNode = import("typescript").Node;
type TsExpression = import("typescript").Expression;
type TsCompilerOptions = import("typescript").CompilerOptions;

const closureRequire = createRequire(import.meta.url);

function compilerApi(): TsApi {
  return closureRequire("typescript") as TsApi;
}

function normalizedRelative(root: string, absolute: string, reason: string): string {
  const path = relative(realpathSync(root), realpathSync(absolute)).split(sep).join("/");
  if (path === "" || path === ".." || path.startsWith("../") || isAbsolute(path)) {
    throw new ConfigError("RELEASE_CLOSURE", reason);
  }
  return path;
}

function validateReleasePath(path: string): void {
  if (!path || path.includes("\0") || isAbsolute(path) || path === ".." || path.startsWith("../") || path.includes("/../")) {
    throw new ConfigError("RELEASE_CLOSURE", `invalid release path: ${path}`);
  }
}

function sameSnapshot(left: ReturnType<typeof fstatSync>, right: ReturnType<typeof fstatSync>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.nlink === right.nlink && left.uid === right.uid && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

export function readStableRegularFile(root: string, path: string): StableFileSnapshot {
  validateReleasePath(path);
  const realRoot = realpathSync(root);
  const absolute = resolve(realRoot, path);
  const descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(descriptor);
    const pathStat = lstatSync(absolute);
    if (
      !before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() ||
      (before.mode & 0o022) !== 0 || pathStat.isSymbolicLink() ||
      before.dev !== pathStat.dev || before.ino !== pathStat.ino ||
      normalizedRelative(realRoot, absolute, `release path escapes root: ${path}`) !== path
    ) {
      throw new ConfigError("RELEASE_CLOSURE", `release path is not an owner-controlled stable file: ${path}`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const finalPathStat = lstatSync(absolute);
    if (
      !sameSnapshot(before, after) || after.size !== bytes.byteLength ||
      after.dev !== finalPathStat.dev || after.ino !== finalPathStat.ino || finalPathStat.isSymbolicLink()
    ) {
      throw new ConfigError("RELEASE_CLOSURE", `release file changed while being read: ${path}`);
    }
    return Object.freeze({ bytes, mode: before.mode & 0o777, size: before.size, dev: before.dev, ino: before.ino });
  } finally {
    closeSync(descriptor);
  }
}

export function gitBlobSha1(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

function assertRegularPath(root: string, path: string): void {
  readStableRegularFile(root, path);
}

function loadCompilerOptions(root: string): Readonly<{ api: TsApi; options: TsCompilerOptions; pathAliases: readonly string[] }> {
  const api = compilerApi();
  const configPath = resolve(root, "tsconfig.json");
  if (!existsSync(configPath)) throw new ConfigError("RELEASE_CLOSURE", "tsconfig.json is required for module resolution");
  const config = api.readConfigFile(configPath, api.sys.readFile);
  if (config.error) throw new ConfigError("RELEASE_CLOSURE", "tsconfig.json cannot be parsed");
  const parsed = api.parseJsonConfigFileContent(config.config, api.sys, root, undefined, configPath);
  if (parsed.errors.length > 0) throw new ConfigError("RELEASE_CLOSURE", "tsconfig.json compiler options are invalid");
  return Object.freeze({ api, options: parsed.options, pathAliases: Object.freeze(Object.keys(parsed.options.paths ?? {}).sort()) });
}

function aliasMatches(specifier: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0) return specifier === pattern;
    return specifier.startsWith(pattern.slice(0, wildcard)) && specifier.endsWith(pattern.slice(wildcard + 1));
  });
}

const LOCAL_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".html"] as const;

function explicitLocalCandidate(fromAbsolute: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return explicitPathCandidate(resolve(fromAbsolute, "..", specifier));
}

function explicitPathCandidate(candidate: string): string | null {
  const candidates = [candidate];
  if (extname(candidate) === "") {
    for (const extension of LOCAL_EXTENSIONS) candidates.push(`${candidate}${extension}`);
    for (const extension of LOCAL_EXTENSIONS) candidates.push(resolve(candidate, `index${extension}`));
  }
  return candidates.find((path) => existsSync(path) && lstatSync(path).isFile()) ?? null;
}

function explicitAliasCandidate(
  root: string,
  specifier: string,
  options: TsCompilerOptions
): string | null {
  const base = options.baseUrl ?? root;
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
    const wildcard = pattern.indexOf("*");
    let substitution: string | null = null;
    if (wildcard < 0) {
      if (specifier !== pattern) continue;
      substitution = "";
    } else {
      const prefix = pattern.slice(0, wildcard);
      const suffix = pattern.slice(wildcard + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      substitution = specifier.slice(prefix.length, specifier.length - suffix.length);
    }
    for (const target of targets) {
      const mapped = wildcard < 0 ? target : target.replace("*", substitution);
      const candidate = explicitPathCandidate(resolve(base, mapped));
      if (candidate !== null) return candidate;
    }
  }
  return null;
}

function resolveCodeOrAsset(
  root: string,
  from: string,
  specifier: string,
  compiler: Readonly<{ api: TsApi; options: TsCompilerOptions; pathAliases: readonly string[] }>
): string | null {
  const fromAbsolute = resolve(root, from);
  const resolvedModule = compiler.api.resolveModuleName(specifier, fromAbsolute, compiler.options, compiler.api.sys).resolvedModule;
  const candidate = (resolvedModule?.resolvedFileName ? explicitPathCandidate(resolvedModule.resolvedFileName) : null) ??
    explicitLocalCandidate(fromAbsolute, specifier) ??
    explicitAliasCandidate(root, specifier, compiler.options);
  if (candidate === null || candidate === undefined) {
    if (specifier.startsWith(".") || aliasMatches(specifier, compiler.pathAliases)) {
      throw new ConfigError("RELEASE_CLOSURE", `local module or asset is missing: ${from} -> ${specifier}`);
    }
    return null;
  }
  const absolute = resolve(candidate);
  const delta = relative(realpathSync(root), realpathSync(absolute)).split(sep).join("/");
  if (delta === ".." || delta.startsWith("../") || isAbsolute(delta) || delta === "node_modules" || delta.startsWith("node_modules/")) {
    if (specifier.startsWith(".") || aliasMatches(specifier, compiler.pathAliases)) {
      throw new ConfigError("RELEASE_CLOSURE", `local module escapes app root: ${from} -> ${specifier}`);
    }
    return null;
  }
  assertRegularPath(root, delta);
  return delta;
}

function literalText(api: TsApi, expression: TsExpression | undefined): string | null {
  return expression && (api.isStringLiteral(expression) || api.isNoSubstitutionTemplateLiteral(expression)) ? expression.text : null;
}

function isImportMetaUrl(api: TsApi, expression: TsExpression | undefined): boolean {
  return Boolean(
    expression && api.isPropertyAccessExpression(expression) && expression.name.text === "url" &&
    api.isMetaProperty(expression.expression) && expression.expression.keywordToken === api.SyntaxKind.ImportKeyword &&
    expression.expression.name.text === "meta"
  );
}

function codeDependencies(
  root: string,
  path: string,
  compiler: Readonly<{ api: TsApi; options: TsCompilerOptions; pathAliases: readonly string[] }>
): readonly RuntimeClosureEdge[] {
  const source = readStableRegularFile(root, path).bytes.toString("utf8");
  const script = compiler.api.createSourceFile(resolve(root, path), source, compiler.api.ScriptTarget.Latest, true);
  if (script.isDeclarationFile) return Object.freeze([]);
  const edges: RuntimeClosureEdge[] = [];
  const add = (request: string, kind: RuntimeClosureEdge["kind"]): void => {
    const target = resolveCodeOrAsset(root, path, request, compiler);
    if (target !== null) edges.push(Object.freeze({ from: path, request, to: target, kind }));
  };
  const visit = (node: TsNode): void => {
    if ((compiler.api.isImportDeclaration(node) || compiler.api.isExportDeclaration(node)) && node.moduleSpecifier) {
      if ((compiler.api.isImportDeclaration(node) && node.importClause?.isTypeOnly) || (compiler.api.isExportDeclaration(node) && node.isTypeOnly)) {
        compiler.api.forEachChild(node, visit);
        return;
      }
      const request = literalText(compiler.api, node.moduleSpecifier);
      if (request === null) throw new ConfigError("RELEASE_CLOSURE", `nonliteral ES module specifier: ${path}`);
      add(request, "es-module");
    } else if (compiler.api.isImportEqualsDeclaration(node) && compiler.api.isExternalModuleReference(node.moduleReference)) {
      const request = literalText(compiler.api, node.moduleReference.expression);
      if (request === null) throw new ConfigError("RELEASE_CLOSURE", `nonliteral import-equals specifier: ${path}`);
      add(request, "import-equals");
    } else if (compiler.api.isCallExpression(node) && node.expression.kind === compiler.api.SyntaxKind.ImportKeyword) {
      const request = node.arguments.length === 1 ? literalText(compiler.api, node.arguments[0]) : null;
      if (request === null) throw new ConfigError("RELEASE_CLOSURE", `computed dynamic import is forbidden: ${path}`);
      add(request, "dynamic-import");
    } else if (compiler.api.isCallExpression(node) && compiler.api.isIdentifier(node.expression) && node.expression.text === "require") {
      const request = node.arguments.length === 1 ? literalText(compiler.api, node.arguments[0]) : null;
      if (request === null) throw new ConfigError("RELEASE_CLOSURE", `computed require is forbidden: ${path}`);
      add(request, "require");
    } else if (compiler.api.isNewExpression(node) && compiler.api.isIdentifier(node.expression) && node.expression.text === "URL") {
      const arguments_ = node.arguments ?? [];
      if (isImportMetaUrl(compiler.api, arguments_[1])) {
        const request = literalText(compiler.api, arguments_[0]);
        if (request === null) throw new ConfigError("RELEASE_CLOSURE", `computed new URL(import.meta.url) is forbidden: ${path}`);
        const absolute = resolve(resolve(root, path), "..", request);
        if (existsSync(absolute) && lstatSync(absolute).isDirectory()) {
          throw new ConfigError("RELEASE_CLOSURE", `new URL directory dependency is forbidden: ${path} -> ${request}`);
        }
        const target = explicitLocalCandidate(resolve(root, path), request);
        if (target === null) throw new ConfigError("RELEASE_CLOSURE", `new URL asset is missing: ${path} -> ${request}`);
        const to = normalizedRelative(root, target, `new URL asset escapes app root: ${path} -> ${request}`);
        assertRegularPath(root, to);
        edges.push(Object.freeze({ from: path, request, to, kind: "new-url" }));
      }
    }
    compiler.api.forEachChild(node, visit);
  };
  visit(script);
  return Object.freeze(edges.sort((left, right) => `${left.from}\0${left.request}\0${left.kind}`.localeCompare(`${right.from}\0${right.request}\0${right.kind}`)));
}

function mappedAsset(spec: RuntimeClosureSpec, from: string, request: string): string {
  const matches = (spec.staticAssets ?? []).filter((entry) => entry.from === from && entry.request === request);
  if (matches.length !== 1) throw new ConfigError("RELEASE_CLOSURE", `static asset mapping must be exact: ${from} -> ${request}`);
  return matches[0].target;
}

function htmlDependencies(root: string, path: string, spec: RuntimeClosureSpec): readonly RuntimeClosureEdge[] {
  const source = readStableRegularFile(root, path).bytes.toString("utf8");
  const edges: RuntimeClosureEdge[] = [];
  const attribute = /\b(?:src|href)\s*=\s*/gi;
  for (const match of source.matchAll(attribute)) {
    const start = (match.index ?? 0) + match[0].length;
    const quote = source[start];
    if (quote !== '"' && quote !== "'") throw new ConfigError("RELEASE_CLOSURE", `unquoted HTML asset is forbidden: ${path}`);
    const end = source.indexOf(quote, start + 1);
    if (end < 0) throw new ConfigError("RELEASE_CLOSURE", `unterminated HTML asset is forbidden: ${path}`);
    const request = source.slice(start + 1, end);
    if (!request.startsWith("/") && !request.startsWith("./") && !request.startsWith("../")) continue;
    const to = mappedAsset(spec, path, request);
    assertRegularPath(root, to);
    edges.push(Object.freeze({ from: path, request, to, kind: "html" }));
  }
  return Object.freeze(edges);
}

function cssDependencies(root: string, path: string): readonly RuntimeClosureEdge[] {
  const source = readStableRegularFile(root, path).bytes.toString("utf8");
  const edges: RuntimeClosureEdge[] = [];
  const tokens = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?|url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
  let recognized = 0;
  for (const match of source.matchAll(tokens)) {
    recognized += 1;
    const request = match[1] ?? match[2];
    if (/^(?:data:|https?:|\/)/i.test(request)) continue;
    const target = explicitLocalCandidate(resolve(root, path), request);
    if (target === null) throw new ConfigError("RELEASE_CLOSURE", `CSS asset is missing: ${path} -> ${request}`);
    const to = normalizedRelative(root, target, `CSS asset escapes app root: ${path} -> ${request}`);
    assertRegularPath(root, to);
    edges.push(Object.freeze({ from: path, request, to, kind: "css" }));
  }
  const possible = (source.match(/@import\b|url\s*\(/gi) ?? []).length;
  if (possible !== recognized) throw new ConfigError("RELEASE_CLOSURE", `unparsed CSS dependency is forbidden: ${path}`);
  return Object.freeze(edges);
}

function dependenciesFor(
  root: string,
  path: string,
  spec: RuntimeClosureSpec,
  compiler: Readonly<{ api: TsApi; options: TsCompilerOptions; pathAliases: readonly string[] }>
): readonly RuntimeClosureEdge[] {
  const extension = extname(path).toLowerCase();
  if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return codeDependencies(root, path, compiler);
  if (extension === ".css") return cssDependencies(root, path);
  if (extension === ".html") return htmlDependencies(root, path, spec);
  return Object.freeze([]);
}

export function deriveRuntimeLocalClosureGraph(root: string, spec: RuntimeClosureSpec): RuntimeClosureGraph {
  const compiler = loadCompilerOptions(root);
  const initial = [...spec.entrypoints, ...spec.requiredFiles, ...spec.migrations];
  for (const asset of spec.staticAssets ?? []) initial.push(asset.from, asset.target);
  const pending = [...new Set(initial)].sort();
  for (const path of pending) assertRegularPath(root, path);
  const seen = new Set<string>();
  const edges: RuntimeClosureEdge[] = [];
  while (pending.length > 0) {
    const path = pending.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const edge of dependenciesFor(root, path, spec, compiler)) {
      edges.push(edge);
      if (!seen.has(edge.to)) pending.push(edge.to);
    }
    pending.sort();
  }
  edges.sort((left, right) => `${left.from}\0${left.request}\0${left.kind}`.localeCompare(`${right.from}\0${right.request}\0${right.kind}`));
  return Object.freeze({ files: Object.freeze([...seen].sort()), edges: Object.freeze(edges) });
}

export function deriveRuntimeLocalClosure(root: string, spec: RuntimeClosureSpec): readonly string[] {
  return deriveRuntimeLocalClosureGraph(root, spec).files;
}

export function assertRuntimeLocalClosure(root: string, declaredFiles: readonly string[], spec: RuntimeClosureSpec): readonly string[] {
  const declared = new Set(declaredFiles);
  if (declared.size !== declaredFiles.length) throw new ConfigError("RELEASE_CLOSURE", "runtime closure contains duplicate paths");
  for (const path of declaredFiles) assertRegularPath(root, path);
  const expected = deriveRuntimeLocalClosure(root, spec);
  const omitted = expected.filter((path) => !declared.has(path));
  if (omitted.length > 0) throw new ConfigError("RELEASE_CLOSURE", `runtime closure omits AST imports or required assets: ${omitted.join(", ")}`);
  return expected;
}

function gitOutput(projectRoot: string, arguments_: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", ["-C", projectRoot, ...arguments_], { encoding: "utf8", shell: false, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new ConfigError("RELEASE_GIT", "Git runtime closure command failed");
  return result.stdout;
}

export function assertRuntimeGitClosure(projectRoot: string, paths: readonly string[]): void {
  const gitPaths = [...new Set(paths)].sort().map((path) => path.startsWith("app/") || path.startsWith("data/") ? path : `app/${path}`);
  try {
    gitOutput(projectRoot, ["ls-files", "--error-unmatch", "--", ...gitPaths]);
  } catch {
    throw new ConfigError("RELEASE_GIT", "Git runtime closure must be clean; required release file is not tracked at the current HEAD");
  }
  if (gitOutput(projectRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...gitPaths]) !== "") {
    throw new ConfigError("RELEASE_GIT", "runtime closure must be clean; dirty or untracked files detected");
  }
  const commit = gitOutput(projectRoot, ["rev-parse", "--verify", "HEAD"]).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new ConfigError("RELEASE_GIT", "runtime closure HEAD is invalid");
  for (const path of gitPaths) {
    const expected = gitOutput(projectRoot, ["rev-parse", `${commit}:${path}`]).trim();
    const snapshot = readStableRegularFile(projectRoot, path);
    if (expected !== gitBlobSha1(snapshot.bytes)) throw new ConfigError("RELEASE_GIT", `${path} bytes differ from HEAD`);
  }
}
