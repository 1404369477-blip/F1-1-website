---
task_id: TASK-20260812-39D4DD
department: 开发部
status: final
decision: pass
date: 2026-08-12
---

# 39D4DD 投影 outbox、single sender 与无 hash 首包自举实现报告

## 结果

本任务按统筹部从 `TASK-20260812-850163` 拆出的 A 段边界完成本地实现。手动 publish 仍是唯一创建公开投影 outbox 的入口；sender 每次最多领取一项，租约固定 60 秒，尝试上限固定 3 次。投递成功必须在同一 SQLite 事务中写入精确 receipt、切换 outbox 状态并追加审计事件。

Receiver 的空根首次激活不再依赖预先填写的 generation/hash。它只接受通过 Ed25519 验签、generation=1、previous=null 的完整包；激活锁和 committed generation 均使用 `O_EXCL`，并发首包竞争只允许一个请求进入激活区。后继链继续要求 generation 连续且 previous 指向当前 active manifest。

## 产物

| 文件 | SHA-256 | 作用 |
|---|---|---|
| `app/migrations/rss-real/0003_projection_delivery_runtime.sql` | `0f9d3908b62006158bf6dab60a4969c0bf65b95787d483b4e365f36199a86848` | receipt 持久化、sender 索引、固定 lease/attempt、成功需 receipt 与不可变约束 |
| `app/src/server/review-real/migration.ts` | `9ebb1e87f13a63bcf04ebbeec49d1e3536c36f8c9e4531e866ce668601ecd9af` | 保留 v2 入口并新增 v3 migration/fingerprint 门 |
| `app/src/server/review-real/repository.ts` | `29d79c39e1783cf3c88f4765ba21ace063129072be495135ec3e0da403a6f862` | single lease、过期先 reconcile、状态与 audit/receipt 同事务 |
| `app/src/server/review-real/sender.ts` | `d5c93d59a4c2811bcf3d769c67bc1339eeb60d953b4b09d12a2c353b68b3c02b` | stored-envelope 签名投递、unknown 只查 receipt、404 同包有界重投、语义冲突 terminal |
| `app/src/server/review-real/projection.ts` | `495b2e4a9182e2c1183201eae975892752b88ea9fd35be81467a4362751f471e` | 无 pin gen1 自举、激活锁与 generation `O_EXCL`、连续链校验 |
| `app/src/tests/review-real-delivery.test.ts` | `c85feb9eee7e66140dc68f6f6e62a2977526f9c072e56c35fe7ed4581288a93c` | A 段唯一聚焦测试组 |

v3 完整 `sqlite_schema` 指纹固定为 `5d3316653750c8eaafefda7a0d5e3a154ab647a7e77329c048b91ce516a8b84f`。

## 已验证

三项门禁均只执行一次，未发生重跑：

1. 固定 Node 24 Vitest：`1 file passed / 2 tests passed`。覆盖 publish 前 outbox=0、publish 后唯一 outbox、正常 receipt 成功、response-loss 后只 GET、精确 404 后同一 canonical signed package 重投、409 terminal、假签名拒绝、空根 gen2 拒绝、activation-lock 竞争失败、合法 gen1 激活与幂等 receipt。
2. 固定 Node 24 TypeScript：`tsc --noEmit`，退出码 0。
3. 限定六项实现文件 `git diff --check`，退出码 0。

冻结检查：

- `0001` SHA 仍为 `c03c5c0bd5887e9e74453c91602bae76f6a7c74db513a2d9ff808ad498807ef3`。
- `0002` SHA 仍为 `1d373f90cf881a58a15966ffe12ed01c3a651380d5f4f5aa9de468d79a798263`。
- 679786 的四项 release 工具 SHA 均保持其已 ACK 值：`9bf92e…`、`f04b6f…`、`732c63…`、`10c580…`。
- 未修改采集核心、Admin UI 和公开 UI。

## 未验证与后继边界

- 本任务未实现 HTTP transport/CLI、deployment-v2、public internal listener、Next public-real-snapshot adapter、installer 或 release successor overlay。这些属于统筹部明确拆出的 B 段，当前不可部署或切换公开站。
- 未执行 SSH、M1、真实私库、真实密钥、真实网络、cutover 或完整回归。
- 测试中的 activation-lock contention 是确定性的锁占用探针；未启动多进程压力测试。

## 错题自检

- 已检查单部门单在办、旧 migration 不改、stored envelope/hash 不重算、response unknown 禁止盲重投、状态与 audit 同事务、首错即停和 0SSH/0M1 边界，无命中。
- 850163 已按统筹指令阻断并拆为本 A 段及待派 B 段；本报告不把 A 段说成完整公开读纵切或 production-ready。

TASK_STATE_OK（在任务工具完成收据落盘后成立）。
