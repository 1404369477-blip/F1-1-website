import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";

import { ConfigError } from "../src/server/config/env.ts";
import { withImmediateTransaction } from "../src/server/db/database.ts";
import {
  RSS_COLLECTOR_LABEL,
  assertRssDeploymentHost,
  readVerifiedRssDeploymentManifest,
  rssDeploymentPaths,
  sha256File
} from "../src/server/rss/deployment.ts";
import { readVerifiedRssReleaseManifest } from "../src/server/rss/release-manifest.ts";
import {
  assertRssSchema,
  openRssDatabase
} from "../src/server/rss/repository.ts";
import { RSS_SOURCE_ID } from "../src/server/rss/types.ts";
import type { GatewayMutationPort } from "../src/server/internal-operation/mutation-port.ts";
import { runSafeCli } from "../src/server/security/cli.ts";
import { appRoot } from "../src/server/runtime-config.ts";

type ControlAction = "status" | "stop" | "resume";
type SourceState = Readonly<{ enabled: boolean; stopEpoch: number }>;
type LaunchState = "loaded" | "unloaded" | "unknown";

function parseAction(arguments_: readonly string[]): ControlAction {
  if (arguments_.length === 1 && ["status", "stop", "resume"].includes(arguments_[0])) {
    return arguments_[0] as ControlAction;
  }
  throw new ConfigError("CLI_ARGUMENTS_FORBIDDEN", "control requires exactly one of status, stop, resume");
}

function launchDomain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw new ConfigError("RELEASE_OWNER", "current uid is unavailable");
  return `gui/${uid}`;
}

function runLaunchctl(arguments_: readonly string[]): Readonly<{ ok: boolean; output: string }> {
  const result = spawnSync("/bin/launchctl", [...arguments_], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024
  });
  return {
    ok: !result.error && result.status === 0,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(0, 64 * 1024)
  };
}

function readLaunchState(): LaunchState {
  const result = runLaunchctl(["print", `${launchDomain()}/${RSS_COLLECTOR_LABEL}`]);
  if (result.ok) return "loaded";
  return /could not find service|service not found/i.test(result.output) ? "unloaded" : "unknown";
}

function readSource(databasePath: string, verifySchema: boolean): SourceState {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    if (verifySchema) assertRssSchema(database);
    const row = database.prepare("SELECT enabled, stop_epoch FROM source WHERE source_id = ?").get(RSS_SOURCE_ID) as
      | { enabled: number; stop_epoch: number }
      | undefined;
    if (!row) throw new ConfigError("RSS_SOURCE", "fixed RSS source is missing");
    return { enabled: Number(row.enabled) === 1, stopEpoch: Number(row.stop_epoch) };
  } finally {
    database.close();
  }
}

function tryReadSource(databasePath: string): SourceState | null {
  try {
    return readSource(databasePath, false);
  } catch {
    return null;
  }
}

function setSourceEnabled(enabled: boolean, incrementEpoch: boolean, verifySchema: boolean, mutationPort?: GatewayMutationPort): SourceState {
  const database = openRssDatabase(appRoot);
  try {
    if (verifySchema) assertRssSchema(database);
    return withImmediateTransaction(database, () => {
      const result = mutationPort === undefined
        ? database.prepare("UPDATE source SET enabled = ?, stop_epoch = stop_epoch + ? WHERE source_id = ?").run(enabled ? 1 : 0, incrementEpoch ? 1 : 0, RSS_SOURCE_ID).changes
        : mutationPort.mutate({
          operationId: `gateway-source-update-${Date.now()}`,
          operationKind: "source_update",
          entityKind: "source",
          entityId: RSS_SOURCE_ID,
          mutationKind: "update",
          statement: "UPDATE source SET enabled = ?, stop_epoch = stop_epoch + ? WHERE source_id = ?",
          parameters: [enabled ? 1 : 0, incrementEpoch ? 1 : 0, RSS_SOURCE_ID],
          identity: { sourceId: RSS_SOURCE_ID, candidateId: null, publicationId: null, publicId: null },
          capabilityClass: "control",
          egressClass: "none"
        });
      if (Number(result) !== 1) throw new ConfigError("RSS_SOURCE", "fixed RSS source update failed");
      const row = database.prepare("SELECT enabled, stop_epoch FROM source WHERE source_id = ?").get(RSS_SOURCE_ID) as {
        enabled: number;
        stop_epoch: number;
      };
      return { enabled: Number(row.enabled) === 1, stopEpoch: Number(row.stop_epoch) };
    });
  } finally {
    database.close();
  }
}

function bestEffortStop(databasePath: string, plistPath: string, beforeEpoch: number | null): Readonly<{
  source: SourceState | null;
  launchState: LaunchState;
  confirmed: boolean;
}> {
  try {
    setSourceEnabled(false, true, false);
  } catch {
    // Continue to bootout and final confirmation even when the DB fence failed.
  }
  runLaunchctl(["bootout", launchDomain(), plistPath]);
  const source = tryReadSource(databasePath);
  const launchState = readLaunchState();
  return {
    source,
    launchState,
    confirmed: beforeEpoch !== null && source !== null && !source.enabled &&
      source.stopEpoch > beforeEpoch && launchState === "unloaded"
  };
}

await runSafeCli(() => {
  process.umask(0o077);
  const action = parseAction(process.argv.slice(2));
  const paths = rssDeploymentPaths(appRoot, homedir());
  assertRssDeploymentHost(paths);

  if (action === "stop") {
    const before = tryReadSource(paths.database);
    const stopped = bestEffortStop(paths.database, paths.plist, before?.stopEpoch ?? null);
    if (!stopped.confirmed) {
      throw new ConfigError("LAUNCHCTL_FAIL_CLOSED", "stop postconditions could not be confirmed");
    }
    process.stdout.write(`${JSON.stringify({
      command: "rss:control",
      action,
      status: "stopped-confirmed",
      label: RSS_COLLECTOR_LABEL,
      launchState: stopped.launchState,
      source: stopped.source,
      externalCalls: 0
    })}\n`);
    return;
  }

  const expectedReleaseManifestSha256 = process.env.RSS_EXPECTED_RELEASE_MANIFEST_SHA256;
  const releaseManifest = readVerifiedRssReleaseManifest(
    appRoot,
    paths.releaseManifest,
    expectedReleaseManifestSha256
  );
  const releaseManifestSha256 = sha256File(paths.releaseManifest);
  const manifest = readVerifiedRssDeploymentManifest(paths, releaseManifest, releaseManifestSha256);

  if (action === "status") {
    const source = readSource(paths.database, true);
    const launchState = readLaunchState();
    if (launchState === "unknown") throw new ConfigError("LAUNCHCTL_STATE", "collector launch state is unknown");
    process.stdout.write(`${JSON.stringify({
      command: "rss:control",
      action,
      status: "observed",
      label: manifest.label,
      launchState,
      source,
      externalCalls: 0
    })}\n`);
    return;
  }

  const before = readSource(paths.database, true);
  if (readLaunchState() !== "unloaded") {
    throw new ConfigError("LAUNCHCTL_STATE", "resume requires an explicitly unloaded collector");
  }
  try {
    setSourceEnabled(true, false, true);
    if (!runLaunchctl(["bootstrap", launchDomain(), paths.plist]).ok) {
      throw new ConfigError("LAUNCHCTL_FAILURE", "collector bootstrap failed");
    }
    const source = readSource(paths.database, false);
    const launchState = readLaunchState();
    if (!source.enabled || launchState !== "loaded") {
      throw new ConfigError("LAUNCHCTL_STATE", "resume postconditions could not be confirmed");
    }
    process.stdout.write(`${JSON.stringify({
      command: "rss:control",
      action,
      status: "resumed-confirmed",
      label: manifest.label,
      launchState,
      source,
      externalCalls: 0
    })}\n`);
  } catch {
    const stopped = bestEffortStop(paths.database, paths.plist, before.stopEpoch);
    if (!stopped.confirmed) {
      throw new ConfigError("LAUNCHCTL_FAIL_CLOSED", "resume failed and shutdown postconditions are unconfirmed");
    }
    throw new ConfigError("LAUNCHCTL_FAILURE", "resume failed and collector was stopped again");
  }
});
