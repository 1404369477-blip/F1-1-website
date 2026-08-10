---
type: audit_report
status: final
date: 2026-08-04
department: 测试部
target: TASK-20260804-AC25D4公开Repository与feed-detail API最终候选
task_id: TASK-20260804-C30FD0
related_task: TASK-20260804-C30FD0
domain_stage: 公开API正式窗口测试
decision: pass
tags: [M4, public-api, feed-detail, independent-test]
summary: 冻结候选SHA稳定，唯一一次API聚焦测试5/5通过，独立临时SQLite最小矩阵覆盖feed、detail、筛选、cursor、Problem、headers与m3拒绝并通过；P0/P1/P2均为0，未覆盖项保持明确边界。
p0: 0
p1: 0
p2: 0
---

# C30FD0 公开 feed/detail API 聚焦测试报告

## 结论

`PASS`。冻结候选 SHA 无漂移；唯一一次开发聚焦测试为 1 文件、5 测试全通过；测试部独立最小矩阵在 0700 临时目录与临时 SQLite 上为 1/1 通过。P0=0、P1=0、P2=0。

本报告只判定 TASK-20260804-C30FD0 规定的 API 功能合同，不构成前端、真实 HTTP 进程、生产部署或系统调用级 no-egress 证明。

## 独立证据

1. 冻结候选：开发报告列出的 9 个 SHA-256 逐项复算一致，测试前后保持一致。
2. API 聚焦测试仅运行一次：固定 Node `v24.18.0` 执行 `vitest run --config vitest.config.ts src/tests/public-api.test.ts`，结果 `1 passed / 5 passed`，耗时 437 ms。
3. 独立最小矩阵：测试部自建 `/private/tmp` 测试入口，使用 canonical `public-synthetic` seed 和独立临时数据库直接调用 `handlePublicFeed`、`handlePublicStory`、`PublicStoryRepository`；结果 `1 passed / 1 passed`。
4. Feed：首页 12 条、12 个唯一 `public-demo-*`、`pageSize=12`、`hasMore=false`、`nextCursor=null`；按 `publishedAt DESC, publicId DESC` 排序；四类 `contentType` 均有结果且无越类；`src-active=12`、不存在 source=0；首项 cursor 续读剩余 11 条且不重复首项。
5. 失败出口：未知、空、重复 query 分别返回 `PUBLIC_QUERY_INVALID`；单边 cursor 返回 `PUBLIC_CURSOR_PAIR_REQUIRED`；非 canonical cursor 返回 `PUBLIC_CURSOR_INVALID`；跨筛选 cursor 返回 `PUBLIC_CURSOR_SCOPE_MISMATCH`。Problem key 精确为 7 项，instance 不含 query。
6. Detail：12/12 为 200；每项 related 为 0–3、排除自身且不重复；非法 ID 返回 `PUBLIC_ID_INVALID`，合法未知 ID 返回 `PUBLIC_STORY_NOT_FOUND`。
7. Headers/profile：成功与失败 content-type、`Cache-Control: no-store` 精确符合 ADR，均无 `Access-Control-Allow-Origin`；`m3-shadow` 公开读取返回 503 `PUBLIC_PROFILE_UNAVAILABLE`。
8. 清理：测试专用文件和临时目录已删除；未发现 C30FD0 临时 DB/sidecar、`.next`、3010 监听或测试进程残留。未修改 app、Spec、ADR、data、design、lockfile。

## 已验证

- TASK 指定的 feed、排序、四类/source 筛选、固定页、cursor 正负例。
- 12 个 detail、related 约束、publicId 正负例。
- closed Problem key/reasonCode、成功/失败响应头、无 CORS、m3-shadow 拒绝。
- 9 个冻结 SHA、临时态清理和测试前后候选零漂移。

## 未验证

- 按任务边界未运行 build、full check、typecheck、浏览器或真实 Next/HTTP 进程。
- 未覆盖 13+ 条非正式 profile、生产数据库、生产缓存、签名 cursor、前端接线、真实外部资源与系统调用级 no-egress。
- 完整性破坏/DB busy 由唯一聚焦套件覆盖；独立最小矩阵未重复注入这些破坏，避免扩展为第二轮聚焦套件。

## 错题自检

- 首次独立入口用 Node strip-only 直接加载 TypeScript，在业务调用前因参数属性不受支持退出；随后改用项目现成 Vitest 转译器。
- 独立矩阵首个临时库 basename 写成 `public.sqlite`，候选按合同以 `PROFILE_PATH_MIX` 在 seed 前拒绝。修正为 canonical basename 后矩阵 1/1 通过。两次均属于测试夹具错误，不计产品缺陷；聚焦测试未重复运行。
- 未采信开发部 PASS 结论；开发报告仅用于冻结 SHA 和定位范围。没有 ACK、放行前端或替上游修复。

TASK_STATE_OK
