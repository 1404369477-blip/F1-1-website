---
type: audit_report
department: 测试部
target: TASK-20260810-91AF6E冻结候选
status: final
date: 2026-08-10
related_task: TASK-20260810-37CA8F
decision: fail
tags: [M5, source-management, HTTP, closed-receipt, regression]
summary: 冻结候选、closed DB与独立59+0临时profile均通过前置门；唯一loopback实例在首个add请求返回403 ADMIN_CSRF_INVALID后按合同立即停止。根因为独立客户端误用x-f1-csrf而非x-f1-csrf-token，未建立产品缺陷，但后续HTTP/恢复矩阵未完成，P0=0/P1=1/P2=0，FAIL。
p0: 0
p1: 1
p2: 0
---

# TASK-20260810-37CA8F 独立 HTTP 与 closed 复验报告

## 结论

`FAIL`。P0=0、P1=1、P2=0。

唯一实例的首个业务写入请求 `POST /api/admin/sources` 返回 `403 ADMIN_CSRF_INVALID`。复核发现独立客户端把合同头 `x-f1-csrf-token` 写成 `x-f1-csrf`。服务端拒绝行为符合合同，因此当前证据没有建立产品缺陷；但任务规定首个 HTTP 断言失败后停止且不得重启/重复整链，本轮无法达到 PASS 所需的完整 HTTP、幂等与恢复出口，记独立验收 P1-01。

## 已验证

- 开发报告、manifest、closed DB和三候选 SHA 全部精确命中任务冻结值。
- 独立 0700 临时物理 profile/DB：迁移 0001+0002+0003、`user_version=3`，seed `59 baseline + 0 local`，最终 `integrity_check=ok`、local仍为0。
- 唯一 `127.0.0.1:3019` 实例：health 200/externalCalls=0；未认证 list 401；session create 201；session get 200；认证 list 200且59条均为只读 baseline、enabled=false；CSRF issue 201；所有观察响应为 no-store。
- 正式 closed DB SHA仍为 `ddf3778c...e939`；开发报告、开发 manifest、receipt字节未漂移。

## 未验证与首错

未验证：add/operation/get成功链，validate/activate/stop/retire/requeue，response-loss replay，stale/conflict/404，refresh/destroy与CSRF重放、错method/path/body，最终59+local overlay。原因均为首错停止，不得外推 PASS。

最小复现与逐步收据见 [raw-http-receipt.json](TASK-20260810-37CA8F-evidence/raw-http-receipt.json)，机器汇总见 [evidence-manifest.json](TASK-20260810-37CA8F-evidence/evidence-manifest.json)。

## 收口与错题自检

- 未复用开发 HTTP 断言；亲自构造独立请求。
- 明确区分客户端头名错误与产品失败，没有把正确的403拒绝写成产品缺陷。
- 首错后未修 harness 重跑，实例总数为1。
- 未运行全量测试、build、lint、typecheck或浏览器；未修改产品代码、正式 DB、依赖、Spec/ADR或外部资源。
- 任务实例已停止，3019无监听；只清理由本任务创建的临时副本。

TASK_STATE_OK
