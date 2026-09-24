import datetime
import hashlib
import json
import pathlib
import subprocess

repo = pathlib.Path('[M5-HOME]/Documents/F1+1')
source = repo / 'scratch/backup-live-20260906/cleanup'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda n: json.loads((source / n).read_text())
evidence = read('evidence-manifest.json')
result = {
    'schemaVersion': 'f1-live-v2-independent-cleanup-postcheck-v1',
    'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'Read-only exact approved paths, retained small evidence hashes, authorization and receipt bindings; no deletion, job trigger, database or private-key read',
    'machines': {},
    'savedEvidence': [],
}
for machine in ('m1', 'm5'):
    authorization = read(f'{machine}-authorization.json')
    receipt = read(f'{machine}-cleanup-receipt.json')
    inventory = read(f'{machine}-inventory.json')
    assert authorization['manifestSha256'] == receipt['manifestSha256'] == sha(source / f'{machine}-inventory.json')
    assert receipt['authorizationSha256'] == sha(source / f'{machine}-authorization.json')
    assert receipt['ok'] and receipt['preservedAllDirectories'] and receipt['preservedAllJsonLogsKeysProjection']
    assert authorization['coordinatorVerifiedThreeCycleSuccess'] and authorization['evidencePreservationConfirmed']
    approved = authorization['approvedCandidatePaths']
    assert approved == [entry['path'] for entry in receipt['deleted']]
    assert len(approved) == (13 if machine == 'm1' else 1)
    candidates = {}
    for root in inventory['roots']:
        for entry in root['entries']:
            if entry.get('cleanupCandidate'):
                candidates[str(pathlib.Path(root['root']) / entry['relativePath'])] = entry
    assert set(candidates) == set(approved)
    for entry in receipt['deleted']:
        assert all(entry[key] == candidates[entry['path']][key] for key in ('dev', 'ino', 'size', 'allocatedBytes'))
    for index, cycle in enumerate(authorization['threeSuccessfulProductionCycles'], 1):
        capture = repo / f'scratch/off-host-transfer-review/production-cycles/cycle{index}/capture.json'
        assert sha(capture) == cycle['evidenceSha256']
    result['machines'][machine] = {
        'authorizationSha256': sha(source / f'{machine}-authorization.json'),
        'receiptSha256': sha(source / f'{machine}-cleanup-receipt.json'),
        'inventorySha256': sha(source / f'{machine}-inventory.json'),
        'bindingVerified': True,
        'deletedCount': len(approved),
        'deletedLogicalBytes': sum(e['size'] for e in receipt['deleted']),
        'deletedAllocatedBytes': sum(e['allocatedBytes'] for e in receipt['deleted']),
        'freeBytesBefore': receipt['freeBytesBefore'],
        'freeBytesAfter': receipt['freeBytesAfter'],
        'observedFreeByteIncrease': receipt['freeBytesAfter'] - receipt['freeBytesBefore'],
    }

for entry in evidence:
    saved = repo / entry['savedPath']
    assert saved.is_file() and not saved.is_symlink()
    assert saved.stat().st_size == entry['size'] and sha(saved) == entry['sha256']
    row = {key: entry[key] for key in ('machine', 'relativePath', 'size', 'sha256', 'savedPath')}
    row['savedBytesVerified'] = True
    if 'existingDocsEvidence' in entry:
        existing = repo / entry['existingDocsEvidence']['path']
        row['existingDocsEvidenceSha256'] = sha(existing)
        row['existingDocsEvidenceMatchesRaw'] = sha(existing) == entry['sha256']
    result['savedEvidence'].append(row)

def payload(machine):
    base = '[M1-HOME]/F1-1-website/backups/live-v2-stage-20260906-02' if machine == 'm1' else '[M5-HOME]/Library/Application Support/F1Plus1/BackupObserver/manual-preflight-02'
    return {
        'approvedPaths': read(f'{machine}-authorization.json')['approvedCandidatePaths'],
        'roots': [root['root'] for root in read(f'{machine}-inventory.json')['roots']],
        'retainedEvidence': [{'path': str(pathlib.Path(base) / e['relativePath']), 'size': e['size'], 'sha256': e['sha256']} for e in evidence if e['machine'] == machine],
    }

check = '''
import datetime,hashlib,json,pathlib,stat
out={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'deletedPaths':[],'retainedRoots':[],'retainedEvidence':[]}
for raw in request['approvedPaths']:
 p=pathlib.Path(raw)
 try: p.lstat(); absent=False
 except FileNotFoundError: absent=True
 assert absent,raw
 out['deletedPaths'].append({'path':raw,'absent':True,'parentPresent':p.parent.is_dir()})
 assert p.parent.is_dir()
for raw in request['roots']:
 p=pathlib.Path(raw); s=p.lstat(); assert stat.S_ISDIR(s.st_mode)
 out['retainedRoots'].append({'path':raw,'directoryPresent':True,'dev':s.st_dev,'ino':s.st_ino})
for row in request['retainedEvidence']:
 p=pathlib.Path(row['path']); before=p.lstat(); assert stat.S_ISREG(before.st_mode)
 digest=hashlib.sha256(p.read_bytes()).hexdigest(); after=p.lstat()
 assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)
 assert after.st_size==row['size'] and digest==row['sha256'],str(p)
 out['retainedEvidence'].append({'path':str(p),'size':after.st_size,'sha256':digest,'verified':True})
print(json.dumps(out))
'''
for machine in ('m1', 'm5'):
    program = 'request=' + repr(payload(machine)) + '\n' + check
    command = ['/usr/bin/ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'home-mac', 'python3', '-'] if machine == 'm1' else ['python3', '-']
    completed = subprocess.run(command, input=program, text=True, capture_output=True, timeout=50, check=True)
    result['machines'][machine]['liveReadOnlyPostcheck'] = json.loads(completed.stdout)

result['preservedEvidenceCount'] = len(evidence)
result['preservedEvidenceBytes'] = sum(entry['size'] for entry in evidence)
result['evidenceManifestSha256'] = sha(source / 'evidence-manifest.json')
result['verifierSha256'] = sha(pathlib.Path(__file__))
result['result'] = 'PASS'
result['limitations'] = [
    'Free-space changes are the execution receipts before/after measurements, not allocated-byte totals or a current free-space promise.',
    'The cleanup postcheck reads exact authorized paths and retained small evidence only; it does not prove all historical artifacts are removable.',
    'Three-cycle acceptance covers its recorded observation window; it does not certify future RPO or actual Passkey restoration.',
]
destination = source / 'independent-postcheck.json'
destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'result':result['result'],'evidenceFiles':len(evidence),'output':str(destination),'machines':{m:{k:v for k,v in d.items() if k != 'liveReadOnlyPostcheck'} for m,d in result['machines'].items()}},ensure_ascii=False,indent=2))
