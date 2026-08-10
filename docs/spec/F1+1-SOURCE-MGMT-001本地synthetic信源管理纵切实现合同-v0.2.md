---
title: F1+1 SOURCE-MGMT-001 本地 synthetic 信源管理纵切实现合同 v0.2
type: product_implementation_contract_successor
status: proposed
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-68918B
function_id: SOURCE-MGMT-001
implementation_state: pending_implementation
profile_decision: acknowledged
external_calls: 0
production_authorized: false
immutability: append_only_successor_required
---

# F1+1 SOURCE-MGMT-001 本地 synthetic 信源管理纵切实现合同 v0.2

## 0. Canonical 入口与证据 pin

本文件是 `SOURCE-MGMT-001` 当前唯一开发输入，状态保持 `proposed`。实现、设计、安全和测试不得从 v0.1 或数据报告中选择另一套字段、状态、operation、Outbox 或恢复语义。

本任务完成后，本文件按当前 SHA 视为不可变；任何实质修订必须新建 v0.3 successor 并保留本文件字节，不得原地改写。

本 successor 固定引用：

| 证据 | 状态 | SHA-256 | 用途 |
|---|---|---|---|
| `TASK-20260809-936D79` 产品 v0.1 | acknowledged | `0d1bbcabeef2fbb68041f889486b6f654dff462ace69181a1cb7d1c9348cc6de` | 历史需求、接口和状态收敛证据 |
| `TASK-20260809-8F382B` 数据报告 | acknowledged | `4498eea95e8d2461bd3c4bbb1e3ff67de2247a65c0da99951a194b2b9e9d3d95` | profile、39 字段 persistence、单 writer、baseline 引用和机器约束 |

v0.1 保持原字节并退出当前实施入口；其“数据候选仍待确认”和冲突处置段只属于历史审计。数据报告作为 ACK 证据，不是第二开发入口。若任一 pin 漂移，启动和开发验收均失败关闭。

当前事实：

- profile 决策已经关闭；唯一 profile 是 `source-management-synthetic`。
- `SOURCE-MGMT-001` 仍为 `P1-blocker`，因为 App、页面、视觉、安全复验和独立测试尚未完成。
- 本合同不授权真实设备、真实 URL、provider、Base、平台请求、AI、媒体、发布、public-host 切换或部署。

## 1. 唯一范围与用户出口

### 1.1 用户入口

- 页面：loopback local-dev `GET /admin/sources`。
- 用户可查看冻结的 59 条禁用 Source、按 platform/lifecycle/enabled/onboarding 筛选、打开详情、复制纯文本 URL、查看最近本地 mock receipt。
- 用户可新增一条 local synthetic Source，并显式执行 validate、activate、stop、retire、validation retry 和 dead-letter requeue。
- 页面不得注册真实外链；URL 只作为文本，不产生 DNS、HTTP、预取或图片请求。
- 公开 `/`、`/stories/*` 及其 Repository/profile/DTO/hash 不受影响。

### 1.2 持续关闭

- 冻结 59 条 baseline 的任何 mutation、复制、覆盖、提升、删除或反写。
- 真实平台 URL/账号/provider/adapter、RSS、Base、飞书表单、AI、真实媒体、发布、部署、付费和外发。
- 非 loopback listener、LAN/overlay/公网 Admin、跨 profile query、第二 SQLite handle、`ATTACH`、跨库事务、双写和第二 writer。
- 批量 mutation、自动 validation/activation、物理 DELETE、模糊 retry、UI 自造状态或字段。

## 2. 唯一 profile、writer 与 Source 视图

### 2.1 Profile

```text
profile_id = source-management-synthetic
candidate_db_path = app/.local/f1plus1-source-management-synthetic.sqlite
writer_count = 1
sqlite_handle_per_process = 1
external_calls = 0
writes_to_base = false
```

同一进程只打开该 SQLite。进程不得打开 m3/public SQLite，不得执行 `ATTACH`、跨 profile query/copy 或共享 WAL。public process 不拥有该 DB 路径、Admin route 或 mutation credential。

### 2.2 冻结 baseline

```text
artifact = data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json
file_sha256 = d4da9fc24c792c0471bcd24c525a46dcef1e521b36a870fd111e7310243888b2
canonical_projection_root = e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17
row_count = 59
field_count = 39
enabled_false_count = 59
```

baseline 由受 pin 的本地只读 artifact/manifest 提供。新 SQLite 初始 local Source 行数为 0；不 seed、不复制、不稀疏覆盖 baseline 行。任何 baseline `source_id` 的 mutation 在写事务前返回 `403 ADMIN_M3_SHADOW_DENIED`，baseline file/root/count 和 local DB 均零变化。

### 2.3 Effective set

```text
effective_set = frozen_baseline_59 UNION local_synthetic_rows
order = source_id Unicode code point ascending
guard = every local source_id and canonical_url absent from baseline identity index
```

同一 `source_id` 恰好一个当前值。local synthetic Source 以完整 39 字段落库；禁止 JSON patch、`payload_json` 第二 schema、baseline override 或 UI fallback。

### 2.4 未来唯一 Admin master 边界

本 profile 当前是 non-authoritative local synthetic 单 writer。未来若并入唯一 Admin master，必须另有 accepted 数据迁移/生产部署合同，证明旧 writer 已 fence、writer count 始终为 1、完整 hash/ledger 可迁移和 public 仍为只读投影。本合同不执行合并、同步、双写、自动提升或生产切换。

## 3. Source 唯一字段与状态

### 3.1 Source 39 字段

API `source` 与 SQLite canonical persistence 的键集合必须逐字等于：

```text
source_id
platform
platform_account_id
handle
raw_url
canonical_url
canonical_url_valid
normalizer_version
normalization_status
dedup_status
entity_type
content_focus
priority
verification_status
identity_status
relevance_status
monitorability
adapter_status
adapter_authorization_status
platform_allowed
authorization_checked_at
authorization_expires_at
collection_onboarding_status
onboarding_operation_id
lifecycle_status
enabled
manual_disable_at
source_stop_status
source_safety_epoch
source_config_epoch
added_at
evidence_url
notes
migration_batch_id
change_reason
created_at
updated_at
created_by_ref
updated_by_ref
```

`additionalProperties=false`。runtime 的 authorization/policy/recovery epoch、source version/hash、baseline row hash、alias、allowed actions、最近 mock receipt 与 operation link 都是 internal/read-model 字段，不进入 Source，不形成第 40 个字段。

### 3.2 Canonical 状态

`collection_onboarding_status` 仅允许 16 个值：

```text
validating | activation_pending | queued | collecting | active |
normalization_failed | dedup_needs_review | linked_existing |
blocked_adapter_missing | blocked_authorization | blocked_platform |
queue_failed | collection_failed | stopped | cancelled | dead_letter
```

`lifecycle_status` 仅允许：

```text
proposed | active | paused | retired
```

状态转换只使用 `data/mvp-contract-v0/state-machine.json` 的 frozen edges。validation 可以在同一事务组合多条既有边，但不能创造直达 transition：

- `validating→normalization_failed|dedup_needs_review|linked_existing|activation_pending`；
- 三门未通过时 `activation_pending→blocked_platform|blocked_authorization|blocked_adapter_missing`；
- 失败态重验先沿既有恢复边回 `validating` 或 `activation_pending`，再按上述闭集结算；
- activate/resume/requeue 只沿各自 frozen edge；lifecycle 已 active 时不重复写 proposed/paused transition。

### 3.3 UI alias

展示 alias 只读计算为 `unknown/restricted/failed/disabled/enqueued/enabled/normalization_pending/dedupe_pending/adapter_check_pending/proposed`；`manual_only` 是 capability badge。alias、badge 和 `allowed_actions` 不回写 Source，不被 mutation 接受。

## 4. Closed Route、DTO 与 operation 分域

### 4.1 Read routes

```text
GET /api/admin/sources
GET /api/admin/sources/{source_id}
GET /api/admin/operations/{command_operation_id}
```

列表 query 仅允许：

```text
platform?
lifecycle_status?
enabled? = true|false
collection_onboarding_status?
cursor?
limit? = 25|50|100
```

cursor 绑定最后 `source_id`、筛选 canonical hash 与 effective root；漂移返回 `409 ADMIN_SOURCE_CURSOR_STALE`。baseline 缺失或 pin/count/root 漂移时整页 503，不能 partial 放行。单条非 Source enrichment 失败可 partial；Source core/schema 失败的行省略并禁用全页 mutation。

### 4.2 Mutation routes

```text
POST /api/admin/sources
POST /api/admin/sources/{source_id}/validate
POST /api/admin/sources/{source_id}/activate
POST /api/admin/sources/{source_id}/stop
POST /api/admin/sources/{source_id}/retire
POST /api/admin/sources/{source_id}/requeue
```

`DELETE /api/admin/sources*` 永不注册并返回 `405 ADMIN_METHOD_DENIED`。`POST .../retry` 永不注册并返回 `404 ADMIN_ROUTE_NOT_FOUND`。

### 4.3 Command envelope

每个 mutation body 都是 canonical-json-v1 exact UTF-8 bytes、`additionalProperties=false`、≤16 KiB，并包含：

```text
CommandIdentity {
  command_operation_id: "op-" + 6..128 lowercase alnum/hyphen,
  command_idempotency_key: base64url opaque with >=128 bits entropy
}

RuntimeFences {
  authorization_version: integer >= 1,
  policy_epoch: integer >= 1,
  recovery_epoch: integer >= 1
}

SourceExpected {
  source_id, updated_at,
  source_config_epoch, source_safety_epoch,
  collection_onboarding_status, lifecycle_status, enabled
}
```

command idempotency scope 为 `{command_operation_id,method,exact_path,canonical_body_hash}`。同 scope/body 返回原 receipt；同 command operation 异 path/body 返回 409。

### 4.4 唯一 command receipt

```text
SourceOperationReceipt {
  schema_version: "admin-source-operation-v0.2",
  command_operation_id,
  operation_type: source_add | source_validate | source_activate |
                  source_stop | source_retire | source_requeue,
  operation_status: pending | succeeded | failed,
  source_id,
  business_operation_id?: string,
  outbox_job_id?: string,
  result: {
    collection_onboarding_status?, lifecycle_status?, enabled?,
    source_config_epoch?, source_safety_epoch?, onboarding_operation_id?
  },
  reason_code?: string,
  updated_at
}
```

conflict/stale/rejected 通过 HTTP + reason code 表达，不新增 receipt status。

### 4.5 Command 与业务 Outbox 唯一分域

| 用户命令 | command receipt | 新建 Outbox/TaskEnvelope | 业务 Outbox type |
|---|---|---:|---|
| add | `source_add` | 0 | 无 |
| validate / validation retry | `source_validate` | 0 | 无 |
| activate / cancelled 后新 activation | `source_activate` | 1 | `source_activation` |
| stop | `source_stop` | 0 | 无；旧 activation job 按 frozen edge 结算/失效 |
| retire | `source_retire` | 0 | 无 |
| dead-letter requeue | `source_requeue` | 0 | 复用原 `source_activation` job/operation/key |

Validation intent 的完整定义只有：command receipt + canonical request hash + Source CAS result + 一条脱敏 AuditEvent。它没有异步 lane、worker、lease、attempt、Outbox 或 TaskEnvelope。

## 5. 六条 mutation 合同

### 5.1 Add

`POST /api/admin/sources` 只接受 `https://synthetic.invalid/...`，拒绝其他 scheme/host、userinfo、fragment、控制字符和超限输入；只做字符串校验，不做 DNS。

```text
source_id = "src-local-" + first24(lowercase-hex(
  SHA-256(UTF8(canonical-json-v1({platform,raw_url})))
))
```

一个 `BEGIN IMMEDIATE` 事务写完整 39 字段 Source、lineage/runtime fences、`source_add` receipt 和一条 AuditEvent。初始 onboarding=`validating`、lifecycle=`proposed`、enabled=false、stop=`clear`、两个 Source epoch=1、onboarding operation=null。Outbox/TaskEnvelope/provider delta=0。baseline identity/canonical URL 冲突时整笔拒绝。

### 5.2 Validate 与 validation retry

`POST .../validate` 是显式同步、deterministic、no-egress command。它读取 pinned normalizer、baseline identity index、local Source set 和 local mock 三门 registry；不创建 table/job/queue/Outbox/TaskEnvelope。

同一事务：

1. 重验 session/Origin/CSRF、command、Source CAS 与五 fence；
2. 规范化、查重并按 `platform > authorization > adapter` 选择唯一门失败状态；
3. 只沿 §3.2 frozen edges 更新 Source；字段变化时 config epoch+1，safety epoch不变；
4. 写 `source_validate` receipt 与一条 AuditEvent。

validation retry 使用新 command identity、新 CSRF 与 fresh SourceExpected 调用同一路由；不得调用 requeue。

### 5.3 Activate

前置必须同时满足 canonical URL valid、normalization valid、dedup unique、platform allowed、authorization valid、adapter ready、stop clear、五 fence current，且 canonical state 为 activation_pending/queue_failed/stopped/cancelled。

- 首次 activation 与 cancelled 后新 activation 创建新的 business operation/key 和唯一 Outbox/TaskEnvelope。
- queue_failed/stopped 恢复保留原 onboarding business operation/key/Outbox，只沿 frozen edge 更新。

同一事务原子提交 Source enabled=true、onboarding=queued、合法 lifecycle、config epoch+1、唯一 `source_activation` Outbox/TaskEnvelope、`source_activate` receipt 和一条 AuditEvent。任一步失败全回滚。worker 取得 fresh lease 后才能 queued→collecting，并在 provider 前后和结果提交前重验 stop/five fence。

### 5.4 Stop

只允许 queued/collecting/active。一个事务写 onboarding=stopped、enabled=false、非 clear stop status、manual 时写 manual_disable_at、config/safety epoch各+1、`source_stop` receipt 和 AuditEvent。旧 lease 因 fence 提升失效；旧结果不得提交。新 command 对已 stopped Source 不重复提升 epoch。

### 5.5 Retire

只允许 lifecycle=active、onboarding=stopped|cancelled、enabled=false、stop非 clear且五 fence current。事务沿 active→retired，config/safety epoch各+1，写 `source_retire` receipt/AuditEvent；Source、lineage、operation、Outbox、attempt和dead-letter历史全部保留。

### 5.6 Dead-letter requeue

只允许 Source=dead_letter 且唯一 matching OutboxJob=dead_letter。使用新 command identity，复用原 job/business operation/business idempotency key，retry_generation+1，重新验证三门、stop、Source hash/version与五 fence；沿 frozen `dead_letter→activation_pending→queued` 与 Outbox `dead_letter→pending`，不新建 Outbox或第二业务事实。验证失败时保留 dead-letter并零业务增量。

## 6. 事务、恢复与 reason code

### 6.1 原子性与 CAS

- 所有写由单 writer + `BEGIN IMMEDIATE` 执行；固定 busy timeout 和有限 lock retry。
- Source CAS 同时绑定 source_id、updated_at/version/hash、两个 Source epoch、三个 runtime epoch、canonical state和enabled。
- 影响行数不等于 1 时整笔 rollback；只允许读回已存在 receipt。
- AuditEvent 写失败使业务事务失败；GET 永远零业务写入。

### 6.2 Response loss

- commit 后连接丢失时 UI 显示“结果待确认”，先 GET 同 command operation，再刷新 Source。
- 客户端不得自动换 operation/key或重复 mutation。
- Source command 不使用 Publication 专属 `reconcile_wait`。

### 6.3 Closed reason groups

| HTTP | reason group | 恢复 |
|---:|---|---|
| 400/413/415/422 | JSON/canonical/body/content/input invalid | 保留非敏感表单，修正后新确认 |
| 401/403 | session/peer/Host/Origin/CSRF/baseline/external denied | 回 guard shell或保持只读；不降级 |
| 404/405 | route/source not found、method denied | 刷新；禁止替代身份、DELETE或模糊 retry |
| 409 | idempotency/state/already proposed/cursor/requeue/retire conflict | GET operation/Source，fresh CAS 后重新确认 |
| 412 | fence stale | 刷新 Source/fences，领取新 nonce |
| 503 | profile not ready/no-egress/storage busy | 先查 operation；无结果保持 fail closed |
| 500 | clock/audit/internal failure | 业务 rollback；读取当前状态 |

reason literal 的闭集由实现 mapping/validator 固定；客户端不得按 message 猜状态或恢复动作。

## 7. Session、CSRF、no-egress 与日志

- 继承 local session 合同：host-only HttpOnly SameSite=Strict、absolute TTL 30m、idle TTL 10m、进程重启失效。
- session/CSRF/GET/mutation 只接受一个 canonical loopback origin；拒绝 forwarded headers、authority 歧义与 wildcard CORS。
- mutation 要求一次性 CSRF，TTL 5m；首次 exact consume 后不恢复。
- 每个入口先断言 runtime no-egress ready。DNS、HTTP、TLS、raw socket、代理或外部 subprocess/provider 任一尝试都使请求失败关闭。
- 日志/AuditEvent 只允许固定 reason、脱敏 operation/task ref、five fence、attempt、monotonic sequence、clock/redaction/retention；禁止 Cookie、CSRF、body、完整 URL、真实 ID、stack、SQL、路径和 secret。
- 本合同只适用可信单用户 local-dev；同 UID 恶意进程残余风险不得外推为生产认证。

## 8. 390 / 1440 与无障碍

页面必须真实覆盖 loading、filter-empty、partial、error、conflict、stale、blocked、dead-letter、active、stopped 和 response-unknown。baseline pin 失败显示 profile/root error，不显示正常 empty。

### 390×844

- 卡片行显示 handle/platform、canonical 主状态、enabled、最近 mock receipt 和一个主动作。
- 筛选、详情、新增和危险确认使用 full-screen Drawer/Dialog；触控目标≥44×44，安全区不遮挡操作，无页面横滚。
- focus trap/return、Escape、键盘和触控都汇入单 action controller；重复触发不得发第二请求。

### 1440×900

- 语义 table + Detail Drawer；默认列覆盖 handle/URL、platform、lifecycle、enabled、onboarding、normalization、dedup、三门、最近 mock、updated_at和actions。
- `aria-sort`、row action和Drawer action共用状态控制器；表格可局部横滚，页面本身不横滚。

### 共用

- 状态以文字+图标/形状表达，unknown 显示“未核验”并禁用 mutation。
- pending/success/error/unknown 使用 `aria-live`；200% zoom、forced-colors、reduced-motion和读屏名称必须独立验证。
- 设计 successor 必须绑定 390/1440、深/浅主题的不可变 snapshot/hash；用户视觉确认前不得把 UI 写成完成。

## 9. Mandatory golden

| ID | 机械出口 |
|---|---|
| `SRC-V2-BASELINE-01` | 59×39、59 disabled、e7a8 root；baseline mutation全403；artifact/local/public零漂移 |
| `SRC-V2-PROFILE-02` | 单进程只开 source-management DB；第二handle/ATTACH/cross-profile/public写入均失败 |
| `SRC-V2-ADD-03` | Source+1、validating、enabled=false；Outbox/TaskEnvelope/provider=0 |
| `SRC-V2-VALIDATE-04` | 同步 canonical结果；Outbox/TaskEnvelope=0；三门优先级唯一 |
| `SRC-V2-ACTIVATE-05` | Source enabled+queued与唯一 source_activation Outbox/TaskEnvelope同事务 |
| `SRC-V2-LEASE-06` | fresh lease才collecting；stop/fence stale时provider=0且旧结果不提交 |
| `SRC-V2-STOP-07` | stopped、enabled=false、config/safety epoch各+1；历史保留 |
| `SRC-V2-RETIRE-08` | 仅合法前置 active→retired；DELETE 405；历史保留 |
| `SRC-V2-VALIDATION-RETRY-09` | 新 command调用validate；无job/outbox；同command重放同receipt |
| `SRC-V2-DEAD-REQUEUE-10` | 同business operation/key/Outbox，retry generation增加，第二业务事实=0 |
| `SRC-V2-IDENTITY-11` | 六个source_* command receipt闭集；Outbox只允许source_activation |
| `SRC-V2-RESPONSE-12` | 断线后GET operation得到唯一事实；不换key盲重试 |
| `SRC-V2-SECURITY-13` | Host/Origin/session/CSRF/no-egress攻击矩阵零业务写入；日志敏感命中=0 |
| `SRC-V2-UI-390-14` | 状态、Drawer/Dialog、44px、focus、单action、无横滚通过 |
| `SRC-V2-UI-1440-15` | table/Drawer、键盘、全部状态、深浅/zoom/forced-colors/AT通过 |
| `SRC-V2-PUBLIC-16` | public profile/db/Repository/API/App hash前后相同；公开用户结果不变 |

任一项为 TODO/SKIPPED/NOT_RUN、设计未冻结、用户视觉门未满足或安全/测试 P0/P1 未清零，`SOURCE-MGMT-001` 继续为 `P1-blocker`。

## 10. 唯一部门交接

### 数据/开发输入

数据 ACK 已关闭 profile、39 字段、baseline reference、operation/Outbox分域和机器约束。开发只按本 v0.2 实现：

1. 在现有 profile selector 增加 `source-management-synthetic`，不复制 selector、不开第二 handle。
2. 使用 profile-scoped append-only migration；历史 migration 字节不改。
3. 实现 frozen artifact reader + local full-row repository + effective-set pagination；baseline mutation全部403。
4. 实现六条 command lane；add/validate Outbox=0，activate 创建或复用唯一 source_activation。
5. 复用既有 Outbox/Inbox/Attempt/DeadLetter/AuditEvent internal persistence，不新增领域实体。
6. 输出 generator/validator/manifest/closed receipt；连续两次干净初始化同根，旧 profile hashes零漂移。

### 设计

冻结 `/admin/sources` 390/1440 深浅 snapshot/hash，覆盖 §8 全状态、六操作和危险确认。alias只读、baseline无动作、URL不可点击、retry 文案不混用。

### 安全

复验 exact Host/Origin/authority、session/CSRF、canonical JSON、CAS/idempotency、five fence、stop失效、dead-letter identity、日志脱敏、single profile/no-egress与同UID边界。

### 测试

绑定同一 app/data/design/profile hash执行 §9 全部 golden；验证39字段、16/4状态、六command、唯一Outbox type、并发/断线/rollback、390/1440和public零漂移。

## 11. 回退与当前结论

- migration/profile初始化失败：关闭该 profile，保留最后可证明收据；不切到m3/public，不复制59行，不运行down migration。
- transaction/API/state无法一一映射：整笔rollback并退回产品/数据合同；不加字段、状态、实体或模糊route。
- 设计、安全、测试失败：保持功能关闭，保留证据链；不把局部通过外推为完成。
- 任何真实URL/provider/Base/外联/生产需求：拒绝并进入独立用户授权流程。

结论：profile与数据合同已ACK，产品实施语义已经统一；v0.2 是唯一开发入口。`SOURCE-MGMT-001` 当前仍为 `P1-blocker`，externalCalls=0，真实外部与生产能力持续关闭。
