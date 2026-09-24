import {join,resolve} from "node:path";
import {z} from "zod";
import {canonicalJsonV1} from "../internal-operation/gateway.ts";
import {readPrivateFile,atomicWritePrivateFile} from "../rss/private-credential-file.ts";
import type {XPageAutomaticCursorStore} from "./automatic-worker.ts";
const Position=z.object({firstSeenAt:z.iso.datetime({precision:3}),candidateId:z.string().min(1).max(256)}).strict();
const Cursor=z.object({schemaVersion:z.literal("x-page-automatic-cursor-v1"),cutoffIso:z.iso.datetime({precision:3}),
  after:Position.nullable(),upperBound:Position}).strict();
/** Independent, bounded progress only; it conveys no source or mutation grant. */
export function createXPageAutomaticCursorStore(input:Readonly<{privateDir:string}>):XPageAutomaticCursorStore {
  const path=join(resolve(input.privateDir),"x-page-automatic-cursor.json");
  return {
    read:()=>{const file=readPrivateFile(path,4096);if(!file)return null;const {cutoffIso,after,upperBound}=Cursor.parse(JSON.parse(file.text));return {cutoffIso,after,upperBound};},
    write:cursor=>{const current=readPrivateFile(path,4096);atomicWritePrivateFile(path,canonicalJsonV1(Cursor.parse({schemaVersion:"x-page-automatic-cursor-v1",...cursor})),current?.identity??null,4096);}
  };
}
