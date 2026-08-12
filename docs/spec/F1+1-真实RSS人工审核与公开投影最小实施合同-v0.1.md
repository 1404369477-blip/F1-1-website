---
type: product_implementation_contract
status: accepted_backend_contract_pending_visual_confirmation
date: 2026-08-12
department: 产品部
task_id: TASK-20260812-28FA62
decision_id: ADR-M5-REAL-REVIEW-PUBLISH-001
scope: 固定M1真实RSS候选、私有人工审核、显式手动发布、独立公开投影与双主机演进
auto_publish: forbidden
admin_visual_implementation: user_gated
---

# F1+1 真实 RSS 人工审核与公开投影最小实施合同 v0.1

## 1. 单一结论

第一版采用一条可立即实施、后续无需改写业务语义的主链：

```text
固定 RSS 采集器
  → M1 私有 rss-real-private SQLite / pending_review_candidate
  → 私有 /admin/reviews 人工编辑与决定
  → approved + queued Publication
  → 用户再次显式“手动发布”
  → Admin 写主内 PublishedProjection + 唯一 snapshot_sync outbox
  → 独立公开接收器原子激活全量只读快照
  → / 与 /stories/{publicId}
  → 原文链接
```

本合同接受后，后端数据库、Repository、API、投影生成和 loopback 接收器可以先行实施。`/admin/reviews` 的 UI/CSS、Mac/iPhone 最终布局与视觉证据继续等待现有候选的用户确认；视觉门不阻断不改变用户界面的后端纵切。

当前 `public-multimedia-synthetic` 数据库、12/24 条 synthetic 数据、migration、manifest、hash 与公网 Beta 继续保持只读且字节不变。真实发布只进入新的独立公开快照根；禁止把真实行写入 synthetic SQLite，也禁止从公开副本反向修复私有主库。

## 2. 已验证输入与仍未验证项

### 2.1 已验证输入

- `RSS-REAL-001` 已在固定 M1 完成唯一真实请求：HTTP 200，50 条 feed item 中选择 20 条并新建 20 条候选，`20/20 pending_review`，公开站零漂移。
- 固定调度已启用：source `enabled=true`，LaunchAgent loaded，`RunAtLoad` 成功，`StartInterval=900s`；RunAtLoad 对同一 20 条得到 `new=0 / duplicate=20`。
- 测试部已在零手动触发条件下观察到一个自然 900 秒周期：LaunchAgent `runs 1→2`，唯一新 slot 终态 `succeeded/OK`，HTTP 200，`new=0 / updated=0 / duplicate=20`，公开面零漂移；该证据不外推未来所有周期。
- 私有数据库现行 schema 只有 `source`、`ingest_run`、`pending_review_candidate` 三表；候选已有机器字段、`editor_*`、`editor_based_on_source_revision` 和 `review_status`。
- 旧 Admin mapping 的 11 类 DTO / 111 槽位证明了 revision、approve、reject、manual publish、operation receipt 的产品语义；它绑定 synthetic Content/Summary/ReleaseBundle 图，不能直接当作真实 RSS 三表的物理映射。
- 双主机合同已 accepted：Admin 唯一写主、Admin→public 单向全量快照、公开端原子激活、Mac/iPhone 功能等价、`RTO≤4h`、`RPO≤15m`。

### 2.2 未验证

- 本合同的 `0002_admin_review_publish.sql`、七张新增表、真实 RSS Admin Repository/API、投影包、接收器与公开 reader 尚未实现。
- 现有 20 条候选尚无人工中文标题、中文摘要、决定、Publication 或公开投影。
- `/admin/reviews` 视觉候选尚未获得用户确认；真实 Mac/iPhone、私有 overlay、passkey/fresh re-auth、生产证书与真实双主机网络未验。
- 首版只支持 0 图；真实媒体权利、代理、下载、缓存、缩略图与图片安全处理继续关闭。
- 首版详情页把人工中文摘要同时作为导语与正文首段，关键点为空；更丰富的中文提炼字段留给后继产品决定。
- 已有人工字段非空且来源真实更新的动态保护样本仍缺失；当前自然周期全部为 duplicate。

## 3. 范围与禁止项

### 3.1 本合同包含

- 读取当前 `rss-real-private` 的真实 `pending_review_candidate`。
- 人工编辑 `editor_title`、`editor_excerpt`、`editor_notes`；保存时精确绑定当前 `source_revision`。
- 保存生成不可变 `ReviewBundle`；批准/拒绝都绑定该 Bundle 与 hash。
- 批准只创建唯一 queued Publication；批准不会生成公开快照，不会创建投递 outbox。
- 用户第二次显式确认后执行手动发布；同一事务生成 Admin 写主内 PublishedProjection 和唯一 `snapshot_sync` outbox。
- 独立公开接收器只接受签名、闭合、全量、顺序确定的公开快照；原子激活后 `/` 与 `/stories/{publicId}` 才可见。
- 0 图、真实原文链接、失败对账、幂等/CAS、回退与从单 M1 到双主机的同合同演进。

### 3.2 本合同不包含

- 自动批准、批准即发布、自动发布、定时发布或批量发布。
- 外部 AI/翻译/摘要；文章页 second-hop；图片、enclosure、媒体下载或代理。
- 其他 RSS、X、Instagram、Reddit、Base/provider 切换或开放式信源发现。
- `correct`、`withdraw`、删除已发布内容和权限管理 UI。
- 在 public-host 暴露 `/admin`、把公开副本当备份、SQLite `ATTACH`、跨库事务、双写或复制活跃 DB/WAL/SHM。
- 未经视觉确认实现正式 Admin UI/CSS，或通过隐藏 URL、`robots.txt` 代替私有访问控制。

## 4. 单一数据模型

### 4.1 现有三表保持

`app/migrations/rss-real/0001_rss_real.sql` 字节不改。采集器继续只写机器字段、`source_revision` 与 `last_seen_at`，永不写 `editor_*`、决定、Publication、Projection 或 outbox。

`pending_review_candidate` 的现有字段按以下语义使用：

| 字段 | 唯一语义 |
| --- | --- |
| `title/excerpt/author/published_at/canonical_url/source_payload_hash/source_revision` | 采集器机器层；来源变化只递增 `source_revision` |
| `editor_title/editor_excerpt/editor_notes` | 当前人工工作副本；只由 Admin revision 写 |
| `editor_based_on_source_revision` | 人工工作副本所依据的精确来源修订 |
| `review_status` | 当前候选索引状态：`pending_review/approved/rejected/published`；权限与可执行动作仍须从完整链重新推导 |

若 `editor_based_on_source_revision < source_revision`，候选固定显示 `source_updated`，批准与发布均关闭；人工可载入新来源后保存新 Bundle。采集器不得为该情况自动覆盖人工字段或自动改变审核决定。

### 4.2 唯一增量 migration

新增且只新增一份只追加 migration：

`app/migrations/rss-real/0002_admin_review_publish.sql`

该 migration 新增七张表，不新增第二候选表，不复制 source/ingest 数据：

| 表 | 主键/唯一约束 | 最小职责 |
| --- | --- | --- |
| `review_bundle` | `bundle_id` PK；`bundle_hash` UNIQUE；`(candidate_id,bundle_revision)` UNIQUE | 保存一次人工 revision 的不可变私有快照、公开 allowlist 快照和 hash |
| `review_decision` | `decision_id` PK；`bundle_id` UNIQUE | 不可变 `approved/rejected` 决定；拒绝原因 1–500 字；批准 hash 绑定 Bundle |
| `publication` | `publication_id` PK；`public_id` UNIQUE；`bundle_id` UNIQUE | 批准时预留稳定 publicId/generation；状态 `queued/published/reconcile_wait/terminal_failed/emergency_stopped/superseded` |
| `published_projection` | `projection_id` PK；`public_id` UNIQUE；`projection_hash` UNIQUE | Admin 写主内唯一公开 allowlist 记录；只由显式 publish 事务生成 |
| `projection_outbox` | `delivery_id` PK；`(snapshot_generation,snapshot_manifest_hash)` UNIQUE；`idempotency_key` UNIQUE | 唯一 `snapshot_sync` intent、内嵌闭合 TaskEnvelope、lease/attempt/reconcile 状态 |
| `admin_operation` | `operation_id` PK；`request_hash` 与 method/path/type 固定 | revision/approve/reject/publish 的幂等收据与 response-loss 对账 |
| `audit_event` | 单调 `audit_seq` PK；`event_id` UNIQUE | 追加式脱敏审计；禁止 UPDATE/DELETE trigger |

禁止新增 `SummaryDraft`、`public_story`、第二 Publication、第二 publicId、第二 outbox、前端持久状态或把 `payload_json` 当任意字段袋。闭合 JSON 只允许承载本合同列出的快照/receipt/TaskEnvelope，写入前后都须 schema 校验并计算 canonical hash。

### 4.3 Bundle 与 hash

一次成功 revision 在同一 `BEGIN IMMEDIATE` 中：

1. CAS 当前 `candidate_id + source_revision + source_payload_hash`；
2. 校验 `titleZh` 1–400 字、`summaryZh` 1–1200 字、`notes` 0–2000 字；
3. 更新候选 `editor_*` 与 `editor_based_on_source_revision`；
4. 插入新的不可变 `review_bundle`；
5. 旧 queued Publication 若存在只可转 `superseded`，不删除旧决定；
6. 写同 operation receipt 与一条 audit event。

`review_bundle.public_payload` 的键固定为：

```json
{
  "candidateId": "...",
  "sourceId": "motorsport-f1-news",
  "sourceRevision": 1,
  "sourcePayloadHash": "64-lowercase-hex",
  "canonicalUrl": "https://www.motorsport.com/...",
  "sourceTitle": "...",
  "sourceAuthor": "... or Motorsport.com",
  "sourcePublishedAt": "RFC3339 UTC",
  "contentType": "race_news",
  "titleZh": "...",
  "summaryZh": "...",
  "media": [],
  "sourceDisplayName": "Motorsport.com"
}
```

`public_payload_hash=SHA-256(canonical-json-v1(public_payload))`。`bundle_hash` 另绑定 `bundle_id/bundle_revision/public_payload_hash/editor_notes/created_at`；私有备注不得进入 PublishedProjection、投影包、公开 API 或公开日志。

## 5. 事务与状态

### 5.1 Revision

- 输入：当前 candidate/source revision、当前 bundle（可空）、中文标题/摘要/备注、operationId。
- 成功：新 Bundle 一条，候选工作副本与 Bundle 同事务可见，`review_status=pending_review`。
- 重放：同 operationId + 同 canonical body 返回同一 Bundle；同 operationId + 不同 body 返回 409。
- 来源或 Bundle stale：零写入，返回 `REVIEW_SOURCE_STALE` 或 `REVIEW_BUNDLE_STALE`。

### 5.2 Approve

批准必须绑定最新 Bundle，且 `bundle.source_revision=candidate.source_revision=editor_based_on_source_revision`。同一事务精确：

```text
ReviewDecision approved = 1
Publication queued = 1
PublishedProjection = 0
ProjectionOutbox = 0
```

`public_id="public-rss-" + SHA-256(UTF8(candidate_id + U+001F + bundle_hash))`，使用完整 64 位小写十六进制。相同 Bundle 重放返回同一 Decision/Publication；不同决定冲突时零覆盖。

### 5.3 Reject

拒绝原因 trim 后 1–500 字。成功只创建 immutable rejected Decision 并令候选索引为 rejected：

```text
ReviewDecision rejected = 1
Publication = 0
PublishedProjection = 0
ProjectionOutbox = 0
```

### 5.4 显式手动发布

只有 `Decision=approved + Publication=queued + 当前 source/bundle/hash 未 stale + manual_only` 才显示/接受手动发布。该 mutation 需要再次确认与 fresh re-auth。

同一 `BEGIN IMMEDIATE` 中：

1. 重算当前 candidate、Bundle、Decision、Publication、session/Origin/CSRF/CAS；
2. Publication `queued→published`，冻结 `published_at` 与 `publish_generation=1`；
3. 插入唯一 Admin `published_projection`；
4. 从当前全部 PublishedProjection 计算下一代全量公开快照；
5. 插入唯一 `projection_outbox(operation_type=snapshot_sync,status=pending)`，内嵌同 ID/key/hash 的 TaskEnvelope；
6. 候选索引改为 `published`，写 operation receipt 与一条 audit event。

业务事务成功只表示“已发布到 Admin 写主，等待公开投递”。公开链接只有 receiver 回执 `active|superseded` 且公开 GET 200 后才显示为可用。批准和 publish 必须是两个独立用户动作；前端不得连续自动调用。

### 5.5 投递与对账

`projection_outbox` 状态固定：

```text
pending -> leased -> succeeded
pending|leased -> retryable_failed -> leased
leased -> reconcile_wait
reconcile_wait -> succeeded | retryable_failed | terminal_failed
pending|retryable_failed -> cancelled
```

- 同 `deliveryId + snapshotManifestHash` 重放返回同一收据。
- response unknown 只 GET 同一 delivery；确认未提交且预算/fence 有效才重投同一包。
- terminal/急停保留 Admin published fact 与 public last-known-good，不创建第二 publicId、Publication、Projection 或 generation。
- 任一业务/投递状态更新必须与对应 operation/audit 收据同一事务；状态分裂时整笔回滚。

## 6. 独立公开投影

### 6.1 公开记录 allowlist

每个 active record 只含：

```text
publicId, publishGeneration, projectionHash,
contentType=race_news, state=media_missing,
titleZh, summaryZh, publishedAt,
sourcePublishedAt, sourceTimeStatus=known,
source{sourceId=motorsport-f1-news,platform=rss,displayName=Motorsport.com,byline,accessStatus=available},
media=null,
originalLink{enabled=true,url=<validated canonical_url>,reason=null},
detail{leadZh=summaryZh,bodyZh=[summaryZh],keyPointsZh=[]}
```

真实原链只接受采集器已经验证的 HTTPS `www.motorsport.com`、空 userinfo、空端口或 443、无 fragment URL；公开页面使用普通外链并添加 `rel="noopener noreferrer"`。公开服务不抓文章页、不解析该链接、不代理正文。

### 6.2 全量快照与原子激活

沿用 accepted 双主机 `ProjectionPackageV1/ProjectionReceiptV1`：按 `publicId` Unicode code point 升序、全量 records、generation/previous hash、records hash、manifest hash、Ed25519 签名、staging+fsync+单次 active pointer swap。接收端没有 Admin 主库、Admin route、mutation credential 或签名私钥。

当前单 M1 第一版把 Admin sender 与 public receiver 分成两个 loopback 进程、两个系统资源根和两个服务身份；它们只经 `PUT /internal/projections/{deliveryId}` 与 receipt GET 交互。未来迁到独立 public-host 时只替换 receiver endpoint、mTLS/服务身份和部署 manifest，包、hash、generation、receipt、outbox 与业务 API 不变。

### 6.3 synthetic 保留与切换

- 现有 `public-multimedia-synthetic` SQLite 永久保持只读，不接收真实行。
- 新公开 reader 只读 active projection snapshot；没有 active snapshot 时返回合法 empty，不回退静态 Demo 或跨读 synthetic DB。
- 正式公开 origin 的切换只在至少一代真实快照 active、首页/详情候选均 200、回退入口已验证后执行。
- 回退只把公开 origin 切回上一精确 synthetic release 或上一 active snapshot；不回写、合并或删除私有审核事实。

## 7. Admin API v0.2

所有 JSON `additionalProperties=false`，所有 mutation 需要同源 session、精确 Origin、一次性 CSRF、operationId、expected CAS。队列/详情以 `candidateId` 为真实身份，避免把尚未保存的真实候选伪装成 Bundle。

| Method | Path | 作用 |
| --- | --- | --- |
| GET | `/api/admin/reviews` | 真实候选队列；cursor；默认 pending/source_updated/delivery_failed |
| GET | `/api/admin/reviews/{candidateId}` | 机器来源、人工工作副本、最新 Bundle/Decision/Publication/delivery、allowedActions |
| POST | `/api/admin/reviews/{candidateId}/revision` | 保存人工字段并创建新 Bundle |
| POST | `/api/admin/reviews/{candidateId}/approve` | 批准最新 Bundle并预留 queued Publication |
| POST | `/api/admin/reviews/{candidateId}/reject` | 拒绝最新 Bundle；原因必填 |
| POST | `/api/admin/publications/{publicId}/publish` | 第二次显式确认；提交 private Projection + snapshot outbox |
| GET | `/api/admin/operations/{operationId}` | response-loss/503/刷新后对账同一业务 operation |
| GET | `/api/admin/deliveries/{deliveryId}` | 查询同一投递与 public active receipt |

### 7.1 读取 DTO

队列 item 固定：

```text
candidateId, sourceId, sourceRevision, editorBasedOnSourceRevision,
sourceTitle, titleZh?, summaryZh?, sourceAuthor?, sourcePublishedAt,
sourceDisplayName, originalUrl, mediaState="none",
reviewState, latestBundle{id,revision,versionTag}?,
decision?, publication?, delivery?, updatedAt, allowedActions[]
```

详情只增加 `sourceExcerpt`、`editorNotes`、完整的 bundle/decision/publication/delivery receipts 和 `integrity`。客户端 Bundle CAS 只使用从已复验完整 Bundle hash 截取的 12 位小写十六进制 `versionTag`；完整 64 位 hash 只在服务端存储、复算和关联，不进入 URL、页面正文或日志。

`allowedActions` 只作提示，服务端 mutation 必须重新计算。状态与动作固定：

| 派生态 | 动作 |
| --- | --- |
| `pending_review` | revision；已有当前 Bundle 时 approve/reject |
| `source_updated` | 只允许基于新 sourceRevision revision |
| `approved_waiting_publish` | 只允许 publish |
| `rejected` | 返回队列；需要重开须先 revision 生成新 Bundle |
| `published_delivery_pending` | 查 delivery |
| `published` | 打开公开页、返回队列 |
| `reconcile_wait` | 查同 operation/delivery；禁止新 publish |
| `terminal_failed/emergency_stopped/blocked` | 固定原因与恢复出口；无弱校验 mutation |

### 7.2 Mutation DTO

```text
RevisionRequest {
  schemaVersion:"admin-review-v0.2", operationId,
  expected:{candidateId,sourceRevision,sourcePayloadHash,latestBundleId?,latestBundleVersionTag?},
  editable:{titleZh,summaryZh,notes}
}

ApproveRequest|RejectRequest {
  schemaVersion:"admin-review-v0.2", operationId,
  expected:{candidateId,sourceRevision,bundleId,bundleVersionTag}
  // Reject additionally: reason
}

PublishRequest {
  schemaVersion:"admin-review-v0.2", operationId,
  expected:{publicId,publishGeneration,publicationStatus:"queued",approvedBundleVersionTag}
}
```

成功响应返回 operation receipt 与当前 candidate/Bundle/Decision/Publication/delivery 的闭合子集。PublishSuccess 的状态固定为 `delivery_pending|active`；只有 `active` 返回可打开的 `publicPath`。

### 7.3 固定错误

| HTTP | reasonCode | 恢复 |
| ---: | --- | --- |
| 400 | `ADMIN_REQUEST_INVALID` | 修正闭合输入 |
| 401 | `ADMIN_SESSION_REQUIRED` | 重新认证 |
| 403 | `ADMIN_ORIGIN_REJECTED` / `ADMIN_CSRF_REJECTED` / `ADMIN_REAUTH_REQUIRED` | 重新取得当前会话/nonce/fresh auth |
| 404 | `REVIEW_CANDIDATE_NOT_FOUND` / `PUBLICATION_NOT_FOUND` / `ADMIN_OPERATION_NOT_FOUND` | 回列表或读取当前对象；不盲重放 |
| 409 | `REVIEW_SOURCE_STALE` / `REVIEW_BUNDLE_STALE` / `REVIEW_DECISION_CONFLICT` | 放弃旧 expected，加载当前状态 |
| 409 | `PUBLICATION_RECONCILE_WAIT` / `DELIVERY_RECONCILE_WAIT` | 查同 operation/delivery |
| 422 | `REVIEW_CONTENT_INVALID` / `REVIEW_REASON_REQUIRED` | 保留表单、修正字段 |
| 503 | `ADMIN_STORAGE_BUSY` / `ADMIN_BACKUP_STALE` | 先查 operation；RPO breach 时 mutation 保持关闭 |

错误不含 SQL、stack、绝对路径、cookie、CSRF、完整 hash、feed 正文、私有备注或内部拓扑。

## 8. 私有入口与双端边界

- 后端第一切片只绑定 loopback，并复用现有 local Admin session/Origin/CSRF 组件；它用于建立数据库与 API 真值。
- 正式 Mac/iPhone 入口仍须经同一私有 overlay origin、用户+设备认证、passkey/session 与同源 CSRF；publish 需要 5 分钟内 fresh re-auth。两端调用相同 API、拥有相同动作与恢复能力。
- iPhone 可以改为单列队列→详情，Mac 可以双栏；任何端都不能删除 revision/approve/reject/publish/operation/delivery 恢复。
- public-host 的公网路由只有公开 GET；`/admin`、Admin API、私有主库和 mutation credential 数量固定为 0。
- `backupAge≥15m`、时钟不可信、唯一写主无法证明或旧主未 fence 时，revision/approve/reject/publish 全部关闭；公开 last-known-good 继续只读。

## 9. 第一开发任务与实施波次

### 9.1 `DEV-REAL-REVIEW-BE-01`（立即可开工）

涉及 Function ID：`ADMIN-PROFILE-001`、`ADMIN-SEC-002`、`ADMIN-QUEUE-003`、`ADMIN-EDIT-004`、`ADMIN-APPROVE-005`、`ADMIN-REJECT-006`、`ADMIN-PUBLISH-007`、`ADMIN-RECOVER-008`、`RECOVER-ADMIN-004`。

允许改动：

```text
app/migrations/rss-real/0002_admin_review_publish.sql
app/src/server/review-real/**
app/src/app/api/admin/reviews/**
app/src/app/api/admin/publications/**
app/src/app/api/admin/operations/**
app/src/app/api/admin/deliveries/**
app/scripts/review-real-*.ts
app/src/tests/review-real*.test.ts
```

可复用：Node24 `node:sqlite`、现有 RSS DB/path/profile guard、`canonicalJson`、source-management 的 Admin session/CSRF 原语、Node `crypto`。不得新增 npm 依赖。

验收出口：

1. 在任务专用私有 DB 副本上只追加 migration；20 条现有候选可列出，原三表内容与 collector 约束不漂移。
2. revision/approve/reject/manual publish/operation/delivery 的真实 Route Handler 与 Repository 可执行；approve 精确 `1 Decision + 1 queued Publication + 0 Projection/Outbox`。
3. 手动 publish 精确 `1 PublishedProjection + 1 snapshot outbox`，批准步骤无法触发它；auto-publish 入口计数为 0。
4. same operation/body 重放收据相同；same operation/different body、stale source/bundle、并发决定、response unknown、DB busy 均零重复身份。
5. 公开 snapshot 记录 0 图、真实原链 allowlist、私有备注零泄露；现有 public synthetic DB SHA/count 零漂移。
6. 后端完成不包含 `/admin/reviews` 页面/UI/CSS，也不把本地 fixture 测试写成真实双端完成。

失败路径：migration/hash/profile 不符写前停止；来源 revision stale 时零决定/发布；跨 DB/接收器结果 unknown 只留同一 outbox/reconcile key，禁止直接写 public active 根。

### 9.2 后继波次

1. `DATA-REAL-REVIEW-MAP-01`：把本合同 11 类 Admin DTO 与七表/现有 candidate 做机器 mapping/validator；不能新增同义字段。
2. `DEV-PUBLIC-SNAPSHOT-01`：实现 ProjectionPackage/Receipt、loopback receiver、active pointer 与 public snapshot Repository；不做公网切换。
3. `SEC/TEST-REAL-REVIEW-01`：同一 hash 对 session/CSRF/CAS、SQL/HTML/URL、幂等、投影原子性、私有字段泄露与 synthetic 零漂移做独立验收。
4. `DESIGN-ADMIN-REVIEWS-01`：吸收现有候选，补真实 RSS 字段、source_updated、delivery_pending/failed 与 Mac/iPhone 全能力证据，冻结不可变 hash 后交用户确认。
5. `DEV-ADMIN-REVIEWS-UI-01`：只在用户确认视觉后实现页面；高度贴合冻结设计。
6. `OPS-REAL-CUTOVER-01`：至少一代真实快照 active、公开候选首页/详情 200、回退 PASS 后，才把正式公开 origin 切到 snapshot reader。
7. `OPS-ADMIN-PRIVATE-01`：production deployment manifest 获批后配置私有 overlay、强认证、Mac/iPhone、备份/监控与实机 RPO/RTO。

## 10. 最小验收与回退

### 10.1 必须验收

- 未保存候选、已保存 Bundle、批准、拒绝、publish delivery pending、active、source_updated、stale/conflict、reconcile、terminal、empty/error/partial 都有固定 API 状态和唯一恢复动作。
- 任一公开记录都能由 `candidate → bundle → decision → publication → private projection → active snapshot record` 完整追溯，hash 全部匹配。
- 未批准、被拒绝、source stale、Bundle stale、private notes 不完整、链接 host 不匹配、投影 hash/签名/generation 不一致的记录均不进入 active。
- 公开 `/` 和 `/stories/{publicId}` 只读 active snapshot；删除公开副本不改变私有主库；重新投递同一签名全量快照可重建。
- 用户从 Admin 手动发布后，只有 active receipt 才看到公开详情 200；原文链接精确回到 Motorsport.com；媒体为空时页面无破损图片。

### 10.2 回退

- Admin backend 失败：卸载 Admin/review 服务，保持 RSS 采集与私有候选；公开 synthetic Beta 不变。
- publish 或 delivery unknown：保持同一 Publication/publicId/outbox；公开 last-known-good 不变。
- public reader/cutover 失败：切回上一精确 synthetic release 或上一 active snapshot；不删除私有决定/Publication。
- migration 失败：写前失败关闭；已经提交 migration 时保留 DB，由上一 release 只读隔离，禁止 down migration 或手工删表。
- 自动发布、公开 Admin、第二写主、ATTACH/跨库事务、真实媒体任一被检测到：立即停相应服务并回到 last-known-good。

## 11. 视觉门

现有候选身份：

- `design/ui/F1+1-M5-admin-reviews-preview-v0.1/index.html`
- SHA-256 `fa0ef6e31fe889abea39e6bbcb3a9d7c5764a17f364e1d409bc4defce879113e`

它仍是 synthetic 交互候选，缺少真实 RSS 的 `candidateId/sourceRevision/source_updated/delivery` 状态及四张正式 PNG。设计部须形成 successor，绑定 1440/1024/390 × 深浅主题和 Mac/iPhone 全动作；用户确认前，后端可以实施，正式页面/UI/CSS保持关闭。
