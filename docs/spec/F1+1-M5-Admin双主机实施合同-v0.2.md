---
type: product_implementation_contract
status: accepted_contract_pending_implementation
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-061961
decision: ADR-M5-ADMIN-DUAL-HOST-001
scope: 本地synthetic双主机模拟与后继生产实施边界
production_deployment: unauthorized
---

# F1+1 M5 Admin 双主机实施合同 v0.2

## 1. 实施结论与当前门禁

本合同是 [ADR-M5-ADMIN-DUAL-HOST-001](../decisions/system/2026-08-09-F1+1-M5-Admin双主机拓扑-successor-accepted.md) 的唯一实施入口，固定以下产品选择：

- Admin 与公开站分别运行于 `admin-host` / `public-host`；
- Admin 主机有唯一可写 SQLite 主库，公开主机只有可重建只读投影；
- Admin 主动 push，公开主机不拉取 Admin 业务数据；
- Mac/iPhone 功能等价，`RTO≤4h`，`RPO≤15m`。

开发不需再选择拓扑、数据方向、主写位置、投影激活次序、双端能力集或恢复目标。

当前仍有三个独立门禁：

1. `ADMIN-DECISION`：`ADR-M5-REVIEW-SYNTHETIC-001` 业务实施决策未获用户批准；
2. `ADMIN-VISUAL`：Admin 不可变视觉快照/hash及用户确认未完成；
3. `PRODUCTION`：主机、网络、域名、证书、私有客户端、备份与运营 manifest 未获用户批准。

因此，本合同当前可直接用于任务拆分、数据/internal contract 补齐和 no-egress 本地模拟设计；任何 Admin 业务代码必须同时等待前两门，任何真实部署必须等待第三门。

## 2. 主机、进程和凭据边界

| 责任 | `admin-host` | `public-host` |
| --- | --- | --- |
| 应用 | Admin UI/API、worker、投影生成、备份和审计 | 公开 UI/API、投影接收器 |
| 数据 | 唯一可写 SQLite 主库 | 原子激活的最小只读投影副本 |
| 入口 | 只绑定 loopback/私有接口，由私有策略点转发 | 公网只有公开 HTTPS；无 `/admin` upstream/fallback |
| 跨机凭据 | 持有投影签名私钥与最小 push 身份 | 只持有签名验证公钥与 staging 写入身份 |
| 禁止凭据 | 不使用公开 Web session 做系统管理 | 无主库、Admin mutation、私有控制面、备份解密/签名私钥 |
| 文件系统 | 主库、WAL、密钥、备份 staging 分权限 | 公开投影 inbox/staging/active 分权限 |

两台主机使用不同系统账户、服务身份、密钥域、session cookie、部署凭据、网络策略和文件系统。禁止共享主目录、共享挂载、共享数据库路径、SQLite `ATTACH`、跨主机直连主库或双向同步。

## 3. 本地双主机模拟候选

真实部署前的后续实施必须先通过一个 no-egress 本地候选：

```text
admin-host-sim
  bind: 127.0.0.1 only
  db: app/.local/admin-dual-host-sim/admin/master.sqlite
  roots: app/.local/admin-dual-host-sim/admin/

public-host-sim
  bind: 127.0.0.1 only, different port
  projection root: app/.local/admin-dual-host-sim/public/{inbox,staging,active}/
  no SQLite master and no Admin route
```

两个进程只经 loopback HTTP 交换不可变 synthetic 包，非 loopback 出站计数精确为 0。它们使用不同任务根、运行用户模拟、session secret、签名/验证 key fixture 和资源 allowlist；测试固定种子与时钟。任一进程打开对方数据根、相同 SQLite 或共享凭据即 fail closed。

此处只固定可执行的候选形状，不授权当前任务写 app、创建真实端口或启动服务。

## 4. 投影包和收据 closed DTO

所有 JSON 为 UTF-8 `canonical-json-v1`，`additionalProperties=false`，数组顺序有意义。路径参数 `deliveryId` 必须等于 body.deliveryId。

```text
ProjectionPackageV1 {
  schemaVersion: "admin-public-projection-v1",
  deliveryId: "op-snapshot-" + 64 lowercase hex,
  snapshotGeneration: integer(1..MAX_SAFE_INTEGER),
  previousSnapshotManifestHash: lowercase-hex(64) | null,
  sourceConfigEpoch: integer(1..MAX_SAFE_INTEGER),
  publicSchemaVersion: string(1..64),
  fullSnapshot: true,
  recordCount: integer(0..1000),
  records: PublicReadDTO[recordCount],
  recordsCanonicalHash: lowercase-hex(64),
  signingKeyId: string(1..128),
  idempotencyKey: string(1..256),
  snapshotManifestHash: lowercase-hex(64),
  signature: base64url
}

ProjectionReceiptV1 {
  schemaVersion: "admin-public-projection-receipt-v1",
  deliveryId: "op-snapshot-" + 64 lowercase hex,
  snapshotManifestHash: lowercase-hex(64),
  snapshotGeneration: integer(1..MAX_SAFE_INTEGER),
  status: "active" | "superseded" | "rejected",
  activeSnapshotGeneration: integer(0..MAX_SAFE_INTEGER),
  activeSnapshotManifestHash: lowercase-hex(64) | null,
  reasonCode: null | ProjectionReasonCode,
  receivedAt: RFC3339 UTC,
  activatedAt: RFC3339 UTC | null
}
```

hash 计算顺序固定：

```text
records = 当前全部 PublishedProjection 逐条验证后的 PublicReadDTO，按 publicId Unicode code point 升序
recordsCanonicalHash = SHA-256(UTF8(canonical-json-v1(records)))
manifestCore = ProjectionPackageV1 中除 deliveryId/idempotencyKey/snapshotManifestHash/signature 外的全部字段
snapshotManifestHash = SHA-256(UTF8(canonical-json-v1(manifestCore)))
deliveryId = "op-snapshot-" + snapshotManifestHash
idempotencyKey = "snapshot-sync:" + decimal(sourceConfigEpoch) + ":" + snapshotManifestHash
signature = sign(signingKeyId, UTF8("admin-public-projection-v1\n" + snapshotManifestHash))
```

`records` 是一份全站 full snapshot，每个当前 PublishedProjection 精确对应一条公开 DTO；只能使用同一个当前 accepted 公开 DTO 版本 allowlist，不混用两个版本。任一 PublishedProjection/approved chain 不完整时整个 snapshot fail closed；包内不允许任何 Admin-only 字段。该包是内容寻址技术发布物，不是新的业务投影实体。

## 5. 接收、幂等与原子激活

`PUT /internal/projections/{deliveryId}` 的闭合顺序：

1. 先验证双向服务身份、method/path/content-type/content-length 与 request deadline；
2. 在有限 staging 中完整接收，不解析部分响应为业务数据；
3. **先查幂等历史**：在已提交 generation 目录和 active manifest 中查 `deliveryId`；同 manifest hash 返回可重建的原 active/superseded 收据，同 ID 不同 hash 拒绝；未命中才继续。
4. 校验 closed schema、`fullSnapshot=true`、公开字段 allowlist、全量基数/升序、大小、records hash、manifest hash、派生 delivery/key、签名和 signing key 状态。
5. 已有 active 时，校验 `snapshotGeneration=active+1` 且 `previousSnapshotManifestHash=active hash`。全新/重建的空 public-host 仅在 active 与 committed history 均为空、受控恢复配置的 `bootstrapPin={snapshotGeneration,snapshotManifestHash}` 与包精确一致、包为当前全量 snapshot 时接受该 generation，不要求从 1 重放。具体 pin 传递实现属于 deployment manifest；本地用固定 synthetic pin。
6. 在同文件系统写不可变 prepared generation 目录，内含 manifest 和可由其重建的 receipt，fsync 文件/目录后以单次 atomic pointer swap 切换 active；**pointer swap 是唯一 commit point**。
7. GET receipt 只认 committed chain/active pointer。崩溃在 pointer swap 前发生时清理/覆用 prepared 且返回 404；在 swap 后发生时，从 active manifest 重建 active 收据；后继 generation 已激活时从链上 manifest 重建 superseded 成功收据。不存在 active 已变而收据永久 404 的窗口。

任一步失败：丢弃本次不完整 staging/prepared，保持 last-known-good active，不更改 active generation/hash。中断后同 `deliveryId` 查询收据；404 仅表示 committed chain 没有该 delivery，Admin 仍须验证同一 id/key 和 retry budget 后才可重投。generation 历史保留至少覆盖 delivery reconcile/audit 周期；生产精确保留值由 deployment manifest 固定。

closed reason code：

```text
PROJECTION_IDENTITY_DENIED
PROJECTION_REQUEST_INVALID
PROJECTION_SIZE_LIMIT
PROJECTION_SCHEMA_INVALID
PROJECTION_PUBLIC_FIELD_VIOLATION
PROJECTION_RECORD_HASH_MISMATCH
PROJECTION_MANIFEST_HASH_MISMATCH
PROJECTION_SIGNATURE_INVALID
PROJECTION_SIGNING_KEY_INACTIVE
PROJECTION_GENERATION_CONFLICT
PROJECTION_IDEMPOTENCY_CONFLICT
PROJECTION_STORAGE_FAILED
PROJECTION_ACTIVATION_FAILED
PROJECTION_RECEIPT_UNKNOWN
PROJECTION_EMERGENCY_STOPPED
```

同一请求有多项失败时，按上述顺序只返回首个 reason code。响应不含路径、stack、凭据、记录正文或签名材料。

reason code 的收据存续性固定为：

- `PROJECTION_SIZE_LIMIT|PROJECTION_SCHEMA_INVALID|PROJECTION_PUBLIC_FIELD_VIOLATION|PROJECTION_RECORD_HASH_MISMATCH|PROJECTION_MANIFEST_HASH_MISMATCH|PROJECTION_SIGNATURE_INVALID|PROJECTION_GENERATION_CONFLICT|PROJECTION_IDEMPOTENCY_CONFLICT` 是包字节/代际的 terminal 错误，持久 `rejected` receipt；只有 manifest core 经授权修订或基于 receiver active 重基产生新 hash/key 时才创建 replacement。
- `PROJECTION_IDENTITY_DENIED|PROJECTION_REQUEST_INVALID|PROJECTION_SIGNING_KEY_INACTIVE|PROJECTION_STORAGE_FAILED|PROJECTION_ACTIVATION_FAILED|PROJECTION_EMERGENCY_STOPPED` 是包外可恢复错误；不进入 committed receipt history，GET 继续 404，沿同 Outbox intent/key/package 执行有界重试。预算用尽时沿既有 `terminal_failed→dead_letter`结算；人工证明配置/资源已修复后，只用既有 `dead_letter→pending` 守卫复用原 operation/delivery/idempotency key，不生成 replacement。
- `PROJECTION_RECEIPT_UNKNOWN` 是 caller 的 reconcile 原因，不是 receiver terminal receipt；未确认结果始终保留 `reconcile_wait`。

## 6. Admin 主库与分发事务

业务 manual publish 的既有三段语义不变。对双主机 profile，`snapshot_sync` 严格串行：任意时刻最多一个 `pending|leased|retryable_failed|reconcile_wait` intent。completion 段提交 PublishedProjection；没有未结算 intent 时同一 Admin DB 事务还提交一个 `snapshot_sync` intent。已有未结算 intent 时不创建并行 intent，由后继幂等差异扫描在前任务结算后补齐。网络投递仍在事务外。顺序固定为：

1. 父状态只取一种：(a) 非空 receiver 的当前 confirmed active；(b) 从未激活过的空 receiver 的受控 sentinel `{confirmedActiveGeneration:0,confirmedActiveHash:null}`；(c) 重建空 receiver 中 Admin 保留的最后已结算 active receipt，并为待重放的同一成功签名包或下一 full snapshot 配置精确 bootstrap pin。(a)/(c) 的下一 `snapshotGeneration=confirmedActiveGeneration+1`、`previousSnapshotManifestHash=confirmedActiveHash`；(b) 固定 generation=1、previous=null。无法证明上述任一状态时不生成新 intent，先对账。读当前全部 PublishedProjection+本次新投影，计算全量 package；候选以 `app/.local/admin-dual-host-sim/admin/snapshots/<snapshotManifestHash>.json` 落盘/fsync。
2. 在 `BEGIN IMMEDIATE` 内重验当前投影集 root、receiver 最后 confirmed active 收据、不存在未结算 snapshot intent 和候选 hash；只有精确相等才提交 PublishedProjection+唯一 `snapshot_sync` Outbox/TaskEnvelope，或由扫描器单独提交后继 intent。`OutboxJob.aggregate_id="snapshot:<snapshotGeneration>:<snapshotManifestHash>"`，`deliveryId=OutboxJob.operation_id=TaskEnvelope.operation_id="op-snapshot-<snapshotManifestHash>"`，`payload_hash=snapshotManifestHash`，`reconcile_key="reconcile:snapshot:<snapshotManifestHash>"`，幂等唯一字段沿用冻结的 `{source_config_epoch,snapshot_manifest_hash}`。事务冲突整笔回滚并重生成候选；无引用文件只由受控 GC 删除。
3. 投递进程取得 fresh lease，重验 five fences、stop、key/hash 和当前主身份后调用 PUT；
4. 确认 active 或 superseded 成功收据时，OutboxJob `→succeeded` 与单条脱敏 AuditEvent 在同一可见事务中结算；SnapshotReconciliation 只在 partial/empty/stale 失败时记录保留 last-known-good；
5. 超时/响应丢失时保持 unknown，仅使用同 deliveryId 查收据；确认未接收且预算/fence 仍有效时才重投同一包；
6. terminal 时保留主库中已发布事实和旧 intent 审计，公开主机保留 last-known-good。包外可恢复故障修复后，沿 `dead_letter→pending` 人工守卫复用原 intent/key/package。只有 receiver 持久 terminal rejected 且 manifest core/父节点已有经授权变化时，扫描器才先确认 receiver 最后 active N-1，再从当前全量 PublishedProjection 生成不同的 manifest hash，创建 replacement generation N；新 delivery/key 由新 hash 派生。若重算 hash 与旧 terminal manifest 相同，禁止 replacement 循环并继续 fail closed。不改旧 terminal intent，不生成第二 Publication/PublishedProjection。
7. 启动前、每次 publish commit 后、每次 snapshot intent 结算后和运行中每 `≤60s` 执行同一幂等扫描：比较当前 PublishedProjection 全集 canonical root 与最后 confirmed active full snapshot `recordsCanonicalHash`。相等时 NO_WORK；不等且无未结算 intent 时按步骤1–2创建下一/replacement intent；仍有未结算 intent 时不并行创建。这个扫描只读现有主库事实、Outbox 和已结算收据，不新增 dirty 实体；扫描失败/receiver 不可对账时保持 fail closed 并告警。

`delivery_pending|active|retryable_failed|unknown|terminal_failed` 仅是 internal receipt presentation enum，不是 Publication 新状态，不新增领域实体。唯一映射固定为：`pending|leased→delivery_pending`、`succeeded→active`、`retryable_failed→retryable_failed`、`reconcile_wait→unknown`、`terminal_failed|dead_letter|stale_epoch|cancelled→terminal_failed`。本 successor 仅向 internal `outbox_job` 增加 snapshot_sync 未知结果的精确边：

```text
leased -> reconcile_wait
  guard: operation_type=snapshot_sync and receiver outcome unknown; preserve same deliveryId/idempotency_key/reconcile_key/snapshotManifestHash
reconcile_wait -> succeeded
  guard: GET same deliveryId confirms active|superseded with exact snapshotManifestHash/snapshotGeneration
reconcile_wait -> retryable_failed
  guard: GET same deliveryId confirms 404/not-submitted, attempt<max_attempts, five fences current, stop clear
reconcile_wait -> dead_letter
  guard: receiver confirms terminal rejection; an unconfirmed outcome stays reconcile_wait even when automated query budget is exhausted
```

数据部只需将该状态增量和页面槽位机械回指到现有 OutboxJob/TaskEnvelope/AuditEvent；SnapshotReconciliation 沿用既有 retained 失败记录。映射未证明时只阻断跨主机分发实现，开发不得自建第二字段集。

## 7. 逐 Admin Function ID 双端等价合同

Mac 入口为私有客户端→同一 Admin HTTPS origin→宽屏双栏；iPhone 入口为私有客户端→同一 origin→单列列表/详情。两端使用同一 API、当前主库和权限集。

| Function ID | Mac 真实入口 | iPhone 真实入口 | 依赖与成功出口 | 失败 / 恢复 | 当前门禁 |
| --- | --- | --- | --- | --- | --- |
| `ADMIN-PROFILE-001` | 登录后进入 `/admin/reviews` | 登录后进入同一路由 | 同一 review profile/唯一主库 ready | root/profile 失配时两端均阻断；修复后重新加载 | `ADMIN-DECISION` |
| `ADMIN-SEC-002` | 私有连接+用户/设备/passkey/session | 同等；高风险动作 fresh passkey+前台确认 | session、Origin、一次性 CSRF、CAS/fence 全过 | 任一门失败零写；重新认证/加载当前状态 | `ADMIN-DECISION` |
| `ADMIN-QUEUE-003` | 宽屏左队列+右详情 | 队列→详情，返回保留位置 | 可审核项、证据与 allowedActions 一致 | partial/error 保留可读项；重试同 GET | `ADMIN-DECISION` + `ADMIN-VISUAL` |
| `ADMIN-EDIT-004` | 右侧编辑区保存新版本 | 详情页同字段/同确认 | 新 Summary version+不可变 Bundle，operation success | stale/conflict 零覆盖；加载最新后重新确认 | 同上 |
| `ADMIN-APPROVE-005` | 批准确认层 | 同对象/同后果确认层 | 1 Decision+1 queued Publication，0 Outbox/Projection | 失败全回滚；查同 operation | 同上 |
| `ADMIN-REJECT-006` | 拒绝原因+确认层 | 同样 1–500 字与确认 | 唯一 rejected Decision，无 Publication | 缺原因/冲突零写；返回当前对象 | 同上 |
| `ADMIN-PUBLISH-007` | 已批准后第二次手动发布确认 | 同等可达；fresh passkey+前台确认 | 主库同一 Publication/Projection 提交；分发收据 active 后公开链接可用 | publish unknown 查同 operation；delivery unknown 查同 delivery；不生新 identity | 同上 |
| `ADMIN-RECOVER-008` | 错误/对账页执行同 operation/delivery 查询 | 同一错误、reason 和 recovery action | 业务收据与分发收据分开，同 identity 恢复 | 无收据保持 fail closed；确认未提交才有界重试 | 同上 |
| `ADMIN-VISUAL-009` | 宽屏双栏、状态与确认层 | 单列层级、safe area、触摸与键盘/读屏等价 | 不可变快照/hash经用户确认，双端全流程可达 | 任一端缺功能/恢复出口即阻断同一候选 | `ADMIN-VISUAL` |

当前这些 Function 的业务/视觉门禁仍未全部回答，对外状态保持 `user-gated`。拓扑确认只关闭 `ADMIN-TOPOLOGY-CONFIRMED`，不把任一 Function 误报为 complete。

## 8. 备份、RPO 与恢复收据

### 8.1 备份

1. 每 `≤5m` 尝试 SQLite 在线一致快照；失败不推进 last-success time。
2. 完成标准同时包含：一致快照成功、目标关闭/落盘、SQLite 完整性、schema/ledger/app 版本、manifest/hash、加密、异故障域持久化与回读。
3. 备份 manifest 固定：`backupId,startedAt,completedAt,sourceSchemaVersion,applicationVersion,sqliteVersion,journalMode,sourceLogicalId,contentHash,fileSize,encryptionKeyVersionRef,targetFailureDomainClass,verificationResult,previousBackupId,reasonCode`。禁止 secret、绝对路径、stack 和私密正文。
4. `backupAge≥10m` 预警；`backupAge≥15m` 关闭新的 revision/approve/reject/publish 以及设备/权限变更。`clock_status!=trusted` 或无法证明 backupAge 时直接按 RPO breach 处理；只有可信时钟和新恢复点全部复验通过才解除。查询与公开 last-known-good 可继续。
5. 本地验收使用固定 fixture clock、当前恢复点和一个已演练 last-known-good；生产保留周期等待 deployment manifest。

### 8.2 四小时恢复阶段

| 累计时限 | 阶段 | 必须收据 |
| ---: | --- | --- |
| 0–15m | 宣告、隔离、fence 旧写主 | incidentId/time，新 Admin mutation=0，写主≤1 |
| 15–45m | 撤销受影响凭据，选择≤15m恢复点 | manifest/hash/key/failure-domain PASS |
| 45–120m | 重建 Admin 冷备与私有通道 | config/patch/identity hash，无公网 listener |
| 120–180m | 恢复唯一 SQLite，保持只读 | integrity/schema/ledger/hash/invariant PASS |
| 180–210m | Mac/iPhone 认证、会话、Origin/CSRF/no-egress 只读验收 | 两端同能力集、公网不可达 |
| 210–225m | 明确提升唯一写主，执行 synthetic mutation/回滚/幂等 | writer=1，mutation/audit/backup trigger PASS |
| 225–240m | 重建、签名、push 并原子激活投影 | active receipt，public GET PASS，临时能力=0 |

超时或任一必须收据缺失：Admin mutation 保持关闭，公开站只继续 last-known-good。旧主未被机械证明不可写时，候选主不得提升。

## 9. 故障、回退与 break-glass

| 故障 | 立即动作 | 恢复 / 回退出口 |
| --- | --- | --- |
| public-host 失效/失陷 | 撤销接收凭据，隔离并保持 Admin 不可路由 | 重建空公开主机，从已签名投影 push，验证 generation/hash/public GET |
| admin-host 失效/失陷 | 关闭 Admin 新连接/mutation，fence、撤销会话/设备/服务凭据 | 按§8.2恢复；公开 last-known-good 继续只读 |
| push 被篡改/重放 | 拒绝新 staging，告警，active不变 | 轮换受影响接收凭据/签名 key，用下一合法 generation 重投 |
| 收据 unknown | 不盲重投 | GET 同 delivery；确认 404 且 fence/budget 有效时重投同一包 |
| 备份超龄/损坏 | 10m预警，15m关高风险 mutation，损坏点隔离 | 新恢复点完成验证+异域持久化+恢复演练后解除 |
| 私有通道故障 | 新登录/提权/高风险 mutation fail closed | 人工开启冷备通道；应用强认证不变 |

break-glass 默认关闭，只能由受控本地/带外控制台显式启用；每次具名、单会话、最小角色、最长 30m、不续期、自动撤销并回读。启用、首次使用、权限使用、临近到期、关闭与关闭失败都必须写追加式脱敏审计并告警；自动失效/回读失败时立即隔离 Admin 主机，拒绝新会话和 mutation，直到受控带外核查证明临时策略/会话为 0。它只恢复私有可达性，不跳过 passkey/session/Origin/CSRF/CAS/fence 或提升业务权限。

## 10. 分阶段实施和独立验收

| 阶段 | Owner | 前置 | 实施出口 | 独立验收 |
| ---: | --- | --- | --- | --- |
| `DATA-ADMIN-HOST-01` | 数据部 | 本合同 accepted | 将 delivery presentation 槽位与 snapshot_sync 状态增量回指到 OutboxJob/TaskEnvelope/AuditEvent；SnapshotReconciliation 只保留失败语义；无新领域实体 | 字段/enum/transition/transaction/hash 机器校验，旧 artifact 字节不改 |
| `DEV-ADMIN-HOST-01` | 开发部 | `DATA-ADMIN-HOST-01` PASS；Admin 两门已批 | 两个 loopback 进程/独立根，closed DTO，push/receipt，原子激活 | 不同运行身份，public 无 Admin route/主库，非loopback出站=0 |
| `DEV-ADMIN-HOST-02` | 开发部 | 01 PASS | 业务 publish→snapshot_sync→active receipt；Admin 区分业务/分发状态 | 成功、重放、same-ID/diff-hash、unknown/404/retry、terminal 全通过 |
| `DEV-ADMIN-DEVICE-01` | 开发部 | `ADMIN-DECISION`+`ADMIN-VISUAL` 已批 | Mac/iPhone 同一路由/API/权限集，手机高风险动作 fresh reauth | 逐 Function ID 双端真实浏览器/设备证据，任一缺口均为 P1 |
| `SEC-ADMIN-HOST-01` | 安全部 | 同一候选 hash | 双主机信任边界、凭据、签名、日志、no-egress、break-glass、备份/恢复审查 | P0=0/P1=0；公开主机无法触发 Admin mutation/查询 |
| `TEST-ADMIN-HOST-01` | 测试部 | 同一 app/data/config/hash | 功能、故障、投影原子性、RPO/RTO fixture clock 与回退矩阵 | 任一 mandatory 未运行/失败不得报 complete |
| `OPS-ADMIN-HOST-01` | 统筹/开发/安全/测试 | `PRODUCTION-DEPLOYMENT-MANIFEST` 用户批准 | 按 manifest 部署、备份、告警、演练与回退 | 实机 Mac/iPhone、RPO≤15m、RTO≤4h、写主=1、无公网 Admin 收据 |

阶段不可跨越前置。accepted 文档、代码存在、本地模拟 PASS 都不能代替生产部署批准或运行收据。

## 11. mandatory 验收出口

1. 两个独立进程/资源根/身份；一个可写 SQLite；公开主机主库/Admin route/mutation credential 计数为 0。
2. Mac/iPhone 分别完成 `ADMIN-PROFILE-001`–`ADMIN-RECOVER-008`全部允许动作；`ADMIN-VISUAL-009` 无功能缺失且经用户确认。
3. 主发布事务成功后有唯一 Publication/PublishedProjection；分发失败不改业务真值，不生成第二 identity。
4. 全量快照 hash/signature/schema/generation/previous hash/allowlist 全过才原子激活；七中任一错误时 active bytes 与 generation 不变。
5. 同 `deliveryId+snapshotManifestHash` 重放收据相同；same ID/different hash 固定拒绝；响应 unknown 仅查同 delivery；pointer swap 前/后崩溃分别得到 404/active 可重建收据。
6. public-host 从空状态只在 bootstrap pin 精确匹配当前已签名 full snapshot 时可确定性重建，无需重放 1..N；删除公开副本不影响主库。
7. fixture clock 证明备份尝试≤5m、10m预警、15m关高风险 mutation、失败不推进 last-success。
8. 恢复演练固定 writer≤1，候选只读验证后才提升，全链≤4h；超时时 Admin mutation 保持关闭。
9. 正常、篡改、重放、乱序、部分写、pointer swap 前/后崩溃、空主机 bootstrap pin 失配、断网、磁盘满、时钟不可信、旧主未 fence、备份损坏和 break-glass 超时/关闭失败均有独立证据；时钟不可信按 RPO breach，break-glass 失效失败隔离 Admin。
10. 实机、DNS/TLS、跨网、备份介质、中国大陆网络、RPO/RTO 真实计时和生产开关均保持未验证/关闭，直到 deployment manifest 获批并通过独立复验。当前 frozen PublishedProjection/SnapshotReconciliation 的 `synthetic_only=true,external_calls=0` 只证明本地候选；真实双主机需另行授权的 data successor 和 deployment manifest，不直接复用 synthetic 机器 schema 宣称生产通过。

## 12. 实施禁止项

- 不得把公开副本当业务真值、备份或反向修复源。
- 不得在 public-host 暴露 `/admin`、挂载主库、持有 Admin mutation/备份解密/签名私钥。
- 不得在两主机双写、同步 SQLite 文件、复制活动 db/WAL/SHM 或使用网络共享 SQLite。
- 不得在分发失败时回退到 Demo/fixture/旧内部数据或追加第二 Publication/publicId。
- 不得因 iPhone 屏幕较小删除编辑、批准、拒绝、手动发布、对账或恢复出口。
- 不得以私有网络代替应用身份、设备、passkey、session、Origin、CSRF、CAS/fence、审计或限流。
- 不得为追赶 RTO 开放临时公网 Admin、跳过完整性、自动提升候选主或忽略旧主 fencing。
- 不得在 `PRODUCTION` 门禁前创建主机、开通网络/域名/证书、写真实密钥、上传数据、部署、付费或外发。
