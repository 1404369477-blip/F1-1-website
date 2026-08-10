---
title: 公开前端浏览器 A/B/C 分层与 localhost-only 验收合同安全裁决
type: audit_report
department: 安全部
target: TASK-20260809-F67080 当前固定候选的浏览器验收边界
status: final
date: 2026-08-09
related_task: TASK-20260809-3AE944
decision: pass
tags: security,browser,no-egress,playwright,seatbelt,localhost
summary: 历史GCM/updater尝试只能归入浏览器辅助层Unknown，不构成五个本地Function ID的App泄漏P1；现有Seatbelt、独立headless shell、Playwright/CDP与进程树收据足以定义一次机械localhost-only验收
---

# 公开前端浏览器 A/B/C 分层与 localhost-only 验收合同安全裁决

## 1. 裁决结论

**PASS（允许按本报告合同执行一次后继 localhost-only 浏览器验收）。P0=0，P1=0，P2=1。**

当前固定候选身份沿用任务真值：

- source 聚合 SHA-256：`7b1e8977c3e7296f4e5cf165b106bc322c2ef19dbd5e506f51e2c4ec92465281`
- canonical DB SHA-256：`eb2d7ad2787a290f7a13adcb063215d58654bc9f66d1d8ff60b98f14592b9551`
- build-manifest SHA-256：`b8c57b58a1f524871415bd233871800d9608e35f2f4f188b2d58675e38f0881c`

历史 GCM/Google updater 尝试没有精确目的地、时间、PID、请求发起栈或页面关联，现有证据只能把它们保留为 **C 层 Unknown**。它们不能证明 App/server 外联，也不能证明页面触发了外部请求，因而不应直接把 `PUB-FEED-003`、`PUB-FEED-004`、`PUB-FEED-005`、`UI-A11Y-001`、`UI-RESP-002` 判为 P1。

五个 Function ID 仍缺当前候选的真实浏览器功能、状态、恢复、视觉和可访问性证据，状态继续 NOT_RUN/待验收。C 层历史污染只使旧浏览器收据不可复用，不改变 App 功能本身的安全定级。

## 2. A/B/C 三层边界

| 层 | 精确定义 | 必要证据 | 外联命中后的定级 |
|---|---|---|---|
| A：App/server | Next server、API、worker、fault proxy或项目子进程主动产生的 DNS/socket/HTTP(S)；包括服务端渲染、API handler、server action、后台任务 | App 进程树、启动参数、Seatbelt profile、PID→exe、监听与连接清单、应用日志/guard；候选 hash | 候选路径可证时为 App P1；若携带 secret/用户数据或触发真实外部副作用，按影响升级 P0。首错停止 |
| B：页面触发 | 页面、renderer、iframe、web/service worker、CSS/font/image/media、fetch/XHR/WebSocket/EventSource、导航、prefetch或页面脚本触发的请求 | 全 target CDP Network 事件、Playwright request/response/requestfailed、URL/方法/initiator/target/timestamp、页面资源清单；仅允许声明的 loopback | 任一外部 scheme/host/IP 或未声明 loopback 端口为候选 P1；若发生敏感数据发送或真实副作用按影响升级 P0。首错停止 |
| C：浏览器自身 | Chrome/Chromium 自身的 GCM、updater、遥测、组件更新、证书/安全服务等与页面候选无关的浏览器/辅助进程活动 | 固定独立 headless-shell、外层 Seatbelt、完整进程树与启动参数、PID→exe、lsof 成功连接快照；可得时记录 sandbox denial | 已成功外连使本次 harness 失败，但不得自动归为 App P1；被 Seatbelt 阻断且无 A/B 请求和无 App 数据时记工具观察项，可继续功能验收；无法归因则 C=Unknown，不外推 A/B |

归因采用“正证据优先”：

1. CDP/Playwright 显示页面 initiator、frame/worker target 或页面资源 URL时归 B。
2. App/server PID、调用日志或项目网络 guard 命中时归 A。
3. PID/exe 属于固定 headless-shell 辅助进程，且没有同时段、同目的地的页面 CDP/Playwright 事件或 App PID证据时归 C。
4. 只有域名片段或含糊日志，无法绑定 PID、target 或时间时归 Unknown；Unknown 只阻断相应层的“已证明”声明。
5. 禁止用 C 层事件虚构 App 数据外发，也禁止用“Chrome 常见后台流量”解释已被 B 层页面证据捕获的外部请求。

## 3. 历史 GCM/updater 事件裁决

历史材料已证明：旧候选页面资源和 API 观察均为 loopback，同期 harness 出现 GCM/updater 外部端点尝试；原始请求、精确目的地、时间与 PID没有持久化。

据此只能得出：

- 旧验收环境存在 C 层污染风险，旧收据不能作为当前候选 clean-room/no-egress PASS；
- 未证明外部连接成功；未证明 App payload、项目 secret 或业务数据离开本机；
- 未证明事件由 A 或 B 发起；
- 该历史应从原“Function P1”中拆出，保留 `C_BROWSER_AUX_ATTRIBUTION_UNKNOWN`；
- 当前候选五个 Function ID 仍须在同一 hash 上完成一次新验收，但原因是当前浏览器功能证据缺失，不是已经证实 App 外联。

系统 Chrome 151 会混入 updater/GCM，不作为后继验收浏览器。固定使用独立 `ms-playwright` revision 1208 `chrome-headless-shell`。

## 4. 本地工具可行性

只读检查与统筹补充证据共同确认：

- `/usr/bin/sandbox-exec` 存在；
- 独立 `chrome-headless-shell` revision 1208 存在，当前文件 SHA-256=`a46b3b1e63163fa2d2437fb6ae967cb5a73b50050bca32f1964e6129b6228244`；
- `playwright-core` 1.58.2 可用；
- 已无副作用验证的 SBPL 结构可允许精确 `localhost:3000`，并对未授权本地端口返回 `EPERM`；
- Seatbelt 从 Playwright 驱动进程外层启动时，可继承约束普通 Chromium 后代；
- CDP 可记录页面网络，进程树和 `lsof` 可补充浏览器及辅助进程的成功连接证据。

该组合足以机械阻断普通浏览器后代的非白名单远端 IP 成功连接，并独立观察 B 层页面请求。PF/DTrace 不可用意味着无法证明 C 层“从未产生外联意图”；此限制列 P2，不阻断 A/B 功能验收。

## 5. 一次最小 localhost-only 浏览器验收合同

### 5.1 冻结与单次规则

后继测试开始前必须一次性冻结并写入 evidence manifest：

1. source 聚合、canonical DB、BUILD_ID、build-manifest、middleware-manifest及任务要求的源码/数据 SHA；
2. Node、`playwright-core` 版本与入口 hash；
3. chrome-headless-shell 绝对路径、revision、文件 SHA与启动参数；
4. Seatbelt profile canonical bytes/hash；
5. App、internal server、fault proxy、浏览器允许的精确 loopback 端口；
6. 任务专属 0700 临时根与全新浏览器 profile；
7. 单次 run ID、固定时钟/fixture身份和操作者。

浏览器功能矩阵只运行一次。首个 A/B 外联、候选漂移、sandbox 未生效、非白名单成功连接或 Function 失败即停止，不重跑来覆盖首错。

### 5.2 两个独立 Seatbelt 域

1. **App 域**：从最外层约束 Next/App/internal/fault-proxy 的完整普通后代；只允许任务声明的 loopback 监听和相互调用端口，禁止所有外部 remote IP。
2. **Browser 域**：从 Playwright 驱动进程外层约束驱动、chrome-headless-shell及普通辅助后代；只允许页面 origin、fault-proxy origin，以及确有必要且写入 manifest 的 loopback 端口。禁止使用宽泛 `localhost:*`。

SBPL 必须建立在统筹已验证的结构上：`(allow default)`，随后拒绝带 `(remote ip)` 的 outbound，再仅允许精确 `(remote tcp "localhost:<port>")`。实际 profile 在运行前必须用一个未授权 loopback 端口负例证明 `EPERM`，并用声明端口正例证明可达；这两项只验证 profile，不导航 App 页面。

任何 sandbox-exec 启动失败、profile 解析失败、后代逃离已记录进程树或端口白名单被扩大，整次环境 FAIL。

### 5.3 浏览器固定参数和环境

最小要求：

- 仅使用固定 headless-shell executable path，不使用系统 Chrome，不下载浏览器；
- 新建任务专属 user-data-dir，禁止复用个人 profile；
- 禁用扩展、同步、后台网络、默认应用、组件更新、域可靠性、翻译、媒体路由、崩溃上报、通知及后台模式；
- 使用 Playwright pipe/CDP，不开启外部可达调试端口；若必须使用调试端口，只能绑定任务声明的 `127.0.0.1` 临时端口并写入 manifest；
- 环境变量使用 allowlist，删除 proxy、真实 token、账号、云凭据与外部服务配置；
- `serviceWorkers: block`，除非某 Function 明确依赖 service worker；若依赖，则必须纳入全 target CDP 与 B 层判定；
- `acceptDownloads=false`，权限默认拒绝，持久化存储仅在任务临时 profile 内；
- 进程启动后、页面交互前持久化 argv、环境键名 allowlist、父子 PID、PID→exe、UID及文件 SHA。

参数用于降低 C 层噪音；安全结论仍以 Seatbelt 强制阻断、B 层 CDP与成功连接账本为准，不能把 flags 当作 no-egress 证明。

### 5.4 B 层页面网络账本

在首次导航前：

- 对 browser context 安装 request gate；允许 `about:`、`data:`、`blob:` 和 manifest 中精确 `http://127.0.0.1:<port>`；其他 URL 在发送前 abort 并记首错；
- 对 page、iframe、worker等全部 target 启用 CDP `Network`，记录 `requestWillBeSent`、response、loadingFailed、initiator、frame/target、时间、URL、方法、状态；
- 开启 target auto-attach，避免只观察主 tab；
- 持久化 Playwright request/response/requestfailed、console、pageerror、导航与下载事件；
- URL 可记录完整 loopback path/query；任何潜在 secret/header/cookie/body必须只记录 allowlist字段或脱敏 hash。

B 层 PASS 条件：全部页面触发请求均为声明 loopback或允许的非网络 scheme；外部 URL=0、未声明 loopback端口=0、下载=0、外部 WebSocket/EventSource=0。

### 5.5 C 层进程与成功连接账本

- 在浏览器启动后、首次导航前，递归冻结 Playwright/headless-shell进程树；交互阶段新增子进程必须追加并校验 executable 属于固定浏览器 bundle；
- 在导航前、关键状态切换期间和收口前，对完整 PID 集执行 `lsof -nP -a -p <pid-list> -i`，保存原始输出和 hash；
- 任一非声明 loopback的 `ESTABLISHED`、`SYN_SENT` 或可证成功外部连接使 harness FAIL；先按 PID/exe/时间归层，不自动写成 Function P1；
- Seatbelt 明确阻断、PID属于浏览器辅助进程、B/CDP与A/App无对应请求且未携带 App 数据时，记录 `C_AUX_ATTEMPT_BLOCKED`，允许继续；
- 只有含糊系统日志且无法绑定运行 PID/时间时记 `C_UNKNOWN`，不写“全浏览器从未尝试外联”，也不阻断 A/B Function PASS。

`lsof` 是瞬时成功连接补充证据，不能单独证明从未尝试。非白名单连接不能成功的主保证来自覆盖完整普通后代的 Seatbelt profile。

### 5.6 五个 Function ID 的最小矩阵

在同一浏览器 run、同一候选 hash 中依次覆盖：

- `PUB-FEED-003`：四类各 6、scope/cursor不串；
- `PUB-FEED-004`：loading、empty、error、404、nomore、partial、offline及唯一恢复；状态必须由真实 loopback fixture/代理或浏览器条件触发，无调试入口；
- `PUB-FEED-005`：12+12，顺序不变、无重复；page2失败保留12并以同 cursor恢复到24；
- `UI-A11Y-001`：键盘/焦点/语义、200%、forced-colors、reduced-motion、reduced-transparency；
- `UI-RESP-002`：1440/1024/390×深浅六格，390非零 safe-area，Dock与末条可达且无横向溢出。

每一步保存候选 hash、viewport/theme/state、操作、断言、恢复、焦点、请求账本和截图 hash。不得复用修复前截图或旧浏览器观察。

### 5.7 收口

无论 PASS/FAIL都必须：停止浏览器/App/proxy；确认任务端口无监听；扫描任务前缀进程、profile、DB/WAL/SHM/candidate；回读候选/DB/build hash；保存首错及全部原始账本 hash；精确清理任务临时根。不得清理 canonical 文件或掩盖首错。

## 6. PASS / FAIL / BLOCKED 规则

### 整次验收 PASS

只有以下条件全部成立：

- 固定候选前后零漂移；
- 两个 Seatbelt 域的 profile正例/负例通过并覆盖完整普通后代；
- A 层无外部成功连接或项目网络 guard命中；
- B 层全部请求为允许 scheme或精确 loopback，外部请求=0；
- C 层无非白名单成功连接；C 层被阻断尝试可单列但不能含 App 数据或 A/B关联；
- 五个 Function ID 的全部成功、失败、恢复、视觉和无障碍证据通过；
- 停止、残留、端口与 hash收口通过。

允许在上述条件下完成五个 Function ID 验收。报告应写“App/server与页面触发外部请求=0；浏览器普通后代被Seatbelt限制为声明loopback；未证明所有浏览器辅助进程从未产生外联意图”。

### 失败与归因

- A 外联：候选 Function/实现 P1；携带敏感数据或真实副作用时升级 P0，首错停止。
- B 外联：对应页面路径/Function P1；敏感数据或真实副作用时升级 P0，首错停止。
- C 成功外联：harness FAIL；五个 Function维持 NOT_RUN或以已经完成的独立功能证据逐项判断，不自动记 App P1。修正 harness 后需新任务授权，不能在同次重跑。
- C 被阻断尝试：观察项；无 A/B关联、无 App数据时不阻断 Function PASS。
- 层级不可归因：对应层 `Unknown`；只阻断相关 no-egress声明，不制造 App泄漏结论。
- sandbox/profile/进程树/账本缺失：环境 `BLOCKED`，Function保持 NOT_RUN，不判候选P1。
- 任一Function自身失败：只给该Function首错与P1，停止扩展；不能用网络环境PASS覆盖功能失败。

## 7. 必要证据与不必要证据

必要：候选/工具/hash、两个SBPL及测试收据、精确argv、全进程树、PID→exe、B层全target CDP/Playwright账本、完整PID集lsof快照、五Function逐步收据、截图hash、停止/残留/前后hash。

不必要：PF/DTrace全机抓包、系统Chrome的个人/全局updater日志、证明Chrome代码“永不产生”后台意图、重复19/19/lint/typecheck/build、重新安装依赖、重复旧截图、真实外部域名负例、浏览器或服务的第二轮运行。

## 8. P0 / P1 / P2

- P0：0。
- P1：0。当前没有证据把历史事件归因到 A/B，也没有证据表明外部连接成功或数据外发。
- P2：1。受当前权限限制，无法用 PF/DTrace证明 C 层从未产生任何外联意图；合同通过 Seatbelt阻断成功副作用，并将已阻断C尝试与A/B功能分离。此边界必须在后继报告中逐字保留。

## 9. 已验证 / 未验证

已验证：两项历史任务和机器manifest的证据边界；历史页面观察与GCM/updater污染的可归因程度；`sandbox-exec`、独立revision 1208 headless-shell及其hash、Playwright 1.58.2、SBPL精确loopback白名单的本地可行性证据；A/B/C机械归因与一次后继合同。

未验证：任何当前候选浏览器Function、页面请求、App/server连接、C层实际连接、Seatbelt完整后代覆盖运行收据、真实截图/焦点/七态/分页/safe-area。以上必须由后继测试一次执行；本任务没有运行浏览器、服务或网络探针。

## 10. 错题自检

- 没有把C层Chrome行为写成App泄漏，也没有忽略未来B层真实页面外联。
- 没有把tab-scoped CDP外推为全浏览器no-egress；Seatbelt与进程树负责成功副作用边界，CDP负责页面归因。
- 没有要求不可得的“从未产生意图”证明；明确保留C层P2/Unknown。
- 没有把环境BLOCKED计作五个Function实现P1；Function证据仍需同候选一次真实验收。
- 合同使用独立headless-shell，排除系统Chrome updater/GCM污染源。
- 没有运行浏览器、启动服务、外联、安装依赖或修改候选文件。

TASK_STATE_OK
