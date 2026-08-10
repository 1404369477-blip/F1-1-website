# F1+1 VS-1 本地 synthetic 纵切实施合同 v0.2 successor

- 状态：`accepted contract / pending implementation`
- 日期：2026-08-09
- 当前决策入口：[`ADR-M5-VS1-LOCAL-PIPELINE-002`](../decisions/system/2026-08-09-F1+1-VS1本地synthetic纵切-successor-accepted.md)
- predecessor 合同：[`v0.1`](F1+1-VS1本地synthetic纵切实施合同-v0.1.md)，SHA-256=`2bfbcfc6cb3c890c80d71f8269e9661704e71405c9f2e0a247c648ede1766ccd`
- 适用 Function ID：`COLLECT-MOCK-002`、`CONTENT-PROCESS-003`、`SUMMARY-MOCK-004`
- 修订范围：仅 `event-dedup-v1` 两个 golden 与 `VS1-SUMMARY-MISSING-012` 的 closed 条件分支

## 1. 继承规则

v0.1 全部合同继续有效，以下两节覆盖 v0.1 对应冲突句。任何实现不得借本 successor 修改其他 fixture、状态、hash 输入、事务、retry、receipt 或授权边界。

## 2. `event-dedup-v1` golden 覆盖

算法继续是：

```text
lowercase_hex(SHA-256(canonical-json-v1({
  content_kind,
  language,
  normalized_body,
  normalized_title,
  published_day_utc
})))
```

HAPPY 与 `VS1-EVENT-DAY-005` 共用下列四个不变值：

```json
{
  "content_kind": "article",
  "language": "en",
  "normalized_body": "SYNTHETIC_ONLY:F1: Driver A wins.",
  "normalized_title": "SYNTHETIC_ONLY:F1: Synthetic race result"
}
```

| Case / 日期 | canonical-json-v1 SHA-256 |
| --- | --- |
| `VS1-HAPPY-001` / `2026-08-09` | `4fbc236a8b27e1f1f45b7165ed5a2374ba35730aaa49f860a2ff94c46874c6b1` |
| `VS1-EVENT-DAY-005` / `2026-08-10` | `11aef98ca09276504ed792c50ace95f8d072d0a53bdfd0e2d756e3e12c8c8301` |

测试必须同时断言：两种独立 serializer 生成相同 canonical bytes；只改变日期时两个 hash 精确等于表值；输入 key/文本/语言/content kind 任一变化都不允许以表值通过。旧 `28e7cc…86b7`、`442132…fdfd` 不属于这两个英文 fixture。

## 3. `VS1-SUMMARY-MISSING-012` 唯一 closed 分支

### 3.1 parser 条件

registry 顶层和 attempt 的 closed 字段集合保持 v0.1 不变。parser 在完成 `additionalProperties=false`、类型、attempt 顺序与 enum 校验后，按以下固定顺序应用条件：

1. `adapter_outcome != candidate`：`candidate` 与 `mock_summary` 都必须缺失；出现任一字段即 `INVALID_FIXTURE`。
2. `adapter_outcome == candidate`：`candidate` 必须存在且通过 v0.1 全部结构校验。
3. `case_id == VS1-SUMMARY-MISSING-012`：`mock_summary` 必须缺失；出现时 `INVALID_FIXTURE`。
4. `case_id != VS1-SUMMARY-MISSING-012` 且 outcome 为 candidate：`mock_summary` 必须存在并通过 v0.1 全部结构校验；缺失时 `INVALID_FIXTURE`。

第 3 条是 registry 全域唯一例外。validator 收据固定三个字段：`candidate_case_count=count(all attempts where adapter_outcome==candidate)`、`missing_summary_exception_case_ids=["VS1-SUMMARY-MISSING-012"]`、`missing_summary_exception_count=1`。第一个值必须从 registry 实际扫描派生；后两项必须同时由“candidate 且无 mock_summary”的实际扫描结果派生并精确等于固定值。禁止硬编码一个与 registry 扫描无关的收据。

### 3.2 adapter、Summary 与事务出口

012 的 attempt 必须是：

```json
{
  "attempt": 1,
  "adapter_outcome": "candidate",
  "fault_injection": "none",
  "candidate": {
    "external_id": "synthetic-summary-missing-012",
    "external_url": "https://synthetic.invalid/vs1/summary-missing-012",
    "content_kind": "article",
    "language": "en",
    "title": "SYNTHETIC_ONLY:F1: Summary missing case",
    "body": "SYNTHETIC_ONLY:F1: This candidate intentionally has no mock summary.",
    "published_at": "2026-08-09T00:00:00Z"
  }
}
```

`mock_summary` key 必须不存在；不得写 `null`、空对象、空字符串或额外 sentinel 字段。

parser 对该对象返回合法。adapter 正常产出一个 candidate。worker 进入 v0.1 的结果事务，依次构造 observation、capture、Content 与 Event；Summary 阶段只按当前 `content_version_hash` 查当前 case 的 mock summary allowlist。012 唯一结果是 lookup miss → `SUMMARY_FIXTURE_NOT_ALLOWLISTED` → 结果事务完整 ROLLBACK → 原子 failure settlement 写 `inbox=rejected`、attempt/Outbox `terminal_failed`、Outbox `dead_letter` 与一条脱敏 AuditEvent。Content/Event/Summary/ReleaseBundle 相对事务前均为 `+0`，禁止 partial commit 或 retry。

三行 V-OP 终态固定为：

| Function ID | status | reasonCode | recoveryAction |
| --- | --- | --- | --- |
| `COLLECT-MOCK-002` | `FAIL` | `SUMMARY_FIXTURE_NOT_ALLOWLISTED` | `FIX_FIXTURE_AND_RESEED_TASK_DB` |
| `CONTENT-PROCESS-003` | `FAIL` | `SUMMARY_FIXTURE_NOT_ALLOWLISTED` | `FIX_FIXTURE_AND_RESEED_TASK_DB` |
| `SUMMARY-MOCK-004` | `FAIL` | `SUMMARY_FIXTURE_NOT_ALLOWLISTED` | `FIX_FIXTURE_AND_RESEED_TASK_DB` |

012 没有任何持久化纵切输出，因此三项都以同一根因 FAIL；full receipt 的 `transactionSequence` 仍必须证明 adapter、Content/Event 阶段曾到达 Summary lookup。receipt 还必须记录 `transactionCommitted=false`、所有 domain deltas 为 0、Outbox/dead-letter settlement delta、`externalCalls=0` 与唯一恢复动作。

### 3.3 负例

mandatory validator/tests 至少包括：

- 012 缺 summary：parser PASS，运行命中 Summary reason code；
- 012 含合法、null、空对象或空字符串 summary：parser `INVALID_FIXTURE`，adapter 不运行；
- 任一其他 candidate case 缺 summary：parser `INVALID_FIXTURE`；
- 非 candidate attempt 含 candidate 或 summary：parser `INVALID_FIXTURE`；
- 将 `case_id` 改成大小写或近似值：不命中例外；
- 全 registry 扫描严格只有 012 一项缺失 summary。

## 4. 开发、测试与恢复出口

- 开发：以 v0.2 为当前入口实现两个 golden 与 parser 条件；不改 v0.1 其他行为。
- 测试：独立复算两个 hash，跑 012 正例与全部负例，比较除预期两处外的 registry/case/state/hash 零漂移。
- 安全：确认 012 不引入额外字段、任意 runtime injection、外部调用、日志原文或 fail-open。
- 恢复：任何 hash、exception count、case ID、reason code、delta 或 transaction 状态不一致都保持开发任务阻断；恢复 v0.2 输入后重建任务隔离库，不修改 app 之外的冻结 data/profile。

## 5. 完成门禁

本 successor 自身不证明 app 已实现。`worker:mock`、`test:contract`、完整 mandatory suite 与测试/安全正式 ACK 通过前，三个 Function ID 继续为 `P1-blocker`。Admin、真实 provider、RSS、Base、发布、部署及非 loopback 外部能力继续关闭。
