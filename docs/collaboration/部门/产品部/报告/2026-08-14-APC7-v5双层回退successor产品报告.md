---
type: product_report
status: final
date: 2026-08-14
department: 产品部
task: TASK-APC7
runtime_state: disabled_unchanged
review_input: scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review-apc6.md
review_input_sha256: 81a066974c89c6f216ba4bd14829d4c7640cda70a7a063be9be3252e627b88dd
decision: contract_p1_addressed_pending_apc8
---

# TASK-APC7：v5 双层回退 successor 产品报告

## 1. 结论

APC6指出的首个P1在产品合同层已收敛：现行v4 release不得打开已提交0005的v5 DB，原“旧manual-only runtime忽略v5附加表”的回退主张被新的accepted successor精确取代。

现行可实施回退只有两层：

1. **0005 COMMIT前**：迁移失败使同一事务整体ROLLBACK；仅在证明DB仍为精确v4、identity/audit/outbox未漂移后，现行v4 release才可恢复。
2. **0005 COMMIT后**：full v5失败只可切换到同候选、预构建、互钉manifest并完成stage演练的`v5-manual-only-fallback`；它打开同一个v5 inode并保留全部v5增量。旧v4 release、down migration、普通流程恢复迁移前备份、复制/`ATTACH`/双写全部禁止。

迁移前备份恢复被限定为灾难恢复：必须明确恢复点、实际/预计丢失窗口、故障v5与备份v4 audit tail、public/receipt状态和audit fork identity。该路径不能记录为普通无损rollback。

本任务没有新增用户产品选择，只修复已accepted方向的可执行性。runtime仍为`disabled`；0005、full v5、fallback、manifest、测试、M1迁移和部署均未产生。

## 2. 输入身份与只读代码事实

### 2.1 审查与前身

| 输入 | SHA-256 |
| --- | --- |
| APC6安全复审 | `81a066974c89c6f216ba4bd14829d4c7640cda70a7a063be9be3252e627b88dd` |
| predecessor ADR `ADR-M5-BACKLOG-AUTO-PUBLISH-001` | `59302394fe76f9dfbea32ab054b1969ca3b5d0f15bd55ffb09f98520f209a298` |
| predecessor实施合同v0.1 | `633babb5949562b51a8cd57621538ca9d09136e0eb49e7cfd1bc6f73846dd2d7` |
| predecessor产品报告 | `f048c46b97fde813637e326d77423782d1506117068fe386776a84e40eddfa2c` |

001与v0.1当前为未提交accepted产物；本任务未原地修改。新ADR在frontmatter与正文中标明只supersede其migration/startup/rollback/disaster-recovery/re-upgrade语义，新v0.2作为现行实施入口；旧文件继续保留历史字节。

### 2.2 现行实现只读证据

| 文件 | SHA-256 | 与P1直接相关的事实 |
| --- | --- | --- |
| `0001_rss_real.sql` | `c03c5c0bd5887e9e74453c91602bae76f6a7c74db513a2d9ff808ad498807ef3` | 建立v1 RSS私库 |
| `0002_admin_review_publish.sql` | `1d373f90cf881a58a15966ffe12ed01c3a651380d5f4f5aa9de468d79a798263` | 建立旧HTTP-shaped operation/audit/publication/outbox |
| `0003_projection_delivery_runtime.sql` | `0f9d3908b62006158bf6dab60a4969c0bf65b95787d483b4e365f36199a86848` | 建立现行delivery/receipt runtime |
| `0004_rss_media_and_chinese_refinement.sql` | `070dcd5778c88db85259f083f7272c42d562d30e8c8b2c74bb16d4e36205aeda` | 当前最高schema版本为4 |
| `admin-service/runtime.ts` | `f34364b290f5b522e6e749575640e36626f593aacb9a749d02697b5bbc623a30` | opener只允许1..4并要求最终v4；现行runtime还会调度sender/automatic review |
| `review-real/migration.ts` | `242c434e4067e92d3cf9592190e8ca2bee2703ad79ee4736951942c97cbe2262` | 精确验证v2/v3/v4 fingerprint，不认识v5 |
| `rss/repository.ts` | `de68148179006965b42582ce11e9fbec3aa48c646bf465ad763439fbf7d339d3` | repository只接受v1或v4，无v5 phase/fallback gate |
| `rss-collect-once.ts` | `d8f7a2c224feaa95eb8d2cb92b50fcf0afc50347ff14a37af473feecd07fb90f` | claim后执行真实fetch，无fallback hard-disable |
| `review-real/repository.ts` | `73e5ed08455888290e7810991cccfab25653ff8771d22c193801b48595a42e8e` | 现行operation/outbox写法不满足v5 closed union/producer binding |
| `review-real/sender.ts` | `42e036649d72053ef66ca2bed9115a43c0a60bdbe4432d8995d3d3731f8dd6b5` | sender会扫描现行可投递outbox，尚无fallback producer allowlist |

上述事实足以否定“旧v4代码可忽略v5附加表继续运行”。本任务未运行代码、未打开DB，也未对这些文件写入。

## 3. 冻结的最小实现合同

### 3.1 fallback能力

`v5-manual-only-fallback`必须与full v5共享同一Git tree、0005/schema/repository模块与精确v5 fingerprint，并以不同`releaseRole`和内容寻址manifest互钉。它完整理解/写入v5 operation closed union、persistent fresh binding、legacy provenance、audit、Publication/Projection/outbox producer和receipt。

允许：人工HTTP revision/approve/reject；fresh HTTP publish/correct/withdraw；fresh pause/stop；只读状态；producer合法outbox的same-delivery sender。

禁止：`internal_auto_review|internal_auto_publish`、两个system auto actor、`start_backlog|enter_live|resume_backlog|resume_live`、collector/refiner/automatic reviewer/publisher、collector running slot及DNS/socket/HTTP、raw queued扫描和系统snapshot/outbox创建。

fallback看到既有`backlog|live`时先进入control/read-only安全态，直到operator以fresh pause/stop持久化paused。它不代写phase。

### 3.2 sender边界

0005必须给每条outbox建立immutable producer operation FK。migration前既有outbox只能在唯一绑定到`legacy_http_shaped_unknown/publish`时迁移；fallback期间新outbox只能来自manifest operator合法`http_post/publish|correct|withdraw`及对应fresh binding。internal、unknown、缺失、重复或错绑定producer不得lease。

sender只改变delivery/receipt状态；response unknown继续reconcile同一delivery，明确404后才重投同一签名package。它不创建Decision、Publication、Projection、snapshot或outbox。receiver只允许manifest精确loopback；collector零外联与sender有限loopback调用分别计量。

### 3.3 切换次序

1. 同候选构建并stage full/fallback，互钉manifest；在隔离备份恢复副本完成v4→v5、双opener、HTTP/DB/fresh/outbox与负例演练。
2. 建立fresh一致性备份并证明`backupAge<15m`、hash/manifest与隔离恢复。
3. quiesce Admin、collector、refiner、automatic reviewer/publisher、sender；running ingest为0，active sender lease收敛或持久进入同delivery reconcile状态。
4. 锁唯一DB并复核v4 identity/fingerprint/integrity/audit/outbox。
5. 单事务执行0005，提交前验证schema/data/legacy/audit/FK/operation/outbox producer与singleton disabled。
6. COMMIT后用v5 opener复核同一inode，再启动full v5且phase仍disabled。
7. full失败时卸载full并启动已配对fallback；不得恢复备份或启动v4。

## 4. 产物

| 产物 | 作用 |
| --- | --- |
| `docs/decisions/system/2026-08-14-F1+1-条件自动发布v5双层回退-successor-accepted.md` | 不可变successor ADR，精确取代001的错误回退语义 |
| `docs/spec/F1+1-存量优先确定性安全初审与条件自动发布实施合同-v0.2.md` | full/fallback、双opener、producer sender、部署/恢复/负例实施合同 |
| `docs/spec.md` | 切换现行权威入口并增加P1门与变更记录 |
| `docs/progress.md` | 记录APC7合同层完成与运行态未升级 |
| 本报告 | 输入、结论、范围、Unknown与交付身份 |

最终产物SHA在唯一限定`git diff --check`通过后计算并回报；报告不能预写自身最终SHA。

## 5. 未验证与后继门

- APC8独立复审：待执行；本报告只可写`pending_apc8`。
- 0005 SQL、v5 fingerprint、outbox producer回填：未实现、未运行。
- full/fallback release及manifest SHA：未构建，实际身份Unknown。
- stage的HTTP/DB/fresh/sender/负例、生产backup/quiesce/migration/start/fallback：全部未运行。
- 现行v4DB与M1没有被本任务访问；瞬时inode、audit/outbox/receipt/active generation需部署任务现场重读。
- 灾难恢复可能丢失集合必须按实际恢复点计算；本文只冻结报告格式与禁止静默拼接规则。

因此，APC6首个P1只能标记为“产品合同已修、等待APC8”；项目实现状态与运行态均未升级。
