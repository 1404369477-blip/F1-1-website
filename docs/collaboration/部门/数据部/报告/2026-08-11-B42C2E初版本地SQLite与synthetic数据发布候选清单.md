# 初版本地 SQLite 与 synthetic 数据发布候选清单

- 任务：`TASK-20260811-B42C2E`
- 部门：数据部
- 日期：2026-08-11
- 数据事实结论：`PASS`
- 发布就绪结论：`BLOCKED_PENDING_AUTHORITATIVE_FRESH_RECEIPT_CLOSURE`
- 机器清单：[TASK-20260811-B42C2E-local-synthetic-release-candidate.json](./TASK-20260811-B42C2E-local-synthetic-release-candidate.json)

## 1. 结论

本任务完成四个本地 profile 的唯一数据候选清单。当前唯一公开页数据候选配置为 `F1_DATA_PROFILE=public-multimedia-synthetic`，对应 `app/.local/f1plus1-public-multimedia-synthetic.sqlite`：24 条、每页 12 条、四类各 6 条、0/1/4 媒体各 8 条，对应 `/` 与 `/stories/{publicId}` 所需的数据出口。

`source-management-synthetic` 已提供 59 条只读 M3 baseline 加 1 条 local synthetic Source 的原始后端数据，并具有 command receipt、outbox、audit 等本地事实；项目中没有 `app/src/app/admin/sources/page.tsx`，所以当前不能声称 SOURCE-MGMT 用户页面可达。尚缺页面实现以及页面候选的测试、安全、设计核收。

数据清单本身已闭合。发布 freshness 仍受 `TASK-20260811-5F3B7D` 阻断：该任务状态为 blocked，首错 `CLI_INTERNAL_ERROR`。本轮又观察到三份 legacy receipt 当前 SHA 已不同于 5F3B7D 报告记录的旧 SHA；没有 acknowledged 的刷新任务证据可把该变化裁定为 freshness PASS。因此本报告没有把已知 stale 状态固化成最终可发布结论。

## 2. 取证边界与零漂移

本任务执行的命令没有打开四个 canonical SQLite 文件。取证只对 `/private/tmp` 下任务专属 0700 目录中的 0600 副本执行，连接参数为 `mode=ro&immutable=1`，并设置 `PRAGMA query_only=ON`。完成后副本与任务目录均已清理，任务名前缀残留计数为 0；没有生成 WAL、SHM 或 journal，外部调用为 0。本任务没有执行 OS 级全局 handle 审计，因此此处是命令协议与执行观察结论。

零漂移保护范围为四个 SQLite 文件，以及 v0.6 multimedia runtime graph 与 manifest；六项前后 SHA 全部一致。Legacy receipt 因本任务执行期间观察到外部字节变化而明确排除在零漂移结论之外，其来源继续由 freshness 门禁裁定。

| Profile | Canonical DB | 前后 SHA-256 | 角色 |
| --- | --- | --- | --- |
| `m3-shadow` | `app/.local/f1plus1.sqlite` | `df82598c…19c0` | 59×39 冻结影子基线；非公开 feed、非 Base 真值 |
| `public-synthetic` | `app/.local/f1plus1-public-synthetic.sqlite` | `24536392…041` | 12 条历史 synthetic 公开 profile；非当前唯一候选 |
| `public-multimedia-synthetic` | `app/.local/f1plus1-public-multimedia-synthetic.sqlite` | `eb2d7ad2…9551` | 当前唯一公开页数据候选 |
| `source-management-synthetic` | `app/.local/f1plus1-source-management-synthetic.sqlite` | `ddf3778c…e939` | SOURCE-MGMT raw synthetic 后端；非公开 feed |

第一次隔离查询在 disposable 副本上因误设 `migration_ledger.version` 列而失败，精确错误为 `sqlite3.OperationalError: no such column: version`。该次没有产出事实报告；四份副本和 0700 根目录已清理。随后按统筹允许的同一最小命令重试一次，改为读取真实列结构并成功完成。此错误没有触碰 canonical DB。

## 3. Profile 冻结清单

### 3.1 `m3-shadow`

- Migration：`0001_local_foundation.sql` → `0002_source_fixture.sql` → `0003_public_synthetic_profile.sql`；ledger 3 条，`user_version=3`。
- 数据：Source 59 条，59 条均 `enabled=false`；公开领域表均为 0。
- Fixture：`m3-shadow-59-v0.3`，投影根 `e7a8312c…9f17`，manifest `d4da9fc2…88b2`。
- Logical content root：`f6ae0064…2549`。该值来自当前 receipt 字节；freshness 及刷新来源未获 5F3B7D 核收。
- Schema fingerprint：`ad2f86e0…23b`，来自同一未核收 legacy receipt，仅作 observed pin。
- `external_calls=0`、`writes_to_base=0`。

### 3.2 `public-synthetic`

- Migration：与 M3 同一三段链；ledger 3 条，`user_version=3`。
- 数据：Source 1；CapturedItem/Content/Summary/ReleaseBundle/ReviewDecision/Publication/Projection 各 12；MediaCandidate 10。
- Fixture：`public-demo-12-v0.4`，graph `4be9f7e…a526`，manifest `3b296868…e554`，profile ledger root `1f771949…af1`。
- Logical content root：`6be7af63…a3a`。该值同样不代表 freshness 已被 5F3B7D 核收。
- Schema fingerprint：`ad2f86e0…23b`，authority 同样受 freshness 门禁约束。
- 该 profile 保留为历史兼容数据事实，不承担 24 条、两页和 0/1/4 媒体发布门禁。其 fixture 顺序 Page 1 为 12 条、Page 2 为空；四类各 3；0 图 2、1 图 10、4 图 0。

### 3.3 `public-multimedia-synthetic`

- Migration：`0001_local_foundation.sql` → `0002_source_fixture.sql` → profile 专属 `0003_public_multimedia_synthetic_profile.sql`；ledger 3 条，`user_version=3`。
- 数据：Source 1；其余七个公开领域主表各 24；MediaCandidate 40；DomainEvent/Outbox 均为 0。
- 分类：`race_news`、`driver_social`、`legends_history`、`paddock_fun` 各 6。
- 媒体：0 图 8 条、1 图 8 条、4 图 8 条，共 40 个媒体候选。
- Fixture：`public-multimedia-pagination-24-v0.6`；runtime graph file SHA `1eddfe54…08b`，canonical graph root `52775a13…a532`；manifest file SHA `38d51764…6eb`，manifest root `0a0374e8…00b`；profile ledger root `dd33f389…d4ec`。
- 根语义：content logical root 为 runtime graph canonical root `52775a13…a532`；profile ledger root 为 `dd33f389…d4ec`；DB file SHA 为 `eb2d7ad2…9551`。三者不互换。当前没有该 profile 的 closed DB logical-content-root receipt，本报告没有创建替代真值。

排序固定为 `publication.published_at DESC, projection.public_id DESC`。两页精确 ID 为：

| 页 | 12 条 `publicId` | `hasMore` |
| --- | --- | --- |
| Page 1 | `race-news-24`, `driver-social-23`, `paddock-fun-21`, `legends-history-22`, `race-news-20`, `driver-social-19`, `paddock-fun-17`, `legends-history-18`, `race-news-16`, `driver-social-15`, `paddock-fun-13`, `legends-history-14`（均带 `public-page2-` 前缀） | `true` |
| Page 2 | `race-news-12`, `driver-social-11`, `paddock-fun-09`, `legends-history-10`, `race-news-08`, `driver-social-07`, `paddock-fun-05`, `legends-history-06`, `race-news-04`, `driver-social-03`, `paddock-fun-01`, `legends-history-02`（均带 `public-page2-` 前缀） | `false` |

Page 1 cursor 固定为 `eyJjb250ZW50VHlwZSI6bnVsbCwicHVibGljSWQiOiJwdWJsaWMtcGFnZTItbGVnZW5kcy1oaXN0b3J5LTE0IiwicHVibGlzaGVkQXQiOiIyMDI2LTA4LTA5VDEyOjA2OjAwWiIsInNvdXJjZSI6bnVsbCwidiI6MX0`。

### 3.4 `source-management-synthetic`

- Migration：`0001_local_foundation.sql` → `0002_source_fixture.sql` → `0003_source_management_runtime.sql`；ledger 3 条，`user_version=3`。
- Baseline：59 条，59 条均 disabled，projection SHA `e7a8312c…9f17`，保持只读。
- Local synthetic：1 条，`source_id=src-local-14ae0ef1ac47d753a1994519`；`collection_status=stopped`、`lifecycle_status=retired`、`enabled=false`、version 5、config/safety epoch 5/3；effective source hash `ae982ea0…df81`。
- Runtime：lineage 1、fence 1、command receipt 5、outbox 1、inbox 0、task attempt 0、dead letter 0、audit 5。
- Effective root `7003323b…e0d3`；logical content root `7cae9bb8…e6a`。
- Schema fingerprint `f6f56bad…377d`，由已 ACK 的 `TASK-20260811-3D190C` oracle 与当前 SOURCE-MGMT closed receipt 共同指向。
- 该 profile 证明 raw backend 数据存在；它不构成 `/admin/sources` 页面或公开 profile。

## 4. 当前数据入口与页面缺口

公开页候选的唯一选择器为：

```text
F1_DATA_PROFILE=public-multimedia-synthetic
```

数据出口对应 `/api/public/feed` 和 `/api/public/stories/{publicId}`；页面消费入口对应 `/` 与 `/stories/{publicId}`。本任务没有启动服务或执行 HTTP 探针，以上为源码、Spec 与数据 profile 的静态追溯结论。

SOURCE-MGMT 当前已有 `/api/admin/sources` 相关后端路由与 `source-management-synthetic` raw 数据，但缺少 `app/src/app/admin/sources/page.tsx`。因此用户仍不能通过页面完成列表、详情、筛选或 mutation。还需后继实现页面并完成其测试、安全与设计验收；本任务不改 App。

## 5. Receipt freshness 外部门禁

`TASK-20260811-5F3B7D` 当前状态为 blocked，机器证据为 `app/evidence/TASK-20260811-5F3B7D/manifest.json`（SHA `3c105f96…213c`），报告为 `docs/collaboration/部门/开发部/报告/2026-08-11-旧profile封闭收据刷新首错阻断报告.md`（SHA `f727b993…6128`）。首错是 `CLI_INTERNAL_ERROR`，public-synthetic 调用次数为 0。

当前三份 legacy receipt 的文件 SHA 已变为：

- `m3-shadow.closed.json`: `8ddf26bd…fa42`
- `public-synthetic.closed.json`: `2a018f68…cc81`
- `public-synthetic.data.closed.json`: `23548946…021`

它们与 5F3B7D 报告记录的未刷新 SHA 不同。由于 5F3B7D 没有成功产物或 ACK，本任务只记录该事实，不推断修改来源，也不把 `validatedAt` 当作已核收 freshness。发布就绪必须等待 5F3B7D 的 accepted successor 给出权威闭环。

## 6. 已验证、未验证与错题自检

已验证：

- 四个 canonical DB 文件前后 SHA 一致；本任务命令打开 canonical SQLite handle 的次数为 0，未执行 OS 级全局 handle 审计。
- 四个隔离副本只以 immutable/read-only/query-only 打开。
- migration、ledger、表计数、baseline+local overlay 与根值均已冻结到机器 JSON。
- 当前公开候选满足 24 条、12×2 分页、四类各 6、0/1/4 图各 8。
- M3 baseline 为 59 条且全 disabled；SOURCE-MGMT 仅增加 1 条 local synthetic Source。
- 外部调用、Base 写入、真实内容导入、真实媒体使用均为 0。
- 两个任务临时根均已清理，任务名前缀残留为 0。

未验证：

- Legacy receipt freshness 与当前字节的权威来源；等待 5F3B7D 或其 accepted successor。
- 公开路由的运行时 HTTP 行为；本任务禁止启动网站。
- SOURCE-MGMT 页面行为；页面文件不存在。
- 真实 Base/provider 行为；本任务明确禁止访问。

错题自检：

- 首次隔离查询误设 `migration_ledger.version`，已记录精确错误并清理；唯一重试读取真实列结构后通过。
- 未把 current receipt 的新时间或新字节解释为 accepted freshness。
- 未混淆 multimedia graph root、profile ledger root 与 DB file hash，也未虚构 closed DB receipt。
- 本任务命令未打开 canonical SQLite、联网、启动 server、访问 Base/provider、修改 App/Spec/ADR/data 或补造数据；没有把该观察外推为全系统 handle 审计。

## 7. 任务状态

数据候选清单验收出口已完成；发布 freshness 作为外部阻断明确保留。任务完成落账后状态应为 `completed`，等待统筹 ACK。
