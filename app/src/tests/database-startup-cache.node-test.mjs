import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, readFileSync, statSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { xPageSchema12 } from './helpers/x-page-database.ts';
import { withRssSyntheticSeed } from './helpers/rss-automatic-backup.ts';
import { applyRssAutomaticMigration } from '../server/rss-automatic/migration.ts';
import { applyRssAutomaticSourceEpochMigration } from '../server/rss-automatic/source-epoch-migration.ts';
import { RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 } from '../server/rss-automatic/source-epoch-schema-identity.ts';
import { inspectExistingPrivateDatabase, openExistingSafeDatabase } from '../server/db/database.ts';
import { createReviewAdminRuntime } from '../server/admin-service/runtime.ts';
import { getInstalledSqliteAuthorizer } from '../server/internal-operation/authorizer.ts';
import { installNoEgressGuard } from '../server/vs1/no-egress.ts';

const app = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const originalExec = DatabaseSync.prototype.exec;
const originalPrepare = DatabaseSync.prototype.prepare;
const hash = b => createHash('sha256').update(b).digest('hex');
async function fixture(t, mutate) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'admin-cache-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const memory = xPageSchema12();
  applyRssAutomaticMigration(memory, { applyEnabled: true });
  applyRssAutomaticSourceEpochMigration(memory, { applyEnabled: true });
  if (mutate) withRssSyntheticSeed(memory, () => mutate(memory));
  const databasePath = join(root, 'f1plus1-rss-real-private.sqlite');
  await backup(memory, databasePath); memory.close(); chmodSync(databasePath, 0o600);
  mkdirSync(join(root, 'private'), { mode: 0o700 });
  writeFileSync(join(root, 'session-key'), Buffer.alloc(32, 9).toString('base64url'), { mode: 0o600 });
  const keys = generateKeyPairSync('ed25519');
  writeFileSync(join(root, 'signing-key'), keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  writeFileSync(join(root, 'fence.json'), JSON.stringify({ schemaVersion: 'admin-recovery-fence-v1', clockTrusted: false, writerReady: false, lastSuccessfulRecoveryPointAt: null }), { mode: 0o600 });
  const identity = inspectExistingPrivateDatabase(databasePath, 'f1plus1-rss-real-private.sqlite');
  return { root, databasePath, identity, config: {
    targetReleaseAppRoot: app, reviewDatabasePath: databasePath, reviewDatabaseIdentity: identity,
    reviewSchemaTarget: 10, reviewSchemaSha256: RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256,
    rssAutomaticCutoffIso: '2026-09-05T02:30:00.000Z',
    verifiedRssAutomaticFullManifestSha256: 'b'.repeat(64), verifiedRssAutomaticFallbackManifestSha256: 'c'.repeat(64),
    gatewayReleaseSha256: 'a'.repeat(64), gatewayManifestSha256: 'b'.repeat(64),
    ownerSupervisorHandoffProvider() { throw new Error('TEST_NO_HANDOFF'); },
    dataRoot: root, staticRoot: app + '/src/admin-ui', canonicalOrigin: 'https://test.invalid', rpName: 'Test', operatorRef: 'test-owner',
    tailscaleAppCapabilityId: 'admin.example.com/cap/f1-admin-device', trustedIdentities: [{ login: 'test@invalid.example', operatorRef: 'test-owner', sourceRefs: ['one', 'two', 'three'] }],
    sessionHashKeyPath: join(root, 'session-key'), recoveryFencePath: join(root, 'fence.json'), projectionSigningKeyId: 'test-only',
    projectionSigningPrivateKeyPath: join(root, 'signing-key'), projectionInternalEndpoint: 'http://127.0.0.1:3102/internal/projections', projectionSenderServiceIdentity: 'test-only'
  }};
}

function trace(t, rejectSetting = false) {
  const checks = [], cacheReads = [], execs = [];
  DatabaseSync.prototype.exec = function(sql) {
    execs.push(sql);
    if (rejectSetting && sql === 'PRAGMA cache_size=-65536;') return;
    return originalExec.call(this, sql);
  };
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = originalPrepare.call(this, sql);
    if (/^PRAGMA (foreign_key_check|integrity_check)$/.test(sql)) checks.push(sql);
    if (sql === 'PRAGMA cache_size') cacheReads.push(statement.get().cache_size);
    return statement;
  };
  t.after(() => { DatabaseSync.prototype.exec = originalExec; DatabaseSync.prototype.prepare = originalPrepare; });
  return { checks, cacheReads, execs };
}

test('real schema-10 factory retains all three FK and integrity checks with connection cache', async t => {
  const f = await fixture(t); const traceResult = trace(t); const guard = installNoEgressGuard();
  t.after(() => guard.restore());
  const runtime = createReviewAdminRuntime(f.config);
  t.after(() => { runtime.closeBackgroundResources(); runtime.gateway?.close(); runtime.database.close(); });
  assert.equal(runtime.server.listening, false);
  assert.equal(guard.externalCalls, 0);
  assert.deepEqual(traceResult.cacheReads, [-65536]);
  assert.deepEqual(traceResult.checks, Array.from({ length: 3 }, () => ['PRAGMA foreign_key_check', 'PRAGMA integrity_check']).flat());
  assert.equal(traceResult.execs.filter(sql => sql.includes('cache_size')).length, 1);
  assert.ok(traceResult.execs.every(sql => /^PRAGMA /.test(sql)));
  assert.throws(() => runtime.database.exec('PRAGMA cache_size=-131072'), /authorized/);
  assert.throws(() => runtime.database.exec("ATTACH ':memory:' AS unsafe"), /authorized/);
  assert.equal(getInstalledSqliteAuthorizer(runtime.database)?.profile, 'gateway_owner_writer');
});

test('cache is connection-local; reopened database default and persisted header stay unchanged', async t => {
  const f = await fixture(t);
  // Set WAL before capturing bytes so only the cache change is under test.
  const first = new DatabaseSync(f.databasePath); first.exec('PRAGMA journal_mode=WAL'); first.close();
  const before = readFileSync(f.databasePath), identity = statSync(f.databasePath);
  const opened = openExistingSafeDatabase(f.databasePath, 'f1plus1-rss-real-private.sqlite', f.identity, [10]);
  opened.close();
  const second = new DatabaseSync(f.databasePath, { readOnly: true });
  try {
    assert.equal(second.prepare('PRAGMA cache_size').get().cache_size, -2000);
    assert.equal(second.prepare('PRAGMA default_cache_size').get().cache_size, -2000);
  } finally { second.close(); }
  assert.equal(hash(readFileSync(f.databasePath)), hash(before));
  assert.equal(statSync(f.databasePath).ino, identity.ino);
});

test('ignored cache setting fails exact readback and never reaches expensive admission checks', async t => {
  const f = await fixture(t); const traced = trace(t, true);
  assert.throws(() => createReviewAdminRuntime(f.config), /required SQLite page cache was not applied/);
  assert.deepEqual(traced.cacheReads, [-2000]);
  assert.deepEqual(traced.checks, []);
});

test('actual foreign-key corruption is still rejected under enlarged cache', async t => {
  const f = await fixture(t, db => {
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare(`INSERT INTO pending_review_candidate(candidate_id,source_id,external_id,dedupe_key,canonical_url,title,excerpt,published_at,source_payload_hash,source_revision,first_seen_at,last_seen_at)
      VALUES('test-fk','absent-source','test-fk',?,'https://example.invalid/fk','test','test','2026-09-22T00:00:00Z',?,1,'2026-09-22T00:00:00Z','2026-09-22T00:00:00Z')`).run('1'.repeat(64), '2'.repeat(64));
    db.exec('PRAGMA foreign_keys=ON');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 1);
  });
  const traced = trace(t);
  assert.throws(() => createReviewAdminRuntime(f.config), /SCHEMA10_DRIFT/);
  assert.deepEqual(traced.cacheReads, [-65536]);
  assert.deepEqual(traced.checks, ['PRAGMA foreign_key_check']);
});

test('actual CHECK corruption is still rejected by full integrity check', async t => {
  const f = await fixture(t, db => {
    db.exec('PRAGMA ignore_check_constraints=ON');
    db.exec("UPDATE source SET enabled=2 WHERE source_id='motorsport-f1-news'");
    db.exec('PRAGMA ignore_check_constraints=OFF');
    assert.notEqual(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  });
  const traced = trace(t);
  assert.throws(() => createReviewAdminRuntime(f.config), /SCHEMA10_DRIFT/);
  assert.deepEqual(traced.cacheReads, [-65536]);
  assert.deepEqual(traced.checks, ['PRAGMA foreign_key_check', 'PRAGMA integrity_check']);
});

test('existing database identity mismatch rejects before cache initialization', async t => {
  const f = await fixture(t); const traced = trace(t);
  assert.throws(() => createReviewAdminRuntime({ ...f.config, reviewDatabaseIdentity: { ...f.identity, ino: f.identity.ino + 1 } }), /receipt does not match/);
  assert.deepEqual(traced.cacheReads, []); assert.deepEqual(traced.checks, []);
});

test('schema/user_version and reader total_changes cannot authorize cross-check result reuse', t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'admin-reuse-counterexample-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'counterexample.sqlite');
  const reader = new DatabaseSync(path);
  reader.exec('PRAGMA journal_mode=WAL; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id)); PRAGMA user_version=10');
  const writer = new DatabaseSync(path);
  t.after(() => { reader.close(); writer.close(); });
  const state = () => ({ schema: reader.prepare('PRAGMA schema_version').get().schema_version,
    user: reader.prepare('PRAGMA user_version').get().user_version,
    ownChanges: reader.prepare('SELECT total_changes() AS n').get().n });
  const before = state();
  assert.deepEqual(reader.prepare('PRAGMA foreign_key_check').all(), []);
  writer.exec('PRAGMA foreign_keys=OFF; INSERT INTO child VALUES(999)');
  assert.deepEqual(state(), before);
  assert.equal(reader.prepare('PRAGMA foreign_key_check').all().length, 1);
});
