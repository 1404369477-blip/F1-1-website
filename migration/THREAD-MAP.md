# F1+1 Codex 任务与部门会话映射

记录时间：2026-08-02。来源为项目内 `docs/collaboration/会话启动状态.json` 与 Codex 当前只读任务列表。

对应有效对话已经导出到 `migration/conversations/00-main.md` 至 `08-testing.md`，索引见 `migration/conversations/INDEX.md`。

| 角色 | Codex 任务 ID | 冻结时状态 | 续接说明 |
| --- | --- | --- | --- |
| 当前主任务 | `019fb2b1-fb60-7792-adb4-e0e876a32947` | active | 标题“开发F1资讯聚合网站：F1+1”；迁移完成后从这里统筹 |
| 统筹部 | `019fb368-828c-7461-bc1e-debc14d1cd1c` | 项目登记为 active/registered | 迁移任务 owner；ID 以磁盘登记为准 |
| 产品部 | `019fb369-ae6d-7131-9199-7dc088542ead` | idle，有未读 | 不直接派新执行，先由主任务核对当前队列 |
| 研究部 | `019fb36c-1f86-78d3-a6d7-f87f124bd710` | notLoaded | 已完成前沿调研增量 |
| 设计部 | `019fb36e-c81c-7991-9357-e19a1df6ba23` | idle | VS-1 16 状态映射已交付 |
| 数据部 | `019fb371-9834-78d3-a7b3-4f4c62819520` | idle，有未读 | VS-1 SQL/fixture 蓝图已交付 |
| 开发部 | `019fb374-7c86-7882-9e51-76114ce69e7f` | idle，有未读 | `TASK-20260802-7A9C48` 被迁移冻结打断；优先恢复 |
| 安全部 | `019fb377-10f9-7213-ba73-1a717dc76d77` | idle，有未读 | 最新 VS-0 决策 FAIL；待后继复验 |
| 测试部 | `019fb379-9212-7e80-a5df-587d339936c4` | idle，有未读 | VS-1 88 个测试 ID 计划已交付，实施仍 pending |

## 同步边界

- 线程内容由 Codex 应用/账号管理，项目归档没有复制 Codex 数据库或 auth。
- 同账号登录后优先检查上述 ID 是否仍可见；能看到时直接在原任务续接。
- 若未同步，以 `docs/spec.md`、accepted ADR、`docs/collaboration/tasks/`、四份部门接班文档和本文件为恢复依据。
- 新建替代任务时，应在项目的会话真值文件中按 `agent-team` 协议登记新 ID；旧 ID 留作历史，不伪造为已同步。
