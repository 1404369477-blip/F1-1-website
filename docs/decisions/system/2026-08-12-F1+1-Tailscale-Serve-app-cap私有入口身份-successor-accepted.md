---
type: system_adr
status: accepted
date: 2026-08-12
department: 产品部
decision_id: ADR-M5-ADMIN-PRIVATE-IDENTITY-002
related_task: TASK-20260812-C2A6B8
authorization_state: inherited_user_confirmed
authorization_evidence: 用户已确认固定M1承载首版、Mac与iPhone均可执行全部Admin操作、采用Tailscale私有入口并允许安装；本successor仅纠正无官方producer的设备头语义
supersedes_identity_details_of:
  - docs/collaboration/部门/安全部/报告/2026-08-12-87555F-M1后台私有入口最小安全合同-v0.1.md
implementation_state: contract_accepted_code_pending
tailnet_state: not_configured
production_ready: false
---

# ADR-M5-ADMIN-PRIVATE-IDENTITY-002：Tailscale Serve app-cap 私有入口身份 successor

## 决定

固定 M1 首版 Admin 只接受下列一条身份链：

```text
已批准的 user-owned M5 / iPhone
  → deny-by-default 下的精确 source Grant
  → tcp:443 + <user-controlled-domain>/cap/f1-admin-device{sourceRef}
  → Tailscale Serve 剔除同名入站头后注入
       Tailscale-User-Login + Tailscale-App-Capabilities
  → 127.0.0.1:3101 对 login + capability + sourceRef 作闭集校验
  → operatorRef + tailnetUserRef + deviceRef
  → Passkey / server-side session / Origin / CSRF / CAS / fresh re-auth
```

`sourceRef` 是由精确 tailnet policy 绑定到请求 source 的无业务语义随机参考值。它不代表 Tailscale 原生 device ID、node ID、node key、硬件序列号或设备指纹。内部 `deviceRef` 只是已校验 `sourceRef` 的稳定脱敏引用。Tailscale device approval 仍单独负责实际设备入网，Passkey 仍单独负责应用凭据与 user verification。

`x-f1-approved-device-ref` 从身份、challenge、session、授权和 fresh re-auth 的所有决策输入中删除。首版选择“存在即拒绝”：任一请求出现该头时，对外仍返回通用 `401 ADMIN_SESSION_REQUIRED`，内部只记录脱敏 reason `ADMIN_UNTRUSTED_DEVICE_HEADER_PRESENT`，头值不入日志。前端、浏览器扩展、curl 和本地 proxy 都不得生成它。

## 取代边界

本 ADR 只取代 `2026-08-12-87555F-M1后台私有入口最小安全合同-v0.1.md` 中下列身份细节：

- §4.1 的宽 `group:f1-admin-operators → tcp:443` 策略形状，改为 M5 与 iPhone 两条精确 source Grant，每条同时授予唯一 app capability 参数。
- §4.3、§5.1、§5.2、§5.3、§6 中 `approved device ref` / `device_ref` 的请求证明来源，统一改为“Serve app-cap 证明的 `sourceRef` 经闭集校验后派生的 `deviceRef`”。
- §3.2 对 Tailscale identity header 的用途表述：`Tailscale-User-Login + Tailscale-App-Capabilities` 是会话前置的可信绑定输入，两者仍不能单独替代 Passkey 或业务授权。
- §10.1 与 §11 中 Grant、Serve、设备/session 验收顺序，以本 ADR 的 prepare/load/activation 门和负向矩阵为准。

原合同的 loopback-only `3101`、tailnet-only HTTPS、Funnel=0、公网 Admin=0、device approval、Passkey、session、Origin、CSRF、CAS、fresh re-auth、撤销、RPO/RTO 与应急边界继续有效。`ADR-M5-REAL-PROJECTION-RUNTIME-003` 要求的唯一私库、不可变 release 与回退根也不变。

当前 app 仍要求 `x-f1-approved-device-ref`，因此实现状态继续为 `P1-blocker`；本 ADR 不将合同接受写成真机可用或生产放行。

## Tailnet 与 Serve 的唯一形状

### 精确 source Grant

实际 login、source selector、tailnet IP/host alias、FQDN 与 `sourceRef` 不进仓库或普通报告。受限配置的脱敏形状固定为：

```json
{
  "grants": [
    {
      "src": ["<exact-user-owned-m5-source>"],
      "dst": ["tag:f1-admin-server"],
      "ip": ["tcp:443"],
      "app": {
        "<user-controlled-domain>/cap/f1-admin-device": [
          {"sourceRef": "<43-char-base64url-m5-ref>"}
        ]
      }
    },
    {
      "src": ["<exact-user-owned-iphone-source>"],
      "dst": ["tag:f1-admin-server"],
      "ip": ["tcp:443"],
      "app": {
        "<user-controlled-domain>/cap/f1-admin-device": [
          {"sourceRef": "<43-char-base64url-iphone-ref>"}
        ]
      }
    }
  ]
}
```

不变量：

1. M5 与 iPhone 都保持 user-owned，不加 tag；M1 可继续使用 `tag:f1-admin-server`。
2. 两个 source selector 必须在真实 tailnet 中各自唯一指向当前批准的 M5 与 iPhone。节点重建、重认证或 selector 漂移后，未重新校验前保持不可达。
3. 两个 `sourceRef` 分别由 32 bytes CSPRNG 生成，以无 padding base64url 表示，长度精确为 43，正则为 `^[A-Za-z0-9_-]{43}$`，且必须不同。不得从邮箱、IP、node key、序列号、主机名、设备型号或业务字段派生。
4. capability ID 精确为 `<user-controlled-domain>/cap/f1-admin-device`：使用小写 ASCII DNS 域名，无 scheme、port、userinfo、query、fragment 或 wildcard；不得使用 `tailscale.com`、`tailscale.io` 及其子域。真实域名必须由用户控制并在部署窗口显式提供，当前为 `Unknown`。
5. Tailscale Grants 按并集生效。任一额外宽 Grant 不得再授予同一 app capability；导致目标 capability 参数为 0 或多个时，Admin 一律失败关闭。
6. device approval 必须开启。它与 app-cap 校验两门同时成立才能继续，任一门不得代替另一门。

Serve 只接受与 manifest 同一 capability ID 的形状：

```text
tailscale serve --accept-app-caps=<user-controlled-domain>/cap/f1-admin-device --bg 3101
```

必须回读 tailnet-only HTTPS `443 → http://127.0.0.1:3101`、Funnel active listener `0` 与精确 capability ID。此命令在本 ADR 中只是合同，未执行。

## Deployment v3 身份输入

`ADR-M5-REAL-PROJECTION-RUNTIME-003` 已要求尚未实现的 `admin-service-deployment-v3`。本successor直接把身份字段合并进同一 v3，不再创建一个并行 manifest 版本：

```json
{
  "tailscaleAppCapabilityId": "<user-controlled-domain>/cap/f1-admin-device",
  "trustedIdentities": [
    {
      "login": "<exact-ascii-tailscale-user-login>",
      "operatorRef": "<existing-opaque-operator-ref>",
      "sourceRefs": [
        "<43-char-base64url-m5-ref>",
        "<43-char-base64url-iphone-ref>"
      ]
    }
  ]
}
```

- `trustedIdentities` 首版精确 1 行；`login` 为受限 manifest 中实际 Serve login 的精确 ASCII 值，长度 `3..320`，不 trim、case-fold 或猜测。若实测头值使用 RFC2047 或含非 ASCII，首版部署停止，由后继合同冻结严格解码；当前不做宽松解码。
- `operatorRef` 必须与 manifest 顶层唯一 operator 相同；`sourceRefs` 首版精确 2 个、全局不重复。
- 现有的 `trustedIdentities[].deviceRefs` 字段删除；不接受 v2 设备字段的隐式转换。
- prepare CLI 新增必填 `F1_ADMIN_TAILSCALE_APP_CAPABILITY_ID`，并继续使用 `F1_ADMIN_TRUSTED_IDENTITIES_JSON`，其 schema 按上述 `sourceRefs` 更新。两者必须在 owner-only 输入中一次验证后写入原子 manifest；运行时不接受环境变量覆写。
- 真实 login、capability ID、source selector、`sourceRef` 和当前 policy 字节只进 M1 owner-only 受限配置；仓库、普通报告和运行收据只留 canonical manifest/policy hash 与脱敏 ref。

用户在真实 tailnet 变更前仍需提供或确认：用户控制的 capability 域名、实际 Serve login、M5/iPhone 的两个精确 source selector、当前宽 Grant/shared node/device approval 状态与变更后策略 hash。本 ADR 接受不代替这些部署输入，也不代替 Tailscale 管理面的真实回读。

## Admin 请求的精确输入与输出

### 预认证闭集

`3101` 在任一静态 Admin HTML、Passkey bootstrap/login 或业务 API 之前，按下列固定顺序处理：

1. socket peer 必须为 loopback；Host、method、path、HTTP 版本与现有闭集校验保留。不合格继续返回通用 `404`。
2. `x-f1-approved-device-ref` 在 raw headers 中出现 1 次或多次均返回通用 `401`，它的值不读取、不比较、不记录。
3. `Tailscale-User-Login` 必须是精确 1 个 raw header field，长度 `3..320` bytes，仅可见 ASCII，与 restricted manifest 的 `login` 逐字节唯一匹配。
4. `Tailscale-App-Capabilities` 必须是精确 1 个 raw header field，UTF-8 字节长度 `1..4096`，JSON 顶层必须是普通 object，且只有一个 key：manifest 的精确 `tailscaleAppCapabilityId`。
5. 该 key 的 value 必须是长度 1 的 array；唯一 item 必须是只含 `sourceRef` 的 object，其值符合 43 字符规则，并与同一 login 的 `sourceRefs` 逐字节唯一匹配。
6. 头缺失/重复/过长、非 ASCII login/sourceRef、JSON 非法或形状不符、未知 capability/字段、0 或多个参数、login/sourceRef 交叉不匹配都返回通用 `401 ADMIN_SESSION_REQUIRED`；不得回退为仅依赖 login。

### 唯一内部输出

闭集全部通过后，仅生成：

```text
operatorRef    = manifest.trustedIdentities[matched].operatorRef
tailnetUserRef = "tailnet-user-" + first16hex(SHA-256(UTF8(exactLogin)))
deviceRef      = "device-" + first16hex(SHA-256(UTF8(exactSourceRef)))
```

原始 login/sourceRef 只在当次请求匹配与 owner-only manifest 中出现，不进 challenge key、Cookie、session 表、API 响应、审计或普通日志。上述 hash 形状保留当前内部 ref 合同，避免把本次修正扩大为会话数据迁移。

### Passkey 三元绑定

Passkey bootstrap challenge、login challenge、登录后 server-side session、每请求 session 复核与 fresh re-auth receipt 都必须绑定同一个：

```text
(operatorRef, tailnetUserRef, deviceRef)
```

Mac 与 iPhone 可使用同步 passkey，但它们的 `deviceRef` 必须不同。Cookie、challenge 或 fresh receipt 从一个 source 复制到另一 source 后，当前请求重算的三元组不一致，立即 `401`。login 或 `sourceRef` 变化、Grant 撤销、manifest 替换也必须使旧 challenge/session/fresh receipt 失效。

## Prepare、load、activation 与回退

本 ADR 嵌入 `ADR-M5-REAL-PROJECTION-RUNTIME-003` 的已定顺序，不改 public/review DB 四根：

1. **部署输入门**：用户提供/确认 capability 域名与实际 tailnet 边界；受限窗口生成两个 `sourceRef`，记录变更前 policy/device/Serve hash。任一真实值为 Unknown 时不写 tailnet。
2. **prepare Admin**：新 release 实现 deployment-v3 与 app parser；prepare 仅原子写 disabled manifest/plist，校验 capability ID、唯一 login、两个 sourceRef 与 `reviewDatabasePath/dev/inode`，不 `launchctl`、不改 tailnet。
3. **policy prepare**：开启/回读 device approval，将宽 operator 网络 Grant 替换为 M5/iPhone 两条精确 Grant，用 Tailscale policy validator 验证后回读 canonical policy hash。Serve 此时仍关闭。
4. **load loopback**：按 003 的同 inode 迁移/运行门只 load `127.0.0.1:3101`，确认 LAN/tailnet 无法直连。Admin mutation 保持 0。
5. **启用 Serve 预认证**：用同一 capability ID 启用 `--accept-app-caps`，先只验证 M5/iPhone 的头形状、伪造剔除、单值、撤销与重启持久性。实际头字节与本合同不一致时关闭 Serve，不宽松 parser。
6. **Passkey 与双端验收**：预认证 PASS 后才生成 bootstrap nonce、注册 Passkey，再在 M5/iPhone 分别完成三元 session 与全功能链。backup/writer/fresh re-auth 等其他门全部通过后才开 mutation。
7. **public 不变**：首条 manual publish、projection active 与 public cutover 仍严格使用 003 的后续顺序；身份门未过不得用公网 Admin 或 synthetic 身份回退补位。

任一身份步骤失败时：关闭 mutation，撤销 Admin sessions/challenges/fresh receipts，关闭 Admin Serve，撤销本 capability 的两条 Grant，停止 `3101`；恢复变更前 policy/Serve hash 只能恢复原私有运维边界，不得恢复宽 Admin Grant、`x-f1-approved-device-ref`、Funnel、公网密码页、端口转发或公网 SSH。公网 3000、RSS collector、唯一 review DB、public last-known-good 与 rollback root 不变。

## 开发与验收闭集

开发的最小改动面只包含 Admin deployment/prepare schema、`requestEnvelope` 身份 parser、相应单元/真实 HTTP 用例与准备文档。不改 Review/Publication 业务实体、公开 UI、公开投影协议或数据根。

同一 release/manifest/policy/Serve 候选必须证明：

1. 不自带项目设备头的已批准 M5/iPhone 顶层导航可到达 Admin HTML，随后 Passkey/session 链可用。
2. 任意或正确的 `x-f1-approved-device-ref` 都不改变 identity，并按本 ADR 拒绝；手工注入两个 Tailscale 头时，后端只观察 Serve 剔除后重建的值。
3. login/app-cap 头的缺失、重复、过长、非法 JSON、未知字段/能力、非 ASCII、0/多 `sourceRef`、错 login/ref 组合全部 `401`且零 session/零业务写。
4. tagged source 因 login 缺失被拒绝；shared/错误用户因 login allowlist 被拒绝；未批准设备在 443 前被阻断；已批准但无精确 Grant/app-cap 的设备不可达或 `401`。
5. M5 与 iPhone 产生不同 `deviceRef`；跨 source 重放 Cookie/challenge/fresh receipt、login/ref 变化、Grant/device 撤销、节点重建后的旧会话全部失效。
6. `3101` 只绑 loopback，公网 3000 Admin/internal 路径继续通用 404，Funnel=0；失败回退不修改 review DB dev/inode、RSS collector、public projection generation 或 synthetic rollback 根。

## 明确排除

首版不新增 LocalAPI WhoIs、PROXY protocol parser、Caddy/Nginx/自定义 proxy、tsnet node 或 Funnel。标准 HTTP Serve 转发后 `3101` 只看到 loopback peer，没有可供 WhoIs 反查 M5/iPhone 的可信 remote IP:port。也不信任 `X-Forwarded-For` / `X-Real-IP`，不让浏览器传 IP、node key 或 device ID。

## 已验证与仍未验证

依据研究部 `TASK-20260812-9D64EC` 官方核验，已确认 Serve 用户头/app-cap 头、同名入站头剔除、`v1.92+ --accept-app-caps`、Grants 并集语义、device approval 分层与当前 WhoIs/loopback 断点。研究时 M1 `1.96.5`、M5 `1.98.9` CLI 已显示该 flag，部署时仍需重新回读真实版本。

仍为 Unknown：用户控制的 capability 域名、真实 login/source selector/policy/device approval/shared node 状态、M1 真实 Serve 注入的字节形状/重复头/重启持久性、iPhone 版本、Mac/iPhone 真机 Passkey/撤销/切网与中国大陆 direct/relay/DERP 长期可用性。同机失陷进程仍可直连 loopback 伪造头，该剩余风险继续由专用 M1、最小进程集、独立运行账号和 owner-only 文件边界承担。

## 依据

- `docs/collaboration/部门/研究部/报告/2026-08-12-Tailscale-Serve可信身份头与设备身份官方核验.md`
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Tailscale application capabilities](https://tailscale.com/docs/features/access-control/grants/grants-app-capabilities)
- [Tailscale Serve examples](https://tailscale.com/docs/reference/examples/serve)
- [Tailscale Grants syntax](https://tailscale.com/docs/reference/syntax/grants)
- [Tailscale device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval)
