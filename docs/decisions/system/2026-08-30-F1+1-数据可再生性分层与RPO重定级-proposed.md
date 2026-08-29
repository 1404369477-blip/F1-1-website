---
type: system_adr
status: proposed
date: 2026-08-30
department: 产品部
decision_id: ADR-F1PLUS1-DATA-REDERIVABILITY-RPO-RETIER-001
authorization_state: awaiting_user_decision
contract_review_state: not_started
implementation_state: not_authorized
production_state: not_deployed
supersedes_clause_of:
  - docs/agent-guide.md#Admin双端能力与入口恢复全局硬门 第6条
  - docs/decisions/system/2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md#7
---

# ADR-F1PLUS1-DATA-REDERIVABILITY-RPO-RETIER-001：数据可再生性分层与 RPO 重定级（提案）

> 本文件是**提案**，不是已采纳决定。写入范围仅限本文件。
> 未经用户确认，不得据此修改 `docs/spec.md`、任何 accepted ADR、任务 JSON、代码、SQL 或生产配置。
> 现有 `RPO≤900s` 全局硬门在用户确认前继续有效。

## 1. 一句话

把「全库统一 RPO≤900 秒」改成「按数据可再生性分三层、各层各自的恢复目标」，从而移除迫使备份系统采用增量/prune/远端消费架构的根本原因，并把当前唯一不可再生却零备份的数据（产品决策与人工审核产出）纳入保护。

## 2. 背景：当前阻断的形状

`docs/agent-guide.md` 的「Admin 双端能力与入口恢复全局硬门」第 6 条（用户 2026-08-09 确认）冻结了：

- RTO `≤4 小时`，RPO `≤15 分钟`（900 秒）
- 一致性机制生成的备份，禁止直接复制活跃 DB/WAL/SHM
- 异机、加密、与主机故障域分离
- 每个备份集带可校验 hash 与 manifest
- 隔离目标上的恢复演练
- 备份失败/恢复点超龄/hash 不匹配必须产生可判定失败状态

`2026-08-24 可信单用户 M1 快速上线` ADR 第 7 节把它固化为上线硬门：`backupAgeSeconds<=900`、运行中 RPO 不得超过 900 秒。

由此产生的执行链（见 `docs/当前生产状态与执行待办.md` 第 9 节）是：

```text
TASK-20260829-FCC322 备份V2整改（唯一在办）
  → BBFF2A schema10 恢复门（blocked，依赖 1）
    → 082F2C Motorsport/The Race 两源 canary（blocked，依赖 2）
      → E59ACA 双语/审核/公开投影/Admin（blocked，依赖 2/3）
```

也就是说：**让 2 条 RSS 每 900 秒抓一次新闻，前置条件是先建成一套企业级备份系统。**

`FCC322` 当前的 8 项阻断（独立对抗审查结论 `BLOCK`）：

| # | 阻断项 | 它为什么存在 |
|---|---|---|
| 1 | prune 未严格验证 point，坏点可能误删有效备份 | 因为有 prune；有 prune 是因为高频备份产生大量 point |
| 2 | SQLite 只做 quick/integrity/FK/count，缺 schema10/trigger/index/invariant 验证 | 恢复正确性，与 RPO 无关 |
| 3 | SQLite 与 projection pointer/generation/manifest 未形成共同恢复边界 | 因为要在 15 分钟粒度上对齐两个独立写入源 |
| 4 | RPO 用完成时间，可能把陈旧数据伪装成新恢复点 | 因为存在需要被证明的 900 秒指标 |
| 5 | 远端 consume 缺持久 tombstone/幂等收据，断链后可能半消费 | 因为采用了增量推送 + 远端消费协议 |
| 6 | 加密对象身份未绑定 kind/keyId，O_EXCL 闭包不足 | 恢复正确性，与 RPO 无关 |
| 7 | Projection verifier 比生产 strict schema 宽松 | 同 #3，源于双源恢复边界 |
| 8 | stale `run.lock` 可能让备份永久静默停止 | 因为备份是常驻高频任务 |

**关键观察：8 项里的 1、3、4、5、7 共 5 项，不是「标准定得太高」，而是「为了达到 900 秒 RPO 而选择的增量 + prune + 远端消费 + 双源对齐架构」自身产生的复杂度。**它们不是安全余量，是设计选择的账单。2、6、8 是真正的正确性要求，与 RPO 无关，应当保留。

## 3. 事实基线（2026-08-30 实测）

| 项 | 值 |
|---|---|
| 生产 DB | `[M1-HOME]/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite`，`user_version=10` |
| schema10 lineage 表数量 | 67 |
| verified backup recovery point | `0` |
| `lastSuccessfulRecoveryPointAt` | `null` |
| 工程工作区未提交改动 | 545 处（460 untracked + 85 modified），约 946 MB |
| `docs/collaboration/` 未提交文件 | 354 个（含 478 个 TASK JSON，共 25,331 行） |
| `.gitignore` 未覆盖的大目录 | `design/`（920 MB）、`.worktrees/`（75 MB）、`.next/` |
| 最近一次 commit | 2026-08-29 `f1b6878`，仓库总计 24 次 commit |

即：当前**唯一有备份论证的对象是可再生的 RSS 副本，而不可再生的产品决策与设计产出没有任何异机副本**，且不在版本控制内。

## 4. 提案核心：三层可再生性

按「丢失后如何恢复、恢复要付什么代价」对 schema10 全部表分层。

> **2026-08-30 逐表分层草案已产出**（kimi-k3 子 Agent，`scratch/2026-08-30-rpo-retier-proposal-check/table-classification-draft.md`，待独立复核）：净表数为 **63**（本文初稿估算 67 系把 0005/0006 重建式迁移当净新增；TEMP 表与 4 个 VIEW 不计），分布为 T0=29、T1=5、T2=25、T2′=4，12 张表带疑义标记（含 `backup_recovery_point`、`gateway_write_permit`/`x_manual_write_permit` 防重放事实、`projection_delivery_receipt` 对端回执）。按 §11.1 规则，疑义表在复核裁定前一律按 T0 保护。

分层草案同时暴露出两条**落地硬约束**，已验证属实：

1. **旧 RPO 值被硬编码在数据库层，分层必须配套 schema 迁移。** `app/migrations/rss-real/0007_internal_operation_recovery_phase.sql` 第 813 行为 `rpo_seconds INTEGER NOT NULL CHECK(rpo_seconds BETWEEN 0 AND 900)`，第 881–886 行的 `valid_backup_recovery_point_v1` 视图过滤 `rpo_seconds<=900 AND restore_duration_seconds<=14400`。即使本提案获批，T1/T2 的 24 小时恢复点也无法写入 `backup_recovery_point` 表——会被 CHECK 直接拒绝。因此 §7 的影响面必须增加一条 additive 迁移（沿用项目「不改旧文件字节、只加后继迁移」惯例），把 RPO 上限改为按 tier 取值或加 `tier` 列；该迁移需独立实施合同，不在本提案内冻结细节。
2. **T2 的「免费可再生」必须声明依赖传递规则。** 多张 T2 表的重建以 T0/T1 上游存活为前提（如 `bilingual_language_slot_v1` 的重建以 T1 产物或重付费为前提）。本提案补充规则：**任何表的实际恢复保证等于其重建链上最弱上游的保证**；逐表分层只回答「本表是否需要独立备份」，不回答「链路是否可重建」，链路级验证由 §8.2/§8.3 覆盖。

### T2 — 免费可再生（上游即备份）

内容来自公开 RSS，丢失后重抓即可，成本为零。

代表表：`ingest_run` / `ingest_run_v5`、`pending_review_candidate`、`rss_media_candidate`、`source`/`source_v5`/`source_v6` 的抓取态字段、`route_registry`、`published_projection`、`bilingual_public_projection_v1`（可由 T0+T1 重新投影）。

- **RPO 目标：无要求。**
- **理由：** Motorsport.com 与 The Race 是这部分数据的权威副本，且始终在线。为它论证「任意数据损失窗口 ≤15 分钟」在信息上是冗余的。
- **代价：** 丢失后公开站会退到 LKG，需要重抓一轮才恢复完整时间线。这是可接受的。

### T1 — 付费可再生（重跑要花钱）

模型产出，丢失后可重新生成，但要重付 DeepSeek 费用与时间。

代表表：`machine_summary_draft`、`bilingual_language_slot_v1` / `bilingual_language_slot_draft_v1`、`bilingual_model_receipt_v1`、`bilingual_bundle_v1`。

- **RPO 目标：24 小时（每日一次全量快照）。**
- **理由：** 最坏情况是重付一天的 refine 费用。按当前每 900 秒最多补 20 条的节流，一天的量级是可承受的重算成本。
- **代价：** 极端情况下最多重付一天模型费用，需要用户确认这个金额可接受。

> **2026-08-30 用户决定：T1 目标暂不生效，先按 T0 处理。**
>
> 用户对本层选择「先把成本测出来再定，暂时按 T0 处理」。理由是本提案 §11.2 承认的残余风险成立——「重付一天 DeepSeek 费用」的绝对金额当前没有实测数据，因为 Admin 的成本监控尚未上线，用一个未量化的金额去论证放宽保护是不成立的。
>
> 因此在解除条件满足前，`machine_summary_draft` 与全部 `bilingual_*` 表按 §T0 的 ≤15 分钟 append-only 路径保护。
>
> **解除条件：** Admin 成本监控上线并产出至少 7 天真实 DeepSeek 用量与金额，据此算出「重算一天」的绝对成本，再由用户决定是否下调至 24 小时。该前置在 §6 中登记为 `COST-OBS` 步骤。
>
> 这个偏差方向是保护过度而非不足，不引入数据丢失风险；代价是 T0 高频路径要多承载一部分体积，实施时需实测 append-only 日志的日增量是否仍在 MB 量级。

### T2 补充 — 签名投影文件的实测降级行为（2026-08-30 读码核实）

初稿把「公开投影」整体归入 T2 并称丢失后果是「退回 LKG」。读码后必须修正：**公开站从不读数据库，只读磁盘上的签名投影文件**（`app/src/server/public/snapshot-adapter.ts` → `readProjectionSnapshot`，`app/src/server/review-real/projection.ts:271`）。读取链是 `<projectionRoot>/active.json` → `generations/<snapshotManifestHash>.json` → Ed25519 验签 → canonical JSON 逐字节比对。

因此实际存在三种不同后果，不能笼统称为「退回 LKG」：

| 场景 | 代码分支 | 访客看到 |
|---|---|---|
| DB 丢失并回滚到较早快照，投影文件完好 | 公开站不读 DB | **完全无变化**，继续提供最后激活的 generation |
| 投影文件整体丢失（`active.json` ENOENT） | `projection.ts:282` `return null` → `snapshot-adapter.ts:96` 返回 `items: []` | **空时间线，HTTP 200**，页面正常但没有任何内容 |
| 投影文件部分丢失或损坏（`active.json` 在，generation 文件缺失/hash 不符/验签失败） | `projection.ts:283/289/299/301` 抛 `PUBLIC_SNAPSHOT_INTEGRITY_FAILED, 503` | **整站 503**，硬故障 |

三点结论：

1. **T2 的「RSS 内容可再生」论断成立且比初稿更强**：DB 层的丢失对访客零影响，因为读路径根本不经过 DB。
2. **但投影文件本身不是纯 T2。** 重建一份签名快照需要 T0 的人工发布决定 + fresh WebAuthn 人工动作，不是脚本能自动补的。因此投影文件应单列为 **T2′：可再生但需人工发布介入**，恢复目标跟随 T0（因为它的重建依赖 T0 数据）。
3. **部分丢失比完全丢失更糟**，这是一个必须写进 runbook 的反直觉行为：完全丢失只是空页面（200），部分丢失是整站 503。因此恢复顺序必须是**先恢复 `generations/` 再恢复 `active.json`**；若只能恢复其一，应主动移除 `active.json` 让站点退到空列表 200，而不是留下一个指向缺失文件的悬空指针。

这条修正不改变 §5 的机制选择，但给 §8 增加一项验证要求（见 §8.6）。

### T0 — 不可再生（丢了就是永久丢失）

人的判断与凭证，任何重跑都无法复原。

代表表：`review_decision`、`review_bundle`、`bilingual_approval_v1`、`x_manual_submission`、`audit_event`、`admin_operation`、`internal_operation_audit`、`publication` 的人工发布决定、`backup_recovery_point`、以及 Passkey/WebAuthn 凭证。
**并且必须包含当前完全在 DB 之外的 T0 资产**：`docs/spec.md`、`docs/decisions/`、`docs/collaboration/tasks/`（478 条）、`design/`（920 MB 视觉产出）。

- **RPO 目标：≤15 分钟，但用完全不同的机制实现——见 §5。**
- **理由：** 这才是原始 900 秒要求真正应该保护的对象。它当前的实际 RPO 是**无穷**（零备份）。
- **代价：** 需要一条独立于 SQLite 备份的持久化路径。

## 5. 提案的备份机制：用「小而频繁的 append-only」+「大而低频的全量」替代增量/prune

### 5.1 T0 高频路径

T0 的数据量极小（人工决定与审计事件，每天量级在 KB 到 MB）。因此不需要增量协议：

1. Admin 每次写入人工决定或审计事件时，同步 append 一条 canonical JSON 到 owner-only 的 append-only 日志文件；
2. 该日志每 5 分钟推送到异机（加密后），因为体积小，全量推送即可，**不需要 tombstone、不需要幂等 consume、不需要 prune**；
3. 日志足以在最近一次 T1 全量快照之上重放全部人工决定。

这直接消灭阻断项 #1、#5。

### 5.2 T1/T2 低频路径

每日一次 `VACUUM INTO '<目标路径>'`：

- 这是单条 SQL 语句产生的一致性快照，**天然满足 agent-guide 第 6 条「禁止直接复制活跃 DB/WAL/SHM」的要求**，且不需要把 DB、WAL 与 manifest 关联成同一可恢复边界；
- 输出是单一独立文件，加密后异机保存，附 hash 与 manifest；
- 保留策略改为「保留最近 N 份，超出的按序删除」——**由于不再有高频 point 流，可以直接不实现 prune 语义**，从而消灭阻断项 #1 的根源；
- projection 不再要求与 SQLite 共享恢复边界，因为 T2 的投影**可以从 T0+T1 重新生成**，属于可再生对象。这消灭阻断项 #3、#7。

机制可行性已实测（`scratch/2026-08-30-rpo-retier-proposal-check/check.mjs`，disposable，未触碰生产 DB）：

| 验证项 | 结果 |
|---|---|
| SQLite 版本 | `3.51.3`（`VACUUM INTO` 需 3.27+，满足） |
| 执行环境 | `node v22.23.1`（环境默认版本，非项目钉定的 `24.18.0`；该机制在 SQLite 层实现，与 Node 版本无关，但正式实施仍须在钉定版本上复验） |
| 源库 journal 模式 | `WAL`，含 500 行与 1 个 trigger |
| 快照产物 | 单一文件，**无 `-wal` / `-shm` 旁文件** |
| `user_version` 保持 | `10` |
| trigger 保持 | `1` |
| `quick_check` | `ok` |

即：`VACUUM INTO` 的输出是自包含的单文件，可直接加密后异机传输，无需把 DB、WAL 与 manifest 关联成同一恢复边界——这正是阻断项 #3 想解决的问题被从源头移除的原因。

### 5.3 保留的阻断项

以下 3 项与 RPO 无关，是恢复正确性要求，**提案不建议放宽**：

- **#2** 恢复后必须做 schema10 正式验证（`sqlite_master`、trigger、index、runtime invariant），不能只看 `quick_check` 和行数；
- **#6** 加密对象身份必须绑定 kind 与 keyId，写入用 `O_EXCL`；
- **#8** 备份失败与 stale lock 必须产生可判定失败状态和告警，不得静默停止。

### 5.4 RPO 的度量口径

阻断项 #4 指出「用完成时间会把陈旧数据伪装为新恢复点」，这个批评是对的，提案保留其结论但缩小适用面：恢复点时间必须取**数据边界时间**（快照事务开始时刻 / 日志最后一条 append 的时刻），不取备份任务完成时刻。这一条对 T0 日志天然成立。

## 6. 提案后的执行链

```text
T0-DOC   补 .gitignore + commit + 异机 push（保护 spec/decisions/tasks/design）
           ⚠ 当前被「remote 为公开仓库」阻断，见 §6.2
  → T0-LOG   append-only 日志 + 5 分钟异机推送
  → SNAP     每日 VACUUM INTO 全量快照 + 加密 + 异机 + hash/manifest
  → DRILL    隔离目标恢复演练一次（验证 §5.3 三项 + §8.2）
  → BBFF2A   schema10 恢复门
    → 082F2C 两源 canary
      → E59ACA 双语/审核/公开/Admin
        → COST-OBS 成本监控产出 7 天真实用量 → 重新评估 T1 定级
```

`COST-OBS` 是 T1 从「暂按 T0」下调到 24 小时的唯一解除入口，位置在 `E59ACA` 之后，因为成本监控本身是 `E59ACA` 的 Admin 交付项之一。在它产出数据前，T1 不下调。

### 6.1 `FCC322` 处置决定

用户 2026-08-30 授权由本提案决定。**决定：条件性 supersede，不立即执行。**

| 时点 | `FCC322` 状态 |
|---|---|
| 现在（提案未采纳） | 保持 `claimed` 不动 |
| 提案被采纳时 | 改为 `superseded`，§5.3 的 3 项正确性要求转入新备份任务的验收出口 |
| 提案被否决时 | 保持原样继续整改现有增量候选 |

理由：

1. **不能先杀掉唯一的备份任务。** 立即 supersede 会在提案尚未获批的窗口里让项目处于「零 verified recovery point 且零在办备份任务」的状态，比现状更差。替代要求获批之后再收口，是唯一不产生真空的顺序。
2. **但也不该继续整改。** 8 项阻断中的 5 项只为服务一个正在被质疑的需求存在，现在投入工时去关闭它们，如果提案随后获批，这些工时全部作废。所以现在的正确动作是**冻结而非推进**——不领新工作量，等决定。
3. **3 项正确性要求必须显式转移，不能隐式丢失。** supersede 时 §5.3 的 schema10 正式验证、加密对象 kind/keyId 与 `O_EXCL`、失败与 stale lock 不静默三项，必须逐条写进新任务的 `acceptance_exit`，并在新任务 JSON 的 `pointers` 里引用 `FCC322` 与原独立审查报告，保留审计链。
4. **收口走正式任务工具，不手改 JSON。** 与 2026-08-29 处理 22 条旧 RSS/Admin 任务时相同的方式。

### 6.2 `T0-DOC` 当前阻断（2026-08-30 发现）

用户已授权 commit 并 push，但执行前发现 remote 是**公开仓库**，因此该步骤暂停，详见 §11.5。这是本提案范围外的独立决定，不影响 §4 分层与 §5 机制的成立。

## 7. 影响面（需要改动的精确位置）

用户确认后才执行，逐项列出以便复核与回退：

| 文件 | 改动 |
|---|---|
| `docs/agent-guide.md` | 「Admin 双端能力与入口恢复全局硬门」第 6 条：把单一 RPO 值改为引用本 ADR 的三层表；保留 RTO≤4 小时；保留一致性机制、加密异机、hash/manifest、恢复演练、失败告警六项要求 |
| `docs/spec.md` | 状态覆盖层追加一段，说明 RPO 口径变更与生效日期（append-only，不改写历史段落） |
| `docs/decisions/system/2026-08-24-...可信单用户M1快速上线-successor-accepted.md` | 不改写字节。由本 ADR 作为 successor overlay 覆盖其第 7 节的 `backupAgeSeconds<=900` 单值门 |
| `docs/roadmap.md` | 「当前关键动作」前两条按 §6 改写 |
| `docs/当前生产状态与执行待办.md` | 第 8 节与第 9 节按 §6 重排；`FCC322` 状态改 superseded 并指向新任务 |
| `docs/collaboration/tasks/TASK-20260829-FCC322.json` | 走正式任务工具收口为 superseded，不手改 JSON |
| `.gitignore` | 追加 `design/`、`.worktrees/`、`.next/`、取消注释 `node_modules/`（已于 2026-08-30 随 q4 授权先行完成） |
| `app/migrations/rss-real/`（additive 新迁移） | 必需：`backup_recovery_point` 的 `rpo_seconds` CHECK 与 `valid_backup_recovery_point_v1` 视图当前把 900 秒写死（0007 第 813、881–886 行），需后继迁移按 tier 放宽；不改旧迁移字节，细节由独立实施合同冻结 |
| 代码 | 本轮不改。新备份实现由后继任务在获得授权后进行 |

`docs/spec/` 下 9 份历史实施合同与 `docs/decisions/system/` 下 12 份历史 ADR 中的 RPO 表述**保留原字节**，仅由本 ADR 覆盖，符合项目既有的 successor overlay 惯例。

## 8. 如何验证

1. **分层完备性**：对 schema10 全部 67 张表逐一标注 T0/T1/T2，无未分类表；由独立复核（非提案方）重新分类一遍并比对差异。
2. **T0 覆盖验证**：构造一次「删除生产 DB 且只保留最近一次全量快照 + T0 日志」的隔离恢复，验证全部人工审核决定与审计链可完整重放，行数与 hash 与删除前一致。
3. **T2 可再生性验证**：在隔离副本上清空 T2 表，重跑一次 collect + 投影，验证公开 feed 恢复到可用状态（不要求逐字节相同，要求条目集合与来源时间一致）。
4. **§5.3 三项**：恢复后跑 schema10 正式 verifier；对加密对象做 kind/keyId 错配与 `O_EXCL` 冲突负例；注入 stale lock 验证告警而非静默。
5. **RPO 口径**：注入「快照事务开始于 T、任务完成于 T+30min」的场景，验证恢复点时间取 T 而非 T+30min。
6. **投影文件三态降级（新增，来自 §4 T2 补充）**：在隔离副本上分别注入「投影完好」「`active.json` 缺失」「`active.json` 存在但 generation 文件缺失」三种状态，验证访客侧分别得到「内容不变」「空列表 200」「503」；并验证恢复 runbook 的「先 `generations/` 后 `active.json`」顺序不会在中间态产生 503 窗口。

## 9. 如何回退

- 本提案未采纳：删除本文件即可，无其他副作用。
- 已采纳但需撤回：本 ADR 的所有改动都是文档层 append 或引用替换，历史 accepted ADR 与实施合同保持原字节，因此撤回方式是把 `agent-guide.md` 第 6 条恢复为单值 `RPO≤15 分钟`，并把本 ADR 状态改为 `superseded`。已按新架构写出的备份候选代码不影响生产（生产写门仍关闭）。
- 已按新架构部署后需撤回：全量快照与 T0 日志都是标准产物，不阻碍重新实现旧的增量方案；旧方案候选保留在 `scratch/TASK-20260829-BACKUP-V2-UPGRADE/working/`。

## 10. 本提案明确不做的事

- 不放宽 RTO（保持 `≤4 小时`）。
- 不放宽加密、异机、hash/manifest、恢复演练、失败告警这五项要求。
- 不取消恢复演练，只缩小其覆盖对象。
- 不改变 `automaticReview=false / automaticPublish=false`。
- 不改变 Admin 私网边界、Passkey/fresh re-auth 或双端功能等价硬门。
- 不扩大公网暴露，不涉及 Quick Tunnel 或域名变更（另一个独立议题）。
- 不改变 X 的 27 条选择集与只读约束。
- 不授权任何生产写动作。

## 11. 残余风险

1. **分层判断可能出错。** 如果某张被标为 T2 的表实际含有人工字段，会造成永久数据丢失。缓解：§8.1 要求独立复核逐表比对；有疑义的表一律上调为 T0。
2. **T1 重算成本未量化。** 「重付一天 DeepSeek 费用」的具体金额当前没有实测数据（Admin 的成本监控尚未上线）。缓解：先按 T0 处理，等成本可观测后再下调。
3. **T0 append-only 日志本身可能损坏。** 缓解：日志每条带前序 hash 形成链，与现有 audit chain 同构；异机保留多份。
4. **T0 异机副本的落地路径当前被公开仓库阻断（2026-08-30 实测）。** §6 的 `T0-DOC` 是 T0 保护里唯一立即可行的一步，但实测发现：

   | 项 | 值 |
   |---|---|
   | remote | `https://github.com/1404369477-blip/F1-1-website.git` |
   | visibility | **public** |
   | remote 最新 commit | `52e6549`，最后 push 于 2026-08-13 |
   | 本地未推送 commit | 5 个（`6b6e4b2` … `f1b6878`） |
   | remote 是否已含 Tailscale 私有 Admin 地址 | **否**（`git grep [PRIVATE-TAILNET] 52e6549` 为空） |
   | 本地 `8f305e1` 是否引入该地址 | **是** |

   待提交文件中含私有信息的范围：Tailscale 私有 Admin 地址出现在 5 个文件（`docs/spec.md`、`docs/handoff.md`、`docs/progress.md`、`docs/当前生产状态与执行待办.md`、`docs/collaboration/tasks/TASK-20260813-EDBB77.json`）；Quick Tunnel 地址出现在 6 个文件；文档另含 M1 hostname、运行 UID、绝对 DB 路径与设备授权细节。真实凭证扫描为**阴性**（`sk-` 命中均为 `TASK-` 前缀误报，DeepSeek key 从环境变量读取，`app/src/server/rss/refinement.ts` 未硬编码）。

   直接 push 会把私有 Admin 入口标识发布到公开仓库，与 `docs/agent-guide.md` 安全边界「未经用户确认不提交私有链接」及 A 级「扩大公网暴露」冲突，也与本项目为私网 Admin 边界付出的全部工作相矛盾。因此 `T0-DOC` 停在 commit 前，等用户决定仓库可见性或脱敏方案。**缓解此项前，T0 的实际 RPO 仍为无穷。**

5. **本 ADR 覆盖的是用户 2026-08-09 亲自确认的条款。** 该确认当时的语境是 Admin 私有访问与异机备份决策包，未区分数据可再生性。本提案的成立前提是用户同意「当时冻结的是保护强度，不是保护对象的均一性」。**这一点必须由用户明确回答，不能由 Agent 推定。**

## 12. 需要用户回答的问题

1. 是否接受把「RSS 抓取内容」定级为可再生数据、放弃对它的 15 分钟 RPO 保证？（最坏后果：公开站退回 LKG，需重抓一轮）
2. 是否接受「双语提炼最多重付一天模型费用」，即 T1 用 24 小时 RPO？还是要求 T1 也走 T0 的 15 分钟路径？
3. 是否同意 `FCC322` 从「整改现有增量备份候选」改为 superseded、由范围更小的新任务承接？
4. 是否授权先把现有 545 处未提交改动 commit 并 push 到 remote（这是当前 T0 数据唯一的立即可行保护）？

---

关联：[当前生产状态与执行待办](../../当前生产状态与执行待办.md) · [可信单用户 M1 快速上线 ADR](2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md) · [Admin 私有访问与异机备份决策包](2026-08-09-F1+1-M5-Admin私有访问与异机备份用户决策包-proposed.md)
