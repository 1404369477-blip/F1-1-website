---
task_id: TASK-20260812-A156EC
department: 开发部
status: final
decision: pass
date: 2026-08-12
---

# M1 fresh-stage 分块传输与目标验签最终报告

## 结论

M1 上的全新隔离 stage 已通过目标端 release verifier 的唯一一次执行；公开服务和 RSS 900 秒自然调度的 postflight 语义不变量通过。本链路未执行 formal overlay、prepare、launchctl load、数据库写入、key 生成或 cutover。

## 冻结身份

- Local retained tar: `aad604e911687faefdd10d7dfb1bf2cc988345fb30357c075f43c970f4f149df`, `399386112` bytes。
- Chunk manifest: `ad129147281b7543bab3fbea46097dde8655726593e8bcd054b35d7158f0c5db`；固定 16 MiB，共 24 块，最后一块 `13510144` bytes。
- Reassembler: `b041f23b4863a65a2f8d3711327a1776ce4bed8673b1e2a3baed77a991b2a9ed`；远程 Node 24 `--check` 通过，聚合只执行一次。
- External release manifest: `58b6da76890d1ccb800624f6915c6f0ddd7f9a37b51e6fcafd6c16b6a9e9c95f`，mode `0600`。
- Content root: `b3886d55e093baf50a89d260c21898d4987c77f583ef8e5960f2ca3ba012e987`。
- Release root: `f868497562332e6b365479f48105aba298783aa23513a0b962ac2ba318f462a6`。
- Next closure: 322 files / `13373354` bytes / `b11ef505eda7b8397f074be03716e8b01f97ccb7438f37f7338581054155966c`。
- Production dependency closure: 44 packages。

## M1 产物路径

- 分块、manifest 与重组 tar：`[M1-HOME]/F1-1-website/.projection-release-TASK-20260812-04E33E/`
- 最终全新 stage app root：`[M1-HOME]/F1-1-website/.projection-release-TASK-20260812-D9A84D/stage/app`
- Stage 集合身份：12082 个常规文件，1152 个目录，0 symlink，所有对象 uid 501，常规文件 nlink 1。

## Target verifier 唯一执行

M1 固定 Node `[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node` 在 stage 中返回 `status=release-verified`，并确认上述 content/release/Next/dependency roots；`externalCalls=0`。未重跑 verifier。

## Postflight

- 当前 feed 返回的第一个合法 `publicId` 为 `public-page2-race-news-24`；对应 API 详情和页面详情均为 HTTP 200，home/health 均为 200。
- Public DB 仍为 SHA `949c78d505e4c032d2495174deaf62d24f9d99b76284ad7ba6fb29a5ac83bb50`，737280 bytes，inode 24546198，mode 0600，uid 501，nlink 1。
- RSS schema `user_version=1`、integrity `ok`；source enabled 1 / stop_epoch 4 / reason `OK`；35 runs，running 0，最新 run `succeeded/OK`，new 0 / updated 0 / duplicate 20。
- RSS 候选 20 条且全部 `pending_review`，machine invalid 0，四项人工编辑非空计数均为 0。
- RSS LaunchAgent loaded，state `not running`，run interval 900 seconds，last exit 0。数据库 SHA/大小可随该自然周期变化，本报告未把它误写为字节零漂移。

## 边界与下一步

本节点证明发布闭包可在 M1 全新 stage 被精确验签，不代表已安装或切流。下一个部署任务建议从上述 stage app root 复制到新的、版本化 release 目录，再单独执行 prepare-only；仍需独立用户授权与回滚锚点，不应直接复用当前 live app 目录。

## 错题自检

- 大 tar 首次单次 scp 发生截断；后续用独立 task 和逐块收据完成，未覆盖或清理旧失败证据。
- 旧 synthetic detail slug 已失效；postflight 改为从当前 feed 提取 publicId，未通过改数据或路由获取 200。
- RSS 定时任务在验签期间自然执行；最终按语义不变量验收，不把自然 DB 变化当作 stage 写入。
