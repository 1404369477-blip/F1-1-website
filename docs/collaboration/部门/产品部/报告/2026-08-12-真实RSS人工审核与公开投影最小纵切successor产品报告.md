---
type: product_completion_report
status: final
date: 2026-08-12
department: 产品部
task_id: TASK-20260812-28FA62
decision_id: ADR-M5-REAL-REVIEW-PUBLISH-001
external_calls: 0
app_changes: 0
design_changes: 0
---

# 真实 RSS 人工审核与公开投影最小纵切 successor 产品报告

## 1. 结果

本任务已收敛为一个可实施 successor：固定 M1 现有 `rss-real-private` 继续作为真实候选唯一写主；人工保存生成不可变 Bundle；approve/reject 绑定当前来源修订与 Bundle；approve 只创建 Decision 和 queued Publication；用户第二次显式手动 publish 才提交私有 PublishedProjection 与唯一 `snapshot_sync` outbox；公开 `/` 与 `/stories/{publicId}` 只读取接收端原子激活的独立全量快照。

后继任务已完成不含 UI 的本地后端候选：七表/mapping、Review Repository/route facade、ProjectionReceiver、PublicSnapshotRepository 与完整 schema 启动指纹均已落地，并取得唯一端到端测试、Node24 typecheck和最终限定安全收据。现有 `/admin/reviews` 候选仍缺真实 RSS 状态与正式视觉证据，所以视觉门继续阻断页面/UI/CSS。当前 public synthetic Beta、数据库、hash 和回退 release 均保持只读；固定 M1 真实库迁移、正式 HTTP 接线和公开切换没有发生。

## 2. 决策依据

- 真实收据已证明一次 HTTP 200 采集形成 20 条 `pending_review`；RunAtLoad 与一个零手动触发的自然 900 秒周期均对同批内容得到 `new=0/duplicate=20`，公开 synthetic 零漂移。
- 当前 RSS 三表已经包含 candidate 的机器字段、人工工作副本、来源修订和状态；复制到旧 synthetic 审核域会形成第二候选真值。
- SQLite 不能为私有主库与独立公开端提供跨故障域原子提交；唯一 outbox、内容寻址全量快照、receiver receipt 可区分业务成功、投递成功与结果未知。
- 用户已固定“初期人工审核、禁止自动发布”，所以 approve 与 publish 保持两个独立动作，auto-publish 入口为 0。
- 第一版 0 图、人工中文标题/摘要和真实原文链接已经能构成闭环；AI、second-hop、媒体和多源接入继续后置。

## 3. 冻结产出

1. accepted ADR：`docs/decisions/system/2026-08-12-F1+1-真实RSS人工审核与公开投影最小纵切-successor-accepted.md`。
2. 实施合同：`docs/spec/F1+1-真实RSS人工审核与公开投影最小实施合同-v0.1.md`。
3. 当前 Spec：`docs/spec.md`。
4. 初版功能矩阵：`docs/spec/F1+1-初版全功能追踪矩阵-v0.1.md`。
5. Spec 索引：`docs/spec/README.md`。
6. 进度真值：`docs/progress.md`。
7. 产品部交接：`docs/collaboration/部门/产品部/交接班文档.md`。

## 4. 后继本地实现状态

`DEV-REAL-REVIEW-BE-01` 的本地候选已由后继任务实现，包含 `0002_admin_review_publish.sql`、schema/mapping/migration、Review Repository/backend/route facade/security、ProjectionReceiver、PublicSnapshotRepository 与聚焦测试。唯一端到端正例覆盖 revision、approve 后 0 公开、reject、manual publish、receiver active 及 public list/detail；固定 Node24 typecheck通过，完整 schema 指纹 P1 已由 `739DF6` 修复并由 `7B47E0` 限定复审放行。

客户端 Bundle CAS 字段统一为 `latestBundleVersionTag`、`bundleVersionTag`、`approvedBundleVersionTag`，均为完整 Bundle hash 经服务端复验后取前 12 位小写十六进制；完整 64 位 hash 继续只存在服务端。该本地候选没有迁移固定 M1、没有正式 HTTP server/Next Route Handler 接线、没有 UI、没有网络或公开切换。

## 5. 已验证与未验证

已验证：输入合同/收据/现行物理 schema 已逐项对照；产品链已经固定到表、事务、DTO、错误、Function ID、实施波次、验收和回退；后继本地候选已有七表/mapping、Repository/route facade、receiver/public reader、唯一端到端测试、typecheck和最终限定安全收据；功能矩阵只有 `complete / user-gated / P1-blocker` 三态，50 行机械计数仍为 `20 / 7 / 23`。

未验证：固定 M1 真实库尚未应用 `0002`；正式 DB opener、HTTP server/Next Route Handler、sender/receipt 回写与故障运行尚未接线；20 条候选尚未通过正式出口人工编辑/决定/发布；未来每个 900 秒周期与已有非空人工字段遇真实更新的动态保护未证明；真实视觉、Mac/iPhone 私有入口、Tailscale/passkey、生产认证/备份/双主机/公网切换未验；真实图片和 AI 继续关闭。

## 6. 错题自检

- 自然 900 秒周期只按 `BAF2E6` 的一个已 ACK 样本记录，没有外推为长期稳定。
- 没有把 private `published` 业务事实写成公开 active；公开可用仍要求 receiver active receipt 与 GET 200。
- 没有复用旧 11 DTO/111 槽位作为当前物理事实；它仅作为语义输入。
- 没有把视觉候选写成用户已确认；后端与 UI 门已拆开。
- 没有改写 accepted 双主机合同、RSS `0001`、synthetic DB、`app/` 或 `design/`。
- 独立安全、测试与设计复验属于后继任务；本产品任务没有自行宣称这些门已通过。

## 7. 任务状态

产出完成后仅执行一次文档机械检查、任务 doctor 与 task complete。`TASK_STATE_OK` 只证明本任务产品合同、同步文档与任务状态持久化，不代表任何业务代码、真实审核、真实发布或生产切换已经完成。

TASK_STATE_OK
