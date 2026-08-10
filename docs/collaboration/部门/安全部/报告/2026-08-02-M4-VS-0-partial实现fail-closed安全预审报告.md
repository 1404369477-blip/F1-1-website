---
type: audit_report
department: 安全部
status: final
date: 2026-08-02
related_task: TASK-20260802-45A639
domain_stage: M4-C-VS0-security-pre-review
execution_mode: local_read_only_and_ephemeral
decision: fail
target: docs/collaboration/tasks/TASK-20260802-158240.json; app/src; app/package.json; app/package-lock.json; app/.env.example; app/.gitignore; docs/collaboration/部门/开发部/报告/2026-08-02-M4-VS-0安全地基与fixture-provider实现报告.md
tags: [M4, VS-0, pre-review, fail-closed, sqlite, symlink, TOCTOU, no-egress]
summary: "TASK-20260802-158240 的 partial 实现预审发现数据库根路径 symlink/父目录检查与路径打开之间的 TOCTOU P0；另外存在任务状态与数据桥接报告未对齐的 P1，以及两项不阻断本预审结论的覆盖缺口。decision=fail；本报告不构成 VS-0 最终放行。"
---

# M4 VS-0 partial 实现 fail-closed 安全预审

## 1. 唯一结论

本预审唯一结论为 FAIL。

- P0：1 项。openSafeDatabase 允许受控根目录的父路径通过 symlink 逃逸，且检查与 DatabaseSync 按路径打开之间存在 TOCTOU 窗口。
- P1：1 项。TASK-20260802-158240 的任务 JSON 仍为 revision 3、execution_state=blocked、blocked-by-data；数据部后续桥接报告已写为 PASS/UNBLOCKED，但尚未形成任务级 accepted/resume 的一致收据。
- P2：2 项。VS-0 完整能力与真实运行收据尚未形成；因 P0 触发停线且禁止触碰共享 .local，动态矩阵没有在本轮重新执行。

P0 足以阻断 TASK-20260802-158240 继续导入和任何 VS-0 最终放行声明。当前结果只适用于 partial 实现的早期安全预审，不代表 VS-0 最终验收、真实外部能力开启或 Source 数据导入完成。

## 2. 范围与禁止事项

本轮仅对 TASK-20260802-158240 当前 partial 实现做本地只读检查和临时目录负例验证，覆盖 app/src、任务 JSON、开发部实现报告及相关本地收据。

本轮没有修改源码、Spec、ADR 或 data；没有安装或清理依赖；没有访问共享 .local；没有联网、飞书、外部资源、真实采集、发布或其他外部 IO。临时负例只使用独立临时目录，并在脚本退出前清理。

## 3. 取证快照与 hash 边界

本报告的事实边界固定在以下本地快照，不因后续实现变化而回写历史结论：

1. TASK-20260802-158240 JSON：revision=3，execution_state=blocked；阻塞理由为 M3 batch 只有 33 列而 Source 要求 39 列，六个字段缺少逐行 canonical enrichment，且 source_safety_epoch 不是 local-only；该任务收据仍未改为 resumed/accepted。
2. 开发部报告 2026-08-02-M4-VS-0安全地基与fixture-provider实现报告.md：记录了环境、能力注册、fixture provider、数据库门、日志脱敏和安全 health DTO；记录的 package-lock SHA256 为 89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3；M3 fixture hash 为 e73b8d6b8a9b1a018dc7d30c90bfe3111b10caeb6fee28486edf27f176a05de5。
3. 数据部桥接报告 2026-08-02-M4-VS-0-seed-enrichment解阻报告.md：声称 bridge m4-vs0-seed-enrichment-v0.2 已得到 59×39 projection、六个 derived fields、全量 enabled=false 且无外部调用；本报告只将其作为后来收据，不把它推断为 TASK-20260802-158240 已 resume 或已完成导入。
4. 本轮未跑生成器、未重算业务数据 hash，也未把任何 token、secret、完整外部 URL 或身份原文写入报告。

## 4. P0：数据库受控根目录可被 symlink 逃逸

### 4.1 静态代码事实

app/src/server/db/database.ts 的 openSafeDatabase 当前采取了以下顺序：

1. 根据 appRoot 计算 .local，并以词法路径判断数据库路径位于 allowedRoot 内。
2. 对父路径执行 mkdirSync 和 chmodSync(0700)。
3. 若目标文件已存在，对目标文件做 lstat，检查 regular、非 symlink、nlink=1，且拒绝 group/world write。
4. 通过 new DatabaseSync(absolutePath) 按路径打开数据库。
5. 打开后设置每连接 PRAGMA：foreign_keys=ON、journal_mode=WAL、synchronous=FULL、busy_timeout=250，并检查数据库、WAL、SHM 的状态。

这组检查没有在打开前对 .local 及每一级父目录做 realpath、owner、nlink 和 symlink 拒绝；也没有使用 O_NOFOLLOW/O_EXCL 或等效的稳定文件描述符绑定来把检查对象与实际打开对象绑定。检查完成后再次按路径打开，留下了父目录替换和检查到打开之间的 TOCTOU 窗口。对目标数据库文件的 lstat 不能覆盖父目录 symlink 将路径重定向到 allowedRoot 外的情况。

fixture provider 对输入 fixture 文件的目标本身有 realpath、regular、nlink 和权限检查；该检查不等价于数据库根及其父目录的安全打开，因此不能消除本 P0。

### 4.2 临时负例结果

在独立临时 root 与 outside 目录中执行 Node 24 的最小负例：

1. 创建临时 root/.local symlink，指向临时 outside。
2. 调用 openSafeDatabase(".local/escape.sqlite", {appRoot: root})。
3. 检查 outside/escape.sqlite 是否出现，并读取其 realpath。

实际输出的关键字段为：

    local_is_symlink=true
    escaped_db_exists=true
    escaped_realpath=<临时 outside 目录>/escape.sqlite
    exit=0

该测试没有使用共享 .local，临时目录已清理。结果证明当前实现会在受控根路径为 symlink 时创建根外数据库；因此 P0 为可复现的实际失败，不是仅凭代码推测。

## 5. 覆盖矩阵

| 检查面 | 本轮判定 | 证据与边界 |
| --- | --- | --- |
| 环境 allowlist、未知变量拒绝 | PASS（静态） | env.ts 采用精确 allowlist，拒绝未知变量、代理、token/secret/password/api key/private key 等命名；REAL_* 必须是字面量 false。 |
| Node 注入、代理与 secret 拒绝 | PASS（静态） | BLOCKED_NAMES 与前缀/后缀规则覆盖 Node 注入、代理和凭据命名；本轮未改变环境。 |
| capability/provider registry | PASS（静态） | localOnly、externalCalls=0、fixture/mock/manual_only，network/externalWrite 关闭。 |
| fixture 目标路径 regular/realpath/nlink/权限 | PASS（目标文件层） | validateFixturePath 对目标文件有 realpath、regular、nlink=1、非 group/world write 及读前读后身份比较。 |
| fixture 父目录与数据库根路径 | FAIL（P0） | 数据库 allowedRoot 仅词法判断；.local/父目录未做完整 realpath 和稳定打开，临时 symlink 负例已逃逸。 |
| DB/WAL/SHM 0600、WAL/FULL/FK/busy_timeout | BLOCKED by P0 | 代码设置并检查这些属性，但不能把根外打开的数据库视为安全通过；修复 P0 后必须重跑。 |
| symlink/hardlink/TOCTOU | FAIL（P0） | 目标文件有部分检查，父目录 symlink 与检查到路径打开 TOCTOU 已被负例确认；稳定 fd 身份绑定缺失。 |
| migration/seed 与 59 行 Source 导入 | BLOCKED | seed 只写 blocked gate ledger，不插入 Source；任务 JSON 仍 blocked-by-data。 |
| no-egress、child_process、外部写入 | PASS（静态） | 当前脚本与实现未发现联网、child_process 或外部写入路径；本轮未触发真实外部能力。 |
| security log redaction | PASS（静态及既有测试收据） | SAFE_KEYS、secret/private 模式删除和字符串上限存在；未把原始凭据写入本报告。 |
| safe health DTO | PASS（静态及既有测试收据） | health route 只返回本地阻塞状态、能力和计数，不返回路径、secret 或 source 身份原文。 |
| 任务状态与桥接收据一致性 | FAIL（P1） | 任务 JSON 仍 blocked，数据桥接报告写 PASS/UNBLOCKED；缺少任务级 resume/accepted 对齐收据。 |
| VS-0 最终放行 | 未验证（P2） | 本任务是早期预审；Repository、seed、UI/API 等最终出口及真实运行收据仍待后续任务。 |

## 6. P1：任务状态与数据桥接收据漂移

数据部桥接报告记录了 59×39 的 enrichment bridge、全量 enabled=false 和无外部调用；TASK-20260802-158240 JSON 的当前快照仍保持 execution_state=blocked 与原 blocked-by-data 理由。两份记录的时间和职责不同，不能直接将桥接报告等同于任务已恢复、已接受或已插入 Source。

最小收口是由统筹部/数据部写出任务级 accepted/resume 收据，明确 39 列 canonical projection、六个 derived fields、source_safety_epoch 的边界、59 行仍未导入或已导入的事实，以及下一步 seed/check 的唯一状态。收到一致收据前，继续导入与 PASS 声明都应保持关闭。

## 7. P2：未完成或本轮未覆盖的出口

1. 当前 partial 实现没有形成 VS-0 全量能力、运行收据和真实能力开启的最终验收包；本报告不替代最终放行。
2. 由于 P0 已确认且任务禁止触碰共享 .local，本轮没有重新执行完整动态矩阵、构建后运行收据或任何真实外部路径。它们必须在修复后以独立临时目录和脱敏收据重跑。

## 8. 可执行修复与复验门槛

1. 对 appRoot/.local 及数据库路径的每一级父目录执行 realpath/lstat；拒绝任一 symlink、hardlink/nlink 异常、非预期 owner、group/world write 或根外解析。不要只对最终文件做检查。
2. 采用 O_NOFOLLOW/O_EXCL 或等效的原子 no-follow 打开流程；对稳定文件描述符 fstat dev、ino、mode、nlink 和 owner，并将 SQLite 打开绑定到已验证对象，禁止 lstat 后再以可替换路径打开。
3. 追加独立临时负例：.local symlink、嵌套父目录 symlink、DB hardlink、WAL/SHM symlink、检查到打开之间的 TOCTOU、Home 外路径以及权限/owner 变化；每项都必须得到拒绝且无根外文件。
4. 对齐 TASK-20260802-158240 与数据桥接收据后，再执行 seed gate、hash/check 和状态更新；在对齐前不得导入 59 行或给出 VS-0 PASS。
5. P0 修复并复验通过后，重新运行 env verify、fixture path、migration、日志脱敏、health DTO、no-egress、lint/typecheck/build 及临时 DB 矩阵；每个结果保留命令、退出码、输入快照边界和清理记录。

## 9. 已验证、未验证与错题自检

### 已验证

- 已正式领取 TASK-20260802-45A639，并按其早期只读预审范围取证。
- 已核对 TASK-20260802-158240 的 revision 3、blocked 状态和开发部 partial 实现报告。
- 已静态复核 env、capability、fixture 目标文件、日志、health、seed gate 和无外部 IO 代码边界。
- 已在独立临时目录复现 .local symlink 导致数据库写入 outside 的负例，exit=0 且出现 escaped_db_exists=true。
- 未修改源码、Spec、ADR、data、共享 .local、依赖或外部资源。

### 未验证

- P0 修复尚未实施，本轮未验证稳定 fd/no-follow 实现。
- DB/WAL/SHM 权限和每连接 PRAGMA 不能在根路径逃逸存在时判为安全通过，需修复后重跑。
- TASK-20260802-158240 是否由统筹部正式 resume/accept、是否执行 seed、59 行实际导入状态，均未在本轮确认。
- VS-0 最终能力、真实运行收据和任何外部采集/发布能力均未验证，也未被开启。

### 错题自检

- 没有把数据桥接报告的 PASS/UNBLOCKED 误写成 TASK-158240 已恢复；将其保留为 P1 状态漂移。
- 没有把 fixture 目标文件检查扩大解释为数据库父目录安全；将父目录 symlink/TOCTOU 单独列为 P0。
- 没有因既有 C 层报告 PASS 就覆盖或改写历史报告；本报告使用独立文件。
- 负例只在临时目录执行并清理，未接触共享 .local，也没有在发现 P0 后继续做真实外部动作。
- 明确本报告是 partial 实现早期预审，未宣称 VS-0 最终放行。

本报告结论：decision=fail；P0=1，P1=1，P2=2；TASK-20260802-158240 保持 blocked，直至 P0 修复、桥接状态对齐并完成后续独立复验。

TASK_STATE_OK
