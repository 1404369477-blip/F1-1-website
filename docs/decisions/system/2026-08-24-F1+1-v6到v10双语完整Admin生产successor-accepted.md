---
type: system_adr
status: accepted
date: 2026-08-24
department: 产品部
decision_id: ADR-F1PLUS1-V6-V10-BILINGUAL-ADMIN-PRODUCTION-001
authorization_state: user_confirmed_full_admin_bilingual_public_deployment_goal
implementation_state: slice_0_complete
runtime_state: current_v6_v4_semantics
production_state: not_deployed
---

# ADR-F1PLUS1-V6-V10-BILINGUAL-ADMIN-PRODUCTION-001：双语完整 Admin 与公开部署 successor

## 决定

接受一条从当前唯一真实 review SQLite `user_version=6` 出发的单一 successor 路线：

```text
v6 current runtime
→ 0007 internal gateway / recovery / phase
→ 0008 X manual inbox
→ 0009 bilingual refinement / approval / publication
→ 0010 production source registry
→ immutable full/fallback release pair
→ PRODUCTION-DEPLOYMENT-MANIFEST
→ private full Admin + public read-only deployment
```

用户已经授权继续实现完整功能管理后台、双语详细提炼真实接线并以公开部署为最终目标。该授权允许工程切片在既定安全边界内持续推进，不等于任一 migration、真实模型、真实外联、M1 写入、服务切换或公开发布已经执行。所有生产瞬时值和不可逆动作继续由不可变 `PRODUCTION-DEPLOYMENT-MANIFEST` 放行。

## 精确 supersede 范围

旧 accepted 文件保留原字节，不原地修改。本决定精确取代以下已经与当前 runtime 冲突的实施身份：

1. `ADR-M5-BACKLOG-AUTO-PUBLISH-001/002/003` 及其实施合同中把条件自动发布 migration 命名为 `0005_auto_publish_policy.sql`、目标 `user_version=5`、源 schema 视为 v4 的部分；
2. 以上文件内由该旧编号推导的 migration selector、schema fingerprint、full/fallback compatibility root 和 production apply 次序；
3. 任何把当前 `user_version=5` 或 `user_version=6` 解释成 accepted v5 自动发布合同已实现的说法。

被继承 predecessor 必须按下表验证原字节。本 ADR 只 supersede 表中的旧 migration/schema 实施身份；其余条款继续有效。

| Predecessor | SHA-256 | 本 successor 取代的 identity key |
|---|---|---|
| `docs/decisions/system/2026-08-14-F1+1-存量优先确定性安全初审与条件自动发布-successor-accepted.md` | `59302394fe76f9dfbea32ab054b1969ca3b5d0f15bd55ffb09f98520f209a298` | `0005_auto_publish_policy.sql/user_version=5/source_schema=4` |
| `docs/decisions/system/2026-08-14-F1+1-条件自动发布v5双层回退-successor-accepted.md` | `329b8680d44bc0877abd176ba8f5b104c35c336ca914a22f1f898996ab357a49` | 上述旧 schema 的 full/fallback apply 次序 |
| `docs/decisions/system/2026-08-14-F1+1-条件自动发布v5无环release-pair身份-successor-accepted.md` | `ef06aeb4c6d1bd1a4fbf4baf306284c31707fdef50204d7e473c7f5324842c1b` | 上述旧 schema 派生的 selector/fingerprint/pair identity |
| `docs/spec/F1+1-存量优先确定性安全初审与条件自动发布实施合同-v0.1.md` | `633babb5949562b51a8cd57621538ca9d09136e0eb49e7cfd1bc6f73846dd2d7` | 旧 0005/schema 4 参数 |
| `docs/spec/F1+1-存量优先确定性安全初审与条件自动发布实施合同-v0.2.md` | `a9b2ff909d5e5107f05d1445cbc336d3e7370e3a118f1c9d4cb104d1eb3de0b3` | 旧 full/fallback apply 参数 |
| `docs/spec/F1+1-存量优先确定性安全初审与条件自动发布实施合同-v0.3.md` | `58b0919356ff1f6da90e9e803b4217e14c24ea1b0428148d672fd9bbe2810fb0` | 旧 pair builder/verifier 的 migration/schema 输入 |

以下旧合同语义继续有效，并由本 successor 继承：默认 `disabled`、存量 cutoff、oldest-first、collector 零外联、approved-only CAS、每批最多 20、单 snapshot/outbox、same-delivery reconcile、last-known-good、fresh phase control、operation/channel/actor closed union、双层回退、无环 release-pair receipt、备份 `RPO≤15m`、恢复 `RTO≤4h`、停止与审计。

现有文件编号保持不变：

- `0005_second_rss_autosport.sql` 是第二 RSS migration；
- `0006_independent_rss_racefans_the_race.sql` 是 RaceFans/The Race migration；
- 两者都不属于旧 v5 auto-publish migration。

## 迁移序列和不可复用边界

### 0007：internal gateway / recovery / phase

唯一候选身份来自 `scratch/2026-08-21-migration-0007-contract/`：

- contract identity：`8dffe664191aab20d70244280e5d95b926c5206f22d788e33391494f93bee5ad`；
- candidate manifest raw：`feb9986e9e434dc8d9393f9556ab853e8029877137f3e0e834e93d3cf96c958b`；
- SQL raw：`ab32bb74fb404656bbdf6f84cc8a6967e18f8ed797f59ec27125291e5c26a163`；
- SQL canonical：`d651a156ad1264562962be13fb1742d2e41bd85d1523284e056f2458a4c44797`；
- source schema 6：`396af1d629a1bed95ec846770aaf26a3483d58b4ff28ce9d9f2c876a9987f8a9`；
- disposable post schema 7：`f3c0c049575b3121cccc8e66438481c70931df461cd941b95aaa54100844ad60`。

该候选仍是 `FROZEN_CANDIDATE_FOR_IMPLEMENTATION`，尚未进入共享 `app/`、真实 DB 或生产。实现若改变其语义或冻结身份，必须形成新的 0007 successor 候选并重新审查；不得复用编号静默漂移。

0007 是唯一写权限、durable external attempt、writer/recovery epoch、phase、required fence、common recovery point 和 owner handoff 地基。所有 collect/refine/review/publish/reconcile/projection/source mutation 在 schema 7 后必须经过 gateway。

### 0008：X manual inbox

0008 的首版能力固定为人工提交单条公开 X status URL 的私有收件箱。59 条 X source 保持 `proposed + disabled + collectionMode=manual_url`：

- 不轮询账号、时间线、搜索或规则 API；
- 不使用 RSSHub、cookie、浏览器会话、代理或规避；
- 官方 oEmbed 默认 `disabled`；
- 只有 production manifest 显式启用 `manual_single_url_oembed` 后，单条人工 URL 才能进入官方 oEmbed durable attempt；
- oEmbed 结果不直接进入公开投影，deletion/rights/media 任一 Unknown 时 publication fence blocked。

历史 `0008_x_official_ingest_v1` 候选不自动进入本路线。若沿用其表或字段，必须先形成明确降窄到 manual inbox 的新冻结身份并重新审查。

### 0009：bilingual refinement

0009 承载中文与英文两个独立语言槽、不可变 draft/bundle/approval/publication/projection 和稳定 `publicId` 回填。当前 `scratch/2026-08-21-bilingual-refinement-candidate/` 仅为 `apply=false` 候选；其 R5 结论只允许进入 clean integration 计划。

生产不变量：

- `zh-CN` 与 `en` 都必须 `complete + current + reviewable` 才能形成 bilingual bundle；
- 任一来源、prompt、model route、文本或 hash 变化产生新 bundle/release，旧 approval 失效；
- Public v2 不含 `sourceExcerpt/rawSource/sourceBody/rawBody`；
- 旧中文-only active projection 在回填失败时保持 last-known-good；
- 不生成假英文，不把英文整理稿称为原文或官方翻译；
- copy-risk screen 是保守阻断器，不构成版权法律判断。

### 0010：production source registry

0010 消除真实 review DB 的四源 hard-coded `CHECK` 与 synthetic source-management 第二真值。四条现行 RSS 逐字段迁移且不得漂移。canonical Source必须保留三列及唯一枚举：`identity_status=unknown|verified|needs_review`、`relevance_status=unknown|qualified|rejected`、`monitorability=unknown|monitorable|restricted|unavailable`。新source及59 X的三列默认均为`unknown`；其他新source默认固定为`enabled=false / lifecycle_status=proposed / collection_onboarding_status=validating / normalization_status=pending / dedup_status=pending / adapter_status=unchecked / adapter_authorization_status=unknown / platform_allowed=unknown / source_stop_status=clear / source_config_epoch=1 / source_safety_epoch=1`。生命周期闭集只为`proposed|active|paused|retired`；`validating`只属于collection onboarding。派生guard/fence不得替代、改名或反写这三列。59 X仍为disabled/manual。

Source只读read model可增加`activation_readiness`与`epoch_fences`，但它们不是canonical Source列。前者只从canonical URL/normalization/dedup/三列status、platform、authorization、adapter和stop机械派生；后者的五个唯一真值依次为`source_config_epoch/source_safety_epoch/authorization_version/policy_epoch/recovery_epoch`。缺值、解析失败或receipt无效一律Unknown并阻断activate/queue/provider；不得用canonical status的`unknown`冒充read-model Unknown，也不得用默认值补齐epoch。

## 单一目标拓扑

```text
Mac / iPhone
  → private overlay + Tailscale Serve app-cap
  → loopback Admin :3101
  → Passkey session + Origin + one-time CSRF + fresh re-auth
  → InternalOperationGateway
  → one review SQLite writer
  → signed immutable full snapshot
  → public receiver / active pointer
  → public read-only host
```

Admin 在 Mac 和 iPhone 功能等价。布局可以适配，审核、双语编辑/重跑、发布/撤回、source 管理、X inbox、phase、备份/恢复状态、ops、审计和失败恢复能力不得因移动端被删除或隐藏。应急公网 Admin 入口默认关闭；隐藏 URL、`robots.txt`、前端路由或登录页不构成网络隔离。

## 新内容默认链与 phase

唯一 phase 为 `disabled|backlog|live|paused`。生产首次启用必须从 fresh `disabled→backlog` 开始，在同一个 `BEGIN IMMEDIATE` 内证明 running collector slot 为 0、冻结 cutoff、增加 epoch 并写审计。collector claim读取同一 singleton；`backlog|paused` 在 DNS/socket 前 `externalCalls=0`。

backlog 仅选择 cutoff 内当前 source revision/hash、当前 bilingual bundle、当前 approval 和唯一 queued Publication，按 oldest-first 稳定排序，每批 `1..20`。`waiting|manual_override|failed|reconcile_required|stale`、非终态 outbox、backup breach、schema/release drift 任一存在时不得进入 live。进入 live 后只在下一自然 `900s` 槽恢复采集。

live 新内容默认链为：

```text
collect → normalize/dedupe → zh+en refinement
→ deterministic safety review → approved/queued
→ system auto publish → one signed full snapshot/outbox
→ same-delivery receiver → active public projection
```

语言、媒体权利、模型 route/预算、backup、stop/recovery/deletion/publication fence、schema/release/manifest或上一 outbox 任一 Unknown 时停在可恢复队列。

## Admin 与 observability 边界

Admin 目标页面包括 reviews、sources、X submissions、ops overview/pipeline/logs/traffic/APIs/cost/release/backup/audit/security。首版 observability 为 server-side bounded read model：

- pipeline 来自 review DB 持久事实；
- process/listener/public reachability来自进程外 sealed observer receipt；
- traffic来自 public ingress `traffic-aggregate-v1` receipt；
- cost actual来自 provider usage/billing receipt，估算必须显式标记；
- logs仅返回 allowlisted structured event；
- alerts由同一 snapshot纯函数派生。

producer不存在或过期时显示 `unavailable|stale|unknown`，不能显示 0 或 healthy。Admin GET不得执行 shell、远程 probe、backup、restart或任何 mutation。traffic禁止 IP及其 hash、Cookie/Auth、UA、body、query、full URL和referrer。

## 冻结视觉身份

双语 Public 与 Admin 的目标交互绑定到 Open Design 项目绝对路径：

`[M5-HOME]/Library/Application Support/Open Design/namespaces/release-stable/data/projects/f1plus1-bilingual-detailed-extract-preview/`

| Artifact | SHA-256 | 冻结意图 |
|---|---|---|
| `index.html` | `4a9e088beb0f8464f7a293b3be399d81e53c6c6ce91efa866aab00edc3c9002c` | Admin `zh/en/both`、retry zh、retry en、rerun |
| `public-preview.html` | `c661a0192349b4a13064eea1e16cf82f2b787fbe82d9e0aff34a5749cce7b260` | 每 story zh/en；移动端 DOM hitbox `64×44` |
| `design-notes.html` | `bbee8e9ad29bc0bb03cf1284bd6da1154dbd8a26a7f3c0b9387963c451706e02` | 设计说明 |
| `evidence/successor-2026-08-23-touch-target/freeze-manifest.json` | `0431f203baf7fc47d10ec897f118cb1d1397d2216e57194ea62bde31601fb502` | successor freeze manifest |
| `evidence/successor-2026-08-23-touch-target/qa-report.md` | `7f20c3dd859ac61138ed67c387c1e5440fdad561171c198e7f265be443af647c` | QA 报告 |
| `evidence/successor-2026-08-23-touch-target/touch-target-measurements.json` | `2d90a790f37118bb8c829d457eea978e524ad76d0534d86d561045194d93e31d` | touch target measurements |
| `evidence/successor-2026-08-23-touch-target/screenshots.sha256` | `7550f5f59b132a7ece0d4ef90734fb1a7df4410634277035175ac6d05586cb56` | screenshots manifest |

这些文件明确标记 `NOT_DEPLOYED`、`realApi=false`。它们冻结实现目标和验收锚点，不证明真实 API、DB、模型、Admin 或 Public 已接线；实现候选必须以真实运行字节另交同候选视觉/功能证据。

## 回退和生产门

每一级 schema 都必须同时预构建并 stage：

```text
full_vN
manual_only_fallback_vN
```

COMMIT 前失败整体 rollback并证明原 schema/identity/audit/outbox不漂移；COMMIT 后禁止 down migration和旧 runtime打开新 schema，只能切同候选、同 schema、同 pair receipt 的 fallback。迁移前一致性备份只用于灾难恢复，恢复必须报告 audit fork和实际丢失窗口。

`PRODUCTION-DEPLOYMENT-MANIFEST` 继续是生产值和不可逆动作唯一门，至少固定主机/UID/路径/inode、域名/Tailscale policy/device、migration/schema/release pair、Node、签名密钥、provider/model/budget、source/版权/媒体 policy、备份/恢复、observer/traffic/log/cost/alert和 phase/cutoff 值。HTTP、普通环境变量、自由 CLI 参数或待验证 artifact不能覆盖这些值。

## 当前状态

- 已实现并运行：schema 6、四条 RSS、现行中文 refinement、v4语义 automatic review/publish、真实 Admin review基础、signed public snapshot基础。
- 已有但未部署的工程候选：release successor R3 evidence gate、0007 frozen contract、0008/X和0009/bilingual隔离候选、Admin telemetry候选。
- 待实现：0007–0010共享树实现、完整 Admin route/page、Public v2、production source registry、successor auto phase、full/fallback pair、真实 observer/traffic/cost/log/alert链。
- production-gated：真实 migration、模型/密钥/费用、oEmbed外联、M1写入、Serve policy、备份/恢复、phase离开disabled、public固定域名cutover和任何真实发布。

本 ADR 接受的是目标合同和实施顺序，没有把任何规划、原型、离线 fixture、`realApi=false` 或 `NOT_DEPLOYED` 产物写成已上线。

Slice 0 当前时态为 `COMPLETE / CLOSED_PASS`。R4只修 canonical Source三列、0010 mapping、activation/queue guard与五个epoch fence的唯一真值；独立复审已关闭该唯一P1。此状态仅关闭文档合同门，各Function的实现与production状态仍以Function矩阵及production gate为准。

## Slice 0 R4 独立复审关闭 pin

- report：`scratch/2026-08-24-bilingual-admin-contract-review-r4/review-report.md`，SHA-256 `3e6c69ee2c3f67523b0cfd6c9ea15ed1eee1692c2d61d371516e207345de3a22`
- receipt：`scratch/2026-08-24-bilingual-admin-contract-review-r4/review-receipt.json`，SHA-256 `03327aa1af9119e55681f591e24bd4160c657973392bfe2bc53f45b01fe5d4aa`
- manifest：`scratch/2026-08-24-bilingual-admin-contract-review-r4/manifest.json`，SHA-256 `09fa3a08e3736d29a198ced3e71e4983b9ccc2dbcc26440bfd665ba9cc44f022`
- 结论：`decision=PASS / P0=0 / P1=0 / P2=0 / Slice0Gate=CLOSED_PASS`。

该关闭不表示0007–0010、完整Admin、双语Public、M1或production已经实现或部署；`PRODUCTION-DEPLOYMENT-MANIFEST`继续是生产瞬时值与不可逆动作的唯一门。

## 0007 fence/rollback successor 追加更正

后继独立安全审计发现旧 frozen 0007 的singleton deletion/publication fence可由Admin `phase_control/fence_update`在没有verified truth receipt时直接clear，且Slice1 E2E使用drop trigger后裸UPDATE的test-only workaround。旧0007以下身份现标记`SUPERSEDED_FOR_IMPLEMENTATION`：contract `8dffe664…e5ad`、manifest `feb9986e…958b`、SQL raw `ab32bb74…a163`、SQL canonical `d651a156…4797`、post-schema `f3c0c049…d60`；旧文件和证据原字节保持不变。

唯一现行0007合同入口改为[0007 fence/rollback successor ADR](2026-08-24-F1+1-0007-fence与rollback-successor-accepted.md)和[实施合同](../../spec/F1+1-0007-fence与rollback-successor实施合同-v1.0.md)。当前状态为`0007-successor-contract-review-pending / Slice1 BLOCKED`。新SQL/raw/canonical/post-schema/manifest/contract identity均尚未创建；在独立合同复审关闭前不得实施0007或推进0008。Slice 0 R4历史关闭只证明当时三份目标文档，不覆盖本次新增P0。R3 external pin保持原字节和原语义。

本append-only段是本文0007的effective status，覆盖上文`Slice 0 COMPLETE / CLOSED_PASS`对0007后继工程的放行含义；上文继续作为历史记录，不被回写。

## 0007 successor 合同门正式关闭

独立审核闭包：report SHA-256 `6c73bd52fc2617717302994f1ffe5571db1b2a78bdc05515a01a87a387e5aa8b`；receipt SHA-256 `74e959ca3a321d191d4fd7f02723f94a2b0e843bea685c93be93ac84c02daff8`；manifest SHA-256 `73ef34bb4466beea632b4cee5552be75f045a235682613acc255800f2828ff4f`；根目录`scratch/2026-08-24-0007-successor-contract-independent-review/`；manifest `2/2 OK`；结论`PASS / P0=0 / P1=0 / P2=0`及`MICRO_PASS / P0=0 / P1=0`。

现行状态为`contract CLOSED_PASS / 0007-successor-implementation-review-pending / Slice1 successor implementation AUTHORIZED_PENDING`。该授权只允许另行派发隔离SQL、六身份、实现、负例和无workaround E2E候选；Slice1工程门、0008与production继续blocked。旧FAIL、旧0007 frozen bytes、`SUPERSEDED_FOR_IMPLEMENTATION`和R3 external pin保持原义。

## 可信单用户 M1 quick-launch successor overlay

用户随后明确选择“可信单用户M1 + 自动RSS采集/双语处理 + 人工审核发布 + Admin私网”，并接受same-UID残余风险；现行实施入口追加为[可信单用户M1快速上线 successor ADR](2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md)。该ADR在quick-launch范围内覆盖上文“必须先完成high-assurance 0007 successor implementation才能推进0008”的顺序，当前状态为`quick-launch-contract-review-pending`。

首版路线固定为`schema6 → shared旧0007 trusted_local_capability_accounting_v1 → 0008 X manual disabled → 0009 bilingual → 0010 source registry → full_v10/manual_only_fallback_v10`。shared旧0007 raw SHA-256为`ab32bb74fb404656bbdf6f84cc8a6967e18f8ed797f59ec27125291e5c26a163`；它只在same-UID可信假设下提供capability/accounting/audit骨架，不具备恶意same-UID防护。high-assurance successor R7及后继整改继续`DEFERRED / NOT_SHARED / NOT_PRODUCTION`，旧accepted、FAIL和候选字节不改。

首版`automatic_review=disabled / automatic_publish=disabled`；RSS collect与zh-CN/en refine可自动，review与publish只允许人工，publish/correct/withdraw仍需private Admin及fresh≤300秒。59 X保持proposed/disabled/manual URL，oEmbed disabled。Admin仍必须loopback+Tailscale Serve+Passkey/session/Origin/CSRF/fresh/audit，Public只激活signed immutable snapshot。backup RPO≤900秒、COMMIT前rollback、COMMIT后同schema fallback和Public LKG均为上线硬门；不可变`PRODUCTION-DEPLOYMENT-MANIFEST`继续固定全部瞬时值。

本线程用户确认只记录为`evidenceKind=current_thread_user_instruction / evidenceId=NOT_ISSUED`，不得伪造消息ID、ticket或receipt。该append-only段是quick-launch现行状态；它没有把规划写成已实现或已部署。

## Quick-launch automatic-zero P1 更正

Automatic review/publish禁用证明只允许使用[quick-launch ADR §10 `AutoAutomationZeroVector`](2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md#10-autoautomationzerovector-唯一合同)。manifest固定`quickLaunchCutoverAt/release/manifest/DB identity/autoProcessIdentitySetSha256/scheduleInventorySha256`；cutover前terminal legacy/audit/provenance保留且不计数，cutover后任一匹配operation/effect均计数，cutover前遗留nonterminal/queued也计数。review/publish分别使用精确owner、operation kind、producer、channel、outbox type和status闭集。

五轴为process=0、schedule-registration=0、owner-handoff=0、prohibited-operation=0、prohibited-effect=0。schedule包含Admin内嵌timer/startup call、独立PID、LaunchAgent、cron、plist和registry；当前两个60秒timer使现行runtime必定FAIL。独立FAIL pin为report `5fb3c8aa3bbbd453a69a7ef28222ebb9c0b56c69a1343dc1e19bd83cadfa5554`、receipt `96ab78b838856fe5d2dabc20d51eaab5c9a76de1cb7f39bade41efcca9c40624`；当前仍为`quick-launch-contract-review-pending`。

## Quick-launch R2 合同门关闭

R2独立复审结论为`PASS / P0=0 / P1=0 / P2=0 / quick-launch contract gate=CLOSED_PASS`；report SHA-256 `9a75a70c462be4c76d5d0b4c5db8925e6a574b6a9f1fab05e1297dc8674bcadf`、receipt SHA-256 `763737f8c6eddd05d2e09232e948b5e55ebd917369d474558dbe3cba73928d70`、manifest SHA-256 `5020a905065ffaabc1bcc89a1ba43906240429faef22350fe7d526eb39f7687d`，证据根`scratch/2026-08-24-trusted-single-user-m1-quick-launch-independent-review-r2/`。当前状态收口为`contract CLOSED_PASS / engineering authorized pending`。该关闭只授权后继工程候选按既有合同另行实施与复审，不表示实现、production-shaped E2E、M1或production通过。首轮FAIL及其整改历史保留；当前`runtime.ts`两个60秒interval和两个startup tick继续令review/publish的schedule轴`FAIL / NO_DEPLOY`，必须由后继release移除或机械拒绝注册并取得§10全部收据后才可继续部署门。
