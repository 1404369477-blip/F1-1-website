# 新 Mac 续接提示词

把下面整段发送给恢复后的 F1+1 主任务；将路径中的用户名替换为目标机实际用户名。

```text
继续 F1+1 项目。项目已经从旧 Mac 迁移到：
/Users/你的用户名/Documents/F1+1

先不要继续业务开发，也不要改文件。请按以下顺序完成接班和迁移验收：

1. 完整读取 AGENTS.md、docs/agent-guide.md；按指引读取 docs/spec.md、accepted ADR、docs/progress.md。
2. 完整读取 migration/README-M5-macOS26.6.md、migration/CURRENT-HANDOFF.md、migration/SECURITY-EXCLUSIONS.md、migration/THREAD-MAP.md、migration/conversations/INDEX.md、migration/DEPARTMENT-HANDOFF-PROMPTS.md。
3. 运行：
   bash migration/scripts/verify-restored-project.sh --project-root /Users/你的用户名/Documents/F1+1
4. 运行：
   python3 docs/collaboration/scripts/agent_team_task.py doctor
   python3 docs/collaboration/scripts/agent_team_task.py list --state claimed
   python3 docs/collaboration/scripts/agent_team_task.py list --state queued
5. 核对 Git：分支 main、HEAD a9691e71b1552592cc5ded8d5db66c336262301c、remote 为空、dirty worktree 被完整保留。不要 reset、checkout、clean 或丢弃任何用户改动。
6. 确认 Node24 warm layer：app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/node 为 v24.18.0，npm 为 11.16.0；若 warm layer 不可用，按迁移说明走 lockfile 重装，不混用系统 Node25。
7. 当前开发任务 TASK-20260802-7A9C48 在迁移时中断。已有 serve.ts、安全 CLI wrapper 和 log allowlist 部分代码；command-level argv/端口零监听/CLI泄漏负例、整改报告和独立安全复验仍未完成。任何 build/check 成功都不能把该任务写成 PASS。
8. 最新 VS-0 独立安全结论仍为 FAIL：P0=1（同 UID TOCTOU 用户门禁），P1=2 正在整改，R12 OS 级 no-egress pending。真实 Base/provider/Collector、外部平台采集、AI/媒体、自动发布、部署继续 closed。
9. 核对主任务、统筹、产品、研究、设计、数据、开发、安全、测试共9个任务是否同步；每个任务的有效历史可从 migration/conversations/ 对应文件恢复。
10. 请先客观汇报迁移校验结果、全部部门同步状态、明确未验证项和建议恢复顺序；等我确认后，再按 migration/DEPARTMENT-HANDOFF-PROMPTS.md 逐部门接班，并恢复开发部 TASK-20260802-7A9C48。

如果原 Codex 任务没有同步，以磁盘上的 docs/spec.md、accepted ADR、docs/collaboration/tasks、部门四文档和迁移断点为真值；不要复制或猜测旧 Codex 本地数据库状态。
```
