---
title: Tailscale Serve 可信身份头与设备身份官方核验
type: work_report
department: 研究部
status: final
decision: current_contract_fail_minimal_app_capability_successor
task_id: TASK-20260812-9D64EC
date: 2026-08-12
scope: 标准 HTTPS Serve 反代到 127.0.0.1:3101 时的用户身份、设备身份、Grants、LocalAPI WhoIs 与当前 Admin 代码合同
implementation_authorized: false
production_ready: false
---

# Tailscale Serve 可信身份头与设备身份官方核验

## 1. 结论先行

当前 `admin-service` 的身份接线在真实 Mac/iPhone 浏览器出口上 **FAIL**，且不应直接上线。唯一已证实的致命缺口是：

- Tailscale Serve 会注入 `Tailscale-User-Login` / `Tailscale-User-Name` / `Tailscale-User-Profile-Pic`，不会注入 `x-f1-approved-device-ref`。
- Serve 官方文档没有定义设备 ID、设备名、node key 或其他通用设备 HTTP header。
- 当前代码在静态 HTML、Passkey bootstrap/login 及业务 API 之前统一要求 `x-f1-approved-device-ref`，因此普通浏览器的首个 `GET /admin/reviews` 会进入 `401 ADMIN_SESSION_REQUIRED`。
- 让页面 JavaScript、浏览器扩展或远程客户端自行添加该 `X-` header 也不能建立设备身份；该值属于请求者自报，Serve 没有承诺会剔除或验证它。

为保留现行“会话同时绑定 operator + tailnet user + 独立访问端”的安全意图，最小可实施 successor 是：

1. 继续使用 Serve 自动剔除同名入站头后注入的 `Tailscale-User-Login`，并与单一 operator allowlist 比对。
2. 在 tailnet Grant 中对 M5 和 iPhone 两个精确 source selector 分别授予同一个自定义 app capability，参数仅携带一个受限 manifest 内的脱敏 opaque `sourceRef`。
3. M1 以 `tailscale serve --accept-app-caps=<user-controlled-domain>/cap/f1-admin-device --bg 3101` 启用官方能力头；已安装的 M1 `1.96.5` 和 M5 `1.98.9` CLI 帮助均显示该 flag，而官方要求是 `v1.92+`。
4. Admin 只读取 Serve 注入的 `Tailscale-App-Capabilities`，对精确 capability、唯一 ASCII `sourceRef`、manifest allowlist 做闭集校验；忽略或拒绝所有 `x-f1-approved-device-ref`。
5. 将通过校验的 `sourceRef` 立即 hash 为内部 `deviceRef`，现有 challenge/session/fresh re-auth 的三元绑定可以继续保留。对外文档应把它表述为“由 tailnet 策略证明的 source ref”，不冒充硬件序列号或 Tailscale 原生 device ID。

该 successor 不需要 LocalAPI WhoIs、独立入口 proxy、PROXY protocol 或 Go/tsnet 重写。它依然需要产品/安全部修订 proposed 合同，开发部落地后再由安全/测试独立验收；本报告没有修改 app 或 tailnet。

## 2. 官方事实矩阵

| 问题 | 官方结论 | F1+1 影响 |
| --- | --- | --- |
| Serve 是否携带用户身份 | tailnet Serve 反代会注入 `Tailscale-User-Login`、`Tailscale-User-Name`、`Tailscale-User-Profile-Pic` | `Tailscale-User-Login` 可作为经 Serve 证明的 tailnet user 输入 |
| 入站伪造同名头 | Serve 在代理前删除请求中的同名 identity headers | 只有后端绑定 loopback/Serve 时才可信；LAN/tailnet 不能直连 `3101` |
| 值编码 | 含非 ASCII 时可能使用 RFC2047 Q encoding | 实施需限制 login 为 ASCII，或严格解码后再比对；禁止默认当普通 UTF-8 |
| tagged source device | identity headers 不为 tagged source 填充 | M5/iPhone 必须保持 user-owned；只给目的端 M1 使用 server tag |
| 外部 shared user | 已接受 node share 的外部用户也可获得 identity headers | login allowlist 仍必须存在；头存在不等于 F1+1 授权 |
| 是否有原生设备 header | 官方 Serve 头列表中没有 device ID、device name、node ID 或 node key | 当前 `x-f1-approved-device-ref` 没有官方 producer |
| app capability header | `v1.92+` 可用 `--accept-app-caps` 让 Serve 注入 `Tailscale-App-Capabilities`；用户或 tagged source 都可用 | 可将精确 source Grant 变成后端可验证的脱敏策略输入 |
| app capability 伪造 | Serve 会删除入站同名 `Tailscale-App-Capabilities` 再生成 | 在 loopback-only 后端上可用于授权/绑定；仍信任同机 Serve 与主机边界 |
| Device approval | 未批准的实际设备不能发送或接收 tailnet 流量 | 负责入网准入，不生成每请求 device header |
| Device approval 粒度 | 作用于实际设备；共享设备只批准一次，可对应多个用户/节点 | 它无法独立代替 per-request user 和 source 绑定 |
| Grants | deny-by-default；`src` 可选用户、tag、IP/CIDR 或 host alias，host alias 可指向单个设备 | 首版可以对 M5/iPhone 分别建精确 source Grant |
| Grants 叠加 | 多个匹配 Grant 按并集生效，窄规则不会覆盖宽规则 | 禁止宽泛 operator Grant 额外授予同一 app cap；出现 0/多个 `sourceRef` 都 fail-closed |
| LocalAPI WhoIs | 稳定 API；输入必须是 remote IP 或 IP:port，返回 `Node`、`UserProfile`、`CapMap` | 直连 tailnet listener 可获得精确 node/user/capability；它不接受浏览器自报设备值 |
| 标准 HTTP Serve + WhoIs | HTTP Serve 将请求反代到 loopback；官方头列表不携带原始 source IP | 当前 Node 应用看到的 socket peer 是 loopback，不能将该 peer 交给 WhoIs 反查 M5/iPhone |
| PROXY protocol | Serve 在 TCP / TLS-terminated TCP forwarder 模式可以 PROXY v1/v2 传递原始 IP/port | 需替换标准 HTTP 反代，新增 PROXY parser/入口层并调 WhoIs；远高于首版最小成本 |

## 3. 现有代码的 PASS/FAIL

### 3.1 可保留的部分

| 现有实现 | 结论 | 依据 |
| --- | --- | --- |
| 只监听 `127.0.0.1:3101` | PASS | `server.ts:22-23, 322-330`；符合 Serve 防 identity-header 远程伪造的官方最佳实践 |
| 将 canonical HTTPS Host/Origin 、HTTP/1.1、method/path 做闭集检查 | PASS（本任务未动态重测） | `server.ts:75-131` |
| `Tailscale-User-Login` 与 operator allowlist 匹配 | PASS（有前置） | 仅对“用户所有的 source device + 标准 Serve HTTP 反代 + loopback backend”成立 |
| 对 user/device 作 hash 后才进入会话 | PASS 意图 | `server.ts:65-66, 142-146`；不应把原始 login/sourceRef 写进日志 |
| challenge/session/fresh re-auth 绑定 operator + deviceRef + tailnetUserRef | PASS 意图 | `auth.ts:164-170`、`review-real/security.ts:220-269` |

前置边界：Serve 官方说明 localhost 可将伪造面缩小到同机其他进程，它没有将 loopback 说成密码学代理身份。若 M1 上任意本地进程已失陷，该进程仍可直连 `3101` 伪造头。首版需继续依赖专用主机、最小进程集、私有运行账号和文件权限。

### 3.2 当前阻断

| 现有实现 | 结论 | 原因 |
| --- | --- | --- |
| 要求 `x-f1-approved-device-ref` | **FAIL / P1-blocker** | 它不在 Serve 官方身份头集合内，没有可信 producer；`server.ts:116-120` |
| 用该头直接生成 `deviceRef` | **FAIL / security semantic error** | 请求者自报值不能证明 Tailscale device/node；`server.ts:142-145` |
| 静态 Admin 页 | **FAIL / 真实浏览器不可达** | `requestEnvelope()` 在 `serveStatic()` 前执行；`server.ts:243-254` |
| Passkey bootstrap/login | **FAIL / 真实浏览器不可达** | 所有 auth route 也在同一 envelope 之后；`server.ts:255-280` |
| manifest `trustedIdentities[].deviceRefs` | 可保留结构，现有语义 FAIL | `deployment.ts:51-55`；只能改为对 Serve app-cap `sourceRef` 的脱敏 allowlist，禁止存 node key/IP/序列号 |
| LocalAPI WhoIs 直接补到当前 HTTP server | **FAIL** | Serve 到 app 的 remote peer 是 loopback，标准 HTTP 反代没有官方 source-IP header |

## 4. 浏览器与 `x-f1-approved-device-ref` 的精确边界

1. 首个顶层导航在 Admin JavaScript 下载之前已发生，页面代码没有执行机会去为这个 `GET` 生成项目自定义头。
2. 页面加载后的 same-origin `fetch` 可以由项目 JavaScript 尝试携带自定义 `X-` 值，但该值来自页面/请求者；它无法读取 Tailscale 的 node private key，也没有官方机制将该值转换成可信设备证明。
3. 浏览器扩展、远程桌面、手工 curl 或本地 proxy 能添加该头，这只证明它可被伪造。
4. Serve 明确会剔除的是官方三个 identity headers 与 `Tailscale-App-Capabilities`；官方资料没有承诺处理 `x-f1-approved-device-ref`。

因此，`x-f1-approved-device-ref` 必须从安全决策输入中移除。为兼容过渡期，服务端可对它采用“存在即拒绝”或“忽略且审计”，不得让该值改变 identity/session。

## 5. 最小 successor 接线

### 5.1 Tailnet 策略层

以下只是脱敏形状，实际用户、host alias、IP 和 tailnet 标识不入仓库/普通报告：

```json
{
  "hosts": {
    "f1-operator-mac": "<restricted-manifest-tailnet-ip>",
    "f1-operator-phone": "<restricted-manifest-tailnet-ip>"
  },
  "grants": [
    {
      "src": ["f1-operator-mac"],
      "dst": ["tag:f1-admin-server"],
      "ip": ["tcp:443"],
      "app": {
        "<user-controlled-domain>/cap/f1-admin-device": [
          {"sourceRef": "<opaque-mac-ref>"}
        ]
      }
    },
    {
      "src": ["f1-operator-phone"],
      "dst": ["tag:f1-admin-server"],
      "ip": ["tcp:443"],
      "app": {
        "<user-controlled-domain>/cap/f1-admin-device": [
          {"sourceRef": "<opaque-phone-ref>"}
        ]
      }
    }
  ]
}
```

约束：

- capability 名使用用户控制的域；`tailscale.com` / `tailscale.io` 保留给 Tailscale。
- M5/iPhone 不设 tag，以免 `Tailscale-User-Login` 缺失。
- `sourceRef` 仅 ASCII、定长/有界、随机且无业务语义；不携带邮箱、IP、node key、序列号、主机名或设备型号。
- 同一 source 不得通过其他宽 Grant 再获得该 app cap。Tailscale 使用并集语义，重叠规则不会覆盖。
- device approval 继续开启；它负责实际设备入网。精确 source Grant 负责只让两个指定节点访问 `443`。
- 节点重认证、IP/节点替换后，只读回读 host alias/Grant/app cap；未重新对齐前保持不可达，禁止回退到用户组宽放。

### 5.2 Serve 层

```text
tailscale serve --accept-app-caps=<user-controlled-domain>/cap/f1-admin-device --bg 3101
```

Serve 必须继续表现为 tailnet-only HTTPS `443 → http://127.0.0.1:3101`，Funnel active listener 为 0。本报告只核验命令能力与语义，没有执行该命令。

### 5.3 Admin 应用层

一次请求的最小决策顺序：

1. socket peer 必须是 loopback；Host/路径/method 闭集校验继续保留。
2. `Tailscale-User-Login` 必须精确单值，解码后与 allowlist 唯一匹配。
3. `Tailscale-App-Capabilities` 必须精确单值、有长度上限、JSON 可解析，并且只包含目标 capability 的一个参数对象。
4. 目标参数对象只允许 `sourceRef`；其值必须与该 login 的 restricted manifest allowlist 中唯一项匹配。
5. 缺失、重复、非 ASCII、非法 JSON、未知 capability/字段、0 个或多个 `sourceRef` 全部 `401`，不得回退到仅用 login。
6. 内部 `tailnetUserRef = H(login)`，`deviceRef = H(sourceRef)`；原始值不入响应/日志/审计。
7. `x-f1-approved-device-ref` 不再参与身份、challenge、session 或授权。

这一接线使浏览器无需知道/生成任何 Tailscale 头：Tailscale client 建立 tailnet 连接，Serve 根据连接身份和 Grant 注入用户头与 capability 头，Admin 再执行 Passkey/session/CSRF/fresh re-auth。

## 6. LocalAPI WhoIs 与独立 proxy 边界

### 6.1 WhoIs 真正能做什么

Tailscale `client/local` 官方 Go API 将 `Client.WhoIs(remoteAddr)` 标为 stable API；`remoteAddr` 必须是 IP 或 IP:port。成功响应为：

```text
WhoIsResponse {
  Node
  UserProfile
  CapMap
}
```

`WhoIsForIP` / `WhoIsForService` 可将 `CapMap` 限定到目标 IP/服务，官方包文档对两者也标为 stable（当前最新包中 v1.100+ 加入）。官方 LocalAPI 源码还显示 WhoIs endpoint 要求 read permission，可接受 node key、IP 或 IP:port，并根据目标返回 peer capabilities。

它适用于“应用或受信 proxy 持有真实 Tailscale 连接的 remote IP:port”的入口。

### 6.2 为什么不能直接加到当前 `3101`

现行路径是 HTTP Serve 终止 TLS，再新建一条 loopback HTTP 连接到 Node。Node 看到的 `request.socket.remoteAddress` 为 loopback，Serve 官方 HTTP identity-header 集合中没有原始 source IP。将 loopback 交给 WhoIs 不能得到 M5/iPhone 节点。

因此，以下实现形状均不应进入首版：

- 每个 HTTP 请求 shell-out `tailscale whois 127.0.0.1`：对象错误，且进程边界不适合应用代码。
- 信任 `X-Forwarded-For` / `X-Real-IP`：Serve 本任务官方文档没有把它们定义为可信 source identity；当前代码也主动拒绝。
- 从浏览器传 IP/node key 再调 WhoIs：查询 key 本身来自不可信请求，且会暴露不必要的 tailnet 识别子。

### 6.3 若未来硬性要求原生 Node 字段

官方 Serve 支持 `--tls-terminated-tcp=443 --proxy-protocol=2 tcp://127.0.0.1:<proxy-port>`，它可将原始 IP/port 传给理解 PROXY v2 的后端。实施会需要：

1. 一个只接受来自本机 Serve 的 PROXY v2 ingress；
2. 严格 parser、长度/超时/协议族闭集与伪造负例；
3. 对真实 source IP:port 调 LocalAPI WhoIs，对 `Node/UserProfile/CapMap` 取最小字段并 hash；
4. 新的 HTTP 终止/反代层，因为该路径是 TCP forwarder，不能假定同时获得标准 HTTP Serve identity headers；
5. 入口版本、LocalAPI 版本、故障回退和独立安全审核。

这会新增一个安全敏感入口组件，当前没有必要性证据。Serve app capability 可以以较小成本保留现有 session source 绑定。

## 7. Device approval、Grant、header、Passkey 的分层

```text
Device approval
  │ 实际设备是否允许进入 tailnet
  ▼
精确 source Grant + tcp:443
  │ 该节点是否能连 M1 Admin HTTPS
  ▼
Serve Tailscale-User-Login + Tailscale-App-Capabilities
  │ 向 loopback backend 证明 user 与 policy-scoped sourceRef
  ▼
F1+1 login allowlist + Passkey/WebAuthn
  │ 证明 operator 的应用凭据与 user verification
  ▼
Server-side session + Origin + CSRF + CAS + fresh re-auth
  │ 逐请求/逐操作授权与防重放
  ▼
审核/发布业务结果
```

任一层缺失都不应由其他层补位。特别是：

- Device approval 不生成应用会话，也不提供 per-request header。
- Grant 允许 TCP 不等于 F1+1 登录成功。
- `Tailscale-User-Login` 给出 tailnet user，不区分同一用户的 M5 和 iPhone。
- 同步 passkey 可在 Mac/iPhone 共享凭据故障域，不应把 credential ID 误当 Tailscale 实际设备 ID。
- app-cap `sourceRef` 证明的是当前 tailnet 策略对连接 source 的授权分类；device approval 另行证明实际设备已批准。

## 8. 可直接交给开发/安全的负向验收

### 8.1 必须通过

1. **真实首页导航**：已批准、精确 Grant 匹配的 M5/iPhone 浏览器仅依赖 Serve 注入头，不自带项目设备头，`GET /admin/reviews` 可达静态页。
2. **客户端伪造无效**：请求添加任意/正确 `x-f1-approved-device-ref` 不改变服务端 identity；最好直接拒绝并记脱敏审计。
3. **官方头伪造无效**：访问者在入站请求中手工添加 `Tailscale-User-Login` / `Tailscale-App-Capabilities`，后端只能看到 Serve 剔除并重建的真实值。
4. **cap 闭集**：缺失、重复、过长、非法 JSON、未知字段/能力、非 ASCII ref、未在 allowlist、0 个或多个 ref 全部 `401`。
5. **用户与 source 交叉验证**：正确 `sourceRef` + 错误 login，或正确 login + 错误 `sourceRef`，均 `401`。
6. **tagged/shared 边界**：tagged source 因缺 login 被拒绝；shared external user 因不在 operator allowlist 被拒绝。
7. **未批准设备**：device approval 阶段无法发送/接收 tailnet 流量，Admin 请求计数为 0。
8. **已批准但未列入 Grant 的设备**：`443` 不可达；若另有宽网络 Grant 导致连通，因缺少精确 app cap 仍 `401`，并将宽 Grant 作为策略漂移处置。
9. **撤销**：撤销 M5 或 iPhone 的 device authorization 后 `443` 不可达；从另一已批准设备重放被撤销设备的 Cookie，因 `deviceRef/sourceRef` 不同而 `401`。
10. **节点重建/重认证**：host alias/IP/app cap 未重新对齐时 fail-closed，不自动放宽到同用户的任意设备。
11. **直连负例**：LAN/tailnet 无法直连 `3101`；公网 `3000` 的 Admin 路径仍通用 `404`，Funnel active 为 0。
12. **session 绑定**：login 或 app-cap sourceRef 变化后，旧 session/challenge/fresh receipt 不可继续使用。

### 8.2 首版不需要的实体

- 不新增 LocalAPI sidecar、Caddy/Nginx/定制 proxy、PROXY protocol parser 或 tsnet 节点。
- 不让前端读/存/构造 Tailscale device/node 标识。
- 不将 node key、Tailscale IP、machine ID、设备序列号或邮箱写入仓库、普通 manifest、URL、Cookie 或审计。
- 不用公网密码页、Funnel、端口转发或 Cloudflare Admin 作回退。

## 9. 实施输入与 Unknown

后继任务在修改代码/策略前还需冻结：

- 一个用户控制的 capability 域名；当前 Unknown。
- M5/iPhone 当时的精确受限 host alias/IP 映射和两个 opaque source refs；不入普通报告。
- tailnet 当前 device approval、Grant、宽规则、shared node 和 app-cap 现状；本任务没有登录管理面。
- M1 真实 Serve 反代对 ASCII capability JSON 的 header 形状、重复头处理与重启持久性；待受控实测。
- M5/iPhone 异地 Wi-Fi/蜂窝/切网可达性，以及中国大陆 direct/peer relay/DERP 的可用率、延迟和 SLA；Tailscale 官方未在本任务资料中承诺，继续为 `Unknown`。
- 同机恶意/失陷进程对 loopback header 的伪造能力依然是 residual host risk；不应被写成已消除。

## 10. 官方来源与本机证据

以下全部于 2026-08-12 访问，未使用百度或第三方教程作为事实依据：

1. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)，Last validated 2026-01-20；identity/app-capability headers、同名入站头剔除、tagged/shared 边界、localhost 边界。
2. [Tailscale identity](https://tailscale.com/docs/concepts/tailscale-identity)，Last validated 2026-02-11；user/node identity、LocalAPI 节点/user/grant 能力、Serve user/app-cap 区分。
3. [Tailscale application capabilities](https://tailscale.com/docs/features/access-control/grants/grants-app-capabilities)，Last validated 2025-12-01；自定义 capability 命名、Grant/LocalAPI/Serve/tsnet 四种接入。
4. [Tailscale Serve examples](https://tailscale.com/docs/reference/examples/serve)，Last validated 2026-01-14；`--accept-app-caps`、JSON header 形状和 `v1.92+` 前置。
5. [Tailscale Grants syntax](https://tailscale.com/docs/reference/syntax/grants)，访问于 2026-08-12；deny-by-default、并集语义、精确 IP/host alias source selector。
6. [Tailscale device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval)，Last validated 2026-01-05；未批准设备不能收发、撤销 API 与实际设备/节点粒度差异。
7. [Tailscale `client/local` Go package](https://pkg.go.dev/tailscale.com/client/local)，当前页面版本 `v1.102.0`；`WhoIs` / `WhoIsForIP` / `WhoIsForService` 签名、输入和 stable maturity。
8. [Tailscale `WhoIsResponse`](https://pkg.go.dev/tailscale.com/client/tailscale/apitype#WhoIsResponse)，当前页面版本 `v1.102.0`；`Node`、`UserProfile`、`CapMap` 结构。
9. [Tailscale LocalAPI 官方源码](https://github.com/tailscale/tailscale/blob/main/ipn/localapi/localapi.go)，访问于 2026-08-12；WhoIs read permission、nodekey/IP/IP:port 解析和 CapMap 选择。
10. [Tailscale `serve` CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)，Last validated 2026-01-26；HTTP reverse proxy、PROXY protocol 仅用于 TCP forwarding、持久 `--bg`。

本机只读证据：

- M5 Tailscale Standalone CLI `1.98.9` 的 `serve --help` 显示 `--accept-app-caps` 与 `--proxy-protocol`；`whois --help` 只接收 Tailscale IP/IP:port。
- 通过现有 SSH 别名只读执行 M1 Tailscale Standalone CLI `1.96.5` 帮助，同样显示两个 Serve flag 及 WhoIs IP/IP:port 输入。
- 本轮未输出任何真实 tailnet 名、FQDN、IP、登录账号、node key、machine/device ID 或序列号。

## 11. 已验证 / 未验证 / 错题自检

### 已验证

- 官方 Serve 用户头精确集合、伪造剔除、tagged/shared/localhost 边界。
- Serve 没有官方通用 device/node HTTP header；当前 `x-f1-approved-device-ref` 无可信 producer。
- Serve app capability header 在 `v1.92+` 的官方能力、伪造剔除和本机两版 CLI flag 存在性。
- Grants 可对精确设备 host alias/IP 作 source，并使用自定义 app-cap 参数；规则按并集生效。
- Device approval 负责实际设备入网/撤销，不产生 per-request 设备头。
- LocalAPI WhoIs 的 IP/IP:port 输入、Node/UserProfile/CapMap 输出与当前 HTTP Serve loopback 断点。
- 当前 `requestEnvelope()` 使静态页和全部 Passkey route 在缺失项目设备头时先返回 401。

### 未验证

- 真实 tailnet policy/device approval/app-cap 状态、用户控制域名和精确设备 source 映射。
- M1 真实 Serve 注入 app-capability header 的运行字节、出错、重启与撤销行为。
- Mac/iPhone 真机的首页、Passkey、session source 绑定、切网、撤销与中国大陆稳定性。
- 当前 app 仍未修改，本报告的 successor 尚未实施或放行。

### 错题自检

- 没有将用户头写成设备头，没有把 device approval 写成 per-request identity。
- 没有把浏览器自定义头当成可信证明，也没有据空声称 Serve 会产生项目设备头。
- 没有将 LocalAPI WhoIs 的 loopback 查询误写为远程 M5/iPhone node 查询。
- 没有忽略 Grants 并集语义、tagged/shared 边界、RFC2047 可能性或同机进程剩余风险。
- 没有将中国大陆网络、真机、真实 policy 或当前 app-cap 运行状态外推为 PASS。
- 未安装、登录、批准设备、修改 Grant/Serve/Funnel、启动服务、修改 app 或 SSH 写入。
