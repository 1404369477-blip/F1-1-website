---
type: product_decision_candidate
status: final
decision: proposed
date: 2026-08-02
department: 产品部
task_id: TASK-20260802-933C1C
domain_stage: M4-C-VS1-contract-gap-product
source_test_plan: docs/collaboration/部门/测试部/报告/2026-08-02-M4-VS-1-mock采集链路测试计划.md#16
user_confirmation_required: true
---

# TASK-20260802-933C1C｜VS-1 重试与 validation job 产品决策候选

## 1. 唯一 proposed 结论

本报告只提出本地 mock VS-1 的一份产品决策候选，不改变 accepted ADR、`docs/spec.md`、`data/mvp-contract-v0/`、`app/`、设计合同或测试计划。候选结论如下：

1. **Collection retry**：仅把 `HTTP_429`、`HTTP_500/502/503/504`、`COLLECTION_TIMEOUT` 和有界 `DB_LOCK_CONTENTION` 归为可重试；本地 mock 每个 collection operation 最多执行 3 次，等待序列固定为 `1s → 3s`，不使用 jitter、真实 `Retry-After` 或隐藏的库内重试。自动重试复用同一 `operation_id`、同一 `idempotency_key`，每次重新取得 lease 并重新核对五个 fence；第三次失败进入 `dead_letter`，没有第四次自动执行。
2. **Validation job**：新 Source 写入 `validating` 时，在同一 SQLite 事务中写入**恰好一个**独立的本地 validation job intent。它使用现有 internal inbox/outbox/runtime 设施的独立 validation lane，执行规范化与查重；它不创建 activation/collection TaskEnvelope 或 Outbox，不设置 `enabled=true`，不调用 adapter/provider。输入相同的 source generation 只允许一个 validation job；显式人工重验证才创建新的 validation operation/key。
3. **Publication 边界**：collection 的 timeout、unknown、429、5xx 和 lock failure 都不进入 `Publication.reconcile_wait`。`reconcile_wait` 继续只服务于已存在的 Publication 提交未知结果，并保留原 `reconcile_key`。

上述三点都保持 `proposed`，在 successor ADR、Spec 和数据合同的最小修订完成并通过后才可用于实现。真实平台的 SLO、限流响应头和 provider 副作用语义仍为 `Unknown`，本报告只冻结本地 deterministic mock 行为候选。

## 2. 输入、范围与当前缺口

本报告只读核对了以下合同：

| 输入 | 用途 | 当前状态 |
|---|---|---|
| [`测试计划 §16`](/Users/hoyin/Documents/F1+1/docs/collaboration/部门/测试部/报告/2026-08-02-M4-VS-1-mock采集链路测试计划.md#16) | 缺口 2（collection retry 精确表）与缺口 6（validation job 形态） | 已核收，精确语义待本报告候选 |
| [`docs/spec.md`](/Users/hoyin/Documents/F1+1/docs/spec.md) §4–§7 | `validating`、三门、五 fence、queued/collecting、collection_failed/dead_letter、无真实外部 I/O | frozen，未修改 |
| [`state-machine.json`](/Users/hoyin/Documents/F1+1/data/mvp-contract-v0/state-machine.json) | Source 16 状态、Outbox 任务状态、同 key 重试与人工死信恢复 | frozen，未修改 |
| [`schema.json`](/Users/hoyin/Documents/F1+1/data/mvp-contract-v0/schema.json) | Source/Outbox 字段、`max_attempts`、`next_attempt_at`、`operation_type` enum | frozen，未修改 |
| [`runtime-envelope.schema.json`](/Users/hoyin/Documents/F1+1/data/mvp-contract-v0/runtime-envelope.schema.json) | attempt、lease/deadline、五 fence、`reconcile_key=null` | frozen，未修改 |
| [`accepted M4 ADR`](/Users/hoyin/Documents/F1+1/docs/decisions/system/2026-08-01-F1+1-M4本地Kickoff系统路线-accepted.md) | R9 lease/fence/CAS、R12 deny-all、VS-1 mock 范围 | accepted，未修改 |

测试计划已冻结“activation 条件满足前不得生成 activation/collection TaskEnvelope/Outbox，且不得调用 adapter/provider”，但尚未冻结 validation job 的精确数量、队列形态和幂等边界。现有数据合同已冻结 collection 的有限重试出口，却没有精确的 429/5xx/timeout/lock 分类和等待序列。

## 3. Collection retry 候选合同

### 3.1 错误分类

错误码先经过本地 mock 的显式 allowlist；未知错误 fail closed，避免把新错误默认为可重试。

| 错误/触发 | retryable | Source 结果 | Outbox/attempt 结果 | 说明 |
|---|---:|---|---|---|
| `HTTP_429` | 是 | `collecting → collection_failed`，写 `next_attempt_at` | `retryable_failed`，同 key，刷新 lease/fence | 本地忽略真实 `Retry-After`；synthetic fixture 只验证固定等待。真实平台头部语义 `Unknown` |
| `HTTP_500`、`HTTP_502`、`HTTP_503`、`HTTP_504` | 是 | `collecting → collection_failed` | `retryable_failed`，同 key | `503` 是测试计划的固定 fixture；其他三类一并列入候选 allowlist |
| `HTTP_501`、`HTTP_505+` 或未知 HTTP 状态 | 否 | `collecting → collection_failed`，终止原因 | `terminal_failed → dead_letter` | 不以“所有 5xx”扩大重试范围；后续若平台需要新类另开 successor 决策 |
| `COLLECTION_TIMEOUT` / `TIMEOUT` | 是 | `collecting → collection_failed` | `retryable_failed`，同 key | VS-1 读取路径没有发布副作用；不进入 `reconcile_wait` |
| `DB_LOCK_CONTENTION` | 是 | `collecting → collection_failed` | `retryable_failed`，同 key | 一次 collection attempt 记录一次锁冲突；不在 repository 内再叠加未记账循环 |
| `DB_CORRUPTION`、schema/hash 失败、invalid fixture、path/permission、fence/lease 失效 | 否 | `collection_failed` 或 `stopped/cancelled`（按原因） | `terminal_failed`、`stale_epoch` 或 `cancelled` | 不自动重试；保存脱敏错误与审计，等待人工出口 |

`HTTP_408`、真实 provider 的连接重置、真实 API 的响应体含义以及具有外部写副作用的 timeout 不在本候选的冻结范围内，均标为 `Unknown`。`PUBLISH_TIMEOUT` 走既有 Publication 语义，不得套用 collection 表。

### 3.2 预算与确定性等待

| attempt | 执行条件 | 失败后的处理 | 下一次等待 |
|---:|---|---|---:|
| 1 | 首次取得 lease，`attempt=1` | 可重试错误写 `retryable_failed`，持久化 `next_attempt_at` | `1s` |
| 2 | 同一 operation/key，重新取得 lease，五 fence 重新匹配 | 可重试错误写 `retryable_failed` | `3s` |
| 3 | 同一 operation/key，重新取得 lease，五 fence 重新匹配 | 任何再次失败均进入 `terminal_failed/dead_letter` | 无 |

- `max_attempts=3` 是 VS-1 local mock 候选值，计数是总执行次数，禁止第 4 次自动执行。它与 fixture 中已有的 `max_attempts=3` 示例对齐，但当前 `schema.json`/state machine 尚未把它写成 VS-1 全局语义。
- `next_attempt_at` 使用 synthetic clock 的失败时刻加上表中等待；worker 重启只读取已持久化时间，不重新计算随机值。等待不使用 jitter，不依赖墙上时间之外的未记录状态，也不读取真实 `Retry-After`。
- `TaskEnvelope.attempt` 从 1 开始；Outbox 的现有 `attempt` 字段可在首个 lease 前保持 v0.3 约定的初值，取得 lease 后必须为 1、2 或 3。`max_attempts`、`last_error_code`、`next_attempt_at` 沿用现有字段，不新增 domain 字段。
- 每次重试都检查 `source_stop_status`、三门、五 fence、`enabled` 和当前 operation/key；CAS 或 fence 失败时不调用 provider，不产生下一次 collection side effect。
- automatic retry 始终复用原 `operation_id`、`idempotency_key`、Source identity 和 payload identity。它只增加 attempt/lease/audit 记录，不创建第二个 collection operation。

### 3.3 状态转移表

| 场景 | Source canonical 状态 | Job/attempt 状态 | operation/key 规则 | 自动动作 |
|---|---|---|---|---|
| queued 获得 lease | `queued → collecting` | `pending/ retryable_failed → leased` | 原 activation/collection operation/key | 通过五 fence 后才允许 mock provider |
| 429/允许的 5xx/timeout/lock，且 attempt < 3 | `collecting → collection_failed` | `leased → retryable_failed` | 保持原 operation/key；新 lease/fence | 按 1s 或 3s 进入下一 attempt |
| 同上，attempt = 3 | `collection_failed → dead_letter` | `leased → terminal_failed → dead_letter` | 原 operation/key 保留在审计和 dead-letter | 不再自动执行 |
| 非 retryable fixture/error | `collecting → collection_failed` | `leased → terminal_failed → dead_letter` | 原 operation/key 保留 | 无 `next_attempt_at`；人工处理 |
| stop/cancel/fence 失效 | `collecting → stopped/cancelled`，或 job `stale_epoch` | `cancelled/stale_epoch` | 原任务不复活 | 不调用 provider；显式恢复重新核对 gate/fence |
| dead-letter 人工重排 | `dead_letter → activation_pending` | 旧 job 保持 dead-letter | **新 operation_id 与新 idempotency_key**，旧 key 不复用 | 重新核对规范化、查重、三门、五 fence |

对于非 retryable 错误，当前 frozen state machine 只有“bounded provider failure”及 `retry_count >= max_retry` 的 dead-letter guard，没有显式的 `retryable=false` guard。本候选要求 successor data state machine 为现有 `collection_failed → dead_letter` 增加“terminal classification”出口，不新增 Source 状态；在此修订接受前，代码不得自行把非 retryable 错误伪装为普通重试。

## 4. Validation job 候选形态

### 4.1 一次创建、一条独立 lane

候选采用**一条独立的本地 validation lane，每个 source input generation 恰好一个 validation job**：

- `POST /api/admin/sources` 通过产品层输入校验后，在同一 SQLite 事务写入 `Source(collection_onboarding_status=validating)` 与一个 validation job intent；事务提交成功后才返回 202。Source 初始仍为 `enabled=false`，`onboarding_operation_id` 可保持 null，直到 activation transaction 创建正式 activation operation。
- validation job 使用现有 internal inbox/outbox/runtime 设施，建议的内部 `operation_type` 为 `source_validation`，`aggregate_type=source`，`aggregate_id=source_id`，`reconcile_key=null`。它是内部运行操作，不是新的领域实体、Base 表、公开 DTO 或第二套 schema。
- job payload 的输入身份由 `source_id`、`raw_url` 的 canonical input hash、`normalizer_version` 和 `source_config_epoch` 组成。建议 key 为 `validate:<source_id>:<input_hash>`；`operation_id` 为同一 generation 的稳定 `op-validate-*` 值。相同 key 的重复请求只返回现有 job/result，禁止第二个 validation job。
- 显式人工重验证（例如 `normalization_failed`、`dedup_needs_review` 后的修订）创建新的 validation operation/key，并保留旧 job 与 audit；旧 job 不被覆盖、不重新消费。
- validation worker 只执行 URL normalization、canonicalization、dedup lookup 和本地字段写回。它不调用 adapter/provider，不建立 activation/collection TaskEnvelope/Outbox，不把 `enabled` 写成 true，不创建 Content/Event/Publication。

### 4.2 时序与精确数量

| 时点 | Source | Validation lane | Activation/collection side effect |
|---|---|---|---|
| T0，admin create | 写一行 `validating` | 写一条 pending validation intent | 0 个 activation TaskEnvelope/Outbox，0 个 collection TaskEnvelope/Outbox，0 次 adapter/provider |
| T1，commit 后 | 仍为 `validating` | 一个 job 可被 lease；重复投递按 key dedupe | 仍为 0 |
| T2，validation 成功且规范化/查重通过 | `validating → activation_pending` | job `succeeded` | 仍为 0；等待 gate/activation |
| T2，规范化无效 | `validating → normalization_failed` | job `succeeded`，domain outcome 为 invalid | 0 |
| T2，查重需人工/已关联 | `validating → dedup_needs_review` 或 `linked_existing` | job `succeeded`，domain outcome 记录 | 0 |
| T2，内部锁冲突/暂时运行失败 | 仍为 `validating` | `retryable_failed`，同 key，最多 3 次 | 0 |
| T3，validation 技术失败耗尽 | 仍为 `validating`，由内部 job dead-letter 表示未完成 | `terminal_failed → dead_letter` | 0；只能显式人工重验证 |
| T4，后续 activation gate 通过 | `activation_pending → queued` | 正式 activation operation 才创建一条 activation outbox | collection 仍等 queued lease，不由 validation job 触发 |

validation job 的技术重试可复用第 3 节的 1s/3s/3-attempt 本地预算；它拥有独立的 operation/key，不能与 collection operation 共用。domain outcome（例如 `normalization_failed`）不是技术 retryable failure，完成一次 job 即可落盘相应 canonical Source 状态。

### 4.3 幂等、fence 与失败路径

| 失败/重复路径 | 预期结果 |
|---|---|
| 相同 HTTP idempotency key、相同 source input | 返回同一 `source_id` 与 validation job；不插入第二 Source 或 job |
| 相同 source generation 的重复 delivery | inbox 标记 deduped 或 no-op；最多一条 job 产生 domain 写入 |
| 输入 hash/normalizer/source config epoch 变化 | 旧 job 按 stale fence 结束；显式新 generation 使用新 operation/key |
| normalization invalid | Source=`normalization_failed`；不创建 activation/collection job；修订后显式回 `validating` |
| dedup `needs_review` / `linked_existing` | Source 进入对应 canonical 状态；不启用、不采集、不公开 |
| lock contention 或有限本地技术错误 | 同 key 有界重试；耗尽后 validation job dead-letter；Source 保持 `validating`，等待人工重验证 |
| stop/cancel/stale epoch | 在 provider 之前拒绝旧 job；Source 不被旧结果覆盖；不创建 activation/collection side effect |
| validation 通过但 activation gate 不通过 | Source 只停在 `activation_pending` 或相应 blocked 状态；validation job 不替代三门检查 |

五个 fence、lease/deadline 和 CAS 规则沿用 accepted ADR R9。validation lane 的所有错误与重复也写入脱敏 AuditEvent；`external_calls=0` 保持硬断言。

## 5. Admin mutation HTTP 产品行为候选

以下只描述产品层 method/path/状态码和结果，不规定 session、Origin、CSRF、CSPRNG、权限实现；既有安全合同仍适用。

| method/path | 成功行为 | 重复/冲突行为 | 领域副作用 |
|---|---|---|---|
| `POST /api/admin/sources` | 首次返回 `202 Accepted`，body 至少含 `source_id`、`collection_onboarding_status=validating`、validation operation/job ref；响应在事务 commit 后发送 | 相同 client key/input 返回既有 Source/job（`200` 或等价幂等 202）；同 key 不同 input 返回 `409`；语法无效返回 `400` | 一行 Source + 一条 validation job；activation/collection jobs=0 |
| `POST /api/admin/sources/{source_id}/validate` | 返回 `202` 与当前/新 validation operation；同 generation 已 pending/succeeded 时返回既有结果 | Source 处于不允许人工重验的状态返回 `409`；重复请求不增 job | 只创建 validation lane job；不改变 enabled，不创建 collection task |
| `POST /api/admin/sources/{source_id}/requeue` | 仅对 `dead_letter` 返回 `202`，生成新 operation/key 并重新进入 `activation_pending` | 非 dead-letter、fence 不匹配或三门失败返回 `409`/canonical blocked 结果 | 旧 dead-letter 保留；新操作重新检查 gate/fence |
| `POST /api/admin/sources/{source_id}/activate` | 只有 `activation_pending` 且三门、停止状态、五 fence 全通过才返回 queued 结果 | 未满足条件返回 `409` 与 canonical blocked 状态 | 原子写 `enabled=true`、queued、activation operation/outbox；validation job 不可代替此入口 |

HTTP 精确 DTO、错误 reason code、页面文案和安全拒绝收据仍需 successor API/安全合同；本表不授权真实外部能力。

## 6. 对现有合同的影响与最小 successor 更新

### 保持不变的部分

- 不新增 Source canonical state；继续使用 `validating`、`activation_pending`、`queued`、`collecting`、`collection_failed`、`dead_letter` 等现有 enum。
- 不新增 domain entity、Base 字段、Publication identity 或第二套 schema。`SourceObservation`、`AuditEvent` 仍为 internal-only；validation job 只是 internal runtime operation。
- 不把 collection unknown 转写成 `reconcile_wait`；Publication 的四类 reconcile outcome 与原 `reconcile_key` 语义不变。
- M3 shadow、domain seed、Base/provider、真实采集、真实表单和自动发布继续关闭；本任务无外部写入。

### 需要 successor ADR/Spec/data 的最小修订（本任务只列出，不落盘）

1. **Successor ADR（VS-1）**：加入第 3 节的错误 allowlist、`max_attempts=3`、`1s/3s` deterministic schedule、same key/fresh fence、terminal classification、manual requeue 新 key 和 validation lane 的 exactly-one 约束；明确 `reconcile_key=null`。
2. **Spec**：补充 Source validating 的 T0–T4 时序、collection retry 状态表、admin mutation 产品 DTO/status 候选及“validation 成功仍不能 activation”的门禁；保留本地 mock/no-egress 与真实平台 `Unknown`。
3. **Data successor**：
   - 在现有 `OutboxJob.operation_type` 允许列表中增加 internal-only `source_validation`，或提供等价的 internal validation-lane discriminant；不得创建新的 domain entity/table 作为第二 schema。
   - 为 `collection_failed → dead_letter` 增加 `terminal classification` guard，并将 `retryable_failed`、`terminal_failed`、`dead_letter` 与 Source 状态的映射写成可机械验证的约束。
   - 明确 `max_attempts=3`、`next_attempt_at` 的本地 mock 语义；新增 validation pass/invalid/duplicate/lock-exhausted fixtures 与 validation job count invariant。当前 v0.3 文件不在本任务中修改。
4. **API/测试后续**：由开发/测试将本表的 202/200/409/400 候选转为唯一 DTO 合同，并补 `SRC-01`、`ADMIN-MUT-01`、`RETRY-01..04` 的 exact assertions；在合同接受前保持受影响测试 blocked。

当前已确认的合同差异 pointer：`schema.json#/$defs/OutboxJob/properties/operation_type` 尚无 `source_validation`；`state-machine.json#/state_machines/source_onboarding/transitions` 尚无显式 terminal-classification guard。两项差异都要求 data successor 处理，产品报告保持 `proposed`，不在本任务中越权改动。

## 7. 用户确认点

请在 successor ADR 前确认以下三点：

1. 是否接受 VS-1 local mock 对 `429/500/502/503/504/collection timeout/DB lock contention` 使用总 3 次、`1s → 3s`、无 jitter/无真实 `Retry-After` 的有界重试，并让未知错误 fail closed？
2. 是否接受新 Source 每个 input generation 在同一事务写入恰好一个 internal validation job，validation 完成只推进到 `activation_pending`，activation/collection jobs 和 adapter/provider 调用保持 0？
3. 是否接受 dead-letter 人工重排生成新 operation/key，HTTP create/revalidate 以 202 幂等返回既有 job，冲突以 409 呈现？

## 8. 已验证、未验证与错题自检

### 已验证

- 已读取测试计划 §16、Spec、accepted M4 ADR、v0.3 schema/state/runtime/fixtures；本报告只引用现有合同，不改动其正文。
- 已核对当前 Outbox 字段已有 `attempt`、`max_attempts`、`last_error_code`、`next_attempt_at`、`operation_id`、`idempotency_key`、`reconcile_key`，并确认 `operation_type` 当前 enum 不含 `source_validation`。
- 已核对 Source canonical onboarding state 没有 `validation_failed` 或 `validation_job` domain state；候选没有新增 Source 状态。
- 已把测试计划的 retry fixture、`max_attempts=3` 示例、same key/fresh fence 和 activation/collection zero-side-effect 条件映射到具体表格。
- 本报告之外没有写入 accepted ADR、Spec、data、app、design、Base、provider 或网络；`external_calls=0`。

### 未验证

- Node24/SQLite 的真实 `busy_timeout`、WAL、CAS、lease/fence、重启后 `next_attempt_at` 和锁竞争行为尚未运行；1s/3s 是产品候选参数。
- 真实平台对 429 `Retry-After`、各类 5xx、连接 timeout、provider 是否存在外部副作用的语义未验证，全部保持 `Unknown`。
- 当前 v0.3 data 尚未接受 `source_validation` operation type、terminal-classification guard 和 validation fixtures；因此 successor ADR/Spec/data 尚未 accepted。
- admin HTTP DTO、session/Origin/CSRF 拒绝响应、页面文案、worker 实现、完整 VS-1 测试收据均未验证。

### 错题自检

1. 没有把有限 retry 写成无限 retry；自动 retry 有总预算、同 key 和明确 dead-letter 出口。
2. 没有把 manual requeue 与 automatic retry 混用；manual requeue 使用新 operation/key，旧 dead-letter 保留审计。
3. 没有把 collection timeout 或 unknown 误写为 Publication `reconcile_wait`，也没有产生第二 `public_id` 或 Publication。
4. 没有把 validation job 写成 domain entity、Base 资源或真实外部调用；它仅是 internal validation lane 的候选。
5. 没有把 validation 成功当成 activation 授权；三门、stop 和五 fence 仍由 activation transaction 独立检查。
6. 没有修改 accepted ADR/Spec/data/app/design 或历史测试报告；当前数据差异已明确列为 successor 更新指针。

## 9. 交付状态

本文件是 TASK-20260802-933C1C 的唯一 proposed 产品决策报告。当前不接受 VS-1 retry/validation 语义，不启动真实采集、真实 validation、真实表单、真实发布或任何外部能力；待用户确认、successor 合同和开发/测试收据后再申请阶段性放行。

TASK_STATE_OK
