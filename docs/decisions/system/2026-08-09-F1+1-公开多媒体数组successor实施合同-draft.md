---
type: system_implementation_contract
status: superseded_by_accepted
date: 2026-08-09
department: 产品部
decision_id: ADR-M5-PUBLIC-MEDIA-ARRAY-001
related_task: TASK-20260809-B10D8D
data_task: TASK-20260809-33B8F5
correction: COR-20260809T102214-960E65
decision_scope: 本地 synthetic 公开读链的 0/1/4 图有序媒体数组
authorization_state: user_confirmed_local_synthetic_only
implementation_state: blocked_pending_runtime_profile_successor
---

# ADR-M5-PUBLIC-MEDIA-ARRAY-001：公开多媒体数组 successor 实施合同（draft）

> 本草案已由 [ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001](./2026-08-09-F1+1-public-multimedia-synthetic运行profile与V2接线-successor-accepted.md) 收口。现行实施只认 accepted 决策与 [本地运行实施合同](../../spec/F1+1-public-multimedia-synthetic本地运行实施合同-v0.1.md)；本文件保留为决策历史。

## 1. 单一问题与结论

最终 v0.2 冻结设计已确认多图缩略图、主图切换、pointer/touch/trackpad 单步翻页和多图 lightbox。当前 accepted `public-read-v0.1` 只有 `media: object|null`，正式 `public-synthetic` 只能提供 0 或 1 图；前端组件保留多图分支不能形成真实用户出口。测试任务 `TASK-20260809-34476E` 将此判为 P1-03。

本草案固定产品需求，机器字段和 hash 真值只认数据部已 ACK 的 `TASK-20260809-33B8F5` 产物 `data/mvp-contract-v0.5-public-multimedia-synthetic/`：在不新增领域实体、平行媒体表或第二业务真值的前提下，把现有 MediaCandidate → ReleaseBundle media snapshot/refs → Publication → PublishedProjection 链映射为版本化的 0..4 有序公开媒体数组，并提供 0/1/4 图 synthetic 机器样本。

本段保留草案形成时的历史状态：当时为 `draft / P1-blocker`，数据机器前置已 PASS，App、SQLite、Repository、API 与 UI 尚未接线或运行。现行运行路线已由 `TASK-20260809-55302B` 的 accepted successor 固化；本文件不再作为实施入口。

## 2. 已确认、建议与 Unknown

### 2.1 已确认

- 用户已确认冻结设计中的真实多图交互属于初版功能；不得删除功能换取 PASS。
- 当前 `public-read-v0.1` 单媒体 DTO 与该功能冲突；`TASK-34476E` 的 P1-03 是现行阻断。
- 现有领域链已经有 MediaCandidate、ReleaseBundle 的 media snapshot/refs 和唯一 PublishedProjection；不能另建 Gallery、PublicStory、平行媒体表或前端媒体真值。
- 本轮只允许本地 synthetic 资产、`external_calls=0`、真实媒体=0、Base 写入=0。
- 数据部 `TASK-20260809-33B8F5` 已完成并由统筹 ACK：`public-read-v0.2`、0/1/4 图、V1 首图降级、V2 显式 Accept、回退/错误码和 v0.4 零漂移机器合同均 PASS。

### 2.2 产品建议

- 使用数据包冻结的显式版本协商：无显式 V2 Accept 时返回 V1；精确 V2 Accept 才返回 `public-read-v0.2`。同一 feed/detail/related 响应内禁止混合版本；冻结 `public-synthetic` v0.4 不得被 V2 runtime 读取、升级或混用。
- DTO 的媒体字段最终形态为 0..4 的有序数组；每个元素只承载展示必需的现有字段。数组顺序就是主图与缩略图顺序，首项是默认主图，不再新增 `primary` 或排序实体。
- v0.4 作为不可改写回退基线；successor 只在完整机器包、App 接线、测试和安全对同一 hash 候选 PASS 后才能成为 active contract。

### 2.3 Unknown

- 独立 `public-multimedia-synthetic` profile 的 SQLite path、migration selector/root、profile ledger/root pins、Repository runtime selection 和最终 accepted 状态。
- App V1/V2 协商、SQLite、Repository、API、UI 与回退的精确实现 hash 和运行收据。
- App 接线后的四图真实手势、焦点、性能和辅助技术收据。
- 真实媒体 URL、图片权利、代理/自托管、生产 CSP 与撤权流程；这些不属于本 successor。

## 3. 最小数据与 DTO 合同

数据任务必须在现有链上给出唯一机械映射：

```text
MediaCandidate[]
  → immutable ReleaseBundle.canonical_payload media snapshot/refs
  → approved Bundle / unique Publication
  → unique PublishedProjection
  → versioned public DTO media[0..4]
```

每个 V2 公开媒体元素逐字使用 33B8F5 已冻结字段：

```text
kind, mediaId, assetRef, mediaHash, altZh, captionZh, creditDisplay, tone
```

约束如下：

1. 数组长度只能为 0、1、2、3 或 4；初版 fixture 必须覆盖 0、1、4。
2. 数组顺序必须来自 ReleaseBundle 已冻结的有序 media snapshot/refs；前端不得排序、复制、截断补位或根据文件名猜顺序。
3. 每项必须唯一回指一个 selected MediaCandidate，并核对 identity、media hash、license、safety、rights、access 和 Bundle hash。任一缺失、重复、乱序或不一致使该公开链 fail closed。
4. public state 唯一优先级固定为：`content_access_status=source_restricted` 时为 `restricted`；否则 `media.length=0` 时为 `media_missing`；否则只有完整且全部通过的 1–4 图才能为 `available`。图片存在不得升级 restricted。
5. synthetic successor 只允许本地 `synthetic:` asset reference；出现 `http:`、`https:`、`data:` 输入、路径逃逸或未知 kind 由 Repository 拒绝。客户端可在受控 presentation 层把每个 synthetic 元素变成一张本地 data URI，但不得产生额外图片。
6. 每项 alt 非空；credit/caption 可空；任何真实 URL、内部 hash、rights 证据、路径或私有字段不得进入公开 DTO。
7. feed 与 detail 对同一 publicId 的媒体数组逐项相等；related item 使用同一结构。

字段、JSON pointer、hash、V1 降级、V2 Accept、406 `PUBLIC_MEDIA_VERSION_UNSUPPORTED` 与 500 `PUBLIC_READ_INTEGRITY_FAILED` 只认 33B8F5 机器包；产品文档不另造第二套字段。

## 4. 实施切片

### 4.1 数据部（已完成机器前置）

- 保留 `data/mvp-contract-v0.4-public-synthetic/` 全部字节、hash、count 和 manifest 不变。
- 已交付版本化 successor 的 schema、公开 DTO mapping、0/1/4 fixture、generator、validator、manifest 和回退说明。
- 至少一条四图卡片逐项具备唯一 assetRef/alt/credit/tone/identity/hash 来源；validator 连续两次从干净副本生成并 PASS。
- 明确 V1/V2 显式协商与独立 profile 的原子启停；禁止运行时猜测旧对象与新数组，禁止同一 feed/detail/related 响应混合 V1/V2，也禁止把冻结 `public-synthetic` v0.4 与新 profile 混跑。

### 4.2 产品运行 successor 与开发部

- `TASK-20260809-55302B` 已固化独立 `public-multimedia-synthetic` profile、migration/root/ledger、默认 V1 与显式 V2 runtime 协商及回退边界；冻结 `public-synthetic` v0.4 继续 V1-only 且零漂移。
- 开发只按 55302B accepted 决策与实施合同的 `DATA-MM-01` 前置和分阶段出口修改 public server types、Repository、Zod client schema、mapper 和对应测试。
- Repository 必须先验证完整数组与领域链，再一次性返回；禁止部分媒体成功。
- 前端 `images[]` 只由 DTO 数组一一映射；删除任何复制单图、静态数组、测试注入或隐式 placeholder 扩写。
- 四图正式样本必须让缩略图 hover/leave/click/Enter/Space、主图 pointer/touch/trackpad 单步切图、lightbox 前后/方向键/手势/计数真实可达。
- 同时关闭 `TASK-34476E` 的 lightbox 焦点返回 P1；多图数据完成不能掩盖该独立 P1。

### 4.3 测试、设计与安全

- 绑定数据机器包、SQLite、server types、Repository、client schema、mapper、UI 和测试的精确 hash。
- 0 图无缩略图；1 图无无意义缩略图/翻页；4 图顺序、主图、四缩略图和计数一致。
- 真实执行鼠标、键盘、touch、pointer、trackpad 与 lightbox，一次手势最多翻一张；关闭后焦点返回精确触发图。
- 篡改顺序、重复 media、缺 alt、坏 hash、rights/safety/access 失配、第五张、未知字段/版本、旧新 DTO 混跑全部 fail closed。
- 页面资源仍为零外部 URL；CSP、日志与 Problem 不泄露内部 media identity/hash/path。

## 5. 成功、失败与恢复

### 成功

- 数据 successor validator 已连续 PASS，v0.4 零漂移；后继 profile/接线候选也须独立 PASS。
- 正式同源 feed/detail 真实返回 0/1/4 图，四图由唯一投影链产生。
- UI 的多图全部交互与 lightbox 焦点通过独立测试/安全/设计核验。
- `external_calls=0`、真实媒体=0、Base 写入=0，且没有新增领域实体或第二真值。

### 失败

以下任一项保持 `MEDIA-DATA-002`、`MEDIA-NAV-003`、`MEDIA-LIGHTBOX-004` 为 `P1-blocker`：

- 只能靠前端复制、静态数组、测试拦截或组件分支到达四图。
- 需要新建 Gallery/PublicStory/平行媒体表或绕过 ReleaseBundle/Projection。
- 任一图片无法唯一证明顺序、rights/license/safety/hash/access。
- v0.4 字节、hash、count、manifest 漂移；同一响应混合 V1/V2；未收到精确 V2 Accept 却返回 V2；或冻结 `public-synthetic` v0.4 被 V2 runtime 读取、升级或混跑。
- 任一 mandatory 手势、焦点、故障注入或安全用例缺证据。

### 恢复

- successor 未全绿前，现行 public profile 和 App 继续使用冻结 v0.4 的 V1 0/1 图闭环。
- candidate 失败时停止新版本入口，删除可识别的本地候选 DB/build 产物，恢复到可机械证明的 v0.4 App/data hash；禁止改写 v0.4 历史文件。
- 若无法取得逐字节可证明基线，公开链保持 fail closed；禁止回退静态 Demo 或混跑单双 DTO。

## 6. 授权边界

用户对高保真和初版全部功能的确认已经覆盖本地 synthetic 多图 successor 的产品目标，可由后继数据/开发任务在零外联边界内推进。该确认不包含：

- 真实图片下载、代理、缓存、自托管或公开展示；
- 真实来源 URL、账号/API、平台内容权或媒体许可证；
- Base/provider/Collector 切换、真实采集、自动发布、部署、付费或外发；
- 修改现有 accepted ADR 核心。若机器包需要 accepted 合同变化，另建窄范围 successor 收口任务。

## 7. 当前验收出口

- 历史状态：`draft / P1-blocker`；现行 canonical 决策已 accepted，运行实现仍为 P1。
- 数据依赖：`TASK-20260809-33B8F5` 已 ACK/PASS；只关闭机器前置，不关闭运行 P1-03。
- 后继状态：`TASK-20260809-55302B` 已领取并形成 accepted successor；完整 runtime graph 与运行实现仍未交付。
- 当前允许：产品合同、机器包设计、本地 synthetic 产物和只读审查。
- 当前禁止：App/SQLite/migration 修改、真实媒体、外部 I/O、生产切换，以及把组件预留或 `NOT_RUN` 记为完成。
