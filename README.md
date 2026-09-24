# F1+1

> 一个聚合 F1 赛事动态、相关新闻、车手社交分享及周边趣闻的一站式资讯网站。

本仓库采用「三层物理隔离 + AI 工作层」的方式管理:把**想清楚 / 做出来 / 长什么样**分开,并为不同 AI agent 提供统一入口。

## 仓库结构

```
F1+1/
├── CLAUDE.md         ← AI 工作入口(Claude Code 自动加载)
├── AGENTS.md         ← 通用 Agent 工作入口(Codex / Copilot 等)
├── README.md         ← 你在这里:项目总入口与导航
├── docs/             ← 规划与管理:spec、agent-guide、overview、roadmap、progress、handoff、决策记录
├── app/              ← 应用本体代码
├── design/           ← 设计与 UI 参考
└── scratch/          ← 草稿/实验区(git 忽略)
```

## 三层各管什么

| 文件夹 | 回答的问题 | 谁主要在这里工作 |
|--------|-----------|----------------|
| `docs/` | 我们要做什么、做到什么程度、做到哪了 | 规划 / 决策 / 交接 |
| `app/` | 怎么做出来 | 写代码 |
| `design/` | 它长什么样、参考了谁 | 设计 / 体验 |

## 从哪开始

1. 读 [`docs/spec.md`](docs/spec.md) —— 当前唯一开发准绳。
2. 读 [`docs/agent-guide.md`](docs/agent-guide.md) —— AI 协作规则与安全边界。
3. 读 [`docs/roadmap.md`](docs/roadmap.md) —— 阶段地图。
4. 想了解进展,看 [`docs/progress.md`](docs/progress.md)。
5. 接手项目 / 换设备继续,先读 [`docs/collaboration/当前工作分工与交接.md`](docs/collaboration/当前工作分工与交接.md)、[`docs/当前生产状态与执行待办.md`](docs/当前生产状态与执行待办.md)，再读 [`docs/handoff.md`](docs/handoff.md)。

## 当前阶段

🔴 **M6 生产恢复** —— 公开 Beta 已部署，当前播 generation **201**（含 Sky Sports F1 中文稿）；15 分钟加密备份已上线。Admin / 公开 / 投影均 `1408`；collector/refiner 仍钉 `0145`。签名自动审核/发布仍关。`AC5CC2` JSON 尚未核收 complete。X 采集尚未恢复。接班先读 [`docs/collaboration/当前工作分工与交接.md`](docs/collaboration/当前工作分工与交接.md) 和 [`docs/当前生产状态与执行待办.md`](docs/当前生产状态与执行待办.md)。
