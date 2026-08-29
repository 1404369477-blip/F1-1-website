---
task_id: TASK-20260812-F3FA8B
department: 开发部
status: final
decision: pass
date: 2026-08-12
predecessors:
  - TASK-20260812-3CDDF8
  - TASK-20260812-C59E17
---

# 四根解耦 deployment-v3 与 existing-only 私库实现报告

## 结果

已按 `ADR-M5-REAL-PROJECTION-RUNTIME-003` 落地本地候选：Admin deployment 升级为 v3，target release、唯一 review SQLite、synthetic rollback 与 public data/projection 根分别承担单一语义；Admin HTTP 与 sender 从同一 manifest 使用同一路径和文件身份；public prepare 从独立旧 live 根核验 rollback，并只把新 plist 指向 target release。

## 实现闭包

- Admin manifest 新增 `targetReleaseAppRoot`、`reviewDatabasePath`、`reviewDatabaseIdentity={dev,ino,uid,nlink=1}`、`reviewSchemaTarget=3`，v1/v2 严格拒绝。
- Admin prepare 只做已存在私库的路径、父目录、权限、owner、单链接和 `lstat/O_NOFOLLOW/fstat` 身份门，不创建或迁移数据库。
- existing-only opener 不放宽通用 `openSafeDatabase`：缺失不创建，只接受精确绝对路径和既有 inode；连接先拒绝 `ATTACH/DETACH`，再核验 WAL/FULL/foreign keys、版本、schema、`database_list`、foreign keys 与 integrity。user_version 1/2 原位只追加至 3，3 仅复验。
- Admin runtime 与独立 sender 均只使用同一 canonical deployment manifest 的数据库路径及身份，不接受环境或请求级数据库覆盖。
- public installer 将 target release 与 `F1_PUBLIC_SYNTHETIC_ROLLBACK_APP_ROOT` 分开；rollback `BUILD_ID` 与 synthetic SQLite hash/身份只从旧根读取。
- public deployment manifest 升级为 v2，记录 target、rollback、public data/projection 根和 rollback DB 收据；新三份 plist 只指 target release，保持 `RunAtLoad=false`、`KeepAlive=false`。
- 公开日志迁到 `publicDataRoot/logs`，prepare stage 使用系统 canonical 私有临时目录；target release 不承载日志、stage 或 real-mode synthetic DB 依赖。
- release runtime 维持 89 文件，successor overlay 由 30 增至 31，`src/server/db/database.ts` 从 base 身份移入精确 overlay。

## 验证收据

- 前置 3CDDF8：聚焦 Vitest 首轮 3/4 文件通过、8 tests PASS，唯一失败为测试变量名重复；按首错停止。
- 前置 C59E17：变量名修正后生产 SHA 零漂移；聚焦 Vitest 3/4 文件通过、9 tests PASS，唯一失败为 macOS `/var` 非 canonical 测试夹具；按首错停止。
- 本 finalizer：只把 Admin 测试临时根改为 `mkdtempSync(realpathSync(tmpdir()))`；领取前后十个生产文件 SHA 全部不变。
- 固定 Node 24 聚焦 Vitest：1 次，`4 files / 10 tests PASS`。
- 固定 Node 24 TypeScript `--noEmit`：1 次，PASS。
- 14 个限定候选文件 `git diff --check`：1 次，PASS。

## 冻结 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `app/src/server/admin-service/deployment.ts` | `32a82364aeeb0860b50bd240dfa9c7511bd313debb42c8853b5d09004ab34555` |
| `app/src/server/admin-service/runtime.ts` | `513b3d74bb9fae8b978a31dc477370062b20286b2b053763b38ae6c4567e5a8d` |
| `app/src/server/db/database.ts` | `2aab55cc0bd9b83b312e6a1492c4680541c05a2f159f4eaa72941b6d3d7adc57` |
| `app/src/server/review-real/migration.ts` | `149e7e143640be5be7fbe21202c3705709d371b165e3e9a281c45890fc431004` |
| `app/scripts/admin-install-macos.ts` | `1b52929a051646aad34a5aa8aaffc54da1506580460afa9f9beac8eb4489f337` |
| `app/scripts/admin-service.ts` | `82731b74dda8ab5f33483d353e93666bf0371eed82ca254fac3f729606275179` |
| `app/scripts/projection-sender.ts` | `03387aedfceccd8b5ea5d96e99e95d84f4ef21dbf700c7de4b04c87b6d631e` |
| `app/src/server/public/deployment.ts` | `d126d60c09d79ce26baf03a93e1cc93f17d308df221c264d61fb7b46c5f5d05e` |
| `app/scripts/install-macos-public-beta-core.ts` | `2039c6e25de03721739bb81d030467fd67f10c00d506a6d2b21355eec4902a20` |
| `app/src/server/admin-service/release-manifest.ts` | `4e452f503f3cb1a71798d45ed2d5c558c8da5cfa440409d14eabf9265e0eee05` |
| `app/src/tests/admin-service.test.ts` | `faea3cf55ec46352b4e422296416c0cbb3ac6214921b179b3c368b89979a4593` |
| `app/src/tests/public-install-release.test.ts` | `e389aab3ffc06a14ec38d1bf696c01296c64c1b83ffd8628e067e721cf167807` |
| `app/src/tests/admin-release-manifest.test.ts` | `51efeec218dcdfc6c41f7a214f04f833ddba486be8fd8dba70c7428ad6515ede` |
| `app/ADMIN-SERVICE-PREP.md` | `651c87752c272afb517d61df2ba91ae1292d037f9cfd9dcd435142d87dcf1e4d` |

## 未验证边界

- 未 build，因此本次源码变更尚未生成新的 production `.next` 与外部 release manifest roots；必须由独立 release successor 完成。
- 未连接 M1、未读取或迁移真实 RSS 数据库、未执行 public/Admin prepare、未写 plist、未调用 `launchctl`，也未进行 load/cutover。
- 未验证真实 RSS 下一自然周期与迁移后的同 inode 兼容写入、真实 generation 1、Tailscale/Passkey 或公网 real-mode。

## 错题自检

- 未用测试便利放宽 production `realpath/O_NOFOLLOW` 门；两次 fixture 问题都由机械 successor 只改测试。
- 未修改审核领域语义、公开视觉、Tailscale 身份或 RSS collector plist。
- 没有把本地测试 PASS 表述为目标机部署、真实 DB 迁移或公开上线完成。
