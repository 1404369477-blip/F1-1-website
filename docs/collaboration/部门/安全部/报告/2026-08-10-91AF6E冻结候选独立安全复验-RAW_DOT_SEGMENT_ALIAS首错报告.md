---
type: audit_report
department: 安全部
target: "TASK-20260810-91AF6E 固定 SOURCE-MGMT 后端候选"
status: final
date: 2026-08-10
related_task: TASK-20260810-A5F239
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
tags: [SOURCE-MGMT-001, raw-target, dot-segment, fail-closed, first-failure]
summary: "FAIL。首个独立负例RAW_DOT_SEGMENT_ALIAS命中：raw target /api/admin/alias/../session 在任何拒绝前被URL规范化为 /api/admin/session，raw gate返回未授权成功且无reason code。按首错停止；session/CSRF/identity/SQLite/audit/no-egress后续向量全部NOT_RUN。未启动产品实例、未打开或修改formal DB、未外联；任务临时根已清理。"
---

# 91AF6E 冻结候选独立安全复验：RAW_DOT_SEGMENT_ALIAS 首错

## 1. 唯一结论

**FAIL；P0=0，P1=1，P2=0。**

首个授权攻击向量 `RAW_DOT_SEGMENT_ALIAS` 形成未授权 raw gate 成功。输入的原始 request-target 为：

```text
POST /api/admin/alias/../session HTTP/1.1
Host: 127.0.0.1:3019
Origin: http://127.0.0.1:3019
peer: 127.0.0.1
```

固定候选在 raw gate 内先通过 `new URL(target, canonicalOrigin).pathname` 做路径规范化，随后得到 `/api/admin/session`。该请求没有被拒绝，返回的 `RawAdminContext.path` 为正式session路由，`reasonCode=null`。这违反“raw request-target在任何规范化和路由前拒绝危险别名”的安全下界。

本轮仅执行这一条最小、无实例、无DB攻击。首错出现后立即停止，其余成功路径或负例没有运行，避免用后续结果覆盖失败。

## 2. 固定候选与证据

| 对象 | 任务固定 SHA-256 | 本轮结果 |
|---|---|---|
| 开发报告 | `65d2ea230c0b78da12c0407b2a1e0fc0c84980502b6324621a33694546d99374` | MATCH |
| 开发manifest | `7b0658d9972df676acec689cb3d99ea23e74bf1abc2e51f9a169a9aa49b187b3` | MATCH |
| `server.ts` | `5c40918c7ac45aa809ed106acdfa00c9b6d5c52fb90a0b9995a0a3998d83378f` | MATCH |
| `no-egress.ts` | `5f008507164f2a1b8678435ec491e31bf6235700c50844ec1dca3801ada756d2` | MATCH |
| `source-management-no-egress.test.ts` | `7e35d4c92470ccd92d815c80437d189a64713e763af10de058bfc99ff548cabd` | MATCH |
| formal closed DB | `ddf3778c62cf95f195b1f08db8b075d676069f4cc9fb39804063e1004dd2e939` | MATCH，零修改 |

安全部机器manifest：

```text
docs/collaboration/部门/安全部/报告/TASK-20260810-A5F239-evidence/manifest.json
SHA-256=92339f02cf0f30075e1059b8e41df0d1d0c6b60f4236119917b8d4ebc138d764
```

独立探针使用固定Node `24.18.0`，探针SHA为 `365a919bb3eae9cdebe08421daf83c06004b7186208e0dc8077056d5c33fbc3a`。探针直接调用固定候选的 raw gate，没有启动HTTP listener或产品实例，没有打开数据库。

## 3. 首错机器收据

```json
{
  "vector": "RAW_DOT_SEGMENT_ALIAS",
  "rawTarget": "/api/admin/alias/../session",
  "outcome": "UNAUTHORIZED_RAW_GATE_SUCCESS",
  "normalizedPath": "/api/admin/session",
  "reasonCode": null,
  "externalCalls": 0,
  "productInstanceStarted": false,
  "databaseOpened": false
}
```

影响边界：session创建路由按设计无需既有session或CSRF；raw别名被映射到该正式路由后，攻击者若同时满足loopback/Host/Origin及canonical `{}` body条件，可能从非注册原始路径抵达session创建处理。当前最小探针已证明raw授权层未拒绝别名；依任务首错规则，没有继续启动实例验证业务副作用。

## 4. 最小修复合同

开发 successor 只需在 raw gate 增加规范化前的request-target拒绝，不应修改产品合同、session/CSRF语义、路由或数据库：

1. 在调用URL解析、pathname规范化、框架路由或percent decode前检查原始request-target；
2. 原始path出现`.`或`..` segment、percent-encoded dot segment及其大小写/混合编码变体时固定拒绝；
3. 原始path出现raw或percent-encoded slash/backslash、反斜杠别名、双重分隔或规范化后path与原始path不逐字一致时固定拒绝；
4. query如获允许，应与raw path分离后检查；不得让query参与path规范化比较；
5. 所有拒绝发生在session、nonce、receipt、Source、Outbox、AuditEvent或DB变化前，返回固定allowlist reason且不回显raw target；
6. 具体解析和实现方式由开发部选择；安全出口只要求raw-before-normalization、closed reject和零副作用。

后继测试至少覆盖raw `.`/`..`、`%2e`组合、encoded slash、raw/encoded backslash、重复分隔、大小写percent encoding、双重编码和正常exact path；所有危险向量必须在raw gate拒绝，正式exact路径继续可达。

## 5. NOT_RUN

按“首错即停”，以下授权范围全部保持NOT_RUN：

- 其余raw peer/request-target、Host/Origin、Forwarded/X-Forwarded、encoded slash/backslash变体；
- 单ACTIVE session、随机材料失败、cookie、refresh/destroy、absolute/idle过期；
- CSRF TTL、重放、method/path/body binding及并发消费；
- command/business/task/lease identity冲突与source_id截断碰撞；
- SQL/字段注入、baseline不可变、local overlay、第二writer/profile、路径与权限隔离；
- audit/receipt/ledger篡改、错误脱敏和token/hash/path泄漏；
- live no-egress、外部I/O与完整清理链。

这些NOT_RUN项不能从开发报告继承为安全部独立PASS，也不表示已发现其他缺陷。

## 6. 隔离与清理

- 产品实例创建数：0；listener/端口创建数：0。
- formal DB打开数：0；formal DB写入数：0；closed DB SHA前后保持任务值。
- external I/O：0；没有DNS、HTTP(S)、socket、provider或外部进程调用。
- profile lock、WAL、SHM：均不存在。
- 任务专属临时根已精确清理；探针没有残留进程或文件。
- 产品代码、正式DB、依赖、UI、Spec、ADR和网络配置均未修改。

## 7. 已验证、未验证与错题自检

### 已验证

- 开发报告、开发manifest、三候选及closed DB精确SHA均匹配。
- RAW_DOT_SEGMENT_ALIAS在固定候选中由raw target规范化为正式session path并未授权通过。
- 首错证据已写入独立机器manifest；formal DB/实例/外联均为0，临时根已清理。

### 未验证

- 修复代码尚未产生；危险path变体矩阵尚未运行。
- session/CSRF/identity/SQLite/audit/no-egress的独立安全攻击全部NOT_RUN。
- 真实provider、外部API、public/Admin UI、生产和部署继续未授权。

### 错题自检

- 没有把合法Origin或loopback等同于原始路径安全；raw target仍需独立精确校验。
- 没有启动产品实例来扩大已足够明确的首错。
- 没有在首错后继续跑其余向量，也没有用开发PASS覆盖安全FAIL。
- 没有修改候选或正式DB；没有发生外部I/O。
- 已把具体实现选择留给开发部，只冻结最小安全出口。

TASK_STATE_OK
