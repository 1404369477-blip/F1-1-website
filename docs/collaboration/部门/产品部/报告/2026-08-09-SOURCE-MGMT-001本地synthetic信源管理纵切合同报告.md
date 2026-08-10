---
title: SOURCE-MGMT-001 本地 synthetic 信源管理纵切合同报告
type: product_delivery_report
status: final
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-936D79
decision: pass_with_implementation_gate
external_calls: 0
---

# SOURCE-MGMT-001 本地 synthetic 信源管理纵切合同报告

## 1. 结论

产品部已形成单一 proposed 实现合同：

- `docs/spec/F1+1-SOURCE-MGMT-001本地synthetic信源管理纵切实现合同-v0.1.md`
- SHA-256：`0d1bbcabeef2fbb68041f889486b6f654dff462ace69181a1cb7d1c9348cc6de`

合同把 `SOURCE-MGMT-001` 收敛为一条可直接交给数据、设计和开发拆分的本地 synthetic `/admin/sources` 纵切，覆盖用户入口、39 字段、canonical 状态、展示 alias、操作、closed API/DTO、事务、幂等、operation 对账、失败恢复、390/1440、无障碍和安全边界。

本任务合同层验收通过；功能实施状态继续为 `P1-blocker`。数据部 `TASK-20260809-8F382B` 当前仍为 `claimed`、尚未 final/ACK，`PROFILE-SOURCE-MGMT-001` 因此保持唯一待确认拓扑项。真实页面、profile、migration、运行收据与视觉均未实现。

## 2. 吸收的权威输入

| 输入 | 当前 SHA-256 | 本合同采用范围 |
|---|---|---|
| `data/mvp-contract-v0/schema.json` | `de6c6c07a33589106ebb93496ad10ae3b06ab1c7845e4e0e91888ca0b17ae5a4` | Source 唯一 39 字段 |
| `data/mvp-contract-v0/state-machine.json` | `d5ca45fd60c2ad08c60929abd714f6e80c43c20f561be0c0a18e3baa17c7c120` | 16 个 onboarding state、4 个 lifecycle state 与 frozen transition |
| `data/mvp-contract-v0/runtime-envelope.schema.json` | `15d398cbaaefa37dabfa6af9b7b9c3cc8b207922ef67b0889329366f8336b30d` | TaskEnvelope、五 fence、lease、attempt、operation/key |
| `data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json` | `d4da9fc24c792c0471bcd24c525a46dcef1e521b36a870fd111e7310243888b2` | 59×39 本地基线；canonical sorted projection receipt 继续使用 accepted `e7a8312c…29f17` |
| `ADR-M4-KICKOFF-001` accepted | `10cc265b326291749944acfa5952fa8c6661a20b22f5842a381c250c91c2526b` | loopback、单进程单 profile/SQLite、no-egress、fixture-only、五 fence |
| 安全部 VS-1 local Admin 候选 | `e043705915c4c2489cdf3cb178677b4d5dc753781c98e8c10e7886d2a5462218` | local session、Host/Origin、CSRF、canonical JSON、reason code |
| 设计部 M4 C 层交接 | `0bbcf27a68d0f2c72a31e4226284ad9cbf43d13ff929fd4d99cec985c3de3b93` | `/admin/sources` 组件语义、11 alias、390/1440、无障碍 |

## 3. 已关闭的产品判断

1. **查看与筛选**：冻结 59 条禁用基线只读；本地新增 Source 可见；平台、生命周期、enabled、onboarding 四类筛选固定；基线 hash/count 漂移时整页失败关闭。
2. **字段真值**：API 的 `source` 逐项使用 canonical Source 39 字段；三个 UI 视图槽位只读计算，不持久化，不形成第二 schema。
3. **新增与验证**：add 只接受 `https://synthetic.invalid/...`；add 只落 Source/command receipt/AuditEvent，validate 是同步 deterministic no-egress command；两者都不创建 validation job/queue/Outbox/TaskEnvelope。
4. **状态转换**：validation 的失败、查重和三门结果只组合 frozen transitions；alias 仅展示；`unknown` 不提升为 enabled。
5. **原子 activate**：门、stop 与五 fence 全绿后，Source enabled+queued 与唯一 Outbox/TaskEnvelope 同事务；首次、新激活、resume、queue retry 的 identity 规则分开。
6. **stop/retire**：stop 提升 config/safety fence，旧任务不能提交；retire 只走 frozen lifecycle edge；物理 DELETE 永远不注册。
7. **两类 retry**：validation retry 只走 `/validate` 新 command；dead-letter 只走 `/requeue` 并复用原 business operation/key/Outbox；模糊 `/retry` 永远 404。
8. **恢复与并发**：Source CAS、command idempotency、response-loss operation 查询、CSRF 单次消费和禁止自动换 key 已固定。
9. **UI/安全**：loading/empty/partial/error/conflict/stale/blocked/dead-letter/active/stopped/unknown 均可达；390/1440、焦点、读屏、单 action、URL 不可点击和 no-egress 已固定。
10. **公开零影响**：public profile/db/Repository/API/App 不读写此 Admin profile；真实 provider、Base、平台、AI、媒体、发布、部署和非 loopback I/O 保持关闭。

## 4. 唯一拓扑项与部门交接

### 4.1 唯一候选

只保留 `PROFILE-SOURCE-MGMT-001`：数据部 `TASK-20260809-8F382B` 的 `source-management-synthetic` 单 writer profile 候选。候选须满足：

- 一个进程只打开一个 SQLite；禁止 ATTACH、跨 profile query 与跨库事务；
- 冻结 59 条基线由候选固定的本地只读 artifact/manifest 提供 hash 与 row identity 引用；不打开 m3/public SQLite，也不复制 59 行；
- 只落本地 synthetic Source 的稀疏覆盖、operation、Outbox 与 AuditEvent；
- m3/public profile 字节、计数、hash 和 Repository 真值零漂移。

在 8F382B final 机器合同获统筹 ACK 前，开发启动必须返回 `ADMIN_SOURCE_PROFILE_NOT_READY`。若候选失败，本合同保持 proposed/blocked，不自动新增另一 profile 或第二写主。

数据候选报告当前虽然写为 `status: final`，任务 JSON 仍为 `claimed`、未获统筹 ACK；报告内部还同时存在“同步 validation command”与“add 创建 `source_validation` Outbox/TaskEnvelope”两套语义，并使用缺少 retire 的第二 operation 命名集。产品合同已经按任务原文与最小实体原则冻结唯一口径：

- validation intent 仅为 durable command receipt + request hash + Source CAS/AuditEvent；
- add/validate/stop/retire 不新建 Outbox/TaskEnvelope；
- 只有 activate 创建新的 `source_activation` Outbox/TaskEnvelope；dead-letter requeue 复用原 Outbox/operation/key；
- command receipt 枚举唯一为 `source_add|source_validate|source_activate|source_stop|source_retire|source_requeue`；Outbox 业务枚举只使用 `source_activation`。

8F382B 必须删除 `source_validation` lane、validation worker/lease/attempt、add 返回 job receipt，以及 `create_validate|validate|activate|stop|requeue` 第二命名集，完成机器合同修订后才可 ACK。当前不允许开发从数据候选的冲突段落选择实现。

### 4.2 精确后继

- **数据部**：完成 profile path/selector/ledger/root/schema fingerprint、59 引用与稀疏覆盖映射、39 字段默认、state/CAS/epoch、Source—Outbox—TaskEnvelope、fixture/validator；删除 validation Outbox/worker 和第二 operation 命名集，补齐 `source_retire`；消除 `payload_json` 第二 Source schema 风险。
- **设计部**：冻结 390/1440 深浅主题、11 alias、全部状态、表格/卡片/Drawer/Dialog、add/validate/activate/stop/retire/requeue 与无障碍 hash；基线无 action，URL 不可外联。
- **开发部**：只在数据 ACK、设计冻结/用户视觉门满足后实现 closed API/DTO；不得增加依赖、跨 profile、静态第二真值、真实 provider 或外部 I/O。
- **测试部**：执行合同 17 项 mandatory golden，绑定同一 app/data/design/profile hash；TODO/SKIPPED/NOT_RUN 均保持 P1。
- **安全部**：复验 exact Host/Origin、session/CSRF、canonical JSON、CAS/idempotency、五 fence、stop 失效、dead-letter identity、日志脱敏、single profile、no-egress。

## 5. 已验证

- Source required 字段共 39 个；合同映射表覆盖 39/39，未出现第二 persisted Source 字段集。
- canonical onboarding 共 16 个、lifecycle 共 4 个；合同没有新增 canonical state，validation 复合结果明确沿 frozen transition 逐边结算。
- 冻结基线 receipt 明确为 59×39、59 disabled、accepted sorted projection hash `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`。
- 仅有一个 profile 决策点；合同明确禁止同进程跨库 join、ATTACH、59 行复制、public DB 写入与第二 writer。
- API 不注册 DELETE 与模糊 `/retry`；validation retry、activate retry 与 dead-letter requeue 有独立路由和 identity 规则。
- command receipt 六枚举与唯一 `source_activation` Outbox 已分域；validation intent=command receipt，只有 activate 创建新 Outbox/TaskEnvelope。
- `externalCalls=0`；没有安装、网络请求、真实账号、Base、provider、AI、媒体、发布、部署或外部资源变更。
- 本任务只新增 proposed 产品合同和本报告；app、data、design、accepted ADR 核心未修改。

## 6. 未验证与阻断

- `TASK-20260809-8F382B` 的报告文件已出现但任务仍为 claimed、尚未 ACK；profile 的物理表、root、selector、稀疏覆盖和 baseline 引用机械合同未验证，validation lane/operation enum 冲突尚待数据部修订。
- `/admin/sources` API、SQLite transaction、worker、页面和 17 项 golden 尚未实现/运行。
- 390/1440 深浅视觉 successor、不可变 snapshot/hash 和用户视觉确认尚未完成。
- local session/CSRF 候选在此功能上的实现与攻击矩阵、同 UID 风险、真实 Node24/SQLite 候选 hash 尚未复验。
- 真实 provider/Base/平台/外联、生产认证与部署持续未授权；本合同不能作为这些能力的放行证据。

## 7. 错题自检

- 未把 UI alias 写成 canonical enum；`manual_only` 仅为 badge。
- 未把 validation 当 activation；validate 不创建 job/outbox，activate 才可原子 enabled+queued。
- 未保留数据候选中的 `source_validation` lane 或第二 operation 命名集；当前冲突被明确设为数据 ACK 前阻断。
- 未把 stop 当删除；历史 Source、operation、Outbox、attempt 和 AuditEvent 保留。
- 未把 response unknown 写成领域 `reconcile_wait`；Source command 只查询 operation receipt。
- 未假设同进程跨库 join；未复制 59 条基线；未新增第二写主、第二 Source schema、第二 operation identity 或未冻结状态。
- 未把 8F382B claimed 写成已交付/ACK；未将 proposed 合同或后继实施写成 complete。
- 未把 fixture URL、门禁或本地 mock 收据外推为真实授权、真实平台能力或公开能力。

## 8. 任务状态

`TASK-20260809-936D79` 可按标准任务出口完成；合同判断已收敛，后继实施继续受数据 ACK、设计/用户视觉门、开发、测试与安全独立证据约束。
