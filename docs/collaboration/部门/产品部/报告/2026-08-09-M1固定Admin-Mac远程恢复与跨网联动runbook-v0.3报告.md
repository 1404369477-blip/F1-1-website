---
title: M1 固定 Admin Mac 远程恢复与跨网联动 runbook v0.3 报告
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-C4AA4B
status: final
decision: pass_pending_security_review
implementation_state: planning_only
production_authorized: false
external_configuration_changes: 0
---

# M1 固定 Admin Mac 远程恢复与跨网联动 runbook v0.3 报告

## 1. 结论

已生成独立、脱敏的 v0.3 successor 和 closed-set manifest。v0.2 保持原字节与原 SHA-256。v0.3 只记录用户确认的非唯一设备事实：MacBook Air（M1，2020）、8GB、macOS 26.5.1、Apple silicon/M1 类别、可长期接电常驻、Wi‑Fi only。

没有读取、复制、转写、编码或散列截图中的序列号、磁盘标识、硬件 UUID、网卡地址、设备 ID、Apple Account、IP 或其他唯一标识，也没有记录任何恢复秘密。

本任务只形成 planning-only 文档。没有安装、登录、创建账号、修改网络、开启 Remote Login/SSH、开启或调整 FileVault、启用 UU、生成密钥、上传备份、执行故障注入或部署。官方 Apple 资料只做无登录的只读核验，外部状态变更为 0。

## 2. 交付物与 hash

| 交付物 | 路径 | SHA-256 | 状态 |
|---|---|---|---|
| v0.3 successor | `docs/runbooks/F1+1-专用Admin-Mac-远程恢复与跨网联动runbook-v0.3.md` | `1bdfe81cdefeddf418bb776c2de0f9fa1131db945d15f5d6b06d55dce6c7dd6c` | final / planning_only |
| closed-set manifest | `docs/runbooks/F1+1-专用Admin-Mac-远程恢复与跨网联动runbook-v0.3.manifest.json` | `23aa5a33ba456f9a56b3a860247262bd14b0d6606ac709e3a925223324b417a6` | template_not_exported |
| 本报告 | `docs/collaboration/部门/产品部/报告/2026-08-09-M1固定Admin-Mac远程恢复与跨网联动runbook-v0.3报告.md` | 完成时由任务工具校验本地路径 | final |

predecessor `docs/runbooks/F1+1-专用Admin-MacBook-配置执行交接提示词-v0.2.md` 当前 SHA-256 仍为 `97b0dbdf452d7200d4165d8e1629b6424e8ffcdea0aba8237e46c764e428527e`，未覆盖、未重命名、未修改。

## 3. 证据分层

| 层级 | 当前结论 |
|---|---|
| 用户已确认 | 设备系列、M1、8GB、macOS 26.5.1、可长期接电常驻、Wi‑Fi only |
| Apple 官方能力 | Apple silicon + macOS 26 或更高版本，在 Remote Login 已开启且网络连接可用的条件下，重启后可经 SSH 解锁 FileVault |
| Apple 官方网络前提 | 启动阶段可用网络限 Apple 文档列明的既有开放/WPA2-PSK Wi‑Fi，或开放/无需认证 Ethernet；本机 Wi‑Fi only，因此只保留此前已连接的 WPA2-PSK 候选，WPA3-only/802.1X 不推定兼容 |
| 合理推断 | 路由器或独立网关承载私有 VPN，可避免把 Admin Mac 用户态进程当启动前网络前提；真实网关→启动阶段 SSH 的端到端可达性仍需实测 |
| Unknown | UU、FileVault、Remote Login、SSH 用户/认证、Firewall、启动网络、网关、CGNAT、供电、现场 Owner、冷备、epoch fence、真实 RTO/RPO |

只读核验的官方来源：

1. [Apple：What's new for enterprise in macOS Tahoe 26](https://support.apple.com/en-us/124963)
2. [Apple Platform Security：Managing FileVault in macOS](https://support.apple.com/en-ie/guide/security/sec8447f5049/web)
3. [Apple Platform Deployment：Intro to FileVault](https://support.apple.com/en-il/guide/deployment/dep82064ec40/1/web/1.0)

这些资料证明平台类别能力和前置条件，没有证明目标设备的实际设置或跨网链路已可用。

## 4. 三通道收敛

| 通道 | 现行职责 | 当前状态 |
|---|---|---|
| UU 图形通道 | 只在系统已解锁、图形会话和网络均可用后进行短时图形运维与终端辅助 | Unknown；禁止充当 FileVault 启动解锁或唯一恢复路径 |
| 网关私有 VPN + 原生 SSH | 路由器/独立网关先建立私有启动前路径；Admin Mac 通过此前连接的 WPA2-PSK Wi‑Fi 与 DHCP 保留取得私网可达性，再访问原生 SSH 解锁 FileVault | Apple 平台能力已证；蜂窝外网端到端链 Unknown |
| 现场/冷备灾难通道 | 处理供电、宽带、路由器、磁盘、主板、设备丢失和远程路径失败；恢复唯一 writer | Unknown；需 Owner、SLA、冷备、恢复点、epoch fence 与 RTO/RPO 收据 |

公网 22、端口转发、UPnP、公网 Admin、隐藏 URL 和公网隧道保持禁止。Admin 宿主上的 UU 或普通 Tailscale 用户态进程不得写成 FileVault 启动前已证明路径。

## 5. 固定设备资源边界

8GB 只被记录为“单人、低并发、SQLite 单写者、本地 Node 初版的条件式候选”。长期接电也不构成 UPS、断电自启或长稳 PASS。后继 manifest 必须限制构建、服务、worker 与备份尽量串行，禁止默认并发重负载和本地大模型；至少通过 24 小时及 7 天的内存压力、swap、磁盘、温度、延迟、SQLite busy、备份耗时和恢复点 age 收据后才能关闭容量 Unknown。

## 6. closed-set manifest

manifest 精确列出三份 bundle 文档：

| bundle 相对路径 | 固定导出来源 |
|---|---|
| `runbook/remote-recovery-v0.3.md` | v0.3 successor |
| `history/execution-handoff-v0.2.md` | v0.2 predecessor 只读副本 |
| `evidence/dual-mac-three-channel-research.md` | 已 ACK 的两机三通道研究报告 |

manifest 同时固定：

- 设备事实 allowlist 只有型号系列、内存、OS、长期接电、Wi‑Fi only 和证据等级；
- Wi‑Fi only 基线固定此前连接、WPA2-PSK、DHCP 保留、蜂窝外网重启/FileVault 演练；WPA3-only/802.1X 兼容性不推定，SSID/密码/MAC/IP 禁止记录；
- 唯一标识禁止复制、写入、散列和编码；
- 三通道 ID、状态、启动前资格；
- 六类 hard stop 和所有真实动作默认 false；
- 一个后继用户确认问题；
- manifest 自身 hash 走包外可信通道，避免自哈希循环。

## 7. 实施顺序与停止条件

规划顺序固定为：文档闭合 → 获批只读核对 → 选择网关形态 → 网关/私有 VPN 合同 → FileVault/Remote Login/SSH 合同 → 同 LAN 分通道验收 → 跨网和灾难演练 → 独立安全/测试 → production manifest 用户批准。任一阶段只开放下一阶段提问权。

以下情况立即停止：输入 hash 漂移；出现唯一标识或秘密；未授权真实动作；路径依赖宿主 UU/Tailscale 用户态；需要公网 SSH/Admin；Unknown 被写成 PASS；旧主/工作 Mac/public-host/冷备可能在未完成 epoch fence 时写生产数据。

## 8. 唯一下一步用户确认点

> 启动前私有 VPN 的终止点，您计划使用现有路由器，还是使用独立网关设备？请只选择一种；本次回答只授权后继文档选择，不授权登录、安装、改网络、开启 SSH/FileVault、探测或部署。

该问题未回答前，启动前私有 VPN + 原生 SSH 通道保持 `Unknown`。

## 9. 已验证

- v0.2 当前 SHA-256 与 v0.3 frontmatter/manifest 固定值一致。
- v0.3 和 manifest JSON 均已落盘；manifest 可解析，3 个文件路径、3 个通道和所有授权 false 可机械读取。
- Apple 官方资料支持“Apple silicon + macOS 26+ + Remote Login + 网络可用”的条件式 SSH FileVault 解锁能力，并列出启动阶段网络前提；本机基线已收窄为 Wi‑Fi only、此前连接的 WPA2-PSK、DHCP 保留和蜂窝外网 VPN 实测。
- v0.3 明确区分用户确认事实、Apple 官方能力、合理推断和 Unknown。
- UU、网关私有 VPN + 原生 SSH、现场/冷备三通道职责和失败出口互斥。
- 同 LAN 与跨网演练矩阵、RPO≤15m、RTO≤4h、旧主 epoch fence、8GB 资源门、停止条件和单一问题均已写入。
- 新增文档未包含截图唯一标识或恢复秘密；未修改 app、data、design、accepted ADR 或 v0.2。

## 10. 未验证

- 目标设备的 FileVault、Remote Login、SSH、Firewall、Sharing、UU、此前连接/WPA2-PSK 状态、DHCP 保留、启动前 Wi‑Fi 重连、断电恢复、睡眠和资源状态。
- 网关候选、私有 VPN、ISP/CGNAT、蜂窝外网重启/FileVault 演练及跨网端到端 SSH；完成该演练前 RTO 保持 Unknown。
- UU 的产品/版本、会话与解锁后可达性。
- 现场 Owner、到场 SLA、冷备设备、异机备份、旧主 epoch fence、RTO/RPO 和 public-host 恢复。
- manifest 尚未导出，安全部独立复核尚未完成，生产部署仍未授权。

## 11. 错题自检

- 没有读取或处理截图中的序列号及其他唯一标识；也没有保存它们的 hash。
- 没有把 Apple 平台能力外推为目标设备当前可用或端到端链 PASS。
- 没有把 UU、普通 Tailscale macOS 或图形会话写成启动前 FileVault 路径。
- 没有开放公网 SSH、端口转发、UPnP、公网 Admin 或隐藏旁路。
- 没有把 8GB 写成已通过容量验收。
- 没有将文档授权外推为安装、登录、网络、FileVault、SSH、备份、故障注入或部署授权。
- 没有覆盖 v0.2 或修改 accepted 核心。

## 12. 任务状态

本报告落盘后执行机械检查、task doctor 和 complete；完成后等待统筹核收与安全部独立复核。`TASK_STATE_OK` 只证明文档、manifest、报告和任务状态已持久化，不代表目标设备或恢复链已经配置或放行。
