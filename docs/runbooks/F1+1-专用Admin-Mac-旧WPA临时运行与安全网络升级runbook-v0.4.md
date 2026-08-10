---
title: F1+1 专用 Admin Mac 旧 WPA 临时运行与安全网络升级 runbook v0.4 successor
type: planning_runbook_successor
status: planning_only
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-F27F25
predecessor: docs/runbooks/F1+1-专用Admin-Mac-远程恢复与跨网联动runbook-v0.3.md
predecessor_sha256: 1bdfe81cdefeddf418bb776c2de0f9fa1131db945d15f5d6b06d55dce6c7dd6c
implementation_authorized: false
network_change_authorized: false
production_authorized: false
external_side_effects: 0
---

# F1+1 专用 Admin Mac 旧 WPA 临时运行与安全网络升级 runbook v0.4 successor

## 0. Successor 与隐私边界

本文是已 ACK v0.3 的不可变 successor。v0.3 保持原路径、字节和 SHA-256，不覆盖、不重命名、不原地补写。v0.4 只吸收用户确认的新事实：macOS 将当前 Wi‑Fi 标记为旧 WPA/低安全性；用户希望先在固定 Mac 本机临时运行，后续再升级安全网络或选择独立网络/网关。

本文严禁复制、转写、散列、编码或保存截图中的 Wi‑Fi 地址、路由器地址、SSID、密码、MAC、IP、序列号、磁盘标识、设备 ID、Apple Account、overlay ID 或其他网络/设备唯一标识。允许记录的网络事实只有 `current_wifi_security=legacy_wpa_low_security`，不记录其名称和地址。

本任务只形成文档。未授权安装、登录、下载、创建账号、读取网络配置、修改路由器、忘记/重连网络、开启 UU、Remote Login/SSH、FileVault、端口、服务、真实 provider、真实密钥/数据、备份上传或部署。

## 1. 事实、官方证据、推断与 Unknown

### 1.1 用户确认事实

| 字段 | 脱敏值 | 证据等级 |
|---|---|---|
| 固定设备 | MacBook Air（M1，2020）/ 8GB / macOS 26.5.1 | 用户已确认 |
| 供电模式 | 可长期接电常驻 | 用户已确认；UPS/断电恢复未验证 |
| 网络形态 | Wi‑Fi only | 用户已确认 |
| 当前 Wi‑Fi 安全 | macOS 标记旧 WPA/低安全性 | 用户已确认；不记录截图地址或标识 |
| 推进顺序 | 先本机临时运行，后升级安全网络 | 用户已确认；不等于当前任务授权真实运行 |

### 1.2 Apple 官方证据

Apple 的路由器安全建议将 WPA3 Personal 作为优先设置，将 WPA2/WPA3 Transitional 作为兼容设置，并在无法采用上述模式时允许 WPA2 Personal（AES）。Apple 明确将 WPA/WPA2 mixed、WPA Personal、WEP 和 TKIP 列为应避免的弱安全设置。来源：[Apple：Recommended settings for Wi‑Fi routers and access points](https://support.apple.com/en-us/102766)。

Apple 的 FileVault 部署文档说明：Apple silicon + macOS 26 或更高版本的 SSH 启动解锁需要 Remote Login 和启动阶段网络；Wi‑Fi 条件只列此前连接过的开放网络或 WPA2-PSK。来源：[Apple：Intro to FileVault](https://support.apple.com/en-ca/guide/deployment/dep82064ec40/web)。

因此，当前旧 WPA 网络不能被写成安全网络、FileVault 启动前 SSH 可用网络或 RTO 恢复路径。TEMP-LOCAL 只允许本机 loopback；远程与生产继续关闭。

### 1.3 当前 Unknown

- 旧 WPA 的具体协议组合、cipher、路由器型号/固件、DHCP、CGNAT 和变更能力；文档禁止读取或保存其地址/名称。
- 固定 Mac 的 FileVault、Remote Login、Firewall、Sharing、UU、自动登录、睡眠和资源状态。
- WPA2 Personal（AES）或 WPA2/WPA3 Transitional 是否可在现有路由器上安全配置，变更后旧设备兼容性和回退是否可证明。
- FileVault 启动阶段在过渡网络上究竟以 WPA2-PSK 重连、DHCP 保留是否命中、网关私有 VPN 是否可从蜂窝外网到达。
- RPO≤15m、RTO≤4h、现场/冷备、旧主 epoch fence 和生产部署。

## 2. 两阶段总合同

| 阶段 | 目的 | 网络与入口 | 数据/能力 | 当前状态 |
|---|---|---|---|---|
| `TEMP-LOCAL` | 先在固定 Mac 形成最小本地 synthetic 预览与 operator 收据 | 仅 loopback；现场本机浏览器，或系统已解锁后另行获批的 UU 图形辅助 | synthetic fixture、mock、manual_only、local SQLite 候选；外部请求和真实副作用=0 | planning_only；尚未获执行授权 |
| `SECURE-NET` | 升级受控 Wi‑Fi 后重新评估私有远程恢复和生产 | 至少 WPA2 Personal（AES）或 WPA2/WPA3 Transitional；此前连接、DHCP 保留、网关私有 VPN、蜂窝外网演练 | 只有安全/测试/用户门均通过后才逐项评估 SSH/FileVault/远程/生产 | Unknown / future gate |

独立网络或独立网关属于 `SECURE-NET` 的后继选项，不是 `TEMP-LOCAL` 的开工前置，也不能被自动采购、安装或配置。

## 3. TEMP-LOCAL 允许范围

### 3.1 未来另获授权后可做

只允许一个精确候选在固定 Mac 上执行：

- 使用已冻结 Node、lock、app/data hash 和本地 synthetic profile；
- 应用只绑定 loopback，允许的监听地址只有标准本地回环；
- 浏览器只从同一固定 Mac 打开本地页面；
- provider=`fixture/mock`，发布=`manual_only`，真实媒体/真实账号/真实 Base/AI/采集/表单/发布/部署全部为 false；
- 进程级 `externalCalls=0`，代理/凭据/真实能力环境变量出现即拒绝；
- 本地 synthetic SQLite 仍受单 profile、单 writer、manifest/hash、WAL/SHM 路径和失败关闭合同约束；
- 只产出脱敏 V-OP/健康/关闭收据，不输出 fixture 正文、路径、账号、网络标识或秘密。

当前任务没有授权执行以上动作；它们只能进入后继精确运行任务。

### 3.2 TEMP-LOCAL 明确禁止

- 监听所有接口、LAN、overlay、公网或任何非 loopback 地址；
- 使用公网 Admin/SSH、端口转发、UPnP、反向隧道、隐藏 URL 或临时 relay；
- 把旧 WPA、UU、普通 Tailscale 或“同一房间里能打开页面”写成远程安全证据；
- 安装/登录/启用 UU、Remote Login、SSH、FileVault、Tailscale、VPN、Git remote 或 signer；
- 读取或写入真实 provider、真实账号、生产数据、生产 DB、密钥、备份、未脱敏日志；
- 真实平台/API/AI/媒体/表单/发布/外部 I/O、自动发布或 public-host 部署；
- 计划重启、意外重启、断网、断电、路由器或 FileVault 实机演练。

### 3.3 TEMP-LOCAL 运行停止条件

任一命中立即停止进程并保持失败关闭：

1. 实际监听超出 loopback，或无法机械证明监听范围；
2. DNS、HTTP、raw socket、子进程、代理或其他外部调用计数非 0/Unknown；
3. 出现真实账号、token、密钥、生产 DB/备份、截图地址或网络唯一标识；
4. provider、publish、profile、manifest、hash、Node/lock 或路径不匹配；
5. 要求登录、安装、改网络、开启 UU/SSH/FileVault 或读取秘密；
6. 设备资源、SQLite、日志或进程状态无法安全关闭；
7. 任何人尝试把 TEMP-LOCAL PASS 外推为 LAN、远程、FileVault、RTO/RPO 或生产 PASS。

### 3.4 TEMP-LOCAL 回退

- 停止本次获批进程，回读 loopback listener=0、externalCalls=0；
- 不删除用户文件、不清理缓存、不移动数据库，除非后继任务单独列明精确对象并获批准；
- 保留最后可证明的本地 synthetic 基线和脱敏失败收据；
- 任何可能已暴露的真实凭据/数据触发安全事件，由安全部定义隔离与轮换；本合同不自行处置真实秘密。

## 4. SECURE-NET 目标合同

### 4.1 最小安全目标

后继网络候选至少满足：

- `security_mode ∈ {WPA2 Personal (AES), WPA2/WPA3 Transitional}`；
- 禁止 WPA/WPA2 mixed、WPA Personal、WEP、TKIP、开放网络作为生产推荐；
- WPA3-only 和 802.1X 不推定支持 FileVault 启动前 SSH；若使用必须有新的 Apple 官方证据与实机门禁；
- 路由器固件、配置备份、唯一 DHCP server、DHCP 保留、私有 VPN、ACL、端口转发=0、UPnP=0、公网 Admin/SSH=0；
- SSID、密码、MAC、IP 等实值只存在于用户批准的受限配置系统，不进入 doc-only 文档、任务报告或 Agent 输出。

### 4.2 SECURE-NET 验证顺序

| Gate ID | 必须证据 | 失败出口 |
|---|---|---|
| `NET-G1-CONFIG` | 用户批准精确路由器/独立网关候选、固件、备份、变更和回退；无地址/秘密输出 | 不改网络，TEMP-LOCAL 保持唯一范围 |
| `NET-G2-SECURITY` | WPA2 Personal（AES）或 WPA2/WPA3 Transitional 实际回读；旧 WPA/TKIP 等均关闭 | 立即回退或保持远程/生产关闭 |
| `NET-G3-REJOIN` | 固定 Mac 此前连接成功；重启前后连接一致；DHCP 保留命中；不输出 SSID/MAC/IP | FileVault/远程门保持 Unknown |
| `NET-G4-PRIVATE-VPN` | 路由器/独立网关私有 VPN 不依赖 Admin Mac 用户态；蜂窝外网可达；公网 listener=0 | 禁止 UU/Tailscale 宿主应用替代 |
| `NET-G5-FILEVAULT` | 用户批准的计划重启；原生 SSH 在启动阶段可达；未解锁时服务/writer/Admin=0；解锁后 readiness | RTO 与远程恢复保持 Unknown |
| `NET-G6-RECOVERY` | RPO≤15m、RTO≤4h、旧主 epoch fence、现场/冷备、public last-known-good 全链收据 | 生产继续关闭 |

通过 `NET-G1..G4` 仍不授权 SSH/FileVault。`NET-G5` 需要新的精确实机授权；`NET-G6` 需要独立安全/测试和用户 production manifest 批准。

## 5. 阶段状态机

```text
TEMP-LOCAL-PLANNING
  └─ 用户批准精确本地候选/hash/命令
       └─ TEMP-LOCAL-RUNNING
            ├─ PASS → TEMP-LOCAL-ONLY
            └─ FAIL/UNKNOWN → TEMP-LOCAL-FAIL-CLOSED

SECURE-NET-PLANNING
  └─ 用户批准网络候选和回退
       └─ NET-G1..G4
            └─ 用户另批 FileVault 演练 → NET-G5
                 └─ 独立恢复门 → NET-G6
                      └─ production manifest 用户批准后方可评估生产
```

TEMP-LOCAL 与 SECURE-NET 可以时间上先后推进，但权限不继承。TEMP-LOCAL PASS 不满足任何 `NET-G*`；网络升级 PASS 也不自动授权 app、真实数据、SSH/FileVault 或生产。

## 6. 临时阶段收据闭集

`additionalProperties=false`：

```text
TASK_ID: <固定任务引用>
RUNBOOK_VERSION: v0.4
RUNBOOK_SHA256: <完整hash>
CANDIDATE_HASH_SET: <脱敏hash引用>
PHASE: TEMP-LOCAL
AUTH_RECEIPT: <脱敏引用或NOT_AUTHORIZED>
BIND_SCOPE: loopback_only | FAIL | UNKNOWN
PROFILE: synthetic_only | FAIL | UNKNOWN
EXTERNAL_CALLS: 0 | FAIL | UNKNOWN
REAL_ACCOUNTS: 0 | FAIL | UNKNOWN
REAL_DATA: 0 | FAIL | UNKNOWN
PUBLIC_ADMIN_LISTENERS: 0 | FAIL | UNKNOWN
PUBLIC_SSH_LISTENERS: 0 | FAIL | UNKNOWN
NETWORK_CHANGES: 0
FILEVAULT_CHANGES: 0
SSH_CHANGES: 0
UU_CHANGES: 0
SENSITIVE_IDENTIFIERS_IN_OUTPUT: 0
RESULT: PASS | FAIL | UNKNOWN_FAIL | NOT_AUTHORIZED | BLOCKED
ROLLBACK: not_needed | completed | failed_closed | not_authorized
UNVERIFIED: <逐项>
NEXT_STAGE_AUTHORIZED: false
NEXT_SINGLE_QUESTION: <一个问题或空>
```

## 7. 当前停止线

- 当前旧 WPA 只是一条低安全性风险事实，不能进入安全、FileVault 启动前、远程或生产的 PASS 证据。
- 当前只可落盘文档；本机进程、监听、登录、网络、SSH/FileVault/UU 和外部能力均不执行。
- 任何文档拟含截图地址、SSID、密码、MAC、IP、路由器地址、序列号或秘密，立即删除拟写内容并 FAIL。
- 发现 v0.3 或输入 hash 漂移时停止，不覆盖历史。

## 8. 唯一下一步用户确认点

> 是否批准后继任务在这台固定 Mac 上，对一个精确 hash 候选执行一次 `TEMP-LOCAL` 验证：仅本机 loopback、synthetic fixture、`externalCalls=0`，不启用 UU/SSH/FileVault、不改网络、不读取真实账号/数据、不部署；执行前仍需回报精确命令、候选 hash、临时路径与停止/回退？

用户回答只授权后继任务进入精确执行前门禁，不授权当前文档任务运行任何命令或服务。

## 9. 当前结论

- v0.4 将用户的“先跑起来”收敛为 TEMP-LOCAL，唯一入口为固定 Mac 本机 loopback + synthetic。
- 当前旧 WPA 无法满足 SECURE-NET 或 FileVault 启动前远程恢复条件。
- 安全网络目标为 WPA2 Personal（AES）或 WPA2/WPA3 Transitional，并必须通过此前连接、DHCP 保留、网关私有 VPN、蜂窝外网重启/FileVault 和恢复全链收据。
- 独立网络/网关属于后继选项，不阻断 TEMP-LOCAL 规划，也不会自动实施。
- 本任务真实设备变更、网络变更、服务启动、外部副作用和生产放行均为 0。

