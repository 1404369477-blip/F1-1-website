---
title: F1+1 SOURCE-MGMT-001 本地 synthetic 信源管理纵切实现合同 v0.1
type: product_implementation_contract
status: proposed
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-936D79
function_id: SOURCE-MGMT-001
implementation_state: pending_data_profile_candidate_ack
external_calls: 0
production_authorized: false
---

# F1+1 SOURCE-MGMT-001 本地 synthetic 信源管理纵切实现合同 v0.1

## 0. 决策摘要

本合同只关闭 `/admin/sources` 本地 synthetic 纵切的产品、接口、状态、恢复和交接语义，状态保持 `proposed`。当前未授权修改 app、data、accepted ADR、设计资产或真实资源。

纵切必须满足：

1. 用户可查看冻结的 59 条禁用信源基线及其 39 个 canonical Source 字段；基线保持只读，`row_count=59`、`enabled=false=59`、sorted projection hash=`e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`。
2. 用户可新增一条 `synthetic.invalid` Source，显式执行 validate、activate、stop、retire，并分别到达 validation retry 与 dead-letter requeue。
3. `activate` 只有在规范化有效、查重唯一、三门通过、stop clear 和五 fence fresh 时，才原子形成 `enabled=true + collection_onboarding_status=queued + 唯一 source activation Outbox/TaskEnvelope`。
4. 物理 DELETE 永远不可达；停用与退出使用有审计的 `stop`、`retire`，历史 Source、operation、Outbox 和 AuditEvent 保留。
5. 页面 alias、按钮文案、筛选项和展示状态都不是第二 canonical enum；所有 mutation 重新读取 Source canonical 状态。
6. provider/adapter 只允许 fixture/mock；真实 URL 新增、真实平台调用、Base、AI、媒体、发布、部署和非 loopback I/O 全部关闭。

## 1. 输入真值与边界

### 1.1 当前权威输入

| 输入 | 采用语义 |
|---|---|
| `data/mvp-contract-v0/schema.json#/$defs/Source` | 唯一 39 字段 Source schema；不另造 Source DTO 真值 |
| `data/mvp-contract-v0/state-machine.json#state_machines/source_onboarding` | 唯一 `collection_onboarding_status` 和 `lifecycle_status` 转换 |
| `data/mvp-contract-v0/runtime-envelope.schema.json` | Source activation Outbox/TaskEnvelope 的五 fence、lease、attempt 与 key 机械合同 |
| `data/m4-vs0-seed-enrichment-v0/` | 59×39 基线、59 disabled、M3 字节保留和 sorted projection receipt |
| `ADR-M4-KICKOFF-001` accepted | loopback local-dev、单进程单 profile/SQLite、fixture-only、manual-only、no-egress 与五 fence |
| VS1 accepted/v0.2 及 ACK 运行链 | 同一 operation/key、TaskEnvelope、Outbox、lease、retry/dead-letter、V-OP 与 `externalCalls=0` |
| 安全部 Source Admin 候选 | local session、exact Host/Origin、一次性 CSRF、canonical JSON、幂等、零写入与 reason code |
| 设计部 M4 C 层交接 | `/admin/sources` 组件、alias、390/1440、键盘、焦点和状态表达 |

### 1.2 持续关闭

- M3 shadow/Base 写入、真实 provider/adapter、真实平台账号和请求、RSS、外部 AI、真实媒体、表单、发布、public-host 切换、部署、付费和外发。
- LAN、overlay、公网 Admin、非 loopback listener、跨 profile query、ATTACH、跨库事务、双写、把 public DB 提升为 Admin 写主。
- 把 59 条基线复制到可写 profile、改写其字段、提升状态、改变排序/hash，或把本地 synthetic Source 反写 Base/M3。
- 批量 add/activate/stop/retry、物理删除、真实 URL 点击、自动 validation/activation、自动发布。

### 1.3 唯一拓扑决策点

当前实现是每进程单 profile/单 SQLite，M3 profile 必须只读，public profiles 不能承载 Admin 写路径；同进程跨库 join 和 ATTACH 均被禁止。因此本合同只保留一个最小候选：

> `PROFILE-SOURCE-MGMT-001`：是否接受数据部 `TASK-20260809-8F382B` 正在收敛的独立可写 `source-management-synthetic` profile——运行时只打开这一 SQLite；从该候选固定的本地只读 artifact/manifest 取得冻结 59 条基线的 hash 和 row identity 引用，不打开 m3/public SQLite、不复制 59 行；只持久化本地 synthetic Source 的稀疏可变覆盖、operation/outbox/audit；保持单 writer，旧 profile 和 public DB 零写入？

在数据部 final 报告通过机器校验并由统筹 ACK 前，该项为 `pending_data_profile_candidate_ack`。设计 successor 可先行；数据可完成同候选机器合同；开发不得创建 profile/migration/API。若该候选被否决，本合同保持 proposed/blocked，不自动回退到 m3-shadow、review-synthetic、public-synthetic 或新增其他 profile。

数据候选报告现有文字在“同步 validation command”与“add 创建 `source_validation` Outbox/TaskEnvelope”之间存在冲突；其 operation receipt 还使用 `create_validate|validate|activate|stop|requeue`，缺少 retire 且与本合同命名不一致。唯一收敛规则如下，数据 final/ACK 必须逐字采用；不保留并行 lane：

| 用户命令 | command receipt `operation_type` | 新建 Outbox/TaskEnvelope | 业务 Outbox `operation_type` |
|---|---|---:|---|
| add | `source_add` | 0 | 无 |
| validate / validation retry | `source_validate` | 0 | 无 |
| activate / cancelled 后新 activation | `source_activate` | 1 | `source_activation` |
| stop | `source_stop` | 0 | 无；只按既有边失效/结算旧 activation Outbox |
| retire | `source_retire` | 0 | 无 |
| dead-letter requeue | `source_requeue` | 0 | 无；复用原 `source_activation` Outbox/operation/key |

本合同所称 **validation intent** 只指 durable command receipt + canonical request hash + Source CAS/AuditEvent；它不是异步 job、Outbox 或 TaskEnvelope。只有 activate 产生新的业务 Outbox/TaskEnvelope。数据候选中所有 `source_validation` Outbox、validation worker/lease/attempt、add 返回 job receipt 的语义必须删除；command receipt 的六个 `source_*` literal 与 Outbox 的 `source_activation` 分域，禁止互相代替。数据部 `TASK-20260809-8F382B` 未完成该修订并获统筹 ACK 前，profile 状态保持 not ready。

## 2. 用户入口与真实出口

### 2.1 页面与导航

- 页面：`GET /admin/sources`。
- 边界：loopback local-dev guard shell；初次 GET 不创建 session、不读取 Source、不做 mutation。
- 页面同源 `POST /api/admin/session` 领取唯一内存 session 后，才调用 Source GET API。
- 页面不注册外部链接。`raw_url`、`canonical_url`、`evidence_url` 只以可复制文本展示；不生成 `<a href>`，不触发 DNS/HTTP。
- 公开 `/`、`/stories/*` 的 Repository、profile、DTO、hash 和浏览器行为均不改变；Admin profile 不服务公开读模型。

### 2.2 主要操作

| 操作 | 用户动作 | 成功出口 | 失败/恢复 |
|---|---|---|---|
| 查看 | 筛选、排序、打开详情 | 59 条基线可分页查看；新增 synthetic Source 出现 | GET 可重试；损坏行 partial 且 mutation disabled |
| 新增 | 填写一个 synthetic Source 并确认 | Source=`validating`、enabled=false；无 job/outbox | 字段错误保留表单；同 operation 对账 |
| Validate | 明确点击“验证” | 同步得到 normalization/dedup/gate 结果与 canonical Source | 使用新的 command operation 重试；不创建 activation/collection job |
| Activate | 明确点击“启用并入队” | 原子 enabled=true、queued、唯一 activation intent | conflict/stale 后刷新当前 Source，重新确认；不盲重试 |
| Stop | 明确危险确认 | stopped、enabled=false、fence 提升、旧任务失效 | response unknown 先查 operation；不得改用 DELETE |
| Retire | Source 已 stop/cancel 且 lifecycle active 后二次确认 | lifecycle retired；历史保留 | 前置不满足为 conflict；先回详情修复 |
| Validation retry | 修复本地 fixture/config 后再次点 Validate | 走 `/validate`，形成新的验证 command receipt | 不调用 `/requeue` 或模糊 `/retry` |
| Dead-letter retry | dead_letter 详情中点击“重新入队” | 复用原 activation business operation/key；重新过全部门与 fence | 非 dead_letter、伪造 identity 或门失败均 409/412 |

## 3. Source 39 字段逐项映射

API `source` 对象逐字使用 snake_case canonical Source 字段，`additionalProperties=false`。字段不得重命名、嵌进 `payload_json` 或拆成第二 schema。

| 字段 | 列表 | 详情 | 写入来源/规则 |
|---|---:|---:|---|
| `source_id` | 是 | 是 | 服务端确定；不可编辑 |
| `platform` | 是 | 是 | add 明确选择 canonical enum；后续只读 |
| `platform_account_id` | 否 | 是 | local synthetic 固定 null |
| `handle` | 是 | 是 | add 输入，trim 后 1–255；后续只读 |
| `raw_url` | 否 | 是 | add 输入；仅 `https://synthetic.invalid/...` |
| `canonical_url` | 是 | 是 | add 时等于 provisional raw_url；validate 原子替换为规范结果 |
| `canonical_url_valid` | 否 | 是 | add=false；validate 写 true/false |
| `normalizer_version` | 否 | 是 | 服务端固定数据 successor 版本 |
| `normalization_status` | 是 | 是 | canonical enum；validate 写入 |
| `dedup_status` | 是 | 是 | canonical enum；validate 写入 |
| `entity_type` | 否 | 是 | add 明确选择 canonical enum |
| `content_focus` | 否 | 是 | add 明确选择 canonical enum |
| `priority` | 否 | 是 | add 明确选择 canonical enum |
| `verification_status` | 否 | 是 | add=`pending`；本纵切不提升 |
| `identity_status` | 否 | 是 | add=`unknown`；不是 activation 前置 |
| `relevance_status` | 否 | 是 | add=`unknown`；不是 activation 前置 |
| `monitorability` | 否 | 是 | add=`unknown`；展示未核验，不伪装正常 |
| `adapter_status` | 是 | 是 | add=`unchecked`；validate 只读本地 mock registry 后写 canonical 值 |
| `adapter_authorization_status` | 是 | 是 | add=`unknown`；仅表示 fixture/mock authorization |
| `platform_allowed` | 是 | 是 | add=`unknown`；仅表示 fixture/mock platform gate |
| `authorization_checked_at` | 否 | 是 | local mock gate check 时间；无真实授权含义 |
| `authorization_expires_at` | 否 | 是 | local mock 可为 null；不能外推真实授权 |
| `collection_onboarding_status` | 是 | 是 | 唯一 source onboarding canonical 状态 |
| `onboarding_operation_id` | 否 | 是 | 首次 activate 后等于唯一 business operation id；requeue 不改 |
| `lifecycle_status` | 是 | 是 | canonical `proposed/active/paused/retired` |
| `enabled` | 是 | 是 | 只有 activate 事务可 false→true；stop 同事务 true→false |
| `manual_disable_at` | 否 | 是 | manual stop 写当前 UTC；否则 null |
| `source_stop_status` | 是 | 是 | add=`clear`；stop 写 canonical 非 clear 值 |
| `source_safety_epoch` | 否 | 是 | add=1；stop/retire 安全失效时递增 |
| `source_config_epoch` | 否 | 是 | add=1；validate/activate/stop/retire 有效变更各递增一次 |
| `added_at` | 否 | 是 | 服务端项目日历日期 |
| `evidence_url` | 否 | 是 | 服务端生成 `synthetic.invalid` evidence URL；只读文本 |
| `notes` | 否 | 是 | add 可选 0–4096；日志不记录全文 |
| `migration_batch_id` | 否 | 是 | 59 基线保留原值；local add 固定 successor batch id |
| `change_reason` | 否 | 是 | add/stop/retire 必填；validate/activate 由固定 reason 写入 |
| `created_at` | 否 | 是 | 服务端 UTC |
| `updated_at` | 是 | 是 | 每次成功事务服务端 UTC；CAS 输入 |
| `created_by_ref` | 否 | 是 | 固定脱敏 local admin ref；不接受客户端提交 |
| `updated_by_ref` | 否 | 是 | 固定脱敏 local admin ref；不接受客户端提交 |

详情可额外返回三个只读视图槽位：`display_alias`、`allowed_actions[]`、`last_local_mock_receipt`。它们由 canonical Source、operation/outbox/audit 映射，不持久化到 Source，不参与 Source schema/hash，也不能被 mutation 接受。

## 4. Canonical 状态、alias 与动作矩阵

### 4.1 Canonical 状态

`collection_onboarding_status` 只允许：

```text
validating | activation_pending | queued | collecting | active |
normalization_failed | dedup_needs_review | linked_existing |
blocked_adapter_missing | blocked_authorization | blocked_platform |
queue_failed | collection_failed | stopped | cancelled | dead_letter
```

`lifecycle_status` 只允许：

```text
proposed | active | paused | retired
```

`paused` 不得写入 onboarding；`unknown` 不得写成 enabled；`manual_only` 是 capability badge，不是领域状态。

### 4.2 Alias 计算优先级

| 优先级 | 条件 | primary alias | 辅助 badge/动作 |
|---:|---|---|---|
| 1 | row/schema/root integrity 不可证明 | `unknown` | 全部 mutation disabled |
| 2 | `blocked_*` | `restricted` | 显示固定门；允许 `/validate` |
| 3 | `normalization_failed/queue_failed/collection_failed/dead_letter` | `failed` | 分别显示 validate、activate 或 requeue，不显示模糊 retry |
| 4 | `stopped/cancelled` 或 lifecycle=`paused/retired` | `disabled` | stopped/cancelled 可按 canonical guard activate；active lifecycle+stopped/cancelled 可 retire |
| 5 | `queued/collecting` | `enqueued` | 可 stop；显示本地 mock receipt |
| 6 | onboarding=`active` 且 enabled=true | `enabled` | 可 stop；另显示 `manual_only` badge |
| 7 | normalization pending/needs_review | `normalization_pending` | 查看/validate |
| 8 | normalization valid 且 dedup pending/needs_review | `dedupe_pending` | 查看/validate |
| 9 | `activation_pending` | `adapter_check_pending` | gate 全绿才显示 activate |
| 10 | 其他 lifecycle=`proposed` | `proposed` | 查看/validate |

设计合同中的 11 个 alias 均须可见：`manual_only` 作为非 primary capability badge 单独覆盖；其他 10 个按表计算。alias 永远不回写 Source。

### 4.3 精确动作可达性

| Canonical state | 可用 mutation |
|---|---|
| `validating` | validate |
| `normalization_failed` | validate |
| `dedup_needs_review` | validate |
| `blocked_adapter_missing/blocked_authorization/blocked_platform` | validate |
| `activation_pending` | activate；gate/fence 不绿时 disabled |
| `queue_failed` | activate，复用现有 onboarding business identity/key |
| `queued/collecting/active` | stop |
| `stopped/cancelled` | activate；若 lifecycle active，另可 retire |
| `dead_letter` | requeue；不得用 validate 或 activate 代替 |
| `linked_existing` | 只读；打开 linked receipt，不创建第二启用事实 |
| lifecycle=`retired` | 只读；无恢复、删除或重新启用出口 |

冻结 59 条 baseline 在任何状态下 `allowed_actions=[]`；所有 mutation 返回 `403 ADMIN_M3_SHADOW_DENIED`，前后 baseline root/hash/count 必须相同。

## 5. Read API 与 closed DTO

所有 response：`Cache-Control: no-store, private`，未知字段拒绝；错误只含 `request_id/reason_code/message`。

### 5.1 列表

```text
GET /api/admin/sources
query allowlist:
  platform? = Source.platform enum
  lifecycle_status? = Source.lifecycle_status enum
  enabled? = true | false
  collection_onboarding_status? = Source.collection_onboarding_status enum
  cursor? = opaque base64url
  limit? = 25 | 50 | 100 (default 25)
```

排序固定为 `source_id` Unicode code point 升序。cursor 绑定最后 `source_id`、筛选 canonical hash 和 profile/root receipt；任一漂移返回 `409 ADMIN_SOURCE_CURSOR_STALE`，不静默重启列表。

```text
SourceListResponse {
  schema_version: "admin-source-v0.1",
  items: SourceListItem[],
  page: { limit, next_cursor?, total_visible },
  integrity: { baseline_row_count:59, baseline_enabled_false_count:59,
               baseline_projection_hash, profile_candidate_status },
  partial: { omitted_count, reason_code? }
}

SourceListItem {
  source: <§3 标为列表=是的 canonical 字段>,
  display_alias,
  capability_badges: ["manual_only"] | [],
  allowed_actions: ActionId[],
  last_local_mock_receipt: LocalMockReceiptSummary | null,
  row_integrity: "valid" | "blocked"
}
```

只有 Source core 完整、root/profile receipt 有效时才返回 action。单条 operation enrichment 失败可 `partial` 并返回 Source core；Source core/schema 失败的行必须省略、计入 `omitted_count`、全页 mutation disabled。基线本身缺失或 hash/count 漂移时整页 503，不能 partial 放行。

### 5.2 详情与 operation 对账

```text
GET /api/admin/sources/{source_id}
GET /api/admin/operations/{operation_id}
```

```text
SourceDetailResponse {
  schema_version: "admin-source-v0.1",
  source: <完整 39 字段 Source>,
  display: { alias, capability_badges, allowed_actions, primary_reason_code? },
  last_local_mock_receipt: LocalMockReceipt | null,
  operation_links: { latest_command_operation_id?, onboarding_operation_id? },
  integrity: { source_schema_valid, baseline_reference_valid, five_fences_current }
}

SourceOperationReceipt {
  schema_version: "admin-source-operation-v0.1",
  operation_id,
  operation_type: source_add | source_validate | source_activate |
                  source_stop | source_retire | source_requeue,
  status: pending | succeeded | failed,
  target: { source_id? },
  result: { collection_onboarding_status?, lifecycle_status?, enabled?,
            source_config_epoch?, source_safety_epoch?,
            onboarding_operation_id?, outbox_job_id?, linked_source_id? },
  reason_code?,
  updated_at
}
```

receipt 从既有 command idempotency record、Source、Outbox/TaskEnvelope 与 AuditEvent 映射，不新增领域实体。source operation 不使用 Publication 专属 `reconcile_wait`。不存在返回 404；事务进行中为 pending；确定失败为 failed；响应丢失后只查询同 operation。

这里的 `SourceOperationReceipt.operation_type` 是用户命令枚举；OutboxJob 只接受本功能唯一业务枚举 `source_activation`。两者是闭合分域，命名相近不表示可互换。

## 6. Mutation envelope 与 closed DTO

所有 body 为 canonical-json-v1 exact UTF-8 bytes、`additionalProperties=false`、≤16 KiB。每次 mutation 都要求有效 session、exact Origin、一次性 CSRF、command 幂等和对象 CAS。

### 6.1 公共类型

```text
RuntimeFences {
  authorization_version: integer >= 1,
  policy_epoch: integer >= 1,
  recovery_epoch: integer >= 1
}

SourceExpected {
  source_id,
  updated_at,
  source_config_epoch: integer >= 1,
  source_safety_epoch: integer >= 1,
  collection_onboarding_status,
  lifecycle_status,
  enabled
}

CommandIdentity {
  command_operation_id: "op-" + 6..128 lowercase alnum/hyphen,
  command_idempotency_key: base64url opaque with >=128 bits entropy
}
```

command idempotency scope固定为 `{command_operation_id, method, exact path, canonical body hash}`：同 scope/body 返回原 receipt；同 operation 异 path/body 返回 409。它不替代 Source activation 的 canonical business operation/key。

### 6.2 Add

```text
POST /api/admin/sources
SourceAddRequest {
  schema_version: "admin-source-v0.1",
  command: CommandIdentity,
  expected_runtime_fences: RuntimeFences,
  input: {
    platform, handle, raw_url,
    entity_type, content_focus, priority,
    change_reason: string 1..512 after trim,
    notes: string 0..4096
  }
}
```

- `raw_url` 只接受 `https://synthetic.invalid/...`，拒绝 userinfo、fragment、控制字符、超长、非 allowlist scheme/host；纯字符串校验，不做 DNS。
- `source_id = "src-local-" + first24(lowercase-hex(SHA-256(UTF8(canonical-json-v1({platform,raw_url})))))`。
- 初始值严格为：provisional `canonical_url=raw_url`、`canonical_url_valid=false`、normalization/dedup=`pending`、identity/relevance/monitorability=`unknown`、adapter=`unchecked`、authorization/platform=`unknown`、onboarding=`validating`、operation=null、lifecycle=`proposed`、enabled=false、stop=`clear`、两个 source epoch=1，其余按 §3 服务端规则。
- 成功 `202`，返回唯一 Source 和 succeeded add receipt；Source=1，validation/activation/collection Outbox/TaskEnvelope/provider=0。
- 不同 command 对相同派生 source_id 不新增第二行，返回 `409 ADMIN_SOURCE_ALREADY_PROPOSED` 并给只读 current source ref。

### 6.3 Validate 与 validation retry

```text
POST /api/admin/sources/{source_id}/validate
SourceValidateRequest {
  schema_version: "admin-source-v0.1",
  command: CommandIdentity,
  expected_runtime_fences: RuntimeFences,
  expected_source: SourceExpected
}
```

- validation 为同步、同事务、no-egress 的 deterministic command；不创建 validation table/job/queue、activation/collection Outbox 或 TaskEnvelope。
- validation intent 只落 `source_validate` command receipt、request hash、Source CAS 结果和一条 AuditEvent；add 也只落 `source_add` receipt，不预创建 validation intent/job。
- 只执行数据 successor 固定的 synthetic URL normalizer、同 profile immutable baseline identity index + sparse overlay dedupe、local mock capability registry 三门读取。
- 结果只能沿冻结 Source transition 结算：`validating→normalization_failed|dedup_needs_review|linked_existing|activation_pending`；若三门未通过，再在同一事务沿 `activation_pending→blocked_platform|blocked_authorization|blocked_adapter_missing`。从 normalization/dedup/blocked 失败态重验时，先沿其既有恢复边回 `validating` 或 `activation_pending`，再走上述闭集；这只是组合既有边，不新增直达 transition。identity/relevance/monitorability unknown 不阻断。
- 多门失败按 `platform > authorization > adapter` 选择唯一 blocked state。
- 任一字段改变时 `source_config_epoch += 1`；`source_safety_epoch` 不变；append 一条脱敏 AuditEvent。
- 成功 `200`；即使业务结果为 normalization_failed/blocked，也表示 validation command 已确定提交。内部错误 500 完整 rollback。
- validation retry 仍调用本 route，必须使用新的 command identity、新 CSRF 和 fresh SourceExpected；不得调用 `/requeue`。同 command 重放只回原 receipt。

### 6.4 Activate

```text
POST /api/admin/sources/{source_id}/activate
SourceActivateRequest {
  schema_version: "admin-source-v0.1",
  command: CommandIdentity,
  expected_runtime_fences: RuntimeFences,
  expected_source: SourceExpected
}
```

前置必须同时满足：canonical valid、normalization valid、dedup unique、platform allowed、authorization valid、adapter ready、stop clear、五 fence current，且 state 为 activation_pending/queue_failed/stopped/cancelled。`queue_failed→activation_pending` 复用已有 onboarding business identity/key；`stopped→activation_pending` 不创建新 identity；`cancelled→activation_pending` 必须使用本次新的显式 activation command operation。各分支的 enabled/current identity 精确值由数据 successor 按 frozen transition 映射，产品/API 不猜测或另造枚举。

首次 activation 的同一 `BEGIN IMMEDIATE` 事务必须：

1. 重验 session/Origin/CSRF、command idempotency、SourceExpected、三门、stop 和五 fence。
2. `source_config_epoch += 1`；Source 最终沿 `activation_pending→queued`、`enabled→true`；lifecycle 仅按 frozen rule 执行 `proposed→active` 或 `paused→active`，已经 active 时不重写。
3. 首次 activation 或 cancelled 后的新 activation：`onboarding_operation_id=command_operation_id`，生成唯一 `source_activation` business idempotency key。stopped resume 与 queue_failed retry：保留原 onboarding operation/key；command identity 只幂等化本次人工命令。
4. 首次/新 activation 创建恰好一个 OutboxJob(pending) 和 schema-valid TaskEnvelope；stopped resume/queue_failed retry 必须复用既有唯一 Outbox/business identity，并只沿 frozen Outbox transition 更新，不新增第二 Outbox。任何分支都不取得 lease、不调用 adapter/provider。
5. append 一条 AuditEvent 和 succeeded command receipt。

成功 `200`，提交计数 `Source delta=1 / OutboxJob=1 / TaskEnvelope=1 / provider call=0`。任一步失败全回滚。worker 只有 fresh lease 后才可 `queued→collecting`，再依 VS1 contract 到 active/retry/dead_letter。

### 6.5 Stop

```text
POST /api/admin/sources/{source_id}/stop
SourceStopRequest {
  schema_version: "admin-source-v0.1",
  command: CommandIdentity,
  expected_runtime_fences: RuntimeFences,
  expected_source: SourceExpected,
  stop_status: manual | compliance | authorization | platform,
  change_reason: string 1..512 after trim
}
```

只允许 queued/collecting/active。一个事务内：

- Source→stopped、enabled=false、写 source_stop_status；manual 时写 `manual_disable_at`；
- `source_config_epoch += 1` 且 `source_safety_epoch += 1`；
- 已 leased Outbox 按既有边进入 stale_epoch/cancelled；pending Outbox 不取得 lease，按旧 envelope fence 失效并保留审计，不增加未冻结 transition；
- 旧结果禁止更新 Source，provider 调用前/后与结果 commit 前都重验 fence；
- append 一条 AuditEvent/receipt，外部调用=0。

成功 `200`。重复同 command/body 返回同 receipt；新 command 对已 stopped Source 返回 current state，不重复提升 epoch。

### 6.6 Retire 与删除拒绝

```text
POST /api/admin/sources/{source_id}/retire
SourceRetireRequest {
  schema_version: "admin-source-v0.1",
  command: CommandIdentity,
  expected_runtime_fences: RuntimeFences,
  expected_source: SourceExpected,
  change_reason: string 1..512 after trim
}
```

仅允许 lifecycle=active 且 onboarding=stopped|cancelled、enabled=false、stop非 clear、五 fence current。事务执行 lifecycle active→retired、config/safety epoch 各+1、append AuditEvent；Source、operation、Outbox、attempt/dead-letter 历史全部保留。成功 `200`。

`DELETE /api/admin/sources*` 永不注册；返回 `405 ADMIN_METHOD_DENIED`，业务写入 0。proposed/invalid/linked Source 若 canonical machine 没有 retire edge，只能保留为审计记录，不能物理清除或伪造新 transition。

### 6.7 Dead-letter requeue

```text
POST /api/admin/sources/{source_id}/requeue
SourceRequeueRequest {
  schema_version: "admin-source-v0.1",
  command: CommandIdentity,
  expected_runtime_fences: RuntimeFences,
  expected_source: SourceExpected
}
```

只允许 Source=dead_letter 且存在唯一 matching OutboxJob=dead_letter、原 TaskEnvelope、原 onboarding_operation_id 和原 business idempotency key。command identity 只幂等化这次人工指令；客户端不能提交或覆盖原 business operation/key。

同一事务：

1. 重新检查 normalization/dedup、三门、stop、五 fence 和 attempt budget。
2. Source 沿既有 `dead_letter→activation_pending→queued`；保持同一 onboarding_operation_id。
3. Outbox 沿既有 `dead_letter→pending`；复用原 operation/key/aggregate，不新建 Outbox/业务事实。
4. 写 fresh envelope/lease 前置数据与递增 retry generation/attempt；实际 lease 仍由 worker 另取。
5. Source enabled=true，config epoch+1，append 一条 AuditEvent/command receipt。

成功 `202`；计数仍为一个 Source、一个 business operation、一个 Outbox。非 dead_letter、identity/key 缺失/不唯一、门/fence失败返回 409/412，零业务写入。

`POST /api/admin/sources/{source_id}/retry` 永不注册，返回 `404 ADMIN_ROUTE_NOT_FOUND`。UI 必须按 canonical state明确调用 `/validate`、`/activate` 或 `/requeue`。

## 7. 错误、幂等、并发与恢复

### 7.1 固定 reason code

| HTTP | reason code | 用户恢复 |
|---:|---|---|
| 400 | `ADMIN_JSON_INVALID` / `ADMIN_CANONICAL_JSON_REQUIRED` | 修正本地表单后重新确认 |
| 401 | `ADMIN_SESSION_REQUIRED/INVALID/EXPIRED` | 重新领取本地 session；不自动 mutation |
| 403 | `ADMIN_PEER_DENIED` / `ADMIN_HOST_DENIED` / `ADMIN_ORIGIN_DENIED` / `ADMIN_CSRF_*` | 回 guard shell；不降级 |
| 403 | `ADMIN_M3_SHADOW_DENIED` | 基线只读；无可写恢复 |
| 403 | `ADMIN_EXTERNAL_CAPABILITY_DENIED` | 删除真实/外部输入 |
| 404 | `ADMIN_ROUTE_NOT_FOUND` / `ADMIN_SOURCE_NOT_FOUND` | 刷新列表；不创建替代身份 |
| 405 | `ADMIN_METHOD_DENIED` | 使用注册 POST；DELETE/OPTIONS 均拒绝 |
| 409 | `ADMIN_IDEMPOTENCY_CONFLICT` / `ADMIN_STATE_CONFLICT` | GET operation/Source 后重新确认 |
| 409 | `ADMIN_SOURCE_ALREADY_PROPOSED` / `ADMIN_SOURCE_CURSOR_STALE` | 打开当前 Source 或从第一页重读 |
| 409 | `ADMIN_SOURCE_REQUEUE_NOT_ALLOWED` / `ADMIN_SOURCE_RETIRE_NOT_ALLOWED` | 按 canonical state 使用唯一动作 |
| 412 | `ADMIN_FENCE_STALE` | 刷新 Source/fences；新 nonce、重新确认 |
| 413/415/422 | `ADMIN_BODY_TOO_LARGE` / `ADMIN_CONTENT_TYPE_DENIED` / `ADMIN_INPUT_REJECTED` | 保留非敏感表单并修正 |
| 503 | `ADMIN_NO_EGRESS_REQUIRED` / `ADMIN_SOURCE_PROFILE_NOT_READY` / `ADMIN_STORAGE_BUSY` | 先查 operation；无结果时保持 fail closed |
| 500 | `ADMIN_CLOCK_INVALID` / `ADMIN_AUDIT_FAILURE` / `ADMIN_INTERNAL_FAILURE` | 业务 rollback；重新载入当前状态 |

### 7.2 并发与 response loss

- 每个 Source 同时只允许一个 active mutation target；对象 CAS 以 source_id、updated_at、两个 source epoch、两个 canonical state 和 enabled 为闭集。
- CSRF 首次 exact consume 后永不恢复；业务 rollback 也要求新 nonce。
- commit 后响应丢失：用户看到“结果待确认”，先 `GET /api/admin/operations/{operation_id}`，再刷新 Source；同 operation/body 重放只回原结果。
- 客户端不得因 timeout 自动生成新 operation/key。不同 operation 的竞争由 Source CAS、唯一 operation/outbox约束；最多一个提交。
- GET、筛选、打开 Drawer、复制 synthetic URL 和刷新页面均不得修改 session idle、Source、Outbox 或 AuditEvent 业务状态。

## 8. Local session、CSRF 与 no-egress

逐字继承安全候选：

- `f1_local_admin_session`，HttpOnly、SameSite=Strict、host-only、Path=/；absolute TTL 30m、idle TTL 10m；进程重启失效。
- session create/refresh/destroy/status 与一次性 CSRF endpoint沿用既有 exact contract；CSRF TTL 5m、每 session 最多 32 个 issued nonce。
- 只绑定 `127.0.0.1` 或 `::1`，同一进程只接受一个 canonical origin；拒绝 Forwarded、X-Forwarded、HTTP/2 authority 模糊和 wildcard CORS。
- 每个 Admin GET/mutation/session/CSRF 入口先断言 runtime no-egress ready。DNS、HTTP、TLS、raw socket、代理、外部 subprocess/provider 任一尝试写脱敏 incident 后非零退出。
- 日志/AuditEvent 只允许固定 reason、request/operation ref、五 fence、attempt、monotonic sequence、clock/redaction/retention；禁止 Cookie、session/CSRF、body、完整 URL、真实 source/platform ID、stack、SQL、路径和 secret。
- 同 UID 恶意本地进程残余风险不被 loopback/Origin解决；本合同只适用可信单用户 local-dev，不可外推生产认证。

## 9. 390 / 1440 UI 与无障碍合同

### 9.1 共用状态

必须有真实可达的：`loading`、筛选 `empty`、`partial`、`error`、`conflict`、`stale`、`blocked`、`dead-letter`、`active`、`stopped` 和 response-unknown。全局 baseline=0 不显示正常 empty，必须报 profile/root failure。

- 状态以文字+图标/形状表达，不只靠颜色。
- unknown 永远显示“未核验”，对应 mutation disabled。
- mutation 先显示确认 Dialog；第一次提交后锁定单 action/in-flight promise；Enter、重复点击、触控和焦点恢复不能发第二请求。
- pending/success/error/unknown 使用 `aria-live`；unknown 文案固定“结果待确认”，不宣称自动重试。
- session/CSRF/Origin/profile guard 失败时所有 mutation disabled，焦点移到错误摘要；非敏感表单草稿可留在页面内存，不写 storage。
- URL 只允许复制文本；复制按钮有完整 accessible name；不生成外链或 DNS。

### 9.2 390×844

- Source 以卡片行呈现：handle/platform、canonical 主状态、enabled、最近 mock 收据、一个主动作。
- 筛选、详情、新增、错误与危险确认使用 full-screen Drawer/Dialog；触控目标≥44×44，安全区不遮挡主动作。
- Drawer 打开后焦点进入；Escape/关闭后回到触发器；无页面横滚，长 URL/reason code 可换行且可完整复制。
- stop/retire/requeue 二次确认必须写清 Source、当前状态、结果与不可物理删除边界。

### 9.3 1440×900

- 12 列语义 table，默认列：handle/URL、platform、lifecycle、enabled、onboarding、normalization、dedup、三门摘要、最近 mock、updated_at、actions；次级字段进详情 Drawer。
- `aria-sort`、row action、Drawer action、keyboard shortcut 汇入同一 action controller；换行、筛选、选择其他行使未消费 nonce失效。
- 容器≤1440，无页面级横滚；表格可局部横滚；session expired overlay 保留可读状态但阻断 mutation。

### 9.4 独立视觉验收

设计 successor 必须形成 390/1440 × 深/浅主题预览，覆盖所有状态、Drawer/Dialog、焦点返回、200% zoom、reduced-motion、forced-colors 和读屏名称。现有 M4 设计交接只作为组件/语义输入，不代表本页面已经冻结或获用户视觉确认。

## 10. 事务计数与 mandatory golden

| ID | 预期 |
|---|---|
| `SRC-BASELINE-01` | baseline ref=59×39、59 disabled、hash=e7a8…；可分页读，所有 mutation 403；旧 profile bytes/count/hash不变 |
| `SRC-ADD-02` | add synthetic success：Source+1、validating、enabled=false；Outbox/TaskEnvelope/provider=0 |
| `SRC-VALIDATE-03` | unique happy→activation_pending；invalid/dedup linked/needs_review/三门优先级逐项到唯一 canonical state；job/outbox=0 |
| `SRC-ACTIVATE-04` | 同事务 Source enabled+queued、lifecycle active、唯一 business operation/Outbox/TaskEnvelope；provider=0 |
| `SRC-LEASE-05` | worker fresh lease 后 queued→collecting→active；五 fence 任一 stale 时 provider=0、旧结果不提交 |
| `SRC-STOP-06` | queued/collecting/active stop：enabled=false、stopped、config/safety epoch 各+1；旧 task不能提交 |
| `SRC-RETIRE-07` | stopped/cancelled + lifecycle active 才 retired；DELETE 405；历史行与 audit保留 |
| `SRC-VALIDATION-RETRY-08` | `/validate` 新 command 可重验；不创建 Outbox/TaskEnvelope；同 command重放同 receipt |
| `SRC-DEAD-REQUEUE-09` | 仅 dead_letter；同 business operation/key/Outbox，retry generation/attempt增加；第二业务事实=0 |
| `SRC-RETRY-ROUTE-10` | `/retry` 404；UI 根据状态选择 validate/activate/requeue |
| `SRC-IDEMPOTENCY-11` | 同 command/body 返回同结果；同 command异 body 409；并发最多一笔 commit |
| `SRC-RESPONSE-LOSS-12` | commit 后断开；GET operation得到唯一事实；不得换 key盲重试 |
| `SRC-PROFILE-13` | 进程只开 source-management-synthetic；ATTACH/跨 profile query/59复制/public写入均 0；candidate未ACK时启动拒绝 |
| `SRC-SECURITY-14` | session/Origin/CSRF/Host/no-egress攻击矩阵全部零业务写入；日志 secret/URL/stack命中=0 |
| `SRC-UI-390-15` | full-screen Drawer、44px、键盘/触控单 action、focus trap/return、无横滚 |
| `SRC-UI-1440-16` | table/Drawer/筛选/键盘、全部状态、深浅主题、200%/forced-colors/reduced-motion/AT通过 |
| `SRC-PUBLIC-ZERO-17` | public profile/db/repository/API/app hash前后相同；公开页用户结果不受影响 |

任一 mandatory 为 TODO/SKIPPED/NOT_RUN、profile候选未ACK、设计未冻结、P0/P1未清零时，`SOURCE-MGMT-001` 保持 `P1-blocker`。

## 11. 跨部门精确交接

### 11.1 数据部 successor

必须交付并由统筹 ACK：

1. `source-management-synthetic` 单 profile机器合同、固定路径、migration selector、ledger/root、schema fingerprint、closed receipt；当前候选以 `TASK-20260809-8F382B` 为唯一输入。
2. 59 baseline hash/row identity引用与稀疏覆盖的逐字段机械映射；不复制59行、不跨库读取、不持久化第二 Source schema。
3. 新增 Source 的39字段默认/来源、normalizer/dedupe、local mock gate registry、canonical state/CAS/epoch、Source→Outbox/TaskEnvelope FK映射。
4. 按 §1.3 唯一表删除 `source_validation` Outbox/TaskEnvelope/worker lane；command receipt 固定六个 `source_*` literal，Outbox 只保留 `source_activation`；补齐 `source_retire`，不得保留 `create_validate|validate|activate|stop|requeue` 第二命名集。
5. command receipt/idempotency 与 business activation operation/key 的分域映射；requeue保留原 business identity。
6. 完整 fixture/validator：每 case从同一59 baseline引用起步，最多增加一条 local synthetic Source；baseline root零漂移。

任何现有 `source` + `payload_json` 物理表若不能一一映射39字段，数据 successor必须收敛为 canonical Source mapping；不得让产品合同吸收第二字段集。

### 11.2 设计部 successor

交付冻结 `/admin/sources` 390/1440 深浅预览与hash：列表/筛选/详情/add/validate/activate/stop/retire/requeue、全部状态与无障碍；alias严格按 §4，retry 文案/按钮不能混用，baseline行无 mutation，URL不可点击外联。

### 11.3 开发部

前置为 profile候选ACK、数据合同PASS、设计冻结/用户视觉门满足。实现只使用现有 Node24/Next/SQLite/crypto，不增加依赖；按 §5–§8 closed API/DTO和事务；禁止跨 profile、静态第二真值、真实 provider和外部I/O。

### 11.4 测试部

绑定同一 app/data/design/profile hash，执行 §10 全部 golden、39字段、16 onboarding state、4 lifecycle state、11 alias、两类retry、并发/response-loss/rollback、390/1440与公开零漂移。证据不足保持P1。

### 11.5 安全部

复验 exact Host/Origin/raw authority、session/CSRF、canonical JSON、idempotency/CAS、五 fence、stop失效、dead-letter identity复用、日志脱敏、single profile、no-egress和同UID local-dev残余边界；P0/P1任一存在时不放行。

## 12. 回退与当前结论

- profile/data候选未ACK：不创建 migration/profile/API；本合同保持 proposed。
- 设计未冻结/未确认：后端合同可复核，UI不得实施或写完成。
- transaction/DTO/state无法映射：整笔 rollback并退回数据/产品 successor；不加字段、状态、实体或模糊 route。
- 实现/测试/安全失败：关闭 source-management-synthetic，保留最后可证明收据；不触碰 m3/public profile，不运行 down migration，不删除历史。
- 任何真实 URL/provider/Base/外联需求：立即拒绝并返回独立授权流程；不在本合同扩展。

当前 `SOURCE-MGMT-001` 仍为 `P1-blocker`。本任务只把其产品实施判断收敛为一份 proposed 合同；真实运行、页面、profile和视觉均未实现。
