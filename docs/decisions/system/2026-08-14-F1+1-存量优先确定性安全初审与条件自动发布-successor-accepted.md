---
type: system_adr
status: accepted
date: 2026-08-14
department: 产品部
decision_id: ADR-M5-BACKLOG-AUTO-PUBLISH-001
authorization_state: user_confirmed
authorization_evidence_ref: 2026-08-14 当前主会话用户消息，message ID unavailable
related_audit: scratch/TASK-20260814-AUTO-PUBLISH-GAP/audit.md
related_audit_sha256: b989068960bb02d98b6e3f7565eef2f9587b9e4f15b41a35d9ac6a39090d4f88
implementation_state: contract_accepted_code_pending
runtime_phase: disabled
source_scope: existing_allowlisted_sources_only
---

# ADR-M5-BACKLOG-AUTO-PUBLISH-001：存量优先的确定性安全初审与条件自动发布 successor

## 决定

接受一条窄的系统发布路径：仅对现有白名单信源中，已经现行确定性安全初审通过，且当前来源版本、完整 hash、最新 Bundle、approved Decision 和 queued Publication 全部精确绑定的候选，固定 actor `system-auto-publish-v1` 才可以在单一 SQLite 事务中完成 CAS 发布，创建一份全量 snapshot 和一条 outbox。

系统发布路径不会创建或改写 revision、ReviewDecision 或 queued Publication，不会调用可“修订 + 批准 + 发布”的人工 `releaseNow` 能力，不会生成、伪造或复用 WebAuthn fresh receipt。Admin 中的人工“通过并发布”、“手动发布”、correct、withdraw，以及 `start_backlog|enter_live|pause|resume_backlog|resume_live|stop` 全部 phase control，只能由 manifest 唯一 operator 经真实 `HTTP POST`、session/Origin/CSRF 与 fresh WebAuthn 发起；`system-auto-publish-v1` 和 `system-auto-review-v1` 均不能执行 control、改变 phase 或改写 stop fence。

首次启用必须先处理冻结 cutoff 内的存量。`phase=backlog|paused` 时，collector 在 DNS、socket 或任何 HTTP 外联之前以稳定原因返回，精确保证 `externalCalls=0`。存量清零、全部阻断项清障、最新 outbox 已成功后，单一事务才可切到 `live`；采集只在此后下一个自然 `900s` 调度点恢复，不做人工补抓。

本决定只接受合同。当前应用、M1 SQLite `user_version=4`、M1 服务与现行人工发布运行态均未被本任务修改；新控制面默认 `disabled`，不得把文档的 `accepted` 写成已实现、已部署或已启用。

## 精确取代范围

旧文件保留审计原文。下表之外的安全、数据、投递和回退条款全部继续有效。

| 现行文件 / 条款 | 本 successor 精确取代的语义 | 继续有效的语义 |
| --- | --- | --- |
| `ADR-M5-RSS-REAL-001` §8 对“自动审核、自动发布”的全量排除 | 只对已入私库、当前版本且满足本决定门禁的候选，允许确定性初审和条件系统发布 | 固定 URL、DNS/HTTP/XML 输入安全、1 MiB、60→20、条件请求、单源和采集事务全部保留 |
| `ADR-M5-REAL-PROJECTION-RUNTIME-002` 的“第二次显式手动 publish 才可建立 outbox”与 §未变更边界中“自动发布不在本决定内” | 新增受本决定全部 CAS/阶段/停止门约束的 `system-auto-publish-v1` 内部路径 | 人工 publish 的 fresh WebAuthn、single sender、签名全量快照、generation 1 bootstrap、receipt 对账与 public active reader 全部保留 |
| `ADR-M5-REAL-PROJECTION-RUNTIME-003` §为什么必须独立 successor 和 §未变更边界中的 `auto-publish=0` / “自动发布继续关闭” | 仅取代自动发布为 0 的业务边界 | 四根解耦、唯一 review DB existing-only、禁止复制/`ATTACH`/双写、prepare/load/cutover 和回退顺序全部保留 |
| `F1+1-真实RSS人工审核与公开投影最小实施合同-v0.1.md` frontmatter `auto_publish: forbidden`、§1 手工唯一主链、§3.2 自动发布排除、§5.4 唯一手工 publish、§10.2 “检测到自动发布即停止” | 自动语义改为“默认 disabled，仅本 successor 的系统路径可条件开启” | revision/approve/reject 与人工 publish API/DTO、人工 fresh WebAuthn、不可变 Decision/Publication、公开投影和回退语义保留 |
| `docs/spec.md` 中“未经人工发布确认不得公开”、“自动发布待用户确认”和“自动发布保持关闭” | 已获得窄范围条件授权；实现、迁移、备份、停止和上线验收未闭合时运行态继续 `disabled` | 所有人工发布按钮仍需 fresh WebAuthn |

`ADR-M5-REAL-REVIEW-PUBLISH-001` 已被 002 取代，只作历史证据；本决定不再修改它。synthetic local-dev 人工审核合同的作用域也不变。

## 初版安全范围

初版“确定性安全初审”只包含：

1. 现有 closed DTO / strict schema 校验，拒绝 unknown key、缺失必填字段、非法长度或类型。
2. 当前来源必须是已启用且在显式 allowlist 中的精确来源；未知来源、未知来源版本或未知 payload hash 全部 fail closed。
3. 现有 canonical URL / HTTPS / source URL 门，以及现有媒体身份机械门：`rss_media_candidate` 的 candidate/source revision/full hash、HTTPS URL、MIME 闭集、declared bytes 与 Bundle `media[]` 精确绑定。当前 v4 没有 rights/license/policy 的机器可判定字段；因此只有“当前 source revision 无 media candidate 且 Bundle 为精确 0 图”可在初版对 media/policy 通过。任何非空 media 都进入 `MEDIA_POLICY_UNKNOWN`/`waiting`，在单独 accepted 的机器可判定媒体政策 successor 实现前不得自动发布。任一 URL、media identity 或 policy 结果为 unknown/missing/mismatch 时 fail closed。
4. 在标题、摘要、要点和可公开文本中拒绝 ASCII C0 `U+0000–U+001F`、DEL/C1 `U+007F–U+009F`、bidi controls `U+202A–U+202E` 与 `U+2066–U+2069`。

该门禁不宣称完成事实核查、新闻准确性验证、版权/合法使用判断、仇恨/暴力/成人/违法语义分类或广义内容审核。任一新范围都要单独冻结可测规则、错杀/漏放处理与启用门，本决定不予推导。

## 控制面与存量顺序

- 唯一 singleton 控制面使用 `phase=disabled|backlog|live|paused`，默认 `disabled`；同时固定 `policy_epoch`、`backlog_cutoff_at`、`max_batch=20`、`updated_at`。`max_batch` 一直限于 `1..20`。
- v5 唯一新持久表是上述 singleton。现有 `review_decision` 不追加 `policy_epoch` 列，也不新建 Decision-policy 绑定表；系统发布事务直接 CAS singleton 的当前 epoch，重跑当前初审闭集，并把 epoch 写入操作/audit payload。
- `0005` 必须把现有 `admin_operation` 收敛为八个 operation type `revision|approve|reject|publish|correct|withdraw|auto_publish_control|auto_publish_batch` 与四个且仅四个 channel：`http_post|internal_auto_review|internal_auto_publish|legacy_http_shaped_unknown`。新写的 closed union 只有四组：人工 `revision|approve|reject` 为 `http_post + manifest operator`；人工 `publish|correct|withdraw|auto_publish_control` 为 `http_post + manifest operator + fresh evidence`；自动初审 `revision|approve|reject` 为 `internal_auto_review + system-auto-review-v1`；自动发布批次只有 `auto_publish_batch + internal_auto_publish + system-auto-publish-v1`。所有 row 均持久化非空 operation actor并与 receipt/result 逐字相等；发生领域 mutation 或 batch result 时，同事务 AuditEvent actor也必须相等，failed HTTP/auto-review 不伪造成功领域 event。`controlAction` 只在 control 非空。只有 `revision|approve|reject` 具有表内列出的人工 HTTP 与自动初审两种合法形态；其余 type/channel/actor 任一交叉组合全部拒绝。两个 system actor 都是 server-owned literal，不接受调用参数、环境变量或请求覆盖。
- `http_post` 必须持久化精确 `POST`、operation-specific path 和 `200..599` HTTP status，使用 closed HTTP OperationReceipt。现行 path 闭集为 `/api/admin/reviews/{candidateId}/revision|approve|reject`、`/api/admin/publications/{publicId}/publish` 与 `/api/admin/reviews/release`；successor 追加 `/api/admin/publications/{publicId}/correct|withdraw` 和唯一 phase 路由 `/api/admin/auto-publish/control`。两个 internal channel 的 `http_method/request_path/http_status` 全部为 null，也不写 HTTP response DTO，改写 closed internal result status `succeeded|failed|blocked|no_work` 和 strict DTO/hash。internal actor 不接收或持久化 fresh receipt。
- 所有 pre-v5 `admin_operation` 迁移后统一标为 `legacy_http_shaped_unknown`，保留每个旧字段的原值，并明确旧 `POST/path/http_status` 只证明历史行长成 HTTP 形状，不能证明真实网络请求。现有 `system-auto-review-v1` 旧行也保持该 provenance；v5 后禁止新插入 legacy channel。
- `0005` 需在同一 `BEGIN IMMEDIATE` 中重建 `admin_operation` 与作为其 FK 子表的 `audit_event`，再恢复索引/immutability/append-only/closed-union triggers。当前 audit hash 精确只覆盖 canonical `event_json` 与 `previous_event_hash`，没有覆盖 `admin_operation` 整行或 SQLite 物理页；迁移逐列复制全部旧 operation 值，并对 TEXT/BLOB 执行 `hex(CAST(column AS BLOB))`、对 INTEGER 执行 storage class + value 的前后相等门，同时逐列复制旧 audit 的 ID、`audit_seq`、actor、event JSON、previous/event hash 与时间，禁止重算或改写既有 hash。表重建会改变 schema、record layout 与数据库物理字节，本决定不宣称零字节变化；只允许声明旧列 value bytes/storage class、现有 canonical event hash chain、FK 与顺序相等。
- 新高风险 HTTP operation 必须在不可变 operation row 中持久化 strict fresh binding JSON/hash：绑定 `operation_id/type`、manifest operator actor、request/resource hash、fresh action、现有已验证 fresh record 的不透明 64hex evidence ref、verified/expires 时间；原始 receipt、session、CSRF、challenge 与 credential 不落库。security 层从当前 issued fresh record 生成 server-owned 授权对象，高风险 repository 入口不接收可独立传入的 actor/fresh/time 字段，并在业务 mutation 同一 DB 事务持久化 binding/operation/audit。`auto_publish_control` 还必须把 `start_backlog|enter_live|pause|resume_backlog|resume_live|stop` 六值之一作为 `controlAction` 同时绑定进 request/resource hash、fresh action 和 phase-change audit，其他高风险 operation 的 `controlAction=null`。对应 primary AuditEvent 的 actor 必须与 operation actor 相等。缺失、过期、重放、actor/action/controlAction/resource/request 任一不一致时 operation/phase/publication 增量为 0。
- `audit_event` 的 closed enum 追加 `publication_corrected|publication_withdrawn|auto_publish_phase_changed|auto_publish_batch_completed|auto_publish_batch_failed` 与 `auto_publish_policy|auto_publish_batch`，继续使用同一主账。`auto_publish_phase_changed` 只允许指向 fresh 的 `http_post/auto_publish_control`；batch completed/failed 只允许指向 `internal_auto_publish/auto_publish_batch`。
- `disabled → backlog` 要求当前 Admin 授权会话和 fresh WebAuthn、唯一 DB identity/integrity 及 RPO 备份门全部通过。切换必须在唯一 review DB 的一个 `BEGIN IMMEDIATE` 中取得 writer lock，并在该同一事务内重读 singleton 的 `phase=disabled`、预期 `policy_epoch` 与受控 source fence，证明本 epoch 全部受控 source 没有 `ingest_run.status='running'`，随后一起写入不可变 `backlog_cutoff_at`、`phase=backlog` 和 phase-change AuditEvent。发现任一 running slot 时整个事务回滚，phase/cutoff/成功 audit 均不得部分落盘；切换事务不得持锁等待该 slot 结束，只能在 slot 已提交终态后重试。
- collector 的 claim 必须在它自己的 `BEGIN IMMEDIATE` 中先读同一 singleton，再检查 source/旧 slot 或插入新 `running` slot。读到 `backlog|paused` 时不得插入 running slot，并在 DNS/socket/HTTP 前分别返回 `BACKLOG_DRAINING` 或 `AUTO_PIPELINE_PAUSED`，`externalCalls=0`；singleton 缺失、非法或不可判定同样 0 slot/0 外联 fail closed。读到 `disabled|live` 且其余现行采集门通过时才可插入 running slot。phase 切换与 claim 由同一 SQLite writer lock 串行：已在 `disabled` claim 的 collector 会阻止切换成功直到其 slot 提交终态；切换先提交时，随后 claim 必须看见 `backlog` 并零 slot、零外联退出。
- backlog 范围由现有候选 `first_seen_at <= backlog_cutoff_at` 推导，不新建第二工作队列；处理顺序固定为 `first_seen_at ASC, published_at ASC, candidate_id ASC`，不经由 newest-first `list()` 或 raw queued Publication 扫描。
- `rejected` 是已处理终态，原因和 AuditEvent 永久保留。cutoff 内任一 `waiting|manual_override|failed|pending_review|source_updated|approved_waiting_publish|reconcile_wait` 或未成功 outbox 都阻止 `live`。人工恢复拒绝项后，该项重新进入未清障集合。
- `paused` 阻止新的 review/publish 批次，同时保持 collector 零外联；已有 outbox 可以且只可以按同一 delivery reconcile。任何进入、离开或改变 phase 的动作，包括一键急停、stop、resume 和 `backlog→live`，都只能由 fresh WebAuthn 的 `http_post/auto_publish_control` 发起。内部批次失败只写 closed failure result/audit并依靠现有 blocker fail closed，phase 保持原值，等待 operator 控制。
- `policy_epoch` 在安全规则、allowlist、batch 上限、新 cutoff campaign 或任何会改变准入结果的配置变更时单调增加。纯暂停/恢复可保留同一 epoch，但恢复前必须重新验证备份、完整性、停止 fence 和未决 outbox。

## 系统发布不变量

1. 选择从当前 candidate 出发，不扫描 `publication_status='queued'` 原始行。历史 queued Publication 不因状态值被推导为当前可发布。
2. 同一 `BEGIN IMMEDIATE` 事务重算并比对：当前 source id/revision/full payload hash、latest Bundle id/version/full hash、最新 immutable approved Decision 及其 `decision_id + bundle_id + approved_bundle_hash` 绑定、唯一 queued Publication/publicId/generation/key、当前 `policy_epoch/phase/cutoff`、source enabled/allowlist/stop fence、确定性安全规则和上一 outbox 状态。Decision 本身不新增 epoch 字段；当前 epoch 在同一发布事务独立 CAS 并写 audit payload。任一 stale/unknown/missing/mismatch 均在投影前 fail closed。
3. actor 固定为 `system-auto-publish-v1`，只能以 `internal_auto_publish/auto_publish_batch` 发布已审批且当前的项目；每批 `1..20`。它不提供 HTTP route，不接收浏览器 session/CSRF/Origin/Passkey 输入，不写 fresh receipt，也不能创建 `auto_publish_control`、改变 phase 或改写 stop fence。
4. 一个批次只创建一份全量 snapshot 和一条 outbox。前一 outbox 必须 `succeeded` 或根本不存在；必须串行，不可并发建 snapshot。
5. receiver 响应不确定时，只使用同一 delivery receipt GET 对账；明确 404 才可以重投同一签名 package。不增加 publicId、generation、snapshot 或 outbox。公开站始终读取 last-known-good active snapshot，损坏时 fail closed。
6. 系统发布前必须满足唯一 review DB 精确 path/dev/inode、`database_list=main,temp`、无 `ATTACH`、单 writer、`integrity_check=ok`、恢复 fence 与 `backupAge<15m`。迁移为 additive `user_version 4→5`，回退不执行 down migration。

## 回退、恢复与多源兼容

- 回退第一步固定为由 operator 通过 fresh WebAuthn 的 `http_post/auto_publish_control` 将 `phase` CAS 到 `paused`。若 fresh 控制入口不可用，先 unload 自动 reviewer/publisher/collector 进程并保持公开 last-known-good，恢复 fresh 控制后再持久化 paused；system actor 不代写 phase。保留 Decision、Publication、Projection、snapshot、outbox、reason 与 AuditEvent；已存在的 pending/reconcile outbox 沿同一 delivery 收敛。
- 可回到现行 manual-only Admin runtime，v5 附加控制表保留且被旧代码忽略。若代码回退会丢失 collector guard，必须先 unload collector，完成人工核验后才能恢复。
- 全量公开 snapshot 的 identity/key 必须与单一 source 无关：沿用现有 `snapshotManifestHash=hash(generation, previous manifest hash, ordered full records hash/count)` 和 `deliveryId=op-snapshot-${snapshotManifestHash}`；v5 outbox 的唯一 idempotency key 固定为 `snapshot-sync:${policyEpoch}:${snapshotManifestHash}`，取代现行单源 `stop_epoch` 嵌入键的做法。键不包含 Motorsport、`source_id`、源数量或任一单源 stop epoch；每源 stop fence 只作发布事务 CAS。这保持“全站一份快照”的唯一语义，也继续满足 receiver 对 idempotency key 以 manifest hash 结尾的现行校验。
- 每个 source 在终端发布 CAS 前都要重读其独立 enabled/allowlist/stop fence。未来新源必须先获得单独 accepted source 注册与政策；一个 source 的停止 fence 只阻断该 source 的新发布，不改写 snapshot key schema，不自动开启新源。
- 本文的“未来 v5 多源”是产品演进标签，没有预留第二个 SQL `user_version=5`。当前仓库的 rss-real migration 精确只到 `0004`，所以本 successor 占用 `0005/user_version=5`。如果实施前其他 accepted migration 先占用 5，本合同必须通过新 successor 重编号，不合并同号 migration，不覆写已用版本。

## 启用与验收门

1. 精确 release manifest、唯一 DB identity/schema/integrity、一致性备份和 `RPO≤15m` 完成；旧 manual runtime 回退命令已验证。
2. v5 additive migration、phase-aware reviewer/refiner selector、collector pre-network guard、approved-only system publisher 和停止开关的同一候选通过独立安全/测试门。
3. 以 `phase=disabled` 部署；只读生成 cutoff 预览后，由 manifest operator 用 fresh WebAuthn 的 `POST /api/admin/auto-publish/control` 显式进入 `backlog`。后续 `backlog→live`、pause/resume/stop 同样使用该唯一 HTTP fresh control；事务内重算只决定能否提交，不能替代人工授权。当日 M1 运行计数必须现场重读，本 ADR 不把审计时的瞬时数量固定为部署输入。
4. 用 barrier 强制验收两种 writer-lock 先后次序：collector claim 先取得锁并提交 running slot 时，`disabled→backlog` 必须整体失败并保持 disabled，直到该 slot 终态后重试才成功；phase 切换先取得锁并提交 backlog/cutoff/audit 时，随后 claim 必须插入 0 个 running slot并在网络前以 `externalCalls=0` 退出。
5. backlog 期间证明 collector 在 DNS/socket 前停止且 `externalCalls=0`；每批最多 20，一份 snapshot/outbox，上一 outbox succeeded 后才进入下一批。
6. cutoff 内未决集合为 0，拒绝原因仍可回读，最新 outbox succeeded，再用单一事务切 `live`；只观察下一个自然 `900s` 周期。
7. 真实公开 feed/detail 只读同一 active generation，新批次失败时仍返回上一份可验签快照；Admin/internal 路由公网不可达。
8. closed-union 负例必须逐项写前拒绝：internal control、HTTP batch、system actor control、operator 冒充 system、auto-review actor 使用 HTTP、auto-publish actor 写 review operation、internal 任一 HTTP 字段非 null、HTTP 缺 method/精确 path/status或使用 internal DTO、高风险 HTTP 缺失/错绑/过期/重放 fresh evidence、phase 前后值与 controlAction 不相容或跨 action 重放，以及迁移后新写 legacy channel。

## 授权证据和证据强度

宿主未提供单条 message ID，因此本决定只如实记为“2026-08-14 当前主会话用户消息，message ID unavailable”。用户原文为：

1. “满足安全、内容质量等规则后自动发布”。
2. “开始搭建自动初审流程，目前的审核规则可以尽量简化，排除掉有安全问题的信息就可以，但目前录入的信源应该都没有这些低级问题，后续可以根据信息分布进行微调规则”。
3. “第二吧，后续没什么问题的话可以直接自动发布”。
4. “先处理现有的，然后再继续处理新抓取内容”。
5. “可以，而且把打回拒绝的内容记录到后台，我要回看原因”。
6. 用户随后回答“保留”。

这些证据足以冻结窄范围初版、存量优先、条件自动发布和拒绝留痕。它们不足以支撑广义事实核查、版权判断、语义内容安全覆盖，也不等于已实现、已部署或已打开运行开关。
