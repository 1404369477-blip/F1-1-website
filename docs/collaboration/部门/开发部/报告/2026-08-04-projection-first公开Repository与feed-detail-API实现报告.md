---
type: development_delivery_report
status: final
date: 2026-08-04
department: 开发部
task_id: TASK-20260804-AC25D4
domain_stage: 公开Repository与API实现
decision: delivered_for_security_and_test_review
---

# Projection-first 公开 Repository 与 feed/detail API 实现报告

## 结果

已交付可调用的公开读后端：

- `GET /api/public/feed?cursorAt=&cursorId=&source=&contentType=`；
- `GET /api/public/stories/{publicId}`；
- `PublicStoryRepository` 从 `published_projection` 起步，完整验证后生成 public DTO；
- 固定 12 条 page size、`LIMIT 13`、`published_at DESC + public_id DESC`；
- canonical base64url cursor、筛选绑定和目标 tuple 验证；
- detail 统一 404、0–3 条 related items；
- closed Problem JSON、no-store、精确 content type、无 CORS；
- public-synthetic profile 未就绪、M3 profile、链损坏、完整性失败和 DB busy 均 fail closed，无静态 fallback 或部分 DTO。

本交付不接前端。测试部与安全部互补复验达到 `P0/P1=0` 前，不得 ACK 或开始前端数据源切换。

## Repository 完整性

每个请求先核现有 v0.4 四 root、fixture、profile ledger、实体 count 和 stored canonical payload，再枚举全部 12 个 Projection 并逐条联查唯一 Publication、approved ReviewDecision、immutable ReleaseBundle、Content 和 Summary。

运行时重新验证：

- Projection/Publication/Bundle/Decision/Content/Summary 状态与 SQL 列和 payload 一致；
- publicId、引用、generation、published version hash 一致；
- Content、Summary、payload、Bundle、Decision hash 按 `canonical-json-v1` 重算；
- published version hash 按 frozen synthetic 公式重算；
- Bundle、Decision、Publication 和 canonical payload 五个 fence 一致且均不小于 1；
- `src-active`、v0.4 snapshots、访问、时间和 media presentation enum 完整；
- 任一缺行、重复、SQL 列漂移、payload/hash/fence/ledger/status/profile 漂移使整个请求返回 closed 500/503。

没有 `public_story` 第二真值，没有读取 `DEMO_STORIES` 或 `demo-data.ts`，没有网络或子进程调用。

## HTTP 合同

Feed 只接受四个 query key。未知、重复、空、超长、非法 source/contentType、单边 cursor、非 canonical base64url、closed payload 漂移、筛选跨 scope 和不存在 cursor tuple 使用 ADR reasonCode 拒绝。

成功响应：

```text
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
```

失败响应：

```text
Content-Type: application/problem+json; charset=utf-8
Cache-Control: no-store
```

Problem 只含 `type/title/status/detail/instance/reasonCode/traceId`；DB busy 额外返回 `Retry-After: 1`。`instance` 不含 query，安全 detail 不回显输入、内部错误、SQL、路径、URL、hash 或 header。

## 冻结 SHA-256

| 文件 | SHA-256 |
|---|---|
| `app/src/server/public/types.ts` | `ac0f777c2c57be73bb0152f19c7b3078af534093079fa13ee976862c553ae24b` |
| `app/src/server/public/error.ts` | `cb1d0846e2684272241eba464a1dd112f097e665336bef8ead7d85c1f35af0cd` |
| `app/src/server/public/cursor.ts` | `e20f8b95d779ade72e1c34c9f3c8ed60b5509db3014e3059ea5c51b48529e74d` |
| `app/src/server/public/repository.ts` | `b8db82246c37a174cc040bfd821c4fdc838d3e691f741d3cdcf2d8ef329c49e4` |
| `app/src/server/public/http.ts` | `e5a0a1494884614882938b007620ae1e17d8b3d395000b3bb6288cc6d952aa13` |
| `app/src/server/public/runtime.ts` | `4387c4cc7b372412ec2411bfcc58c7632c3819836b6607379497d8fd8fb5218f` |
| `app/src/app/api/public/feed/route.ts` | `61ece1c80f3e03004cf9fb1cdfbc6b33d15f7c9721832522d99f282a3f2c5d76` |
| `app/src/app/api/public/stories/[publicId]/route.ts` | `aae6f61abb1123c90a8aa7631c26b62c54fd681cc239d7d48453f92516c56c1a` |
| `app/src/tests/public-api.test.ts` | `e22c74bc5b23b3e2e6f75d1a3487b003afb8208a10570e987b296e46d62224ab` |

## 聚焦验证

Node 24.18.0：

```text
vitest src/tests/public-api.test.ts
Test Files 1 passed
Tests 5 passed

tsc --noEmit
PASS
```

五个聚焦场景内部覆盖：

- Feed 12 条 `public-demo-*`、精确排序、四类筛选、source 筛选、no-more；
- canonical cursor 正向续读、跨筛选、未知 tuple、单边/非 canonical/非法日期/非法 query；
- 12 个 detail 200、related 0–3 去重排除当前、非法 ID 400、合法 unknown 统一 404；
- content hash、Bundle fence、profile ledger、Publication status 和缺 Projection 五类损坏均整请求 500，响应无 items/story；
- M3 public read 503、DB busy Problem 503 + `Retry-After: 1`；
- DTO/Problem closed keys、响应头、无 CORS、无 URL/hash/fence/reviewer/raw/SQL/stack/path 泄露。

测试全部使用独立临时 SQLite，退出后清理。最终没有 `.local/*.sqlite`、sidecar、`.next`、监听端口或临时残留。

## 未验证与边界

- 按任务要求未运行 full check、build、现场 Next 进程或真实 `curl`；Route Handler 的 Request/Response 和 Repository 已直接验证，独立测试部可在冻结闭包中补一次真实 HTTP 复验；
- 未做 13+ 条非正式数据库，因为 accepted public profile 固定精确 12 条；`LIMIT 13` 和 cursor 实现已落地，13+ 临时扩容场景由后续独立合同测试决定；
- 未实现前端 API 接线、缓存、生产数据库、签名 cursor 或真实外部能力；
- 未修改 migration、seed、四 root、data 正式包、公开前端、Spec、accepted ADR、design 或 lockfile。

## 错题自检

- 首轮聚焦套件唯一失败来自泄露断言把 Problem 的安全文案 `public story integrity` 中普通单词 `story` 当成 DTO 泄露。实现返回已经是 closed Problem；测试改为精确禁止 `"items":` 和 `"story":` 字段，再保留 SQL/path/payload 等敏感模式，修正后 5/5 PASS。
- Repository 在应用筛选前验证全图，避免损坏 SQL 列因筛选条件被跳过；随后仍执行 ADR 指定的 Projection-first、排序和 `LIMIT 13` SQL。
- 没有把静态 fixture 直接序列化为 DTO；fixture 只作为四 root 和 stored payload 完整性证明，DTO来自 SQLite联查后重算的链。

TASK_STATE_OK
