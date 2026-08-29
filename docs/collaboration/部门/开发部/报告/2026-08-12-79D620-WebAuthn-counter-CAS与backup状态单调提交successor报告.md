---
type: implementation_report
department: 开发部
status: final
date: 2026-08-12
related_task: TASK-20260812-79D620
decision: pass
tags: [admin-service, webauthn, counter-cas, backup-state, fail-closed]
---

# TASK-20260812-79D620 WebAuthn counter CAS 与 backup 状态单调提交 successor 报告

## 1. 结果

`TASK-20260812-86C9B9` 指出的唯一 P1 已在限定四个文件中完成修正：认证 adapter 现在完整透传 `newCounter`、`credentialDeviceType` 与 `credentialBackedUp`；credential store 以验证快照的 `expectedCounter` 执行同步 compare-and-set，并在同一提交门内约束 counter、device type 与 backup state；login session 与 fresh receipt 均只在状态提交成功后签发。

新增的一组聚焦负例复现了两个验证都基于 `counter=N`、却按 `N+2 → N+1` 逆序完成的交错：`N+2` 请求成功，旧快照请求 CAS 失败，最终 counter 保持 `N+2`。同组还覆盖 device type 漂移、backup `true→false` 降级、`singleDevice + backedUp=true`、允许的 `false→true` 与 `0→0` 语义，以及 fresh CAS 冲突时不签发 fresh receipt。原 passkey bootstrap/login/fresh/CSRF 纵切继续通过。

本任务没有修改 UI、Tailscale、固定 M1、LaunchAgent、sender、public switch、真实数据库、公开服务或依赖文件。

## 2. 精确实现

### 2.1 WebAuthn verification 结果不再丢字段

`app/src/server/admin-service/webauthn.ts` 的 `AuthenticationVerification` 增加：

- `credentialDeviceType`
- `credentialBackedUp`

`SimpleWebAuthnAdapter.verifyAuthentication()` 逐字段转发固定 `@simplewebauthn/server@13.3.2` 的 `authenticationInfo`，没有自行解析 authenticator data，也没有放宽第三方类型。

### 2.2 单一同步状态提交门

`app/src/server/admin-service/storage.ts` 用 `commitAuthenticationState()` 替换无条件 `updateCounter()`。调用必须同时提供：

- `credentialId`
- `expectedCounter`
- `newCounter`
- `deviceType`
- `backedUp`
- `now`

该方法在一个无 `await` 的同步 store 临界段中重新读取 canonical credential file，再执行以下 fail-closed 规则，全部通过后才使用既有 `atomicWrite()` 提交：

1. 当前 active credential 必须存在；
2. 当前 counter 必须精确等于验证开始时的 `expectedCounter`；
3. 只有 `current=0 && new=0` 允许相等，其余情况要求 `newCounter > current.counter`；
4. 认证返回的 `deviceType` 必须与登记记录一致，持久记录不随认证漂移；
5. `backedUp` 允许保持不变或 `false→true`，拒绝 `true→false`；
6. `singleDevice` 的当前或新状态均不得为 `backedUp=true`。

任一不满足均在写文件前抛出 `ADMIN_SESSION_REQUIRED`；旧 assertion 不会自动重试。

### 2.3 session/fresh 顺序

`app/src/server/admin-service/auth.ts` 的 login 与 fresh 两条路径均将 credential 验证快照 counter、adapter 返回的新状态交给 `commitAuthenticationState()`。只有该同步提交返回成功后，才分别调用：

- `acceptVerifiedSession()`
- `acceptVerifiedFreshReauth()`

测试以实例 spy 验证：并发旧快照、device 漂移和 backup 降级均没有增加 session 签发次数；fresh 的 stale CAS 失败时 fresh 签发次数保持 `0`。

## 3. 唯一验证预算

三项验证均严格执行一次，未重跑，顺序为聚焦 Vitest → 固定 Node 24 typecheck → 冻结范围 diff-check；没有出现首错。

| 验证 | 次数 | 结果 |
| --- | ---: | --- |
| 固定 Node `24.18.0` 聚焦 Vitest：`src/tests/admin-service.test.ts` | `1/1` | PASS；`1 file / 2 tests`，tests `118ms`，总 duration `386ms` |
| 固定 Node `24.18.0` TypeScript：`tsc --noEmit` | `1/1` | PASS；exit `0`、stdout/stderr 均为空 |
| 冻结范围 diff-check | `1/1` | PASS；4 个目标 SHA 已变化，9 个非目标冻结 SHA 精确不变，目标文件无 CR、行尾空白或冲突标记 |

固定 Node 二进制为 `app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/node`，版本 `v24.18.0`，SHA-256 `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`。

## 4. 候选 SHA-256

| 文件 | 修正后 SHA-256 |
| --- | --- |
| `app/src/server/admin-service/auth.ts` | `ff1426ec977495ecbff30be71b72aa48493e54e8922611f3c4da5121169f00f7` |
| `app/src/server/admin-service/storage.ts` | `0ce78ba9c819ec897f1f0e79a901fa9ae6983307a0d16cb9b43ef8a99bdb776c` |
| `app/src/server/admin-service/webauthn.ts` | `fd2e061d8dea1de239475745153e56778a4298de1a48d6ec1ae9847a985058fd` |
| `app/src/tests/admin-service.test.ts` | `9f60833cd466402798be3de99602821a9860ccef7b45dcf797c90bbcab96007e` |

冻结范围检查确认以下 9 个非目标输入仍与 `86C9B9` 一致：`deployment.ts`、`runtime.ts`、`server.ts`、`scripts/admin-service.ts`、`package.json`、`package-lock.json`、`review-real/schema.ts`、`review-real/repository.ts`、`review-real-backend.test.ts`。

## 5. 未验证与后继边界

- 真实 Touch ID、iCloud passkey、iPhone、独立 FIDO2 credential 与浏览器矩阵仍未执行。
- Tailscale Serve/Grant、固定 M1 `3101` listener、真实 RSS DB migration、sender/receiver 与 public switch仍未执行。
- 本次 CAS 的并发保证以冻结的单实例 Admin Node 服务为运行边界；任务没有启动第二个独立写进程，也没有引入跨进程锁。
- 现有首枚 credential bootstrap 与第二枚独立 hardware credential 的生产停止线不在本任务范围内，继续保留。
- 本报告是开发部自测收据，最终安全放行仍需安全部对修正后的四个 SHA 做限定独立复审。

## 6. 错题自检

- 没有用 challenge 单次消费替代验证后共享状态的 CAS。
- 没有把 SimpleWebAuthn 的单次 verification PASS 当作状态已经持久提交。
- 没有允许 counter 非零相等、回退、device type 漂移、backup 降级或 `singleDevice + backedUp=true`。
- 没有在 CAS 之前签发或轮换 session/fresh。
- 没有修改依赖、UI、Spec、ADR、M1、网络、服务 load、真实数据库或公开出口。
- 三项限定验证均只运行一次，没有用修正性重跑掩盖首错。

TASK_STATE_OK
