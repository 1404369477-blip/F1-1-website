import {join,resolve} from "node:path";
import type {DatabaseSync} from "node:sqlite";
import {z} from "zod";
import {canonicalJsonV1} from "../internal-operation/gateway.ts";
import {readPrivateFile,atomicWritePrivateFile} from "../rss/private-credential-file.ts";
const PositionSchema=z.object({firstSeenAt:z.iso.datetime({precision:3}),candidateId:z.string().min(1).max(256)}).strict();
export const RssAutomaticCursorSchema=z.object({schemaVersion:z.literal("rss-automatic-cursor-v1"),cutoffIso:z.iso.datetime({precision:3}),
  after:PositionSchema.nullable(),upperBound:PositionSchema}).strict();
export type RssAutomaticCursor=z.infer<typeof RssAutomaticCursorSchema>;
export type RssAutomaticCursorStore=Readonly<{read():RssAutomaticCursor|null;write(cursor:RssAutomaticCursor):void}>;
const memory=new WeakMap<DatabaseSync,RssAutomaticCursor>();
export function inMemoryRssAutomaticCursorStore(database:DatabaseSync):RssAutomaticCursorStore {
  return {read:()=>memory.get(database)??null,write:cursor=>{memory.set(database,RssAutomaticCursorSchema.parse(cursor));}};
}
/** One bounded private checkpoint survives worker restarts. It grants no
 * mutation authority: every selected candidate still passes normal admission. */
export function createRssAutomaticCursorStore(input:Readonly<{privateDir:string}>):RssAutomaticCursorStore {
  const path=join(resolve(input.privateDir),"rss-automatic-cursor.json");
  return {
    read:()=>{const file=readPrivateFile(path,4096);return file===null?null:RssAutomaticCursorSchema.parse(JSON.parse(file.text));},
    // The Admin listener and non-reentrant cycle provide the single writer.
    // CAS rejects accidental concurrent progress updates without a crash-held
    // lock; this checkpoint never grants authority to process a candidate.
    write:cursor=>{
      const current=readPrivateFile(path,4096);
      atomicWritePrivateFile(path,canonicalJsonV1(RssAutomaticCursorSchema.parse(cursor)),current?.identity??null,4096);
    },
  };
}
