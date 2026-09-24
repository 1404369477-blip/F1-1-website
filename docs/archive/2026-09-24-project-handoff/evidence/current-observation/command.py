"""Bounded read-only handoff observation; no database, cloud or service mutations."""
import datetime, hashlib, json, os, plistlib, stat, subprocess
from pathlib import Path
base=Path('/Users/chanai/F1-1-website')
support=Path('/Users/chanai/Library/Application Support/F1Plus1')
def small(path,limit=262144):
    a=path.lstat();assert stat.S_ISREG(a.st_mode) and a.st_size<=limit and path.resolve()==path
    data=path.read_bytes();b=path.lstat()
    assert (a.st_ino,a.st_size,a.st_mtime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns)
    return {'path':str(path),'sha256':hashlib.sha256(data).hexdigest(),'value':json.loads(data)}
out={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True,'databaseOpens':0,'productionWrites':0,'backup':{}}
for name in ['last-cycle.json','last-snapshot.json','last-register.json','last-application-drill.json']:
    try:out['backup'][name]=small(support/'Backup'/name)
    except (ValueError,FileNotFoundError,AssertionError) as e:out['backup'][name]={'observationError':type(e).__name__}
lock=base/'backups/snap/run.lock'
if lock.exists():
    out['backupLock']=small(lock)
    pid=out['backupLock']['value']['pid']
    try:os.kill(pid,0);out['backupLock']['pidObservation']='present'
    except ProcessLookupError:out['backupLock']['pidObservation']='absent'
else:out['backupLock']={'absent':True}
out['jobs']={}
for label in ['com.f1plus1.backup-snapshot','com.f1plus1.rss-collector']:
    p=Path('/Users/chanai/Library/LaunchAgents')/(label+'.plist')
    raw=p.read_bytes();v=plistlib.loads(raw)
    r=subprocess.run(['/bin/launchctl','print','gui/501/'+label],capture_output=True,text=True,timeout=8)
    out['jobs'][label]={'plistSha256':hashlib.sha256(raw).hexdigest(),'programArguments':v.get('ProgramArguments'),'workingDirectory':v.get('WorkingDirectory'),'startInterval':v.get('StartInterval'),'exitCode':r.returncode,'output':r.stdout}
for name in ['Admin','Public']:
    row=small(support/name/'deployment.json');v=row.pop('value')
    row['selected']={k:v[k] for k in ['reviewDatabasePath','reviewSchemaSha256','officialReleaseManifestSha256','targetNextBuildSha256','fullReleaseManifestSha256'] if k in v}
    out[name]=row
trust=support/'Backup/icloud-provider-trust.json';out['providerTrustSha256']=hashlib.sha256(trust.read_bytes()).hexdigest()
p=base/'.ac5cc2/logs/rss-collector.stdout.log'
with p.open('rb') as f:
    f.seek(max(0,p.stat().st_size-65536));raw=f.read(65536)
out['rssCollectorTail']=raw.decode(errors='replace').splitlines()[-3:]
rb=base/'backups/icloud-readiness-canary-20260923-r4/work/dates/2026/09/23/1790176881821_528531270a64230a/readback/objects/db-projection-snapshot.528531270a64230a1f0cd556649dbe24c194dc763b3ae85d3ef6042426dccb9a.e2f2c6fc36e07951'
out['readback']={'path':str(rb),'exists':rb.exists(),'bytes':rb.stat().st_size if rb.exists() else None,'hashRechecked':False}
out['disk']=subprocess.check_output(['/bin/df','-h',str(base)],text=True)
out['note']='Sequential file observations; not an atomic cycle, signature verification, or new production acceptance.'
print(json.dumps(out,ensure_ascii=False,separators=(',',':')))
