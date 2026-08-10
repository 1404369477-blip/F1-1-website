---
type: product_decision_package
status: final
decision: proposed
date: 2026-08-02
department: 产品部
task_id: TASK-20260802-214FED
domain_stage: M4-C-VS0-threat-model
decision_scope: M4 本地 SQLite 同 UID 威胁模型与 R5 收口
user_confirmation_required: true
---

# TASK-20260802-214FED｜M4 本地 SQLite 同 UID 威胁模型与 R5 收口决策包

## 1. 结论与当前门禁

本报告只提出产品选择，不接受任何方案，不修改 accepted ADR、Spec 或 app。

当前证据把两个门禁区分开：

- C local preflight 的 Node 24 / SQLite 基础能力已有开发部 PASS 收据；该收据覆盖 SQLite 版本、WAL、锁、事务、恢复和权限样例。
- 安全部 TASK-20260802-29333B 的独立终审为 FAIL / P0=1 / P1=5 / P2=4。唯一 P0 命中 accepted R5：SQLite 主库、父目录和 WAL/SHM/journal 文件族尚未证明在恶意同 UID 进程竞争下稳定打开。

因此，选择前状态为：

| 阶段 | 现行状态 | 解释 |
|---|---|---|
| VS-0 | 本地静态地基和工具链可保留；SQLite-backed seed/Repository 的 R5 安全放行阻断 | C local preflight PASS 不能覆盖安全终审 P0；不宣称 VS-0 最终安全 PASS |
| VS-1 | pending / closed | 未启动，也不因本地 SQLite 预检或 fixture 收据自动开放 |
| 外部能力 | 关闭 | 不连接 Base/provider/Collector，不采集、不发布、不部署 |

## 2. 只读证据与威胁模型边界

本包只读核对以下现行证据：

| 证据 | 精确落点 | 用途 |
|---|---|---|
| 当前 Spec | docs/spec.md §7.2，R5 行 | accepted 安全 predicate 与测试门禁 |
| accepted M4 ADR | docs/decisions/system/2026-08-01-F1+1-M4本地Kickoff系统路线-accepted.md §4.7 | accepted R5 的系统级合同 |
| 安全终审 29333B | docs/collaboration/部门/安全部/报告/2026-08-02-M4-VS-0安全地基与59x39-seed独立终审报告.md §5 | P0、打开链路缺口与短期缓解 |
| 当前开发缓解 | docs/collaboration/部门/开发部/报告/2026-08-02-M4-VS-0安全地基与fixture-provider实现报告.md；app/src/server/db/database.ts | 已实现的路径、权限、身份和 sidecar 检查 |

### 2.1 accepted R5

当前 accepted M4 ADR 与 Spec R5 要求：启动 umask(077)；允许根、目录、DB、WAL/SHM/journal/backup 的权限和身份可验证；DB path realpath 必须位于允许根；拒绝 symlink、hardlink 和 TOCTOU；使用 O_NOFOLLOW 与原子创建；路径、权限、WAL、恢复、并发均进入合同测试。

### 2.2 安全 29333B 的实现事实

安全终审确认当前打开链路存在两个独立对象：

1. openStableDatabasePath() 以 O_NOFOLLOW 打开 guard fd，并检查最终文件的 dev/ino/nlink。
2. 随后 openSafeDatabase() 调用 new DatabaseSync(absolutePath)，SQLite 再按字符串路径解析并独立打开。
3. 构造后才检查 SQLite location()、最终文件和父目录；WAL 模式开启后才检查 -wal、-shm、journal 与 backup。

该链路能发现部分 symlink、hardlink、权限和身份替换。guard fd 与 SQLite 实际打开对象没有由同一个稳定目录句柄或 VFS open 绑定；sidecar 仍由 SQLite 按派生路径处理。安全报告据此判定强 R5 尚未闭合，并明确没有执行竞争式路径替换探针。

### 2.3 当前开发缓解

当前开发实现已包含以下防御性措施：

- process.umask(0o077)；.local/测试根目录 0700，DB 0600。
- 仅允许安全根下的单层 SQLite basename；检查 app root、root、parent 的目录身份。
- 打开前拒绝已有 sidecar；O_NOFOLLOW | O_CREAT | O_EXCL 用于初始 DB 创建。
- DatabaseSync 构造后检查 database.location() 与期望 realpath/inode，并通过 /dev/fd 观察至少两个相同 DB inode 的 descriptor。
- 构造前后以及应用 SQLite pragma 后复核 root、全父链、DB 身份和 sidecar 权限；失败时关闭数据库。

这些缓解缩小了普通路径错误、symlink/hardlink、权限误配和部分身份替换风险。它们没有形成“SQLite 实际打开与 DB/sidecar 全文件族绑定到稳定句柄”的证明。恶意同 UID 竞争、共享文件系统、多用户部署和生产恢复路径均保持 Unknown 或不适用状态。

## 3. 三方案比较

| 方案 | 用户价值 | 实现成本 | 迁移影响 | 残余风险 | 回滚方式 |
|---|---|---|---|---|---|
| A：维持强 R5，引入 broker/VFS 或 OS 隔离 | 保留强 R5 目标，未来可为 VS-1、多用户或生产部署提供可扩展安全基础 | 高。需要新 broker、SQLite VFS、原生 openat/O_NOFOLLOW 绑定或等价 OS 隔离；涉及新依赖、进程边界、打包、审计和故障恢复 | app Repository 接口可保持；DB/WAL/SHM/journal/backup 的打开与恢复链路需要替换并重新核对 migration、备份和运维 | 新组件自身的权限、协议、供应链、崩溃恢复和部署面；在完成独立复验前仍为 Unknown | 保留当前 DB 文件和 fixture provider；禁用 SQLite provider，回到只读 fixture/内存路径；不以当前弱缓解宣称 R5 PASS |
| B：M4 local-only 窄威胁模型，排除恶意同 UID | 以较小范围、较低复杂度推进本地 M4 MVP，继续使用 Node core/SQLite 和现有防御性缓解 | 低至中。需要用户确认威胁模型，建立 successor ADR，补齐 0700/0600、单层路径、全祖先 inode、pre/post sidecar、location() 和普通竞争负例合同 | 需把当前强 R5 的适用范围缩至 owner-only local MVP；未来 VS-1/生产不能直接继承，需 A 等价隔离或另行接受更强方案；不改 data schema | 同 UID 恶意进程仍可在路径重开或 sidecar 阶段竞争；不适用于共享账号、网络文件系统、容器共享目录、多用户或生产 | 关闭 SQLite-backed MVP，回到 fixture/内存路径；重新选择 A；不得把 B 的本地收据迁移为 VS-1 或生产安全证明 |
| C：暂缓 VS-1 | 避免在威胁模型未定前扩大安全承诺，保留现有 accepted R5 和审计链 | 立即成本最低；产品能力和 VS-1 进度延后，后续仍需在 A/B 之间作出选择 | 不改现有合同和 app；VS-0 SQLite 安全 P0 保持阻断，VS-1 不创建迁移或部署承诺 | 本地 SQLite 安全缺口持续存在；交付延期，技术债与后续重启成本增加 | 无需代码回滚；继续保持 SQLite provider/VS-1 关闭，待用户选择 A 或 B 后重新开任务 |

## 4. 唯一推荐

推荐方案 B：仅为 M4 local-only、owner-only 单用户环境明确排除恶意同 UID 竞争，并以 successor ADR 重新定义适用范围；VS-1、多用户、共享文件系统、部署和生产继续关闭。

推荐理由：当前授权目标是本地 M4 MVP，现有 Node core/SQLite 预检和开发缓解足以覆盖较窄的本地误配与普通路径攻击面；A 会引入 broker/VFS/OS 隔离等高复杂度组件，现阶段没有官方或本地收据证明其具体选型；C 会冻结 VS-1，同时无法关闭当前 VS-0 的 SQLite 安全 P0。B 的适用范围必须写成明确门禁，不能把 owner-only 证据外推为强 R5、VS-1 或生产安全。

该推荐仍为 proposed。在用户确认前，当前 accepted R5 不变，VS-0 SQLite 安全门禁继续阻断。

## 5. 选择后的验收出口

### 方案 A 的出口

需新建并接受实现 ADR，固定 broker/VFS/OS 隔离的选型、版本、权限边界和回滚；主库与 WAL/SHM/journal/backup 必须由同一受控文件族打开，SQLite 实际连接与文件身份需具备稳定句柄证明。完成 root/parent/final/sidecar 的 symlink、hardlink、替换和竞争式负例；复跑 Node24、WAL、恢复、并发、migration、fixture、日志与 no-egress 合同。安全复验必须达到 P0=0、P1=0，再决定 VS-0 PASS；VS-1 仍需独立阶段门禁。

### 方案 B 的出口

用户确认 owner-only M4 local-only、恶意同 UID 明确排除后，另建 successor ADR，并在 Spec 中把适用范围、排除项和停止条件写清；本任务不代为落盘。实现验收至少包括：

- 根目录、每一级祖先、DB、sidecar 的 0700/0600、realpath、dev/ino/mode/nlink 和权限负例；单层路径与 O_NOFOLLOW/O_EXCL 负例。
- SQLite 构造前后、location()、pragma、checkpoint/close 前后的 DB/sidecar pre/post 复核；普通并发与崩溃恢复可重放。
- 明确记录恶意同 UID 竞争、共享文件系统、多用户部署和生产存储为不适用；禁止将其收据用于 VS-1 或生产。
- 通过新的范围化安全复验后，最多开放 M4 local-only VS-0；VS-1 仍保持 pending/closed，直到具备 A 等价强隔离或新的用户确认。

### 方案 C 的出口

保持当前 accepted R5 和当前 app 不变；把 VS-0 SQLite security gate=P0 blocked、VS-1=deferred 写入后续进度门禁（本任务不修改）；只允许继续无 SQLite 真值的文档、fixture 或审计工作。重新启动 VS-1 前，必须选择 A 或 B 并完成相应 successor ADR 与安全复验。

## 6. 未验证、回退与错题自检

### 未验证

- 安全 29333B 未执行竞争式 root/parent/final/sidecar 替换探针；P0 来自打开链路的结构性缺口。
- broker、SQLite VFS、openat 原生边界和 OS 隔离均无当前选型、版本、成本或运行收据。
- 真实多用户部署、网络文件系统、容器共享目录、备份恢复和生产存储未验证。

### 回退原则

- 任何方案的实现收据失败，立即关闭 SQLite-backed provider/VS-0 安全放行，保留 fixture/内存只读路径。
- 不回写 Base、不切换 provider、不部署、不外发；不把历史 PASS 或 C 层 preflight 收据覆盖为当前安全 PASS。
- 方案 B 不能回退为“强 R5 已满足”；恢复强 R5 必须选择 A 或创建新的更强方案 ADR。

### 错题自检

- 没有把 Node24 node:sqlite 能力探针扩大解释为 TOCTOU 安全证明。
- 没有把 O_NOFOLLOW、inode 复核和 sidecar 后验检查描述为已经绑定 SQLite 实际打开对象。
- 没有把安全 29333B 的 FAIL / P0=1 误写成 VS-0 PASS。
- 没有替用户接受方案 B，也没有修改 accepted ADR、Spec、app、data 或外部资源。

## 7. 用户确认点（一句话）

请确认是否接受方案 B 的范围化决策：M4 仅限 owner-only 本地单用户、明确排除恶意同 UID 竞争并另建 successor ADR，VS-1/多用户/生产继续关闭；若不接受，则保持强 R5 与当前 VS-0 安全阻断并转方案 A/C。

TASK_STATE_OK
