# 自动化部（M1运行办公室）当前状态

更新时间：2026-09-05 21:17（Asia/Shanghai）

> 运行钉以 [`docs/当前生产状态与执行待办.md`](../../../当前生产状态与执行待办.md) 为准。本文件只给人看摘要；超过当班后必须现场回读 LaunchAgent / sqlite / `active.json`。
> 2026-08-14/15 的 RSSHub、60 秒 automatic review tick、无 SNAP 等旧观察已失效，不要当现行能力。

## 治理登记

- `auto` 已通过受管 add-role 事务登记。真实 M1 Codex 会话 ID 当时未登记；这不阻断当前生产 sidecar。
- 任务协议：只续 `TASK-20260831-AC5CC2`（`claimed / user_confirmed`）。不要 complete。

## 已核实运行能力（2026-09-05 21:17 现场）

- Admin `:3101` = `candidate-v10-20260905-1408`。
- Public `:3000` 与投影 `:3102` = 同一 `1408`。公开 pointer generation **201**，`dataGate=accepted-public-real-snapshot`，首页含 Sky Sports F1。
- collector / refiner WorkingDirectory = `candidate-v10-20260901-0145`；opener 读 `1408`。`StartInterval` collector 900s / refiner 120s。周期之间 collector `not running` 是正常间歇态。
- 最近自然槽 `1987348`（`2026-09-05T13:00:00.000Z`）三源 `succeeded` / `new_count=0`。
- 签名 caps：`automaticReview=false` / `automaticPublish=false`。
- SNAP 15 分钟整库快照 + iCloud 密文镜像已上线。Backup V2 增量候选已废弃。
- **没有**生产 RSSHub；**不要**把 08-15 的 `:1200` 写成现行采集链。
- snapshot 投递：**不要 HTTP POST `:3102`**；走 `[M1-HOME]/F1-1-website/.ac5cc2/runtime/scheduled-sender.ts` 进程内 receive。

## 回退

- 公开+`:3102`：`[M1-HOME]/F1-1-website/.public-load-20260905-1408/`
- Admin：`[M1-HOME]/F1-1-website/.admin-load-20260905-1408/`
- 0012 前库：`[M1-HOME]/F1-1-website/.0012-apply-20260905-1408/pre-0012.sqlite`

## 流量监控现状

首版结构化、隐私最小化访问聚合仍 `not_available`。不能从 public-beta 空 stdout 推断访问量。
