# Spec

> 这是当前项目的唯一开发准绳，整合「产品意图 + 技术路线 + 验收标准」，兼具 PRD 与实施合同作用。
> `overview.md`、`mvp.md`、`roadmap.md` 等是辅助文档;若冲突,以本文件为准,并及时同步修正。

## 状态

- 当前版本:Spec v1 候选（A 轴与 M4 公开读模型 v0.4 系统合同已 accepted；v0.4 数据机器合同、双 profile SQLite 和启动安全整改链已通过独立门禁并由统筹 ACK）
- 当前阶段:M5 第一版落地 Build Loop；`public-synthetic` 与 `public-multimedia-synthetic` 的 SQLite、projection-first Repository/feed/detail API 均已核收并已部署为固定 M1 公网 Beta。`RSS-REAL-001` 已在同一 M1 完成一次受控真实采集与独立安全复审：HTTP 200，50 条中选择并新建 20 条，`20/20 pending_review`，随后已启用 `StartInterval=900s` 的独立 LaunchAgent；RunAtLoad 与一个零手动触发的自然周期均成功，对同批数据得到 `new=0/duplicate=20`，公开 synthetic DB/页面/服务零漂移。真实 RSS 审核/发布业务由 `ADR-M5-REAL-REVIEW-PUBLISH-001` 接受；七表 migration、确定性 mapping、Review Repository/route facade、ProjectionReceiver 与 PublicSnapshotRepository 已形成本地候选，并有唯一端到端 Vitest、Node24 typecheck及最终限定安全门收据。该候选尚未迁移固定 M1 真实库，也未接入正式 HTTP server、Tailscale/passkey、Admin UI 或公开 origin，所以相关用户出口继续为 `P1-blocker`；Admin 视觉单独 `user-gated`。公开站当前仍只读 synthetic，自动发布为 0；其他真实 provider/Base/AI/媒体能力继续关闭或保持独立门禁
- 最近更新:2026-08-12

当前初版功能完整性以 [F1+1 初版全功能追踪矩阵 v0.1](spec/F1+1-初版全功能追踪矩阵-v0.1.md) 为唯一索引。对外状态只允许 `complete`、`user-gated`、`P1-blocker`；组件预留、静态分支、测试注入、占位或 `NOT_RUN` 不等于完成。矩阵当前计数为 `complete=20 / user-gated=7 / P1-blocker=23`。`RSS-SAFE-001`、历史 ID `RSS-PILOT-002` 与唯一 Motorsport RSS 的 `REAL-SOURCE-003` 已由代码、M1 真实运行、独立安全收据和一个自然 900 秒周期闭合；该完成不外推未来每个周期、其他来源或已有非空人工字段遇真实更新的动态保护。真实审核/发布业务授权已关闭且本地后端候选已经形成；九项 Admin/恢复 Function 仍为 `P1-blocker`，因为正式 M1 migration、HTTP server 接线、可达 Admin 用户出口、投递回执运行和实机恢复证据尚未闭合。`ADMIN-VISUAL-009` 继续等待用户确认 successor 视觉。现有 public synthetic、多媒体与 VS1 synthetic 的完成边界不随本次真实 RSS 决策扩大。

统一 v0.3 基线及其复验收据继续作为历史冻结输入。用户于 2026-08-03 接受 [ADR-M4-PUBLIC-READ-001](decisions/system/2026-08-03-F1+1-公开读模型与API接线-v0.4-successor-accepted.md)：M3 `m3-shadow` 与 12 条公开 synthetic 的 `public-synthetic` 使用物理隔离的两个 profile/SQLite 文件；M3 59×39 与权威 hash `e7a831…9f17` 不漂移；公开链采用最小 `mvp-local-v0.4` successor 和 `public-demo-*` 身份。v0.4 数据包首轮安全审核 `FAIL / P0=0 / P1=4 / P2=1` 与测试审核 `FAIL / P0=0 / P1=1 / P2=1` 均保留并已 ACK；五类 P1 整改经后继安全、测试聚焦复验达到 `P0=0 / P1=0 / P2=1`，整改与两项复验均已 ACK。双 profile SQLite、四 root 运行时 pin、原子 seed 和受控 Next 启动出口也已通过测试/安全闭包并 ACK；其间安全任务 `TASK-20260804-B9D885` 发现的 `NODE_ENV=test` 任意数据库覆盖 P1 由开发任务 `TASK-20260804-A01DF7` 关闭，并由 `TASK-20260804-A1A095` 独立复验通过。Repository/feed/detail API 开发任务 `TASK-20260804-AC25D4`、正式测试 `TASK-20260804-C30FD0` 与安全复审 `TASK-20260804-000EA6` 均已 ACK。公开前端早期 10 文件精确快照的 PASS 审计链继续有效；最终 v0.2 App 已落地，但当前冻结候选仍须关闭 34476E 三项 P1，并补齐七状态、辅助技术、200% 缩放、forced-colors、实体安全区和全部手势的正式收据。

## 1. 项目一句话

一个聚合 F1 赛事动态、相关新闻、车手社交分享及周边趣闻的一站式资讯网站。

## 2. 目标用户与核心场景

- 目标用户:对 F1 赛车和赛车运动高度热衷,并希望获得中文资讯提炼的车迷;是否还要限定地区或语言人群,待后续确认。
- 核心场景:在一个信息流中及时查看来自指定信源的 F1 赛事、新闻、现役车手、F1 名宿及周边趣闻,先读中文摘要和配图,需要上下文时进入站内详情页,需要完整内容时跳转原始信源。
- 用户现在怎么解决:尚待用户补充;已知需要跨 Instagram、X、Reddit、新闻网站等多个平台寻找内容。
- 为什么现有方式不够好:信息分散在不同平台和语言中,噪声、重复内容与缺少中文提炼增加了获取成本。

## 3. 要解决的问题

- 核心痛点:高价值 F1 内容分散、更新节奏快、信噪比不稳定,用户难以持续跟踪指定信源并快速判断是否值得阅读全文。
- 第一版最重要的价值:持续监控用户指定的白名单信源,在正常可访问条件下于原内容发布后 15 分钟内完成采集,过滤明显低质量内容,经人工审核后形成可浏览的中文信息流。
- 交付物:一个公开的 F1 中文资讯聚合网站,以及支撑它运行的信源管理、自动采集与清洗、中文整理、人工审核、发布和运行监控流程。
- 成功标准:对已接入且可正常访问的测试信源发布一条符合规则的新内容后,系统能在 15 分钟内发现并进入处理流程;审核者能核对来源、修订并发布;访客能在信息流、站内详情页和原始链接之间完成阅读闭环。

## 4. MVP 范围

### 必须做

- 管理一组由用户指定的白名单信源,支持启用、停用和记录最近采集状态。
- 用户新增信源后，系统必须先得到 `canonical_url_valid=true`、`normalization_status=valid`、`dedup_status=unique`，再进入激活检查；重复归属、规范化失败和查重待审不得进入激活。身份与相关性在未核验时继续保持 `unknown`，不作为采集入队前置。
- 新信源初始字段固定为：`collection_onboarding_status=validating`、`normalization_status=pending`、`dedup_status=pending`、身份/相关性/可监控性为 `unknown`、适配器与授权待检查、`lifecycle_status=proposed`、`enabled=false`。当规范化/查重完成且三门检查、停止状态和五个 fence 均通过时，`activation_pending → queued` 必须在一个事务中原子写入 `enabled=true`、`collection_onboarding_status=queued`、唯一 `onboarding_operation_id` 和唯一 outbox；同一 operation id 复用于 Source、TaskEnvelope、Outbox。worker 取得 lease 后才允许 `queued → collecting`，环境变量不能单独改变 enabled。多门同时失败时按 `platform > authorization > adapter` 选择 `blocked_platform`、`blocked_authorization`、`blocked_adapter_missing`。重复归属进入 `linked_existing`，停用/急停进入 `stopped`/`cancelled`，故障进入 `queue_failed`/`collection_failed`，失败预算耗尽进入 `dead_letter`；阻断、重试、恢复、停止、取消和死信的每个出口都要重新检查三门与五个 fence，`paused` 只属于 `lifecycle_status`。全部 canonical 状态须在 fixture/API/UI 有路径。
- 定时监控已接入信源;第一版的正常目标是新内容发布后 15 分钟内发现并入库。
- 将不同平台内容归一化,执行重复检测与低质量初筛;更细的质量维度先在人工审核过程中校准。
- 为候选内容生成可核对的中文标题或摘要,保存来源、作者、发布时间和原始链接。
- 在来源允许且技术可行时展示 0–4 张有序相关图片；0 图、1 图与 4 图都必须有正式数据出口。图片获取、代理、权利和安全规则必须经过独立门禁；当前只允许本地 synthetic 媒体。
- 提供人工审核队列,支持核对原文、编辑、通过和拒绝;上线初期未经审核不得公开发布。
- 提供公开信息流和站内详情页;详情页展示进一步提炼的信息并提供清晰的原始内容链接。
- 采集与发布失败必须可观察、可重试,且重试不能制造重复公开内容。

### 暂时不做

- 不监控全网关键词、开放搜索结果或平台热榜。
- 不在稳定性与内容安全门槛明确前自动发布。
- 不绕过登录、验证码、访问控制或平台反滥用机制采集内容。

### 以后可能做

- 网站稳定后逐步扩大信源发现范围,加入关键词、热榜或开放式推荐。
- 在人工审核数据形成明确规则且严重问题可控后,进入自动整理与自动发布阶段;具体开启权限、准入门槛和停止机制待用户确认。
- 参考 `AI Hot` 的公开产品能力补充日报、主题、收藏等功能;是否进入 MVP 等调研后逐项确认。

## 5. 流程 / 页面 / 使用方式

- 主流程:白名单信源 → 定时采集 → 归一化与去重 → 低质量初筛 → 中文整理与图片候选 → 人工审核 → 公开信息流 → 站内详情 → 原始链接。
- 新信源接入流程:提交原始链接 → `collection_onboarding_status=validating` → 规范化有效且查重唯一 → `activation_pending`。只有 platform、authorization、adapter 三门（并按 `platform > authorization > adapter` 固定阻断优先级）、`source_stop_status=clear` 和五个 fence 同时满足，才在一个事务中原子写 `enabled=true`、`queued`、唯一 onboarding operation 与唯一 outbox；worker lease 成功后才进入 `collecting`。页面将 validating 的等待显示为 `normalization_pending`/`dedupe_pending`，将 activation_pending 显示为 `adapter_check_pending`，将 queued 显示为“已入队”。每次重试/恢复/继续都重新取得三门和 fence，`paused` 仅作为 `lifecycle_status`。
- 实际路由候选固定为：公开信息流 `/`、内容详情 `/stories/[publicId]`、审核队列 `/admin/reviews`、信源管理 `/admin/sources`。当前前两者公开只读，后两者只允许 loopback local-dev。已 accepted 的未来生产边界为家中或办公室的专用常开 Admin MacBook + 独立公开只读主机、Mac/iPhone 私有 overlay 入口、唯一写主和公开只读投影；具体设备、账号、网络、域名及生产实施仍等待唯一 deployment manifest 门禁。
- 关键领域状态:信源 `validating/activation_pending/queued/collecting/active/normalization_failed/dedup_needs_review/linked_existing/blocked_adapter_missing/blocked_authorization/blocked_platform/queue_failed/collection_failed/stopped/cancelled/dead_letter`；`paused` 只存在于独立的 `lifecycle_status`，该字段使用 `proposed/active/paused/retired`。规范化/查重与身份/相关性/可监控性使用数据 schema 的字段 enum。页面 alias 可使用 `normalization_pending/dedupe_pending/adapter_check_pending/enqueued/enabled/manual_only/restricted/failed/disabled`，但不成为第二领域 enum。内容待采集/已过滤/待整理/待审核/已发布/已拒绝/处理失败；页面空状态/加载中/加载失败/已无更多内容。`unknown` 不得渲染为正常启用。

发布未知结果统一进入 `reconcile_wait`。该状态表示远端结果未知，不是额外业务成功态：使用同一 `reconcile_key` 查询，确认成功转 `published`，确认未提交才允许有界重试/人工处理，终态失败转 `terminal_failed`，急停转 `emergency_stopped`；不得创建第二个 `public_id` 或盲重试。

## 6. 数据与权限

- 需要保存什么数据:信源原始链接、规范 URL、查重结果、适配器与授权检查结果、启停和入队状态、原始内容标识及必要元数据、规范化内容、去重指纹、中文整理结果、图片候选、审核记录、发布状态、失败与重试记录。
- 数据来源:用户指定的 Instagram、X、Reddit 账号或社区、新闻网站/RSS 等公开信源;首批 X 候选清单已整理 59 条,其他平台的具体清单仍待确认。
- 是否涉及登录、权限、付款、隐私或第三方授权:公开访客浏览无需先确定登录方案;后台审核需要权限控制;部分平台 API 可能需要账号、密钥、付费额度或第三方授权,需先调研确认。
- 飞书 M3 影子资源现状(2026-08-01):用户另行明确授权后,已通过飞书 CLI 创建 `F1+1 信源库｜M3影子`,包含 `主信源`、`手机捕获` 两表、三个 grid 视图和一个未分享的手机表单;批次 `M3-20260801-X59-01` 已导入并由统筹部回读为 59/59,全部 `enabled=false`。该 Base 仍是影子资源,尚未成为业务真值,也没有连接 provider、Collector、采集、同步或发布链路。
- 飞书授权残余风险(2026-08-01):当前用户身份 verified;为取得表单能力执行的 `--recommend` 重新授权同时授予 142 个用户 scopes,其中包含超出本轮需要的 Base update/delete 等能力。本轮只按固定命令白名单使用所需能力;令牌级最小权限尚未收敛,缩减、撤销或重新授权必须另获用户确认,不得保存 auth 原始 JSON、token、open_id 或 appId。
- 飞书资源 ACL 状态(2026-08-01):用户另行明确授权后,已只用飞书 CLI 将六项公共权限收紧并 fresh read 为 `link_share_entity=closed`、`external_access=false`、`invite_external=false`、`share_entity=only_full_access`、`security_entity=only_full_access`、`comment_entity=anyone_can_edit`;维护者仍有 `manage_public=true`,表单继续 `shared=false`。现有 CLI 授权仍不能列出直接协作者名单,因此协作者边界保持 Unknown,不得推导为 Base 仅 owner 可访问。OAuth 142 scopes 风险继续独立存在;业务真值、provider、Collector、采集与发布切换均未获授权。
- 敏感信息处理方式:真实密钥只通过部署环境或密钥服务注入,不写入仓库、日志或摘要内容;最小权限、定期轮换和访问审计方案在风险检查中确定。

## 7. 技术路线

> [accepted] 当前系统路线入口包括 [ADR-SOURCE-001](decisions/system/2026-08-01-F1+1-信源库A到D演进路线-accepted.md)、[ADR-M4-KICKOFF-001](decisions/system/2026-08-01-F1+1-M4本地Kickoff系统路线-accepted.md)、[ADR-M4-PUBLIC-READ-001](decisions/system/2026-08-03-F1+1-公开读模型与API接线-v0.4-successor-accepted.md)、窄范围 [ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001](decisions/system/2026-08-09-F1+1-public-multimedia-synthetic运行profile与V2接线-successor-accepted.md)、[ADR-M5-RSS-REAL-001](decisions/system/2026-08-12-F1+1-RSS-REAL-001单一真实RSS采集纵切-successor-accepted.md) 与 [ADR-M5-REAL-REVIEW-PUBLISH-001](decisions/system/2026-08-12-F1+1-真实RSS人工审核与公开投影最小纵切-successor-accepted.md)。固定 M1 已每 900 秒调度唯一 Motorsport RSS 并在私有 SQLite 保存 20 条真实 `pending_review` 候选；后继按 [真实 RSS 人工审核与公开投影最小实施合同 v0.1](spec/F1+1-真实RSS人工审核与公开投影最小实施合同-v0.1.md) 只追加审核/发布 migration，在用户第二次显式手动发布后经唯一 snapshot outbox 推送独立公开只读投影。自动发布、真实媒体和其他来源仍关闭。

> [accepted] Admin 生产拓扑的窄范围入口为 [ADR-M5-ADMIN-DUAL-HOST-001](decisions/system/2026-08-09-F1+1-M5-Admin双主机拓扑-successor-accepted.md)与 [Admin 双主机实施合同 v0.2](spec/F1+1-M5-Admin双主机实施合同-v0.2.md)：独立 Admin 主机、唯一写主、Admin→public 单向只读投影、Mac/iPhone 全功能等价、`RTO≤4h`、`RPO≤15m`。真实 RSS 审核/手动发布的后端业务范围现由 `ADR-M5-REAL-REVIEW-PUBLISH-001` 接受；旧 `ADR-M5-REVIEW-SYNTHETIC-001` 只保留 synthetic 历史。Admin 视觉和 production deployment manifest 仍是两个独立门禁。

> [accepted] Admin 主机物理落点的现行窄范围 successor 为 [ADR-M5-ADMIN-DEDICATED-MACBOOK-001](decisions/system/2026-08-09-F1+1-M5-Admin专用MacBook部署边界-successor-accepted.md) 与 [专用 MacBook 补充实施合同 v0.2](spec/F1+1-M5-Admin专用MacBook补充实施合同-v0.2.md)：`admin-host` 固定为用户控制、家中或办公室、以常开为运维目标的专用 MacBook，不承担日常个人工作；public-host 继续独立，Mac/iPhone 日常只经私有 overlay 与应用强认证访问。旧 MacBook 主机落点 successor/v0.1 合同保留历史；真实设备、账号、FileVault、自动登录、网络、端口、密钥、备份服务和生产部署均未实施、验证或授权。

- 本地运行形态:锁定候选 Node.js `24.18.0`、Next.js `16.2.11`、npm `11.16.0`；Next App Router + React + TypeScript 单体 Web/控制核心，同仓单独启动 0/1 个同机 mock worker。版本写入 `.nvmrc`/`.node-version`、`package.json.engines`、`packageManager` 和 `.npmrc engine-strict=true`；当前机器 Node25/npm11.8 仅为环境事实。
- 本地状态库:Node.js 24 server-only `node:sqlite`，通过 repository 接口和只追加 SQL migration 访问；WAL、显式 `synchronous=FULL`、`busy_timeout`、`BEGIN IMMEDIATE`、有限 `lock_contention` 重试、`user_version` migration、crash recovery/checkpoint 已在 C 层预检用 SQLite 3.53.1 验证。M4 物理隔离的 `.local/f1plus1.sqlite`（`m3-shadow`）、`.local/f1plus1-public-synthetic.sqlite`（`public-synthetic`）与 `.local/f1plus1-public-multimedia-synthetic.sqlite`（`public-multimedia-synthetic`）均已完成对应 migration、profile ledger/root pin、原子幂等 seed、ATTACH/跨 profile 拒绝及独立测试/安全核收；每进程仍只能显式选择一个 profile，三库只用于本地 synthetic/测试且不替代 Base 业务真值。多媒体 Repository/API 后端已实现，公开 App V2 接线仍受视觉确认门禁；生产存储、多实例和网络文件系统继续未通过各自门禁。
- 真实 RSS 状态库:固定 M1 非 iCloud 私有根中的 `rss-real-private` SQLite 已按 `0001_rss_real.sql` 运行，`source/ingest_run/pending_review_candidate` 三表现有 20 条真实候选；采集器只更新机器字段并保护 `editor_*`。本地开发候选已实现只追加 `0002_admin_review_publish.sql` 的七表、确定性 mapping、完整 `sqlite_schema` 启动指纹、Review Repository/route facade、签名全量 ProjectionReceiver 和 PublicSnapshotRepository；唯一端到端临时库测试、Node24 typecheck 与最终限定安全门均有收据。固定 M1 真实库仍为 v1，正式 opener/HTTP server/receiver 服务和公开 origin 均未接线；现有 0001 与 synthetic 数据库没有被本轮候选修改。
- SOURCE-MGMT-001 本地 synthetic 后端的现行事实：开发 `TASK-20260810-91AF6E`、测试 `TASK-20260810-92C716`、数据 oracle `TASK-20260811-3D190C` 与最终安全 `TASK-20260811-FAD506` 均已由统筹 ACK；最终安全结论限 ACK 候选，`PASS / P0=0 / P1=0 / P2=0`。闭合 DB SHA-256 为 `ddf3778c62cf95f195b1f08db8b075d676069f4cc9fb39804063e1004dd2e939`，logical content root 为 `7cae9bb8767a259086920190f65485800bb6008e3dc294fba893d1b0b8156e6a`，数据 oracle SHA-256 为 `1ced08f0504bdfab352aea40ddb40e35cbde712ada05148ebc3f1ab82afc248e`。该闭环只证明 raw 后端/API、closed DB、session/CSRF、identity、audit、单 writer 拒绝及本地 `externalCalls=0`；[页面服务模型 proposed B](decisions/system/2026-08-10-F1+1-SOURCE-MGMT-001真实Admin页面服务模型-proposed.md) 内的 `91AF6E queued` 属任务形成时快照，不再代表现行前置状态。真实 `/admin/sources` 页面、当前 v2 视觉确认以及页面候选的测试/安全/设计三路运行验收仍未完成。
- 依赖策略:npm lockfile；原生 CSS Modules/设计 token；TypeScript 类型 + Zod 边界校验；Vitest/Testing Library 用合成 fixture 验证切片。M4 不引入 Redis、托管数据库、云队列、第三方自动化、付费 API 或必须境外运行的服务。
- UI 实现输入:公开信息流当前唯一最终实施入口为 [F1+1 v0.2 最终实现级产品合同](spec/F1+1-v0.2-最终实现级产品合同.md)，逐字绑定 `design/ui/F1+1-v0.2-全站设计/F1+1-v0.2-final-20260808.html` 与 SHA-256 `5a84bfb27294ebd727369118a95528f5b788bfacbe2d56cc03fcb006f6168cb1`。2026-08-07 v0.2 实现级设计合同与 v0.1 四页合同保留为历史/共享壳层输入；若与最终公开信息流合同冲突，以最终合同为准。Appica UI 与 Base UI 只作组件行为/语义参考，不形成包依赖，不使用其 `styles.css`，也不复制其演示资产。
- 数据领域合同:`mvp-local-v0.3` 及其已核收产物继续作为不可改写的历史冻结输入；公开 synthetic 活动产品合同为最小 `mvp-local-v0.4` successor。首轮机器包独立安全/测试分别发现 4 项与 1 项 P1；该 FAIL 历史保留。数据部通过 data-native 单一输入、exact decision fence、封闭 manifest/profile/ledger、DTO allowlist 与 symlink-safe 原子写完成五类整改，后继安全与测试聚焦复验均为 `PASS / P0=0 / P1=0 / P2=1` 并已 ACK；测试 P2 为未安装原生 Draft 2020-12 引擎，数据安全 P2 的应用代码四 root pin 已由后继 SQLite 实现关闭。v0.4 保留 v0.3 的 13 个领域对象、6 组状态机、5 类幂等键、9 条不变量、TaskEnvelope、internal-only 边界和 canonical JSON 规则，只追加 editorial category、中文详情、来源/访问/时间/媒体展示 snapshot 及对应 hash 输入。M3 33/9 仍只映射 Source/CapturedItem；v0.4 不反写 M3、不增加 Base 字段、领域实体、`public_story` 或第二发布身份。
- VS-0 M3 影子种子投影采用窄范围 accepted 实现决策 [ADR-M4-VS0-SEED-002](decisions/system/2026-08-02-F1+1-VS0-M3种子投影-successor-accepted.md)：M3 33 个 direct 字段/原始字节与 hash 保留，6 个 Source 缺失字段按固定 derived 规则补齐，`source_safety_epoch` 从 M3 直读；`added_at` 严格按 `YYYY-MM-DD 00:00:00` 投影为同一日历日期，creation timestamp 使用 UTC 午夜，59 行按 `source_id` Unicode code point 升序计算 projection hash，权威收据为 `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`。该决策只作用于 local fixture projection，59 行保持 `enabled=false`，不写 Base、不切 provider、不增加第二 schema。
- 本地 provider:默认 `fixture`；命令只能显式选择 `m3-shadow`、`public-synthetic` 或 `public-multimedia-synthetic` 中的一个，profile ledger/路径/manifest/count 任一不匹配即拒绝启动，同一进程禁止 attach 或混合数据库。`base_direct`、`base_snapshot` 只保留接口桩，不允许通过环境变量启用；fixture 不是第二业务真值。
- 本地 adapter/处理:默认 `mock`、fixture summary、fixture/无图 media、`manual_only` publish；不登录平台、不提交真实表单、不调用真实飞书、AI、图片或发布接口。
- 飞书权限门禁与 runtime profile:M4 仍使用 `M4-local-fixture-v0` 安全总配置（fixture/mock、`REAL_FEISHU_IO=false`、`REAL_EXTERNAL_IO=false`、`REAL_FORM_SUBMIT=false`、`PUBLISH_MODE=manual_only`），其已核收的本地数据库子 profile 为 `m3-shadow`、`public-synthetic` 与 `public-multimedia-synthetic`。未来 A/D 只读候选 `A/D-read-minimal-v0` 按操作拆分 granular scope；本轮不创建或交换 token，不执行重授权、撤权、logout 或轮换。
- 信源库演进路线(已确认):按 ADR-SOURCE-001 先进入 A，建立飞书 Base 单一业务真值并在门禁通过后由采集器在线直读；A 稳定后进入 D，继续以 Base 为唯一业务真值，只增加 `Base → 本地 last-known-good` 单向只读快照，并在独立门禁通过后切换 provider。
- 生产授权边界:`RSS-REAL-001` 是唯一真实采集例外，范围严格限 accepted successor 的固定源、固定 M1、15 分钟节奏、RSS-only、私有 `pending_review` 与零自动发布；当前尚未实现或运行。本地 Kickoff 仍不授权 Base 业务真值切换、A `base_direct`、D `base_snapshot`、其他真实采集、表单提交、自动发布、外发或付费。
- 中国大陆与个人维护: M4 不部署，运行时不依赖境外托管服务或远程密钥；未来部署必须另行确认运营主体、部署地域、数据区域、平台条款、AI 跨境与容量。网络安装受限时由用户配置合规 npm 镜像，仓库不保存凭证。
- 开工与实现证据:B 层 scaffold/lockfile 与 C 层 Node24.18.0/npm11.16.0/SQLite3.53.1 预检已通过；早期公开 feed/detail 前端 10 文件精确快照的开发、测试、安全任务均已 ACK。v0.4 数据机器合同整改复验、双 profile SQLite/seed、Next 受控启动出口、数据库覆盖单点整改，以及原 Repository/feed/detail API 的开发/测试/安全窗口也均已 ACK。多媒体 `DEV-MM-01..03` 的第三 profile、0/1/4 图原子 seed 与 V1/V2 API 已通过开发、测试、安全独立门禁。真实审核后端本地候选也已完成七表/mapping、Repository/route facade、ProjectionReceiver/PublicSnapshotRepository、唯一端到端测试、typecheck与最终限定安全门；它仍缺正式 M1 migration、HTTP server接线、UI、私有实机与公开切换收据。`DEV-MM-04`、完整 R12、生产存储和无障碍 AT 仍需各自收据。
- 本地管理安全:当前候选 app 只绑定 loopback（`APP_BIND_HOST=127.0.0.1`/`::1`）；admin mutation 需要 local-dev 会话、同源 Origin 和 CSRF nonce，缺失即拒绝。未来跨主机路线只经私有客户端/策略点达到独立 Admin 主机，仍需用户+设备+passkey+session+Origin+CSRF+CAS/fence。手动 publish/correct/withdraw 仅作用于已授权的本地投影，自动发布与外部发布接口关闭。
- app 目录合同:继续沿用 `app/src/app`、`app/src/modules`、`app/src/server`、`app/migrations`、`app/fixtures`、`app/scripts` 和 `.env.example` 的 accepted 布局；公开页面、public-synthetic migration/seed、Repository 与 feed/detail Route Handlers 已完成并 ACK。当前后继工作只包含最终冻结 UI 的 API 单一数据源接线及定向复验，并继续受独立门禁约束。
- 本地命令合同:`npm ci`、`npm run verify:env`、`npm run db:migrate`、`npm run seed:fixtures`、`npm run dev`、`npm run worker:mock`、`npm run test`、`npm run test:contract`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm run check`。migrate/seed/start 必须显式绑定一个 canonical profile/DB；随机路径覆盖已在真实 CLI 写前拒绝。公开前端、启动/SQLite、v0.4 Repository/API 与最终 App 落地已有收据；最终 App 新快照当前测试 FAIL，完整 R12 仍待验收。
- 关键约束:新信源只有在规范化、查重、`adapter_ready`、`authorization_valid`、`platform_allowed` 同时通过后立即进入采集队列，不以身份或 F1 相关性已核验为前置条件；正常目标只对授权有效、时间戳可信、可正常访问的 `api_monitorable` 信源统计；全部拟公开内容继续人工审核；图片默认可无图；自动发布默认关闭。
- 待验证技术风险:X 与 Instagram 的稳定访问、费用与审批；Reddit 与新闻/RSS 速率限制；`node:sqlite` 锁与事务；重复事件聚合；图片权利与安全代理；外部内容 XSS、SSRF、提示注入；摘要事实一致性；任务积压、限流、恢复和部署可达性。

### 7.1 领域发布与内部任务合同

- `m3-shadow` 与 v0.3 synthetic 证明继续使用冻结 v0.3 hash/fixture 语义。12 条 `public-synthetic` 内容只使用 [ADR-M4-PUBLIC-READ-001](decisions/system/2026-08-03-F1+1-公开读模型与API接线-v0.4-successor-accepted.md) 的 v0.4 successor：Content hash 新增 `editorial_category`、`source_time_status`、`published_at`；Summary hash 新增 `lead_zh`、`body_zh`、`key_points_zh`；批准 Bundle 冻结 source display/byline、access、time 与 media presentation snapshot。v0.4 记录不得复用 v0.3 hash。
- `public-synthetic` 的 12 条内容共用逐字复用的 `src-active`，每条都有 CapturedItem、Content、Summary、immutable ReleaseBundle、approved ReviewDecision、published Publication 和 PublishedProjection；10 条有 synthetic MediaCandidate。公开 ID 固定为 `public-demo-*`，不得绑定 59 个 M3 Source、创建第 60 行或增加第二公开真值。

- `ReleaseBundle` 是不可变公开载荷，沿用数据 v0.3 候选的 `release_bundle_id`、`bundle_version`、`content_id`、`summary_id`、`content_version_hash`、`summary_version_hash`、`source_evidence_url`、`canonical_json_rule_version`、`payload_hash`、`bundle_hash`、`release_status`、`immutable`、`media_refs` 和五类 fence。`content_version_hash` 的输入对象与当前 v0.3 生成器候选的 `content_hash_input` 一致：`content_id`、`source_id`、`external_content_id`、`canonical_url`、`content_kind`、`content_version`、`normalized_title`、`normalized_body`、`language`、`source_evidence_url`、`source_config_epoch`；`capture_id`、`external_url`、`published_at`、`captured_at` 等字段仍进入 Content/release canonical payload，但不在该 version-hash 对象中。`summary_version_hash` 的输入对象与当前 v0.3 `summary_hash_input` 候选一致：`summary_id`、`content_id`、`summary_version`、`title_zh`、`summary_zh`、`language=zh-CN`、`source_evidence_url`、`input_content_hash`、`summary_schema_version`、`summarizer`、`deterministic=true`；这些字段属于 Summary v0.3 候选，生成过程的其他运行元数据才进入 internal contract。`summary_status` 只表达生命周期，草稿仍使用既有 Summary 的 `summary_status=draft`。两类 hash 均按 `canonical-json-v1` 对上述对象复算，不能从 ID+版本字符串推导；若 v0.3 复验要求调整 schema 字段，须由数据部统一修订后再重验。
- release canonical payload 是从这些既有字段生成的冻结投影，不增加第二套持久化领域字段；按 v0.3 候选，它以 `canonical_payload` 保存可重建对象，冻结 `release_bundle_id`、`content_snapshot`、`summary_snapshot`、source snapshot（`source_id`、`canonical_url`、`platform`、`identity_status`、`source_config_epoch`、`source_safety_epoch`）、original URL（由 Content 的 `external_url`/`canonical_url` 取值）、rights snapshot、media hash/license/safety snapshot、policy version、schema version 和五个 fence。若 v0.3 复验要求调整 rights/media/policy/schema 字段，列为数据部修订项，保持 proposed，不在 Spec 增加同义字段。
- `payload_hash = SHA-256(canonical-json-v1(canonical_payload))`，只 hash 该冻结 payload；`bundle_hash_input` 固定为 `{release_bundle_id,bundle_version,payload_hash,canonical_json_rule_version,immutable}`，`bundle_hash = SHA-256(canonical-json-v1(bundle_hash_input))`，`approved_bundle_hash` 必须等于 `bundle_hash`。`canonical_payload`、`bundle_hash_input` 都是 ReleaseBundle 的可重建合同字段，不能改成未留证的隐含计算。冻结字段任何变化都创建新的 `release_bundle_id` 或递增 `bundle_version`，并将旧批准标为 `superseded`。
- `ReviewDecision` 以数据 v0.3 候选的 `review_decision_id`、`content_id`、`summary_id`、`release_bundle_id`、`review_version`、`decision`、`approved_bundle_hash`、`reviewer_ref`、`reviewed_at`、`decision_reason`、`decision_hash_input`、`decision_hash`、`canonical_json_rule_version`、`immutable` 和五类 fence 为准。`decision_hash_input` 只含 `review_decision_id`、`release_bundle_id`、`approved_bundle_hash`、`review_version`、`decision`、`canonical_json_rule_version` 和五个 fence；`decision_hash=SHA-256(canonical-json-v1(decision_hash_input))`。session 证据进入 internal-only `AuditEvent` 记录，不形成领域字段；未批准 Bundle 不得公开。
- `Publication` 对 `(release_bundle_id, approved_bundle_hash)` 建立唯一逻辑关系，始终只有一条记录、一个稳定 `public_id` 和一个单调 `publish_generation`。`Publication.idempotency_key` 是发布 Outbox/TaskEnvelope 的唯一 key，三者必须逐字相等；`Publication.reconcile_key` 只用于同一 Publication 的查询。发布超时在该记录上转入 `reconcile_wait`，查询成功、未提交、终态失败或急停都保留同一 `public_id`、generation 和两类 key，不创建第二 Publication。批准 hash 与任务 payload hash 语义分离；发布/更正/下架必须在一个事务中核对当前 Bundle/hash/version、`manual_only`、五 fence、session/Origin/CSRF 和幂等键。急停 canonical 状态为 `emergency_stopped`。
- `Publication` 其余 required fields（`publication_id`、content/summary 引用、approved content/summary hashes、published version hash、`reconcile_status`/`reconcile_attempt`、急停和错误/时间字段）以 v0.3 唯一 schema 为准；产品不创建第二字段集。
- `Publication.retryable_failed` 只能沿同一 Publication/key 回到 `queued`/`publishing`，并重新核对批准 hash、manual-only、五 fence 和人工操作；`blocked` 在阻断清除后回 `queued`；`reconcile_wait` 只能依同一 `reconcile_key` 进入确认成功、确认未提交、终态失败或急停。Outbox 的 retryable failure 只能复用原 operation/idempotency key 重新排队，过期、取消或 dead-letter 不得升级为公开状态。所有恢复均禁止新 public_id、第二 Publication 和自动切换。
- `PublishedProjection` 只读派生自 `Publication` 的 `published` 投影，复用同一 `public_id`/`publish_generation`/版本 hash，不成为第二发布真值或第二公开身份。
- `canonical_json_rule_version` 固定为 `canonical-json-v1`；规则生成精确 compact UTF-8 字节：对象键按 Unicode code point 排序、数组保持顺序、数字为有限 JSON 数字、保留显式 null、`ensure_ascii=false` 且不做 NFC/NFD 归一化、逗号/冒号无空白，拒绝 NaN/Infinity/指数重写和隐式类型转换。该规则是项目自定义规则，不能改写为其他名称。`payload_hash`、`bundle_hash`、`approved_bundle_hash` 必须按上一条定义互相校验。
- 内部 `TaskEnvelope` 固定引用 [`runtime-envelope.schema.json`](../data/mvp-contract-v0/runtime-envelope.schema.json) 的 `schema_version`、`envelope_type`、`task_id`、`operation_id`、`aggregate_type`、`aggregate_id`、`payload_hash`、五 fence、`lease_token`、`lease_expiry`、`deadline`、`attempt`、`idempotency_key`、可空 `reconcile_key`。Source、TaskEnvelope、Outbox 对同一采集激活复用 `operation_id`；publish Outbox/TaskEnvelope 复用对应 Publication 的 `idempotency_key`，publish/reconcile envelope 的 `reconcile_key` 与同一 Publication 的 `reconcile_key` 逐字相等，其他任务为 null。live envelope 的五 fence、epoch 和 `attempt` 从 1 起，`epoch=0` 在 schema 层永远拒绝；`attempt` 不得超过 `max_attempts`，`lease_token` 必须承载至少 128 bit CSPRNG opaque 值，`now < lease_expiry <= deadline <= now + MAX_TASK_WINDOW`，窗口是有限实现常量。缺失、Unknown、默认 0、负值或非单调 epoch 一律 fail closed。取得 lease、调用 provider/adapter 前、outbox dispatch 前、状态/提交 outbox 前以及 publication mutation 前，都必须做同一事务可见的五 fence CAS。stop、授权失效或合规停用递增对应 epoch，旧 worker 不能 ack/commit；新任务应在 60 秒内停止，旧结果只进入 internal-only 审计或同一 Publication 的 `reconcile_wait` 查询，恢复不自动回弹。outbox 的 stale epoch、cancelled、dead_letter 只表示内部任务结果，不升级为领域公开状态。

内部运行记录边界：`SourceObservation` 仅为 internal-only observation record（不得成为领域实体、Base 映射或公开状态），以 `source_id + external_id` 幂等并引用既有 Source；没有单独的草稿实体，草稿就是领域 `Summary(summary_status=draft)`，只有生成过程运行元数据进入 internal contract；`AuditEvent` 仅为 internal-only append-only 审计记录。`SourceObservation`、生成过程元数据和 `AuditEvent` 的字段、allowlist、owner、retention/cleanup、`additionalProperties=false` 由数据 v0.3 的 `data/mvp-contract-v0/internal-contract.schema.json` 候选承载：observation 最少记录 `observation_id`、`source_id`、`external_id`、`observed_at`、可空 `published_at`、`cursor_ref`、`response_hash`、`error_class`、`source_config_epoch`、`source_safety_epoch`、`operation_id`、owner 和幂等 key；audit 至少记录 event_id、monotonic_seq、occurred_at、clock_status、trace/session_hash、reason_code、operation/task 引用、五个 epoch、attempt、payload/fixture/schema hash、redaction_version 与 retention/cleanup。D80846 artifact 已交付并 ACK；若聚焦复验发现字段较窄，须由数据部补齐或给出一一对应映射后再定版；产品不把这些 internal-only 记录写成领域或 Base 字段。

### 7.2 安全 A 层合同

下列 R1–R13 是 M4 的静态安全 predicate，具体实现收据属于 B/C：

| 编号 | 必须固化的默认值、边界和拒绝条件 |
|---|---|
| R1 | registry 仅含 fixture/mock/manual-only；应用配置命名空间 canonical allowlist 中 `REAL_*` 仅接受字面量 `false`；未知值、旧别名、真实 provider/能力变量、凭证/代理/Node 注入/旧数据库/自动发布/API key 环境变量、fixture 越界/symlink/hardlink/TOCTOU/schema/hash 错误拒绝；每次调用重断言 registry/profile。 |
| R2 | bind 仅 `127.0.0.1`/`::1`，端口 1024–65535；默认 origin 为 `http://127.0.0.1:3000`，实际 origin 必须是同端口 loopback 的严格 http URL，禁止 userinfo/path/query/fragment/wildcard；不信任转发头，关闭 CORS，mutation 只接受一个精确 Origin，GET 不变更。 |
| R3 | session/CSRF CSPRNG ≥256 bit、内存、重启失效；HttpOnly/SameSite=Strict/host-only cookie；nonce 绑定 session/method/path/body hash/time，TTL ≤10min，原子消费和常量时间比较，重放/并发/过期/错绑/GET mutation 拒绝。 |
| R4 | 日志/audit allowlist；不写 headers/query/body/原文/prompt/model/private URL/stack/topology；统一遮蔽 Authorization/Cookie/Set-Cookie/token/OAuth code/api_key/secret/password/private URL/platform ID；未知 secret 字段阻止日志并产出 redacted incident；源码/client bundle 扫描拒绝。 |
| R5 | `umask 077`；目录 0700、DB/WAL/SHM/journal/backup 0600；DB path realpath 在允许根，拒绝链接/TOCTOU，O_NOFOLLOW/原子创建；路径、权限、WAL、恢复、并发纳入合同测试。 |
| R6 | M4 原链只 display-only，media 仅 synthetic/none，无 http(s) fetch；未来 fetch 需新门禁、https、逐跳 DNS/IP pinning、私网/危险协议/变体拒绝、无默认 redirect、无代理绕过、有限字节/时间/压缩上限（启用前在新 ADR 固定数值）；redirect 不接受任意 next。 |
| R7 | DTO text-only，禁危险 HTML/Markdown/CSS/URL 拼接；富文本需 sanitizer/上下文编码；CSP/nosniff/frame-ancestors/referrer policy；XML 禁 DTD/实体/网络并限字节/长度/深度/节点/解压/时间（启用前在新 ADR 固定数值）；M4 media 拒绝 SVG/HTML/active content，未来在隔离 worker 按 MIME/魔数/尺寸/像素/帧/时间上限处理。 |
| R8 | summary 仅 deterministic fixture；worker 无网络/DNS/socket/subprocess/tools/secrets/publish repo，输入/输出固定 schema/长度/引用；真实模型另建任务。 |
| R9 | TaskEnvelope 固定 schema/envelope/aggregate/idempotency 字段、五 fence、lease/deadline/attempt；live 五 fence、epoch 与 attempt 从 1 起，`epoch=0` 永远由 schema 拒绝，attempt 不超过 max_attempts，lease_token 至少承载 128 bit CSPRNG opaque，`now < lease_expiry <= deadline <= now + MAX_TASK_WINDOW`；缺失/Unknown/默认0/非单调拒绝，`source_config_epoch` 是唯一 source config 命名；每个副作用前 CAS；stop/授权/合规递增 fence，≤60 秒停新任务，旧结果只进入 internal-only 审计/对账。 |
| R10 | `content_version_hash`、`summary_version_hash` 从 v0.3 候选指定不可变字段对象复算；ReleaseBundle 的 `canonical_payload` 冻结 content/summary snapshots、source snapshot（含 identity_status）、original URL、rights snapshot、media hash/license/safety snapshot、policy/schema 版本、五 fence；`payload_hash` 只 hash payload，`bundle_hash_input` 与 `decision_hash_input` 均有固定对象和 `canonical-json-v1` 复算式，`approved_bundle_hash=bundle_hash`；变更即新 Bundle 并 supersede；Publication、publish Outbox、TaskEnvelope 共用一个 idempotency key，publish/reconcile envelope 的可空 `reconcile_key` 与同一 Publication 逐字相等，unknown outcome 只说明进入 `reconcile_wait`，同一 Publication/key 查询且不增 public_id。 |
| R11 | M4 无 Feishu auth SDK/command/credential/token mutation；未来按 operation→granular scope→ACL 三层核对，缺失/额外/ACL unknown fail closed；auth 生命周期和真实 Base 需新任务、收据、用户确认。 |
| R12 | dependency bootstrap 与 runtime no-egress 分开；`npm ci` 仅用户批准网络/审计缓存；verify/check/test/dev/worker deny-all，仅允许 127.0.0.1/::1，`external_calls=0` 覆盖 DNS/HTTP/raw socket/subprocess/child_process/proxy，阻断代理绕过并审计 lifecycle，外联先记录脱敏安全事件再非零退出。 |
| R13 | task/operation/review/publish/stop/reconcile 记录 synthetic trace、脱敏 hash、epoch、attempt、错误/状态/下一动作；unknown capability/env、Origin/CSRF/session reject、secret scan、egress attempt、stale-fence/schema/hash reject 也记录 redacted reason_code/trace/session_hash/epoch；internal-only `AuditEvent` 采用 allowlist、append-only monotonic_seq、clock_status、redaction_version 和 retention/cleanup 字段，`additionalProperties=false`，禁 secret/original/private ID/stack；retention/时钟异常须声明。 |

### 7.3 Fixture 分层与 A/B/C 门禁

fixture 层固定且互斥为三层：`m3-shadow-seed`（59×33、全部 `enabled=false`）、`synthetic-case-seed`（含 published projection 与 snapshot reconciliation 的子集）和 `security-error-seed`。公开投影与快照对账不得各自成为第四、第五层，必须在 synthetic 层内保留独立的 manifest/hash/count 元数据；所有层使用 synthetic scheme/`synthetic.invalid`，`external_calls=0`。数据 v0.3 已由 D80846 交付/ACK，并经两份聚焦复验 PASS；本任务保持其冻结输入，不修改 data。

| 轴 | 内容 | 当前状态 |
|---|---|---|
| A | 版本、路由、状态机、领域/内部映射、安全 predicate、fixture 层、失败路径 | **accepted**；两份聚焦复验 `PASS / P0=0 / P1=0`，首轮 FAIL 历史保留 |
| B | accepted 后创建 package/lock/版本文件/目录/最小 scaffold | **completed**；静态初始化与 `package-lock.json` 已通过开发/安全/测试审计，`node_modules` 当前存在且被 gitignored |
| C | Node24、SQLite、UI/API、安全 deny-all、contract/build/test | **部分实现**；Node24/npm ci、v0.4、既有双 profile 与新增多媒体第三 profile、原子 0/1/4 图 seed、受控启动、Repository/feed/detail V1/V2 API 和最终 v0.2 App 落地已完成对应任务；VS1 的 `COLLECT-MOCK-002`、`CONTENT-PROCESS-003`、`SUMMARY-MOCK-004` 已完成本地 synthetic operator 与独立门禁；SOURCE-MGMT-001 raw 后端/API 已完成开发、测试、数据 oracle 与最终安全闭环，真实页面、视觉确认和同候选三路运行验收仍未完成；`DEV-MM-01..03` 独立门禁 PASS，`DEV-MM-04` 公开 UI 仍等待用户视觉确认，七状态/AT 亦有未验项；其余 Admin、完整 R12、VS-2/VS-3、真实外部能力继续未完成或受用户门禁 |

## 8. 风险检查

进入正式实现前先完成本地 Kickoff 复核；M4 候选允许用 mock/fixture 推进，不代表真实平台准入:

- 最大需求风险:直接照搬参考站全部功能会扩大 MVP,需要先区分核心阅读闭环和后续能力。
- 最大 UI / 交互风险:最终视觉方向、冻结 HTML 与六张视口证据已经用户确认并 ACK；当前风险转为 app 实现漂移、响应式 Dock 点击穿透、多手势重复翻页、焦点管理和 API 接线引入第二真值，必须由最终合同逐项验收。
- 最大数据或权限风险:平台 API 条款、媒体使用权、内容转载边界、后台权限和第三方密钥管理尚未确认。
- 最大技术可行性风险:在不绕过访问控制的前提下,X 与 Instagram 是否能稳定达到 15 分钟内采集。
- 需要先做的小实验:公开参考站行为与接口线索调研;各平台官方与开源采集路径对比;少量白名单信源端到端采集、去重、摘要与审核试跑;图片代理安全探针。
- M4/M5 本地最大技术风险:双 profile 物理隔离、运行时 root-of-trust、migration/seed、受控启动和 Repository/API 已核收；当前风险集中在最终前端单一数据源接线、冻结交互的浏览器/辅助技术一致性与完整 R12。生产数据库仍需单独决策。
- M4 本地最大安全风险:本地 admin 入口、fixture 注入、URL/HTML/媒体处理、提示注入和日志脱敏；`APP_ENV`、`REAL_*`、provider、publish 开关必须 fail closed。
- M4 本地最大范围风险:把 fixture provider、mock worker 或本地公开投影误写成真实 Base/provider/采集/发布能力；所有本地输出必须标注 local-only。
- M4 依赖与部署风险:当前不引入 ORM、Redis、云队列、Postgres 或 Docker；Node24/npm ci/SQLite 预检和公开前端 check 已 PASS。生产存储、多实例和网络文件系统仍未验证，不能由本地 SQLite 推导生产可用性。
- M4 领域合同风险:v0.4 首轮机器合同 FAIL 及五类 P1 已由后继整改和独立复验闭环；后续 UI 若绕过 Projection/批准发布链、启发式补字段、在 M3 59 行与 `src-active` 间混表、依赖 `DEMO_STORIES` 或新增 `public_story`，仍会形成第二真值并绕过审核链。最终实现必须继续证明 v0.3 SHA、59×39/e7a8 与 12 套完整图不漂移。
- 外部门禁继续打开:平台授权/条款/费用、AI 数据区域与训练退出、图片权利、直接协作者边界、OAuth 142 scopes 最小化、真实部署和中国大陆合规均未由本候选解决。

## 9. 验收标准

### M4 本地 Kickoff 候选验收（本地/合成，未宣称生产通过）

- [ ] A 轴静态候选固定 Node `24.18.0`、Next `16.2.11`、npm `11.16.0`；错误版本、fixture 路径、schema 或 `REAL_*`/provider/publish 开关组合会拒绝启动。C 层本地预检已通过；业务实现仍单独验收。
- [ ] server-only `node:sqlite` migration 可重复执行；repository 层覆盖 WAL、显式 synchronous、busy timeout、BEGIN IMMEDIATE、有限锁重试、唯一约束、CAS、领域 `source_config_epoch`/`source_safety_epoch` 和 crash 后恢复；内部 `TaskEnvelope` 五 fence 只由 `runtime-envelope.schema.json` 候选承载，不写入领域 schema 或 Base 映射。
- [x] `mvp-local-v0.3` schema/mapping/state machine/fixtures 已通过聚焦复验并冻结；本轮 successor 不改其历史 artifact。
- [x] `mvp-local-v0.4` machine contract 与 `public-demo-12-v0.4` manifest 已完成五类 P1 整改，并通过安全/测试独立聚焦复验后由统筹 ACK；首轮 FAIL 历史保留。已证明 v0.3 SHA 零漂移、M3 59×39/e7a8 不变、12 capture/content/summary/bundle/decision/publication/projection、10 media、1 source 的 ID/FK/enum/hash 与新增失败探针通过。
- [x] fixture provider 已以物理隔离的 M3 与 public synthetic SQLite 实现只追加 migration/原子 seed；每进程显式选择一个 canonical profile，ledger/manifest/path/root/count/ATTACH/混用不匹配写前拒绝，不写回 Base，并通过测试与安全闭包。
- [x] mock adapter → observation → normalization/dedupe → inbox/outbox 的重复投递只产生一个业务事件，旧领域 `source_config_epoch`/`source_safety_epoch` 或旧 task envelope runtime fence（`authorization_version`/`policy_epoch`/`recovery_epoch`）结果不能更新当前状态；observation、inbox/CAS、outbox 意图在同一事务内提交。VS1 固定 Node24 operator、领域事务/hash、25-case 恢复链及独立数据/测试/安全门禁均已 ACK；该勾选只覆盖本地 synthetic。
- [ ] mock summary/media → ReleaseBundle → review 的 v0.4 content/summary hash 可从 accepted 字段对象复算；source/access/time/media snapshot、权利/政策/schema 或 fence 变化会创建新 Bundle 并使旧审核失效；无图可以继续待审。VS1 的 fixture-only mock Summary、immutable Bundle、012 缺失/回滚与 hash 子集已完成；该复合项仍含 media 与可见 review 出口，不能由 `SUMMARY-MOCK-004` 单项完成态外推勾选。
- [ ] `ReleaseBundle`/`ReviewDecision`/`Publication` 按 7.1 绑定不可变版本、`approved_bundle_hash`、稳定 `public_id`、`publish_generation` 和 `reconcile_key`；同一 `(release_bundle_id, approved_bundle_hash)` 只有一个 Publication，且 Publication、publish Outbox、TaskEnvelope 逐字共享 `idempotency_key`；未审核 Bundle 不会进入本地公开投影，unknown outcome 只作为进入 `reconcile_wait` 的原因，同一 key 查询不新增 `public_id`。
- [ ] 本地页面路由固定为 `/`、`/stories/[publicId]`、`/admin/reviews`、`/admin/sources`。公开首页与详情只从 projection-first API/Repository 读取且无 `DEMO_STORIES`；最终 App 已落地，但最新候选必须先关闭矩阵中全部公开页 P1。SOURCE-MGMT-001 raw 后端/API 已通过开发、测试、数据 oracle 与最终安全门，真实 `/admin/sources` 页面仍未实现；审核队列和信源页面继续按矩阵及各自用户门禁推进。
- [x] `GET /api/public/feed` 固定 page size=12、`published_at/public_id` 双键降序和筛选绑定不透明 cursor；`GET /api/public/stories/{publicId}` 对合法未公开 ID 统一 404。query/cursor 非法、链不完整、hash/fence 漂移、DB busy 分别返回 accepted Problem reasonCode，任一损坏整请求 fail closed。开发、正式测试和安全复审任务均已 ACK；该勾选只覆盖 API/Repository，不外推浏览器筛选、分页 append 或错误恢复已完成。
- [ ] 新信源仅在 canonical URL 有效、规范化有效、查重唯一、三门和五 fence 当前且 stop 清除时，通过一个事务原子写 `enabled=true`、`queued`、唯一 onboarding operation 与唯一 outbox；worker lease 后才 `queued → collecting`。platform > authorization > adapter 的阻断优先级、每个重试/恢复出口、`paused` 仅 lifecycle_status、`epoch=0` schema 拒绝和身份/相关性 unknown 不升级均有静态合同与 fixture/API/UI 路径。现行本地 synthetic raw 后端/API、安全与恢复出口已由 `91AF6E/92C716/3D190C/FAD506` ACK 证据闭合；本项继续未勾选，只因当前 v2 视觉确认、真实页面实现及页面候选的测试/安全/设计三路运行验收尚未完成，不外推真实 provider、Base、生产或外部 I/O。
- [ ] 固定 hash 的 v0.2 最终设计逐项落实：单列时间线、完整摘要、1440 右下角文字工具、`<=1100px` Dock 与安全区、设置外部点击关闭、单一主题按钮、手风琴居中、0/1/4 图证据行、pointer/touch/trackpad 单步滑动、lightbox、七类展示状态、深浅主题、44px、键盘/焦点/aria、减少动效/透明度、forced-colors 和 200% 缩放均有正式可达证据。当前 App 已落地但 34476E 为 FAIL/P1=3；多媒体 runtime graph、第三 SQLite、Repository 与 V1/V2 API 已由 `DEV-MM-01..03` 及独立测试/安全门禁关闭，`DEV-MM-04` 公开 App 接线、浏览器交互与视觉仍待用户确认，组件预留或 `NOT_RUN` 不得勾选。
- [ ] admin 入口仅 loopback 可达；local-dev 会话、Origin 和 CSRF nonce 缺一即拒绝；manual publish/correct/withdraw 重新校验批准 hash，自动发布和外部写入保持关闭。
- [ ] 全部 M4 测试不调用真实飞书、平台、AI、图片、付费、部署或表单提交；日志/fixture/测试报告无 token、密钥、原文全文和私人标识。
- [x] P0-01–P0-09、R1–R13 与公开读模型的产品级静态合同已有 accepted 落点。v0.4、双 profile SQLite/seed、启动安全出口、Repository/API 与 VS1 三项本地 mock Function 已通过对应独立门禁；最终 App 当前 P1、AT 实机、完整 R12、Admin、VS-2/VS-3 与真实外部能力未通过各自门禁前不得宣称完整实现或生产放行。

### 未来真实系统验收

- [ ] 管理员可以添加、启用和停用一个白名单信源,并查看其最近采集时间与错误状态。
- [ ] 新信源提交后,规范化与查重通过且适配器能力、合法授权均有效时立即产生幂等采集任务;`identity_status` 或 `relevance_status` 为 `unknown` 不阻断入队。
- [ ] URL 无效、重复归属不明、适配器缺失、授权失效、平台受限、入队失败或采集失败时,系统记录明确阻断/失败状态并告警,且不绕过平台访问控制。
- [ ] 配置状态与唯一入队意图在同一事务写入;队列重试复用不可变操作 ID。每次平台调用及结果提交前重新检查启停、授权、合规停止状态和安全 epoch,过期任务不得继续请求或写入当前结果。
- [ ] 信源库任一时刻只有一个业务真值且最多一个活动读取 provider;Collector 运行时恰有一个 provider,门禁间隙可以停止。A/D 均以 Base 为唯一业务真值,D 的本地快照只能由 Base 单向生成且不得反写。
- [ ] Base 业务真值切换、A `base_direct` 切换和 D `base_snapshot` 切换分别经过实现验证、故障/回滚检查与用户确认;任一门禁未通过时维持当前已批准阶段。
- [ ] 在信源及接口正常可访问时,一条符合初筛规则的测试内容能在发布后 15 分钟内被发现并进入处理流程。
- [ ] 相同原始内容重复采集或任务重试时,不会生成重复的审核项或公开内容。
- [ ] 明显广告、垃圾、空内容或与 F1 无关的内容可被标记为低质量并阻止进入正常审核流;具体规则可在审核阶段校准。
- [ ] 审核者可以查看来源证据、中文整理结果和图片候选,完成编辑、通过或拒绝。
- [ ] 人工批准绑定不可变内容版本及其 hash;批准后再次编辑必须回到待审核。公开发布只接受与当前批准 hash 完全一致的版本,发布重试不得复用旧版本批准。
- [ ] 通过审核的内容会出现在公开信息流;访客能打开站内详情并跳转到正确的原始链接。
- [ ] 暂停采集、接口限流、处理失败和发布失败均有可见状态与安全重试路径,且不会绕过人工审核。
- [ ] 自动发布的开启权限、量化准入门槛、停止与回退方式在实现前经用户确认;在此之前保持人工审核。

## 10. 变更记录

> 大改先记录原因,再更新上文,最后动代码。

| 日期 | 版本 | 变更 | 原因 |
|------|------|------|------|
| 2026-08-11 | SOURCE-MGMT-001 后端最终 PASS 状态同步 | 逐项复核并同步 `91AF6E` 开发、`92C716` 测试、`3D190C` 数据 oracle、`FAD506` 最终安全均已 ACK；raw 后端/API 与本地 synthetic 安全出口已闭合。Function ID 及接口、数据、认证、安全、视觉合同不变；SOURCE-MGMT-001 继续 P1，剩余原因只保留当前视觉确认、真实页面实现与同候选测试/安全/设计三路运行验收 | TASK-20260811-0345AC；吸收 `907A0B` 的整体 `NOT READY` 边界，不外推真实 provider/Base、外部 I/O、Admin 生产访问或部署 |
| 2026-08-09 | VS1 本地 mock 三项状态同步 | `COLLECT-MOCK-002`、`CONTENT-PROCESS-003`、`SUMMARY-MOCK-004` 依据开发/数据/测试/安全最终 ACK 证据从 P1 更新为 `complete`；矩阵计数同步为 17/20/13；完成边界限固定 Node24、本地 synthetic operator、V-OP/25-case 恢复链与进程级 `externalCalls=0` | TASK-20260809-611B38；不外推 Admin、真实 provider/Base/AI、OS 级 no-egress、外部 I/O 或生产 |
| 2026-08-09 | 多媒体后端门禁状态同步 | 同步 `DEV-MM-01..03`、独立 `public-multimedia-synthetic` SQLite、原子 0/1/4 图 seed、V1/V2 API 与 fail-closed 后端已通过开发/安全/测试并 ACK；`DEV-MM-04` 继续等待用户视觉确认；保留 pre-update synthetic DB 留存/误取与 Turbopack tracing/部署打包两项 P2 | TASK-20260809-DE4B65；只更新产品状态，不修改 app/data/design/accepted ADR 核心 |
| 2026-08-09 | 初版全功能追踪矩阵 v0.1 | 吸收 COR-20260809T102214-960E65，将已确认功能统一登记 Function ID、入口、依赖、视觉锚点、恢复、Owner、证据与授权轴；状态只用 complete/user-gated/P1-blocker。同步最终 App 已 ACK 但独立测试 FAIL/P1=3，建立本地 synthetic 0/1/4 图 successor 草案并绑定数据任务 33B8F5；RSS 依赖与真实请求继续分层用户门禁 | TASK-20260809-B10D8D；禁止用组件预留、静态分支、测试注入或 NOT_RUN 冒充完成，不修改 app/data/design/accepted ADR 核心 |
| 2026-08-08 | v0.2 最终 UI 产品真值 | 绑定已 ACK 的冻结 HTML `F1+1-v0.2-final-20260808.html` 与 SHA-256 `5a84…8cb1`，引用最终实现级产品合同；同步 Repository/API 及早期前端 ACK 时态，明确最终 app 落地、API 单一数据源、交互/无障碍复验仍 pending，真实外部能力继续关闭 | TASK-20260808-00A9C9；只同步产品合同，不修改 design、app、data 或 accepted ADR 核心 |
| 2026-08-06 | M4 本地闭环状态同步 | 记录 Repository/feed/detail API 已在本地 end-to-end 验证（`public-synthetic` 迁移/seed、`npm run check` 全绿、新增 `test:public-http` 真实 HTTP 矩阵全绿、零泄露分类器全 0），并记录 Next 16 dev 注入 `NODE_OPTIONS` 与应用 R1 冲突（dev 不服务公开 API、演示走 `npm run start`）；明确正式任务交付/新快照定向回归仍保持门禁，v0.2 视觉待设计部确认 | 务实本地闭环，非正式任务门禁；只更新已发生时态，不修改 accepted ADR、app、data、design 或 lock |
| 2026-08-04 | M4 实施状态同步 | 同步公开前端精确快照测试/设计 `PASS / P0=0 / P1=0 / P2=2` 且已 ACK；记录 AT/200%/forced-colors 与 public-demo+SQLite/API 新快照重验边界；同步 v0.4 数据首轮安全 `FAIL / 0/4/1`、测试 `FAIL / 0/1/1`、五类 P1 整改任务已完成待聚焦复验及开发接线关闭 | TASK-20260803-2F2899；仅更新已发生时态，不修改 accepted ADR、app、data、design 或 lock |
| 2026-08-03 | v1 候选修订 | 接受 ADR-M4-PUBLIC-READ-001：物理隔离 `m3-shadow`/`public-synthetic` 双 profile/SQLite，M3 59×39/e7a8 与 v0.3 冻结不漂移；采用最小 v0.4、`public-demo-*`、projection-first feed/detail DTO/cursor/Problem 及迁移/回退门禁 | 用户明确确认 U1/U2；为公开前端接入唯一 SQLite 发布链，避免 M3 混行、第二真值和启发式字段派生 |
| 2026-08-02 | v1 候选修订 | 吸收 `TASK-20260802-5BAF26`：按统一 v0.3 基线重写原子 enable+queued、规范化/查重门、blocked 优先级、操作 ID、单一 Publication/key、可重建 hash、internal-only 运行记录、三层 seed、epoch0 拒绝和数据 ACK/复验 FAIL 时态；Spec 继续 proposed | 第二轮测试/安全复验发现 v0.2 文档存在跨合同 P0/P1 漂移；数据合同仍由数据部并行修订，未切换真值/provider、未初始化 app |
| 2026-08-02 | v1 候选修订 | 吸收开发/安全/测试三方复核，关闭 A 轴 P0-01–P0-09；补齐三门入队状态机、四条 canonical 路由、ReleaseBundle/ReviewDecision/Publication、TaskEnvelope/`runtime-envelope.schema.json` 候选、版本化 hash、`reconcile_wait`、fixture 分层、R1–R13 静态合同及 A/B/C 分层 | TASK-20260802-131D64；数据部 v0.2、app 初始化、Node24/SQLite/UI/安全运行证据保持并行或后置未验证；Spec 继续 proposed |
| 2026-08-02 | C 层预检状态同步 | 吸收 D27E44、7BFD99、6F480F 的 `PASS / P0=0 / P1=0`：Node24.18.0/npm11.16.0、SQLite3.53.1、`npm ci --ignore-scripts`、lint/typecheck/build 和两路复验通过；该历史节点当时允许 VS-0，Repository/UI/API/完整 R12/VS-1–3 与真实外部能力仍 pending/closed | 保留首轮 FAIL、延迟清理误删 node_modules及恢复/复验历史；现行 VS1 三项本地 mock Function 状态见 2026-08-09 记录 |
| 2026-08-02 | VS-0 M3 投影 hash 收据纠错 | 当前唯一入口为 [ADR-M4-VS0-SEED-002](decisions/system/2026-08-02-F1+1-VS0-M3种子投影-successor-accepted.md)：以 `source_id` Unicode code point 升序算法为权威，`e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17` 为有效 sorted 收据；`96d5caf625f62d059cc51a41d7c3b6a1db623d07cea00c4d256e2d841c693aa2` 仅保留为 unsorted 历史候选，前任 ADR 已 `superseded` | TASK-20260802-E1CFC2；仅纠正本地 fixture projection 收据，不改冻结 v0.3/data/app/Base，不创建第二 schema或 provider 切换 |
| 2026-08-01 | v1 候选 | 固化 M4 本地 Kickoff 技术栈、provider/adapter/mock 边界、数据领域合同引用、飞书权限 profile、app 目录合同、本地命令、首批纵向切片、设计实现级合同吸收和 fail-closed 门禁；Spec v1 保持 proposed | 用户授权本地技术选型与 app 开工；开发预检仅证明进程内 mock/SQLite 合同，真实端口、依赖安装、生产存储、平台、部署、付费、外发、真值/provider、真实采集/表单提交和自动发布仍需单独确认 |
| 2026-08-01 | v0 | 记录 M3 影子 Base 六项公共权限已通过 CLI 收紧并写后回读通过,保留直接协作者 Unknown、OAuth 142 scopes 与业务链路切换门禁 | 用户另行明确授权固定 ACL PATCH;该授权不包含协作者、OAuth 或业务链路变更 |
| 2026-08-01 | v0 | 记录 M3 影子 Base、两表/视图/表单和 59 条 `enabled=false` 导入的实际状态,补充 OAuth 过宽权限风险,继续保留真值/provider/Collector/发布门禁 | 用户另行授权 M3 影子资源与导入;该授权不包含业务链路切换或权限收敛 |
| 2026-08-01 | v0 | 引用 accepted ADR-SOURCE-001,固化信源库先A、后D的演进顺序、单一真值与三次独立切换门禁 | 用户于 2026-08-01 明确接受A到D路线;路线决定本身不自动授权真实资源或执行切换 |
| 2026-07-31 | v0 | 固化“新信源规范化与查重后立即采集、公开仍须人工审核”的生效门禁,补充默认状态、入队条件与失败路径 | 用户于 2026-07-31 明确确认该决定;该确认不代表接受 A/D 架构或授权创建真实飞书资源 |
| 2026-07-30 | v0 | 写入目标用户、白名单采集、15 分钟时效、低质量初筛、人工审核和阅读闭环 | 将已确认需求固化为团队协作地基 |
| 2026-07-30 | v0 | 创建 Spec 草案 | 项目地基初始化 |
