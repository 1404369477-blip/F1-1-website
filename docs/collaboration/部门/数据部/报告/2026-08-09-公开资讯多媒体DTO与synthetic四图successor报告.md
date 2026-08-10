---
type: data_successor_report
status: final
date: 2026-08-09
department: 数据部
task_id: TASK-20260809-33B8F5
domain_stage: M5公开多媒体数据successor
decision: pass
summary: public-read-v0.2 proposed机器successor已冻结0..4有序媒体DTO、既有MediaCandidate→ReleaseBundle→Publication→PublishedProjection唯一链、v1首图兼容和0/1/4本地synthetic fixture；两次独立生成及每轮两次validator均确定性PASS，v0.4全部hash与1/12/12/12/10/12/12/12/12计数零漂移，external_calls=0。
---

# 公开资讯多媒体 DTO 与 synthetic 四图 successor 报告

## 1. 结论

测试部 P1-03 的数据前置缺口已关闭。新的 proposed `public-read-v0.2` 机器包让公开卡片从既有唯一领域链稳定导出 `0..4` 有序媒体数组；四图 fixture 能真实向正式 UI 提供四个不同的本地 synthetic asset、稳定主图/缩略图次序及逐图身份、alt、credit、tone、hash，足以驱动缩略图、单步切图与多图 lightbox。

机器包保持以下边界：

- v0.4 继续作为不可改写历史输入，所有字节、manifest artifact hash 和精确图计数均保持原值。
- 沿用 `MediaCandidate → ReleaseBundle → ReviewDecision → Publication → PublishedProjection`；领域实体增加数为 0。
- 每图 presentation 进入新 immutable ReleaseBundle canonical payload 的 `media_presentations[]`，与现有 `media_refs[]`、canonical `media[]` 同长、同序、同 identity。该数组参与 payload/bundle hash，修改任何 presentation 字段必须创建新 Bundle 并重新审核。
- DTO 是 presentation allowlist，不形成第二业务真值；前端不得复制首图凑四图，也不得自行生成 alt、credit、tone、identity 或顺序。
- 所有 asset 使用 `synthetic:` 引用，无真实媒体文件、URL、远程请求、Base 写入或外部 I/O。

数据合同已达到 P0/P1=0。P1-03 的最终运行关闭仍需开发部接入 successor，并由测试部在正式 App 中验证四图真实交互；本任务没有修改或启动 App。

## 2. 产出

目录：`data/mvp-contract-v0.5-public-multimedia-synthetic/`

| 文件 | SHA-256 | 作用 |
| --- | --- | --- |
| `schema.json` | `ade4feda490a8bc2fd68817d8f48ac0994cdf81dd4703e3317003d04705451de` | 完整 `public-read-v0.2` feed/detail DTO、0..4 media item、canonical media/presentation snapshot |
| `public-multimedia-mapping.json` | `3c05b244c0087d9aea35f63f80c38329b0e7205f78a04e7afcb097a1ef04ae7a` | 字段来源、顺序、guards、v1兼容、API/回退/错误及开发交接 |
| `fixtures.multimedia-synthetic.json` | `ee52a70cda9eea32600a443ad5411cd76d2b4cf3d8894d9b46396c28252823c0` | 0图、1图、4图三条完整 synthetic 发布链 |
| `generate_successor.py` | `23f4d8adf0f75f65f56997f9e7ecaa75d70790239fe860373012925cd2d2dc31` | 确定性离线生成器；写入仅限本目录 |
| `validate_successor.py` | `58063ea96b585fff65b11dedd3b95417a1ded9abc81e08aa102f19bc646e64c7` | schema/mapping/fixture/hash/rights/order/兼容/冻结输入语义 validator |
| `manifest.json` | 自身不自引用 | artifact、canonical hash、fixture count、v0.4 hash/count 与零外连收据 |

最终确定性收据：

- generator receipt：`5331d19c0b86d51213cd5d56588c051275f5868a05cfc4fbebc9caee975804b3`
- validator receipt：`319979783180a55c99121b161f1a3c2ac69f1736a285dcce8853773ef00a9166`

## 3. `public-read-v0.2` 多媒体 DTO

每个 feed/detail item 保留 v0.1 的全部非媒体字段。detail 继续包含 `leadZh`、`bodyZh[]`、`keyPointsZh[]`，分页继续是闭合的 `pageSize/hasMore/nextCursor`。

唯一媒体变化：

```text
media: PublicMediaItemV2[0..4]

PublicMediaItemV2 {
  kind: "synthetic_placeholder"
  mediaId
  assetRef
  mediaHash
  altZh
  captionZh
  creditDisplay
  tone
}
```

顺序规则：

1. `ReleaseBundle.media_refs[]` 是唯一顺序源。
2. `media[0]` 是稳定主图。
3. `media[1..]` 是缩略图和前后导航顺序；Repository 与前端都不得重排。
4. `media_refs[]`、`canonical_payload.media[]`、`canonical_payload.media_presentations[]` 必须同长、同序、ID逐项相等，长度只允许 0–4，ID不得重复。

逐图字段来源：

| DTO 字段 | 唯一来源 |
| --- | --- |
| `mediaId` | `ReleaseBundle.media_refs[index]`，并等于 MediaCandidate 与两类 canonical snapshot identity |
| `assetRef` | `MediaCandidate.asset_ref`，只允许 `synthetic:` 且不得含 URL delimiter |
| `mediaHash` | `MediaCandidate.media_hash`，必须等于 canonical media snapshot hash并按 synthetic asset input复算 |
| `altZh` | `ReleaseBundle.canonical_payload.media_presentations[index].alt_zh` |
| `captionZh` | 同一 presentation 的 `caption_zh` |
| `creditDisplay` | 同一 presentation 的 `credit_display` |
| `tone` | 同一 presentation 的 `tone` allowlist |

## 4. state、access、rights 与 hash fail-closed

- state 优先级固定：`restricted` 优先；其余情况下 `media=[] → media_missing`，有 1–4 张合规媒体则为 `available`。
- 每个 MediaCandidate 必须属于同一 Content，`candidate_status=selected`、`license_status=allowed`、`safety_status=passed`。
- ReleaseBundle 全局 rights、逐图 canonical rights/safety、MediaCandidate 当前值必须一致。
- 任何缺行、第五张、重复 ID、顺序漂移、hash 漂移、rights/safety 不合格、外部 asset、Bundle/approval/Publication/Projection 链不一致都会以 `PUBLIC_READ_INTEGRITY_FAILED` 拒绝整条资讯；不返回部分 gallery。
- `media_snapshot_hash` 对 canonical media 与 presentation 两个有序数组计算。
- `payload_hash=SHA-256(canonical-json-v1(canonical_payload))`。
- `bundle_hash_input` 保留冻结 v0.4 形态：`release_bundle_id/bundle_version/payload_hash/canonical_json_rule_version/immutable`；`bundle_hash` 对该对象计算。
- `published_version_hash` 绑定 approved bundle/content/summary hashes、publicId、generation 与 releaseBundleId；Projection 与 Publication 必须逐字相等。

## 5. synthetic 可达性 fixture

三条 fixture 相互独立：

| case | 媒体数 | state | V2 出口 | V1 降级 |
| --- | ---: | --- | --- | --- |
| `case-zero` | 0 | `media_missing` | `media=[]` | `media=null` |
| `case-single` | 1 | `available` | 单元素数组 | 相同首图单对象 |
| `case-gallery` | 4 | `available` | 四个不同 local synthetic item | 稳定首图单对象 |

`case-gallery` 的顺序为 `night → blue → amber → violet`，四个 mediaId、assetRef、mediaHash、altZh 均不同。正式 UI 接入 V2 后，可以从同一 API item 获得四张图，缩略图、pointer/touch/trackpad 单步切图和 lightbox 不再依赖静态前端数组。

## 6. API 兼容与回退

兼容策略是显式版本协商：

- 没有明确 V2 Accept 时继续返回原 `public-read-v0.1`，旧 DTO 字节形态不变。
- 精确 `Accept: application/vnd.f1plus1.public-read-v0.2+json` 返回 `schemaVersion=public-read-v0.2` 和媒体数组。
- V2→V1 降级：0图转 `null`；1–4图只取稳定 `media[0]` 并移除 V2 新增的 `mediaId/mediaHash`，得到当前单 media 对象。
- feed、detail、relatedItems 必须使用同一版本；一次响应禁止混合 V1/V2 item。
- 不支持的版本返回 HTTP 406 / `PUBLIC_MEDIA_VERSION_UNSUPPORTED`。
- 数据完整性错误继续使用 HTTP 500 / `PUBLIC_READ_INTEGRITY_FAILED`；未知 publicId 继续沿用既有 404。
- 回退时关闭显式 V2 negotiation，继续提供 v0.1；不得重写 v0.4 fixture、manifest、SQLite 或已批准 Bundle。

## 7. 开发部最小实施清单

本清单是后继任务输入，本任务没有改动这些路径。

1. `app/src/server/public/types.ts`
   - 保留所有 V1 类型不变。
   - 增加 `PublicMediaItemV2`、`PublicFeedItemV2`、V2 feed/detail response 与显式版本 union。
2. `app/src/server/public/repository.ts`
   - 读取 `media_refs`、canonical media、canonical media presentations 三个有序列表并逐项 join MediaCandidate。
   - 在 emit 前完成 count/identity/order/hash/rights/safety/approved bundle/Publication/Projection 全链验证。
   - V2 返回完整数组；V1 只执行确定性首图降级；任一 mismatch 整条 fail closed。
3. `app/src/app/api/public/feed/route.ts`
   - 精确协商 V2 media type；无显式 V2 时保持 V1。
   - unsupported version 使用 406 和固定 reasonCode，不把内部 hash/路径写入 Problem。
4. `app/src/app/api/public/stories/[publicId]/route.ts`
   - detail 与 relatedItems 复用同一个版本选择及 Repository 映射，禁止混合版本。
5. profile-scoped successor migration
   - 只在后继授权的新 successor migration 中持久化 immutable `media_presentations` snapshot，并把它纳入 payload/bundle hash。
   - v0.4 migration、fixture、manifest、public-synthetic DB 不得修改或就地升级。
6. seed/transaction
   - seed 先完整验证 0/1/4 三链和 frozen roots，再单事务写 successor profile；失败 rollback。
   - Publication 已 published 与 Projection identity/hash 一致后，Repository 才允许 V2 读取。

## 8. 已验证

- impact 已先声明，随后正式 claim；写路径只包含本 successor data 目录，标准报告由受管任务流交付。
- 连续两次独立 generator 输出同一 receipt；每次生成后 validator 各自独立 reload 两次，四次结果使用同一 validator receipt。
- schema 的 feed/detail/page/media 全部闭合；V2 detail 保留 V1 的三项详情扩展。
- 0/1/4 fixture 数量精确为 `1/1/1`，媒体总数 5；四图 item 具备稳定且不同的 identity/asset/hash/alt/tone。
- MediaCandidate→ReleaseBundle snapshot→approved Decision→published Publication→PublishedProjection 的 identity/hash链全部复算通过。
- v1 null/首图降级与 V2 数组版本规则通过。
- 五项聚焦负例全部被拒绝：presentation 顺序漂移、rights 非 allowed、外部 asset URL、第五张媒体、bundle hash 漂移。
- v0.4 manifest SHA、fixture SHA、schema SHA、DTO mapping SHA 和 manifest 内全部 artifact SHA 匹配。
- v0.4 精确计数保持 `sources/captured/content/summary/media/bundle/decision/publication/projection = 1/12/12/12/10/12/12/12/12`。
- `external_calls=0`、`real_media=0`、`writes_to_base=false`；没有 `__pycache__` 残留，`git diff --check` 通过。

## 9. 未验证

- App、SQLite、migration、Repository、API、UI 与 lockfile 均未修改。
- 没有启动网站、建立 successor SQLite、运行浏览器或执行缩略图/手势/lightbox 交互。
- P1-03 最终运行关闭需开发完成后由测试部验证；P1-01、P1-02 属于其他任务范围。
- 没有真实媒体、真实 URL、Base/provider/Collector 或外部网络验证。

## 10. 错题自检

- 没有建立 PublicStory、Gallery、平行媒体表或前端媒体真值。
- 没有就地修改 v0.4 schema/fixture/manifest，也没有用复制首图制造四图假出口。
- presentation metadata 已进入 immutable ReleaseBundle snapshot 与 hash，不依赖 UI 猜 alt/credit/tone。
- 顺序由 `media_refs` 单点冻结；Repository 和 UI 无权重新排序。
- 首版自审发现 detail extension 与 bundle hash 链精度不足，已在最终生成前修正并完整重跑；最终 manifest 只引用修正后的字节。
- 初次 impact 声明包含报告路径，被受管工具按控制根规则拒绝；任务保持 queued。随后按协议仅声明 data 写根并成功 claim，报告继续作为标准交付物，没有绕过任务真值。

TASK_STATE_OK
