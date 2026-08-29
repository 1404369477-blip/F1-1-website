# 自动化部（M1运行办公室）当前状态

更新时间：2026-08-15

事实快照观察时间：`2026-08-14T17:06:24Z`；超过 30 分钟的运行状态一律按 `Unknown`，需重新取得 observer/inventory receipt。详细证据见 `scratch/TASK-20260815-M1-CODEX-LAUNCHD-HANDOFF/READINESS-REPORT.md`。

## 治理登记

- `auto` 已通过受管 add-role 事务登记，正式目录和路由已生成。
- 真实 M1 Codex 会话 ID 尚未登记，部门仍为 `pending/待启用`。
- 最新协议上的 role-policy overlay 命令返回 `UPGRADE_NOT_NEEDED`，协议 `role_policy_overlays` 仍为空；M1 项目职责暂由明确标注的 non-managed 补充章程承载。

## 已核实运行能力

- RSSHub `127.0.0.1:1200`；collector/refiner 每 900 秒；Admin `127.0.0.1:3101` 内含 60 秒 automatic review/sender tick；Public `127.0.0.1:3000`；receiver/projection `127.0.0.1:3102`；receipt refresh 每 43200 秒。
- Quick Tunnel 的 live cloudflared 与磁盘 plist `/usr/bin/false` 存在漂移。
- production collector 尚未引用 RSSHub/1200/catalog；RSSHub 尚未接入主采集链。
- M5 异机备份任务曾因旧 SSH alias 超时而违反 15 分钟 RPO；M1 本地没有同等独立备份 LaunchAgent。

## Codex

M1 安装并运行 ChatGPT desktop `26.803.61601`，内置 `codex-cli 0.147.0-alpha.6.5`；PATH 无独立 `codex`。用户说明已接好 `deepseek-v4-flash` 和 `deepseek-v4-pro`；本部门不读取或复制其凭据。Scheduled UI 是否列出这两个模型仍为 `Unknown`。

## 流量监控现状

- Public 最外层代理当前只做代理与 route allowlist，没有请求计数、状态类别、延迟、错误率或路由聚合代码。
- public-beta 的 stdout 当前为空，stderr 仅有旧启动类输出；不能从现有日志可靠重建流量指标。
- Quick Tunnel 配置了 stdout/stderr 路径，但当前磁盘 plist 已禁用，且没有可验证的结构化、隐私最小化访问聚合收据。
- 因此首版流量监控能力状态为 `not_available`；本任务未为取得指标而重启或改动服务。
