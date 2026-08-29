---
type: audit_report
department: 安全部
target: 739DF6完整sqlite_schema指纹successor
status: final
date: 2026-08-12
related_task: TASK-20260812-7B47E0
decision: pass
tags: [rss-real, admin-review, sqlite-schema, fingerprint, limited-review]
summary: 新migration与test的SHA精确匹配，完整main.sqlite_schema闭合指纹已在v1迁移后和现成v2打开路径强制核对，删除关键trigger无法通过；52616C唯一P1已CLOSED，限定结论PASS，P0/P1/P2均为0。
---

# TASK-20260812-7B47E0 完整 `sqlite_schema` 指纹唯一 P1 最终限定复审报告

## 1. 最终结论

**PASS：P0=0，P1=0，P2=0。**

`TASK-20260812-52616C` 的唯一 P1-01 已 **CLOSED**。新候选没有继续以表名“包含”作为最终 schema 身份；它从 `main.sqlite_schema` 收集全部非 SQLite 内部的持久对象，闭合为 `type/name/tbl_name/sql`，确定性排序后用项目 canonical JSON 计算 SHA-256，并与冻结 final-schema SHA `46a714035b59e1d608065922593895cd72c0748ac5ddbef660ae16e99e7f638e` 精确比较。

该门同时覆盖 table/index/trigger/view，对额外业务对象、缺表/列/index/trigger、DDL SQL 字节漂移与对象类型漂移都会得到不同指纹。任何非内部 temp schema 对象会被单独拒绝，非 `main/temp` 的 attached database 仍被原门禁拒绝，不存在用 temp 同名对象遮蔽 main 后通过的路径。

`user_version=1` 在精确 `0002` 文本 SHA 命中后执行 `BEGIN IMMEDIATE` migration，提交后立即验证最终 schema；`user_version=2` 不自动修补，每次经过同一打开函数时直接重验指纹。测试源码已明确覆盖“合法 v2 重开通过 → 删除 `publication_no_delete` → 再次重开时 `ADMIN_INTERNAL_FAILURE` → Repository 尚未构造”。

本结论仅放行当前后端候选进入本地部署准备。未来运行时打开器必须在构造 `ReviewRealRepository` 前调用这个精确 migration/schema 门；当前任务没有放行跳过该顺序的另一个入口。

## 2. 冻结身份

### 2.1 本 successor 两项新身份

| 对象 | 本会话只读 SHA-256 | 任务冻结值 | 结果 |
| --- | --- | --- | --- |
| `app/src/server/review-real/migration.ts` | `b752d7f115d50bc9af4077b537e0fb4e9ea9ba5deac8195a91b1a2bc6c7a0f39` | 同左 | PASS |
| `app/src/tests/review-real-backend.test.ts` | `6387db1d5b77b93eddd188e8ceeec50c02d1e9a6fbb139c6e9d4125a6d4a6fa5` | 同左 | PASS |

### 2.2 其余核心身份

| 对象 | SHA-256 | 结果 |
| --- | --- | --- |
| `app/src/server/review-real/error.ts` | `4cbf9f8df661ac99d306029874caf1e1d02e33a3f4e4b97ce484bb62b78a0ba4` | MATCH |
| `app/src/server/review-real/security.ts` | `1a2741d5bb688f5abb28209bae2614c2c7666d1ecba582973c29a19c29b2c458` | MATCH |
| `app/src/server/review-real/schema.ts` | `2c00bfc6916f4fded2d8e09f96193c428c157c0797c10081e749aba7620b2fde` | MATCH |
| `app/src/server/review-real/mapping.ts` | `139f05fdbd2b45e5b5a8d4c95b58b864b8e7a48d99c796a00a489e74a4f3730e` | MATCH |
| `app/src/server/review-real/repository.ts` | `ad35534a3ae192796a5b7a1a199c306d71520dcd338ff4140f92b4593ef6ad6f` | MATCH |
| `app/src/server/review-real/backend.ts` | `a8349c5ada79268ba38155a4352b4f46cdee9ca1cfd409dae7f01813e7e0ea27` | MATCH |
| `app/src/server/review-real/routes.ts` | `cf022cb0dd9ceb37f5a6deebb662862e5a67700fbb9f963891388e1eaa8ad500` | MATCH |
| `app/src/server/review-real/projection.ts` | `46f868cf5d1caea9347030f2588d34f4334799c935d31e5d387f059cfe8cfb05` | MATCH |

上述两个新身份与八个未改核心文件组成本任务的十核心 SHA。另外，数据层前置 `app/migrations/rss-real/0002_admin_review_publish.sql` 仍为 `1d373f90cf881a58a15966ffe12ed01c3a651380d5f4f5aa9de468d79a798263`，未漂移。

## 3. 限定复审方法

- 完整回读 `TASK-20260812-7B47E0`、`TASK-20260812-739DF6`、开发 successor 报告、新 migration 源码和新增聚焦负例源码。
- 独立复算新两 SHA、其余核心 SHA 与未改 `0002` SHA。
- 只针对 `52616C/P1-01` 反向推演：缺对象、多对象、SQL 漂移、temp 遮蔽、ATTACH、v1 apply 后与现成 v2 重开时机。
- 只读开发部已持久化的唯一 Vitest/typecheck/diff-check 收据与相应测试源；没有重跑任何一项。
- 严格保持被审文件修改 `0`、测试 `0`、typecheck `0`、网络/SSH `0`、数据库写入 `0`。

## 4. P1-01 逐项裁定

| 闭合要求 | 结论 | 静态证据 |
| --- | --- | --- |
| 完整持久 schema 对象集 | PASS | `buildReviewRealSchemaManifest` 查询 main schema 的全部非 `sqlite_*` 对象，且只接受 `table/index/trigger/view`；任一异常类型、非文本名或 NULL SQL 失败关闭。 |
| 闭合 canonical 字段 | PASS | 每项仅 `type/name/tbl_name/sql`，不做会掩盖 DDL 漂移的空白重写；整个数组用现有 `canonicalJson`。 |
| 确定性顺序 | PASS | 使用显式 Unicode code point 比较，依次比较 `type/name/tbl_name/sql`，不依赖 locale 或 SQLite 返回顺序。 |
| 冻结指纹 | PASS | canonical manifest SHA 必须精确等于 `46a71403…f638e`；缺失/额外/改写任一业务对象都改变 root。 |
| temp 遮蔽 | PASS | 在 final hash 前单独查询 `temp.sqlite_schema`；出现任一非内部对象立即 `ADMIN_INTERNAL_FAILURE`。 |
| ATTACH/混合 profile | PASS | `PRAGMA database_list` 仍只允许 `main/temp`，其他 schema 名立即失败。 |
| v1 apply 后验证 | PASS | 精确 migration SQL SHA 先验，v1 在 immediate transaction 提交后无条件调用 `assertReviewRealSchema`。 |
| 现成 v2 重开验证 | PASS | v2 分支不修补，同样无条件调用 `assertReviewRealSchema`；测试源码先证明合法 v2 重开，再删 trigger 并重开验证拒绝。 |
| 缺关键 trigger 直接反例 | CLOSED | 测试删除 `publication_no_delete`；下次打开在 `repositoryConstructed=true` 之前抛 `ADMIN_INTERNAL_FAILURE`。 |

未找到一条可在保持冻结 SHA 的前提下，删除关键 trigger/index/table/column、加入额外业务对象或改写对象 SQL，却仍让 final-schema SHA 匹配的直接路径。

## 5. 已有动态收据的只读核对

开发 successor 报告以同一新 migration/test SHA 记录：

- 固定 Node24 唯一聚焦 Vitest：`1 file / 1 test PASS`；
- 固定 Node24 唯一 typecheck：exit `0`，无输出；
- 唯一 candidate `git diff --check --`：exit `0`。

本安全复审只阅读该持久化收据和测试源码，没有重跑。这些收据支持“新库/合法 v2 通过、删除关键 trigger 被拒绝、原端到端正例未回归”，但不外推为本任务禁止扩展的其他安全层 PASS。

## 6. 未验证与放行边界

- 后续本地部署打开器尚未实现；必须把 `applyReviewRealAdminMigration` 作为每个 DB handle 构造 Repository 之前的必经门，不得另建跳过指纹的 opener。这是后续部署准备的明确验收项，不是当前候选已实现的生产事实。
- `52616C` 按 fail-first 留下的 session/CSRF/fresh re-auth、route 真实适配、delivery receipt、projection 文件系统与 crash replay、public reader 全链仍为 Unknown；本任务禁止重启它们的审查。
- M1 真实 DB migration、Tailscale/passkey、Mac/iPhone、UI/CSS、公网切换、RPO/RTO 均未验证，不由本 PASS 放行。
- 指纹绑定固定 Node24 及其 SQLite 与冻结 `0001+0002`；任何 Node/SQLite/migration 更换都必须更新指纹并重走 successor，不得自动放宽。

## 7. 错题自检

- 只裁定 `52616C/P1-01`，没有借限定复审重启其他后端层的全量审查。
- 没有把 migration 文本 SHA 当作 DB 当前 schema 指纹；两者已分别验证。
- 没有为通过而忽略 temp 遮蔽、ATTACH、额外对象或 DDL SQL 漂移；它们均在同一指纹/前置门中关闭。
- 没有运行测试、typecheck、网络、SSH 或数据库，没有修改被审 migration/test 或其他 App/Spec/ADR 文件。
- 已把尚未实现的真实 opener 顺序保留为部署准备门禁，没有误报为现行生产 PASS。

TASK_STATE_OK
