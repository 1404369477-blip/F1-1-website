# 2026-08-14 存量优先确定性安全初审与条件自动发布 successor 产品报告

## 1. 结论

`ADR-M5-BACKLOG-AUTO-PUBLISH-001` 已以 `accepted / contract_accepted_code_pending / runtime_phase=disabled` 收口。它精确取代生产真实 RSS 主链中“只能第二次人工发布”和 `auto_publish: forbidden` 的系统路径条款，同时保留全部人工按钮的 fresh WebAuthn、现有 single sender、签名全量快照、same-delivery reconcile、last-known-good 公开站与四根解耦语义。

APC2 独立复审发现的 collector claim / phase TOCTOU 已由 APC3 合同修订，并获 APC4 明确确认关闭。APC4 随后发现 operation channel、actor、fresh evidence、internal receipt 与 legacy provenance 仍未形成 closed union。本次 APC5 已在产品合同层补齐该首个新 P1；当前结论等待 APC6 从 operation channel 维度继续独立复审，不能据此放行实现或运行。

本次只修改产品真值文档。没有修改 app、测试、SQLite、M1、服务、LaunchAgent、tailnet、部署或密钥；没有执行 SSH。当前 M1 仍为 `user_version=4`，自动初审 PASS 只到 `approved + Publication=queued`，真实自动发布仍为 0。

## 2. 输入和证据边界

- 只读差距审计：`scratch/TASK-20260814-AUTO-PUBLISH-GAP/audit.md`。
- 审计 SHA-256：`b989068960bb02d98b6e3f7565eef2f9587b9e4f15b41a35d9ac6a39090d4f88`。
- 该审计证明当前自动初审只到 approved/queued，投影/snapshot/outbox 仍由人工 fresh WebAuthn mutation 创建；sender 只投递现有 outbox；拒绝 reason/audit 和人工恢复链已存在；存量 cutoff、oldest-first 与 collector 零外联 guard 尚未实现。
- 审计中的 M1 数量只是当时采样，本 successor 不把它们当成部署常量。特别是 raw queued Publication 含历史版本，这支持“只从当前 candidate 出发”的强制合同。
- APC2 独立复审：`scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review.md`，SHA-256=`77675c89fd820ca25ea619f62cc5abda0a7371fa3458fbc0d929af1fd6ca3dec`，结论 `FAIL / P0=0 / P1=1`，按首 P1 停止。
- APC2 输入的本产品报告上一版本完整 SHA-256 为 `429ae17788cf4e37e7e63c5b45ae4d83c67d4544a99d699e5c4bbddee720fb89`，精确 64 个十六进制字符；早先交接中的 62 字符值缺末尾 `89`，不得作为 SHA-256 身份。该 64 位值只标识 APC2 输入版本；本次改写后的报告 SHA 在最终写入后外部复算并随交付回报，正文不做自引用。
- APC4 独立复审：`scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review-apc4.md`，SHA-256=`3424c861bbf823bcce1366e14d61a2452c18a1756165422a03e939c4eeb05768`，结论 `FAIL / P0=0 / P1=1`；它确认 APC2 P1 已关闭，在 operation channel 维度发现首个新 P1 后停止。
- APC4 输入的本产品报告完整 SHA-256 为 `871380949b099e8dc68af2406ed603e2badd6b5b279ee07464aecd601f5f2280`。该值只标识 APC4 读取的 APC3 版本；本次 APC5 报告 SHA 在最终写入后外部复算并随交付回报。
- 现行实现事实：`0002_admin_review_publish.sql` SHA-256=`1d373f90cf881a58a15966ffe12ed01c3a651380d5f4f5aa9de468d79a798263` 强制 admin operation 写 HTTP method/path/status；`0003` SHA-256=`0f9d3908b62006158bf6dab60a4969c0bf65b95787d483b4e365f36199a86848` 与 `0004` SHA-256=`070dcd5778c88db85259f083f7272c42d562d30e8c8b2c74bb16d4e36205aeda` 没有改写该表。现行 `OperationReceiptSchema` 所在 `schema.ts` SHA-256=`3ab50668bb749e49981317f12cc785f9479d4c68f076a04011062e92fbf57d54` 强制 `httpStatus`；repository SHA-256=`73e5ed08455888290e7810991cccfab25653ff8771d22c193801b48595a42e8e` 与 runtime SHA-256=`f34364b290f5b522e6e749575640e36626f593aacb9a749d02697b5bbc623a30` 证明 `system-auto-review-v1` 当前通过内部直调写入 HTTP-shaped revision/approve/reject。该事实只能标为 legacy provenance unknown，不能追认成真实 HTTP。

## 3. 用户授权证据

宿主没有提供单条 message ID，所以证据标记统一为“2026-08-14 当前主会话用户消息，message ID unavailable”，不伪造 ID。精确原文：

1. “满足安全、内容质量等规则后自动发布”。
2. “开始搭建自动初审流程，目前的审核规则可以尽量简化，排除掉有安全问题的信息就可以，但目前录入的信源应该都没有这些低级问题，后续可以根据信息分布进行微调规则”。
3. “第二吧，后续没什么问题的话可以直接自动发布”。
4. “先处理现有的，然后再继续处理新抓取内容”。
5. “可以，而且把打回拒绝的内容记录到后台，我要回看原因”。
6. 用户随后回答“保留”。

证据强度足以接受：窄初版、现有白名单源、存量优先、条件自动发布、拒绝原因/audit 保留。它们不支持声称完成事实核查、版权判断、广义内容安全或其他来源的自动准入。

## 4. 已冻结的唯一合同

| 维度 | 精确结论 |
| --- | --- |
| 安全范围 | 仅现有 closed DTO/strict schema、精确 allowlisted source、canonical URL/HTTPS/source binding、现有 media identity 机械门，以及 ASCII C0 `U+0000–U+001F`、DEL/C1 `U+007F–U+009F`、bidi `U+202A–U+202E`/`U+2066–U+2069` |
| media/policy 真值 | v4 可机械判定的只有 `rss_media_candidate` 对 candidate/source revision/full hash、HTTPS URL、MIME 闭集、declared bytes 和 Bundle `media[]` 的绑定；没有 rights/license/policy 字段。只有“当前无 media candidate + Bundle 精确 0 图”可自动 PASS；非空 media 固定 `MEDIA_POLICY_UNKNOWN/waiting` 并阻止 system publish/live |
| fail closed | unknown source/URL/media/policy/schema/revision/hash 全部阻断；不用默认值或人工推测放行 |
| phase | `disabled|backlog|live|paused`，默认 `disabled`；`policy_epoch`、冻结 `backlog_cutoff_at`、`max_batch=20`（永远 `1..20`） |
| phase/claim 原子栅栏 | `disabled→backlog` 在一个 `BEGIN IMMEDIATE` 内重读 singleton/source fence、证明 0 running slot并写 cutoff/phase/audit；collector claim 在自己的 `BEGIN IMMEDIATE` 内先读 singleton，`backlog|paused` 时 0 running slot、DNS/socket 前 `externalCalls=0`。同一 writer lock 串行两者，已 claim 的 disabled collector 终态前 phase 切换不能成功 |
| 并发验收 | barrier 强制两种次序：claim 先锁时 phase 整体失败并保持 disabled，slot terminal 后重试才成功；phase 先锁时 claim 读到 backlog、0 slot、0 DNS/socket/HTTP |
| operation closed union | 八个 type 与四个 channel 均为 closed enum；人工 revision/approve/reject=`http_post+manifest operator`；人工 publish/correct/withdraw/control 再强制 persistent fresh binding；自动初审 revision/approve/reject=`internal_auto_review+system-auto-review-v1`；自动发布批次=`internal_auto_publish+system-auto-publish-v1`；任何交叉拒绝 |
| phase control | `start_backlog|enter_live|pause|resume_backlog|resume_live|stop` 全部只允许 manifest operator 经 `POST /api/admin/auto-publish/control` + fresh WebAuthn；closed controlAction 同时绑定 request/resource hash、fresh action和phase audit，前后 phase 不相容或跨 action 重放均拒绝；system actor不能control或改 stop fence，内部失败只形成 blocker/result/audit |
| HTTP/internal DTO | v5 HTTP successor receipt 固定 `operationChannel=http_post`、actorRef 与 nullable controlAction，method/path/status 精确且 internal result 全 null；两个 internal channel 的 method/path/status/HTTP response 全 null。auto-review 只允许 succeeded/failed/blocked 的单 candidate result；auto-publish 的 no_work、failed/blocked、1..20 succeeded 形态分别冻结计数与 snapshot/delivery nullability |
| legacy migration | pre-v5 行全部 `legacy_http_shaped_unknown`；旧 TEXT/BLOB 以 BLOB hex、INTEGER 以 storage class+value 做前后相等门。admin_operation/audit_event 在一个事务内双表重建，SQLite page/record bytes会变化，只声明旧列 value bytes/storage class、canonical event hash chain、FK/sequence相等；v5 后禁止新 legacy 行 |
| fresh binding | security 从 issued fresh record 生成 server-owned 授权对象，高风险 repository 不接收可独立传入的 actor/fresh/time；同一业务事务持久绑定 operation/type、manifest actor、request/resource hash、action、nullable controlAction、opaque fresh evidence ref与5分钟窗口。不保存原 receipt/session/CSRF/challenge/credential；错绑、过期、重放时所有业务增量为0 |
| 存量 | `first_seen_at<=cutoff`，按 `first_seen_at ASC, published_at ASC, candidate_id ASC`；不走 newest-first list/100 条截断 |
| collector | `backlog|paused` 时在 DNS/socket/HTTP 前返回稳定 reason，`externalCalls=0` |
| 阻断 live | cutoff 内 `waiting|manual_override|failed|pending_review|source_updated|approved_waiting_publish|reconcile_wait` 任一存在，或最新 outbox 未 succeeded |
| 拒绝 | `rejected` 为已处理终态，保留 immutable reason/audit；人工恢复后新 revision 再次进入未决集合 |
| system actor | 固定 `system-auto-publish-v1`，无 HTTP 路由、无 fresh receipt，只发布已 approved/current 项 |
| CAS | current source id/revision/full hash + latest Bundle id/full hash + latest approved Decision 的现有 `decision_id/bundle_id/approved_bundle_hash` + unique queued Publication/publicId/key + phase/epoch/cutoff/source stop + current safety PASS + previous outbox succeeded。Decision 不加 epoch 字段，epoch 在同一发布事务独立 CAS 并写入 operation/audit payload |
| snapshot/outbox | 每批 1–20 项、一份全量 snapshot、一条 outbox，严格串行；不扫 raw queued Publication |
| unknown/public | unknown 只 receipt GET reconcile 同一 delivery，明确 404 才重投同 package；public 保持 last-known-good |
| 数据 | additive `0005_auto_publish_policy.sql`，`user_version 4→5`，唯一新持久表为 singleton policy；重建既有 `admin_operation/audit_event` 以实现四 channel closed union，旧 operation字段和 audit canonical hash输入逐值保留但不宣称数据库物理字节不变；唯一 DB path/dev/inode、不复制、不 `ATTACH`、不双写、不 down migration |
| 备份/停止 | 每次系统发布前 `integrity_check=ok`、single writer、recovery fence、`backupAge<15m`；回退首先 `paused` |
| 恢复采集 | 存量清零并切 live 后，只在下一个自然 `900s` tick 恢复，不人工补抓 |
| 多源兼容 | 沿用 source-independent `snapshotManifestHash` 和 `deliveryId=op-snapshot-${snapshotManifestHash}`，v5 idempotency key 固定 `snapshot-sync:${policyEpoch}:${snapshotManifestHash}`，取代现行单源 `stop_epoch` 嵌入键；每源 stop fence 只作 CAS，新 source 仍需单独 accepted 注册。“未来 v5 多源”是产品标签，不预留第二个 SQL `user_version=5` |

## 5. 精确 supersession

- `ADR-M5-RSS-REAL-001` §8：只取代已入私库当前候选的“自动初审/发布全量排除”；采集输入安全、固定 URL/15 分钟/1 MiB/60→20 和单源继续有效。
- `ADR-M5-REAL-PROJECTION-RUNTIME-002` 的人工唯一 publish 与 §未变更边界：只新增 approved-only system actor 路径；人工 fresh WebAuthn、sender/receiver/receipt/public reader 不变。
- `ADR-M5-REAL-PROJECTION-RUNTIME-003` §为什么必须独立 successor / §未变更边界：只取代 `auto-publish=0`；四根解耦、existing-only review DB、不复制/不 `ATTACH`/不双写、prepare/load/cutover/rollback 继续有效。
- `F1+1-真实RSS人工审核与公开投影最小实施合同-v0.1.md`：只取代 frontmatter `auto_publish: forbidden`、§1/§3.2/§5.4/§10.2 中系统发布的绝对禁止；人工 API/DTO/fresh WebAuthn 和不可变实体保留。
- `docs/spec.md`：把“自动发布待用户决策”收口为“窄范围已授权，实现与运行仍 P1/disabled”。

旧 accepted 文件原文未改，通过 successor 表建立唯一取代语义。

## 6. 产物

1. `docs/decisions/system/2026-08-14-F1+1-存量优先确定性安全初审与条件自动发布-successor-accepted.md`
2. `docs/spec/F1+1-存量优先确定性安全初审与条件自动发布实施合同-v0.1.md`
3. `docs/spec.md`
4. `docs/progress.md`
5. 本报告

## 7. 未实现与风险说明

1. v5 migration、phase-aware selector、collector pre-network guard、approved-only system publisher 和 Admin 阶段/急停控制均尚未编码。
2. APC2 首 P1 已由 APC4 确认关闭；APC4 的 operation-channel 首 P1 已完成 APC5 合同修订，APC6 尚未独立复审。在 APC6 `PASS / P0=0 / P1=0` 前不放行实现任务。即使合同复审通过，runtime 仍保持 `disabled`，还需独立实现、closed-union/legacy/barrier 测试、备份、迁移、部署与切换门。
3. 当前 rejected/recovered 生产正例仍缺；机制有代码/schema/既有测试证据，不能包装成 M1 真实用户正路验收。
4. 安全闭集很窄。它可以拦截明确结构、URL、媒体身份和控制符问题，无法判定事实真假、版权权利或广义语义风险。v4 没有 rights/license/policy 机器字段，所以非空 media 全部阻断自动发布；这是已冻结的 fail-closed 边界，不代表媒体政策能力已经完成。
5. 当前仓库的 rss-real migration 精确只到 `0004`，因此本 successor 当前可使用 `0005/user_version=5`。若其他并行 accepted migration 在实施前先占用 5，需新 successor 重编号，不合并同号 migration，不覆写已用版本。
6. 现有功能追踪矩阵的 `AUTO-PUBLISH-005` 分类未在本任务机械重算。现行产品真值是“用户窄授权已关闭，实现/部署/用户出口仍为 P1-blocker”；后续状态同步任务再机械更新矩阵计数，本报告不伪造新计数。

## 8. 下一实施任务的最小输入

开发任务只需引用新 ADR 和实施合同，按下列顺序交付：

1. additive v5 singleton 与默认 disabled；
2. 四 channel/type/actor closed union、HTTP/Internal DTO、persistent fresh binding 与 legacy operational 双表重建；
3. collector claim-first singleton guard 与 `disabled→backlog` 同一 writer-lock 原子切换；
4. claim 先锁/phase 先锁双 barrier 验收，再交付 backlog cutoff + oldest-first reviewer/refiner；
5. 从当前 candidate 出发的 approved-only `internal_auto_publish` system CAS publisher；
6. 一批一 snapshot/outbox 与现有 sender/reconcile 复用；
7. Admin fresh WebAuthn 唯一 HTTP phase/急停控制及全部 closed-union 负例；
8. 一致性备份、`backupAge<15m`、默认 disabled 部署、backlog 存量、live 切换与下一自然 900s 验收。

实施不需修改 receiver/public reader/sender transport 协议，不需新建 backlog 队列，不需引入第二数据库或第二发布真值。
