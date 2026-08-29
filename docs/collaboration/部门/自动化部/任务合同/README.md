# M1运行办公室任务合同入口

机器合同使用 `f1plus1-ops-handoff-task-v1`。正文保存在 M1 owner-only `OpsHandoff/inbox/`；本同步目录只保存 schema/版本说明和证据指针，不保存活动 lease 或生产授权。

合同顶层 `bodySha256` 定义为：删除该字段后，对完整 JSON 按冻结 canonical JSON 规则编码，再计算 SHA-256。合同、lease、observer receipt 和 outbox 必须逐级绑定。

活动任务仍需在项目 `docs/collaboration/tasks/TASK-*.json` 建立治理真值；机器合同不能绕过 agent-team 任务状态与用户授权轴。
