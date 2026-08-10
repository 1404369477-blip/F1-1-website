---
type: data_mapping_report
status: final
date: 2026-08-09
department: 数据部
task_id: TASK-20260809-535C4B
domain_stage: M5人工审核数据合同闭合
decision: pass
summary: proposed机器映射包已闭合11类Admin DTO的111个槽位、approve预留唯一Publication/publicId且零Outbox、manual publish才建立同key Outbox/TaskEnvelope的唯一时序，并证明公开详情只在同profile投影成功后可达；P0/P1=0，冻结v0.3/v0.4与public-synthetic零漂移。
---

# Admin DTO 与 Publication 预留时序机器映射报告

## 1. 结论

任务范围内的 proposed 数据映射已闭合，P0/P1=0：

1. `ReviewList`、详情扩展、operation receipt、revision/approve/reject/publish 的 request/success 共 11 类 DTO、111 个叶槽位，逐项绑定到唯一 `source_registry` 规则。来源只使用冻结 v0.3 领域字段、AuditEvent/OutboxJob/TaskEnvelope internal receipt、不可变 ReleaseBundle snapshot 和产品合同常量；未增加领域实体、internal 持久实体或第二 schema。
2. `approve` 在同一原子事务创建 immutable approved ReviewDecision、推进既有状态，并取得或创建唯一 queued Publication；`publication_id/public_id/publish_generation/idempotency_key/reconcile_key` 一次预留。该事务明确禁止 OutboxJob、TaskEnvelope、PublishedProjection。
3. `ApproveSuccess.publication.publicId` 直接来自已提交的 `Publication.public_id`，因此 `POST /api/admin/publications/{publicId}/publish` 在 approve 提交后具备稳定寻址身份。
4. 显式 manual publish 才取得或创建一个 `OutboxJob(operation_type=publish)`，内嵌一个 TaskEnvelope；二者逐字复用 Publication 的 idempotency/reconcile key。worker 持新鲜 lease 与五 fence 推进 `queued → publishing → published`，确认成功的同一可见事务插入唯一 PublishedProjection。
5. `/stories/{publicId}` 在 Projection 前固定 404/fail-closed；唯一 PublishedProjection 写入并通过完整 hash/fence 链后，才在同一显式选择的物理 profile 中变为可读。禁止跨 profile copy、ATTACH、静态 fallback 或临时 publicId。

该包是 implementation mapping 与离线校验收据，不授权第三 profile、migration、Repository、API 或 UI 实现。

## 2. 产出

机器包目录：`data/admin-review-mapping-v0.1/`

| 产物 | SHA-256 | 用途 |
| --- | --- | --- |
| `admin-review-mapping.json` | `96d4f7a3db5d17d5575447ec299513ec830779e302f1d7d69665a563c40552ef` | DTO来源、三阶段事务、可达性与不变量 |
| `mapping.schema.json` | `80ed33137c5e76024305bd3619d856907f7ff472837b614c9706c04c3bbed4f1` | 映射文档闭合结构；明确非领域 schema |
| `fixtures.synthetic.json` | `d2a06ef4644ed47867631bd4f1f653f9daf2fb0a52e86041595e2bf44ad0294e` | approve/enqueue/completion/unknown/reject 五条时序 fixture |
| `validate_mapping.py` | `3d8a587d10a9f432a379529d756603ff20d0807e809f654eb073488c3a30503d` | 离线 mapping/pointer/时序/冻结 hash/count validator |
| `manifest.json` | manifest 自身不自引用 | 机器收据、artifact hash、冻结输入与精确计数 |

映射 canonical SHA-256：`6bce7514386dfcdd6a592100c371ddc2fc2b48e19090f23ea7bb982eb600cbc4`。

## 3. 唯一时序

### 3.1 Approve reservation transaction

事务入口：`POST /api/admin/reviews/{bundleId}/approve`。

前置校验覆盖当前 Bundle/version/hash、Summary hash、五 fence、`manual_only`、session/Origin/CSRF、operation receipt 幂等与对象级 CAS。提交内容固定为：

- INSERT immutable `ReviewDecision(decision=approved, approved_bundle_hash=current bundle_hash)`；
- CAS Summary `ready→approved`、ReleaseBundle `ready→approved`；
- Content 在同一不可观察事务内完成 `review_pending→approved→publish_queued`，提交态为 `publish_queued`；
- 对 `(release_bundle_id, approved_bundle_hash)` get-or-create 唯一 `Publication(queued)`，一次冻结 public identity、generation 和两类 key；
- append 脱敏 AuditEvent，支撑 operation receipt。

该事务的精确提交计数为：Decision=1、Publication=1、Outbox=0、TaskEnvelope=0、Projection=0。任一步失败整笔 rollback，不留下半个 Decision 或部分预留 identity。

### 3.2 Manual publish enqueue transaction

入口按已预留 `Publication.public_id UNIQUE` 寻址。服务端重验当前 approved Decision、Bundle/hash/version、generation、五 fence、manual-only 与安全守卫后：

- get-or-create 一个 `OutboxJob(pending, operation_type=publish)`；
- 建立一个 TaskEnvelope；
- Publication、OutboxJob、TaskEnvelope 的 idempotency_key 与 reconcile_key 逐字相等；
- 客户端 operationId 只作 internal receipt/AuditEvent 相关号，不产生第二 publish key；
- repeated same-key/same-payload 返回原 intent；任一 key/hash 冲突 fail closed。

enqueue 提交后的精确计数为：Publication=1、Outbox=1、TaskEnvelope=1、Projection=0。Publication 身份和 publicId 不变。

### 3.3 Completion / reconcile transaction

worker 取得 fresh lease 后才 CAS `queued→publishing`。确认成功时以同 key、同身份、同 generation 原子执行 Publication `→published`、Content `publish_queued→published`、Outbox `→succeeded`、INSERT 唯一 PublishedProjection 与 AuditEvent。

结果 Unknown 时进入同一 Publication 的 `reconcile_wait`，保留 publicId/generation/key，Projection 仍为 0，公开详情继续 404。confirmed published 才生成投影；confirmed not submitted、terminal failure、emergency stop 沿冻结状态机恢复或停止，不创建第二身份。

## 4. DTO 来源边界

validator 对每个 DTO 叶槽位执行以下门禁：

- DTO 名集合和每类槽位数必须精确为 `16/6/19/9/12/6/10/7/8/6/12`，合计 111；
- 每个槽位必须指向一个存在的 source rule，source registry 不得包含未使用规则；
- 直接字段 JSON pointer 必须在 v0.3 domain schema 或 internal AuditEvent schema 中存在；ReleaseBundle immutable canonical snapshot 只允许从既有 `canonical_payload` 顶层进入；
- owner 只允许既有 Content、Summary、ReleaseBundle、ReviewDecision、Publication、OutboxJob、PublishedProjection、AuditEvent 及非持久 verifier/产品常量组合；
- `schemaVersion`、固定成功态与 pending presentation 状态来自产品合同 literal；page/cursor、integrity、allowedActions 和 publicPath 是对既有记录的非持久 closed derivation；
- operation receipt 由 AuditEvent、OutboxJob、TaskEnvelope关联结果、ReviewDecision、Publication 和 PublishedProjection 组合读取，不形成新领域记录。

## 5. 已验证

- validator 连续两次独立 reload PASS，收据一致：`17021c9f7a52074e2685675eedff0e9a53bca62542ffce9248bf81727c0ae79b`。
- 11 类 DTO / 111 槽位唯一来源、3 个事务阶段、0 领域实体增加、0 internal实体增加通过。
- approve `1 Publication / 0 Outbox / 0 TaskEnvelope / 0 Projection`；manual publish enqueue `1/1/1/0`；completion 后 `1 Projection`。
- admin publish path 使用 approve 返回的相同 publicId；public story 从 Projection 前 404 转为成功后 200；unknown 保持同一 publicId 并进入 reconcile_wait。
- Publication/Outbox/TaskEnvelope 两类 key 逐字一致。
- v0.3 manifest 11/11 artifact hashes 全部匹配；schema、state-machine、manifest 固定 SHA 均匹配。
- v0.4 public-synthetic manifest 全 artifact hashes 匹配，fixture SHA 匹配，精确图计数保持 `1/12/12/12/10/12/12/12/12`，`external_calls=0`。
- 三个聚焦负例均被拒绝：DTO 槽位无来源、approve 放行 Outbox、注册新 owner/第二实体。
- `git diff --check` 通过；自产 `__pycache__` 已精确清理。

## 6. 未验证与实施门禁

- 未创建或运行 SQLite、migration、Repository、API、Admin UI、worker、session/CSRF 或真实 publish transaction。
- 未授权第三 profile、profile-scoped migration root 或 app config 变化；同 profile 可达性规则已机器闭合，实施仍需产品/统筹后继任务明确授权。
- 未启动网站，未访问 Base/provider/Collector，未导入真实内容，未发生外部 I/O。

这些属于后继实现与运行验收范围，不构成本 proposed mapping 的 P0/P1。

## 7. 错题自检

- 已纠正前序数据报告把 Publication 放到 manual publish 才创建的过时时序；当前唯一映射在 approve 事务预留 Publication/publicId，manual publish 只创建或复用 dispatch intent。
- 没有让 approve 偷跑 Outbox/TaskEnvelope，也没有把 public route 可寻址误写成公开故事已可读。
- 没有用第二 Publication、临时 publicId、同步直写 Projection、payload_json 猜字段或跨 profile copy 解决可达性。
- validator 首轮曾因组合 owner 字符串顺序未登记而 fail closed；已补齐精确既有组合并重新生成 manifest，随后连续两轮与负例均通过。
- 没有审批、提权、网络、系统目录写入或等待中的外部工具调用。

TASK_STATE_OK
