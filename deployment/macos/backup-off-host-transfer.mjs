/** M5 only: SSH ciphertext transport, independent signed read, bounded two-package cache.
 * The caller verifies the fixed runtime first. This CLI also re-verifies it before import.
 * No production action happens on import; tests inject a local transport into transferOnce.
 */
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = 'F1-1-website/backups/snap';
const DESTINATION = 'F1-1-website/backups/off-host-receipts';
const PACKAGE = /^[0-9]{13}_[a-f0-9]{16}$/;
const HASH = /^[a-f0-9]{64}$/;
const KIND = 'db-projection-snapshot';
const GIB = 1024 ** 3;
const ACTIVE = new Map();
let interrupted = false;
let interruptionSignal;
const digest = value => createHash('sha256').update(value).digest('hex');
export const TRANSFER_BUDGET = Object.freeze({ workerMs: 240000, cipherMs: 210000, tailMs: 25000, cliSeconds: 245, supervisorMs: 249000 });
const PHASES = new Set(['COMMAND', 'WORKER', 'RUNTIME_VERIFY', 'LATEST_FETCH', 'MANIFEST_FETCH', 'MANIFEST_RECHECK', 'OBJECT_SIZE', 'CIPHERTEXT_FETCH', 'RECEIPT_LOOKUP', 'RECEIPT_UPLOAD', 'RECEIPT_COMMIT', 'REMOTE_CLEANUP', 'LOCAL_CLEANUP', 'ARCHIVE']);
const REASONS = new Set(['TIMEOUT', 'DEADLINE', 'CHILD_EXIT', 'SIGNAL', 'SPAWN_ERROR', 'OUTPUT_LIMIT', 'FILE_LIMIT', 'OTHER']);
const SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGABRT', 'SIGSEGV', 'SIGPIPE', 'SIGBUS', 'SIGILL', 'SIGTRAP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2']);
function cleanDiagnostic(value) {
  if (!value || !PHASES.has(value.phase) || !REASONS.has(value.reason)) return undefined;
  const result = { phase: value.phase, reason: value.reason };
  for (const name of ['elapsedMs', 'limitMs', 'outputBytes', 'partialBytes']) {
    if (Number.isSafeInteger(value[name]) && value[name] >= 0) result[name] = value[name];
  }
  if (Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255) result.exitCode = value.exitCode;
  if (SIGNALS.has(value.signal)) result.signal = value.signal;
  return result;
}
export function failureRecord(error) {
  const code = /^(TRANSFER|OFF_HOST)_[A-Z_]+$/.test(error?.message) ? error.message : 'TRANSFER_FAILED';
  return { ok: false, code, ...(cleanDiagnostic(error?.diagnostic) ? { diagnostic: cleanDiagnostic(error.diagnostic) } : {}),
    ...(cleanDiagnostic(error?.cleanupDiagnostic) ? { cleanupDiagnostic: cleanDiagnostic(error.cleanupDiagnostic) } : {}) };
}
function commandFailure(diagnostic) { return Object.assign(new Error('TRANSFER_COMMAND_FAILED'), { diagnostic: cleanDiagnostic(diagnostic) }); }
export function commandBudget(deadline, maximumMs, phase, now = Date.now(), reserveMs = 0) {
  const remaining = Math.floor(deadline - now - reserveMs);
  if (remaining <= 0) throw commandFailure({ phase, reason: 'DEADLINE', elapsedMs: 0, limitMs: 0 });
  return Math.min(maximumMs, remaining);
}
function fail(code) { throw new Error(`TRANSFER_${code}`); }
function demand(condition, code) { if (!condition) fail(code); }
function privatePath(path, directory = false) {
  const s = lstatSync(path);
  demand(!s.isSymbolicLink() && s.uid === process.getuid() && !(s.mode & 0o077) &&
    (directory ? s.isDirectory() : s.isFile() && s.nlink === 1), 'PATH_REJECTED');
  demand(realpathSync(path) === path, 'PATH_REJECTED');
  return s;
}
function directory(path) {
  demand(isAbsolute(path) && resolve(path) === path, 'PATH_REJECTED');
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  privatePath(path, true);
}
function readSmall(path, limit = 4 * 1024 * 1024) {
  const before = privatePath(path);
  demand(before.size <= limit, 'FILE_TOO_LARGE');
  const bytes = readFileSync(path), after = privatePath(path);
  demand(before.dev === after.dev && before.ino === after.ino && before.size === bytes.length &&
    before.mtimeMs === after.mtimeMs, 'FILE_CHANGED');
  return bytes;
}
function writePrivate(path, bytes) {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDir(path) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function signalGroup(child, signal) { if (!Number.isInteger(child.pid)) return; try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
function stopCommands() { for (const [child, graceMs] of ACTIVE) { signalGroup(child, 'SIGTERM'); setTimeout(() => signalGroup(child, 'SIGKILL'), graceMs); } }

/** No shell for local commands. Remote shell text is made only from fixed prefixes and validated hex IDs. */
export function runCommand(command, args, timeoutMs, fileLimit, { phase = 'COMMAND', forwardDiagnostic = false, killGraceMs = 1000 } = {}) {
  demand(timeoutMs > 0 && !interrupted, 'DEADLINE');
  demand(PHASES.has(phase), 'PHASE_INVALID');
  demand(Number.isInteger(killGraceMs) && killGraceMs >= 1000 && killGraceMs <= 3000, 'GRACE_INVALID');
  const startedAt = Date.now();
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    ACTIVE.set(child, killGraceMs);
    let output = Buffer.alloc(0), errorOutput = Buffer.alloc(0), bytes = 0, reason, killTimer;
    const stop = why => { reason ??= why; signalGroup(child, 'SIGTERM'); killTimer ??= setTimeout(() => signalGroup(child, 'SIGKILL'), killGraceMs); };
    const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    const fileTimer = fileLimit && setInterval(() => {
      try { const s = lstatSync(fileLimit.path); if (!s.isFile() || s.isSymbolicLink() || s.size > fileLimit.bytes) stop('FILE_LIMIT'); }
      catch (error) { if (error.code !== 'ENOENT') stop('FILE_LIMIT'); }
    }, 50);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 65536) stop('OUTPUT_LIMIT');
      else if (stream === child.stdout) output = Buffer.concat([output, chunk]);
      else if (forwardDiagnostic) errorOutput = Buffer.concat([errorOutput, chunk]);
    });
    child.once('error', () => { reason ??= 'SPAWN_ERROR'; });
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer); clearInterval(fileTimer);
      // SSH/scp descendants must not outlive this bounded invocation.
      signalGroup(child, 'SIGKILL'); ACTIVE.delete(child);
      const supervisorStopped = Boolean(reason);
      reason ??= signal || interrupted ? 'SIGNAL' : code !== 0 ? 'CHILD_EXIT' : undefined;
      let partialBytes;
      if (fileLimit) {
        try {
          const s = lstatSync(fileLimit.path);
          if (s.isFile() && !s.isSymbolicLink()) partialBytes = s.size;
          if (!s.isFile() || s.isSymbolicLink() || s.size > fileLimit.bytes) reason ??= 'FILE_LIMIT';
        } catch { reason ??= 'FILE_LIMIT'; }
      }
      if (code === 0 && !reason && !interrupted) accept(output.toString('utf8'));
      else {
        const error = commandFailure({ phase, reason: reason ?? (signal || interrupted ? 'SIGNAL' : 'CHILD_EXIT'), elapsedMs: Date.now() - startedAt, limitMs: Math.ceil(timeoutMs), outputBytes: bytes, partialBytes, exitCode: code, signal: signal ?? interruptionSignal });
        // Only our explicit worker boundary may forward structured, allowlisted data.
        // A parent's own timeout/cap remains primary even if the child prints a record.
        if (forwardDiagnostic && !supervisorStopped && code !== 0 && !signal && !interrupted) {
          for (const line of errorOutput.toString('utf8').trim().split('\n').reverse()) {
            try {
              const record = JSON.parse(line);
              if (record.ok !== false || !/^(TRANSFER|OFF_HOST)_[A-Z_]+$/.test(record.code)) continue;
              error.message = record.code;
              if (cleanDiagnostic(record.diagnostic)) error.diagnostic = cleanDiagnostic(record.diagnostic);
              if (cleanDiagnostic(record.cleanupDiagnostic)) error.cleanupDiagnostic = cleanDiagnostic(record.cleanupDiagnostic);
              break;
            } catch {}
          }
        }
        reject(error);
      }
    });
  });
}
export function transport(deadline, { command = runCommand, now = Date.now } = {}) {
  const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2'];
  const run = (cmd, args, seconds, phase, fileLimit) => command(cmd, args, commandBudget(deadline, seconds * 1000, phase, now(), phase === 'CIPHERTEXT_FETCH' ? TRANSFER_BUDGET.tailMs : 0), fileLimit, { phase });
  return {
    fetch: (remote, local, maxBytes = 4 * 1024 * 1024, phase = remote === 'latest.json' ? 'LATEST_FETCH' : remote.startsWith('objects/') ? 'CIPHERTEXT_FETCH' : 'MANIFEST_FETCH') => run('/usr/bin/scp', ['-q', '-B', ...options, `home-mac:${SOURCE}/${remote}`, local], phase === 'CIPHERTEXT_FETCH' ? TRANSFER_BUDGET.cipherMs / 1000 : 15, phase, { path: local, bytes: maxBytes }),
    size: object => run('/usr/bin/ssh', ['-T', ...options, 'home-mac', `/usr/bin/stat -f %z ${SOURCE}/objects/${object}`], 15, 'OBJECT_SIZE'),
    existingReceipt: packageId => {
      demand(PACKAGE.test(packageId), 'IDENTITY_INVALID');
      const path = `${DESTINATION}/${packageId}.json`;
      return run('/usr/bin/ssh', ['-T', ...options, 'home-mac', `if test -L ${path}; then exit 1; elif test -f ${path}; then cat ${path}; elif test -e ${path}; then exit 1; fi`], 15, 'RECEIPT_LOOKUP');
    },
    async publish(local, packageId, nonce) {
      demand(PACKAGE.test(packageId) && /^[a-f0-9]{32}$/.test(nonce), 'IDENTITY_INVALID');
      const temporary = `${DESTINATION}/.${packageId}.${nonce}.tmp`, final = `${DESTINATION}/${packageId}.json`;
      try {
        await run('/usr/bin/scp', ['-q', '-B', ...options, local, `home-mac:${temporary}`], 20, 'RECEIPT_UPLOAD');
        // Refuse replacement of a different receipt: observation time must never be renewed.
        const command = `set -eu; umask 077; trap 'rm -f ${temporary}' EXIT; test -f ${temporary}; test ! -L ${temporary}; chmod 600 ${temporary}; if test -e ${final} || test -L ${final}; then test -f ${final}; test ! -L ${final}; cmp -s ${temporary} ${final}; else mv -n ${temporary} ${final}; test -f ${final}; test ! -L ${final}; if test -e ${temporary}; then cmp -s ${temporary} ${final}; fi; fi`;
        await run('/usr/bin/ssh', ['-T', ...options, 'home-mac', command], 15, 'RECEIPT_COMMIT');
      } catch (error) {
        // A disconnected host may make remote cleanup impossible; local cache still stays bounded.
        try { await run('/usr/bin/ssh', ['-T', ...options, 'home-mac', `rm -f ${temporary}`], 5, 'REMOTE_CLEANUP'); }
        catch (cleanupError) { error.cleanupDiagnostic = cleanDiagnostic(cleanupError.diagnostic) ?? { phase: 'REMOTE_CLEANUP', reason: 'OTHER' }; }
        throw error;
      }
    }
  };
}
function pointer(bytes, now) {
  let p; try { p = JSON.parse(bytes); } catch { fail('LATEST_INVALID'); }
  demand(p && JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['schemaVersion', 'packageId', 'recovery_point_at', 'contentHash', 'kind', 'keyId'].sort()), 'LATEST_INVALID');
  demand(p.schemaVersion === 'backup-snapshot-latest-v1' && p.kind === KIND && PACKAGE.test(p.packageId) && HASH.test(p.contentHash) && /^[a-f0-9]{16}$/.test(p.keyId), 'LATEST_INVALID');
  const at = Date.parse(p.recovery_point_at);
  demand(Number.isFinite(at) && new Date(at).toISOString() === p.recovery_point_at && p.packageId === `${at}_${p.contentHash.slice(0, 16)}`, 'LATEST_INVALID');
  demand(at <= now + 30000 && now - at <= 900000, 'RECOVERY_POINT_STALE');
  return p;
}
function inventory(root) {
  privatePath(root, true);
  return readdirSync(root).flatMap(name => {
    const path = join(root, name), st = lstatSync(path);
    privatePath(path, st.isDirectory());
    return st.isDirectory() ? inventory(path).map(child => `${name}/${child}`) : [name];
  }).sort();
}
function expectedFiles(id, object) { return ['latest.json', 'ownership.json', 'receipt.json', `objects/${object}`, `packages/${id}/manifest.json`].sort(); }
function entry(root, id) {
  demand(PACKAGE.test(id), 'CACHE_UNOWNED');
  const marker = JSON.parse(readSmall(join(root, 'ownership.json'), 4096));
  demand(marker.schemaVersion === 'm5-ssh-cipher-cache-v1' && marker.packageId === id && HASH.test(marker.manifestSha256) && HASH.test(marker.ciphertextSha256) && /^[a-f0-9]{16}$/.test(marker.keyId), 'CACHE_UNOWNED');
  const object = `${KIND}.${marker.contentHash}.${marker.keyId}`;
  demand(HASH.test(marker.contentHash) && JSON.stringify(inventory(root)) === JSON.stringify(expectedFiles(id, object)), 'CACHE_UNOWNED');
  demand(digest(readSmall(join(root, 'packages', id, 'manifest.json'))) === marker.manifestSha256, 'CACHE_CHANGED');
  return { marker, object };
}
function retainTwo(cacheRoot, current) {
  const owned = [];
  for (const name of readdirSync(cacheRoot)) {
    if (!PACKAGE.test(name)) continue;
    try { entry(join(cacheRoot, name), name); owned.push(name); } catch { /* Unknown/incomplete/tampered directories are never deleted. */ }
  }
  const removed = [];
  // The package selected by M1 latest is pinned through this transaction; retain one other newest point.
  for (const id of owned.filter(id => id !== current).sort().reverse().slice(1)) {
    const path = join(cacheRoot, id); entry(path, id);
    rmSync(path, { recursive: true }); removed.push(id);
  }
  if (removed.length) syncDir(cacheRoot);
  return removed;
}
export function archiveReceipt(directoryPath, id, bytes, { protectedPackages = [], now = Date.now(), publicKeyPem } = {}) {
  directory(directoryPath);
  const final = join(directoryPath, `${id}.json`);
  let present = false;
  try { lstatSync(final); present = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (present) demand(readSmall(final, 16384).equals(bytes), 'RECEIPT_CONFLICT');
  else {
    const temporary = join(directoryPath, `.${id}.${randomUUID()}.tmp`);
    try {
      writePrivate(temporary, bytes);
      try { linkSync(temporary, final); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        demand(readSmall(final, 16384).equals(bytes), 'RECEIPT_CONFLICT');
      }
      syncDir(directoryPath);
    } finally {
      if (existsSync(temporary)) { unlinkSync(temporary); syncDir(directoryPath); }
    }
    // A crash between link and unlink can leave nlink=2. Future runs retain and reject
    // that interrupted publication; they never replace a link or silently claim success.
  }
  const preserve = new Set([id, ...protectedPackages]);
  const removed = [];
  // Public key only. Unknown or invalid signatures must never become cleanup candidates.
  const publicKey = publicKeyPem ? createPublicKey(publicKeyPem) : null;
  if (publicKey?.asymmetricKeyType !== 'ed25519') return { removedPackages: removed };
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
  for (const name of readdirSync(directoryPath)) {
    const match = /^([0-9]{13}_[a-f0-9]{16})\.json$/.exec(name);
    if (!match || preserve.has(match[1]) || now - Number(match[1].slice(0, 13)) <= 7 * 86400000) continue;
    const path = join(directoryPath, name);
    try {
      // Do not delete an unrelated file merely because its filename resembles a receipt.
      const before = privatePath(path), record = JSON.parse(readSmall(path, 16384)), p = record.payload;
      if (JSON.stringify(Object.keys(record).sort()) !== '["payload","signature"]' ||
        typeof record.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(record.signature) ||
        p?.schemaVersion !== 'f1plus1-off-host-read-v1' || p.observerRef !== 'm5-backup-verifier-v1' ||
        p.packageId !== match[1] || !HASH.test(p.contentHash) ||
        `${Date.parse(p.recoveryPointAt)}_${p.contentHash.slice(0, 16)}` !== match[1]) continue;
      if (!verify(null, Buffer.from(`f1plus1-off-host-read-v1\n${canonical(p)}`), publicKey, Buffer.from(record.signature, 'base64url'))) continue;
      const after = privatePath(path);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
      unlinkSync(path); removed.push(match[1]);
    } catch { /* Unknown, changed, non-owned, linked or unreadable files are retained. */ }
  }
  if (removed.length) syncDir(directoryPath);
  return { removedPackages: removed };
}
function cachePins(cacheRoot) {
  privatePath(cacheRoot, true);
  // Conservative protection also keeps receipts for unfamiliar package-shaped directories.
  return readdirSync(cacheRoot).filter(name => PACKAGE.test(name));
}

/** Dependency injection is an in-process test seam; no remote/path override exists in the CLI. */
export async function transferOnce(input, dependencies) {
  const { api, remote, now = Date.now, archive = async (file, id) => archiveReceipt(input.receiptDir, id, readSmall(file, 16384), { protectedPackages: cachePins(input.cacheRoot), publicKeyPem: createPublicKey(readSmall(input.signingKeyFile, 4096)).export({ type: 'spki', format: 'pem' }) }), freeBytes = path => { const s = statfsSync(path, { bigint: true }); return s.bavail * s.bsize; } } = dependencies;
  const start = now(), deadline = dependencies.deadline ?? start + TRANSFER_BUDGET.workerMs;
  const check = () => demand(now() < deadline && !interrupted, 'DEADLINE');
  check();
  directory(input.cacheRoot); privatePath(input.signingKeyFile);
  const lock = join(input.cacheRoot, '.transfer.lock'), token = randomUUID();
  try { mkdirSync(lock, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') fail('LOCKED'); throw error; }
  let stage, stageIdentity, committed, lockOwned = false, primaryError;
  try {
    writePrivate(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token, startedAt: new Date(start).toISOString() }));
    lockOwned = true;
    const key = readSmall(input.signingKeyFile, 4096).toString('utf8');
    const publicKeyPem = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
    stage = join(input.cacheRoot, `.transfer-${token}`); directory(stage); stageIdentity = privatePath(stage, true);
    demand(freeBytes(input.cacheRoot) >= BigInt(GIB + 8 * 1024 * 1024), 'SPACE_LOW');
    await remote.fetch('latest.json', join(stage, 'latest.json')); check();
    const p = pointer(readSmall(join(stage, 'latest.json'), 16384), now());
    const cached = join(input.cacheRoot, p.packageId), object = `${KIND}.${p.contentHash}.${p.keyId}`;
    let receipt, reused = false;
    if (existsSync(cached)) {
      const owned = entry(cached, p.packageId); demand(owned.object === object, 'CACHE_CHANGED');
      receipt = JSON.parse(readSmall(join(cached, 'receipt.json'), 16384));
      const cipher = api.hashCiphertextFile(join(cached, 'objects', object)); check();
      api.verifyOffHostReceipt({ receipt, publicKeyPem, expected: { packageId: p.packageId, recoveryPointAt: p.recovery_point_at, contentHash: p.contentHash, keyId: p.keyId, manifestSha256: owned.marker.manifestSha256, ciphertextSha256: cipher.sha256, ciphertextBytes: cipher.bytes }, now: new Date(now()) });
      committed = cached; reused = true;
    } else {
      directory(join(stage, 'packages')); directory(join(stage, 'packages', p.packageId)); directory(join(stage, 'objects'));
      const manifestPath = join(stage, 'packages', p.packageId, 'manifest.json');
      await remote.fetch(`packages/${p.packageId}/manifest.json`, manifestPath); check();
      const manifestBytes = readSmall(manifestPath), manifest = api.parseManifest(manifestBytes.toString('utf8'));
      demand(manifest.kind === KIND && manifest.recovery_point_at === p.recovery_point_at && manifest.contentHash === p.contentHash && manifest.keyId === p.keyId, 'MANIFEST_MISMATCH');
      const sizeText = (await remote.size(object)).trim(); check();
      demand(/^[0-9]{2,11}$/.test(sizeText), 'SIZE_INVALID');
      const size = Number(sizeText); demand(Number.isSafeInteger(size) && size >= 29 && size <= 4 * GIB, 'SIZE_INVALID');
      demand(freeBytes(input.cacheRoot) >= BigInt(size + GIB + 8 * 1024 * 1024), 'SPACE_LOW');
      await remote.fetch(`objects/${object}`, join(stage, 'objects', object), size); check();
      demand(privatePath(join(stage, 'objects', object)).size === size, 'SIZE_MISMATCH');
      for (const file of [manifestPath, join(stage, 'objects', object)]) { const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
      const secondManifest = join(stage, 'manifest-check.json');
      await remote.fetch(`packages/${p.packageId}/manifest.json`, secondManifest, undefined, 'MANIFEST_RECHECK'); check();
      demand(readSmall(secondManifest).equals(manifestBytes), 'MANIFEST_CHANGED'); unlinkSync(secondManifest);
      // This API reads the ciphertext from this M5 staging filesystem before signing.
      receipt = api.createOffHostReadReceipt({ backupRoot: stage, packageId: p.packageId, privateKeyPem: key }); check();
      api.verifyOffHostReceipt({ receipt, publicKeyPem, expected: { packageId: p.packageId, recoveryPointAt: p.recovery_point_at, contentHash: p.contentHash, keyId: p.keyId, manifestSha256: digest(manifestBytes), ciphertextSha256: receipt.payload.ciphertextSha256, ciphertextBytes: size }, now: new Date(now()) });
      // M1's small receipt is the fallback when this two-package cache no longer contains the point.
      // iCloud is never read before delivering the signed receipt back to M1.
      const previousBytes = remote.existingReceipt ? await remote.existingReceipt(p.packageId) : ''; check();
      if (previousBytes !== '') {
        demand(Buffer.byteLength(previousBytes) <= 16384, 'RECEIPT_TOO_LARGE');
        const previous = JSON.parse(previousBytes);
        api.verifyOffHostReceipt({ receipt: previous, publicKeyPem, expected: { packageId: p.packageId, recoveryPointAt: p.recovery_point_at, contentHash: p.contentHash, keyId: p.keyId, manifestSha256: receipt.payload.manifestSha256, ciphertextSha256: receipt.payload.ciphertextSha256, ciphertextBytes: size }, now: new Date(now()) });
        receipt = previous; reused = true;
      }
      writePrivate(join(stage, 'receipt.json'), `${JSON.stringify(receipt)}\n`);
      writePrivate(join(stage, 'ownership.json'), `${JSON.stringify({ schemaVersion: 'm5-ssh-cipher-cache-v1', packageId: p.packageId, contentHash: p.contentHash, keyId: p.keyId, manifestSha256: receipt.payload.manifestSha256, ciphertextSha256: receipt.payload.ciphertextSha256 })}\n`);
      syncDir(join(stage, 'objects')); syncDir(join(stage, 'packages', p.packageId)); syncDir(join(stage, 'packages')); syncDir(stage);
      demand(!existsSync(cached), 'CACHE_CONFLICT'); renameSync(stage, cached); stage = undefined; committed = cached; syncDir(input.cacheRoot);
    }
    // Retention runs even if the network or iCloud receipt archive later fails.
    const removed = retainTwo(input.cacheRoot, p.packageId); check();
    const receiptFile = join(committed, 'receipt.json'); readSmall(receiptFile, 16384);
    await remote.publish(receiptFile, p.packageId, randomUUID().replaceAll('-', '')); check();
    let archiveStatus = 'ARCHIVED';
    try { await archive(receiptFile, p.packageId); } catch { archiveStatus = 'ARCHIVE_FAILED'; }
    check();
    return { ok: true, code: reused ? 'TRANSFER_ALREADY_OBSERVED' : 'TRANSFER_READ_VERIFIED', receiptReturnedToM1: true, archiveStatus, packageId: p.packageId, recoveryPointAt: p.recovery_point_at, readCompletedAt: receipt.payload.readCompletedAt, ciphertextBytes: receipt.payload.ciphertextBytes, removedPackages: removed };
  } catch (error) {
    primaryError = error; throw error;
  } finally {
    try {
    try {
      if (stage) {
        const current = privatePath(stage, true);
        demand(current.dev === stageIdentity.dev && current.ino === stageIdentity.ino, 'STAGING_CHANGED');
        rmSync(stage, { recursive: true });
      }
    }
    finally {
      if (lockOwned) {
        const owner = JSON.parse(readSmall(join(lock, 'owner.json'), 4096));
        demand(owner.token === token && owner.pid === process.pid, 'LOCK_CHANGED');
        unlinkSync(join(lock, 'owner.json'));
      }
      rmdirSync(lock);
    }
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      primaryError.cleanupDiagnostic ??= cleanDiagnostic(cleanupError.diagnostic) ?? { phase: 'LOCAL_CLEANUP', reason: 'OTHER' };
    }
  }
}

function argumentsFor(argv) {
  const args = new Map();
  demand(argv.length === 10, 'USAGE');
  for (let i = 0; i < argv.length; i += 2) { demand(!args.has(argv[i]), 'USAGE'); args.set(argv[i], argv[i + 1]); }
  demand(['--runtime-root', '--expected-hash', '--signing-key-file', '--cache-root', '--receipt-dir'].every(k => args.has(k)), 'USAGE');
  const input = { runtimeRoot: args.get('--runtime-root'), expectedHash: args.get('--expected-hash'), signingKeyFile: args.get('--signing-key-file'), cacheRoot: args.get('--cache-root'), receiptDir: args.get('--receipt-dir') };
  demand(HASH.test(input.expectedHash), 'USAGE');
  for (const path of [input.runtimeRoot, input.signingKeyFile, input.cacheRoot, input.receiptDir]) demand(isAbsolute(path) && resolve(path) === path, 'PATH_REJECTED');
  demand(input.cacheRoot.startsWith(join(homedir(), 'Library/Application Support') + '/'), 'CACHE_LOCATION_REJECTED');
  demand(input.cacheRoot !== input.receiptDir && !input.receiptDir.startsWith(input.cacheRoot + '/'), 'PATH_REJECTED');
  return input;
}
async function main() {
  demand(process.version === 'v24.18.0', 'NODE_VERSION');
  if (process.argv[2] === '--archive-worker') {
    const [source, receiptDir, id, publicKeyHex] = process.argv.slice(3);
    demand(process.argv.length === 7 && PACKAGE.test(id) && /^[a-f0-9]{88}$/.test(publicKeyHex), 'USAGE');
    demand(isAbsolute(source) && resolve(source) === source && isAbsolute(receiptDir) && resolve(receiptDir) === receiptDir, 'PATH_REJECTED');
    const publicKeyPem = createPublicKey({ key: Buffer.from(publicKeyHex, 'hex'), type: 'spki', format: 'der' }).export({ type: 'spki', format: 'pem' });
    archiveReceipt(receiptDir, id, readSmall(source, 16384), { protectedPackages: cachePins(dirname(dirname(source))), publicKeyPem }); return;
  }
  // Both the CLI supervisor and worker own detached children and must stop them.
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { interrupted = true; interruptionSignal = signal; stopCommands(); process.exitCode = 1; });
  const worker = process.argv[2] === '--bounded-worker';
  const argv = process.argv.slice(worker ? 3 : 2), input = argumentsFor(argv);
  if (!worker) {
    // Outer wall limit includes imports, synchronous hashing, remote commands and cleanup.
    await runCommand(process.execPath, [join(HERE, 'bounded-backup-command.mjs'), String(TRANSFER_BUDGET.cliSeconds), process.execPath, '--experimental-transform-types', fileURLToPath(import.meta.url), '--bounded-worker', ...argv], TRANSFER_BUDGET.supervisorMs, undefined, { phase: 'WORKER', forwardDiagnostic: true, killGraceMs: 3000 }).then(output => process.stdout.write(output));
    return;
  }
  const deadline = Date.now() + TRANSFER_BUDGET.workerMs;
  await runCommand(process.execPath, [join(HERE, 'verify-backup-runtime.mjs'), input.runtimeRoot, input.expectedHash], commandBudget(deadline, 30000, 'RUNTIME_VERIFY'), undefined, { phase: 'RUNTIME_VERIFY' });
  const core = await import(pathToFileURL(join(input.runtimeRoot, 'src/server/backup-snapshot/core.ts')));
  const receipt = await import(pathToFileURL(join(input.runtimeRoot, 'src/server/backup-snapshot/off-host-receipt.ts')));
  const publicKeyHex = createPublicKey(readSmall(input.signingKeyFile, 4096)).export({ type: 'spki', format: 'der' }).toString('hex');
  const result = await transferOnce(input, {
    api: { ...core, ...receipt }, remote: transport(deadline), deadline,
    archive: (source, id) => runCommand(process.execPath, [fileURLToPath(import.meta.url), '--archive-worker', source, input.receiptDir, id, publicKeyHex], commandBudget(deadline, 5000, 'ARCHIVE'), undefined, { phase: 'ARCHIVE' })
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(`${JSON.stringify(failureRecord(error))}\n`); process.exitCode = 1;
});
