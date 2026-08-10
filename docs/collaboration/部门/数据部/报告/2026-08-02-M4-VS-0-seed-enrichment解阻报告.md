---
type: data_delivery_report
status: completed
date: 2026-08-02
department: 数据部
task_id: TASK-20260802-6DAEAE
domain_stage: M4-C-VS0-data-seed-enrichment
execution_mode: offline_local_generator_validator
---

# M4 VS-0 M3→Source canonical seed enrichment 解阻报告

## 1. 唯一结论

**PASS / UNBLOCKED**。

结构化桥接、59×39 投影、Source 核心校验和连续两次独立 reload 确定性生成均通过。当前唯一 accepted 入口为产品部 successor `TASK-20260802-E1CFC2` 的 `ADR-M4-VS0-SEED-002`；它继承 `added_at` 午夜 transport value 到同一日历日期的规则，并将 `source_id` Unicode code point 升序及 `e7a8312c…329f17` 冻结为权威收据。旧 `96d5caf…693aa2` 仅保留为决策前未排序 historical candidate。

桥接 mapping 已升级到 `m4-vs0-seed-enrichment-v0.3`，manifest 升级到 `m4-vs0-seed-enrichment-manifest-v0.3`，清除 `product_decision_required` 和阻断时态，manifest 与 projection 均为 PASS。`source_safety_epoch` 继续从 M3 直接复制，不属于 local-only 补字段。

## 2. 范围与冻结边界

本任务只创建下列新 bridge artifact，并修订 5B8665 报告中的引用与计数：

- [implementation-mapping.json](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/implementation-mapping.json)
- [source-seed-enriched.json](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json)
- [manifest.json](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/manifest.json)
- [seed-enrichment-validator.py](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/seed-enrichment-validator.py)
- 本报告
- 修订后的 [5B8665 C 层 SQLite/Repository 蓝图](/Users/hoyin/Documents/F1+1/docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md)

唯一 current accepted 实现决策入口为 [ADR-M4-VS0-SEED-002](/Users/hoyin/Documents/F1+1/docs/decisions/system/2026-08-02-F1+1-VS0-M3种子投影-successor-accepted.md)（accepted；SHA-256=`1b1fbceeecbfd5c97fdb2da91cdee12eb4fe6a032aec3463179964aab31e6db6`）。前任 [ADR-M4-VS0-SEED-001](/Users/hoyin/Documents/F1+1/docs/decisions/system/2026-08-02-F1+1-VS0-M3种子投影-accepted.md) 仅作为 predecessor 审计链保留。

未修改或覆盖：

- `data/mvp-contract-v0/schema.json`
- `data/mvp-contract-v0/base-mapping.json`
- `data/mvp-contract-v0/state-machine.json`
- `data/mvp-contract-v0/fixtures.synthetic.json`
- `data/mvp-contract-v0/manifest.json`
- `data/mvp-contract-v0/generate_contract.py`
- M3 原始 batch、字段定义和 M3 manifest
- Spec、accepted ADR、app、Base、飞书或任何外部资源

Bridge 是实现输入映射和派生 fixture，不是第二 domain schema、Base truth 或 v0.4 合同。`source-seed-enriched.json` 是 59 个完整 `Source` 对象的候选 canonical projection；Source 字段、枚举和校验仍唯一引用 `data/mvp-contract-v0/schema.json`。

## 3. 逐项源证据与计数纠正

| 项目 | 冻结来源 | 结果 |
|---|---|---:|
| M3 direct header | `data/m3-base-shadow-import-v0/main-source-record-batch.json#/fields` | 33 |
| M3 rows | `.../main-source-record-batch.json#/rows` | 59 |
| M3 Source ID 唯一 | batch rows `source_id`，casefold | 59/59 |
| M3 canonical URL 唯一 | batch rows `canonical_url`，casefold | 59/59 |
| M3 `enabled=false` | batch rows `enabled` | 59/59 |
| Source required | `data/mvp-contract-v0/schema.json#/$defs/Source/required` | 39 |
| Source properties | `data/mvp-contract-v0/schema.json#/$defs/Source/properties` | 39 |
| CapturedItem required | `data/mvp-contract-v0/schema.json#/$defs/CapturedItem/required` | 16 |
| Source−M3 差集 | required − M3 fields | 6 |
| `source_safety_epoch` | M3 fields index 27 / each row | direct, all value `1` |

六个差集字段精确为：

```text
platform_allowed
source_config_epoch
created_at
updated_at
created_by_ref
updated_by_ref
```

5B8665 蓝图中原来的 `13/9` 已纠正为 `Source required=39 / CapturedItem required=16`；`M3 direct input=33/9` 作为输入计数保留。5B8665 现在引用本 bridge 的 mapping、manifest 和 59×39 projection hash，不引用第二套字段或第二 schema。

## 4. Implementation mapping 优先级

Bridge 的 `implementation-mapping.json#/field_map_precedence` 规定以下顺序：

1. `Source` schema 的 required 属性、类型和 format：`data/mvp-contract-v0/schema.json#/$defs/Source/required`。
2. M3 direct field 的所有权和值来源：`data/mvp-contract-v0/base-mapping.json#/source_table/field_map`。
3. 仅对 M3 header 缺失的 Source required 字段使用确定性 derived rule。
4. `base-mapping.json#/local_only_fields/Source` 只是冻结文件中的 local-only 注记，不能覆盖 M3 已有字段。

因此：

- `source_safety_epoch` 在 M3 header 中存在，必须按 `field_map` 直读每行。冻结 `local_only_fields/Source/2` 的旧标注不改变其 direct ownership；本任务不改冻结文件，仅在 bridge 中记录纠正。
- `added_at` 在 M3 header 中存在，仍归 direct field ownership；由于目标 schema 是 date，bridge 按 successor ADR 继承的显式、可审计目标表示转换执行，`product_decision_required=false`。
- Bridge 不会从 `handle`、URL、临时分类或外部访问推导身份、平台允许性或启用结论。

## 5. 六个 derived 字段唯一规则

| 字段 | 目标 pointer | 候选值/规则 | 来源与安全语义 |
|---|---|---|---|
| `platform_allowed` | `schema.json#/$defs/Source/properties/platform_allowed` | 固定 `unknown` | M3 没有平台策略、限流或合规证据；`unknown` 不满足 activation gate |
| `source_config_epoch` | `schema.json#/$defs/Source/properties/source_config_epoch` | 固定整数 `1` | 初始 local fixture/provider epoch；本任务不发生 provider switch 或递增 |
| `created_at` | `schema.json#/$defs/Source/properties/created_at` | `normalized_added_at + T00:00:00Z` | UTC、无墙钟依赖；从显式 `added_at` 日历投影得到 |
| `updated_at` | `schema.json#/$defs/Source/properties/updated_at` | 等于 `created_at` | M3 是 creation-only shadow import，无更新事件 |
| `created_by_ref` | `schema.json#/$defs/Source/properties/created_by_ref` | `synthetic:seed-m3-v0` | 合成实现 actor；不代表人、平台账号、token 或凭证 |
| `updated_by_ref` | `schema.json#/$defs/Source/properties/updated_by_ref` | `synthetic:seed-m3-v0` | 同一 creation-only seed event；保持与 created actor 相等 |

六项都满足 schema 类型/pattern；全部 59 行使用同一规则。`source_config_epoch=1` 只是首个本地 fixture epoch，不能被解释为真实 Base/provider 已切换或已获授权。

## 6. `added_at` 冲突与单一推荐

### 6.1 冲突证据

- Direct source：`data/m3-base-shadow-import-v0/main-source-record-batch.json#/rows/*/28`。
- 59 行 distinct transport value：`2026-07-31 00:00:00`。
- M3 字段定义使用 date-style datetime transport：`data/m3-base-shadow-import-v0/main-source-fields.json` 中 `added_at`。
- Base mapping 指定 `added_at → Source.added_at` 且 `preserve_value=true`：`data/mvp-contract-v0/base-mapping.json#/source_table/field_map`。
- Source target 只接受 date：`data/mvp-contract-v0/schema.json#/$defs/Source/properties/added_at`，`format=date`。

### 6.2 推荐转换

对且仅对严格匹配 `YYYY-MM-DD HH:mm:ss` 且时分秒为 `00:00:00` 的 M3 值：

```text
2026-07-31 00:00:00  ->  2026-07-31
```

该规则保留 M3 的日历日期语义，输出满足 Source `format=date` 的 canonical 表示。它不做以下动作：

- 不静默截断字符串；
- 不转为 `2026-07-31T00:00:00Z` 写入 `Source.added_at`；
- 不推断本地时区；
- 不新增 `raw_added_at`、`added_at_datetime` 或其他业务字段；
- 不修改冻结 schema/base-mapping 以掩盖冲突。

如果任一行出现非午夜时间、其他分隔符或非法日期，validator 立即 FAIL，不自行选择时区或舍入策略。

### 6.3 accepted 语义

产品部 successor `ADR-M4-VS0-SEED-002` 继承 `ADR-M4-VS0-SEED-001 §2.2` 的日历日期投影：保持 v0.3 Source schema 不变，把 M3 时间字符串视为 M3 date 字段的 transport representation。`product_decision_required=false`，该规则已进入 bridge 的正式实现映射；非午夜或非法输入仍由 validator fail closed。

## 7. 机器产物与 hash

### 7.1 Canonical projection

输出文件：[`source-seed-enriched.json`](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json)

- 行数：59
- 字段数：39
- `enabled=false`：59/59
- `source_safety_epoch`：59/59 直读 M3，值集合 `{1}`
- canonical projection hash scope：

```text
SHA-256(canonical-json-v1({fields: Source.required, rows: enriched_rows}))
```

- `canonical_projection_hash`（按 `source_id` Unicode code point 升序）：

```text
e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17
```

### 7.2 Bridge artifact manifest

[`manifest.json`](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/manifest.json) 固定：

- `mapping_version=m4-vs0-seed-enrichment-v0.3`
- `manifest_version=m4-vs0-seed-enrichment-manifest-v0.3`
- `contract_version=mvp-local-v0.3`
- `implementation_mapping=true`
- `non_authoritative=true`
- `second_domain_schema=false`
- `writes_to_base=false`
- `external_calls=0`
- `m3_direct_field_count=33`
- `derived_field_count=6`
- `source_required_field_count=39`
- `row_count=59`
- `enabled_false_count=59`
- `determinism.repeat_count=2`
- `determinism.equal_projection_bytes=true`
- `determinism.equal_fixture_bytes=true`
- `determinism.validator_mode=offline_local_generator_validator`
- `frozen_contract_manifest.artifact_count=11`
- `frozen_contract_manifest.artifact_hashes_match=true`
- `added_at_projection.product_decision_required=false`
- `canonical_projection_row_order=source_id Unicode code point ascending`
- fixture canonical key=`fields`（与 `Source.required` 顺序一致）
- `status=PASS`

Manifest 的 `artifact_hashes` 覆盖 current accepted successor ADR、冻结合同 manifest 及其 11/11 artifact、M3 batch/fields/manifest、bridge mapping、validator 和 enriched output；manifest 自身排除以避免递归。validator 同时核对 mapping 的所有声明 SHA 与实际文件。

## 8. 只读 validator 与确定性结果

Validator：[`seed-enrichment-validator.py`](/Users/hoyin/Documents/F1+1/data/m4-vs0-seed-enrichment-v0/seed-enrichment-validator.py)

Validator 不使用网络、provider、Base、飞书或外部库。默认 `--repeat 2`，每轮都独立 reload mapping/schema/M3 JSON 后重新执行 `make_rows` 和全部校验；正式输出根固定为 bridge 目录，拒绝 `--root` 任意覆盖、symlink 和非 regular 输出，并通过原子写入落盘。每次执行：

1. 复核冻结 M3 batch、M3 field list、M3 manifest、v0.3 schema、base-mapping 及合同 manifest 的 11/11 artifact SHA-256。
2. 复核 mapping 自声明的 33/6/39 计数、六项 derived rules、`source_id` row order、e7a8 hash、successor ADR ID/path/SHA 与字段 pointers。
3. 生成六项 derived fields 和显式 `added_at` 日期投影。
4. 对 59 行执行 required/type/enum/pattern/format/min/max 核心校验、Source ID/URL 唯一性、39 字段顺序、M3 direct value 保留、59/59 disabled 检查。
5. 对每轮独立 reload 产生的 fixture 和 projection 比较字节完全相等，重算 canonical projection hash；canonical fixture 使用 `fields` 键。
6. 写入 bridge fixture/manifest；不写入冻结合同目录。

两次连续独立执行均返回 exit 0，且 `--require-product-decision` 在 `product_decision_required=false` 时仍返回 exit 0。实际结果：

```text
result=PASS
rows=59
fields=39
m3_direct_fields=33
derived_fields=6
enabled_false=59
repeat_count=2
canonical_projection_hash=e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17
overall_status=PASS
```

两轮内部独立 reload 的 `source-seed-enriched.json` 和 canonical projection 字节逐一相等；正式 bridge 输出通过原子写落盘。`96d5…` 未被标记为 PASS，manifest 仅将其列为 `pre_decision_unsorted_candidate_hash`。

## 9. 验收矩阵

| 检查 | pointer/证据 | 结果 |
|---|---|---|
| M3 原始 batch SHA | `data/m3-base-shadow-import-v0/manifest.json#/payloads` 与 bridge manifest | PASS |
| v0.3 schema/base-mapping SHA | bridge manifest `artifact_hashes` | PASS |
| 冻结合同 manifest 11/11 artifact SHA | `data/mvp-contract-v0/manifest.json#/artifact_hashes`、bridge `#/frozen_contract_manifest` | PASS |
| current accepted ADR-002 ID/path/SHA | mapping `#/accepted_decision`、bridge manifest `#/accepted_decision` | PASS |
| M3 header 33 | batch `#/fields` | PASS |
| Source required 39 | `schema.json#/$defs/Source/required` | PASS |
| CapturedItem required 16 | `schema.json#/$defs/CapturedItem/required` | PASS |
| 差集恰为六项 | mapping `#/derived_fields` | PASS |
| `source_safety_epoch` direct | mapping `#/source_safety_epoch_correction` | PASS |
| 59 rows / 59×39 projection | bridge manifest | PASS |
| Source required/type/enum/format/core bounds | validator | PASS |
| source_id/canonical_url uniqueness | validator | PASS |
| 59/59 `enabled=false` | validator/manifest | PASS |
| unknown/pending/proposed/false/null preservation | validator | PASS |
| external_calls=0 / writes_to_base=false | mapping/manifest/output | PASS |
| two-run deterministic fixture/projection bytes | manifest `#/determinism` | PASS |
| `source_id` Unicode row order与权威 e7a8 | mapping `#/output_projection`、successor ADR §2–3 | PASS |
| fixture `fields` canonical key | `source-seed-enriched.json#/fields`、mapping `#/output_projection/fields_pointer` | PASS |
| `--require-product-decision` flag | validator main；`product_decision_required=false` 时 exit 0 | PASS |
| fixed output root / symlink / atomic write | validator `ensure_safe_output_paths`、`atomic_write` | PASS |
| `added_at` direct preserve wording与date target的语义合并 | mapping `#/added_at_conflict`、successor ADR inherited rule | PASS |

本任务总判定为 PASS；没有新增 P0/P1。

## 10. 已验证、未验证与错题自检

### 已验证

- 正式 claim `TASK-20260802-6DAEAE` 成功。
- 冻结 `data/mvp-contract-v0` 与 M3 输入文件的 SHA-256 与任务前记录一致；没有运行冻结 v0.3 generator。
- `Source` 39 required、`CapturedItem` 16 required、M3 33/9、59 rows 和六项差集通过机械复核。
- `source_safety_epoch` 59/59 从 M3 原值复制，值集合为 `{1}`。
- Bridge 输出 59×39，`enabled=false` 为 59/59，source_id/canonical_url 双唯一，核心 schema 校验通过。
- canonical projection hash 为 `e7a8312c...329f17`，两次连续 validator 执行均返回 PASS；每轮都独立 reload mapping/schema/M3 后 repeat=2，fixture/projection 字节相等。
- `96d5caf...693aa2` 已明确标为历史未排序 candidate，未作为 PASS 收据。
- mapping 自声明 33/6/39、derived rules、row order、e7a8 与 successor ADR-002 ID/path/SHA 均通过 validator 自证。
- 冻结合同 manifest 的 11/11 artifact SHA 全部通过，冻结 v0.3 文件零漂移。
- fixture 已统一使用 `fields` 键；validator mode 已改为 `offline_local_generator_validator`。
- 5B8665 报告已从 `13/9` 修订为 Source `39` / CapturedItem `16`，M3 映射保持 `33/9`，只引用本 bridge 与 current successor ADR。

### 未验证（范围外）

- 没有运行 Node/SQLite、app seed command、Repository、Base/provider、Collector 或任何外部 I/O。
- 没有把 `created_by_ref` 的 synthetic actor 解释为真实用户，也没有把 `source_config_epoch=1` 解释为真实 provider 切换收据。

### 错题自检

- 没有把 `source_safety_epoch` 留在 local-only；M3 direct field ownership 优先。
- 没有把 Source 39 与 M3 input 33 混称；5B8665 的错误 `13/9` 已纠正为 `39/16`，`33/9` 只表示上游 M3 输入。
- 没有静默截断 `added_at`、改写为 RFC3339、猜测时区或添加第二 raw timestamp 字段；转换规则、hash scope 和 accepted ADR 引用均落盘。
- 没有升级 `platform_allowed`、身份、可监控性或 `enabled`；`unknown/pending/proposed/false/null` 保守值保持不变。
- 没有修改冻结 v0.3 字节、Spec、ADR、app、Base 或真实资源，没有访问网络。
- 没有把结构校验 PASS 扩大为 SQLite/Repository 运行收据；本任务仅对本地 bridge projection 形成 PASS。
- 未使用任意 `--root` 写入；输出根固定且 symlink/非 regular 目标被拒绝，文件使用原子写。
- 清理了本任务产生的 `data/.../__pycache__`，缓存未纳入 artifact 或 manifest。

## 11. 收口

current successor ADR 已关闭排序/hash 与唯一产品语义阻断；本报告、mapping、fields fixture 和 bridge manifest 已更新为 PASS。后续开发部仍须在独立任务中提交 SQLite/Repository seed 运行收据，不能把本报告扩大解释为业务实现或生产放行。

TASK_STATE_OK
