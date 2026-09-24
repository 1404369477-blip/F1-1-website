import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {canonicalJson} from '../db/profile.ts';
import {assertXPageAdmissionSchema} from './admission-migration.ts';
import {readXPageHistoricalAdmission} from './source-authority.ts';
import {XPageProducerReceiptSchema,type XPageProducerReceiptLedger,type XPageProducerReceipt} from './trusted-importer.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function assert(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
export function xPageProducerReceiptEntityId(producerId:string,receiptId:string):string {return `xreceipt-${hash(`${producerId}\n${receiptId}`)}`;}
export function xPageImportResultHash(result:XPageProducerReceipt['result']):string{return hash(`f1plus1-x-page-import-result-v1\n${canonicalJson(result)}`);}
/** Reads the immutable transaction result, never a process-local cache. */
export class SqliteXPageProducerReceiptLedger implements XPageProducerReceiptLedger {
 private readonly database:DatabaseSync;
 constructor(database:DatabaseSync){assertXPageAdmissionSchema(database);this.database=database;}
 read(producerId:string,receiptId:string):XPageProducerReceipt|null {
  const row=this.database.prepare(`SELECT r.*,op.state,op.result_hash,op.policy_id,op.owner_process FROM x_page_producer_receipt_v1 r JOIN internal_operation op ON op.operation_id=r.operation_id WHERE r.producer_id=? AND r.receipt_id=?`).get(producerId,receiptId);
  if(!row)return null;
  assert(row.state==='succeeded'&&row.policy_id==='p-x-page-trusted-import-live'&&row.owner_process==='x_page_importer','X_PAGE_RECEIPT_OPERATION_INVALID');
  assert(hash(String(row.receipt_json))===row.receipt_sha256,'X_PAGE_RECEIPT_HASH_INVALID');
  const receipt=XPageProducerReceiptSchema.parse(JSON.parse(String(row.receipt_json)));
  assert(canonicalJson(receipt)===row.receipt_json&&row.receipt_entity_id===xPageProducerReceiptEntityId(producerId,receiptId)
   &&receipt.producerId===producerId&&receipt.receiptId===receiptId&&receipt.captureSha256===row.capture_sha256&&receipt.captureProofSha256===row.capture_proof_sha256
   &&receipt.sourceId===row.source_id&&receipt.observedSourceId===row.observed_source_id&&receipt.capturedSourceVersionHash===row.captured_source_version_hash
   &&receipt.acceptedAt===row.accepted_at&&receipt.result.candidateId===row.candidate_id&&receipt.result.sourceRevision===row.source_revision
   &&receipt.result.operationId===row.operation_id&&row.result_hash===xPageImportResultHash(receipt.result),'X_PAGE_RECEIPT_BINDING_INVALID');
  return Object.freeze({...receipt,result:Object.freeze({...receipt.result})});
 }
 readAdmissionTrust(producerId:string,receiptId:string):ReturnType<typeof readXPageHistoricalAdmission> {
  assert(this.read(producerId,receiptId),'X_PAGE_RECEIPT_MISSING');
  const row=this.database.prepare('SELECT admission_id FROM x_page_producer_receipt_v1 WHERE producer_id=? AND receipt_id=?').get(producerId,receiptId)!;
  return readXPageHistoricalAdmission(this.database,String(row.admission_id));
 }
}
