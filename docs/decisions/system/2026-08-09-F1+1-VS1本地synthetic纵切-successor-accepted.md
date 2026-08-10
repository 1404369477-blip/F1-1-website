# ADR-M5-VS1-LOCAL-PIPELINE-002：Event golden 与 Summary 缺失分支纠错

- 状态：`accepted`
- 日期：2026-08-09
- 当前 canonical 决策入口：`ADR-M5-VS1-LOCAL-PIPELINE-002`
- predecessor：[`ADR-M5-VS1-LOCAL-PIPELINE-001`](2026-08-09-F1+1-VS1本地synthetic纵切-accepted.md)，其历史字节保持不变，在本 successor 生效后不再作为当前实施入口
- predecessor SHA-256：`49cc35b6188ec495d70dfed52eca00c9307cca5d1c78a42ed884f53b51281ed7`
- 当前实施合同：[F1+1-VS1本地synthetic纵切实施合同-v0.2.md](../../spec/F1+1-VS1本地synthetic纵切实施合同-v0.2.md)
- 任务：`TASK-20260809-5708AA`

## 1. 唯一裁决

只修订两点：

1. `event-dedup-v1` 的算法、输入字段和 HAPPY 固定英文 `article/en` 内容保持不变。对应 `published_day_utc=2026-08-09` 的 golden 为 `4fbc236a8b27e1f1f45b7165ed5a2374ba35730aaa49f860a2ff94c46874c6b1`；只把日期改为 `2026-08-10` 后的 golden 为 `11aef98ca09276504ed792c50ace95f8d072d0a53bdfd0e2d756e3e12c8c8301`。
2. `VS1-SUMMARY-MISSING-012` 是 closed fixture parser 中唯一允许 `adapter_outcome=candidate` 且缺失 `mock_summary` 的 case。该 case 仍必须含合法 candidate；parser 判为合法，adapter 产出 candidate，Summary allowlist lookup 返回缺失并触发 `SUMMARY_FIXTURE_NOT_ALLOWLISTED`，结果事务完整回滚，failure settlement 原子进入 terminal/dead-letter。其余 candidate case 缺失 `mock_summary` 继续是 `INVALID_FIXTURE`。

## 2. 机械证据

两个 golden 的 canonical bytes 分别为：

```json
{"content_kind":"article","language":"en","normalized_body":"SYNTHETIC_ONLY:F1: Driver A wins.","normalized_title":"SYNTHETIC_ONLY:F1: Synthetic race result","published_day_utc":"2026-08-09"}
```

```json
{"content_kind":"article","language":"en","normalized_body":"SYNTHETIC_ONLY:F1: Driver A wins.","normalized_title":"SYNTHETIC_ONLY:F1: Synthetic race result","published_day_utc":"2026-08-10"}
```

Python `json.dumps(... ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)` 与独立 Node stable serializer 均对上述 UTF-8 bytes 复算出同一对 SHA-256。旧 `28e7cc…86b7`、`442132…fdfd` 仅保留为 predecessor 的旧中文候选输入历史值，不得用于 HAPPY 英文 fixture、`VS1-EVENT-DAY-005` 或开发 PASS 收据。

## 3. 继承与边界

除本 ADR 第 1 节两项外，`ADR-M5-VS1-LOCAL-PIPELINE-001` 与实施合同 v0.1 的 operator、实体、状态、事务、lease、五 fence、retry/dead-letter、reason code、receipt、Owner、验收和外部能力关闭边界全部逐字继承。

本 successor 不修改 predecessor 文件，不修改 app、data、design、依赖或既有领域 schema，不新增 case 字段、运行时注入、领域实体、状态或外部能力。Admin、真实 provider、RSS、Base、发布与部署继续关闭。

## 4. 回退

若任一独立实现无法从第 2 节精确 bytes 复算两个 golden，或 parser 不能证明全 registry 只有 case 012 命中缺失 Summary 例外，则开发保持阻断，v0.2 不得作为 PASS。回退只撤销本 successor 与 v0.2 的当前入口，predecessor 继续作为历史证据；不得回用其两个旧 golden 或把 012 降级成 `INVALID_FIXTURE`。
