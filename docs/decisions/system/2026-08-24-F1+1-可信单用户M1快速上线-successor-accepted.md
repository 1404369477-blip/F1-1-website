---
type: system_adr
status: accepted
date: 2026-08-24
department: 产品部/安全部
decision_id: ADR-F1PLUS1-TRUSTED-SINGLE-USER-M1-QUICK-LAUNCH-001
authorization_state: user_confirmed_in_current_thread
contract_review_state: closed_pass
implementation_state: engineering_authorized_pending
production_state: not_deployed
---

# ADR-F1PLUS1-TRUSTED-SINGLE-USER-M1-QUICK-LAUNCH-001：可信单用户 M1 快速上线 successor

## 1. 决定

首版采用以下唯一产品模式：

```text
可信单用户 M1
→ 四 RSS 自动采集
→ zh-CN + en 自动处理
→ 人工审核
→ fresh 人工发布
→ signed immutable public snapshot
→ 公网只读 Public

Admin = loopback + Tailscale Serve 私网 + Passkey/session/Origin/CSRF/fresh/audit
automatic_review = disabled
automatic_publish = disabled
59 X = disabled + manual URL only
oEmbed = disabled
```

本 ADR 是快速上线实施选择的 successor overlay。它精确覆盖现有双语完整 Admin successor 中“必须先完成 high-assurance 0007/R7 才能继续 0008–0010”的实施顺序；旧 accepted ADR、旧审计、旧候选和全部 FAIL/PASS 证据保持原字节。high-assurance 0007 successor R7继续为`DEFERRED / NOT_SHARED / NOT_PRODUCTION`，后续可作为同 schema lineage 的强化迁移另立实施与切换门。

当前状态为`accepted / quick-launch-contract-review-pending / NOT_IMPLEMENTED / NOT_DEPLOYED`。文档 accepted 只记录用户选定的风险模型和工程路线；独立合同复审关闭前不能把本路线记为工程或生产完成。

## 2. 证据基线与裁定

| 证据 | 当前身份 | 本 ADR 的裁定 |
|---|---|---|
| shared旧0007 SQL | `app/migrations/rss-real/0007_internal_operation_recovery_phase.sql`，raw SHA-256 `ab32bb74fb404656bbdf6f84cc8a6967e18f8ed797f59ec27125291e5c26a163` | 首版复用为`trusted_local_capability_accounting_v1`；仅声明operation/idempotency/attempt/outbox/audit/budget/phase/accounting能力 |
| 0007矛盾审计 | `scratch/2026-08-24-0007-fence-contradiction-audit/report.md`，SHA-256 `e586a75fe6cc62bf6b698c288265e313386fd39c09ca20978dc58d8e30dfe68b` | 已证明Admin `phase_control/fence_update`可在无verified truth receipt时clear singleton fence；在本威胁模型中列为显式残余风险 |
| high-assurance 0007合同 | ADR SHA-256 `d7ec4fdcaf04723f614dd33c5cead2650f322ae2023774f2d615666179144025`；合同 SHA-256 `aa0d42c7e74a946cb6c25d4a8ed6eced15f3c8d03796fbc8a0070ad0246e5637` | 合同保留，快速上线不实施该successor |
| R7独立复审 | report SHA-256 `12f3a738120d2765b66813e16e47998ccecf2ef6ab16dd166a3ac808363c664e`；receipt SHA-256 `ac8195cad6924e47947681f8b1fd1e83229a76c65ed495f4e84ce22ce1c2cf8b` | `FAIL / P0=0 / P1=2 / P2=0 / offline gate BLOCKED`；不得作shared或production claim |

shared旧0007的seed为`phase=disabled / global_stop=stopped / recovery=fenced / deletion=unknown / publication=blocked`。其policy同时包含自动RSS collect/refine、人工review/publish、automatic review/publish和Admin `phase_control/fence_update`。因此schema可提供首版capability/accounting骨架，但它自身不能证明恶意same-UID进程受到隔离，也不会自动满足上线门。

## 3. 威胁模型

### 3.1 明确信任

首版只信任以下集合：

1. 一个自然人owner；
2. production manifest钉死的M1主机、唯一运行UID和该UID启动的已批准本地进程；
3. 该UID下的Admin、RSS collector、bilingual refiner、snapshot sender与backup producer遵守本合同，不恶意读写DB、配置、内存、loopback请求、handoff、receipt或audit；
4. owner执行的人工审核与fresh人工发布决定。

“可信same-UID”是安全假设，不是密码学证明。首版不声称防御同UID恶意进程、同UID恶意插件、同UID凭证窃取、M1本地管理员/root、内核失陷或已批准release本身恶意。

### 3.2 仍然不可信

- 公网访客、爬虫和任意Internet请求；
- 未授权tailnet用户、设备、shared node和额外Grant；
- 直连Admin端口、Funnel、端口转发和伪造浏览器header；
- RSS/XML/HTML、标题、正文、图片URL、X URL、provider/model响应及所有远端内容；
- 网络超时、DNS/TLS错误、provider重复/未知响应和损坏snapshot；
- M1上的其他UID及owner未批准进程；
- 丢失、被撤销或身份漂移的Mac/iPhone会话。

这些主体不能因“单用户”获得Admin、DB mutation、publish、签名、backup、source activate或模型凭证权限。

### 3.3 用户接受的残余风险

同UID恶意进程可以尝试读取owner-only文件和进程环境、直连loopback并伪造Serve注入头、调用本地mutation接口、篡改未被外部锚定的DB/audit/receipt、消费模型或签名凭证、利用旧0007 Admin fence路径清门、启动被manifest禁用的automatic publisher，或删除/加密本地数据。Passkey、CSRF、old-0007 capability和本地audit不能对已控制same-UID的攻击者形成强隔离。

用户在本线程已明确接受该首版残余风险，以换取快速上线。该接受不覆盖公网Admin、未授权设备、自动发布、X自动采集、无备份运行或绕过production manifest；也不构成对数据丢失、版权、provider费用或账号封禁风险的豁免。

## 4. Admin 与公开面硬边界

Admin必须同时满足：

1. 进程只绑定`127.0.0.1:3101`或`::1`，禁止`0.0.0.0`；
2. 仅由Tailscale Serve tailnet-only HTTPS转发，Funnel与公网反代为0；
3. Serve剔除客户端同名头后注入唯一login与app-cap `sourceRef`，服务端按既有accepted identity合同闭集验证；
4. 浏览器mutation要求有效Passkey绑定session、匹配Origin、一次性CSRF、CAS/idempotency；publish/correct/withdraw、source authorize、phase和restore额外要求不超过300秒且一次消费的fresh grant；
5. 所有允许和拒绝结果写allowlisted、脱敏、append-only audit；浏览器永远不能提交actor/capability真值；
6. Admin无公网裸入口、隐藏URL密码页、Funnel、普通Basic Auth或仅Cookie降级路径。

Public只读取验签通过的immutable signed full snapshot与active pointer；receiver失败、签名/hash/schema错误时保留last-known-good，缺少可验证generation时返回503。Public无DB写权限、Admin route、密钥、provider凭证或内部source原文。

## 5. 首版功能模式

| 能力 | 首版唯一模式 | 失败语义 |
|---|---|---|
| RSS collect | 四RSS及0010 active RSS按manifest schedule自动运行 | source/stop/route/egress/lease未知时零外联并告警 |
| bilingual refine | 0009对新candidate自动运行zh-CN和en两个独立slot | 任一slot失败留待人工retry；不伪造英文，不自动发布 |
| review | 人工审核、人工编辑、人工approve/reject | automatic reviewer无schedule、无owner handoff、无可用启动capability |
| publish | 仅Admin人工fresh publish/correct/withdraw | automatic publisher无schedule、无owner handoff、无可用启动capability；任何system-auto operation为上线阻断 |
| X 59 | 0010中`proposed/disabled/manual_url`；只接受人工status URL | poll/search/rules/RSSHub/cookie和automatic backfill均为0；oEmbed disabled且externalCalls=0 |
| Public | signed snapshot sender→receiver→active pointer | unknown outcome只reconcile同delivery；损坏保持LKG |

旧0007中存在`automatic_reviewer`和`automatic_publisher`policy row不等于能力已启用。首版release必须逐字通过§10唯一`AutoAutomationZeroVector`；`fresh operation`不是合法术语，自动化零门与WebAuthn fresh无关。普通环境变量不得把自动review或自动publish打开。

## 6. 迁移路线与旧0007最小适配

唯一首版顺序为：

```text
schema 6
→ shared旧0007 / trusted_local_capability_accounting_v1
→ 0008 X manual inbox（59 disabled，oEmbed disabled）
→ 0009 bilingual
→ 0010 source registry
→ full_v10 + manual_only_fallback_v10
```

旧0007只按production manifest钉死的raw/canonical/post-schema/release身份应用一次。其信任语义降窄为：同UID可信前提下的single-writer、idempotency、durable attempt、outbox、audit、budget、phase与accounting schema；不得在文档、UI、health或receipt中称为high-assurance、malicious-same-UID-safe、verified external authority或R7。

上线bootstrap只允许经现有gateway和authorizer执行，不允许drop trigger、raw SQL、直接repository write或复用测试workaround：

1. 从seed用restore/control operation推进`fenced→restoring→verifying→ready`并产生writer epoch/authority记录；
2. 用Admin `phase_control/fence_update`一次只改变一个singleton fence，先deletion、后publication；本地trusted policy evaluator生成对应审计事实；
3. clear global stop；为四RSS、candidate和publication逐scope创建所需generic fence receipt；
4. 进入`live`，因为旧policy只在live同时允许自动RSS collect、自动bilingual refine和人工review/publish；
5. 每步均为独立idempotent operation，CAS失败或状态Unknown立即停止，不能补写假receipt。

旧trigger会拒绝`system_supervisor/system_producer/fence_update`的singleton更新，现有Admin `phase_control/fence_update`路径可执行且正是矛盾审计确认的残余风险。因此最小适配是app层`trusted_local_bootstrap`调用现有Admin control action；不需要修改0007 SQL。若production-shaped disposable DB证明这条合法路径无法完成，禁止drop trigger或裸UPDATE；路线退回review-pending，并另立最小additive `0011_trusted_local_control_bootstrap`候选及独立复审。0011只允许修正control mapping/receipt accounting，不得启用automatic publish或改写0008–0010数据语义。

high-assurance successor R7及后继整改继续`DEFERRED`。未来强化必须单独证明schema兼容、数据迁移、same-UID隔离、owner authority、one-fence/one-verified-receipt和rollback收敛；不能把离线candidate PASS、self-report或旧FAIL覆盖成production事实。

## 7. 上线与回退硬门

上线前必须同一release/manifest全部通过：

- `automatic_review=disabled`、`automatic_publish=disabled`，且§10中review与publish各自五轴`AutoAutomationZeroVector`为`pass`；
- RSS collect和bilingual refine仅使用manifest闭集source、route、provider、model、prompt、预算和interval；
- 人工publish必须private Admin身份、fresh≤300秒、一次性CSRF、CAS/idempotency、当前双语bundle、人工approval、版权/media/source policy clear和同一signed delivery；
- Admin listener=loopback，Serve=tailnet-only，Funnel=0，Mac+iPhone Passkey/fresh/撤销/直连负例通过；
- Public receiver只激活验签full snapshot，错误保留LKG；
- migration前生成加密、owner-only、off-host recovery point，`backupAgeSeconds<=900`，在隔离副本通过decrypt/hash/integrity/FK/schema/business-point restore；运行中RPO不得超过900秒；
- schema COMMIT前任一步失败整笔rollback到schema6且无identity/audit/outbox漂移；COMMIT后禁止down migration，只切同schema `manual_only_fallback_v10`。数据损坏时恢复最近verified recovery point并记录实际丢失窗口和audit fork；Public继续LKG；
- production-shaped disposable DB必须证明旧0007 bootstrap无drop-trigger/raw-update workaround，0008/0009/0010逐级apply、full/fallback同schema、manual publish、restart、backup/restore和rollback路径。

任一门Unknown即`NO_DEPLOY`。同UID残余风险接受不能把Unknown改为PASS。

## 8. Production manifest 与用户确认

不可变`PRODUCTION-DEPLOYMENT-MANIFEST`仍必须固定：M1 host/UID、DB与backup path/dev/inode/mode、0001–0010及release pair hash、Node/npm/SQLite、Admin/Public域名、Tailscale login/capability/source selectors/Grants/device/shared-node/policy、Passkey RP/origin、snapshot signing key路径、RSS inventory、model/provider/prompt/budget、manual-only开关、auto-review/auto-publish禁用证据、scheduler intervals、版权/media/deletion policy、backup/off-host/key/RPO/restore drill、observer/log/traffic/cost/alert producer、cutover与rollback命令及收据输出路径。

本 ADR 对用户确认的绑定方式为：`evidenceKind=current_thread_user_instruction`、`evidenceId=NOT_ISSUED`。事实仅为“用户明确选择可信单用户M1快速上线，并接受same-UID残余风险；high-assurance 0007延后强化”。当前没有外部ticket、签名receipt、消息ID或transcript hash，本文件不伪造这些值。若部署前产品要求持久化授权证据，应在manifest中引用真实导出的线程证据hash；缺失时只影响授权证据完备性，不能用虚构ID补齐。

## 9. 当前门

`quick-launch-contract-review-pending`。允许写入范围仅为本ADR、既有successor ADR/实施合同/Function矩阵和主spec/progress/handoff的append-only同步。app、SQL、tests、data、DB、M1、service、network、model、publish和production均未因本ADR获得本轮写入授权。

## 10. `AutoAutomationZeroVector` 唯一合同

本节是automatic review/publish禁用状态的唯一机器合同，覆盖本文其他“五处为0”简写。独立FAIL输入固定为report SHA-256 `5fb3c8aa3bbbd453a69a7ef28222ebb9c0b56c69a1343dc1e19bd83cadfa5554`与receipt SHA-256 `96ab78b838856fe5d2dabc20d51eaab5c9a76de1cb7f39bade41efcca9c40624`，根目录`scratch/2026-08-24-trusted-single-user-m1-quick-launch-independent-review/`；`QL-P1-1`保持open，当前合同仍`review-pending`。

### 10.1 时间、release与DB域

`PRODUCTION-DEPLOYMENT-MANIFEST`必须固定唯一：

```text
quickLaunchCutoverAt = UTC timestamp YYYY-MM-DDTHH:mm:ss.sssZ
releaseSha256 = lowercase 64-hex
manifestSha256 = lowercase 64-hex
autoProcessIdentitySetSha256 = lowercase 64-hex
scheduleInventorySha256 = lowercase 64-hex
reviewDatabaseIdentity = {
  pathSha256: lowercase 64-hex,
  device: integer 0..9007199254740991,
  inode: integer 1..9007199254740991,
  userVersion: 10,
  schemaSha256: lowercase 64-hex
}
```

`autoProcessIdentitySetSha256`绑定manifest中两个auto owner的executable realpath/bytes/argv/LaunchAgent label闭集；`scheduleInventorySha256`绑定Admin release closure、目标plist/cron/LaunchAgent目录与manifest scheduler registry的canonical inventory。两个值都是生产瞬时值，未进manifest不得签零收据。

`quickLaunchCutoverAt`包含边界：`created_at|verified_at >= quickLaunchCutoverAt`均属于post-cutover。zero receipt的`observedAt`由进程外部署verifier生成，必须是同格式UTC、`observedAt>=quickLaunchCutoverAt`，所有process/schedule/DB子收据的`asOf`与它相差不超过5秒。DB以existing-only、只读、同一SQLite snapshot打开；path hash、device、inode、userVersion、schema hash、release、manifest、process identity set和schedule inventory任一不等、字段/表/clock/receipt缺失或解析失败时vector=`unknown`，上线结论=`NO_DEPLOY`。

cutover前的legacy operation、audit、publication、outbox和provenance禁止删除或改写。以下“operation轴”和“effect轴”统计集合统一为：

```text
post-cutover任何匹配对象（不论当前为terminal或nonterminal）
UNION
cutover前创建但在observedAt仍处于本节精确nonterminal集合的匹配对象
```

因此cutover前terminal历史不计数且必须保留；cutover后即使operation立即`succeeded|completed|failed`仍计数并FAIL；cutover前仍queued/nonterminal的自动对象也计数并FAIL。

### 10.2 Closed DTO与五轴

```text
AutoAutomationZeroVector = {
  schemaVersion: "auto-automation-zero-vector-v1",
  domain: {
    quickLaunchCutoverAt: timestamp,
    observedAt: timestamp,
    releaseSha256: SHA,
    manifestSha256: SHA,
    autoProcessIdentitySetSha256: SHA,
    scheduleInventorySha256: SHA,
    reviewDatabaseIdentity: ReviewDatabaseIdentity
  },
  automaticReview: AutoAutomationZeroDatum,
  automaticPublish: AutoAutomationZeroDatum,
  state: "pass" | "fail" | "unknown"
}

AutoAutomationZeroDatum = AutomaticReviewZeroDatum | AutomaticPublishZeroDatum

AutomaticReviewZeroDatum = {
  automation: "automatic_review",
  ownerProcess: "automatic_reviewer",
  operationKind: "review",
  capabilityClass: "db_mutation",
  egressChannel: "none",
  producers: [
    "app/src/server/admin-service/runtime.ts::automaticReviewTick",
    "ReviewRepository.automaticReviewBatch",
    "system-auto-review-v1"
  ],
  legacyOperationIdPrefixes: [
    "auto-review-revision-", "auto-review-approve-", "auto-review-reject-"
  ],
  allowedSchema7OutboxKinds: [],
  schema7OperationNonterminalStates: [
    "requested", "authorized", "attempt_committed", "in_flight", "reconcile_required"
  ],
  schema7OperationTerminalStates: ["succeeded", "blocked", "terminal_failed", "cancelled"],
  legacyOperationTerminalStates: ["completed", "failed"],
  counts: {
    activeProcessInstances: UInt53,
    registeredSchedules: UInt53,
    activeOwnerHandoffs: UInt53,
    prohibitedOperations: UInt53,
    prohibitedEffects: UInt53
  },
  evidence: {
    processReceiptSha256: SHA,
    staticScheduleReceiptSha256: SHA,
    runtimeScheduleReceiptSha256: SHA,
    handoffSqlReceiptSha256: SHA,
    operationSqlReceiptSha256: SHA,
    effectSqlReceiptSha256: SHA
  },
  state: "pass" | "fail" | "unknown"
}

AutomaticPublishZeroDatum = {
  automation: "automatic_publish",
  ownerProcess: "automatic_publisher",
  operationKind: "publish",
  capabilityClass: "db_mutation",
  egressChannel: "none",
  producers: [
    "app/src/server/admin-service/runtime.ts::automaticPublishTick",
    "ReviewRepository.automaticPublishBatch",
    "system-auto-publish-v1"
  ],
  legacyOperationIdPrefixes: ["auto-publish-batch-"],
  allowedSchema7OutboxKinds: ["projection_delivery", "withdraw_delivery"],
  schema7OperationNonterminalStates: [
    "requested", "authorized", "attempt_committed", "in_flight", "reconcile_required"
  ],
  schema7OperationTerminalStates: ["succeeded", "blocked", "terminal_failed", "cancelled"],
  schema7OutboxNonterminalStates: ["pending", "leased", "reconcile_required"],
  schema7OutboxTerminalStates: ["succeeded", "terminal_failed", "cancelled"],
  legacyOperationTerminalStates: ["completed", "failed"],
  legacyPublicationNonterminalStates: ["queued", "reconcile_wait"],
  legacyPublicationTerminalStates: ["published", "terminal_failed", "emergency_stopped", "superseded"],
  legacyOutboxNonterminalStates: ["pending", "leased", "retryable_failed", "reconcile_wait"],
  legacyOutboxTerminalStates: ["succeeded", "terminal_failed", "cancelled"],
  counts: {
    activeProcessInstances: UInt53,
    registeredSchedules: UInt53,
    activeOwnerHandoffs: UInt53,
    prohibitedOperations: UInt53,
    prohibitedEffects: UInt53
  },
  evidence: {
    processReceiptSha256: SHA,
    staticScheduleReceiptSha256: SHA,
    runtimeScheduleReceiptSha256: SHA,
    handoffSqlReceiptSha256: SHA,
    operationSqlReceiptSha256: SHA,
    effectSqlReceiptSha256: SHA
  },
  state: "pass" | "fail" | "unknown"
}

UInt53 = integer 0..9007199254740991
```

DTO为closed object，两个variant必须按`automation`判别且tuple顺序也是合同的一部分；禁止额外字段、null、负数、缺receipt或用boolean替代count。count可表示失败反例；只有五轴各为数字`0`时datum才可`pass`。五轴逐项含义固定为：

1. `activeProcessInstances=0`：无独立auto PID/process；Admin PID内嵌timer不在本轴豁免，它计入schedule轴。
2. `registeredSchedules=0`：release静态call graph和运行scheduler registry均无auto registration或startup invocation；同时无独立PID、loaded LaunchAgent、cron entry、plist job或其他scheduler entry。
3. `activeOwnerHandoffs=0`：无post-cutover handoff、无observedAt仍未消费且未过期handoff、无绑定nonterminal auto operation的handoff。
4. `prohibitedOperations=0`：无post-cutover匹配operation，且无cutover前遗留nonterminal匹配operation。
5. `prohibitedEffects=0`：review无post-cutover自动revision/approve/reject领域增量或任何outbox；publish无post-cutover自动publication/delivery/projection outbox，且无cutover前遗留queued/nonterminal自动publication/outbox。

两个Datum均pass且外层domain全匹配时vector=`pass`；任一count大于0或receipt明确反证时为`fail`；无法证明时为`unknown`。`fail|unknown`均`NO_DEPLOY`。

### 10.3 Review与publish exact对象域

| Automation | owner / operation | runtime producer与legacy actor | operation channel | outbox/effect type | nonterminal / terminal |
|---|---|---|---|---|---|
| automatic review | `automatic_reviewer / review / db_mutation / none` | `app/src/server/admin-service/runtime.ts::automaticReviewTick`；`ReviewRepository.automaticReviewBatch`；`system-auto-review-v1`；legacy operation ID prefix=`auto-review-revision-|auto-review-approve-|auto-review-reject-` | schema7 `internal_operation`; legacy `admin_operation+audit_event` | schema7 outbox允许集为空，任一joined outbox均FAIL；legacy `operation_type=revision|approve|reject`，event=`review_revision_saved|review_approved|review_rejected` | schema7 nonterminal=`requested|authorized|attempt_committed|in_flight|reconcile_required`；terminal=`succeeded|blocked|terminal_failed|cancelled`；legacy terminal=`completed|failed` |
| automatic publish | `automatic_publisher / publish / db_mutation / none` | `app/src/server/admin-service/runtime.ts::automaticPublishTick`；`ReviewRepository.automaticPublishBatch`；`system-auto-publish-v1`；legacy operation ID prefix=`auto-publish-batch-` | schema7 `internal_operation`; legacy `admin_operation+audit_event+publication+projection_outbox` | schema7 `outbox_kind=projection_delivery|withdraw_delivery`；legacy `operation_type=publish`、publication、`projection_outbox.operation_type=snapshot_sync` | schema7 operation nonterminal同上；schema7 outbox nonterminal=`pending|leased|reconcile_required`、terminal=`succeeded|terminal_failed|cancelled`；legacy publication nonterminal=`queued|reconcile_wait`、terminal=`published|terminal_failed|emergency_stopped|superseded`；legacy outbox nonterminal=`pending|leased|retryable_failed|reconcile_wait`、terminal=`succeeded|terminal_failed|cancelled` |

选定的shared旧0007没有`operation_channel`列，其exact channel是`capability_class=db_mutation + egress_class=none + owner_process + operation_kind`四元组；legacy v4 `admin_operation`也没有channel列，只能用上表actor+operation ID prefix的provenance绑定。不得虚构列，也不得把未进入本路线schema的v5 `internal_auto_review|internal_auto_publish`当作已存在。

任何匹配owner但wrong operationKind/channel、匹配actor但unknown operation/effect type、或表中出现闭集外status均为`unknown`，不能从计数中排除。

### 10.4 Exact SQL

以下named parameters逐字来自§10.1 domain：`:cutoverAt`、`:observedAt`、`:releaseSha256`、`:manifestSha256`。每条在同一只读snapshot执行并保存SQL text hash、ordered row JSON hash和count；table/column缺失不得当0。

Owner handoff轴对review和publish分别以`:owner`执行：

```sql
SELECT
  COUNT(*) AS prohibited_count,
  COALESCE(SUM(CASE
    WHEN h.release_sha256 <> :releaseSha256
      OR h.manifest_sha256 <> :manifestSha256
    THEN 1 ELSE 0 END), 0) AS identity_mismatch_count
FROM owner_authorization_handoff AS h
LEFT JOIN internal_operation AS op
  ON op.operation_id = h.consumed_by_operation_id
WHERE h.owner_process = :owner
  AND (
    h.verified_at >= :cutoverAt
    OR (h.consumed_by_operation_id IS NULL AND h.expires_at > :observedAt)
    OR op.state IN ('requested','authorized','attempt_committed','in_flight','reconcile_required')
  );
```

Handoff查询命中的`identity_mismatch_count>0`令vector=`unknown / NO_DEPLOY`，不得因为`prohibited_count`已经令其fail就丢弃identity反证。

Schema7 operation轴分别以`:owner/:operationKind`执行；post-cutover行的release/manifest不匹配仍计数，且额外令vector=`unknown`：

```sql
SELECT
  COUNT(*) AS prohibited_count,
  COALESCE(SUM(CASE
    WHEN created_at >= :cutoverAt
     AND (expected_release_sha256 <> :releaseSha256
       OR expected_manifest_sha256 <> :manifestSha256)
    THEN 1 ELSE 0 END), 0) AS identity_mismatch_count
  ,COALESCE(SUM(CASE
    WHEN capability_class <> 'db_mutation' OR egress_class <> 'none'
    THEN 1 ELSE 0 END), 0) AS channel_mismatch_count
FROM internal_operation
WHERE owner_process = :owner
  AND operation_kind = :operationKind
  AND (
    created_at >= :cutoverAt
    OR state IN ('requested','authorized','attempt_committed','in_flight','reconcile_required')
  );
```

`identity_mismatch_count|channel_mismatch_count>0`均令vector=`unknown / NO_DEPLOY`，因为该行不能归属于manifest固定的quick-launch域；`prohibited_count`仍保留为禁止自动operation的反证数。

Legacy review operation轴与review effect轴：

```sql
SELECT COUNT(DISTINCT op.operation_id) AS prohibited_count
FROM admin_operation AS op
WHERE op.operation_type IN ('revision','approve','reject')
  AND (
    op.operation_id GLOB 'auto-review-revision-*'
    OR op.operation_id GLOB 'auto-review-approve-*'
    OR op.operation_id GLOB 'auto-review-reject-*'
    OR EXISTS (
      SELECT 1 FROM audit_event AS ae
      WHERE ae.operation_id = op.operation_id
        AND ae.actor_ref = 'system-auto-review-v1'
    )
  )
  AND op.created_at >= :cutoverAt;

SELECT COUNT(*) AS prohibited_count
FROM audit_event
WHERE actor_ref = 'system-auto-review-v1'
  AND event_type IN ('review_revision_saved','review_approved','review_rejected')
  AND created_at >= :cutoverAt;
```

Review schema7 outbox必须为空，包括cutover前仍nonterminal行：

```sql
SELECT COUNT(*) AS prohibited_count
FROM internal_operation_outbox AS ob
JOIN internal_operation AS op ON op.operation_id = ob.operation_id
WHERE op.owner_process = 'automatic_reviewer'
  AND op.operation_kind = 'review'
  AND (
    ob.created_at >= :cutoverAt
    OR ob.state IN ('pending','leased','reconcile_required')
  );
```

Legacy publish operation轴使用actor join，legacy publication/outbox effect轴以同一自动publish operation provenance连接：

```sql
SELECT COUNT(DISTINCT op.operation_id) AS prohibited_count
FROM admin_operation AS op
WHERE op.operation_type = 'publish'
  AND (
    op.operation_id GLOB 'auto-publish-batch-*'
    OR EXISTS (
      SELECT 1 FROM audit_event AS ae
      WHERE ae.operation_id = op.operation_id
        AND ae.actor_ref = 'system-auto-publish-v1'
    )
  )
  AND op.created_at >= :cutoverAt;

WITH auto_publication AS (
  SELECT DISTINCT ae.entity_id AS publication_id, op.created_at AS operation_created_at
  FROM admin_operation AS op
  JOIN audit_event AS ae ON ae.operation_id = op.operation_id
  WHERE ae.actor_ref = 'system-auto-publish-v1'
    AND op.operation_type = 'publish'
    AND ae.entity_type = 'publication'
    AND ae.event_type IN ('publication_published','publication_superseded','emergency_stopped')
)
SELECT
  (SELECT COUNT(*)
   FROM auto_publication AS ap
   JOIN publication AS p ON p.publication_id = ap.publication_id
   WHERE ap.operation_created_at >= :cutoverAt
      OR p.publication_status IN ('queued','reconcile_wait'))
  +
  (SELECT COUNT(*)
   FROM auto_publication AS ap
   JOIN projection_outbox AS ob ON ob.publication_id = ap.publication_id
   WHERE ob.created_at >= :cutoverAt
      OR ob.status IN ('pending','leased','retryable_failed','reconcile_wait'))
  AS prohibited_count;
```

Schema7 publish outbox轴：

```sql
SELECT
  COUNT(*) AS prohibited_count,
  COALESCE(SUM(CASE
    WHEN ob.outbox_kind NOT IN ('projection_delivery','withdraw_delivery')
    THEN 1 ELSE 0 END), 0) AS unexpected_type_count
FROM internal_operation_outbox AS ob
JOIN internal_operation AS op ON op.operation_id = ob.operation_id
WHERE op.owner_process = 'automatic_publisher'
  AND op.operation_kind = 'publish'
  AND (
    ob.created_at >= :cutoverAt
    OR ob.state IN ('pending','leased','reconcile_required')
  );
```

所有query还必须先对各表执行closed status/type distinct-set检查；任一值不在§10.3闭集时vector=`unknown`。SQL count=0不能覆盖process或schedule轴。

Distinct-set收据逐字执行下列只读SQL；结果按每列UTF-8 byte升序保存，允许集只取§10.2–10.3对应variant，不允许实现者补默认值：

```sql
SELECT DISTINCT owner_process, operation_kind, capability_class, egress_class, state
FROM internal_operation
WHERE owner_process IN ('automatic_reviewer','automatic_publisher')
ORDER BY owner_process, operation_kind, capability_class, egress_class, state;

SELECT DISTINCT ob.outbox_kind, ob.state, op.owner_process, op.operation_kind
FROM internal_operation_outbox AS ob
JOIN internal_operation AS op ON op.operation_id = ob.operation_id
WHERE op.owner_process IN ('automatic_reviewer','automatic_publisher')
ORDER BY ob.outbox_kind, ob.state, op.owner_process, op.operation_kind;

SELECT DISTINCT operation_type, operation_status
FROM admin_operation
WHERE operation_id GLOB 'auto-review-revision-*'
   OR operation_id GLOB 'auto-review-approve-*'
   OR operation_id GLOB 'auto-review-reject-*'
   OR operation_id GLOB 'auto-publish-batch-*'
ORDER BY operation_type, operation_status;

SELECT DISTINCT actor_ref, event_type, entity_type
FROM audit_event
WHERE actor_ref IN ('system-auto-review-v1','system-auto-publish-v1')
ORDER BY actor_ref, event_type, entity_type;

WITH auto_publication AS (
  SELECT DISTINCT ae.entity_id AS publication_id
  FROM audit_event AS ae
  JOIN admin_operation AS op ON op.operation_id = ae.operation_id
  WHERE ae.actor_ref = 'system-auto-publish-v1'
    AND op.operation_type = 'publish'
    AND ae.entity_type = 'publication'
)
SELECT DISTINCT p.publication_status
FROM publication AS p
JOIN auto_publication AS ap ON ap.publication_id = p.publication_id
ORDER BY p.publication_status;

WITH auto_publication AS (
  SELECT DISTINCT ae.entity_id AS publication_id
  FROM audit_event AS ae
  JOIN admin_operation AS op ON op.operation_id = ae.operation_id
  WHERE ae.actor_ref = 'system-auto-publish-v1'
    AND op.operation_type = 'publish'
    AND ae.entity_type = 'publication'
)
SELECT DISTINCT ob.operation_type, ob.status
FROM projection_outbox AS ob
JOIN auto_publication AS ap ON ap.publication_id = ob.publication_id
ORDER BY ob.operation_type, ob.status;
```

此外必须对`admin_operation`中由audit actor命中但operation ID prefix未命中的行输出计数；计数大于0为`unknown`，不能静默改用actor扩张producer闭集。Prefix命中但没有actor audit的operation仍是exact producer operation：按operation轴计数，cutover后必定`fail`，不能因为没有audit/effect就排除。空结果只表示该表在固定snapshot没有匹配行，不影响历史保留要求。

### 10.5 Process与schedule收据

Process receipt由进程外observer对manifest固定M1/UID/release执行，枚举全部同UID PID并生成closed record：

```text
AutoProcessObservation = {
  automation: "automatic_review" | "automatic_publish",
  ownerProcess: "automatic_reviewer" | "automatic_publisher",
  pid: integer 1..4194304,
  pidStartTime: UTC timestamp,
  executableRealpathSha256: SHA,
  executableBytesSha256: SHA,
  argvSha256: SHA,
  parentPid: integer 0..4194304,
  launchAgentLabel: string 1..256 UTF-8 bytes | null,
  classification: "manifest_exact_auto_owner"
}
```

`activeProcessInstances`是按`(pid,pidStartTime)`去重的record数。只有executable bytes+realpath+argv或LaunchAgent label与manifest为该owner固定的allowlist精确相等时才生成record；明确不引用两个auto producer/owner/label的其他同UID进程被排除。出现引用auto producer/owner/label但无法精确分类的PID、读取失败、PID race无法复读、allowlist重复/交叉配对或closed字段非法时vector=`unknown`；不得当作无关进程或0。

Schedule轴必须同时覆盖：

1. Admin进程内`setInterval`、`setTimeout`、startup direct call、promise/queueMicrotask和等价scheduler注册；
2. 独立PID/worker、loaded LaunchAgent、release内及目标路径全部plist、用户/系统cron与manifest scheduler registry；
3. owner handoff issuer是否可为两个auto owner生成新handoff。

Schedule finding为以下closed record：

```text
AutoScheduleFinding = {
  automation: "automatic_review" | "automatic_publish",
  findingClass:
    "embedded_interval" | "embedded_timeout" | "startup_direct_call" |
    "embedded_async_scheduler" | "independent_process" | "launchagent" |
    "cron" | "plist" | "manifest_scheduler" | "owner_handoff_issuer",
  producer:
    "app/src/server/admin-service/runtime.ts::automaticReviewTick" |
    "ReviewRepository.automaticReviewBatch" |
    "app/src/server/admin-service/runtime.ts::automaticPublishTick" |
    "ReviewRepository.automaticPublishBatch" |
    "f1plus1-owner-supervisor-v1",
  locatorSha256: SHA
}
```

`locatorSha256=SHA256(findingClass + "\\n" + producer + "\\n" + canonicalLocator)`；`canonicalLocator`对源码是release-closure-relative path+AST node kind+byte offset，对PID是executable realpath hash+argv hash+PID start time，对LaunchAgent/plist/cron/manifest registry是类型+label/path/entry的canonical JSON hash，对handoff issuer是issuer executable hash+owner literal。`registeredSchedules`是静态、运行和进程外三份收据中`AutoScheduleFinding`按`locatorSha256`去重后的数量；同一finding被多个observer看到只计1，任一observer读取不全则为`unknown`，不得当作0。Review receipt只允许review的前两个producer与issuer，publish receipt只允许publish的前两个producer与issuer；交叉配对或closed enum外的finding使vector=`unknown`。

Quick-launch release build必须完全不注册或调用当前`runtime.ts`的两个60秒路径。静态receipt对最终release closure做AST/call-graph检查，review forbidden symbols为`automaticReviewTick`、`automaticReviewInterval`、`automaticReviewBatch`的startup reachable registration/invocation；publish对应`automaticPublishTick`、`automaticPublishInterval`、`automaticPublishBatch`。运行receipt在Admin listen前安装sealed scheduler registry，启动后跨越至少一个`60_000ms`窗口，证明两个producer的registration和invocation均为0；registry instrumentation不允许应用进程自行签PASS。

当前`app/src/server/admin-service/runtime.ts` SHA-256 `9b8f831a165686e41eb2ae0b8d1652812e4e590102dd57573c53f05aa09729df`在源码中无条件注册两个`setInterval(...,60_000)`并在listen后立即调用两个tick，因此当前runtime对review和publish的`registeredSchedules`均至少为2（interval+startup invocation），必定`FAIL / NO_DEPLOY`。只有quick-launch release静态收据与运行收据同时为0才可通过；独立auto PID为0不能覆盖该失败。

### 10.6 Positive与negative vectors

| Vector | 输入 | 结果 |
|---|---|---|
| `POS-LEGACY-TERMINAL-PRESERVED` | cutover前存在`system-auto-review-v1` completed revision/approve/reject、`system-auto-publish-v1` completed publish、published publication、succeeded outbox及全部audit；无遗留nonterminal，无post-cutover自动对象，五轴均0 | `pass`；历史字节保留 |
| `NEG-PID0-EMBEDDED-REVIEW-TIMER` | 独立review PID=0，但Admin release仍注册`setInterval(automaticReviewTick,60000)`或startup调用tick | review `registeredSchedules>0`，`fail` |
| `NEG-PID0-EMBEDDED-PUBLISH-TIMER` | 独立publish PID=0，但Admin release仍注册`setInterval(automaticPublishTick,60000)`或startup调用tick | publish `registeredSchedules>0`，`fail` |
| `NEG-POST-CUTOVER-NO-WORK-OP` | cutover后任一auto owner创建operation，即使立即terminal、没有领域写或outbox | 对应`prohibitedOperations>0`，`fail` |
| `NEG-PRE-CUTOVER-NONTERMINAL` | cutover前auto operation仍`requested|authorized|attempt_committed|in_flight|reconcile_required`，或publish publication/outbox仍在本节nonterminal集合 | 对应operation/effect轴>0，`fail` |
| `NEG-POST-CUTOVER-EFFECT` | cutover后存在auto review revision/decision，或auto publish publication/delivery/projection outbox | `prohibitedEffects>0`，`fail` |
| `NEG-MISSING-EVIDENCE` | 任一PID/schedule/SQL/identity/status distinct-set收据缺失或无法重算 | `unknown / NO_DEPLOY` |

任何实现或文档不得把`fresh grant count=0`、独立worker PID=0、空batch未产outbox、全历史operation=0或删除legacy历史用作本vector替代证明。

## 11. Quick-launch R2 合同门关闭

R2独立复审结论为`PASS / P0=0 / P1=0 / P2=0 / quick-launch contract gate=CLOSED_PASS`；report SHA-256 `9a75a70c462be4c76d5d0b4c5db8925e6a574b6a9f1fab05e1297dc8674bcadf`、receipt SHA-256 `763737f8c6eddd05d2e09232e948b5e55ebd917369d474558dbe3cba73928d70`、manifest SHA-256 `5020a905065ffaabc1bcc89a1ba43906240429faef22350fe7d526eb39f7687d`，证据根`scratch/2026-08-24-trusted-single-user-m1-quick-launch-independent-review-r2/`。当前状态收口为`contract CLOSED_PASS / engineering authorized pending`。该关闭只授权后继工程候选按既有合同另行实施与复审，不表示实现、production-shaped E2E、M1或production通过。首轮FAIL及其整改历史保留；当前`runtime.ts`两个60秒interval和两个startup tick继续令review/publish的schedule轴`FAIL / NO_DEPLOY`，必须由后继release移除或机械拒绝注册并取得§10全部收据后才可继续部署门。
