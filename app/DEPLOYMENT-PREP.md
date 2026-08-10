# F1+1 · 部署前准备（Deployment Prep · DRAFT）

> 状态：**部署前准备**（开发部 TASK-20260807-A55149）。本文档只做「上线前的准备」：构建/启动验证、部署配置要点、上线门禁清单与静态预览部署。**不触发任何真实外网部署**。
> 依据：`docs/spec.md` §7 技术路线、M4 安全约束 R1–R13。

---

## 0. 结论先行

- **M4 本地不部署**：运行时不依赖境外托管服务或远程密钥；真实外网上线必须由用户另行确认（运营主体、部署地域、数据区域、平台条款、容量、AI 跨境）。
- 当前可安全完成：生产构建/启动验证、部署配置整理、静态预览部署（设计草稿）。
- 正式部署前必须通过的本地验证：`npm run build` + `npm run start` 生产闭环、无外联（`external_calls=0`）、`REAL_*` fail-closed、loopback 绑定。

---

## 1. 上线前必须由用户确认的门禁（正式部署前的硬门槛）

| # | 事项 | 说明 |
|---|---|---|
| 1 | **运营主体** | 部署方是谁（个人/组织），负责对外合规与责任 |
| 2 | **部署地域** | 服务器所在地（影响数据区域、跨境与访问合规） |
| 3 | **数据区域** | 数据存储位置、是否跨境 |
| 4 | **平台条款** | 内容来源（Motorsport.com 等）与托管平台的条款遵守 |
| 5 | **容量/预算** | 实例规模、带宽、存储、成本与伸缩策略 |
| 6 | **AI 跨境/模型** | 若启用真实总结模型，数据出境与模型训练退出确认 |
| 7 | **生产存储** | 从本地 SQLite 到生产数据库（Postgres 等）的独立决策与验证 |
| 8 | **多实例/网络文件系统** | 生产多副本、文件存储一致性尚未验证 |

> 未确认前：维持 M4 本地（fixture/mock、loopback、manual_only 发布）。

---

## 2. 构建与启动验证（本地，可立即执行）

```bash
cd app
npm run verify:env        # 环境与安全配置校验（REAL_* 仅 false）
npm run db:migrate        # 只追加 migration（双 profile SQLite）
npm run seed:fixtures     # 原子幂等 seed（public-synthetic）
npm run build             # 生产构建
npm run start             # 生产启动（App Router 受控出口）
```

### 已验证（2026-08-07，Node 24.18.0 工具链）

- ✅ `npm run verify:env` → `fixture/mock/manual_only`、`externalCalls: 0`（**需干净环境**，见 §4 警告）
- ✅ `npm run db:migrate` → userVersion 3、SQLite 3.53.1、WAL、synchronous FULL、busy_timeout 250
- ✅ `npm run seed:fixtures` → `public-synthetic` / `mvp-local-v0.4` / `public-demo-12-v0.4`，12 条完整图，`syntheticOnly`、`externalCalls: 0`、`writesToBase: false`
- ✅ `npm run build` → Next 16.2.11（Turbopack）编译成功、TypeScript 通过、静态页 3/3；路由：`/`、`/api/health`、`/api/public/feed`、`/api/public/stories/[publicId]`、`/stories/[publicId]`

- 已知：`next dev` 因 Next 16 注入 `NODE_OPTIONS` 与 R1 冲突不可用于公开 API 演示；**走生产模式 `npm run start`**（此前已在本机验证 no-store 全绿）。
- 公开 HTTP 矩阵：`npm run test:public-http`（真实 HTTP、no-store 全绿）。

---

## 3. 部署配置要点

### 3.1 环境变量（部署时注入，不入仓库）

| 变量 | 用途 | 生产要求 |
|---|---|---|
| `APP_BIND_HOST` | 绑定地址 | 正式部署按 R2 从 loopback 放开到公网接口时，必须配合 HTTPS/反向代理与鉴权 |
| `NODE_ENV` | 运行环境 | `production` |
| `REAL_*`（provider/publish 等） | 真实能力开关 | 未获授权前一律 `false`（fail-closed） |
| 密钥（如 DB、平台 API） | 部署机密 | 只经部署环境/密钥服务注入，不入日志 |

### 3.2 应用服务配置

- **Next.js**：当前 `next.config.ts` 仅 `reactStrictMode + turbopack.root`。容器化部署可评估 `output: 'standalone'`（减少镜像体积），但需回归 `npm run build` 与 `npm run start` 及公开 HTTP 矩阵。
- **反向代理/HTTPS**：生产面向公网须置于 TLS 终止的代理后；CSP、`X-Content-Type-Options: nosniff`、`frame-ancestors`、referrer policy 在 R7 边界内配置。
- **缓存**：公开 feed/detail 采用 no-store（已实现并验证）；如需 CDN 缓存，必须与 no-store 语义协调，且不缓存登录/管理页。
- **外链跳转**：`前往原文` 为站外跳转，须校验 URL scheme（拒绝 javascript: 等），可选经跳转中间页。
- **图片代理**：真实图片来自外部 CDN（Motorsport）。生产如需代理，必须在 R6 边界内：仅 https、逐跳 DNS/IP pin、私网/危险协议拒绝、无默认 redirect、有限字节/时间/压缩上限；媒体拒绝 SVG/HTML/active content。

### 3.3 数据库

- 本地双 profile SQLite（`m3-shadow` / `public-synthetic`）仅供本地/测试；生产数据库（Postgres 等）需独立决策、迁移与备份策略（§1 门禁 7）。
- 每进程显式选择一个 canonical profile；`user_version` migration、WAL、备份与恢复须在生产前验证。

---

## 4. 安全与合规约束（上线前复核）

- **R2**：开发/本地绑定 loopback；公网上线须明确定义 origin（同端口 loopback 严格 http URL）、关闭 CORS、mutation 仅接受精确 Origin、GET 不变更。
- **R5**：umask 077、目录 0700、DB/WAL/SHM 0600、路径 realpath 防链接/TOCTOU。
- **⚠️ 运行环境必须干净**：进程环境含任何「禁止变量」（代理类 `HTTPS_PROXY/HTTP_PROXY/ALL_PROXY/NO_PROXY`，令牌/密钥/凭证类如 `ANTHROPIC_AUTH_TOKEN`、`BRAVE_API_KEY`、`API_KEY` 等）会被 `verify:env` 以 `ENV_FORBIDDEN` 拒绝（R1 fail-closed）。**部署容器/进程必须以最小化、干净的环境变量启动**，只注入 §3.1 清单中的变量；CI/本机若带代理或密钥变量，需在启动 app 前清理（`env -u` 或隔离容器）。
- **R12**：构建期网络仅 `npm ci`；运行时 verify/check/test/dev 无外联（`external_calls=0`）；上线前跑一次 egress 探针，外联先记脱敏安全事件再非零退出。
- **R13**：审计记录脱敏、`AuditEvent` allowlist、`additionalProperties=false`；生产保留 trace/session hash、epoch、attempt。
- **内容合规**：真实图片/内容（Motorsport.com）上线前确认来源条款与授权；`unknown` 状态不得渲染为正常启用；未审核内容不公开。

---

## 5. 静态预览部署（设计草稿，可独立上线）

- 设计草稿为**纯静态文件**：`design/ui/F1+1-v0.2-全站设计/index.html`（自包含 CSS/JS，含真实图片外链）。
- 可直接托管到任意静态托管（GitHub Pages / 对象存储 / 任意 Web Server），无后端依赖。
- 说明：真实图片来自外部 CDN，静态部署后仍可加载；草案产物标记 DRAFT，不等同于正式产品。
- 可选：加 `Content-Security-Policy` 允许 `img-src` 该 CDN 域名。

---

## 6. 上线前检查清单（Checklist）

- [ ] `npm run verify:env` 通过；`REAL_*` 全部 `false`
- [ ] `npm run db:migrate` + `seed:fixtures` 幂等可重复
- [ ] `npm run build` + `npm run start` 生产闭环通过
- [ ] `npm run test:public-http` 真实 HTTP 矩阵通过（no-store 全绿）
- [ ] `npm run check`（lint + typecheck + test）全绿
- [ ] 运行时无外联探针通过（R12）
- [ ] 用户已确认 §1 的 8 项部署门禁
- [ ] 生产数据库、缓存、图片代理、日志脱敏方案定稿
- [ ] 正式品牌/商标/授权（F1+1 暂用名）确认

---

> 边界：本文档只做本地准备与风险清单，**不代表已获部署授权**；真实上线需 §1 门禁全部确认后由用户决定。
