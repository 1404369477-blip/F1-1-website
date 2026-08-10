---
type: audit_report
department: 安全部
target: "TASK-20260810-70EC0F 进程内SQLite/audit与no-egress证据链"
status: final
date: 2026-08-10
related_task: TASK-20260810-70EC0F
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
tags: [SOURCE-MGMT-001, sqlite, audit, no-egress, harness, first-failure]
summary: "FAIL。冻结DB、guard、server、91AF6E manifest与F213DE报告SHA链匹配；唯一进程内harness在复制DB前因cpSync mode参数误用触发ERR_OUT_OF_RANGE。该首错属于安全探针实现错误，未建立产品缺陷。按首错停止，SQLite/audit/权限/第二writer均NOT_RUN；正式DB未打开且SHA零漂移，server/readiness/fixture初始化/动态网络均未调用，externalCalls=0，临时资源已清理。"
---

# 进程内 SQLite/audit 与 no-egress 证据链最终安全复验

## 1. 唯一结论

**FAIL；P0=0，P1=1，P2=0。**

本轮 P1 是安全 harness 实现错误，未建立产品安全缺陷。唯一授权 Node24 harness 在复制 closed DB 前调用 `cpSync(source, target, {mode: 0o600})`；Node 的 `cpSync.mode` 表示复制行为 flags，只接受 `0..7`，因此对十进制 `384` 抛出 `ERR_OUT_OF_RANGE`。

首错发生在 DB 副本创建、任何数据库打开、业务断言和网络入口之前。依任务首错合同，没有修改 harness 或重跑。

## 2. 已匹配的冻结证据链

| 对象 | 本轮 SHA-256 | 结果 |
|---|---|---|
| formal closed DB | `ddf3778c62cf95f195b1f08db8b075d676069f4cc9fb39804063e1004dd2e939` | MATCH，运行前后零漂移 |
| `no-egress.ts` | `5f008507164f2a1b8678435ec491e31bf6235700c50844ec1dca3801ada756d2` | MATCH |
| source-management `server.ts` | `5c40918c7ac45aa809ed106acdfa00c9b6d5c52fb90a0b9995a0a3998d83378f` | MATCH |
| 91AF6E manifest | `7b0658d9972df676acec689cb3d99ea23e74bf1abc2e51f9a169a9aa49b187b3` | MATCH |
| F213DE 安全报告 | `745ddde6a5d5da108d9a3ef80eb689946a094cb3ab48ef6e591d47a2f7b2757f` | MATCH |

91AF6E manifest 固定记录：前序 no-egress 聚焦门 `9/9`、唯一 `127.0.0.1:3019` loopback、HTTP 与 closed receipt `externalCalls=0`，收口后无进程、端口、profile lock、WAL 或 SHM。该 manifest 内绑定的 guard、server 与 F213DE 报告 SHA 均与本轮实文件相符。

F213DE 报告固定了一次性 exact-loopback、`options={all:true}`、实际地址复核和其余 DNS/connect/HTTP/child-process 继续拒绝的合同。当前 SHA 链没有漂移。本轮没有重放动态网络或启动监听。

## 3. 首错机器收据

```json
{
  "reasonCode": "HARNESS_COPY_MODE_ARGUMENT",
  "runtimeCode": "ERR_OUT_OF_RANGE",
  "phase": "before closed DB copy and before database open",
  "operatorCause": true,
  "productDefectEstablished": false,
  "externalCalls": 0
}
```

正确的机械语义应先复制文件，再用独立 `chmod(0600)` 设置权限；本任务禁止首错后修订重跑，因此仅将该事实作为后继输入，不在本轮执行。

## 4. 已验证

- 875B6C 相关 closed DB、guard、server、91AF6E manifest 和 F213DE 报告冻结 SHA 精确匹配。
- no-egress 冻结证据链内部引用一致：9/9、exact loopback、`externalCalls=0` 和清理状态有对应 manifest 字段。
- 742B8D 已记录的 raw/session/CSRF/identity 前半 PASS 保持原历史，本轮没有重复。
- 首错前没有创建 DB 副本，没有打开正式 DB，没有启动 server、调用 readiness、初始化 fixture 或触发动态网络。
- formal DB SHA 保持固定值；外部调用为 0；任务临时根和 harness 文件已精确清理。

## 5. NOT_RUN / 未验证

由于唯一 harness 在复制阶段首错，以下进程内出口全部为 NOT_RUN：

- 59 baseline + 1 local、`local_synthetic`、retired/stopped/disabled；
- main/temp 单 DB、唯一 profile ledger、overlay/fence/operation/outbox/inbox/task/audit 计数；
- audit 顺序、previous hash 链、internal/append-only/external_calls/redaction 字段；
- logical content root 与 91AF6E closed receipt 一致；
- 错误 basename、弱权限与第二 writer 的失败关闭。

因此不能把 742B8D 前半 PASS 与本轮证据链复算组合为 875B6C 最终安全 PASS；完整安全出口仍未闭合。

## 6. 错题自检

- 命中：误把 `cpSync` 的 `mode` 选项当成文件权限；Node 将其解释为复制 flags。
- 已按首错停止，没有修改 harness 重跑或用既有开发/测试结果冒充本轮 SQLite/audit 独立 PASS。
- 没有把探针错误归类为产品缺陷，也没有改写 A5F239、742B8D、7CBD3F 历史。
- 没有启动 server/readiness/fixture 初始化、动态网络或正式数据库。
- 不确定项已全部保留为 NOT_RUN，没有外推 OS 级或生产 no-egress 能力。

## 7. 最小后继条件

若统筹继续，新的窄 successor 应固定一条已审查的复制原语：先物理复制 closed DB，再独立 `chmod 0600`；其余 harness 语义保持 70EC0F 任务合同，只执行一次。本任务历史不得重置或覆盖。

TASK_STATE_OK
