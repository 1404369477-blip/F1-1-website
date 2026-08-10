---
task_id: TASK-20260809-8F382B
department: 数据部
status: final
decision: pass
summary: 只读核对59x39 Source、VS1表、三套本地profile与Admin双主机合同后，冻结source-management-synthetic独立写profile、59条不可变基线与仅新增local synthetic行的确定性union、公开库全程只读的唯一数据落点；未修改app、data、migration、数据库或accepted合同。
external_calls: 0
writes_to_base: false
database_writes: 0
---

# SOURCE-MGMT-001 SQLite/profile/mutation successor 数据合同

## 1. 结论与唯一推荐

唯一推荐拓扑为新增独立的 `source-management-synthetic` 本地写 profile。其候选 SQLite 路径固定为：

```text
app/.local/f1plus1-source-management-synthetic.sqlite
```

该 profile 只属于 `admin-host` / loopback local-dev Admin 进程，承载 `/admin/sources` 的 local synthetic Source、同步 validation command、activation Outbox、lease/attempt、dead-letter、operation receipt 和追加式审计。它不得被公开进程选择，也不得出现在 `public-host`。

59 条 M3 Source 继续只由冻结的 59×39 canonical projection 表达：

```text
data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json
file SHA-256 = d4da9fc24c792c0471bcd24c525a46dcef1e521b36a870fd111e7310243888b2
canonical projection root = e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17
row count = 59
field count = 39
enabled=false count = 59
```

新 profile 不 seed、复制、覆盖或批量物化这 59 行。启动时以受 pin 的只读文件读取基线；SQLite 只保存 `source_id` 不存在于基线的 local synthetic Source。59 条基线永久 `allowed_actions=[]`，任何 mutation 在进入写事务前返回 `403 ADMIN_M3_SHADOW_DENIED`。有效 Source 视图使用确定性 union 规则：

```text
effective_set =
  frozen 59x39 baseline rows, byte/field semantics unchanged
  union source_config_fixture local synthetic rows

guard = every local source_id and canonical_url is absent from baseline identity index
```

这条规则给每个 `source_id` 恰好一个当前值。基线始终不可变，local synthetic 行有显式 lineage，删除用 stop/retire 表达。系统不创建第二份 59 行真值，也不把 mutation 反写 M3、Base 或任何公开库。

## 2. 现有 profile 能否安全共存

结论分两层：

1. 同一代码库、同一磁盘和同一主机可以保存多个物理隔离的 profile 文件。
2. 同一进程、同一请求链和同一 SQLite handle 只能选择一个 profile。

现行实现已固定：

- `m3-shadow` → `.local/f1plus1.sqlite`
- `public-synthetic` → `.local/f1plus1-public-synthetic.sqlite`
- `public-multimedia-synthetic` → `.local/f1plus1-public-multimedia-synthetic.sqlite`
- `app/src/server/db/profile.ts` 拒绝 path/profile ledger 混用和 SQLite `ATTACH`。
- `app/src/server/config/env.ts` 的 allowlist 当前只有上述三个值。
- `app/src/server/db/source.ts` 明确只允许 `m3-shadow` seed/assert，并要求 59 条均为 `enabled=false`。

因此，现有 `m3-shadow` 和 `public-multimedia-synthetic` 可以作为冻结文件共存；Admin source mutation 进程不得同时打开它们，也不得将 public profile 升为可写。后继开发只能在现有 selector 上追加第四个 closed value，禁止复制环境解析器、默认回落到其他 profile、第二 handle、`ATTACH`、跨 profile SQL、跨 profile copy 或共享 WAL。

双主机映射保持：

```text
admin-host
  source-management-synthetic SQLite   唯一写者
  frozen 59x39 projection file         只读、hash pin
  public profile files                  不打开

public-host / public process
  public-synthetic 或 public-multimedia-synthetic read model
  source-management SQLite              不存在、不可达
  Admin mutation credential             0
```

Source mutation 不直接改变 PublishedProjection。未来公开发布仍从 Admin 主库形成经批准的 Projection，再按 accepted 双主机合同单向生成不可变公开快照；公开副本不反向同步，也不充当 Source 真值或恢复源。

`source-management-synthetic` 在 SOURCE 本地纵切期间就是该进程唯一打开、唯一可写的 Admin SQLite。它不得与 `review-synthetic` 或任何其他可写 Admin profile 并发。进入 accepted 双主机整合时，Source 表和 mutation migration 必须并入同一 `admin/master.sqlite` selector，或由单一 Admin-master successor 原子取代本 profile；禁止保留两个并行写库。public 进程若需要打开公开 SQLite，必须使用 `mode=ro`、适用时 `immutable=1`、`PRAGMA query_only=ON`、只读 OS 身份、无 WAL/SHM，并在启动时执行写失败探针；更小的生产形态是只消费原子激活的不可变公开投影。

## 3. 冻结输入与只读事实

| 输入 | 当前只读事实 |
| --- | --- |
| Source domain | `data/mvp-contract-v0/schema.json#/$defs/Source`，39 required fields；schema SHA-256 `de6c6c07a33589106ebb93496ad10ae3b06ab1c7845e4e0e91888ca0b17ae5a4` |
| M3→Source mapping | 33 direct + 6 derived；`source_safety_epoch` 为 direct；added_at 使用午夜日历日期投影；59 行按 `source_id` Unicode code point 升序 |
| M3 closed DB | `app/.local/f1plus1.sqlite`，当前 SHA-256 `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0`；closed receipt 记录 WAL/SHM absent、59 Source、公开域 0 |
| public-synthetic DB | 当前 SHA-256 `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041`；closed receipt 记录 12 Projection，Source 1 |
| public-multimedia DB | 当前文件 SHA-256 `eb2d7ad2787a290f7a13adcb063215d58654bc9f66d1d8ff60b98f14592b9551`；本任务未打开 SQLite handle，仅作文件 hash 观察 |
| VS1 SQL | `app/migrations/vs1/0001..0006` 共 6 文件；按相对路径排序后的 `{ordered:[{relative_path,sha256}]}` canonical root 为 `e3928f21a840d9c69ccc1f6dffae7617e84b50e1c7eb88fba8dc86ae2aa33890` |
| runtime profile | 当前 union 只有三个 profile；新 profile 尚未实现 |
| Admin topology | `ADR-M5-ADMIN-DUAL-HOST-001`：Admin 唯一写主、public 可重建只读投影、Admin→public 单向、禁止共享/双写 SQLite |
| SOURCE-MGMT 产品候选 | `docs/spec/F1+1-SOURCE-MGMT-001本地synthetic信源管理纵切实现合同-v0.1.md`，SHA-256 `0d1bbcabeef2fbb68041f889486b6f654dff462ace69181a1cb7d1c9348cc6de`；状态 proposed，本任务的数据候选用于关闭其 profile decision，不将 proposed 外推为 accepted |

VS1 六个 SQL 文件当前分别为：

| 文件 | SHA-256 |
| --- | --- |
| `0001_runtime_source_outbox.sql` | `dc235534c492b9c763f63e2752bd4d78cc4f05ecf8e3600a3a906c3d0aae029b` |
| `0002_runtime_delivery.sql` | `3c96d4be93ebbc3dcc56bbb1780bec7f65c76f9c9ae1a7a391d3895d10f5c748` |
| `0003_observation_capture.sql` | `f1014f95dea2d556ea632493448b6db98350b89baea55f018a1975c9baec7460` |
| `0004_content_event.sql` | `276e31b466eda82ec5076307f4bab62b37b1ef496146e555edbae5f7a6408696` |
| `0005_summary_bundle_guards.sql` | `f5a8e18f1d437cdca18990d27d15be06c12b08efda771e12f903600bb7bc9a6a` |
| `0006_audit_receipt.sql` | `c27b9c0274605db15ad91462f6752637ae35c54b7632920718229f06dda7c17e` |

上述 VS1 DDL 是实施证据和复用输入。它的 `source` 表只有少量列加 `payload_json`，不能替代 39 字段 Source persistence；`outbox_job.operation_type` 当前只允许 `source_activation`，`dead_letter` 当前每 job 只允许一行，均需由本 successor 的 profile-scoped 追加 migration 精确收口，不能原位改历史 SQL。

## 4. 39 字段逐项 persistence / DTO 映射

后继 profile 复用现有 `app/migrations/0002_source_fixture.sql` 创建的 `source_config_fixture` 39 列，但该表在新 profile 中只保存 local synthetic Source，初始行数为 0。任何 local 行都必须含完整 39 字段，禁止 partial JSON patch 落库；任何 baseline `source_id` 都禁止插入。

API read DTO 固定包含 `source` 对象，且该对象的键集合逐字等于 `Source.required`；内部 read-model 字段放在同级 `meta`，不进入 Source schema。

| # | Source 字段 | SQLite / API 唯一映射与约束 |
| ---: | --- | --- |
| 1 | `source_id` | `source_config_fixture.source_id` / `source.source_id`；PK；先对 effective set 查重 |
| 2 | `platform` | 同名 / 同名；`x,instagram,reddit,website,rss` |
| 3 | `platform_account_id` | 同名 / 同名；nullable；synthetic 不填真实账号 ID |
| 4 | `handle` | 同名 / 同名；1–255 |
| 5 | `raw_url` | baseline 从冻结 artifact 只读；local row 仅允许 `https://synthetic.invalid/...`；不触发请求 |
| 6 | `canonical_url` | baseline 从冻结 artifact 只读；local row 对 baseline+local effective set 做 canonical unique |
| 7 | `canonical_url_valid` | INTEGER 0/1 ↔ boolean |
| 8 | `normalizer_version` | 同名 / 同名；validation receipt 固定算法版本 |
| 9 | `normalization_status` | 同名 / 同名；`pending,valid,invalid,needs_review` |
| 10 | `dedup_status` | 同名 / 同名；`pending,unique,linked_existing,needs_review` |
| 11 | `entity_type` | 同名 / 同名；沿用 Source enum |
| 12 | `content_focus` | 同名 / 同名；沿用 Source enum |
| 13 | `priority` | 同名 / 同名；`high,medium,low` |
| 14 | `verification_status` | 同名 / 同名；`pending,confirmed,rejected` |
| 15 | `identity_status` | 同名 / 同名；初始 `unknown` |
| 16 | `relevance_status` | 同名 / 同名；初始 `unknown` |
| 17 | `monitorability` | 同名 / 同名；初始 `unknown` |
| 18 | `adapter_status` | 同名 / 同名；初始 `unchecked` |
| 19 | `adapter_authorization_status` | 同名 / 同名；初始 `unknown` |
| 20 | `platform_allowed` | 同名 / 同名；初始 `unknown`；不得凭 UI 推定 allowed |
| 21 | `authorization_checked_at` | 同名 / 同名；nullable RFC3339 UTC |
| 22 | `authorization_expires_at` | 同名 / 同名；nullable RFC3339 UTC |
| 23 | `collection_onboarding_status` | 同名 / 同名；沿用 16 个 canonical states |
| 24 | `onboarding_operation_id` | 同名 / 同名；validation 时保持 null；activation 事务写唯一 operation ID |
| 25 | `lifecycle_status` | 同名 / 同名；`proposed,active,paused,retired`；paused 只在此字段 |
| 26 | `enabled` | INTEGER 0/1 ↔ boolean；初始 false；只在 activation 事务变 true |
| 27 | `manual_disable_at` | 同名 / 同名；stop/retire 写 UTC instant，其余 nullable |
| 28 | `source_stop_status` | 同名 / 同名；`clear,manual,compliance,authorization,platform` |
| 29 | `source_safety_epoch` | 同名 / 同名；integer≥1；stop/fence transaction 单调递增 |
| 30 | `source_config_epoch` | 同名 / 同名；integer≥1；配置变更单调递增 |
| 31 | `added_at` | 同名 / 同名；`YYYY-MM-DD`；历史 M3 午夜运输值保持日历日期语义 |
| 32 | `evidence_url` | baseline 从冻结 artifact 只读；local row 固定 synthetic evidence URL；不访问 |
| 33 | `notes` | 同名 / 同名；≤4096；禁止 token/秘密/真实私密正文 |
| 34 | `migration_batch_id` | baseline 原值只读；local 新增用固定 successor 批次 |
| 35 | `change_reason` | 同名 / 同名；每次 full overlay 更新当前原因，历史原因进 AuditEvent |
| 36 | `created_at` | baseline 原值只读；local 新增使用事务固定 UTC clock |
| 37 | `updated_at` | 同名 / 同名；mutation commit UTC clock |
| 38 | `created_by_ref` | 同名 / 同名；synthetic/local actor ref |
| 39 | `updated_by_ref` | 同名 / 同名；synthetic/local actor ref |

`meta` 只允许以下 data-owned 派生：

```text
sourceHash                 SHA-256(canonical-json-v1(source exact 39 keys))
sourceVersion              monotonic integer from source_overlay_lineage
origin                     m3_baseline | local_synthetic
baselineRowHash            64-hex | null
lastCollectedAt            successful SourceObservation.observed_at max | null
lastCollectedState         known | unknown
allowedActions             derived from canonical state/gates/fences; not persisted as Source
```

`lastCollectedAt` 只读 `SourceObservation.internal_only=true AND error_class='none'`。主排序为 `observed_at DESC`；同一 instant 用 `discovered_at DESC`，再用 `observation_id` BINARY/Unicode code point 升序稳定选择 trace。`published_at` 不参与该值；没有成功观察时返回 `null/unknown`。该字段不写 Source、M3 或 Base。

## 5. 最小 profile-scoped migration 草案

后继开发必须新建 profile-scoped 追加 migration，历史 `0001/0002`、VS1 SQL、public migrations 不改字节。建议 selector 顺序固定为：

```text
app/migrations/0001_local_foundation.sql
app/migrations/0002_source_fixture.sql
app/migrations/profiles/source-management-synthetic/0003_source_management_runtime.sql
```

`0003` 只创建以下内部表；它们不增加领域实体：

### 5.1 `fixture_profile_ledger`（复用现行 profile ledger 语义）

唯一一行 `profile_id=source-management-synthetic`，至少固定：canonical DB path、contract/mapping/fixture version、59×39 baseline file/hash/root、Source schema hash、ordered migration selector root、schema fingerprint、validator hash、row-count contract、`synthetic_only=1, external_calls=0, writes_to_base=0, real_content_imported=0`。静态 pin 不随 mutation 覆盖。

### 5.2 `source_overlay_lineage`

```text
source_id                 PK, FK source_config_fixture
origin                    CHECK origin='local_synthetic'
baseline_projection_hash  64-hex
source_version             INTEGER >=1
effective_source_hash      64-hex UNIQUE
first_operation_id         UNIQUE
last_operation_id          UNIQUE
created_at / updated_at
```

约束：`source_id/canonical_url` 必须不在 frozen baseline identity index。每个 mutation 写完整 39 字段 local row、新 version/hash 和 lineage，不能只改 lineage。baseline 行没有 lineage、没有 overlay、没有 mutation action。

### 5.3 `source_runtime_fence`

```text
source_id                 PK
authorization_version     INTEGER >=1
policy_epoch              INTEGER >=1
recovery_epoch            INTEGER >=1
updated_at / updated_by_ref
```

`source_config_epoch/source_safety_epoch` 仍属于 Source。三项 runtime fence 保持 internal；二者组合形成五 fence，避免给 Source 增加第 40 列。首次 materialize overlay 时五项均必须存在。

### 5.4 `operation_receipt`

```text
command_operation_id      PK
command_idempotency_key   UNIQUE
method                    POST
exact_path                closed route
canonical_body_hash       64-hex
operation_type            source_add|source_validate|source_activate|source_stop|source_retire|source_requeue
source_id
expected_source_hash      64-hex nullable
expected_source_version   INTEGER nullable
expected five fences      five INTEGER columns
operation_status          pending|succeeded|failed
business_operation_id     nullable
business_idempotency_key  nullable
outbox_job_id             nullable FK outbox_job
result_hash               64-hex nullable
reason_code               closed enum nullable
created_at / completed_at
```

command 幂等 scope 固定为 `{command_operation_id,method,exact_path,canonical_body_hash}`。same scope/body 返回原 receipt；同 command operation 异 path/body 固定冲突。`conflict/stale/rejected` 只进入 HTTP/reason_code，不形成第二 operation status。首次 activate 创建并引用 business operation/key；requeue 创建新的 command receipt，同时复用原 business operation/key/Outbox。响应只在 transaction commit 后返回。

### 5.5 `outbox_job` / `inbox` / `task_attempt`

复用 VS1 表的 identity、TaskEnvelope、payload hash、lease/deadline、attempt 与 unique keys。Source 管理唯一 Outbox operation type 为既有 `source_activation`；Add/Validate/Stop/Retire 不创建 Outbox 或 TaskEnvelope。每个 activation TaskEnvelope 必填：`task_id,operation_id,aggregate_type=source,aggregate_id,payload_hash,source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,lease_token,lease_expiry,deadline,attempt,idempotency_key,reconcile_key`。

关键约束：

- `(business_operation_id,operation_type)` UNIQUE；`business_idempotency_key` UNIQUE。
- `task_id`、`lease_token` 全局唯一。
- `outbox_due_idx(job_status,next_attempt_at,job_id)`。
- lease 取得前 Source 不能进入 `collecting`。
- activation transaction 逐字复用同一 `operation_id` 到 Source、Outbox、TaskEnvelope。

DDL 级约束固定为：

| 表 | PK / FK | UNIQUE / CHECK | 必要索引与原子条件 |
| --- | --- | --- | --- |
| `outbox_job` | `job_id` PK；`aggregate_id→source_config_fixture.source_id` | `idempotency_key`；`(business_operation_id,operation_type)`；status 闭集；attempt 0..3；five fence≥1 | `(job_status,next_attempt_at,job_id)`；fresh lease CAS 同时检查 pending/retryable、next_attempt、stop 与 five fence |
| `inbox` | `inbox_id` PK；`job_id→outbox_job` | `(business_operation_id,business_idempotency_key)`；`envelope_hash`；status=`received|processing|acked|rejected` | settlement transaction 同时更新 inbox、attempt、outbox、Source/Audit；禁止 split commit |
| `task_attempt` | `attempt_id` PK；`job_id→outbox_job` | `(job_id,retry_generation,attempt_no)`；`lease_token` 全局唯一；attempt 1..3；expiry<deadline；`deadline-created_at≤MAX_TASK_WINDOW_SECONDS` | `(attempt_status,lease_expiry)`；worker completion CAS 必须匹配 lease token、未过期 deadline 与 five fence |
| `source_runtime_fence` | `source_id` PK/FK `source_config_fixture` | 三 epoch≥1 | fence read/update 与 Source row mutation同事务 |

`MAX_TASK_WINDOW_SECONDS` 必须是 finite manifest 常量并由 validator 断言；不能只留文字承诺。

### 5.6 `dead_letter`

保留原 `job_id/business_operation_id/reason/attempt/external_calls=0`，追加 `retry_generation INTEGER>=0`，唯一键改为 `(job_id,retry_generation)`。人工 requeue 使用新的 command identity，同时保留原 job/business operation/business idempotency identity，递增 generation、重新检查三门/停止状态/五 fence，并创建 fresh lease；旧 dead-letter 行追加保留。validation retry 走同步 `/validate`，activation dead-letter 走 `/requeue`，不注册模糊 `/retry`。

### 5.7 `audit_event`

复用唯一 internal-only AuditEvent，对象列逐字覆盖 `internal-contract.schema.json#/$defs/AuditEvent` 的 25 个 required：`event_id,monotonic_seq,occurred_at,clock_status,trace_ref,session_hash,reason_code,owner,operation_id,task_id,source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch,attempt,payload_hash,fixture_hash,schema_hash,redaction_version,retention,cleanup_after,append_only,internal_only,external_calls`。`additionalProperties=false`。若实现 hash chain，`previous_event_hash/event_hash` 只能是 storage-only 列，不进入 AuditEvent 对象；before/after Source hash/version 只进入版本化 operation receipt/result storage。禁止 UPDATE/DELETE trigger；审计内容脱敏，不存凭证、真实平台正文或私密身份。

## 6. mutation 事务合同

所有 mutation 使用单 writer + `BEGIN IMMEDIATE`，固定 `busy_timeout` 和有限 `lock_contention` 重试。HTTP GET 零写；transaction 内禁止网络、provider、Base、文件替换和公开 DB 访问。

### 6.1 新增 synthetic Source

1. 校验 session/Origin/CSRF 的结果由 API 层提供；数据层仍校验 closed DTO、request hash 和 idempotency。
2. 读取并 pin 59×39 baseline；对 effective `source_id/canonical_url` 查重。
3. 生成完整 39 字段 Source：`validating,pending,pending,unknown/unchecked,proposed,enabled=false,stop=clear`；五 fence 初始均为 1。
4. 同一 transaction 插入 `source_config_fixture`、lineage、runtime fence、`source_add` command receipt 和一条 AuditEvent。
5. `onboarding_operation_id` 保持 null；validation/activation/collection Outbox、TaskEnvelope、provider call 均为 0。
6. commit 后返回 202；重放返回同一 Source/command receipt。

### 6.2 显式 validate

Validate 是显式同步、no-egress、deterministic command，不创建 table/job/queue/Outbox/TaskEnvelope。单一 `BEGIN IMMEDIATE` 以 expected source hash/version + five-fence CAS，读取 pinned synthetic normalizer、baseline identity index 和 local mock capability registry；规范化有效且 dedup unique 时进入 `activation_pending`，失败进入 `normalization_failed/dedup_needs_review/linked_existing`，三门失败按固定优先级进入唯一 blocked state。任何 Source 字段变化都使 `source_config_epoch+1`，`source_safety_epoch` 不变；同事务写 `source_validate` receipt 与一条 AuditEvent。`enabled` 不变，provider call=0。validation retry 使用新的 command identity重复调用本 route。

### 6.3 activate

允许 `activation_pending/queue_failed/stopped/cancelled` 的精确恢复入口，并要求 `canonical_url_valid=true, normalization=valid, dedup=unique, platform=allowed, authorization=valid, adapter=ready, source_stop_status=clear` 以及五 fence 精确匹配。首次/cancelled activation 创建新 business identity；queue_failed/stopped 恢复复用原 onboarding business identity/key/Outbox。单 transaction：

```text
Source.enabled=true
Source.collection_onboarding_status=queued
Source.lifecycle_status=active
Source.onboarding_operation_id=:business_operation_id
Source.source_config_epoch += 1
sourceVersion += 1
write exactly one source_activation Outbox/TaskEnvelope
write one source_activate command receipt
append one AuditEvent
```

任一步失败整体回滚。worker 获得 fresh lease 后，重验三门/停止状态/五 fence，才允许 `queued→collecting`。

### 6.4 stop / retire

stop 只允许 queued/collecting/active，并固定写 `collection_onboarding_status=stopped`、`enabled=false`、非 clear `source_stop_status`、manual 时写 `manual_disable_at`、`source_config_epoch+1`、`source_safety_epoch+1`、source version/hash、`source_stop` receipt 与 AuditEvent；同时把未结 job 标为 cancelled/stale，旧 lease 因 Source safety/config fence 提升而失效。`cancelled` 只由其 canonical 独立入口产生，stop 不二选一猜状态。

retire 是独立 `source_retire` lane，仅允许 `lifecycle_status=active`、onboarding=`stopped|cancelled`、`enabled=false`、stop 非 clear且 five fence current；同事务写 `lifecycle_status=retired`、config/safety epoch 各+1、source version/hash、receipt 和 AuditEvent，保留 Source、lineage、operation、Outbox、attempt/dead-letter 历史。物理 DELETE 禁止。

### 6.5 dead-letter requeue

只接受当前 canonical dead_letter。使用新 command identity写 `source_requeue` receipt，同时保留 original job/business operation/business idempotency identity，`retry_generation+1`，attempt 从新 generation 的 1 开始，重新验证三门、stop、source hash/version 与五 fence。验证不通过时保持 dead-letter，零新业务事实。validation 失败使用同步 `/validate` 路径，不能由服务端猜 lane。

## 7. CAS、hash 与 ledger

### 7.1 canonical Source hash

```text
source_hash = SHA-256(UTF8(canonical-json-v1(source object with exact 39 required keys)))
```

任何 mutation 的 SQL CAS 必须同时绑定：`source_id, source_version, source_hash, source_config_epoch, source_safety_epoch, authorization_version, policy_epoch, recovery_epoch`。影响行数不等于 1 即整笔 rollback，返回 stale/conflict；只允许读回已存在的 command receipt，不新增 Source、Outbox、TaskEnvelope 或 AuditEvent。

### 7.2 effective Source root

```text
effective_rows = frozen baseline 59 rows原样 union local synthetic rows，按 source_id Unicode code point 升序
effective_root = SHA-256(UTF8(canonical-json-v1({
  fields: Source.required,
  baseline_projection_hash: e7a831...9f17,
  rows: effective_rows
})))
```

该 root 是 source-management profile 的当前逻辑读根。它不覆盖基线 `e7a831…9f17`，也不写回 frozen manifest。任何 baseline 行变化都先触发 `ADMIN_M3_SHADOW_DENIED`，不能靠更新 effective root 吸收。

### 7.3 mutation/audit root

AuditEvent storage 可使用 `previous_event_hash` 串联；`event_hash` 对不含自身的 storage core 计算，两列不进入 canonical AuditEvent 对象。in-DB ledger 只固定 static profile ledger root、effective root、last audit hash/sequence、local synthetic count、pending job count、schema fingerprint、migration selector root、validator hash和 DB logical root。唯一 handle checkpoint/close 后，外部 closed receipt 才记录 DB file SHA；该 SHA 绝不回写同一 DB，避免自哈希循环。

### 7.4 ready validator

ready 前机械检查：

- baseline file regular/single-link/owner/private、59×39、59 disabled、file hash 与 e7a8 projection root；
- Source required keys 恰好 39，local synthetic 每行完整、enum/type/format/unique 合法；
- baseline 59行只读、local synthetic source_id/canonical_url 不在 baseline、effective unique 与 effective root；
- profile/path/ledger/migration root/schema fingerprint 精确匹配；
- `PRAGMA foreign_keys=ON`、`journal_mode=WAL`、`synchronous=FULL`、`integrity_check`、`foreign_key_check`；
- 单 writer，database_list 只有 main/temp，第二 handle/ATTACH/cross-profile query/copy 失败；
- Outbox/Envelope/attempt/lease/five-fence/receipt/dead-letter generation/AuditEvent 全部闭合；
- public profile 文件 SHA 与精确任务 evidence/receipt pins 无漂移；source-management 进程不打开 public DB；public process 使用 mode=ro/query_only、只读 OS 身份、无 WAL/SHM，写失败探针必须失败，且无 mutation route/credential；
- `external_calls=0,writes_to_base=false,real_content=0,provider_switch=false`。

## 8. WAL/SHM、迁移和回退

- 运行时 WAL/SHM 只属于 source-management DB 的私有目录；mode 600、目录 700、同 owner、拒绝 symlink/hardlink/未知 sidecar。
- 备份/closed receipt 先停止新 mutation，执行受控 checkpoint，关闭唯一 handle，再对 DB 计算 SHA；不得把运行中的 DB/WAL/SHM 分别复制后宣称一致备份。
- migration 只追加，按 ordered path+SHA 计算 selector root；未知、缺号、重号、hash drift 或 schema fingerprint mismatch 均在写前失败。
- migration transaction 失败保持旧 `user_version` 和旧 ready DB；不得运行 down migration。
- 候选初始化失败时，只能移走或删除已机械证明归属 `source-management-synthetic` 的候选文件；三个旧 profile 字节保持不变。
- mutation 失败 rollback 当前 transaction；恢复时读同 operation receipt。禁止自动切换到 m3/public profile，禁止复制 59 行“修复”。

## 9. 失败注入矩阵

| 注入 | 必须结果 |
| --- | --- |
| baseline file/hash/root/59×39 任一漂移 | ready=false，DB 与 HTTP mutation 不开放 |
| local source_id 或 canonical_url 与 frozen baseline 冲突 | transaction rollback，Source/job/audit 业务增量 0 |
| 对任一 baseline source_id 发起 mutation | 写事务前 `403 ADMIN_M3_SHADOW_DENIED`；baseline/file/root/count与local DB均零变化 |
| same idempotency key + different request hash | 固定 conflict，读取原 receipt，零写 |
| source hash/version 或任一 fence stale | CAS 影响 0 行，整笔 rollback，旧 lease 不生效 |
| 三门同时失败 | 按 `platform > authorization > adapter` 唯一阻断状态 |
| activation Outbox insert 失败 | enabled/queued/operation/audit 全部 rollback |
| worker lease 过期、伪造或重复 | 不进入 collecting，不改 Source；记录拒绝收据 |
| 第 3 次有界失败 | 同一 job/operation/key 进入 dead_letter；保留 attempts |
| dead-letter requeue gate/fence 失败 | 保持旧 dead-letter，零新业务事实 |
| stop 与 worker completion 竞争 | stop 提升 fence；旧 completion stale，不能回写 active |
| SQLite busy/磁盘满/crash | 有限重试后失败；事务原子；重启按 receipt/audit 对账 |
| public profile/path 被选为 mutation target | 启动拒绝；public bytes、WAL/SHM、Projection 不变 |
| second handle/ATTACH/cross-profile query/copy | fail closed |
| Base/provider/network/真实 URL 请求尝试 | capability disabled；external_calls 保持 0 |
| audit UPDATE/DELETE | trigger 拒绝，业务 transaction rollback |

## 10. 后继开发的精确输入

1. 在现有单一 env/profile selector 中追加 `source-management-synthetic`；旧三个分支与默认值逐字兼容。
2. 实现唯一 DB path、profile-scoped `0003`、ordered migration root和 schema fingerprint，不改历史 migration。
3. 实现 frozen baseline reader + sparse overlay repository；禁止把 59 行 seed 到新 DB。
4. API GET 从 effective set 返回 exact 39-key Source + closed `meta`；filter/sort/page 均以同 snapshot effective root 为 scope；baseline `allowed_actions=[]`。
5. 实现 `source_add/source_validate/source_activate/source_stop/source_retire/source_requeue` 六条明确 mutation lane；Add/Validate Outbox与TaskEnvelope=0，只有 Activate 创建或复用 `source_activation`；禁用模糊 retry。
6. 所有写走单 writer、BEGIN IMMEDIATE、idempotency receipt、source hash/version CAS 与 five-fence。
7. 复用/升级 VS1 Outbox、Inbox、Attempt、DeadLetter、AuditEvent internal persistence；不增加领域实体。
8. source management 进程从不打开 public DB；public 进程无 Admin route、主库路径或 mutation credential。
9. 提供 generator/validator/manifest/closed receipt，连续两次干净初始化与全失败矩阵同根；旧三 profile hashes 零漂移。
10. 真正 App、migration 或 DB 写入必须另领开发任务；本报告不授权实施或生产部署。

## 11. P0 / P1 / P2 与未决点

### P0

`0`。在只读合同层未发现 accepted Spec、A→D、VS1 与双主机拓扑之间需要破坏旧 profile、复制 59 行或让 public DB 可写的冲突。

### P1

`0`（本数据合同范围）。拓扑、39 字段、lineage、mutation identity、five-fence、Outbox、dead-letter generation、audit、hash、migration 与回退均有唯一落点。

现有 App 尚不支持该 profile，VS1 历史 DDL也尚未包含完整 39 字段 persistence、command/business identity 分域和可追加的 dead-letter generation；这些是后继开发必做输入，不能据此宣称 SOURCE-MGMT-001 已实现。

### P2

`0`。source-management runtime 不依赖猜测 public receipt 文件名；它不打开 public DB。零漂移验证只接受任务明确给出的 evidence/receipt 路径、版本、DB SHA、receipt SHA 与签发任务 pin，缺任一项即 fail closed。

### accepted 合同未决点

无。`ADR-SOURCE-001` 的真实 Base 业务真值和 provider 切换仍是独立用户门禁；本 successor 明确标为 non-authoritative local synthetic，不执行 A/D 切换，因此不需要统筹或产品新增拓扑决策。

## 12. 已验证、未验证与错题自检

### 已验证

- 只读核对 Source 39 required fields、33/6 M3 enrichment、59 行/59 disabled/e7a8 root。
- 只读核对 `0001/0002`、VS1 六表 migration、`source.ts`、`profile.ts` 与 runtime env profile union。
- 只读核对三个当前 SQLite 文件 SHA；对 M3/public-synthetic 使用现有 closed receipt，没有打开数据库。
- 只读核对 accepted M4、A→D、VS1 successor、Admin 双主机 ADR/实施合同及公开 profile 隔离规则。
- 机械复算 VS1 六文件逐文件 SHA 和 ordered canonical root。
- `git diff --check` 仅针对本报告；确认 `app/`、`data/`、migration、DB、Spec、ADR 均无本任务写入。

### 未验证

- 未实现或运行 `source-management-synthetic` profile、migration、repository、API、worker、validator、closed receipt或 UI。
- 未打开 public-multimedia SQLite，未核对其逻辑 counts/schema/ledger；只计算文件 SHA。
- 未运行真实 session/Origin/CSRF、Mac/iPhone、私有网络、双主机、备份/RPO/RTO 或生产部署。
- 未调用 Base、provider、Collector、真实 URL、网络或任何外部能力。

### 错题自检

- 没有把 59 条基线复制或覆盖进新 DB；local synthetic 表初始为 0 行，baseline mutation 全部 403。
- 没有把 `source_config_fixture`、effective root 或 local synthetic profile写成 Base 业务真值。
- 没有把 current VS1 `source.payload_json` 当作 39 字段 Source 合同。
- 没有把 `authorization_version/policy_epoch/recovery_epoch` 塞入 Source 形成第 40–42 字段。
- 没有让 public DB 承载 mutation、Admin 凭据、主库或反向同步。
- 没有把 validation retry 与 dead-letter requeue 合成模糊 route。
- 没有在 stop/重试中创建第二 operation/key 或接受 stale lease。
- 没有修改 frozen data、App、migration、SQLite、Spec 或 accepted ADR。

最终结论：`PASS / P0=0 / P1=0 / P2=0`。
