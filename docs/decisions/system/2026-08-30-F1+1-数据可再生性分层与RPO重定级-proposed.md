---
type: system_adr
status: accepted
date: 2026-08-30
department: 产品部
decision_id: ADR-F1PLUS1-DATA-REDERIVABILITY-RPO-RETIER-001
authorization_state: user_confirmed
contract_review_state: closed_pass
implementation_state: engineering_authorized_pending
production_state: not_deployed
supersedes_clause_of:
  - docs/agent-guide.md#Admin双端能力与入口恢复全局硬门 第6条
  - docs/decisions/system/2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md#7
---

# ADR-F1PLUS1-DATA-REDERIVABILITY-RPO-RETIER-001：数据可再生性分层与 RPO 重定级（提案）

> 修订记录：v2，2026-08-30，吸收 opus-5 对抗审查（BLOCK，P0=6 / P1=11 / P2=9）与 kimi-k3 63 表分层草案；核心机制改为每 15 分钟整库 `VACUUM INTO` 快照轮转。审查报告与草案已入库 `docs/decisions/evidence/2026-08-30-rpo-retier/`。
> 用户于 2026-08-30 采纳 v2：`status=accepted`，`FCC322` 先 `blocked` 释放开发部 claim 位，SNAP 实现任务待另立。
>
> v2 的机制选择是**满足**现有 `RPO≤900s` 硬门，而不是改写其数值。采纳本身不授权改生产配置、不授权实施 SNAP，也不授权手改任务 JSON。
>
> v2 对 front-matter `supersedes_clause_of` 的读法：覆盖的是「必须用增量 / prune / 远端消费才能达成 900 秒」这条隐含实现路径，以及 2026-08-24 ADR 第 7 节把该路径当成上线硬门的执行含义；第 6 条与第 7 节的 **RPO≤900 秒数值本身不改**。

## 1. 一句话

用每 15 分钟一次的整库 `VACUUM INTO` 快照轮转（同轮按「DB → `generations/` 全量 → `active.json`」打包投影树，异机推送按内容哈希去重）原样满足现有 `rpo_seconds≤900` 的 schema CHECK、`valid_backup_recovery_point_v1` 视图与 Admin 15 分钟写门，零 schema 迁移、零代码字节改动；T0 / T1 / T2 / T2′ 分层只治理快照包保留深度与恢复验证深度，并把当前零备份的不可再生资产纳入同一恢复边界。

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

v1 曾写「8 项里的 1、3、4、5、7 共 5 项随架构变更消失」。该措辞过强，按 opus P0-6 收回。

**v2 重述：** 这 5 项在快照轮转架构下不再作为独立工程问题存在，但其中 #3 的共同恢复边界改由打包顺序保证、#1 的保留策略仍需防坏包误删（快照包校验失败时跳过轮转并告警，不删除任何旧包）。逐项对照：

| # | 快照轮转下是否仍是独立工程问题 | 理由 |
|---|---|---|
| 1 | 不再独立存在，但保留策略仍要防坏包误删 | 「保留最近 N 份」只作用于**快照包整体**。包在校验（hash / manifest / 解密回读 / 投影全链）失败时跳过本轮轮转并告警，不删除任何旧包。坏时钟或伪造 manifest 不能挤掉已校验的旧包 |
| 2 | 仍在，提案不放宽 | 恢复正确性 |
| 3 | 不再作为独立对齐问题；边界由打包顺序保证 | 同一轮按「DB → `generations/` 全量 → `active.json`」打成一份包，恢复时整包落地。schema10 对 `projection_generation` / manifest / pointer 成对的 CHECK 与 `assertRecoveryPointBinding` 仍按原字节执行，不靠事后拼两个写入源 |
| 4 | 不再独立存在 | `recovery_point_at` 取本轮快照事务时刻，不取任务完成时刻；内容哈希未变时只重签 manifest，时间仍取本轮事务时刻 |
| 5 | 不再独立存在 | 没有增量 consume / tombstone 协议。异机侧是整包替换或「哈希相同则不重传」；坏包不得覆盖好包（先校验后才纳入保留集） |
| 6 | 仍在，提案不放宽 | 恢复正确性；明文窗口见 §11 |
| 7 | 不再作为独立对齐问题 | 包内带完整投影树，演练仍须满足 schema10 的 `drill_public_pointer_verified=1`，verifier 不得宽于生产 strict schema |
| 8 | 仍在，提案不放宽 | 失败与 stale lock 必须可判定 |

2、6、8 是真正的正确性要求，与 RPO 无关，应当保留。

## 3. 事实基线（2026-08-30 实测）

| 项 | 值 |
|---|---|
| 生产 DB | `[M1-HOME]/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite`，`user_version=10`，体积 **93MB**（2026-08-30 主 Agent 实测） |
| schema10 净表数 | **63**（kimi 草案；初稿 67 系把 0005/0006 重建式迁移当净新增，且计入 VIEW / TEMP） |
| verified backup recovery point | `0` |
| `lastSuccessfulRecoveryPointAt` | `null` |
| 工作区快照（提案起草当日上午，T0-DOC 重建前提取） | 545 处未提交（460 untracked + 85 modified），约 946 MB；`docs/collaboration/` 354 个未提交文件（含 478 个 TASK JSON） |
| T0-DOC 重建后 | 标签 `scrub-backup-20260830`（指向重建前 `f1b6878`）；新 commit `b7bc31e` / `8dfc6dd` / `f4390ae`；336 处脱敏替换；原始副本在 `scratch/2026-08-30-scrub-originals/`；`scrub-log.md` 见 evidence 目录。push 因本机无 GitHub 凭证未执行 |
| `.gitignore` | `design/`、`.worktrees/`、`.next/`、`node_modules/` 已在 T0-DOC 覆盖（§7 不再列为待改项） |

即：当前**唯一有备份论证的对象是可再生的 RSS 副本，而不可再生的产品决策与设计产出在 push 完成前仍没有公开 remote 上的异机副本**；生产 DB 与投影树仍是零 verified recovery point。

## 4. 提案核心：三层可再生性（只治理保留与验证深度）

按「丢失后如何恢复、恢复要付什么代价」对 schema10 全部表分层。v2 起分层**不再治理备份节奏**：全库统一每 15 分钟出一份快照包。分层只决定：

- **保留深度**：因每份快照包同时含各层，包级保留按最严层（T0）执行；T1 在 `COST-OBS` 解除前同 T0。T2 不单独缩短包保留期——整库包无法按表拆开丢弃。
- **恢复验证深度**：T0 必须逐字节 / 哈希链对齐；T2 只需证明可从上游重抓或重投影；T2′ 必须验证完整代际链与下一次发布仍可激活。

> **2026-08-30 逐表分层草案已产出**（kimi-k3 子 Agent，原文 `scratch/2026-08-30-rpo-retier-proposal-check/table-classification-draft.md`，入库副本 `docs/decisions/evidence/2026-08-30-rpo-retier/table-classification-draft.md`，待独立复核）：净表数为 **63**（TEMP 表与 4 个 VIEW 不计），分布为 T0=29、T1=5、T2=25、T2′=4，12 张表带疑义标记（含 `backup_recovery_point`、`gateway_write_permit`/`x_manual_write_permit` 防重放事实、`projection_delivery_receipt` 对端回执）。按 §11.1 规则，疑义表在复核裁定前一律按 T0 保护。

分层草案同时暴露一条**落地硬约束**，已验证属实：

**T2 的「免费可再生」必须声明依赖传递规则。** 多张 T2 表的重建以 T0/T1 上游存活为前提（如 `bilingual_language_slot_v1` 的重建以 T1 产物或重付费为前提）。本提案补充规则：**任何表的实际恢复保证等于其重建链上最弱上游的保证**；逐表分层只回答「本表是否需要独立备份」，不回答「链路是否可重建」，链路级验证由 §8 覆盖。

v1 曾写「旧 RPO 值被硬编码，分层必须配套 schema 迁移」。该段删除。v2 全库仍按 ≤900 秒出恢复点，`0007` 第 813 行 CHECK、`valid_backup_recovery_point_v1` 与 `assertRecoveryFence` **原样满足**，不需要 additive 迁移，也不改代码字节。

### T2 — 免费可再生（上游即备份）

内容来自公开 RSS，丢失后重抓即可，成本为零。

代表表：`ingest_run`、`rss_media_candidate`、`source` 的抓取态字段、`route_registry`、`published_projection`、`bilingual_public_projection_v1`（可由 T0+T1 重新投影）。`pending_review_candidate` 含人工编辑列，草案整表上调 T0，不放在本层代表名单。

- **备份节奏：与全库相同（15 分钟）。** 本层不要求、也不被允许改短间隔。
- **保留 / 验证：更浅。** 演练只需证明可重抓或从上游重投影，不要求 T2 行与删除前逐字节相同。
- **理由：** Motorsport.com 与 The Race 是这部分数据的权威副本，且始终在线。
- **代价：** 若只用更旧的包做 T2 抽检，公开站可能短暂不完整，需重抓一轮。这是可接受的验证深度差异，不是 RPO 放宽。

### T1 — 付费可再生（重跑要花钱）

模型产出，丢失后可重新生成，但要重付 DeepSeek 费用与时间。

代表表：`machine_summary_draft`、`bilingual_language_slot_v1` / `bilingual_language_slot_draft_v1`、`bilingual_model_receipt_v1`、`bilingual_bundle_v1`。

- **备份节奏：与全库相同（15 分钟）。**
- **目标保留 / 验证（解除后）：** 允许用 24 小时深度的历史包证明「重算一天可接受」；不改变出快照的间隔。
- **理由：** 最坏情况是重付一天的 refine 费用。按当前每 900 秒最多补 20 条的节流，一天的量级是可承受的重算成本——但这是保留策略论据，不是节奏论据。

> **2026-08-30 用户决定：T1 目标暂不生效，先按 T0 处理。**
>
> 用户对本层选择「先把成本测出来再定，暂时按 T0 处理」。理由是本提案 §11.2 承认的残余风险成立——「重付一天 DeepSeek 费用」的绝对金额当前没有实测数据，因为 Admin 的成本监控尚未上线，用一个未量化的金额去论证放宽保护是不成立的。
>
> 因此在解除条件满足前，`machine_summary_draft` 与全部 `bilingual_*` 表的**保留深度与验证深度**按 T0 执行。备份节奏本来就是 15 分钟，不存在「T1 要不要进高频路径」的问题。
>
> **解除条件：** Admin 成本监控上线并产出至少 7 天真实 DeepSeek 用量与金额，据此算出「重算一天」的绝对成本，再由用户决定是否把 T1 的保留 / 演练深度下调。该前置在 §6 中登记为 `COST-OBS` 步骤。v2 起节奏问题已消失，T1 定级只影响保留策略，`COST-OBS` 紧迫性降低，不阻塞 SNAP / DRILL / 后续上链。
>
> 这个偏差方向是保护过度而非不足，不引入数据丢失风险。

### T2 补充 — 签名投影文件的实测降级行为（2026-08-30 读码核实）

初稿把「公开投影」整体归入 T2 并称丢失后果是「退回 LKG」。读码后必须修正：**真实签名投影 profile 的公开读路径不经数据库**，只读磁盘上的签名投影文件（`app/src/server/public/snapshot-adapter.ts` → `readProjectionSnapshot`，`app/src/server/review-real/projection.ts:271`）。读取链是 `<projectionRoot>/active.json` → `generations/<snapshotManifestHash>.json` → Ed25519 验签 → canonical JSON 逐字节比对。`repository.ts` 仍保留一条 SQLite 读路径（含 `public-synthetic`），不能写成「公开站从不存在任何 DB 读」。

因此实际存在三种不同后果，不能笼统称为「退回 LKG」。下表保留为**事实描述**，不是恢复动作清单：

| 场景 | 代码分支 | 访客看到 |
|---|---|---|
| DB 丢失并回滚到较早快照，投影文件完好 | 公开站在签名投影 profile 下不读 DB | **完全无变化**，继续提供最后激活的 generation |
| 投影根目录仍在，但 `active.json` ENOENT | `projection.ts:282` `return null` → `snapshot-adapter.ts:96` 返回 `items: []` | **空时间线，HTTP 200**，列表页正常但没有任何内容 |
| 投影文件部分丢失或损坏（`active.json` 在，generation 文件缺失/hash 不符/验签失败） | `projection.ts:283/289/299/301` 抛 `PUBLIC_SNAPSHOT_INTEGRITY_FAILED` | **整站硬故障**（signed-snapshot 分支 503；默认 `PUBLIC_READ_INTEGRITY_FAILED` 为 500） |

双语 V2 路径没有 ENOENT→null 分支：`bilingual-snapshot.ts` 把包括 ENOENT 在内的异常转为 `PUBLIC_READ_INTEGRITY_FAILED`；V2 pointer 含 LKG 引用。删除双语 pointer 得到的是硬失败，不是空列表 200。

三点结论：

1. **T2 的「RSS 内容可再生」论断成立且比初稿更强**：DB 层丢失在签名投影 profile 下对访客可以零影响，因为该读路径不经过 DB。
2. **但投影文件本身不是纯 T2。** 重建一份签名快照需要 T0 的人工发布决定 + fresh WebAuthn 人工动作，不是脚本能自动补的。因此投影文件应单列为 **T2′：可再生但需人工发布介入**。v2 把它放进与 DB 同一份快照包，验证深度跟随 T0（必须证明完整代际链与下一次发布可激活）。
3. **部分丢失比完全丢失更糟**，这是必须写进 runbook 的反直觉行为。v1 曾建议「若只能恢复其一，主动移除 `active.json` 让站点退到空列表 200」。**该建议撤回。** `receive()` 在 `active === null` 时要求 `snapshotGeneration === 1`，删除 pointer 会永久锁死发布链；Admin 侧代际锚点仍是 N。恢复指引改为：
   - 投影树必须作为**整体**恢复（完整 `generations/` 链 + 匹配的 `active.json`；双语 V2 同理：完整 `bilingual-generation-*` + 匹配的 `bilingual-active.json`）；
   - **永不**截断 `generations/` 链内部、**永不**单独删除 `active.json` 或双语 pointer；
   - 「保留最近 N 份」的轮转只适用于**快照包整体**，不适用于 `generations/` 链内部（截断祖先会使 `findCommitted()` 回溯到 generation 1 失败，下一次发布永久 503/409）；
   - 恢复落地顺序仍是先完整 `generations/`（及双语 generation 文件）再写 pointer，避免中间态悬空指针；这与打包顺序「DB → generations → active.json」是同一边界的两个方向。

### T0 — 不可再生（丢了就是永久丢失）

人的判断与凭证，任何重跑都无法复原。

代表表：`review_decision`、`review_bundle`、`bilingual_approval_v1`、`x_manual_submission`、`audit_event`、`admin_operation`、`internal_operation_audit`、`publication` 的人工发布决定、`backup_recovery_point`、以及 Passkey/WebAuthn 凭证。
**并且必须包含当前完全在 DB 之外的 T0 资产**：`docs/spec.md`、`docs/decisions/`、`docs/collaboration/tasks/`（478 条）、`design/`（920 MB 视觉产出）。

- **RPO 目标：≤15 分钟，由 §5 的整库快照轮转实现，不再使用 append-only 日志。**
- **理由：** 这才是原始 900 秒要求真正应该保护的对象。库内 T0 在 SNAP 落地前实际 RPO 仍为无穷；库外 T0 在 `T0-DOC` push 完成前同样没有公开 remote 副本。
- **保留 / 验证：最深。** 包级保留按本层执行；演练必须证明人工决定与审计链可恢复。

## 5. 提案的备份机制：每 15 分钟一次整库快照轮转

删除 v1 的「T0 append-only 日志 + 每日 `VACUUM INTO`」双轨。单一机制如下。

### 5.1 一轮快照做什么

每 15 分钟执行一轮，构成**同一恢复边界**：

1. 对整库执行一次 `VACUUM INTO` 全量快照（单条 SQL，禁止复制活跃 DB/WAL/SHM）。
2. 同轮复制投影树：`generations/` **全量** + 当时的 `active.json`（双语 V2 的 generation 文件与 pointer 一并纳入）。打包顺序固定为 **DB → `generations/` → `active.json`**。
3. 计算快照包内容哈希（DB 快照字节 + 投影树字节）。
4. 异机推送按内容哈希去重：
   - 与上一轮哈希相同：只重签 manifest，`recovery_point_at` 取**本轮快照事务时刻**。无新写入，数据丢失窗口仍为 0，不重传 93MB。
   - 有变化：加密后上传整包，写入 kind / keyId / 明文 hash / 事务时刻。
5. 包校验失败：跳过本轮轮转并告警，**不删除任何旧包**。
6. 保留最近 N 份只作用于已通过校验的快照包整体，永不 prune `generations/` 链内部的单个文件。

由此获得的性质（明确写出）：

- `app/migrations/rss-real/0007_internal_operation_recovery_phase.sql` 第 813 行 `rpo_seconds INTEGER NOT NULL CHECK(rpo_seconds BETWEEN 0 AND 900)` **原样满足**；
- 同文件 `valid_backup_recovery_point_v1` 视图（`rpo_seconds<=900 AND restore_duration_seconds<=14400`）**原样满足**；
- `app/src/server/review-real/security.ts:208-219` 的 `assertRecoveryFence` 15 分钟 Admin 写门 **原样满足**。

因此：**零 schema 迁移、零代码字节改动。** v1 §4 / §7「需 additive 迁移才能写入 T1/T2 的 24 小时恢复点」整段删除。opus P0-1 的自举循环（必须先有 ≤900 秒备份才能迁移掉 ≤900 秒要求）随之消失。P0-2 的 Admin 503 瘫痪不发生（不会出现「每日快照导致一天里 23 小时 45 分钟写门拒绝」）。P0-5 的触发器重放问题因日志方案删除而消失。P1 的双写原子性 / 日志 hash 链截断问题同理消失。

### 5.2 机制可行性（已有证据与缺口）

`VACUUM INTO` 已在 disposable 环境实测（`scratch/2026-08-30-rpo-retier-proposal-check/check.mjs`，未触碰生产 DB）：

| 验证项 | 结果 |
|---|---|
| SQLite 版本 | `3.51.3`（`VACUUM INTO` 需 3.27+，满足） |
| 执行环境 | `node v22.23.1`（环境默认版本，非项目钉定的 `24.18.0`；该机制在 SQLite 层实现，与 Node 版本无关，但正式实施仍须在钉定版本上复验） |
| 源库 journal 模式 | `WAL`，含 500 行与 1 个 trigger |
| 快照产物 | 单一文件，**无 `-wal` / `-shm` 旁文件** |
| `user_version` 保持 | `10` |
| trigger 保持 | `1` |
| `quick_check` | `ok` |

该证据是玩具库，不足以单独支撑生产节奏。生产 DB 实测 93MB。§8 增加「在 93MB 生产等容副本上实测快照耗时与写锁窗口」。

`VACUUM INTO` 的输出是自包含单文件，可直接进入快照包；投影树按上节顺序打进同一边界，不再把 DB 与 pointer 当成两个要对齐的独立写入源。

### 5.3 保留的阻断项

以下 3 项与 RPO 无关，是恢复正确性要求，**提案不建议放宽**：

- **#2** 恢复后必须做 schema10 正式验证（`sqlite_master`、trigger、index、runtime invariant），不能只看 `quick_check` 和行数；
- **#6** 加密对象身份必须绑定 kind 与 keyId，写入用 `O_EXCL`；
- **#8** 备份失败与 stale lock 必须产生可判定失败状态和告警，不得静默停止。

### 5.4 RPO 的度量口径

恢复点时间必须取**数据边界时间**（本轮 `VACUUM INTO` 快照事务时刻），不取备份任务完成时刻。内容哈希与上一轮相同、只重签 manifest 时，同样取本轮事务时刻：无新写入，丢失窗口为 0，但 fence 看到的是「本轮已证明边界仍成立」，不是「沿用上一轮完成时钟」。

## 6. 提案后的执行链

```text
T0-DOC   脱敏与提交重建已完成（标签 scrub-backup-20260830，
         新 commit b7bc31e / 8dfc6dd / f4390ae）。
         push 因本机无 GitHub 凭证待用户 gh auth login 后执行
  → SNAP     每 15 分钟 VACUUM INTO 整库快照
             + 同轮打包 generations/ 全量与 active.json
             + 内容哈希去重后的加密异机推送
  → DRILL    隔离目标恢复演练一次（验证 §5.3 三项 + §8 整树投影 + 93MB 耗时）
  → BBFF2A   schema10 恢复门
    → 082F2C 两源 canary
      → E59ACA 双语/审核/公开/Admin
        → COST-OBS 成本监控产出 7 天真实用量 → 重新评估 T1 保留/演练深度
```

`COST-OBS` 不再是「T1 要不要进 15 分钟路径」的解除入口——节奏问题已消失。它只决定 T1 定级是否仍按 T0 做保留与演练。位置仍可放在 `E59ACA` 之后（成本监控是该任务的 Admin 交付项），但不阻塞 SNAP / DRILL / BBFF2A。紧迫性降低。

### 6.1 `FCC322` 处置决定

用户 2026-08-30 授权由本提案决定。**决定：条件性 supersede；裁定前先 blocked，不保持 claimed。**

| 时点 | `FCC322` 状态 |
|---|---|
| 2026-08-30 采纳后（当前） | `FCC322` 置 `blocked`，释放开发部 claim 位。`block_reason` 绑定本 ADR 已采纳、增量候选整改冻结、等待 SNAP 快照轮转实现任务 enqueue 后再 supersede。走正式任务工具 |
| SNAP 任务 enqueue 后 | `FCC322` 改为 `superseded`，下表转移清单写入新任务 `acceptance_exit` |

v1 写「现在保持 `claimed` 不动」。该句删除。保持 claimed 会占死开发部唯一 claim 位，并使第 9 节队列谎报「在办」。

理由：

1. **裁定前不能先杀掉备份任务，也不能假装它在办。** `blocked` 保留任务身份与审计链，同时让开发部可以领取第 9 节下一条（如 `0ED611`）。立即 superseded 会在未获批窗口里造成「零 verified recovery point 且零备份任务」的真空。
2. **也不该继续整改增量候选。** 8 项里服务于旧架构的工作，在提案获批后会作废。正确动作是冻结等待裁定。
3. **正确性要求必须显式转移，不能隐式丢失。** supersede 时按下表逐条写入新任务，并在新任务 `pointers` 引用 `FCC322` 与原独立审查报告。
4. **收口走正式任务工具，不手改 JSON。** 与 2026-08-29 处理 22 条旧 RSS/Admin 任务时相同的方式。

`FCC322` 的 `acceptance_exit` 与细节条款 → 新任务映射（不允许未列举项）：

| 原出口 / 条款 | 新任务 | 说明 |
|---|---|---|
| 两端候选通过固定 Node 语法检查 | 转入 | 钉定 Node `24.18.0` 上复验快照实现 |
| 损坏 point prune 零删除 | 转入（改述） | 快照包校验失败则跳过轮转、不删除任何旧包；见 §2 #1 |
| 半写对象 | 转入 | disposable 注入半写包 / 半写加密对象，不得进入保留集、不得覆盖好包 |
| consume 后断链 | 明确放弃 | 无增量 consume 协议；改由「先校验再纳入保留集 + 哈希去重不重传」覆盖 |
| 旧 receipt 回放 | 转入 | 过期或错绑定的 recovery receipt 不得推进 fence / 不得宣称 verified point |
| schema/trigger/index 篡改 | 转入 | 即 §5.3 #2 |
| DB-pointer 错配 | 转入（改述） | 包内 DB 与投影树必须按打包顺序成对；演练跑 `assertRecoveryPointBinding` |
| 路径逃逸 | 转入 | 加密对象路径不得逃出约定根；与 kind/keyId/`O_EXCL` 一起验 |
| stale lock | 转入 | 即 §5.3 #8；覆盖备份 `run.lock` |
| 独立复审 P0=0/P1=0 | 转入 | 新任务完成前仍须独立复审出口，不得用本提案审查代替实施审查 |
| 形成 report/receipt/manifest/hash | 转入 | 证据写入受版本控制位置，不把唯一底本留在 `scratch/` |
| 生产动作仍为 0（整改期） | 转入 | 获授权部署前禁止装 LaunchAgent、写生产 fence、对生产 DB 做真实快照 |
| schema10 正式 verifier（§5.3 #2） | 转入 | 与「篡改」项合并验收 |
| kind/keyId + `O_EXCL`（§5.3 #6） | 转入 | 明文 hash 以 fd 为准，与 kind/keyId 进 manifest |
| 复用生产 strict projection parser | 转入 | verifier 不得宽于生产 |

### 6.2 `T0-DOC` 当前状态（2026-08-30）

用户已选定「保持公开仓库，脱敏后推送」。脱敏与提交重建已完成：

| 项 | 值 |
|---|---|
| 安全标签 | `scrub-backup-20260830` = `f1b6878` |
| 新 commit | `b7bc31e`（gitignore + 文档脱敏，435 files）、`8dfc6dd`（应用层未推送工作，171 files）、`f4390ae`（X 源清单，3 files） |
| 替换次数 | 336 处 / 115 文件 |
| 原始副本 | `scratch/2026-08-30-scrub-originals/`（不提交） |
| 脱敏日志 | `docs/decisions/evidence/2026-08-30-rpo-retier/scrub-log.md`（明文原值不入库，只留占位符与 sha12） |
| push | **未执行**。本机无 GitHub 凭证，待用户 `gh auth login` 后执行 |

这是本提案范围外的凭证动作，不影响 §4 分层与 §5 机制的成立。push 完成前，库外 T0 在公开 remote 上仍无副本。

## 7. 影响面（需要改动的精确位置）

用户确认后才执行，逐项列出以便复核与回退：

| 文件 | 改动 |
|---|---|
| `docs/agent-guide.md` | 「Admin 双端能力与入口恢复全局硬门」第 6 条的 **RPO≤15 分钟数值不改**。可追加一句：该数值由本 ADR 的 15 分钟快照轮转满足；分层只解释保留与验证深度。保留 RTO≤4 小时，以及一致性机制、加密异机、hash/manifest、恢复演练、失败告警 |
| `docs/spec.md` | 状态覆盖层追加一段，说明满足 900 秒门的机制与生效日期（append-only，不改写历史段落，不改 RPO 数字） |
| `docs/decisions/system/2026-08-24-...可信单用户M1快速上线-successor-accepted.md` | 不改写字节。`backupAgeSeconds<=900` 继续有效，由本 ADR 提供满足路径，不再覆盖掉该单值门 |
| `docs/roadmap.md` | 「当前关键动作」前两条按 §6 改写 |
| `docs/当前生产状态与执行待办.md` | 第 8 节与第 9 节按 §6 重排；`FCC322` 先 blocked、裁定后 superseded 或解冻 |
| `docs/collaboration/tasks/TASK-20260829-FCC322.json` | 走正式任务工具：裁定前置 `blocked`，裁定后 superseded 或解冻；不手改 JSON |
| `.gitignore` | 已完成，本轮无待改项 |
| `app/migrations/rss-real/` | **不新增迁移。** `rpo_seconds` CHECK 与 `valid_backup_recovery_point_v1` 保持 0007 原字节 |
| 代码 | **本轮不改，实施后也不改** `security.ts:208-219`、`recovery.ts` 的 900 秒断言。新备份实现是后继任务，写在现有门的外侧 |

`docs/spec/` 下 9 份历史实施合同与 `docs/decisions/system/` 下 12 份历史 ADR 中的 RPO 表述**保留原字节**。本 ADR 不再充当「把 900 秒改成分层数值」的 successor overlay。

## 8. 如何验证

1. **分层完备性**：对 schema10 全部 **63** 张净表逐一标注 T0/T1/T2/T2′，无未分类表；由独立复核（非提案方）重新分类一遍并比对差异；草案疑义清单逐条结清或维持「疑义按 T0」。
2. **T0 覆盖验证**：在隔离目标上只提供最近一份通过校验的快照包（DB + 完整 `generations/` + 匹配的 `active.json`），恢复后验证全部人工审核决定与审计链完整，行数与 hash 与删除前一致。不做日志重放。
3. **T2 可再生性验证**：在隔离副本上清空 T2 表，重跑一次 collect + 投影，验证公开 feed 恢复到可用状态（不要求逐字节相同，要求条目集合与来源时间一致）。本项验证「更浅演练」是否足够，不改变 15 分钟节奏。
4. **§5.3 三项**：恢复后跑 schema10 正式 verifier；对加密对象做 kind/keyId 错配与 `O_EXCL` 冲突负例；注入 stale lock 验证告警而非静默。
5. **RPO 口径**：注入「快照事务开始于 T、任务完成于 T+30min」的场景，验证恢复点时间取 T 而非 T+30min；再注入「内容哈希与上一轮相同」的场景，验证只重签 manifest、`recovery_point_at` 仍为本轮事务时刻、不重传整包。
6. **投影树整包恢复**：在隔离副本上分别注入「投影完好」「`active.json` 缺失」「`active.json` 存在但 generation 文件缺失」三种状态，确认访客侧事实表（§4）成立；恢复 runbook 只验证「整树恢复 + 先 generations 后 pointer」，并验证**恢复后能成功激活 generation N+1**。禁止把「删除 `active.json`」写成修复步骤。
7. **生产等容耗时（新增）**：在 93MB 生产等容副本上、用钉定 Node `24.18.0`，实测 `VACUUM INTO` 耗时与写锁窗口，作为 SNAP 实施前置。玩具库 `check.mjs` 不得单独作为节奏证据。
8. **坏包轮转负例**：注入校验失败的快照包，验证跳过轮转、告警、旧包零删除。

## 9. 如何回退

- 本提案未采纳：删除本文件与 `docs/decisions/evidence/2026-08-30-rpo-retier/` 即可。这两处都是本轮文档写入，无 schema / 代码 / 生产副作用。`T0-DOC` 的三个 commit 与标签是用户已授权的独立脱敏动作，不随本提案回退。
- 已采纳但需撤回：本 ADR 的采纳改动都是文档层追加或引用。第 6 条 RPO 数值本来就没改，撤回方式是把本 ADR 状态改为 `superseded`，并停止尚未部署的 SNAP 实现。生产写门仍关闭时，已写出的候选代码不影响生产。
- 已按新架构部署后需撤回：快照包是标准加密对象，不阻碍改回其他满足 900 秒门的实现。回退承诺不依赖被 gitignore 的 `scratch/` 目录。

## 10. 本提案明确不做的事

- 不放宽 RTO（保持 `≤4 小时`）。
- 不放宽、也不改写 RPO 数值（保持 `≤15 分钟` / `rpo_seconds≤900`）。
- 不放宽加密、异机、hash/manifest、恢复演练、失败告警这五项要求。
- 不取消恢复演练，只按分层缩小验证深度。
- 不改变 `automaticReview=false / automaticPublish=false`。
- 不改变 Admin 私网边界、Passkey/fresh re-auth 或双端功能等价硬门。
- 不扩大公网暴露，不涉及 Quick Tunnel 或域名变更（另一个独立议题）。
- 不改变 X 的 27 条选择集与只读约束。
- 不授权任何生产写动作。
- 不改 `0007` 迁移字节，不改 `security.ts` / `recovery.ts` 的 900 秒断言。
- 不恢复 v1 的 append-only 日志，不把「删除 `active.json`」写进 runbook。

## 11. 残余风险

1. **分层判断可能出错。** 如果某张被标为 T2 的表实际含有人工字段，会造成永久数据丢失。缓解：§8.1 要求独立复核逐表比对；有疑义的表一律上调为 T0。
2. **T1 重算成本未量化。** 「重付一天 DeepSeek 费用」的具体金额当前没有实测数据。缓解：保留与演练先按 T0；`COST-OBS` 只影响日后是否下调保留深度，不改变 15 分钟节奏，紧迫性低于 v1。
3. **快照在加密 / 上传前存在本地明文窗口。** `VACUUM INTO` 不能写管道，明文落盘不可避免。缓解：目标文件用 `O_EXCL` 创建；完成后立即加密；加密成功并回读校验后删除明文；staging 目录 0700 owner-only；hash 对明文、以 fd 为准，与 kind/keyId 一起进 manifest。
4. **目标磁盘余量不足会使快照失败或留下残片。** 缓解：余量低于 **3× 当前 DB 大小**（按 93MB 计约 279MB 门槛，随体积重算）时告警并跳过本轮，不覆盖旧包。
5. **库外 T0 的公开 remote 副本仍待 push。** 脱敏与提交重建已完成，push 阻在本机无 GitHub 凭证。缓解：用户执行 `gh auth login` 后推送三个新 commit；标签 `scrub-backup-20260830` 保留重建前历史。push 完成前，公开 remote 仍停在 `52e6549`。库内 T0 仍待 SNAP。
6. **本 ADR 覆盖的是用户 2026-08-09 亲自确认的条款。** 该确认当时的语境是 Admin 私有访问与异机备份决策包，未区分数据可再生性。v2 不再改写 900 秒数值，只改实现路径与保留 / 验证分层。采纳本提案即表示用户确认「当时冻结的是保护强度与 900 秒上限，允许用整库快照轮转满足它，并用可再生性分层解释保留与演练」。**这一点由本提案的采纳 / 否决回答，不另开问题。**

## 12. 需要用户回答的问题

v1 的 q1–q4 已回答，无新增待答项。提案整体仍待用户采纳或否决（`authorization_state: awaiting_user_decision`）。

| # | 原问题 | 答案 |
|---|---|---|
| q1 | 是否接受把「RSS 抓取内容」定级为可再生数据、放弃对它的 15 分钟 RPO 保证？ | **接受 T2 定级。** 读码后确认：签名投影 profile 下 DB 丢失对访客可以零影响，可再生论断成立且更强。v2 **不再要求放弃 15 分钟快照**——T2 与全库同一节奏；该定级只影响验证深度（演练不要求 T2 逐字节）。「放弃 15 分钟 RPO」是 v1 问法，v2 作废 |
| q2 | 是否接受 T1 用 24 小时 RPO，还是要求 T1 也走 15 分钟路径？ | **先测成本再定，暂按 T0 处理。** 解除入口 `COST-OBS`。v2 下这只约束保留 / 演练深度；节奏已是 15 分钟 |
| q3 | 是否同意 `FCC322` 改为 superseded、由范围更小的新任务承接？ | **由本提案决定：条件性 supersede。** 裁定前由统筹部置 `blocked` 并释放 claim；采纳后 superseded 并按 §6.1 全表转移；否决后解冻继续整改 |
| q4 | 是否授权先把未提交改动 commit 并 push？ | **授权。** 用户选定「保持公开，脱敏后推送」。脱敏与三个新 commit 已完成；push 待用户 `gh auth login` |

---

关联：[当前生产状态与执行待办](../../当前生产状态与执行待办.md) · [可信单用户 M1 快速上线 ADR](2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md) · [Admin 私有访问与异机备份决策包](2026-08-09-F1+1-M5-Admin私有访问与异机备份用户决策包-proposed.md) · [本提案对抗审查](../evidence/2026-08-30-rpo-retier/proposal-adversarial-review.md) · [63 表分层草案](../evidence/2026-08-30-rpo-retier/table-classification-draft.md)
