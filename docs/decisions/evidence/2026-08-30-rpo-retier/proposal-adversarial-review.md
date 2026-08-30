> produced by opus-5 subagent 2026-08-30, adversarial review

# 对 `2026-08-30-F1+1-数据可再生性分层与RPO重定级-proposed.md` 的独立对抗审查

**结论：BLOCK（不可按现文采纳）。P0=6 / P1=11 / P2=9。**

审查立场：独立审核层，只读，不代表提案方。本报告只写入本文件；未触碰生产 DB、任务 JSON、`docs/`、`app/`。

## 0. 一句话判断

提案的**方向**（按可再生性分层、把当前零备份的人工产出纳入保护）是本项目当前最重要的未被识别的问题，这一点成立且价值很高；但提案的**成立论证**建立在一个错误前提上——它把 `RPO≤900s` 当成一个只存在于文档层的数值。实际上 900 秒同时写死在 **schema10 的 CHECK 约束**、**一个生产视图**、**两处运行时代码**里，其中一处（`ReviewAdminSecurity.assertRecoveryFence`）会在恢复点超过 15 分钟时用 `ADMIN_BACKUP_STALE 503` 拒绝**全部 Admin 写操作**。因此 §7 的「代码：本轮不改」是错的，「删除本文件即可回退」也是错的，而「8 项阻断中 5 项源于架构选择」的归因至少有 2 项不成立、2 项只是改名。

同时，提案新增的 T2′（签名投影文件）**被定级但没有被分配任何备份机制**，且 §4 给出的恢复 runbook 动作（主动删除 `active.json`）会永久锁死发布路径。

---

## P0：提案不能按现文采纳的缺陷（6 项）

### P0-1 `RPO≤900` 是 schema10 的 CHECK 约束与运行时断言，不是文档数值；§7「代码：本轮不改」不成立，且存在自举循环

精确引用：

- `app/migrations/rss-real/0007_internal_operation_recovery_phase.sql:813`：`rpo_seconds INTEGER NOT NULL CHECK(rpo_seconds BETWEEN 0 AND 900)`（`backup_recovery_point`，STRICT 表）。
- 同文件 `:881-904`：视图 `valid_backup_recovery_point_v1` 硬过滤 `rpo_seconds<=900`，并要求 `drill_public_pointer_verified=1`。
- 同文件 `:911-912`：`backup_recovery_point_no_update` / `_no_delete` 触发器使已写入行完全不可改、不可删。
- `app/src/server/internal-operation/recovery.ts:111`：`assert(... receipt.rpoSeconds <= 900, "RECOVERY_RPO_BREACH")`。
- `docs/当前生产状态与执行待办.md` 第 4 节：生产 DB 已 `user_version=10`，即 0007 已 apply。

后果：T1/T2 的「每日一次全量快照」对应的恢复点 `rpo_seconds` 最大 86400，**INSERT 会被 CHECK 直接拒绝**；而 `RecoveryPointReceipt`（`recovery.ts:17-59`）只有单个 `rpoSeconds` 字段，没有任何分层表达位。要落地分层必须新增 migration 0011，而 `docs/decisions/system/2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md:143` 规定「migration 前生成加密、owner-only、off-host recovery point，`backupAgeSeconds<=900`」——**即：必须先建成 ≤900 秒的备份能力，才被允许迁移掉 ≤900 秒的要求**。提案完全没有提到这个循环。

修复建议：在 §7 增加「migration 0011」行并写清三件事：(a) 新 schema 如何表达分层（按 tier 增列 / tier-scoped CHECK / 重定义 view）；(b) 第一份合法恢复点在旧 CHECK 下如何取得（自举顺序）；(c) 若不想动 schema，则把本提案的适用范围明确缩小为「T0 一层，900 秒仍是唯一可记录值，T1/T2 的每日快照不进 `backup_recovery_point`」——但那样必须同时说明 §8 的验证证据从哪来。

### P0-2 每日快照 cadence 与生产代码里的 15 分钟 Admin 写门直接冲突

精确引用：`app/src/server/review-real/security.ts:208-219`

```208:219:app/src/server/review-real/security.ts
  private assertRecoveryFence(now: number): void {
    const fence = this.readRecoveryFence();
    if (
      !fence.clockTrusted ||
      !fence.writerReady ||
      fence.lastSuccessfulRecoveryPointAt === null ||
      !Number.isFinite(fence.lastSuccessfulRecoveryPointAt) ||
      fence.lastSuccessfulRecoveryPointAt > now ||
      now - fence.lastSuccessfulRecoveryPointAt >= 15 * 60 * 1000
    ) {
      throw new ReviewRealError("ADMIN_BACKUP_STALE", 503);
    }
  }
```

该方法由 `security.ts:352-356 authorizeMutation()` 在**每一次 Admin 写操作**前调用（fence 文件由 `app/src/server/admin-service/deployment.ts:515-520` 初始化、`runtime.ts:331-342` 读取）。因此提案落地后只有两种可能，两种都是不可接受的：

1. `lastSuccessfulRecoveryPointAt` 由每日 `VACUUM INTO` 写入 → 每 24 小时里有约 23 小时 45 分钟**所有人工审核与发布被 503 拒绝**，即提案要保护的 T0 数据根本无法产生；
2. 由 T0 的 5 分钟日志推送写入 → 这道门的语义从「已验证的异机加密 DB 恢复点」降级为「一个文件被推送成功」，**正是阻断项 #4「把陈旧数据伪装成新恢复点」**，而提案在 §5.4 声称保留 #4 的结论。

提案全文未出现 `security.ts`、`recovery-fence.json`、`ADMIN_BACKUP_STALE`。

修复建议：§7 增加该文件；明确定义分层后的 fence 语义（建议：T0 日志 head 时间门控 Admin 写、DB 快照龄期门控 migration/schema 类操作，两者分字段），并在 §8 增加负例「日志新鲜但 DB 快照超龄时 Admin 写是否应通过」的判定。

### P0-3 T2′ 被定级为「恢复目标跟随 T0」，但 §5 没有给它分配任何备份机制；投影文件在提案下实际是零备份

- §4 T2 补充 结论 2 明确：投影文件「恢复目标跟随 T0」（≤15 分钟）。
- §5 只给出两条路径：§5.1 T0 的 append-only 日志（记录**DB 内**人工决定与审计事件）、§5.2 每日 `VACUUM INTO`（**DB 单文件**）。
- 二者都不覆盖 `<projectionRoot>/active.json`、`generations/**`、`bilingual-active.json`、`bilingual-generation-*.json`。
- 同时 §5.2 主动取消了 projection 与 SQLite 的共同恢复边界（「这消灭阻断项 #3、#7」）。

净效果：投影文件既不在 DB 快照里，也不在 T0 日志里，也不再被要求进入恢复边界——**保护强度低于 FCC322 当前的 `acceptance_exit`**（该出口要求「SQLite 与 projection pointer/generation/manifest 同一恢复边界」）。这是一次实质倒退，而提案把它写成了简化收益。

更严重的是提案漏掉了一个硬约束：`app/src/server/review-real/projection.ts:370-402` 的 `findCommitted()` 会从 `active` 沿 `previousSnapshotManifestHash` **一路回溯到 generation 1**，任一祖先文件缺失/验签失败即 `PUBLIC_SNAPSHOT_INTEGRITY_FAILED 503`；而 `receive()`（`:404,424`）每次发布都先走 `findCommitted`。因此：

- 只恢复「当前激活的那一份 generation」→ 公开读路径看起来正常，但**下一次发布永久失败**；
- §5.2 的「保留最近 N 份，超出的按序删除」若被套用到投影 generations 目录，则**发布链被永久破坏且不可恢复**（重建需要伪造整条历史链的签名，不可能）。

修复建议：把投影树写成独立一层并给出机制——每个 generation 文件生成时即不可变异机复制、全链永不 prune、pointer 与全链一起校验；§8 增加「恢复后成功激活 generation N+1」的验证项（只验证公开页面可读不足以证明发布链存活）。

### P0-4 §4 结论 3 的 runbook 动作会锁死发布路径，且对双语 V2 路径是错的

提案 §4 T2 补充 结论 3 建议：「若只能恢复其一，应主动移除 `active.json` 让站点退到空列表 200」。

- `projection.ts:436-450`：`receive()` 在 `active === null` 时要求 `snapshot.snapshotGeneration === 1`，否则 `PROJECTION_GENERATION_CONFLICT 409`。Admin 侧代际计数器在 `projection_recovery_anchor.active_generation`（`0007…sql:863-879`）已是 N，**删除 pointer 后任何后续投影都无法激活**。这是把一个可见的 503 换成一个不可见的、永久的发布死锁——对单用户运维是更坏的失败模式。
- 双语 V2 路径没有 ENOENT→null 分支：`app/src/server/public/bilingual-snapshot.ts:128-137` 的 `readStableCanonical` 把包括 ENOENT 在内的任何异常统一转成 `PUBLIC_READ_INTEGRITY_FAILED`；`:161-169` 读 `bilingual-active.json` 后才 try/catch。所以**删除双语 pointer 得到的是硬失败，不是空列表 200**。
- 同处 `:165-169` 显示双语 V2 **确实实现了 LKG 回退**（`pointer.body.lkg`）。提案 §4 用「读码后必须修正：初稿称丢失后果是退回 LKG」推翻了 LKG 表述，但只读了 V1 路径就下了全局结论；V2 才是 `E59ACA` 的目标形态。
- 双语 pointer 还把 `schema10Sha256` / `migration0010Sha256` 钉成 `z.literal`（`bilingual-snapshot.ts:94-95`），意味着**任何 schema 变更后旧双语 generation 一律不可用**——这与 P0-1 的 migration 0011 直接互锁，提案未评估。

修复建议：结论 3 改写为「先恢复完整 generation 链 → 再恢复 pointer；**任何情况下不得删除 pointer**；若必须隔离 pointer，同时按授权流程重置 Admin 侧代际锚点并记录 audit fork」，并把 V1（`generations/` 子目录）与 V2（root 平铺 + LKG 引用）列为两行。

### P0-5 T0「日志重放」在 schema10 的写许可触发器体系下没有可行路径

§5.1-3 的核心承诺是「日志足以在最近一次全量快照之上重放全部人工决定」。schema10 不允许这样做：

- `0007…sql:906-910` `backup_recovery_point_insert_guard`：INSERT 必须存在未消费的 `gateway_write_permit` + `state='authorized'` 的 `internal_operation` 且 `recovery_epoch` 匹配，否则 `RAISE(ABORT,'BACKUP_OPERATION_REQUIRED')`；`:914+` 对 `projection_recovery_anchor` 同构；`:774-790` 对 permit / fence receipt 同构。
- `app/src/server/internal-operation/authorizer.ts:44-52,146-153` 与 `gateway.ts:1688-1694` 把「操作种类 → 允许写的表 → 允许的 SQLite 动作」闭集化。
- 人工决定表（`review_decision` / `bilingual_approval_v1` / `x_manual_submission` / `*_audit`）全部处在这套 permit + fence + audit 的写入门后。

因此「重放一条 canonical JSON」要么必须**同时按序重放整个 operation / permit / fence / audit 图**（这恰恰就是提案声称已经消除的「多源有序恢复边界」复杂度，只是换了位置），要么必须 drop trigger（`docs/当前生产状态与执行待办.md` 第 4 节明确禁止），要么必须走真实 Admin 授权（需要 fresh WebAuthn 人工动作，不能自动重放）。

叠加问题：`audit_event` / `internal_operation_audit` / `x_manual_audit` 是前序哈希链，§8.2 要求「行数与 hash 与删除前一致」，但只有在重放能逐字节复现包括时间戳与 epoch 在内的全部输入时才可能成立，提案没有定义这一点。

修复建议：二选一并写进 §5.1——(a) 把重放单位定义为「完整授权操作信封（含 permit/fence/audit 行）按 `audit_seq` 顺序重放 + 明确的 epoch 策略」，并在 disposable production-shaped DB 上先证明可行；(b) 放弃「重放」，把 T0 机制改成「≤15 分钟一次全量 `VACUUM INTO`」——T0 数据量小、DB 体积可控时这条路径完全绕开触发器问题，且能直接满足 P0-2 的 fence。**建议选 (b)**，它比 append-only 日志更简单，且不需要新的一致性论证。

### P0-6 §2 的核心归因不成立：#3、#7 与架构选择无关（由 schema10 + 已交付代码强制），#1 只是改名，#5 被换成一个新的未缓解风险

§2 的关键论断是「8 项里的 1、3、4、5、7 共 5 项……是设计选择的账单」。逐项核对：

| 阻断项 | 提案归因 | 实际 | 证据 |
|---|---|---|---|
| #3 SQLite 与 projection 未形成共同恢复边界 | 源于双源对齐架构，可消灭 | **不成立。** schema10 强制两者成对：`0007…sql:850-851` CHECK 要求 `projection_generation>0` 时 manifest+pointer 均非空；`recovery.ts:157-193 assertRecoveryPointBinding` 逐字段比对 `projection_recovery_anchor.active_generation/active_manifest_sha256/active_pointer_sha256` 与 `common_checkpoint_sha256`。提案在 §5.3 明确保留并要求正式验证 schema10（#2），因此不能同时消灭 #3 | `0007…sql:850-851`、`recovery.ts:157-193` |
| #7 Projection verifier 比生产 strict schema 宽松 | 同 #3，可消灭 | **不成立。** `0007…sql:855` 与视图 `:904` 都要求 `drill_public_pointer_verified=1`，即恢复演练必须验证投影指针；只要这一项在，verifier 的严格度就仍是要求，且 P0-3 的全链验证让它更重要 | `0007…sql:855,904` |
| #1 prune 可能误删有效备份 | 因为有高频 point，改为「保留最近 N 份」即消灭 | **改名而非消灭。** 「超出的按序删除」仍是按元数据/时间排序后的不可逆删除；坏时钟或伪造 manifest 仍能挤掉有效快照。`docs/当前生产状态与执行待办.md` 第 11 节把「不可逆删除……备份」列为必须停止并回统筹 | 提案 §5.2 第 3 点 |
| #5 远端 consume 缺 tombstone/幂等 | 全量推送即消灭 | **换成新风险。** 每 5 分钟全量覆盖推送 = 本地日志被截断/损坏时会用坏副本覆盖掉唯一的异机好副本（poison push / shrink overwrite）。增量+tombstone 至少在远端是 append-only。§11.3 的「异机保留多份」是愿望不是机制 | 提案 §5.1 第 2 点、§11.3 |
| #4 RPO 用完成时间 | 保留结论、缩小适用面 | 成立，但见 P0-2：一旦日志推送写 fence，#4 就在另一处复活 | 提案 §5.4 |

修复建议：§2 的表格改为三列（阻断项 / 重定级后是否仍然存在 / 理由），把 #1/#3/#5/#7 改写成「范围缩小后的保留项」而不是「被消灭」，并据此重算 §2 结尾的「5 项」结论。这不会削弱提案的方向，但会让它诚实——现在的版本会让用户以为采纳后工作量下降幅度远大于实际。

---

## P1：采纳前必须修订（11 项）

### P1-1 DB 提交与日志 append 之间没有定义顺序与原子性，T0 的「≤15 分钟」因此没有依据

§5.1-1 只说「Admin 每次写入人工决定或审计事件时，同步 append 一条 canonical JSON」。缺三件事：

1. **单条 append 不是崩溃原子的**：没有长度前缀/记录分隔/逐记录 CRC，崩溃时最后一条可能是半条 JSON，解析器要么拒整个文件要么静默丢弃尾部。
2. **双写顺序未定义**：DB 先提交后崩溃 → 日志缺一条人工决定（静默数据丢失，直接违反 T0 目标）；日志先写后 DB 回滚 → 重放产生幻影决定。这正是提案在 projection 侧声称消除的「两个独立写入源」问题，被搬到了 T0 路径上。
3. **没有 fsync 与失败语义**：append 失败时该操作是否算失败？若不算，T0 的保护承诺就是空的。

修复建议：定长前缀 + 逐记录摘要的帧格式；日志先写（含 idempotency key）、DB 提交后回写 commit 标记、启动时按标记 reconcile；「日志 append 或 fsync 失败」必须 fail-closed 地让该 Admin 写操作失败（与 `authorizeMutation` 的 fence 语义一致）。

### P1-2 只靠前序 hash 链不足以检测日志损坏

§11.3「日志每条带前序 hash 形成链」漏了三类情况：

1. **尾部截断保持链有效**：丢掉最后 N 条后剩余部分仍是一条完整合法链，除非有外置的 head hash + 单调序号高水位可比。
2. **整文件回滚**：把日志换回旧版本同样通过校验。
3. **链式结构放大损坏**：第 k 条损坏后，k 之后全部不可验证；对链表结构而言「RPO≤15 分钟」不等于「最多丢 15 分钟数据」——本项目自己的 `scratch/2026-08-30-rpo-retier-proposal-check/table-classification-draft.md` 第 110-119 行「缺陷意见 4」已经指出这一点，提案未吸收。

修复建议：逐记录独立摘要 + 链 hash 双写；head hash 与单调 seq 同时镜像到 DB 与异机（互为锚点）；定义「链在 seq k 断裂」的可判定失败状态与告警（挂到 §5.3 的 #8 上）。

### P1-3 `VACUUM INTO` 的证据基础不足以支撑 §5.2 的结论

`scratch/2026-08-30-rpo-retier-proposal-check/check.mjs` 实测的是：500 行、1 个 trigger、无并发写入者的玩具库，且快照以 `readOnly` 打开。未验证而 §5.2 已当作结论的项目：

- 真实 DB 体积、`VACUUM INTO` 耗时、目标磁盘余量——**§3 的事实基线连生产 DB 的字节数都没有列**，无法判断每日全量是否可行；
- 长事务期间 WAL 无法 checkpoint 导致 `-wal` 膨胀（快照在 M1 上与 900 秒采集并发运行时的实际形状）；
- 快照文件的 `journal_mode`：生产在 `app/src/server/db/database.ts:406,572` 显式 `PRAGMA journal_mode=WAL` 并在 `:636-644` 上报该值，恢复后是否需要重设未说明；
- VACUUM 会重建数据库，隐式 rowid 与 `sqlite_sequence` 的稳定性未验证（对 immutable/append-only 表尤其要看）；
- `foreign_key_check` 与 `reviewRealSchemaFingerprint(database)` 相等性未验证——而后者正是 `recovery.ts:159` 的绑定条件。

修复建议：在 production-shaped disposable 副本上、用钉定的 Node 24.18.0、带一个并发写入者重跑，把上述每项写成 §8 的验证行；§3 补 DB 体积与日增量。

### P1-4 `VACUUM INTO` 的运维失败模式未处理

- 目标文件已存在时 `VACUUM INTO` 直接报错：崩溃留下的残留目标文件会让**每日任务从此永久失败**（叠加 §5.3 #8 的告警才可发现，检测窗口 24 小时）。
- 崩溃中途留下的是**明文数据库残片**，落点目录权限未规定。
- 明文→加密之间存在窗口（`VACUUM INTO` 不能写管道，这个窗口不可避免）。提案 §5.3 保留了 #6（kind/keyId + `O_EXCL`）但没说：hash 必须对**明文**、以 fd 为准计算并与 kind/keyId 一起进 manifest；staging 目录必须 0700 owner-only；加密后应 decrypt-and-compare 一次。
- 没有磁盘余量前置检查与失败路径。

修复建议：唯一化目标文件名 + 失败即隔离到 quarantine + 余量预检 + 加密后回读校验，逐条写进新备份任务的 `acceptance_exit`。

### P1-5 FCC322 的「条件性冻结」在唯一真值里无法表达，形成监管真空与队列谎报

`docs/collaboration/tasks/TASK-20260829-FCC322.json` 当前是 `execution_state: "claimed"`、`block_reason: ""`、`authorization_state: "user_confirmed"`；`docs/当前生产状态与执行待办.md` 第 9 节第 1 行写「claimed，当前唯一在办」。提案 §6.1 决定「保持 claimed 不动」+「冻结而非推进」，问题有三：

1. **冻结只存在于一份 `proposed` 文档里**，而该文档开头自己声明「未经用户确认，不得据此修改……任务 JSON」。任何接班 Agent 按 `docs/当前生产状态与执行待办.md` 第 1 节的接班顺序读到 FCC322 JSON，会完全合法地继续整改那 5 项——正是提案认为会作废的工时。
2. **队列谎报**：`claimed / 在办` 与实际「等用户决定、无人推进」不符，第 9 节是给其他 Agent 与部门看的调度真值。
3. **占位锁**：第 9 节执行约束「开发部同一时间只能 claim 一条任务」，冻结期间开发部无法领取第 9 节推荐的下一条 `0ED611`，整个开发部被一份未决提案挂起。

修复建议：在用户授权下把 FCC322 走正式任务工具置为 `blocked`，`block_reason` 指向本 ADR 的 `decision_id` 与提案路径；同时在第 9 节增加一行说明冻结状态与解冻权限归属。保持 `claimed` 不是「不产生真空」，而是把真空藏起来。

### P1-6 supersede 的转移清单不完整，构成审计链泄漏

FCC322 的 `acceptance_exit` 要求的 disposable 故障注入覆盖：「损坏 point prune 零删除、**半写对象**、consume 后断链、**旧 receipt 回放**、schema/trigger/index 篡改、DB-pointer 错配、**路径逃逸**、stale lock」，外加「独立复审 P0=0/P1=0」。提案 §6.1-3 只承诺转移 §5.3 的 3 项。其中**半写对象、路径逃逸、旧 receipt 回放、独立复审出口**都与 RPO 无关，会在 supersede 时静默消失。

修复建议：§6.1 增加一张完整映射表：FCC322 每一条 `acceptance_exit` 项 → 新任务对应出口 / 或「明确放弃 + 理由」。不允许出现未列举项。

### P1-7 支撑 8 项阻断的证据与 §9 的回退路径都躺在被 gitignore 的一次性目录里

- `.gitignore:2` 是 `scratch/*`（仅 `!scratch/README.md`）。`git check-ignore` 确认 `scratch/TASK-20260829-BACKUP-V2-UPGRADE` 被忽略。
- FCC322 的 `artifacts: []`、`report: ""`、`pointers` 只有 `docs/当前生产状态与执行待办.md`，即**8 项阻断的原始独立审查报告没有任何被版本化的落点**，其结论目前只以 `docs/当前生产状态与执行待办.md` 第 8 节的 8 条要点形式存在。
- 提案 §9 的回退方案「旧方案候选保留在 `scratch/TASK-20260829-BACKUP-V2-UPGRADE/working/`」——同一个被忽略、按约定「用完即弃」、与生产同故障域、不在 §4 任何一层里的目录（§4 的 T0 清单是 `docs/spec.md`、`docs/decisions/`、`docs/collaboration/tasks/`、`design/`，不含 `scratch/`）。

即：提案要保护审计链，但审计链的证据本身 RPO=∞，回退路径也一样。

修复建议：§4 增加「证据/收据层」的定级决定（把报告 + manifest + hash 提升到受版本控制的位置，或显式接受其丢失并说明后果）；§9 的回退承诺不能依赖被 ignore 的目录。

### P1-8 §3 / §7 关于 `.gitignore` 的事实与磁盘现状不一致，且暗示存在声明范围外的写入

当前 `.gitignore` 已经包含 `design/`、`.worktrees/`、`.next/`，且 `node_modules/` 是**未注释的生效行**。而 §3 的事实基线把这三项列为「`.gitignore` 未覆盖的大目录」，§7 的影响面表还要求「追加 `design/`、`.worktrees/`、`.next/`、取消注释 `node_modules/`」。git status 显示 `.gitignore` 为已修改未提交。

两种可能都需要处理：要么 §3 的基线是对另一个树状态测的（那么「545 处 / 946 MB」等数字也需重新标注测量时点与 revision），要么在提案自称「写入范围仅限本文件」期间发生了范围外写入。

修复建议：§3 标注测量所依据的 git revision 与时刻；披露本轮已发生的任何文件改动；§7 删除已生效的条目。

### P1-9 表数与分层完备性：§8.1 的验收基准（67 张表）与提案自己的证据（63 张净表 + 4 视图）不一致，且草案提出的 7 条缺陷未被吸收

- §3 写「schema10 lineage 表数量 67」，§8.1 要求「对全部 67 张表逐一标注……无未分类表」。
- 提案自己的证据 `scratch/2026-08-30-rpo-retier-proposal-check/table-classification-draft.md:7` 结论是净表 **63**（差额为 VIEW 与 TEMP 表），且该文件第 2 行明写「待独立复核，**不得直接并入提案**」。
- 该草案第 110-119 行提出 7 条针对分层定义本身的缺陷，提案一条都没有吸收，其中三条直接影响结论可信度：
  - **依赖传递规则缺失**：`published_projection`、`bilingual_language_slot_v1` 等「T2」表的免费可再生性以上游 T0/T1 存活为前提；没有「T2 的重建保证随最弱上游退化」这条规则，逐表达标但链路不可重建。
  - **混合表只有上调规则、没有成本出口**：`pending_review_candidate` 含人工编辑列，整表上调 T0 后**几乎全部抓取正文又回到 15 分钟路径**。
  - **备份元数据的递归层未处理**：`backup_recovery_point` 自身被定为 T0（它承载密钥版本、off-host 回执、演练证据），即「恢复能力本身是否可恢复」这一层提案没定义。
- 按草案统计（T0 29 + T1 5 + T2′ 4，且 T1 暂按 T0），**63 张表里约 38 张仍在 ≤15 分钟路径上**。§2 暗示的「移除一整套企业级备份架构」的收益因此被显著高估。

修复建议：修正分母；在 §4 增加依赖传递规则与混合表的列级/拆表演进路径；在 §4 增加「备份元数据层」；在 §8.1 之外增加「草案疑义清单逐条结清」的出口；在 §2 补一张诚实的成本对比（多少张表、多少字节真正离开了 15 分钟路径）。

### P1-10 覆盖用户冻结条款的程序正当性：`proposed` 状态下已发布 supersede 元数据；overlay 惯例只对 ADR→ADR 成立，对 agent-guide 无先例且会形成循环授权

- 提案 front-matter 在 `status: proposed` / `authorization_state: awaiting_user_decision` 下已经写了 `supersedes_clause_of:`（`:11-13`）。机器读者与 grep 会把它当成生效关系。
- §4 内嵌了一段「**2026-08-30 用户决定**」（T1 暂按 T0），与同文件 front-matter 的 `awaiting_user_decision` 自相矛盾；项目既有的授权记录通道是任务 JSON 的 `authorization_history` 与 `docs/progress.md`，不是未采纳 ADR 的正文。
- §7 声称「符合项目既有的 successor overlay 惯例」。核对：既有 overlay 全是 **ADR→ADR**（`docs/spec.md:326`、`docs/decisions/system/2026-08-24-F1+1-v6到v10双语完整Admin生产successor-accepted.md:218-220` 的「可信单用户 M1 quick-launch successor overlay」），且每次都伴随记录在 spec/progress 的用户明确选择。**没有任何先例是一份 ADR 去覆盖 `docs/agent-guide.md` 里的硬门。**
- 更麻烦的是授权链会成环：`CLAUDE.md` / `AGENTS.md` 规定冲突以 `docs/agent-guide.md` 为准；`docs/agent-guide.md:61` 又规定「Spec 与其他文档冲突以 Spec 为准」；提案 §7 让 agent-guide 第 6 条去引用本 ADR，而 §7 同时向 `docs/spec.md` 追加覆盖层。三者互指。

修复建议：采纳前把 `supersedes_clause_of` 改为 `proposed_supersedes` 或移除；把用户的 T1 决定挪到正常授权通道并在 ADR 里只做引用；§7 增加一条明确的优先级裁定（agent-guide / spec / ADR 三者在 RPO 口径上的唯一权威是谁），否则下一个 Agent 会拿三份互指的文档得出三种结论。§11.5 已经点出「必须由用户明确回答」，这是对的，但要补的是**回答之后落到哪个文件、以什么形式生效**。

### P1-11 §4 T2 补充的三态表在关键细节上不准确，而 §8.6 已经把它变成了验证目标与 runbook

代码引用（`projection.ts` 行号）基本准确，但**场景标签错了**，且 §8.6 会照着错的状态去构造注入：

1. **「投影文件整体丢失（`active.json` ENOENT）→ 空列表 200」只在投影根目录仍存在且为 0700/owner-uid 时成立。** `projection.ts:276-277` 的 `assertReadableProjectionDirectory(root)` 在 ENOENT 检查**之前**执行，所以真正的「整体丢失」（目录都没了）走的是 `PUBLIC_SNAPSHOT_INTEGRITY_FAILED`，不是 200。表里第 2 行应拆成「根目录存在但 pointer 缺失」与「投影树整体消失」两种。
2. **状态码是 500 不是 503（默认路径）。** `app/src/server/public/http.ts:47` 把 `PUBLIC_READ_INTEGRITY_FAILED` 映射为 **500**，只有 signed-snapshot 分支 `:83-84` 才是 503。监控与 runbook 按 503 写会漏告警。
3. **详情页不是 200。** `projection.ts:545` 在 snapshot 为 null 时 `PUBLIC_SNAPSHOT_UNAVAILABLE 404`，所以「页面正常但没有任何内容」只适用于列表。
4. **恢复必须保留权限与 inode 属性，提案完全没提。** `projection.ts:226-242` 要求 `nlink === 1`、`uid === 当前 uid`、`(mode & 0o077) === 0`、`size <= 2MB`，并在读前后比对 dev/ino/size/mtime/ctime。用任何不保留 owner/mode 的方式解包恢复投影文件 → **永久 503/500**。这一条必须进 runbook 和 §8.6。
5. **「公开站从不读数据库」过强。** `app/src/server/public/repository.ts:558-625` 是真实的 SQLite 读路径（含 `dataProfile === "public-synthetic"` 分支），`http.ts:48` 也保留了 `PUBLIC_DB_BUSY`。准确表述是「真实签名投影 profile 的读路径不经 DB」。

修复建议：按上述 5 点重写该表与 §8.6 的注入矩阵（应为 5 种状态而不是 3 种），并把「恢复需保留 mode/uid/nlink」写成 runbook 的第一条前置。

---

## P2：建议（9 项）

- **P2-1 实测环境未对齐钉定版本。** §5.2 自己承认在 `node v22.23.1` 上跑（项目钉定 `24.18.0`）。把「在钉定版本上复验」从括号说明升级为 §8 的一行验证出口，避免它作为脚注被跳过。
- **P2-2 一次性证据未清理。** `scratch/2026-08-30-rpo-retier-proposal-check/` 留下了 `src.sqlite`、`snap.sqlite` 两个明文 SQLite 产物。`.gitignore` 的 `*.sqlite` 覆盖了泄漏风险，但 `docs/agent-guide.md:63` 要求 scratch「用完即弃」；一致性上应清理并在报告里只留 hash。
- **P2-3 T0 的密钥托管未定义。** §5.1-2 说「加密后推送」，§10 说「不放宽加密」，但没说密钥放在哪、如何轮换、M1 整机损毁后谁能解密。`docs/agent-guide.md:132` 要求由合同冻结密钥托管/轮换/保留。若唯一密钥副本随 M1 消失，T0 的真实 RPO 仍是无穷——这与 §11.4 的结论同类，应并列写出。
- **P2-4 5 分钟 cadence 与 15 分钟目标之间只有 3 个周期余量。** 建议在 §5.1 直接写出告警阈值（例如连续 2 次推送失败即失败状态），并指出每日快照把静默失败的检测窗口从 15 分钟拉长到 24 小时——这是低频方案的代价，应写进 §11 残余风险而不是留白。
- **P2-5 §12 的问题清单已过期。** Q2 在 §4 已被用户回答；Q4 在 §6.2 / §11.4 已说明「用户已授权但被公开仓库阻断」。请重排为「当前真正待答」的问题，否则用户会重复回答已决事项。
- **P2-6 `COST-OBS` 的位置让 T1 事实上永久停在 T0。** §6 把它排在 `E59ACA` 之后（即全链上线之后）。若目标只是测出「重算一天」的金额，`machine_summary_draft` 与 `internal_external_attempt` 里已有 token/调用记录（见分层草案对应行），可以更早产出估算。建议把 `COST-OBS` 拆成「离线估算（可立即做）」与「线上成本监控（随 E59ACA）」两步。
- **P2-7 §8.1 的出口应包含疑义结清。** 分层草案的「疑义清单」（第 93-109 行）有 11 条未决项（`projection_delivery_receipt` 的对端保留策略、`internal_control` 的 epoch 连续性、`budget_account` 的付费事实累计、`gateway_write_permit` 已消费状态的防重放语义等）。「无未分类表」不等于「无未决疑义」，建议在 §8.1 增加第二个出口。
- **P2-8 `T0-DOC` 还缺一个未列出的前置决定。** §11.4 正确识别了公开仓库问题，但没写：一旦含 Tailscale 地址的 commit 被推送，就需要历史重写才能撤回；且 `.git` 与生产同故障域。建议 §11.4 把可选项明确成三选一（仓库改私有 / 脱敏后推送 / 另建私有 remote），并说明各自对已有 5 个本地未推送 commit 的处理方式。
- **P2-9 投影发布路径自己也有一个 stale lock 静默失败点。** `projection.ts:413-423,480-482`：`activation.lock` 用 `O_EXCL` 创建、`finally` 里 unlink；进程在两者之间被杀会留下 stale lock，之后每次 `receive` 都被 `EEXIST` 映射成 `PROJECTION_GENERATION_CONFLICT 409`。§5.3 的 #8 目前只覆盖备份 `run.lock`；建议把「stale lock 不静默」的要求写成跨路径通用项，一并覆盖 `activation.lock`。

---

## 对提案七个审查问题的直接回答

1. **「8 项中 5 项源于架构选择」的归因**：不成立。#3、#7 由 schema10 CHECK/视图与 `recovery.ts` 的绑定强制，与增量/远端协议无关，换成每日 `VACUUM INTO` + append-only 日志后**依然存在**；#1 只是改名（「按序删除」仍是不可逆 prune）；#5 被换成 poison-push 这一新的未缓解风险；只有 #4 的适用面确实缩小（但见 P0-2，它在 Admin fence 上复活）。见 P0-6。
2. **T0 append-only 日志的完整性**：三处不完整。重放边界与 schema10 的写许可触发器体系不相容（P0-5）；崩溃时最后一条 append 无原子性、且 DB 提交与日志 append 之间没有顺序与 fail-closed 语义（P1-1）；前序 hash 链无法检测尾部截断与整文件回滚，且会把单点损坏放大成尾部全损（P1-2）。
3. **`VACUUM INTO` 的盲点**：写锁在 WAL 下不阻塞写入者，但长读事务会阻止 checkpoint 导致 WAL 膨胀；磁盘余量、真实 DB 体积与耗时完全没有数据（§3 连 DB 字节数都没列）；明文→加密之间的窗口与 staging 目录权限、hash 取值口径未定义；残留目标文件会让每日任务永久失败；快照 journal_mode / rowid / `sqlite_sequence` / schema fingerprint 未验证。见 P1-3、P1-4。
4. **「投影文件 = T2′」是否自洽**：不自洽。T2′ 有目标但 §5 没给它任何机制，实际是零备份且弱于 FCC322 现有出口（P0-3）；恢复顺序「先 generations 再 active.json」方向对但不完备——必须恢复**整条**代际链，否则发布路径永久失败；而建议的「主动移除 `active.json`」会锁死发布，且对双语 V2 路径是错的（P0-4）；三态表的状态码、场景边界与权限前置也不准确（P1-11）。
5. **supersede FCC322 的条件性冻结**：留下监管真空。冻结只写在一份自称无约束力的 `proposed` 文档里，任务 JSON 与执行待办第 9 节仍显示 `claimed / 在办`，接班 Agent 会合法地继续做被认为作废的工作，同时开发部被单任务 claim 约束挂起（P1-5）；转移清单只列 3 项，漏掉半写对象、路径逃逸、旧 receipt 回放与独立复审出口（P1-6）；而支撑这 8 项的原始报告本身在被 gitignore 的 `scratch/` 里，审计链在 supersede 之前就已经很薄（P1-7）。
6. **覆盖用户冻结条款的程序正当性**：方式与惯例只**部分**一致。overlay 惯例确实存在，但既有先例全是 ADR→ADR 且都伴随记录在 spec/progress 的用户明确选择；覆盖 `docs/agent-guide.md` 的硬门无先例，并会让 CLAUDE.md → agent-guide → ADR → spec 的授权链成环。另外 `proposed` 状态下已发布 `supersedes_clause_of`、并在正文内嵌一条与 front-matter 矛盾的「用户决定」，都应在采纳前修正（P1-10）。§11.5 要求用户明确回答是正确的，但缺「回答后以什么形式在哪个文件生效」。
7. **高估/低估的风险**：
   - **高估的简化收益**：分层后仍有约 38/63 张表在 ≤15 分钟路径（T1 暂按 T0 + 混合表上调 + T2′ 跟随 T0），而 §2 的叙述让人以为整套架构可以退役（P1-9、P0-6）。
   - **高估的可回退性**：§9 称「删除本文件即可，无其他副作用」——在 P0-1（schema CHECK / migration 0011 不可 down）与 P1-8（`.gitignore` 已被改动）成立的情况下不成立。
   - **低估的风险**：Admin 写门 15 分钟硬编码（P0-2，最严重，会直接让人工发布不可用）；投影代际链的全链依赖（P0-3/P0-4）；恢复时文件 mode/uid/nlink 要求（P1-11-4）；T0 密钥托管（P2-3）；每日 cadence 把静默失败检测窗口拉到 24 小时（P2-4）。
   - **正确且被低估的价值**：§3「唯一有备份论证的对象是可再生的 RSS 副本，而不可再生的产品决策与设计产出没有任何异机副本」这一观察是本提案最有价值的部分，且与 `docs/当前生产状态与执行待办.md` 第 4 节（verified recovery point = 0）一致。建议把 `T0-DOC` 从「被 §6.2 阻断的第一步」提升为**与本提案解耦的独立决定**先行推进——它不依赖任何分层结论，也不需要 schema 变更。

## 建议的最小可行修订路径（不改变提案方向）

1. 把提案范围缩小为两件互不依赖的事：**(A) 立即保护当前零备份的库外 T0 资产**（docs/decisions/tasks/design + 证据目录），这一步不碰 schema、不碰 fence、不碰 900 秒；**(B) DB 层的 RPO 分层**，作为需要 migration 0011 + `security.ts` fence 语义变更的独立提案。
2. (B) 里把 T0 的机制从 append-only 日志改为「高频 `VACUUM INTO`」（P0-5 修复建议 (b)），从而同时解决触发器重放、双写原子性与 Admin fence 三个问题。
3. 投影树单列一层并给出「全链不可变异机副本、永不 prune」的机制与验证（P0-3）。
4. §2 的归因表按 P0-6 重写；§9 的回退承诺按 P0-1/P1-8 重写。
5. FCC322 按 P1-5 置 `blocked`（不是保持 `claimed`），转移清单按 P1-6 补全。
