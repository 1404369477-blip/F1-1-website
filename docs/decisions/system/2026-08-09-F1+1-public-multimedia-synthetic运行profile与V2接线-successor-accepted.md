---
type: system_adr
status: accepted
date: 2026-08-09
department: 产品部
decision_id: ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001
related_task: TASK-20260809-55302B
input_tasks:
  - TASK-20260809-33B8F5
  - TASK-20260809-B10D8D
authorization_evidence: COR-20260809T102214-960E65；最终v0.2多图设计用户确认；TASK-20260809-33B8F5已ACK
authorization_state: user_confirmed
amends: ADR-M4-PUBLIC-READ-001
supersedes_draft: ./2026-08-09-F1+1-公开多媒体数组successor实施合同-draft.md
decision_scope: 纯本地 synthetic 的第三公开运行 profile、public-read-v0.2 显式协商与正式 App 接线
---

# ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001：`public-multimedia-synthetic` 运行 profile 与 V2 接线 successor（accepted）

## 1. accepted 结论

在现有 `m3-shadow` 与 `public-synthetic` 之外，新增第三个物理隔离的本地运行 profile：`public-multimedia-synthetic`。它只承载经完整领域链发布的 0/1/4 图 synthetic 样本，并只在 loopback、`external_calls=0`、真实媒体为 0、Base 写入为 0 的边界内验证 `public-read-v0.2` 与最终多图 UI。

本决定只在以下窄范围修订 [ADR-M4-PUBLIC-READ-001](./2026-08-03-F1+1-公开读模型与API接线-v0.4-successor-accepted.md)：

1. canonical profile allowlist 增加 `public-multimedia-synthetic`；
2. 新 profile 采用独立 SQLite、独立 profile-scoped `0003`、独立 fixture/manifest/ledger/root pins；
3. 公开 API 增加默认 V1、精确 `Accept` 才启用 V2 的显式协商；
4. 最终公开 App 在该 profile 下只消费 V2 数组，禁止前端静态补图。

前任 accepted ADR 的领域链、单一 Publication/PublishedProjection、projection-first 读取、cursor/Problem、fail-closed、安全和外部能力关闭规则继续有效。现有 `m3-shadow`、`public-synthetic`、v0.3/v0.4 文件、数据库和运行收据全部冻结，不做原地升级。

## 2. 授权与状态边界

用户已确认最终 v0.2 的多图视觉与交互，并通过 `COR-20260809T102214-960E65` 要求落实初版全部已确认功能。`TASK-20260809-33B8F5` 已由统筹 ACK，0/1/4 图 DTO、V1 首图降级、V2 显式协商、hash/rights/order 与 v0.4 零漂移机器合同均已通过。上述证据足以接受本地 synthetic 隔离运行路线，无需新增用户问题。

accepted 只表示架构与实施合同获准。当前尚未创建第三 SQLite、migration、runtime fixture、App 接线或运行收据；对应 Function ID 继续为 `P1-blocker`，直到开发、测试、安全和设计对同一候选完成验收。

## 3. 唯一 canonical profile 合同

| 属性 | accepted 值 |
| --- | --- |
| profile id | `public-multimedia-synthetic` |
| SQLite path | `app/.local/f1plus1-public-multimedia-synthetic.sqlite` |
| data contract | `public-read-v0.2` |
| fixture set | `public-multimedia-0-1-4-v0.5` |
| fixture input | `data/mvp-contract-v0.5-public-multimedia-synthetic/fixtures.multimedia-synthetic.json` |
| machine mapping | `data/mvp-contract-v0.5-public-multimedia-synthetic/public-multimedia-mapping.json` |
| runtime graph | `data/mvp-contract-v0.5-public-multimedia-synthetic/runtime-graph.public-multimedia-synthetic.json` |
| runtime manifest | `data/mvp-contract-v0.5-public-multimedia-synthetic/runtime-profile-manifest.json` |
| network | loopback only；非 loopback 出站调用精确为 0 |
| real media / Base | `real_media=0`；`writes_to_base=false` |

canonical selector 只能把一个进程映射到一个 profile、一个数据库和一组 migration：

```text
m3-shadow
  → app/.local/f1plus1.sqlite
  → existing accepted migration selector

public-synthetic
  → app/.local/f1plus1-public-synthetic.sqlite
  → 0001 + 0002 + existing 0003_public_synthetic_profile.sql

public-multimedia-synthetic
  → app/.local/f1plus1-public-multimedia-synthetic.sqlite
  → 0001 + 0002 + profiles/public-multimedia-synthetic/0003_public_multimedia_synthetic_profile.sql
```

新 profile 禁止复用旧 `0003_public_synthetic_profile.sql`，因为其 profile check、单媒体存储和 schema receipt 均属于冻结 v0.4。也禁止向全局目录追加会让旧 profile 自动运行的 `0004`。开发必须让 migration runner 按 profile 选择精确有序清单；一次运行只能看到所选清单。

## 4. migration、ledger 与 root pins

### 4.1 migration selector

新 profile 精确复用以下两个现有文件的字节：

| migration | SHA-256 |
| --- | --- |
| `app/migrations/0001_local_foundation.sql` | `9c8c083b8f3c566023e9438c254d5b1c09d87430dec08f6e6905ed84b6fb3176` |
| `app/migrations/0002_source_fixture.sql` | `12a755754744689f977ac8b8d5d4443ec63cd5612aaff50eb920badf1ebfb031` |

新增文件固定为：

```text
app/migrations/profiles/public-multimedia-synthetic/0003_public_multimedia_synthetic_profile.sql
```

该文件只为现有领域表补足 `media_presentations` immutable snapshot 的可存储形态，并把 `fixture_profile_ledger.profile_id` 限定为 `public-multimedia-synthetic`。同一 ledger 还必须增加 `migration_selector_root_sha256 TEXT NOT NULL CHECK(length(...)=64)`、`schema_fingerprint_sha256 TEXT NOT NULL CHECK(length(...)=64)`、`real_media INTEGER NOT NULL CHECK(real_media=0)` 三列，禁止另建 root 真值表。新 profile 的 `public_media_candidate.content_id` 必须从旧 0003 的单行 `UNIQUE` 改为一对多普通 FK；`media_candidate_id` 继续是全表唯一主键，`(content_id, media_candidate_id)` 建唯一索引用于稳定 join。同一 Content 的有效 candidate 基数由 scoped 0003 的写前 trigger 与 seed/Repository validator 共同限制为 0–4：第 1–4 行可写，第 5 行必须在事务内拒绝。只调整现有 MediaCandidate 物理基数，不新增 Gallery、PublicStory、平行媒体表、第二 Publication 或第二 PublishedProjection。新文件落盘后，开发必须生成并固定：

```text
migration_selector_root = SHA-256(
  canonical-json-v1([
    {path, sha256} for exact 0001, 0002, scoped 0003 in order
  ])
)
```

selector root、SQLite `user_version=3`、三条 migration ledger 的 path/hash/order 和 schema fingerprint 必须逐字一致；任一失配写前拒绝。现有 `migration_ledger` 不加第二张 ledger：`migration_id` 依次固定为 `0001_local_foundation.sql`、`0002_source_fixture.sql`、`profiles/public-multimedia-synthetic/0003_public_multimedia_synthetic_profile.sql`，`migration_sha256` 等于各自文件字节 SHA，`append_only=1`，`sqlite_version` 为运行时受支持版本，`applied_at` 只校验 RFC3339 且不进入 selector root。顺序只取上述 selector 数组位置，不由目录扫描或时间推导。

### 4.2 profile ledger

新数据库精确只有一条 `fixture_profile_ledger`，至少固定：

- `profile_id=public-multimedia-synthetic`；
- `sqlite_path=app/.local/f1plus1-public-multimedia-synthetic.sqlite`；
- `contract_version=public-read-v0.2`；
- `fixture_set=public-multimedia-0-1-4-v0.5`；
- runtime graph manifest SHA、fixture graph SHA、schema/mapping SHA、migration selector root；
- 各领域表精确 row count；
- `synthetic_only=true`、`external_calls=0`、`writes_to_base=false`、`real_content_imported=false`、`real_media=0`。

root 公式固定为：

```text
runtime_graph_file_sha256 = SHA-256(runtime graph 文件字节)
runtime_graph_canonical_sha256 = SHA-256(UTF8(canonical-json-v1(runtime graph 解析值)))
runtime_manifest_root_sha256 = SHA-256(UTF8(canonical-json-v1(
  runtime-profile-manifest.json 中除 runtime_manifest_root_sha256 外的完整对象
)))
profile_ledger_root_sha256 = SHA-256(UTF8(canonical-json-v1({
  profile_id, sqlite_path, contract_version, fixture_set,
  fixture_manifest_hash, fixture_graph_hash, row_counts,
  manifest_root_sha256, generator_root_sha256, validator_root_sha256,
  migration_selector_root_sha256, schema_fingerprint_sha256,
  synthetic_only, external_calls, writes_to_base,
  real_content_imported, real_media
})))
```

其中 `fixture_manifest_hash` 是最终 `runtime-profile-manifest.json` 文件字节 SHA，`fixture_graph_hash` 是 runtime graph canonical SHA，`manifest_root_sha256=runtime_manifest_root_sha256`，`generator_root_sha256` 与 `validator_root_sha256` 分别是 `generate_runtime_graph.py`、`validate_runtime_graph.py` 的文件字节 SHA；执行 receipt 只写入 manifest 的独立 receipt 字段，不冒充文件 root。`row_counts_json` 必须逐字等于 `canonical-json-v1(row_counts)`；`recorded_at` 不进入 root。runtime manifest 只列原五个 ACK artifact，以及 graph/generator/validator 三个新文件的 file SHA，不列自身 file SHA；manifest 自身只由 ledger 的 `fixture_manifest_hash` 外部绑定。manifest 还必须列 canonical graph root、精确实体 counts、上述 frozen input hashes 和 generator/validator receipts；同一路径、字段与 scope 不得由实现另命名。

当前 33B8F5 fixture 只冻结多媒体相关的 ReleaseBundle/Decision/Publication/Projection/MediaCandidate 片段和 DTO 预期，没有给出可直接 seed 的 Source/CapturedItem/Content/Summary 完整行。开发不得猜测缺失字段或借旧数据库补齐。`DATA-MM-01` 必须先在同一 v0.5 数据目录追加 `runtime-graph.public-multimedia-synthetic.json`、`runtime-profile-manifest.json`、`generate_runtime_graph.py`、`validate_runtime_graph.py`，固定完整闭图、精确 counts/root 和连续两次确定性 validator 收据；现有五个 ACK artifact 保持逐字不变，只复用既有实体和 schema，不增加第二套字段。

### 4.3 已冻结输入

新实现不得改变以下收据：

- M3 59×39、59 disabled、sorted projection hash `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`；
- v0.4 manifest SHA `3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554`、fixture SHA `c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4`；
- `public-synthetic` ledger root `1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1`、graph root `4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526`、12 条 published projections；
- v0.5 schema/mapping/fixture artifact SHA 分别为 `ade4feda490a8bc2fd68817d8f48ac0994cdf81dd4703e3317003d04705451de`、`3c05b244c0087d9aea35f63f80c38329b0e7205f78a04e7afcb097a1ef04ae7a`、`ee52a70cda9eea32600a443ad5411cd76d2b4cf3d8894d9b46396c28252823c0`。

旧 profile 零漂移由各自独立只读 validator 产生 closed receipt。validator 必须先完成 checkpoint、关闭全部连接并确认对应 `-wal`/`-shm` 不存在，再固定 `{profileId,dbRelativePath,closedDbSha256,schemaFingerprint,ledgerRoot,rowCounts,artifactRevision,validatorArtifactSha256,validatedAt}`；v0.4 data 收据固定 manifest/artifact SHA 与同一 artifact revision。新 runtime launcher 不打开旧 SQLite，只按安全相对路径读取旧 DB 字节并复核当前 SHA-256、WAL/SHM 缺失、receipt 的 validator hash/revision/时效和 manifest pins。receipt 缺失或陈旧、DB 字节变化、WAL/SHM 存在、hash/count/revision 不匹配时新 profile fail closed。运行进程禁止第二 SQLite handle、`ATTACH`、跨 profile query、文件复制、导入旧 DB 或从新库反写旧库。

## 5. 原子建库、seed、启动与读取

顺序固定如下：

1. 独立 validator 在无运行进程时验证 M3、v0.4 data 和 `public-synthetic` DB 的冻结收据；不修改任何旧文件。
2. 校验 33B8F5 五个 artifact SHA，以及 `DATA-MM-01` 的完整 runtime graph/manifest/root；缺任一项立即停止。
3. 在受控临时路径创建全新 SQLite，只运行新 profile 的精确 0001/0002/scoped-0003 清单。
4. 一个 `BEGIN IMMEDIATE` 事务写入完整 0/1/4 图领域闭图和唯一 ledger；任一约束、hash、rights、order、count 或故障注入失败时整笔回滚。
5. 关闭写连接，重新只读打开，复算 schema fingerprint、migration ledger、profile ledger、全部 FK/hash/count、0/1/4 DTO 和 V1 首图降级。
6. 只有全绿时才原子 rename 为 canonical path；目标已存在时禁止覆盖，须先由受控 reset 命令验证目标属于同 profile，再移动至可恢复备份。
7. 启动进程只打开 canonical 新库，先完成 ready gate，再接受 loopback HTTP；ready 前 API 不监听。
8. Repository 每次读取从唯一 PublishedProjection 反查 Publication→Decision→Bundle→Content/Summary/MediaCandidate，整条验证后一次性发出；禁止部分 gallery。

重复 migrate/seed/start 必须得到相同 roots/counts，并且不新增任何领域行。所有失败均使用固定 reasonCode 和脱敏收据；不得输出内部路径、SQL、hash 输入、权利证据或 stack。

迁移/seed 验收必须额外证明同一 Content 可落 4 个不同 `media_candidate_id`，第 5 个 insert 由 scoped trigger 拒绝且事务零部分写；只做 Repository 层截断不能通过。

## 6. V1/V2 API 协商

既有 feed/detail 路由和 query/cursor 语义不变。版本选择对 feed、detail 与同一 detail 的 relatedItems 共用一份结果：

| 请求 `Accept` | 响应 |
| --- | --- |
| 缺失、`*/*` 或 `application/json` | `public-read-v0.1`，0 图为 null，1–4 图只返回稳定首图 |
| 去除首尾 OWS 后精确等于 `application/vnd.f1plus1.public-read-v0.2+json` | `public-read-v0.2`，返回 `media[0..4]` |
| 其余全部值，包括其他 vendor type、任意多值、参数化 V2、`text/plain`、非法或未知 media type | HTTP 406 / `PUBLIC_MEDIA_VERSION_UNSUPPORTED` |

成功响应继续使用既有 `application/json; charset=utf-8` 与 `Cache-Control: no-store`；`schemaVersion` 是 payload 版本真值。任一完整性错误返回 HTTP 500 / `PUBLIC_READ_INTEGRITY_FAILED`，整条 feed/detail 失败，不返回部分 item、206 或静态 fallback。

V2 元素字段只认 33B8F5：

```text
kind, mediaId, assetRef, mediaHash, altZh, captionZh, creditDisplay, tone
```

数组顺序只认 `ReleaseBundle.media_refs[]`；`media[0]` 为稳定主图。state 优先级固定为 `source_restricted → restricted`；否则 0 图为 `media_missing`；否则完整有效的 1–4 图为 `available`。图片不得提升 restricted。

## 7. App 正式单一数据源

新 profile 下的最终 App 必须：

- feed、detail 和 related 请求都发送精确 V2 Accept；
- 对 V2 响应使用 closed client schema，未知字段、版本、第五图、重复 mediaId 或空 alt 整条拒绝；
- `images[]` 与 DTO `media[]` 一一映射，不复制首图、不静态补图、不用组件默认值生成 alt/credit/tone/hash/order；
- 0 图保持正文可读且无缩略图；1 图不显示无意义导航；4 图让 thumbnail、pointer/touch/trackpad 单步切图和 lightbox 真正可达；
- 406/500/网络失败进入既有公开错误/恢复出口；禁止自动改发 V1 后再构造四图；
- 源码与运行产物不包含 `DEMO_STORIES`、媒体静态数组、请求拦截或第二媒体真值。

冻结 `public-synthetic` 继续使用原 App/profile 的 V1-only 路线。新 profile 的一个进程可用上述闭合选择器支持 V1/V2，但每个请求及其完整响应只能选择一个 payload version；一个进程仍只绑定一个 build candidate、一个 SQLite，不能在运行时切换 profile 或“双读比对”。

## 8. 分阶段实施与验收

| 阶段 | Function / Task ID | Owner | 实施出口 | 独立验收 |
| ---: | --- | --- | --- | --- |
| 1 | `DATA-MM-01` | 数据部 | 在 v0.5 目录追加固定命名的 runtime graph/manifest/generator/validator，覆盖完整 Source→Projection、counts/root；不改现有五个 ACK artifact | 连续两次干净生成与 validator 同 receipt；旧根零漂移 |
| 2 | `DEV-MM-01` | 开发部 | profile allowlist、独立 path、精确 selector、scoped 0003、schema receipt | 测试/安全检查只选三条 migration、旧 0003/DB 零修改 |
| 3 | `DEV-MM-02` | 开发部 | 原子 seed、ledger/root pins、受控 reset/start/health | 0/1/4 闭图、幂等、故障全回滚、只开一个 DB |
| 4 | `DEV-MM-03` | 开发部 | types/Repository/feed/detail/related 的默认 V1与精确 V2 | API 0/1/4、首图降级、406/500、单响应不混版 |
| 5 | `DEV-MM-04` | 开发部 | 最终 App V2 单一数据源与四图交互；同时修复 lightbox 焦点 | 浏览器 thumbnail/键盘/三类手势/lightbox/焦点真实可达 |
| 6 | `SEC-MM-01` | 安全部 | profile/path/ATTACH/no-egress/DTO/log/CSP/回退审计 | P0=0/P1=0；非 loopback 出站=0；旧根零漂移 |
| 7 | `TEST-MM-01` | 测试部 | build/API/browser/故障/回退全矩阵 | P0=0/P1=0；Function ID `MEDIA-DATA-002`、`MEDIA-NAV-003`、`MEDIA-LIGHTBOX-004`、`RECOVER-MEDIA-003` 全有正式收据 |
| 8 | `DESIGN-MM-01` | 设计部 | 对固定 v0.2 HTML/hash做 0/1/4 图、焦点、手势与响应式差异审查 | mandatory 差异=0；只读，不把 Demo 数据设施带入 App |

任一阶段 P0/P1 未清零则停止后续阶段；accepted ADR 不能替代实现或独立复验。

## 9. 失败与回退

- 完整 runtime graph 缺失：停在 `DATA-MM-01`，禁止开发猜字段、从旧 DB 查询补齐或写第二 schema。
- migration selector、profile/path/ledger/root 任一失配：ready=false，关闭 SQLite/HTTP，不落 seed。
- seed 中途失败：事务全回滚，删除仅属于本次临时路径的候选；旧数据库不动。
- V2 完整性或协商失败：返回固定 406/500；不降级部分 item、不混版、不静态补图。
- UI/浏览器/安全复验失败：停止新 profile App 候选，保留脱敏收据，回到可机械证明的 v0.4 App + `public-synthetic` 匹配组合。
- 回退只切换完整 app/config/database 组合，不执行 down migration、不覆盖新旧 DB、不清理旧 profile 数据。
- 无法证明旧基线或新候选归属时，公开链 fail closed；禁止恢复到静态 Demo。

## 10. 持续关闭

本决定不授权或开启真实媒体、HTTP(S) asset、媒体下载/代理/缓存、自托管、真实原链、Base/provider/Collector、Admin、RSS、真实平台请求、自动发布、外部发布、部署、付费、生产认证或跨网络访问。它也不修改 review-synthetic draft、VS-RSS-0 draft、accepted A→D 路线或任何现有 data/app/design 文件。

## 11. 当前验收出口

- 决策状态：`accepted`，canonical id=`ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001`。
- 机器数据前置：33B8F5 的 DTO/delta 合同已 PASS；完整可 seed runtime graph 仍由 `DATA-MM-01` 关闭。
- 实现状态：第三 profile、SQLite、migration、API、App 与浏览器收据均未创建，相关 Function ID 保持 `P1-blocker`。
- 真实外部能力：全部关闭。
