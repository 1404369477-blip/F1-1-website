// Isolated synthetic crash process. SIGKILL intentionally skips cleanup so the
// parent can reopen the actual database file and inspect SQLite crash recovery.
import {xPageAdmissionFixture} from './x-page-admission.ts';
import {canonicalJson} from '../../server/db/profile.ts';
import {importTrustedXCapture,readReadyXPageSource} from '../../server/x-page/trusted-importer.ts';
const env=await xPageAdmissionFixture();env.admit();env.live();
const tables=['pending_review_candidate','x_page_candidate_capture_v1','x_page_producer_receipt_v1','internal_operation','internal_operation_audit','owner_authorization_handoff','operation_entity_binding','x_page_operation_source_binding_v1','gateway_write_permit'];
const snapshot=canonicalJson(tables.map(table=>({table,rows:env.database.prepare(`SELECT * FROM ${table}`).all()})));
await new Promise<void>((resolve,reject)=>process.send!({path:env.path,root:env.root,tables,snapshot},(error:Error|null)=>error?reject(error):resolve()));
const crashing={runAtomicAdmission:env.importPort.runAtomicAdmission.bind(env.importPort),
 runImportTransaction:<T>(input:Parameters<typeof env.importPort.runImportTransaction>[0],callback:(mutate:Parameters<Parameters<typeof env.importPort.runImportTransaction>[1]>[0])=>T)=>env.importPort.runImportTransaction(input,mutate=>callback(write=>{
  const count=mutate(write);if(write.entityKind==='x_page_capture')process.kill(process.pid,'SIGKILL');return count;
 }))};
importTrustedXCapture({database:env.database,gatewayPort:crashing,receiptLedger:env.receiptLedger,evidencePort:env.evidencePort,capture:env.capture(),trust:env.trust,
 expectedSourceIdentity:readReadyXPageSource(env.database,env.trust,'x_f1',env.now()),expectedCandidate:null,operationId:'synthetic-sigkill-import',now:env.now});
throw new Error('X_PAGE_CRASH_POINT_NOT_REACHED');
