# 路线图 / 里程碑

> 当前产品真值以 [spec.md](spec.md) 为准；路线图只表达阶段与验收状态。

## 当前阶段

🔴 **M6 · 固定 M1 生产恢复与持续采集重建** —— Public Beta 已部署并有 2026-08-29 公网 HTTP 200 证据；生产 DB 已到 schema10。持续采集当前受 verified recovery point 缺失、recovery/global-stop 围栏、RSS identity 占位值和旧 LaunchAgent 阻断。27个X账号已完成一次只读页面验收，生产 registry 和 worker 尚未落地。当前唯一执行顺序见 [当前生产状态与执行待办](当前生产状态与执行待办.md)。

## 里程碑一览

| 里程碑 | 目标 | 做完的标志 | 状态 |
| --- | --- | --- | --- |
| **M0 地基** | 仓库结构、文档骨架、AI 工作入口 | 三大文件夹、Spec、Agent 规则和 git 安全网就位 | 🟢 已完成 |
| **M1 Spec v0** | 明确问题、用户、场景和边界 | 产品目标、MVP 与不做什么写入 Spec | 🟢 已完成 |
| **M2 风险检查** | 识别数据、平台、权限、UI 和安全风险 | 研究/安全/测试报告与门禁形成 | 🟢 已完成 |
| **M3 Spec v1 / 影子验证** | 固化 accepted 产品核心与影子证据 | A→D、公开读模型、M3 59×39 与数据合同获得收据 | 🟢 已完成 |
| **M4 Kickoff** | 初始化本地工程与受控运行地基 | Node24、lock、SQLite 双 profile、migration/seed/启动门禁通过 | 🟢 已完成 |
| **M5 Build Loop** | 小步实现本地 MVP | 每个切片经过合同、实现、独立验收和状态同步 | 🟢 已进入生产候选阶段，历史缺口仍按任务收敛 |
| **M6 公开部署与生产恢复** | 固定 M1 公开运行、可恢复性与持续采集 | Public可用、verified备份、RSS自然周期、人工审核发布和监控闭环 | 🔴 受阻，正在恢复 |
| **M7 X与完整Admin运营** | 27个X低风险持续采集、双语链和双端Admin | X灰度扩容、内容持续更新、Mac/iPhone完整运营与告警 | 🟡 已规划，待前置门 |

## 当前生产切片

| 切片 | 当前事实 | 下一验收出口 |
| --- | --- | --- |
| Public Beta | M1 candidate-v10已部署，最近公网200；Quick Tunnel地址可变 | 现场验证当前URL、home/health/feed并保持LKG |
| Schema10 与备份 | DB基础一致性可读；verified recovery point为0，Backup V2审查BLOCK | `TASK-20260829-FCC322` 关闭P0/P1并形成可恢复点 |
| RSS持续采集 | 四源registry存在；旧collector/refiner未加载，control fenced | `BBFF2A` 关闭恢复门；`082F2C` 完成两源canary与两个900秒周期 |
| X信源 | 用户选定27个X+1条Sky RSS；27/27当次页面可读 | `0ED611` 收敛registry、三源canary和分批扩容 |
| 双语/Public/Admin | 大量候选代码与局部生产UI存在；完整生产链收据不足 | `E59ACA` 关闭新内容双语→人工审核→公开投影及双端Admin监控 |

## 当前关键动作

- [ ] 修复 Backup V2 的八项阻断并完成独立复审。
- [ ] 形成 verified/off-host/encrypted/restore-drilled recovery point，证明 RPO≤900秒。
- [ ] 通过合法 control 与真实 identity hash 关闭 schema10 RSS 恢复门，生成新 LaunchAgent候选。
- [ ] 只对 Motorsport/The Race 执行单次 canary，再观察两个自然900秒周期。
- [ ] 把旧59条收敛为27个X账号与1条Sky RSS，先3源低风险灰度。
- [ ] 打通新内容双语详细提炼、人工审核发布、签名投影和公开中/EN切换。
- [ ] 将完整Admin监控部署为真实Mac/iPhone页面，并验收状态、日志、流量、API、信源、备份、成本和告警。

> 状态图例：⚪ 未开始 · 🟡 进行中 · 🟢 已完成 · 🔴 受阻

---
关联文档：[总览](overview.md) · [MVP](mvp.md) · [Spec](spec.md) · [进度](progress.md)
