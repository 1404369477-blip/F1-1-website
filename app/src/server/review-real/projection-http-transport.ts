import { request as httpRequest } from "node:http";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

type ProjectionTransportResult = {kind:"unknown"}|{kind:"response";status:number;body:unknown};
type ProjectionRequest = Readonly<{method:"GET"|"POST";path:string;body?:unknown;serviceIdentity:string;timeoutMs:number}>;
const MAX_RECEIPT_BYTES=64*1024;
const WORKER_RESOURCE_DEADLINE_MS=45_000;
const PARENT_RESOURCE_DEADLINE_MS=60_000;
function validRequest(value:unknown):value is ProjectionRequest {
 if(value===null||typeof value!=="object")return false;
 const v=value as Record<string,unknown>,keys=Object.keys(v).sort();
 if(JSON.stringify(keys)!==JSON.stringify((v.method==="POST"?["body","method","path","serviceIdentity","timeoutMs"]:["method","path","serviceIdentity","timeoutMs"]).sort()))return false;
 if(typeof v.serviceIdentity!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(v.serviceIdentity)||!Number.isSafeInteger(v.timeoutMs)||Number(v.timeoutMs)<1000||Number(v.timeoutMs)>30000)return false;
 if(v.method==="GET")return typeof v.path==="string"&&/^\/internal\/projections\/receipts\/op-snapshot-[0-9a-f]{64}$/.test(v.path);
 if(v.method!=="POST"||v.path!=="/internal/projections"||v.body===null||typeof v.body!=="object")return false;
 try{return Buffer.byteLength(JSON.stringify(v.body),"utf8")<=2*1024*1024;}catch{return false;}
}
function validResult(value:unknown):value is ProjectionTransportResult {
 if(value===null||typeof value!=="object")return false;
 const v=value as Record<string,unknown>;
 if(v.kind==="unknown")return Object.keys(v).length===1;
 return v.kind==="response"&&JSON.stringify(Object.keys(v).sort())===JSON.stringify(["body","kind","status"])
  &&Number.isSafeInteger(v.status)&&Number(v.status)>=100&&Number(v.status)<=599;
}
/** One request, one worker, no retry. The worker holds no key, database or gateway.
 * Resolve only after worker exit, so its socket cannot survive local restoration. */
export function requestProjectionJson(input:ProjectionRequest):Promise<ProjectionTransportResult> {
 if(!isMainThread||!validRequest(input))return Promise.resolve({kind:"unknown"});
 return new Promise(resolve=>{
  let worker:Worker;
  try{worker=new Worker(new URL(import.meta.url),{workerData:input,execArgv:["--experimental-transform-types"]});}
  catch{resolve({kind:"unknown"});return;}
  let result:ProjectionTransportResult|undefined,invalid=false,exited=false;
  // This is only a resource backstop, not a second HTTP attempt or a longer
  // socket timeout. Let already queued message/exit events run before acting.
  const deadline=setTimeout(()=>setImmediate(()=>{
   if(exited)return;
   invalid=true;void worker.terminate();
  }),PARENT_RESOURCE_DEADLINE_MS);
  worker.on("message",message=>{if(result!==undefined||!validResult(message)){invalid=true;void worker.terminate();}else result=message;});
  worker.once("messageerror",()=>{invalid=true;void worker.terminate();});
  worker.once("error",()=>{invalid=true;});
  worker.once("exit",code=>{exited=true;clearTimeout(deadline);resolve(code===0&&!invalid&&result!==undefined?result:{kind:"unknown"});});
 });
}

function requestJson(
  input: Readonly<{
    method: "GET" | "POST";
    path: string;
    body?: unknown;
    serviceIdentity: string;
    timeoutMs: number;
  }>,
): Promise<ProjectionTransportResult> {
  return new Promise((resolveResult) => {
    const body =
      input.body === undefined
        ? null
        : Buffer.from(JSON.stringify(input.body), "utf8");
    const request = httpRequest(
      {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: 3102,
        method: input.method,
        path: input.path,
        agent: false,
        headers: {
          Host: "127.0.0.1:3102",
          Accept: "application/json",
          "X-F1-Service-Identity": input.serviceIdentity,
          ...(body === null
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": String(body.byteLength),
              }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.byteLength;
          if (size > MAX_RECEIPT_BYTES)
            request.destroy(new Error("PROJECTION_RESPONSE_TOO_LARGE"));
          else chunks.push(bytes);
        });
        response.on("aborted", () => resolveResult({ kind: "unknown" }));
        response.on("end", () => {
          request.destroy();
          if (!response.complete) {
            resolveResult({ kind: "unknown" });
            return;
          }
          let value: unknown = null;
          if (size > 0) {
            try {
              value = JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              ) as unknown;
            } catch {
              resolveResult({
                kind: "response",
                status: Number(response.statusCode ?? 500),
                body: null,
              });
              return;
            }
          }
          resolveResult({
            kind: "response",
            status: Number(response.statusCode ?? 500),
            body: value,
          });
        });
      },
    );
    request.setTimeout(input.timeoutMs, () =>
      request.destroy(new Error("PROJECTION_REQUEST_TIMEOUT")),
    );
    request.once("error", () => resolveResult({ kind: "unknown" }));
    if (body !== null) request.end(body);
    else request.end();
  });
}


if(!isMainThread){
 // Independent of the parent event loop. A stuck socket or stray handle
 // cannot retain this worker beyond the resource bound. A synchronous worker
 // stall is handled by the parent's separate termination backstop.
 const deadline=setTimeout(()=>{
  parentPort?.postMessage({kind:"unknown"});parentPort?.close();process.exit(0);
 },WORKER_RESOURCE_DEADLINE_MS);
 deadline.unref();
 if(parentPort===null||!validRequest(workerData))throw new Error("PROJECTION_WORKER_REQUEST_INVALID");
 const result=await requestJson(workerData);
 parentPort.postMessage(result);
 parentPort.close();
}
