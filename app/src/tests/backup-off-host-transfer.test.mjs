// Local fake-remote tests. These do not exercise SSH, M1, iCloud, or real backup decryption.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { archiveReceipt, transferOnce, runCommand } from '../../../deployment/macos/backup-off-host-transfer.mjs';
import * as core from '../server/backup-snapshot/core.ts';
import * as offhost from '../server/backup-snapshot/off-host-receipt.ts';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'f1-transfer-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = { cacheRoot: join(root, 'cache'), receiptDir: join(root, 'receipts'), signingKeyFile: join(root, 'signing.pem') };
  const source = join(root, 'source'); mkdirSync(source, { mode: 0o700 });
  mkdirSync(join(source, 'packages'), { mode: 0o700 }); mkdirSync(join(source, 'objects'), { mode: 0o700 });
  const pair = generateKeyPairSync('ed25519');
  writeFileSync(input.signingKeyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const calls = [], published = new Map();
  const remote = {
    async fetch(path, target) { calls.push(['fetch', path]); copyFileSync(join(source, path), target); },
    async size(object) { calls.push(['size', object]); return String(statSync(join(source, 'objects', object)).size); },
    async publish(path, id) { calls.push(['publish', id]); const bytes = readFileSync(path); if (published.has(id)) assert.deepEqual(bytes, published.get(id)); published.set(id, bytes); }
  };
  const deps = { api: { ...core, ...offhost }, remote, freeBytes: () => 10n * 1024n ** 3n };
  function packageAt(ageMs, salt = 1) {
    const point = new Date(Date.now() - ageMs).toISOString();
    const members = [{ relativePath: 'db/snapshot.sqlite', bytes: 10, sha256: String(salt).repeat(64) }, { relativePath: 'projection/active.json', bytes: 10, sha256: 'e'.repeat(64) }];
    const hash = core.sha256Text(core.canonicalJson(members)), keyId = 'b'.repeat(16), id = core.packageIdFor(point, hash);
    const manifest = { schemaVersion: 'backup-snapshot-manifest-v1', kind: core.SNAPSHOT_KIND, keyId, recovery_point_at: point, contentHash: hash, userVersion: 10, sqliteMasterSha256: 'c'.repeat(64), members };
    mkdirSync(join(source, 'packages', id), { mode: 0o700 });
    writeFileSync(join(source, 'packages', id, 'manifest.json'), core.canonicalJson(manifest), { mode: 0o600 });
    const object = core.objectFileName(core.SNAPSHOT_KIND, hash, keyId);
    writeFileSync(join(source, 'objects', object), Buffer.alloc(100, salt), { mode: 0o600 });
    const latest = { schemaVersion: 'backup-snapshot-latest-v1', packageId: id, recovery_point_at: point, contentHash: hash, kind: core.SNAPSHOT_KIND, keyId };
    writeFileSync(join(source, 'latest.json'), JSON.stringify(latest), { mode: 0o600 });
    return { id, object, latest };
  }
  return { root, input, source, deps, calls, published, packageAt };
}

test('actual local ciphertext read signs the exact bytes; duplicate replay preserves receipt time and bytes', async t => {
  const f = fixture(t), p = f.packageAt(10000);
  const first = await transferOnce(f.input, f.deps);
  assert.equal(first.code, 'TRANSFER_READ_VERIFIED');
  const bytes = f.published.get(p.id), receipt = JSON.parse(bytes);
  assert.equal(receipt.payload.ciphertextSha256, core.sha256Bytes(Buffer.alloc(100, 1)));
  const second = await transferOnce(f.input, f.deps);
  assert.equal(second.code, 'TRANSFER_ALREADY_OBSERVED'); assert.deepEqual(f.published.get(p.id), bytes);
  assert.equal(f.calls.filter(c => c[0] === 'fetch' && c[1].startsWith('objects/')).length, 1);
  assert.deepEqual(readFileSync(join(f.input.receiptDir, p.id + '.json')), bytes);
  assert.equal(existsSync(join(f.input.cacheRoot, '.transfer.lock')), false);
});

test('third complete package prunes only one marked older package and preserves unknown directories', async t => {
  const f = fixture(t), a = f.packageAt(30000, 1); await transferOnce(f.input, f.deps);
  const unknown = join(f.input.cacheRoot, '1780000000000_aaaaaaaaaaaaaaaa'); mkdirSync(unknown, { mode: 0o700 }); writeFileSync(join(unknown, 'do-not-delete'), 'evidence');
  const b = f.packageAt(20000, 2); await transferOnce(f.input, f.deps);
  const c = f.packageAt(10000, 3); const result = await transferOnce(f.input, f.deps);
  assert.deepEqual(result.removedPackages, [a.id]); assert.equal(existsSync(unknown), true);
  assert.equal(existsSync(join(f.input.cacheRoot, b.id)), true); assert.equal(existsSync(join(f.input.cacheRoot, c.id)), true);
  assert.equal(readdirSync(f.input.cacheRoot).some(n => n.startsWith('.transfer')), false);
});

test('low capacity stops before ciphertext download and removes its staging and lock', async t => {
  const f = fixture(t); f.packageAt(1000);
  await assert.rejects(transferOnce(f.input, { ...f.deps, freeBytes: () => 1024n ** 3n }), /SPACE_LOW/);
  assert.equal(f.calls.some(c => c[0] === 'fetch' && c[1].startsWith('objects/')), false);
  assert.deepEqual(readdirSync(f.input.cacheRoot), []); assert.equal(f.published.size, 0);
});

test('path injection and stale latest are rejected before manifest/size/SSH publication', async t => {
  const f = fixture(t), p = f.packageAt(1000);
  for (const latest of [{ ...p.latest, packageId: '../$(touch nope)' }, { ...p.latest, contentHash: 'x;id' }]) {
    writeFileSync(join(f.source, 'latest.json'), JSON.stringify(latest));
    await assert.rejects(transferOnce(f.input, f.deps), /LATEST_INVALID/);
  }
  f.packageAt(901000, 2); await assert.rejects(transferOnce(f.input, f.deps), /RECOVERY_POINT_STALE/);
  assert.equal(f.calls.every(c => c[0] === 'fetch' && c[1] === 'latest.json'), true);
});

test('manifest replacement during transfer fails without receipt, complete cache, or surviving staging', async t => {
  const f = fixture(t), p = f.packageAt(1000); let reads = 0;
  const fetch = f.deps.remote.fetch;
  f.deps.remote.fetch = async (path, target) => {
    await fetch(path, target);
    if (path.endsWith('/manifest.json') && ++reads === 2) writeFileSync(target, '{}', { mode: 0o600 });
  };
  await assert.rejects(transferOnce(f.input, f.deps), /MANIFEST_CHANGED/);
  assert.equal(f.published.size, 0); assert.deepEqual(readdirSync(f.input.cacheRoot), []);
  assert.equal(existsSync(join(f.input.receiptDir, p.id + '.json')), false);
});

test('cached ciphertext tampering is detected before reusing its signature', async t => {
  const f = fixture(t), p = f.packageAt(1000); await transferOnce(f.input, f.deps);
  writeFileSync(join(f.input.cacheRoot, p.id, 'objects', p.object), Buffer.alloc(100, 8));
  const count = f.calls.filter(c => c[0] === 'publish').length;
  await assert.rejects(transferOnce(f.input, f.deps), /IDENTITY_MISMATCH/);
  assert.equal(f.calls.filter(c => c[0] === 'publish').length, count);
  assert.equal(existsSync(join(f.input.cacheRoot, '.transfer.lock')), false);
});

test('existing lock is never stolen and symlinked cache is rejected', async t => {
  const f = fixture(t); f.packageAt(1000); mkdirSync(f.input.cacheRoot, { mode: 0o700 });
  mkdirSync(join(f.input.cacheRoot, '.transfer.lock'), { mode: 0o700 });
  await assert.rejects(transferOnce(f.input, f.deps), /LOCKED/); assert.equal(f.calls.length, 0);
  rmSync(f.input.cacheRoot, { recursive: true }); symlinkSync(f.source, f.input.cacheRoot);
  await assert.rejects(transferOnce(f.input, f.deps), /PATH_REJECTED/); assert.equal(f.calls.length, 0);
});

test('failed return transport preserves the bounded complete cache for exact retry', async t => {
  const f = fixture(t), a = f.packageAt(30000, 1); await transferOnce(f.input, f.deps);
  f.packageAt(20000, 2); await transferOnce(f.input, f.deps);
  const p = f.packageAt(10000, 3), publish = f.deps.remote.publish;
  f.deps.remote.publish = async () => { throw new Error('fake disconnect'); };
  await assert.rejects(transferOnce(f.input, f.deps), /fake disconnect/);
  assert.equal(existsSync(join(f.input.cacheRoot, a.id)), false); assert.equal(existsSync(join(f.input.cacheRoot, p.id)), true);
  assert.equal(readdirSync(f.input.cacheRoot).filter(n => /^\d{13}_/.test(n)).length, 2);
  f.deps.remote.publish = publish;
  assert.equal((await transferOnce(f.input, f.deps)).code, 'TRANSFER_ALREADY_OBSERVED');
});

test('M1 existing signed receipt is verified and reused after this cache loses the package', async t => {
  const f = fixture(t), p = f.packageAt(10000); await transferOnce(f.input, f.deps);
  const old = f.published.get(p.id); rmSync(join(f.input.cacheRoot, p.id), { recursive: true });
  f.deps.remote.existingReceipt = async () => old.toString('utf8');
  const next = await transferOnce(f.input, f.deps);
  assert.equal(next.code, 'TRANSFER_ALREADY_OBSERVED'); assert.deepEqual(f.published.get(p.id), old);
  rmSync(join(f.input.cacheRoot, p.id), { recursive: true });
  const tampered = JSON.parse(old); tampered.payload.ciphertextSha256 = '0'.repeat(64);
  f.deps.remote.existingReceipt = async () => JSON.stringify(tampered);
  await assert.rejects(transferOnce(f.input, f.deps), /SIGNATURE_INVALID/);
  assert.equal(existsSync(join(f.input.cacheRoot, p.id)), false);
});

test('archive failure happens after M1 delivery and cannot erase or renew the receipt', async t => {
  const f = fixture(t), p = f.packageAt(1000);
  const result = await transferOnce(f.input, { ...f.deps, archive: async () => { assert.equal(f.published.has(p.id), true); throw new Error('fake iCloud unavailable'); } });
  assert.equal(result.ok, true); assert.equal(result.receiptReturnedToM1, true); assert.equal(result.archiveStatus, 'ARCHIVE_FAILED');
  assert.equal(existsSync(join(f.input.receiptDir, p.id + '.json')), false);
  const bytes = f.published.get(p.id); await transferOnce(f.input, f.deps);
  assert.deepEqual(f.published.get(p.id), bytes);
});

test('archive prunes only authenticated receipts older than seven days, keeping exact boundary, cache pins and unknown files', async t => {
  const f = fixture(t), first = f.packageAt(1000); await transferOnce(f.input, f.deps);
  const template = JSON.parse(f.published.get(first.id)).payload, now = Date.now(), week = 7 * 86400000;
  const key = createPrivateKey(readFileSync(f.input.signingKeyFile));
  const publicKeyPem = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  function oldReceipt(age) {
    const recoveryPointAt = new Date(now - age).toISOString(), packageId = core.packageIdFor(recoveryPointAt, template.contentHash);
    const payload = { ...template, packageId, recoveryPointAt, readStartedAt: recoveryPointAt, readCompletedAt: recoveryPointAt };
    const receipt = { payload, signature: sign(null, Buffer.from('f1plus1-off-host-read-v1\n' + core.canonicalJson(payload)), key).toString('base64url') };
    const bytes = Buffer.from(JSON.stringify(receipt) + '\n'), path = join(f.input.receiptDir, packageId + '.json');
    return { id: packageId, path, bytes };
  }
  const expired = oldReceipt(week + 1), boundary = oldReceipt(week), current = oldReceipt(week + 1000), cached = oldReceipt(week + 2000);
  const badSignature = oldReceipt(week + 3000), unknown = oldReceipt(week + 4000), linked = oldReceipt(week + 5000), directory = oldReceipt(week + 6000), hardlinked = oldReceipt(week + 7000);
  for (const item of [expired, boundary, cached, badSignature, hardlinked]) writeFileSync(item.path, item.bytes, { mode: 0o600 });
  const forged = JSON.parse(badSignature.bytes); forged.signature = Buffer.alloc(64).toString('base64url'); writeFileSync(badSignature.path, JSON.stringify(forged));
  writeFileSync(unknown.path, '{"unrelated":"keep"}', { mode: 0o600 });
  symlinkSync(expired.path, linked.path); mkdirSync(directory.path, { mode: 0o700 });
  linkSync(hardlinked.path, join(f.root, 'keep-hardlink'));
  const result = archiveReceipt(f.input.receiptDir, current.id, current.bytes, { protectedPackages: [cached.id], now, publicKeyPem });
  assert.deepEqual(result.removedPackages, [expired.id]);
  assert.equal(existsSync(expired.path), false);
  for (const item of [boundary, current, cached, badSignature, unknown, directory, hardlinked]) assert.equal(existsSync(item.path), true);
  assert.equal(readdirSync(f.input.receiptDir).includes(linked.id + '.json'), true);
  assert.deepEqual(readFileSync(current.path), current.bytes);
});

test('archive refuses dangling links and a different file created concurrently without overwriting either', t => {
  const f = fixture(t), id = '1788709909073_60364844270a141b';
  mkdirSync(f.input.receiptDir, { mode: 0o700 });
  const final = join(f.input.receiptDir, id + '.json'), absent = join(f.root, 'absent');
  symlinkSync(absent, final);
  assert.throws(() => archiveReceipt(f.input.receiptDir, id, Buffer.from('new receipt')), /PATH_REJECTED/);
  assert.equal(fs.lstatSync(final).isSymbolicLink(), true); assert.equal(existsSync(absent), false);
  rmSync(final);
  const originalLink = fs.linkSync;
  try {
    fs.linkSync = (from, to) => {
      if (to === final) writeFileSync(final, 'concurrent evidence', { flag: 'wx', mode: 0o600 });
      return originalLink(from, to);
    };
    syncBuiltinESMExports();
    assert.throws(() => archiveReceipt(f.input.receiptDir, id, Buffer.from('new receipt')), /RECEIPT_CONFLICT/);
  } finally { fs.linkSync = originalLink; syncBuiltinESMExports(); }
  assert.equal(readFileSync(final, 'utf8'), 'concurrent evidence');
  assert.deepEqual(readdirSync(f.input.receiptDir), [id + '.json']);
  const interrupted = join(f.root, 'interrupted-publication'); linkSync(final, interrupted);
  assert.throws(() => archiveReceipt(f.input.receiptDir, id, Buffer.from('concurrent evidence')), /PATH_REJECTED/);
  assert.equal(statSync(final).nlink, 2); assert.equal(existsSync(interrupted), true);
});

test('command timeout kills a process group that ignores TERM', async () => {
  const started = Date.now();
  await assert.rejects(runCommand(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], 100), /COMMAND_FAILED/);
  assert.ok(Date.now() - started < 2500);
});

test('command timeout terminates an ignoring grandchild as well as its leader', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'f1-transfer-group-'))), pidFile = join(root, 'pid');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');process.on('SIGTERM',()=>{});const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});fs.writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000);`;
  await assert.rejects(runCommand(process.execPath, ['-e', code, pidFile], 250), /COMMAND_FAILED/);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 20 && alive; i++) {
    try { process.kill(pid, 0); await new Promise(done => setTimeout(done, 25)); }
    catch (error) { assert.equal(error.code, 'ESRCH'); alive = false; }
  }
  assert.equal(alive, false);
});
