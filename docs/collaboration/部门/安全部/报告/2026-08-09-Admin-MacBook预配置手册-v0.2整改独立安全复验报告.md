---
title: Admin MacBook 预配置手册 v0.2 整改独立安全复验报告
type: audit_report
department: 安全部
target: F1+1 专用 Admin MacBook 服务器预配置手册 v0.2 successor
status: final
date: 2026-08-09
related_task: TASK-20260809-ECEC1F
decision: pass
tags: security,admin,macbook,rpo,rto,break-glass,public-host
summary: 固定v0.2 successor完整关闭前序两项P1和两项P2，双哈希未漂移且未发现新P0/P1；保留一个恢复点时间字段定义P2
---

# Admin MacBook 预配置手册 v0.2 整改独立安全复验报告

## 1. 唯一结论

**PASS。P0=0，P1=0，P2=1。**

本结论只覆盖前序安全报告 `TASK-20260809-48792F` 的 2 项 P1、2 项 P2及其直接回归面。v0.2 已把四项缺口转为明确、可失败关闭、需要运行收据才能放行的合同；未发现公网 Admin、认证绕过、第二写主、共享主库/密钥/身份或双向数据流等新 P0/P1。

本 PASS 不代表真实 MacBook、iPhone、public-host、私有网络、备份或生产部署已通过。

## 2. 双哈希绑定

| 对象 | 任务固定 SHA-256 | 复验前 | 复验后 | 结论 |
|---|---|---|---|---|
| v0.2 successor | `c33ec34a656996812e0c301458b043938ce4245d792738f15536d7c12648d8e8` | 匹配 | 匹配 | 未漂移 |
| v0.1 历史基线 | `cf87d710fe47b0778c96e82fbf7ff862aac9519568c9de4a433a88cb6973f8c0` | 匹配 | 匹配 | 未漂移 |

v0.2 以窄范围 successor 继承 v0.1，只在四项安全发现上覆盖；v0.1 正文没有被改写。

## 3. 前序发现逐项复验

### P1-1：RPO 超限后写入冻结不完整——已关闭

v0.2 §1 已形成单一 `RPO_BREACH`：

- 触发覆盖 `backup_age_seconds>=900`、可信时钟异常、远端认证回读非 PASS、恢复点身份/年龄不可证明；
- 输出固定为 `persistentWritesAllowed=0` 与 `writerFenceStatus=fenced`，明确废止“只关高风险 mutation”；
- 冻结集覆盖采集、处理、摘要/媒体、信源、审核、发布、权限/设备、应用/系统配置及其任务、游标、lease、重试、hash、投影和凭据状态；无法证明可重建时默认冻结；
- 继续能力只允许不改变业务真值/会话/缓存/游标的诊断只读、last-known-good public `GET/HEAD` 与只读健康/备份验证；一旦需要持久写即拒绝；
- 解冻仅允许 `RPO_BREACH -> READY` 一次原子转换，且 Online Backup、封闭快照、hash/manifest/signature、异机认证回读、下载解密、SQLite 完整性、可信 UTC、writer=1/旧主 fencing/CAS/epoch/policy 全部绑定同一新 `recoveryPointId`、source cut 与 canonical manifest；任何 failed/unknown/missing 均保持冻结。

判定：前序 P1-1 已关闭，且 mandatory receipt 明确要求四类触发、每类持久写拒绝、失败不解冻和原子解冻证据。

### P1-2：RTO 起点和终点不唯一——已关闭

v0.2 §2 已规定：

- 起点为 `service_unavailable_at`、`trusted_monitor_first_failure_at`、`human_discovered_at` 中最早可证可信 UTC；
- `incident_declared_at` 只记录响应启动，不得覆盖或重置起点；
- 无可证起点或时钟异常固定输出 `UNKNOWN_FAIL`，不得用任务开始时间或人工估算补齐；
- 终点取六项全部 PASS 的最晚时间：私有 Admin/公网 listener=0、Mac/iPhone 全 Function ID 等价、writer=1/旧主 fenced、同一恢复点数据库完整、public-host last-known-good 或新签名投影可用、break-glass/临时能力归零；
- failed 为 FAIL，unknown/missing 为 `UNKNOWN_FAIL`；仅全部 PASS 且持续时间不超过 14400 秒时允许 PASS；
- receipt 必须保存三个候选起点及 provenance、六项终点证据与各自 PASS 时间。

判定：前序 P1-2 已关闭，延迟宣告不能缩短 RTO，未完成全链不能提前停止计时。

### P2-1：break-glass 未进入操作表和证据包——已关闭

v0.2 §3/§5 新增 `C-06` 与 mandatory `BREAK-GLASS-RECEIPT`：默认关闭、具名 actor/incident/scope、逐次批准、仅私有 overlay 或受控本地/带外、最长 30 分钟、不续期、不自动重开、自动撤销、临时能力归零回读及关闭失败隔离均已明确。

全过程不得绕过 passkey、有效 session、精确 Origin、一次性 CSRF、CAS 和五重 fence；不增加第二写主，不允许 public-host 成为 Admin 入口。关闭/失效回读失败时立即隔离 Admin，远程 Admin 与 mutation 归零。

判定：前序 P2-1 已关闭。

### P2-2：public-host 负向隔离证据不完整——已关闭

v0.2 §4/§5 固定 `PUBLIC-NEG-01..05`，要求同一 public-host 候选哈希下证明：

1. `/admin`、`/api/admin/*`、Admin mutation/upstream/listener 不可达；
2. 无主库、DB/WAL/SHM/journal、主库备份、共享挂载或 Admin 数据路径；
3. 无 Admin session/passkey/CSRF secret、备份解密材料、投影签名私钥或高权限凭据，仅允许验签公钥和最小接收身份；
4. 数据只允许 Admin 唯一写主→完整签名公开投影→public-host，禁止 pull 主库、回写 Admin 或生成发布真值；
5. 两主机系统账号、service identity、cookie domain、密钥域、文件系统、网络策略和部署凭据互不共享。

任一 unknown/missing/failed 均保持 production 关闭，不能把 public-host 提升为写主或恢复源；mandatory receipt 还绑定证据时间、probe/validator 版本和责任人。

判定：前序 P2-2 已关闭。

## 4. 新回归检查

| 回归面 | 结论 | 证据 |
|---|---|---|
| 公网 Admin | PASS | break-glass 仅恢复私有/本地/带外可达性，明确禁止公网 Admin；RTO 终点要求公网 listener=0 |
| 强认证与 fence | PASS | break-glass 不能绕过 passkey/session/Origin/一次性 CSRF/CAS/five fences |
| 第二写主 | PASS | RPO/RTO、break-glass、public-host 各处均保持 writer=1 与旧主/候选主 fenced |
| 主库/凭据共享 | PASS | `PUBLIC-NEG-02/03/05` 分别关闭文件族、密钥材料和共享身份域 |
| 双向数据流 | PASS | `PUBLIC-NEG-04` 仅允许单向完整签名公开投影，反向请求须有负例 |
| 部分解冻 | PASS | RPO 只允许同一新恢复点七门全过后的原子解冻，禁止混用旧点或逐项解冻 |
| 缺证据误报 PASS | PASS | 任一 mandatory receipt 缺失只能 `pending_implementation` 或 `fail_closed` |
| AUTH 停止线 | PASS | YAML 与正文均保持 planning-only、implementation unauthorized、production unauthorized；真实设备和外部动作需新 manifest/hash、设备身份、窗口和用户授权 |

未发现新 P0/P1。

## 5. P2 残余

### P2-1：`latest_recoverable_source_commit_completed_at` 需在实施合同中消除歧义

v0.2 §1.3 用 `trusted_now - latest_recoverable_source_commit_completed_at < 900s` 作为解冻条件。`source commit` 若被实现为“最近一次业务事务提交时间”，数据库空闲超过 15 分钟时，即使刚完成覆盖全部当前状态的新一致快照，仍会永久无法解冻；若被实现为“Online Backup 所绑定的源状态切点完成时间”，则符合本合同意图。

该问题当前表现为可用性/实现歧义，现有默认行为仍是 fail-closed，未形成越权或数据完整性放宽，因此列 P2。后继 production manifest/数据合同应明确：

- 字段指向本次恢复点捕获的源状态 cut/backup snapshot 完成时间，不是最后一次业务写入时间；
- 同时绑定源数据库身份、源事务/ledger high-water mark、snapshot 完成时间与远端回读完成时间；
- RPO age 的机械公式以最新“已完成且可恢复”的恢复点完成时间及其覆盖边界为准；空闲数据库不得因无新业务事务形成假性超龄；
- 时间或覆盖边界不能证明时继续 `RPO_BREACH`。

## 6. 已验证

- v0.2 与 v0.1 双 SHA-256 在复验前后精确匹配。
- 前序 2 项 P1、2 项 P2各自有唯一 successor 条款、阶段表行、失败动作和 mandatory receipt。
- RPO 全写冻结、同一恢复点原子解冻、RTO 最早起点/全链终点/Unknown-Fail。
- break-glass 默认关闭、具名、≤30m、不续期、自动撤销、强认证/fence 不可绕过。
- `PUBLIC-NEG-01..05` 对路由、主库/挂载、凭据/私钥、数据方向与共享身份域的负向隔离。
- planning-only、AUTH、production unauthorized 与“缺运行证据不得 PASS”的停止线。

## 7. 未验证

- 精确 MacBook、macOS、运营账号、FileVault、供电、overlay、可信时钟和 Mac/iPhone 实机能力。
- SQLite Online Backup、异机存储、签名/解密、RPO/RTO、break-glass 和 public-host 的任何运行收据。
- 真实公网负例、路由/监听、文件族、secret/keychain/IAM、双向请求与跨身份读取负例。
- production manifest、probe/validator 实现及 P2 时间字段的最终机器定义。

以上继续保持 `pending_implementation` / fail-closed；本报告不授权任何真实操作。

## 8. 错题自检

- 只复验任务限定的四项整改及直接回归，没有扩大为完整服务器方案重审。
- 没有把 v0.2 的“已验证”自述当作安全证据；逐项核对了触发、冻结、解冻、起终点、失败语义和 mandatory receipt。
- 没有因合同文本 PASS 推导实机或生产 PASS。
- 没有把 break-glass 当作公网备用入口，也没有允许它绕过应用认证或提升权限。
- 没有把 public-host 的公开 GET 能力外推为主库、Admin、备份或恢复能力。
- 对恢复点时间字段的语义歧义保留 P2和 fail-closed 实施门，没有隐瞒可用性风险。
- 未修改 v0.1、v0.2 或任何产品文档，未操作真实设备和外部资源。

TASK_STATE_OK
