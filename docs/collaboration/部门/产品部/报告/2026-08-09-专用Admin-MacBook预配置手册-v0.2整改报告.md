---
title: 专用 Admin MacBook 预配置手册 v0.2 整改报告
type: product_remediation_report
status: final
decision: pass
date: 2026-08-09
department: 产品部
related_task: TASK-20260809-D6C29A
security_input: TASK-20260809-48792F
implementation_authorized: false
external_calls: 0
---

# 专用 Admin MacBook 预配置手册 v0.2 整改报告

## 1. 结论

已新增 [F1+1 专用 Admin MacBook 服务器预配置手册 v0.2 successor](../../../../runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.2.md)，逐项关闭安全部 [独立安全复核报告](../../安全部/报告/2026-08-09-专用Admin-MacBook预配置手册独立安全复核报告.md) 的 `P1=2` 与 `P2=2`。v0.2 仍为 `planning_only`，未执行任何真实实施。

v0.1 作为固定审计历史保留，任务前后 SHA-256 必须均为：

```text
cf87d710fe47b0778c96e82fbf7ff862aac9519568c9de4a433a88cb6973f8c0
```

## 2. 四项缺口的关闭结果

| 安全缺口 | 整改结果 | 验收出口 |
| --- | --- | --- |
| `P1-1` RPO 超限后只冻结少数变更 | 统一 `RPO_BREACH`；将采集、处理、摘要/媒体、信源、审核、发布、权限/设备、配置全部无法证明可重建的持久写冻结 | 仅可证无真值变更查询和 last-known-good public GET 继续；同一新恢复点七门全 PASS 后原子解冻 |
| `P1-2` RTO 起止语义冲突 | 起点固定为服务不可用、可信监控首失败、人工发现三者中最早可证时间；`incident_declared_at` 只是响应字段 | 起点/时钟不可证固定 `UNKNOWN_FAIL`；终点要求 Admin、双端、writer/fence、DB/恢复点、public-host 全部 PASS |
| `P2-1` break-glass 缺显式执行与证据 | 新增 Phase C `C-06`，固定默认关闭、具名开启、≤30m、不续期、自动撤销、关闭失败隔离 | 证据包必须含开启/使用/撤销/归零，且不绕过 passkey/session/Origin/一次性 CSRF/CAS/fence，不使用公网 Admin |
| `P2-2` public-host 负向证据不足 | 新增 `PUBLIC-NEG-01..05` 隔离矩阵 | 必证 `/admin`/Admin API 不可达、无主库/挂载、无高权限/解密/签名私钥、身份/存储域隔离、只有单向签名公开投影 |

## 3. 产品语义检查

- `RPO_BREACH` 的触发、主 reason code 优先级、冻结操作、允许查询和解冻门已形成闭合集。
- 解冻需要同一 `recoveryPointId`、source commit、snapshot、hash/manifest/signature、远程认证回读、下载解密、SQLite 完整性和可信时钟，没有分步解冻。
- RTO 使用 `min(provable timestamps)` 和全服务终点；任一 mandatory 终点 unknown 都无法产生 PASS。
- break-glass 仅能恢复私有 overlay 或受控本地/带外访问，公网 Admin 全时为 0。
- public-host 只接收完整签名公开投影，没有 Admin、主库、解密材料、签名私钥或反向提升路径。

## 4. 变更范围

本任务只新增：

- `docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.2.md`；
- 本产品整改报告。

未修改 v0.1、accepted ADR、Spec、`app/`、`data/`、`design/` 或真实资源；未删除文件。真实设备/供应商/安装/账号/网络/端口/密钥/备份上传/故障注入/部署操作数均为 0。

## 5. 已验证

- v0.1 任务前固定 SHA-256 为 `cf87d710fe47b0778c96e82fbf7ff862aac9519568c9de4a433a88cb6973f8c0`；完成前将再次复算。
- 四项安全发现均有唯一合同入口、阶段表条目和实施证据包出口。
- 双主机、专用 Admin MacBook、独立 public-host、`writer_count=1`、公网 Admin=0、Mac/iPhone 等价、`RPO≤15m`、`RTO≤4h` 均未改变。
- 实施边界继续为 `planning_only`、`implementation_authorized=false`、`production_deployment=unauthorized`。

## 6. 未验证

- 任何真实 MacBook、macOS、账号、FileVault、供电、网络、overlay、时钟、SQLite、备份目标、签名/解密材料、public-host 或 Mac/iPhone 运行状态。
- `RPO_BREACH`、RTO、break-glass 和 public-host 负向矩阵的运行收据。
- 真实安装、注册、付费、探针、上传、故障注入和部署。

## 7. 错题自检

- 没有修改已按固定 hash 审查的 v0.1。
- 没有保留“RPO 超限只冻结高风险 mutation”的旧语义。
- 没有以 `incident_declared_at` 重置 RTO 起点。
- 没有让 break-glass 使用公网 Admin、续期、超过 30 分钟或绕过强认证/fence。
- 没有让 public-host 持有主库、共享挂载、Admin/备份解密/投影签名私钥或高权限凭据。
- 没有将 planning 文档写成真实实施 PASS。

TASK_STATE_OK
