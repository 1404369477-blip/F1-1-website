# 路线图 / 里程碑

> **2026-09-06 08:13–08:25 只读回扫覆盖**：生产备份当前故障，`backup-snapshot` 最近 exit=1，遗留锁 `STALE_LOCK` 持续阻断；最新本地快照为 9 月 5 日 14:37，最新已登记恢复点为 9 月 1 日 08:13（北京时间）。不能继续以“已上线 / fence=true”宣称当前 RPO 合格。公开 reader 可用、三源最近采集槽成功；cutoff 后待审核已增至 40 条。当前优先级为恢复备份与登记链，再收敛任务合同及新稿持续链。详见 [本轮审计与推进方案](reviews/2026-09-06-整体回扫与推进方案.md)。本地缺陷修复未部署，TASK 状态未升级。

> 当前产品真值以 [spec.md](spec.md) 为准；路线图只表达阶段与验收状态。

## 当前阶段

🔴 **M6 · 固定 M1 生产恢复与持续采集重建** —— Public Beta 已部署，2026-09-05 现场 home/health/feed=200 且公开 generation **201**（含 Sky Sports F1）。SNAP 15分钟备份与恢复点登记已上线。Admin / 公开 / `:3102` 均 `1408`；collector/refiner 仍钉 `0145` + `1408` opener。签名 caps 仍关。`AC5CC2` JSON 尚未核收 complete。X 27账号仅完成一次只读页面验收。现行任务归类见 [当前工作分工与交接](collaboration/当前工作分工与交接.md)；运行钉见 [当前生产状态与执行待办](当前生产状态与执行待办.md)。

## 里程碑一览

| 里程碑 | 目标 | 做完的标志 | 状态 |
| --- | --- | --- | --- |
| **M0 地基** | 仓库结构、文档骨架、AI 工作入口 | 三大文件夹、Spec、Agent 规则和 git 安全网就位 | 🟢 已完成 |
| **M1 Spec v0** | 明确问题、用户、场景和边界 | 产品目标、MVP 与不做什么写入 Spec | 🟢 已完成 |
| **M2 风险检查** | 识别数据、平台、权限、UI 和安全风险 | 研究/安全/测试报告与门禁形成 | 🟢 已完成 |
| **M3 Spec v1 / 影子验证** | 固化 accepted 产品核心与影子证据 | A→D、公开读模型、M3 59×39 与数据合同获得收据 | 🟢 已完成 |
| **M4 Kickoff** | 初始化本地工程与受控运行地基 | Node24、lock、SQLite 双 profile、migration/seed/启动门禁通过 | 🟢 已完成 |
| **M5 Build Loop** | 小步实现本地 MVP | 每个切片经过合同、实现、独立验收和状态同步 | 🟢 已进入生产候选阶段，历史缺口仍按任务收敛 |
| **M6 公开部署与生产恢复** | 固定 M1 公开运行、可恢复性与持续采集 | Public可用、verified备份、RSS自然周期、人工审核发布和监控闭环 | 🔴 备份门已过；cutoff allowlist 已 sidecar 上站（含 Sky）；`AC5CC2` JSON 未核收 |
| **M7 X与完整Admin运营** | 27个X低风险持续采集、双语链和双端Admin | X灰度扩容、内容持续更新、Mac/iPhone完整运营与告警 | 🟡 已规划，待前置门 |

## 当前生产切片

| 切片 | 当前事实 | 下一验收出口 |
| --- | --- | --- |
| Public Beta | M1 `1408` 已部署，播 generation **201**（含 Sky）；Quick Tunnel 地址可变 | 现场验证当前 URL、home/health/feed；后续新稿仍要 fence + sidecar 发布 |
| Schema10 与备份 | SNAP已上线；fence true；恢复点周期续登记 | 保持LaunchAgent健康；下次release把登记CLI纳入生产树 |
| RSS持续采集 | control=`live/clear/ready`；collector/refiner 钉 `0145` + `1408` opener；0012 Sky 已 apply 且已上公开站 | `AC5CC2` 按合同口径核收两个自然 900s（JSON 仍勿 complete）；新稿 fence/refine/sidecar |
| X信源 | 用户选定27个X+1条Sky RSS；27/27当次页面可读 | `0ED611` 已blocked；registry生产写与真实X canary分别取用户确认 |
| 双语/Public/Admin | 大量候选代码与局部生产UI存在；完整生产链收据不足 | `E59ACA` 关闭新内容双语→人工审核→公开投影及双端Admin监控 |

## 当前关键动作

- [x] 以 SNAP 快照轮转替代 Backup V2 增量候选，形成 verified/off-host/encrypted/restore-drilled recovery point（RPO≤900 秒），并由 LaunchAgent 续登记。
- [x] 通过合法 control 与真实 identity hash 关闭 schema10 RSS 恢复门（0011 apply、`--until ready`、新 LaunchAgent 候选）。
- [ ] 只对 Motorsport/The Race 执行单次 canary，再观察两个自然900秒周期（canary 已成功；现场已有多个三源自然槽；JSON 仍勿 complete）。
- [ ] 把旧59条收敛为27个X账号与1条Sky RSS，先3源低风险灰度。
- [ ] 打通新内容双语详细提炼、人工审核发布、签名投影和公开中/EN切换（cutoff allowlist sidecar 已通且 Sky 已上站；后续新稿仍缺 fence/周期审核）。
- [ ] 将完整Admin监控部署为真实Mac/iPhone页面，并验收状态、日志、流量、API、信源、备份、成本和告警。

> 状态图例：⚪ 未开始 · 🟡 进行中 · 🟢 已完成 · 🔴 受阻

---
关联文档：[总览](overview.md) · [MVP](mvp.md) · [Spec](spec.md) · [进度](progress.md)
