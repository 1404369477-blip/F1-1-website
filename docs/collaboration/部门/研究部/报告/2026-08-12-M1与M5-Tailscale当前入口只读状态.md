---
type: work_report
department: 研究部
target: M1 与 M5 Tailscale 当前入口只读状态
status: final
date: 2026-08-12
related_task: TASK-20260812-C55BB9
decision: one_gui_action_required
tags: [tailscale, preflight, serve, https, macos]
summary: M1 已安装并运行 Tailscale，MagicDNS 已开，Serve/Funnel 当前均为空；M5 已安装且扩展/VPN 已启用，但 backend 处于 Stopped。阻断 Admin canonical HTTPS origin 的唯一外部前置是 tailnet HTTPS 尚未启用（M1 CertDomains=null）；用户只需在 Tailscale DNS 管理页启用 HTTPS 并确认 CT 公开边界。
---

# M1 与 M5 Tailscale 当前入口只读状态

## 结果

本轮仅读，没有登录、更新、改 Serve/Funnel/Grant、启用 HTTPS 或启动 Admin。报告对 tailnet 名、完整 DNS/IP、账号和 node key 做了脱敏。

| 项目 | 固定 M1 | 移动 M5 |
| --- | --- | --- |
| App/渠道 | `/Applications/Tailscale.app`，Standalone system extension 变体 | `/Applications/Tailscale.app`，Standalone system extension 变体 |
| 版本 | `1.96.5` | `1.98.9` |
| CLI | App 内置 CLI 可读；未观测到 `/usr/local/bin/tailscale` launcher | App 内置 CLI 可读；未观测到 `/usr/local/bin/tailscale` launcher |
| system extension/VPN | activated+enabled；VPN Connected | activated+enabled；VPN 配置显示 Connected |
| backend | `Running`、online | `Stopped`、offline；本轮未启动 |
| tailnet/node | 已有 node key、身份与脱敏 `.ts.net` DNS name | 已有 node key、同 tailnet 身份与脱敏 DNS name |
| MagicDNS | `true` | 本地缓存状态为 `true` |
| CertDomains | `null` | `null` |
| Serve | `status={}`；`get-config={"version":"0.0.1"}`，无 endpoint | `status={}`；backend stopped 时 get-config 不可读 |
| Funnel | `status={}`，无观测 endpoint | `status={}` |
| `127.0.0.1:3101` | 无 listener，符合当前 Admin 尚未启动的准备态 | 不适用 |

M1 已满足“官方 Standalone 运行、tailnet 已登录、MagicDNS 已开、Serve/Funnel 当前为空”。M5 已安装且保留身份，但 backend 当前停止；这不阻断 M1 canonical origin 的生成，会阻断后续从 M5 访问的真机验收。

## 阻断 canonical HTTPS origin 的唯一外部缺口

M1 `CertDomains=null`，表明当前 tailnet HTTPS 证书域尚未就绪；因此还不能冻结 `https://<opaque-m1>.<tailnet>.ts.net` 为 Admin canonical origin。MagicDNS 已经开启，Serve/Funnel 没有旧转发需要清理。

另有两项项目内后续工作，不属于这个外部前置：先启动仅监听 `127.0.0.1:3101` 的 Admin candidate，再配置 Serve `443 → 127.0.0.1:3101`。当前 3101 为空正好防止未准备应用被提前暴露。

## 用户只需做的一项 GUI 动作

在任一已登录此 tailnet 且具有 Owner/Admin 权限的浏览器中，打开 **Tailscale Admin Console → DNS → HTTPS Certificates → Enable HTTPS**，阅读并确认 machine name 与 tailnet DNS name 会进入公开 Certificate Transparency 日志。

在点击前，只需确认 M1 现衋的 machine name 不含邮箱、姓名、地点或秘密；本报告已隐藏该值。如名称含敏感信息，不启用 HTTPS，先回统筹部冻结 opaque 名称。

该 GUI 动作不会配置 Serve，也不会开启 Funnel。完成后即可把其余准备交回统筹/开发通过 SSH 执行。

## GUI 完成后的命令级验收

以下命令仅在用户完成 GUI 后由后继任务执行；命令中保留 app 内置 CLI 路径，避免依赖当前不存在的 launcher：

```bash
ssh f1plus1-m1-uu \
  'TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale status --json'

ssh f1plus1-m1-uu \
  'TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve status --json'

ssh f1plus1-m1-uu \
  'TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve get-config --all'

ssh f1plus1-m1-uu \
  'TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status --json'
```

验收条件：

1. `BackendState=Running`、`MagicDNSEnabled=true`，`CertDomains` 从 `null` 变为仅含该 M1 的 `.ts.net` HTTPS 域；在普通报告中继续脱敏。
2. Serve 仍为空，Funnel 仍为空；启 HTTPS 前置不得顺带生成任何公开端点。
3. 只在 Admin 3101 启动并通过 loopback 健康检查后，后继任务才能运行：

```bash
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale \
  serve --https=443 http://127.0.0.1:3101
```

随后必须回读 `serve status --json` 与 `serve get-config --all`，并对 Funnel 进行独立空配置核验。现有 Cloudflare 公网上游 3000 不变。

## 回退

如 HTTPS 同意后出现非预期 Serve/Funnel，不启动 Admin mutation，由后继受控任务执行：

```bash
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale funnel reset
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve status --json
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status --json
```

HTTPS 若需整体关闭，回到 Admin Console 的 DNS/HTTPS Certificates 执行 Disable HTTPS；该动作会破坏依赖 HTTPS 的链接，只在 Serve 已关、Admin mutation=0 且回退窗口中执行。

## Unknown

- iPhone 当前实际安装/登录/批准/在线状态本轮没有本机证据；M1/M5 的缓存 peer 列表不能代替 iPhone 当前验收。
- device approval、Grant 和实际 tailnet policy 本轮没有从管理面读取；Serve 准备后仍必须进行错身份/未批准/已撤销设备的负向实测。
- M5 backend 当前为 Stopped；本轮按只读边界没有打开客户端或启动连接。
- 中国大陆异网可达、iPhone 蜂窝、重连、撤销时延和 RTO/RPO 继续为 Unknown。

