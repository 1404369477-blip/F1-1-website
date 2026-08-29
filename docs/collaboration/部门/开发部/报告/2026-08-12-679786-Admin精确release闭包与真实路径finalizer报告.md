---
type: implementation_report
department: 开发部
status: final
date: 2026-08-12
related_task: TASK-20260812-679786
decision: pass
tags: [admin, release-manifest, simplewebauthn, node24, fresh-stage]
summary: Admin精确release builder/verifier已闭合；固定54e694c业务基线与四文件tooling overlay，逐文件绑定38项运行闭包、SimpleWebAuthn递归22包、固定Node24及确定性content/release roots；macOS测试stage使用canonical realpath后，三项限定验证各一次通过。
---

# TASK-20260812-679786 Admin 精确 release 闭包与真实路径 finalizer 报告

## 1. 结果

Admin 本地 release builder 与 fresh-stage verifier 已形成可冻结候选。候选只生成和验签本地 release manifest；没有连接固定 M1、没有传输文件、没有执行 prepare/load、没有启动 3101、没有迁移或写入数据库，也没有修改 sender/receiver 业务。

最终闭包绑定：

- Git commit：`54e694c13b7369819448a2c3b072cb0fbbc49b7b`
- Git tree：`e5b1d165e1ba6aaca820d15d29be9428dcc6661a`
- Git parent：`5d5963671550b45e9c01fbc727bc6aeac73447e4`
- runtime file records：`38`
- production dependency packages：`22`，根包为 `@simplewebauthn/server@13.3.2`
- Node：`24.18.0`；二进制 SHA-256 `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`

manifest 的 `contentRootSha256` 和 `releaseRootSha256` 由 runtime file record、22 包 lock version/integrity、递归实际文件/mode/hash、目标 Node 路径/版本/字节 SHA 及 Git 三元身份确定性生成。manifest 文件本身由外部 SHA-256 锚定，fresh stage 逐字重算后才输出 `release-verified`。

## 2. 双层 Git 身份

`BASE_RUNTIME_FILES` 是 `54e694c` 中未被本 release 工具修改的业务运行文件。每项必须：

- 已被 Git 跟踪；
- 当前 blob 与 `54e694c` 精确一致；
- 工作树没有修改或未跟踪替代物。

`TOOLING_OVERLAY_FILES` 精确为四项：

1. `app/package.json`
2. `app/scripts/admin-build-release-manifest.ts`
3. `app/scripts/admin-verify-release-stage.ts`
4. `app/src/server/admin-service/release-manifest.ts`

`package.json` 相对 `54e694c` 只允许新增两条精确 script；其他 canonical 结构、依赖和 package 身份必须相同。Git 状态使用 `--porcelain=v1 -z` 按 NUL 逐 record 解析，要求 package 精确为 ` M`、三个新文件精确为 `??`；禁止第五码、rename/copy、quoted path 或其他状态。

## 3. Node 与依赖边界

- `targetNodePath` 只接受 `/.local/node-v24.18.0-darwin-arm64/bin/node` 固定绝对路径形态，作为 M1 manifest 中的目标路径。
- `localNodePath` 必须等于当前固定 Node 24 的 `process.execPath`，且为 owner 控制、非 symlink、单链接、不可组/世界写的普通文件；它只用于读取并绑定目标 Node 字节 SHA。
- fresh-stage 生产默认要求 manifest target 与目标机当前 `process.execPath` 精确相等；本地测试只通过显式参数模拟 M1 目标路径，没有放宽生产默认值。
- package-lock 从 `@simplewebauthn/server` 递归遍历，必须精确得到 22 包；每包同时绑定 version、integrity、实际 node_modules 递归普通文件/mode/size/SHA 与包内容根。symlink、特殊文件、owner/mode/nlink 漂移均关闭。

## 4. macOS stage 真实路径 finalizer

macOS `tmpdir()` 字符串路径可能以 `/var/...` 表示，而 `realpath` 为 `/private/var/...`。生产 verifier 正确要求 `realpath(manifestPath) === resolve(manifestPath)`；测试 harness 现于创建 stage 根后立即使用 `realpathSync(root)` 作为所有后续复制、manifest 和 verifier 路径，并保持目录 `0700`、manifest `0600`。由此验证真实路径门，不修改或绕过生产门。

## 5. 限定验证

本 finalizer 使用全新预算，三项各运行一次，无重跑：

| 验证 | 次数 | 结果 |
| --- | ---: | --- |
| 聚焦 Admin release Vitest | `1/1` | PASS；`1 file / 1 test`，测试 `1.10s`，总计 `1.18s` |
| 固定 Node24 typecheck | `1/1` | PASS；exit `0`，无输出 |
| `git diff --check --` | `1/1` | PASS；exit `0`，无输出 |

聚焦测试实际完成 builder → canonical manifest → 复制 38 runtime files → 复制 22 包递归文件 → 0600 manifest → fresh-stage verifier → roots 全等的闭环。

## 6. 冻结产物 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `app/src/server/admin-service/release-manifest.ts` | `732c633c98b9ac460d0c48951b9a16932148c0bb3c6b14ae8a6acdd74166697b` |
| `app/scripts/admin-build-release-manifest.ts` | `9bf92eb14482d342827db6346a6e2fbf9ffba2e5019a66e076becc3bb01480da` |
| `app/scripts/admin-verify-release-stage.ts` | `f04b6f20b11ed054141710729232f3d20e074cb92ff8908589f7164667805dd8` |
| `app/src/tests/admin-release-manifest.test.ts` | `10c580e726470e80e3c4056f3c1d47bd53b8639085b8c5c186f7058698f615ff` |
| `app/package.json` | `f1644bf49865d73b4267713a12ba81261da37cd871ead64c0acfedfb0b5d530d` |
| `app/ADMIN-SERVICE-PREP.md` | `9b1f5b4303cf9211660e7da243bf8689c0528b0caca53295311ba14effe349be` |

## 7. 未验证与错题自检

未验证：M1 fresh stage、文件传输、目标所有权/mode 恢复、真实 builder manifest 的最终 SHA/content root/release root、prepare、LaunchAgent load、Tailscale Serve、passkey、真实 migration、3101、sender、公开切换及回退。这些必须由后续部署任务在独立授权和回退锚下实施。

错题自检：未把测试、协作文档、DB、密钥、缓存、`.git` 纳入 M1 runtime；runbook 只作为操作说明，不在 38 个运行文件内；没有删除 Git 基线、放宽 Node 路径、依赖 integrity、外部 manifest SHA、文件 mode 或 single-link 门；历史失败均由各 TASK 保留，本报告只代表 679786 finalizer 的最终 PASS。

TASK_STATE_OK
