---
title: VS1最终候选no-egress输入与失败结算独立安全复验
type: audit_report
department: 安全部
target: VS1本地synthetic最终候选
status: final
date: 2026-08-09
related_task: TASK-20260809-ED377D
decision: fail
tags: security,vs1,no-egress,receipt,lease
summary: 冻结哈希与静态安全合同匹配，但唯一获准的固定Node24聚焦探针在进入候选前因工具链不可用非零停止，缺少本轮独立运行证据，P1为一
---

# VS1 最终候选 no-egress、输入与失败结算独立安全复验

## 1. 唯一结论

**FAIL。P0=0，P1=1，P2=2。**

冻结候选的全部任务真值哈希均匹配；静态审查未发现新的候选 P0/P1。唯一获准的固定 Node24 clean-room 聚焦命令在加载 npm 或候选代码前以 `exit 127` 停止，原因是任务指定的固定 Node24 可执行文件在预期位置不存在。依照用户“首个非零停止”的硬门，本轮没有重试、改用系统 Node、运行第二条命令或运行完整测试套件。

因此，本轮无法独立证明进程级 no-egress、25 cases、失败结算与清理的运行行为。该缺口属于 **P1 验收证据缺失**，使任务不能 PASS；它不证明候选实现存在同等级漏洞。开发部既有 receipt/V-OP 只能作为上游证据，不能替代本轮独立运行收据。

本结论严格限定于 VS1 本地 synthetic 最终候选安全复验；不外推 OS/系统调用级隔离、生产、真实 provider/RSS/Base/AI、Admin、发布、部署或网络能力。

## 2. 冻结候选身份

| 项目 | SHA-256 | 结果 |
|---|---|---|
| successor accepted ADR | `95421002e6b5b52061d6d41b6342f92bb919bfdf937ca00ab69fc9f9a2cc5612` | MATCH |
| 实施合同 v0.2 | `2913bc78bd43969f8354b63d9906b346839102d76f05702d6c41f54145c4ed6c` | MATCH |
| `package.json` | `e39a413a0ae2000b781433e983a9df48c26b0f5c1db1ce950e2b0b6dd6be7752` | MATCH |
| `package-lock.json` | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` | MATCH |
| worker | `57fcea6ac269daccce8a21072198b4ccc3f0529823a79383a97d0a3af67de814` | MATCH |
| contract entry | `7f52c992ffdd3a92c06d3c87aa0babcce83e4fa12c55f3933968e246a0f40297` | MATCH |
| fixture loader | `7c21bf9e3e0c38a166a831613118daf0f3fcf837d08ca6723553e732133326e9` | MATCH |
| no-egress guard | `a8c117708d31fb236e059183c9b08c6a56ab091ac38bde121ef0234e85a22d2d` | MATCH |
| pipeline | `a74240b8d479cfec2fd0e83bc6146fd05ab6b85e12e7149d4b016dc1b92cf806` | MATCH |
| VS1 test | `d43658bd81f20e42691256430dd036e329853c7759af595494d5d86c933862cf` | MATCH |
| registry | `21347151fbc69de403dd4d7b7aec3f315e2d8de4646f622d8b5377924f610ee1` | MATCH |
| seed | `4ab8a3bab537c82e43612fa11b81cdacea2043d4027bd09fcf91b04f5677a648` | MATCH |
| manifest | `7343f8bc76d68b7993b29ed5232e3487621effb3a27518e0f754a5dd07fef39e` | MATCH |
| migration 0001 | `dc235534c492b9c763f63e2752bd4d78cc4f05ecf8e3600a3a906c3d0aae029b` | MATCH |
| migration 0002 | `3c96d4be93ebbc3dcc56bbb1780bec7f65c76f9c9ae1a7a391d3895d10f5c748` | MATCH |
| migration 0003 | `f1014f95dea2d556ea632493448b6db98350b89baea55f018a1975c9baec7460` | MATCH |
| migration 0004 | `276e31b466eda82ec5076307f4bab62b37b1ef496146e555edbae5f7a6408696` | MATCH |
| migration 0005 | `f5a8e18f1d437cdca18990d27d15be06c12b08efda771e12f903600bb7bc9a6a` | MATCH |
| migration 0006 | `c27b9c0274605db15ad91462f6752637ae35c54b7632920718229f06dda7c17e` | MATCH |
| 开发 full receipt | `d6c93b0d0ad690f7177b2e071695228d6e320743a1162d7a0722198bb31ab7a4` | MATCH，上游证据 |
| 开发 V-OP | `642f1576f96efcf97f05ae2613ac2432b0deffe5a5004b4a002fc547f86d2b5a` | MATCH，上游证据 |

哈希身份与 TASK JSON 完全一致，没有候选漂移。首次静态哈希命令误用了不存在的迁移文件名；随后只读列举正式目录，以实际 `0001_runtime_source_outbox.sql` 至 `0006_audit_receipt.sql` 重算并全部匹配。该审查命令错误没有修改候选，也没有被计作候选失败。

## 3. 唯一运行探针收据

### 3.1 授权命令边界

- 固定 Node：24.18.0 项目工具链。
- 环境：`env -i`，只传固定用户目录、项目 Node24 前置最小 `PATH`、`TMPDIR=/tmp`、`LANG=C`、`LC_ALL=C`。
- 命令：一次现有 `test:contract` 聚焦入口。
- 明确禁止：联网、安装、正式数据写入、完整测试套件、候选修改和首错后的第二次执行。

### 3.2 实际结果

| 项目 | 结果 |
|---|---|
| 退出码 | `127` |
| 到达 npm | 否 |
| 到达 `vs1-contract.ts` | 否 |
| 安装 no-egress guard | 否 |
| 运行 25 cases | 否 |
| 创建任务 SQLite/receipt/WAL/SHM | 否 |
| 外部请求 | 未发起；候选 `externalCalls` 计数未初始化，不能用 `0` 冒充运行证明 |
| 后续重试/替代 Node | 未执行 |
| `/tmp` 任务残留 | 任务前缀扫描为空 |

宿主 `env` 在候选启动前输出了固定工具路径相关错误。它不经过项目的 closed CLI redactor；本报告不复述绝对路径。该输出同时说明：项目日志 allowlist 静态成立不等于宿主启动器的 stderr 也受项目控制。

## 4. no-egress 静态复验

### 4.1 guard 安装顺序

`vs1-worker.ts` 和 `vs1-contract.ts` 都只静态导入 `installNoEgressGuard`，立即安装 guard，随后才动态导入配置、安全 CLI、fixture 与 pipeline。未发现业务模块先于 guard 导入。**静态 PASS。**

### 4.2 受控出口

guard 静态覆盖：

- `globalThis.fetch`、`WebSocket`；
- `net.connect/createConnection/Socket.prototype.connect`；
- `http.request/get`、`https.request/get`、`http2.connect`、`tls.connect`；
- `dns.lookup/resolve/resolve4/resolve6` 及 promises 版本；
- `dgram.createSocket`；
- `child_process` 的 exec/execFile/fork/spawn 及同步版本；
- `cluster.fork`、`worker_threads.Worker`。

每次拒绝先递增内存中的 `externalCalls`，再抛出固定 `EXTERNAL_IO_FORBIDDEN`。源码引用扫描没有在 VS1 worker/fixture/pipeline 中发现直接网络、子进程、动态底层 binding、`ATTACH` 或扩展加载调用。现有测试源码包含对代表性 net/Socket/tls/http2/DNS promise/child process/cluster/worker/fetch 出口的拒绝断言。

**静态 PASS；动态 NOT_RUN。** 这只能证明已枚举的 Node 进程级 API 控制设计，不能证明 OS 防火墙、系统调用、原生扩展、同 UID 恶意进程或未枚举运行时 API 的 deny-all。

## 5. 输入、路径与 SQLite 边界

### 5.1 已静态确认

- manifest、registry、seed、合同和 migration 全部以固定 hash 绑定。
- 输入路径先做词法项目根检查，再做 `realpath` 根检查。
- 文件要求 owner-controlled regular file、非 symlink、`nlink=1`、非 group/world writable、owner UID 等于当前 UID。
- JSON 使用 fatal UTF-8 解码，在 `JSON.parse` 前扫描所有对象并拒绝重复键；Zod closed schema 再限制字段、枚举和 012 唯一例外。
- manifest 派生的 candidate count 与 missing-summary exception 必须重新计算并逐字匹配。
- 任务根由专用前缀创建并收紧到 `0700`；SQLite/receipt 收紧到 `0600`，SQLite 文件要求 regular、非 symlink、`nlink=1`。
- SQLite readiness 固定检查 foreign keys、WAL、FULL、busy timeout 和 temp store；源码无 `ATTACH`/扩展加载入口。

### 5.2 残余边界

`readFixedFile` 的 `realpath`、`lstat` 与 `readFile` 是分离的路径操作；本轮没有机械证明同 UID 对手在检查与读取之间替换路径时仍安全。哈希会拒绝非预期内容，但不等同于稳定文件描述符/O_NOFOLLOW 的完整 TOCTOU 证明。任务明确禁止外推 OS 级能力，因此列为 **P2/Unknown**，不升级为本地单进程 synthetic 的 P1。

## 6. 凭据、日志与收据静态复验

- V-OP 固定六字段：`artifactHash`、`externalCalls`、`functionId`、`reasonCode`、`recoveryAction`、`status`。
- full receipt 是 closed 字段集合；源码测试明确禁止 receipt 出现 synthetic secret、测试 URL、`lease_token`、app root 和 task root。
- CLI catch 将异常压缩为 allowlist `reasonCode`；SQLite 原生错误统一为 `SQLITE_FAILURE`，未知错误统一为 `CLI_INTERNAL_ERROR`。
- `redactLogEvent` 只接受 allowlist 键和值；额外字段降级为 `redacted_incident`，不透传原错误、message、stack、正文、URL 或路径。
- 固化开发 receipt/V-OP 的当前字节扫描未命中 synthetic secret、测试 URL、`lease_token`、绝对用户路径、stack 或源码行模式。
- receipt 使用 `wx` 创建并设 `0600`，artifact hash 从 canonical receipt 原字节计算；replay 回读同一 receipt 并验证 hash/数据库终态，不执行第二次写入。

**静态与既有证据字节 PASS；本轮候选 CLI 动态错误出口 NOT_RUN。** 宿主启动器错误不受上述应用 allowlist 控制，已在 P1 中记录。

## 7. Lease、五 fence、stop 与结算顺序

### 7.1 领取与运行前

- `BEGIN IMMEDIATE` 内只选 pending/retryable、到期且顺序唯一的 job。
- job 必须匹配 payload hash、idempotency key、attempt `<3`。
- source 必须 enabled、stop clear、adapter ready、authorization valid、platform allowed。
- lease token 使用 `randomBytes(16)`，提供 128-bit 随机量；lease expiry 为 5 分钟，deadline 不超过起始时间 15 分钟。
- envelope 原字节/hash 同步写入 outbox、inbox、attempt；运行前逐字重验 job/inbox envelope、hash、lease token/expiry/deadline、有效期、五 fence 和 stop。

### 7.2 成功与失败结算

- candidate 写事务开始时再次执行 lease/fence/stop 检查。
- 成功结算的 ack、attempt succeeded、outbox succeeded、source active 和 audit append 位于同一立即事务；每个 CAS 要求精确 `changes=1`。
- failure settlement 首先重新读取 job/source/attempt，再核对 leased 状态、lease token、五 fence 和 stop。
- retryable 仅在 transient code 且 attempt `<3`；fixture clock 使用 1 秒、3 秒，最多三次。
- stale/stop/lease invalid 进入 stale settlement；终态失败写 dead-letter；attempt、outbox、inbox、source 与 audit 在同一结算事务更新。
- 016A-G、summary missing 与 approved-chain 路径的源码断言要求 domain before/after hash 一致；dead-letter/audit delta、transactionCommitted 和 recoveryAction 受 closed receipt 约束。
- no-work 不写 receipt，要求计数、domain hash 和数据库字节保持一致；成功 replay 要求原 receipt 字节/hash不变且无 due job。

**静态 PASS；本轮动态 NOT_RUN。**

## 8. 问题分级与最小关闭路径

### P0：0

没有发现能在当前授权范围内直接开放真实外部能力、泄露凭据或绕过唯一候选身份的静态 P0。

### P1：1

**P1-01：必需的独立聚焦运行证据缺失。** 固定 Node24 工具链在任务预期位置不可用，唯一命令 `exit 127` 且未进入 npm/候选。no-egress 真实拒绝计数、25 cases、失败结算、receipt/log 和 cleanup 没有本轮独立运行收据；宿主 launcher 还输出了不受项目 redactor 控制的路径相关错误。

最小关闭路径：由统筹/工具链任务先只读确认项目声明的固定 Node24 精确路径与 hash；重新派发新的后继安全复验任务，在不修改候选的前提下只运行一次同规格 `env -i ... test:contract`。必须 `exit 0`、`cases=25`、`externalCalls=0`、无路径/stack/URL/secret 输出、无任务 DB/receipt/WAL/SHM 残留。当前任务依照首错停止，不能在本轮补跑。

### P2：2

- **P2-01：OS/系统调用级 no-egress 未验证。** 进程 monkeypatch 不能证明内核、防火墙、原生扩展或同 UID 对手边界。
- **P2-02：路径 TOCTOU 未机械验证。** `realpath/lstat/readFile` 分步检查的同 UID 竞争安全性保持 Unknown；固定 hash 提供内容闭合，但不提供稳定 inode 的完整证明。

## 9. 已验证、未验证与错题自检

已验证：20 个任务真值 artifact hash 与两份开发证据 hash 全部匹配；guard 安装顺序和枚举出口；fixture/hash/重复键/regular-file/hardlink/permission/大小与 closed schema 代码；日志与 receipt allowlist；lease 128-bit、期限、五 fence、stop；成功/失败结算、retry/dead-letter、016A-G 回滚、replay/no-work 和清理 helper 的静态控制流；当前固化 receipt/V-OP 无敏感模式；任务临时前缀扫描为空。

未验证：本轮任何候选动态行为；进程级 no-egress 真实拒绝与真实 `externalCalls`；25 cases、失败结算、receipt/log、cleanup；固定 Node24 工具链身份；OS/系统调用级隔离；同 UID TOCTOU；真实 provider/RSS/Base/AI/Admin/发布/部署/生产能力。

错题自检：未在首个非零后重试或换用系统 Node；未把哈希匹配或开发部收据冒充本轮运行 PASS；未把 `externalCalls` 未初始化写成 0；未把 monkeypatch 外推成 OS deny-all；未把本任务 FAIL 扩大为候选漏洞定论；未修改 app、合同、ADR、data、design、lockfile 或正式数据；未联网、安装、启动服务或操作外部资源。

TASK_STATE_OK
