# 多平台白名单信源稳定采集方案

> 任务：TASK-20260730-E2E459  
> 查询日期：2026-07-30（Asia/Shanghai）  
> 范围：X、Instagram、Reddit、新闻网站、RSS/Atom；仅讨论获得平台许可或公开允许的路径。  
> 约束：正常可访问条件下 15 分钟内发现；不得绕过登录、验证码、封禁、速率限制或其他访问控制。

## 1. 结论

1. MVP 应采用“每个平台独立适配器 + 统一归一化入口”，优先级依次为：第一方 API / 第一方 Feed → 获得许可的网页采集 → 人工链接入口。不要用单一通用爬虫承诺所有平台 15 分钟时效。
2. X 的最低复杂度方案是官方用户时间线接口按 5 分钟轮询并使用 `since_id`；Filtered Stream 可在白名单扩大后提供秒级发现，但会增加长连接、重连和成本管理工作。查询日公开价为 Post Read 每资源 0.005 美元，价格会变，预算需按官方页面和控制台复核。
3. Instagram 是当前最大可行性缺口。官方 API 面向 Business / Creator 专业账号；被监控方可通过 Instagram Login 直接授权且无需绑定 Facebook Page，Facebook Login + Business Discovery 可读取其他专业账号的有限数据。个人账号及未获得许可的自动采集没有稳定、合规的通用路径。白名单必须标记 `api_monitorable` 与 `manual_only`，后者不能承诺 15 分钟自动发现。
4. Reddit 官方 Data API 技术上可用 `[/r/subreddit]/new` 完成 5 分钟轮询，生产使用仍受 OAuth、申请资格和商业许可约束。若网站未来商业化，必须在生产接入前取得 Reddit 书面许可或合同。
5. 新闻网站与 RSS/Atom 是第一阶段最适合验证 15 分钟目标的路径。第一方 Feed 成本低、结构化程度高；无 Feed 网站只能在站点条款和 robots 允许时做站点级适配。
6. 当前官方价格可核实程度不同：X 查询日公开价为 Post Read 0.005 美元/资源、User Read 0.010 美元/资源，价格可能变化；Reddit 商业价格需要单独协议；Meta 官方资料未给出本场景固定单价。成本估算只使用查询日官方价格，不采用社区报价。

## 2. 推荐级别

- **A：MVP 主路径**——官方支持、可在现有约束下验证 15 分钟目标。
- **B：有条件采用**——需要账号、审核、付费、授权或额外运维。
- **C：降级路径**——可缓解漏采，但不承担稳定时效承诺。
- **D：排除**——依赖未授权抓取、私有接口、Cookie、代理轮换或规避平台控制。

## 3. 候选方案矩阵

| 平台 | 路径 | 稳定性 | 预期时效 | 成本 | 密钥 / 登录 | 维护与许可证 | 主要合规风险 | 推荐 |
|---|---|---:|---:|---|---|---|---|---:|
| X | 官方 `GET /2/users/:id/tweets`，每 5 分钟轮询，保存 `since_id` | 中高；官方 v2 接口，仍受平台政策和计费变更影响 | 约 0–5 分钟 + 处理时间 | 查询日 Post Read 为 0.005 美元/资源；月度最多 200 万 Post reads；同一资源在 UTC 日内通常去重计费 | Developer App + Bearer Token；无需被监控账号登录（仅公开内容） | 平台条款；可用 Tweepy（MIT）或 node-twitter-api-v2（Apache-2.0） | 必须处理删除、保护、编辑与地域限制；控制读取字段和留存 | **A** |
| X | 官方 Filtered Stream，按 `from:账号` 建白名单规则 | 中高；长连接需要重连、断点和漏采补偿 | 官方称 P99 约 6–7 秒 | 返回的 Post 按查询日 0.005 美元/资源计费；同样受余额和月度上限约束 | Developer App + Bearer Token | 平台条款；直接 HTTP 或官方/社区 SDK | 断流期间需用 Recent Search 或时间线补采；合规事件处理同上 | **B** |
| X | 官方 Recent Search，组合 `from:` 规则补采最近 7 天 | 中；适合补洞，不适合作为大量账号的唯一主路径 | 5 分钟轮询可达目标 | 返回的 Post 按查询日 0.005 美元/资源计费 | Bearer Token | 平台条款 | 查询规则遗漏、成本随返回资源量变化；只返回最近 7 天 | **C** |
| X | 页面抓取、Cookie 会话、代理池、第三方“无 OAuth”抓取 API | 低 | 无可靠承诺 | 代理、账号与服务费不可控 | 常要求 Cookie / 账号 | 开源许可证不能替代平台许可 | 违反平台条款或访问控制风险高，账号与 IP 易被限制 | **D** |
| Instagram | 官方 Instagram API with Instagram Login：被监控专业账号直接 OAuth 授权，轮询 `graph.instagram.com/.../media` | 中高；数据边界最清晰，无需绑定 Facebook Page | 约 0–5 分钟 + 处理时间 | 官方资料未给出本场景固定调用单价；有开发、App Review 和业务验证成本 | Meta App + Instagram User Token；被监控方主动授权 | 平台条款；可直接 HTTP | 只覆盖 Business / Creator；依赖车手、车队或媒体方合作；Token 到期和撤权需降级 | **A（有合作时）** |
| Instagram | 官方 Instagram API with Facebook Login：用连接 Page 的专业账号执行 Business Discovery / Media，5 分钟轮询 | 中；官方路径，但权限、App Review 与版本变化明显 | 约 0–5 分钟 + 处理时间；需实测 | 同上 | Meta App、用户/Page Token、连接的 Professional Account；相应权限通常需 Advanced Access | 平台条款；可直接 HTTP；Meta Python Business SDK 是定制许可且主要面向 Marketing API | 只能发现 Business / Creator 的有限数据；不能覆盖 consumer account；速率为动态/业务用例限制 | **B** |
| Instagram | 官方 Embed / oEmbed 或人工提交原帖链接 | 中；已知链接可稳定展示或引用 | 无法自动保证 15 分钟发现 | 通常无调用费，仍有开发成本 | Embed 可用于公开内容；oEmbed 可能需要 App Access Token | 平台条款 | 只能在已知 URL 后展示，不能承担发现；内容可能被删除或转私密 | **C** |
| Instagram | Instaloader、instagrapi、浏览器自动化、Cookie/代理抓取 | 代码活跃但平台路径低稳定 | 无可靠承诺 | 账号、代理、验证码和维护成本高 | 常需账号 Cookie / 私有 API | MIT 等代码许可证不构成 Meta 许可 | Meta 条款要求自动收集先获明确许可；私有接口和绕控风险高 | **D** |
| Reddit | 官方 OAuth Data API：`GET [/r/subreddit]/new`，每 5 分钟轮询，按 fullname 去重 | 中；接口清晰，实际可用性取决于申请和授权 | 约 0–5 分钟 + 处理时间 | 符合免费资格者 100 QPM / OAuth Client；商业使用需另签协议，价格未知 | 已登记 OAuth Client + 明确 User-Agent | PRAW / Async PRAW（BSD-2-Clause） | 商业使用需许可；User Content 仅获有限复制展示许可，删除/修改需同步；中文摘要合同边界需法务复核 | **A（获批后）** |
| Reddit | 官方文档标记支持的 `/new` RSS/Atom | 中低；接口文档仍标记 RSS support，但近期社区出现停用担忧 | 5 分钟轮询理论可达 | 通常无 API 费 | 通常无需 OAuth；托管网络访问可能受限 | feedparser（BSD-2-Clause） | 不应规避 Reddit 对未识别流量的限制；无稳定 SLA；生产只能作降级 | **C** |
| Reddit | `.json` 匿名流量、代理轮换或未获商业许可的第三方抓取 | 低 | 无可靠承诺 | 隐性成本高 | 可能伪装 User-Agent / IP | 开源许可证无助于平台授权 | 官方明确要求 OAuth，未识别流量可被阻断；商业与数据使用风险高 | **D** |
| 新闻网站 | 第一方 API、RSS/Atom Feed，支持 WebSub 时优先订阅；否则 5 分钟条件轮询 | 高（相对） | WebSub 接近实时；轮询约 0–5 分钟 | 常为零 API 费，另有基础设施成本；付费媒体 API 单独评估 | 依站点而定 | feedparser（BSD-2-Clause）；WebSub 为 W3C 标准 | Feed 不等于转载授权；正文、图片和摘要仍需遵守来源条款与版权规则 | **A** |
| 新闻网站 | Sitemap / 栏目页发现 + 获许可的文章页提取 | 中低；页面结构变化会破坏适配器 | 5–15 分钟，受缓存和页面更新影响 | 基础设施与维护成本 | 通常无登录；若需登录必须得到明确授权 | Trafilatura（Apache-2.0）仅用于获许可页面 | 必须逐站检查 Terms、robots、频率、转载和图片许可；禁止绕过付费墙 | **B** |
| 新闻网站 | RSSHub 等社区适配器生成 Feed | 中低；仓库活跃，单路由质量和合规性差异大 | 取决于路由与上游 | 自托管成本；RSSHub 为 AGPL-3.0 | 依路由而定 | 路由需逐一审核 | 适配器可能仍是网页抓取，不能把“转成 RSS”视为获得许可 | **C** |
| RSS / Atom | 第一方 Feed，按 GUID / Atom ID 去重，5 分钟条件轮询 | 高（相对） | 约 0–5 分钟 + 处理时间 | 无协议费用；带宽和运行成本低 | 通常无 | RSS 2.0 / Atom；feedparser（BSD-2-Clause） | 部分 Feed 缺 `published_at`、GUID 不稳定或只给摘要；需站点级补正 | **A** |
| RSS / Atom | WebSub Hub 推送 + 定时补偿轮询 | 高（发布方支持时） | 秒级至分钟级 | 运行公网回调的基础设施成本 | 回调验证，不涉及用户账号 | W3C WebSub Recommendation | 仍需轮询补洞；Hub 过期、回调失败与重复投递必须可观测 | **A（支持时）** |

### 矩阵事实依据

- X 官方文档：
  - [Get Posts / 用户发布内容](https://docs.x.com/x-api/users/get-posts) 支持 `since_id`、时间区间和排除回复/转帖。
  - [Filtered Stream](https://docs.x.com/x-api/posts/filtered-stream/introduction) 给出近实时交付、P99 约 6–7 秒、Pay-per-use 1 个连接和 1,000 条规则。
  - [Rate Limits](https://docs.x.com/x-api/fundamentals/rate-limits) 在查询日列出：用户发布接口每 App 10,000 次/15 分钟、Recent Search 450 次/15 分钟、Stream 50 次连接请求/15 分钟。
  - [Pricing](https://docs.x.com/x-api/getting-started/pricing) 与 [Usage and Billing](https://docs.x.com/x-api/fundamentals/post-cap) 明确按量预付；查询日公开价为 Post Read 0.005 美元/资源、User Read 0.010 美元/资源，价格会变；月度读取上限 200 万，同一资源在 UTC 日内通常去重计费。
  - [Compliance Streams](https://docs.x.com/x-api/compliance/streams/introduction) 要求离线保存的数据跟随删除、保护、编辑、停用和地域限制等用户意图；高量实时合规流属于 Enterprise 能力。
- Instagram / Meta 官方资料：
  - Meta 官方 [Instagram API with Instagram Login](https://www.postman.com/meta/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00) 说明 Professional Account 可直接授权且无需绑定 Facebook Page；[Instagram API Postman Workspace](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) 说明 Facebook Login 路径可获取其媒体及其他 Business / Creator 的有限元数据，并明确不能访问 consumer accounts。
  - [Instagram Embed 帮助](https://www.facebook.com/help/instagram/620154495870484) 说明公开帖子、Reel、指南或 Profile 可由第三方嵌入；它只解决展示，不解决发现。
  - [Instagram Terms of Use](https://www.facebook.com/help/instagram/581066165581870) 与 [Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms) 明确要求自动化收集先取得 Meta 书面或明确授权。
- Reddit 官方资料：
  - [Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki) 要求 OAuth、明确 User-Agent，并在符合免费资格时给出 100 QPM / OAuth Client；未带 OAuth 或登录凭据的流量可能被阻断。
  - [API Reference](https://www.reddit.com/dev/api/) 的 `GET [/r/subreddit]/new` 是 Listing，最多返回 100 项，且页面标记 RSS support。
  - [Developer Interfaces](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Reddit-Developer-Interfaces) 与 [Data API Terms](https://redditinc.com/policies/data-api-terms) 要求商业使用取得许可/合同，并约束内容修改、留存、删除、归属和模型训练。
- Web 标准：
  - [Atom RFC 4287](https://www.rfc-editor.org/info/rfc4287/) 定义 Feed 与 Entry 的结构化元数据。
  - [WebSub W3C Recommendation](https://www.w3.org/TR/websub/) 定义发布者、Hub 和订阅者之间的 HTTP 推送。
  - [HTTP Semantics RFC 9110](https://www.ietf.org/rfc/rfc9110.html) 定义 `ETag`、`Last-Modified` 等条件请求语义。
  - [Robots Exclusion Protocol RFC 9309](https://www.ietf.org/rfc/rfc9309.html) 是抓取前必须纳入适配器判断的协议，但它不能替代站点授权或合同。

## 4. GitHub 维护信号与组件选择

> 数据来自 GitHub Repository API 与 Releases API，查询日期 2026-07-30。全部候选仓库在查询日均未归档。`pushed_at`、Release 和 open issues/PRs 只构成维护信号，不代表 API 路径已获平台许可，也不等同于发布质量；`open` 是 GitHub 的 `open_issues_count`，包含 Issue 与 Pull Request。

| 组件 | 用途 | `pushed_at` | 最新 Release | `open` | 许可证 | 判断 |
|---|---|---:|---:|---:|---|---|
| [tweepy/tweepy](https://github.com/tweepy/tweepy) | Python 调用 X 官方 API | 2026-07-02 | v4.17.0 · 2026-07-02 | 104 | MIT | **推荐**；若后续选 Python，可减少认证、分页与 Stream 样板代码 |
| [PLhery/node-twitter-api-v2](https://github.com/PLhery/node-twitter-api-v2) | Node.js / TypeScript 调用 X v2 | 2026-01-13 | 1.28.0 · 2025-11-15 | 46 | Apache-2.0 | **推荐（Node 栈）** |
| [xdevplatform/twitter-api-typescript-sdk](https://github.com/xdevplatform/twitter-api-typescript-sdk) | X 官方 TypeScript SDK | 2024-01-12 | 未发现 GitHub Release | 58 | Apache-2.0 | 官方但维护信号较弱；实现前复核 API 兼容性 |
| [facebook/facebook-python-business-sdk](https://github.com/facebook/facebook-python-business-sdk) | Meta Business / Marketing API SDK | 2026-07-17 | 25.0.3 · 2026-07-17 | 69 | [Meta 定制许可](https://github.com/facebook/facebook-python-business-sdk/blob/main/LICENSE)，仅限与 Facebook Web Services / APIs 结合使用 | 可参考；Instagram 采集接口可直接 HTTP，避免扩大与任务无关的 Marketing SDK 依赖面 |
| [praw-dev/praw](https://github.com/praw-dev/praw) | Python Reddit OAuth API Wrapper | 2026-07-27 | v8.0.2 · 2026-06-24 | 2 | BSD-2-Clause | **推荐**；同步 Worker 简单可靠 |
| [praw-dev/asyncpraw](https://github.com/praw-dev/asyncpraw) | 异步 Reddit Wrapper | 2026-07-27 | v8.0.2 · 2026-06-24 | 0 | BSD-2-Clause | **有条件推荐**；仅在任务框架已采用 async 时使用 |
| [kurtmckee/feedparser](https://github.com/kurtmckee/feedparser) | Python 解析 RSS / Atom | 2026-07-30 | v6.0.14 · 2026-07-30 | 108 | BSD-2-Clause 风格的两条款许可 | **推荐**；近期有正式发布，仍需在小实验验证畸形 Feed 与解析警告 |
| [adbar/trafilatura](https://github.com/adbar/trafilatura) | 获许可网页正文与元数据提取 | 2026-07-29 | v2.1.0 · 2026-06-07 | 66 | Apache-2.0 | **有条件推荐**；仅用于已通过 Terms / robots 检查的网站 |
| [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub) | 将多类来源适配为 RSS | 2026-07-30 | 未发现 GitHub Release | 349 | AGPL-3.0 | **仅作候选路由线索**；必须逐路由核查采集方式、条款与稳定性 |
| [Instaloader/instaloader](https://github.com/instaloader/instaloader) | 下载 Instagram 图片、视频和元数据 | 2026-07-26 | v4.15.3 · 2026-07-26 | 53 | MIT | **排除生产采集**；近期发布无法解决 Meta 自动化收集许可问题 |
| [subzeroid/instagrapi](https://github.com/subzeroid/instagrapi) | Instagram Private API | 2026-07-28 | 2.18.12 · 2026-07-28 | 2 | MIT（GitHub API 未识别 SPDX，LICENSE 正文为 MIT） | **排除**；Private API、账号会话和绕控风险与项目边界冲突 |

### 社区经验的使用边界

- X 社区在 2026 年初出现“控制台只显示 Pay-per-use、旧 Free 入口不可用”的报告：[示例线索](https://www.reddit.com/r/Twitter/comments/1qc2jnb/unable_to_access_x_api_free_tier/)。官方定价页已明确为 Pay-per-use，并公开查询日单价，因此本文只引用官方价格；社区报价仅作检索线索。
- Reddit 开发者社区出现新 OAuth 应用申请入口和响应速度不确定的报告：[示例线索](https://www.reddit.com/r/redditdev/comments/1ts6cuv/question_where_do_i_actually_apply_for_data_api/)。官方帮助页确实要求申请、OAuth 和按用例审批，因此把“实际获批”设为生产门禁；社区关于“完全无法申请”的说法没有作为事实采用。

## 5. 归一化字段

### 5.1 信源表 `source`

| 字段 | 类型 | 说明 |
|---|---|---|
| `source_id` | string | 内部稳定 ID |
| `platform` | enum | `x / instagram / reddit / website / rss` |
| `external_source_id` | string? | 平台账号 ID、subreddit、Feed URL 或站点 ID；优先平台稳定 ID，用户名仅作展示 |
| `handle` | string? | 当前显示账号名或 subreddit 名 |
| `canonical_source_url` | URL | 白名单来源主页或 Feed URL |
| `adapter` | enum | `official_api / first_party_feed / permitted_html / manual_link` |
| `monitorability` | enum | `api_monitorable / manual_only / blocked` |
| `enabled` | boolean | 管理员启用 / 停用采集；停用后保留配置与历史状态 |
| `auth_ref` | string? | 密钥服务引用；不得保存真实 Token |
| `authorization_basis` / `authorization_evidence_url` | string? | API 条款、来源授权或站点许可依据与证据指针 |
| `authorization_checked_by` / `authorization_review_due_at` | string? / datetime? | 复核责任与下次条款检查时间 |
| `poll_interval_seconds` | integer | 默认 300；按平台限流调整 |
| `cursor` | object? | `since_id`、pagination cursor、ETag、Last-Modified 等 |
| `terms_checked_at` | datetime | 最近一次条款检查时间 |
| `last_attempt_at` / `last_success_at` / `last_error_at` | datetime? | 最近尝试、成功与失败时间 |
| `last_error_code` / `last_error_message` | string? | 结构化失败出口；消息必须脱敏 |
| `next_poll_at` / `backoff_until` | datetime? | 调度和 429 / 5xx 退避状态 |

### 5.2 原始候选表 `source_item`

| 字段 | 类型 | 说明 |
|---|---|---|
| `source_id` + `external_id` | compound key | 来源内唯一键；RSS GUID / Atom ID 只保证在 Feed 范围内稳定，缺失时用规范化 canonical URL |
| `source_id` | string | 对应白名单信源 |
| `ingest_method` | enum | `official_api / first_party_feed / permitted_html / manual_link` |
| `canonical_url` | URL | 原始内容直链 |
| `author_external_id` / `author_handle` | string? | 作者 ID 优先；显示名可变 |
| `content_type` | enum | `post / article / video / image / gallery / comment` |
| `title` / `body_text` | string? | 仅保存接口或 Feed 合法返回的必要文本；完整正文受来源条款控制 |
| `media` | array | `type、url/ref、width、height、alt、rights_status`；不默认代理或永久保存 |
| `published_at` / `updated_at` | datetime? | 来源时间，统一 UTC；缺失时保留 `null`，不得用抓取时间伪装发布时间 |
| `observed_at` | datetime | 采集器首次看到该内容的时间 |
| `fetched_at` / `normalized_at` | datetime | 拉取完成和归一化完成时间 |
| `raw_ref` | string? | 受控原始响应引用；按平台留存政策设置 TTL |
| `content_hash` | string | 规范化文本与关键媒体引用的哈希，用于更新检测 |
| `dedupe_key` | string | `source_id:external_id`；canonical URL 与 `content_hash` 只作辅助去重；跨平台事件去重另建层，不覆盖来源键 |
| `compliance_state` | enum | `active / deleted / protected / withheld / expired / review_required` |
| `deleted_at` / `last_compliance_sync_at` | datetime? | 删除发生时间与最近一次合规同步时间 |
| `rights_status` | enum | `link_only / embed_allowed / excerpt_allowed / licensed / unknown` |

### 5.3 时效与质量字段

- `discovery_latency_ms = observed_at - published_at`，仅在 `published_at` 有可信来源时计算。
- `processing_latency_ms = normalized_at - observed_at`。
- `attempt_count`、`http_status`、`rate_limit_remaining`、`retry_after`、`adapter_version`。
- `timestamp_confidence = source / page_metadata / inferred / unknown`；`inferred` 结果不得用于 15 分钟 SLA 验收。

## 6. 15 分钟目标的最小试验

### 6.1 当前无凭据预检结果

- 第一方 Formula 1 Feed [`https://www.formula1.com/en/latest/all.xml`](https://www.formula1.com/en/latest/all.xml) 在 2026-07-30 返回 `200`、`content-type: text/xml`、`Cache-Control: s-maxage=60`，可直接作为第一条 F1 RSS 适配样例。
- 该 Feed 当前条目包含标题、描述、链接、作者和 GUID，但没有 `pubDate`。对应文章页 JSON-LD 包含 `datePublished` / `dateModified`；适配器需在条目首次出现后抓取允许访问的文章元数据，才能计算发现延迟。
- 本地网络对 Reddit RSS 的一次 20 秒探测超时；Web 获取工具识别到其 `application/atom+xml` 类型但未解析正文。这个结果只能记为“当前环境未验证”，不能推导 Reddit RSS 已停用。
- 未使用任何 X、Meta、Reddit 密钥，未创建测试帖，未产生付费 API 调用。

### 6.2 试验步骤

1. **先做有界、可重复的 RSS 端到端闭环（无付费、无账号）**
   - 在 `scratch/` 启动只供本地试验的 RSS / WebSub 测试源，按 0、7、14 分钟发布 3 条带唯一 ID 和可信 `published_at` 的条目；采集器每 5 分钟拉取。
   - 验证调度、解析、`source_id + external_id` 去重、重启重放、XML 损坏和 `Retry-After` 退避；测试源与脚本均为 disposable spike，不进入正式实现。
   - 同时被动观察 Formula 1 第一方 Feed 24 小时，保存每次请求时间、状态、ETag / Last-Modified、原始响应哈希；首次出现新条目后读取文章 JSON-LD 的可信 `datePublished`。
   - 如果 24 小时内没有新条目，外部来源验证记为“未观察到可验样本”，试验按时结束；本地闭环结果不能替代真实来源时效证据。
2. **X 官方 API 受控试验（需用户确认付费与密钥）**
   - 用测试/自有公开账号发布 3 条带唯一标记的测试 Post。
   - 主试验：用户时间线 5 分钟轮询 + `since_id`；备选：Filtered Stream `from:test_account`。
   - 记录响应 rate-limit 头、Post ID、`created_at`、首次 `observed_at` 和费用控制台读数。
3. **Instagram 专业账号受控试验（需 Meta App、专业账号和授权）**
   - 自有 Professional Account 通过 Instagram API with Instagram Login 授权，发布 3 条测试 Media，5 分钟轮询 `graph.instagram.com/.../media`。
   - 另选一个用户确认的公开 Professional Account 验证 Business Discovery 可见性；不能用自有账号成功替代外部账号可行性结论。
   - 若首批白名单包含 consumer account，将其直接标为 `manual_only`，不尝试私有 API 或 Cookie 路径。
4. **Reddit OAuth 受控试验（需实际获批与发布授权）**
   - 在自有测试 subreddit 发布 3 条唯一测试帖，5 分钟轮询 `[/r/subreddit]/new`。
   - 使用唯一且真实的 User-Agent，记录 `X-Ratelimit-*` 响应头。
   - 商业许可未确认前，结果只证明技术连通性，不证明可用于公开商业产品。

### 6.3 通过标准

- 每条测试内容均满足 `observed_at - published_at <= 15 分钟`；3 条全部通过，不能只报告平均值。
- 同一内容在重复轮询、Worker 重启和一次主动重试后仍只有一个 `source_id + external_id` 记录。
- 注入一次 `429` 或模拟 `Retry-After` 后，Worker 退避且不会紧密重试；恢复后补采成功。
- 模拟 Token 失效、Feed XML 损坏、文章页缺 `datePublished`：状态进入可见错误，原有游标不被覆盖，不能制造错误发布时间。
- 任一平台出现授权不足、价格未知、个人账号不可访问或条款冲突时，输出 `blocked/manual_only`，不切换到未授权抓取。

### 6.4 成本和停止条件

- X 试验前在 Developer Console 设置低额硬性 Spending Limit；查询日 Post Read 为 0.005 美元/资源，月成本先按 `非自有唯一 Post 数 × 0.005 美元 + 返回的唯一 User 数 × 0.010 美元` 估算，再用控制台账单校准。价格变化时必须重算。
- Instagram 与 Reddit 只在获得有效 App / OAuth 凭据后测试；凭据只进入环境变量或密钥服务。
- 任何步骤出现验证码、账号风控、登录挑战、平台明确拒绝、付费墙或 robots 禁止时立即停止该路线。

## 7. 产品与统筹需要确认的门禁

1. 首批白名单中，Instagram 各账号是否为 Business / Creator；个人账号是否接受 `manual_only`。
2. 是否允许为 X 购买最低测试额度并设置 Spending Limit；查询日 Post Read 为 0.005 美元/资源，未确认前只能完成文档与无凭据 RSS 试验。
3. 项目是否预期商业化、展示广告或收费。若是，Reddit Data API 必须先走商业许可；现阶段不得假设免费资格覆盖生产。
4. Reddit User Content 的中文摘要、翻译和站内详情是否符合合同与版权边界，需要安全/法务给出结论。
5. 新闻来源是否只展示标题、短摘要、来源与原始链接；全文、图片代理和长期存储需逐来源授权。

## 8. 建议的首版顺序

1. 第一方 RSS / Atom + Formula 1 样例。
2. X 官方用户时间线轮询；获得真实控制台价格后做成本门禁。
3. Reddit OAuth `/new`；商业许可结论先于生产接入。
4. Instagram 仅接入已授权 Professional Account；个人账号保留人工链接入口。
5. 无 Feed 新闻站点逐站审批后增加适配器，禁止创建通用绕控抓取层。
