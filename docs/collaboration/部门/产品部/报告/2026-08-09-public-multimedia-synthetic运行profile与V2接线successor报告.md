---
type: work_report
status: completed
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-55302B
decision: ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001
scope: 只固化本地 synthetic 运行 profile 与 V2 接线合同；不改 app/data/migration/DB/design
---

# `public-multimedia-synthetic` 运行 profile 与 V2 接线 successor 报告

## 1. 结论

产品部已在用户既有多图确认范围内接受独立 `public-multimedia-synthetic` 运行路线。canonical 决策为 `ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001`；它只修订 M4 accepted 公开读路线中的 profile allowlist、独立 scoped migration、显式 V1/V2 协商和最终 App V2 接线，不改写 `m3-shadow`、`public-synthetic` 或 v0.3/v0.4。

当前只完成产品/系统合同。第三 SQLite、migration、runtime graph、Repository/API/App 和浏览器收据均未创建；四个媒体 Function ID 继续 `P1-blocker`。

## 2. 交付物

1. `docs/decisions/system/2026-08-09-F1+1-public-multimedia-synthetic运行profile与V2接线-successor-accepted.md`
2. `docs/spec/F1+1-public-multimedia-synthetic本地运行实施合同-v0.1.md`
3. `docs/decisions/system/2026-08-09-F1+1-公开多媒体数组successor实施合同-draft.md` 的 successor 指向
4. `docs/spec/F1+1-初版全功能追踪矩阵-v0.1.md`、`docs/spec.md`、`docs/spec/README.md` 的 canonical 引用
5. 本报告。

## 3. 核心 accepted 合同

- profile：`public-multimedia-synthetic`；DB：`app/.local/f1plus1-public-multimedia-synthetic.sqlite`。
- migration：精确复用 canonical 0001/0002，第三条使用 profile-scoped 0003；禁止旧新 0003 同选和全局 0004 误升级旧 profile。
- seed：完整闭图与 ledger 在一个事务写入，关闭写连接后独立重读复算，再原子启用 canonical DB。
- runtime：一进程一 profile 一 DB；无 ATTACH、跨库、复制、导入、双读或运行时切换。
- API：默认 V1；精确 V2 Accept 才返回数组；未知/多值/参数化版本 406，完整性错误 500，feed/detail/related 单响应不混版。
- App：只消费 V2 数组一一映射；0/1/4 正式可达，禁止复制首图、静态数组、测试注入或 placeholder 扩写。
- 回退：完整切回可证明的 v0.4 App+`public-synthetic` 配对；无 down migration、无静态 fallback。

## 4. 发现并关闭的合同缺口

33B8F5 已 ACK 的五个 artifact 精确冻结了媒体 delta、DTO、hash/rights/order、V1/V2 和 0/1/4 预期，但当前 fixture 没有可直接 seed 的 Source/CapturedItem/Content/Summary 完整行。产品合同没有让开发猜字段或从旧数据库补齐，建立了 `DATA-MM-01`：数据部须在同一 v0.5 目录追加完整 runtime graph、counts、manifest/root 与两次确定性 validator 收据，只复用既有实体和 schema。

该前置不改变已 ACK artifact，也不引入第二领域合同。缺失时第三 profile ready=false，开发存储阶段不得开始。

## 5. 已验证

- 33B8F5 任务与数据报告为 ACK/PASS；v0.5 schema/mapping/fixture 五个 artifact hash 与 manifest 逐字匹配。
- canonical 0001/0002 当前 SHA-256 已复算并写入 accepted 决策；旧 0003 SHA 只作为冻结证据，不被新 profile 复用。
- v0.4 manifest/fixture、public-synthetic ledger/graph 与 M3 e7a8 冻结根已逐字写入零漂移门禁。
- accepted 合同只新增一个 profile，不新增领域实体、第二 Publication/Projection、Gallery、PublicStory 或平行媒体表。
- V1/V2 的 Accept、406/500、0/1/4、state 优先级、App 单一数据源、失败与完整回退均有机械出口。
- 外部能力、真实媒体、Base/provider、Admin、RSS、自动发布、部署和付费继续关闭。

## 6. 未验证

- `DATA-MM-01` 完整 runtime graph 尚未生成。
- 新 scoped 0003、selector root、schema fingerprint、SQLite/ledger/seed 尚未实现。
- Repository/API/App V2 接线与 0/1/4 production 浏览器交互尚未运行。
- 测试、安全、设计尚未绑定实现候选复验；Function ID 状态未升级。

## 7. 错题自检

- 没有把 33B8F5 数据机器 PASS 外推成可 seed 完整数据库或 App 完成。
- 没有复用旧 0003、追加会误跑旧 profile 的全局 0004，也没有原地升级 `public-synthetic`。
- 没有用跨库读取、复制旧 DB 或双 profile 运行补齐新 profile。
- 没有用前端静态四图、首图复制、测试拦截或组件分支关闭 P1。
- 没有把 accepted 架构决策写成实现、测试、安全、设计或生产放行。

## 8. 对抗审查

三路只读聚焦审查最终均为 `P0=0 / P1=0`：

- 产品审查确认 canonical 入口已唯一切到 accepted ADR；33B8F5 只关闭 DTO/delta，DATA-MM-01 和四个 P1 的时态、Owner 与派发出口一致。
- 领域审查推动并确认 Content→MediaCandidate 一对多、数据库 0–4 trigger/第5行拒绝、完整 runtime graph、migration ledger 映射和 root 公式闭合；manifest 无自哈希，单一 Publication/Projection 不变。
- 安全审查确认 Accept 输入全域闭合、每请求/完整响应单版本；旧库 closed receipt 绑定 checkpoint 后 DB SHA、WAL/SHM=0、revision/validator/time，launcher 无 SQLite handle 复核当前字节；no-egress 与完整组合回退闭合。

审查只覆盖本任务产品/系统文档，没有修改 App、data、migration、DB、design 或外部资源。
