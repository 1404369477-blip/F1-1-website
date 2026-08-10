---
title: F1+1 专用 Admin MacBook 服务器预配置手册 v0.2 successor
type: planning_runbook_successor
status: planning_only
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-D6C29A
predecessor: docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.1.md
predecessor_sha256: cf87d710fe47b0778c96e82fbf7ff862aac9519568c9de4a433a88cb6973f8c0
security_review: TASK-20260809-48792F
implementation_authorized: false
production_deployment: unauthorized
---

# F1+1 专用 Admin MacBook 服务器预配置手册 v0.2 successor

## 0. Successor 身份与使用规则

本文是 [v0.1 手册](./F1+1-专用Admin-MacBook服务器预配置手册-v0.1.md) 的窄范围 successor。v0.1 的固定 SHA-256 为 `cf87d710fe47b0778c96e82fbf7ff862aac9519568c9de4a433a88cb6973f8c0`，其字节保持不变。当两份文档在下列四项上有差异时，以 v0.2 为准；其余设备、账号、操作系统、专用机、双主机、唯一写主、私有 Admin、Mac/iPhone 功能等价、`RPO≤15m`、`RTO≤4h` 及授权停止线继续继承 v0.1。

| 安全发现 | v0.2 唯一修正入口 | 关闭结果 |
| --- | --- | --- |
| `P1-1` RPO 超限后写入冻结不完整 | 第 1 节 | 一个 `RPO_BREACH`、完整持久写冻结集、同一新恢复点门禁 |
| `P1-2` RTO 起点和终点不唯一 | 第 2 节 | 最早可证起点、完整服务终点、Unknown/FAIL 唯一 |
| `P2-1` break-glass 缺实施表与证据 | 第 3、5 节 | 显式 Phase C 硬门和必交证据包 |
| `P2-2` public-host 缺负向隔离证据 | 第 4、5 节 | 固定负向矩阵和失败关闭 |

本文仍为 `planning_only`。它不授权真实设备操作、安装、账号、供应商、网络、端口、密钥、备份上传、真实探针或部署。

## 1. `RPO_BREACH` 闭合合同

### 1.1 触发集与唯一状态

任一条件成立即原子进入 `RPO_BREACH`：

1. `backup_age_seconds >= 900`；
2. `trusted_clock_status != trusted`，包含 absent、unknown、rollback、future、parse_error 或无法把各证据时间放入同一可信 UTC 时间线；
3. `remote_authenticated_readback_status != pass`，包含 failed、timeout、unknown、missing；
4. `latest_recoverable_point_id`、其 source commit 或年龄无法证明。

主 reason code 只能从以下闭合集中选择：

- `RPO_BREACH_BACKUP_AGE`
- `RPO_BREACH_CLOCK_UNTRUSTED`
- `RPO_BREACH_REMOTE_READBACK`
- `RPO_BREACH_RECOVERY_POINT_UNPROVABLE`

同时命中多个原因时，按上述顺序产出主码，其余作为去重后的 `secondaryReasonCodes`。一旦进入，必须输出 `rpoState=RPO_BREACH`、`persistentWritesAllowed=0`、`writerFenceStatus=fenced`；不得使用旧的“只关高风险 mutation”语义。

### 1.2 必须冻结的持久写入

冻结对象是任何无法由最新已证明恢复点确定性重建的持久变更。无法证明可重建时，必须冻结。闭合集为：

| 领域 | `RPO_BREACH` 期间冻结的操作 |
| --- | --- |
| 采集 | 新建/领取/完成采集任务，CapturedItem/Observation/Inbox/Outbox 写入，游标、尝试、lease 与重试状态推进 |
| 处理 | 规范化、去重、Event/Content 及 canonical 成员变更，质量/F1 相关性决定，处理任务状态推进 |
| 摘要与媒体 | Summary、ReleaseBundle、MediaCandidate、版本、快照、hash 或关联写入 |
| 信源 | 新增、编辑、启用、禁用、排序、provider/adapter/config/epoch/fence 变更 |
| 审核 | 修订、批准、拒绝、ReviewDecision 与审核队列变更 |
| 发布 | Publication 创建/排队/重试/发布/更正/撤回/对账，PublishedProjection 生成/激活，public-host 新投影推送 |
| 权限与设备 | 账号、角色、权限、passkey、session、CSRF、设备准入/撤权、overlay policy/freshness 变更 |
| 应用与系统配置 | feature flag、运行参数、schema/migration、密钥/签名材料、备份策略/保留、writer/lease/fence 策略变更 |

进入冻结时，未提交的事务必须回滚；已领取但尚未结算的操作必须被 fence，不得用一条新的持久状态“补记”完成。

继续能力只有：

- 经同候选测试证明不改变业务真值、不旋转会话/缓存/游标的诊断性只读查询；
- public-host 对 last-known-good 已激活投影的只读 `GET/HEAD`；
- 只读健康、时钟、备份对象与签名验证。

上述调用一旦需要持久写、更新游标或改变业务可见结果，立即拒绝。

### 1.3 同一新恢复点解冻门

解冻只允许一次原子转换：`RPO_BREACH -> READY`。以下所有证据必须绑定同一个新 `recoveryPointId`、同一 source commit 和同一 canonical manifest：

1. SQLite Online Backup 从唯一写主完成；snapshot 已封闭，源/目标连接关闭，WAL/SHM 处理有固定收据。
2. snapshot `bytesSha256`、canonical `manifestSha256`、签名和签名公钥版本全部 PASS。
3. 异机加密对象已完成远程认证回读；回读对象 ID、字节数、snapshot hash、manifest hash 和签名与第 1–2 步一致。
4. 从该远程对象下载到干净临时目标并成功解密；下载字节 hash 一致。
5. 下载后 SQLite `quick_check`、`integrity_check`、schema fingerprint、migration ledger 和业务不变量全部 PASS。
6. 可信 UTC 恢复，`trusted_now - latest_recoverable_source_commit_completed_at < 900s`，且无回拨/未来签发/解析异常。
7. `writer_count=1`，旧主与所有候选写主已 fence，无未对账的在途写操作；所有 CAS、epoch、policy 和 fence 已以当前值重验。

任一项 failed/unknown/missing 即输出 `RPO_RECOVERY_VALIDATION_FAILED`，保持 `RPO_BREACH`和 `persistentWritesAllowed=0`。不允许逐项解冻、旧恢复点与新回读对象混用，也不允许仅依靠上传成功或主机本地 hash 解冻。

## 2. RTO 计时与 Unknown/FAIL 闭合合同

### 2.1 唯一起点

先从以下三个字段中取得能用可信 UTC 证明、并能放入同一时间线的值：

- `service_unavailable_at`；
- `trusted_monitor_first_failure_at`；
- `human_discovered_at`。

`rto_start_at = min(provable timestamps)`。`incident_declared_at` 只记录人员启动响应的时间，不参与起点选择，不得覆盖或重置 `rto_start_at`。

若可证集为空，或时钟不可信、回拨、未来、解析失败、时区/单调关系无法证明，固定输出：

```text
rtoResult=UNKNOWN_FAIL
reasonCode=RTO_START_OR_CLOCK_UNPROVABLE
productionReady=false
```

不得以 `incident_declared_at`、任务开始时间或手工估算补齐。

### 2.2 唯一终点

`rto_end_at` 只能是下列全部条件的最晚 PASS 时间：

1. 一个 manifest 批准的私有 Admin origin 可用，公网 Admin listener 为 0；
2. Mac 与 iPhone 对同一全量 Admin Function ID 集完成功能、失败、恢复与审计等价回验；
3. `writer_count=1`，旧主和所有候选写主已 fence；
4. 唯一业务数据库以同一已证恢复点完成解密、hash、SQLite 完整性、schema/ledger 与业务不变量验证；
5. 独立 public-host 满足二者之一：继续为 last-known-good 已激活投影服务且 public `GET` PASS；或新的完整签名投影已推送、原子激活、active receipt 与 public `GET` PASS；
6. break-glass 和临时能力已关闭，公网 Admin、临时 listener、临时会话/设备准入、staging 均为 0。

任一条件为 failed 则 `rtoResult=FAIL`；任一条件为 unknown/missing 则 `rtoResult=UNKNOWN_FAIL`。只有全部 PASS 且 `rto_end_at - rto_start_at <= 14400s` 时才输出 `rtoResult=PASS`。

### 2.3 必交 RTO receipt

RTO receipt 必须至少包含：`incidentId`、三个候选起点及各自 provenance/trust status、`rtoStartAt`、`rtoStartProvenance`、`incidentDeclaredAt`、第 2.2 节六项终点证据的 ID/hash/PASS 时间、`rtoEndAt`、`durationSeconds`、`rtoResult`、`reasonCode`。

## 3. Phase C 的 break-glass 显式门

v0.1 Phase C 追加以下必要行；任何实施合同都必须逐字保留。

| ID | 项目 | `PREP｜现在可准备` | `DECIDE｜需用户决策` | `AUTH｜需真实实施授权` | `VERIFY｜实施后验收` | Owner | 失败关闭与恢复 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `C-06` | break-glass 私有应急入口 | 准备具名开启人、incident/ticket、作用域、`openedAt/expiresAt`、自动撤销、回读与隔离模板；默认关闭 | 具名开启人与事故范围；每次只能单独批准，不预授权下一次 | 只允许私有 overlay 或受控本地/带外入口；最长 30 分钟，不续期、不自动重开；禁止公网 Admin | 回读具名 actor、作用域、时间、自动撤销、临时会话/策略/entry=0、无公网 Admin；passkey/session/Origin/一次性 CSRF/CAS/fence 均 PASS | 用户/安全/运营/测试 | 关闭或自动失效回读失败：立即隔离 Admin 主机，关闭全部远程 Admin 与 mutation，撤销相关会话/设备/凭据，保全脱敏审计，回读为 0 后才可重新认证 |

break-glass 无论在开启、使用或关闭阶段，都不得绕过 passkey、有效 session、精确 Origin、一次性 CSRF、对象 CAS 和五重 fence。它不增加第二个写主，不变更 `writer_count=1`，不允许 public-host 成为 Admin 入口。

## 4. public-host 负向隔离矩阵

该矩阵必须在真实实施后对同一 public-host 候选 hash 出具证据。任一项 unknown/missing/failed 都使 production 保持关闭，也不得把 public-host 提升为写主或恢复源。

| `PUBLIC-NEG-*` | 必须证明的负向事实 | 最小实施后证据 | 失败动作 |
| --- | --- | --- | --- |
| `PUBLIC-NEG-01` | `/admin`、`/api/admin/*` 及 Admin mutation 不可达；无 Admin upstream/listener | 外部及主机本地负例、route 清单 hash、listener/upstream 清单 | 隔离 public-host，删除 route/upstream，撤销可能暴露的会话与凭据，复验后才恢复 public GET |
| `PUBLIC-NEG-02` | 无主库、无活跃 DB/WAL/SHM/journal、无主库备份、无共享挂载或到 Admin 数据目录的路径 | fs/mount/volume/container 清单、禁止路径负例、文件族扫描 | 隔离主机，删除副本/挂载，将主库作潜在暴露处理并复验 |
| `PUBLIC-NEG-03` | 无 Admin 会话/passkey/CSRF 秘密，无备份解密材料，无投影签名私钥，无主库、Admin、备份或部署高权限凭据 | secret/config/env/keychain/IAM 字段级 allowlist 与禁止键扫描；只允许投影验签公钥和最小接收身份 | 停 public-host，撤销/轮换受影响凭据，用干净候选重建 |
| `PUBLIC-NEG-04` | 数据方向只能为 `Admin 唯一写主 -> 完整签名公开投影 -> public-host`；public-host 不 pull 主库、不回写 Admin、不生成发布真值 | 网络边、业务路由、签名验证、反向请求负例、`writer_count=1` 收据 | 拒绝投影候选，隔离双向链路，保留 last-known-good public 投影或失败关闭 |
| `PUBLIC-NEG-05` | Admin 与 public-host 的系统账号、service identity、cookie domain、密钥域、文件系统、网络策略和部署凭据互不共享 | 双端候选 manifest/hash 的差集收据与反向登录/读取负例 | 关闭受影响主机，拆分身份/凭据/存储域并完整轮换 |

## 5. v0.2 阶段表增量与实施证据包

### 5.1 阶段表必须追加的四行

| ID | 项目 | `PREP｜现在可准备` | `DECIDE｜需用户决策` | `AUTH｜需真实实施授权` | `VERIFY｜实施后验收` | 失败关闭 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `F-07` | `RPO_BREACH` 与恢复点 | 准备第 1 节的 reason/冻结/解冻 receipt 模板 | 无新产品选择；不得放宽 15m | 需后继 manifest 精确授权调度、存储、签名、回读和恢复 | 三触发+时钟/age unprovable 均冻结；全写集=0；同一新恢复点全门 PASS 才原子解冻 | 任一证据缺失继续 `RPO_BREACH` |
| `F-08` | RTO 计时 | 准备三起点、六终点和 Unknown/FAIL receipt 模板 | 无新产品选择；不得用 declaration 重置起点 | 真实故障注入和恢复演练需精确候选/窗口授权 | 最早可证起点至全链恢复终点≤14400s；时间不可证即 `UNKNOWN_FAIL` | 任一终点未 PASS 不停止计时；缺失不得记 PASS |
| `C-06` | break-glass | 见第 3 节 | 具名开启人/事故范围逐次决定 | 只私有/本地，≤30m，不续期、不绕过强认证 | 开启、使用、自动撤销、关闭失败隔离及回读全收据 | 关闭失败立即隔离 Admin，全部远程 Admin/mutation=0 |
| `F-09` | public-host 负向隔离 | 准备 `PUBLIC-NEG-01..05` 证据模板 | 无新产品选择；双主机不合并 | 真实 public-host 候选和负例探测需精确授权 | 五组负例绑定同一候选 hash PASS，仅单向签名 public 投影 | 任一 unknown/fail 保持 production 关闭，不可提升为写主 |

### 5.2 真实实施后的 mandatory 证据包增量

在 v0.1 第 4 节六类证据之外，必须绑定同一 production manifest/hash 追加：

1. `RPO-BREACH-RECEIPT`：四类触发各一次，冻结表每类持久写各一个拒绝负例，只读/public GET 正例，同一新恢复点七门、失败不解冻及原子解冻收据。
2. `RTO-RECEIPT`：三个候选起点及 provenance，最早选择，`incident_declared_at` 不重置，时钟/起点 unprovable 的 `UNKNOWN_FAIL`，六项终点与≤4h 判定。
3. `BREAK-GLASS-RECEIPT`：默认关闭负例、具名 actor/incident/scope、`openedAt`、`expiresAt`、≤30m、不续期、自动撤销、临时能力归零回读，关闭失败隔离，以及 passkey/session/Origin/一次性 CSRF/CAS/fence 全程不可绕过的负例。
4. `PUBLIC-HOST-NEGATIVE-RECEIPT`：第 4 节 `PUBLIC-NEG-01..05` 逐项 PASS，精确绑定 public-host 候选 hash、证据时间、probe/validator 版本和责任人。

任一 mandatory 证据缺失时，状态只能是 `pending_implementation` 或 `fail_closed`，不得填 PASS、不得用文档完成替代运行收据。

## 6. 当前验证边界和停止线

### 已验证

- 安全部 `TASK-20260809-48792F` 的 `P1-1` / `P1-2` / `P2-1` / `P2-2` 在本文有唯一对应入口。
- v0.1 固定 SHA-256 已绑定；v0.2 没有要求修改 v0.1 正文。
- 冻结集覆盖采集、处理、摘要/媒体、信源、审核、发布、权限/设备、应用/系统配置；无法证明可重建的写入不享受例外。
- RTO 起点、终点、PASS、FAIL 和 `UNKNOWN_FAIL` 都有唯一机械判定。
- break-glass 和 public-host 负向矩阵已同时进入阶段表与必交证据包。

### 未验证

- 精确 MacBook、macOS、运营账号、供电、私有 overlay、可信时钟、SQLite Online Backup、异机存储、签名/解密材料、public-host 和 Mac/iPhone 能力。
- 任何 RPO/RTO、break-glass 或 public-host 运行收据。
- 真实设备、账号、网络、端口、密钥、上传、故障注入和部署。

上述未验证项全部保持关闭。后续真实操作必须使用不可变 production manifest/hash、精确设备/主机身份、授权窗口、回退和删除边界再次向用户请求授权。
