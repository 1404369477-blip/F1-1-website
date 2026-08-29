---
type: work_report
department: 研究部
target: M1、M5 与 iPhone 的 Tailscale 私有 Admin 最小实施
status: final
date: 2026-08-12
related_task: TASK-20260812-22B680
decision: proceed_with_gated_standalone_serve_pilot
tags: [tailscale, macos, ios, serve, funnel, grants, device-approval]
summary: 官方资料支持 M1/M5 使用 Standalone、iPhone 使用 App Store 客户端，并以 Serve 把 127.0.0.1:3101 提供为 tailnet-only HTTPS；第一次 macOS 系统扩展/VPN 批准、登录与 Serve HTTPS 同意必须保留本机 GUI/浏览器门。中国大陆实网可达、开机后无人重连和撤销时延均保持 Unknown，实施不应因文档通过而自动放行。
---

# M1/M5/iPhone Tailscale 私有 Admin 官方实施核验

## 0. 结论

截至 2026-08-12，最小候选是：

- 固定 M1 与移动 M5 安装 Tailscale 官方 **Standalone stable**；官方明确首选 Standalone，并警告同机不要并存 App Store 与 Standalone 变体。当前包服务器于访问时展示 stable `1.102.2` 与可校验 `.sha256`，实施 manifest 需在下载当日重新锁版本与 hash。
- iPhone 从 App Store 安装官方客户端，首次打开由人确认 VPN 配置并登录。
- M1 Admin 仅监听 `127.0.0.1:3101`；三台设备都进入同一 tailnet 且逐台人工批准后，用 deny-by-default Grant 仅允许运营者到 M1 tag 的 `tcp:443`。
- M1 用 Tailscale Serve 将 tailnet HTTPS `443` 转发到 `http://127.0.0.1:3101`；Funnel 始终关闭，不向公网暴露 Admin。Serve identity headers 仅能作脱敏审计辅助，不代替 passkey/session/授权。
- 可通过现有 SSH 下载、校验、运行 `.pkg`、检查 CLI/Serve/Funnel 与准备无敏配置；macOS 首次系统扩展/VPN 授权以及 Tailscale 登录不能仅靠无人 SSH 完成。未配 MDM 时，iPhone 所有安装、VPN 同意与登录均需本机操作。

这是实施前证据与清单，本轮没有安装、登录、建 tailnet、改 Grant、启用 Serve 或运行中国大陆真实网络探测。

## 1. 证据标签和访问时态

| 标签 | 含义 |
| --- | --- |
| 已证实 | Tailscale/Apple/GitHub 官方页面直接支持 |
| 工程判断 | 从官方能力映射到 F1+1 现行安全合同 |
| Unknown | 官方没有给出承诺，或必须在真实设备/账号/网络实测 |

所有引用页面于 2026-08-12 访问。Tailscale 文档页显示的“Last validated”日期在参考清单中保留；包服务器是当日动态页，实施前必须重读。

## 2. 安装选型与版本

### M1/M5

1. 先查是否已有 `/Applications/Tailscale.app`、App Store/Standalone 哪一变体、CLI 路径及网络扩展状态。发现两个变体时停止，按官方切换流程删除旧 app、清空废纸篓并重启，不覆盖安装。
2. 从 `https://pkgs.tailscale.com/stable/` 下载当日 `.pkg` 及其 `.sha256`；只有 hash 匹配时允许进入安装窗口。当日页面显示 `Tailscale-1.102.2-macos.pkg`，该数值不应当作长期固定版本。
3. `.pkg` 可经 SSH 下载、hash 校验与 `sudo installer` 安装；安装后打开 app，在「系统设置 → 通用 → 登录项与扩展 → 网络扩展」开启 Tailscale，用 Touch ID/管理员密码确认，并在系统询问时允许 VPN 配置。该显式同意是官方固定边界；无 MDM 时不把 SSH 执行成功写成扩展已批准。
4. 通过菜单栏应用登录同一 tailnet；Standalone 的 `/usr/local/bin/tailscale` CLI 集成也需在 app Settings 选择安装并输入管理员密码。如暂时没有 launcher，不应猜测路径，先用 app 的可见安装流程补齐。

### iPhone

1. 官方要求 iOS 15+；从 App Store 安装 Tailscale。
2. 打开 app，点击 Get Started，允许 VPN 配置与推送通知，再用同一受支持 SSO 身份登录。
3. 核心试运行可使用客户端自动建立的广义 VPN On Demand 保持重启/更新/崩溃后重连，先不自定义规则。官方警告错误规则可直接阻止连接；另一 VPN 启用 On Demand 时，Tailscale 可被禁用直到人工重连。

## 3. SSH 可做与必须在人设备前

| 环节 | SSH/远程 CLI 可做 | 必须本机 GUI/浏览器或人工同意 |
| --- | --- | --- |
| M1 `.pkg` | 检查旧变体；下载包和 `.sha256`；校验；在已批准窗口运行安装器 | 首次系统扩展/VPN 授权；无 MDM 时的 Touch ID/管理员密码对话框 |
| M1 tailnet | 网络扩展、VPN 与 CLI 已就绪后可读 `version/status/ip/netcheck`；可生成登录 URL | 首次登录/SSO；device approval；HTTPS/Serve 的网页同意 |
| M1 Serve | 前置已经满足后可设置/查状态/关闭/重置 | 首次 HTTPS 或 Serve 未满足前置时可能出现 consent URL，必须人工审批 |
| M5 | 安装包预备和已接入后状态查询 | 同 M1 的扩展/VPN/登录；后续 Admin passkey 登录 |
| iPhone | 无 Tailscale CLI | App Store 安装、VPN 允许、SSO 登录、Admin passkey 和真实业务验收 |
| 策略/撤销 | 有受限 API/OAuth 时可自动，本项目首版不预存管理 API key | 在 console 审阅 Grant、逐台批准/撤销设备和回读结果 |

`tailscale up --force-reauth` 可中断现有 tailnet 会话；官方明确警告没有备用登录通道时不要远程执行。UU/现有 SSH 可用于首次 GUI 窗口的远程操作，但其能否跨重启、FileVault 锁定屏和网络中断存活仍为 Unknown。

## 4. Device approval 与最小 Grant

1. 先在 console 开启 device approval，再加入三台设备；官方明确未批准设备不能发送或接收 tailnet 流量。不使用 pre-approved auth key 绕过人工批准。
2. M1 使用 `tag:f1-admin-server`；M5/iPhone 保持用户身份。Tag 是服务设备身份，会替换该节点原有的用户身份；在 M1 上应在维护窗口一次性完成并回读。
3. 从一份移除默认 allow-all 的 tailnet policy 开始；Grants 实际是 deny-by-default，但如保留了更宽的历史 ACL/Grant，这一条窄 Grant 不会覆盖宽规则，匹配权限会合并。

最小形状（占位身份只能在受限 deployment manifest 替换）：

```json
{
  "groups": {
    "group:f1-admin-operators": ["<operator-identity-ref>"]
  },
  "tagOwners": {
    "tag:f1-admin-server": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["group:f1-admin-operators"],
      "dst": ["tag:f1-admin-server"],
      "ip": ["tcp:443"]
    }
  ]
}
```

保存前用 console 编译/验证，保存后用已批准 M5/iPhone 证明 443 可达，并用错身份、未批准设备和撤销设备证明 443 不可达。未经这三个负向出口不得宣称默认拒绝已落地。

## 5. Serve 3101 tailnet-only 与 Funnel 关闭

### 前置

- M1 Tailscale online 且已批准/Tag；MagicDNS 已开；HTTPS 已开。开 HTTPS 时必须人工确认设备 FQDN 会进入公开 Certificate Transparency 日志，因此先把 M1 改为无个人/地点/项目秘密的 opaque 名称。
- Admin 必须只监听 `127.0.0.1:3101`，本机 `curl` 健康检查成功；公开 Cloudflare 上游仍只是 3000。

### 候选命令

实施当日以 `tailscale serve --help` 与已安装版本为准；现行官方 CLI 接受 localhost 端口目标，最小候选为：

```bash
tailscale serve --https=443 http://127.0.0.1:3101
tailscale serve status
tailscale serve status --json
tailscale serve get-config --all
```

官方文档另给出 `tailscale serve 3101`/`tailscale serve localhost:3101` 简写；由于 `status` 与 `status --json` 当前回传信息不同，验收同时保留三份回读，不只检查一条命令退出码。

### Funnel 硬门

- 官方文档在两处有容易误读的表述：Serve 页说未满足前置时的同意流可启用 HTTPS/相关能力，同页一度写“Funnel is enabled by default”；Funnel 专页明确写 Funnel 服务默认关闭，只有执行 `tailscale funnel` 并同意后才建 Funnel。安全上不依赖默认值，验收必须回读实际配置。
- 不执行任何 `tailscale funnel ...`。如发现现有 Funnel，先根据实际开启参数加 `off`，随后 `tailscale funnel reset`（实施当日先查 `--help`），再从 policy 移除允许 `funnel` 的 `nodeAttrs`，并回读公网 listener=0。
- Serve/Funnel 不能在同一端口同时使用，最后一次配置决定端口公开或私有；正因如此，只看 Serve URL 可打开不足以证明 Funnel 关闭。

### 回退

```bash
tailscale serve --https=443 off
tailscale serve reset
tailscale serve status
tailscale serve get-config --all
```

回退后还要检查 Admin 仅有 loopback 3101、从 M5/iPhone 的 `.ts.net` 443 不可达、公网 Admin 路径仍通用 404。回退 Serve 不卸载 Tailscale，也不动现有 3000 公开 Beta/collector。

## 6. Identity headers 信任边界

- Serve 会对 tailnet 流量附加 identity headers，且会删除入站同名 header 防止远程伪造；Funnel 不提供 identity headers。
- 官方强调后端应仅监听 localhost；否则可绕过 Serve 直接注入 headers。
- headers 不应独立作应用认证：它们也可出现在已接受共享的外部用户访问上，而 tagged-device 发起流量时又不填充用户 identity headers。F1+1 继续要求 passkey、server-side session、exact Origin、CSRF 和 fresh re-auth；Tailscale header 仅转换为脱敏审计 ref。

## 7. 开机、离网与重连

- 已证实：Tailscale 在 iOS/macOS 启用时会自动配置广义 VPN On Demand，用于系统重启、自动更新、崩溃等情况下恢复 tunnel；用户手动禁用 Tailscale 会移除这项自动配置。
- 已证实：连接可直连、peer relay 或 DERP relay，三者都用 WireGuard 端到端加密；直连失败可退回 relay。客户端会持久化最后已知 DERP 列表，协调服务短时不可达且 DERP 可达时仍有恢复条件。
- Unknown：固定 M1 在无人登录、Wi-Fi 中断/路由器重启、睡眠唤醒、FileVault 重启前后是否持续可达；M5/iPhone 在中国大陆异地 Wi-Fi/蜂窝的直连/relay 路径、重连时间、延迟与丢包。这些必须真机实测，不能从“有 relay”推导出可用性或 SLA。

## 8. 撤销和失陷响应

1. 在 Machines 页面对丢失/失陷设备先撤销 approval 或 Remove machine；官方说 Remove 会使设备立即失去 tailnet 资源连接。只卸载客户端不会从 tailnet 移除设备。
2. 回读被撤销设备对 M1 443 不可达；同时在 F1+1 Admin 主库撤销该 device ref 所有 session/passkey credential。M1 失陷时还要关 Serve、fence writer 并轮换应用/投影/备份凭据。
3. M5/iPhone 保持 key expiry；M1 如转为 tagged device，首次应用 tag 并重认证后默认关闭 key expiry，这个例外必须进 manifest 并按期复核。
4. 官方的“立即失去连接”不能证明项目目标 `≤15m` 已达成；console/API 发起、策略传播、客户端断开和 Admin session 撤销的总时间仍需真实计时收据。

## 9. 第一个实施窗口的闭集清单

### 窗口前（全部可读）

- 记录 M1/M5/iPhone 系统版本、Tailscale 变体/版本、现有 VPN 冲突、M1 监听端口与可回退点。
- 下载 stable `.pkg` + `.sha256`，锁定当日 version/hash；用户确认 tailnet 身份和 opaque M1 machine name。
- 准备含完整现行 policy 快照与 hash 的回退文件；不放任何 auth/API key 进 Git/普通报告。

### 需人在设备前的一次窗口

1. M1/M5 安装 Standalone，批准 system extension/VPN，登录；iPhone 安装、允许 VPN，登录。
2. 开 device approval，逐台对照设备后批准；M1 设 tag，保存窄 Grant。
3. 启 MagicDNS/HTTPS，确认 CT 边界；启 `443 → 127.0.0.1:3101` Serve，不同意/不配 Funnel。
4. 完成 M5+iPhone 私有 URL 可达、错身份/未批准/撤销设备不可达，以及公网 Admin 负向。

### 失败与回退

- 任一变体冲突、hash 不匹配、system extension/VPN 未批准、账号/设备身份不可确认：不启 Serve。
- 任一公网 Funnel/listener、宽规则、错身份 443 可达：先停 Admin mutation，关 Serve/Funnel，回退 policy，保持公开 3000 不变。
- M5 异地 Wi-Fi、iPhone 蜂窝/Wi-Fi→蜂窝、relayed path 或重连失败：第一版 Admin 继续关闭远程 mutation，不退到公网密码页、Funnel 或路由器端口转发。

## 10. Unknown 边界

- Tailscale 没有在本轮官方资料中承诺中国大陆家庭宽带、异地 Wi-Fi、蜂窝或跨运营商可达率、性能或 SLA；是否经 direct/peer relay/DERP 可稳定访问只能实测。
- 当前真实 tailnet/SSO 身份、Personal 套餐资格、device approval/HTTPS 现状、机器名/CT 暴露、Tailscale 客户端实际版本与更新策略未核验。
- M1 在 FileVault 预启动、无人登录、旧 WPA Wi-Fi 和路由器重启后的可达性，UU 能否承担现场 GUI 与失联后恢复，全部 Unknown。
- Tailscale 只解决私有可达与网络策略；F1+1 passkey/session/CSRF/fresh re-auth、备份 `RPO≤15m`、恢复 `RTO≤4h`、唯一 writer 与真实发布链仍需独立验收。

## 11. 官方来源

| 资料 | 页面时态/用途 |
| --- | --- |
| [Tailscale macOS 安装](https://tailscale.com/docs/install/mac) | Last validated 2026-01-05；Standalone/App Store/开源变体与加入流程 |
| [Three ways to run Tailscale on macOS](https://tailscale.com/docs/concepts/macos-variants) | Last validated 2026-01-05；Standalone 首选、变体不并存 |
| [Authorizing the macOS system extension](https://tailscale.com/docs/concepts/macos-sysext) | Last validated 2026-01-05；macOS 15+ 的系统扩展/VPN 明示同意 |
| [Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli?tab=macos) | Last validated 2026-07-30；Standalone CLI 集成、App Store CLI 路径、iOS 无 CLI |
| [stable package server](https://pkgs.tailscale.com/stable/) | 2026-08-12 动态页；当日 macOS stable `1.102.2` 与 `.sha256` 路径 |
| [Tailscale changelog](https://tailscale.com/changelog) | 2026-08-12 访问；客户端版本/安全更新时序，表明版本需实施日重锁 |
| [GitHub `tailscale/tailscale`](https://github.com/tailscale/tailscale) | 2026-08-12 访问；开源 CLI/daemon 仓库边界 |
| [iOS 安装](https://tailscale.com/docs/install/ios) | Last validated 2025-02-21；App Store、VPN 配置、推送和 SSO |
| [VPN On Demand](https://tailscale.com/docs/features/client/ios-vpn-on-demand) | Last validated 2026-01-05；重启/崩溃重连与其他 VPN 冲突 |
| [Device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval) | Last validated 2026-01-05；未批准设备零 tailnet 收发与撤销 API |
| [Grants syntax](https://tailscale.com/docs/reference/syntax/grants) | Last validated 2026-01-05；deny-by-default、权限合并、`tcp:443` |
| [Tags](https://tailscale.com/docs/features/tags) | 2026-08-12 访问；tag 替换用户身份与 server 用途 |
| [Key expiry](https://tailscale.com/docs/features/access-control/key-expiry) | Last validated 2026-01-05；tagged 例外与远程 force-reauth 中断风险 |
| [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) | 2026-08-12 访问；tailnet-only 代理、identity headers 与 localhost 边界 |
| [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve) | 2026-08-12 访问；status/get-config/off/reset 和 localhost proxy |
| [Enabling HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates) | Last validated 2025-12-10；MagicDNS/HTTPS 与 CT 主机名公开 |
| [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) | 2026-08-12 访问；Funnel 默认关闭、公网语义、端口与 nodeAttrs |
| [Connection types](https://tailscale.com/docs/reference/connection-types) | Last validated 2026-06-01；direct/peer relay/DERP 与 WireGuard 端到端加密 |
| [DERP servers](https://tailscale.com/docs/reference/derp-servers) | Last validated 2026-01-21；relay 回退与已知 DERP 列表持久化 |
| [Remove a device](https://tailscale.com/docs/features/access-control/device-management/how-to/remove) | Last validated 2026-01-05；Remove 立即失去 tailnet 资源，卸载不等于移除 |
| [Apple：iPhone 配置描述文件](https://support.apple.com/guide/iphone/iph6c493b19/ios) | 2026-08-12 访问；iPhone 安装/移除 VPN 与设备管理配置的用户同意边界 |

