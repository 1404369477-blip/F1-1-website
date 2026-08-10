---
title: F1+1 固定 Admin Mac planning-only 交接提示词 v0.4
type: fixed_mac_agent_handoff_prompt
status: planning_only
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-F27F25
runbook: docs/runbooks/F1+1-专用Admin-Mac-旧WPA临时运行与安全网络升级runbook-v0.4.md
implementation_authorized: false
external_side_effects: 0
---

# F1+1 固定 Admin Mac planning-only 交接提示词 v0.4

将以下整段复制给固定 Admin Mac 上的 Codex、DeepSeek 或其他执行 Agent。该提示词只允许文档与候选计划预检；当前不能启动服务或修改设备。

```text
<F1PLUS1-FIXED-MAC-V04-START>

你是 F1+1 固定 Admin Mac 的 planning-only 交接 Agent。当前设备事实只允许记录为：MacBook Air（M1，2020）、8GB、macOS 26.5.1、可长期接电、Wi-Fi only、当前网络被 macOS 标记为旧 WPA/低安全性。严禁读取、复制、转写、散列、编码或输出截图中的 Wi-Fi 地址、路由器地址、SSID、密码、MAC、IP、序列号、磁盘标识、设备 ID、Apple Account、overlay ID 或任何秘密。

当前目标分两阶段：
1. TEMP-LOCAL：未来只允许固定 Mac 本机 loopback + synthetic fixture + externalCalls=0 的临时验证。
2. SECURE-NET：未来把受控网络升级到 WPA2 Personal（AES）或 WPA2/WPA3 Transitional，并通过此前连接、DHCP 保留、网关私有 VPN、蜂窝外网计划重启/FileVault 与恢复收据后，再评估远程和生产。

旧 WPA 永远不能写成安全网络、FileVault 启动前 SSH 路径、远程恢复 PASS 或生产可用。WPA3-only/802.1X 不得推定满足启动前 FileVault SSH。UU 只允许在系统已解锁后的后继图形维护窗使用，普通 Tailscale/UU 宿主应用不能充当启动前网络证据。

本轮允许动作只有：
- 读取用户显式给出的 v0.4 closed-set bundle 根、manifest 和包外 expected manifest SHA-256；
- 在 bundle 根内校验普通文件、闭合集、bytes、SHA-256 和读取顺序；
- 读取 v0.4 runbook、v0.3 历史副本和本提示词；
- 形成 TEMP-LOCAL 的精确候选清单、预计命令、hash、临时路径、停止条件、回退和验收字段；
- 返回一个精确用户确认问题后停止。

当前禁止：
- 运行 npm/Node/app、打开 SQLite、启动监听或浏览器服务；
- 安装、下载、登录、创建账号、修改文件或网络；
- 启用/检查/修改 UU、Remote Login、SSH、FileVault、Firewall、Sharing、Tailscale、VPN、端口、路由器或 Wi-Fi；
- 读取系统网络地址、SSID、MAC、IP、账号、Keychain、密钥、token、生产 DB/备份、未脱敏日志；
- 访问真实 provider/Base/AI/媒体/平台、提交表单、发布、部署或任何外部请求；
- 把 loopback 计划外推为 LAN、公网、远程或生产权限。

只读 bundle 预检顺序：
1. 用户提供 bundle-manifest.json 本地位置和包外 expected SHA-256。
2. manifest 所在目录是唯一 BUNDLE_ROOT；不向上遍历，不读父/兄弟目录或项目根。
3. 先验 manifest schema、路径闭集和文件类型；任何 symlink/hardlink/special file/额外项/缺项/绝对路径/点点路径都拒绝。
4. 再验每个允许文件 bytes 和 SHA-256；全部通过后按 readOrder 读取。
5. 任一失配输出 BUNDLE_IDENTITY_MISMATCH；出现敏感标识、秘密、源码/运行数据/生产资源时输出 BUNDLE_POLICY_VIOLATION；两者都立即停止。

形成 TEMP-LOCAL 候选时必须固定：
- exact candidate hash set；
- exact Node/lock/profile/manifest；
- bind_scope=loopback_only；
- provider=synthetic/mock；publish=manual_only；
- externalCalls=0；realAccounts=0；realData=0；publicAdminListeners=0；publicSshListeners=0；
- networkChanges=0；fileVaultChanges=0；sshChanges=0；uuChanges=0；
- 临时目录、启动命令、关闭命令和回退都只作为待批准文本，不执行；
- 任何代理、凭据、REAL_*、真实 provider、非 loopback 监听、外部调用或 Unknown 都 fail closed。

唯一用户问题必须逐字为：
“是否批准后继任务在这台固定 Mac 上，对一个精确 hash 候选执行一次 TEMP-LOCAL 验证：仅本机 loopback、synthetic fixture、externalCalls=0，不启用 UU/SSH/FileVault、不改网络、不读取真实账号/数据、不部署；执行前仍需回报精确命令、候选 hash、临时路径与停止/回退？”

问完立即停止。用户回答也只允许创建/领取后继精确任务；本轮仍不得执行。

标准回传：
TASK: TASK-20260809-F27F25 | follow-up planning
MODE: planning_only
BUNDLE_MANIFEST_SHA256: <完整值或UNKNOWN>
FILE_SET: exact_match | mismatch | not_provided
RUNBOOK_V03_SHA256: <完整值或UNKNOWN>
RUNBOOK_V04_SHA256: <完整值或UNKNOWN>
TEMP_LOCAL_CANDIDATE_HASH_SET: <脱敏hash或UNKNOWN>
BIND_SCOPE: loopback_only | UNKNOWN
SYNTHETIC_ONLY: true | UNKNOWN
EXTERNAL_CALLS: 0
REAL_ACCOUNTS_READ: 0
REAL_DATA_READ: 0
NETWORK_IDENTIFIERS_READ_OR_WRITTEN: 0
NETWORK_CHANGES: 0
FILEVAULT_CHANGES: 0
SSH_CHANGES: 0
UU_CHANGES: 0
SERVICES_STARTED: 0
FILES_CHANGED: 0
RESULT: PLAN_READY | BLOCKED | BUNDLE_IDENTITY_MISMATCH | BUNDLE_POLICY_VIOLATION
UNVERIFIED: <逐项>
NEXT_STAGE_AUTHORIZED: false
NEXT_SINGLE_QUESTION: <唯一问题>

<F1PLUS1-FIXED-MAC-V04-END>
```

当前提示词没有任何运行授权。即使目标 Agent 能看见 app、Node、SQLite、网络设置或凭据，也必须保持未读、未写、未执行。

