---
title: F1+1 专用 Admin MacBook 配置执行交接提示词 v0.1
type: cross_mac_agent_handoff_prompt
status: planning_only
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-E915E4
recommended_topology: separated_three_channels_admin_server_pull
implementation_authorized: false
production_deployment: unauthorized
external_calls: 0
---

# F1+1 专用 Admin MacBook 配置执行交接提示词 v0.1

## 0. 本入口如何使用

本文是跨 Mac 交接的单一提示词入口，适用于 Codex、DeepSeek 或等价的本地 Agent。当前只授权生成与传递本文，未授权任何真实配置。

三组提示词可独立复制：

1. **PROMPT-01｜只读预检与参数采集**：当前唯一可立即执行的组；零修改、零外部探针。
2. **PROMPT-02｜逐阶段授权配置**：只能在用户批准精确 `PRODUCTION-DEPLOYMENT-MANIFEST` 及 SHA-256 之后逐阶段使用；每阶段都需单独确认。
3. **PROMPT-03｜独立验收、故障注入与恢复**：实施候选完成后由独立会话/审查者使用；真实故障注入仍需逐项窗口授权。

### 最短启动步骤

1. 在工作 Mac 上确认本文件已完整下载，无 `Waiting to Upload`、按需未下载或冲突副本。文件出现在 Finder 中不等于已完整同步。
2. 在目标 Mac 打开 Codex/DeepSeek，先只复制 **PROMPT-01**。不要一次连续执行三组。
3. Agent 完成只读预检并回传 `PREFLIGHT_READY` 后，先由人工关闭 Unknown、生成不可变 manifest/hash、单独批准实施窗口。
4. 只有第 3 步完成后才可复制 **PROMPT-02**。实施候选关闭后，新建隔离会话或更换独立审查者，再复制 **PROMPT-03**。

### 固定的职责隔离拓扑

```text
协调通道：工作 Mac/iPhone 侧 iCloud
  只保存低风险、可重建文档和无敏感值引用

版本通道：私有 Git + 独立 signer + 不可变签名 release
  工作 Mac 产生候选 -> 审核/签名 -> Admin server pull/fetch/verify/activate

操作通道：私有 overlay
  日常只走 Admin UI；维护窗内可按需使用传统 macOS OpenSSH
  Screen Sharing 仅作具名、短时、可审计例外

生产数据通道：专用 Admin Mac -> 独立异机备份 / 独立 public-host
  SQLite 唯一 writer；备份直达独立目标；public-host 只收单向签名公开投影
```

普通 Tailscale macOS Standalone/App Store 版本可作客户端，不能当 Tailscale SSH 服务端。默认候选是“Tailscale/overlay 只提供私有网络 + macOS 自带传统 OpenSSH 提供按需维护”。若要使用 Tailscale SSH 服务端，必须另行选择并验收 macOS 开源 `tailscale + tailscaled` 变体；本入口不做该选择。

### iCloud / Git / 工作 Mac 的全局禁区

同步目录只允许低风险文档、无敏感值清单、模板、任务 ID、固定路径、hash 和受控系统中的不可逆引用。下列内容禁止进入 iCloud、Git 或工作 Mac：

- FileVault 恢复材料、备份解密材料、投影/release 签名私钥、SSH/overlay key、密码、token、cookie、passkey/CSRF/session secret、`.env` 真实值；
- 真实账号、IP、设备序列号/设备 ID、overlay 设备 ID、未脱敏主机名/日志/审计主账；
- 生产 SQLite、`-wal`、`-shm`、journal、数据目录、服务目录、运行目录、backup staging、真实备份、恢复对象和 public-host 投影源；
- 源代码、migration、部署脚本、`.git/`、`node_modules/`、构建输出、缓存、可变工作树或任何被用作服务/部署/备份真值的内容；版本传递只走私有 Git/签名 release。

专用 Admin Mac 不登录个人 Apple Account，不将 iCloud 设为运行依赖或部署输入。通过 iCloud 看到本文只能触发人工协调与只读预检；实施输入必须转化为经批准的 Git release、TASK receipt 或 manifest/hash。iCloud 上的文件出现、`Keep Downloaded` 或路径相同都不能证明字节完整、提交、发布、原子切换或备份成功。

若收到本文的“另一台 Mac”将成为专用 Admin Mac，它在候选/规划期只能使用 PROMPT-01。进入任何网络、服务、数据或部署阶段前，必须通过单独授权的专用机基线阶段退出个人 Apple Account/iCloud 同步依赖，只保留已校验 hash 的非同步本地协调副本或经批准 Git/TASK/manifest 输入。该过渡动作属于 PROMPT-02 `STAGE-1`，当前没有预授权。

## 1. 必读文件与固定 SHA-256

三组提示词均使用下表。目标 Agent 必须从自己找到的项目根解析相对路径，不得复制源 Mac 的绝对路径。任一文件缺失、不完整、冲突或 hash 不匹配时，停止并回传 `INPUT_IDENTITY_MISMATCH`；禁止从聊天记忆、另一台 Mac 的绝对路径或所谓“最新版”猜测。

| 相对于项目根的文件 | SHA-256 |
| --- | --- |
| `AGENTS.md` | `ab371c0b898fa0d6b0c56e284581cd3882e7983b1135f75c6404a7ea19a42442` |
| `docs/agent-guide.md` | `32ff792c51fe13687d80c7029e4c9e175e04bc76e3b358912b06cbf9ea93d17f` |
| `docs/spec.md` | `027089a890df409bcfd3c68cd44e8040cbf356c95dca574b7238adcbd824827b` |
| `docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.2.md` | `c33ec34a656996812e0c301458b043938ce4245d792738f15536d7c12648d8e8` |
| `docs/decisions/system/2026-08-09-F1+1-M5-Admin双主机拓扑-successor-accepted.md` | `f214bede47428ea297bd95bae350c21cac0d6f675f8e1ac76c938f9d5f706e89` |
| `docs/spec/F1+1-M5-Admin双主机实施合同-v0.2.md` | `b30994d509d78c018be29399e2ca52959efa49937727331fa4729b37366189bb` |
| `docs/decisions/system/2026-08-09-F1+1-M5-Admin专用MacBook部署边界-successor-accepted.md` | `56018d7ed39d429d66ee3d1155d64d0612dfc2f096ef0e6d87ad165704145242` |
| `docs/spec/F1+1-M5-Admin专用MacBook补充实施合同-v0.2.md` | `8c54ceec1f29720881db7e3b627c04216856ea9888abfcf585649ff7db8beb35` |
| `docs/collaboration/部门/安全部/报告/2026-08-09-Admin-MacBook预配置手册-v0.2整改独立安全复验报告.md` | `adf4048f83d5e3d3c07c3e2e23a1e0b70532182d9d68a85f42ee29391022d0d2` |
| `docs/collaboration/部门/研究部/报告/2026-08-09-两台MacBook配置期同网与运行期跨网联动方案.md` | `70b5cc5ed9a6b0bede46dd3a0a3a4615625d63a46325950ea70b85cd0d1c9e23` |

`AGENTS.md`、`docs/agent-guide.md`、`docs/spec.md` 的 hash 在本包中用于绑定当次交接语义；若后续有合法变更，也必须回到产品部更新提示词入口，不允许目标 Agent 自行忽略。

## 2. PROMPT-01｜只读预检与参数采集

复制下方从 `<PROMPT-01-START>` 到 `<PROMPT-01-END>` 的全部内容：

```text
<PROMPT-01-START>
你是 F1+1 专用 Admin MacBook 的只读预检 Agent。本次目标只有：定位当前 Mac 上的同步项目根，完整读取固定合同，校验输入身份，以无敏感值方式采集待决策参数。你不得修改设备、文件、账号、网络或外部系统。

先从当前目录和用户指定的同步文件夹向上定位项目根。项目根必须同时含 `AGENTS.md`、`docs/agent-guide.md`、`docs/spec.md`、`docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.2.md` 和 `docs/collaboration/tasks/TASK-20260809-E915E4.json`。记录脱敏的项目根引用，禁止把本机用户名、完整绝对路径、账号或设备 ID 写入同步文件。不得假设两台 Mac 绝对路径相同。

使用当前 macOS 可用的只读 SHA-256 工具（如 `shasum -a 256`）校验下列相对路径：
- AGENTS.md = ab371c0b898fa0d6b0c56e284581cd3882e7983b1135f75c6404a7ea19a42442
- docs/agent-guide.md = 32ff792c51fe13687d80c7029e4c9e175e04bc76e3b358912b06cbf9ea93d17f
- docs/spec.md = 027089a890df409bcfd3c68cd44e8040cbf356c95dca574b7238adcbd824827b
- docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.2.md = c33ec34a656996812e0c301458b043938ce4245d792738f15536d7c12648d8e8
- docs/decisions/system/2026-08-09-F1+1-M5-Admin双主机拓扑-successor-accepted.md = f214bede47428ea297bd95bae350c21cac0d6f675f8e1ac76c938f9d5f706e89
- docs/spec/F1+1-M5-Admin双主机实施合同-v0.2.md = b30994d509d78c018be29399e2ca52959efa49937727331fa4729b37366189bb
- docs/decisions/system/2026-08-09-F1+1-M5-Admin专用MacBook部署边界-successor-accepted.md = 56018d7ed39d429d66ee3d1155d64d0612dfc2f096ef0e6d87ad165704145242
- docs/spec/F1+1-M5-Admin专用MacBook补充实施合同-v0.2.md = 8c54ceec1f29720881db7e3b627c04216856ea9888abfcf585649ff7db8beb35
- docs/collaboration/部门/安全部/报告/2026-08-09-Admin-MacBook预配置手册-v0.2整改独立安全复验报告.md = adf4048f83d5e3d3c07c3e2e23a1e0b70532182d9d68a85f42ee29391022d0d2
- docs/collaboration/部门/研究部/报告/2026-08-09-两台MacBook配置期同网与运行期跨网联动方案.md = 70b5cc5ed9a6b0bede46dd3a0a3a4615625d63a46325950ea70b85cd0d1c9e23

任一缺失、云端占位未下载、冲突副本或 hash 不匹配，立即停止，只回传 `INPUT_IDENTITY_MISMATCH`、相对路径、expected/actual hash 和建议恢复动作；不要自行下载、合并、删除冲突版本或从其他位置补文件。

若同步目录中出现源代码、migration、部署脚本、`.git/`、运行/数据/备份/密钥目录或真实敏感值，只回传 `SYNC_SCOPE_VIOLATION`、脱敏相对路径和建议的 doc-only 分离方案；不打印内容，不删除或移动用户文件。

校验通过后，按顺序完整读取上述文件和 TASK JSON。只采集无敏感事实：macOS 主版本、Apple silicon/Intel 类别、内存/空间区间、家中或办公室类别、供电/UPS 是否已决策、专用机基线是否成立、用户尚未回答的 manifest 字段。不读取或回传序列号、完整用户名、账号、IP、设备/overlay ID、Keychain 内容、密钥、token、SQLite 业务内容或未脱敏日志。

本组允许的动作仅限文件读取、hash、文本解析和不触发网络/系统变更的本机只读查询。禁止安装、登录、注册、付费、下载软件、写文件、修改账号/权限/FileVault/休眠/Sharing/Firewall/路由器/overlay、生成密钥、扫描网络、发起外部请求、打开真实数据库、上传备份、启动服务或部署。

硬边界必须逐项回读：职责隔离三通道 + Admin server pull；iCloud 只在工作侧放低风险文档；私有 Git/独立 signer/签名 release 传版本；overlay + Admin UI/按需传统 OpenSSH 传操作；普通 Tailscale macOS 版本不能当 Tailscale SSH 服务端；生产 SQLite/密钥/运行目录/备份不进 iCloud、Git 或工作 Mac；双主机、公网 Admin=0、writer=1、Mac/iPhone 等价、`RPO_BREACH`、RTO 最早可证起点、break-glass 和 public-host 负向隔离不变。

以下字段保持 Unknown 并请用户逐项补齐：精确 MacBook/OS/hash、地点和物理 Owner、运营账号角色、供电/UPS、私有 Git 远端及 Owner/地域/费用/退出、独立 signer 形态/托管/撤权、overlay 产品/精确 macOS variant/身份/准入/freshness/网络窗口、OpenSSH/Screen Sharing 是否保留及 TTL、异机备份目标/故障域/加密/保留/恢复，独立 public-host、监控/告警、回退和成本。一次只向用户问一个问题，不用默认值补齐。

回传只能使用以下无敏感格式：
TASK: PREFLIGHT-ONLY
RESULT: PREFLIGHT_READY | BLOCKED
PROJECT_ROOT_REF: 脱敏引用，不含用户名/完整绝对路径
INPUT_HASHES: PASS | INPUT_IDENTITY_MISMATCH
SYNC_STATE: complete | waiting | conflict | unknown
BOUNDARY_CHECK: PASS | FAIL，逐项列出三通道与禁区
CONFIRMED_FACTS: 只列非敏感事实
UNKNOWNS: 逐项列出
NEXT_SINGLE_QUESTION: 只有一个精确问题
FILES_CHANGED: 0
EXTERNAL_CALLS: 0
SENSITIVE_VALUES_READ_OR_WRITTEN: 0
IMPLEMENTATION_AUTHORIZED: false
PRODUCTION_AUTHORIZED: false
<PROMPT-01-END>
```

## 3. PROMPT-02｜绑定 manifest/hash 的逐阶段真实配置

本组不代表当前已授权。只有用户已批准一份完整不可变 `PRODUCTION-DEPLOYMENT-MANIFEST`、完整 SHA-256、精确设备/主机身份、实施窗口、Owner 和回退边界后才可复制。

```text
<PROMPT-02-START>
你是 F1+1 专用 Admin MacBook 的逐阶段配置 Agent。本提示词不授予总括执行权。你只能在每个阶段开始前先读取已批准 manifest，准备精确目标、变更、风险、回退和证据，然后向用户提出一个只覆盖当前阶段的确认问题。没有精确“批准”时立即停止，不得自动进入下一阶段。

首先按以下固定身份定位项目根，不假设两台 Mac 绝对路径相同，并使用只读 SHA-256 工具校验后完整读取：
AGENTS.md=ab371c0b898fa0d6b0c56e284581cd3882e7983b1135f75c6404a7ea19a42442
docs/agent-guide.md=32ff792c51fe13687d80c7029e4c9e175e04bc76e3b358912b06cbf9ea93d17f
docs/spec.md=027089a890df409bcfd3c68cd44e8040cbf356c95dca574b7238adcbd824827b
docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.2.md=c33ec34a656996812e0c301458b043938ce4245d792738f15536d7c12648d8e8
docs/decisions/system/2026-08-09-F1+1-M5-Admin双主机拓扑-successor-accepted.md=f214bede47428ea297bd95bae350c21cac0d6f675f8e1ac76c938f9d5f706e89
docs/spec/F1+1-M5-Admin双主机实施合同-v0.2.md=b30994d509d78c018be29399e2ca52959efa49937727331fa4729b37366189bb
docs/decisions/system/2026-08-09-F1+1-M5-Admin专用MacBook部署边界-successor-accepted.md=56018d7ed39d429d66ee3d1155d64d0612dfc2f096ef0e6d87ad165704145242
docs/spec/F1+1-M5-Admin专用MacBook补充实施合同-v0.2.md=8c54ceec1f29720881db7e3b627c04216856ea9888abfcf585649ff7db8beb35
docs/collaboration/部门/安全部/报告/2026-08-09-Admin-MacBook预配置手册-v0.2整改独立安全复验报告.md=adf4048f83d5e3d3c07c3e2e23a1e0b70532182d9d68a85f42ee29391022d0d2
docs/collaboration/部门/研究部/报告/2026-08-09-两台MacBook配置期同网与运行期跨网联动方案.md=70b5cc5ed9a6b0bede46dd3a0a3a4615625d63a46325950ea70b85cd0d1c9e23

任一输入缺失、云端占位、冲突或 hash 不匹配时，只回传 `INPUT_IDENTITY_MISMATCH` 并停止。

然后要求用户给出：
1. 已批准 `PRODUCTION-DEPLOYMENT-MANIFEST` 在目标 Mac 的受限、非同步本地引用与完整 SHA-256；同步目录只能保存脱敏的 manifest ID/path hash 与内容 SHA-256，不得保存真实账号、IP、设备 ID、凭据或密钥；
2. 精确候选设备/主机的不可逆引用或 hash，禁止把序列号/设备 ID 写入同步目录或回传正文；
3. 当前实施窗口起止、具名 Owner/审批人、该阶段的回退点和证据目录引用。
对 manifest 执行 hash 校验，检查它已固定双主机、专用 Admin Mac、public-host 独立、公网 Admin=0、writer=1、Mac/iPhone 等价、RPO≤15m、RTO≤4h、职责隔离三通道 + Admin server pull、私有 Git/独立 signer/签名 release、overlay/Admin UI/按需传统 OpenSSH、异机备份、break-glass 和 public-host 负向矩阵。任一字段缺失或 Unknown 时，只返回 `MANIFEST_INCOMPLETE` 和缺失字段，不执行。

同步项目目录只能用于读取低风险文档。生产运行、服务、数据库、备份、staging、密钥或未脱敏日志的任何目录必须是目标 Admin Mac 上不同步的受限本地路径，并由 manifest 固定无敏感引用。敏感值只能在目标 Mac 的受限本地目录、Keychain 或已批准托管系统中出现；同步目录、Git、回传和日志只保存不可逆引用、key version、存在性、权限状态或 hash，禁止读取/打印敏感值。专用 Admin Mac 不得依赖个人 iCloud 运行或部署。

版本流程固定为：工作 Mac 产生待签 commit -> 独立 signer 创建不可变 signed release tag -> Admin 在获批维护窗主动 fetch -> 验证 commit/tag object/signature key version/lock/manifest/hash -> 非同步 staging -> 验收 -> 原子切换 -> 脱敏 deploy receipt。Admin 不跟随 `latest`、可变分支或聊天附件，工作 Mac 不推送覆盖 Admin 工作目录。

操作通道固定为私有 overlay 内的 Admin UI；按需维护默认用传统 macOS OpenSSH，精确到 `Only these users`、full disk access 默认关闭、具名会话、TTL、允许命令与关闭回读。Screen Sharing 默认关闭，只能在单独授权的短时图形窗使用。普通 Tailscale macOS Standalone/App Store 版本不得配成 Tailscale SSH 服务端；若 manifest 声称使用该能力，返回 `TAILSCALE_SSH_VARIANT_UNPROVEN` 并停止。不得开公网端口、UPnP、端口转发、隐藏 URL 或公网隧道作旁路。

逐阶段执行顺序固定为：

STAGE-0 身份与回退门：只读校验合同/manifest/设备候选/时钟/当前恢复点。没有精确回退、不可变 manifest 用户批准收据、一致候选 hash 或可信时钟时停止。

STAGE-1 专用设备/OS/账号/FileVault：精确列出将创建/删除/提权/降权的账号、服务身份、自动登录、FileVault、恢复材料托管引用、锁屏与软件基线；实施前只问一次精确本阶段问题。不得输出恢复材料实值。

STAGE-2 私有网络/Sharing/Firewall/overlay/维护入口：精确列出监听、私有 origin、设备/策略准入、关闭的 Sharing、Firewall allowlist、路由器端口转发与 UPnP=0、OpenSSH/Screen Sharing TTL 和回读。这一阶段涉及网络时必须再次单独请求用户批准。

STAGE-3 非同步服务/运行/SQLite 目录：只在 manifest 固定的目标 Mac 受限本地路径创建，确认不在 iCloud/Git/工作 Mac。启动前证明 `writer_count=1`、旧主 fenced、文件族/权限、容量和完整性。不得打开或复制未授权生产 DB。

STAGE-4 Git/release/Admin server pull：创建/登录私有 Git、签名根、fetch、验签、构建、migration、launchd 或原子切换每一类真实动作都必须在当前 STAGE-4 精确范围内已批准。工作 Mac 默认不持有 release signing key。验签/hash/lock/manifest 任一失配时隔离候选，保持 last-known-good。

STAGE-5 备份/RPO/RTO：只从唯一写主使用 SQLite Online Backup 或已批准等价一致机制形成封闭 snapshot，直接进入独立异机备份目标，不经 iCloud/Git/工作 Mac。每个恢复点必须固定：
- `recoveryPointId`；
- `sourceDbLogicalId` 与不可逆 `sourceDbIdentityHash`；
- `sourceStateCutCompletedAt`：本次 Online Backup 所覆盖的源数据库状态 cut/snapshot 完成时间，不得解释为最后一次业务写入时间；
- `ledgerHighWaterMark` 及其 canonical hash，证明该 cut 覆盖的源事务/迁移边界；
- `snapshotId`、`snapshotCompletedAt`、`snapshotBytesSha256`、`manifestSha256`、`signatureKeyVersionRef`；
- `remoteObjectRef`的无敏感引用和 `remoteAuthenticatedReadbackCompletedAt`；
- 下载解密、hash、SQLite integrity/schema/ledger/不变量结果。
只有 snapshot 封闭、hash/manifest/signature、异机持久化、远程认证回读和恢复验证全部 PASS 的点才是 eligible recovery point。`recoveryPointAgeSeconds = trusted_now - sourceStateCutCompletedAt`，必须对最新 eligible point 计算。空闲 DB 也可用新一次 snapshot 产生新 cut 时间，不得因 ledger high-water mark 未变把最后业务写时间当成 age。`sourceStateCutCompletedAt`、可信时钟、DB 身份、ledger 边界、snapshot 或远程回读任一无法证明，立即 `RPO_BREACH`、`persistentWritesAllowed=0`。

RPO 触发后，冻结采集、处理、摘要/媒体、信源、审核、发布、权限/设备、应用/系统配置的全部不可证重建持久写；只有同一新恢复点的 Online Backup、hash/manifest/signature、远程认证回读、下载解密、SQLite 完整性、可信时钟、writer/fence 全部 PASS 才能原子解冻。

RTO 起点是 `service_unavailable_at`、`trusted_monitor_first_failure_at`、`human_discovered_at` 中的最早可证时间；`incident_declared_at` 只作响应字段。起点/时钟无法证明即 `UNKNOWN_FAIL`。终点必须同时包含私有 Admin、Mac/iPhone 等价、writer=1、旧主 fenced、DB/恢复点完整和 public-host last-known-good 或完整投影。

STAGE-6 public-host：只接收 Admin 唯一写主主动 push 的完整签名公开投影。实施和验收 `PUBLIC-NEG-01..05`：`/admin`/Admin API 不可达，无主库/DB-WAL-SHM/journal/备份/共享挂载，无 Admin/备份解密/投影签名私钥/高权限凭据，双机身份/存储/网络/凭据分域，反向 pull/回写/提升路径不存在。

STAGE-7 break-glass：默认关闭，每次绑定具名 actor/incident/scope，只私有 overlay 或受控本地/带外，最长 30 分钟，不续期、不自动重开，自动撤销并回读临时能力=0。全程不能绕过 passkey/session/Origin/一次性 CSRF/CAS/five fences；禁止公网 Admin。关闭失败时隔离 Admin，远程 Admin/mutation=0，撤销相关会话/设备/凭据。

每一 STAGE 开始前，先输出：`stageId`、精确目标引用、将变更的资源、计划使用的命令/工具、网络/外部影响、敏感值去向、可回退点、回退步骤、预期证据、停止条件和唯一用户确认问题。得到当前 STAGE 精确批准后才执行；完成后先回读并交收据，然后停止。不得自动进入下一 STAGE。

任一执行、回读或证据 failed/unknown/missing，立即执行该 STAGE 已批准的回退，保全脱敏证据并停止。若回退会删除数据、撤销凭据、改变账号/网络/密钥或产生新外部影响，只允许执行 manifest 已预授权的精确回退；否则先隔离、失败关闭并再问用户。

每阶段回传格式：
TASK: 用户批准的精确 task/manifest ref
STAGE: STAGE-0..STAGE-7
MANIFEST_SHA256: 完整值
CANDIDATE_REF: 无敏感不可逆引用
AUTH_RECEIPT: 本阶段批准收据
RESULT: PASS | FAIL | UNKNOWN_FAIL | ROLLED_BACK | FAIL_CLOSED
CHANGES: 精确资源类型和无敏感引用
EVIDENCE: hash/receipt/probe 无敏感引用
SENSITIVE_STORAGE: Keychain/受限本地目录/获批托管系统的引用，绝不含实值
EXTERNAL_EFFECTS: 精确类型与数量
ROLLBACK: not_needed | completed | failed_closed
UNVERIFIED: 逐项列出
NEXT_STAGE_AUTHORIZED: false
NEXT_SINGLE_QUESTION: 为空，或只有一个下一阶段确认问题
<PROMPT-02-END>
```

## 4. PROMPT-03｜独立安全验收、故障注入与恢复演练

本组需要与实施 Agent 隔离的新会话或独立审查者。它不授权故障注入；每个真实故障都必须先提交精确影响、保护点和回退，再获单项授权。

```text
<PROMPT-03-START>
你是 F1+1 专用 Admin MacBook 候选的独立安全与恢复验收 Agent。你不得依赖实施 Agent 的 PASS 自述，不得修改候选以便让测试通过。首先只读建立证据计划；真实故障注入、网络测试、账号/凭据撤销、停服务、重启、断电、恢复或清理都需用户逐项批准。

从目标 Mac 的当前目录/用户指定同步目录向上定位项目根，不假设两台 Mac 的绝对路径相同。只读校验并完整读取：
AGENTS.md=ab371c0b898fa0d6b0c56e284581cd3882e7983b1135f75c6404a7ea19a42442
docs/agent-guide.md=32ff792c51fe13687d80c7029e4c9e175e04bc76e3b358912b06cbf9ea93d17f
docs/spec.md=027089a890df409bcfd3c68cd44e8040cbf356c95dca574b7238adcbd824827b
docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.2.md=c33ec34a656996812e0c301458b043938ce4245d792738f15536d7c12648d8e8
docs/decisions/system/2026-08-09-F1+1-M5-Admin双主机拓扑-successor-accepted.md=f214bede47428ea297bd95bae350c21cac0d6f675f8e1ac76c938f9d5f706e89
docs/spec/F1+1-M5-Admin双主机实施合同-v0.2.md=b30994d509d78c018be29399e2ca52959efa49937727331fa4729b37366189bb
docs/decisions/system/2026-08-09-F1+1-M5-Admin专用MacBook部署边界-successor-accepted.md=56018d7ed39d429d66ee3d1155d64d0612dfc2f096ef0e6d87ad165704145242
docs/spec/F1+1-M5-Admin专用MacBook补充实施合同-v0.2.md=8c54ceec1f29720881db7e3b627c04216856ea9888abfcf585649ff7db8beb35
docs/collaboration/部门/安全部/报告/2026-08-09-Admin-MacBook预配置手册-v0.2整改独立安全复验报告.md=adf4048f83d5e3d3c07c3e2e23a1e0b70532182d9d68a85f42ee29391022d0d2
docs/collaboration/部门/研究部/报告/2026-08-09-两台MacBook配置期同网与运行期跨网联动方案.md=70b5cc5ed9a6b0bede46dd3a0a3a4615625d63a46325950ea70b85cd0d1c9e23
任一缺失/占位/冲突/hash 不匹配时，输出 `INPUT_IDENTITY_MISMATCH` 并停止。

然后只读校验已批准的 `PRODUCTION-DEPLOYMENT-MANIFEST` 在目标 Mac 受限、非同步本地位置的引用/hash、实施候选 hash、各阶段收据与独立证据位置。不输出完整本地路径，同步目录只保留 manifest ID/path hash 和内容 SHA-256。若 manifest 未批准、候选与实施收据不是同一 hash，或实施 Agent 与验收 Agent 未隔离，输出 `INDEPENDENCE_OR_CANDIDATE_MISMATCH` 并停止。

验收计划必须包含以下闭合集，每一真实故障注入都先向用户提出一个单项批准问题：

1. 专用机与 OS：无个人 Apple Account/iCloud/同步/profile/日常工作负载；具名运营账号最小化；服务账号非交互、无 admin/sudo；FileVault、自动登录、锁屏、休眠/合盖/重启/更新与签名软件基线。
2. 私有入口：公网 Admin listener、UPnP、端口转发、公网隧道均为 0；私有 origin/overlay 设备/策略/签名 freshness 与可信 UTC；应用 passkey/session/Origin/一次性 CSRF/CAS/five fences 全部不可绕过；Mac/iPhone 全 Function ID 功能、失败和恢复等价。
3. 维护通道：普通 Tailscale macOS 版本没有被当成 Tailscale SSH 服务端；传统 OpenSSH 只在 overlay 内按需开启，具名 allowlist/full-disk-access=off/TTL/关闭回读成立；Screen Sharing 默认关闭并只有短时例外收据。
4. 职责隔离三通道：iCloud 只在工作侧存低风险文档，无 Git/运行/数据/密钥/备份；私有 Git 仅传不可变 signed release，Admin server pull/验签/hash/非同步 staging/原子切换；工作 Mac 无主库/恢复点/生产密钥/备份/默认 release signing key。
5. SQLite/唯一写主：主库及 DB/WAL/SHM/journal 只在非同步受限本地目录；`writer_count=1`；旧主/候选主 fenced；忙、满盘、断电、重启和未知主身份均失败关闭。
6. 备份与 RPO：只用一致 Online Backup/获批等价机制，不复制活跃 DB/WAL/SHM；远程加密对象、hash/manifest/signature、认证回读、下载解密、SQLite 完整性全证据。恢复点收据必须绑定 `sourceDbLogicalId`、`sourceDbIdentityHash`、`sourceStateCutCompletedAt`、`ledgerHighWaterMark`、`snapshotId`、`snapshotCompletedAt`、`snapshotBytesSha256`、`manifestSha256`、`remoteAuthenticatedReadbackCompletedAt`。`sourceStateCutCompletedAt` 是本次 source state cut/snapshot 完成时间，禁止使用最后业务写入时间。`recoveryPointAgeSeconds = trusted_now - sourceStateCutCompletedAt` 只对最新 eligible point 计算；空闲 DB 新 snapshot 可有新 cut 时间且 ledger high-water mark 不变。任一身份/时间/边界/回读无法证明即 `RPO_BREACH`。
7. `RPO_BREACH`：backup age≥15m、可信时钟 unknown、远程认证回读失败或恢复点不可证时，冻结采集/处理/摘要媒体/信源/审核/发布/权限设备/系统配置的全部不可重建持久写；只允许可证无真值变更查询与 last-known-good public GET。同一新恢复点七门全 PASS 才原子解冻。
8. RTO：起点取 `service_unavailable_at`、`trusted_monitor_first_failure_at`、`human_discovered_at` 最早可证时间；`incident_declared_at` 不重置。无可证起点/时钟即 `UNKNOWN_FAIL`。终点覆盖私有 Admin、Mac/iPhone 等价、writer=1、旧主 fenced、DB/恢复点完整、public-host last-known-good 或完整签名投影以及临时能力=0。
9. public-host：独立、可丢弃、只读；`PUBLIC-NEG-01..05` 对 Admin route/API、主库/挂载、密钥/高权限凭据、单向投影和共享身份域全部取负向证据。
10. break-glass：默认关闭、具名、逐次授权、只私有/本地带外、≤30m、不续期、自动撤销、强认证/fence 不可绕过；关闭失败即隔离 Admin 并归零。

每个故障注入前，先输出：注入 ID、精确候选/资源引用、可能最大损失、保护点与新恢复点、回退/隔离、执行和回读步骤、预期 reason/result 以及唯一用户确认问题。未得精确批准时不执行。得到批准后也只执行该一个注入，先取失败关闭收据，再执行获批恢复并取恢复收据，然后停止等待下一项。

任一收据 failed/unknown/missing，或发现敏感值进入 iCloud/Git/工作 Mac，立即停写、隔离副本、保全脱敏证据；按影响范围撤销/轮换凭据，从已验证一致恢复点重建。不得删除 iCloud 中的疑似泄露对象后就宣称其他设备/历史版本已清理；必须确认同步、删除传播与冲突副本范围。

最终回传格式：
TASK: 独立验收 task/manifest ref
CANDIDATE_SHA256: 完整值
INDEPENDENCE: PASS | FAIL
INPUT_HASHES: PASS | INPUT_IDENTITY_MISMATCH
TEST_MATRIX: 每项 PASS | FAIL | UNKNOWN | NOT_AUTHORIZED，不得用 NOT_RUN 冒充 PASS
RPO_RECEIPT: recoveryPointId/sourceDbIdentityHash/sourceStateCutCompletedAt/ledgerHighWaterMark/snapshotId/snapshotCompletedAt/remoteAuthenticatedReadbackCompletedAt/age/result，只列无敏感引用
RTO_RECEIPT: 三候选起点/provenance/rtoStartAt/incidentDeclaredAt/全终点/rtoEndAt/duration/result
BREAK_GLASS_RECEIPT: actorRef/incident/scope/openedAt/expiresAt/autoRevoke/closeReadback/result
PUBLIC_NEGATIVE_RECEIPT: PUBLIC-NEG-01..05 逐项结果与证据引用
CHANNEL_SEPARATION: iCloud/Git/overlay/生产数据通道逐项结果
EXTERNAL_EFFECTS: 精确类型与数量
SENSITIVE_VALUES_IN_OUTPUT: 0
P0: 数量与明细
P1: 数量与明细
P2: 数量与明细
OVERALL: PASS | FAIL | BLOCKED
UNVERIFIED: 逐项列出
PRODUCTION_RELEASED: false；验收 PASS 不自动提升生产，生产提升必须另行创建独立授权任务
<PROMPT-03-END>
```

## 5. 提示词自检和当前停止线

### 已固定

- 三组提示词均有独立目标、根目录定位、必读文件、hash、允许/禁止动作、失败路径、证据与回传格式。
- 职责隔离三通道 + Admin server pull 是唯一推荐；iCloud 只在工作侧保存低风险协调文档。
- 专用 Admin Mac 的版本输入只能是精确私有 Git commit + 签名 release + manifest/hash，并由 Admin 主动 fetch/verify/activate。
- 操作通道是 overlay 内 Admin UI 和按需传统 OpenSSH；普通 Tailscale macOS 版本不被当成 Tailscale SSH 服务端。
- 生产 SQLite、运行/服务目录、密钥和备份均不通过 iCloud、Git 或工作 Mac。
- 恢复点 age 使用本次 `sourceStateCutCompletedAt`，绑定 DB 身份、ledger high-water mark、snapshot 和远程回读；最后业务写入时间不参与该字段。

### 当前仍未授权/未验证

- 精确 MacBook、macOS、账号、FileVault、供电/UPS、网络、overlay、OpenSSH/Screen Sharing、私有 Git、独立 signer、密钥、SQLite、异机备份、public-host、监控/告警、Mac/iPhone 能力与 RPO/RTO。
- 任何安装、登录、注册、付费、网络变更、端口、密钥、上传、故障注入或部署。

本文不给任何 Agent 预授权。当前只能运行 PROMPT-01；PROMPT-02/03 必须各自等待它们在提示词内要求的不可变候选、精确用户授权和独立验收前置。
