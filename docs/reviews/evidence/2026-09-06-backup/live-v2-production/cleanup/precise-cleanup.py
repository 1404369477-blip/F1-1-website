#!/usr/bin/env python3
"""Inventory by default. Execution requires the coordinating agent's exact manifest approval.
Only this run's named stage roots are supported. Never removes a directory, JSON, key or log.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import stat
import subprocess
import sys

M1 = '[M1-HOME]/F1-1-website/backups/live-v2-stage-20260906-02'
M5 = '[M5-HOME]/Library/Application Support/F1Plus1/BackupObserver/manual-preflight-02'
M1_NAMES = ['restore', 'restore-02', 'restore-03', 'restore-04', 'restore-05',
            'frozen-01', 'clone-01', 'snap', 'preflight-02/restore', 'preflight-02/clone', 'preflight-02/snap']
CIPHER = re.compile(r'^db-projection-snapshot\.[a-f0-9]{64}\.[a-f0-9]{16}$')
PACKAGE = re.compile(r'^[0-9]{13}_[a-f0-9]{16}$')


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def roots_for(machine):
    return [M1 + '/' + name for name in M1_NAMES] if machine == 'm1' else [M5]


def metadata(path, relative):
    s = os.lstat(path)
    return dict(relativePath=relative, dev=s.st_dev, ino=s.st_ino, mode=s.st_mode,
                uid=s.st_uid, gid=s.st_gid, nlink=s.st_nlink, size=s.st_size,
                allocatedBytes=s.st_blocks * 512, mtimeNs=s.st_mtime_ns,
                type='directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode)
                else 'symlink' if stat.S_ISLNK(s.st_mode) else 'other')


def candidate(root, relative):
    # Plain DB artifacts and encrypted manual objects only; all JSON/projection/log/key files stay.
    if root in [M1 + '/' + n for n in M1_NAMES if n.startswith('restore') or n == 'preflight-02/restore']:
        return relative == 'db/snapshot.sqlite'
    if root in [M1 + '/clone-01', M1 + '/preflight-02/clone']:
        return relative in ['f1plus1-rss-real-private.sqlite', 'f1plus1-rss-real-private.sqlite-wal', 'f1plus1-rss-real-private.sqlite-shm']
    if root in [M1 + '/frozen-01', M1 + '/snap', M1 + '/preflight-02/snap', M5]:
        parts = relative.split('/')
        return len(parts) == 2 and parts[0] == 'objects' and bool(CIPHER.fullmatch(parts[1]))
    return False


def lsof(root):
    result = subprocess.run(['/usr/sbin/lsof', '-nP', '-F', 'pcfn', '+D', root],
                            capture_output=True, text=True, timeout=30)
    return dict(exitCode=result.returncode, stdout=result.stdout, stderr=result.stderr,
                noOpenHandles=result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip())


def inventory_root(root):
    if os.path.realpath(root) != root:
        raise RuntimeError('ROOT_LINK_REJECTED')
    root_stat = metadata(root, '.')
    if root_stat['type'] != 'directory' or root_stat['uid'] != os.getuid():
        raise RuntimeError('ROOT_IDENTITY_REJECTED')
    rows = []
    def visit(at, relative):
        for name in sorted(os.listdir(at)):
            path = os.path.join(at, name)
            rel = name if not relative else relative + '/' + name
            row = metadata(path, rel)
            row['cleanupCandidate'] = candidate(root, rel) and row['type'] == 'file' and row['nlink'] == 1 and row['uid'] == os.getuid()
            rows.append(row)
            if row['type'] == 'directory':
                visit(path, rel)
    visit(root, '')
    check = lsof(root)
    return dict(root=root, rootIdentity=root_stat, entries=rows, lsof=check,
                fileCount=sum(r['type'] == 'file' for r in rows), directoryCount=sum(r['type'] == 'directory' for r in rows),
                logicalBytes=sum(r['size'] for r in rows if r['type'] == 'file'),
                allocatedBytes=root_stat['allocatedBytes'] + sum(r['allocatedBytes'] for r in rows),
                candidateFileCount=sum(r['cleanupCandidate'] for r in rows),
                candidateLogicalBytes=sum(r['size'] for r in rows if r['cleanupCandidate']),
                candidateAllocatedBytes=sum(r['allocatedBytes'] for r in rows if r['cleanupCandidate']))


def inventory(machine):
    roots = [inventory_root(root) for root in roots_for(machine)]
    return dict(schemaVersion='f1-live-v2-precise-cleanup-inventory-v1', machine=machine, observedAt=utc(),
                scope='read-only metadata and lsof; no DB, ciphertext, private-key or AES contents read',
                roots=roots, candidateCount=sum(r['candidateFileCount'] for r in roots),
                candidateAllocatedBytes=sum(r['candidateAllocatedBytes'] for r in roots),
                candidateLogicalBytes=sum(r['candidateLogicalBytes'] for r in roots),
                allRootsUnused=all(r['lsof']['noOpenHandles'] for r in roots),
                gates=['Three distinct production v2 cycles independently verified successful by coordinator',
                       'This exact inventory SHA256 and selected paths explicitly approved by coordinator',
                       'Evidence copied or retained; all JSON, projection, logs and keys remain',
                       'Fresh complete metadata equality and fresh lsof no handles before any unlink'])


def execute(args):
    raw = open(args.manifest, 'rb').read()
    manifest = json.loads(raw)
    auth = json.load(open(args.authorization, encoding='utf8'))
    if manifest.get('schemaVersion') != 'f1-live-v2-precise-cleanup-inventory-v1' or manifest.get('machine') != args.machine:
        raise RuntimeError('MANIFEST_REJECTED')
    if auth.get('schemaVersion') != 'f1-live-v2-cleanup-authorization-v1' or auth.get('manifestSha256') != hashlib.sha256(raw).hexdigest() or auth.get('machine') != args.machine:
        raise RuntimeError('EXACT_COORDINATOR_AUTHORIZATION_REQUIRED')
    cycles = auth.get('threeSuccessfulProductionCycles', [])
    if len(cycles) != 3 or len({c.get('packageId') for c in cycles}) != 3 or any(not PACKAGE.fullmatch(c.get('packageId', '')) or not re.fullmatch('[a-f0-9]{64}', c.get('evidenceSha256', '')) for c in cycles):
        raise RuntimeError('THREE_SUCCESSFUL_CYCLE_EVIDENCE_REQUIRED')
    # The coordinator reviews the three success receipts; their hashes are immutable approval inputs.
    if auth.get('coordinatorVerifiedThreeCycleSuccess') is not True or auth.get('evidencePreservationConfirmed') is not True:
        raise RuntimeError('COORDINATOR_GATES_REQUIRED')
    if [r['root'] for r in manifest['roots']] != roots_for(args.machine):
        raise RuntimeError('SCOPE_REJECTED')
    approved = auth.get('approvedCandidatePaths', [])
    if not approved or len(set(approved)) != len(approved):
        raise RuntimeError('APPROVED_PATHS_REQUIRED')
    candidates = {os.path.join(r['root'], e['relativePath']): e for r in manifest['roots'] for e in r['entries'] if e['cleanupCandidate'] and candidate(r['root'], e['relativePath'])}
    if any(path not in candidates for path in approved):
        raise RuntimeError('UNLISTED_PATH_REJECTED')
    # Recheck every root before the first destructive operation, including preserved artifacts.
    for expected in manifest['roots']:
        current = inventory_root(expected['root'])
        if current['rootIdentity'] != expected['rootIdentity'] or current['entries'] != expected['entries'] or not current['lsof']['noOpenHandles']:
            raise RuntimeError('ROOT_CHANGED_OR_IN_USE')
    before = os.statvfs(roots_for(args.machine)[0])
    receipt = dict(schemaVersion='f1-live-v2-precise-cleanup-receipt-v1', machine=args.machine, startedAt=utc(),
                   manifestSha256=hashlib.sha256(raw).hexdigest(), authorizationSha256=hashlib.sha256(open(args.authorization, 'rb').read()).hexdigest(),
                   freeBytesBefore=before.f_bavail * before.f_frsize, deleted=[], preservedAllDirectories=True,
                   preservedAllJsonLogsKeysProjection=True)
    # Reserve the evidence file before any deletion; never overwrite an earlier receipt.
    if any(os.path.abspath(args.receipt) == root or os.path.abspath(args.receipt).startswith(root + '/') for root in roots_for(args.machine)):
        raise RuntimeError('RECEIPT_MUST_BE_OUTSIDE_CANDIDATE_ROOTS')
    fd = os.open(args.receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    def persist():
        data = (json.dumps(receipt, ensure_ascii=False, indent=2) + '\n').encode()
        os.lseek(fd, 0, os.SEEK_SET)
        remaining = memoryview(data)
        while remaining:
            written = os.write(fd, remaining)
            if written <= 0:
                raise RuntimeError('RECEIPT_WRITE_FAILED')
            remaining = remaining[written:]
        os.ftruncate(fd, len(data))
        os.fsync(fd)
    persist()
    try:
        for path in approved:
            expected = candidates[path]
            current = metadata(path, expected['relativePath'])
            if current != {k: v for k, v in expected.items() if k != 'cleanupCandidate'} or current['type'] != 'file' or current['nlink'] != 1:
                raise RuntimeError('FILE_CHANGED_BEFORE_UNLINK')
            receipt['pendingUnlink'] = dict(path=path, dev=expected['dev'], ino=expected['ino'], size=expected['size'])
            persist()
            os.unlink(path)
            receipt['deleted'].append(dict(path=path, dev=expected['dev'], ino=expected['ino'], size=expected['size'], allocatedBytes=expected['allocatedBytes']))
            receipt.pop('pendingUnlink', None)
            persist()
        receipt['ok'] = True
    except Exception as error:
        receipt['ok'] = False
        receipt['error'] = str(error)
        raise
    finally:
        after = os.statvfs(roots_for(args.machine)[0])
        receipt.update(finishedAt=utc(), freeBytesAfter=after.f_bavail * after.f_frsize)
        try:
            persist()
        finally:
            os.close(fd)
        print(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--machine', choices=['m1', 'm5'], required=True)
    p.add_argument('--execute', action='store_true')
    p.add_argument('--manifest')
    p.add_argument('--authorization')
    p.add_argument('--receipt')
    args = p.parse_args()
    if args.execute:
        if not all([args.manifest, args.authorization, args.receipt]):
            p.error('execution requires manifest, coordinator authorization and a new receipt path')
        execute(args)
    else:
        print(json.dumps(inventory(args.machine), ensure_ascii=False, indent=2))
