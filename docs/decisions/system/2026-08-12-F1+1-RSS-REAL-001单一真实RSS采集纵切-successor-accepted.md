---
type: system_adr
status: accepted
date: 2026-08-12
department: 产品部
decision_id: ADR-M5-RSS-REAL-001
related_task: TASK-20260812-4133D9
authorization_state: user_confirmed
authorization_evidence: 当前对话2026-08-12：用户明确批准真实采集，并确认个人非商业Beta暂不以合规为阻断
supersedes_draft: ./2026-08-09-F1+1-VS-RSS-0本地低频RSS试验-draft.md
implementation_state: pending_review
decision_scope: 固定M1上的Motorsport.com单源RSS真实采集、私有待审核入库与失败恢复
---

# ADR-M5-RSS-REAL-001：单一真实 RSS 采集纵切 successor（accepted）

## 1. 目标与状态

用户已批准 `RSS-REAL-001`：在固定 M1 上每 15 分钟读取一个固定 RSS，形成私有 `pending_review` 候选。accepted 只冻结实施合同；代码、依赖、M1 调度、私有数据库和运行收据当前均为 `pending_review`，须经开发实现及测试、安全独立复验后才可启用。

本 successor 取代旧 `ADR-VS-RSS-0-001` 的三次请求、24 小时临时诊断和 `au.motorsport.com` 试验口径。旧 draft 保留历史且正文不修改。

## 2. 固定源与运行节奏

- 唯一来源：`https://www.motorsport.com/rss/f1/news/`；只允许 `GET`、HTTPS、443、精确 host 与精确 path，禁止 query、userinfo、fragment、IP literal、通配子域和运行时 URL 输入。
- 固定执行端：现有 M1 Beta 主机；每个 UTC 15 分钟时间槽最多启动一次，`slot_key=floor(scheduled_at/900s)` 全局唯一，单来源最多一个在途运行。漏跑不补抓多个历史时间槽；下一次运行写明调度缺口。
- 只读取 RSS 响应。文章页、媒体、enclosure、站点 API、Base、AI、翻译和摘要调用均为 0。
- 请求发送已保存的 `ETag` / `Last-Modified` 条件头；响应未提供时字段保持 null 并记录 `validator_capability=unknown`。`304` 只生成无变化 `ingest_run`，不创建候选。
- 来源当前是否直返 200、是否重定向、MIME、条件头、字段与地区可达性均为运行期 Unknown；任一不符合本合同即失败关闭，不猜测或换域名。

## 3. 输入安全合同

- 每次解析前重新解析 DNS，并将实际连接地址钉在本次解析结果；解析结果只要包含 loopback、private、link-local、multicast、unspecified、CGNAT、保留/文档地址或 IPv4-mapped IPv6 即整体拒绝。禁止代理环境绕过。
- 重定向上限为 0。任何 3xx 返回 `REDIRECT_REJECTED`；TLS 证书或 hostname 校验失败、连接 3 秒、首字节 5 秒或总计 10 秒超时均不解析、不入库。
- 请求声明 `Accept-Encoding: identity`；任何非 identity `Content-Encoding` 拒绝。声明长度或实际读取字节超过 1 MiB 立即中止。只接受 `application/rss+xml`、`application/xml`、`text/xml`（可带 charset）。
- 严格 UTF-8 解码后，在创建 XML parser 前大小写不敏感地拒绝 `DOCTYPE`、`ENTITY`；解析器关闭外部资源、实体、XInclude 和网络 schema。最大深度 32、XML 节点 10,000、单字段 16,384 UTF-8 bytes。
- 必须完整解析并校验整份响应；item 总数上限 60，超过即拒绝整份。通过后按有效 `pubDate` 降序、稳定 external identity 升序打破并列，只选最新 20 条。任何 item 缺少可解析 `pubDate`，或缺少非空 GUID/Atom ID 且无可校验 canonical HTTPS link，均拒绝整份响应。
- RSS description 中的嵌入标记只允许转为有界纯文本；原始 XML、HTML、响应头、IP 清单、Cookie、token、媒体 URL 和正文不得落库或写日志。

## 4. 私有 SQLite 三表合同

私有 profile 固定为 `rss-real-private`，数据库位于 M1 的非 iCloud 私有数据根，不与 release 包、公开 synthetic SQLite、Base 或 Admin 主库混用。目录权限 0700，DB/WAL/SHM 0600；拒绝 symlink/hardlink，单 writer，WAL + `synchronous=FULL`。逻辑表仅有：

| 表 | 最小字段与约束 |
| --- | --- |
| `source` | `source_id`、精确 `feed_url`、`enabled`、`stop_epoch`、`etag`、`last_modified`、`last_attempt_at`、`last_success_at`、`next_eligible_at`、`last_reason_code`；只允许一行 `motorsport-f1-news` |
| `ingest_run` | `run_id`、唯一 `slot_key`、`scheduled_at/started_at/finished_at`、HTTP/validator 结果、`response_sha256`、字节数、完整 item 数、选取数、new/updated/duplicate 数、`status`、唯一 `reason_code`、`next_action`；禁止原始响应与完整 header |
| `pending_review_candidate` | `candidate_id`、`source_id`、`external_id`、唯一 `dedupe_key`、`canonical_url`、机器层 `title/excerpt/author/published_at/source_payload_hash/source_revision`、人工层 `editor_title/editor_excerpt/editor_notes/editor_based_on_source_revision`、初始 `review_status=pending_review`、`first_seen_at/last_seen_at` |

三表 migration、schema hash、运行 profile 与数据库路径必须由同一部署 manifest 绑定；任一不匹配写前拒绝。

## 5. 幂等、内容更新与事务

- `external_id` 优先使用非空 GUID/Atom ID，回退为规范化 canonical article URL；`dedupe_key=SHA-256(UTF8(source_id + U+001F + external_id))`。
- 同一 `dedupe_key + source_payload_hash` 只更新 `last_seen_at`；同一 identity 内容变化时递增 `source_revision` 并更新机器层字段。
- 机器层更新永不修改 `editor_*`、`editor_based_on_source_revision` 或 `review_status`。`review_status=pending_review` 只用于候选首次插入；后续以 `editor_based_on_source_revision IS NULL OR editor_based_on_source_revision < source_revision` 派生“需要复审”，只有后续人工审核动作可以写人工状态与审核基线。
- 一次 200 响应的 `ingest_run`、候选 insert/update 与 `source` validator/成功游标在一个 `BEGIN IMMEDIATE` 事务提交。任一失败全部回滚；不得保留部分候选或推进 validator。
- 候选永远停在私有 `pending_review`。不得创建 ReleaseBundle、Publication、PublishedProjection 或公开 DTO，也不得改变当前公开 synthetic 数据源。

## 6. 失败、恢复与收据

- URL/DNS/redirect/TLS/压缩/大小/MIME/XML/字段/身份/时间失败：整份拒绝、候选零写入、validator 不推进，写唯一 reason code 与 `next_action=manual_review`。
- 网络/5xx：本时间槽不即时重试，下一时间槽再试；429 仅接受有效 `Retry-After`，夹在 60–3600 秒并写 `next_eligible_at`；401/403/404 停止来源并等待人工处理。
- SQLite busy 只允许三次短退避；仍失败则本次回滚。事务结果未知时用同一 `run_id` 对账，确认未提交后才可在后续时间槽恢复，禁止创建第二 run 身份。
- 进程崩溃、M1 睡眠/离线或漏调度在下次启动生成 `scheduler_gap` 收据；不伪造 15 分钟达标。可测条目的发现延迟为 `first_seen_at - published_at`，无有效分母时写 `unknown/not_measurable`。
- 收据只含 ID、时间、计数、hash、固定状态/reason code 和下一动作；不得含 feed 内容、完整 URL/header、stack、密钥或本机绝对路径。

## 7. M1 部署与回退

- 实施包须绑定精确 Git commit、release hash、migration/schema hash、LaunchAgent plist hash 和数据库 profile；采集 LaunchAgent 与公开站进程分离，固定 900 秒节奏，只能写私有数据库。
- 启用顺序：离线 fixture/攻击向量通过 → 测试与安全 `P0=0/P1=0` → M1 私有目录与数据库初始化 → 单次受控真实运行 → 核对收据与公开站仍为 synthetic → 启用 15 分钟调度。
- 回退顺序：先递增 stop epoch 并卸载采集 LaunchAgent，等待/终止在途任务，确认停止后无新增 `ingest_run`；再切回上一精确 release。私有数据库转只读隔离保留，删除须另获授权；公开 synthetic 数据库和现有公网只读站保持原样。
- 回退验收：采集进程为 0、固定源外联为 0、停止后新 run 为 0、公开首页/详情仍只读 synthetic、Admin 与自动发布仍关闭。

## 8. 明确排除与验收出口

本合同排除自动发布、自动审核、文章正文/metadata second-hop、图片下载/代理/缓存、enclosure 使用、中文摘要/AI、Base/provider 切换、其他 RSS/平台来源、公开真实原链、Admin 公网入口和付费能力。个人非商业 Beta 的用户决定使合规评估不构成本纵切当前阻断；该决定不扩大第三方内容、媒体或商业再使用范围。

实现完成必须同时证明：固定 URL/15 分钟槽、1 MiB/60→20、全部输入安全负例、条件请求、三表原子事务、幂等与人工字段保留、失败收据、M1 停止/回退、公开 synthetic 零漂移和自动发布为 0。当前这些运行证据均未生成，状态保持 `pending_review / P1-blocker`。
