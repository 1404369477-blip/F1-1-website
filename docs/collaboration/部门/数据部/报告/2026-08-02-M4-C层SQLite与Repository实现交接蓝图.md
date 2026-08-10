---
type: data_delivery_report
status: final
date: 2026-08-02
department: 数据部
task_id: TASK-20260802-5B8665
domain_stage: M4-C-data-implementation-handoff
execution_mode: read_only_blueprint
---

# M4 C 层 SQLite 与 Repository 实现交接蓝图

## 1. 结论、边界与唯一真值

本任务已正式领取。本文是给开发部的只读实现交接蓝图，输入冻结在：

- [`docs/spec.md`](/Users/hoyin/Documents/F1+1/docs/spec.md) 的本地状态库、数据领域、TaskEnvelope、ReleaseBundle/Publication 与 C 层验收条款；
- 已接受 ADR [`2026-08-01-F1+1-M4本地Kickoff系统路线-accepted.md`](/Users/hoyin/Documents/F1+1/docs/decisions/system/2026-08-01-F1+1-M4本地Kickoff系统路线-accepted.md)；
- 唯一冻结数据合同目录 [`data/mvp-contract-v0/`](/Users/hoyin/Documents/F1+1/data/mvp-contract-v0/)，合同版本 `mvp-local-v0.3`，对应已 ACK 的 `TASK-20260802-D80846`。

VS-0 的 M3→Source canonical seed enrichment 由唯一桥接 artifact 单独承载：[`data/m4-vs0-seed-enrichment-v0/implementation-mapping.json`](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/implementation-mapping.json)、[`source-seed-enriched.json`](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json) 和 [`manifest.json`](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/manifest.json)。该桥接只补齐实现输入，不改变本文的领域 schema；Source 目标为 39 个 required 字段、CapturedItem 目标为 16 个 required 字段，M3 输入仍为 33/9。`source_safety_epoch` 从 M3 直接复制，未再作为 local-only 字段处理。`added_at` 日历日期投影已按 current accepted `ADR-M4-VS0-SEED-002` 的 successor 规则生成，59×39 projection 按 `source_id` Unicode code point 升序，权威 hash 为 `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`；后续只引用该 bridge，不创建第二字段集或第二 schema。

本文没有修改 `data/`、`app/`、Spec 或 ADR，没有运行生成器，没有访问 Base、飞书、provider、Collector、真实平台或网络。本文新增的 JSON 代码块是实现映射建议，不构成第二领域 schema；字段、枚举、默认值、hash 规则和状态边界仍以冻结 JSON 为唯一合同。若代码实现需要一个未被下文明确标为“实现基础设施”的业务字段，应暂停并提交数据合同修订任务，不自行扩展。

冻结基线的重要计数：6 组状态机、5 类幂等键、9 条不变量、16 个 onboarding 状态、4 个 reconcile outcome case、`max_task_window_seconds=900`、3 层 seed、M3 `33/9/59`、11 个 artifact hash、`external_calls=0`。领域 schema 的 `$defs` 共 13 个；`ActivationTransaction` 只在 fixture 中作为 receipt，未注册为领域实体。

## 2. 输入追溯矩阵

| 输入 | 唯一作用 | 本文使用的 JSON pointer / 条款 | 状态 |
|---|---|---|---|
| `schema.json` | 13 个领域对象、字段类型、required、enum、const、对象/数组结构 | `data/mvp-contract-v0/schema.json#/$defs/*`；根集合 `#/properties/*` | frozen |
| `base-mapping.json` | M3 33/9 字段边界与 `Source`/`CapturedItem` 映射 | `#/source_table/field_map`、`#/capture_table/field_map`、`#/base_mapped_entities`、`#/domain_only_entities`、`#/internal_only_entities` | frozen |
| `state-machine.json` | 6 组状态、5 类幂等、9 条不变量、五 fence 与窗口 | `#/state_machines`、`#/idempotency_keys`、`#/runtime_fence`、`#/invariants`、`#/migration_boundary` | frozen |
| `runtime-envelope.schema.json` | 内部 TaskEnvelope 的完整字段及 live fence 约束 | `#/properties/*`、`#/required` | frozen |
| `internal-contract.schema.json` | internal-only `SourceObservation`/`AuditEvent` allowlist | `#/$defs/SourceObservation`、`#/$defs/AuditEvent`、`#/domain_refs`、`#/base_mapping_refs` | frozen |
| `fixtures.synthetic.json` | 领域实体、18 个 Source、22 个 case、11 个 outbox、激活 receipt、snapshot fixture | `#/sources`、`#/captured_items`、`#/contents`、`#/events`、`#/summaries`、`#/media_candidates`、`#/release_bundles`、`#/review_decisions`、`#/publications`、`#/outbox_jobs`、`#/published_projections`、`#/activation_transaction`、`#/snapshot_reconciliation`、`#/cases` | frozen |
| `internal-fixtures.synthetic.json` | 2 条 observation、3 条 audit 与 3 条 internal case | `#/source_observations`、`#/audit_events`、`#/cases` | frozen |
| `seed-layers.json` + `manifest.json` | 三层 seed、来源 artifact SHA、subset hash、计数和零外连声明 | `seed-layers.json#/layers`；`manifest.json#/artifact_hashes`、`#/seed_subsets`、`#/entity_counts`、`#/external_calls` | frozen |
| accepted ADR | SQLite/Node 24/Repository/WAL/迁移/运行表边界 | §2.1、§4.1、§4.6、§4.7、§7、§9.2 | accepted；C 收据 pending |
| `docs/spec.md` | 产品语义和实施验收边界 | §本地状态库、数据领域、TaskEnvelope、ReleaseBundle、C 层 checklist | proposed/accepted baseline；C 收据 pending |

JSON pointer 中的 `*` 仅表示对应 `$defs` 名称；本文不创建同名替代路径。

## 3. 物理表分类与一份映射

### 3.1 分类

| 分类 | 表/集合 | 领域含义 | 读写边界 |
|---|---|---|---|
| Base 映射领域表 | `source_config_fixture` | `Source`，承载 M3 33 个 direct 字段和完整 39 个 required 字段 | fixture seed 读取 M3 影子并按 VS-0 bridge 补 6 个 derived 字段；Repository 只在本地合成场景按状态机写入；永不写回 Base |
| Base 映射领域表 | `captured_item` | `CapturedItem`，9 个手机捕获字段加合同规定的本地字段 | intake/repository；invalid 输入保留并阻断 Content 生成 |
| 本地域表 | `content_item` | `Content` | normalization/repository；版本与原始引用不可覆盖 |
| 本地域表 | `event` | `Event` | dedup/repository；成员数组保持确定性 |
| 本地域表 | `summary` | `Summary`，含 `summary_status=draft` | deterministic fixture summary；没有独立 SummaryDraft 表 |
| 本地域表 | `media_candidate` | `MediaCandidate` | fixture/none media；权利与安全状态显式 |
| 本地域表 | `release_bundle` | `ReleaseBundle` | immutable；审核前不得产生公开投影 |
| 本地域表 | `review_decision` | `ReviewDecision` | immutable decision 版本；批准 hash 必须回指当前 Bundle |
| 本地域表 | `publication` | `Publication` | 一个 Bundle/hash 一条逻辑身份；稳定 `public_id` 与 generation |
| 本地域表 | `published_projection` | `PublishedProjection` | Publication 的只读派生投影，不产生第二 public identity |
| 领域合同 + worker 边界 | `outbox` | `OutboxJob` 与嵌套 `TaskEnvelope` 的持久化任务记录 | durable outbox；状态由 `outbox_job` machine 约束；不反写 M3 |
| 本地对账记录 | `snapshot_reconciliation` | `SnapshotReconciliation` | 只保留 last-known-good；可引用 `outbox.job_id`，不升级候选快照 |
| 测试 fixture 集合 | `fixture_case`（推荐只在 fixture provider 中加载） | `FixtureCase` | 测试/合同输入；生产 Repository 不写入。若为测试 DB 表，字段仍逐字来自 schema |
| internal-only | `source_observation` | `SourceObservation` | `(source_id, external_id)` 唯一；不进入 domain/Base/public DTO |
| internal-only | `audit_event` | `AuditEvent` | append-only、脱敏、单调序列；不保存 secret/original/private identifier |
| worker 运行表 | `inbox`、`task_attempt`、`dead_letter` | TaskEnvelope 的 durable 入口、尝试与死信 | 运行记录；字段只承载 runtime envelope 和运行结果，不扩展产品领域 |
| 实现基础设施 | `PRAGMA user_version` 或迁移台账、seed ledger | 迁移/seed 防重复元数据 | 不属于领域合同；只能由代码 ADR/迁移实现定义，不能反向成为产品字段 |

`source_config_fixture` 的表名沿用 accepted ADR。它是唯一承载 `Source` 的物理映射；不再另建 `sources`、`source_state` 或 `source_config` 表。M3 影子行的只读性由 seed ledger/fixture profile 和导入策略记录，不能通过增加 `source_kind` 等业务列解决。`Source` 的 `enabled=false → true` 仅适用于通过状态机、五 fence 和本地合成 fixture 门禁的原子激活；M3 影子 seed 本身仍保持 59/59 disabled。

`OutboxJob` 仍是 v0.3 领域定义，`inbox`/`task_attempt`/`dead_letter` 是 worker 运行边界。它们共享同一 `TaskEnvelope` schema 和业务幂等键，Repository 不维护一套平行的任务字段合同。

### 3.2 机器可读 mapping 建议

下面的 `columns` 数组是对应 `$defs` 的完整 `properties` 名称集合；`column_pointer` 是逐字段可机械展开的唯一路径：将 `{field}` 替换为数组中的字面字段名即可。SQLite 列名建议逐字使用字段名，JSON object/array 字段使用 canonical UTF-8 JSON 文本存储，避免物理别名产生第二字段集。

```json
{
  "blueprint_version": "m4-c-sqlite-repository-handoff-v0.3",
  "authoritative_contract": "data/mvp-contract-v0",
  "domain_schema": "data/mvp-contract-v0/schema.json",
  "canonical_json": "data/mvp-contract-v0/state-machine.json#/canonical_json_rule",
  "storage_rules": {
    "scalar_column_name": "exact_contract_property_name",
    "object_or_array_storage": "TEXT containing canonical-json-v1 UTF-8 bytes",
    "required": "schema required array becomes NOT NULL after repository validation",
    "nullable": "schema anyOf null remains nullable; no sentinel string",
    "enum_const_minimum": "repository validates; SQLite CHECK duplicates only finite enum/const/minimum rules",
    "regex_uri_datetime": "repository schema validator; no unregistered SQLite REGEXP function",
    "unknown_fields": "reject before BEGIN IMMEDIATE write"
  },
  "tables": [
    {
      "table": "source_config_fixture",
      "kind": "base_mapped_domain",
      "entity": "Source",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/Source",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/sources",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/Source/properties/{field}",
      "columns": ["source_id","platform","platform_account_id","handle","raw_url","canonical_url","canonical_url_valid","normalizer_version","normalization_status","dedup_status","entity_type","content_focus","priority","verification_status","identity_status","relevance_status","monitorability","adapter_status","adapter_authorization_status","platform_allowed","authorization_checked_at","authorization_expires_at","collection_onboarding_status","onboarding_operation_id","lifecycle_status","enabled","manual_disable_at","source_stop_status","source_safety_epoch","source_config_epoch","added_at","evidence_url","notes","migration_batch_id","change_reason","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["source_id"],
      "foreign_keys": [],
      "unique_keys": ["source_id"],
      "indexes": ["canonical_url(valid unique partial index)","collection_onboarding_status,source_stop_status","lifecycle_status,enabled","source_config_epoch,source_safety_epoch"],
      "write_policy": "M3 seed read-only; synthetic local activation only through SourceRepository transaction"
    },
    {
      "table": "captured_item",
      "kind": "base_mapped_domain",
      "entity": "CapturedItem",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/CapturedItem",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/captured_items",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/CapturedItem/properties/{field}",
      "columns": ["capture_id","raw_url","capture_note","captured_at","normalization_status","normalization_error","dedup_status","dedup_match_source_id","source_id","canonical_url","content_id","source_config_epoch","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["capture_id"],
      "foreign_keys": ["source_id -> source_config_fixture.source_id (nullable)","content_id -> content_item.content_id (nullable)","dedup_match_source_id -> source_config_fixture.source_id (nullable)"],
      "unique_keys": ["capture_id"],
      "indexes": ["source_id,captured_at","normalization_status,dedup_status","canonical_url"],
      "write_policy": "invalid and needs_review rows remain candidates; no Content write until normalization/dedup guard passes"
    },
    {
      "table": "content_item",
      "kind": "domain_only",
      "entity": "Content",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/Content",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/contents",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/Content/properties/{field}",
      "columns": ["content_id","source_id","capture_id","external_content_id","external_url","canonical_url","content_kind","content_status","published_at","captured_at","content_version","content_version_hash","content_hash_input","normalized_title","normalized_body","language","source_evidence_url","source_config_epoch","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["content_id"],
      "foreign_keys": ["source_id -> source_config_fixture.source_id","capture_id -> captured_item.capture_id (nullable)"],
      "unique_keys": ["source_id,external_content_id,content_version_hash"],
      "indexes": ["source_id,external_content_id","content_status,updated_at","content_version_hash"],
      "write_policy": "same source/external/version hash is idempotent; changed immutable input creates a new content version"
    },
    {
      "table": "event",
      "kind": "domain_only",
      "entity": "Event",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/Event",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/events",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/Event/properties/{field}",
      "columns": ["event_id","dedup_fingerprint","canonical_content_id","member_content_ids","dedup_status","source_config_epoch","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["event_id"],
      "foreign_keys": ["canonical_content_id -> content_item.content_id"],
      "unique_keys": ["dedup_fingerprint"],
      "indexes": ["dedup_status,updated_at","canonical_content_id"],
      "write_policy": "member_content_ids stays canonical JSON array; repository validates every member against Content and uniqueItems"
    },
    {
      "table": "summary",
      "kind": "domain_only",
      "entity": "Summary",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/Summary",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/summaries",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/Summary/properties/{field}",
      "columns": ["summary_id","content_id","summary_version","summary_version_hash","summary_hash_input","input_content_hash","summary_schema_version","summarizer","deterministic","title_zh","summary_zh","summary_status","language","source_evidence_url","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["summary_id"],
      "foreign_keys": ["content_id -> content_item.content_id"],
      "unique_keys": ["content_id,summary_version_hash"],
      "indexes": ["content_id,summary_status","summary_version_hash"],
      "write_policy": "SummaryDraft is persisted as Summary(summary_status=draft); deterministic=true and input_content_hash must match Content"
    },
    {
      "table": "media_candidate",
      "kind": "domain_only",
      "entity": "MediaCandidate",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/MediaCandidate",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/media_candidates",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/MediaCandidate/properties/{field}",
      "columns": ["media_candidate_id","content_id","asset_ref","media_hash","mime_type","license_status","safety_status","candidate_status","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["media_candidate_id"],
      "foreign_keys": ["content_id -> content_item.content_id"],
      "unique_keys": ["content_id,media_hash"],
      "indexes": ["content_id,candidate_status","license_status,safety_status"],
      "write_policy": "synthetic asset_ref only; failed/restricted candidate can remain recorded and publication may use no media"
    },
    {
      "table": "release_bundle",
      "kind": "domain_only",
      "entity": "ReleaseBundle",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/ReleaseBundle",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/release_bundles",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/ReleaseBundle/properties/{field}",
      "columns": ["release_bundle_id","bundle_version","content_id","summary_id","content_version_hash","summary_version_hash","source_evidence_url","canonical_json_rule_version","canonical_payload","payload_hash","bundle_hash_input","bundle_hash","release_status","immutable","assembled_at","media_refs","source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["release_bundle_id"],
      "foreign_keys": ["content_id -> content_item.content_id","summary_id -> summary.summary_id"],
      "unique_keys": ["release_bundle_id,bundle_hash"],
      "indexes": ["content_id,summary_id","release_status,updated_at","bundle_hash"],
      "write_policy": "immutable=true; payload_hash and bundle_hash are recomputed before insert and never updated"
    },
    {
      "table": "review_decision",
      "kind": "domain_only",
      "entity": "ReviewDecision",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/ReviewDecision",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/review_decisions",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/ReviewDecision/properties/{field}",
      "columns": ["review_decision_id","content_id","summary_id","release_bundle_id","review_version","decision","approved_bundle_hash","reviewer_ref","reviewed_at","decision_reason","decision_hash_input","decision_hash","canonical_json_rule_version","immutable","source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["review_decision_id"],
      "foreign_keys": ["content_id -> content_item.content_id","summary_id -> summary.summary_id","release_bundle_id -> release_bundle.release_bundle_id"],
      "unique_keys": ["release_bundle_id,review_version"],
      "indexes": ["release_bundle_id,decision","decision,reviewed_at","approved_bundle_hash"],
      "write_policy": "immutable=true; approved requires approved_bundle_hash equal to the current release_bundle.bundle_hash in the same transaction"
    },
    {
      "table": "publication",
      "kind": "domain_only",
      "entity": "Publication",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/Publication",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/publications",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/Publication/properties/{field}",
      "columns": ["publication_id","content_id","summary_id","release_bundle_id","public_id","publish_generation","publication_status","approved_bundle_hash","approved_content_version_hash","approved_summary_version_hash","published_version_hash","idempotency_key","reconcile_key","reconcile_status","reconcile_attempt","last_query_at","emergency_stop","attempt","last_error_code","published_at","source_evidence_url","source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["publication_id"],
      "foreign_keys": ["content_id -> content_item.content_id","summary_id -> summary.summary_id","release_bundle_id -> release_bundle.release_bundle_id","(release_bundle_id,approved_bundle_hash) -> release_bundle(release_bundle_id,bundle_hash)"],
      "unique_keys": ["release_bundle_id,approved_bundle_hash","public_id","idempotency_key","reconcile_key"],
      "indexes": ["publication_status,reconcile_status","public_id","release_bundle_id,approved_bundle_hash","source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch"],
      "write_policy": "one logical identity per Bundle/hash; retry/reconcile mutates this row only; no second public_id or generation"
    },
    {
      "table": "outbox",
      "kind": "domain_contract_and_worker_runtime",
      "entity": "OutboxJob",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/OutboxJob",
      "runtime_schema_ref": "data/mvp-contract-v0/runtime-envelope.schema.json#",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/outbox_jobs",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/OutboxJob/properties/{field}",
      "columns": ["job_id","task_envelope","operation_id","operation_type","aggregate_type","aggregate_id","idempotency_key","reconcile_key","current_source_config_epoch","job_status","attempt","max_attempts","payload_hash","last_error_code","next_attempt_at","published_at","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["job_id"],
      "foreign_keys": ["publication aggregate_id is checked by repository when aggregate_type=publication; no polymorphic SQL FK"],
      "unique_keys": ["idempotency_key","operation_id,operation_type"],
      "indexes": ["job_status,next_attempt_at","aggregate_type,aggregate_id","operation_id","reconcile_key"],
      "write_policy": "task_envelope JSON is validated against runtime-envelope.schema.json; Publication publish/reconcile keys must match exactly"
    },
    {
      "table": "published_projection",
      "kind": "domain_only_read_model",
      "entity": "PublishedProjection",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/PublishedProjection",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/published_projections",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/PublishedProjection/properties/{field}",
      "columns": ["projection_id","public_id","content_id","summary_id","release_bundle_id","publish_generation","projection_status","published_version_hash","source_evidence_url","synthetic_only","external_calls","created_at","updated_at","created_by_ref","updated_by_ref"],
      "primary_key": ["projection_id"],
      "foreign_keys": ["public_id -> publication.public_id","content_id -> content_item.content_id","summary_id -> summary.summary_id","release_bundle_id -> release_bundle.release_bundle_id"],
      "unique_keys": ["public_id","release_bundle_id,publish_generation"],
      "indexes": ["projection_status,created_at","public_id"],
      "write_policy": "insert/update only from a successful Publication transition; synthetic_only=true and external_calls=0 in M4"
    },
    {
      "table": "snapshot_reconciliation",
      "kind": "local_reconciliation_record",
      "entity": "SnapshotReconciliation",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/SnapshotReconciliation",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/snapshot_reconciliation",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/SnapshotReconciliation/properties/{field}",
      "columns": ["job_id","last_known_good_manifest_hash","candidate_manifest_hash","reconciliation_status","failure_reason","external_calls","synthetic_only"],
      "primary_key": ["job_id"],
      "foreign_keys": ["job_id -> outbox.job_id"],
      "unique_keys": ["job_id"],
      "indexes": ["reconciliation_status,failure_reason"],
      "write_policy": "reconciliation_status is retained; partial/empty/stale candidate never replaces last_known_good"
    },
    {
      "table": "fixture_case",
      "kind": "test_fixture_only",
      "entity": "FixtureCase",
      "schema_ref": "data/mvp-contract-v0/schema.json#/$defs/FixtureCase",
      "fixture_ref": "data/mvp-contract-v0/fixtures.synthetic.json#/cases",
      "column_pointer": "data/mvp-contract-v0/schema.json#/$defs/FixtureCase/properties/{field}",
      "columns": ["case_id","kind","input_refs","expected","synthetic_input","external_calls"],
      "primary_key": ["case_id"],
      "foreign_keys": [],
      "unique_keys": ["case_id"],
      "indexes": ["kind"],
      "write_policy": "fixture provider/test DB only; production domain repository does not persist or expose this collection"
    },
    {
      "table": "source_observation",
      "kind": "internal_only",
      "entity": "SourceObservation",
      "schema_ref": "data/mvp-contract-v0/internal-contract.schema.json#/$defs/SourceObservation",
      "fixture_ref": "data/mvp-contract-v0/internal-fixtures.synthetic.json#/source_observations",
      "column_pointer": "data/mvp-contract-v0/internal-contract.schema.json#/$defs/SourceObservation/properties/{field}",
      "columns": ["observation_id","unique_key","owner_ref","source_id","external_id","observed_at","discovered_at","published_at","cursor_ref","response_hash","error_class","source_config_epoch","source_safety_epoch","operation_id","idempotency_key","payload_hash","internal_only"],
      "primary_key": ["observation_id"],
      "foreign_keys": ["source_id -> source_config_fixture.source_id"],
      "unique_keys": ["unique_key","source_id,external_id"],
      "indexes": ["source_id,observed_at","external_id","operation_id,idempotency_key"],
      "write_policy": "append/dedupe internal observation; published_at, operation_id and idempotency_key remain nullable; no domain/public projection"
    },
    {
      "table": "audit_event",
      "kind": "internal_only_append_only",
      "entity": "AuditEvent",
      "schema_ref": "data/mvp-contract-v0/internal-contract.schema.json#/$defs/AuditEvent",
      "fixture_ref": "data/mvp-contract-v0/internal-fixtures.synthetic.json#/audit_events",
      "column_pointer": "data/mvp-contract-v0/internal-contract.schema.json#/$defs/AuditEvent/properties/{field}",
      "columns": ["event_id","monotonic_seq","occurred_at","clock_status","trace_ref","session_hash","reason_code","owner","operation_id","task_id","source_config_epoch","source_safety_epoch","authorization_version","policy_epoch","recovery_epoch","attempt","payload_hash","fixture_hash","schema_hash","redaction_version","retention","cleanup_after","append_only","internal_only","external_calls"],
      "primary_key": ["event_id"],
      "foreign_keys": [],
      "unique_keys": ["event_id","monotonic_seq"],
      "indexes": ["occurred_at,monotonic_seq","reason_code","operation_id,task_id","cleanup_after"],
      "write_policy": "INSERT only; append_only=true, internal_only=true, external_calls=0; schema_hash must equal internal-contract.schema.json SHA-256"
    }
  ],
  "runtime_tables": [
    {
      "table": "inbox",
      "role": "durable task intake",
      "contract_refs": ["data/mvp-contract-v0/runtime-envelope.schema.json#", "data/mvp-contract-v0/schema.json#/$defs/OutboxJob", "data/mvp-contract-v0/state-machine.json#/state_machines/outbox_job"],
      "minimum_columns": {
        "job_id": "data/mvp-contract-v0/schema.json#/$defs/OutboxJob/properties/job_id",
        "task_envelope": "data/mvp-contract-v0/runtime-envelope.schema.json#",
        "received_at": "accepted ADR §4.6 durable inbox runtime timestamp (implementation metadata; no domain field)",
        "status": "data/mvp-contract-v0/state-machine.json#/state_machines/outbox_job/states",
        "updated_at": "accepted ADR §4.6 runtime record timestamp (implementation metadata; no domain field)"
      },
      "rule": "task_envelope is the exact runtime schema object; status is operational projection and cannot create a second task identity"
    },
    {
      "table": "task_attempt",
      "role": "lease/attempt history",
      "contract_refs": ["data/mvp-contract-v0/runtime-envelope.schema.json#/properties/attempt", "data/mvp-contract-v0/runtime-envelope.schema.json#/properties/lease_token", "data/mvp-contract-v0/runtime-envelope.schema.json#/properties/lease_expiry", "data/mvp-contract-v0/state-machine.json#/runtime_fence/lease_policy"],
      "minimum_columns": {
        "job_id": "data/mvp-contract-v0/schema.json#/$defs/OutboxJob/properties/job_id",
        "attempt": "data/mvp-contract-v0/runtime-envelope.schema.json#/properties/attempt",
        "task_envelope": "data/mvp-contract-v0/runtime-envelope.schema.json#",
        "started_at": "accepted ADR §4.6 task attempt timing (implementation metadata; no domain field)",
        "finished_at": "accepted ADR §4.6 task attempt timing (implementation metadata; no domain field)",
        "outcome": "data/mvp-contract-v0/state-machine.json#/state_machines/outbox_job/states",
        "updated_at": "accepted ADR §4.6 task attempt timestamp (implementation metadata; no domain field)"
      },
      "rule": "UNIQUE(job_id,attempt); raw lease token is never logged or copied to AuditEvent"
    },
    {
      "table": "dead_letter",
      "role": "bounded failure retention",
      "contract_refs": ["data/mvp-contract-v0/state-machine.json#/state_machines/outbox_job/states", "data/mvp-contract-v0/state-machine.json#/state_machines/outbox_job/transitions", "data/mvp-contract-v0/state-machine.json#/invariants/INV-FENCE-003"],
      "minimum_columns": {
        "dead_letter_id": "accepted ADR §4.6 dead-letter runtime identity (implementation metadata; no domain field)",
        "job_id": "data/mvp-contract-v0/schema.json#/$defs/OutboxJob/properties/job_id",
        "attempt": "data/mvp-contract-v0/schema.json#/$defs/OutboxJob/properties/attempt",
        "task_envelope": "data/mvp-contract-v0/runtime-envelope.schema.json#",
        "reason_code": "data/mvp-contract-v0/internal-contract.schema.json#/$defs/AuditEvent/properties/reason_code",
        "moved_at": "accepted ADR §4.6 dead-letter runtime timestamp (implementation metadata; no domain field)",
        "requeue_status": "data/mvp-contract-v0/state-machine.json#/state_machines/outbox_job/transitions"
      },
      "rule": "manual requeue preserves operation/idempotency identity and reruns all gates/fences; no automatic domain promotion"
    }
  ],
  "non_domain_infrastructure": {
    "migration": "PRAGMA user_version plus append-only SQL files; implementation metadata is not a product field",
    "seed": "artifact_hash/fixture_set ledger may be local infrastructure only; it cannot be returned as a domain DTO",
    "activation_receipt": "data/mvp-contract-v0/schema.json#/properties/activation_transaction; fixture receipt only"
  }
}
```

### 3.3 DDL 约束与索引规则

1. 每个 schema `required` 字段经 Repository schema validator 通过后映射为 `NOT NULL`。`anyOf` 含 `null` 的字段保持可空；显式 `null` 不能改成空串、`0` 或缺省。
2. `enum`、`const`、整数 `minimum` 复制为 SQLite `CHECK`；例如 `Source.enabled` 为 `CHECK(enabled IN (0,1))`，`source_config_epoch` 为 `CHECK(source_config_epoch>=1)`，`Summary.language` 为 `CHECK(language='zh-CN')`，`PublishedProjection.external_calls` 为 `CHECK(external_calls=0)`。正则、URI、date-time、对象/数组唯一性由同一 JSON Schema validator 与 canonical serializer 完成；SQLite 不假定存在未登记的 `REGEXP` 函数。
3. `TEXT` JSON 列必须在写入前通过对应 schema，之后按 `canonical-json-v1` 序列化。`content_hash_input`、`summary_hash_input`、`canonical_payload`、`bundle_hash_input`、`decision_hash_input`、`task_envelope`、`member_content_ids` 等名称保持合同原名。
4. 领域主键、幂等唯一键和 Publication 组合唯一键以 3.2 为准。对于 `reconcile_key` 允许空值的实体，SQLite 的唯一索引允许多个 NULL；Publication 合同本身要求同一身份的 key 逐字一致，Repository 必须在 NULL/非 NULL 语义上做条件检查。
5. `source_config_fixture.canonical_url` 使用条件唯一索引候选：`WHERE canonical_url_valid=1 AND dedup_status='unique'`。这样 `linked_existing` 可以保留为待处理记录；若 C 层确认业务需要另一种归属方式，应提交精确数据修订，不通过新字段绕过冲突。
6. JSON 数组关系暂不新建 `event_member`、`media_ref` 或 `bundle_snapshot` 表。`Event.member_content_ids`、`ReleaseBundle.media_refs` 以合同数组持久化，并在同一 Repository 事务内逐项校验存在性、`uniqueItems` 与 hash 绑定。此选择保持最少实体原则。
7. immutable 表使用 Repository 层拒绝 UPDATE/DELETE，并可增加 `BEFORE UPDATE/DELETE` trigger 作为 fail-closed 防线；trigger 只阻止变更，不生成隐藏版本字段。
8. `OutboxJob.aggregate_type` 是多态合同字段，SQLite 不建立伪造多态 FK。Repository 按 aggregate type 选择唯一领域表并校验 aggregate_id；这项边界来自 `runtime-envelope.schema.json#/properties/aggregate_type` 和 OutboxJob schema。

## 4. 只追加 migration 顺序

每条 migration 必须是一个可重复检查的 SQL 文件，版本号单调递增；成功后才推进 `PRAGMA user_version`。迁移体内不得联网、读取真实 provider、重写旧 migration、删除历史表或用 `DROP` 规避约束。启动时按 `verify:env → db:migrate → seed:fixtures → worker:mock` 顺序执行。

| 版本 | 只追加内容 | 前置/后置断言 | 追溯 |
|---|---|---|---|
| `0001` | 连接与数据库边界：创建允许根下文件；开启 `foreign_keys`，协商 WAL、`synchronous=FULL` 候选、`busy_timeout`；记录实际 `sqlite_version()`/`sqlite_source_id()` | 拒绝低于 3.51.3 的 WAL 多连接路径；目录/DB/WAL/SHM 权限与 realpath 通过 | accepted ADR §2.1、§7；Spec 本地状态库 |
| `0002` | `source_config_fixture`、`captured_item`、对应 FK、唯一键和状态索引 | Source required=39、CapturedItem required=16；M3 direct input=33/9，seed enrichment 后 Source=39，59 行保持 disabled | `schema.json#/$defs/Source,CapturedItem`；`base-mapping.json`；`data/m4-vs0-seed-enrichment-v0/implementation-mapping.json` |
| `0003` | `content_item`、`event`、`summary`、`media_candidate`、FK/unique/check/index | 内容/摘要 hash 输入可重算；Event member JSON 可校验 | `schema.json#/$defs/Content,Event,Summary,MediaCandidate`；`state-machine.json#/idempotency_keys` |
| `0004` | `release_bundle`、`review_decision`、`publication`、`published_projection`、组合 FK/唯一索引与 immutable 防线 | Bundle payload/bundle hash、批准 hash、一个 public identity 关系可复算 | `schema.json#/$defs/ReleaseBundle,ReviewDecision,Publication,PublishedProjection`；`state-machine.json#/invariants/INV-IDENTITY-004,INV-HASH-005` |
| `0005` | `outbox`、嵌套 TaskEnvelope JSON、`snapshot_reconciliation` | 每个 envelope 通过 runtime schema；publish/reconcile key 与 Publication 逐字一致 | `schema.json#/$defs/OutboxJob,SnapshotReconciliation`；`runtime-envelope.schema.json`；`state-machine.json#/state_machines/outbox_job,publication` |
| `0006` | `source_observation`、`audit_event`、append-only/monotonic 约束 | internal schema SHA 与 fixture schema_hash 对齐；domain/base refs 为空 | `internal-contract.schema.json`、`internal-fixtures.synthetic.json` |
| `0007` | `inbox`、`task_attempt`、`dead_letter` 运行表及 `job_id/attempt` 索引；只保留 runtime envelope 与结果 | duplicate delivery、lease、retry、dead-letter、manual requeue 的 identity 不变 | accepted ADR §4.6/§4.7；`state-machine.json#/state_machines/outbox_job` |
| `0008` | 可选测试 DB 的 `fixture_case` 与 seed ledger；生产 DB 默认不创建 fixture_case | 三层 seed 原子导入，artifact/subset hash 和 count 通过 | `schema.json#/properties/cases`；`seed-layers.json`；`manifest.json` |

每条 migration 采用：打开事务 → 检查当前 `user_version` 只能是前一版本 → DDL/索引/trigger → `PRAGMA integrity_check` 或等价轻量检查 → 更新 `user_version` → 提交。任一步失败保留旧 DB 和 migration 记录，停止 worker；修复只能由下一条 migration 追加。SQLite 的 `journal_mode=WAL`、`synchronous` 和 `busy_timeout` 是连接初始化动作，须在每个连接上复核，不把它们伪装成已经通过的 C 收据。

## 5. Repository 事务边界

事务体不执行网络、文件大读、模型调用、provider/adapter 调用或外部发布。外部能力在 M4 均关闭；未来调用若获单独授权，事务外执行，回写前再做同一五 fence CAS。

| 命令/场景 | `BEGIN IMMEDIATE` 内的最小顺序 | 成功条件 | 失败出口 |
|---|---|---|---|
| seed 导入一层 | 验证 artifact SHA、JSON schema、canonical/subset hash → 写对应 rows → 写 seed ledger | 行数、默认值、唯一键、hash 全部通过才 commit | 回滚整层；保持旧 fixture 与 last-known-good；不写 Base |
| observation → ingest | 写/去重 `source_observation` → 写唯一 inbox 业务操作 → 比较 Source 两个领域 epoch → 写 outbox 意图 | observation、inbox、CAS、outbox 一次提交；commit 后才 ack | duplicate 返回已存在结果；epoch/unique/lock 失败回滚并写脱敏 audit |
| activation `activation_pending → queued` | 读取 Source gates/stop/epochs → 验证 TaskEnvelope 五 fence → CAS Source `enabled=false`、status=`queued` → 写唯一 outbox 与 envelope → 校验 receipt 关系 | Source、TaskEnvelope、Outbox 复用 operation/key；一个 commit | `changes()!=1` 归类 stale/guard conflict；禁止只改 enabled 或只入队 |
| lease `queued → collecting` | 读取 outbox；校验 operation/key、五 fence、lease window → CAS job/source 状态并写 `task_attempt` | 只有一个 lease owner；`now < lease_expiry <= deadline <= now+900` | lock contention 有界重试；过期/epoch mismatch → stale_epoch，不调用 provider |
| content/summary/dedup | 校验 JSON 对象 → 写 Content/Summary/Event；执行 content/dedup/version unique key | hash 可重算、FK 存在、同一版本复用同一行 | 冲突且 hash 相同返回已有 row；冲突且 hash 不同 fail closed，待新版本 |
| Bundle → review → publication | 读取 immutable Bundle → recompute payload/bundle → 校验 ReviewDecision approved hash → `INSERT Publication`/复用已存在 identity → 写 publish outbox | `(release_bundle_id,approved_bundle_hash)`、public_id、idempotency_key、reconcile_key 均唯一且逐字一致 | UNIQUE 冲突先查询并比较 hash/key；不创建第二 Publication |
| publish/reconcile | 事务外调用在 M4 禁止；状态查询/写回前重新读取 Publication 与五 fence | 同一 Publication 行上转 `published`/`retryable_failed`/`reconcile_wait`/终态；published projection 只从成功状态派生 | unknown → `reconcile_wait`；confirmed not submitted 才可同 key 重试；partial snapshot 保留 last-known-good |
| stop/epoch bump | `BEGIN IMMEDIATE` 递增对应 epoch、写 stop/cancel 状态、标记旧任务 stale/cancelled、追加 AuditEvent | 旧 envelope 的 CAS 随即失败；新任务需重新过三门/五 fence | rollback 只在事务失败时发生；不恢复旧 worker，不自动回弹 |
| dead-letter/manual requeue | 读取失败预算与原 envelope；写 dead-letter 记录或同 identity 重新 pending；追加 AuditEvent | 操作/idempotency identity 保留，manual requeue 重验五 fence | 预算耗尽保持 dead_letter；不以死信状态升级领域公开状态 |

激活事务的关键伪 SQL（列名为合同原名，具体 Node API 由开发部实现）：

```sql
BEGIN IMMEDIATE;
SELECT source_id, enabled, collection_onboarding_status, canonical_url_valid,
       normalization_status, dedup_status, platform_allowed,
       adapter_authorization_status, adapter_status, source_stop_status,
       source_config_epoch, source_safety_epoch
  FROM source_config_fixture
 WHERE source_id = :source_id;

-- Repository additionally checks authorization_version, policy_epoch,
-- recovery_epoch and the validated TaskEnvelope before this UPDATE.
UPDATE source_config_fixture
   SET enabled = 1,
       collection_onboarding_status = 'queued',
       onboarding_operation_id = :onboarding_operation_id,
       updated_at = :now,
       updated_by_ref = :actor
 WHERE source_id = :source_id
   AND enabled = 0
   AND collection_onboarding_status = 'activation_pending'
   AND canonical_url_valid = 1
   AND normalization_status = 'valid'
   AND dedup_status = 'unique'
   AND platform_allowed = 'allowed'
   AND adapter_authorization_status = 'valid'
   AND adapter_status = 'ready'
   AND source_stop_status = 'clear'
   AND source_config_epoch = :source_config_epoch
   AND source_safety_epoch = :source_safety_epoch;
-- require changes() = 1
INSERT INTO outbox (... exact OutboxJob columns ...)
VALUES (... exact validated TaskEnvelope and one operation/idempotency key ...);
COMMIT;
```

`collection_onboarding_status` 与 `lifecycle_status` 是两个独立枚举，`paused` 只属于后者。当前 activation receipt 只冻结 `enabled`、onboarding status、operation/task/outbox/key 的绑定，没有把 lifecycle 变更写入 receipt；C 层应先按 `state-machine.json#/state_machines/source_onboarding/lifecycle_rules` 与该 fixture 逐项断言，再决定是否在同一事务补 lifecycle transition。遇到两份冻结输入语义不一致时必须报告精确 pointer，不能通过额外状态列绕过。

## 6. 五 fence、lease 与 CAS

TaskEnvelope 的五 fence 固定为：`source_config_epoch`、`source_safety_epoch`、`authorization_version`、`policy_epoch`、`recovery_epoch`。前两个来自 `Source`，后三个属于 runtime envelope；它们不能写入领域 Source schema 作为新产品字段。`runtime-envelope.schema.json` 规定五者 `minimum=1`，`epoch=0`、缺失、Unknown、负值和非单调值一律拒绝。

每个副作用前至少执行一次同一事务可见的检查：取得 lease、调用 provider/adapter 前、outbox dispatch 前、状态/提交 outbox 前、Publication mutation 前。代码应将 CAS 失败统一归类为 `stale_epoch`、`lease_expired`、`identity_conflict` 或 `lock_contention`，不能用通用成功响应掩盖。

建议的 lease CAS 形态：

```sql
BEGIN IMMEDIATE;
UPDATE outbox
   SET job_status = 'leased',
       attempt = attempt + 1,
       task_envelope = :fresh_envelope_json,
       updated_at = :now
 WHERE job_id = :job_id
   AND idempotency_key = :idempotency_key
   AND job_status IN ('pending','retryable_failed','reconcile_wait')
   AND current_source_config_epoch = :source_config_epoch
   AND attempt < max_attempts;
-- require changes() = 1, then insert task_attempt(job_id, attempt, envelope...)
COMMIT;
```

实际实现还必须在 Repository 中比较完整 envelope 的五 fence、opaque lease token、`lease_expiry` 和 `deadline`。`runtime-envelope.schema.json` 当前为 synthetic lease pattern；live 运行必须保留至少 128 bit CSPRNG opaque 值，不能把 token 写入普通日志或 AuditEvent。`max_task_window_seconds=900` 取自 `state-machine.json#/runtime_fence/max_task_window_seconds` 与 manifest，不能从环境变量任意放大。

Publication 写序固定为：验证当前 immutable Bundle → 验证 ReviewDecision 的 `approved_bundle_hash` → 在同一事务以 `(release_bundle_id, approved_bundle_hash)` 查找或插入一个 Publication → 对 publish outbox/TaskEnvelope 逐字复制 Publication `idempotency_key` 与 `reconcile_key` → commit。外部发布在 M4 关闭；若未来启用，调用前后都要对同一 Publication 做 CAS。未知结果只进入 `reconcile_wait`，查询使用同一 `public_id`/generation/key，禁止插入第二 Publication。

## 7. Seed、fixture 与 hash 验证点

### 7.1 导入顺序与范围

1. 先读取 `manifest.json` 和 11 个 artifact，逐一 SHA-256 验证；验证 `canonical-json-v1` 规则为 UTF-8、Unicode code-point 键序、紧凑逗号/冒号、显式 null、有限 JSON 数字、无 NFC/NFD 归一化、SHA-256。
2. 导入 `m3-shadow-seed`：`Source`/`CapturedItem` 的 M3 33/9 字段保留原值，59 行、59 个 `source_id`、59 个 `canonical_url`、59/59 `enabled=false`；`unknown`、`pending`、`proposed`、`false`、`null` 不升级。该层 `writes_to_base=false`。
3. 导入 `synthetic-case-seed`：按 schema 根集合写入 domain fixture；`ActivationTransaction` 只验证 receipt，不建立领域表；published projection、snapshot reconciliation、internal subset 只作为各自选择集。
4. 导入 `security-error-seed`：16 个安全/错误 case，所有 `synthetic_only=true`、`external_calls=0`；禁止真实 URL、账号、token、媒体和 provider 调用。
5. 导入后重新查询行数、唯一键、FK、状态枚举、M3 默认值、三层分离、`seed_subsets` 的 `source_artifact_sha256`/`subset_hash` 语义。重复执行必须命中 seed ledger/幂等键并返回同一结果，禁止追加重复业务行。

### 7.2 hash 与 schema 验收点

| 对象 | 重算对象 | 规则/来源 | C 层动作 |
|---|---|---|---|
| artifact | 每个 manifest artifact 文件 | `manifest.json#/artifact_hashes` | 启动/seed 前校验；manifest 自身不纳入避免递归 |
| Content | `content_hash_input` | `state-machine.json#/invariants/INV-HASH-005`、`Content.content_version_hash` | canonicalize 后 SHA-256 与字段逐字相等 |
| Summary | `summary_hash_input` | 同上、`Summary.summary_version_hash` | `input_content_hash` 必须指向当前 Content hash |
| ReleaseBundle | `canonical_payload` → payload hash；`bundle_hash_input` → bundle hash | `ReleaseBundle` schema、`INV-HASH-005` | payload 根显式含两个 version hash；strict content snapshot 含 capture/external/published/captured；summary snapshot 含 summary version hash |
| ReviewDecision | `decision_hash_input` | `ReviewDecision` schema | approved 时 `approved_bundle_hash=bundle_hash`；变更只能 supersede |
| TaskEnvelope | 整个 envelope 结构与 window | `runtime-envelope.schema.json`、`state-machine.json#/runtime_fence` | schema、五 fence、lease、attempt、idempotency/reconcile key 逐项验证 |
| Internal AuditEvent | fixture/schema evidence | `internal-contract.schema.json#/$defs/AuditEvent/schema_hash` | `schema_hash` 等于 internal schema 文件 SHA；sequence 单调 |
| published subset | 选中 PublishedProjection 对象的 canonical JSON | `manifest.json#/seed_subsets` | `source_artifact_sha256` 与 `subset_hash` 分开记录 |
| snapshot subset | 选中 SnapshotReconciliation 对象的 canonical JSON | 同上 | partial/stale 只保留 last-known-good |
| internal subset | 选中的 observations + audits 对象 canonical JSON | 同上 | count 按实际数组计算，内部文件 SHA 单独放 `source_artifact_sha256` |

Seed 导入只验证和写本地状态。报告、manifest 或 fixture 中的 hash 不能被 Repository 当作真实平台证明；C 层没有执行前，不得把它们写成 SQLite 运行收据。

## 8. 状态机与失败出口映射

状态名和边界全部来自 `state-machine.json#/state_machines`；表中只存对应合同字段，不另建 `paused`、`publish_unknown`、`source_config_version` 等状态/字段。

| 出口 | 触发条件 | Repository 处理 | 保留内容 |
|---|---|---|---|
| normalization failure | URL invalid 或 normalization invalid | `CapturedItem` 保留 raw/capture；Source 进入 `normalization_failed`；恢复前重验三门/五 fence | 原始候选与错误字段 |
| dedup review | dedup `needs_review` | 停在 `dedup_needs_review`，不建重复 Content/Event；人工复核后回 validating | dedup fingerprint/匹配引用 |
| blocked | 三门失败按 `platform > authorization > adapter` 选择唯一 blocked 状态 | 只改 canonical 状态，恢复时重新检查所有门和 fence | gate evidence，非公开成功 |
| queue/collection failure | queue reject、bounded provider failure | 有界重试；预算耗尽转 dead_letter；不无限重放 | operation/idempotency key、attempt、脱敏 AuditEvent |
| stop/cancel | `source_stop_status != clear` 或显式取消 | queued/collecting 转 stopped/cancelled；递增对应 epoch；旧 lease CAS 失败 | stop reason、旧任务内部结果 |
| stale epoch/lease | 五 fence、source epoch 或 lease 过期/不匹配 | provider/outbox/commit 前 fail closed；OutboxJob=`stale_epoch` | 同一 envelope、审计 evidence |
| dead letter | 失败预算耗尽 | 保留任务与 AuditEvent；人工 requeue 用原 identity 并重验 gates/fences | 失败原因、attempt、envelope |
| publication blocked | hash mismatch、stop、stale fence | `blocked`；清除后只回 `queued`，不新建 identity | approved hash、同一 idempotency/reconcile key |
| reconcile wait | outcome unknown | Publication 进入 `reconcile_wait`；查询结果决定四种 outcome | one public_id、generation、两个 key |
| snapshot failure | partial/empty/stale candidate | SnapshotReconciliation=`retained`；候选 hash 不替换 last-known-good | 两个 manifest hash、failure_reason |
| lock contention | `SQLITE_BUSY`/locked 或 commit busy | 有限 backoff/jitter；耗尽归类 lock_contention，停止该任务或进入失败队列 | 旧状态完整性、脱敏 AuditEvent |
| migration/schema drift | schema/hash/engine/version 不符 | 启动拒绝或回滚该事务；停 worker；下一条 migration 修复 | 旧 DB、migration/seed 记录 |

## 9. 验收矩阵

| 验收项 | 证据位置 | 本蓝图已确认 | C 层状态 |
|---|---|---|---|
| 13 个 `$defs` 与物理映射 | `schema.json#/$defs`、本文 3.2 | 逐一列出；FixtureCase 仅测试；ActivationTransaction 仅 receipt | 待开发实现/测试 |
| M3 33/9、Source 39、CapturedItem 16、59、双唯一、disabled | `base-mapping.json`、M3 manifest、VS-0 bridge `manifest.json` | frozen input 与 bridge projection 已验证；`source_safety_epoch` 直读 M3；`added_at` 按 current accepted ADR-002 继承规则投影；排序 hash=`e7a8…` | seed DB 运行待验证 |
| required/nullable/enum/const/minimum | 每个 `schema.json#/$defs/*/properties` | 规则及 repository validator 入口已定义 | Node SQLite 约束测试待验证 |
| FK/唯一/索引 | 本文 3.2/3.3 | 选择最小键；多态 aggregate 保留 Repository 校验 | SQL migration 待实现 |
| 6 状态机、5 幂等、9 不变量 | `state-machine.json` | 状态和失败出口无额外状态 | contract test 待验证 |
| 激活 `enabled+queued+operation+outbox` 原子写 | `state-machine.json#/state_machines/source_onboarding/transitions`、`fixtures.synthetic.json#/activation_transaction` | 事务伪 SQL、changes=1 与失败出口已定义 | BEGIN IMMEDIATE/CAS 待验证 |
| 五 fence、lease、900 秒窗口 | `runtime-envelope.schema.json`、`state-machine.json#/runtime_fence` | 五 fence、epoch 规则、opaque token 与 deadline 规则已固定 | Node24 runtime/clock/lease 待验证 |
| Publication 唯一身份与 reconcile | `schema.json#/$defs/Publication`、`state-machine.json#/invariants/INV-IDENTITY-004` | unique/FK/写序/四 outcome 已定义 | 并发/重复投递待验证 |
| strict hash | `schema.json#/$defs/ReleaseBundle`、v0.3 fixture | content/summary/bundle/review/snapshot hash 对象已列 | canonical serializer/SQLite round-trip 待验证 |
| internal-only 边界 | `internal-contract.schema.json`、`base-mapping.json` | SourceObservation/AuditEvent 不进 domain/Base；Audit append-only | schema loader/trigger 待验证 |
| 三层 seed、subset hash、16 security cases | `seed-layers.json`、`manifest.json`、security fixtures | 选择集、来源 SHA、subset hash 和零外连边界已列 | seed command/fixture DB 待验证 |
| WAL/lock/recovery/migration | accepted ADR §2.1/§7、开发部运行时报告 §6.2/§7 | 迁移顺序、连接参数、有限重试、版本门禁已定义 | Node24.18.x 实机矩阵待验证 |
| no external I/O/Base write | manifest、ADR §2.2/§4.1 | 本任务只读；M4 fixture/mock fail closed | C 进程 deny-all 收据待验证 |

## 10. 失败路径与 C 层未知

### 10.1 必须立即停止并升级的路径

1. 若任一字段无法用对应 schema 的 SQLite 类型、JSON validator 或明确的 Repository 检查表达，报告精确 JSON pointer（例如 `schema.json#/$defs/<Entity>/properties/<field>`）与冲突 SQL，不自行加列。需要改变领域语义时提交新的数据合同/ADR 修订。
2. 若唯一键冲突的两行具有不同 payload/hash，Repository fail closed，保留旧行和 AuditEvent；不使用 `INSERT OR REPLACE`、不静默覆盖、不生成第二 public identity。
3. 若同一操作遇到 stale epoch、expired lease、stop/cancel 或任何五 fence mismatch，在 provider/outbox/Publication 副作用前拒绝；旧结果仅可进入 internal 审计或同一 Publication 的 reconcile 查询。

### 10.2 C 层明确 pending 项

- Node 24 目标 patch 的 `node:sqlite` 真实 API、`DatabaseSync` 事务/锁/commit busy 行为、实际 SQLite version/source id；此前 Node 25 观察不能替代 Node 24 收据。
- WAL 单 writer、0/1 mock worker、同机多进程、`busy_timeout` 有界 retry、SIGKILL recovery、checkpoint、磁盘权限和网络文件系统拒绝矩阵。
- migration 失败后的 user_version/旧 DB 恢复、重复执行与下一条 append migration；seed ledger 在并发启动下的幂等。
- JSON Schema validator 与 canonical serializer 在 Node/SQLite TEXT round-trip 后的 Unicode、null、有限数值与 hash 等价性。
- 真实 Repository 的 FK/trigger/CAS changes=1、Publication 重复提交、reconcile 四 outcome、死信人工重排和最后一致快照。
- HTTP/UI/CSRF、真实 provider/平台、飞书/Base ACL、媒体权利、AI、部署、容量和生产存储。这些均不在本文授权范围内。

C 层未形成上述收据前，交接状态只能标为 `implementation_pending`；不能把本报告中的静态设计写成运行通过。

## 11. 回滚与安全边界

- migration 失败：停止 worker，保留旧 DB/WAL 和 migration 记录；只允许下一条 migration 修复，不删除历史。
- fixture/schema/hash 漂移：拒绝启动，恢复上一份锁定 artifact/manifest；不把异常行写进 `published_projection`。
- 任务异常：递增 `recovery_epoch` 或相关 stop epoch，取消旧 lease；按幂等键查询后定向重放，保留 last-known-good。
- 任何真实网络、Base、飞书、Collector、发布、token、credential 或外部媒体写入都保持关闭。发现开关越界时进程 fail closed，写入脱敏 internal audit 后退出。
- 表结构中没有凭证、原文全文、私密账号标识或运行堆栈列；AuditEvent 只保留合同规定的 hash、reason、owner、retention/cleanup 等脱敏证据。

## 12. 已验证、未验证与错题自检

### 已验证（只读）

- 已成功 claim `TASK-20260802-5B8665`，读取任务 JSON、Spec、accepted ADR、冻结 v0.3 schema/mapping/state/runtime/internal/fixture/seed/manifest。
- 13 个 `$defs`、M3 33/9/59、Source required39、CapturedItem required16、6/5/9、16/4/900、3 seed、11 artifact hash、internal-only 两实体、三层 subset 字段语义与 `external_calls=0` 均与冻结文件一致；VS-0 bridge 另以 `m4-vs0-seed-enrichment-v0` manifest 记录 59×39 projection hash。
- 每个领域/internal 表在 3.2 的 `columns` 与唯一 schema `$defs` 属性集合对应；运行表显式标为 ADR/runtime 基础设施，不冒充领域字段。
- Publication unique identity、strict payload snapshot、五 fence、TaskEnvelope `reconcile_key`、source stop/cancel、dead-letter/reconcile/snapshot failure 的失败出口均有 source pointer 和事务位置。
- 本次只新增本报告；没有运行生成器、没有修改 `data/`、`app/`、Spec/ADR，没有外部 I/O。

### 未验证（C 层 pending）

SQLite/Node24 迁移与事务真实运行、WAL/锁/CAS/lease/recovery、seed DB 导入、Repository/API/worker、schema validator 实机、UI/安全门禁、真实 provider/Base/飞书和生产容量均未执行。本文没有伪造运行收据。

### 错题自检

- 没有创建 `sources`、`source_state`、`event_member`、`SummaryDraft`、`publish_unknown` 等平行实体/状态；`source_config_fixture` 是唯一 Source 物理映射，SummaryDraft 仍为 Summary draft。
- 没有把 SourceObservation 的三项 runtime epoch 写进领域字段；Observation 只按 internal contract 的两个 source epoch 与可空字段映射，AuditEvent 保留五 epoch。
- 没有把 `source_sha256` 与 subset canonical hash 混为一个字段；seed 表达沿用 `source_artifact_sha256` 与 `subset_hash` 的冻结语义。
- 没有把 `epoch=0`、Unknown、缺失 lease 或超时 envelope 视为可执行任务；900 秒窗口和五 fence 只从 runtime/state contract 读取。
- 没有把 SnapshotReconciliation 当作第二 Publication；partial/stale 只保留 last-known-good。
- 没有把 `INSERT OR REPLACE` 当作幂等；冲突必须比较 hash/key，Publication 永不复制 public identity。
- 没有把 Node 25 探针、静态 hash 或本报告内容写成 Node24/SQLite 运行通过。

## 13. 收口

本蓝图已完成，供开发部在不改写冻结 v0.3 的前提下创建 C 层 migration/repository。后续任何字段、状态、key、hash 或实体变化都应回到数据合同修订流程。任务完成前应由开发/测试/安全分别补 C 层收据；本任务本身保持只读交接。

TASK_STATE_OK
