# X 信源清单 v0：分类口径、数据字典与复核队列

## 1. 产出摘要

- 输入文件：`F1+1信源.md`（RTF 内容，扩展名与实际格式不一致）。
- 输入文件 SHA-256（处理前）：`135e9bcae84124a57d1599a9a1cb85ca0a08be1cccda3e54a3d118391a2b074d`。
- 抽取到 59 个 X URL；移除 `?s=20` 并按 URL 大小写不敏感规则规范化后，仍为 59 个唯一 URL。
- 结构化清单：`data/x-source-inventory-v0.csv`，含 59 条数据记录。
- 本轮没有修改输入文件；处理后重新计算的 SHA-256 仍为 `135e9bcae84124a57d1599a9a1cb85ca0a08be1cccda3e54a3d118391a2b074d`，并已通过集合相等校验。

## 2. 规范化与分类口径

### 2.1 URL 规范化

1. 仅抽取 `https://x.com/<handle>` 形式的账号主页 URL。
2. 删除分享追踪参数 `?s=20`。
3. X handle 按大小写不敏感处理；`canonical_url` 使用小写 handle。
4. `handle` 保留输入中的原始大小写；`evidence_url` 保留输入中的原始 URL，确保每行能回溯到原始记录。
5. `source_id` 使用 `x_<lowercase_handle>`；本批次内稳定且唯一。后续账号改名时应保留旧记录并通过别名或迁移字段关联，避免静默改写主键。

### 2.2 实体分类

| `entity_type` | 中文口径 | 本批数量 |
|---|---|---:|
| `official_org_team_event` | 看起来对应组织、车队、赛事或品牌账号的候选项；分类不代表身份已认证 | 15 |
| `driver_or_manager` | 看起来对应现役/退役车手或管理者的候选项 | 28 |
| `journalist_commentator_media` | 看起来对应记者、评论员、主持人或媒体的候选项 | 12 |
| `fan_news_aggregator` | 车迷资讯、主题资讯或聚合候选项 | 2 |
| `image_entertainment_other` | 图片、娱乐或当前无法归入前四类的候选项 | 2 |
| **合计** |  | **59** |

分类依据仅用于首版整理。由于本轮未完成账号主页、所属机构官网或其他权威证据的逐项身份核验，所有记录的 `identity_status` 均保持 `unknown`；分类为 `official_org_team_event` 的记录也不等同于已确认官方账号。

## 3. 数据字典

| 字段 | 类型 | 必填 | 允许值/格式 | 含义 |
|---|---|---:|---|---|
| `source_id` | string | 是 | `x_<lowercase_handle>` | 稳定主键；本批唯一 |
| `platform` | enum | 是 | `x` | 平台 |
| `handle` | string | 是 | 输入中的 handle | 原始显示 handle；大小写不用于唯一性判断 |
| `canonical_url` | URL | 是 | `https://x.com/<lowercase_handle>` | 移除追踪参数后的规范 URL；本批唯一 |
| `entity_type` | enum | 是 | 见 2.2 | 首版实体类别 |
| `content_focus` | enum | 是 | `team_or_series_updates`、`driver_or_manager_updates`、`journalism_commentary`、`fan_news_aggregation`、`visual_entertainment_or_other` | 预期内容重点；待采样复核 |
| `identity_status` | enum | 是 | `verified`、`needs_review`、`unknown` | 身份证据状态；`verified` 必须有独立权威证据 |
| `monitorability` | enum | 是 | `monitorable`、`restricted`、`unavailable`、`unknown` | 在合规路径下可否稳定监控；尚未实测均为 `unknown` |
| `priority` | enum | 是 | `high`、`medium`、`low` | 首版候选优先级，仅用于安排复核顺序 |
| `lifecycle_status` | enum | 是 | `proposed`、`active`、`paused`、`retired` | 信源生命周期；本批尚未核验，统一为 `proposed` |
| `added_at` | date | 是 | `YYYY-MM-DD` | 加入清单日期 |
| `evidence_url` | URL | 是 | 原始输入 URL | 输入证据；含原始分享参数 |
| `notes` | string | 否 | UTF-8 文本 | 不确定性、范围问题、改名风险或复核提示 |

### 3.1 枚举约束

- `identity_status=verified` 只能在账号主页、所属机构官网或其他第一方权威页面形成可追溯证据后使用。
- `identity_status=needs_review` 用于账号不存在、改名、主体冲突或证据互相矛盾。
- `identity_status=unknown` 用于尚无可靠身份判断；不得由账号名直接升级为 `verified`。
- `monitorability=monitorable` 需要通过获授权接口或合规公开路径验证；页面可人工打开不等于具备持续采集能力。
- `lifecycle_status=active` 需要同时满足身份复核、相关性抽样和合规监控验证。

## 4. 重复与格式问题

- 输入共有 59 个链接，按移除 `?s=20`、handle 小写化后的规范 URL 去重，重复数为 0。
- 所有链接都带有分享追踪参数 `?s=20`；CSV 已在 `canonical_url` 删除该参数，并在 `evidence_url` 保留原值。
- 输入文件是 RTF 1.0、Windows 简体中文代码页 936，文件名扩展名为 `.md`。后续读取必须按实际 RTF 处理；当前文本简单抽取可用，但不应把 RTF 控制符写入 URL。
- 输入标题存在 `X/tewtter` 拼写问题，不影响链接抽取。
- `Ferrari`、`FerrariRaces`、`ScuderiaFerrari` 可能属于同一组织体系下不同内容范围；它们是三个不同 URL，本轮不合并。

## 5. 未知项与后续复核队列

### P0：身份、存活与改名核验（59 条）

逐条确认账号可访问、当前 handle、展示名、简介、认证/所属关系及至少一个第一方交叉证据。核验前所有 `identity_status` 保持 `unknown`。优先检查：

- `audif1_`：可能涉及新车队身份或改名，需确认当前账号主体及迁移关系。
- `visacashapprb`：车队品牌命名可能变化，需确认账号当前主体与生命周期。
- `Ferrari`、`FerrariRaces`、`ScuderiaFerrari`：需分别确认品牌、赛车项目和 F1 车队的内容边界。
- `hyonibeee`：仅凭输入无法判断主体与内容重点。
- `Formula24hrs`、`FanaticsFerrari`、`F1HardWalls4K`：需确认是否原创、聚合、图片账号或存在版权/重复风险。

### P1：F1 相关性抽样

对每个账号抽取最近一个稳定观察窗口的内容，记录 F1 相关内容占比、原创/引用/回复/纯转帖结构及语言。重点复核 `RichardHammond`、`MrJamesMay`、`JeremyClarkson`、`Ferrari` 和综合赛车媒体账号。

### P2：可监控性与合规路径

在平台许可、接口权限和频率限制明确后，对候选账号验证发现延迟、游标稳定性、引用帖识别、回复排除、纯转帖排除、限流和删除/改名行为。未完成该实验前 `monitorability` 保持 `unknown`。

## 6. 维护规则建议

1. 新增记录先进入 `proposed + unknown`，完成身份、相关性、合规监控三项复核后再进入 `active`。
2. 以 `source_id` 为内部稳定引用，以规范化 URL 做当前去重键；账号改名通过迁移记录关联，不静默覆盖历史证据。
3. 每次变更保留操作时间、操作者、变更前后值、证据 URL 和原因。
4. 定期检查账号不存在、改名、长期停更、主体转换及内容漂移；异常项进入 `needs_review`，不直接删除。
5. 用户已确认的首版内容规则记为 `proposed`：收原创帖和引用帖，排除回复与纯转帖。该规则属于产品采集范围，不能替代 X 平台授权、接口权限或合规结论。
6. 发布链路继续保留人工审核；身份未核验或来源证据缺失的内容不得自动公开。

## 7. 当前验证边界

已完成：RTF 识别、URL 抽取、追踪参数清理、大小写无关去重、59 行一一映射、字段与枚举设计、分类数量核算。

尚未完成：59 个账号的实时存活/身份/官方性核验、内容采样、F1 相关性统计、X 合规接口与 15 分钟监控能力测试。上述项目不得从本清单推断为已验证。
