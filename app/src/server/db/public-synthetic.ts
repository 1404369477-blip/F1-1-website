import { createHash } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import { relative, resolve } from "node:path";

import { ConfigError, validateFixturePath, type AppConfig, type SecurePathInfo } from "../config/env.ts";
import { SOURCE_REQUIRED_FIELDS, type SourceRow } from "../providers/source-fixture.ts";
import { assertMigrationState, withImmediateTransaction, type SqliteDatabase } from "./database.ts";
import {
  PUBLIC_PROFILE_COUNTS,
  PUBLIC_PROFILE_ID,
  assertDatabaseProfile,
  canonicalJson,
  countTable
} from "./profile.ts";

export const PUBLIC_ROOT_HASHES = Object.freeze({
  manifest: "3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554",
  ledger: "1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1",
  generator: "34ecfa83fec1f89a22d877e554c4ce5c4d11c1bad6b7f09f123fea3ede1cb81a",
  validator: "058be83bdded7f5c60028f0a2e537c510e9386934284684fffb119d2e487360c"
});

export const PUBLIC_FIXTURE_SHA256 = "c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4";
export const PUBLIC_GRAPH_SHA256 = "4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526";

const ROOT_FILES = {
  manifest: "manifest.json",
  ledger: "profile-ledger.json",
  generator: "generate_public_fixture.py",
  validator: "validate_public_fixture.py"
} as const;
const ENTITY_TABLES = [
  ["captured_items", "public_captured_item", "capture_id"],
  ["contents", "public_content", "content_id"],
  ["summaries", "public_summary", "summary_id"],
  ["media_candidates", "public_media_candidate", "media_candidate_id"],
  ["release_bundles", "public_release_bundle", "release_bundle_id"],
  ["review_decisions", "public_review_decision", "review_decision_id"],
  ["publications", "public_publication", "publication_id"],
  ["published_projections", "published_projection", "projection_id"]
] as const;

type JsonRecord = Record<string, unknown>;

type PublicFixture = JsonRecord & {
  sources: SourceRow[];
  captured_items: JsonRecord[];
  contents: JsonRecord[];
  summaries: JsonRecord[];
  media_candidates: JsonRecord[];
  release_bundles: JsonRecord[];
  review_decisions: JsonRecord[];
  publications: JsonRecord[];
  published_projections: JsonRecord[];
};

export type PublicSyntheticSeedResult = {
  profileId: typeof PUBLIC_PROFILE_ID;
  contractVersion: "mvp-local-v0.4";
  fixtureSet: "public-demo-12-v0.4";
  fixtureManifestHash: typeof PUBLIC_ROOT_HASHES.manifest;
  fixtureGraphHash: typeof PUBLIC_GRAPH_SHA256;
  rowCounts: typeof PUBLIC_PROFILE_COUNTS;
  syntheticOnly: true;
  externalCalls: 0;
  writesToBase: false;
  realContentImported: false;
  inserted: boolean;
};

export type PublicSeedOptions = {
  testOnlyFailAfterWrites?: number;
};

function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError("PUBLIC_FIXTURE_SCHEMA", `${label} must be an object`);
  }
  return value as JsonRecord;
}

function parseJson(path: SecurePathInfo, label: string): JsonRecord {
  try {
    return asRecord(JSON.parse(path.bytes.toString("utf8")), label);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("PUBLIC_FIXTURE_JSON", `${label} is invalid JSON`);
  }
}

function readPinnedFile(appRoot: string, projectRoot: string, file: string, expectedHash: string): SecurePathInfo {
  const absolute = resolve(projectRoot, "data/mvp-contract-v0.4-public-synthetic", file);
  const info = validateFixturePath(relative(appRoot, absolute), appRoot, projectRoot);
  if (info.sha256 !== expectedHash) {
    throw new ConfigError("PUBLIC_ROOT_DRIFT", `${file} does not match the application trust root`);
  }
  return info;
}

function asArray(record: JsonRecord, key: string, count: number): JsonRecord[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length !== count || value.some((item) => item === null || typeof item !== "object" || Array.isArray(item))) {
    throw new ConfigError("PUBLIC_FIXTURE_COUNTS", `${key} must contain exactly ${count} objects`);
  }
  return value as JsonRecord[];
}

function requireEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new ConfigError("PUBLIC_FIXTURE_POLICY", `${label} does not match the accepted contract`);
}

function validateGraph(fixture: PublicFixture): void {
  const source = fixture.sources[0] as JsonRecord;
  requireEqual(source.source_id, "src-active", "source_id");
  requireEqual(Object.keys(source).length, 39, "Source field count");
  requireEqual(source.enabled, true, "public Source enabled");

  const capturedByContent = new Map(fixture.captured_items.map((row) => [String(row.content_id), row]));
  const contentById = new Map(fixture.contents.map((row) => [String(row.content_id), row]));
  const summaryById = new Map(fixture.summaries.map((row) => [String(row.summary_id), row]));
  const bundleById = new Map(fixture.release_bundles.map((row) => [String(row.release_bundle_id), row]));
  const decisionByBundle = new Map(fixture.review_decisions.map((row) => [String(row.release_bundle_id), row]));
  const publicationByPublicId = new Map(fixture.publications.map((row) => [String(row.public_id), row]));
  for (const projection of fixture.published_projections) {
    const publicId = String(projection.public_id);
    const publication = publicationByPublicId.get(publicId);
    const bundle = bundleById.get(String(projection.release_bundle_id));
    const decision = decisionByBundle.get(String(projection.release_bundle_id));
    const content = contentById.get(String(projection.content_id));
    const summary = summaryById.get(String(projection.summary_id));
    const capture = capturedByContent.get(String(projection.content_id));
    if (!/^public-[a-z0-9-]+$/.test(publicId) || !publication || !bundle || !decision || !content || !summary || !capture) {
      throw new ConfigError("PUBLIC_FIXTURE_GRAPH", `projection ${publicId} has an incomplete chain`);
    }
    if (
      projection.projection_status !== "published" ||
      publication.publication_status !== "published" ||
      decision.decision !== "approved" ||
      bundle.release_status !== "approved" ||
      decision.approved_bundle_hash !== bundle.bundle_hash ||
      publication.approved_bundle_hash !== bundle.bundle_hash ||
      projection.published_version_hash !== publication.published_version_hash ||
      content.source_id !== "src-active" ||
      capture.source_id !== "src-active" ||
      summary.content_id !== content.content_id
    ) {
      throw new ConfigError("PUBLIC_FIXTURE_GRAPH", `projection ${publicId} violates the approved published chain`);
    }
  }
}

function loadPublicPackage(appRoot: string, projectRoot: string): PublicFixture {
  const pinned = Object.fromEntries(
    Object.entries(ROOT_FILES).map(([key, file]) => [key, readPinnedFile(appRoot, projectRoot, file, PUBLIC_ROOT_HASHES[key as keyof typeof PUBLIC_ROOT_HASHES])])
  ) as Record<keyof typeof ROOT_FILES, SecurePathInfo>;
  const manifest = parseJson(pinned.manifest, "manifest");
  const ledger = parseJson(pinned.ledger, "profile ledger");
  requireEqual(manifest.contract_version, "mvp-local-v0.4", "manifest contract");
  requireEqual(manifest.graph_hash, PUBLIC_GRAPH_SHA256, "manifest graph hash");
  requireEqual(ledger.profile_id, PUBLIC_PROFILE_ID, "ledger profile");
  requireEqual(ledger.sqlite_path, "app/.local/f1plus1-public-synthetic.sqlite", "ledger path");
  requireEqual(ledger.fixture_manifest_hash, PUBLIC_ROOT_HASHES.manifest, "ledger manifest root");
  requireEqual(ledger.fixture_graph_hash, PUBLIC_GRAPH_SHA256, "ledger graph hash");
  requireEqual(ledger.synthetic_only, true, "ledger synthetic_only");
  requireEqual(ledger.external_calls, 0, "ledger external_calls");
  requireEqual(ledger.writes_to_base, false, "ledger writes_to_base");
  requireEqual(ledger.real_content_imported, false, "ledger real_content_imported");
  if (canonicalJson(ledger.row_counts) !== canonicalJson({
    sources: 1,
    captured_items: 12,
    contents: 12,
    events: 0,
    summaries: 12,
    media_candidates: 10,
    release_bundles: 12,
    review_decisions: 12,
    publications: 12,
    outbox_jobs: 0,
    published_projections: 12
  })) throw new ConfigError("PUBLIC_FIXTURE_COUNTS", "profile ledger row counts drifted");

  const fixtureInfo = readPinnedFile(appRoot, projectRoot, "fixtures.public-synthetic.json", PUBLIC_FIXTURE_SHA256);
  const fixtureRecord = parseJson(fixtureInfo, "public fixture");
  requireEqual(createHash("sha256").update(canonicalJson(fixtureRecord)).digest("hex"), PUBLIC_GRAPH_SHA256, "fixture graph hash");
  requireEqual(fixtureRecord.schema_version, "mvp-local-v0.4", "fixture contract");
  requireEqual(fixtureRecord.fixture_set, "public-demo-12-v0.4", "fixture set");
  requireEqual(fixtureRecord.synthetic_only, true, "fixture synthetic_only");
  requireEqual(fixtureRecord.external_calls, 0, "fixture external_calls");
  requireEqual(fixtureRecord.writes_to_base, false, "fixture writes_to_base");
  requireEqual(fixtureRecord.real_content_imported, false, "fixture real_content_imported");
  requireEqual((fixtureRecord.events as unknown[])?.length, 0, "event count");
  requireEqual((fixtureRecord.outbox_jobs as unknown[])?.length, 0, "outbox count");
  const fixture = Object.assign(fixtureRecord, {
    sources: asArray(fixtureRecord, "sources", 1) as SourceRow[],
    captured_items: asArray(fixtureRecord, "captured_items", 12),
    contents: asArray(fixtureRecord, "contents", 12),
    summaries: asArray(fixtureRecord, "summaries", 12),
    media_candidates: asArray(fixtureRecord, "media_candidates", 10),
    release_bundles: asArray(fixtureRecord, "release_bundles", 12),
    review_decisions: asArray(fixtureRecord, "review_decisions", 12),
    publications: asArray(fixtureRecord, "publications", 12),
    published_projections: asArray(fixtureRecord, "published_projections", 12)
  }) as PublicFixture;
  validateGraph(fixture);
  return fixture;
}

function sqlValue(field: string, value: unknown): SQLInputValue {
  if (field === "canonical_url_valid" || field === "enabled") {
    if (value === true) return 1;
    if (value === false) return 0;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  throw new ConfigError("PUBLIC_FIXTURE_SCHEMA", `${field} is not a scalar Source value`);
}

function result(inserted: boolean): PublicSyntheticSeedResult {
  return {
    profileId: PUBLIC_PROFILE_ID,
    contractVersion: "mvp-local-v0.4",
    fixtureSet: "public-demo-12-v0.4",
    fixtureManifestHash: PUBLIC_ROOT_HASHES.manifest,
    fixtureGraphHash: PUBLIC_GRAPH_SHA256,
    rowCounts: PUBLIC_PROFILE_COUNTS,
    syntheticOnly: true,
    externalCalls: 0,
    writesToBase: false,
    realContentImported: false,
    inserted
  };
}

function assertStoredPayloads(database: SqliteDatabase, fixture: PublicFixture): void {
  const storedSource = database.prepare(`SELECT ${SOURCE_REQUIRED_FIELDS.join(", ")} FROM source_config_fixture`).get() as JsonRecord | undefined;
  if (!storedSource) throw new Error("PUBLIC_SEED_DRIFT: src-active is missing");
  const normalizedSource = Object.fromEntries(SOURCE_REQUIRED_FIELDS.map((field) => [
    field,
    field === "canonical_url_valid" || field === "enabled" ? Number(storedSource[field]) === 1 : storedSource[field]
  ]));
  if (canonicalJson(normalizedSource) !== canonicalJson(fixture.sources[0])) throw new Error("PUBLIC_SEED_DRIFT: stored Source changed");
  for (const [fixtureKey, table, id] of ENTITY_TABLES) {
    const expected = [...fixture[fixtureKey]].sort((left, right) => String(left[id]).localeCompare(String(right[id]))).map(canonicalJson);
    const actual = (database.prepare(`SELECT payload_json FROM ${table} ORDER BY ${id}`).all() as Array<JsonRecord>).map((row) => String(row.payload_json));
    if (actual.length !== expected.length || actual.some((payload, index) => payload !== expected[index])) {
      throw new Error(`PUBLIC_SEED_DRIFT: ${table} does not match the pinned fixture`);
    }
  }
}

function assertPublicLedger(database: SqliteDatabase): void {
  const ledger = database.prepare("SELECT * FROM fixture_profile_ledger").get() as JsonRecord | undefined;
  if (!ledger) throw new Error("PROFILE_LEDGER_MISSING: public fixture profile ledger is missing");
  if (
    ledger.profile_id !== PUBLIC_PROFILE_ID ||
    ledger.sqlite_path !== "app/.local/f1plus1-public-synthetic.sqlite" ||
    ledger.contract_version !== "mvp-local-v0.4" ||
    ledger.fixture_set !== "public-demo-12-v0.4" ||
    ledger.fixture_manifest_hash !== PUBLIC_ROOT_HASHES.manifest ||
    ledger.fixture_graph_hash !== PUBLIC_GRAPH_SHA256 ||
    ledger.row_counts_json !== canonicalJson(PUBLIC_PROFILE_COUNTS) ||
    Number(ledger.synthetic_only) !== 1 || Number(ledger.external_calls) !== 0 || Number(ledger.writes_to_base) !== 0 ||
    Number(ledger.real_content_imported) !== 0 ||
    ledger.manifest_root_sha256 !== PUBLIC_ROOT_HASHES.manifest ||
    ledger.profile_ledger_root_sha256 !== PUBLIC_ROOT_HASHES.ledger ||
    ledger.generator_root_sha256 !== PUBLIC_ROOT_HASHES.generator ||
    ledger.validator_root_sha256 !== PUBLIC_ROOT_HASHES.validator
  ) throw new Error("PROFILE_LEDGER_DRIFT: public ledger does not match the pinned profile");
}

function assertNoPartialPublicGraph(database: SqliteDatabase): void {
  const counts = {
    sources: countTable(database, "source_config_fixture"),
    captured_items: countTable(database, "public_captured_item"),
    contents: countTable(database, "public_content"),
    summaries: countTable(database, "public_summary"),
    media_candidates: countTable(database, "public_media_candidate"),
    release_bundles: countTable(database, "public_release_bundle"),
    review_decisions: countTable(database, "public_review_decision"),
    publications: countTable(database, "public_publication"),
    published_projections: countTable(database, "published_projection")
  };
  if (canonicalJson(counts) !== canonicalJson(PUBLIC_PROFILE_COUNTS)) {
    throw new Error("PUBLIC_SEED_DRIFT: public entity counts are incomplete or mixed");
  }
}

export function assertPublicSyntheticSeeded(
  database: SqliteDatabase,
  config: AppConfig,
  appRoot: string,
  projectRoot: string
): PublicSyntheticSeedResult {
  if (config.dataProfile !== PUBLIC_PROFILE_ID) throw new Error("PROFILE_MIX: public seed requires public-synthetic");
  const fixture = loadPublicPackage(appRoot, projectRoot);
  assertMigrationState(database, resolve(appRoot, "migrations"), 3);
  assertDatabaseProfile(database, config);
  assertPublicLedger(database);
  assertNoPartialPublicGraph(database);
  assertStoredPayloads(database, fixture);
  return result(false);
}

export function seedPublicSyntheticFixture(
  database: SqliteDatabase,
  config: AppConfig,
  appRoot: string,
  projectRoot: string,
  options: PublicSeedOptions = {}
): PublicSyntheticSeedResult {
  if (config.dataProfile !== PUBLIC_PROFILE_ID) throw new Error("PROFILE_MIX: public seed requires public-synthetic");
  const fixture = loadPublicPackage(appRoot, projectRoot);
  assertMigrationState(database, resolve(appRoot, "migrations"), 3);
  assertDatabaseProfile(database, config);
  const existingLedger = countTable(database, "fixture_profile_ledger");
  if (existingLedger > 0) {
    assertPublicLedger(database);
    assertNoPartialPublicGraph(database);
    assertStoredPayloads(database, fixture);
    return result(false);
  }
  if (countTable(database, "source_config_fixture") !== 0 || ENTITY_TABLES.some(([, table]) => countTable(database, table) !== 0)) {
    throw new Error("PUBLIC_SEED_PARTIAL: rows exist without a profile ledger");
  }

  let writes = 0;
  const markWrite = (): void => {
    writes += 1;
    if (options.testOnlyFailAfterWrites === writes) throw new Error("PUBLIC_SEED_FAULT_INJECTED");
  };
  withImmediateTransaction(database, () => {
    const sourceInsert = database.prepare(
      `INSERT INTO source_config_fixture (${SOURCE_REQUIRED_FIELDS.join(", ")}) VALUES (${SOURCE_REQUIRED_FIELDS.map(() => "?").join(", ")})`
    );
    sourceInsert.run(...SOURCE_REQUIRED_FIELDS.map((field) => sqlValue(field, fixture.sources[0][field])));
    markWrite();

    const statements = {
      captured_items: database.prepare("INSERT INTO public_captured_item (capture_id, source_id, content_id, payload_json) VALUES (?, ?, ?, ?)"),
      contents: database.prepare("INSERT INTO public_content (content_id, source_id, capture_id, editorial_category, content_version_hash, content_status, published_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
      summaries: database.prepare("INSERT INTO public_summary (summary_id, content_id, summary_version_hash, summary_status, payload_json) VALUES (?, ?, ?, ?, ?)"),
      media_candidates: database.prepare("INSERT INTO public_media_candidate (media_candidate_id, content_id, media_hash, candidate_status, payload_json) VALUES (?, ?, ?, ?, ?)"),
      release_bundles: database.prepare("INSERT INTO public_release_bundle (release_bundle_id, content_id, summary_id, bundle_hash, release_status, immutable, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)"),
      review_decisions: database.prepare("INSERT INTO public_review_decision (review_decision_id, content_id, summary_id, release_bundle_id, approved_bundle_hash, decision, immutable, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
      publications: database.prepare("INSERT INTO public_publication (publication_id, content_id, summary_id, release_bundle_id, public_id, approved_bundle_hash, published_version_hash, publication_status, published_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      published_projections: database.prepare("INSERT INTO published_projection (projection_id, public_id, content_id, summary_id, release_bundle_id, published_version_hash, projection_status, synthetic_only, external_calls, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    };
    for (const row of fixture.captured_items) {
      statements.captured_items.run(String(row.capture_id), String(row.source_id), String(row.content_id), canonicalJson(row)); markWrite();
    }
    for (const row of fixture.contents) {
      statements.contents.run(String(row.content_id), String(row.source_id), String(row.capture_id), String(row.editorial_category), String(row.content_version_hash), String(row.content_status), row.published_at as string | null, canonicalJson(row)); markWrite();
    }
    for (const row of fixture.summaries) {
      statements.summaries.run(String(row.summary_id), String(row.content_id), String(row.summary_version_hash), String(row.summary_status), canonicalJson(row)); markWrite();
    }
    for (const row of fixture.media_candidates) {
      statements.media_candidates.run(String(row.media_candidate_id), String(row.content_id), String(row.media_hash), String(row.candidate_status), canonicalJson(row)); markWrite();
    }
    for (const row of fixture.release_bundles) {
      statements.release_bundles.run(String(row.release_bundle_id), String(row.content_id), String(row.summary_id), String(row.bundle_hash), String(row.release_status), row.immutable === true ? 1 : 0, canonicalJson(row)); markWrite();
    }
    for (const row of fixture.review_decisions) {
      statements.review_decisions.run(String(row.review_decision_id), String(row.content_id), String(row.summary_id), String(row.release_bundle_id), String(row.approved_bundle_hash), String(row.decision), row.immutable === true ? 1 : 0, canonicalJson(row)); markWrite();
    }
    for (const row of fixture.publications) {
      statements.publications.run(String(row.publication_id), String(row.content_id), String(row.summary_id), String(row.release_bundle_id), String(row.public_id), String(row.approved_bundle_hash), String(row.published_version_hash), String(row.publication_status), String(row.published_at), canonicalJson(row)); markWrite();
    }
    for (const row of fixture.published_projections) {
      statements.published_projections.run(String(row.projection_id), String(row.public_id), String(row.content_id), String(row.summary_id), String(row.release_bundle_id), String(row.published_version_hash), String(row.projection_status), row.synthetic_only === true ? 1 : 0, Number(row.external_calls), canonicalJson(row)); markWrite();
    }
    database.prepare(
      "INSERT INTO fixture_profile_ledger (profile_id, sqlite_path, contract_version, fixture_set, fixture_manifest_hash, fixture_graph_hash, row_counts_json, synthetic_only, external_calls, writes_to_base, real_content_imported, manifest_root_sha256, profile_ledger_root_sha256, generator_root_sha256, validator_root_sha256, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, ?, ?, ?, ?, ?)"
    ).run(
      PUBLIC_PROFILE_ID,
      "app/.local/f1plus1-public-synthetic.sqlite",
      "mvp-local-v0.4",
      "public-demo-12-v0.4",
      PUBLIC_ROOT_HASHES.manifest,
      PUBLIC_GRAPH_SHA256,
      canonicalJson(PUBLIC_PROFILE_COUNTS),
      PUBLIC_ROOT_HASHES.manifest,
      PUBLIC_ROOT_HASHES.ledger,
      PUBLIC_ROOT_HASHES.generator,
      PUBLIC_ROOT_HASHES.validator,
      "2026-08-04T00:00:00Z"
    );
    markWrite();
    assertNoPartialPublicGraph(database);
    assertPublicLedger(database);
    assertStoredPayloads(database, fixture);
  });
  return result(true);
}
