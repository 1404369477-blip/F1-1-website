---
type: development_delivery_report
status: final
date: 2026-08-04
department: 开发部
task_id: TASK-20260804-A01DF7
domain_stage: SQLite启动能力P1整改
decision: delivered_for_focused_security_rereview
---

# NODE_ENV=test 数据库覆盖 P1 整改报告

## 结果

已关闭 `TASK-20260804-B9D885` 确认的唯一 SQLite P1：所有真实 CLI 调用 `loadRuntimeConfig()` 时均无条件要求 canonical profile 数据库路径。`NODE_ENV=test`、`APP_ENV=test` 或任意环境值均不能再开启随机 `.local/*.sqlite` 覆盖。

修复后：

- `loadAppConfig()` 不再暴露 `allowTestDatabasePath`；
- `AppConfig` 与 DB profile 边界不再存在 `testDatabasePathOverride`；
- `loadRuntimeConfig()` 不再读取 `NODE_ENV` 决定数据库路径能力；
- profile/数据库路径不一致统一以 safe 四字段 `DB_PATH` CLI 错误拒绝；
- P1 隔离测试改为“隔离 app 根 + canonical `.local/f1plus1.sqlite`”，不再依赖真实 CLI 可继承的能力开关；
- 新增真实 CLI 负例：`NODE_ENV=test` 加随机 `F1_DB_PATH` 调用 `db:migrate`、`runtime:assert-ready`、`start`，全部在建库/监听前拒绝。

## 改动 SHA-256

| 文件 | SHA-256 |
|---|---|
| `app/src/server/config/env.ts` | `7158d2d4233d24326a08abf80ec247c07527627f987a0a7c4370f388e5909877` |
| `app/src/server/runtime-config.ts` | `c2d2d209f6e2851066aec7e7ff1f21b67414c5389685e527ae14abd024e3be92` |
| `app/src/server/db/profile.ts` | `a0cd5842b8eebfb212ff169c643fcadad370277416f5400fc4847ff4f9c751b9` |
| `app/src/tests/p1-cli.test.ts` | `c935d176f7e7a2e2e2fc699099cdd2ed3c21cf43f6a0649d81cf888b6cec8fb7` |
| `app/src/tests/runtime-profile-boundary.test.ts` | `d0f637bf613b9588fd835fcbd4fa01aa2dbcb2a65f8dfbfa827d2963bd519ec2` |

未修改 migration、public-synthetic 数据图、四 root、公开 UI/API、Spec、accepted ADR、design 或 lockfile。

## 聚焦验证

Node 24.18.0：

```text
vitest runtime-profile-boundary.test.ts + public-synthetic-seed.test.ts
Test Files 2 passed
Tests 5 passed

tsc --noEmit
PASS
```

负例对 `db:migrate`、`runtime:assert-ready`、`start` 均确认：

```json
{"event":"cli_failure","status":"rejected","reasonCode":"DB_PATH","externalCalls":0}
```

三条命令均未创建目标数据库、WAL、SHM 或 journal；3000/3101 前后无监听。canonical `m3-shadow` 与 `public-synthetic` 配置继续通过，既有双 profile/四 root/原子 seed 目标套件继续通过。

最终未生成 `.next`，`app/.local` 顶层无 SQLite 或 sidecar 残留。

## 未验证与门禁

- 按任务要求未运行完整 `npm run check`、build 或同质重复探针；
- 安全部尚未执行一次静态 + 单负例聚焦复验；该复验 PASS 前不得 ACK 本任务、`253A43` 或 `3760`。

## 错题自检

- 首轮聚焦测试中，实际拒绝已经发生在建库/监听前，但 `DATA_PROFILE_MIX` 尚未进入 CLI reason allowlist，被封闭映射为 `CLI_INTERNAL_ERROR`。这仍是安全四字段输出，但缺少可判定配置原因。未扩大安全日志 allowlist，改用已有且语义匹配的 `DB_PATH` reason；修正后同一聚焦套件 5/5 PASS。
- 测试隔离通过复制到临时 app 根并使用 canonical basename完成，没有把随机路径覆盖移到另一个可继承环境变量。
- 没有重跑 full check、build 或启动 happy path。

TASK_STATE_OK
