# F1+1 固定 M1 公开 Beta：SSH 运行收据 v0.1

## 当前结论

- 状态：第一版公开 synthetic beta 已在固定 M1 MacBook 上运行。
- 上线时间：2026-08-12 00:22（Asia/Shanghai）。
- 临时公网地址：<[EPHEMERAL-TUNNEL-URL]>
- GitHub：<https://github.com/1404369477-blip/F1-1-website>
- 分支：`codex/first-public-release`
- 本地 release commit：`939fac95ac28ee30dec31c1e115aa372ec40261a`
- GitHub 对应远端 commit：`3b1c89540f2a2913b17b9dee358dc49b01f271aa`
- M1 运行目录：`[M1-HOME]/F1-1-website`，当前为精确 release package，不含 `.git`。

该公网地址来自 Cloudflare Quick Tunnel，只适合开发和公开 beta。地址会在隧道进程或 M1 重启后变化，无可用性保证；稳定上线需要用户域名和命名隧道。Cloudflare 官方说明见 [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/[EPHEMERAL-TUNNEL-URL]/) 与 [Tunnel 概览](https://developers.cloudflare.com/tunnel/)。

## 主机与运行面

| 项目 | 当前事实 |
| --- | --- |
| 主机 | MacBook Air M1，arm64，macOS 26.5.1 |
| 供电 | AC attached，电池 80% |
| 睡眠 | 电池与 AC 下 `sleep=0`；屏幕休眠为 60 分钟 |
| 网络 | Wi-Fi；没有路由器端口转发或 UPnP 暴露 |
| Node | 官方 arm64 Node.js 24.18.0，路径 `[M1-HOME]/.local/node-v24.18.0-darwin-arm64` |
| 应用监听 | `127.0.0.1:3000`；Next 内部监听 `127.0.0.1:3001` |
| 数据 profile | `public-multimedia-synthetic`，24 条公开 synthetic 内容 |
| 公网入口 | `cloudflared 2026.6.1` arm64，origin 仅指向 `http://127.0.0.1:3000` |
| 远程运维 | UU 端口映射 `127.0.0.1:22022 → M1 127.0.0.1:22`，本机 SSH alias 为 `f1plus1-m1-uu` |

公网隧道使用出站连接，不要求家庭网络具备公网 IP，也没有打开路由器入站端口。应用自身 production allowlist 只允许公开页面、公开 API、health 和必要静态资源；Admin 与其他路径保持 404。

## LaunchAgent 状态

| Label | 当前状态 | 作用 |
| --- | --- | --- |
| `com.f1plus1.public-beta` | running | production Web 服务，`KeepAlive` |
| `com.f1plus1.receipt-refresh` | scheduled，last exit 0 | 每 43,200 秒刷新一次闭合收据 |
| `com.f1plus1.quick-tunnel` | running | Cloudflare 临时公网隧道，`KeepAlive` |

三个 plist 位于 `[M1-HOME]/Library/LaunchAgents/`。它们依赖用户 `chanai` 已登录；FileVault 解锁前和无人登录阶段不会启动。

## 已执行的最小上线验证

本轮没有重跑 lint、typecheck、全量测试或重复 build。M1 只执行了一次 production build，并在本地和常驻公网入口做最小真实检查。

| 检查 | 结果 |
| --- | --- |
| `/api/health` | 本机 200 / ready |
| `/` | 本机 200；公网 200 |
| `/stories/public-page2-race-news-24` | 本机 200；公网 200 |
| `/api/admin/session` | 公网 404 |
| 应用进程 | launchd running |
| receipt refresh | last exit code 0 |
| cloudflared | launchd running，QUIC registered |

## 日常 SSH 运维

连接：

```sh
ssh f1plus1-m1-uu
```

查看三个服务：

```sh
launchctl print gui/501/com.f1plus1.public-beta
launchctl print gui/501/com.f1plus1.receipt-refresh
launchctl print gui/501/com.f1plus1.quick-tunnel
```

读取当前临时公网地址：

```sh
grep -Eo 'https://[a-z0-9-]+\.[EPHEMERAL-TUNNEL-URL]\.com' [M1-HOME]/F1-1-website/app/.local/logs/quick-tunnel.stderr.log | tail -n 1
```

查看日志：

```sh
tail -n 100 [M1-HOME]/F1-1-website/app/.local/logs/public-beta.stderr.log
tail -n 100 [M1-HOME]/F1-1-website/app/.local/logs/receipt-refresh.stdout.log
tail -n 100 [M1-HOME]/F1-1-website/app/.local/logs/quick-tunnel.stderr.log
```

只重启网站：

```sh
launchctl kickstart -k gui/501/com.f1plus1.public-beta
```

只重启公网隧道：

```sh
launchctl kickstart -k gui/501/com.f1plus1.quick-tunnel
```

隧道重启后须从日志重新读取公网地址。UU 连接只用于运维；网站公网入口由 M1 自己向 Cloudflare 建立，M5 离线不会主动中断已经运行的公网站。

## 紧急关闭与回退

立即关闭公网暴露，同时保留本机网站：

```sh
launchctl bootout gui/501 [M1-HOME]/Library/LaunchAgents/com.f1plus1.quick-tunnel.plist
```

同时停止网站：

```sh
launchctl bootout gui/501 [M1-HOME]/Library/LaunchAgents/com.f1plus1.public-beta.plist
```

恢复当前版本：

```sh
launchctl bootstrap gui/501 [M1-HOME]/Library/LaunchAgents/com.f1plus1.public-beta.plist
launchctl bootstrap gui/501 [M1-HOME]/Library/LaunchAgents/com.f1plus1.quick-tunnel.plist
```

代码回退或升级必须从 GitHub 指定 commit 重新生成精确 release package，再通过 SSH 传入新的非 iCloud 运行目录；当前目录不含 `.git`，不得在其中执行 `git pull`。切换前保留上一运行目录，完成 health、首页、详情和 Admin 404 四项检查后再删除旧目录。

## 已知限制

- 当前内容仍为 synthetic fixture；真实白名单采集、中文 AI 摘要、人工审核发布和真实媒体链尚未上线。
- Quick Tunnel 没有 SLA，官方说明其用于开发测试，且有 200 个并发请求及不支持 SSE 等限制。
- 中国大陆不同运营商对该临时域名的可达性和延迟尚未取得实测；需要用手机蜂窝网络和至少一条异地宽带验证。
- Wi-Fi 仍是单点故障，现有路由器显示旧 WPA 低安全性；当前没有更改路由器配置。后续应升级 WPA2-AES/WPA3，并在真实流量证明需要后再考虑独立网络。
- Mac 合盖可能改变睡眠行为；常驻阶段应保持开盖供电，或在受控的合盖桌面模式下单独验证。
- Homebrew 安装 `cloudflared` 时自动清理了旧下载缓存；没有删除已安装软件、项目文件或运行数据库。

## 下一条最短路径

1. 用户用 iPhone 蜂窝网络打开临时网址，确认中国大陆真实访问可达性和首屏体验。
2. 用户提供域名后，把 Quick Tunnel 替换为稳定命名隧道；origin 继续保持 `127.0.0.1:3000`，Admin 继续拒绝。
3. 在不影响公开站的独立切片中，接通首个合规 RSS 信源、15 分钟调度、规范化/去重、中文摘要草稿和人工审核队列；真实内容未经审核不得公开。
