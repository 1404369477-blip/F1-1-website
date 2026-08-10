---
type: development_block_report
status: blocked
date: 2026-08-04
department: 开发部
task_id: TASK-20260804-C25855
domain_stage: p1_remediation
decision: blocked_by_single_http_receipt
---

# 安全启动收据与 public-synthetic HTTP 闭环阻断报告

## 结论

任务未达到 acceptance exit，不能回传 `TASK_STATE_OK`。任务专属 Next 在第一次包装器启动中成功监听；唯一 HTTP 聚焦验收的第一个 feed 响应为 200，但 `Cache-Control` 实测为 `no-cache, must-revalidate`，与任务要求的精确 `no-store` 不一致。验收在该断言立即停止，其余 HTTP 矩阵未执行。按照一次 HTTP 上限，没有修改后重跑或追加请求。

## 已完成实现

`app/scripts/serve.ts` 新增严格 allowlist 的启动失败收据。该收据对象只包含：

- `stage`：`spawn | readiness | early_exit | timeout`
- `normalizedExitCode`：`zero | nonzero | unavailable`
- `allowlistedSignal`：`SIGINT | SIGTERM | SIGKILL | other | none`
- `elapsedBucket`：`lt_1s | 1_to_5s | 5_to_15s | gte_15s`
- `readyReached`：boolean
- `profileLabel`：`m3-shadow | public-synthetic | unknown`

包装器通过 127.0.0.1 TCP 探针标记 ready，不读取或输出 Next stdout/stderr；15 秒未监听会记录 timeout 并终止子进程；spawn、readiness 与 early exit 分别归一化。收据不会包含命令、参数、路径、环境值、stdout/stderr、stack、URL、数据库位置或 secret。正常 SIGINT/SIGTERM 清理不生成失败收据。

本次首次启动成功，因此运行时没有自然产生失败收据；字段约束由 TypeScript 类型和唯一写出函数保证，后续安全部仍需独立审计。

## 受控执行收据

- 实际唯一目录：`/tmp/TASK-20260804-C25855`；从未创建 `/tmp/TASK-20260804-NEW`。
- canonical public-synthetic seed：一次，1/12/12/12/10/12/12/12/12，`inserted=true`、`externalCalls=0`。
- 包装器启动：一次，Node 24.18.0、Next 16.2.11，成功监听 127.0.0.1:3000；未使用纠正性重启。
- HTTP 聚焦验收：一次调用；首个 `GET /api/public/feed` 返回 200，但响应头为 `Cache-Control: no-cache, must-revalidate`，期望 `no-store`，Node `AssertionError` 后停止。
- typecheck：一次，exit 0。
- 未运行 full check、build、浏览器或其他测试；未关闭 integrity，未增加 fallback，未直启绕过包装器。

## 未验证

- feed body 的 12 条断言在 header 首错后未执行完成。
- 有效详情 200、合法未知 publicId 404、malformed 400、Problem 字段/no-store/零泄露均为 `NOT_RUN`。
- 启动失败收据的真实 failure-path 输出未运行，因为唯一启动成功。

## 执行错误

HTTP 验收命令使用 `node ... | tee ...`，没有启用 `pipefail`，因此外层 shell exit code 显示 0；Node stderr 中的 `AssertionError` 明确记录实际失败：`actual='no-cache, must-revalidate'`、`expected='no-store'`。本报告与任务状态以 Node 断言事实判定为 FAIL，没有把管道 exit code 误记为 PASS。

## 清理与下一步

任务进程已 SIGINT 停止。任务置 blocked 前清理 `/tmp/TASK-20260804-C25855`、canonical DB/sidecar、临时 `.next`、脚本与收据；工作区 `.next` 未创建。

下一步需要统筹部决定是否新增后继任务和新的 HTTP 验收预算，先确认 Next dev 对 route `Cache-Control` 的真实处理边界，再做最小修复。当前任务禁止第二轮 HTTP，不能在本窗口继续试验。

## 错题检查

- 没有第三次启动；实际只启动一次。
- 没有重复 seed、直启 Next、关闭 integrity、吞掉 Repository 错误或增加 fallback。
- 没有改 API、Repository、数据合同、Spec、accepted ADR、依赖或 lockfile。
- 对未执行的详情、404、malformed 与泄露矩阵没有扩大 PASS 声明。
