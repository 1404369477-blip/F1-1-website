---
type: department_report
status: final
date: 2026-08-12
department: 开发部
task_id: TASK-20260812-F055A6
decision: pass
external_calls: 0
---

# Next 空目录 xattr 探针兼容与 manifest 验签报告

## 结论

三项 fresh-build 重复空目录已按 69A83A 安全裁定逐项完成 fresh 身份门与唯一一次非递归 `rmdir`；production build 没有重跑。M1-target builder 唯一一次通过，新 manifest 已按外部 SHA 在本机实际闭包验签通过。

## 三项删除收据

三项在删除前均满足：位于 real `.next` root、real directory、non-symlink、realpath exact、uid501/gid20、dev `16777230`、nlink2、size64、entry0、hidden flag `0x8000`、无 ACL/xattr/mount 异常；紧邻删除前 descriptor 的 dev/ino/uid/gid/type/mode/empty 与 lstat 一致。

| 路径 | inode | mode | rmdir | 回读 |
|---|---:|---:|---:|---|
| `.next/server/app 2` | `5952530` | `0700` | 1 次 | absent |
| `.next/server/chunks 2` | `5952505` | `0755` | 1 次 | absent |
| `.next/static/chunks 2` | `5952506` | `0755` | 1 次 | absent |

正常同名目录保持非空：`server/app` 13 项、`server/chunks` 77 项、`static/chunks` 13 项。

## Builder 与 manifest

- Builder：唯一一次 PASS，`status=built-from-fixed-git-identity`，`externalCalls=0`。
- Git commit/tree/parent：`bb0aa0266b73b7b2f7af38d3f29ac0a07dee772f` / `2fdf2078daf7bb2c6327d19c6c8c81809465abf2` / `2ff1bdba83eadddf01908bfbc884d8efcd0d84d1`。
- Manifest：`app/.local/release/admin-service-release-manifest.json`，uid501、mode0600、nlink1、realpath exact、canonical JSON。
- Manifest bytes：`1,859,487`；SHA-256：`6f4642999797aea6d220cc01ec4d9500416a37a5db7de8eaafc573991bff770d`。
- Runtime：89 files。
- Next：322 files、`13,399,239` bytes、root `40746f5fd74751c9e1890403e7ba8e15c4b027a6cceb954bdda867ac53c1ec7c`；322 files mode0644、54 directories mode0755。
- Production packages：44；dependency root `517c29e4a226a5a47ccee85a5063c9ca985aff124760af936acec5c867dd2ffe`。
- M1 Node target：`[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node`；SHA-256 `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`。
- Content root：`d42c42cbccd2314ff53a012de64e7606a1872b8853a2d182c5079d3c35e5fefe`。
- Release root：`d186e4285198e78185aaa23a0c218313c78f2adf0aa5f377fbf380dc01307de1`。

## 闭包外 harness

- 路径：`scratch/TASK-20260812-F055A6/verify-m1-target-manifest.mjs`，Git ignored。
- Parent mode0700；file mode0600、uid501、nlink1。
- 固定 Node 24 `--check`：唯一一次 PASS。
- 实际 `readVerifiedAdminReleaseManifest()`：唯一一次 PASS；以新 manifest SHA 为外部先验，显式 M1 target path 与本机 `process.execPath` 重算 runtime、Next、packages、Node、content/release roots，`externalCalls=0`。

## 未验证边界

未执行新 build、Git 写、push、SSH、M1、DB、prepare、load、cutover、delta 或传输。manifest 目前只完成本机 M1-target 语义验签，尚未在 fresh M1 stage 上验证。

TASK_STATE_OK
