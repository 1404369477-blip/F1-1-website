---
title: Tailscale Serve app-cap 私有入口身份产品报告
type: work_report
department: 产品部
status: final
decision: accepted_successor_code_and_tailnet_pending
task_id: TASK-20260812-C2A6B8
date: 2026-08-12
scope: Serve login、app capability sourceRef、Passkey/session三元绑定与x-f1头语义纠正
implementation_authorized: true
implementation_complete: false
production_ready: false
---

# C2A6B8：Tailscale Serve app-cap 私有入口身份产品报告

## 结果

已将私有 Admin 入口身份收敛为一个 accepted successor：

- accepted ADR：`docs/decisions/system/2026-08-12-F1+1-Tailscale-Serve-app-cap私有入口身份-successor-accepted.md`
- decision ID：`ADR-M5-ADMIN-PRIVATE-IDENTITY-002`
- Spec 与初版 Function 矩阵已同步；Function 状态与计数不变，`ADMIN-SEC-002` 与 `DEPLOY-006` 继续 `P1-blocker`。

唯一安全结论为：`x-f1-approved-device-ref` 没有 Tailscale Serve 官方 producer，浏览器/扩展/curl 自行填写只是请求者自报。它已从身份、challenge、session、授权和 fresh re-auth 的全部安全语义中删除。首版实现须对该头“存在即拒绝”，不记录头值。

## 开发唯一输入/输出合同

### 部署输入

`admin-service-deployment-v3` 与现有四根 successor 合并，新增/更正：

```text
tailscaleAppCapabilityId = <user-controlled-domain>/cap/f1-admin-device
trustedIdentities        = 精确 1 个 {login, operatorRef, sourceRefs}
sourceRefs               = 精确 2 个不重复的 43-char base64url，分别对应 M5/iPhone
```

prepare CLI 输入：

```text
F1_ADMIN_TAILSCALE_APP_CAPABILITY_ID
F1_ADMIN_TRUSTED_IDENTITIES_JSON
```

现有 `trustedIdentities[].deviceRefs` 删除，旧字段不隐式转换。真实值只进 owner-only 受限 manifest，不进仓库/普通报告/收据。

### HTTP 预认证输入

`127.0.0.1:3101` 在返回静态 HTML、Passkey route 或业务 API 前必须完成：

1. loopback peer 与既有 Host/method/path/HTTP 闭集；
2. `x-f1-approved-device-ref` 出现即 `401`；
3. 单值、ASCII、`3..320` bytes 的 `Tailscale-User-Login`，逐字节匹配唯一 login；
4. 单值、`1..4096` bytes 的 `Tailscale-App-Capabilities`，JSON 顶层只含 manifest 的精确 capability ID；
5. capability value 只含一个 `{sourceRef}`，且与同 login 的受限 allowlist 唯一匹配。

缺失、重复、过长、非法 JSON、非 ASCII、未知能力/字段、0 或多个 ref、login/ref 交叉不匹配都统一 `401 ADMIN_SESSION_REQUIRED`，不回退为 login-only。

### 内部输出与会话

```text
operatorRef    = manifest operatorRef
tailnetUserRef = tailnet-user- + SHA-256(login) 前16 hex
deviceRef      = device- + SHA-256(sourceRef) 前16 hex
```

Passkey bootstrap/login challenge、server-side session、每请求校验与 fresh re-auth 都绑定 `(operatorRef, tailnetUserRef, deviceRef)`。M5/iPhone 允许共享同步 passkey，两端 `deviceRef` 不同；跨端 Cookie/challenge/fresh receipt 重放会因当前 source 三元组不等而 `401`。

## 网络与策略合同

- M5/iPhone 保持 user-owned，M1 可标记 `tag:f1-admin-server`。
- M5 与 iPhone 各自一条精确 source Grant，同时授予 `tcp:443` 和同一 capability ID，参数 `sourceRef` 分别唯一。
- device approval 继续开启；它负责实际设备入网，app-cap 负责 per-request policy-scoped source 证明。
- Grants 按并集生效；其他宽 Grant 不得再授予同一 app cap。
- Serve 形状为 `tailscale serve --accept-app-caps=<capability-id> --bg 3101`，仍为 tailnet-only HTTPS 443，Funnel=0。

## 实施顺序

```text
用户/受限部署输入
→ deployment-v3 disabled prepare
→ device approval + 两条精确 Grant + policy validator/hash
→ loopback 3101 load（mutation=0）
→ Serve app-cap 预认证实测
→ Passkey bootstrap + M5/iPhone 三元会话验收
→ backup/writer/fresh re-auth 其他门
→ manual publish / projection active / public cutover
```

预认证失败即关闭 Serve/Grant/Admin 与所有会话，不改公网 3000、RSS collector、review DB path/dev/inode、public last-known-good 或 synthetic rollback 根。

## 用户仍需提供/确认的真实输入

这些值当前均为 `Unknown`，不在文档中猜测：

1. 一个用户实际控制的 capability DNS 域名；
2. Serve 实际 `Tailscale-User-Login`；
3. 当前 M5/iPhone 的精确 source selector 及其底层指向；
4. 真实 device approval、宽 Grants、shared nodes 现状和变更后 canonical policy hash；
5. M1 Serve 真实头字节、重复头、撤销和重启持久性收据。

用户已批准 Tailscale 私有 Admin 路线与安装。本次不需要为合同纠正再问一次；真实 tailnet 写入前仍必须把上述具体值收进受限 deployment manifest。

## 未扩展的边界

本任务未修改 app，未通过 SSH 操作 M1，未安装/登录 Tailscale，未改 device approval、Grant、Serve 或 Funnel，也未部署。LocalAPI WhoIs、PROXY protocol、定制 proxy/tsnet、公网 Admin、端口转发与 Funnel 继续排除。

## 自审与剩余风险

- 已验证的官方事实与真实 tailnet 环境事实已分开表达；后者没有被写成 PASS。
- `sourceRef` 只是策略绑定 source 分类；报告没有将它写成硬件身份。
- loopback 无法抵御已失陷的 M1 本地进程伪造头；专用主机、最小进程集、独立运行账号与 owner-only 文件权限仍是剩余信任边界。
- 中国大陆异地 Wi-Fi/蜂窝、direct/peer relay/DERP 长期稳定性仍需上线候选实测，本合同不对可用率作无证据承诺。
