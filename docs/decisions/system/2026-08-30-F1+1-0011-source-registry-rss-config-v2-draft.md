---
type: system_adr
status: draft
date: 2026-08-30
department: 开发部
decision_id: ADR-F1PLUS1-0011-SOURCE-REGISTRY-RSS-CONFIG-V2
related_task: TASK-20260830-C917F4
amends: docs/decisions/system/2026-08-24-F1+1-v6到v10双语完整Admin生产successor-accepted.md
authorization_state: user_required
apply_state: blocked_until_separate_user_approval
---

# ADR-F1PLUS1-0011：`source_registry_rss_config_v2` additive 迁移草案

> 本文件是工程草案，不是 accepted ADR，也不是生产 apply 授权。`0010` 已 apply 的 SQL 与 `source_registry_rss_config_v1` 不可变 trigger 一律不得改写。用户单独批准本草案后，才允许另立任务写 `0011_*.sql` 并在 disposable 库验证；生产 apply 再要第三次确认。

## 1. 决策目标

`0010` 把四条 RSS 的 `route_identity_sha256` / `authorization_receipt_sha256` / `source_policy_sha256` 写成占位 hash，并用 `SOURCE_REGISTRY_CONFIG_IMMUTABLE` 锁死 `source_registry_rss_config_v1`。Motorsport / The Race 要进入真实采集，必须换真实 hash，但不能 UPDATE/DELETE v1 行。

本草案定义一张 **additive** 现势表 `source_registry_rss_config_v2`：v1 整表保留为不可变历史；现势指针与写路径只服务 `motorsport-f1-news` 与 `the-race-f1-news`。

## 2. 不变式

1. **不改** `app/migrations/rss-real/0010_source_registry.sql`，不 drop / disable v1 trigger。
2. v1 行继续 `UNIQUE(source_id)`、零 UPDATE、零 DELETE。
3. v2 是 append-only 修订：同一 `source_id` 可有多行，现势由 `(source_id, source_revision)` 最大且 `superseded_at IS NULL` 的一行表示。
4. Autosport / RaceFans 不得出现在 v2 写路径；其 v1 占位行保持原样。
5. `automaticReview=false`、`automaticPublish=false` 写入 policy preimage，采集不得绕过人工审核。
6. apply 本迁移不自动 `enable` 信源、不加载 LaunchAgent、不打开 v1 RSS 库。

## 3. 表设计（草案，未写 SQL）

### 3.1 `source_registry_rss_config_v2`

建议列（STRICT，时间戳一律 `YYYY-MM-DDTHH:MM:SS.mmmZ`）：

| 列 | 约束意图 |
|---|---|
| `config_id` | PK，`rss-cfg-v2-<source_id>-<revision>` |
| `source_id` | FK → `source_registry_v1.source_id`，仅允许两个 canary id |
| `source_revision` | `>=1`，对同一 source 单调递增 |
| `v1_config_id` | 指向被取代的 v1 `config_id`，作历史锚 |
| `schedule_seconds` | `=900` |
| `route_id` | 与 `route_registry.route_id` 对齐 |
| `route_identity_sha256` | 见 §4.1 |
| `route_release_sha256` / `route_manifest_sha256` | 当前 Admin/RSS release 对 |
| `rights_status` / `media_policy` | 与 v1 同 enum |
| `dedupe_strategy` | `'source_external_id_sha256_v1'` |
| `normalization_strategy` | `'rss_xml_canonical_v1'` |
| `monitorability_policy` | `'manifest_schedule_v1'` |
| `authorization_receipt_sha256` | 见 §4.2 |
| `authorization_expires_at` | 必须晚于 `created_at` |
| `source_policy_sha256` | 见 §4.3 |
| `operation_id` | FK → `internal_operation` |
| `created_at` | 创建时间 |
| `superseded_at` | 现势为 NULL；被下一修订取代时写时间戳 |

建议约束：

- `CHECK(source_id IN ('motorsport-f1-news','the-race-f1-news'))`
- `UNIQUE(source_id, source_revision)`
- `UNIQUE(source_id) WHERE superseded_at IS NULL`（部分唯一，保证一个现势行）
- INSERT/UPDATE 必须持有未消费的 `source_registry_mutation_permit_v1`（或 v2 同构 permit），`action='apply_rss_config'`
- 禁止 DELETE；禁止改 hash 列以外的历史行（只允许现势行写 `superseded_at`）

### 3.2 `route_registry` 一次插入

仓库里 **没有** 生产 RSS `route_registry` 种子；现有 INSERT 全在测试 seed。`route_registry` 不可 UPDATE/DELETE。0011 apply 应在迁移事务里 **一次性 INSERT** 两条 RSS 路由（Motorsport / The Race），`route_class='rss'`、`egress_class='rss_https'`、`endpoint_class='rss_fetch'`、`endpoint_identity_sha256` = §4.1 的 hash。之后路由身份冻结；feed URL 变更必须新 `route_id` + 新 v2 修订。

运行期 gateway 当前没有 `route_registry` INSERT 方法，因此 **禁止** 用 gateway 补路由行；只允许 0011 迁移 apply 窗口写入。

### 3.3 读路径切换（apply 后的代码合同，本任务不改）

`bilingual-gateway-port.ts` 今天 `LEFT JOIN source_registry_rss_config_v1` 且要求 `config_revision === 1`。0011 apply 后必须改读现势 v2，否则 admission 仍绑定占位 hash。该代码切换与 SQL apply 必须同任务、同收据，且仍须用户批准。

## 4. 三类 hash 的 preimage

哈希算法：`SHA-256( domain || "\n" || canonicalJsonV1(preimage) )`，输出 64 位小写 hex。`canonicalJsonV1` 与 gateway 现有实现相同（对象键排序、只接受 JSON 安全整数）。**禁止**把占位 `"1"/"4"/"5" × 64` 再写进 v2。

### 4.1 `route_identity_sha256`

- Domain：`f1plus1-rss-route-identity-v1`
- 用途：对齐 `route_registry.endpoint_identity_sha256`，以及未来 collect 的 `ClosedExternalRequest.expected.routeIdentitySha256`
- Preimage（固定键序由 canonical 保证）：

```json
{
  "canonicalFeedUrl": "https://www.motorsport.com/rss/f1/news/",
  "egressClass": "rss_https",
  "endpointClass": "rss_fetch",
  "routeClass": "rss",
  "routeId": "rss-route-motorsport",
  "scheduleSeconds": 900,
  "siteUrl": "https://www.motorsport.com/"
}
```

The Race 把 `routeId` 换成 `rss-route-the-race`，URL 换成 `https://www.the-race.com/category/formula-1/rss/` 与 `https://www.the-race.com/`。

### 4.2 `authorization_receipt_sha256`

- Domain：`f1plus1-rss-authorization-receipt-v1`
- 用途：`TrustedSourceAuthority.authorizationReceiptSha256`；表示用户授予的 **仅采集** 许可，不是发布许可
- Preimage：

```json
{
  "automaticPublish": false,
  "automaticReview": false,
  "canonicalFeedUrl": "https://www.motorsport.com/rss/f1/news/",
  "expiresAt": "2027-08-30T00:00:00.000Z",
  "grant": "collection-only",
  "grantedAt": "2026-08-30T00:00:00.000Z",
  "grantedBy": "owner-supervisor",
  "scheduleSeconds": 900,
  "sourceId": "motorsport-f1-news"
}
```

`expiresAt` / `grantedAt` 必须是用户批准 apply 当时写入的真实 UTC 毫秒时间戳，不能用本文示例日期冒充收据。

### 4.3 `source_policy_sha256`

- Domain：`f1plus1-rss-source-policy-v1`
- 用途：媒体/权利/主机 allowlist 绑定；Motorsport 走数字 CDN allowlist，The Race 走 Ghost 图床前缀
- Preimage：

```json
{
  "allowlistedImageHosts": ["cdn-1.motorsport.com", "cdn-2.motorsport.com"],
  "automaticPublish": false,
  "automaticReview": false,
  "collectionMode": "rss",
  "dedupeStrategy": "source_external_id_sha256_v1",
  "mediaPolicy": "allowlisted",
  "normalizationStrategy": "rss_xml_canonical_v1",
  "rightsStatus": "clear",
  "scheduleSeconds": 900,
  "sourceId": "motorsport-f1-news"
}
```

The Race 的 `allowlistedImageHosts` 必须写成现有媒体合同已冻结的 `storage.ghost.io` 内容图前缀，不得临时发明第三套主机。

## 5. 仅两源写路径

合法写入口（apply 之后，仍走 gateway，禁止 raw SQL）：

1. `owner-supervisor` 签发 `admin_http` handoff。
2. `operation_kind='source_update'`（或 0011 新增的 `source_apply_rss_config`，二者择一，不得并行）。
3. permit `action='apply_rss_config'`，`source_id ∈ {motorsport-f1-news, the-race-f1-news}`。
4. 同一事务：现势 v2 行写 `superseded_at`（若有）→ INSERT 新 v2 行 → 可选 `source_registry_history_v1` 追加 `validated`/`enabled` 之外的新 action（若 0011 扩展 enum）。
5. Autosport / RaceFans / 任意 X 源：permit 与 CHECK 双重拒绝。

启用采集仍走既有 `enable` 状态机，且必须在 v2 现势行存在、hash 复算通过之后。本草案 **不** 授权 enable。

## 6. Apply 前置（用户单独批准）

在写 `0011_*.sql` 或对生产执行 apply 之前，必须同时满足：

1. 用户书面批准本草案（把 `authorization_state` 从 `user_required` 改成 `user_confirmed`）。
2. 独立任务持有 `user_confirmed`，且 confirmation 写明「允许写 0011 SQL / 允许 disposable apply / 禁止生产 apply」中的哪一层。
3. Motorsport / The Race 的三条 hash 已用 §4 preimage 离线算出，并与将写入的 release/manifest 对得上。
4. 双语 admission 读路径切换方案已评审，避免 apply 后仍读 v1 占位。
5. 回退：不 apply 则零行为；若 disposable apply 失败，丢弃该库。生产一旦 apply，只能再追加 v2 修订，不能 DELETE v2、不能改 v1。

## 7. 明确不做

- 不在本任务写迁移文件、不改 `user_version`、不改 schema10 fingerprint 钉。
- 不替换 Autosport / RaceFans 占位 hash。
- 不把 `config_revision === 1` 的双语断言改成本任务的代码。
- 不授权自动审核、自动发布或 900 秒以外的调度。

## 8. 状态

`draft` / `apply_state=blocked_until_separate_user_approval`。开发部按 `TASK-20260830-C917F4` 交付设计文档；产品部吸收后才可升为 proposed/accepted。
