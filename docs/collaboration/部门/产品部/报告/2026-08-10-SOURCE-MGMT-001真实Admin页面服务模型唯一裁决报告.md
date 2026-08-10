---
title: SOURCE-MGMT-001 真实 Admin 页面服务模型唯一裁决报告
date: 2026-08-10
department: 产品部
task_id: TASK-20260810-8A055D
decision: pass
severity_count:
  P0: 0
  P1: 0
status: completed_candidate
---

# SOURCE-MGMT-001 真实 Admin 页面服务模型唯一裁决报告

## 1. 任务结果

`TASK-20260810-8A055D` 已按产品/架构裁决边界完成。唯一推荐是 **B：受控 Next 统一页面/API**，具体落地为“同一 Node 进程、同一 raw `node:http` listener、raw gate 先行、同进程 Next production request handler”。

产出：

- [`2026-08-10-F1+1-SOURCE-MGMT-001真实Admin页面服务模型-proposed.md`](../../../../decisions/system/2026-08-10-F1+1-SOURCE-MGMT-001真实Admin页面服务模型-proposed.md)
- 本报告

候选合同可直接拆给开发部，但实施尚未授权。页面代码/CSS/运行接线必须等待两个前置门：`TASK-20260810-91AF6E` 及同一候选独立测试/安全闭合，以及用户对 v2 视觉冻结 manifest 的精确确认。

## 2. 裁决摘要

| 候选 | 裁决 | 要点 |
|---|---|---|
| A raw 同进程自包含 shell | 淘汰 | 需增加 Next 之外的前端组装/资产合同，存在第二 UI 真值和视觉漂移 |
| **B 受控 Next 统一页面/API** | **唯一推荐** | 一进程/一 listener/一 profile/一 DB/一 writer，raw-before-Next，真实页面与 API 同源 |
| C 其他模型 | 淘汰 | 没有找到同时满足全部硬门且比 B 更小的模型；sidecar/双端口/反向代理不符合任务边界 |

该裁决符合 accepted M4 的 Next App Router + 单 Web 进程方向，不需要改 accepted ADR，不要求放宽 v0.3 安全合同，不增加新依赖或外部能力。

## 3. 为什么现有 Next 文件不构成页面出口

只读核对确认：

- `app/scripts/serve.ts` 对 `source-management-synthetic` 直接进入 raw source server 分支并 return；
- raw server 已处理 `/api/health` 和 `/api/admin/...`，但不会把请求交给 Next；
- App Router 已有 Admin Route Handlers，`app/src/app/(admin)/` 没有 `/admin/sources` page；
- 现有非 source profile 的 Next child + `3001` proxy 模型会形成第二进程/端口，不能复用为本任务出口。

因此，最小正确接线是保留 raw server 为唯一 listener 和 authority owner，将同一个已守门请求交给同进程 Next production handler。

## 4. 可直接派发的实施边界

候选合同已冻结：

1. 启动拓扑和完整失败清理顺序；
2. `/admin/sources`、`/api/health`、现有 Admin API 和精确 hashed asset 的 route allowlist；
3. raw authority 在 Next 正规化前执行，AsyncLocal raw context 穿透 Route Handler；
4. 页面 bootstrap、local session、CSRF 及 command/body/nonce 唯一顺序；
5. CSP、cache、source map 与无外部资产边界；
6. `SOURCE-MGMT-001` 六操作、状态、response unknown 与恢复；
7. Mac/iPhone 功能等价，且明确 390 viewport 不外推为物理 iPhone 网络可达；
8. DEV-PAGE-00..03 四个最小切片、文件边界、closed manifest 和三路独立验收出口。

## 5. 视觉和实施门禁

v2 视觉 manifest 文件 SHA-256 为：

`7686511f56f65ca5838ee9c907a24ac930d92974397d9b398d0d9ac90495f155`

其内部继续声明 `implementation_authorized=false` 和 `remaining_user_gate=visual_direction_confirmation`。现有四张 PNG 只覆盖 1440/390 深浅冻结候选，没有 1024 运行证据，也不证明页面已实现。

实施后必须由同一运行 candidate 生成 `1440/1024/390 × dark/light` 六格，再由测试、安全和设计部分别对同一 root 复验。

## 6. 已验证

- 任务 JSON、产品部收件箱和 claim 状态已核对；
- v0.3 合同 SHA `90ee4ed30d325b7b2833582cc0ac8134aefc7fbc2dcd43ec9d20c0f726b2f1fe` 已复算；
- v0.3 安全复验 SHA `495bcf8a670cf275c88a67056370e62ec238fc5b38e3a3165dfbb82f3c8ebc6d` 已复算；
- v2 视觉 manifest SHA `7686511f56f65ca5838ee9c907a24ac930d92974397d9b398d0d9ac90495f155` 已复算；
- BDBD33=`blocked`、F213DE=`acknowledged`、91AF6E=`queued` 的任务时态已核对；
- `serve.ts`、raw source server、Admin Route Handlers、App Router page 结构已只读核对；
- 唯一 B 推荐不要求修改 accepted ADR、安全合同、依赖或外部能力。

## 7. 未验证和当前阻断

| 项目 | 状态 | 影响 |
|---|---|---|
| 91AF6E 后端闭合 | `queued` | 页面实施关闭 |
| v2 视觉用户确认 | 未确认 | UI/CSS/page 实施关闭 |
| Next production handler 在 no-egress 下的进程/网络行为 | 未实跑 | DEV-PAGE-01 首个失败关口 |
| CSP nonce 与零 `unsafe-eval` | 未实跑 | 不满足时候选 FAIL，不放宽安全配置 |
| 1440/1024/390 深浅运行证据 | 未实现 | `SOURCE-MGMT-001` 继续 `P1-blocker/user-gated` |
| 物理 iPhone 网络可达 | closed/Unknown | 需后续私有访问/部署授权，不由本任务外推 |

当前阻断只阻断实施，不阻断本次架构裁决和候选合同交付。

## 8. 错题自检

1. 没有把 App Router 中已存在的 API wrapper 或将来的孤立 page 写成现行可达出口。
2. 没有复用非 source profile 的 child+proxy/3001 模型。
3. 没有将 v2 视觉候选、91AF6E queued 或 proposed 架构写成已实现/已放行。
4. 没有触碰 app、data、design、Spec 或 accepted ADR；没有新增依赖、端口、外部请求、真实资源或部署。
5. 没有将 390 viewport 证据写成物理 iPhone 跨网运行证据。

## 9. 收口判定

- 产品/架构合同：PASS，P0=0，P1=0。
- `SOURCE-MGMT-001` 实施状态：继续 `P1-blocker/user-gated`。
- 真实 provider/Base/真实数据/Admin 生产访问/部署/外部 I/O：closed。
- 后续唯一用户门：对 v2 视觉 manifest 的精确确认；本报告不代替该确认。
