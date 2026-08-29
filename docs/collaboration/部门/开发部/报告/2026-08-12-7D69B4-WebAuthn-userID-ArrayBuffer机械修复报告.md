---
type: implementation_report
department: 开发部
status: final
date: 2026-08-12
related_task: TASK-20260812-7D69B4
decision: pass
tags: [admin, webauthn, typescript, mechanical-successor]
---

# TASK-20260812-7D69B4 WebAuthn userID ArrayBuffer 类型边界机械修复报告

## 1. 结果

`TASK-20260812-B2CB5F` 的唯一类型首错已机械闭合。只修改 `app/src/server/admin-service/webauthn.ts`：在调用 `generateRegistrationOptions()` 前，新建与输入字节数相同的普通 `ArrayBuffer`，从其构造 `Uint8Array<ArrayBuffer>`，再用 `set()` 复制原 `userId` 字节。

没有修改接口、认证语义、challenge、RP ID、origin、算法、依赖、测试、服务、UI、backend、package 或 lockfile；没有使用 `as` 强转、`any`、`ts-ignore` 或放宽第三方类型。

## 2. 字节与类型边界

修复代码固定为：

```ts
const userId = new Uint8Array(new ArrayBuffer(input.userId.byteLength));
userId.set(input.userId);
```

- 目标长度精确等于源长度；
- `set()` 从 offset 0 逐字节复制，不改变字节顺序；
- 目标 backing store 明确为普通 `ArrayBuffer`，排除 `SharedArrayBuffer` 泛型分支；
- 官方 SimpleWebAuthn 收到的 userID 字节与原候选相同。

## 3. 冻结身份

| 文件 | B2CB5F 首错 SHA-256 | successor SHA-256 | 结果 |
| --- | --- | --- | --- |
| `app/src/server/admin-service/webauthn.ts` | `a34bc0ace8a627fb2d6431f964fc6eb7c5cd15c261359b54d447cd170d33aa79` | `78d08dd951cf6da2e78be9dde9926c95cbd3cff8db11dbc576911833942e2096` | 仅两行复制边界变化 |
| `app/src/tests/admin-service.test.ts` | `7fff56cf99d18c89b5f284794aae28af8bc9648dddd215704aa331dfd5ad6a46` | 同左 | 未改 |
| `app/package.json` | `a55f3047f3d987e99d5ab7fc4b124f01638c64ed90c74e8033b5a8084ba80808` | 同左 | 未改 |
| `app/package-lock.json` | `09af041323719abb803b7ebf306a82028810d6189af46702a3fd122c422ab24d` | 同左 | 未改 |

## 4. 限定验证

| 验证 | 次数 | 结果 |
| --- | ---: | --- |
| B2CB5F 聚焦 Vitest | 继承 `1/1` | PASS；本 successor `0` 次重跑 |
| 固定 Node24 全项目 typecheck | `1/1` | PASS；exit `0`，无输出 |
| candidate `git diff --check --` | `1/1` | PASS；exit `0`，无输出 |

首错策略未再次触发。

## 5. 边界

- 网络安装、SSH、固定 M1、服务 load、Tailscale、真实数据库、真实 passkey、sender 与 public switch 均为 `0`。
- 本结论只关闭 TypeScript `ArrayBuffer` 泛型首错；B2CB5F 报告列出的真实设备、网络、恢复和生产部署 Unknown 保持不变。

## 6. 错题自检

- 没有靠类型断言隐藏错误；目标 backing store 在运行时真实创建。
- 没有重跑已 PASS 的聚焦测试来消耗重复预算。
- 没有利用机械修复扩展到其他文件或任务外部署能力。

TASK_STATE_OK
