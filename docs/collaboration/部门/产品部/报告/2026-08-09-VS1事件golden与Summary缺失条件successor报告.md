---
task_id: TASK-20260809-5708AA
department: 产品部
status: completed
date: 2026-08-09
decision: ADR-M5-VS1-LOCAL-PIPELINE-002
scope: event golden + VS1-SUMMARY-MISSING-012 only
external_effects: 0
---

# VS-1 Event golden 与 Summary 缺失条件 successor 报告

## 1. 结论

已发布最小 accepted successor 和 v0.2 实施合同，只纠正开发任务 `TASK-20260809-D6114C` 登记的两处机械冲突：

1. [ADR-M5-VS1-LOCAL-PIPELINE-002](../../../../decisions/system/2026-08-09-F1+1-VS1本地synthetic纵切-successor-accepted.md)；
2. [VS-1 本地 synthetic 纵切实施合同 v0.2](../../../../spec/F1+1-VS1本地synthetic纵切实施合同-v0.2.md)。

predecessor accepted ADR 与 v0.1 合同的字节均未修改。Spec 索引与全功能矩阵已切换到 v0.2 当前入口，三个 Function ID 继续保持 `P1-blocker`。

## 2. Golden 纠错

HAPPY 固定输入继续是英文 `article/en`：

```json
{"content_kind":"article","language":"en","normalized_body":"SYNTHETIC_ONLY:F1: Driver A wins.","normalized_title":"SYNTHETIC_ONLY:F1: Synthetic race result","published_day_utc":"2026-08-09"}
```

只改日期后的第二输入为 `published_day_utc=2026-08-10`。两种独立实现复算结果：

| 实现 | 2026-08-09 | 2026-08-10 |
| --- | --- | --- |
| Python 标准 JSON + hashlib | `4fbc236a8b27e1f1f45b7165ed5a2374ba35730aaa49f860a2ff94c46874c6b1` | `11aef98ca09276504ed792c50ace95f8d072d0a53bdfd0e2d756e3e12c8c8301` |
| Node 独立 stable serializer + crypto | `4fbc236a8b27e1f1f45b7165ed5a2374ba35730aaa49f860a2ff94c46874c6b1` | `11aef98ca09276504ed792c50ace95f8d072d0a53bdfd0e2d756e3e12c8c8301` |

两种实现生成的 canonical UTF-8 bytes 与 SHA-256 逐字一致。旧 `28e7cc…86b7`、`442132…fdfd` 只保留为 predecessor 的旧输入历史值，不再作为英文 fixture PASS 收据。

## 3. 012 唯一条件分支

v0.2 固定 parser 的四步条件：

- 非 candidate：candidate/summary 均禁止；
- candidate：candidate 必需且完整合法；
- 仅 `VS1-SUMMARY-MISSING-012`：`mock_summary` 必须缺失，出现任何形态都 `INVALID_FIXTURE`；
- 其他全部 candidate case：`mock_summary` 必需，缺失即 `INVALID_FIXTURE`。

012 的 exact candidate 已写入 v0.2。parser 接受该 case，adapter 产生 candidate，Summary lookup 命中唯一 miss，返回 `SUMMARY_FIXTURE_NOT_ALLOWLISTED`；结果事务完整回滚，failure settlement 原子写 terminal/dead-letter 与一条脱敏 AuditEvent。domain delta 全为 0，禁止 retry、partial commit、额外 sentinel、任意 runtime injection、第二 schema 或新增实体。

## 4. 已验证

- Python 与 Node 两种实现对两个 exact canonical bytes 复算一致。
- successor 只覆盖两个 golden 与 012 条件；v0.1 其他 fixture、状态、hash、事务、retry 和 receipt 全部继承。
- predecessor ADR SHA-256 仍为 `49cc35b6188ec495d70dfed52eca00c9307cca5d1c78a42ed884f53b51281ed7`。
- predecessor v0.1 SHA-256 仍为 `2bfbcfc6cb3c890c80d71f8269e9661704e71405c9f2e0a247c648ede1766ccd`。
- 未修改 app、data、design、依赖或外部资源。

## 5. 未验证

- `TASK-20260809-D6114C` 的 app 实现仍被阻断，须待本任务统筹 ACK 后恢复。
- fixture parser、012 运行事务、mandatory suite 以及测试/安全正式运行 ACK 尚未发生。
- Admin、真实 provider、RSS、Base、发布、部署与非 loopback 外部能力持续关闭。

## 6. 错题自检

- 没有原地修改旧 accepted ADR 或 v0.1 历史字节。
- 没有改 event-dedup-v1 算法、字段或英文输入来迁就旧 hash。
- 没有把 012 降为 parser 层 `INVALID_FIXTURE`，真实 Summary 缺失失败仍可达。
- 没有把 012 例外推广到其他 candidate case。
- 没有新增字段、schema、状态、实体、依赖或外部能力。
- 没有把 successor accepted 写成 app 已完成。

## 7. 后续依赖

本任务完成并由统筹 ACK 后，开发部可恢复 `TASK-20260809-D6114C`。后继 `TASK-20260809-061961` 仍需等待本任务 ACK 与安全部 `TASK-20260809-1D7401` ACK；本轮未领取或执行该后继任务。
