import type { DatabaseSync } from "node:sqlite";

export function hasRssConfigV2(database: DatabaseSync): boolean {
  return database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='source_registry_rss_config_v2'").get() !== undefined;
}

export function rssConfigTable(database: DatabaseSync): "source_registry_rss_config_current" | "source_registry_rss_config_v1" {
  return hasRssConfigV2(database) ? "source_registry_rss_config_current" : "source_registry_rss_config_v1";
}
