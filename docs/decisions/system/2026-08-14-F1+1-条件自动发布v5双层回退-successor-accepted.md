---
type: system_adr
status: accepted
date: 2026-08-14
department: 产品部
decision_id: ADR-M5-BACKLOG-AUTO-PUBLISH-002
authorization_state: inherited_user_confirmed_scope_no_new_choice
authorization_evidence_ref: 2026-08-14 当前主会话用户消息，message ID unavailable
implementation_state: contract_accepted_code_pending
runtime_phase: disabled
supersedes_decision_id: ADR-M5-BACKLOG-AUTO-PUBLISH-001
supersedes_scope: v5迁移、启动、代码回退、灾难恢复与再升级语义
predecessor_adr_sha256: 59302394fe76f9dfbea32ab054b1969ca3b5d0f15bd55ffb09f98520f209a298
predecessor_contract_sha256: 633babb5949562b51a8cd57621538ca9d09136e0eb49e7cfd1bc6f73846dd2d7
review_input: scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review-apc6.md
review_input_sha256: 81a066974c89c6f216ba4bd14829d4c7640cda70a7a063be9be3252e627b88dd
---

# ADR-M5-BACKLOG-AUTO-PUBLISH-002：条件自动发布 v5 双层回退 successor

## 决定

接受 `ADR-M5-BACKLOG-AUTO-PUBLISH-001` 的最小可执行回退 successor。001 中确定性安全闭集、operation closed union、fresh binding、phase/collector writer-lock 栅栏、存量优先、approved-only CAS、单 snapshot/outbox、same-delivery reconcile、last-known-good 和未来多源键语义全部继续有效；本决定只取代其 v5 迁移、启动、代码回退、灾难恢复与再升级条款。

现行 v4 release 只认识 `user_version=1..4` 和精确 v4 schema，并按旧 HTTP-shaped `admin_operation` 写入。它不得打开、读取或写入已经提交 migration 0005 的 v5 数据库。001 中“回到现行 manual-only runtime，v5 附加表由旧代码忽略”和“验证旧 manual runtime 回退命令”的主张自本决定起 superseded，不得用于实现、部署或验收。

运行态继续 `disabled`。本决定没有修改 app、migration、测试、数据库、M1、LaunchAgent、密钥或部署，也没有把任何 fallback release 标记为已构建或已验证。

## 两层回退边界

### A. migration 0005 提交前

迁移只能在已停写、已取得唯一 DB 写锁并验证 v4 identity/fingerprint 后，以单一事务执行。只要 `COMMIT` 尚未成功，任一 schema/data/audit/fresh/outbox 验证失败都必须使事务整体回滚；复核 `user_version=4`、精确 v4 fingerprint、旧字段值、audit chain 和 DB identity 未变后，才允许重新启动现行 v4 release。

这是普通流程中唯一允许现行 v4 release 再次打开该数据库的路径。迁移失败后无法证明数据库仍是精确 v4 时，服务保持卸载并进入人工恢复，不得以旧代码试开。

### B. migration 0005 提交后

`COMMIT` 成功即形成 v5 单向边界。此后 full v5 release 启动失败、健康门失败或业务故障，只能切换到同一候选预先构建并演练通过的 `v5-manual-only-fallback` release；继续使用同一个 v5 DB inode，不恢复旧备份、不执行 down migration、不复制/`ATTACH`/双写。

`v5-manual-only-fallback` 必须完整理解和写入 v5 schema、四通道 closed union、legacy provenance、fresh binding、audit chain、Publication/Projection/outbox 与 receipt。它硬关闭：

1. `internal_auto_review`、`internal_auto_publish` 以及 `system-auto-review-v1`、`system-auto-publish-v1` 业务 operation；
2. `start_backlog|enter_live|resume_backlog|resume_live`，因此不能把 phase 推入 `backlog|live`；
3. collector/refiner/automatic reviewer/automatic publisher 的加载、claim、DNS、socket 和 HTTP 外联；collector 探针必须在建立 running slot 或网络调用前返回 `FALLBACK_COLLECTOR_DISABLED`，`externalCalls=0`；
4. 从 raw queued Publication 扫描或创建系统 snapshot/outbox。

fallback 保留 manifest operator 经真实 HTTP POST 执行的人工 `revision|approve|reject|publish|correct|withdraw`；其中 `publish|correct|withdraw` 继续要求同一事务持久化 fresh binding。它还保留只读状态，以及 fresh `pause|stop` 控制。fallback 打开时若现存 phase 为 `backlog|live`，先进入 control/read-only 安全态；在 operator 以 fresh `pause` 或 `stop` 将 phase 持久化为 `paused` 前，人工内容 mutation 和 sender 新 lease 都为 0。

旧 v4 release 永远拒绝 v5 DB；fallback 也必须拒绝 v4、未知或 fingerprint 不匹配的 DB。任何 v5 业务写入发生后，不存在到 v4 的普通代码回退路线。

## fallback sender 的有限职责

fallback 可保留现有 single sender，但它只承担既有投递传输，不是自动发布 actor。它不能创建或修改 review Decision、Publication、Projection、snapshot 或 outbox，也不能写 `internal_auto_review|internal_auto_publish` operation。

v5 migration 必须为每条 outbox 建立不可变、可外键验证的 producer operation 绑定。fallback sender 只可处理以下两类 outbox：

- migration 前已存在、且能唯一绑定到迁移后 `legacy_http_shaped_unknown/publish` operation 的 outbox；
- fallback 运行期间由 manifest operator 的合法 `http_post/publish|correct|withdraw` 与对应 fresh binding 同事务新建的 outbox。

producer 缺失、重复、指向 internal channel、actor/fresh/Publication/snapshot 任一不一致的 outbox不得 lease；migration 对旧 outbox 无法唯一回填 producer 时整体失败。sender 仍严格使用同一 delivery：response unknown 先 receipt GET，对方明确 404 后才重投相同签名 package；它不得增加 generation、publicId、snapshot 或 outbox。允许的 receiver 流量只指向 manifest 精确 loopback receiver；collector 的 `externalCalls=0` 与 sender 的有限 loopback投递分别计数，不得混称。

## 双 release 身份与部署顺序

full v5 与 `v5-manual-only-fallback` 必须在同一候选、同一 Git tree、同一 migration 0005、同一 v5 schema/repository closed-union实现上构建。两个内容寻址 manifest 相互固定对方 SHA，并至少冻结：

- `releaseRole`、Git commit/tree/content root、release root、manifest SHA；
- migration 0001..0005 SHA 集、`user_version=5`、精确 schema fingerprint 与 DB opener policy；
- 唯一 DB path/dev/inode/uid/nlink、允许进程/LaunchAgent 集、Node/runtime身份；
- 四通道 operation 矩阵、fresh binding schema、outbox producer binding schema；
- full/fallback capability flags、receiver loopback身份、public last-known-good root；
- 配对 release manifest SHA、构建时间和 stage 收据 SHA。

这些实际身份在构建前均为部署显式输入；文档不得臆造值。缺任一字段、互相引用不一致、release root 可变、opener version/fingerprint 不精确时均禁止迁移。

部署顺序固定为：

1. 同一候选构建 full v5 与 fallback；对隔离的真实备份恢复副本完成 manifest验签、v4→v5 migration、两种 opener、HTTP/DB人工操作、fresh/audit、pre-v5与人工新建 outbox投递和负例演练。
2. 对唯一 review DB 生成 fresh 一致性备份，证明 `backupAge<15m`、hash/manifest、隔离恢复与 v4 fingerprint；记录 public active generation、outbox/receipt、audit tail 和恢复点。
3. quiesce Admin HTTP 写、collector、refiner、automatic reviewer/publisher、sender；等待在途 HTTP 终止，running ingest slot 全部终态，sender lease 按同一 delivery收敛或进入可证明的 reconcile 状态。无法清零就停止。
4. 锁定同一 DB，重验 path/dev/inode/uid/nlink、`database_list=main,temp`、无 `ATTACH`、`user_version=4`、v4 fingerprint、integrity、audit/outbox/fresh binding 前置条件。
5. 单事务执行 migration 0005；提交前验证 schema、旧字段 storage class/value bytes、legacy provenance、audit chain、FK、operation矩阵、outbox producer 绑定和 singleton `phase=disabled`。
6. `COMMIT` 后按 v5 opener 再验证同一 inode、version/fingerprint、integrity、data/audit/outbox；随后才可启动 full v5，且初始 phase 仍为 `disabled`。
7. full v5 健康门失败时先卸载 full，再启动已配对验签的 fallback。fallback 在同一 v5 DB 上保留全部 v5 增量；不得先恢复备份或启动 v4。fallback 未通过自身 opener/capability门时服务保持关闭。

## 灾难恢复与审计分叉

迁移前备份只用于 full v5 与 fallback 都无法安全打开 v5 DB、或 v5 DB 已不可恢复的灾难恢复。它不属于普通 rollback。

执行该恢复前必须停止所有 writer/sender/receiver切换，保持公开 last-known-good；将故障 v5 DB、WAL/SHM、两个 release manifest、日志、receipt 和 audit tail 只读封存并记录 SHA。operator 要明确批准恢复点时间和预计丢失窗口；恢复点之后的所有 v5 operation、Decision、Publication、Projection、snapshot、outbox、receipt 和 audit 都视为可能丢失，不得宣称 `RPO≤15m` 之外的精度，也不得把两条 audit chain 静默拼接。

恢复记录必须固定故障 v5 audit tail、备份 v4 audit tail、public active generation、receiver receipt集合、丢失窗口和新 chain/fork identity。恢复出的 v4 DB 仅可由精确 v4 release 在隔离恢复分支打开；在对 public/outbox/receipt 做完人工一致性裁决前，不得新发布。返回主线时重新预构建 full v5/fallback、重新备份并按本决定再次执行 v4→v5；不存在 v5→v4 down migration。

## 再升级

从 fallback 回 full v5 时，先 quiesce fallback Admin/sender并锁同一 DB，验证 v5 fingerprint、integrity、audit tail、outbox/receipt与manifest pairing。相同 schema 的 full release可在 `disabled|paused` 下重启；若代码需要高于 v5 的 schema，必须先有新的 migration successor和与新 schema 配对的 manual-only fallback，再重复双层门。任何再升级都不得丢弃 fallback 期间的人工 operation或 outbox增量。

## 最小验收与负例

在允许 migration 之前，stage 必须至少证明：

1. migration 提交前注入失败使 DB 精确保持 v4，旧 v4 opener 可开；提交后旧 v4 opener 对 v5 必须 fail closed。
2. full/fallback 都只打开精确 v5 fingerprint；fallback 对 v4、未知版本、错 manifest、错 inode与第二 DB fail closed。
3. fallback 的人工 revision/approve/reject 与 fresh publish/correct/withdraw 可形成合法 v5 operation/audit；所有 internal channel、两个 system auto actor和 enter/resume backlog/live 组合写入为 0。
4. fallback collector probe 为 0 running slot、0 DNS/socket/HTTP、`externalCalls=0`；refiner和自动 reviewer/publisher进程数为 0。
5. pre-v5 合法 outbox及 fallback人工新建 outbox均可由 single sender沿同一 delivery收敛；internal/unknown/错 producer outbox不能 lease；sender不能生成新 snapshot/outbox。
6. full失败切 fallback不改 DB inode/version/fingerprint，不丢 full 已提交的 v5 operation、audit和outbox；public继续 last-known-good。
7. fresh pause/stop可从 full故障态进入 paused；fallback所有进入/resume backlog/live动作均在零业务增量时拒绝。
8. 灾难恢复演练明确报告恢复点、丢失集合和 audit fork；不得把备份恢复写成普通回退成功。

## 未变更边界

- 001 的用户授权证据与安全范围原样保留；本 successor 只修复合同可执行性，没有新增用户产品选择。
- v5 migration编号冲突规则、source-independent snapshot key和逐源 stop fence不变。
- 当前真实状态仍是 M1 `user_version=4`、现行 release、人工发布；full v5、fallback、0005及其验收全部 `Unknown / 未实现`。
