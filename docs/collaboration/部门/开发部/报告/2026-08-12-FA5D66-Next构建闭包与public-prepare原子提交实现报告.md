---
type: implementation_report
department: 开发部
status: final
date: 2026-08-12
related_tasks: [TASK-20260812-FA5D66, TASK-20260812-86A926, TASK-20260812-EFE9FE, TASK-20260812-0E594C]
decision: pass
---

# Next 构建闭包与 public prepare 原子提交实现报告

## 结论

安全报告 D17D1B 的唯一 P1 已由本 successor 链闭合：production `.next`、89 项运行文件、44 个 production package 与固定 Node 24.18.0 共同进入外部 SHA 锚定的 release manifest；public prepare 在任何 live plist 写入前验证同一 manifest/Node/依赖/Next/回退/公钥/身份，并先完成任务私有 stage。public-beta、quick-tunnel、receiver 三份 plist 仅在全部 prepare 成功后原子替换，提交中断会逐字恢复旧文件。三份 plist 均为 `RunAtLoad=false`、`KeepAlive=false`；没有调用 `launchctl`。

## 精确闭包

| 项目 | 最终值 |
|---|---:|
| runtime / overlay / base | `89 / 30 / 59` |
| `.next` 文件 / 字节 | `322 / 13,373,354` |
| `.next` mode | `322 × 0644`；`57 × 0755` 目录；执行文件 `0` |
| 明确排除 | `9` 项 build cache/diagnostics/trace/turbopack |
| production packages | `44` |
| dependency root | `517c29e4a226a5a47ccee85a5063c9ca985aff124760af936acec5c867dd2ffe` |
| Next root | `b11ef505eda7b8397f074be03716e8b01f97ccb7438f37f7338581054155966c` |
| content root | `e9eee919236dcb64bfe6b39b82d8cefa6bbb36495d7bdbdb3368f457010adb22` |
| release root | `4f3e25b9764e2664857acf99381e0b4d87657006eef2ede66df9c3cafecd43cd` |
| manifest 文件 SHA-256 | `16fdd3a49ba3b995806e52c712a8bce5c9699c31506a68015e7ff9979682cc06` |

builder 在 fresh build 后先拒绝 symlink、异主、多链接、special file 或 realpath 越界，再通过已打开文件描述符把非执行闭包文件归一到 `0644`、目录归一到 `0755`。target verifier 全程只读并逐项重算 path/mode/size/SHA；它不执行 chmod。私钥、DB、release/deployment manifest 与 plist 的 `0600`、私有目录的 `0700` 没有放宽。

## 验证收据

- 继承 FA5D66 固定 Node 24 production build 唯一一次：PASS；Next 16.2.11 编译、TypeScript、页面生成通过，保留现有 NFT tracing warning。
- 继承 86A926 builder：PASS；生成上表唯一 manifest 与 roots，`externalCalls=0`。
- `TASK-20260812-0E594C` 固定 Node 24 聚焦 Vitest 唯一一次：PASS，`2 files / 5 tests`。覆盖 fresh stage、Next 字节/mode漂移拒绝、错误外部 SHA 零 live 写、全 stage 失败零 live 写、提交中断旧 plist 恢复、成功三 plist disabled/no launchctl。
- 固定 Node 24 typecheck 唯一一次：PASS。
- 限定 diff-check：PASS。

## 回退与边界

public deployment manifest 同时绑定外部提供并与本机字节核对的上一 synthetic `BUILD_ID` 与 SQLite SHA-256。prepare 任一步失败恢复原 plist/manifest/log 字节并删除任务 stage；本任务没有执行 load、cutover、服务启动或数据库迁移。真实 M1 文件身份、listener、sender→active、公开 feed/detail 与 synthetic 回退演练仍需目标机后继验证。

## 0 外部操作

本链为本地 build/manifest/test/typecheck/diff；SSH=0、M1 操作=0、网络=0、真实 DB 写=0、`launchctl`=0、load=0、cutover=0。

TASK_STATE_OK
