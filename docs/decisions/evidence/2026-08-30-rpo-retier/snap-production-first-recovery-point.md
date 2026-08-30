# SNAP 生产部署与第一个 verified 异机加密恢复点

- 日期:2026-08-30(UTC+8 晚)
- 依据:`ADR-F1PLUS1-DATA-REDERIVABILITY-RPO-RETIER-001` v2(accepted)
- 级别:A 级生产动作,用户逐项确认(异机目的地、密钥托管、首轮真实快照)

## 部署形态

- 代码:`backup-snapshot-once.ts` / `backup-restore-drill.ts` / `backup-snapshot/core.ts` 按 SHA-256 校验同步到生产树(与仓库副本逐字节一致,`core.ts = 8fbc8966cf13…`)。
- 调度:LaunchAgent `com.f1plus1.backup-snapshot`,`StartInterval=900`、`RunAtLoad=true`、`Umask=077`,入口 `deployment/macos/backup-snapshot-cycle.sh`(模板见 `com.f1plus1.backup-snapshot.plist.template`,安装时以 `$HOME` 渲染)。
- 数据路径:快照根在生产根 `backups/snap`(0700);成功后仅镜像密文(`objects/` → `packages/` → `latest.json` 顺序)到 iCloud Drive `F1Plus1-Backups/snap`;明文暂存 `.staging` 与 `run.lock` 永不离机。
- 密钥:32 字节随机密钥,0600,仅存生产机私有目录;副本由用户手动托管至密码管理器(密钥内容未经过任何对话或日志)。`keyId=e2f2c6fc36e07951`。
- 保留:`retain=8`(约 2 小时窗口,对象层按 contentHash 去重)。

## 实测结果

| 项 | 结果 |
| --- | --- |
| 首轮快照(93MB 生产库) | `SNAPSHOT_OK`,全程 2.5s,VACUUM+加密 `elapsedMs=1674` |
| 首恢复点 | `recovery_point_at=2026-08-30T15:09:28.875Z`,`packageId=1788102568875_44474a8646f6c765` |
| schema 一致性 | `userVersion=10` 与部署清单 `reviewSchemaTarget:10` 吻合,`sqliteMasterSha256=9e19c92f…` 源/快照一致 |
| 恢复演练(直接以 iCloud 镜像为 backup-root) | `RESTORE_OK`:`quick_check=ok`、`foreign_key_check=ok`、`user_version=10`、schema 指纹一致、`drill_public_pointer_verified=1`,1404ms |
| 轮转与去重 | 连续三轮(手动 1 + launchd 自动 2)`retainedCount=1→2→3`,库未变时 `SNAPSHOT_DEDUPED`,同 contentHash 仅一个 132MB 加密对象 |
| launchd 自动运行 | `launchctl list` 退出码 0,周期日志 `SNAPSHOT … / OFFHOST_MIRROR_OK` |

## 故障与处置

- launchd 后台任务受 macOS TCC 限制,对 `~/Library/Mobile Documents`(iCloud Drive)无访问权:首轮自动镜像 `rsync: Operation not permitted`,任务退出码 1(快照本身成功,失败非静默)。处置:用户向 `/bin/bash`(launchd 任务的 TCC 责任进程)授予完全磁盘访问权限,复跑 `OFFHOST_MIRROR_OK`。此为该形态的长期运行前提,重装系统或更换入口二进制后需重新授权。

## 回退方式

`launchctl bootout gui/<uid>/com.f1plus1.backup-snapshot`,删除 `~/Library/LaunchAgents/com.f1plus1.backup-snapshot.plist`、生产根 `backups/snap` 与 iCloud `F1Plus1-Backups/snap`。生产库全程只读(`VACUUM INTO` + `busy_timeout=120s`),无需回滚数据。

## 对任务链的影响

`TASK-20260829-BBFF2A` 的前置条件「Backup 闭包 → verified 异机加密恢复点」自此满足;后续 fence/control 推进属其任务范围,本次未触碰 `recovery-fence.json`、control 表或任何生产写路径。
