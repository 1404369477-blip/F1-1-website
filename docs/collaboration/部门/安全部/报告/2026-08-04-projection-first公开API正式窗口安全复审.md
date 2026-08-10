---
type: audit_report
department: 安全部
target: projection-first 公开 Repository 与 feed/detail API 冻结快照
status: final
date: 2026-08-04
related_task: TASK-20260804-000EA6
upstream_task: TASK-20260804-AC25D4
decision: pass
severity_count: "P0=0, P1=0, P2=0"
tags: [public-api, projection-first, fail-closed, cursor, read-only]
summary: "正式窗口安全复审 PASS：P0=0、P1=0、P2=0；9 个冻结哈希一致，完整性损坏与恶意输入探针 fail-closed。cursor scope 动态探针因夹具字段命名错误保留未验证，静态控制流已验证精确绑定。"
---

# projection-first 公开 API 正式窗口安全复审

## 结论

**PASS。** 本结论仅覆盖 `TASK-20260804-AC25D4` 冻结快照中的 projection-first Repository、feed/detail HTTP 边界与本轮三类最小安全探针。P0=0、P1=0、P2=0。本报告不放行浏览器/前端、系统级 no-egress、真实外部能力、生产部署或 VS-0 整体。

## 冻结与静态审查

- 复算上游列出的 9 个 SHA-256，全部与开发报告一致：`types/error/cursor/repository/http/runtime/feed route/detail route/public-api.test`。探针后再次复算仍一致。
- Repository 以 `published_projection` 为唯一入口，先枚举并完整验证 12 条 projection 链，再做 filter/cursor/page；任一 hash、fence、ledger、state、reference 或链数量异常均抛出闭合错误，未发现跳过坏行或部分返回分支。
- cursor 为 canonical base64url 闭合结构，有 512-byte 上限、精确键集、UTC 时间与 public/source/type 校验；HTTP 层将 cursor 中 source/contentType 与当前请求精确绑定，Repository 再校验目标 tuple 存在。
- feed 只接受四个查询键；detail ID 有闭合格式。Problem 固定七字段、固定文案与无 query 的 instance，失败响应 `no-store` 且无 CORS 放宽。
- 对公开 API 模块做定向静态搜索，未命中 demo/static fallback、`public_story`、fetch/network/subprocess、Host/Forwarded 信任、CORS 放宽或 `process.env` 直读。

## 三类最小安全探针

1. **完整性损坏：通过。** 在一个隔离临时 SQLite 中同时注入 content hash、bundle fence、profile ledger 损坏，仅请求 feed 一次；返回 HTTP 500 / `PUBLIC_READ_INTEGRITY_FAILED`，Problem 键集闭合，无 items/story fallback，无 SQL、SQLite、payload、本地路径或损坏值泄漏。
2. **cursor scope 绑定：探针未验证。** 仅请求一次；探针从 fixture `payload_json` 取值时使用了错误字段命名，导致自建 cursor 本身无效，未得到预期 `PUBLIC_CURSOR_SCOPE_MISMATCH`。遵守一次边界未重跑。静态控制流明确实施 scope 精确比对；冻结 `public-api.test.ts` 也包含对应回归用例，本轮按边界未执行该套件。
3. **恶意 feed/detail 输入：通过。** 在一个隔离临时 SQLite 中对 feed 未知查询键与 detail 路径型 ID 各发起一个请求；分别返回 HTTP 400 / `PUBLIC_QUERY_INVALID` 与 HTTP 400 / `PUBLIC_ID_INVALID`，Problem 键集闭合，无输入回显、路径/URL/SQL/stack/secret 标记泄漏或 CORS 放宽。

所有探针均使用项目现有 Node 24、Vite 内存 TS 载入与独立临时数据库；未运行 Vitest 套件、build、full check、浏览器或外联。临时目录已清理，无残留。

## 已验证 / 未验证

**已验证：** 9 个冻结哈希；projection-first 入口和全链先验证控制流；cursor/query/detail/Problem 静态边界；完整性损坏 fail-closed；恶意 feed/detail 输入 fail-closed；无目标静态 fallback/egress/Host/CORS 命中；探针临时目录清理。

**未验证：** cursor scope 的本轮动态结果（探针 fixture 字段命名错误）；任何浏览器/前端行为；系统级 no-egress 强制证明；真实外部能力、生产配置与部署。

## 错题自检

- 未将动态 cursor 探针的失败归因于产品实现，已如实降格为未验证；未重跑该类别。
- 未运行禁止的测试套件、build、full check、浏览器或网络。
- 未修改 app、Spec、ADR、data、design 或 lockfile；仅新增本安全报告并更新任务协议状态。
- PASS 只表示本轮安全准入无 P0/P1，不替代测试部运行验收或真实能力放行。

## 任务收据

`TASK_STATE_OK | state_persisted | local_paths_checked=1 | external_declared=0 | 2026-08-04T16:37+08:00 | TASK-20260804-000EA6 | 6f3a02ac5803601c`

TASK_STATE_OK
