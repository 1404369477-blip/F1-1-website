---
type: audit_report
department: 测试部
target: docs/decisions/system/2026-08-01-F1+1-信源库A到D演进路线-accepted.md; docs/decisions/system/2026-07-31-F1+1-信源库维护决策包-proposed.md; docs/spec.md; docs/progress.md
status: final
date: 2026-08-01
related_task: TASK-20260801-E5128C
decision: pass
tags: [M2, source-architecture, A-to-D, accepted-ADR, independent-audit]
summary: ADR-SOURCE-001只接受先A后D的窄范围路线，详细决策包继续proposed；真实资源、Base真值、A provider与D provider仍受独立门禁约束，门禁间隙安全停止，D保持Base单一真值与单向只读快照，故障和回滚不能恢复legacy第二真值。静态合同通过，留有一项auth证据留存的一般级追踪性问题。
---

# A→D accepted 路线合同独立复验报告

## 审核对象与边界

- accepted ADR：`docs/decisions/system/2026-08-01-F1+1-信源库A到D演进路线-accepted.md`。
- 详细决策包：`docs/decisions/system/2026-07-31-F1+1-信源库维护决策包-proposed.md`。
- 唯一开发准绳：`docs/spec.md`。
- 项目进度：`docs/progress.md`。
- 用户确认凭据：`TASK-20260801-24D860`，状态 `acknowledged`、授权状态 `user_confirmed`，确认内容为接受“先 A、后 D”的推荐路线。
- 验收任务：`TASK-20260801-E5128C` 的验收出口、详情与失败路径。
- 验证层级：只读静态 ADR/Spec/进度合同、授权语义、状态转换、故障回滚、Markdown 与本地链接审核。当前没有 A/D 实现或真实 Base 证据，不把静态合同通过扩展为资源、实现、平台或切换放行。
- 写入边界：本轮只新增本测试部 final 报告并流转 TASK；没有修改任何上游产品文档，没有运行飞书登录、授权、资源查询或写入命令，也没有访问或创建真实飞书资源。

## 结论摘要

- `decision=pass`。
- 阻断问题：0。
- 重要问题：0。
- 一般问题：1，为 2026-08-01 auth 验证缺少可独立复现的脱敏原始收据；不影响路线与授权边界判定。
- 通过理由：ADR frontmatter 为 `status: accepted`，接受范围限于 A→D 顺序、Base 单一业务真值、D 单向只读快照、三个执行切换门禁及故障/回滚不变量；原详细决策包仍为 `status: proposed`。真实资源创建、59 条导入、Base 业务真值切换、A `base_direct` 切换和 D `base_snapshot` 切换均未被路线接受自动授权。Base 真值与 A provider 分属独立门禁；只切真值时 legacy 冻结、Collector 停止。A 故障与 D 回滚均不能恢复 legacy 第二真值，本地快照、运行遥测和 overlay 均不能反写 Base。

## 独立证据

### 1. 用户确认与 accepted 范围

`TASK-20260801-24D860` 记录：用户于 2026-08-01 接受上一轮提出的“先 A、后 D”路线；任务已由产品部完成并由统筹部核收。该凭据同时明确禁止把路线接受扩展为真实 Base 创建、登录/授权、59 条导入、采集器切换或自动公开。

ADR 把接受范围限定为：

1. A 先行，Base 成为唯一业务真值，A provider 经独立门禁后为 `base_direct`；
2. A 达到另行定义并验证的稳定窗口后准备 D；
3. D 继续以 Base 为唯一业务真值，只增加 `Base → 本地 last-known-good` 单向只读快照；
4. D 实现、故障与恢复验证通过，并由用户另行确认后，provider 才切至 `base_snapshot`；
5. B、C 不作为当前信源库主路线。

ADR 明确排除字段设计、阈值、表单、迁移操作、工具选型、成本和备份周期等详细建议。该边界与源 TASK 的确认内容一致。

### 2. 文档状态与交叉引用

```text
ADR-SOURCE-001: type=system_adr, status=accepted, decision_id=ADR-SOURCE-001
详细决策包: type=system_decision_package, status=proposed
Spec: Spec v0 草案，仅 ADR-SOURCE-001 明列路线为 accepted
progress: 记录路线已接受，详细决策包继续 proposed
```

详细决策包通过 `accepted_route_adr` 和 S4 指向 ADR，并用 `[已接受决策]` 只标注 A→D 顺序、B/C 排除、Base 单一真值与单向快照；其余无标签规范和 `[产品建议]` 继续保持 proposed。没有发现整包状态升级、accepted 范围外溢或旧“路线尚未获确认”的当前时态。

### 3. 资源门禁与三次执行切换

ADR 分开定义：

1. **真实资源门禁：** 创建或使用真实 Base、表单、应用与账号权限需另行授权；
2. **Base 业务真值切换门禁：** 影子导入、59/59 对账、schema/唯一性/状态、备份和恢复验证完成后，用户明确确认从 legacy 切到 Base；
3. **A provider 门禁：** `base_direct` 完整读取、权限失败、缺页、配置变化、在途失效与停止测试完成后，用户明确确认 active provider 切换；
4. **D provider 门禁：** A 稳定、D 完整性/故障/恢复/阈值验证及独立测试完成后，用户另行确认从 `base_direct` 切到 `base_snapshot`。

Spec 把 Base 真值、A provider 和 D provider列为三次实现验证与用户确认；真实资源授权仍是更前置的独立门禁。ADR 允许 Base 真值与 A provider 在两项授权均已分别取得后原子提交，同时明确一次事务不能替代两次授权。

当前 accepted 路线没有通过任何执行门禁，也没有授权真实资源、导入或 provider 切换。

### 4. 中间停止态与状态转换

proposed 决策包给出完整阶段表：

| 阶段 | 业务真值 | active provider | Collector 行为 |
|---|---|---|---|
| 迁移前 | legacy | `legacy` | 按当前清单运行 |
| Base 影子导入 | legacy | `legacy` | Base 不参与正式采集 |
| Base 真值已切、A provider 未切 | Base | `none / paused` | legacy 冻结，Collector 停止 |
| A | Base | `base_direct` | 只读当前 Base |
| D | Base | `base_snapshot` | 只读获准 last-known-good 快照 |

静态转换模型探针结果：

```text
base_truth_before_A_stops = true
atomic_base_and_A_allowed_after_two_approvals = true
gap_to_A_allowed_after_A_gate = true
A_to_D_allowed_after_D_gate = true
D_to_A_requires_ready_base_direct = true
base_to_legacy_forbidden = true
D_to_legacy_forbidden = true
D_second_truth_forbidden = true
PROBES = 8/8
```

这套状态机区分业务真值和读取 provider；门禁间隙允许零活动 provider 并强制停止，Collector 运行时必须恰有一个 provider。

### 5. A/D 跨阶段不变量

- A、D 的唯一业务真值始终是 Base。
- D 同步只能 `Base → 本地只读快照`；本地文件、Collector、运行遥测和 deny overlay 都不能反写、合并或裁决 Base。
- D 快照只是可重建读模型，不保存完整候选、拒绝、停用或业务审计事实。
- 任一时刻最多一个 active provider；provider 切换递增 `source_config_epoch`，旧 epoch 结果不能写入当前状态。
- 运行遥测独立追加，仅供只读联接，不参与生效谓词或 Base 配置写入。
- “采集”与“公开”继续由人工审核版本/hash 门禁隔离，路线接受没有开启自动公开。

accepted ADR 与 proposed 包、Spec 对以上不变量一致。

### 6. 故障与回滚

| 场景 | 期望安全状态 | 文档合同 | 结果 |
|---|---|---|---|
| A 空响应、缺页、读取中断、schema/权限失败 | 不解释为清空，不用残缺页，不回 legacy；停止并告警 | ADR 5.2.1–2 | 通过 |
| D 同步失败 | 保留最后完整校验快照，标记新鲜度并告警 | ADR 5.2.3 | 通过 |
| D 快照部分、空或破损 | 不发布，不替换 last-known-good | ADR 4.3–5、5.2.3 | 通过 |
| D → A 回滚 | Base 继续为真值；仅在当前 `base_direct` 可用并通过检查时回切 | ADR 5.3.1 | 通过 |
| A 切换失败且 Base 尚未成真值 | 可撤销影子导入，继续 legacy | ADR 5.3.2 | 通过 |
| Base 已成真值后的 A 故障 | 从 Base 恢复或停止，禁止静默回 legacy | ADR 5.3.2 | 通过 |
| 回滚遇到已停用/拒绝/删除 | 不撤销这些 Base 事实，不增加第二写入口 | ADR 5.3.3 | 通过 |

故障路径没有恢复 legacy 第二真值、双向同步或局部快照覆盖路径。

### 7. 2026-08-01 auth 证据边界

ADR、Spec、proposed 包、progress 和 `TASK-20260801-24D860` 均记录：统筹部只读运行 `lark-cli auth status --json --verify`，结果摘要为用户身份 verified、token valid、租户级 scopes 含 Base create/read/update；该命令没有访问或创建 Base。

四份产品文档正确限制该证据的证明范围：

- 可以证明任务记录所述的身份、token 和租户级 scope 状态；
- 不能证明某个 Base 已存在；
- 不能证明目标 Base 的资源级权限；
- 不能证明表、表单或记录状态；
- 不能证明 Base API 已成功实读；
- 不构成真实资源创建、导入或切换授权。

本测试任务遵守“不得访问真实飞书资源”，没有重跑 auth 或 Base 命令。仓库内只保存了多处一致的摘要与任务核收记录，没有保存可独立复核的脱敏原始 JSON、退出码或单独命令收据；因此本轮只能验证其语义使用边界，无法独立重现 exact scope 结果。该追踪性缺口列为一般问题 1。

### 8. 本地链接、Markdown 与项目健康

```text
accepted ADR: local_link_occurrences=4, missing=0, fences=0, trailing_ws=0
proposed package: local_link_occurrences=8, missing=0, fences=6 (balanced), trailing_ws=0
Spec: local_link_occurrences=1, missing=0, fences=0, trailing_ws=0
progress: local_link_occurrences=1, missing=0, fences=0, trailing_ws=0
total local link occurrences=14, unique targets=8, missing=0

python3 docs/collaboration/scripts/agent_team_task.py doctor
TASK_DOCTOR_OK | tasks=15 | full_history_validated=true

git diff --check
(no output)
```

被审文件初始 SHA-256：

```text
11424b03112d8f578a01ffb068ce6d0744fef377294908170df3994ef275c7d2  accepted ADR
5d33315b82ae4901fb8a153a7365072d61cacfe0299e707479e2a381a7e6cc82  proposed package
1a39a06a0eb8d4140a39af8e6b182d6aab8035a09cca7709dcca9a2346da1999  docs/spec.md
a4ca2cbfbfe2e2af64d9fbf7e9d941acc15dfb858b68cb01e6101785ce00633a  docs/progress.md
```

敏感/真实资源标识扫描未发现 Base app token、table ID、form ID、record ID、应用凭据或真实 Base 资源链接。

## 必测失败路径

### 失败路径一：整份 proposed 包被升级为 accepted

- 注入：检查 frontmatter、intro、标签定义及 accepted scope。
- 期望：只有独立 ADR 为 accepted；详细包继续 proposed，accepted 标签只引用 ADR 明列范围。
- 实际：ADR `status=accepted`，详细包 `status=proposed`，范围清楚。
- 结果：通过。

### 失败路径二：路线接受被扩写为资源、导入或切换授权

- 注入：从“先 A 后 D”尝试推导创建 Base、导入 59 条、切 Base 真值或 provider。
- 期望：所有执行动作停在独立门禁。
- 实际：ADR 3.2、6.2，Spec 路线授权边界和 progress 当前未验证项共同截断推导。
- 结果：通过。

### 失败路径三：Base 真值和 A provider 门禁被合并

- 注入：只批准 Base 真值切换，暂不批准 `base_direct`。
- 期望：legacy 立即冻结，provider 为 `none/paused`，Collector 停止。
- 实际：ADR 3.2 及 proposed 包 5.4/M4 明确满足；两门禁均分别批准后才可原子提交。
- 结果：通过。

### 失败路径四：D 形成双向同步或第二业务真值

- 注入：手改本地快照并尝试反写、合并或按最新时间裁决 Base。
- 期望：全部拒绝；从 Base 全量重建本地读模型。
- 实际：ADR 5.1 和 proposed 包 5.1/5.3 禁止反写与双真值。
- 结果：通过。

### 失败路径五：A 在线故障后恢复 legacy

- 注入：Base 已成为业务真值，随后 API 缺页、权限失败或不可用。
- 期望：停止并告警，从 Base 恢复；不能回到冻结 legacy。
- 实际：ADR 5.2.2、5.3.2 满足。
- 结果：通过。

### 失败路径六：D 同步失败覆盖 last-known-good

- 注入：返回空页、部分页、schema 错误或破损快照。
- 期望：阻断新快照，保留最后完整校验版。
- 实际：ADR 4.3–5、5.2.3 与 proposed 包 5.2/5.3 满足。
- 结果：通过。

### 失败路径七：D → A 回滚撤销 Base 变化

- 注入：D 期间 Base 已停用、拒绝或删除来源，再回切 `base_direct`。
- 期望：继续读取当前 Base；不恢复旧名单或旧 epoch 结果。
- 实际：ADR 5.3.1/3 与 proposed 包 5.4 满足。
- 结果：通过。

### 失败路径八：把 auth scope 当资源权限或 API 实读

- 注入：从 token valid 和 Base scopes 推导目标 Base 存在、可读或已获创建授权。
- 期望：结论保持 unknown，执行门禁不变。
- 实际：四份文档均显式限制证明范围；没有发现越权推导。
- 结果：语义边界通过；原始收据追踪性列为一般问题。

### 失败路径九：本地链接失效或状态互相冲突

- 注入：解析四份文档全部相对链接，并对照 accepted/proposed/Spec/progress 当前状态。
- 期望：链接可达，状态无冲突。
- 实际：14/14 链接可达；accepted 范围和 proposed 细节可区分。
- 结果：通过。

## 自设计反向探针

1. **双授权原子提交探针：** Base 真值和 A provider 两项授权均存在时允许一次原子事务；移除任一授权后必须停在 shadow 或 `none/paused`。
2. **门禁间隙探针：** 只切 Base 真值时，legacy 冻结且 Collector 停止，证明“零 provider”是显式安全状态。
3. **A 故障探针：** Base 在线读取出现空页/缺页时，不能把结果视为空集合，也不能临时回 legacy。
4. **D 部分页探针：** 全量同步只读到部分记录时，临时快照不能替换 last-known-good。
5. **D 反写探针：** 本地快照修改、运行遥测或 deny overlay 都不能变更 Base 业务事实。
6. **旧 epoch 探针：** provider 切换后，旧 epoch 任务只留审计，不能更新当前状态或生成当前内容。
7. **回滚单调性探针：** Base 中已停用/拒绝/删除记录在 D→A 后仍保持相同业务状态。
8. **scope 降级探针：** 删除目标资源 ID 与资源 ACL 证据，只保留 token/scopes 摘要时，资源存在性和 API 实读仍为 unknown。

## 问题清单

### 阻断问题

无。

### 重要问题

无。

### 一般问题

1. **2026-08-01 auth 验证存在一般级证据追踪性未覆盖。** accepted ADR、Spec、proposed 包、progress、源 TASK 和产品日志均保存一致且已核收的摘要，但没有另存去 token 的 JSON 结果、命令退出码、CLI 版本或独立证据路径。本任务禁止访问真实飞书，测试部无法重跑 exact 结果。建议统筹部后续只追加一份不含 token、用户隐私或资源 ID 的验证收据，至少包含命令类别、时间、CLI 版本、退出码、身份/token 布尔状态和 scope 名称摘要。该观察不否定已核收 TASK 摘要，也不构成路线合同缺陷；当前文档已把证明范围限制在身份/token/租户级 scope，资源与执行门禁仍为 unknown，因此不影响本轮 `pass`。

## 已验证

- `TASK-20260801-24D860` 的用户确认、`user_confirmed` 授权状态和核收状态。
- ADR frontmatter 为 `status=accepted`、`decision_id=ADR-SOURCE-001`；详细包保持 `status=proposed`。
- accepted 范围只覆盖 A→D 顺序、B/C 排除、Base 单一真值、D 单向快照、独立执行门禁及故障/回滚不变量。
- 真实资源、59 条导入、Base 真值、A provider、D provider、`app/`、部署和自动公开均未获路线授权。
- Base 真值与 A provider 两门禁独立；门禁间隙 `none/paused` 且 Collector 停止。
- A/D 单一真值、单向同步、最多一个 active provider、epoch 围栏和运行遥测只读边界。
- A 空/缺页/权限故障、D 同步失败、D→A 回滚和 Base 成真值后的 A 失败路径。
- auth 摘要在四份文档中的语义边界：只证明身份/token/租户级 scopes，不证明具体资源或 API 实读。
- Spec、proposed、progress 与 accepted ADR 的交叉引用和时态一致性。
- 20 项机械合同检查、8 个状态转换反向探针、9 条失败路径和 8 个自设计探针。
- 14 个本地链接 occurrence 全部可达，Markdown 围栏/尾随空格、敏感资源标识扫描、`git diff --check` 和 TASK doctor。
- 本测试任务没有修改四份上游文件，也没有访问或创建真实飞书资源。

## 未覆盖项

- 2026-08-01 auth 命令的脱敏原始输出、CLI 版本和退出码未留存，本轮未重跑；exact identity/token/scope 结果只能引用已核收任务摘要。
- 具体 Base 是否存在、资源级 ACL、表/表单/记录状态和 API 实际读写能力。
- 创建真实资源、59 条影子导入、59/59 对账、schema/唯一性/状态、备份和恢复验证。
- A `base_direct` 的分页、权限失败、配置变化、在途失效、性能、15 分钟目标和停止实现。
- A 稳定窗口及其量化标准尚未定义或验证。
- D 全量同步、双读一致性、manifest、checksum、原子替换、snapshot age、destructive delta、last-known-good 和恢复演练。
- `source_config_epoch` 持久化、旧任务围栏、真实 provider 切换与 D→A 回滚实现。
- 真实平台授权、公开内容人工审核实现、自动发布门禁、成本、容量和运维能力。
- 当前无可运行代码或 UI，未覆盖动态并发、故障注入、性能、安全、移动端或用户可见出口。

## 用户可见出口

当前产物是系统 ADR 与文档合同，没有可运行的 Base、采集器、管理页或公开页。本轮没有真实用户出口可测；未来每个执行门禁必须用实际 Base/Collector 状态、停止提示、错误信息、恢复结果和最终人工审核公开出口验收，不能只凭文档或底层 helper 通过。

## 结论：通过

`decision=pass`。A→D accepted 路线与 detailed proposed 包的状态边界清楚；资源创建、Base 真值、A provider 和 D provider 未被路线确认越权授权。单一真值、D 单向只读、中间停止态、故障安全和回滚不恢复 legacy 合同在 ADR、Spec、proposed 包与 progress 中一致。auth 摘要缺少脱敏原始收据，已列为一般追踪性问题；其证明范围已被安全收窄，不构成执行或资源放行。

## 错题自检

- 已读取 `docs/collaboration/错题集.md`；当前没有已登记的历史错题，未命中历史条目。
- 本轮专项检查了可复发错误：把整份 proposed 包升级为 accepted；把路线确认扩写为登录、资源创建、导入或切换授权；把 Base 真值和 A provider 合并成一个门禁；门禁间隙继续读 legacy；D 形成反写或第二真值；A/D 故障回滚复活旧名单；把租户级 scopes 当资源权限/API 实读；只检查正常迁移而遗漏停止、部分页、旧 epoch 与回滚单调性。
- 处理结果：亲自核对四份文档及两个 TASK JSON，执行 20 项机械检查、8 个状态转换探针、9 条失败路径与 8 个反向探针；auth exact 输出和全部动态实现继续列入未覆盖；没有修改上游产品文档或访问真实飞书资源。
- 已按项目复杂任务规则完成子 Agent 只读对抗性复核；复核没有发现阻断或重要问题，维持 `pass`，确认 accepted/proposed 范围、四层门禁、中间停止态、D 单向只读及故障回滚合同完整。复核建议把 auth 收据缺失明确为证据追踪性未覆盖，并消除 final 报告中的未来时态；本报告已据此修正。子 Agent 没有修改文件、流转任务或访问真实飞书资源。
