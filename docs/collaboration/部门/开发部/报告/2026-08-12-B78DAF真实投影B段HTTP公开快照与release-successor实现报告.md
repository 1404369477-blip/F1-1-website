---
task_id: TASK-20260812-B78DAF
department: 开发部
status: final
decision: pass
date: 2026-08-12
---

# 真实投影 B 段 HTTP、公开快照与 release successor 实现报告

## 结果

本轮把已 ACK 的 A 段投影 outbox/single sender/无 hash gen1 自举接到一个可本地部署但尚未启用的 B 段闭包。Admin sender 只向 `127.0.0.1:3102` 的精确内部入口发送签名全量快照；响应未知只进入 receipt GET 对账，明确 404 后才允许重投同一包。public receiver/reader 只持有验签公钥和独立 projection root，公开读取每次验证 active pointer、committed generation、Ed25519 签名、manifest 与 records；无 active 返回合法空列表，损坏或链接替换 fail closed，不跨读 Admin DB/私钥，也不在 real 与 synthetic 间请求级回退。

Admin deployment 直接升级为 `admin-service-deployment-v2` 并拒绝 v1；Admin/Public installer 均只 prepare，生成的 plist 固定 disabled，不执行 load/cutover。公开 v0.2 布局、CSS 与设计结构未调整；真实 record 仅恢复普通原文外链语义。

## 运行与 release 闭包

- runtime files：`88`；successor overlay：`29`；固定 `54e694c` base：`59`。
- production dependency packages：`44`；roots 为 `@simplewebauthn/server`、`next`、`react`、`react-dom`、`zod`；M1 平台包为 `@next/swc-darwin-arm64`、`@img/sharp-darwin-arm64`、`@img/sharp-libvips-darwin-arm64`。
- manifest schema：`f1plus1-runtime-release-manifest-v2`；Git commit/tree/parent 固定为 `54e694c13b7369819448a2c3b072cb0fbbc49b7b` / `e5b1d165e1ba6aaca820d15d29be9428dcc6661a` / `5d5963671550b45e9c01fbc727bc6aeac73447e4`。
- 生成 manifest：`.local/release/admin-service-release-manifest.json`，mode `0600`，SHA-256 `7c318e8469fefbef29fd94c06f0cc3f1e290a2517fb6370743a48eb4f7fabb34`；content root `1b45de559d55a8cfa9e69556f9415c43659710b7e42e477abc8c34965afb784d`；release root `73f567da54c38e1ff5c181123fddc6ae2bc34fbcf21009061b74c779bf609c25`。这是本机 ignored 构建产物，目标机须以外部 SHA anchor 重新核验，不能把本路径当部署授权。
- 679786 的 38 项 release 结论已被本 88 文件 successor 替代。依赖闭包仍拒绝任意运行字节 symlink；只排除 npm 包内部 `node_modules/.bin/*` 命令入口链接，真实模块字节仍逐文件绑定。

## A 段吸收与最终身份

| 文件 | A 段 SHA-256 | B 段最终 SHA-256 | 说明 |
|---|---|---|---|
| `app/migrations/rss-real/0003_projection_delivery_runtime.sql` | `0f9d3908b62006158bf6dab60a4969c0bf65b95787d483b4e365f36199a86848` | 同左 | v3 receipt/lease/attempt 运行约束 |
| `app/src/server/review-real/migration.ts` | `9ebb1e87f13a63bcf04ebbeec49d1e3536c36f8c9e4531e866ce668601ecd9af` | 同左 | v3 migration 与 schema fingerprint |
| `app/src/server/review-real/repository.ts` | `29d79c39e1783cf3c88f4765ba21ace063129072be495135ec3e0da403a6f862` | 同左 | single lease、receipt/audit 同事务 |
| `app/src/server/review-real/sender.ts` | `d5c93d59a4c2811bcf3d769c67bc1339eeb60d953b4b09d12a2c353b68b3c02b` | `42e036649d72053ef66ca2bed9115a43c0a60bdbe4432d8995d3d3731f8dd6b5` | 加入固定 loopback HTTP transport |
| `app/src/server/review-real/projection.ts` | `495b2e4a9182e2c1183201eae975892752b88ea9fd35be81467a4362751f471e` | `28524974f1121b346cb85864ae3c293d60681805253ba03207e4a968802ca409` | 加入纯只读、安全文件身份与验签 reader |
| `app/src/tests/review-real-delivery.test.ts` | `c85feb9eee7e66140dc68f6f6e62a2977526f9c072e56c35fe7ed4581288a93c` | 同左 | response-loss/404/gen1/冲突回归 |

## B 段关键冻结 SHA

| 文件 | SHA-256 |
|---|---|
| `app/src/server/review-real/receiver-http.ts` | `bdda80d933156188d064ed608296c49b2386401f63786447abdd47f79b34b11e` |
| `app/src/server/admin-service/deployment.ts` | `f5ce2d89c0afe6f16e23bf9de82d5e3ef2c33ca8dc443ecb81c95da0a7721263` |
| `app/src/server/admin-service/runtime.ts` | `05640d1aa822208ff3e24241a9a634a180349a98fc2cc4554b45b02008c4928f` |
| `app/src/server/admin-service/server.ts` | `a0d7c5d27a4304d662e33ac31527c33bdbb43ed3fe81b7be9cba2161a2cfbf18` |
| `app/src/server/public/deployment.ts` | `4fe7a98bc95dba49edc83f65faaa8ce6265ff5bd83baf684742447b3d755cb4b` |
| `app/src/server/public/snapshot-adapter.ts` | `cce311ddce093205d4e8e965a95c202a3bee5588120cb97d508b77f61ff6c3ee` |
| `app/src/server/public/repository.ts` | `2b5ef415bea49ce8435317df676c64b510170b834d39f3df0b09d50d455460a3` |
| `app/scripts/projection-sender.ts` | `8466c822b127b2187a5a9742c38894c3698ffba0d6c7fe47715ff86d9bd3e410` |
| `app/scripts/public-projection-runtime.ts` | `8830ea0d5834e8d8fdb5a6857719f4d5193dee0c068d0129fd9d71cb2e51c890` |
| `app/src/server/admin-service/release-manifest.ts` | `2378be0eda0adc4980c503d79a591c882c51cd3c260f6cb71b24547a4d86f5d7` |
| `app/src/tests/public-real-snapshot.test.ts` | `afb1fb8c4f12fdbd7d47b96987b417d3a3ce2bcc4afed06d5f6e4475650aed87` |
| `app/src/tests/admin-release-manifest.test.ts` | `54689cef44dcda302023132ee7aae6530552590b8fdc77b1cf4e98d9f07aacbc` |

## 已验证

验证严格沿机械 successor 链消费预算，没有在同一任务失败后重跑：

1. `8D0CBA` 的固定 Node 24 聚焦组一次通过：`5 files / 39 tests PASS`，覆盖 response-loss、HTTP POST/receipt GET、gen1、无 active、active、损坏、symlink fail-closed、deployment-v2 拒 v1、Admin 与环境合同。
2. `BA4EA9` 的固定 Node 24 `tsc --noEmit` 一次通过；该任务未重跑 Vitest。
3. `B78DAF` 的 Admin release builder/fresh-stage 单文件测试一次通过：`1 file / 1 test PASS`；证明 88/29/59 身份、Node、依赖闭包、fresh stage 与 external manifest anchor verifier 一致。
4. builder 本地生成一次成功，回报 `packageCount=44`、`externalCalls=0`。没有启动应用监听、目标服务或浏览器。
5. `B78DAF` 的 tracked 候选 diff-check 已返回 clean；首轮报告 no-index 包装脚本因误用 zsh 只读变量名 `status` 停止。落账后继 `TASK-20260812-6996D6` 只更换临时变量名，对本报告执行一次 no-index diff-check并通过；代码、测试和 release 字节零漂移。

## 回退与未验证

切换前必须同时证明至少一代真实 active snapshot、outbox `succeeded`、real feed/detail 200、Admin/internal 公网路由为 0，以及上一 synthetic release/hash 可用。投递异常先停 sender并保留 DB/outbox/audit；active generation 异常切回上一已验证 active pointer；reader/release 整体异常切回 deployment manifest 中的精确 synthetic release/hash，不改写私有审核、publication、projection 或 outbox 事实。

本任务没有执行 SSH、固定 M1、真实数据库迁移、真实 Ed25519 密钥、真实进程并行、真实网络、`launchctl load`、Tailscale、公开 cutover、压力/故障注入、浏览器视觉矩阵或回退演练。prepare-only 安装器和 release 候选仍须独立安全复审；当前公开站运行态是否已切换保持未验证。

## 错题自检

- 已关闭 macOS `/var` 与 `/private/var` 同 inode 被字符串 realpath 门误拒的问题；目录仍要求同 dev/inode、owner、private mode 且入口非 symlink。
- 已关闭 public runtime 解析 Admin manifest而跨读私钥的问题：public 使用独立 manifest，仅含 projection root、verify key、key ID 与服务身份。
- 已关闭真实 original-link 引入的 disabled union 静态类型扩张；只做类型收窄，无运行行为变化。
- 已机械把发生合法 successor 变化的 `src/server/public/repository.ts` 从固定 base 移入精确 overlay；未批量放宽其他 base blob、owner/mode/nlink、签名、manifest、records 或 fallback 门。

TASK_STATE_OK（在任务工具完成收据落盘后成立）。
