# F1+1 固定 M1 MacBook 临时 beta 部署入口

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
