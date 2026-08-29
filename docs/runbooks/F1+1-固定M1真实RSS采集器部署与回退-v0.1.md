# F1+1 固定 M1 真实 RSS 采集器部署与回退 v0.1

## 当前边界

本 runbook 只适用于 `com.f1plus1.rss-collector` 部署候选。安装器只准备私有 SQLite、deployment manifest 与 LaunchAgent plist，输出 `prepared-no-bootstrap-called`，不会调用 `launchctl bootstrap`，也不会声称目标机原先没有同名 job。安全部对代码候选和部署候选分别确认 `P0=0/P1=0`、统筹部下发独立 SSH 实施任务前，不得在 M1 执行以下命令。

固定事实：

- M1 app root：`[M1-HOME]/F1-1-website/app`，必须为非 iCloud 路径。
- Node：`[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node`，版本必须为 `24.18.0`。
- label：`com.f1plus1.rss-collector`。
- schedule：`RunAtLoad=true`、`StartInterval=900`、无 `KeepAlive`。
- SQLite：`app/.local/f1plus1-rss-real-private.sqlite`，profile `rss-real-private`。
- release manifest：`app/.local/release/rss-real-release-manifest.json`，其最终文件 SHA 必须由统筹部通过独立通道传入。
- manifest：`app/.local/rss-real-deployment-manifest.json`。
- plist：`[M1-HOME]/Library/LaunchAgents/com.f1plus1.rss-collector.plist`。
- 日志：`app/.local/logs/rss-collector.stdout.log` 与 `rss-collector.stderr.log`。
- 每次真实执行入口：`app/scripts/rss-scheduled-run.ts`；它在动态导入 collector 前复核外部 release manifest 锚、完整运行闭包、目标 Node、deployment manifest 与 DB schema。

## 部署硬门

执行者必须先取得并逐项核对：精确 Git HEAD、独立 release-manifest SHA-256、确定性 release/content root、完整生产运行文件闭包、package-lock 递归解析出的 `fast-xml-parser` 全部生产依赖目录 content root、目标 Node 绝对路径/版本/二进制 SHA、migration/schema/profile/DB path、collector/installer/control/deployment module/plist SHA，以及安全部对同一候选的部署门结论。任一 hash、路径、权限或候选状态不匹配时立即停止。

本 runbook 不授权修改公开 synthetic 数据库、公开页面、LaunchAgent 以外的服务、SSH 配置或网络配置。

## 1. 从干净 Git HEAD 构建 release manifest

只在精确提交完成、运行文件闭包全部 tracked 且无 staged/unstaged/untracked 漂移后，由 M5 固定 Node24 执行：

```sh
cd [M5-HOME]/Documents/F1+1/app
RSS_TARGET_NODE_PATH='[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node' \
./.local/toolchains/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types scripts/rss-build-release-manifest.ts
```

builder 从真实 `git rev-parse HEAD` 取 commit，拒绝显式运行文件清单中的 dirty/untracked 项；逐文件绑定 scheduled wrapper 与 collector 传递闭包，并从 lock 递归解析 `fast-xml-parser` 的生产依赖，逐目录计算文件清单和 content root。目标 Node SHA 来自 builder 当前固定 Node24 的实际二进制字节，M1 installer 会要求目标绝对路径、版本和字节 SHA 全部相等。

builder 输出 `.local/release/rss-real-release-manifest.json`、deterministic content root、release SHA 与 manifest 文件 SHA。统筹部须通过独立通道固定完整 manifest 文件 SHA，release 包和 manifest 可以同路传输，expected SHA 不得从待验证 deployment manifest 中回读。

## 2. 准备但不加载

在 prepare 之前先执行：

```sh
launchctl print gui/$(id -u)/com.f1plus1.rss-collector
```

只有输出明确表示 `Could not find service` / `service not found` 才能判定 unloaded 并继续。返回 loaded 时先使用已批准旧版本 `stop`；权限错误、launchctl 故障或其他非零结果均为 Unknown，立即停止。不得把任意非零退出统一解释为 unloaded。

把已固定的 release manifest 安装到 `.local/release/rss-real-release-manifest.json`，mode 0600。然后在 M1 精确 app root 中，以统筹部独立传入的 `<EXPECTED_RELEASE_MANIFEST_SHA256>` 执行：

```sh
cd [M1-HOME]/F1-1-website/app
RSS_EXPECTED_RELEASE_MANIFEST_SHA256='<EXPECTED_RELEASE_MANIFEST_SHA256>' \
[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types scripts/rss-install-macos.ts
```

唯一成功出口为一行 JSON，`status=prepared-no-bootstrap-called`、`externalCalls=0`。该措辞只证明 installer 没有调用 bootstrap；prepare 前取得的明确 unloaded 收据才证明目标机当时没有同名 job。

```sh
launchctl print gui/$(id -u)/com.f1plus1.rss-collector
```

安装器先以 expected release-manifest SHA 核对实际 manifest 字节，再重算当前安装树、生产依赖目录、Node 二进制和 content/release root。通过后才初始化 DB。它会将同一个已核验 SHA 写入 plist 的 `RSS_RELEASE_MANIFEST_SHA256`，使每次 LaunchAgent 运行都先进入 scheduled wrapper。它还会将 `.local`、release、logs、tmp 与 LaunchAgents 目录收紧为 0700，将 DB、release/deployment manifest、plist和两个日志叶子收紧为 0600，并拒绝 symlink、hardlink 或 hash 漂移；plist 同时固定 `Umask=0077`。

## 3. 受控单次真实运行

只有独立 SSH 实施任务明确授权一次真实请求后，执行一次：

```sh
/usr/bin/env -i \
  HOME=[M1-HOME] \
  TMPDIR=[M1-HOME]/F1-1-website/app/.local/tmp \
  PATH=[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  RSS_REAL_IO=true \
  RSS_RELEASE_MANIFEST_SHA256='<EXPECTED_RELEASE_MANIFEST_SHA256>' \
  [M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types \
  [M1-HOME]/F1-1-website/app/scripts/rss-scheduled-run.ts
```

scheduled wrapper 必须先以该外部 SHA 重算 release manifest、运行文件、递归生产依赖、目标 Node、deployment manifest/plist/权限与 DB schema；任一步失败都在动态导入 collector、打开 collector 写连接或执行 DNS/HTTP 前退出，失败收据固定 `externalCalls=0`。通过后才执行现有 collector。保存唯一 JSON 收据，核对 run/slot/status/reason、`externalCalls`、response hash 与候选计数。不得复制 RSS 正文、header、IP、绝对日志内容或数据库内容到公开文档。

单次运行结束后先停采围栏，再进入审查：

```sh
[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types scripts/rss-control.ts stop
```

`stop` 在一个 SQLite `BEGIN IMMEDIATE` 事务中先置 `enabled=0` 并把 `stop_epoch` 加一，随后执行 `launchctl bootout`。即使 Agent 尚未加载，也必须完成数据库围栏。

## 4. 状态核对

```sh
RSS_EXPECTED_RELEASE_MANIFEST_SHA256='<EXPECTED_RELEASE_MANIFEST_SHA256>' \
[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types scripts/rss-control.ts status
```

`status` 以外部 expected release-manifest SHA 为根，重新校验 release/deployment manifest、安装树、生产依赖、Node、plist、日志0600、DB schema 和 source；launchctl 只有明确 loaded 或 service-not-found 才输出状态，其他结果固定失败。status 不写 SQLite、不发网络请求。

必须确认人工审核字段没有被机器更新覆盖、公开 synthetic 数据无变化，并取得安全/测试对单次收据的放行。缺少任一确认时保持 stopped。

## 5. 启用 900 秒调度

```sh
RSS_EXPECTED_RELEASE_MANIFEST_SHA256='<EXPECTED_RELEASE_MANIFEST_SHA256>' \
[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types scripts/rss-control.ts resume
```

`resume` 先用外部锚校验完整 identity/权限门，并要求 launch job 明确 unloaded；随后在同一个即将写入的 SQLite 连接上执行完整 `assertRssSchema`/integrity/fingerprint，再在 `BEGIN IMMEDIATE` 中置 `enabled=1`，最后 bootstrap。LaunchAgent 每次 RunAtLoad/900 秒触发均执行带同一外部锚的 scheduled wrapper，不直接执行 collector。任何失败都以独立 best-effort 阶段分别尝试 DB refence 和 bootout；只有最终回读确认 source disabled、epoch 增加且 job 明确 unloaded，才确认安全停回，但仍以 resume failure 退出。成功也必须回读确认 enabled+loaded。

启用后立即执行一次 `status`，并只读取脱敏日志尾部：

```sh
RSS_EXPECTED_RELEASE_MANIFEST_SHA256='<EXPECTED_RELEASE_MANIFEST_SHA256>' \
[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types scripts/rss-control.ts status
tail -n 50 .local/logs/rss-collector.stdout.log
tail -n 50 .local/logs/rss-collector.stderr.log
```

## 6. 紧急停止与回退

任何异常先执行：

```sh
[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types scripts/rss-control.ts stop
```

顺序固定为数据库 stop fence → launchd bootout。不得先 bootout 再修改 `stop_epoch`。即使 DB fence 失败，工具仍独立尝试 bootout；即使 bootout 失败，工具仍执行最终回读。只有 source disabled、epoch 严格增加且 launch state 明确 unloaded 三项同时满足才输出 `stopped-confirmed`。保留 DB、manifest、plist 与日志供对账。

代码回退使用上一份已批准 release package 与其独立 manifest/hash。切换前保持 source disabled；重新运行 prepare-only installer，验证新 manifest 后只做一次受控真实运行。新候选通过收据核对后再执行 `resume`。本 runbook 不授权删除当前 DB、WAL/SHM、manifest、plist、日志或上一 release 目录。

## 未验证

当前开发任务没有 SSH、没有连接 M1、没有真实 RSS 请求、没有执行 installer/control，也没有加载或卸载任何本机 LaunchAgent。M1 文件所有权、现有 LaunchAgents 目录权限、真实 release package hash、受控运行结果、900 秒节奏和停机后的零新增 run 均需后续独立任务实测。
