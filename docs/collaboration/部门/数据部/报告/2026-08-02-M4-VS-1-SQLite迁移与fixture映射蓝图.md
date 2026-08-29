---
type: data_delivery_report
status: final
date: 2026-08-02
department: 数据部
task_id: TASK-20260802-6E342D
domain_stage: M4-C-VS-1-mock-collection-sqlite-blueprint
execution_mode: read_only_blueprint
---

# M4 VS-1 mock 采集链路 SQLite 迁移与 fixture 映射蓝图

## 1. 结论、范围与冻结边界

本任务已正式领取。本文是开发部实施 VS-1 本地 mock 采集链路的 DDL 级交接蓝图，输入仅包括：

- [`docs/spec.md`]([M5-HOME]/Documents/F1+1/docs/spec.md) 的 M4 本地状态库、mock/fixture provider、Source onboarding、采集、幂等、恢复和 C 层验收条款；
- 已接受的 [`ADR-M4-KICKOFF-001`]([M5-HOME]/Documents/F1+1/docs/decisions/system/2026-08-01-F1+1-M4本地Kickoff系统路线-accepted.md)；
- 唯一冻结领域合同 [`data/mvp-contract-v0/`]([M5-HOME]/Documents/F1+1/data/mvp-contract-v0/)，版本 `mvp-local-v0.3`，对应已 ACK 的 `TASK-20260802-D80846`；
- 唯一 VS-0 M3→Source enrichment bridge [`data/m4-vs0-seed-enrichment-v0/`]([M5-HOME]/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/)，59×39 sorted projection 的权威 hash 为 `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`。

本报告只交付数据库和 fixture 映射蓝图，没有实现 Repository、worker 或 provider。报告写入之外没有修改 `data/`、`app/`、Spec、ADR；没有访问 Base、飞书、网络、真实平台、真实数据库或外部服务，也没有运行生成器。

设计边界如下：

1. `data/mvp-contract-v0` 是唯一领域字段、状态、幂等、hash 和安全合同。本文的 DDL/SQL 片段是实现说明，不形成第二领域 schema；任何物理列都必须回指合同 pointer，或明确标记为 runtime/internal infrastructure。
2. `Source` 与 `CapturedItem` 是 Base 映射领域对象。M3 影子 seed 只导入本地 fixture，59 行保持 `enabled=false`，不会写回 Base，也不会生成真实 `Content`、`Event`、`Summary` 或公开事实。
3. `SourceObservation` 与 `AuditEvent` 是 internal-only 记录。它们不进入 domain DTO、Base 映射、PublishedProjection 或公开 API。`SummaryDraft` 只映射为 `Summary(summary_status=draft)`，不创建草稿实体。
4. SQLite 只承载本地/测试状态。Node 24 `node:sqlite`、WAL、`synchronous=FULL`、`busy_timeout`、`BEGIN IMMEDIATE`、有限 `lock_contention` 重试、`user_version` 迁移和 crash recovery 是 accepted 运行边界；生产、多实例、网络文件系统和真实 provider 继续 pending。

## 2. 输入证据与合同指纹

| 输入 | 关键 pointer/条款 | 本文用途 | 状态 |
|---|---|---|---|
| `schema.json` | `#/$defs/{Entity}/properties/{field}`、`#/required` | 领域字段、类型、required、enum、const、minimum、对象/数组 | frozen |
| `base-mapping.json` | `#/source_table/field_map`、`#/capture_table/field_map`、`#/base_mapped_entities`、`#/domain_only_entities`、`#/internal_only_entities` | M3 33/9 → Source/CapturedItem 边界；SummaryDraft alias | frozen |
| `state-machine.json` | `#/state_machines`、`#/idempotency_keys`、`#/invariants`、`#/runtime_fence`、`#/migration_boundary` | 6 状态机、5 幂等键、9 不变量、五 fence、900 秒窗口 | frozen |
| `runtime-envelope.schema.json` | `#/required`、`#/properties/*` | TaskEnvelope 字段、lease/deadline/五 fence | frozen |
| `internal-contract.schema.json` | `#/$defs/SourceObservation`、`#/$defs/AuditEvent` | internal 表 allowlist、唯一键和审计 append-only 约束 | frozen |
| `fixtures.synthetic.json` | `#/sources`、`#/captured_items`、`#/contents`、`#/events`、`#/summaries`、`#/media_candidates`、`#/release_bundles`、`#/review_decisions`、`#/publications`、`#/outbox_jobs`、`#/published_projections`、`#/cases` | synthetic domain rows、happy/error cases、activation receipt | frozen |
| `internal-fixtures.synthetic.json` | `#/source_observations`、`#/audit_events`、`#/cases` | internal synthetic rows | frozen |
| `seed-layers.json`、`manifest.json` | `#/layers`、`#/artifact_hashes`、`#/entity_counts`、`#/seed_subsets` | seed 分层、file SHA、subset hash 和计数 | frozen |

当前 `manifest.json` 的合同收据为：`state_machine_count=6`、`idempotency_key_count=5`、`invariant_count=9`、`source_onboarding_state_count=16`、`reconcile_outcome_case_count=4`、`max_task_window_seconds=900`、`fixture_case_count=22`、`external_calls=0`。领域实体计数为 Source 18、CapturedItem 8、Content 7、Event 2、Summary 7、MediaCandidate 5、ReleaseBundle 5、ReviewDecision 5、Publication 5、OutboxJob 11、PublishedProjection 3；internal fixture 为 SourceObservation 2、AuditEvent 3。`$defs` 中 13 个领域对象均逐字来自冻结 schema。

冻结合同 11/11 artifact SHA-256（用于 migration preflight，不在本文重算或改写）如下：

| artifact | SHA-256 |
|---|---|
| `schema.json` | `de6c6c07a33589106ebb93496ad10ae3b06ab1c7845e4e0e91888ca0b17ae5a4` |
| `base-mapping.json` | `f0a086099d0f4ce9bbcd1afb0533aef90ec8d4f00b1618cc5114bebe40601f9d` |
| `state-machine.json` | `d5ca45fd60c2ad08c60929abd714f6e80c43c20f561be0c0a18e3baa17c7c120` |
| `fixtures.synthetic.json` | `e56122c0d99761df2e48bfed817c45e0e184d10130ea5bfce89e1d1be56f4abf` |
| `runtime-envelope.schema.json` | `15d398cbaaefa37dabfa6af9b7b9c3cc8b207922ef67b0889329366f8336b30d` |
| `security-fixtures.schema.json` | `3a8dcd859f48edcd65ab6a05a4b34280f3629f7c879236dbab3ce83e61b78d0a` |
| `security-fixtures.synthetic.json` | `66ace7a1e1800d740f75b35fd55234c7417b9acae7ef1c0a32757eec3051db22` |
| `internal-contract.schema.json` | `462605a2258d2922d9b982f490aeda3a1395f9e1dcf718fb8745e49db2afade8` |
| `internal-fixtures.synthetic.json` | `6fa873675732a06e440d8d67923647a9938d264b1162a485d3abf02ef33f86d8` |
| `seed-layers.json` | `d8a9d5cbfb8f3b209557ef7c6ef904e8c63b03d577b461d4f2ecb2aae7b40459` |
| `generate_contract.py` | `3f62c2eabdbd95c4b26bb878028481695aed5ab93173d3cba608acd1e6bf3841` |

Hash/canonical边界：合同的 `canonical_json_rule` 是项目自定义 `canonical-json-v1`，编码 UTF-8、键按 Unicode code point 排序、紧凑逗号/冒号、不做 NFC/NFD、保留显式 null、仅有限 JSON 数字，SHA-256 对精确 UTF-8 bytes 计算；它不宣称 RFC 8785 JCS。所有 object/array SQLite 列均保存这套 canonical JSON 文本。

## 3. 物理表、字段和 DDL 规则

### 3.1 通用 SQLite 类型映射

| 合同 JSON 类型/语义 | SQLite 列 | 落库规则 |
|---|---|---|
| `string`、`uri`、`date`、`date-time` | `TEXT` | 先按 schema validator 校验格式；不以空字符串代替 null |
| `boolean` | `INTEGER NOT NULL CHECK (col IN (0,1))` | DTO 层 `0/1` 与布尔值双向转换；const/enum 另设 CHECK 或 repository 校验 |
| `integer` | `INTEGER` | `minimum` 用 CHECK；epoch 必须 `>=1`，Publication 的 `attempt/reconcile_attempt` 可按合同 `>=0` |
| `object`、`array` | `TEXT` | 存 canonical-json-v1 UTF-8；写前拒绝未知 key、NaN、Infinity、非有限数字；读后再 schema 校验 |
| `anyOf: [T, null]` | `T` 可空 | 保留 SQL NULL，不能写 sentinel 字符串 |
| `const`、`enum` | 原类型 + `CHECK` | 只复制冻结值；状态转换仍由 repository CAS 决定 |
| `required` | `NOT NULL` | 所有当前 schema required 字段均为 NOT NULL；nullable anyOf 字段除外 |

URL、date-time、hash、ID pattern 由统一 schema validator 校验；SQLite 不依赖未注册的 `REGEXP` 扩展。每个写入口先验证 `additionalProperties=false`、类型和 hash，再进入事务。以下所有 `schema_ref` 的 `{field}` 替换为列名即为逐字段 pointer；列名保持合同字面，不引入 snake/camel 别名。

### 3.2 Base 映射与 Source/CapturedItem

| 物理表 | 合同字段（完整列集） | 主键/外键/唯一 | CHECK/索引 | 写策略 |
|---|---|---|---|---|
| `source_config_fixture` | `schema.json#/$defs/Source/properties/{field}`：`source_id, platform, platform_account_id, handle, raw_url, canonical_url, canonical_url_valid, normalizer_version, normalization_status, dedup_status, entity_type, content_focus, priority, verification_status, identity_status, relevance_status, monitorability, adapter_status, adapter_authorization_status, platform_allowed, authorization_checked_at, authorization_expires_at, collection_onboarding_status, onboarding_operation_id, lifecycle_status, enabled, manual_disable_at, source_stop_status, source_safety_epoch, source_config_epoch, added_at, evidence_url, notes, migration_batch_id, change_reason, created_at, updated_at, created_by_ref, updated_by_ref`（39） | `PK(source_id)`；本地 `canonical_url` 有效值唯一；`onboarding_operation_id` 非空时唯一 | platform/状态 enum；`enabled IN (0,1)`；epoch 两列 `>=1`；索引 `(collection_onboarding_status,source_stop_status)`、`(lifecycle_status,enabled)`、`(source_config_epoch,source_safety_epoch)`、有效 canonical URL | M3 59 行只读 disabled seed；合成 activation 才能在 CAS 中改变状态；永不写回 Base |
| `captured_item` | `schema.json#/$defs/CapturedItem/properties/{field}`：`capture_id, raw_url, capture_note, captured_at, normalization_status, normalization_error, dedup_status, dedup_match_source_id, source_id, canonical_url, content_id, source_config_epoch, created_at, updated_at, created_by_ref, updated_by_ref`（16） | `PK(capture_id)`；`source_id → source_config_fixture.source_id`、`dedup_match_source_id → source_config_fixture.source_id`、`content_id → content_item.content_id` 均可空 | normalization/dedup enum；epoch `>=1`；索引 `(source_id,captured_at)`、`(normalization_status,dedup_status)`、`canonical_url` | invalid/needs_review 记录可保留；只有规范化有效、查重唯一时才允许 Content 写入 |

VS-0 bridge 的输入/输出只在 seed ledger 留证：`m3-shadow-seed` 59×33，`source-seed-enriched` 59×39，59 行 `enabled=false`；按 accepted successor 规则补齐 `platform_allowed`、`source_config_epoch`、`created_at`、`updated_at`、`created_by_ref`、`updated_by_ref`，`source_safety_epoch` 直接取 M3，`added_at` 按 accepted date 投影；`source_id` Unicode code point 升序，projection hash 为 `e7a8…9f17`。本任务不改 bridge，不重生成它。

### 3.3 采集、内容、去重与摘要

| 物理表 | 合同字段（完整列集） | 主键/外键/唯一 | CHECK/索引 | 写策略 |
|---|---|---|---|---|
| `content_item` | `schema.json#/$defs/Content/properties/{field}`：`content_id, source_id, capture_id, external_content_id, external_url, canonical_url, content_kind, content_status, published_at, captured_at, content_version, content_version_hash, content_hash_input, normalized_title, normalized_body, language, source_evidence_url, source_config_epoch, created_at, updated_at, created_by_ref, updated_by_ref`（22） | `PK(content_id)`；`source_id → Source`；`capture_id → CapturedItem` 可空；唯一 `(source_id,external_content_id,content_version_hash)` | content kind/status enum；epoch `>=1`；`content_hash_input` canonical object；索引 `(source_id,external_content_id)`、`(content_status,updated_at)`、`content_version_hash` | 版本 hash 对合同指定输入重算；相同 source/external/version hash 幂等返回既有 row；变更生成新版本，不覆盖不可变输入 |
| `event` | `schema.json#/$defs/Event/properties/{field}`：`event_id, dedup_fingerprint, canonical_content_id, member_content_ids, dedup_status, source_config_epoch, created_at, updated_at, created_by_ref, updated_by_ref`（10） | `PK(event_id)`；`canonical_content_id → Content`；`dedup_fingerprint UNIQUE` | dedup enum；epoch `>=1`；`member_content_ids` canonical array、uniqueItems；索引 `(dedup_status,updated_at)`、`canonical_content_id` | dedup key 重放只返回同一 Event；成员数组按确定性规则追加一次，不产生第二 canonical Event |
| `summary` | `schema.json#/$defs/Summary/properties/{field}`：`summary_id, content_id, summary_version, summary_version_hash, summary_hash_input, input_content_hash, summary_schema_version, summarizer, deterministic, title_zh, summary_zh, summary_status, language, source_evidence_url, created_at, updated_at, created_by_ref, updated_by_ref`（18） | `PK(summary_id)`；`content_id → Content`；唯一 `(content_id,summary_version_hash)` | `deterministic=1`、`language='zh-CN'`；summary status enum；索引 `(content_id,summary_status)`、`summary_version_hash` | SummaryDraft 映射为 `summary_status=draft`；`input_content_hash` 必须等于 Content 当前版本 hash；hash mismatch 回滚 |
| `media_candidate` | `schema.json#/$defs/MediaCandidate/properties/{field}`：`media_candidate_id, content_id, asset_ref, media_hash, mime_type, license_status, safety_status, candidate_status, created_at, updated_at, created_by_ref, updated_by_ref`（12） | `PK(media_candidate_id)`；`content_id → Content`；唯一 `(content_id,media_hash)` | mime/license/safety/candidate enum；索引 `(content_id,candidate_status)`、`(license_status,safety_status)` | fixture/无图路径可继续；禁止把未经授权媒体转成 ReleaseBundle 可发布事实 |

### 3.4 Bundle、审核、Publication 与只读投影

| 物理表 | 合同字段（完整列集） | 主键/外键/唯一 | CHECK/索引 | 写策略 |
|---|---|---|---|---|
| `release_bundle` | `schema.json#/$defs/ReleaseBundle/properties/{field}`：`release_bundle_id, bundle_version, content_id, summary_id, content_version_hash, summary_version_hash, source_evidence_url, canonical_json_rule_version, canonical_payload, payload_hash, bundle_hash_input, bundle_hash, release_status, immutable, assembled_at, media_refs, source_config_epoch, source_safety_epoch, authorization_version, policy_epoch, recovery_epoch, created_at, updated_at, created_by_ref, updated_by_ref`（25） | `PK(release_bundle_id)`；`content_id → Content`、`summary_id → Summary`；唯一 `(release_bundle_id,bundle_hash)` | `canonical_json_rule_version='canonical-json-v1'`、`immutable=1`、五 epoch `>=1`；索引 `(content_id,summary_id)`、`(release_status,updated_at)`、`bundle_hash` | payload 必须冻结 Content 的 capture_id/external_url/published_at/captured_at、content/summary version hash、source/policy/media/schema/fence snapshot；payload/bundle hash 在同一事务重算后不可更新 |
| `review_decision` | `schema.json#/$defs/ReviewDecision/properties/{field}`：`review_decision_id, content_id, summary_id, release_bundle_id, review_version, decision, approved_bundle_hash, reviewer_ref, reviewed_at, decision_reason, decision_hash_input, decision_hash, canonical_json_rule_version, immutable, source_config_epoch, source_safety_epoch, authorization_version, policy_epoch, recovery_epoch, created_at, updated_at, created_by_ref, updated_by_ref`（23） | `PK(review_decision_id)`；三项实体外键；唯一 `(release_bundle_id,review_version)` | review enum；approved 时 `approved_bundle_hash` 非空且等于当前 bundle hash；immutable=1；索引 `(release_bundle_id,decision)`、`(decision,reviewed_at)`、`approved_bundle_hash` | 审核决策追加版本；旧版本不覆写；Bundle/hash/fence 变化使旧批准失效 |
| `publication` | `schema.json#/$defs/Publication/properties/{field}`：`publication_id, content_id, summary_id, release_bundle_id, public_id, publish_generation, publication_status, approved_bundle_hash, approved_content_version_hash, approved_summary_version_hash, published_version_hash, idempotency_key, reconcile_key, reconcile_status, reconcile_attempt, last_query_at, emergency_stop, attempt, last_error_code, published_at, source_evidence_url, source_config_epoch, source_safety_epoch, authorization_version, policy_epoch, recovery_epoch, created_at, updated_at, created_by_ref, updated_by_ref`（30） | `PK(publication_id)`；Content/Summary/Bundle 外键；唯一 `(release_bundle_id,approved_bundle_hash)`、`public_id`、`idempotency_key`、`reconcile_key` | publication/reconcile enum；generation `>=1`、attempt/reconcile_attempt `>=0`、emergency_stop 0/1、五 epoch `>=1`；索引 `(publication_status,reconcile_status)`、`public_id`、`(release_bundle_id,approved_bundle_hash)`、五 fence | 同一 Bundle/hash 只保留一个 Publication/public_id/generation；retry/reconcile/blocked/dead-letter 只 CAS 此 row，保留 identity 和 key；Projection 不写回 Publication |
| `published_projection` | `schema.json#/$defs/PublishedProjection/properties/{field}`：`projection_id, public_id, content_id, summary_id, release_bundle_id, publish_generation, projection_status, published_version_hash, source_evidence_url, synthetic_only, external_calls, created_at, updated_at, created_by_ref, updated_by_ref`（15） | `PK(projection_id)`；`public_id → Publication`、Content/Summary/Bundle 外键；唯一 `public_id`、`(release_bundle_id,publish_generation)` | `projection_status='published'`、`synthetic_only=1`、`external_calls=0`；索引 `(projection_status,created_at)`、`public_id` | 只读派生表；仅在本地 synthetic Publication 成功转换后写入，不能成为第二公开真值 |
| `snapshot_reconciliation` | `schema.json#/$defs/SnapshotReconciliation/properties/{field}`：`job_id, last_known_good_manifest_hash, candidate_manifest_hash, reconciliation_status, failure_reason, external_calls, synthetic_only`（7） | `PK(job_id)`；`job_id → outbox.job_id` | status `retained`、failure reason `partial_or_empty_snapshot|stale_epoch`、external_calls=0、synthetic_only=1；索引 `(reconciliation_status,failure_reason)` | 候选为空、部分或旧 epoch 时保留 last-known-good；候选 hash 不覆盖已确认 manifest |

### 3.5 Outbox、TaskEnvelope 与 internal/runtime 表

`OutboxJob` 是 v0.3 领域合同对象；`inbox`、`task_attempt`、`dead_letter`、迁移台账和 fingerprint 表是实现基础设施。后者的字段不进入领域 JSON、Base 或 public DTO，每个字段都须标为 internal 并通过 runtime-envelope/outbox pointer 追溯。

| 物理表 | 字段及来源 | 主键/唯一/外键 | CHECK/索引 | 语义 |
|---|---|---|---|---|
| `outbox_job` | `schema.json#/$defs/OutboxJob/properties/{field}`：`job_id, task_envelope, operation_id, operation_type, aggregate_type, aggregate_id, idempotency_key, reconcile_key, current_source_config_epoch, job_status, attempt, max_attempts, payload_hash, last_error_code, next_attempt_at, published_at, created_at, updated_at, created_by_ref, updated_by_ref`（20） | `PK(job_id)`；`idempotency_key UNIQUE`；`(operation_id,operation_type) UNIQUE`；`aggregate_id` 的 polymorphic FK 由 repository 按 aggregate_type 校验 | operation/aggregate/job status enum；epoch `>=1`、attempt `>=0`、max_attempts `>=1`；索引 `(job_status,next_attempt_at)`、`(aggregate_type,aggregate_id)`、`operation_id`、`reconcile_key` | `task_envelope` TEXT 必须符合 `runtime-envelope.schema.json`；Source activation 的 operation id 在 Source、Envelope、Outbox 逐字相同 |
| `inbox`（internal） | `inbox_id`、`job_id`、`task_envelope`、`envelope_hash`、`operation_id`、`idempotency_key`、`received_at`、`inbox_status`、`last_error_code`、`created_at`；envelope 字段回指 `runtime-envelope.schema.json#/properties/*`，其余为 runtime internal | `PK(inbox_id)`；`job_id → outbox_job.job_id`；唯一 `(operation_id,idempotency_key)`、`envelope_hash` | status `received|deduped|processing|acked|rejected`；hash 64 hex；索引 `(inbox_status,received_at)`、`operation_id`、`idempotency_key` | 事务内先验 envelope/fence 再去重；重复投递标记 deduped，不重新产生 domain side effect |
| `task_attempt`（internal） | `attempt_id`、`job_id`、`attempt_no`、`lease_token`、`lease_expiry`、`deadline`、`worker_ref`、`started_at`、`finished_at`、`attempt_status`、`error_code`、`envelope_hash`；attempt/lease/deadline 回指 runtime envelope | `PK(attempt_id)`；`job_id → outbox_job.job_id`；唯一 `(job_id,attempt_no)`；lease token 仅内部 synthetic opaque 值 | attempt `>=1`；`now < lease_expiry <= deadline <= now+900`；status `leased|succeeded|retryable_failed|terminal_failed|expired|stale_epoch`；索引 `(job_id,attempt_no)`、`(attempt_status,lease_expiry)` | 租约获得和完成均 CAS；过期/旧 token 完成返回 conflict，不更新业务状态 |
| `dead_letter`（internal） | `dead_letter_id`、`job_id`、`task_envelope`、`attempt_count`、`error_code`、`error_detail_redacted`、`first_failed_at`、`dead_lettered_at`、`recovery_status`、`recovery_operation_id`、`created_at`；Envelope pointer + internal reason fields | `PK(dead_letter_id)`；`job_id → outbox_job.job_id`；唯一 `(job_id,dead_lettered_at)` | attempt `>=1`；recovery `pending|replayed|discarded`；禁止原文、secret、私人标识；索引 `(recovery_status,dead_lettered_at)`、`job_id` | max attempts 后同事务写 dead-letter、CAS Outbox=`dead_letter`；人工恢复要新 operation/idempotency key，并重验三门五 fence |
| `source_observation`（internal-only） | `internal-contract.schema.json#/$defs/SourceObservation/properties/{field}`：17 个字段 `observation_id, unique_key, owner_ref, source_id, external_id, observed_at, discovered_at, published_at, cursor_ref, response_hash, error_class, source_config_epoch, source_safety_epoch, operation_id, idempotency_key, payload_hash, internal_only` | `PK(observation_id)`；`unique_key UNIQUE`；业务唯一 `(source_id,external_id)`；`source_id → source_config_fixture.source_id` | error class enum；epoch `>=1`；hash 64 hex；`internal_only=1`；索引 `(source_id,observed_at)`、`(error_class,observed_at)`、`operation_id` | mock adapter 输出先写 observation；同一 source/external 重复只更新可允许的 observation metadata 或返回已有记录，不进入领域 Content 两次 |
| `audit_event`（internal-only） | `internal-contract.schema.json#/$defs/AuditEvent/properties/{field}`：25 个字段 `event_id, monotonic_seq, occurred_at, clock_status, trace_ref, session_hash, reason_code, owner, operation_id, task_id, source_config_epoch, source_safety_epoch, authorization_version, policy_epoch, recovery_epoch, attempt, payload_hash, fixture_hash, schema_hash, redaction_version, retention, cleanup_after, append_only, internal_only, external_calls` | `PK(event_id)`；`monotonic_seq UNIQUE`；可选 `task_id → task_attempt` 逻辑引用 | 五 epoch `>=1`、attempt `>=1`；`append_only=1`、`internal_only=1`、`external_calls=0`；索引 `(monotonic_seq)`、`(operation_id,occurred_at)`、`reason_code`、`cleanup_after` | 只能 INSERT；同一事务分配递增 seq；不存 token/原文/private identifier；cleanup_after 由 synthetic retention policy 控制 |
| `migration_ledger`（internal） | `migration_id`、`version`、`checksum`、`applied_at`、`status`、`contract_version`、`error_code` | `PK(migration_id)`；`version UNIQUE` | status `applied|rolled_back|failed`；checksum 64 hex；索引 version/status | append-only migration receipt；版本或 checksum 漂移 fail closed |
| `schema_fingerprint`（internal） | `fingerprint_id`、`contract_version`、`artifact_hashes_json`、`manifest_sha256`、`canonical_rule_version`、`recorded_at`、`source` | `PK(fingerprint_id)`；`(contract_version,manifest_sha256) UNIQUE` | canonical rule const `canonical-json-v1`；hash map 只能覆盖冻结 11 artifacts；索引 `(contract_version,recorded_at)` | 记录已接受合同快照，不修改冻结 manifest；新合同须新版本和新任务 |
| `seed_ledger`（internal） | `seed_id`、`layer_id`、`source_artifact`、`source_artifact_sha256`、`selection`、`row_count`、`subset_hash`、`writes_to_base`、`loaded_at`、`fixture_profile` | `PK(seed_id)`；`(layer_id,source_artifact_sha256,selection,subset_hash) UNIQUE` | row_count `>=0`；`writes_to_base=0`、fixture profile `M4-local-fixture-v0`；索引 layer/loaded_at | 载荷和 subset 证据；不以 seed ledger 作为业务实体或真值 |

`SnapshotReconciliation` 的 `job_id` 可指向独立 snapshot outbox job；stale-epoch 与 snapshot-failure fixture 不能共享 job/idempotency/operation。任何 repository 为 polymorphic aggregate 做的逻辑 FK 检查须在事务内执行，并在失败时写 redacted AuditEvent。

## 4. 迁移顺序与 schema fingerprint 门禁

迁移文件采用只追加、单向编号；每个版本在 `BEGIN IMMEDIATE` 下完成，失败回滚当前事务，已应用版本不重写：

| 顺序 | migration 内容 | 前置/后置校验 | 失败出口 |
|---|---|---|---|
| `0001_runtime_ledger` | PRAGMA foreign_keys=ON、WAL、`synchronous=FULL`、`busy_timeout`、`migration_ledger`、`schema_fingerprint`、`seed_ledger` | 打开 DB 后读取 `user_version`；比较 11/11 artifact SHA 和 canonical-json-v1 | checksum/contract 漂移立即停止；不创建领域表 |
| `0002_source_capture` | `source_config_fixture`、`captured_item`、Source/CapturedItem 外键、有效 canonical URL partial unique index | 逐列比对 Source 39、CapturedItem 16 required；验证 VS-0 bridge hash/59 disabled | schema mismatch 或 seed default 漂移 rollback |
| `0003_content_event_summary_media` | `content_item`、`event`、`summary`、`media_candidate` 及 FK/index | Content hash input、Event member array、Summary input hash 可重建 | FK/unique/hash/validator 失败 rollback；不写 Outbox |
| `0004_release_review_publication` | `release_bundle`、`review_decision`、`publication`、`published_projection` | strict release snapshot、approved hash、immutable/one-publicity invariant | payload/hash/fence/approval mismatch rollback |
| `0005_outbox_inbox_attempt_deadletter` | `outbox_job`、`inbox`、`task_attempt`、`dead_letter`；TaskEnvelope JSON 校验 | 逐字段映射 Outbox 20 + runtime envelope required；idempotency/operation uniqueness | stale/missing lease/deadline/duplicate key fail closed |
| `0006_internal_observation_audit` | `source_observation`、`audit_event` | internal contract required 17/25；`(source_id,external_id)`、audit monotonic seq | internal field/retention/hash mismatch rollback；禁止 domain insert |
| `0007_indexes_cas_triggers` | 只增加合同已有列上的索引、有限 CAS helper/triggers；不增加领域字段 | `PRAGMA foreign_key_check`、索引唯一性、const/status 触发器静态检查 | 任一 trigger 误写 projection/Base 时停止迁移 |
| `0008_fixture_seed_receipts` | 按三层 seed 写 `seed_ledger` 与 fixture rows；不写真实连接 | counts/subset hash/file SHA、external_calls=0、writes_to_base=0 | 任一 hash/count/default 不符，整批 rollback，保留 last-known-good |

每次启动/迁移的 fingerprint 步骤：

1. 只读读取合同目录 `manifest.json` 的 `artifact_hashes`、`contract_version`、`canonical_json_rule`，计算 manifest 自身 SHA；不运行 generator，不修改合同目录。
2. 将 11/11 map 与 `schema_fingerprint` 最近 accepted row 做精确比较；缺少 row、版本不等、hash 不等、canonical rule 不是 `canonical-json-v1` 均 fail closed。
3. 校验 `state_machine_count=6`、`idempotency_key_count=5`、`invariant_count=9`、`max_task_window_seconds=900`、M3 59×33、VS-0 59×39/e7a8、fixture counts/subset hashes；通过后才允许 `user_version` 前进。
4. migration 在同一事务写 `migration_ledger` 和 `schema_fingerprint` receipt；`artifact_hashes_json` 使用 canonical-json-v1，写入后复读比对。
5. contract 未来变更必须建立新合同版本/任务/迁移。旧版本继续可读，禁止原位更新 fingerprint 或用新 hash 覆盖旧 receipt。
6. 中途异常执行 rollback；若 crash 后事务已回滚，reopen 后重新从旧 `user_version` preflight。若 seed 已有 ledger 且四元组相同，按幂等跳过；部分或 hash 不同的 seed 不覆盖旧 row。

## 5. 事务、CAS、幂等与 fence

### 5.1 连接和通用事务模板

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 1500;
BEGIN IMMEDIATE;
-- validate schema, canonical JSON, idempotency, fence and current epoch
SAVEPOINT operation;
-- INSERT/UPDATE with explicit expected status and expected epoch
-- require sqlite3_changes() = 1 for every CAS transition
RELEASE operation;
COMMIT;
```

`busy_timeout` 仅允许有限 `lock_contention` 重试；每次重试重新读取当前 row/fence，不复用旧 lease 或旧 epoch。validator 失败、唯一/FK/JSON/hash/CAS 失败都 `ROLLBACK`；错误码写入 redacted AuditEvent（若审计写入本身失败，事务整体失败）。

### 5.2 mock 采集 happy path

1. fixture provider 读取 `M4-local-fixture-v0`；重新断言 `external_calls=0`、synthetic scheme、M3 row disabled、无凭证/真实 URL。读取 Source 时记录当前 `source_config_epoch`、`source_safety_epoch`。
2. mock adapter 输出 `SourceObservation`；先按 `(source_id,external_id)` 查询/插入 internal observation。重复 observation 返回同一 internal identity；不直接创建第二 Content。
3. 创建 Inbox receipt，校验 TaskEnvelope 全部 required 字段、`envelope_hash`、idempotency/reconcile key 和五 fence。相同 `(operation_id,idempotency_key)` 只产生一个可执行 job。
4. `captured_item` 通过 schema validator；仅 `normalization_status=valid` 且 `dedup_status=unique` 时写入 Content。Content version hash 对合同指定 `content_hash_input` 重算；重复 hash 命中既有 row。
5. 按 `dedup_fingerprint` CAS 写 Event；canonical Event 已存在时只追加未出现的 member。需要 Summary 时写 `Summary(summary_status=draft|ready)`，并验证 `input_content_hash`。
6. 所有业务写入和 Outbox intent 在同一 `BEGIN IMMEDIATE` 提交；Outbox 的 operation_id 从原始 TaskEnvelope 贯通。任何一步失败均不留下孤立 Content/Event/Outbox。

### 5.3 Source activation 原子事务

```sql
BEGIN IMMEDIATE;
SELECT * FROM source_config_fixture
 WHERE source_id = :source_id
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
-- priority platform > authorization > adapter determines blocked_* if a gate fails
-- operation_id and idempotency_key are precomputed once
UPDATE source_config_fixture
   SET enabled = 1,
       collection_onboarding_status = 'queued',
       onboarding_operation_id = :operation_id,
       updated_at = :now
 WHERE source_id = :source_id
   AND collection_onboarding_status = 'activation_pending'
   AND source_config_epoch = :source_config_epoch;
-- require changes() = 1
INSERT INTO outbox_job (... operation_id, operation_type, aggregate_type,
                         aggregate_id, idempotency_key, current_source_config_epoch,
                         job_status, task_envelope, ...)
VALUES (... :operation_id, 'source_activation', 'source', :source_id,
        :idempotency_key, :source_config_epoch, 'pending', :task_envelope, ...);
-- require one unique outbox row and append AuditEvent
COMMIT;
```

三门（platform/authorization/adapter）、canonical/normalization/dedup、stop 和五 fence 任一失败都阻断，不写 `enabled=true`。`paused` 只属于 `lifecycle_status`；queued/collecting 的 stop/cancel、normalization_failed/dedup_needs_review 恢复、dead_letter 人工恢复都必须重新执行三门/五 fence。

### 5.4 Lease、执行和恢复

Worker 从 `outbox_job(job_status='pending'|'retryable_failed')` 取一行，生成新 attempt 和 lease token，在同一事务 CAS：

```sql
UPDATE outbox_job
   SET job_status='leased', attempt=attempt+1, updated_at=:now
 WHERE job_id=:job_id
   AND job_status IN ('pending','retryable_failed')
   AND current_source_config_epoch=:current_epoch
   AND attempt < max_attempts;
```

必须证明 `now < lease_expiry <= deadline <= now + 900`，Envelope 中 `task_id`、`operation_id`、`payload_hash`、五个 epoch、lease token/expiry、deadline、attempt、idempotency_key、reconcile_key 全存在且非零 epoch。完成/失败时 `WHERE job_id=? AND lease_token=? AND attempt=? AND current_source_config_epoch=?`，`changes()=1` 才算成功。旧 token、过期 lease、旧 epoch、stop/cancel 或 stale task 均返回冲突并保持当前状态。

重试按 outbox state machine 递增 attempt；超过 `max_attempts` 在同一事务写 `dead_letter` 并 CAS `job_status='dead_letter'`。人工恢复创建新 `recovery_operation_id`，不复用失败 envelope；重新通过三门、stop、五 fence 和 idempotency 检查后才能入队。`reconcile_wait` 保留 Publication identity/reconcile_key，snapshot partial/empty/stale 只保留 last-known-good。

### 5.5 五类幂等键

| 合同 pointer | key 输入 | 物理唯一/贯通 | 重放行为 |
|---|---|---|---|
| `state-machine.json#/idempotency_keys/source_activation` | `source_id,onboarding_operation_id,operation_id` | Source `onboarding_operation_id`、TaskEnvelope、Outbox exact same operation/key | 返回原 activation/outbox；不能第二次 enabled transition |
| `.../content_ingest` | `platform,source_id,external_content_id,content_version_hash` | Content `(source_id,external_content_id,content_version_hash)` | 返回既有 Content；不重复 observation side effect |
| `.../dedup` | `dedup_fingerprint` | Event `dedup_fingerprint` | 返回 canonical Event，member 只追加一次 |
| `.../publication` | `release_bundle_id,approved_bundle_hash,publication_id,idempotency_key,reconcile_key` | Publication/Outbox/Envelope exact same keys；Bundle/hash unique | 保留唯一 public_id/generation；重试只更新同一 Publication |
| `.../snapshot_sync` | `source_config_epoch,snapshot_manifest_hash` | snapshot Outbox operation/key | partial/empty/stale 保留 LKG，不能覆盖 manifest |

## 6. Fixture 映射、seed 与 fingerprint

### 6.1 三层 seed

| layer | source artifact / SHA | selection/count | subset hash | 允许写入 |
|---|---|---|---|---|
| `m3-shadow-seed` | `data/m3-base-shadow-import-v0/main-source-record-batch.json` / `e73b8d6b8a9b1a018dc7d30c90bfe3111b10caeb6fee28486edf27f176a05de5` | 59 rows × 33 fields；`enabled_false_count=59` | layer hash `9a179c3272e146a7eededde911634a2dae982fd77204a08cb2df283750860cf2` | `source_config_fixture` only；`writes_to_base=false` |
| `synthetic-case-seed` | `fixtures.synthetic.json` / `e56122c0d99761df2e48bfed817c45e0e184d10130ea5bfce89e1d1be56f4abf` | 22 cases；Source18/Capture8/Content7/Event2/Summary7/Media5/Bundle5/Review5/Publications5/Outbox11/Projection3 | published projection `3fd27686268958435d9ed57dc606a688759bf84d22ac1aaeec992cd35590c3fc`；snapshot `726be94727d77534b534447f04d38542f442061644fc0d6572fd8ad0a3e01150` | local synthetic tables only |
| `synthetic-case-seed` internal subset | `internal-fixtures.synthetic.json` / `6fa873675732a06e440d8d67923647a9938d264b1162a485d3abf02ef33f86d8` | SourceObservation2 + AuditEvent3 = 5 | `33a88ea7bb2872d3b800fa577555115d8c5a62b5958e56f518f66dce24fd8785` | `source_observation`/`audit_event` only |
| `security-error-seed` | `security-fixtures.synthetic.json` / `66ace7a1e1800d740f75b35fd55234c7417b9acae7ef1c0a32757eec3051db22` | 16 security cases | layer hash `875d6e9a519d588784fd57821b2de2ca58fc59c70a94783d478b4cb45a0276f9` | deny/fail-closed tests；不落业务真值 |

Published projection、snapshot failure 和 internal records 都是 synthetic-case 的子集，不能增加第四/第五顶层 seed，也不能覆盖 M3。每个 subset 同时记录 `source_artifact`、`source_artifact_sha256`、`selection`、`count`、`subset_hash`；internal file SHA 不与 subset hash 混用。

### 6.2 Fixture case 到链路步骤

| case kind（`fixtures.synthetic.json#/cases/*/kind`） | 注入表/步骤 | 预期出口 |
|---|---|---|
| `source_seed`、`source_state` | Source seed/状态 CAS | 59 shadow 保持 disabled；状态机 transition 可验证 |
| `capture_normalization` | CapturedItem → normalization | valid 继续；invalid/needs_review 不生成 Content |
| `duplicate_ingest` | SourceObservation + Inbox + Content | unique `(source_id,external_id)` 和 content version hash 去重 |
| `idempotent_retry`、`queue_retry`、`collection_retry` | Outbox/TaskAttempt | 同 key/operation 复用，CAS 失败不重复副作用 |
| `stale_review` | ReleaseBundle/ReviewDecision | approved hash/fence 不匹配，旧审核失效 |
| `publish_retry`、`reconcile_wait`、`reconcile_outcome` | Publication/Outbox/Projection | 保留 public identity；reconcile 状态按四 outcome |
| `stale_epoch` | Envelope/TaskAttempt/Source epoch | fail closed；不写 provider/Content/Publication |
| `snapshot_failure` | 独立 snapshot job + SnapshotReconciliation | partial/empty/stale 保留 last-known-good |
| `published_happy_path` | Content→Summary→Bundle→Review→Publication→Projection | synthetic published projection；external_calls=0 |
| `adapter_gate`、`authorization_gate`、`platform_gate`、`blocked_recovery` | Source activation | 按 platform > authorization > adapter 产生 blocked 状态；恢复重验三门五 fence |
| `stop_resume` | Source stop/cancel/paused | stop/cancel 阻断；paused 仅 lifecycle_status |

具体 fixture IDs、input_refs、expected 和 hash 以 `fixtures.synthetic.json` 当前 bytes 为准；本文不复制 payload，防止报告成为第二 fixture。`ActivationTransaction` 仅是 fixture receipt，不能创建 `activation_transaction` 领域表。

### 6.3 Fingerprint 更新步骤

1. fixture provider 读取当前冻结 JSON bytes，先计算每个 source artifact file SHA，再以 canonical-json-v1 对选择对象排序/序列化，得到 subset hash；顺序、selection、count 与 `seed-layers.json` 精确比较。
2. `schema_fingerprint` 保存合同版本、11/11 artifact map、manifest SHA、canonical rule、记录时间和 `source=accepted-contract`; `seed_ledger` 保存 layer/subset 四元组、`writes_to_base=false` 和 fixture profile。
3. 只有所有 JSON pointer、counts、hash、`external_calls=0`、M3 59 disabled 和 VS-0 e7a8 通过，才允许在一个事务中导入 fixture；重复四元组幂等跳过。
4. 合同字段/enum/hash 算法需变化时，先由产品/数据新任务接受新 contract version；新增 migration 读取旧版本、写新 fingerprint row，并保留旧 rows。当前任务不允许原位修改 v0.3。
5. fingerprint mismatch、部分 seed、symlink/非 regular fixture、未知字段或写入范围不安全时 fail closed；回滚本批次，保留上一次 last-known-good ledger。

## 7. 失败路径、回滚与安全出口

| 风险/失败 | 检测 | 回滚/状态 | 外部和持久化边界 |
|---|---|---|---|
| 合同 artifact/fingerprint 漂移 | 0001 preflight、manifest 11/11 | 停在旧 `user_version`；不建新表 | `external_calls=0`；不读写 Base |
| JSON/type/enum/const/hash 失败 | schema validator + canonical hash | 当前 SAVEPOINT rollback；写 redacted audit 或整体 rollback | 不产生 domain/outbox side effect |
| FK/unique/dedupe 冲突 | SQLite constraint + repository idempotency lookup | 返回既有 row或 rollback；不吞错 | SourceObservation/Event/Content 不重复 |
| activation gate/stop/fence 失败 | Source 三门、stop、五 fence 查询 | 保持 `activation_pending`/blocked/stopped；不写 enabled | 不创建 activation outbox |
| lease 过期/旧 token/epoch | CAS WHERE + runtime assertion | TaskAttempt expired/stale；Outbox 保持 queued/retryable | 不执行 provider、publish 或 commit |
| outbox lock contention | `busy_timeout` + 有限重试 | 记录 lock_contention；超过预算回滚 | 不扩大重试窗口，不生成第二 job |
| provider mock/fetch 失败 | error class、attempt/max_attempts | retryable_failed→dead_letter；保存 redacted error | 无网络、无真实内容/token |
| audit append 失败 | monotonic seq/retention/hash 校验 | 包含业务变更的事务整体回滚 | 禁止无审计的状态变更 |
| publication 未知结果 | reconcile key/status | `reconcile_wait`，查询后确认；保持同 public_id | no duplicate submit；synthetic only |
| snapshot partial/empty/stale | candidate count/hash/epoch | `SnapshotReconciliation.reconciliation_status='retained'` | last-known-good 不被覆盖 |
| fixture symlink/TOCTOU/安全变量 | regular-file/profile/hash 检查 | reject before transaction | 不访问任意 root、网络或凭证 |

审计记录仅保存 allowlisted hash、reason、operation/task 引用和 owner；`error_detail_redacted` 禁止原文、token、个人标识。安全 fixture 16 cases 都必须 `synthetic_only=true`、`external_calls=0`，不应导入 domain seed。

## 8. 开发实现顺序与验收出口

### 8.1 推荐实现顺序

1. 先实现 connection/migration ledger/fingerprint preflight，再创建 `0002`–`0008`；任何 migration 不绕过合同验证。
2. 实现 schema validator + canonical-json-v1 codec；统一 DTO↔SQLite 转换，object/array 不接受非 canonical bytes。
3. 实现 Source/CapturedItem/Observation/InBox/Outbox repository，再实现 Content/Event/Summary；最后实现 Bundle/Review/Publication/Projection 和 snapshot reconcile。
4. 为每个 CAS 操作提供 `expected_status`、expected epoch、operation/idempotency key；所有重复、旧 epoch、lease conflict 都有 deterministic error code。
5. 只在 `M4-local-fixture-v0` profile 读取三层 synthetic seed；启动时和每次 provider 调用前重复检查 `external_calls=0`、provider=fixture、publish=manual_only。

### 8.2 验收矩阵

| 验收项 | 通过条件 | 本报告状态 |
|---|---|---|
| DDL 字段追溯 | 13 domain defs、internal 17/25、Outbox 20、Source39/Capture16 全列集，逐列有 schema/internal pointer | 已完成蓝图；未执行代码 |
| 约束/索引 | PK/FK/unique/CHECK、state/epoch/attempt/lease/deadline、幂等和审计索引齐全 | 已完成蓝图；未执行代码 |
| migration | 0001–0008 只追加、user_version、11/11 fingerprint gate、失败 rollback | 已完成蓝图；未执行代码 |
| mock 采集链路 | observation→inbox→capture→content→event→outbox，operation id贯通且同事务 | 已定义；未执行 runtime |
| fixture 映射 | 59×33 shadow→59×39/e7a8、59 disabled；22 cases/三层 seed/subset hash 可重现 | 已按冻结收据映射；未重算 bridge |
| 安全边界 | external_calls=0、无 Base/平台/网络/凭证/真实内容、internal 不入 domain | 静态已核对；runtime 未验证 |
| 失败恢复 | stale epoch、lease、stop/cancel、dead-letter、reconcile_wait、snapshot LKG、audit fail 均有回滚出口 | 已完成蓝图；未执行故障测试 |

### 8.3 已验证、未验证与错题自检

已验证（只读）：

- TASK 已正式 claim，当前任务真值为 `claimed`；任务指针与报告路径一致。
- `docs/spec.md`、`docs/progress.md`、冻结 v0.3 manifest/schema/state-machine/runtime/internal/fixture/seed 文件可解析，合同版本、6/5/9/16/4/900、11/11 hashes 和 zero external I/O 证据已读取。
- 当前 schema 的 exact counts 为 Source39、CapturedItem16、Content22、Event10、Summary18、Media12、ReleaseBundle25、ReviewDecision23、Publication30、OutboxJob20、PublishedProjection15、Snapshot7、FixtureCase6；internal 为 SourceObservation17、AuditEvent25、InternalCase5。报告未采用已过时的字段计数。
- `base-mapping.json` 的 M3 33/9 边界、`domain_only_entities`、`internal_only_entities` 和 SummaryDraft alias 已核对；未把 Source/CapturedItem误计入 domain-only，也未把 internal 表写回 Base。
- `seed-layers.json` 的三层、source artifact SHA、subset hash、counts、`writes_to_base=false` 和 published/snapshot/internal 子集边界已核对；snapshot 与 stale 任务按独立 job 语义设计。

未验证（明确留给开发/测试门禁）：

- Node 24 `node:sqlite` 真实 Repository、SQL migration 执行、WAL/crash recovery、lock contention、CAS/lease 和 FK/trigger 实际行为；本报告未运行 app 或 SQLite。
- bridge 59×39 hash 的再次计算、fixture rows 的 DB 导入、JSON Schema validator、canonical bytes 与 subset hash 的 runtime 重算；本报告只引用已 accepted 的 e7a8 收据。
- mock worker 的完整 retry/dead-letter/reconcile/snapshot/stop-resume 动态测试、性能、多进程和网络文件系统行为；生产存储、Base/provider/真实平台继续关闭。

错题自检：

1. **未把 M3 影子行当成可采集真值**：报告明确 59/59 disabled、Source/CapturedItem only、无 Base writeback。
2. **未创建第二领域 schema**：所有 domain columns 回指 `schema.json`；`inbox/task_attempt/dead_letter/migration_ledger/schema_fingerprint/seed_ledger` 显式标 internal infrastructure；SourceObservation/AuditEvent 回指 internal contract。
3. **未漏 operation id 与五 fence**：Source activation、TaskEnvelope、Outbox、Inbox、Attempt 均要求 operation id/idempotency、五 epoch、lease/deadline/attempt；`reconcile_key` 保留在 envelope/outbox/publication。
4. **未把 canonical hash 与 file SHA 混淆**：subset 记录 `source_artifact_sha256` 与 `subset_hash` 两个 scope；`canonical-json-v1` 不误称 JCS；strict ReleaseBundle snapshot 包含 content/summary version hash 及 capture/external/published/captured 字段。
5. **未遗漏 SourceObservation 可空字段和 AuditEvent 字段**：两张 internal 表均按当前 17/25 required fields 列出，唯一键、五 epoch、schema hash、owner、cleanup、append-only 皆在约束中。
6. **未把 stale epoch 与 snapshot failure 共用一份任务身份**：snapshot outbox job 必须独立，stale case 只检验 envelope epoch，snapshot case 只检验 LKG 保留。
7. **未把失败测试写成成功能力**：所有 runtime、真实 SQLite、provider、Base 和外连仍标为未验证/关闭；本报告不宣称 VS-1 已实现。

## 9. 交付状态

唯一交付物为本文。开发部可按第 3–8 节实现 VS-1 mock 采集链路；实现遇到合同字段、enum、hash、状态或安全边界缺口时，应暂停并创建新的数据合同任务，不能在 app 或 migration 中自行扩展领域字段。本文完成后按任务脚本提交 artifact、verified/unverified、错题自检和 `TASK_STATE_OK`；doctor 结果以任务真值为准。
