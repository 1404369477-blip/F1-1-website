---
type: product_completion_report
status: final
date: 2026-08-12
department: 产品部
task_id: TASK-20260812-96F40F
decision_id: ADR-M5-REAL-PROJECTION-RUNTIME-002
external_calls: 0
app_changes: 0
---

# 公开投影 bootstrap 与 sender-reader 闭环产品报告

## 结果

已交付 accepted successor，关闭四项运行冲突：wire 固定为 `POST /internal/projections` + receipt GET；空 receiver 根用“签名全校验 + generation 1/null previous + active absent CAS”完成首包自举，不使用占位 hash；single sender 按 lease/POST/reconcile GET/同包有界重投闭环；public Next 通过显式 `public-real-snapshot` adapter 只读独立 active root，cutover/上一 active/上一 synthetic release 均由精确 manifest 执行。

`auto-publish=0` 没有改变。approve 和 manual publish 仍是两个独立用户动作；sender 只在 manual publish 已提交唯一 outbox 之后机器执行。

## 已验证

- 逐项对照现有 server 闭集、ProjectionReceiver bootstrap 要求、`projection_outbox` 表/触发器和 Repository 只读 `deliveryTask()` 的当前候选事实。
- 已给出单一 wire、首包不可伪造条件、sender 转移、receipt 决策、密钥边界、manifest 字段、reader 读模式、cutover/回退门与最小实施文件清单。
- 现有 accepted ADR 已标记 superseded 并保留全文；Spec/实施合同/功能矩阵已同步，九项 Admin/恢复 Function 仍为 `P1-blocker`。

## 未验证

本任务不写业务代码，因此 `0003`、single sender、deployment-v2、无 hash bootstrap、public snapshot adapter、M1 真实服务、response-loss/crash replay、cutover 与回退都等待开发/测试/安全执行。未运行 SSH、未迁移 DB、未启动服务、未发布真实内容。

## 错题自检

- 没有将签名公钥当成首 snapshot 内容 hash；首包仍必须是 manual publish 产生的已签名全量快照。
- 没有将 delivery 自动执行扩大为内容自动审核或自动发布。
- 没有让 public reader 跨读私库，也没有使用请求级 synthetic fallback 掩盖 real root 损坏。
- 没有原地重写旧 accepted ADR 的决定正文。

TASK_STATE_OK
