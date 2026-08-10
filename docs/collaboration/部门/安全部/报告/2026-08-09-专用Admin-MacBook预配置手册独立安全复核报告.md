---
title: 专用 Admin MacBook 预配置手册独立安全复核报告
type: audit_report
department: 安全部
target: F1+1 专用 Admin MacBook 服务器预配置手册 v0.1
status: final
date: 2026-08-09
related_task: TASK-20260809-48792F
decision: fail
tags: security,admin,macbook,dual-host,sqlite,backup,recovery
summary: 固定手册快照的双主机、专用账号设备、私网入口、唯一写主和未授权动作停止线基本闭合，但RPO失效时仍允许部分持久写、RTO计时起点前后矛盾，当前不宜作为真实实施手册
---

# 专用 Admin MacBook 预配置手册独立安全复核报告

## 1. 唯一结论

**FAIL。P0=0，P1=2，P2=2。**

唯一审查对象为：

- `docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.1.md`
- 固定 SHA-256：`cf87d710fe47b0778c96e82fbf7ff862aac9519568c9de4a433a88cb6973f8c0`

审查前与审查后哈希一致，未发生候选漂移。手册对双主机隔离、专用设备、具名运营账号、无 sudo 非交互服务账号、个人同步禁区、无公网 Admin、唯一写主、SQLite Online Backup、加密异机保存、Mac/iPhone 功能等价及真实动作授权门写得较完整。两项恢复合同缺口会直接削弱已确认的 `RPO≤15m` / `RTO≤4h`，因此当前快照不能作为真实实施放行依据。

本 FAIL 只针对手册合同完整性；未操作真实 Mac、iPhone、路由器、账号、网络、密钥、备份服务或 public-host。

## 2. P0 / P1 / P2

### P0

无。

### P1-1：RPO breach 后仍允许未枚举的持久写

证据：

- §2 `F-01` 规定 `backupAge≥15m` 或时钟不可信时只关闭“高风险 mutation”。
- §3 的备份超龄行只明确关闭 `revision/approve/reject/publish` 和权限/设备变更。
- 同一 Admin 主机还承载采集、处理、信源与其他可写状态；这些写入没有被明确纳入关闭集合。

风险：当最近可恢复点已经达到 15 分钟时，任何继续提交到唯一写主的持久变更都会扩大潜在数据丢失窗口。此时仍宣称 `RPO≤15m` 缺少机械依据。

最小修订：

1. 将 `backupAge≥15m`、可信时钟 unknown、远端认证回读失败统一定义为 `RPO_BREACH`。
2. `RPO_BREACH` 时冻结所有会产生不可重建持久状态的写入；只允许明确列举、可证明不改变业务真值的查询与 last-known-good public GET。
3. 如确需继续某类写入，必须逐类证明其完全可重建、重建输入被异故障域持久化且同样满足 15 分钟边界；未证明即关闭。
4. 恢复条件绑定同一新恢复点的 Online Backup 完成、封闭、hash/manifest/signature、异机认证回读、解密/SQLite 校验与可信时钟，全部通过后才解除。

失败关闭：本项修订并经产品合同吸收前，真实 Admin mutation 和生产部署保持关闭。

### P1-2：RTO 计时起点前后矛盾

证据：

- §1 `U-RECOVERY-09` 正确写明 `RTO≤4h` 从“设备不可用时”开始计时。
- §2 `F-06` 又把验收窗口写为 `incident_declared_at` 到恢复完成不超过 4 小时。

风险：故障发生与人工宣告之间的延迟可被排除在指标外，形成可人为缩短的 RTO 收据。无人值守、告警延迟或夜间故障时尤为明显。

最小修订：

1. 唯一计时起点取 `service_unavailable_at`、可信监控首次失败时间、人工发现时间三者中的最早可证时间；同时保留 `incident_declared_at` 作为响应流程字段，不作为 RTO 起点。
2. 时钟不可信或无法确定最早故障时刻时，RTO 结果为 Unknown/FAIL，不得从宣告时刻重置。
3. RTO 终点必须同时满足：Admin 私有入口恢复、Mac/iPhone 同能力集通过、writer=1、旧主 fenced、数据库/恢复点完整、public-host last-known-good 或完整投影可用。
4. 恢复演练收据同时保存原始监控时间、宣告时间、各阶段时间和最终恢复时间。

失败关闭：计时合同统一前，任何“RTO≤4h 已验证”结论均禁止；真实实施仍需独立授权。

### P2-1：break-glass 关键动作只靠上游合同继承

手册顶部声明继承双主机实施合同，但正文预配置表和实施证据包没有单列 break-glass 的默认关闭、具名开启、最长 30 分钟、不续期、自动撤销、关闭失败隔离与回读字段。对操作型手册而言，这增加实施人员漏项概率。

建议：在 Phase C 和证据包中增加独立行，逐字绑定上游合同；公网 Admin 仍保持 0，应急只恢复私有或受控本地/带外可达性，且不得绕过 passkey/session/Origin/一次性 CSRF/CAS/fence。

### P2-2：public-host 的负向隔离证据未完整落入实施证据包

§0 已禁止 public-host 持有主库、Admin mutation、备份解密材料与签名私钥；§4 证据包主要要求 public GET 与入口核对，没有逐项要求证明 `/admin`/Admin API 不可达、主库/共享挂载不存在、Admin/备份解密/签名私钥不存在、跨主机仅单向签名投影。

建议：在实施证据包新增 public-host 负向矩阵，并要求不同系统账号、服务身份、密钥域、session cookie、部署凭据、网络策略和文件系统的回读证据；任一 Unknown 时 public-host 提升与 Admin 生产部署均关闭。

## 3. 分项判定

| 审查项 | 判定 | 证据与边界 |
|---|---|---|
| 固定候选 | PASS | 审查前后 SHA-256 均为 `cf87d710…3f8c0` |
| 双主机 | PASS（P2） | Admin/public-host 物理与信任域分离、投影单向、public-host 无写主；实施证据包负向项需补齐 |
| 账号与设备 | PASS | 专用设备、个人 iCloud/同步/profile 禁止；具名最小运营账号；服务账号非交互、无 admin/sudo |
| 磁盘保护 | PASS | FileVault、自动登录关闭、恢复材料离机且仓库不保存真实 key；实机状态仍 Unknown |
| 网络 | PASS（P2） | Admin 公网 listener、转发、UPnP、公网隧道均要求为 0；私有 overlay 不替代应用认证；应急入口需在手册表内显式化 |
| 进程与运行时 | PASS | 固定 Node 24.18.0、最小 launchd 环境、非 root UID、日志脱敏、循环重启关闭 |
| SQLite 唯一写主 | PASS | `writer_count=1`；unknown 或多写主时 mutation=0 并 fence 全部候选；DB/WAL/SHM 文件族纳入检查 |
| 一致备份 | PASS | 每≤5m Online Backup、封闭快照、完整性检查、hash/manifest/signature、异机加密与认证回读；禁止复制活跃 DB/WAL/SHM 冒充备份 |
| RPO≤15m | FAIL | 超龄后只关部分写入，不能机械保证所有不可重建数据损失窗口≤15m |
| RTO≤4h | FAIL | “设备不可用”与 `incident_declared_at` 两种起点冲突 |
| Mac/iPhone 等价 | PASS | 两端全 Function ID、同 API/主库/权限集；允许布局差异和高风险再认证，不允许功能删减 |
| 未授权动作停止线 | PASS | 安装、登录、购买、账号/网络/密钥/备份上传/部署均停在 AUTH；需 immutable production manifest/hash、精确设备与用户实施授权 |

## 4. 已验证

- 固定手册文件的完整 SHA-256，审查期间零漂移。
- 手册全文及其指向的现行双主机、专用 MacBook 补充合同的相关静态条款。
- 双主机、公网 Admin=0、单向只读投影、public-host 禁止持有主库和高权限凭据。
- 专用设备、账号、FileVault、自动登录、Sharing/Firewall/路由器、供电/睡眠/更新的规划与停止线。
- SQLite 唯一写主、文件族、Online Backup、manifest/hash/signature、异机加密、恢复与告警合同。
- Mac/iPhone 功能等价、高风险再认证边界及真实动作授权分层。

## 5. 未验证

- 精确 MacBook 型号、macOS build、FileVault、账号/UID、自动登录、Sharing、Firewall、睡眠、供电、散热和实际进程基线。
- Mac/iPhone 私有 overlay、中国大陆网络、控制面/relay、应用认证、passkey/session/Origin/CSRF/freshness 的真实组合。
- public-host 资源、DNS/TLS、网络 ACL、投影传输、负向凭据/挂载检查。
- SQLite 生产路径、并发写、磁盘满、断电、Online Backup 调度、异机存储、加密/解密和恢复演练。
- 真实 `RPO≤15m`、`RTO≤4h` 计时及告警送达。
- 官方页面的现时版本细节；本任务没有联网刷新，手册也明确要求目标 OS/固定 Node 版本在实施时复核。

以上均保持 Unknown/fail-closed，不构成设备或生产放行。

## 6. 错题自检

- 只审查固定 SHA 快照，未把上游 accepted 合同或产品报告的结论当作本部门 PASS。
- 没有因“planning_only”降低恢复合同门槛；真实手册会影响后续操作，RPO/RTO 的机械歧义按 P1 处理。
- 没有把私有网络连通性当作认证、设备准入、session 或 freshness。
- 没有把 Online Backup 命令成功当作可恢复；仍要求封闭、hash/manifest/signature、异机认证回读、解密/SQLite 校验和隔离恢复演练。
- 没有把 Mac/iPhone 布局差异误判为能力降级；两端全功能是硬约束。
- 没有修改手册、Spec、ADR、app、data、design，也没有操作真实设备或外部资源。

TASK_STATE_OK
