---
type: system_adr
status: draft
date: 2026-09-05
department: 自动化部
decision_id: ADR-F1PLUS1-0012-RSS-SKYSPORTS-CONFIG-V3
related_task: TASK-20260831-AC5CC2
amends: docs/decisions/system/2026-08-30-F1+1-0011-source-registry-rss-config-v2-draft.md
authorization_state: user_confirmed
apply_state: applied_production
---

# ADR-F1PLUS1-0012：Sky Sports 官方 F1 RSS（`source_registry_rss_config_v3`）

> 本文件仍是工程草案，不是 accepted ADR。用户已于 2026-09-05 确认生产 apply。生产库指纹 `36e6f60ba0cdd3a5d2254884a1e0a97dcf5cdff9ae473f0989d99f2505977849`，`user_version` 仍为 10。Admin 已切 `candidate-v10-20260905-1408`；公开与 `:3102` 未切。

## 1. 决策目标

公开站目前只有 Motorsport / The Race 两条 RSS。X 路径被 schema10 锁死。用户选定 Sky Sports 官方 F1 RSS（`https://www.skysports.com/rss/12433`）作为可实际采集的第三条新闻源。0011 的 v2 表对 `source_id` 闭集为两源，且 `source` 表 CHECK 仍是四源；不能 UPDATE v1/v2，也不能往 v2 插 Sky。

## 2. 不变式

1. **不改** `0010` / `0011` SQL 字节；v1 仍恰好 4 行占位；v2 仍恰好 Motorsport / The Race。
2. Autosport / RaceFans 不进 v2/v3，不进 collector allowlist。
3. `user_version` 保持 **10**。schema fingerprint 变为 `SOURCE_REGISTRY_SCHEMA10_0012_SHA256`。
4. 部署清单里的 `reviewSchemaSha256` 字面量仍是 schema10 `e8027277…da4f`。只有 `assertSourceRegistrySchema` 增加第三钉。
5. `automaticReview=false` / `automaticPublish=false` 写入 Sky policy preimage。
6. 不删除、不改 `x_skysportsf1`（冻结 x_manual 行）。
7. 本候选 **不得** 自行切公开站或 `:3102`、不得抓 Autosport/RaceFans、不得翻签名 caps。生产 apply / Admin 切换 / Sky allowlist 已在用户确认后落地。

## 3. 迁移形状

- 0006 类重建 `source`：`legacy_alter_table=ON` 下 rename → 新 5-id CHECK → 插入 `skysports-f1-news` → 丢掉 `source_pre_0012` → 原样重建 `gateway_source_*`。
- `DROP TRIGGER source_registry_insert_guard`，插入 `enabled=1 / active / active` 的 registry 行（`current_operation_id=NULL`），再 **字节复原** insert_guard。
- 新表 `source_registry_rss_config_v3`（只允许 Sky / `rss-route-skysports`），insert 后 `INSERT_CLOSED`。
- 单例 `source_registry_rss_skysports_identity`：存在即判定 0012 指纹。
- `source_registry_rss_config_current`：v1 LEFT JOIN v2 **UNION ALL** 现势 v3（`config_layer='v3'`）。
- `route_registry` 一次插入 `rss-route-skysports`。

## 4. 钉死的哈希（生产已 apply）

| 名 | SHA-256 |
|---|---|
| `0012_rss_skysports.sql` 文件 | `66ad9474a90709e4071d82672adb70b1ae23eee6747e1aa15a1b98cebc966597` |
| canonical（header 置零） | `c9efdbfb0725994fc0617984c5b89dab937da69b37172eff249ef9248d94d278` |
| schema fingerprint after apply | `36e6f60ba0cdd3a5d2254884a1e0a97dcf5cdff9ae473f0989d99f2505977849` |

身份 / 路由 / 授权 / 政策 hash 仍走 0011 的三个 domain：`f1plus1-rss-route-identity-v1` / `f1plus1-rss-authorization-receipt-v1` / `f1plus1-rss-source-policy-v1`。

## 5. 生产 apply 顺序（2026-09-05 已执行）

1. `prepare-v10-release-candidate`，opener 接受 0011 **或** 0012 → `candidate-v10-20260905-1408`。
2. 只切 Admin（不切公开、不切 `:3102`；collector WD 仍 0145）。
3. pause / bootout collector。
4. apply 0012；opener 验 0012 指纹 `36e6f60b…7849`。
5. collector Sky allowlist + `1408` opener；gateway 哈希仍钉 `0145`。

现场补充：Sky 官方 `pubDate` 带 `BST`。未改 1408 密封 `parser.ts`；runtime `rss-date.ts` shim `BST`→`+0100`。自然槽 `1987327` 已入库 20 条。工程树 `parseRssDate` 待下一签名 candidate 收口。

回退：库从 `[M1-HOME]/F1-1-website/.0012-apply-20260905-1408/pre-0012.sqlite` 还原（先 checkpoint WAL）；Admin 从 `[M1-HOME]/F1-1-website/.admin-load-20260905-1408/` 退回 `0930`（须同时退库，否则 0930 opener 打不开 0012）。collector runtime 退回两源 / 0145-only import。
