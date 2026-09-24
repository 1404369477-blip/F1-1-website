import { RSS_AUTOMATIC_SCHEMA_SHA256 } from "./schema-identity.ts";

// 0014 remains an immutable predecessor; this is a distinct RSS-only schema 10.
export const RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256 = "ae757027a0d6ce2ed4437989dc98634b0e320ff70cd76b852fe5e753dcb2383e";
export const RSS_AUTOMATIC_SOURCE_EPOCH_MIGRATION_SHA256 = "af6e4c8b348612804446bb8d27be92a1f2d75eb3b3c4bff407a4c587aabc2bb0";
export function isRssAutomaticSchemaSha256(value: string): boolean {
  return value === RSS_AUTOMATIC_SCHEMA_SHA256 || value === RSS_AUTOMATIC_SOURCE_EPOCH_SCHEMA_SHA256;
}
