import { createHash } from "node:crypto";
import { readAdminDeploymentManifest } from "../src/server/admin-service/deployment.ts";
import { runReviewAdminRuntime } from "../src/server/admin-service/runtime.ts";
import { ReviewRealRepository } from "../src/server/review-real/repository.ts";
import { canonicalJsonV1 } from "../src/server/internal-operation/gateway.ts";

const OBSERVATION_WINDOW_MS = 61_000;

type FindingClass = "embedded_interval" | "embedded_timeout" | "startup_direct_call" | "embedded_async_scheduler";
type Automation = "automatic_review" | "automatic_publish";

type AutoFinding = Readonly<{
  automation: Automation;
  findingClass: FindingClass;
  producer: "app/src/server/admin-service/runtime.ts::automaticReviewTick" | "ReviewRepository.automaticReviewBatch" | "app/src/server/admin-service/runtime.ts::automaticPublishTick" | "ReviewRepository.automaticPublishBatch";
  locatorSha256: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseManifestPath(): string {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--manifest" || !args[1]?.startsWith("/")) throw new Error("CLI_ARGUMENTS_FORBIDDEN");
  return args[1];
}

function producerForCallback(name: string): Readonly<{ automation: Automation; producer: AutoFinding["producer"] }> | null {
  if (name.includes("automaticReviewTick")) return { automation: "automatic_review", producer: "app/src/server/admin-service/runtime.ts::automaticReviewTick" };
  if (name.includes("automaticPublishTick")) return { automation: "automatic_publish", producer: "app/src/server/admin-service/runtime.ts::automaticPublishTick" };
  if (name.includes("automaticReviewBatch")) return { automation: "automatic_review", producer: "ReviewRepository.automaticReviewBatch" };
  if (name.includes("automaticPublishBatch")) return { automation: "automatic_publish", producer: "ReviewRepository.automaticPublishBatch" };
  return null;
}

function finding(registration: Readonly<{ findingClass: FindingClass; callbackName: string; ordinal: number }>): AutoFinding | null {
  const producer = producerForCallback(registration.callbackName);
  if (producer === null) return null;
  const canonicalLocator = canonicalJsonV1({ observer: "quick-launch-schedule-observer-v1", callbackName: registration.callbackName, ordinal: registration.ordinal });
  return Object.freeze({ ...producer, findingClass: registration.findingClass, locatorSha256: sha256(`${registration.findingClass}\n${producer.producer}\n${canonicalLocator}`) });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const startedAt = new Date().toISOString();
const manifestPath = parseManifestPath();
const manifest = readAdminDeploymentManifest(manifestPath);
const registrations: Array<{ findingClass: FindingClass; callbackName: string; ordinal: number }> = [];
const invocations: string[] = [];
const originalSetInterval = globalThis.setInterval;
const originalSetTimeout = globalThis.setTimeout;
const originalQueueMicrotask = globalThis.queueMicrotask;
const originalSetImmediate = globalThis.setImmediate;
const originalReviewBatch = ReviewRealRepository.prototype.automaticReviewBatch;
const originalPublishBatch = ReviewRealRepository.prototype.automaticPublishBatch;
let ordinal = 0;

function recordRegistration(findingClass: FindingClass, callbackName: string): void {
  if (producerForCallback(callbackName) !== null) registrations.push({ findingClass, callbackName, ordinal: ordinal++ });
}

globalThis.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
  const callbackName = typeof callback === "function" ? callback.name : String(callback);
  recordRegistration("embedded_interval", callbackName);
  return originalSetInterval(callback, delay, ...args);
}) as typeof globalThis.setInterval;
globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
  const callbackName = typeof callback === "function" ? callback.name : String(callback);
  recordRegistration("embedded_timeout", callbackName);
  return originalSetTimeout(callback, delay, ...args);
}) as typeof globalThis.setTimeout;
globalThis.queueMicrotask = ((callback: VoidFunction) => {
  recordRegistration("embedded_async_scheduler", callback.name);
  return originalQueueMicrotask(callback);
}) as typeof globalThis.queueMicrotask;
globalThis.setImmediate = ((callback: (...args: unknown[]) => void, ...args: unknown[]) => {
  recordRegistration("embedded_async_scheduler", callback.name);
  return originalSetImmediate(callback, ...args);
}) as typeof globalThis.setImmediate;
ReviewRealRepository.prototype.automaticReviewBatch = function (...args: Parameters<typeof originalReviewBatch>): ReturnType<typeof originalReviewBatch> {
  void args;
  invocations.push("ReviewRepository.automaticReviewBatch");
  recordRegistration("startup_direct_call", "ReviewRepository.automaticReviewBatch");
  throw new Error("AUTO_REVIEW_BATCH_INVOCATION_OBSERVED");
};
ReviewRealRepository.prototype.automaticPublishBatch = function (...args: Parameters<typeof originalPublishBatch>): ReturnType<typeof originalPublishBatch> {
  void args;
  invocations.push("ReviewRepository.automaticPublishBatch");
  recordRegistration("startup_direct_call", "ReviewRepository.automaticPublishBatch");
  throw new Error("AUTO_PUBLISH_BATCH_INVOCATION_OBSERVED");
};

let runError: string | null = null;
let signalObserved = false;
const observerSignalHandler = (): void => { signalObserved = true; };
process.once("SIGTERM", observerSignalHandler);
const runtime = runReviewAdminRuntime({
  targetReleaseAppRoot: manifest.targetReleaseAppRoot,
  reviewDatabasePath: manifest.reviewDatabasePath,
  reviewDatabaseIdentity: manifest.reviewDatabaseIdentity,
  dataRoot: manifest.dataRoot,
  staticRoot: manifest.staticRoot,
  canonicalOrigin: manifest.canonicalOrigin,
  rpName: manifest.rpName,
  operatorRef: manifest.operatorRef,
  tailscaleAppCapabilityId: manifest.tailscaleAppCapabilityId,
  trustedIdentities: manifest.trustedIdentities,
  sessionHashKeyPath: manifest.sessionHashKeyPath,
  recoveryFencePath: manifest.recoveryFencePath,
  projectionSigningKeyId: manifest.projectionSigningKeyId,
  projectionSigningPrivateKeyPath: manifest.projectionSigningPrivateKeyPath,
  projectionInternalEndpoint: manifest.projectionInternalEndpoint,
  projectionSenderServiceIdentity: manifest.projectionSenderServiceIdentity
}).catch((error: unknown) => {
  runError = error instanceof Error ? error.message : "RUNTIME_FAILED";
});

await sleep(OBSERVATION_WINDOW_MS + 1_000);
if (!signalObserved) process.emit("SIGTERM");
await runtime;
globalThis.setInterval = originalSetInterval;
globalThis.setTimeout = originalSetTimeout;
globalThis.queueMicrotask = originalQueueMicrotask;
globalThis.setImmediate = originalSetImmediate;
ReviewRealRepository.prototype.automaticReviewBatch = originalReviewBatch;
ReviewRealRepository.prototype.automaticPublishBatch = originalPublishBatch;
process.off("SIGTERM", observerSignalHandler);

const observedAt = new Date().toISOString();
const findings = registrations.map((entry) => finding(entry)).filter((entry): entry is AutoFinding => entry !== null);
const output = {
  schemaVersion: "auto-zero-runtime-schedule-observation-v1",
  startedAt,
  observedAt,
  durationMs: Date.parse(observedAt) - Date.parse(startedAt),
  registrySealed: runError === null,
  registeredSchedules: findings,
  invocations,
  runtimeError: runError,
  signalObserved
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (runError !== null || output.durationMs < OBSERVATION_WINDOW_MS || invocations.length > 0) process.exitCode = 2;
