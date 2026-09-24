import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { canonicalJson } from "../../server/db/profile.ts";
import { inspectExistingPrivateDatabase } from "../../server/db/database.ts";
import type { AdminRuntimeConfig } from "../../server/admin-service/runtime.ts";
import type { ReleaseRuntimeGate } from "../../server/internal-operation/release.ts";
import { DEEPSEEK_PROMPT_SHA256 } from "../../server/rss/refinement.ts";
import { parseRssFeed } from "../../server/rss/parser.ts";
import { applyRssAutomaticMigration } from "../../server/rss-automatic/migration.ts";
import { RSS_AUTOMATIC_SCHEMA_SHA256 } from "../../server/rss-automatic/schema-identity.ts";
import { RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 } from "../../server/rss-automatic/source-epoch-schema-identity.ts";
import { applyRssAutomaticSourceEpochMigration } from "../../server/rss-automatic/source-epoch-migration.ts";
import { xPageSchema12 } from "./x-page-database.ts";
import { seedRssAutomaticBackup, withRssSyntheticSeed } from "./rss-automatic-backup.ts";
const APP_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/u, "");
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export async function rssAutomaticServiceFixture(gate: ReleaseRuntimeGate, draft = true, fallbackManifestSha256?: string, actualSourceEpochShape = false) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "rss-service-test-"));
  const databasePath = join(root, "f1plus1-rss-real-private.sqlite");
  const now = Date.now(), at = new Date(now - 1000).toISOString();
  const memory = xPageSchema12(); applyRssAutomaticMigration(memory, { applyEnabled: true });
  const schemaSha256 = gate.receipt.schemaSha256 === RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 ? RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 : RSS_AUTOMATIC_SCHEMA_SHA256;
  if (schemaSha256 === RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256) applyRssAutomaticSourceEpochMigration(memory, { applyEnabled: true });
  withRssSyntheticSeed(memory, () => {
    memory.prepare("UPDATE internal_control SET phase='live',global_stop_state='clear',recovery_state='ready',deletion_fence_state='clear',publication_fence_state='clear',updated_at=?,writer_authority_receipt_sha256=?").run(at, "1".repeat(64));
    memory.prepare("INSERT INTO budget_account VALUES('acct-rss','request',1000,0,0,1)").run();
    memory.prepare("INSERT INTO budget_account VALUES('acct-projection','request',1000,0,0,1)").run();
    memory.prepare("INSERT INTO route_registry VALUES('route-projection','projection','projection_private','projection_deliver',?,?,?,'active',1)").run(hash("127.0.0.1:3102/internal/projections"), "0".repeat(64), "0".repeat(64));
    memory.prepare("UPDATE source SET enabled=1 WHERE source_id IN ('motorsport-f1-news','the-race-f1-news','skysports-f1-news')").run();
    if (actualSourceEpochShape) {
      memory.exec("UPDATE internal_control SET recovery_epoch=2,writer_epoch=2");
      memory.exec("UPDATE source_registry_v1 SET source_config_epoch=4,source_safety_epoch=4,recovery_epoch=1 WHERE source_id='motorsport-f1-news'");
      memory.exec("UPDATE source SET stop_epoch=4 WHERE source_id='motorsport-f1-news'");
    }
    if (draft) {
      const item = parseRssFeed(Buffer.from(`<rss version="2.0"><channel><title>Synthetic</title><item><guid>synthetic-guid</guid><link>https://www.motorsport.com/f1/news/service-synthetic/</link><title>F1 test news</title><description>F1 test summary</description><author>Synthetic</author><pubDate>${at}</pubDate></item></channel></rss>`), "motorsport-f1-news").items[0];
      memory.prepare(`INSERT INTO pending_review_candidate(candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,author,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at) VALUES('rss-service-draft','motorsport-f1-news',?,?,?,?,?,?,?,?,3,?,?)`).run(item.externalId, hash("service-synthetic"), item.canonicalUrl, item.title, item.excerpt, item.author, item.publishedAt, item.sourcePayloadHash, at, at);
      memory.prepare("INSERT INTO machine_summary_draft VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(`draft-${hash("service-draft")}`, "rss-service-draft", 3, item.sourcePayloadHash, "deepseek-chat", DEEPSEEK_PROMPT_SHA256, "b".repeat(64), "F1测试新闻", "用于隔离验证真实运行时接线的中文摘要。", '["验证当前原文版本"]', 8, 8, at);
    }
  });
  const deploymentSha256 = hash("synthetic-deployment-bytes");
  seedRssAutomaticBackup(memory, { releaseSha256: gate.receipt.manifestSha256, manifestSha256: deploymentSha256, nowIso: at, schemaSha256 });
  const sourceAuthorityBefore = canonicalJson(memory.prepare("SELECT * FROM source_registry_v1 ORDER BY source_id").all());
  await backup(memory, databasePath); memory.close(); chmodSync(databasePath, 0o600);
  const dataRoot = join(root, "admin"), privateDir = join(dataRoot, "private"); mkdirSync(dataRoot, { mode: 0o700 }); mkdirSync(privateDir, { mode: 0o700 });
  const sessionHashKeyPath = join(dataRoot, "session-hash-key"), recoveryFencePath = join(dataRoot, "recovery-fence.json"), projectionSigningPrivateKeyPath = join(root, "projection.pem");
  writeFileSync(sessionHashKeyPath, Buffer.alloc(32, 4).toString("base64url"), { mode: 0o600 });
  writeFileSync(recoveryFencePath, canonicalJson({ schemaVersion: "admin-recovery-fence-v1", clockTrusted: true, writerReady: true, lastSuccessfulRecoveryPointAt: now }), { mode: 0o600 });
  const keys = generateKeyPairSync("ed25519"); writeFileSync(projectionSigningPrivateKeyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const config: AdminRuntimeConfig = { targetReleaseAppRoot: APP_ROOT, reviewDatabasePath: databasePath,
    reviewDatabaseIdentity: inspectExistingPrivateDatabase(databasePath, "f1plus1-rss-real-private.sqlite"), reviewSchemaTarget: 10, reviewSchemaSha256: schemaSha256,
    rssAutomaticCutoffIso: "2026-09-05T02:30:00.000Z", dataRoot, staticRoot: join(APP_ROOT, "src/admin-ui"), canonicalOrigin: "https://f1-admin.example.ts.net", rpName: "F1+1 Admin", operatorRef: "operator",
    expectedDeploymentManifestSha256: deploymentSha256,
    expectedBackupReleaseSha256: gate.receipt.manifestSha256,
    verifiedRssAutomaticFullManifestSha256: gate.receipt.manifestSha256,
    verifiedRssAutomaticFallbackManifestSha256: fallbackManifestSha256,
    tailscaleAppCapabilityId: "admin.example.com/cap/f1-admin-device", trustedIdentities: [{ login: "owner@example.com", operatorRef: "operator", sourceRefs: ["A".repeat(43), "B".repeat(43), "C".repeat(43)] }],
    sessionHashKeyPath, recoveryFencePath, projectionSigningKeyId: "projection-key", projectionSigningPrivateKeyPath,
    projectionInternalEndpoint: "http://127.0.0.1:3102/internal/projections", projectionSenderServiceIdentity: "projection-sender", releaseGate: gate };
  return { config, databasePath, privateDir, root, sourceAuthorityBefore, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
