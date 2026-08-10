---
type: work_report
status: completed
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-0DEB27
domain_stage: M5人工审核系统决策
scope: 只形成review-synthetic successor draft与单一用户决策包；不改Spec/accepted ADR/app/data/migration
external_calls: 0
---

# review-synthetic successor 与单一用户决策包报告

## 1. 结果

产品部已形成 `status=draft` 的系统 successor：

`docs/decisions/system/2026-08-09-F1+1-M5-review-synthetic本地审核profile-successor-draft.md`

唯一推荐是新增物理隔离的 `review-synthetic` 本地 SQLite profile，并在同一 profile 内完成 synthetic 人工审核、显式手动发布和 PublishedProjection 公开回验。现有 `m3-shadow`、`public-synthetic` 继续独立冻结。

草案 §12 只有一个用户批准/拒绝问题。用户未明确批准前，第三 profile、migration、Admin 后端、mock worker 和 Admin UI 全部保持关闭。

## 2. 前置依赖

| 输入 | 状态 | 本任务吸收 |
| --- | --- | --- |
| 产品 `TASK-20260809-97700F` | 统筹 ACK | `/admin/reviews` 产品/API/安全/恢复合同；Admin 视觉仍需独立确认 |
| 数据 `TASK-20260809-1C2D4B` | 统筹 ACK | 两个既有 profile 无法容纳待审核写入；第三物理 profile 是最小安全方案；通用 published hash 缺口 |
| 数据 `TASK-20260809-535C4B` | 统筹 ACK，`PASS / P0=0 / P1=0` | 11 类 DTO/111 槽位唯一映射；approve 预留 Publication；manual publish 才建立 dispatch intent |

任务曾在数据 `535C4B` 仅为 completed 时按协议进入 `waiting_input`；统筹 ACK 后恢复执行，没有用未核收 mapping 提前冻结合同。

## 3. 决策包摘要

### 3.1 唯一推荐

- profile：`review-synthetic`；
- SQLite：`app/.local/f1plus1-review-synthetic.sqlite`；
- migration：复用 canonical 0001/0002，只为 review profile 选择 `app/migrations/review-synthetic/0003_review_synthetic_workflow.sql`；
- 每进程只开一个 profile，禁止 ATTACH、跨库事务、双写和跨 profile copy；
- 每个 profile 由独立 validator 进程生成绑定 DB 文件 SHA、ledger/root/hash/count/artifact revision 的 closed receipt；review runtime 只开 review DB；
- 独立 migration ledger、fixture profile ledger、ordered migration root 与四类 artifact root pin；
- local-dev loopback、session/Origin/CSRF、manual-only、no-egress；
- Admin 前端继续等待独立可视化预览和用户确认。

### 3.2 唯一发布时序

1. Approve 同一事务创建 immutable approved ReviewDecision，推进状态并预留唯一 queued Publication/publicId/generation/idempotency/reconcile identity；精确计数为 `Publication=1 / Outbox=0 / TaskEnvelope=0 / Projection=0`。
2. 用户首次显式 manual publish 才创建同 key OutboxJob(pending) 和 TaskEnvelope；guarded retry 复用 `retryable_failed` 的同一 Outbox/Envelope/key并取得 fresh lease，不重置 pending、不创建第二 intent。
3. fresh lease、五 fence 与 hash 全部通过且确认成功后，才在同一可见事务配对推进 Publication/Outbox、写唯一 PublishedProjection；公开详情在此前固定 404。
4. unknown、transient、confirmed-not-submitted、terminal 与 emergency 均按 successor 枚举的 Publication/Outbox/AuditEvent 配对事务收口，保留同一 identity/generation/key；unknown 下 Outbox 保持 reconcile_wait，不被取消。

### 3.3 通用 hash

`review-synthetic` 人工发布 `published_version_hash v1` 已固定为以下六键对象经 `canonical-json-v1` 后的 UTF-8 SHA-256 小写十六进制：

- `approved_bundle_hash`；
- `approved_content_version_hash`；
- `approved_summary_version_hash`；
- `public_id`；
- `publish_generation`，JSON integer；
- `release_bundle_id`。

禁止 synthetic label、时间、operationId、随机数、路径或字符串拼接进入公式。既有 `public-synthetic` 的 synthetic-label hash 不追溯重算。

`review-synthetic` 的可公开图完整复用 accepted v0.4 successor 字段/hash：Content 的 editorial/time 字段、Summary 的 lead/body/key points，以及 Bundle 的 source/access/time/media snapshots 都必须有唯一来源并可重算。Admin 111 槽位只读取其 allowlist 子集，revision 未开放的 v0.4 字段逐字保留，禁止从 v0.3 子集猜测。

## 4. 用户批准的精确含义

若用户批准，且后继任务将 draft 固化为 accepted，开发部可实施 review-synthetic 数据库/profile/migration、Admin Repository/API、local session/Origin/CSRF、mock worker、同 profile projection-first public read 和必要 synthetic 测试。

该批准不包含 Admin 前端视觉实施。设计部仍需交付深浅主题、关键状态与响应式预览，由用户独立确认后才可实现前端。真实内容、Base/provider、真实采集、自动或外部发布、部署、付费和跨网络 Admin 持续关闭。

## 5. 已验证

- 三个输入任务当前均为 acknowledged；数据 `535C4B` 的 conclusion 为 `PASS / P0=0 / P1=0`。
- 回读并核对 mapping artifact SHA：`96d4f7a3db5d17d5575447ec299513ec830779e302f1d7d69665a563c40552ef`；mapping canonical SHA：`6bce7514386dfcdd6a592100c371ddc2fc2b48e19090f23ea7bb982eb600cbc4`。
- mapping 固定 11 类 DTO、111 槽位、3 个事务阶段、0 领域实体增加、0 internal persisted entity 增加。
- 现有 public-synthetic manifest/fixture SHA 与精确 `1/12/12/12/10/12/12/12/12` 被写为启动前后零漂移门禁。
- successor 明确 profile/migration selector、独立 validator 收据、ledger/root pins、v0.4 public graph、hash 公式、枚举且带 guard 的 Publication/Outbox companion transitions、同 profile 路由可达性、local-dev 安全、验收和回退。
- 草案只含一个用户批准/拒绝问题；默认拒绝。
- 没有修改 Spec、accepted ADR、app、data、migration、Base 或 provider；`external_calls=0`。

## 6. 未验证

- review profile 的 migration、fixture、manifest、ledger/root pins 尚未生成，其最终 SHA 未知。
- SQLite、Repository、API、session/Origin/CSRF、worker、事务、锁、崩溃恢复和同 profile 404→200 尚未实现或运行。
- 本 draft 新列明的 review-profile companion transitions 尚未写入 successor data validator 或状态机产物；用户批准后须先机器化并独立复验，当前不修改冻结 data。
- 测试与安全尚未对后继实现执行独立复验。
- Admin 可视化预览尚未形成，用户没有确认 Admin 前端视觉与交互。
- 用户尚未回答草案 §12；因此所有新增实现和运行能力继续关闭。

## 7. 回退

- 用户拒绝：保留现有两个 profile 和公开读闭环，Admin database/backend/worker 继续关闭。
- 实施或复验失败：关闭 review profile，只恢复或重建其独立 synthetic DB，不运行 down migration，不触碰 public-synthetic/m3-shadow。
- publish unknown：保持同一 Publication `reconcile_wait`，公开侧 fail-closed，不创建第二 identity/key。
- 既有 profile 任一 hash/count 漂移：立即阻断 review profile，不更新旧 manifest 吸收漂移。

## 8. 错题自检

- 没有把 `public-synthetic` 放宽计数或追加待审核行写成最小改动。
- 没有建立 ReviewItem、SummaryDraft、ManualPublication、task_envelope 领域实体或第二 DTO 真值。
- 没有沿用数据前序“manual publish 才创建 Publication”的过时时序。
- 没有把 approve 返回 publicId 写成公开 story 已可读；Projection 成功前固定 404。
- 没有把 user operationId 提升为第二 publish key。
- 没有把后端批准扩展成 Admin 前端视觉批准、真实内容授权、自动发布或生产放行。
- 没有通过 ATTACH、跨 profile copy、双写、静态 fallback 或 payload_json 猜字段解决 profile 隔离。

## 9. 对抗审查

- 产品/系统完整性审查最终 `PASS / P0=0 / P1=0`：第三 profile、migration selector、ledger/root pins、同 profile public read、实施门禁和回退可直接进入后继实现。
- 安全/授权审查发现并关闭跨 profile 启动直读与 loopback 计数歧义；最终 `PASS / P0=0 / P1=0`。三个 profile 改为独立 validator closed receipt，review runtime 只打开 review DB；全文只有一个用户问题。
- 数据/领域审查发现并关闭 v0.4 public graph 缺口、retry Outbox 重置、hash 作用域和未定义的通配状态边；最终 `PASS / P0=0 / P1=0`。新增 companion transitions 已限定在 review profile 并逐边固定 guard，unknown 对账语义保留。
