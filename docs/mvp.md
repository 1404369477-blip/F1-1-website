# MVP 定义

> MVP = 第一个**能真正用起来、能验证核心价值**的最小版本。
> 原则:砍到不能再砍,但砍完仍然有用。
> 本文件是 MVP 辅助说明;正式开发范围以 [spec.md](spec.md) 为准。

> 当前功能完整性与实施状态以 [初版全功能追踪矩阵 v0.1](spec/F1+1-初版全功能追踪矩阵-v0.1.md) 为唯一索引。状态只能是 `complete`、`user-gated`、`P1-blocker`；组件预留、静态分支、测试注入、占位或 `NOT_RUN` 均不代表完成。

## 这一版必须能做到(In Scope)

- 公开阅读：用户从 `/` 浏览 projection-first 中文时间线，使用分类与当前已加载条目的客户端搜索，展开单条详情，进入 `/stories/{publicId}`，并在失败时看到唯一恢复出口。
- 最终视觉与交互：高保真落实 2026-08-08 固定 HTML/hash 的深浅主题、1440/1024/390 响应式、桌面工具/Dock、设置、手风琴、0/1/4 图媒体、缩略图导航、单步手势、lightbox 和无障碍降级。
- 数据与 API：公开页面只读同一 PublishedProjection；SQLite profile、Repository、feed/detail DTO、cursor、Problem、hash/fence 和 fail-closed 规则保持单一真值。
- 本地人工审核：在用户分别批准 review-synthetic 系统 successor 与 Admin 视觉后，审核者能查看 synthetic 队列/证据、编辑中文版本、批准或拒绝，并通过第二次显式操作手动发布到同 profile 唯一投影。
- 本地采集闭环：synthetic 信源按规范化、查重、三门、五 fence 与原子 enable+queued 进入 mock 采集、整理和待审核链，失败可观察、可有界恢复且不重复业务对象。
- RSS 安全层：用户确认精确 XML 依赖后，先完成 fixture-only、zero-real-request 的解析安全 spike；真实三次固定 URL 试验继续使用独立用户问题。
- 所有实现和验收按 Function ID 拆分；每个功能都有用户入口、依赖、视觉锚点、成功/失败/恢复、Owner、证据与授权轴。

## 这一版明确不做(Out of Scope,留给后续)

- 未经单独授权，不发真实 RSS/X/Instagram/Reddit 或其他平台请求，不启用真实 Base/provider/Collector，不提交真实表单。
- 不下载、代理、缓存或公开展示未经权利与安全门禁的真实媒体；当前多图 successor 只用本地 synthetic 资产。
- 不自动批准、批准即发布、自动发布或批量发布；本地审核保持人工决定与第二次显式手动发布。
- 不部署、不付费、不外发，不开放生产认证、跨网络 Admin、生产数据库或公网后台。
- 不增加第二业务真值、Gallery/PublicStory/平行媒体表、静态 Demo fallback 或从前端状态反写领域状态。

## 验收标准(怎么算 MVP 做完了)

- [ ] 矩阵中全部 `LOCAL-CONFIRMED` 行达到 `complete`，且每项绑定正式可达用户出口和独立证据；零 `P1-blocker`。
- [ ] 公开页关闭 `34476E` 的三项 P1：React #418、lightbox 焦点返回、正式 0/1/4 图数据出口；七类故障态与 AT/200%/forced-colors/reduced-transparency 也完成证据。
- [ ] 已 ACK 的 33B8F5 多图机器包保持 v0.4 零漂移；后继 55302B 与实施任务让 0/1/4 图经独立 profile、唯一领域链和显式版本协商到达正式 App，前端无复制或测试注入。
- [ ] Admin 两个用户门禁获批后，revision/approve/reject/manual publish/reconcile 的完整本地 synthetic 链经测试和安全 PASS；若用户拒绝，相关行继续 `user-gated`，不得冒充 MVP 已完成。
- [ ] RSS 依赖与真实请求分别取得对应用户确认后才执行；只批准依赖时仍保持真实请求=0。
- [ ] 真实外部、自动发布和部署门禁继续关闭，不影响本地 MVP 对其状态作如实标记。

## 已知妥协 / 临时方案

- `public-synthetic` 与后继 `review-synthetic` 只用于本地验证，不替代 Base 业务真值或生产存储。
- 当前媒体先使用本地 synthetic presentation；真实媒体需要独立权利、代理/自托管和安全决策。
- Admin 仅 loopback local-dev；生产登录、角色和跨网络访问留到生产门禁。
- RSS 先做 disposable fixture spike；它不会证明真实来源权利、稳定性或生产容量。
- 任何妥协都不能删掉已确认的初版用户出口；无法实现时在矩阵标 `P1-blocker` 并保留恢复方案。

---
关联文档:[总览](overview.md) ·[路线图](roadmap.md)
