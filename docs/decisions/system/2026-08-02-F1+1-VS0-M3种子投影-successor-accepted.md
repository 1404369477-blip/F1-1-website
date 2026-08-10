---
type: implementation_adr
status: accepted
date: 2026-08-02
department: 产品部
decision_id: ADR-M4-VS0-SEED-002
related_task: TASK-20260802-E1CFC2
predecessor: ADR-M4-VS0-SEED-001
predecessor_path: ./2026-08-02-F1+1-VS0-M3种子投影-accepted.md
decision_scope: VS-0 本地 M3 影子种子 projection 的 source_id 排序与 canonical hash 收据纠错
---

# ADR-M4-VS0-SEED-002：M3 影子种子 projection 排序与 hash 收据纠错（accepted）

> 本 ADR 是 `ADR-M4-VS0-SEED-001` 的最小 successor。它只纠正 VS-0 local fixture projection 的行排序与 canonical hash 收据；前任 ADR 的历史正文保持不变，其他派生字段、日期、状态、provenance、59 行禁用和外部能力边界继续沿用前任决定。

## 1. 冲突根因与范围

前任 ADR §2.4 已冻结 `source_id` 按 Unicode code point 升序后计算 `canonical-json-v1`，但其正文同时把来自 M3 原行序的 `96d5caf625f62d059cc51a41d7c3b6a1db623d07cea00c4d256e2d841c693aa2` 写成当前实现收据。该 59×39 projection 的原行序为 `first=x_formula24hrs`、`last=x_autosport`、`sorted=false`，因此算法与收据互相冲突。

本 successor 只处理这一个机械矛盾，不扩大 VS-0，不修改冻结 data schema/state machine、M3 原始字节、data manifest、app、Base、provider 或任何真实外部能力。

## 2. 权威 canonical 算法与对象

以下规则逐字冻结，排序算法优先于任何历史候选收据：

```text
projection_object = {
  fields: Source.required in frozen schema order,
  rows: enriched_rows sorted by source_id Unicode code point ascending
}
canonical_projection_hash = SHA-256(canonical-json-v1(projection_object))
```

`source_id Unicode code point ascending` 是唯一排序规则：按 Python 字符串/Unicode code point 的升序比较；不做大小写折叠、locale 排序、trim、隐式类型转换或其他稳定化。`fields` 保持冻结 `Source.required` 顺序；`rows` 只在计算上述对象前按该规则排序；canonical-json-v1 继续使用既定确定性 JSON 字节规则（UTF-8、无空白、键按 Unicode 排序、数组顺序保留、禁止非有限数）。重复 `source_id`、字段顺序变化、39 列不完整、保守状态变化或输入 artifact hash 漂移均 fail closed。

## 3. 有效收据与历史候选

- `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17` 是同一 59×39 projection 按上述排序算法重算后的唯一有效收据（`sorted_first=x_afcorse`、`sorted_last=x_zhouguanyu24`）。它是本 successor 的 authoritative sorted projection hash，可作为后续只读 validator 的期望值。
- `96d5caf625f62d059cc51a41d7c3b6a1db623d07cea00c4d256e2d841c693aa2` 仅是决策前的 unsorted historical candidate，来源为 M3 原行序；它永远不得标记为 PASS、不得作为当前 projection 输入、不得替代 `e7a8`。

机械复算证据：`rows=59`、`fields=39`；原序 `first=x_formula24hrs`、`last=x_autosport`、`is_sorted=false`、hash=`96d5caf625f62d059cc51a41d7c3b6a1db623d07cea00c4d256e2d841c693aa2`；按 `sorted(key=source_id)` 重排后 hash=`e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`。

## 4. 前任 ADR、回退与后续门禁

前任 [`ADR-M4-VS0-SEED-001`](./2026-08-02-F1+1-VS0-M3种子投影-accepted.md) 仅做最小 frontmatter 状态/指针更新为 `superseded`，历史正文未修改；本文件是当前唯一 canonical accepted 入口。若后续复算不等于 `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`，必须 fail closed，保持不导入 seed；不得回退为 `96d5`，不得以未排序 projection 继续。要撤回或改变本决定，须创建新的 ADR 并保留本文件及前任审计链。

`e7a8` 只证明本地 projection 的机械排序/收据；它不代表 data 任务、VS-0 代码、Repository、SQLite seed command、UI/API、完整 R12、VS-1–3、Base/provider/Collector、采集、发布或部署已放行。后续数据部 validator 复跑与任何 seed import 仍按独立任务门禁执行。

## 5. 变更记录

| 日期 | 版本 | 变更 | 原因 |
|---|---|---|---|
| 2026-08-02 | accepted successor v0.1 | 以 `source_id` Unicode code point 升序算法为权威；将 `96d5` 降级为 unsorted historical candidate，冻结 `e7a8` sorted projection hash；前任 ADR 标记 `superseded` | `TASK-20260802-E1CFC2`；独立守门发现 accepted ADR 的算法与历史 hash 收据冲突 |
