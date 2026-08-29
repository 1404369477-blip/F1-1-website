# 自动化部（M1运行办公室）

治理登记状态：`registered-pending-session`

`auto` 已通过 agent-team 受管事务登记为“自动化部”，正式四文档为：

1. [上岗引导.md](上岗引导.md)
2. [岗位说明.md](岗位说明.md)
3. [交接班文档.md](交接班文档.md)
4. [收件箱.md](收件箱.md)

当前尚未登记真实 M1 Codex 会话 ID，因此部门在会话状态中保持 `pending`，不能宣称已上岗。正式简称为“自动化部”，内部运行单元称“**M1运行办公室**”。

## 项目补充材料

- [M1运行办公室补充章程.md](M1运行办公室补充章程.md)：经用户确认的项目范围与权限边界。当前属于 `non-managed policy attachment`，不冒充受管岗位 overlay。
- [RACI.md](RACI.md)：与统筹、开发、数据、安全、测试和用户的职责关系。
- [RUNBOOK.md](RUNBOOK.md)：只读巡检、异常升级和受控变更流程。
- [STATUS.md](STATUS.md)：已核实机器事实、能力与缺口。
- [机器交接边界.md](机器交接边界.md)：共享治理目录与 M1 owner-only 控制面的分界。
- [流量监控与隐私边界.md](流量监控与隐私边界.md)：首版只允许的聚合指标和禁止字段。
- [模型路由.md](模型路由.md)：DeepSeek V4 Flash/Pro 的职责分工与共同权限门。
- [任务合同/README.md](任务合同/README.md)、[报告/README.md](报告/README.md)、[事故/README.md](事故/README.md)、[决策/README.md](决策/README.md)：运行治理记录入口。

## 两层真值

- `docs/collaboration/` 只承载治理、任务索引、决策、交接、报告和证据指针。
- M1 owner-only `OpsHandoff` 保存原子 task contract、lease、observer receipt 和 outbox，才是 M1 机器运行交接控制面。

两台 Mac 的 `Documents/F1+1` 是 File Provider 的独立本地副本；即使内容 SHA 同步一致，也不能把该目录当作原子队列、锁、lease 或生产授权系统。

## 完整性模型

[MANIFEST.sha256](MANIFEST.sha256) 只冻结稳定的项目治理源：本 README、补充章程、RACI、RUNBOOK、机器交接边界、流量隐私边界、模型路由，以及四类目录入口 README。它使用固定 allowlist，不递归吸收后续报告或任务产物。

以下正常操作会改变的文件不得进入静态 manifest：

- `上岗引导.md`、`岗位说明.md`：受 agent-team 协议管理，由协作 validator 和 `协议版本.json` 的受管文件登记验证；协议升级可合法重生成。
- `收件箱.md`：由 `docs/collaboration/tasks/TASK-*.json` 派生，使用 `agent_team_task.py doctor` 检查，并在需要时通过受管 `rebuild-index` 重建。
- `交接班文档.md`：部门语义交接，按实际任务更新；任务状态仍只认任务 JSON。
- `STATUS.md`：带观察时间的运行快照；超过文件内有效期按 `Unknown`，重新取得 receipt，而不以旧字节 SHA 冒充实时状态。
- `报告/`、`事故/`、`决策/` 中后续新增的记录：按任务、追加日志和报告流程管理；静态 manifest 只冻结各目录的规则入口 README。

机器任务合同只绑定五份稳定且直接影响执行权限的政策文档：补充章程、RUNBOOK、机器交接边界、流量隐私边界和模型路由。它不绑定 `收件箱.md`、`交接班文档.md` 或 `STATUS.md`。
