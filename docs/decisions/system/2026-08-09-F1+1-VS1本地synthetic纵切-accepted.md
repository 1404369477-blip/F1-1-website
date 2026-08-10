# ADR-M5-VS1-LOCAL-PIPELINE-001：本地 synthetic 采集、内容处理与 mock 中文摘要纵切

- 状态：`accepted`
- 日期：2026-08-09
- 决策范围：`COLLECT-MOCK-002`、`CONTENT-PROCESS-003`、`SUMMARY-MOCK-004`
- 授权证据：`docs/spec.md` 既有用户确认、`COR-20260809T102214-960E65`、`TASK-20260809-B10D8D` ACK、`TASK-20260809-3AC51E`
- 实施合同：[F1+1-VS1本地synthetic纵切实施合同-v0.1.md](../../spec/F1+1-VS1本地synthetic纵切实施合同-v0.1.md)

## 1. 决策

接受一条仅在本地、仅由固定 synthetic fixture 驱动、`externalCalls=0` 的纵向切片：

1. `npm run worker:mock -- --once` 每次至多租约并处理一个到期的 collection operation；
2. adapter 只从随代码版本化的 fixture registry 读取至多一个 observation/candidate，禁止网络、DNS、真实 provider 与任意 URL 抓取；
3. 同一结果事务内完成 observation/inbox、CapturedItem、确定性 normalization、内容幂等、Event dedupe、低质量/F1 相关性门禁、确定性 Summary、immutable ReleaseBundle、Outbox/attempt 与一条脱敏 AuditEvent；
4. 合格且成为 Event canonical 的唯一 Content 才生成 `Summary(summary_status=ready)` 与 `ReleaseBundle(release_status=ready, immutable=true)`；人工审核、批准和发布均不在本切片内；
5. 运行后只以本地 operator receipt 验收。Admin 页面、真实 provider、RSS、Base、自动发布、外部发布、部署与生产存储继续关闭。

本决策不新增领域实体。领域对象继续使用 `Source`、`CapturedItem`、`Content`、`Event`、`Summary`、`ReleaseBundle`、`OutboxJob`；`TaskEnvelope` 继续是既有机械消息合同；`SourceObservation`、`AuditEvent` 及 inbox/attempt/dead-letter/receipt 继续是 internal-only 运行记录。

## 2. 唯一选择

采用“单进程、单个任务隔离 SQLite、固定 fixture registry、一次一个 operation、一个原子结果事务”的方案。任务隔离数据库只用于该纵切开发与验收，不加入公开或 Admin runtime profile allowlist，不成为业务真值，也不回写 `m3-shadow`、`public-synthetic`、`public-multimedia-synthetic` 或未来 `review-synthetic`。

拒绝以下实现：

- 连接真实 URL、真实 provider、RSS 或 Base 来证明采集；
- 用内存数组、静态页面数据或第二套领域 schema 绕过既有 SQLite/领域合同；
- 把 `SourceObservation`、`AuditEvent`、receipt、quality decision 或 SummaryDraft 新建为领域实体；
- 用随机摘要、运行时大模型、外部翻译或开发者临时文案生成中文摘要；
- 在低质量/不相关内容上先落 Content 再补过滤状态；
- 将 `pending.mjs`、`NOT_RUN`、静态代码存在或测试计划视为实现完成。

## 3. 兼容性裁决

### 3.1 内容与 Event 去重

内容重投先按既有 content-ingest key `(platform, source_id, external_content_id, content_version_hash)` 返回原 Content，不产生第二 Content、Event member、Summary 或 Bundle。

跨身份但语义相同的合格内容继续各自保留 Content 证据，并按 `event-dedup-v1` 合并到同一 Event；`canonical_content_id` 按 `(content_id, content_version_hash, capture_id or "")` 的 Python 字符串/Unicode code point 升序取第一项。只有 canonical Content 拥有当前 ready Summary/Bundle。若新 member 改变 canonical，旧 ready Summary/Bundle 转为 `superseded`，为新 canonical 创建新 ready Summary/Bundle；若旧链已出现 `approved` 或后续状态，本地 worker 以 `APPROVED_CHAIN_PRESENT` 失败关闭，不改 ReviewDecision、Publication、Projection 或其关联对象。

`dedup_fingerprint` 使用既有 `event-dedup-v1`：对 `content_kind`、`language`、`normalized_body`、`normalized_title`、`published_day_utc` 的 `canonical-json-v1` 字节做 SHA-256。碰撞复核通过读取现有 canonical Content 并重建精确 canonical input bytes；缺行、不可重建或相同 hash 不同 bytes 时 Event 置 `needs_review`，本次 Summary/Bundle 零写入。无需新增 fingerprint input 字段。

### 3.2 低质量过滤

低质量与 F1 无关判定只对固定 synthetic 标记生效，并在 Content 插入前完成。被过滤的 candidate 可保留 CapturedItem 与一条脱敏 AuditEvent；Content、Event、Summary、ReleaseBundle 均为零新增。真实内容的质量模型、词表或自动判断仍未获授权。

### 3.3 retry 与 dead-letter

自动尝试固定为最多 3 次、等待 `1s/3s`、无 jitter；每次复用 operation/idempotency key，取得新 lease 并重验五 fence。collection outcome 已知，因此禁止使用 Publication 专用 `reconcile_wait`。

到达 dead-letter 后，本切片不实现原 job 的人工 requeue。operator 恢复只允许清理并重建任务隔离数据库，再由固定 seed 产生新 operation/key；旧 dead-letter 审计留在被归档的任务库。由此不扩写当前通用 outbox machine 的 `dead_letter → pending` 守卫，也不让开发在“复用旧 key”与“创建新 key”之间自行选择。

## 4. 状态与完成口径

本 ADR 只接受实施判断和边界，未声明代码已经实现。三个 Function ID 在开发、测试与安全运行证据齐全前继续是 `P1-blocker`。正式完成必须同时满足实施合同全部 mandatory 命令、固定 fixture、失败恢复、`externalCalls=0` 与无占位脚本检查。

## 5. 变更规则

下列变化必须新建 successor，不得原地扩张本 ADR：真实 provider/RSS/Base/网络、Admin 可见或 mutation、自动或外部发布、部署/生产存储、新领域实体、新质量模型、修改通用状态机、将任务数据库加入业务 runtime profile。
