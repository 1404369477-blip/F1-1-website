---
task_id: TASK-20260809-12798F
department: 数据部
status: completed
decision: PASS
completion_class: standard
profile_id: public-multimedia-synthetic
fixture_set: public-multimedia-pagination-24-v0.6
external_calls: 0
writes_to_base: false
real_content_imported: false
real_media: 0
---

# public-multimedia 两页数据 successor 报告

## 1. 结论

数据候选通过离线验收。候选在现有 `public-multimedia-synthetic` profile、`public-read-v0.2` 读取合同和 v0.4 领域实体范围内扩充为 24 条唯一 `PublishedProjection`，固定页大小为 12，可形成无重复、无漏项的第一页与第二页。四类 `contentType` 各 6 条；0、1、4 媒体样本各 8 条，并且每一内容分类均包含 2 条 0 图、2 条 1 图和 2 条 4 图样本。

本任务只交付 data-native 候选与 manifest，未改 App、SQLite、migration、Spec、ADR、旧 data artifact 或真实 Base；未访问真实来源或媒体。候选仍由后继开发任务执行原子 seed，当前数据库未被替换。

## 2. 正式产出与根

| 产出 | SHA-256 / canonical root |
| --- | --- |
| `data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json` | file `1eddfe54394757ff1cf00dce12ec2409772817256fe40177bc04e5a54989608b`; canonical `52775a139bf8d7352cd5c751e090794a2aac878a3515d9c35fb61e3f13ffa532` |
| `data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/manifest.json` | file `38d51764568cc9d3943e0c31388bf125c1f3b207cde0fc2f37db22becfbed6eb`; manifest root `0a0374e8eb417574128796a7d6b4c9fb3bba786430a649207aca2007225f800b` |
| 双 reload 确定性收据 | `2aebc861aa5a4018f922231ea8a35cfe56ac0f48b36c1775695db543386c02f7` |

候选没有增加领域实体或数据库 schema。manifest 明确固定目标 profile、seed 事务边界、旧输入哈希、失败回滚与后继实现约束，避免形成第二套 schema。

## 3. 数据规模与覆盖

机器行数为：Source 1、CapturedItem 24、Content 24、Summary 24、MediaCandidate 40、ReleaseBundle 24、ReviewDecision 24、Publication 24、PublishedProjection 24、Event 0、OutboxJob 0。

内容分类分布：

- `race_news`: 6
- `driver_social`: 6
- `legends_history`: 6
- `paddock_fun`: 6

媒体基数分布：

- 0 图：8 条
- 1 图：8 条
- 4 图：8 条
- 总媒体数：40；单条最大 4；第五图为零

每个媒体候选均为本地 `synthetic:` asset，状态固定为 `selected / allowed / passed`。媒体 hash 可由 `canonical-json-v1({asset_ref, fixture_set, mime_type})` 复算。ReleaseBundle 内的 `media_refs`、冻结媒体快照和展示序列逐项同序；公开 DTO 的 `originalLink` 全部为 `enabled=false, url=null, reason=synthetic_only`。

## 4. 分页、排序与筛选收据

排序合同沿用 Repository 的 `published_at DESC, public_id DESC`，page size 固定为 12。第一页末项为 `public-page2-legends-history-14`，cursor 解码后精确为当前末项的 `publishedAt/publicId`，且 `source=null`、`contentType=null`、`v=1`。第二页完整消耗剩余 12 条，`hasMore=false`。

第一页 `publicId`：

1. `public-page2-race-news-24`
2. `public-page2-driver-social-23`
3. `public-page2-paddock-fun-21`
4. `public-page2-legends-history-22`
5. `public-page2-race-news-20`
6. `public-page2-driver-social-19`
7. `public-page2-paddock-fun-17`
8. `public-page2-legends-history-18`
9. `public-page2-race-news-16`
10. `public-page2-driver-social-15`
11. `public-page2-paddock-fun-13`
12. `public-page2-legends-history-14`

第二页 `publicId`：

1. `public-page2-race-news-12`
2. `public-page2-driver-social-11`
3. `public-page2-paddock-fun-09`
4. `public-page2-legends-history-10`
5. `public-page2-race-news-08`
6. `public-page2-driver-social-07`
7. `public-page2-paddock-fun-05`
8. `public-page2-legends-history-06`
9. `public-page2-race-news-04`
10. `public-page2-driver-social-03`
11. `public-page2-paddock-fun-01`
12. `public-page2-legends-history-02`

两页集合交集为空，合并后恰好覆盖 24 个唯一 `publicId`。四类筛选各自按同一复合排序返回 6 条；cursor 的 `source/contentType` 必须与当前查询作用域严格相等，跨筛选复用按合同判 `PUBLIC_CURSOR_INVALID`。

## 5. 哈希链、冻结输入与回滚边界

逐条复算通过：Content version hash、Summary version hash、Media hash、payload hash、bundle hash、ReviewDecision hash、published version hash，以及 Publication 与 PublishedProjection 的跨对象引用。24 组 DTO V1/V2 与 detail 扩展均可从领域链机械重建，0/1/4 媒体表示一致。

manifest 中 29 个冻结输入已逐文件复核，包括三套 canonical profile SQLite、三份 closed receipt、既有 migrations/App 读取文件、v0.4 与 v0.5 data artifacts，29/29 当前 SHA-256 与记录一致。旧三 profile 数据库零漂移：

- `app/.local/f1plus1.sqlite`: `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0`
- `app/.local/f1plus1-public-synthetic.sqlite`: `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041`
- `app/.local/f1plus1-public-multimedia-synthetic.sqlite`: `a1f712aacf0d78664ea9962dfe9902c194422ce099bab968a84d9a2c64cbf50c`

后继 seed 必须先校验所有冻结/root 条件，再在单一 `BEGIN IMMEDIATE` 事务中写入任务所有行；验证完成、checkpoint、关闭句柄并 hash 后，才允许在另行授权的开发任务中 no-clobber 原子安装。任一失败整体回滚并保留当前 v0.5 canonical DB 与 graph。

## 6. 已验证

- 两次独立 reload 得到同一 candidate canonical root；candidate file/canonical hash、manifest self-root 与 manifest file hash自洽。
- JSON 使用重复键拒绝解析器读取；所有实体主键、`public_id` 唯一。
- 24 条完整领域链的外键、版本 hash、审批 hash、发布 hash和 DTO 映射逐条复算通过。
- page1/page2 各 12 条，无重复、漏项或重排；同发布时间样本执行 `public_id DESC` tie-break。
- 四类筛选各 6 条，筛选内顺序稳定；每类均覆盖 0/1/4 媒体各 2 条。
- 0/1/4 媒体闭合、总数 40、第五图为零；rights/safety/hash/order 全部通过。
- 所有公开原文入口禁用且 URL 为 null；`external_calls=0`、`writes_to_base=false`、`real_media=0`、`real_content_imported=false`。
- 29/29 冻结输入 SHA-256 匹配，三套旧 profile SQLite 零漂移。
- `git diff --check` 在任务产出范围通过；任务 doctor 在 complete 后执行。

## 7. 未验证

- 未把候选 seed 到 SQLite，也未启动网站或调用真实 Repository/API。上述操作属于后继开发/测试任务，本任务合同明确禁止改 App 和当前数据库。
- 未访问外部网络、真实媒体、真实信源或飞书 Base，因此不对真实 provider 行为作结论。

## 8. 错题自检

初次生成的分页期望列表沿用了样本生成顺序，在同一分钟的两个样本上没有执行 `public_id DESC`。聚焦验收发现该问题后，按 Repository 复合排序重新计算 page1/page2、四类筛选和 cursor，并同步重算 candidate/manifest 全部根。领域行与媒体链不需要更改。最终验证明确断言每个时间并列对均按 `public_id DESC`，两页合并等于全部 24 条且交集为空。

任务状态查询阶段还误用了任务工具不存在的 `show` 子命令，随后依据任务 JSON 与支持的 `list/complete/doctor` 接口继续；该命令未修改任何文件或任务真值，对交付无影响。

自检结论：P0=0，P1=0。任务已 `completed`，待统筹部 ACK。
