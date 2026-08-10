---
type: system_adr
status: draft
date: 2026-08-09
department: 产品部
decision_id: ADR-M5-REVIEW-SYNTHETIC-001
related_task: TASK-20260809-0DEB27
input_tasks:
  - TASK-20260809-97700F
  - TASK-20260809-1C2D4B
  - TASK-20260809-535C4B
amends_if_accepted:
  - ADR-M4-KICKOFF-001
  - ADR-M4-PUBLIC-READ-001
decision_scope: M5 loopback local-dev review-synthetic SQLite profile、Admin 后端与同 profile 手动发布闭环
authorization_state: user_required
implementation_state: closed_pending_user_decision
---

# ADR-M5-REVIEW-SYNTHETIC-001：本地审核 profile successor（draft）

> 本文件是待用户确认的窄范围 successor 草案。它当前不修改任何 accepted ADR，也不授权开发写入 `app/`、`data/` 或 migration。只有 §12 获得明确“批准”，并由后继任务把本草案固化为 accepted 后，开发部才可在本文边界内实施 `review-synthetic` 本地数据库与 Admin 后端。Admin 前端视觉仍受独立预览与用户确认门禁约束。

## 1. 单一结论

产品部唯一推荐新增第三个物理隔离的本地 SQLite profile：`review-synthetic`。它只承载 synthetic 人工审核、显式手动发布和同 profile 的公开读回验；`m3-shadow` 与 `public-synthetic` 的文件、迁移、fixture、ledger、root pins、计数和 hash 全部保持冻结。

该 successor 在被用户接受后，只窄范围修订三项既有 accepted 边界：

1. `ADR-M4-KICKOFF-001` 的本地数据库 profile allowlist 从两个扩为三个，并允许 loopback local-dev Admin 后端在 `review-synthetic` 上实现。
2. `ADR-M4-PUBLIC-READ-001` 的 projection-first Repository 可在显式选择的 `review-synthetic` profile 中读取由同一 profile 手动发布成功后形成的唯一 PublishedProjection；`m3-shadow` 仍拒绝公开读，`public-synthetic` 的 12 套冻结图继续独立运行。
3. 仅为 `review-synthetic` 的跨对象原子收口补充 §7.4 明列的 companion transitions：Outbox `reconcile_wait→retryable_failed`，Publication `publishing|retryable_failed|blocked→emergency_stopped`，以及 Outbox `pending|retryable_failed→cancelled`。这些边只在精确 guard 和同一可见事务内生效；不增加状态、实体或通配 transition。

前任 accepted ADR 的技术栈、领域对象、幂等、五 fence、manual-only、no-egress、Base 单一业务真值和全部外部能力关闭条款继续有效。除上述明确列出的 profile-local transition delta 外，冻结状态机的状态与转换逐字保持。

## 2. 输入真值与状态分层

### 2.1 已确认

- 产品任务 `TASK-20260809-97700F` 已由统筹部 ACK，冻结 `/admin/reviews` 列表、详情、revision、approve、reject、显式 manual publish、operation receipt、local-dev session/Origin/CSRF、CAS 与恢复语义。
- 数据任务 `TASK-20260809-1C2D4B` 已由统筹部 ACK。现有 `m3-shadow` 要求公开图为空；现有 `public-synthetic` 要求精确 `1/12/12/12/10/12/12/12/12`，且当前 `0003_public_synthetic_profile.sql` 只容纳已批准已发布闭图。两者都不能安全承载待审核写入。
- 数据任务 `TASK-20260809-535C4B` 已由统筹部 ACK，机器映射为 `PASS / P0=0 / P1=0`。11 类 Admin DTO 的 111 个叶槽位都有唯一来源；mapping canonical SHA-256 为 `6bce7514386dfcdd6a592100c371ddc2fc2b48e19090f23ea7bb982eb600cbc4`。
- 冻结映射固定 approve 预留 Publication、manual publish 才创建 dispatch intent 的唯一时序；Public story 只在同 profile 唯一 Projection 确认成功后可读。
- 本任务没有获得第三 profile、migration、Repository、API、worker 或 Admin UI 的实施授权，也没有发生外部 I/O。

### 2.2 产品建议

- 接受一个独立 `review-synthetic` 文件和 profile-scoped migration 选择器，复用既有领域与 internal contract，不新增领域实体或第二 schema。
- 把 `review-synthetic` 人工发布通用的 `published_version_hash v1` 固定为 §6.3 的 canonical JSON SHA-256，清除 synthetic 专用 label 对人工发布的依赖；既有 `public-synthetic` hash 不追溯重算。
- 用户一次确认本地数据库和 Admin 后端实施范围；Admin 前端视觉继续单独等待可视化预览确认。

### 2.3 Unknown

- `0003_review_synthetic_workflow.sql`、review fixture、manifest、ledger 和 root pins 的最终字节与 SHA-256；它们只能由获授权的开发/数据实施任务生成并由测试、安全复验。
- SQLite migration、事务、Repository、Route Handler、mock worker、session/Origin/CSRF 与故障恢复的真实运行收据。
- `/admin/reviews` 的最终视觉和交互方向；当前没有用户确认的 Admin 可视化预览。
- 生产认证、跨网络 Admin、生产数据库、真实内容和任何外部能力。

## 3. 方案比较与唯一推荐

| 方案 | 形态 | 收益 | 风险与代价 | 结论 |
| --- | --- | --- | --- | --- |
| A. 第三物理 `review-synthetic` profile | 独立 SQLite、独立 ledger/root pins、profile-scoped 0003，同 profile 审核与公开投影 | 保持两个 accepted profile 零漂移；可直接承载现有状态与事务 | 增加一个受限本地 profile 和一条启动分支 | **唯一推荐** |
| B. 写入 `public-synthetic` | 在现有 12 套公开图中追加待审核行 | 文件数量少 | 破坏精确计数、payload/hash、0003 状态 CHECK 和已 ACK fail-closed 门禁 | 拒绝 |
| C. 新建 `review_*` 同义表或跨库拼接 | 在现有库另造审核表，或通过 ATTACH/copy 连接两库 | 表面上绕开 0003 限制 | 形成第二 schema/第二真值、跨 profile 事务与回退风险 | 拒绝 |
| D. 保持 Admin 后端关闭 | 不新增 profile，不实施审核写入 | 零新增实现风险 | M5 人工审核纵切无法开工 | 用户拒绝 A 时的回退 |

## 4. 用户批准后允许实施的范围

用户明确批准 §12 且本草案转为 accepted 后，开发部可实施：

1. 在现有 `F1_DATA_PROFILE` allowlist 中追加 `review-synthetic`，固定数据库路径为 `app/.local/f1plus1-review-synthetic.sqlite`。
2. 实现 §5 的 profile-scoped migration 选择器、独立 migration ledger、fixture profile ledger 与 root pin 校验。
3. 实现 `0003_review_synthetic_workflow.sql`、最小 synthetic review fixture、受控 seed/reset 和 profile 启动拒绝。
4. 按已 ACK 的 11 类 DTO / 111 槽位映射实现 Admin Repository、`/api/admin/reviews*`、`/api/admin/operations/{operationId}`、`/api/admin/publications/{publicId}/publish` 与本地 mock publish worker。
5. 实现 local-dev session、精确 loopback Origin、一次性 CSRF、对象级 CAS、五 fence、`manual_only`、operation receipt、AuditEvent 脱敏和固定错误语义。
6. 让现有 projection-first public Repository 在显式选择 `review-synthetic` 时读取同 profile 已确认 PublishedProjection；review 图必须完整采用 accepted v0.4 successor 字段与 hash 合同，Projection 形成前 `/stories/{publicId}` 固定 404/fail-closed。
7. 新增与该实现直接对应的本地 synthetic 合同测试、故障注入、安全探针和回退脚本。

以下仍不授权：

- `/admin/reviews` 前端页面、视觉样式和用户可见交互落地；其开工仍需独立可视化预览与用户确认。
- 修改 `public-synthetic` 或 `m3-shadow` 的数据、迁移、fixture、manifest、ledger、root pins、Repository 真值或冻结 hash。
- 真实信源、真实内容、真实 URL、Base/provider/Collector、飞书、RSS、X/Instagram/Reddit、AI、真实媒体、外部发布 registry 或任何外部 I/O。
- 自动批准、批准即发布、自动发布、批量操作、部署、付费、外发、生产认证或跨网络 Admin。
- 新领域实体、第二 DTO 真值、第二 Publication/public_id、静态 Demo fallback、跨 profile copy、ATTACH 或双写。

## 5. profile 与 migration 合同

### 5.1 三个 profile 的隔离

| Profile | SQLite 文件 | 允许能力 | 必须保持 |
| --- | --- | --- | --- |
| `m3-shadow` | `app/.local/f1plus1.sqlite` | 59 行 Source 影子验证 | 59×39、全部 disabled、`e7a831…9f17`、公开图为空 |
| `public-synthetic` | `app/.local/f1plus1-public-synthetic.sqlite` | 12 套冻结公开读闭环 | `1/12/12/12/10/12/12/12/12`、全部 hash/count/manifest 不变 |
| `review-synthetic` | `app/.local/f1plus1-review-synthetic.sqlite` | synthetic revision/review/manual publish/同 profile 公开回验 | 仅 synthetic、manual-only、no-egress、独立 ledger/root pins |

每个数据库验证器和运行进程必须显式选择且只打开一个 SQLite profile。启动期间或运行期间发现第二 SQLite handle、ATTACH、跨库查询、跨 profile copy/transaction、路径/profile 不匹配或混合 ledger 时立即失败关闭。独立 launcher 可以读取已关闭数据库的固定收据和文件摘要，但不得建立第二 SQLite 连接。

### 5.2 profile-scoped migration 选择器

`m3-shadow` 与 `public-synthetic` 继续使用当前已接受的 migration 集与 root pins，不改文件、不重写 ledger。

`review-synthetic` 的唯一有序 migration 集固定为：

```text
1. app/migrations/0001_local_foundation.sql
2. app/migrations/0002_source_fixture.sql
3. app/migrations/review-synthetic/0003_review_synthetic_workflow.sql
```

前两项复用现有 canonical 文件，不复制、不改名。第三项只属于 `review-synthetic`，不得被另外两个 profile 读取。实现必须对 `{profile_id, ordered[{relative_path, sha256}]}` 运行 `canonical-json-v1` 后计算独立 migration root SHA-256，并把该 root、逐文件 hash、顺序和 `user_version=3` 写入新数据库的 migration ledger/启动收据。未知文件、缺号、重号、符号链接越界、hash 漂移或 root 不匹配均拒绝 migrate/start。

### 5.3 profile ledger 与启动门禁

新数据库的 `fixture_profile_ledger` 必须只有一行 `profile_id=review-synthetic`，至少固定：SQLite path、active contract/mapping version、fixture set、manifest hash、图计数、migration root、profile ledger root、generator root、validator root、`synthetic_only=true`、`external_calls=0`、`writes_to_base=0`、`real_content_imported=false`、`PUBLISH_MODE=manual_only`。

启动授权前必须同时验证：

- `F1_DATA_PROFILE=review-synthetic`、固定 DB path、固定 review fixture/manifest 和 migration selector 逐字匹配；
- 新数据库 ledger/root pins 与实际文件、schema、row counts 和 synthetic 标志一致；
- `public-synthetic` manifest SHA `3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554`、fixture SHA `c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4` 及精确图计数仍匹配；
- `m3-shadow` 的 59×39、59 disabled 与权威 projection hash 仍匹配；
- runtime 保持 loopback、fixture/mock、manual-only、`REAL_FEISHU_IO=false`、`REAL_EXTERNAL_IO=false`、`REAL_FORM_SUBMIT=false`。

前三个 profile 必须分别由三个独立的 profile-scoped validator 进程验证；每个 validator 只打开自己的 SQLite，完成只读校验、checkpoint/close 后生成 closed receipt。`m3-shadow` 与 `public-synthetic` 收据至少绑定 profile ID、canonical DB path、DB 文件 SHA-256、migration ledger root、profile ledger root、fixture/manifest/graph hash、精确 row counts、冻结 artifact/task revision、验证器 SHA 和验证时间，并要求不存在未合并的 `-wal`/`-shm`。review launcher 只读取这些收据与 pinned manifest，并在不建立 SQLite handle 的情况下复核当前 DB 文件 SHA；receipt 缺失、字段/hash/root/count 不匹配、对应 DB 字节已变化或 artifact revision 过期均视为 stale 并失败关闭。review runtime 自始至终只打开 `review-synthetic`。

任一不通过时 Admin mutation、mock worker 和 review-profile public read 均不可启动；不得通过环境变量、测试模式或静态 fallback 绕过。

## 6. 数据、DTO 与 hash 合同

### 6.1 唯一机器映射

实施只认 `data/admin-review-mapping-v0.1/` 和其 manifest：

- `admin-review-mapping.json` SHA-256：`96d4f7a3db5d17d5575447ec299513ec830779e302f1d7d69665a563c40552ef`；
- mapping canonical SHA-256：`6bce7514386dfcdd6a592100c371ddc2fc2b48e19090f23ea7bb982eb600cbc4`；
- 11 类 DTO、111 个叶槽位、3 个事务阶段；
- 领域实体增加数 0，internal persisted entity 增加数 0。

`0003_review_synthetic_workflow.sql` 只把既有 Source、CapturedItem、Content、Summary、MediaCandidate、ReleaseBundle、ReviewDecision、Publication、OutboxJob、PublishedProjection 与 internal-only AuditEvent/TaskEnvelope 合同映射到独立物理 DB。TaskEnvelope 作为冻结 internal contract 随 Outbox intent 持久化，不形成新领域实体或平行业务 schema。DTO 字段只能来自 mapping 的唯一 source rule；禁止用 `payload_json`、前端 state 或临时字段补缺。

### 6.2 v0.4 同 profile 公开读闭合

`review-synthetic` 中任何可能进入 PublishedProjection 的图都必须采用 `ADR-M4-PUBLIC-READ-001` 已接受的同一 v0.4 successor 字段和 hash 合同；不创建 review 专用领域 schema：

- Content 必须含并在 content hash 中冻结 `editorial_category`、`source_time_status`、`published_at`；
- Summary 必须含并在 summary hash 中冻结 `lead_zh`、`body_zh`、`key_points_zh`；
- ReleaseBundle canonical payload 必须完整冻结 source display/byline、access snapshot、time snapshot、media presentation、Content/Summary v0.4 hash、五 fence 与既有权利/政策/schema 证据；
- public DTO、cursor、Problem、projection-first 完整性和 404/500 失败语义逐字复用 accepted v0.4，不增加 review 专用公开 DTO；
- 11 类 Admin DTO / 111 槽位仍只读取 mapping 的 presentation allowlist 子集。Revision 只允许修改已映射的 `title_zh`、`summary_zh`；`lead_zh/body_zh/key_points_zh` 及其他 v0.4 冻结字段必须从当前 Summary/Bundle 逐字保留并进入新 hash，禁止 UI 猜测、清空或默认派生。

review fixture、0003 物理列、Repository 和 validator 必须覆盖上述 v0.4 字段及重算链。任何字段或唯一来源缺失时，审核或公开读保持 fail-closed；不得从 v0.3 子集启发式补全。

### 6.3 `review-synthetic` 人工发布 `published_version_hash v1`

人工发布成功时，服务端必须从当前唯一 Publication 和其已批准链构造以下精确对象：

```json
{
  "approved_bundle_hash": "<Publication.approved_bundle_hash>",
  "approved_content_version_hash": "<Publication.approved_content_version_hash>",
  "approved_summary_version_hash": "<Publication.approved_summary_version_hash>",
  "public_id": "<Publication.public_id>",
  "publish_generation": 1,
  "release_bundle_id": "<Publication.release_bundle_id>"
}
```

该公式适用于 `review-synthetic` 中由人工审核链产生的所有 Publication，固定为：

```text
published_version_hash = lowercase-hex(
  SHA-256(UTF8(canonical-json-v1(上述六键对象)))
)
```

上例中的 `1` 只表示当前 Publication 的实际正整数 generation，不是固定常量。六个键的集合和语义固定，拒绝 unknown/missing/null；`publish_generation` 按 JSON integer 编码。不得加入 synthetic label、时间、operationId、随机数或路径，也不得改用字符串拼接。Publication 与 PublishedProjection 必须逐字复用该 64 位小写十六进制值。冻结输入变化必须产生后继 Bundle/批准链，不能覆盖旧 hash。既有 `public-synthetic` 的 12 个 synthetic-label `published_version_hash` 保持冻结，不迁移、不重算；本公式不追溯适用于该 profile。

## 7. 唯一事务时序

### 7.1 Revision 与 reject

Revision 和 reject 逐字沿用产品合同与 mapping：revision 创建新 Summary version 和 immutable ReleaseBundle；reject 创建 immutable rejected ReviewDecision，`approved_bundle_hash=null`，且 Publication、public_id、OutboxJob、TaskEnvelope、PublishedProjection 均为 0。任何 hash/fence/CAS/AuditEvent 失败整笔回滚。

### 7.2 Approve reservation

入口：`POST /api/admin/reviews/{bundleId}/approve`。

同一 `BEGIN IMMEDIATE` 事务必须：

1. 校验 current Bundle/version/hash、Summary hash、五 fence、`manual_only`、session、Origin、CSRF、operation receipt 幂等与对象级 CAS。
2. 插入 immutable approved ReviewDecision，`approved_bundle_hash=current bundle_hash`。
3. CAS Summary `ready→approved`、ReleaseBundle `ready→approved`；Content 在同一不可观察事务中完成 `review_pending→approved→publish_queued`，提交态为 `publish_queued`。
4. 对 `(release_bundle_id, approved_bundle_hash)` get-or-create 唯一 `Publication(queued)`，一次冻结 `publication_id`、`public_id`、`publish_generation`、`idempotency_key` 和 `reconcile_key`。
5. append 脱敏 AuditEvent，提交 operation receipt。

精确提交计数为 Decision=1、Publication=1、OutboxJob=0、TaskEnvelope=0、PublishedProjection=0。ApproveSuccess 返回已提交的稳定 publicId，使 Admin publish route 可寻址；公开 story 仍为 404。任一步失败整笔 rollback，不保留部分 Decision、状态或 identity。

### 7.3 显式 manual publish enqueue

入口：`POST /api/admin/publications/{publicId}/publish`，只允许用户显式确认触发。首次 dispatch 只允许 `Publication=queued` 且尚无 OutboxJob；满足既有人工重试守卫的 `Publication=retryable_failed` 必须同时存在同一 `OutboxJob=retryable_failed` 与原 TaskEnvelope，复用原 intent 并等待 fresh lease。blocked 必须先沿既有守卫回到 queued，reconcile/terminal/emergency 均无新 dispatch 出口。

同一事务重验 approved Decision、Bundle/hash/generation、五 fence、session/Origin/CSRF、manual-only 与 CAS 后：

- 首次 queued dispatch 创建唯一 `OutboxJob(pending, operation_type=publish)` 并内嵌一个 TaskEnvelope；
- retryable manual retry 不创建、不重置 pending，只复用同一 OutboxJob/TaskEnvelope/operation/key，后续以 `retryable_failed→leased` 取得 fresh lease；
- OutboxJob、TaskEnvelope 逐字复用 Publication 的 `idempotency_key` 和 `reconcile_key`；
- append 脱敏 AuditEvent；客户端 operationId 只作 internal receipt 相关号。

提交后 Publication 仍为同一条，计数为 Publication=1、OutboxJob=1、TaskEnvelope=1、Projection=0。重放或 guarded retry 返回同一 intent；key/body/hash 不一致时失败关闭。禁止生成第二 Publication、第二 publicId、第二 Outbox、第二 publish key、重置旧 Outbox 为 pending 或同步直写 Projection。

### 7.4 Completion 与 reconcile

mock worker 只有取得 fresh lease、有效 deadline/attempt、当前五 fence 且全部 identity/key/hash 逐字一致时，才可在同一事务配对推进 `Publication queued|retryable_failed→publishing` 与 `OutboxJob pending|retryable_failed→leased`。确认成功的同一可见事务必须原子完成：

- Publication `publishing|reconcile_wait→published`；
- Content `publish_queued→published`；
- OutboxJob `→succeeded`；
- 插入唯一 PublishedProjection，复用 publicId、generation 与 §6.3 hash；
- append 精确一条脱敏 AuditEvent。

Publication 与 OutboxJob 的结果必须与 AuditEvent 在同一可见事务配对，固定如下：

| 结果 | Publication | OutboxJob | 约束 |
| --- | --- | --- | --- |
| confirmed success | `publishing|reconcile_wait→published` | `leased|reconcile_wait→succeeded` | 同事务写唯一 Projection；复用上方所述单条 AuditEvent，不追加第二条 |
| transient failure | `publishing→retryable_failed` | `leased→retryable_failed` | 同 identity/key；等待下一次人工确认和 fresh lease |
| outcome unknown | `publishing→reconcile_wait` | `leased→reconcile_wait` | 同 reconcile key；只查询，不盲重试 |
| confirmed not submitted | `reconcile_wait→retryable_failed` | `reconcile_wait→retryable_failed` | 本 successor 只补该 companion transition；复用原 Outbox/Envelope/key |
| permanent/attempt exhausted | `publishing→terminal_failed` | `leased→terminal_failed` | 同事务记录失败；Outbox 后续可沿既有 `terminal_failed→dead_letter` 做审计收口 |
| reconcile confirms terminal | `reconcile_wait→terminal_failed` | `reconcile_wait→dead_letter` | 同事务固定终态，无新 identity |
| emergency before lease | `queued→emergency_stopped`（既有） | 无 Outbox；或 `pending→cancelled`（新增） | global stop；禁止取得 lease |
| emergency while leased | `publishing→emergency_stopped`（新增） | `leased→cancelled`（既有） | 仅本地 mock outcome 明确且尚未形成 unknown；同事务停止 |
| emergency after transient | `retryable_failed→emergency_stopped`（新增） | `retryable_failed→cancelled`（新增） | 同 identity/key；禁止人工 retry |
| emergency while blocked | `blocked→emergency_stopped`（新增） | 无 Outbox；或 `pending→cancelled`（新增） | block/stop 证据同事务审计 |
| emergency during unknown | `reconcile_wait→emergency_stopped`（既有） | 保持 `reconcile_wait` | 不取消待对账语义；只允许同 reconcile key 查询，禁止 dispatch/Projection |

新增边的 guard 固定如下：

- Outbox `reconcile_wait→retryable_failed` 只在同 reconcile key 查询确认未提交、attempt 仍有预算、五 fence 当前且 global stop clear 时，与 Publication 既有 `reconcile_wait→retryable_failed` 同事务发生。
- Publication `publishing→emergency_stopped` 只用于 no-egress 本地 mock 在 outcome 尚未 unknown 前收到 global stop，并与 Outbox 既有 `leased→cancelled` 同事务发生。
- Publication `retryable_failed→emergency_stopped` 与 Outbox `retryable_failed→cancelled` 只在 global stop asserted、无在途调用且 identity/key 不变时同事务发生。
- Publication `blocked→emergency_stopped` 只在 global stop asserted 时发生；若同 identity 存在 pending Outbox，则配对执行新增 `pending→cancelled`，没有 Outbox 时不创建。
- Publication 既有 `queued→emergency_stopped` 在存在 pending Outbox 时配对新增 `pending→cancelled`；没有 Outbox 时保持精确 0。
- Publication 既有 `reconcile_wait→emergency_stopped` 不改变 Outbox `reconcile_wait`；后台只可用同 reconcile key 查明历史结果并写 AuditEvent，仍禁止生成 Projection、retry 或新 identity。该例外是为了保留 unknown outcome 证据，不得映射为 cancelled。

本表和 guard 只为既有状态增加上述枚举的跨对象 companion transitions，不增加状态、实体或其他出边；数据 successor validator 必须在实现前把这些 delta 机械化，测试与安全独立复验。每个结果事务精确 append 一条 AuditEvent。任何一侧写入失败时整笔 rollback，operation receipt 不得返回未定义的分裂状态。Projection 成功前公开 GET 固定 404；成功后只从同一 review profile 的 Projection 起步验证完整 v0.4 链。禁止跨到 `public-synthetic` 生成或复制投影。

## 8. Local-dev 安全合同

- Admin 和 review-profile public API 只绑定 `127.0.0.1` 或 `::1`；拒绝非 loopback、代理推导、wildcard CORS 与跨网络访问。
- session 使用 CSPRNG ≥256 bit、内存存储、进程重启失效、HttpOnly、SameSite=Strict、host-only；实现不得落盘 session secret。
- 每个 mutation 要求精确 canonical loopback Origin 与一次性 CSRF nonce；nonce 绑定 session/method/path/canonical body hash，TTL ≤10 分钟，原子消费并以常量时间比较。
- GET 不改变状态。mutation 必须同时通过 session、Origin、CSRF、expected hash/version、五 fence、manual-only、operation receipt 与对象 CAS。
- `PUBLISH_MODE=manual_only` 只允许本地 mock dispatch；自动发布器、真实 provider 和外部 registry 均不存在。`external_calls=0` 精确指所有非 loopback 出站网络、DNS、TLS、raw socket、代理、外部 subprocess/provider 调用为 0；浏览器到 app 及本机测试到 app 的 loopback HTTP 属本地交互，单独计数，不得被误记为外部能力。
- AuditEvent append-only 且脱敏，只保留 session hash、operation、固定 reason code、版本/hash 引用、五 fence、时间和结果；不得记录 cookie、CSRF、正文、真实 URL、stack、SQL 或本地路径。
- 生产环境、非 loopback、profile/pin 不匹配或安全开关缺失时，Admin route、worker 与 review-profile public read 在启动时不可用。

## 9. 实施与独立验收门槛

用户批准只开放本地实现任务，运行可用性仍须按顺序取得收据：

1. 数据/开发固定 review fixture、manifest、`0003_review_synthetic_workflow.sql`、ordered migration root 和全部 SHA；不得改冻结 data 输入。
2. 开发实现 config/profile、migration/seed/reset、Repository/API、local session/Origin/CSRF、mock worker 与同 profile projection-first read。
3. 测试部独立验证 migrate/seed 幂等、11 DTO/111 槽位、三阶段事务、重放/并发/unknown/锁/崩溃恢复、公开路由 404→200 和回退。
4. 安全部独立验证 profile/path/root pin、ATTACH/跨库拒绝、session/Origin/CSRF、日志/错误脱敏、no-egress、manual-only 与 public-synthetic 零漂移。
5. 测试与安全均达到 `P0=0 / P1=0` 后，才可把 Admin 后端记为本地可用；这不开放 Admin 前端。
6. 设计部形成 `/admin/reviews` 深浅主题、关键状态和响应式可视化预览，用户独立确认后，前端实现才可开工；实现后仍需设计/测试/安全验收。

必须机械满足：

- review profile migration/seed/start 连续两次不新增逻辑记录，root/hash/count 稳定；
- approve 精确 `1 Publication / 0 Outbox / 0 TaskEnvelope / 0 Projection`；manual enqueue 精确 `1/1/1/0`；confirmed completion 后 Projection=1；
- revision/reject/approve/publish 重放、竞争、stale、unknown、AuditEvent 失败均不产生第二 Decision、Bundle、Publication、publicId、key 或 Projection；
- 三个独立 validator 收据及 launcher digest 校验通过；review runtime 只打开 review DB；public-synthetic 精确 `1/12/12/12/10/12/12/12/12`、全部 frozen hash 与既有 feed/detail 结果零漂移；m3-shadow 59×39/e7a8 零漂移；
- `external_calls=0`、Base writes=0、provider switch=false、auto publish=0、真实内容=0、跨 profile write/copy/ATTACH=0。

## 10. 回退与拒绝出口

### 10.1 用户拒绝

若用户对 §12 回答“拒绝”，本草案保持 draft 或由后继任务收口为 rejected/superseded 记录；runtime profile allowlist 继续只有 `m3-shadow` 与 `public-synthetic`，Admin database/backend/worker 继续关闭。无需修改或回退现有两个 profile。

### 10.2 实施失败

- migration、ledger、root pin、fixture 或启动校验失败：关闭 review profile；只通过受控 fixture reset 恢复或删除 `app/.local/f1plus1-review-synthetic.sqlite`，不运行 down migration。
- hash/transaction/DTO 映射失败：整笔 rollback，关闭对应 mutation；不得添加字段、实体、payload_json fallback 或弱校验。
- publish 结果 unknown：保持同一 Publication `reconcile_wait`，公开侧 404/fail-closed；不得新建 publicId/key 或改读 `public-synthetic`。
- test/security 出现 P0/P1：保持后端不可用，修订实现或 successor；不得降低门禁。
- public-synthetic 或 m3-shadow 任一字节/hash/count 漂移：立即阻断 review profile，恢复既有冻结输入；不得以更新旧 manifest 的方式吸收漂移。

所有回退只影响 review-synthetic 的本地 synthetic 产物；不触发外部删除、Base/provider 操作、部署或用户数据处理。

## 11. 本 successor 持续关闭的能力

- 真实采集、真实 RSS/平台访问、Base/provider/Collector、真实表单、OAuth、外部 AI、媒体抓取/代理和真实原链。
- 自动审核、自动发布、外部发布、生产调度、生产存储、部署、付费、外发和跨网络 Admin。
- 未经视觉确认的 Admin 前端、批量审核/发布、correct/withdraw/stop UI 与 `/admin/sources`。
- 把 synthetic 本地数据、SQLite 或 PublishedProjection 提升为 Base 业务真值。

## 12. 唯一用户确认问题

**是否批准将 `review-synthetic` 固化为第三个物理隔离的本地 SQLite profile，并在 `external_calls=0`、loopback local-dev、`PUBLISH_MODE=manual_only`、零 `public-synthetic`/`m3-shadow` 漂移、禁止 ATTACH/跨库事务/双写/跨 profile copy 的边界内，允许开发部实施独立数据库与 profile-scoped `0003_review_synthetic_workflow.sql`、独立验证收据和 ledger/root pins、完整 v0.4 字段/hash 链、已 ACK 的 11 类 Admin DTO/111 槽位后端、session/Origin/CSRF、approve 原子预留唯一 queued Publication/publicId/key 且 Outbox/TaskEnvelope/Projection 均为 0、仅在用户显式手动发布时创建或复用同 key Outbox/TaskEnvelope并按本文枚举的 `review-synthetic` companion transitions 和配对状态事务在确认成功后生成唯一同 profile Projection，以及 `review-synthetic` 人工发布 `published_version_hash v1`；本批准不包含 Admin 前端视觉实施，也不开放真实内容、Base/provider、自动或外部发布、生产部署及任何真实外部能力？请只回答“批准”或“拒绝”。**

默认答案为“拒绝”。用户未明确回答“批准”时，第三 profile、migration、Admin 后端、mock worker 与任何新增运行能力继续关闭。
