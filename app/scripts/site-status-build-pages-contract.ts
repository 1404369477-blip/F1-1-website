import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const version = require("rolldown/package.json").version;
if (process.version !== "v24.18.0" || version !== "1.2.1" || process.argv.length !== 3) throw new Error("PAGES_CONTRACT_BUILD_INPUT_INVALID");
const output = resolve(process.argv[2]);
const input = resolve(app, "src/server/site-status/pages-contract.ts");
const bundle = await rolldown({ input, platform: "node", transform: { define: { "process.env.NEXT_PUBLIC_F1_STATIC_SITE": "false" } } });
try {
  const generated = await bundle.generate({ format: "esm", sourcemap: false, minify: false });
  if (generated.output.length !== 1 || generated.output[0].type !== "chunk") throw new Error("PAGES_CONTRACT_BUILD_NOT_SINGLE_FILE");
  const chunk = generated.output[0];
  if (chunk.imports.length || chunk.dynamicImports.length) throw new Error("PAGES_CONTRACT_BUILD_EXTERNAL_DEPENDENCY");
  const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  const inputs = Object.keys(chunk.modules).filter((path) => !path.startsWith("\0")).sort().map((path) => ({ path: relative(app, path), sha256: sha256(readFileSync(path)) }));
  writeFileSync(output, chunk.code, { flag: "wx", mode: 0o600 });
  writeFileSync(`${output}.build.json`, JSON.stringify({ node: process.version, rolldown: version, format: "esm", externalImports: chunk.imports, dynamicImports: chunk.dynamicImports, inputs, bytes: Buffer.byteLength(chunk.code), sha256: sha256(chunk.code) }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
} finally { await bundle.close(); }
