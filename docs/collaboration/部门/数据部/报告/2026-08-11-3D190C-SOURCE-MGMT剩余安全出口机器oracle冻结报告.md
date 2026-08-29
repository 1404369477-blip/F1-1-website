---
task_id: TASK-20260811-3D190C
department: 数据部
status: final
decision: pass
date: 2026-08-11
summary: 仅对closed SOURCE-MGMT正式库做字节哈希和一次物理复制，SQLite只读打开0700临时根中的0600副本；冻结ledger精确计数、audit链/载荷/关联、logical content root及第二writer代码推导失败语义。正式DB零漂移，externalCalls=0，临时副本与sidecar零残留。
external_calls: 0
formal_database_handles_opened: 0
writer_probes: 0
---

# SOURCE-MGMT 剩余安全出口机器 oracle 冻结报告

## 1. 结论

**PASS；P0=0，P1=0，P2=0。**

已交付唯一机器可读 oracle：

`docs/collaboration/部门/数据部/报告/TASK-20260811-3D190C-SOURCE-MGMT剩余安全出口-oracle.json`

Oracle SHA-256：`1ced08f0504bdfab352aea40ddb40e35cbde712ada05148ebc3f1ab82afc248e`。

该 oracle 绑定 closed DB、closed receipt、产品合同、数据合同、数据库/事务/repository/迁移代码与已 ACK 证据的精确 SHA-256。本任务没有修改 App、data、migration、SQLite、Spec、ADR、closed receipt 或任务历史。

## 2. 数据库访问和零副作用

- 正式库：`app/.local/f1plus1-source-management-synthetic.sqlite`。
- 正式库 SQLite handle 打开数：`0`。
- 正式库前/后 SHA-256 均为 `ddf3778c62cf95f195b1f08db8b075d676069f4cc9fb39804063e1004dd2e939`。
- 物理副本数：`1`；临时目录 `0700`，副本 `0600`，副本 SHA 与正式 closed DB 相同。
- SQLite 仅用 `mode=ro&immutable=1` 打开副本，并设置 `query_only=ON`；`database_list` 仅 `main`，`integrity_check=ok`，`foreign_key_check=0 rows`，`user_version=3`。
- 未启动 server/readiness/fixture，未运行 build/typecheck/全量测试，未联网，未执行 writer 或安全探针；`externalCalls=0`。
- 临时副本和专属临时根已精确清理；任务临时残留为 `0`，正式 DB 的 WAL/SHM/journal 残留为 `0`。

## 3. ledger 精确基准

| 表 | 精确计数 | 冻结行语义 |
| --- | ---: | --- |
| `fixture_profile_ledger` | 1 | `source-management-synthetic`；59×39 baseline、59 disabled、schema/migration/validator roots 和零外联/零 Base 写入全部固定 |
| `source_config_fixture` | 1 | 唯一 `local_synthetic`；`retired/stopped/disabled`，config/safety epoch=`5/3` |
| `source_overlay_lineage` | 1 | source version=`5`；first operation=`...0001`，last operation=`...0005` |
| `source_runtime_fence` | 1 | authorization/policy/recovery=`1/1/1` |
| `operation_receipt` | 5 | `add → validate → activate → stop → retire`，均 `succeeded`，5/5 result hash 可复算 |
| `outbox_job` | 1 | 唯一 `source_activation`；`cancelled/SOURCE_STOPPED`，`attempt=0`，`lease_expiry=null` |
| `inbox` | 0 | 与当前闭环状态一致 |
| `task_attempt` | 0 | 与当前闭环状态一致 |
| `dead_letter` | 0 | job 于 worker acquire 前被 stop 取消，未发生 terminal/third-attempt settlement |
| `audit_event` | 5 | 与五条 command receipt 一一关联 |

### 3.1 `inbox=0` 和 `task_attempt=0` 的唯一解释

实得并非缺行。唯一 activation job 创建后仍是 `attempt=0`，没有实时 lease（`lease_expiry=null`）；随后 `source_stop` 在 command transaction 内将 job 置为 `cancelled`，理由为 `SOURCE_STOPPED`。

当前 repository 只在 `acquireActivation()` 成功取得 fresh lease 后，才会同一 transaction 写入 `inbox` 和 `task_attempt`。该阶段没有发生，因此两表精确为 0 与 retired/stopped 闭环完全一致。安全 harness 先前预设两者均为 1 没有冻结依据。

## 4. audit 链、payload 和 operation 关联

### 4.1 存储语义

`audit_event.payload_json` 存的是 canonical audit **core metadata**，它不是业务 payload。这五条 command event 的业务 payload 唯一可追溯来源是同 `operation_id` 的 `operation_receipt.receipt_json.result`。

```text
payload_hash = SHA-256(UTF8(canonicalJson(operation_receipt.receipt_json.result)))
event_hash   = SHA-256(UTF8(canonicalJson({previous_event_hash, core, payload})))
```

实得为：

| seq | reason | operation | payload hash | event hash |
| ---: | --- | --- | --- | --- |
| 1 | `SOURCE_ADD_SUCCEEDED` | `source_add` / `...0001` | `f668f937…d55` | `93b7bdc3…c122` |
| 2 | `SOURCE_VALIDATE_SUCCEEDED` | `source_validate` / `...0002` | `4588ae13…ad8a` | `3d7c7b3a…7a22` |
| 3 | `SOURCE_ACTIVATE_QUEUED` | `source_activate` / `...0003` | `1d64bfb2…302e` | `94073f2d…779` |
| 4 | `SOURCE_STOP_SUCCEEDED` | `source_stop` / `...0004` | `7a39952b…af2` | `3883e83e…19e0` |
| 5 | `SOURCE_RETIRE_SUCCEEDED` | `source_retire` / `...0005` | `4fccb24b…663` | `0c8797fc…b1a` |

五条的单调序号精确为 `1..5`，previous hash 链、payload hash、event hash、operation receipt 关联全部复算一致。全部行均满足 `append_only=1`、`internal_only=1`、`external_calls=0`、`redaction_version=source-management-redaction-v1`。`source_management_audit_no_update` 与 `source_management_audit_no_delete` 两个 trigger 均存在。

## 5. logical content root 唯一算法与实得

使用 `app/src/server/db/profile.ts` 的项目 `canonicalJson`：对 object key 字典序排序，array 保持顺序，有限 JSON number，最终编码为 UTF-8。

表顺序精确为：

```text
fixture_profile_ledger
source_config_fixture
source_overlay_lineage
source_runtime_fence
operation_receipt
outbox_job
inbox
task_attempt
dead_letter
audit_event
```

每表执行 `SELECT *`，每行规范化为 object，再在 closed receipt 冻结的 Node.js `24.18.0` 运行时下按 `canonicalJson(left).localeCompare(canonicalJson(right))` 升序；顶层对象为 `{tables:[{table,rows},...]}`。

```text
logical_content_root = SHA-256(UTF8(canonicalJson(root_object)))
canonical byte length = 24548
logical_content_root = 7cae9bb8767a259086920190f65485800bb6008e3dc294fba893d1b0b8156e6a
```

该值与 closed receipt 一致。本报告没有采用通用 ledger root、文件 SHA 或其他 profile 的 logical table 列表代替它。

## 6. 第二 writer 的允许失败语义（只读推导）

本任务没有执行并发写或锁竞争探针。按当前 pin 的代码，唯一可接受解读为：

1. 第二次产品打开尝试若遇到已存在的 profile lock 路径，会在 `acquireSourceManagementProfileLock(appRoot)` 以 `LOCK_CONTENTION` 失败，失败发生于 SQLite 打开之前；该静态语义不证明锁文件对应存活 owner。
2. 如果讨论的是已持有合法 handle 的 transaction contention，写事务用 `BEGIN IMMEDIATE`，`busy_timeout=250ms`，最多 3 次 begin，间隔 `25ms/50ms`。
3. 仅当错误同时满足 `code === ERR_SQLITE_ERROR`，且 `errcode` 为 `5/SQLITE_BUSY`、`6/SQLITE_LOCKED`，或错误消息匹配 `busy|locked` 时，才归类为可重试的 SQLite contention；其他错误必须原样抛出。上述 contention 连续发生至第 3 次时，统一抛出 `LOCK_CONTENTION: BEGIN IMMEDIATE remained busy after 3 bounded attempts`。
4. `BEGIN IMMEDIATE` 未取得前，callback 业务写入必须为 0；取得后 callback 失败时尝试 `ROLLBACK`，保留原错误。

这是代码推导 oracle，不得对外表述为已执行的双 writer 动态 PASS。

## 7. 已验证 / 未验证

### 已验证

- 全部输入 pin 在生成 oracle 前字节 SHA 匹配。
- 副本完整性、外键、10 表精确计数和行级关系均符合冻结基准。
- 5/5 receipt result hash、5/5 audit payload hash、5/5 event hash、previous chain 和 operation 关联均独立复算一致。
- logical content root 依项目实际算法复算为 `7cae9bb8…6e6a`，与 closed receipt 匹配。
- 正式 DB SHA 前后一致，正式 sidecar、任务临时副本和临时根零残留。

### 未验证

- 未执行第二 writer / SQLite lock 动态探针；结论仅是对 pin 代码的可追溯推导。
- audit UPDATE/DELETE trigger 只从 `sqlite_schema` 确认存在及其 `AUDIT_APPEND_ONLY` 语义，未在严格只读副本上触发。
- 未验证 server/HTTP/provider/Base/Collector/UI/部署/备份/生产环境。

## 8. 错题自检

- 已清除 `inbox=1/task_attempt=1` 的无依据预设；本 oracle 精确冻结为 `0/0`，并绑定 `cancelled + attempt=0 + lease_expiry=null`的状态依据。
- 没有把 `audit_event.payload_json` 误当业务 payload；业务 payload 从同 operation receipt 的 `result` 恢复。
- 没有用 generic table root、DB file SHA 或其他 profile 口径代替 SOURCE-MGMT 唯一 logical root 算法。
- 没有打开正式 DB，没有执行 writer 探针，没有将静态推导写成动态 PASS。
- 没有修改代码、数据、migration、DB、Spec、ADR、receipt 或前驱任务。

TASK_STATE_OK
