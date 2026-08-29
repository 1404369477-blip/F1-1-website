---
type: system_adr
status: accepted
date: 2026-08-12
department: 产品部
decision_id: ADR-M5-REAL-PROJECTION-RUNTIME-002
related_task: TASK-20260812-96F40F
authorization_state: user_confirmed
authorization_evidence: 用户已授权继续快速搭建、真实采集、固定M1部署与初期人工审核；本successor只闭合用户手动publish之后的机器投递与公开读链
supersedes:
  - ADR-M5-REAL-REVIEW-PUBLISH-001
implementation_state: candidate_requires_successor
visual_state: user_confirmed
---

# ADR-M5-REAL-PROJECTION-RUNTIME-002：真实 RSS 公开投影 bootstrap 与 sender-reader 闭环 successor

## 决定

继续使用“私有唯一写主 → 人工 approve → 第二次显式手动 publish → 唯一 outbox → 签名全量快照 → 公开只读 active snapshot”。`auto-publish=0`；唯有用户完成第二次手动 publish 后，sender 才可机器投递已冻结的唯一快照。

本决定用一套可直接实现的运行合同关闭四个缺口：

1. **wire 唯一化**：接收只使用 `POST /internal/projections`；对账只使用 `GET /internal/projections/receipts/{deliveryId}`。两者只允许 loopback peer、精确 Host/服务身份和固定 JSON schema；公网路由计数为 0。
2. **无占位 hash 的 bootstrap**：receiver 新建空根只预置 `signingKeyId + Ed25519 public key`，不预置首个未知 snapshot hash。空根只接受通过签名和 manifest 全校验、`snapshotGeneration=1`、`previousSnapshotManifestHash=null`且 `active.json` 仍不存在的唯一首包。用 `O_EXCL` 写 committed generation，再原子写 active pointer；并发首包只能一个成功。激活后 committed generation + active pointer 自身成为链头真值，后续严格要求 `generation=active+1` 且 `previous=active hash`。
3. **sender/receipt 唯一状态机**：单 worker 一次最多 lease 一件 `pending|retryable_failed`；同一 delivery 每次均从已存 envelope/hash 构造同一签名包，不重算业务身份。精确 2xx receipt 且 delivery/hash/generation 全匹配才提交 `succeeded`。连接超时、断线或响应不完整一律提交 `reconcile_wait`，随后只 GET 同一 receipt；查得匹配 receipt 转 `succeeded`，明确 404 才可转 `retryable_failed`，再 lease 同一 package。语义失配、409、签名/hash/generation 失配直接 `terminal_failed`；5xx/网络仅在预算内可重试。所有转移与 audit receipt 同一 Admin DB 事务，lease 为 60 秒，`max_attempts=3`，调度为一个 60 秒单 worker tick；过期 lease 先转 `reconcile_wait`，禁止盲重投。
4. **公开 reader/cutover 闭环**：单 M1 第一版使用两个逻辑服务身份和两个资源根，Admin sender 拥有私钥与私库，public runtime 只有 verify key 和 projection root 只读权限。receiver 与 Next public reader 可处于同一 public runtime 进程，但服务端口严格分开：internal POST/receipt GET 只在 loopback internal listener，公网 Next 只暴露公开 GET。Next 通过新的 `public-real-snapshot` 读模式直接每次验证 `active.json → committed generation → signature/manifest/records`；无 active 时回合法 empty，破损时 503 fail closed。

## 密钥、manifest 与首包边界

- Ed25519 private key 只给 Admin sender，public receiver/reader 只有 public key；`signingKeyId` 固定进 deployment manifest。无密钥或权限失配时服务写前停止。
- deployment manifest 固定 Admin DB/root、sender key/path、public projection root、internal endpoint/origin、public read mode、synthetic rollback release/hash和服务身份。删除 `projectionBootstrapGeneration`/`projectionBootstrapHash`；空根是唯一 bootstrap 标记，禁止 `000...` 或人工预猜 hash。
- 首包也必须由用户 manual publish 事务产生，不允许安装器、receiver 或启动脚本合成空/演示快照。

## 切换与回退

cutover 必须基于一份内容寻址 release manifest，且同时满足：至少一代真实 snapshot active；sender outbox `succeeded`；公开候选的 feed/detail 均 200；无 Admin/internal 公网路由；上一精确 synthetic release 的回退命令已验证。切换只改 public runtime 的 immutable read-mode/release 指针，不改 Admin DB、active snapshot 或 public ID。

运行中新 snapshot 由 active pointer 原子切换；若新快照破损或公开健康检查失败，先停 sender，再把 public release 指针切回上一 active snapshot；若 reader 候选整体失败，切回上一精确 synthetic release。回退不删除、合并或回写私有审核/Publication/published_projection/outbox 事实。

## 实施清单与兼容方式

最小必改文件：

```text
app/migrations/rss-real/0003_projection_delivery_runtime.sql
app/src/server/review-real/repository.ts
app/src/server/review-real/projection.ts
app/src/server/review-real/sender.ts
app/src/server/admin-service/deployment.ts
app/src/server/admin-service/runtime.ts
app/src/server/admin-service/server.ts
app/src/server/public/runtime.ts
app/src/server/public/snapshot-adapter.ts
app/src/app/api/public/feed/route.ts
app/src/app/api/public/stories/[publicId]/route.ts
app/scripts/projection-sender.ts
app/scripts/admin-install-macos.ts
app/scripts/install-macos-public-beta.ts
app/src/tests/review-real-delivery.test.ts
app/src/tests/public-real-snapshot.test.ts
```

`0002` 保持不变。`0003` 只追加 sender 运行所需的 receipt 持久化/索引与 lease 恢复约束，并使现有 `pending` outbox 原位兼容；禁止 down migration。现有 `projectionBootstrapGeneration/Hash` 仅存在 prepare-only manifest，尚未用于真实部署，因此后继 deployment schema 直接升为 `admin-service-deployment-v2`并拒绝 v1，安装时不做占位转换。public Next 保留当前 synthetic adapter，新增显式 `public-real-snapshot` adapter，用 release manifest 二选一，禁止请求级混读或数据级 fallback。

## 被拒绝的方案

- 在 prepare 阶段写假 hash/空快照：无法由用户手动 publish 事实溯源。
- 继续 `PUT /internal/projections/{deliveryId}`：与现有已审核 server 闭集和 package 自带 deliveryId 重复。
- sender 超时后直接重发：无法区分已激活但回包丢失。
- public Next 跨读 Admin DB 或把真实行混入 synthetic SQLite：破坏故障域、回退 hash 和只读边界。
- 请求级在 real/synthetic 间自动 fallback：会将损坏的 real 根伪装成正常内容。

## 验收出口

1. 全新 receiver 空根无 bootstrap hash，只有精确签名 generation 1 能激活；并发、假签名、非 1 代、非 null previous 均写前失败。
2. manual publish 前 outbox/sender 工作为 0；manual publish 后唯一 delivery 经 lease/POST/receipt 转 succeeded；response unknown 只 GET 对账，明确 404 后重投同一包仍不增 publicId/generation/outbox。
3. 公开 Next 的 real 候选只读 active root，feed/detail 同一代且 200，损坏时 503；synthetic DB SHA/count 零漂移。
4. cutover 与两层回退（上一 active/上一 synthetic release）均用精确 manifest 执行，私有事实和已签名 generation 零改动。

## 未变更边界

人工 revision/approve/reject 和第二次手动 publish 两动作保持；真实媒体、AI、second-hop、其他信源、公网 Admin、第二写主和自动发布均不在本决定内。
