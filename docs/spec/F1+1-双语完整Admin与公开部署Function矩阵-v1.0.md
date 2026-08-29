# F1+1 双语完整 Admin 与公开部署 Function 矩阵 v1.0

文档门状态：`Slice 0 COMPLETE / CLOSED_PASS`；各Function仍严格保持本矩阵逐行实现与production时态。

状态值只允许：

- `implemented-current`：当前真实代码与Function定义的Mac/iPhone入口、状态和恢复均已有证据；
- `implemented-current-backend`：只确认当前后端/worker窄闭集；不表示页面或双端完成；
- `engineering-candidate`：有隔离候选/收据，未进入生产；
- `implementation-pending`：合同已冻结，尚未实现；
- `production-gated`：工程可完成，生产值或不可逆动作等待manifest。

Open Design 冻结视觉只表达目标交互：每条公开内容有 zh/en切换；Admin有 zh/en/both查看编辑、retry zh、retry en与rerun；当前标记为 `NOT_DEPLOYED`、`realApi=false`。其精确文件路径与SHA在本矩阵的视觉身份段绑定；任何新视觉字节需新SHA和用户确认。

## 视觉身份

| Identity | 值 | 边界 |
|---|---|---|
| Open Design root | `[M5-HOME]/Library/Application Support/Open Design/namespaces/release-stable/data/projects/f1plus1-bilingual-detailed-extract-preview/` | 外部冻结设计根；不属于runtime closure |
| Admin `index.html` | `4a9e088beb0f8464f7a293b3be399d81e53c6c6ce91efa866aab00edc3c9002c` | zh/en/both、retry zh/en/rerun |
| Public `public-preview.html` | `c661a0192349b4a13064eea1e16cf82f2b787fbe82d9e0aff34a5749cce7b260` | 每story zh/en；64×44 DOM hitbox |
| `design-notes.html` | `bbee8e9ad29bc0bb03cf1284bd6da1154dbd8a26a7f3c0b9387963c451706e02` | 设计说明 |
| freeze manifest | `0431f203baf7fc47d10ec897f118cb1d1397d2216e57194ea62bde31601fb502` | `evidence/successor-2026-08-23-touch-target/freeze-manifest.json` |
| QA / measurements / screenshots | `7f20c3dd…647c` / `2d90a790…31d` / `7550f5f5…b56` | 精确全SHA见实现合同§6.1 |
| runtime marker | `NOT_DEPLOYED / realApi=false` | 只作目标视觉，未接真实API/DB |
| required views | Public story zh/en；Admin zh/en/both；retry zh/en/rerun | Mac/iPhone均需真实入口和状态 |

## Function 矩阵

| Function ID | 状态 | Mac / iPhone真实入口 | 数据/API出口 | 正常/失败/恢复 | Production gate |
|---|---|---|---|---|---|
| `PUBLIC-BILINGUAL-001` | implementation-pending | `/`、`/stories/{publicId}` 每story zh/en | Public v2 localized DTO；v1中文兼容 | en缺失不冒充available；保留zh LKG | signed v2 generation/cutover |
| `BILINGUAL-GENERATE-002` | engineering-candidate | Admin detail zh/en/both | 0009 draft；route/budget receipt | 分语言queued/running/complete/blocked/failed/stale | provider/model/key/budget manifest |
| `BILINGUAL-RERUN-003` | implementation-pending | retry zh、retry en、rerun both | `POST .../rerun-language` | 同operation子任务；unknown只reconcile | real gateway/attempt |
| `BILINGUAL-REVIEW-004` | implementation-pending | 双语编辑、版本diff | immutable bundle/release hash | stale零覆盖；重新加载当前版本 | schema9/full-fallback |
| `ADMIN-REVIEWS-005` | engineering-candidate | 当前`/admin/reviews`有基础入口；双语/双端全状态待实现 | 当前review list/detail基础；目标见合同§5.9 | 当前基础不证明双端reconcile/完整状态 | private Serve +双端验收 |
| `ADMIN-PUBLISH-006A` | implemented-current-backend | 当前Admin基础入口只有publish | `POST /api/admin/publications/{publicId}/publish`；证据`app/src/server/review-real/routes.ts`、`backend.ts`、`repository.ts`、`security.ts` | 只声明当前publish窄能力；不声明correct/withdraw或双端完整 | successor manifest/fresh/backup仍待验 |
| `ADMIN-PUBLISH-006B` | implementation-pending | correct/withdraw双端fresh目标入口 | `POST .../correct|withdraw` | unknown查同delivery，不建第二份 | schema9、fresh、backup |
| `ADMIN-SOURCES-007` | engineering-candidate | `/admin/sources/**` | existing source API→0010 single truth | validate/activate/stop/retire/requeue | schema10和四RSS无漂移 |
| `ADMIN-X-INBOX-008` | implementation-pending | `/admin/x-submissions/**` | 0008 manual URL | oEmbed disabled零外联；失败保留URL | manual oEmbed flag |
| `X59-BOUNDARY-009` | production-gated | sources中只读59 proposed/disabled | inventory hash / collectionMode=manual_url | 禁止poll/search/rules/RSSHub/cookie | inventory SHA；默认disabled |
| `AUTO-PHASE-010` | implementation-pending | `/admin/auto-publish` | 0007 control；fresh action | 双锁、cutoff、pause/stop恢复 | backup/release/schema/manifest |
| `AUTO-REVIEW-011` | implemented-current-backend | 当前无完整ops页面；仅worker | 当前v4 worker 60s/latest100；证据`app/src/server/admin-service/runtime.ts`、`review-real/repository.ts` | 只声明现有worker；不得外推successor或双端UI | 0007 gateway + bilingual gate |
| `AUTO-PUBLISH-012` | implemented-current-backend | 当前无successor phase UI；仅worker | 当前v4 worker 60s/batch20；证据`app/src/server/admin-service/runtime.ts`、`review-real/repository.ts` | 当前outbox wait；successor另验 | cutoff/full-fallback/live gate |
| `ADMIN-OPS-013` | engineering-candidate | `/admin/ops` 双端 | bounded snapshot DTO | unknown不算ok | observer/receipt inputs |
| `ADMIN-LOGS-014` | implementation-pending | `/admin/ops/logs` | allowlisted structured event | raw log不可用时unavailable | retention/sink manifest |
| `ADMIN-TRAFFIC-015` | implementation-pending | `/admin/ops/traffic` | ingress aggregate receipt | 无producer=unavailable，不是0 | producer/transport/retention |
| `ADMIN-API-016` | implementation-pending | `/admin/ops/apis` | durable attempt/result | dashboard GET不探测外网 | route/provider receipts |
| `ADMIN-COST-017` | implementation-pending | `/admin/ops/cost` | usage/billing + budget ledger | actual/estimate分开；缺失unavailable | provider billing identity |
| `ADMIN-ALERTS-018` | implementation-pending | ops overview | snapshot纯函数derived alerts | unknown优先；首版无ack mutation | notification另立合同 |
| `ADMIN-AUDIT-019A` | implemented-current-backend | 当前无`/admin/ops/audit`完整真实页面 | 当前operation/audit/outbox/receipt基础；证据`app/src/server/review-real/repository.ts`、`schema.ts` | 只声明backend基础，不声明bounded ops DTO | retention/DTO仍待实现 |
| `ADMIN-AUDIT-019B` | implementation-pending | `/admin/ops/audit` Mac+iPhone | 合同§5.10 bounded audit/log DTO | parse失败对应Datum unavailable | 双端/retention/真实receipt |
| `ADMIN-SECURITY-020A` | implemented-current-backend | 当前auth/review入口 | 当前Serve identity + session/CSRF/fresh基础；证据`app/src/server/review-real/security.ts`、`routes.ts` | identity漂移401零写；不声明security页面 | 真实policy/device仍gated |
| `ADMIN-SECURITY-020B` | implementation-pending | `/admin/security` Mac+iPhone完整页面 | session/device/capability只读bounded DTO | partial/offline/fresh-expired恢复待实现 | 真实policy/device/双端 |
| `BACKUP-RECOVERY-021` | engineering-candidate | `/admin/ops/backup` 只读；restore高风险 | common recovery point | age≥15m breach；隔离restore | off-host/key/drill/authority |
| `RELEASE-FALLBACK-022` | engineering-candidate | `/admin/ops/release` 只读 | full/fallback/pair/stage receipts | COMMIT后同schema fallback | final production manifest |
| `SOURCE-REGISTRY-023` | implementation-pending | sources双端全操作 | 0010必须返回canonical `identity_status=unknown\|verified\|needs_review`、`relevance_status=unknown\|qualified\|rejected`、`monitorability=unknown\|monitorable\|restricted\|unavailable`；`activation_readiness/epoch_fences`只读派生且不能alias/反写 | 普通新source、59X及四RSS三列默认/迁移值均为unknown；四RSS/59X逐字段映射；activate/queue显式读取三列、5 guards、5 epoch fences，任一派生guard blocked/unknown或epoch fence stale/unknown时零写零外联 | schema10/load receipt |
| `PUBLIC-DEPLOY-024` | production-gated | fixed public domain | signed active generation | public保持LKG；损坏503 | domain/signing/cutover |
| `ADMIN-PRIVATE-025` | production-gated | Mac+iPhone private FQDN | loopback3101 behind Serve | emergency入口默认off | Tailscale/app-cap/ACL/device |

## 完成硬门

每个完整Admin Function必须同时提供 Mac与iPhone真实入口、正常/loading/empty/error/partial/offline/reconcile/fresh-expired状态、恢复到可继续操作位置的证据，以及1440/1024/390×深浅主题视觉。`implemented-current-backend`只证明该行明确列出的后端窄闭集，永远不能满足页面或完整Function硬门；升级为`implemented-current`前必须补足同Function的双端证据。`NOT_DEPLOYED`、`realApi=false`、静态稿、隐藏调试、人工注入、TODO、SKIPPED或`NOT_RUN`不能升级为implemented或production complete。

## Slice 0 R4 独立复审关闭

关闭身份：report SHA-256 `3e6c69ee2c3f67523b0cfd6c9ea15ed1eee1692c2d61d371516e207345de3a22`；receipt SHA-256 `03327aa1af9119e55681f591e24bd4160c657973392bfe2bc53f45b01fe5d4aa`；manifest SHA-256 `09fa3a08e3736d29a198ced3e71e4983b9ccc2dbcc26440bfd665ba9cc44f022`。三者均位于`scratch/2026-08-24-bilingual-admin-contract-review-r4/`；结论为`PASS / P0=0 / P1=0 / P2=0 / Slice0Gate=CLOSED_PASS`。

该关闭只确认本矩阵及其ADR/实施合同达到后继工程切片的文档质量门；表内Function状态未因本记录升级，production仍由不可变`PRODUCTION-DEPLOYMENT-MANIFEST`逐项控制。

## 0007 fence/rollback successor 状态追加

本矩阵所有依赖0007 gateway、phase、fence、operation、release pair或后继0008–0010的Function继续保持原逐行状态，但增加统一P0前置门：

| Gate ID | 当前状态 | 影响Function | 关闭条件 |
|---|---|---|---|
| `SCHEMA7-FENCE-ROLLBACK-CONTRACT-GATE` | `0007-successor-contract-review-pending` | 本矩阵全部successor目标Function；现有`implemented-current-backend`窄事实只作历史current能力，不获successor放行 | 只审新ADR/合同/矩阵/Spec同步；独立合同复审`P0=0/P1=0`后进入implementation review pending |
| `SCHEMA7-FENCE-ROLLBACK-IMPLEMENTATION-GATE` | `blocked-until-contract-pass` | 本矩阵全部successor目标Function | 合同门关闭后才可生成新SQL六身份和无workaround E2E；独立实现安全/测试复审`P0=0/P1=0`后关闭Slice1工程门 |

旧0007 identity标记`SUPERSEDED_FOR_IMPLEMENTATION`不把任何Function降级为已实现或升级为complete；Slice1当前blocked。本append-only段是effective status，覆盖本文顶部的历史`Slice 0 COMPLETE / CLOSED_PASS`对Slice1的放行含义，但不回写其历史字节。R3 external pin、视觉身份和各Function的Mac/iPhone、状态/恢复及production门保持不变。

## 0007 successor 合同关闭后的 effective gate

| Gate ID | 现行状态 | 允许范围 | 仍需关闭条件 |
|---|---|---|---|
| `SCHEMA7-FENCE-ROLLBACK-CONTRACT-GATE` | `CLOSED_PASS` | 文档合同已关闭 | 独立pin：report `6c73bd52…5aa8b`、receipt `74e959ca…daff8`、manifest `73ef34bb…f4f` |
| `SCHEMA7-FENCE-ROLLBACK-IMPLEMENTATION-GATE` | `AUTHORIZED_PENDING / 0007-successor-implementation-review-pending` | 只允许隔离SQL、六身份、实现、负例、无workaround E2E候选 | 全量新identity、production-faithful E2E及独立实现安全/测试复审`P0=0/P1=0` |

因此Slice1 successor implementation可以另行派发，但Function状态不升级，Slice1工程门、0008和production继续blocked。历史FAIL、旧0007与R3 pin保持。

## Quick-launch effective mode overlay

状态：`review-pending`。现行入口为[可信单用户M1快速上线 successor ADR](../decisions/system/2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md)。此表只裁定首版运行模式，不把任何Function升级为implemented或production。

| 既有Function | quick-launch模式 | 必须证明 | 失败/残余风险 |
|---|---|---|---|
| `BILINGUAL-GENERATE-002` | 0009完成后自动zh-CN/en refine | exact route/model/prompt/budget；两槽独立attempt | 任一失败留人工retry，不生成假英文 |
| `ADMIN-REVIEWS-005` | 人工review/edit/approve/reject | private Admin session、Origin、CSRF、CAS/idempotency、audit | automatic reviewer不得获得schedule/handoff |
| `ADMIN-PUBLISH-006A/006B` | 仅人工fresh publish/correct/withdraw | fresh≤300秒、当前bundle/approval、signed delivery、LKG | same-UID可滥用本地凭证是已接受残余风险；公网与未授权设备仍拒绝 |
| `ADMIN-X-INBOX-008` / `X59-BOUNDARY-009` | 59 X proposed/disabled/manual URL；oEmbed disabled | poll/search/rules/RSSHub/cookie进程与外联=0 | 任一自动采集或oEmbed外联阻断上线 |
| `AUTO-PHASE-010` | 只用人工fresh phase/bootstrap控制 | shared旧0007 gateway/audit；禁止drop-trigger/raw update | Admin fence路径不具high-assurance，R7 deferred |
| `AUTO-REVIEW-011` | disabled | ADR §10 `automaticReview`五轴全0；owner=`automatic_reviewer`、kind=`review`、producer=`automaticReviewTick/automaticReviewBatch/system-auto-review-v1` | cutover后任一op/effect或cutover前遗留nonterminal FAIL；legacy terminal保留 |
| `AUTO-PUBLISH-012` | disabled | ADR §10 `automaticPublish`五轴全0；owner=`automatic_publisher`、kind=`publish`、producer=`automaticPublishTick/automaticPublishBatch/system-auto-publish-v1` | cutover后任一op/publication/outbox或cutover前遗留queued/nonterminal FAIL；legacy terminal保留 |
| `BACKUP-RECOVERY-021` | production gate | verified off-host backup、age≤900秒、隔离restore | Unknown/超RPO为NO_DEPLOY |
| `RELEASE-FALLBACK-022` | full_v10/manual_only_fallback_v10 | COMMIT前rollback；COMMIT后同schema fallback | 禁止down migration |
| `PUBLIC-DEPLOY-024` | signed snapshot only | receiver验签、active pointer、损坏LKG/503 | Public无DB/Admin/key能力 |
| `ADMIN-PRIVATE-025` | loopback+Tailscale Serve+Passkey | Funnel=0、双端fresh/撤销/直连负例 | same-UID loopback伪造属于已接受残余风险 |

迁移顺序为`schema6 → shared旧0007 trusted_local_capability_accounting_v1 → 0008 → 0009 → 0010`。R7继续`DEFERRED / NOT_SHARED / NOT_PRODUCTION`。用户确认只绑定本线程自然语言指令，`evidenceId=NOT_ISSUED`；不可变production manifest仍固定全部瞬时值。

## Quick-launch automatic-zero P1 更正

Review/publish只允许引用[quick-launch ADR §10唯一`AutoAutomationZeroVector`](../decisions/system/2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md#10-autoautomationzerovector-唯一合同)。五轴精确为process、schedule-registration、owner-handoff、post-cutover或遗留nonterminal operation、post-cutover或遗留queued/nonterminal effect；WebAuthn fresh不属于该vector。manifest固定`quickLaunchCutoverAt/release/manifest/DB identity/autoProcessIdentitySetSha256/scheduleInventorySha256`，cutover前terminal历史不计数且禁止删除。

当前Admin runtime的两个60秒timer和两个startup tick使schedule-registration轴FAIL；独立PID=0不构成PASS。只有quick-launch release静态call-graph与运行scheduler receipt都证明两个producerregistration/invocation=0，且ADR §10 exact SQL六份receipt均为0，两个Datum才可pass。独立FAIL report/receipt pin为`5fb3c8aa3bbbd453a69a7ef28222ebb9c0b56c69a1343dc1e19bd83cadfa5554`/`96ab78b838856fe5d2dabc20d51eaab5c9a76de1cb7f39bade41efcca9c40624`；状态保持`review-pending`。

## Quick-launch R2 合同门关闭

R2独立复审结论为`PASS / P0=0 / P1=0 / P2=0 / quick-launch contract gate=CLOSED_PASS`；report SHA-256 `9a75a70c462be4c76d5d0b4c5db8925e6a574b6a9f1fab05e1297dc8674bcadf`、receipt SHA-256 `763737f8c6eddd05d2e09232e948b5e55ebd917369d474558dbe3cba73928d70`、manifest SHA-256 `5020a905065ffaabc1bcc89a1ba43906240429faef22350fe7d526eb39f7687d`，证据根`scratch/2026-08-24-trusted-single-user-m1-quick-launch-independent-review-r2/`。当前状态收口为`contract CLOSED_PASS / engineering authorized pending`。该关闭只授权后继工程候选按既有合同另行实施与复审，不表示实现、production-shaped E2E、M1或production通过。首轮FAIL及其整改历史保留；当前`runtime.ts`两个60秒interval和两个startup tick继续令review/publish的schedule轴`FAIL / NO_DEPLOY`，必须由后继release移除或机械拒绝注册并取得§10全部收据后才可继续部署门。
