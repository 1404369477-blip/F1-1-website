---
task_id: TASK-20260809-3AC51E
department: 产品部
status: completed
date: 2026-08-09
decision: ADR-M5-VS1-LOCAL-PIPELINE-001
scope: COLLECT-MOCK-002 / CONTENT-PROCESS-003 / SUMMARY-MOCK-004
external_effects: 0
---

# VS-1 本地 synthetic 采集、清洗去重与 mock 摘要纵切实施合同报告

## 1. 结论

已把分散在 Spec、VS-1 测试计划、数据 SQLite/fixture 蓝图、Event 去重候选、重试/安全合同与全功能矩阵中的判断收敛成单一 accepted 窄范围决策与可直接开发的实施合同：

1. [`ADR-M5-VS1-LOCAL-PIPELINE-001`](../../../../decisions/system/2026-08-09-F1+1-VS1本地synthetic纵切-accepted.md)；
2. [`F1+1 VS-1 本地 synthetic 纵切实施合同 v0.1`](../../../../spec/F1+1-VS1本地synthetic纵切实施合同-v0.1.md)；
3. 全功能追踪矩阵 `COLLECT-MOCK-002`、`CONTENT-PROCESS-003`、`SUMMARY-MOCK-004` 三行现行引用与时态。

本任务关闭的是实施判断。三个 Function ID 仍为 `P1-blocker`，因为 `app/package.json` 的 `worker:mock`、`test:contract` 仍指向 pending script，`check` 尚未包含 `test:contract`，也没有开发运行、测试或安全正式收据。

## 2. 已冻结内容

### 2.1 operator 与隔离边界

- 唯一入口：`cd app && npm run worker:mock -- --once`。
- 每次只选择一个 operation；同一进程、同一任务根/SQLite 内最多完成三次 attempt。
- 固定 fixture registry、seed、manifest 路径与 hash 绑定；固定 Source 基线、clock、五 fence、TaskEnvelope/Outbox identity 与 payload hash 公式。
- 任务数据库不加入业务 runtime profile，不读写现有 profile；非 loopback `externalCalls=0`。
- 依赖 bootstrap 不在本任务运行授权内；验收只读复核既有 lock/node_modules，缺失即 fail closed。

### 2.2 内容处理与领域状态

- `normalize-text-v1` 逐步冻结 line ending、ASCII whitespace、控制字符与 Unicode 保留规则。
- `synthetic-quality-v1` 只识别固定 synthetic marker；content normalization、empty、广告、垃圾、F1 无关与 relevance unknown 都在 Content 插入前停止，并以 CapturedItem + internal receipt/AuditEvent 表达。
- content-ingest 幂等、`event-dedup-v1` fingerprint、Unicode 排序、union CAS、canonical 变化与 collision fail-closed 均为唯一规则。
- canonical Content 逐边 CAS 到 `review_pending`；noncanonical 停在 `dedup_pending`。无新增状态或逆向边。
- Summary 固定 `synthetic:mock-summary-v1`、`summary-schema-v1`、`ready`；ReleaseBundle 固定 `ready,immutable=true,manual_only`，逐层重算 hash。
- 已批准或后续链出现时固定 `APPROVED_CHAIN_PRESENT`，不触碰 ReviewDecision、Publication 或 Projection。

### 2.3 事务、重试与收据

- 固定 lease acquisition、成功结果、failure settlement 三类事务及 CAS/回滚顺序。
- 每次 acquire 构造 schema-valid live TaskEnvelope，并用同一 envelope hash 原子绑定 Outbox、inbox、task_attempt；完成 CAS 再次复核。
- transient 错误固定 3 次预算、`1s/3s` fixture clock、同 operation/key、新 lease、五 fence 重验；dead-letter 后只归档并重建任务库。
- 18 类主案例加 `016A..016G` 七个事务故障点均有固定输入、reason code、delta 与恢复出口。
- V-OP stdout 固定六字段；full receipt、NO_WORK、DB checkpoint/close/hash、reasonCode/status/recoveryAction closed 映射均已冻结。

## 3. 已验证

- 文档入口、相对链接、Markdown fence、UTF-8 replacement character：机械检查通过。
- `app/package.json` 当前时态机械确认：`worker:mock=node scripts/pending.mjs`、`test:contract=node scripts/pending.mjs`，`check` 未调用 `test:contract`；矩阵因此保持 `P1-blocker`。
- 产品/范围对抗审查：P0=0、P1=0。
- 领域/机械对抗复验：P0=0、P1=0；确认 CapturedItem、live TaskEnvelope、Content/Event/Summary/Bundle、retry/replay/NO_WORK 闭合。
- 安全/恢复对抗复验：P0=0、P1=0；确认 no-egress、单 DB、failure settlement、lease、同进程 retry 与可复算 DB hash 闭合。
- 未修改 app、data、design、既有 accepted ADR 核心或任何真实外部资源。

## 4. 未验证

- `worker:mock`、fixture registry/seed/manifest、migration/repository/receipt 仍未实现。
- mandatory fixture、contract test、并发 CAS、retry/dead-letter、no-egress 与日志泄露矩阵仍未运行。
- Node24/SQLite 环境的本切片正式运行、测试/安全独立 ACK 尚不存在。
- Admin 可见、真实 provider、RSS、Base、自动/外部发布、部署与生产能力持续关闭；本任务没有验证或授权这些能力。

## 5. 错题自检

- 没有把 accepted 实施判断写成 app 运行完成。
- 没有用 `NOT_RUN`、pending script、静态代码存在或测试计划冒充完成。
- 没有新增领域实体、第二 schema、quality 状态机、collection operation type 或业务 runtime profile。
- 没有把 collection failure 写入 Publication 专用 `reconcile_wait`。
- 没有把 dead-letter 恢复留成“复用旧 key / 新 key”二选一；本切片只允许归档重建并生成新 operation/key。
- 没有把 synthetic marker 规则外推为真实内容质量模型。
- 没有开启 Admin、真实 provider/RSS/Base、外部发布、部署或网络依赖安装。

## 6. 下一步拆分

开发部按同一个实施任务实现合同；数据部只读复核现有 schema/hash/CAS；测试部运行 mandatory case；安全部复核 no-egress、lease/fence、failure settlement 与秘密零泄露。四方收据与 P0/P1 清零前，三个 Function ID 不得改为 `complete`。
