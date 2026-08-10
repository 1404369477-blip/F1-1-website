---
type: development_block_report
status: blocked
date: 2026-08-04
department: 开发部
task_id: TASK-20260804-3AF992
domain_stage: p1_remediation
decision: blocked_by_first_http_assertion
---

# 公开 API no-store 最终响应层整改阻断报告

## 结论

任务未达到 acceptance exit，不能回传 `TASK_STATE_OK`。唯一 HTTP 聚焦验收的首个 feed 请求已通过精确 `Cache-Control: no-store` 断言，随后在响应正文零泄露断言失败并立即停止。按照任务合同，没有修改脚本后重跑、追加 HTTP 请求、重复 seed 或重复启动。

## 覆盖层定位与实现

本地固定 Next 16.2.11 实现 `next/dist/server/base-server.js` 的 `BaseServer.pipeImpl()` 明确在 dev 模式、route handler 产生响应后写入 `Cache-Control: no-cache, must-revalidate`。因此 route handler、Problem helper和 `next.config headers()` 均早于该最终覆盖层。

`app/scripts/serve.ts` 已实现受控本地最终响应层：

- Next 只监听内部 `127.0.0.1:3001`；包装器公开监听固定 `127.0.0.1:3000`。
- 所有转发仍限于同机 loopback；移除 Forwarded/X-Forwarded 输入并固定内部 Host，不构造外部请求。
- 只对 `/api/public/feed` 与 `/api/public/stories/*` 的最终响应设置精确 `Cache-Control: no-store`。
- 页面和静态资源响应头保持 Next 原值。
- profile-aware readiness、完整 integrity、projection-first、无 fallback、无外部 IO与六字段启动失败收据保持启用。

唯一 HTTP 验收中，首个 feed 的 `cache-control === no-store` 断言已经通过，证明最终响应头覆盖生效。

## 首个 HTTP 失败

验收脚本依次执行：读取响应文本 → 断言精确 no-store → 对正文做禁词模式检查 → 继续验证状态和 DTO。首个 feed 在正文检查处失败：`AssertionError: /api/public/feed body leak`。为避免把可能的敏感内容复制到日志，脚本没有输出响应正文或命中片段；stdout 收据为空。

冻结 fixture 的离线搜索确认底层数据包包含 `https://synthetic.invalid/...` 等合成证据 URL，以及一条含 `token` 单词的内部 notes；公开 Repository 合同原则上不会输出这些字段。当前唯一 HTTP 已耗尽，无法确认实际响应是公开 DTO 中出现了禁词、Next 开发错误正文，还是验收正则对安全文本产生误报。该项保持 Unknown，不做猜测。

因此以下项目为 `NOT_RUN`：feed 状态/12条完整断言、筛选、游标负例、有效详情200、未知详情404、malformed400、Problem字段和其余响应 no-store/零泄露。

## typecheck

唯一 typecheck 已执行并失败，exit 2。`app/scripts/serve.ts` 中复制后的 request headers 被 TypeScript 推断为窄对象，删除四个 `x-forwarded-*` 键时触发 TS7053。按照“HTTP 任一断言失败即停止并 block”的门禁，本轮没有在失败后继续修改并重跑 typecheck。

## 受控执行与清理

- 实际目录：`/tmp/TASK-20260804-3AF992`。
- canonical seed：一次，1/12/12/12/10/12/12/12/12，`inserted=true`、`externalCalls=0`。
- 包装器启动：一次，成功建立内部 3001 与公开 3000 监听。
- HTTP 聚焦验收：一次，exit 1；失败传播正确，没有 tee 管道。
- typecheck：一次，exit 2。
- 未运行 full check、build、浏览器或其他测试。
- 进程已 SIGINT 停止；任务置 blocked 前清理专属 `/tmp`、DB/sidecar、临时 `.next`、脚本与收据；工作区 `.next` 未创建。

## 最小下一步

后继任务需要新的 seed/启动/HTTP/typecheck 预算，并先完成两项静态修复：

1. 将代理 request headers 显式声明为 Node `OutgoingHttpHeaders` 或等价宽类型，消除 TS7053。
2. 将零泄露检查改为只输出固定命中类别、不输出正文的安全分类器，在单次验收中区分 `absolute_path`、`scheme_url`、`runtime_keyword` 等类别；验收合同仍应检查 DTO 字段 allowlist，避免把底层合成证据 URL误判为已外发。

## 错题检查

- 没有把 no-cache 解释为等价通过；最终 no-store 断言实际通过。
- 没有重复 seed、启动、HTTP、typecheck，没有直启绕过包装器。
- 没有关闭 integrity、修改 DTO/ADR、增加 fallback 或外部 IO。
- 没有记录或回显疑似泄露正文。
