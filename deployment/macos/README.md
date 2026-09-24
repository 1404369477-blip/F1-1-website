# F1+1 macOS 部署与备份入口

> 当前运行钉与接续顺序统一读取 [当前生产状态与执行待办](../../docs/当前生产状态与执行待办.md)。9月12日传输后继已安装并通过三自然周期；本目录模板已增量同步M1 idle 30秒/RunAtLoad=false与M5 idle 20秒，精确生产路径和hash以收据为准。下方9月7日参数是历史，不能直接覆盖现役配置。

## 2026-09-07 备份 v2 历史验收

**2026-09-07 01:08（Asia/Shanghai）核收状态：备份 v2 已完成生产切换，并通过 1 轮 RunAtLoad 与 2 轮实际自然周期；M1 iCloud 附加归档在三轮中均失败，独立异机副本、应用演练及合法登记通过。** [三轮独立验收](../../docs/reviews/evidence/2026-09-06-backup/live-v2-production/independent-acceptance.json) 覆盖 00:46–01:07 的实际运行；该窗口内替换旧有效恢复点前的最大年龄为 **638.327 秒，小于 15 分钟**。不据此保证未来周期，真实 Passkey 恢复仍未验证。统一执行入口见 [当前生产状态与执行待办](../../docs/当前生产状态与执行待办.md)。

M1 的实际运行包为 `~/F1-1-website/backup-runtime-releases/20260907-v2-05`，runtime 根 SHA-256 为 `ad5749603246a2ea6b967ea0b205cceb7faa2da1b88d6894014254ed81306a17`。当前备份 plist 使用 **ProcessType=Standard、StartInterval=300、RunAtLoad=true**；materialized plist SHA-256 为 `7d0b55b54a0d286a85f4637c4048cb60603154d08f214f6ea567e483516a9d7c`。最初 Background 运行在快照 120 秒期限处失败，已停备份并按身份恢复残留锁，失败证据保留且未计入成功三轮；切换 Standard 时未放宽超时或验证。安装、退休 helper 与锁状态见 [部署证据索引](../../docs/reviews/evidence/2026-09-06-backup/live-v2-production/deployment/evidence-index.json) 和 [最终只读状态](../../docs/reviews/evidence/2026-09-06-backup/live-v2-production/deployment/final-install-and-lock-state.json)。

三轮合法登记使 backup/valid-view 记录由 95 增至 98，control 与公开 anchor 未改变，fence 恢复点单调推进；Public/Admin/Projection 进程身份保持不变，Public health/feed 读取通过。三轮应用演练耗时 **35.782–44.110 秒**，仅证明当前签名收据覆盖的隔离启动与访问探针，不能扩大为真实 Passkey 或灾难时整机恢复已验证。三轮结束后本次临时大文件按精确清单清理：M1 13 文件、M5 1 文件；执行前后可用空间实测分别增加 **2.746731 GiB / 0.312725 GiB**，已独立复核消失与证据保留。详情见 [第二批清理证据](../../docs/reviews/evidence/2026-09-06-backup/live-v2-production/cleanup/README.md)。

本轮总收口见 [全项目审计与收尾报告](../../docs/reviews/2026-09-06-全项目审计与收尾报告.md)，备份故障与救援历史见 [事故报告](../../docs/reviews/2026-09-06-备份事故诊断与受控恢复方案.md)。下方旧 synthetic beta 初始化命令不适用于当前 schema10/0012 生产，不能用来重建或覆盖现活服务。

| 工具 | 当前代码职责 | 使用边界 |
|---|---|---|
| `verify-backup-runtime.mjs` | 使用固定 Node24.18.0 逐文件验证运行闭包及根 hash | 从已核验工具目录运行，预期 hash 来自部署收据，不从待验证目录自授信 |
| `backup-snapshot-cycle.sh` | M1 快照 → M5 独立签名收据 → 真正隔离应用演练 → 合法登记/fence → 可选 iCloud 归档 | 只切备份 job；业务服务、control/schema、writer authority 不随本脚本自动切换 |
| `backup-off-host-observe.sh` / `backup-off-host-transfer.mjs` | M5 经固定 `home-mac` SSH 拉取精确密文，Application Support 内实读签名，向 M1 `backups/off-host-receipts` 原子回传小收据 | M5 不持有 AES 解密密钥，不传 DB 明文；固定运行包和独立签名私钥由实际安装步骤核验 |
| `backup-application-drill.mjs` / `backup-admin-drill-child.mjs` | 用恢复副本启动隔离 Admin/Public 并取得签名演练证据 | 验证应用可启动、访问门与公开业务读；不代表真实 Passkey 恢复、生产切换或灾难时整机恢复已通过 |
| `bounded-backup-command.mjs` | 给命令设置期限并终止进程组后代 | 超时/清理失败必须保留失败状态，不能复用前次成功收据冒充本轮成功 |

备份 v2 的有限保留配置为：M1 SNAP **24 个已验证完整包**，M5 cache **2 份完整包**，小收据按 **7 天**规则处理，运行日志超过 **5 MiB** 时轮换并保留 `.previous`。M5 当前/cache 收据受保护，未知、不完整、异常链接或不可信内容保留并需人工核对；日志阈值、包数与正常失败清理都不等于全盘绝对字节上限。完整清理范围及例外见 [双机存储与保留策略](../../docs/reviews/2026-09-06-双机存储审计与保留策略.md)。本次已退休的旧 M5 `com.f1plus1.admin-backup` 不应恢复加载。

iCloud 仅为附加归档：M5 在小收据已返回 M1 后，以最多 5 秒的独立 worker 归档；失败保留 `receiptReturnedToM1=true` 并标记 `ARCHIVE_FAILED`。M1 在合法登记后以最多 60 秒镜像密文，三轮实测均显示 `archiveStatus=failed / ICLOUD_ARCHIVE_FAILED`，后续仍需排查其可用性。M1 目标 `snap/objects`、`snap/packages` 使用 `rsync --delete-after` 跟随源集合，必须只存本 producer 的镜像；不要在其中保存唯一恢复点或人工文件。iCloud 目录出现、metadata 可见或 rsync 成功均不能替代 M5 独立实读证明。

## 手工 deploy / restore / 登记之前

新 fence 写入者应共同使用 `recovery-fence.json.writer-lock`（`withRecoveryFenceWriterLock`）。当前工作区新版部署初始化与登记器已有该保护；**旧 sealed release 内的手工工具没有因 backup-only 切换自动获得它**。

1. 先确认实际业务部署与备份 runtime 身份，暂停备份调度，等待活动周期、登记器及子进程退出；读取锁状态，不按年龄直接删锁。
2. 只使用已验证兼容同一 mutex 的新 deploy/restore/登记工具；记录具体入口与 SHA。未验证旧工具兼容时，不得让其与备份周期并行写 fence。这里的“locked 工具”是行为要求，仓库没有一个可通用照抄的 `locked-deploy` 或 `locked-restore` 命令。
3. 实际写入前核对恢复目标、备份点、rollback、fence/control 预期；不热改旧 sealed 文件、不手工更新恢复时间戳、不覆盖未知 `.writer-lock`。`backup-lock-recover.ts` 只适用其已定义的 SNAP 锁恢复合同，不能泛化为清除所有锁。
4. 操作成功后复核服务、控制状态和新恢复点证据，再按核验过的 plist 恢复备份并观察自然周期。若回退到旧登记器重新出现 live 阻断，明确显示“快照可继续、登记未恢复”，不宣称备份健康。

## 历史：固定 M1 临时 synthetic beta

> **历史 synthetic beta 指南**：以下初始化、安装和回退步骤不适用于当前 schema10/0012 生产环境。现行入口见 [当前生产状态与执行待办](../../docs/当前生产状态与执行待办.md) 和 [2026-09-06 审计](../../docs/reviews/2026-09-06-整体回扫与推进方案.md)，禁止按本历史指南重建或覆盖现活生产。

本目录只服务第一版公开 synthetic beta。长期拓扑仍要求公开站与 Admin 主机分离；本次把固定 M1 同时作为公开 beta 主机，是用户在 2026-08-11 明确选择的阶段性方案。

## 已关闭的部署缺口

- Git fresh clone 不包含 `app/.local`：`release:bootstrap` 从版本化、纯 synthetic、固定 SHA 的两份 legacy SQLite 建立本机 0600 副本，再由既有 validator 生成新收据并创建公开多媒体数据库。
- legacy receipt 只有 24 小时有效：独立 launchd agent 每 12 小时刷新一次；失败时公开读取会按现有合同失败关闭。
- 公网路径不能依赖隐藏 URL：production `serve.ts` 在 `public-multimedia-synthetic` profile 下只允许 GET/HEAD 的首页、详情、公开 API、health 和 Next 静态资源；Admin 与其他路径统一返回 404。
- 服务重启：用户级 launchd 负责 application KeepAlive；第一版要求专用运营用户保持登录、Mac 长期供电且禁止睡眠。

## 目标机顺序

以下动作必须在非 iCloud 的本地 Git checkout 中执行，Node 必须精确为 `24.18.0`：

```sh
cd app
npm ci
npm run release:bootstrap
npm run build
npm run release:install-macos-agents
```

安装脚本只写入两份用户级 plist，不会自动加载。确认旧服务已停止后再依次执行：

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.f1plus1.receipt-refresh.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.f1plus1.public-beta.plist"
launchctl kickstart -k "gui/$(id -u)/com.f1plus1.receipt-refresh"
launchctl kickstart -k "gui/$(id -u)/com.f1plus1.public-beta"
```

只做四个上线前检查：

```sh
curl -fsS http://127.0.0.1:3000/api/health
curl -fsSI http://127.0.0.1:3000/
curl -fsSI http://127.0.0.1:3000/stories/public-page2-race-news-24
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/admin/sources
```

前三项应为 200，Admin 路径应为 404。公网隧道只允许转发 `http://127.0.0.1:3000`；禁止路由器端口转发、UPnP 和公网 Admin 旁路。

## 暂停与回退

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.f1plus1.public-beta.plist"
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.f1plus1.receipt-refresh.plist"
```

回退时保留 `.local` 和日志，切回上一个已记录的 Git commit，重新执行 `npm ci`、`release:bootstrap`、`build` 和 plist 安装，再加载服务。不得复制运行中的 SQLite `-wal`/`-shm` 作为回退资产。

## 尚未关闭

- 公网隧道供应商、域名和中国大陆真实访问质量尚未确定。
- 用户级 LaunchAgent 依赖图形用户登录；无人值守开机前服务和 FileVault 启动前恢复仍需后续升级为专用 LaunchDaemon/受控现场方案。
- Wi-Fi、断电、睡眠、系统更新和 8 GB 内存的长期数据尚未观察；第一版上线后用真实日志决定是否迁移独立主机。
