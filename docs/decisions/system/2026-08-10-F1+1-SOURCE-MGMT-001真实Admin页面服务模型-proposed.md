---
title: F1+1 SOURCE-MGMT-001 真实 Admin 页面服务模型候选合同
date: 2026-08-10
status: proposed
decision_id: ADR-M5-SOURCE-MGMT-PAGE-SERVICE-001
task_id: TASK-20260810-8A055D
function_id: SOURCE-MGMT-001
decision: B
implementation_authorized: false
external_calls: 0
---

# F1+1 SOURCE-MGMT-001 真实 Admin 页面服务模型候选合同

## 1. 结论和现行边界

唯一推荐为 **B：受控 Next 统一页面/API**。其精确含义是：在 `source-management-synthetic` profile 中，由一个 Node 24 进程创建唯一 `node:http` server，原始请求守门先于 Next 处理器执行，随后将同一个已通过守门的 `IncomingMessage/ServerResponse` 交给同进程 Next production request handler。真实 `/admin/sources` 页面、同源 `/api/admin/*`、`/api/health` 与闭合静态资产集合共用一个 loopback origin。

本候选合同不修改已 accepted 的 M4 核心 ADR，也不放宽 SOURCE-MGMT v0.3 安全合同。它只将“Next App Router + 单 Web 进程”与已有 raw authority 接成一个可实施的页面服务模型。

当前实施仍关闭：

- `TASK-20260810-91AF6E` 仍为 `queued`，后端 typecheck/build/HTTP/closed receipt 未闭合；
- v2 视觉冻结 manifest 仍为 `implementation_authorized=false`，用户视觉方向未确认；
- 真实 provider、飞书 Base、真实数据、Admin 生产访问、部署与非 loopback 外部 I/O 持续 closed。

## 2. 输入收据与可验证事实

| 输入 | SHA-256 / 状态 | 本合同用法 |
|---|---|---|
| `docs/spec/F1+1-SOURCE-MGMT-001本地synthetic信源管理纵切实现合同-v0.3.md` | `90ee4ed30d325b7b2833582cc0ac8134aefc7fbc2dcd43ec9d20c0f726b2f1fe` | raw authority、session/CSRF、identity、命令、状态与恢复权威 |
| v0.3 安全复验报告 | `495bcf8a670cf275c88a67056370e62ec238fc5b38e3a3165dfbb82f3c8ebc6d`，PASS | 安全下界；不由页面层放宽 |
| v2 视觉冻结 manifest | 文件 SHA `7686511f56f65ca5838ee9c907a24ac930d92974397d9b398d0d9ac90495f155`；`implementation_authorized=false` | 页面视觉唯一候选身份集 |
| 开发部现有代码落点勘察 | `6a437f3c5b5fb8b10687c11276b72f4e015681d2c6cf0ca8e73f2aacda0fdb5c` | 现有文件与风险输入；其时态为历史快照 |
| F213DE 安全诊断 | `745ddde6a5d5da108d9a3ef80eb689946a094cb3ab48ef6e591d47a2f7b2757f`，ACK/PASS | exact numeric loopback 监听和 no-egress 启动边界 |
| `TASK-20260810-91AF6E` | `queued` | 开发前置门；完成并经测试/安全 ACK 前不进入页面实施 |

当前代码事实：

- `app/scripts/serve.ts` 在 source profile 中直接启动 `runSourceManagementServer`，不启动 Next；
- `app/src/server/source-management/server.ts` 为唯一 raw `node:http` 服务器，在读 body 和路由前执行 `assertRawAdminRequest`；
- `app/src/app/api/admin/**/route.ts` 已有 Admin Route Handler 落点，但当前 source profile 不会到达 Next；
- `app/src/app/(admin)/` 当前只有 `.gitkeep`，无真实 `/admin/sources` 页面。

因此，只新增 App Router page 会得到“存在但运行时不可达”的孤立产物，不构成 `SOURCE-MGMT-001` 真实用户出口。

## 3. A/B/C 唯一裁决

| 方案 | 结论 | 核心理由 |
|---|---|---|
| A：raw server 同进程自包含 Admin shell | 不选 | 需在 Next App Router 之外建立第二套 HTML/CSS/JS 组装与资产规则，容易形成第二前端真值、静态 Demo 漂移和重复的 CSP/cache/资产验收合同。v2 视觉文件只是冻结候选证据，不是可直接部署的 shell。 |
| **B：受控 Next 统一页面/API** | **唯一推荐** | 复用 accepted M4 的 Next App Router + 单 Web 进程，保留 raw server 为唯一 listener 和 authority owner；页面、API 与闭合资产集合同源，同一数据库和 repository。 |
| C：其他模型 | 不选 | 未找到比 B 更小且同时满足 raw-before-framework、单进程/单端口/单 writer 的第三模型。sidecar、内部第二端口、反向代理、孤立 Next 页面和静态假数据页均违反任务硬门。 |

## 4. 实施拓扑和不变量

### 4.1 唯一拓扑

```text
Browser (same exact loopback origin)
        |
        v
one node:http Server / one numeric loopback port
        |
        +-- raw request gate (before body read and before Next normalization)
        |
        +-- AsyncLocal raw authority context
        |
        +-- same-process Next production request handler
                 |-- GET/HEAD /admin/sources
                 |-- /_next/static/<manifest allowlist only>
                 |-- /api/health
                 `-- /api/admin/*
                        |
                        `-- one initialized source runtime
                               `-- one SQLite handle / one writer / one profile lock
```

运行期必须同时满足：

1. 一个 Node 进程，不孕生 Next child process，不启动 sidecar、worker thread 或独立 proxy；
2. 一个 `source-management-synthetic` profile，一个 profile lock，一个 SQLite DB handle，`writer=1`；
3. 一个数字 loopback listener，一个端口，不建立 Next internal port；
4. raw gate 是唯一 authority owner；Next middleware、Route Handler 或 Client Component 不能重新定义 raw authority；
5. repository/session store/runtime 只初始化一次，页面 Route Handler 复用同一 singleton；
6. server 进程无 DNS、无出站 `net/http/https/fetch`、无子进程，`external_calls=0`；
7. 真实运行只使用 production build。开发热更新所需的额外端口、WebSocket 或宽 CSP 不得进入候选证据。

### 4.2 启动顺序

1. 在受控、无网构建阶段使用现有 Node `24.18.0`、lockfile 和 `next build`；不在 runtime 内执行 `npm ci` 或依赖下载。
2. 生成 closed page-service manifest，至少含 candidate root、package-lock SHA、Next build id、精确 route 集、资产相对路径/SHA/size/MIME、server module root、v0.3 SHA、v2 视觉 manifest SHA。
3. runtime 启动时在打开 SQLite 和监听前验证 manifest、构建字节、symlink/hardlink、文件权限与 profile receipts；任一不可证即 fail closed。
4. 安装 no-egress guard，然后初始化同进程 Next handler 和 source runtime，最后调用 F213DE 规定的 exact numeric loopback listen。
5. Next handler 初始化若尝试 child process、worker thread、DNS、出站 socket、第二 listener，或 raw context 不能穿过 Route Handler，立即停止，不回退到 A、sidecar 或双端口。
6. 启动任一阶段失败时：`ready=false`，停止 accept，关闭已有连接和 Next handler，关闭 DB，释放 profile lock，最后 restore guard；清理后仍发现进程/端口/lock/WAL/SHM 残留则候选 FAIL。

## 5. route、资产与同源 API

### 5.1 closed allowlist

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET/HEAD` | `/admin/sources` | 真实 Admin shell；首屏不嵌入业务数据、session、CSRF 或 secret |
| `GET` | `/api/health` | 已有 readiness 收据 |
| `GET/POST/DELETE` | `/api/admin/session` | 查询/占用/销毁 local session |
| `POST` | `/api/admin/session/refresh` | 会话续期 |
| `POST` | `/api/admin/csrf` | 绑定 method/path/body hash 的 nonce |
| `GET/POST` | `/api/admin/sources` | 列表/新增 |
| `GET` | `/api/admin/sources/{sourceId}` | 读取详情 |
| `POST` | `/api/admin/sources/{sourceId}/{validate|activate|stop|retire|requeue}` | 六操作中的状态变更命令 |
| `GET` | `/api/admin/operations/{commandOperationId}` | response unknown 后的同 operation 对账 |
| `GET/HEAD` | `/_next/static/<exact manifest member>` | 仅限冻结的 hashed JS/CSS/font 资产 |

以下一律 fail closed：不在 manifest 的 `/_next/*`、source map、`/`、`/stories/*`、`/admin/reviews`、`/api/public/*`、任意其他路由；`OPTIONS` 不作为 CORS 出口；source 物理 `DELETE`和通用 `/retry` 不存在。

### 5.2 raw authority 顺序

每个请求的唯一顺序为：

1. 在 `IncomingMessage` 原始字节上校验 peer、raw target、HTTP/1.1、唯一 Host、精确 Origin 与 proxy header=0；
2. 把校验结果放入 `AsyncLocalStorage` raw context；
3. 同一请求交给 Next handler；
4. Route Handler 先检查 raw context 存在且 `rawPath === exactPath`，再调用现有 Admin handler/runtime。

缺 raw context、路径正规化前后不一致、重复/模糊 header、encoded slash/backslash/dot segment、非数字 loopback host 或任一代理头均在 Next 处理之前拒绝。

## 6. page bootstrap、session 和 CSRF

### 6.1 首屏

- HTML shell 只包含布局和无敏感 loading/locked/error 文案，不用 server component 直读 SQLite，不把 Source 行、session、CSRF、operation 或内部 reason 写入 HTML/React payload。
- 客户端首先 `GET /api/admin/session`。未占用时用精确 Origin 与 canonical `{}` 执行 `POST /api/admin/session`；成功后只使用 `HttpOnly` cookie。
- 会话已被其他浏览器占用且本浏览器无 cookie 时显示可恢复 locked/409，不提供抢占或隐藏绕过。
- session active 后才 `GET /api/admin/sources`。客户端不直连 DB，不从静态 JSON 补齐59条。

### 6.2 mutation 唯一顺序

1. 冻结 command-independent 业务输入；
2. 生成 command `operation_id/idempotency_key` pair；
3. 组装完整 closed DTO，以 `canonical-json-v1` 得到最终 bytes/body hash；
4. 为精确 method/path/body hash 申请一次性 CSRF nonce；
5. 提交完全相同的 bytes、nonce 和 cookie。

表单、identity、command pair 或 bytes 任一变化都丢弃未消费 nonce，从第1步重走。响应丢失时只用同 `commandOperationId` 查询 operation receipt，不盲目生成新命令重试。session/CSRF/command identity 不写 DOM、URL、localStorage/sessionStorage、日志或静态资产。

## 7. CSP、cache 与资产安全

- HTML/API/operation/health：`Cache-Control: no-store, private`、`Pragma: no-cache`。
- 仅 manifest 内的 content-hashed JS/CSS/font：`Cache-Control: private, max-age=31536000, immutable`；不得含业务数据、secret 或 source map。
- HTML CSP 使用每请求 CSPRNG nonce，最小候选是：`default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; script-src 'self' 'nonce-<request>'; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; media-src 'none'; worker-src 'none'; manifest-src 'none'`。
- 禁止 `unsafe-eval`、外部 origin、运行期 CDN/字体/图像请求。若 Next production build 无法在不放宽 CSP 的条件下运行，本候选停止。
- 统一加 `Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`、关闭无关 `Permissions-Policy`，不开 CORS。

## 8. Function ID、状态与双端等价

不新增平行 Function ID。唯一 Function ID 仍为 `SOURCE-MGMT-001`，实施和验收必须一次覆盖：

- 59 条冻结 baseline 只读、默认 disabled，不显示 mutation 控件；
- 新增、validate/revalidate、activate、stop、retire、dead-letter requeue 六类操作；
- loading、filter-empty、partial、error、locked/guard shell、conflict/stale、blocked、dead-letter、active、stopped、response-unknown 状态；
- 错误态保留已加载的安全数据，给出唯一 recovery action；不以自动重试隐藏 unknown、CAS 冲突、门禁失败或 dead letter。

Mac 和 iPhone 功能集合等价：同一 API、同一 command controller、同一状态和 recovery receipt；1440/1024 可使用表格+抽屉，390 可使用卡片+全屏详情，不得删除操作或隐藏失败出口。

当前 exact loopback 合同不支持物理 iPhone 访问 Mac 的 `127.0.0.1`。390 证据只能由同一运行候选的受控浏览器 viewport 生成，它证明响应式功能等价，不证明真实 iPhone 网络可达。物理 iPhone 证据继续依赖后续私有访问/部署门禁。

## 9. 现有文件落点与最小开发切片

### DEV-PAGE-00：两个前置门

只读确认：

1. `TASK-20260810-91AF6E` completed 且经统筹 ACK，同一后端候选的测试/安全证据为 PASS；
2. 用户对 SHA `7686511f56f65ca5838ee9c907a24ac930d92974397d9b398d0d9ac90495f155` 的 v2 视觉 manifest 给出明确确认。

任一未满足，页面代码、CSS 和运行接线保持 closed。

### DEV-PAGE-01：同进程 page-service adapter

允许的文件边界：

- 新建 `app/src/server/source-management/page-service.ts`：程序化 Next production handler、闭合 route/asset allowlist、CSP nonce、清理钩子；
- 新建 `app/src/server/source-management/page-service-manifest.ts`：manifest 闭集 validator；
- 最小修改 `app/src/server/source-management/server.ts`：在现有 raw gate 后将已授权请求交给 page-service，保持唯一 listener/lifecycle；
- 最小修改 `app/scripts/serve.ts`：source profile 仍只走一个进程分支，禁止复用当前 `NEXT_INTERNAL_PORT=3001` child/proxy 路径。

### DEV-PAGE-02：真实页面

允许的文件边界：

- `app/src/app/(admin)/admin/sources/page.tsx`；
- `app/src/app/(admin)/admin/sources/SourceManagementClient.tsx`；
- `app/src/app/(admin)/admin/sources/source-management.module.css`；
- 只在已有 `app/src/app/api/admin/**/route.ts` 中修正经独立证明的 raw-context/DTO 接线错误，不改 v0.3 命令、业务、task 或 lease identity。

### DEV-PAGE-03：构建清单和收据

- 生成 `app/evidence/source-management/page-service-manifest.json`，精确绑定同一候选的文件 root、build id、资产 allowlist 和两个前置门收据；
- 只运行一个固定 production 服务实例，同时验证页面、API、资产、raw gate、session/CSRF、六操作和恢复；
- 候选失败不得用第二进程/端口、静态回退页或放宽 no-egress 转成 PASS。

## 10. 独立验收出口

### 10.1 开发候选收据

- Node `24.18.0`、package-lock SHA、candidate root、Next build id、page-service manifest SHA 可复算；
- 进程=1、listener=1、port=1、profile=1、DB handle=1、writer=1；child/worker/proxy/internal port=0；
- `external_calls=0`、DNS=0、非 loopback socket=0；
- `/admin/sources` 与全部 allowlisted API 真实可达，不是静态假数据；
- 清理后进程/端口/profile lock/WAL/SHM/临时 secret=0。

### 10.2 六格视觉与交互证据

必须从同一运行候选生成 `1440 / 1024 / 390 × dark / light` 六格。当前 v2 只冻结了 1440 和 390 深浅候选，没有 1024 运行证据；冻结 PNG 不能替代真实页面验收。

六格在同一 candidate root 上覆盖：59条基线、六操作、loading/empty/partial/error/locked/conflict/stale/blocked/dead-letter/unknown、键盘全链、触控、200% zoom、forced-colors、reduced-motion、safe-area、水平区域焦点与 sticky action。

### 10.3 测试/安全/设计独立门

- 测试：同一候选的端口、raw negative vectors、session/CSRF、六操作、response unknown、启动/清理失败、route/asset allowlist、六格交互证据全部 PASS。
- 安全：raw-before-Next、single process/profile/DB/writer、exact loopback、no-egress、CSP/cache、secret 与日志、启动/停止反向证据 PASS。
- 设计：对 v2 冻结候选与真实运行候选进行 1440/1024/390 深浅与状态/交互逐项对照，P0=0/P1=0。

只有三路绑定同一 candidate root 并经统筹 ACK 后，`SOURCE-MGMT-001` 才可从 `P1-blocker/user-gated` 进入 complete 评估。

## 11. 现行用户门禁和回退

视觉门禁仍只绑定 v2 冻结 manifest。未来交由用户的精确问题是：

> 是否确认 SHA-256 为 `7686511f56f65ca5838ee9c907a24ac930d92974397d9b398d0d9ac90495f155` 的 SOURCE-MGMT-001 v2 视觉冻结 manifest，允许开发部在 `TASK-20260810-91AF6E` 及其独立测试/安全门通过后，按本 proposed B 合同实现本地 `/admin/sources`？

未确认默认为拒绝实施。即使确认，也只授权本地 synthetic 页面候选；不授权真实 provider/Base/真实数据、公网 Admin、部署、自动发布或非 loopback 外部 I/O。

实施失败时回退到当前 raw backend-only 候选和本合同前的文档态；不保留不可达 Next page、静态 Demo、第二 listener 或已放宽安全配置。

三个失败出口保持闭合：

| 失败条件 | 唯一出口 |
|---|---|
| 同进程 Next handler 无法在单 listener/raw-before-Next/no-egress 下成立 | block，回传第一个可复现冲突；不启用 sidecar、第二端口/进程或 A 回退 |
| 实施要求改 accepted ADR、放宽安全合同、新增依赖或外部能力 | 停在 proposed，只列最小差异和一个精确用户问题，不自行接受 |
| v2 视觉未确认或 91AF6E/独立测试安全未闭合 | implementation closed；只保留本候选合同，不写 UI/CSS/page 或运行接线 |

## 12. 已验证、未验证与错题自检

### 已验证

- 任务指向的 v0.3、安全复验、v2 manifest、BDBD33/F213DE/91AF6E 状态与现有代码落点已只读核对；
- source profile 当前只启动 raw server，Next App Router 中已有 Admin API route 但无 `/admin/sources` page 且运行时不可达；
- B 可在不新增进程、端口、profile、DB、writer、依赖或外部能力的产品边界下形成唯一实施候选。

### 未验证

- 当前 Next 16.2.11 production handler 在该 no-egress guard 下能否不产生 child/worker/DNS/第二 listener；
- CSP nonce 在该精确 production build 上能否在零 `unsafe-eval`/零外部 origin 条件下通过；
- 91AF6E 后端收据、用户视觉确认、页面实现、1440/1024/390 深浅和物理 iPhone 访问均未完成。

### 错题自检

- 未把孤立 App Router page 写成真实运行出口；
- 未使用 sidecar、第二端口/进程/writer、静态假数据或 raw gate 绕过；
- 未将 v2 设计冻结、91AF6E queued 或 proposed 合同外推为实施完成；
- 未修改 app、data、design、Spec 或 accepted ADR；
- 未新增真实账号、数据、provider、Base、部署或外部 I/O 授权。
