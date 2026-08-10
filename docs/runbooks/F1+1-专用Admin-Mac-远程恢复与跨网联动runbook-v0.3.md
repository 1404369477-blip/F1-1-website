---
title: F1+1 专用 Admin Mac 远程恢复与跨网联动 runbook v0.3 successor
type: planning_runbook_successor
status: planning_only
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-C4AA4B
predecessor: docs/runbooks/F1+1-专用Admin-MacBook-配置执行交接提示词-v0.2.md
predecessor_sha256: 97b0dbdf452d7200d4165d8e1629b6424e8ffcdea0aba8237e46c764e428527e
implementation_authorized: false
production_authorized: false
external_configuration_changes: 0
---

# F1+1 专用 Admin Mac 远程恢复与跨网联动 runbook v0.3 successor

## 0. 文档效力与隐私边界

本文是 v0.2 的独立 successor，v0.2 保持原字节与原 SHA-256，不覆盖、不重命名、不原地修订。v0.3 只吸收用户确认的固定设备类别和 macOS 版本，并把远程恢复拆成三个职责互斥的通道。

本文仅用于规划。未授权安装、登录、创建账号、修改路由器或 Mac 网络、开启 Remote Login/SSH、开启或调整 FileVault、启用 UU、生成密钥、读取生产数据库、上传备份、运行真实探针、故障注入或部署。

允许记录的设备事实闭集只有：

| 字段 | 值 | 证据等级 |
|---|---|---|
| 设备系列 | MacBook Air（M1，2020） | 用户已确认 |
| 内存 | 8GB | 用户已确认 |
| 操作系统 | macOS 26.5.1 | 用户已确认 |
| 芯片类别 | Apple silicon / M1 | 由已确认型号直接得到 |
| 供电使用方式 | 可长期接电常驻 | 用户已确认；不等于 UPS/断电恢复已验证 |
| 网络物理边界 | Wi‑Fi only | 用户已确认；禁止记录 SSID、密码、MAC、IP |

永久禁止在本文、manifest、任务报告、日志或收据中复制、转写、编码或散列截图里的序列号、磁盘标识、硬件 UUID、网卡地址、设备 ID、Apple Account、IP、overlay ID 或其他唯一标识。需要在未来 production manifest 绑定设备时，只允许由用户批准的独立受限系统保存不可逆候选引用；doc-only bundle 只记录引用是否存在和对应 manifest hash，不保存引用实值。

## 1. 事实、官方能力、推断与 Unknown

### 1.1 已确认事实

- 目标设备属于 Apple silicon，运行 macOS 26.5.1，满足 Apple 官方所述“Apple silicon + macOS 26 或更高版本”的平台范围。
- 内存为 8GB；用户确认可长期接电常驻且网络只能使用 Wi‑Fi。当前没有这台设备上的内存压力、swap、温度、磁盘余量、睡眠、断电恢复或连续运行收据。

### 1.2 Apple 官方能力

Apple 官方资料确认：在 Apple silicon Mac 且 macOS 26 或更高版本上，若 Remote Login 已开启且网络连接可用，重启后可以通过 SSH 解锁 FileVault。Apple 同时列出启动阶段网络前提：曾连接过的开放 Wi‑Fi 或 WPA2-PSK Wi‑Fi，或开放/无需认证的 Ethernet。本设备已确认 Wi‑Fi only，因此当前只保留“此前已连接 + WPA2-PSK”作为启动前受控候选；开放 Wi‑Fi 不进入生产推荐，Ethernet 不属于本机现行物理路线。WPA3-only、802.1X/企业认证、网页 portal 或其他 Wi‑Fi 形态不得推定兼容。来源：

1. [Apple：What's new for enterprise in macOS Tahoe 26](https://support.apple.com/en-us/124963)
2. [Apple Platform Security：Managing FileVault in macOS](https://support.apple.com/en-ie/guide/security/sec8447f5049/web)
3. [Apple Platform Deployment：Intro to FileVault](https://support.apple.com/en-il/guide/deployment/dep82064ec40/1/web/1.0)

这项官方能力只证明操作系统具备条件式能力。它没有证明本机已开启 Remote Login、已开启 FileVault、已允许某个解锁用户、目标 WPA2-PSK Wi‑Fi 已在启动前正确重连、路由器 VPN 能到达启动阶段 SSH、UU 能在启动阶段运行，或跨网链路满足 RTO/RPO。

### 1.3 合理推断

- 外置路由器或独立网关若承担私有 VPN 终止点，它不依赖 Admin Mac 的用户态进程启动，可作为“先到达家庭/办公室私网，再访问 Apple 原生启动阶段 SSH”的候选网络结构。路由器需为 Admin Mac 保留稳定 DHCP 租约映射；文档和收据只记录规则存在/命中，不记录 MAC 或 IP 实值。
- 该结构能否穿过实际 CGNAT、路由、防火墙、VLAN、Wi‑Fi/Ethernet 启动条件并到达本机 SSH，必须通过另行批准的真实演练证明。
- 8GB 对单人、低并发、SQLite 单写者、本地 Node 初版可能足够；生产适用性仍需资源预算和长稳收据。本文不把“可能足够”写成容量 PASS。

### 1.4 当前 Unknown

- UU 的精确产品、版本、账号、启动方式、图形会话前置、跨网可达性和故障恢复行为。
- FileVault、Remote Login、允许解锁用户、SSH 认证方式、full disk access、Firewall、Sharing、自动登录的当前状态。
- 目标 Wi‑Fi 是否已经在该 Mac 上成功连接、是否为 WPA2-PSK、启动阶段是否自动重连，以及 WPA3 过渡模式的实际行为；SSID、密码、MAC、IP 均禁止进入文档。
- 路由器/独立网关型号、固件、私有 VPN 能力、Owner、配置备份、供电、ISP/CGNAT 和公网地址变化。
- 现场 Owner、到场 SLA、冷备设备、异机备份、解密托管、旧主 epoch fence 和实际 RTO/RPO。

## 2. 三通道职责边界

| Channel ID | 使用阶段 | 唯一职责 | 明确禁止 | 当前 |
|---|---|---|---|---|
| `CHANNEL-1-UU-GRAPHICAL-AFTER-UNLOCK` | 系统已解锁、图形会话和网络均可用后 | 短时图形运维、查看 UI 状态、辅助终端；只在具名维护窗使用 | 不承担 FileVault 启动解锁、不充当唯一远程恢复通道、不存恢复密钥、不开放公网 Admin | `Unknown / planning_only` |
| `CHANNEL-2-GATEWAY-VPN-NATIVE-SSH-PREBOOT` | 重启后、用户图形会话前 | 路由器或独立网关先提供私有 VPN 路径；Admin Mac 通过此前已连接的 WPA2-PSK Wi‑Fi 和 DHCP 保留取得稳定私网可达性，再在 Apple 官方前提满足时访问 macOS 原生 SSH完成 FileVault 解锁和最小 readiness | 不使用公网 22、端口转发、UPnP、隐藏 URL 或公网隧道；不推定 WPA3-only/802.1X 兼容；不把宿主 UU/Tailscale 用户态进程当启动前证据 | `Apple capability documented; Wi-Fi-only end-to-end Unknown` |
| `CHANNEL-3-ONSITE-COLD-DISASTER` | 远程链不可用或主机/地点故障 | 处理断电、宽带、路由器、磁盘、主板、丢失、远程解锁失败；现场恢复或冷备重建唯一 writer | 不让工作 Mac 临时成为生产写主；不从 iCloud/Git/聊天恢复生产 DB、密钥或备份 | `Unknown / manifest gate` |

通道切换不自动发生。每次切换都需要明确 reason、Owner、当前 writer epoch、恢复点、允许动作、停止条件和收据。Channel 1 失败不能自动开启 Channel 2；Channel 2 失败不能自动让工作 Mac 提升为 writer；Channel 3 的实机操作仍需单独授权。

## 3. 固定设备的最小运行边界

### 3.1 8GB 单人初版候选

未来只允许在 production manifest 中采用以下最小资源模型，并以实测关闭：

- 单一 Admin 主机、单一 SQLite writer、低频 mock/后继获批采集任务；
- 前台构建、服务启动、worker、备份快照尽量串行，禁止默认并发跑构建、多个 worker、浏览器重负载和本地大模型；
- production 不引入 Docker、Redis、Postgres、多实例、双活数据库或本地生成式 AI，除非新决策另行批准；
- SQLite 数据库、WAL/SHM、运行日志和 backup staging 全部位于非同步本地受限路径；
- 内存压力、swap、磁盘余量、温度、事件循环延迟、SQLite busy、备份耗时任一 Unknown 或越界时停止新持久写，保持公开 last-known-good。

容量 PASS 至少需要：空闲/典型/峰值三档的 24 小时和 7 天收据、内存压力、swap 增量、磁盘余量、温度/降频、请求延迟、SQLite busy/锁等待、备份时长及恢复点 age。当前均未运行。

### 3.2 始终不变的拓扑

- Admin Mac 只承载后台、采集处理、唯一写主和备份调度。
- Admin Mac 可长期接电常驻；UPS、断电自启、路由器供电和宽带恢复仍须独立门禁。网络基线固定为 Wi‑Fi only，不规划 Ethernet 回退。
- public-host 独立，只接收单向签名只读投影，不能提升为写主。
- 工作 Mac/iPhone 只经已批准私有通道访问；生产 SQLite、密钥、运行目录、备份不经 iCloud、Git 或工作 Mac。
- 公网 Admin listener 和公网 SSH listener 始终为 0。
- `writer_count=1`；任何旧主、冷备或恢复主机写入前必须取得新 epoch 并完成旧主 fence。

## 4. 配置期同 LAN 演练计划

本节只定义未来授权后的顺序，不执行。

| Phase | 规划动作 | 必须证据 | 停止条件 |
|---|---|---|---|
| `LAN-0` | 只读核对设备类别、OS 版本、供电、网络类型和 v0.3/manifest hash | 不含唯一标识的设备事实收据 | 发现唯一标识、hash 漂移或实际 OS 不符 |
| `LAN-1` | 设计路由器/独立网关私有 VPN、Wi‑Fi only 启动网络、DHCP 保留和 deny-public 规则 | 拓扑、Owner、配置备份、ACL、此前连接 + WPA2-PSK 兼容性、DHCP 保留存在、端口转发/UPnP=0；不记录 SSID/MAC/IP | 需要公网 SSH/Admin、WPA3-only/802.1X、网关能力 Unknown |
| `LAN-2` | 规划 FileVault、Remote Login、允许用户、SSH key/command、full disk access=off | 用户批准的敏感材料托管引用；禁止实值进入文档 | 未有恢复材料、Owner、回退或单独授权 |
| `LAN-3` | 计划重启；先从同 LAN 外部受控端验证 WPA2-PSK 启动前重连，再经私有 VPN/SSH验证启动阶段 | DHCP 保留命中；未解锁时服务/writer/Admin=0；解锁后 readiness PASS；输出不含 SSID/MAC/IP | VPN/SSH 不可达、Wi‑Fi 未在启动前重连、网络条件不符、出现额外 listener |
| `LAN-4` | 系统解锁后验证 UU 图形维护窗 | UU 只在解锁后可达；关闭后监听/会话/权限归零 | UU 在锁前被误列为恢复路径、无法证明关闭 |
| `LAN-5` | 验证旧主 epoch fence、备份恢复点与 public last-known-good | 旧 epoch 全持久写拒绝，writer=1，RPO/RTO 计时点闭合 | 旧主仍可写、恢复点不可证明、public-host 被提升 |

## 5. 运行期跨网演练计划

每个场景都必须由后续用户对精确对象、时间窗、影响和回退单独批准；一次只执行一个场景。

| Case ID | 注入/场景 | 预期通道 | 必须结果 |
|---|---|---|---|
| `XNET-01` | Admin 已解锁，日常图形维护 | Channel 1 | UU 只在维护窗可达；Admin 应用强认证仍生效；关闭回读 PASS |
| `XNET-02` | 计划重启且现场无人；从蜂窝外网进入私有 VPN | Channel 2 | 网关私有 VPN 在宿主用户态之外可用；Wi‑Fi 启动前重连和 DHCP 保留命中；原生 SSH 启动前可达；解锁前业务服务/writer/Admin=0；解锁后完整 readiness |
| `XNET-03` | UU 不可达 | Channel 2 或保持失败关闭 | 不开放公网入口；CLI/SSH 若未获批则保持远程 mutation=0 |
| `XNET-04` | Admin 宿主 overlay/用户态代理未启动 | Channel 2 | 不能把宿主 UU/Tailscale 当启动前路径；只认网关 VPN + 原生 SSH 的独立证据 |
| `XNET-05` | 路由器/VPN/ISP/CGNAT 故障 | Channel 3 | 远程恢复停止；public 保持 last-known-good；现场 Owner/SLA 或冷备启动 |
| `XNET-06` | 主机磁盘/主板故障或设备丢失 | Channel 3 | 旧主多层 fence、凭据撤销、从已验证恢复点重建，writer_count 始终不超过 1 |
| `XNET-07` | 新主提升后旧主重回 | Channel 3 / epoch fence | 旧 epoch 的业务、队列、投影、备份成功点、权限与设备变更全部拒绝 |
| `XNET-08` | Git 与 signer/identity provider 联合故障 | 保持当前主机 | last-known-good 继续；新部署和新发布=0；不从 iCloud/工作 Mac 注入补丁 |

## 6. RTO/RPO 与恢复收据

- RPO 目标仍为 `≤15 分钟`。判定值为事故发生/可信当前时点与最新可恢复 source state cut 完成时间之差；该恢复点必须绑定数据库身份引用、ledger high-water mark、snapshot hash、远端持久化与认证回读时间。禁止使用“最后一笔业务写入时间”替代恢复点时间。
- RTO 目标仍为 `≤4 小时`。起点使用最早可证明的事故/不可服务时间；终点必须同时包含唯一 Admin writer、旧主 fence、数据库/ledger/hash、Mac/iPhone 私有 Admin、全量公开投影重建/签名/push/原子激活、active receipt、public GET PASS，以及临时/break-glass 能力归零。
- UU 恢复图形画面、SSH 成功登录、FileVault 解锁或 Node 进程启动都只是中间事件，不能单独结束 RTO。
- 在蜂窝外网完成“计划重启 → Wi‑Fi 启动前重连 → 网关私有 VPN → 原生 SSH/FileVault 解锁 → 全链 readiness”的实测前，RTO 保持 `Unknown`。
- 供电、宽带、路由器、主机、备份、现场 Owner 任一故障使 RTO/RPO 不可证明时，高风险和不可重建持久写保持关闭。

## 7. 实施阶段与授权边界

| Stage | 当前允许 | 后继真实动作前置 |
|---|---|---|
| `P0-DOC` | 形成本文、manifest、hash、脱敏报告 | 当前任务授权；零真实配置 |
| `P1-READONLY` | 未来只读核对 OS、网络类型、现有 Sharing/FileVault 状态 | 用户批准精确只读字段和设备窗口；输出不得含唯一标识/秘密 |
| `P2-GATEWAY` | 规划并验证路由器/独立网关候选 | 用户先选路由器或独立网关，再批准网络变更与负例窗口 |
| `P3-MAC-SECURITY` | 规划 FileVault、Remote Login、SSH、账号和恢复材料 | 独立 production manifest/hash、Owner、托管、回退与用户批准 |
| `P4-CHANNELS` | 同 LAN 分别验证 Channel 1/2，Channel 3 只做桌面演练 | 每通道独立授权、成功/失败/关闭收据 |
| `P5-DISASTER` | 现场/冷备、旧主 fence、RTO/RPO 真实演练 | 故障注入授权、可证明恢复点、现场 Owner、回退与安全/测试窗口 |
| `P6-PRODUCTION` | 无 | 唯一 production deployment manifest/hash 再获用户批准 |

任一阶段 PASS 只开放下一阶段提问权，不自动授权下一阶段。

## 8. 停止条件

命中任一条件立即停止，返回 `BLOCKED` 或 `UNKNOWN_FAIL`：

1. v0.2 或引用输入的字节/hash 漂移；
2. 文档或输出拟包含序列号、恢复密钥、账号、IP、设备 ID、磁盘/网卡唯一标识或未脱敏日志；
3. 要求安装、登录、改网络、开启 FileVault/Remote Login/UU、生成密钥、上传备份或部署，但没有对应精确用户授权；
4. 启动前路径依赖 Admin Mac 用户态 UU/Tailscale/图形会话；
5. 需要公网 22、端口转发、UPnP、公网 Admin、隐藏 URL 或公网隧道；
6. Remote Login、FileVault 用户、此前连接/WPA2-PSK、DHCP 保留、启动阶段 Wi‑Fi、蜂窝外网到网关 VPN、现场 Owner、冷备、旧主 fence、恢复点或 RTO/RPO 任一 Unknown 却被写成 PASS；
7. 任何恢复方案会让工作 Mac、public-host、旧主或冷备在未完成 epoch 提升/fence 时写生产数据。

## 9. 闭集收据模板

未来每次只读预检或获批演练只能返回以下字段；`additionalProperties=false`：

```text
RUNBOOK_VERSION: v0.3
RUNBOOK_SHA256: <完整hash>
MANIFEST_SHA256: <完整hash>
DEVICE_PROFILE: macbook-air-m1-2020-8gb-macos-26.5.1
UNIQUE_IDENTIFIERS_READ_OR_WRITTEN: 0
CHANNEL: CHANNEL-1 | CHANNEL-2 | CHANNEL-3
STAGE: P1-READONLY | P2-GATEWAY | P3-MAC-SECURITY | P4-CHANNELS | P5-DISASTER
AUTH_RECEIPT_REF: <脱敏引用或NOT_AUTHORIZED>
RESULT: PASS | FAIL | UNKNOWN_FAIL | NOT_AUTHORIZED | BLOCKED
WRITER_COUNT: 0 | 1 | UNKNOWN
PUBLIC_ADMIN_LISTENER_COUNT: 0 | UNKNOWN
PUBLIC_SSH_LISTENER_COUNT: 0 | UNKNOWN
RPO_RECEIPT_REF: <脱敏引用或UNKNOWN>
RTO_RECEIPT_REF: <脱敏引用或UNKNOWN>
CHANGES: <脱敏摘要或none>
EXTERNAL_EFFECTS: <类型/数量或0>
UNVERIFIED: <逐项>
ROLLBACK: not_needed | completed | failed_closed | not_authorized
NEXT_STAGE_AUTHORIZED: false
NEXT_SINGLE_QUESTION: <一个问题或空>
```

## 10. 唯一下一步用户确认点

在任何只读设备核对或网络设计开始前，只问以下一个问题：

> 启动前私有 VPN 的终止点，您计划使用现有路由器，还是使用独立网关设备？请只选择一种；本次回答只授权后继文档选择，不授权登录、安装、改网络、开启 SSH/FileVault、探测或部署。

未回答时，`CHANNEL-2-GATEWAY-VPN-NATIVE-SSH-PREBOOT` 保持 `Unknown`，其他通道也不得替代它宣告无人值守远程恢复已可用。

## 11. 当前结论

- 设备系列、内存和 OS 版本已形成脱敏、非唯一设备画像。
- Apple 官方平台条件在类别层匹配；本机已固定 Wi‑Fi only，启动候选必须使用此前连接的 WPA2-PSK Wi‑Fi、DHCP 保留和外部网关 VPN。本机设置、启动阶段重连和端到端链仍未验证。
- UU 被限制为解锁后的图形运维通道；网关私有 VPN + 原生 SSH 是启动前候选；现场/冷备是灾难通道。
- 本任务真实配置、外部副作用、设备变更和生产放行均为 0。
