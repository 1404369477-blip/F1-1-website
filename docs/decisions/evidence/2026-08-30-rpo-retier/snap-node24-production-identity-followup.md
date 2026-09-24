# SNAP Node 24 与生产字节身份后继只读收据

- 核验时间：2026-08-31 09:12（Asia/Shanghai）
- 性质：`TASK-20260830-370AD2` 之后的独立生产只读收据
- 边界：保留 370AD2 原报告的 Node 22 / disposable 历史语义；本收据证明相同三份 SNAP 代码随后以 Node 24.18.0 在 93MB 级生产库运行，不倒写原任务当时的验证结果。

## 三方字节身份

候选基准 commit：`5847c07`。

| 文件 | commit `5847c07` SHA-256 | M5 当前工作树 SHA-256 | M1 生产部署 SHA-256 |
| --- | --- | --- | --- |
| `app/scripts/backup-snapshot-once.ts` | `824ae28e74664a281d6c9b73acec1b6902892949311d4acbb35fc99f72f8d439` | `824ae28e74664a281d6c9b73acec1b6902892949311d4acbb35fc99f72f8d439` | `824ae28e74664a281d6c9b73acec1b6902892949311d4acbb35fc99f72f8d439` |
| `app/scripts/backup-restore-drill.ts` | `33fb38a98ec7e822e4af3ae5c209301fdd19b47194498c2433f7b342febe8031` | `33fb38a98ec7e822e4af3ae5c209301fdd19b47194498c2433f7b342febe8031` | `33fb38a98ec7e822e4af3ae5c209301fdd19b47194498c2433f7b342febe8031` |
| `app/src/server/backup-snapshot/core.ts` | `8fbc8966cf137155e3d577ad34582583c49b5abaedc56501d79e13f2ee6cc60a` | `8fbc8966cf137155e3d577ad34582583c49b5abaedc56501d79e13f2ee6cc60a` | `8fbc8966cf137155e3d577ad34582583c49b5abaedc56501d79e13f2ee6cc60a` |

方法：commit 列由 `git show 5847c07:<path> | shasum -a 256` 得到；M5 与 M1 列分别对现场文件运行 `shasum -a 256`。三行逐项相等。

## 实际 Node 与生产轮

- M1 周期脚本实际调用的钉定二进制：`[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node`。
- 现场直接执行该二进制 `--version`：`v24.18.0`。
- 生产 SQLite 文件大小：`97,533,952 bytes`（约 93.0 MiB）。
- 现场最新成功轮：
  - `recoveryPointAt=2026-08-31T01:03:04.724Z`
  - `packageId=1788138184724_a9d4786752f47d3e`
  - `userVersion=10`
  - `sqliteMasterSha256=9e19c92fc1a6230ae6b7c1bf14da4a84cf9c6dcc1c107040de207650839fc0a5`
  - `SNAPSHOT_OK elapsedMs=15555`
  - `OFFHOST_MIRROR_OK` at `2026-08-31T01:03:24Z`
  - `REGISTER decision=SUCCESS / bindingPassed=true / validBackupRecoveryPoint=true` at `2026-08-31T01:03:35Z`

## 结论与限制

这份后继收据关闭了 370AD2 原报告中「钉定 Node 24.18.0 未复验」与「生产等容真实 DB 未测」的后续生产运行疑问，因为生产运行使用的三份承重代码与 370AD2 候选 commit 字节相同。370AD2 的原始任务 JSON 与报告仍保留当时 Node 22 / disposable 的 `unverified`，不能把本收据解释成原任务当时已经完成全部 acceptance_exit。

本收据没有重新运行 370AD2 的故障注入矩阵，也没有执行任何生产写、服务启停、LaunchAgent 操作或密钥读取。
