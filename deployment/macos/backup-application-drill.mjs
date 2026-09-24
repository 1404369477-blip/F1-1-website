import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [runtimeRoot, expectedRuntime, deploymentFile, backupRoot, restoreRoot, aesKeyFile, signingKeyFile, reportFile, receiptFile] = process.argv.slice(2);
const toolsRoot = dirname(fileURLToPath(import.meta.url));
process.umask(0o077);
const incidentDeclaredAt=new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
function assert(value, code) { if (!value) throw new Error(code); }
function privateFile(path) { const s=lstatSync(path); assert(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&63)===0,'APPLICATION_DRILL_FILE_REJECTED'); }
function privateCopiedDirectories(path) {
  const s=lstatSync(path);assert(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid(),'APPLICATION_DRILL_COPY_DIRECTORY_REJECTED');
  chmodSync(path,0o700);
  for(const entry of readdirSync(path,{withFileTypes:true})){
    assert(!entry.isSymbolicLink(),'APPLICATION_DRILL_COPY_LINK_REJECTED');
    if(entry.isDirectory())privateCopiedDirectories(join(path,entry.name));
  }
}
async function port() { const s=createServer(); await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r)});const p=s.address().port;await new Promise(r=>s.close(r));return p; }
async function http(url, headers={}) {
  return await new Promise((resolveRequest,reject)=>{
    const req=request(url,{headers,timeout:5000},res=>{let bytes=0;const chunks=[];res.on('data',c=>{bytes+=c.length;if(bytes>4*1024*1024){req.destroy(new Error('APPLICATION_DRILL_RESPONSE_TOO_LARGE'));return;}chunks.push(c);});res.on('end',()=>resolveRequest({status:res.statusCode,body:Buffer.concat(chunks)}));res.on('error',reject);});
    req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('APPLICATION_DRILL_HTTP_TIMEOUT')));req.end();
  });
}
async function eventually(action, child, ms=25000) {const deadline=Date.now()+ms;let error;while(Date.now()<deadline){if(child.exitCode!==null||child.signalCode!==null)throw new Error('APPLICATION_DRILL_CHILD_EXITED');try{return await action();}catch(e){error=e;await new Promise(r=>setTimeout(r,200));}}throw error??new Error('APPLICATION_DRILL_START_TIMEOUT');}
function waitEvent(child, type, timeout=25000) {return new Promise((res,rej)=>{const timer=setTimeout(()=>{cleanup();rej(new Error('APPLICATION_DRILL_CHILD_TIMEOUT'));},timeout);function cleanup(){clearTimeout(timer);child.off('message',message);child.off('exit',exit)}function message(m){if(m?.type===type){cleanup();res(m)}}function exit(){cleanup();rej(new Error('APPLICATION_DRILL_CHILD_EXITED'))}child.on('message',message);child.once('exit',exit);});}
const exitPromises = new WeakMap();
async function exited(child, timeout=8000) {
  const done=exitPromises.get(child);
  assert(done,'APPLICATION_DRILL_CHILD_UNTRACKED');
  let timer;
  const ended=await Promise.race([done.then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),timeout)})]);
  clearTimeout(timer);
  if(!ended){child.kill('SIGKILL');await done;throw new Error('APPLICATION_DRILL_CHILD_CLEANUP_TIMEOUT');}
}
let admin, publicChild, bootRoot, cleanupFailed=false;
const childLogs=[];
const STAGES=new Set(['INITIALIZE','VERIFY_RUNTIME','LOAD_DEPLOYMENT','RESTORE_PACKAGE','PREPARE_BOOT','ADMIN_READY','ADMIN_HTTP','PUBLIC_READY','PUBLIC_CHECKS','CLOSE_CHILDREN','VERIFY_ORIGINAL','SIGN_RECEIPT']);
let stage='INITIALIZE',stageStartedAt=Date.now();
function enterStage(next){assert(STAGES.has(next),'APPLICATION_DRILL_STAGE_INVALID');const now=Date.now();stage=next;stageStartedAt=now;process.stderr.write(JSON.stringify({code:'APPLICATION_DRILL_STAGE',stage,at:new Date(now).toISOString(),elapsedMs:now-Date.parse(incidentDeclaredAt)})+'\n');}
function watch(child,label){exitPromises.set(child,new Promise(resolveExit=>child.once('close',resolveExit)));let bytes=0;for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{if(bytes<65536){childLogs.push(`${label}: ${chunk}`);bytes+=chunk.length;}});child.on('error',()=>{});return child;}
try {
  assert(process.version==='v24.18.0'&&receiptFile,'APPLICATION_DRILL_USAGE');
  enterStage('VERIFY_RUNTIME');
  const verify=spawnSync(process.execPath,[join(toolsRoot,'verify-backup-runtime.mjs'),runtimeRoot,expectedRuntime],{encoding:'utf8',timeout:30000});assert(verify.status===0,'APPLICATION_DRILL_RUNTIME_UNVERIFIED');
  enterStage('LOAD_DEPLOYMENT');
  privateFile(deploymentFile); privateFile(signingKeyFile);
  const deploymentRaw=readFileSync(deploymentFile), deployment=JSON.parse(deploymentRaw);
  const app=realpathSync(deployment.targetReleaseAppRoot);
  assert(app===resolve(deployment.targetReleaseAppRoot),'APPLICATION_DRILL_RELEASE_LINK');
  // The trusted current release verifier checks the sealed application, build, dependencies and release pair.
  const {adminRuntimeConfigFromDeployment}=await import(pathToFileURL(join(app,'src/server/admin-service/runtime.ts')));
  const {readPublicProjectionDeploymentManifest}=await import(pathToFileURL(join(app,'src/server/public/deployment.ts')));
  const publicDeployment=readPublicProjectionDeploymentManifest(join(dirname(deployment.dataRoot),'Public/projection-deployment.json'));
  assert(publicDeployment.targetReleaseAppRoot===app,'APPLICATION_DRILL_PUBLIC_RELEASE_MISMATCH');
  const {runRestoreDrill,loadKeyFile,canonicalJson}=await import(pathToFileURL(join(runtimeRoot,'src/server/backup-snapshot/core.ts')));
  const {readSnapLatestAndManifest}=await import(pathToFileURL(join(runtimeRoot,'src/server/internal-operation/backup-package-binding.ts')));
  const {createSignedApplicationDrillReceipt}=await import(pathToFileURL(join(runtimeRoot,'src/server/backup-snapshot/application-drill-receipt.ts')));
  const snap=readSnapLatestAndManifest(backupRoot);
  assert(!existsSync(restoreRoot)||lstatSync(restoreRoot).isDirectory(),'APPLICATION_DRILL_RESTORE_ROOT_INVALID');
  enterStage('RESTORE_PACKAGE');
  const report=runRestoreDrill({backupRoot,restoreRoot,key:loadKeyFile(aesKeyFile),packageId:snap.latest.packageId,expectedUserVersion:10});
  assert(report.ok,'APPLICATION_DRILL_RESTORE_FAILED');
  writeFileSync(reportFile,JSON.stringify(report)+'\n',{mode:384});
  enterStage('PREPARE_BOOT');
  const restored=realpathSync(restoreRoot);
  bootRoot=mkdtempSync(join(dirname(restored),'application-boot.'));
  const adminRoot=join(bootRoot,'Admin'),publicRoot=join(bootRoot,'Public'),dbDir=join(bootRoot,'db');
  for(const path of [adminRoot,publicRoot,dbDir])mkdirSync(path,{mode:448});
  const bootDb=join(dbDir,'f1plus1-rss-real-private.sqlite');copyFileSync(join(restored,'db/snapshot.sqlite'),bootDb);
  chmodSync(bootDb,384);
  const dbHash=hash(readFileSync(bootDb));assert(dbHash===snap.manifest.members.find(m=>m.relativePath==='db/snapshot.sqlite').sha256,'APPLICATION_DRILL_DB_COPY_MISMATCH');
  const {DatabaseSync}=await import('node:sqlite');
  const {reviewRealSchemaFingerprint}=await import(pathToFileURL(join(runtimeRoot,'src/server/review-real/migration.ts')));
  const schemaDatabase=new DatabaseSync(join(restored,'db/snapshot.sqlite'),{readOnly:true});
  let schemaSha256;try{schemaSha256=reviewRealSchemaFingerprint(schemaDatabase);}finally{schemaDatabase.close();}
  cpSync(join(restored,'projection'),join(publicRoot,'projection'),{recursive:true,errorOnExist:true,force:false});
  privateCopiedDirectories(join(publicRoot,'projection'));
  for(const m of snap.manifest.members.filter(m=>m.relativePath.startsWith('projection/')))assert(hash(readFileSync(join(publicRoot,m.relativePath)))===m.sha256,'APPLICATION_DRILL_PROJECTION_COPY_MISMATCH');
  const verifyKey=join(publicRoot,'projection-verify.pem');copyFileSync(deployment.projectionVerifyKeyPath,verifyKey);chmodSync(verifyKey,384);
  const ephemeral=generateKeyPairSync('ed25519'),privateKey=join(adminRoot,'ephemeral-projection.pem');writeFileSync(privateKey,ephemeral.privateKey.export({type:'pkcs8',format:'pem'}),{mode:384});
  const sessionKey=join(adminRoot,'session-hash-key'),fencePath=join(adminRoot,'recovery-fence.json');writeFileSync(sessionKey,randomBytes(32).toString('base64url'),{mode:384});
  writeFileSync(fencePath,canonicalJson({schemaVersion:'admin-recovery-fence-v1',clockTrusted:false,writerReady:false,lastSuccessfulRecoveryPointAt:null}),{mode:384});
  const sourceRefs=Array.from({length:3},()=>randomBytes(32).toString('base64url'));
  const identity={login:'recovery-drill@f1plus1.invalid',operatorRef:deployment.operatorRef,sourceRefs};
  const {inspectExistingPrivateDatabase,openExistingSafeDatabase}=await import(pathToFileURL(join(runtimeRoot,'src/server/db/database.ts')));
  const dbIdentity=inspectExistingPrivateDatabase(bootDb,'f1plus1-rss-real-private.sqlite');
  const isolated={...deployment,reviewDatabasePath:bootDb,reviewDatabaseIdentity:dbIdentity,dataRoot:adminRoot,staticRoot:join(app,'src/admin-ui'),sessionHashKeyPath:sessionKey,recoveryFencePath:fencePath,publicProjectionRoot:join(publicRoot,'projection'),projectionSigningPrivateKeyPath:privateKey,trustedIdentities:[identity]};
  if(snap.manifest.xArtifacts){
    assert(report.xArtifactRebinding?.status==='verified-files-awaiting-deployment-binding','APPLICATION_DRILL_X_REBINDING_REQUIRED');
    const {readXCapturePrivateFile}=await import(pathToFileURL(join(runtimeRoot,'src/server/x-page/private-artifact-file.ts')));
    const originalConfig=readXCapturePrivateFile(deployment.xPageTrustConfigurationPath,64*1024);
    assert(originalConfig&&hash(originalConfig.text)===deployment.xPageTrustConfigurationSha256,'APPLICATION_DRILL_X_CONFIG_IDENTITY_INVALID');
    const rebound=JSON.parse(originalConfig.text);
    for(const [name,key] of [['producer',rebound.producerPublicKey],['verifier',rebound.verifier.publicKey]]){
      const file=readXCapturePrivateFile(key.path,4096);assert(file&&hash(file.text)===key.rawSha256,'APPLICATION_DRILL_X_PUBLIC_KEY_INVALID');
      const path=join(adminRoot,`${name}-public.pem`);writeFileSync(path,file.text,{mode:384,flag:'wx'});key.path=path;
    }
    rebound.artifactRoot={...report.xArtifactRebinding.restoredRoot};
    const reboundRaw=canonicalJson(rebound),reboundPath=join(adminRoot,'x-page-runtime-trust.json');
    writeFileSync(reboundPath,reboundRaw,{mode:384,flag:'wx'});
    isolated.xPageTrustConfigurationPath=reboundPath;isolated.xPageTrustConfigurationSha256=hash(reboundRaw);
  }
  const isolatedRaw=JSON.stringify(isolated),isolatedSha=hash(isolatedRaw);
  const config=adminRuntimeConfigFromDeployment(isolated,{allowDisposableReviewDatabase:true,expectedDeploymentManifestSha256:isolatedSha});
  if(snap.manifest.xArtifacts){
    const {loadXPageRuntimeTrust}=await import(pathToFileURL(join(runtimeRoot,'src/server/x-page/deployment-trust.ts')));
    loadXPageRuntimeTrust({configurationPath:isolated.xPageTrustConfigurationPath,expectedConfigurationSha256:isolated.xPageTrustConfigurationSha256,
      expectedDeploymentManifestSha256:isolatedSha,releaseAppRoot:app});
  }
  const bootstrapDb=openExistingSafeDatabase(bootDb,'f1plus1-rss-real-private.sqlite',dbIdentity,[10]);
  try {const {createOwnerSupervisorHandoff}=await import(pathToFileURL(join(runtimeRoot,'src/server/internal-operation/backup-recovery-point-register.ts')));createOwnerSupervisorHandoff(bootstrapDb,'admin_http',config.releaseGate.receipt.sourcePreimageSha256,config.releaseGate.receipt.manifestSha256,Date.now());}finally{bootstrapDb.close();}
  const adminPort=await port(),publicPort=await port(),configFile=join(bootRoot,'admin-config.json');writeFileSync(configFile,isolatedRaw,{mode:384});
  const sandbox=join(bootRoot,'children.sb');writeFileSync(sandbox,`(version 1)\n(allow default)\n(deny network-outbound)\n(deny file-write*)\n(allow file-write* (subpath ${JSON.stringify(bootRoot)}))\n(allow file-write* (literal \"/dev/null\"))\n`,{mode:384});
  enterStage('ADMIN_READY');
  admin=watch(spawn('/usr/bin/sandbox-exec',['-f',sandbox,process.execPath,'--experimental-transform-types',join(toolsRoot,'backup-admin-drill-child.mjs'),configFile,String(adminPort)],{cwd:app,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe','ipc']}),'admin');
  const ready=await waitEvent(admin,'ready',45000);assert(ready.externalCalls===0&&ready.address.address==='127.0.0.1'&&ready.address.port===adminPort,'APPLICATION_DRILL_ADMIN_NOT_ISOLATED');
  enterStage('ADMIN_HTTP');
  const origin=new URL(isolated.canonicalOrigin),headers={Host:origin.host,'X-Forwarded-Proto':'https','X-Forwarded-Host':origin.host,'X-Forwarded-For':'100.64.0.2','Tailscale-User-Login':identity.login,'Tailscale-App-Capabilities':JSON.stringify({[isolated.tailscaleAppCapabilityId]:[{sourceRef:sourceRefs[0]}]})};
  const adminResponse=await http(`http://127.0.0.1:${adminPort}/admin/reviews`,headers);assert(adminResponse.status===200&&adminResponse.body.includes(Buffer.from('<html')),'APPLICATION_DRILL_ADMIN_HTTP_FAILED');
  const unauthorized=await http(`http://127.0.0.1:${adminPort}/api/admin/reviews`,headers);assert(unauthorized.status===401,'APPLICATION_DRILL_ADMIN_AUTH_BOUNDARY_FAILED');
  const adminAvailableAt=new Date().toISOString();
  const env={PATH:dirname(process.execPath)+':/usr/bin:/bin',LANG:'en_US.UTF-8',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',APP_ENV:'test',APP_PORT:String(publicPort),APP_BIND_HOST:'127.0.0.1',APP_PUBLIC_ORIGIN:`http://127.0.0.1:${publicPort}`,F1_DATA_PROFILE:'public-multimedia-synthetic',F1_DB_PATH:'.local/f1plus1-public-multimedia-synthetic.sqlite',SOURCE_CONFIG_PROVIDER:'fixture',SOURCE_FIXTURE_PATH:'../data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json',F1_PUBLIC_READ_MODE:'public-real-snapshot',F1_PUBLIC_DEPLOYMENT_MANIFEST_PATH:'',F1_PUBLIC_PROJECTION_ROOT:join(publicRoot,'projection'),F1_PUBLIC_VERIFY_KEY_PATH:verifyKey,F1_PUBLIC_SIGNING_KEY_ID:deployment.projectionSigningKeyId,ADAPTER_MODE:'mock',SUMMARY_MODE:'fixture',MEDIA_MODE:'fixture',PUBLISH_MODE:'manual_only',REAL_FEISHU_IO:'false',REAL_EXTERNAL_IO:'false',REAL_FORM_SUBMIT:'false',ADMIN_ACCESS_MODE:'local_dev_only',LOG_LEVEL:'error'};
  Object.assign(env,{NEXT_RUNTIME:'nodejs',NEXT_PRIVATE_START_TIME:String(Date.now())});
  enterStage('PUBLIC_READY');
  publicChild=watch(spawn('/usr/bin/sandbox-exec',['-f',sandbox,process.execPath,join(app,'node_modules/next/dist/bin/next'),'start',app,'--hostname','127.0.0.1','--port',String(publicPort)],{cwd:app,env,stdio:['ignore','pipe','pipe']}),'public');
  let lastHealth='';
  const health=await eventually(async()=>{const h=await http(`http://127.0.0.1:${publicPort}/api/health`);const diagnostic=`health status=${h.status} body=${h.body.toString().slice(0,4096)}`;if(diagnostic!==lastHealth){lastHealth=diagnostic;childLogs.push(diagnostic+'\n');}assert(h.status===200&&JSON.parse(h.body).status==='ready'&&JSON.parse(h.body).dataGate==='accepted-public-real-snapshot','APPLICATION_DRILL_PUBLIC_HEALTH_FAILED');return h;},publicChild);
  enterStage('PUBLIC_CHECKS');
  const feed=await http(`http://127.0.0.1:${publicPort}/api/public/feed`,{Accept:'application/json'});assert(feed.status===200,'APPLICATION_DRILL_PUBLIC_FEED_FAILED');
  const dto=JSON.parse(feed.body);assert(dto.schemaVersion==='public-read-v0.1'&&Array.isArray(dto.items),'APPLICATION_DRILL_PUBLIC_FEED_INVALID');
  const active=JSON.parse(readFileSync(join(restored,'projection/active.json'))),generation=JSON.parse(readFileSync(join(restored,'projection/generations',`${active.snapshotManifestHash}.json`)));
  const {verifySignedProjectionPackage}=await import(pathToFileURL(join(app,'src/server/review-real/projection.ts')));
  const {createPublicKey}=await import('node:crypto');
  const signed=verifySignedProjectionPackage(generation.package,{signingKeyId:deployment.projectionSigningKeyId,publicKey:createPublicKey(readFileSync(verifyKey))});
  const records=signed.taskEnvelope.snapshot.records,ids=new Set(records.map(r=>r.publicId));
  assert((records.length===0||dto.items.length>0)&&dto.items.every(r=>ids.has(r.publicId)),'APPLICATION_DRILL_PUBLIC_CONTENT_MISMATCH');
  const {selectApplicationDrillRecords,verifyApplicationDrillDetail}=await import(pathToFileURL(join(runtimeRoot,'src/server/backup-snapshot/application-public-check.ts')));
  const detailBodies=[],detailPlatforms=[];
  for(const record of selectApplicationDrillRecords(records)){
    const detail=await http(`http://127.0.0.1:${publicPort}/api/public/stories/${encodeURIComponent(record.publicId)}`,{Accept:'application/json'});
    assert(detail.status===200,'APPLICATION_DRILL_PUBLIC_DETAIL_FAILED');verifyApplicationDrillDetail(record,JSON.parse(detail.body));
    detailBodies.push(detail.body);detailPlatforms.push(record.source.platform);
  }
  const publicAvailableAt=new Date().toISOString();
  enterStage('CLOSE_CHILDREN');
  const closing=waitEvent(admin,'closed',8000);admin.send('close');const closed=await closing;assert(closed.externalCalls===0,'APPLICATION_DRILL_ADMIN_EGRESS');await exited(admin);
  publicChild.kill('SIGTERM');await exited(publicChild);assert(admin.exitCode===0,'APPLICATION_DRILL_ADMIN_CLOSE_FAILED');
  enterStage('VERIFY_ORIGINAL');
  for(const m of snap.manifest.members)assert(hash(readFileSync(join(restored,m.relativePath)))===m.sha256,'APPLICATION_DRILL_ORIGINAL_CHANGED');
  assert(hash(readFileSync(deploymentFile))===hash(deploymentRaw),'APPLICATION_DRILL_DEPLOYMENT_CHANGED');
  rmSync(bootRoot,{recursive:true});bootRoot=undefined;
  enterStage('SIGN_RECEIPT');
  const completedAt=new Date().toISOString();
  const payload={schemaVersion:'f1plus1-application-drill-v1',packageId:snap.latest.packageId,contentHash:snap.manifest.contentHash,manifestSha256:snap.manifestSha256,databaseSnapshotSha256:dbHash,restoreRootSha256:hash(restored),releaseSha256:deployment.fullReleaseManifestSha256,deploymentManifestSha256:hash(deploymentRaw),schemaSha256,projectionGeneration:active.snapshotGeneration,projectionManifestSha256:active.snapshotManifestHash,bootable:true,businessPointVerified:true,incidentDeclaredAt,adminAvailableAt,publicAvailableAt,completedAt,elapsedMs:Date.parse(completedAt)-Date.parse(incidentDeclaredAt),adminResponseSha256:hash(adminResponse.body),publicResponseSha256:hash(Buffer.concat([health.body,feed.body,...(snap.manifest.xArtifacts?detailBodies:[])])),adminRuntimeSha256:deployment.officialReleaseManifestSha256,publicRuntimeSha256:publicDeployment.targetNextBuildSha256};
  const receipt=createSignedApplicationDrillReceipt(payload,readFileSync(signingKeyFile,'utf8'));
  writeFileSync(receiptFile,JSON.stringify(receipt)+'\n',{mode:384,flag:'wx'});
  process.stdout.write(JSON.stringify({ok:true,code:'APPLICATION_DRILL_OK',packageId:payload.packageId,adminHttp:200,unauthorizedAdminHttp:401,publicHealth:200,publicFeed:200,publicItems:dto.items.length,publicDetailPlatforms:detailPlatforms,elapsedMs:payload.elapsedMs,childrenExited:true,bootRootCleaned:true,passkeyRestoreVerified:false})+'\n');
} catch(error) {
  const failedStage=stage,failedStageElapsedMs=Date.now()-stageStartedAt;
  process.stderr.write(JSON.stringify({code:'APPLICATION_DRILL_FAILURE',stage:failedStage,at:new Date().toISOString(),elapsedMs:Date.now()-Date.parse(incidentDeclaredAt)})+'\n');
  for(const child of [admin,publicChild])if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');try{await exited(child);}catch{cleanupFailed=true;}}
  if(bootRoot&&!cleanupFailed)try{rmSync(bootRoot,{recursive:true});}catch{cleanupFailed=true;}
  // Local diagnostic logs are private; the public receipt contains only a stable reason.
  if(reportFile)writeFileSync(`${reportFile}.failure.log`,childLogs.join('').slice(0,131072),{mode:384});
  process.stdout.write(JSON.stringify({ok:false,code:error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'APPLICATION_DRILL_FAILED',stage:failedStage,stageElapsedMs:failedStageElapsedMs,elapsedMs:Date.now()-Date.parse(incidentDeclaredAt),cleanupFailed})+'\n');process.exitCode=1;
}
