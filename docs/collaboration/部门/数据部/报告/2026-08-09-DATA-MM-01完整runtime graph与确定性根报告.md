---
type: data_runtime_graph_report
status: final
date: 2026-08-09
department: 数据部
task_id: TASK-20260809-5E97E0
function_id: DATA-MM-01
domain_stage: M5公开多媒体数据运行闭图
decision: pass
summary: 在冻结v0.5五个ACK artifact及旧manifest不变的前提下，仅新增四个固定文件，交付Source至Projection与5个MediaCandidate的0/1/4完整可seed闭图、runtime manifest及确定性generator/validator根；两个独立/tmp干净生成和repeat=2验证得到同一receipt，P0=0/P1=0，旧M3/v0.4/public-synthetic根零漂移。
---

# DATA-MM-01：完整 runtime graph 与确定性根报告

## 1. 结论

`DATA-MM-01` 已完成，P0=0、P1=0。`public-multimedia-synthetic` 第三 profile 现有完整、确定、可由后继开发直接原子 seed 的机器输入：

- 一条 Source；
- 三条 CapturedItem、Content、Summary、ReleaseBundle、approved ReviewDecision、published Publication、PublishedProjection；
- 三条公开链分别承载 0、1、4 张媒体；
- 五条 MediaCandidate，总数精确为 5；
- 四图链的四个 MediaCandidate 共用同一个 Content，identity 各不相同，顺序只由 `ReleaseBundle.media_refs[]` 决定；
- Event 与 OutboxJob 在已发布 seed 中均为 0；
- 每条 Publication 与 Projection 一一对应，publicId、generation 与 published hash 一致；
- V2 逐项预期与冻结 33B8F5 fixture 相同，V1 对 0 图返回 null、对 1/4 图返回稳定首图。

本任务只在既有 v0.5 目录新增任务合同指定的四个文件。原 schema、mapping、fragment fixture、successor generator、successor validator 和旧 manifest 均保持逐字不变；App、SQLite、migration、design、Spec、ADR 与 lockfile 未修改。

## 2. 四个新增文件与正式哈希

| 文件 | SHA-256 | 作用 |
| --- | --- | --- |
| `runtime-graph.public-multimedia-synthetic.json` | `dc03afda4e005617b25ab19706b2ed4aeb13fce2d868006865469d280e2e1130` | 完整领域闭图、DTO预期、精确row counts与profile ledger seed绑定合同 |
| `runtime-profile-manifest.json` | `5559745cfbab3179e9a62d531dc0a8e858299765be4f84f05dd563506bbaeff7` | 原五个ACK artifact与graph/generator/validator roots、旧根、counts及执行receipt |
| `generate_runtime_graph.py` | `84f9decf5103e5eb1077f773daf0b41c19e69388f1a1ccce8cb0f87cc5ca4f65` | 只写包目录或`/tmp`后代的确定性原子生成器 |
| `validate_runtime_graph.py` | `eeb094e8539cb2edcba11fcd3be2b81df373706d617119859bb683a939fc17f1` | 实体schema、FK、hash、order、rights、V1/V2、manifest/root离线validator |

runtime manifest 不列自身文件 SHA，避免自哈希循环；其文件 SHA 由后继 profile ledger 的 `fixture_manifest_hash` 外部绑定。

## 3. 精确 row counts

```json
{
  "sources": 1,
  "captured_items": 3,
  "contents": 3,
  "events": 0,
  "summaries": 3,
  "media_candidates": 5,
  "release_bundles": 3,
  "review_decisions": 3,
  "publications": 3,
  "outbox_jobs": 0,
  "published_projections": 3
}
```

`seed_order` 逐字固定为上述领域数组顺序。数组内部行使用确定性 story/case 顺序；每个 Bundle 内的媒体顺序只使用 `media_refs[]`，不从文件名、时间、tone、assetRef 或 MediaCandidate 表顺序推导。

## 4. 完整闭图与 hash 规则

每个 case 的 FK 链固定为：

```text
Source
  → CapturedItem
  → Content
  → Summary
  → ReleaseBundle
  → ReviewDecision(approved)
  → Publication(published)
  → PublishedProjection(published)

Content
  → MediaCandidate[0|1|4]
  → ReleaseBundle.media_refs / canonical media / media_presentations
```

validator 逐项复算：

1. `Content.content_version_hash = SHA-256(canonical-json-v1(content_hash_input))`；
2. `Summary.summary_version_hash = SHA-256(canonical-json-v1(summary_hash_input))`，且 `input_content_hash` 等于 Content hash；
3. MediaCandidate 的 synthetic media hash 绑定 `asset_ref/fixture_set/mime_type`；assetRef 只能使用 `synthetic:` 且不得包含 URL delimiter；
4. `ReleaseBundle.payload_hash` 覆盖完整 canonical payload，包括 `media_presentations[]`；
5. `bundle_hash_input` 逐字冻结 `release_bundle_id/bundle_version/payload_hash/canonical_json_rule_version/immutable`；
6. `bundle_hash` 对上述输入计算；Decision 的 approved hash、Publication 的 approved hash均等于该值；
7. `published_version_hash` 绑定 approved bundle/content/summary hashes、publicId、generation 与 releaseBundleId；
8. Projection 逐字复用 Publication 的 publicId、generation 和 published hash。

任一 FK、identity、count、hash、rights、安全状态或顺序不一致会拒绝整个 graph，不生成部分成功收据。

## 5. 0/1/4 与 V1/V2 预期

| case | MediaCandidate | V2 | V1 | state |
| --- | ---: | --- | --- | --- |
| `case-zero` | 0 | `media=[]` | `media=null` | `media_missing` |
| `case-single` | 1 | 单元素数组 | 相同稳定首图 | `available` |
| `case-gallery` | 4 | 四元素有序数组 | `media[0]`降级 | `available` |

四图 case 的 `media_refs[]`、canonical media、`media_presentations[]` 和输出 V2 media 同长、同序、identity逐项相等。每图的 assetRef、mediaHash、altZh、captionZh、creditDisplay 与 tone 均来自冻结领域链，开发无需补字段或复制首图。

## 6. 确定性 roots 与 receipts

正式收据：

- runtime graph 文件 SHA：`dc03afda4e005617b25ab19706b2ed4aeb13fce2d868006865469d280e2e1130`
- runtime graph canonical SHA：`6d4602ac73099dfb82610d46e835fc09f839e7a4c7a4a395f0c1a343fb8010f3`
- runtime manifest root：`f40d5aecaa47cc649be562ab95477ead53e0384c16fda1568b6e2dd823496243`
- generator root：`84f9decf5103e5eb1077f773daf0b41c19e69388f1a1ccce8cb0f87cc5ca4f65`
- validator root：`eeb094e8539cb2edcba11fcd3be2b81df373706d617119859bb683a939fc17f1`
- generator/validator execution receipt：`7631f1bfff433100b772d0f29d1934003fafda49b3420377ecdd60aa31ad2b5a`
- ledger known-binding receipt：`3a7e1634b682f11a94319391b55cbef9cda6335da14243581b3b21317efa2680`

`runtime_manifest_root_sha256` 对 manifest 解析对象移除该 root 字段后的完整对象计算。generator 与 validator receipt 使用同一组 graph file/canonical roots、row counts、generator/validator roots 和 frozen input hashes，因此生成与验证输出逐字相同。

profile ledger 的静态字段、row counts、manifest/graph/generator/validator绑定方式已完整落在 runtime graph。最终 `profile_ledger_root_sha256` 还必须纳入 `DEV-MM-01` 产生的 `migration_selector_root_sha256` 与 `schema_fingerprint_sha256`；这两个值在 scoped migration 尚未创建时不存在。本任务明确固定字段名、来源和 accepted §4.2 公式，后继原子 seed 在两个运行绑定可用后计算最终 ledger root，不需要猜字段，也不会制造占位假 root。

## 7. 双干净生成与验证

验收轨迹：

1. 正式目录生成后，validator `repeat=2`：PASS；
2. `/tmp/task-5e97e0-a-*` 独立空目录生成并验证 `repeat=2`：PASS；
3. `/tmp/task-5e97e0-b-*` 第二独立空目录生成并验证 `repeat=2`：PASS；
4. 两个临时目录的 graph、manifest 和 receipt 逐字相等；
5. 两组临时输出与正式目录 graph/manifest 逐字相等；
6. 两个临时目录由上下文自动清理，统筹随后只读扫描为 `NO_MATCH`；
7. 统筹部另以默认本地权限复跑正式 validator `repeat=2`，得到同一稳定 PASS 收据。

双干净运行共同输出：

```text
receipt=7631f1bfff433100b772d0f29d1934003fafda49b3420377ecdd60aa31ad2b5a
graph=6d4602ac73099dfb82610d46e835fc09f839e7a4c7a4a395f0c1a343fb8010f3
manifest=f40d5aecaa47cc649be562ab95477ead53e0384c16fda1568b6e2dd823496243
```

## 8. 聚焦负例

六项内存负例均按预期拒绝：

- broken CapturedItem FK；
- 四图 Bundle 的 `media_presentations[]` 顺序漂移；
- MediaCandidate rights 从 `allowed` 改为 `restricted`；
- 增加第五个 MediaCandidate；
- 重复 Publication publicId；
- V1 首图降级改为 null。

早期负例编排曾误把 `order_drift` 指向零图 Bundle，反转空数组不会产生变化；已纠正为四图 Bundle 后验证器明确拒绝。正式 graph、manifest、generator 和 validator 未因负例修改。

## 9. 冻结输入零漂移

现有 v0.5 冻结字节保持：

| artifact | SHA-256 |
| --- | --- |
| `schema.json` | `ade4feda490a8bc2fd68817d8f48ac0994cdf81dd4703e3317003d04705451de` |
| `public-multimedia-mapping.json` | `3c05b244c0087d9aea35f63f80c38329b0e7205f78a04e7afcb097a1ef04ae7a` |
| `fixtures.multimedia-synthetic.json` | `ee52a70cda9eea32600a443ad5411cd76d2b4cf3d8894d9b46396c28252823c0` |
| `generate_successor.py` | `23f4d8adf0f75f65f56997f9e7ecaa75d70790239fe860373012925cd2d2dc31` |
| `validate_successor.py` | `58063ea96b585fff65b11dedd3b95417a1ded9abc81e08aa102f19bc646e64c7` |
| 旧 `manifest.json` | `a8b607a46e265ded3ddda85c05bcc627d4b9f4d50192b29028704a435affe1ba` |

旧根继续匹配：

- M3 sorted 59×39 projection：`e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`；
- v0.4 manifest：`3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554`；
- v0.4 fixture：`c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4`；
- public-synthetic ledger root：`1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1`；
- public-synthetic graph root：`4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526`。

## 10. 缓存清理

只读扫描发现 v0.5 `__pycache__` 中仅有一个约 23 KB 的 `generate_successor.cpython-314.pyc`，来源为本项目冻结生成器，属于可再生成缓存。统筹部已精确删除该单一 pyc 与空 `__pycache__`，并确认未触碰任何业务 artifact。后续 Python 生成/验证均使用 `PYTHONDONTWRITEBYTECODE=1`；本任务不再运行清理或负例命令。

## 11. 已验证、未验证与错题自检

### 已验证

- 完整实体 shape、additionalProperties、FK、ID 唯一性、三条唯一 Publication/Projection 链；
- 0/1/4 与媒体总数5；同一 Content 的四个不同 MediaCandidate；
- Content/Summary/media/payload/bundle/decision/published/projection hash 全链；
- rights/safety/order、V1首图降级、V2逐项冻结预期；
- manifest 无自哈希、artifact map 精确为原五个ACK artifact加graph/generator/validator；
- 两个独立干净生成目录、正式目录与统筹独立复跑均使用相同 receipt；
- `external_calls=0`、`real_media=0`、`writes_to_base=false`。

### 未验证

- 未创建 SQLite、scoped migration、migration selector、schema fingerprint 或最终 profile ledger 行；这些属于 `DEV-MM-01/02`。
- 未运行 seed transaction、DB 第五媒体 trigger、Repository、API、App 或浏览器；本任务只交付其确定性机器输入。
- 最终 profile ledger root 待后继实际 migration selector root 与 schema fingerprint 可用后按 accepted 公式计算；字段、绑定来源和公式已经冻结。

### 错题自检

- 没有修改六个现有 v0.5 文件，也没有把 runtime manifest 的文件 SHA 写入其自身 artifact map。
- 没有新增领域实体、Gallery、PublicStory、第二 Publication、第二 Projection 或平行 schema。
- 没有从旧 DB、App 或前端 Demo 猜缺失字段；所有完整行从冻结 schema、ACK fixture 与 accepted successor构造并机械验证。
- 没有提前伪造尚不存在的 migration selector root 或 schema fingerprint。
- 双干净生成首次使用系统默认临时根 `/var/folders`，被生成器安全门拒绝且自动清理；改为明确 `/tmp` 后成功，没有扩大写入根。
- `order_drift` 初次选错零图目标，随后只改负例目标为四图 Bundle并得到拒绝收据。
- 当前无审批、提权、外部调用或等待中的清理动作。

TASK_STATE_OK
