---
type: audit_report
department: 安全部
target: "TASK-20260811-5F3B7D CLI_INTERNAL_ERROR首错"
status: final
date: 2026-08-11
related_task: TASK-20260811-2EAD96
decision: pass
severity_count: { P0: 0, P1: 2, P2: 0 }
tags: [legacy-receipt, validator-root, CLI-reason, fail-closed]
summary: "诊断PASS、恢复仍阻断。legacy validator identity绑定已演进的共享CLI脚本，令旧receipt稳定字段触发RECEIPT_OLD_BYTE_DRIFT；RECEIPT类原因未进安全allowlist，最终对外呈现CLI_INTERNAL_ERROR。P0=0、P1=2，externalCalls=0。"
---

# CLI_INTERNAL_ERROR 与 legacy receipt 验证器漂移独立安全诊断报告

- 任务：`TASK-20260811-2EAD96`
- 对象：`TASK-20260811-5F3B7D` 首错及固定本地证据
- 结论：**诊断 PASS；安全恢复仍须后继实现与复验，当前刷新门保持关闭**
- 分级：`P0=0`，`P1=2`
- 执行边界：纯静态、只读；未运行动态复现，未启动服务，未联网，`externalCalls=0`
- 状态收据：`TASK_STATE_OK`

## 1. 唯一结论

两层假设均成立，并可由当前源码、历史报告及 receipt 非敏感元字段唯一闭合：

1. legacy receipt 的 `validatorArtifactSha256` 同时绑定稳定的 closed-receipt 验证模块和持续演进的共享 CLI 入口。共享入口扩展到其他 profile 后，即使 legacy 数据库与验证模块未变，validator root 也会改变。现存 receipt 记录旧 root，当前生成路径记录新 root；稳定字段比较据此抛出 `RECEIPT_OLD_BYTE_DRIFT`。
2. `RECEIPT_OLD_BYTE_DRIFT` 未进入 CLI 安全 reason allowlist。`runSafeCli` 因此把该完整性拒绝归一为 `CLI_INTERNAL_ERROR`。这是错误分类与可诊断性缺口，完整性门仍然 fail-closed。

现有证据没有表明数据库内容损坏、receipt 被篡改或外部调用发生。旧 receipt 也不能直接刷新；绕过稳定字段比较、touch 文件或放宽 freshness 均会破坏可信链。

## 2. 证据链

### 2.1 validator 身份发生非业务耦合漂移

当前 `readValidatorArtifactSha256()` 对以下两个文件逐一取 SHA-256，再对 canonical artifact manifest 取根哈希：

- `app/src/server/db/closed-receipt.ts`
- `app/scripts/profile-closed-receipt.ts`

固定证据如下：

| 项目 | 历史/现存值 | 当前值 | 判定 |
|---|---|---|---|
| closed-receipt 模块 SHA-256 | `6466fad6f69912cca2cebcc93a2fd07fc6096fe7582efd37c8d5fc9aa0cf3048` | 同左 | 未漂移 |
| 共享 CLI 脚本 SHA-256 | `beeae3aba02b156e095c3622e94648750075cd5c789808a956181f6aa5fddacb` | `f914623d059fb90e6d4b6769b540fef5a105252f87e4d6fe18dc86e406030793` | 已漂移 |
| validator root | `2a8c89ace30b1e9cac876adb0583ec47e43ce6d6806616a58fac7823ca586d83` | `8940a34ea3695c6de5896e6bf1eee888d1cdad550504e7ca1c5180c43b5e92ac` | 必然漂移 |

当前共享 CLI 文件已承载 SOURCE-MGMT 分支和相关导入。此类路由演进会改变整个文件字节，却不等价于 legacy M3/public receipt 验证语义改变。

### 2.2 实际拒绝路径

`generateClosedReceipt` 把当前 validator root 写入下一份 receipt。`withoutVolatile()` 只排除 `validatedAt` 与 `receiptSha256`；`validatorArtifactSha256` 仍属于稳定字段。`assertExistingReceiptMatches()` 对旧、新稳定字段做 canonical 全量比较，任何差异均抛出 `RECEIPT_OLD_BYTE_DRIFT`。

三份现存 receipt 的非敏感 validator 元字段均为旧 root。由于当前 root 已变，首个 legacy M3 刷新在写入前触发上述拒绝，与上游记录的“首命令 exit 1、后续 public-synthetic 未运行、canonical 零漂移”一致。

### 2.3 CLI 分类缺口

`safeReasonCode()` 仅放行 `CLI_REASON_CODES` 中的 `ConfigError.code`。当前 allowlist 不含任何 `RECEIPT_*` reason；因此 `RECEIPT_OLD_BYTE_DRIFT` 被归一为 `CLI_INTERNAL_ERROR`。该输出没有暴露路径、stack 或 receipt 载荷，脱敏边界有效；同时丢失了“receipt 完整性拒绝”这一可操作类别。

## 3. 风险分级

### P1-1：validator 身份范围耦合

稳定 legacy receipt 的验证器身份绑定可变的多 profile CLI 路由文件。无关路由演进会令已有效 receipt 无法按 freshness 合同刷新，形成可重复的本地可用性阻断，并增加人工绕过完整性门的操作风险。

### P1-2：完整性错误被压平为内部错误

`RECEIPT_*` 未进入安全分类，导致预期的 fail-closed 完整性拒绝对操作者表现为通用内部错误。该问题不构成完整性绕过，也没有载荷泄漏；它会延长恢复路径并提高采取不安全处置的概率。

### P0

`P0=0`。未发现正式数据库写入、receipt 覆盖、外联、秘密泄漏或完整性门绕过。

## 4. 唯一最小安全恢复建议

采用一次**版本化、profile-scoped validator 迁移**，作为同一恢复包完成以下两项，不采用忽略 validator 字段或直接重写旧 receipt 的捷径：

1. 为 legacy M3/public 定义显式 validator revision 与独立稳定入口/manifest，使其 identity 只覆盖实际 legacy 验证器模块和专用稳定入口；SOURCE-MGMT 等共享路由扩展使用各自 identity。冻结新 manifest 后再计算新 root。
2. CLI 对外只新增一个粗粒度安全 reason `RECEIPT_INTEGRITY`。所有内部 `RECEIPT_*` 完整性拒绝映射至该值；具体内部代码仅供本地测试/审计，不输出路径、载荷或 stack。

迁移仅允许旧 root 到已冻结 profile-scoped root 的一次精确转换，须同时满足：

- 旧 receipt 为 canonical JSON、自哈希有效、权限正确，且旧 root 精确等于已登记值；
- DB 字节、schema/ledger/count、logical root、artifact revision，以及除 validator identity 和 freshness/self-hash 外的稳定字段全部精确一致；
- 先在私有候选文件完成校验，再原子安装；public receipt 与配套 data receipt 必须作为一个一致集合处理；
- 任一预检、候选校验或集合提交失败时，保留或恢复旧文件的精确字节，继续 fail-closed；
- 不修改 `assertExistingReceiptMatches()` 为普遍忽略 validator 漂移，不 touch，不手写 freshness，不修改正式 DB。

成功出口：三份新 receipt 均使用冻结后的 profile-scoped root，canonical/self-hash、0600 文件/0700 目录、DB hash 与逻辑根、freshness 全部通过；无 WAL/SHM/tmp 残留，`externalCalls=0`。拒绝出口：旧 root 非预期、任一稳定字段漂移、DB/代码 pin 漂移或无法原子提交时零写入并输出 `RECEIPT_INTEGRITY`。回退出口：旧 receipt 精确字节持续可用，不能形成部分刷新或虚假 freshness。

## 5. 已验证

- 上游首错输出为 `CLI_INTERNAL_ERROR`、`externalCalls=0`，首错后未继续运行 public-synthetic。
- current/historical 两个 validator artifact SHA 与两代 validator root 的关系已独立复算。
- 三份 receipt 的 validator 元字段均为旧 root；未读取或记录 receipt 正文。
- `withoutVolatile`、`assertExistingReceiptMatches`、`safeReasonCode` 与 `CLI_REASON_CODES` 的精确控制流已核对。
- 两个正式 DB、三份 receipt 和四个相关源码文件的 SHA-256 已回读；与本任务取证基线一致。
- 未发现精确任务前缀临时根，也未发现相关 WAL/SHM/journal/tmp/candidate/lock 残留。

## 6. 未验证

- 未执行动态复现；静态路径与固定证据已足以唯一定位，避免增加 canonical 与临时态风险。
- 未实现或运行 profile-scoped validator 迁移，未生成新 receipt，未验证新 root 与原子回退代码。
- 未证明数据库业务内容的完整正确性；本报告仅证明本次首错可由 validator identity 漂移解释，且未见正式 DB hash 漂移。

## 7. 错题自检

- 未把 `CLI_INTERNAL_ERROR` 当作真实内部根因；已还原其下的 `RECEIPT_OLD_BYTE_DRIFT`。
- 未把 validator 漂移推断为 DB 篡改，也未把 fail-closed 拒绝误判为完整性绕过。
- 未输出 receipt 载荷、绝对路径、stack、秘密或完整 Base URL。
- 未建议忽略稳定字段、touch、手写 receipt、放宽 freshness 或修改正式 DB。
- 未运行额外探针、服务、网络或外部能力；未修改 canonical 产品文件。

`TASK_STATE_OK`
