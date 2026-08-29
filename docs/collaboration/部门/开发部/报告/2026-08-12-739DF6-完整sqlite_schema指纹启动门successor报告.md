---
type: implementation_report
department: 开发部
status: final
date: 2026-08-12
related_task: TASK-20260812-739DF6
decision: pass
tags: [rss-real, admin-review, sqlite-schema, fingerprint, fail-closed]
summary: 仅修改 migration 启动门与原聚焦测试，冻结完整最终业务 sqlite_schema 指纹；新库、合法现成 v2 库通过，删除关键 trigger 的 v2 库在 Repository 构造前失败关闭。三项限定验证各一次通过，52616C 唯一 P1 已闭合。
---

# TASK-20260812-739DF6 完整 sqlite_schema 指纹启动门 successor 报告

## 1. 结果

`TASK-20260812-52616C` 指出的唯一 P1 已按最小 successor 闭合：后台数据库启动门现在同时验证固定 `0002` 文本 SHA、完整最终业务 `sqlite_schema` SHA、`user_version`、PRAGMA、附加库、外键与完整性。缺表、缺列、缺索引、缺 trigger、额外持久业务对象或持久对象 SQL 漂移都会在 Repository 构造和业务写入之前失败关闭。

本任务只修改以下两份既有候选文件并新增本报告：

- `app/src/server/review-real/migration.ts`
- `app/src/tests/review-real-backend.test.ts`
- `docs/collaboration/部门/开发部/报告/2026-08-12-739DF6-完整sqlite_schema指纹启动门successor报告.md`

未修改 Repository、Backend、Routes、Security、Schema、Mapping、Projection、`0002` migration、产品合同、ADR、UI 或部署配置。

## 2. 指纹设计与冻结身份

### 2.1 唯一 canonical manifest

启动门从 `main.sqlite_schema` 读取全部非 `sqlite_*` 内部对象，不使用“七个表名包含”之类的弱检查。每项只保留闭合字段：

```text
type, name, tbl_name, sql
```

- 对象类型覆盖 SQLite 持久业务 schema 的 `table/index/trigger/view`；自动索引与 `sqlite_sequence` 等 SQLite 内部对象按保留前缀排除。
- 任一对象字段类型异常或 SQL 为 `NULL` 时直接返回 `ADMIN_INTERNAL_FAILURE`。
- manifest 按 `type → name → tbl_name → sql` 的 Unicode code point 顺序排列。
- 数组和对象使用项目既有 `canonicalJson` 进行无歧义编码；`sqlite_schema.sql` 保留原字节语义，不做会掩盖 DDL 漂移的空白改写。
- canonical JSON 以 UTF-8 计算 SHA-256 并与代码常量逐字比较。
- 额外拒绝非内部 `temp.sqlite_schema` 对象，避免临时对象遮蔽同名主表；仍保留原“只允许 main/temp、禁止 ATTACH”边界。

使用项目固定 Node `v24.18.0` 的 `node:sqlite`，对冻结 `0001` 后精确应用冻结 `0002`，单次生成结果如下：

| 项目 | 冻结值 |
| --- | --- |
| 总对象数 | `42` |
| table | `10` |
| index | `7` |
| trigger | `25` |
| view | `0` |
| final schema SHA-256 | `46a714035b59e1d608065922593895cd72c0748ac5ddbef660ae16e99e7f638e` |

### 2.2 执行时机

- `user_version=1`：在 `BEGIN IMMEDIATE` 内应用精确 SHA 命中的 `0002`；提交后立即运行完整 schema 指纹和既有完整性检查。
- `user_version=2`：不重放或修补 migration；每次启动直接运行同一完整 schema 指纹和既有完整性检查。
- 其他版本、migration 文本 SHA 漂移、schema 指纹漂移或任一既有安全门失败：统一返回 closed `ADMIN_INTERNAL_FAILURE`，不自动修复、不构造 Repository、不执行业务写。

## 3. 聚焦证据

原一条审核到公开投影的端到端正例完整保留；只在同一个 `it` 中增加一个高价值 schema 启动门探针：

1. 在权限收敛的临时目录创建文件库，执行 `0001` 后由启动门完成 v1→v2，证明新库命中冻结指纹。
2. 关闭并重新打开同一合法 v2 文件库，再次调用启动门，证明现成 v2 库命中冻结指纹。
3. 删除关键不可变 trigger `publication_no_delete`，关闭并再次打开。
4. 启动门返回 `ADMIN_INTERNAL_FAILURE`，`repositoryConstructed` 保持 `false`；随后原 approve/private、fresh-auth publish、签名全量 snapshot、公开读取、reject 与 stale CAS 正例继续通过。

该负例直接对应 `52616C` 的利用前提，未为每种等价 schema 漂移堆叠重复动态用例。完整 manifest 的闭合输入使缺列、缺索引、额外业务对象和 SQL 改写产生不同 canonical SHA。

## 4. 限定验证收据

严格遵守 successor 的一次预算，首错策略未触发：

| 验证 | 次数 | 命令/环境 | 结果 |
| --- | ---: | --- | --- |
| 聚焦 Vitest | `1/1` | 固定 Node24 PATH；`vitest run src/tests/review-real-backend.test.ts --config vitest.config.ts` | PASS；`1 file / 1 test`，测试 `58ms`，总计 `215ms` |
| Node24 typecheck | `1/1` | `.local/toolchains/node-v24.18.0-darwin-arm64/bin/node node_modules/typescript/bin/tsc --noEmit` | PASS；exit `0`，无输出 |
| candidate diff-check | `1/1` | `git diff --check --` | PASS；exit `0`，无输出 |

固定 schema SHA 的单次生成属于常量构建步骤，只使用内存 schema，无网络、无业务数据、无真实数据库；没有将其当作额外验收测试或重复运行。

## 5. SHA-256 收口

### 5.1 本 successor 变更

| 文件 | 最终 SHA-256 |
| --- | --- |
| `app/src/server/review-real/migration.ts` | `b752d7f115d50bc9af4077b537e0fb4e9ea9ba5deac8195a91b1a2bc6c7a0f39` |
| `app/src/tests/review-real-backend.test.ts` | `6387db1d5b77b93eddd188e8ceeec50c02d1e9a6fbb139c6e9d4125a6d4a6fa5` |

### 5.2 九项保持不变的冻结身份

| 文件 | SHA-256 | 结果 |
| --- | --- | --- |
| `app/src/server/review-real/error.ts` | `4cbf9f8df661ac99d306029874caf1e1d02e33a3f4e4b97ce484bb62b78a0ba4` | unchanged |
| `app/src/server/review-real/security.ts` | `1a2741d5bb688f5abb28209bae2614c2c7666d1ecba582973c29a19c29b2c458` | unchanged |
| `app/src/server/review-real/schema.ts` | `2c00bfc6916f4fded2d8e09f96193c428c157c0797c10081e749aba7620b2fde` | unchanged |
| `app/src/server/review-real/mapping.ts` | `139f05fdbd2b45e5b5a8d4c95b58b864b8e7a48d99c796a00a489e74a4f3730e` | unchanged |
| `app/src/server/review-real/repository.ts` | `ad35534a3ae192796a5b7a1a199c306d71520dcd338ff4140f92b4593ef6ad6f` | unchanged |
| `app/src/server/review-real/backend.ts` | `a8349c5ada79268ba38155a4352b4f46cdee9ca1cfd409dae7f01813e7e0ea27` | unchanged |
| `app/src/server/review-real/routes.ts` | `cf022cb0dd9ceb37f5a6deebb662862e5a67700fbb9f963891388e1eaa8ad500` | unchanged |
| `app/src/server/review-real/projection.ts` | `46f868cf5d1caea9347030f2588d34f4334799c935d31e5d387f059cfe8cfb05` | unchanged |
| `app/migrations/rss-real/0002_admin_review_publish.sql` | `1d373f90cf881a58a15966ffe12ed01c3a651380d5f4f5aa9de468d79a798263` | unchanged |

## 6. 证据边界与未验证项

- 本任务对正式 M1、真实 RSS 数据库、真实运营数据、Tailscale、passkey/WebAuthn 外部验证器、Mac/iPhone 管理端、Admin UI、公网隔离实施和部署切换均执行 `0` 次；这些仍由后续任务验证。
- 动态证据只写临时文件库和内存库，并由测试结束清理；没有写生产/真实 DB，没有网络或 SSH 请求，也没有将测试候选写入运行时 profile。
- 本任务只关闭 `52616C` 的 schema 身份门 P1；不把聚焦正例外推为尚未实施的路由挂载、sender/receipt 回写或部署放行。
- SQLite schema SHA 与固定 Node24/其内置 SQLite、冻结 `0001+0002` 构成同一发布身份；升级 Node/SQLite 或改 migration 时必须显式生成新冻结身份并走 migration successor，不能静默放宽比较。

## 7. 错题自检

- 已区分“传入的 migration 文本正确”与“数据库当前 schema 正确”，两者现在分别验证。
- manifest 覆盖所有持久业务对象类型并拒绝额外对象，没有退回表名 allowlist 或运行时自动补 trigger。
- 删除 trigger 的反例在 Repository 构造标记之前失败，正例没有因负例而缩减。
- 九项非任务文件 SHA 均逐字复算并保持冻结值；未触碰脏工作树中的其他用户/部门产物。
- 三项验收各一次，无失败、无重跑；常量生成只执行一次。

TASK_STATE_OK
