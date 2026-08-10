# F1+1 新 Mac 迁移：先读这里

F1+1 已迁移到 Apple M5、arm64、macOS 26.6，并在经用户授权的精确清理后完成独立终验。当前目录是 **post-clean 交接与历史证据区**，不再是可用于再次恢复的迁移包。

## 当前可用内容

- `CURRENT-HANDOFF.md`：当前 M4 / VS-0 施工断点、任务状态、删除/保留边界和续做顺序。
- `README-M5-macOS26.6.md`：目标机终验、历史迁移证据与清理结论。
- `conversations/`：主任务和八部门共 9 个 Codex 任务的有效对话导出、索引与 `SHA256SUMS`；10/10 校验已通过。
- `THREAD-MAP.md`、`DEPARTMENT-HANDOFF-PROMPTS.md`、`RESUME-PROMPT.md`、`ENVIRONMENT-MANIFEST.md`、`SECURITY-EXCLUSIONS.md`：迁移过程保留的辅助记录。若其中仍有冻结期步骤或状态，以 `CURRENT-HANDOFF.md`、任务 JSON 和正式报告的 post-clean 真值为准。

## 已删除内容

以下内容已在迁移终验通过、用户授权后精确删除：

- `migration/bundles/`
- `migration/manifests/`
- `migration/portable-assets/`
- `migration/scripts/`

因此 portable/warm 归档、SHA 清单、vendored 资产及恢复/验证脚本当前均不存在。它们的历史 hash 与删除前 PASS 收据保留在 `README-M5-macOS26.6.md` 和测试部终验报告中；不要把旧命令当成当前入口，也不要为本断点重建归档或缓存。

## 当前恢复入口

项目已经在目标机上，续做顺序如下：

1. 阅读 `../docs/handoff.md` 与 `CURRENT-HANDOFF.md`。
2. 以 `../docs/spec.md`、accepted ADR 和 `../docs/collaboration/tasks/` 为权威真值。
3. 继续已经同步的原主任务和八部门任务；9/9 个 Codex 任务已核对可见。
4. 开发部 `TASK-20260802-7A9C48` 当前为 `completed`、待统筹核收；测试部后继 `TASK-20260802-FFC67A` 为 `claimed`、正在独立回归，之后仍需安全复验；安全部 `TASK-20260802-6F7563` 当前仍为 `claimed`。

## 安全与范围警告

- VS-0 最新独立安全结论仍为 FAIL；R5 同 UID 威胁模型待用户决定，R12 OS/系统调用级 no-egress 仍 pending。
- `7A9C48` 的开发整改 PASS 与后继 `FFC67A` 的未来测试结论都不能替代 VS-0 独立安全 PASS；`6F7563` 的候选合同也不等于实现或安全放行。任何一项都没有因迁移终验通过而获得跨轴授权。
- 真实 Base/provider/Collector、平台采集、AI/媒体、公开发布、部署、付费及其他真实外部能力继续 closed/Unknown。
- 旧 Obsidian Local REST `data.json` 已按授权删除；插件本体、启用记录和精确忽略规则保留。任何文档或日志都不得记录凭证值。
