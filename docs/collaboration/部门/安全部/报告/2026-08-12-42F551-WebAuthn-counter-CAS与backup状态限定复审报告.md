---
type: audit_report
department: 安全部
target: 79D620 WebAuthn 单调认证状态提交 successor
status: final
date: 2026-08-12
related_task: TASK-20260812-42F551
decision: pass
tags: [admin-service, webauthn, counter-cas, backup-state, limited-review]
summary: 四个successor SHA与九个未改候选SHA全部匹配；认证结果完整透传counter/device/backup，单实例同步store以expectedCounter执行CAS、非零严格递增、双零允许、device固定及backup单调门，login/fresh只在提交成功后签发session或receipt。86C9B9唯一P1已关闭，结论PASS，P0为0、P1为0、P2为1。
---

# TASK-20260812-42F551 WebAuthn counter CAS 与 backup 状态限定复审报告

## 1. 最终结论

**PASS：P0=0，P1=0，P2=1。`TASK-20260812-86C9B9` 的唯一 P1-01 已 CLOSED。**

四个 successor 文件与九个未修改候选文件的 SHA-256 全部精确匹配任务冻结值。限定静态复审确认：SimpleWebAuthn 认证结果中的 `newCounter`、`credentialDeviceType`、`credentialBackedUp` 已完整传入认证状态提交门；credential store 在单实例同步临界段中以 `credentialId + expectedCounter` 执行 CAS，双零 counter 合法，其余 counter 必须严格递增，device type 必须保持登记值，backup state 只允许保持或 `false→true`，且 `singleDevice + backedUp=true` 始终被拒绝。登录 session 与 fresh session/receipt 均在状态提交成功后才签发。

因此，原来的 `N+2 → N+1` 逆序完成反例会在第二次提交时因 `current.counter !== expectedCounter` 失败关闭，持久 counter 保持 `N+2`；device/backup 绕过和 CAS 失败前签发 session/receipt 也没有残留路径。

本结论只关闭 `86C9B9` 唯一 P1。按任务验收出口，允许后继进行 Admin UI 集成和固定 M1 **prepare-only**；不授权服务 load、Tailscale/Serve、真实 passkey、真实数据库写入、sender/public switch 或生产声明。

## 2. 冻结身份

### 2.1 四个 successor SHA

| 文件 | 本会话 SHA-256 | 任务冻结值 | 结果 |
| --- | --- | --- | --- |
| `app/src/server/admin-service/webauthn.ts` | `fd2e061d8dea1de239475745153e56778a4298de1a48d6ec1ae9847a985058fd` | `fd2e061d…58fd` | PASS |
| `app/src/server/admin-service/storage.ts` | `0ce78ba9c819ec897f1f0e79a901fa9ae6983307a0d16cb9b43ef8a99bdb776c` | `0ce78ba9…776c` | PASS |
| `app/src/server/admin-service/auth.ts` | `ff1426ec977495ecbff30be71b72aa48493e54e8922611f3c4da5121169f00f7` | `ff1426ec…00f7` | PASS |
| `app/src/tests/admin-service.test.ts` | `9f60833cd466402798be3de99602821a9860ccef7b45dcf797c90bbcab96007e` | `9f60833c…007e` | PASS |

### 2.2 九个未修改候选 SHA

| 文件 | 本会话 SHA-256 | `86C9B9` 冻结值 | 结果 |
| --- | --- | --- | --- |
| `app/src/server/admin-service/deployment.ts` | `ddfd5eec42f75aa53d69bf40bb53aaef9bcd7513b55802cfab679f1cda4ebc35` | 同值 | PASS |
| `app/src/server/admin-service/runtime.ts` | `257a8fb89784eca7ca2b0d59bc9e856fa9a385036ec9d4458b6f8d9d1973cccb` | 同值 | PASS |
| `app/src/server/admin-service/server.ts` | `e825ff41d402ea970e17c09d714f9a4ea64c494c507ab005f722d73aac8d479a` | 同值 | PASS |
| `app/scripts/admin-service.ts` | `1be60c1f975c3410a3fda9da70d7357da76951ab856aae04f58288f3f7d7c2a0` | 同值 | PASS |
| `app/package.json` | `a55f3047f3d987e99d5ab7fc4b124f01638c64ed90c74e8033b5a8084ba80808` | 同值 | PASS |
| `app/package-lock.json` | `09af041323719abb803b7ebf306a82028810d6189af46702a3fd122c422ab24d` | 同值 | PASS |
| `app/src/server/review-real/schema.ts` | `6a839832fd5a160f1869c3d0babaf94286b1e26aa37a20f9daf0618dca0ff86e` | 同值 | PASS |
| `app/src/server/review-real/repository.ts` | `0da22560dae79b39ee60947a1caabd2aa103af9fe23c9dc8fe674ee3c32fc52f` | 同值 | PASS |
| `app/src/tests/review-real-backend.test.ts` | `326e3727a15ca9215e4455f6052190917f951624c6025d3f480fc74aa4cd7b6b` | 同值 | PASS |

这些 PASS 只表示任务冻结身份匹配。九个未改文件没有在本限定任务中重新开展全量安全审查。

## 3. 唯一 P1 逐项裁定

| 原要求 | successor 静态实现 | 裁定 |
| --- | --- | --- |
| 认证结果透传 device/backup | `webauthn.ts:33-39` 扩展 `AuthenticationVerification`；`182-188` 逐字段返回固定依赖的 `newCounter`、`credentialDeviceType`、`credentialBackedUp`。 | CLOSED |
| 使用验证快照做 counter CAS | `auth.ts:269-285` 与 `342-358` 将读取时 `credential.counter` 作为 `expectedCounter` 传入；`storage.ts:225` 要求当前 counter 精确等于该值。 | CLOSED |
| 非零严格递增、双零允许 | `storage.ts:227-228` 仅在 current/new 并非双零时要求 `newCounter > current.counter`；负数、非整数与非安全整数在 `209-216` 被闭合 schema 拒绝。 | CLOSED |
| device type 固定 | `storage.ts:226` 要求认证返回 type 与登记 type 精确相同；调用方不能以断言返回值改写登记 type。 | CLOSED |
| backup 单调且 singleDevice 禁 true | `storage.ts:229-231` 拒绝 single-device 的当前或新 backedUp=true，并拒绝 `true→false`；`false→true` 与同值才可进入写入。 | CLOSED |
| 状态提交原子落盘 | 全部检查在同步 `commitAuthenticationState()` 内完成，通过后才沿既有 `atomicWrite()` 写 canonical credential file；方法中没有 `await`。在冻结单实例 Node 服务边界内，请求之间不能插入该同步临界段。 | CLOSED |
| login 成功后才签 session | `auth.ts:278-286` 先提交认证状态，随后调用 `acceptVerifiedSession()`。CAS/状态门异常会直接跳过 session 签发。 | CLOSED |
| fresh 成功后才 rotate/签 receipt | `auth.ts:351-359` 先提交认证状态，随后调用 `acceptVerifiedFreshReauth()`。CAS/状态门异常会直接跳过 session 轮换与 fresh receipt。 | CLOSED |

## 4. 原并发反例回放

```text
初始 current.counter = N
A、B 均在 verifier 前读取 expectedCounter = N
B 的有效 assertion(N+2) 先完成：current=N=expected，N+2>N，提交成功
A 的有效 assertion(N+1) 后完成：current=N+2 != expected=N，写前失败
最终 current.counter = N+2；A 不取得 session/fresh receipt
```

即使两个 SimpleWebAuthn verification 各自都合法，第二层 store CAS 仍以最新持久状态裁定。旧 assertion 不被自动重试，也不能把较低 counter 覆盖回文件。

## 5. 既有验证收据的只读核对

开发部报告记录了以下单次验证；安全部本轮只读回看源码和测试断言，没有重新执行：

- 聚焦 Vitest：`1 file / 2 tests`，一次 PASS；
- 固定 Node 24 typecheck：一次 PASS；
- 四新/九旧 diff-check：一次 PASS。

聚焦测试的冻结代码覆盖：

- 两个 verifier 都基于 counter 10，按 12→11 逆序完成，11 的提交失败且最终保持 12；
- device type 漂移失败且不签 session；
- backup `false→true` 允许，`true→false` 拒绝；
- `singleDevice + backedUp=true` 拒绝；
- counter `0→0` 允许；
- fresh CAS 冲突后 fresh receipt 签发次数保持 0。

该收据与静态实现一致，但不替代真实 authenticator/浏览器验证。

## 6. P2 / Unknown 与边界

**P2-01 / Unknown：**真实 Touch ID、iCloud passkey、iPhone、独立 FIDO2 credential、Safari/Chrome、Tailscale Serve/Grant/device approval/header、异地网络、固定 M1 listener、真实 RSS DB migration、RPO fence、sender/receiver 和 public switch尚未执行。当前 CAS 结论绑定单实例 Admin Node 服务；跨进程 writer/锁不在本任务范围内。

第二枚独立 hardware credential 仍是既有 production 停止线，未因本次 P1 关闭而消失。Admin UI 集成与 M1 prepare 可以推进；服务 load、真实人工发布与 production-ready 仍须等待该停止线和对应动态门独立关闭。

## 7. 放行范围

| 动作 | 裁定 |
| --- | --- |
| Admin UI 与已冻结私有 API 集成 | 放行 |
| 固定 M1 prepare-only，保持 plist disabled / no load | 放行；必须绑定后继批准的精确 deployment manifest |
| 服务 load、Tailscale Serve、真实 passkey bootstrap | 未放行 |
| 真实 DB migration、sender/receiver、public switch、真实人工发布 | 未放行 |
| production-ready、RTO/RPO 达标声明 | 未放行 |

## 8. 错题自检

- 严格只裁定 `86C9B9` 唯一 P1，没有重开 3101、session、CSRF、sourceVersionTag、数据库、UI 或部署全量审查。
- 没有运行测试、typecheck、server、数据库或网络；没有修改四个候选文件、九个冻结文件、依赖、Spec 或 ADR。
- 已区分单次 WebAuthn verification 与验证后的共享状态 CAS；没有用 challenge 单次消费替代 counter 提交证明。
- 已保留单实例边界、真机 Unknown 与第二 hardware credential 停止线，没有把限定 PASS 扩大成生产放行。

TASK_STATE_OK
