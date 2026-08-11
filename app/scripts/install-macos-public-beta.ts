import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { assertNodeVersion, ConfigError } from "../src/server/config/env.ts";
import { runSafeCli } from "../src/server/security/cli.ts";
import { appRoot, projectRoot } from "../src/server/runtime-config.ts";

const APP_LABEL = "com.f1plus1.public-beta";
const REFRESH_LABEL = "com.f1plus1.receipt-refresh";
const REFRESH_SECONDS = 12 * 60 * 60;

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function stringEntry(value: string): string {
  return `    <string>${xml(value)}</string>`;
}

function array(values: readonly string[]): string {
  return ["  <array>", ...values.map(stringEntry), "  </array>"].join("\n");
}

function atomicWrite(path: string, contents: string): void {
  const candidate = `${path}.candidate-${process.pid}`;
  writeFileSync(candidate, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(candidate, 0o600);
  renameSync(candidate, path);
  chmodSync(path, 0o600);
}

function plist(label: string, programArguments: readonly string[], options: { keepAlive?: boolean; interval?: number; stdout: string; stderr: string }): string {
  const keepAlive = options.keepAlive
    ? "  <key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>\n  <key>ThrottleInterval</key>\n  <integer>10</integer>"
    : `  <key>StartInterval</key>\n  <integer>${options.interval}</integer>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
${array(programArguments)}
  <key>WorkingDirectory</key>
  <string>${xml(appRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
${keepAlive}
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(options.stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(options.stderr)}</string>
</dict>
</plist>
`;
}

await runSafeCli(() => {
  process.umask(0o077);
  assertNodeVersion();
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new ConfigError("RELEASE_HOST", "macOS arm64 is required for this beta service installer");
  }
  if (/Mobile Documents|CloudDocs/i.test(projectRoot)) {
    throw new ConfigError("RELEASE_PATH", "production checkout must not run from an iCloud-synced directory");
  }
  for (const required of [resolve(appRoot, ".next/BUILD_ID"), resolve(appRoot, ".local/f1plus1-public-multimedia-synthetic.sqlite")]) {
    if (!existsSync(required) || !lstatSync(required).isFile()) {
      throw new ConfigError("RELEASE_NOT_READY", "build and bootstrapped database are required before service installation");
    }
  }

  const home = homedir();
  const launchAgents = resolve(home, "Library/LaunchAgents");
  const logs = resolve(appRoot, ".local/logs");
  mkdirSync(launchAgents, { recursive: true, mode: 0o700 });
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  chmodSync(logs, 0o700);

  const cleanBase = [
    "/usr/bin/env", "-i",
    `HOME=${home}`,
    "TMPDIR=/tmp",
    `PATH=${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`
  ];
  const canonicalEnvironment = [
    "APP_ENV=local",
    "APP_PORT=3000",
    "APP_BIND_HOST=127.0.0.1",
    "APP_PUBLIC_ORIGIN=http://127.0.0.1:3000",
    "F1_DATA_PROFILE=public-multimedia-synthetic",
    "F1_DB_PATH=.local/f1plus1-public-multimedia-synthetic.sqlite",
    "SOURCE_CONFIG_PROVIDER=fixture",
    "SOURCE_FIXTURE_PATH=../data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json",
    "ADAPTER_MODE=mock",
    "SUMMARY_MODE=fixture",
    "MEDIA_MODE=fixture",
    "PUBLISH_MODE=manual_only",
    "REAL_FEISHU_IO=false",
    "REAL_EXTERNAL_IO=false",
    "REAL_FORM_SUBMIT=false",
    "ADMIN_ACCESS_MODE=local_dev_only",
    "LOG_LEVEL=info"
  ];
  const node = process.execPath;
  const appArguments = [
    ...cleanBase,
    ...canonicalEnvironment,
    node,
    "--experimental-strip-types",
    resolve(appRoot, "scripts/serve.ts"),
    "start"
  ];
  const refreshArguments = [
    ...cleanBase,
    node,
    "--experimental-strip-types",
    resolve(appRoot, "scripts/public-release-refresh.ts")
  ];

  const appPlist = resolve(launchAgents, `${APP_LABEL}.plist`);
  const refreshPlist = resolve(launchAgents, `${REFRESH_LABEL}.plist`);
  atomicWrite(appPlist, plist(APP_LABEL, appArguments, {
    keepAlive: true,
    stdout: resolve(logs, "public-beta.stdout.log"),
    stderr: resolve(logs, "public-beta.stderr.log")
  }));
  atomicWrite(refreshPlist, plist(REFRESH_LABEL, refreshArguments, {
    interval: REFRESH_SECONDS,
    stdout: resolve(logs, "receipt-refresh.stdout.log"),
    stderr: resolve(logs, "receipt-refresh.stderr.log")
  }));

  process.stdout.write(`${JSON.stringify({
    command: "release:install-macos-agents",
    status: "installed-not-loaded",
    labels: [APP_LABEL, REFRESH_LABEL],
    receiptRefreshSeconds: REFRESH_SECONDS,
    node: process.versions.node,
    externalCalls: 0
  })}\n`);
});
