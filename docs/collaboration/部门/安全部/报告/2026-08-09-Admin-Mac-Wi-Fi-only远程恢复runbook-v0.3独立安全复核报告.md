---
title: Admin Mac Wi-Fi-only 远程恢复 runbook v0.3 独立安全复核报告
type: audit_report
department: 安全部
target: F1+1 专用 Admin Mac 远程恢复与跨网联动 runbook v0.3 successor
status: final
date: 2026-08-09
related_task: TASK-20260809-9F010E
decision: pass
tags: security,admin,mac,wifi,filevault,remote-recovery
summary: v0.3规划合同与closed-set manifest安全分层、三通道互斥、无公网入口和授权停止线通过；当前被macOS标为低安全性的Wi-Fi不满足生产或FileVault启动前门，loopback无秘密本地开发可继续
---

# Admin Mac Wi-Fi-only 远程恢复 runbook v0.3 独立安全复核报告

## 1. 三项独立结论

### 1.1 v0.3 文档设计

**PASS。P0=0，P1=0，P2=1。**

v0.3 正确区分用户确认事实、Apple 条件式平台能力、架构推断与 Unknown；UU、网关私有 VPN+原生 SSH、现场/冷备三通道职责互斥；公网 Admin/SSH、端口转发、UPnP、隐藏 URL和公网隧道持续关闭；唯一标识与秘密禁止进入文档、manifest、日志和收据；8GB与长期接电没有被写成容量、供电或长稳 PASS；RPO/RTO保持 Unknown，所有真实动作授权均为 false。

### 1.2 当前真实 Wi-Fi 对生产/启动前通道的适用性

**FAIL / UNKNOWN_FAIL，禁止作为生产或 FileVault 启动前 Channel 2 证据。**

脱敏事实：目标 Mac 当前连接的网络被 macOS 明确标记为旧 WPA/低安全性。Apple 官方安全建议将 WPA/WPA2 mixed、WPA Personal和 TKIP列为应避免配置；Apple 的 FileVault 启动前 SSH 文档只列“此前连接过的开放网络或 WPA2-PSK”等条件式网络前提。

当前证据没有证明网络为独立 WPA2-PSK 且使用可接受的 AES/CCMP、没有证明排除 mixed/TKIP、没有证明启动前自动重连、DHCP保留、网关私有 VPN、蜂窝外网端到端 SSH或可信关闭公网入口。因此：

- `CHANNEL-2-GATEWAY-VPN-NATIVE-SSH-PREBOOT=UNKNOWN_FAIL`；
- Remote Login、FileVault 远程解锁、跨网生产、RTO/RPO和无人值守恢复均不得启用或宣称可用；
- 不得把“当前能上网”、UU/Tailscale用户态连通、路由器页面显示连接或 SSH在解锁后可达当作启动前证据；
- 本报告不授权调整路由器、Wi-Fi、FileVault、Remote Login、SSH、UU或任何账号/密钥。

### 1.3 本机 loopback 临时开发

**可继续，但只限严格本地开发边界。**

允许条件：服务仅监听 loopback；公网 Admin/SSH为0；无真实账号、生产 secret、生产数据、真实 provider、外部副作用或生产 writer；测试数据为本地 synthetic；外部网络能力保持关闭；不借当前 Wi-Fi开启跨设备访问或生产恢复路径。当前弱 Wi-Fi不自动阻断这种无外部副作用的 loopback开发，但它阻断任何把该设备提升为跨网/生产 Admin主机的动作。

## 2. 冻结对象与哈希

| 对象 | 任务固定 SHA-256 | 复核前 | 复核后 |
|---|---|---|---|
| v0.3 runbook | `1bdfe81cdefeddf418bb776c2de0f9fa1131db945d15f5d6b06d55dce6c7dd6c` | 匹配 | 匹配 |
| v0.3 manifest | `23aa5a33ba456f9a56b3a860247262bd14b0d6606ac709e3a925223324b417a6` | 匹配 | 匹配 |
| v0.2 predecessor | `97b0dbdf452d7200d4165d8e1629b6424e8ffcdea0aba8237e46c764e428527e` | 匹配 | 匹配 |

三者均未漂移。predecessor是 `F1+1-专用Admin-MacBook-配置执行交接提示词-v0.2.md`，没有与另一份 MacBook预配置手册混淆。

## 3. 三通道安全复核

| 通道 | 设计判定 | 当前真实判定 | 关键停止线 |
|---|---|---|---|
| Channel 1：UU 解锁后图形维护 | PASS（规划） | Unknown / 未授权 | 只能在系统已解锁、图形会话和网络可用后短时使用；不能保存恢复秘密、承担FileVault启动解锁或开放公网Admin |
| Channel 2：网关私有VPN+原生SSH启动前恢复 | PASS（条件式设计） | FAIL/Unknown | 当前低安全性Wi-Fi不能作为证据；公网22/端口转发/UPnP/公网隧道禁止；宿主UU/Tailscale不算启动前路径 |
| Channel 3：现场/冷备灾难恢复 | PASS（规划） | Unknown / 未授权 | 工作Mac、public-host、旧主或冷备不能在epoch提升和旧主fence前写生产数据；Owner/SLA/恢复点均待定 |

通道之间没有自动降级或静默切换。每次切换必须绑定 reason、Owner、writer epoch、恢复点、允许动作、停止条件和收据；失败不能自动开放下一个通道或提升第二写主。

## 4. 账号、网络、FileVault与隐私边界

- 文档没有记录SSID、Wi-Fi密码、MAC、IP、overlay ID、序列号、硬件UUID、磁盘标识、Apple Account、设备ID、恢复秘密或凭据。
- uniqueIdentifierPolicy 对复制、写入、hash和编码全部设置为 false；此规则可防止用哈希形式把截图唯一标识持久化。
- FileVault/Remote Login/允许解锁用户/SSH认证/Firewall/Sharing/自动登录当前状态全部为 Unknown；没有被当作已配置能力。
- 启动前路径只接受Apple条件式能力，不把产品能力文档外推为目标设备、目标Wi-Fi或跨网链已通过。
- 公网Admin listener与公网SSH listener始终要求为0；public-host只接收单向签名只读投影且不能提升为writer。
- `writer_count=1`，旧主/冷备恢复必须经过epoch提升与fence。

## 5. Wi-Fi-only 与新增低安全性事实

v0.3自身已经把目标Wi-Fi实际安全模式、此前连接、启动前重连和端到端链列为 Unknown，也把WPA2-PSK写成未来受控候选，因此没有把当前网络误报为安全或生产可用。新增事实使该Unknown收敛为当前环境 FAIL，但不使文档架构本身失效。

任何后继 successor/production manifest至少应机械要求：

1. macOS不再显示低安全性警告；
2. 精确安全模式为启动前能力支持的独立WPA2-PSK路径，且禁用WPA/WPA2 mixed、WPA Personal兼容模式和TKIP；密码学套件需明确为AES/CCMP或经当期Apple官方支持的等价安全配置；
3. 不把开放Wi-Fi用作生产推荐，即使Apple文档将其列为启动能力条件之一；
4. 不在文档或收据记录SSID、密码、MAC、IP等实值；只记录脱敏布尔/枚举结果和production manifest引用；
5. 通过另行授权的同LAN及蜂窝外网演练证明启动前重连、DHCP保留、网关VPN、原生SSH/FileVault、解锁前服务/writer/Admin=0、解锁后完整readiness；
6. 任一项Unknown、警告复现、mixed/TKIP命中或公网入口非0均保持Channel 2关闭。

本项需要产品部另建successor或在未来production manifest中吸收；安全部未修改v0.3。

## 6. RPO/RTO、8GB与长期接电

- RPO≤15分钟仍绑定最新可恢复source state cut、数据库身份引用、ledger high-water mark、snapshot hash、异机持久化和认证回读；没有使用最后业务写入时间替代恢复点时间。
- RTO≤4小时仍从最早可证明事故/不可服务时间开始，终点包含唯一writer、旧主fence、数据库/ledger/hash、Mac/iPhone私有Admin、全量公开投影与临时能力归零。
- UU画面、SSH登录、FileVault解锁或Node启动都只是中间事件。
- 当前低安全性Wi-Fi和未完成跨网演练使真实RTO/RPO继续Unknown。
- 8GB只作为单人、低并发、SQLite单写、本地Node的条件式候选；容量需要24小时/7天资源与备份收据。
- 长期接电不代表UPS、断电自启、路由器供电、网络恢复、散热、睡眠或长稳已验证。

## 7. closed-set manifest

只读机械检查确认：

- `closedFileSet=true`、`extraEntriesAllowed=false`；
- 文件闭集恰为runbook、v0.2历史predecessor、已ACK三通道研究导出三项；
- channels恰为三个职责互斥通道；
- device fact allowlist只包含非唯一设备类别、内存、OS、长期接电、Wi-Fi-only和证据等级；
- Wi-Fi基线不允许记录SSID/密码/MAC/IP，不把WPA3-only/802.1X或宿主UU/Tailscale推定为启动前证据；
- 安装、登录、改网络、Remote Login/SSH、FileVault、UU、备份上传、部署和生产授权全部为false；
- manifest状态为`template_not_exported`，未把模板写成已部署bundle。

## 8. P0 / P1 / P2

- P0：0。
- P1：0（文档设计）。v0.3没有把弱Wi-Fi、真实设备能力、RTO/RPO或任何真实配置写成PASS。
- P2：1。v0.3/manifest使用`WPA2-PSK`作为候选，但没有逐字增加“拒绝WPA/WPA2 mixed、WPA Personal兼容和TKIP；要求AES/CCMP”等机器字段。当前Unknown/授权门能够fail-closed，因此未形成未授权放行；后继successor或production manifest必须显式补齐，避免实施者只按名称匹配而接受低安全性配置。

环境定级独立于文档缺陷计数：当前真实Wi-Fi为FAIL/Unknown，不得进入生产或启动前通道。

## 9. 已验证、未验证与推断

### 已验证

- v0.3、manifest与精确v0.2 predecessor的前后哈希。
- 三通道职责、失败出口、公网入口、唯一writer、epoch fence、UU解锁后边界。
- 文档/manifest唯一标识与秘密禁区、closed-set、授权false。
- RPO/RTO、8GB、长期接电、Wi-Fi-only的规划语义没有外推为运行PASS。
- 用户提供的脱敏现状：macOS将当前网络标记为低安全性；未记录任何地址或标识。

### 未验证

- 当前网络的精确认证模式和cipher；本任务没有读取或探测网络配置。
- FileVault、Remote Login、SSH用户/认证、Firewall、Sharing、UU、DHCP保留与启动前重连。
- 网关VPN、ISP/CGNAT、蜂窝外网、现场Owner、冷备、异机备份、epoch fence和RPO/RTO。
- 8GB/长期接电的资源、温度、睡眠、断电与七天长稳。

### 推断

- 基于macOS低安全性标记与Apple安全建议，当前网络不能作为production或FileVault启动前通道的合格证据。
- loopback服务在无真实秘密、生产数据、外部副作用和公网入口时，不依赖当前Wi-Fi安全性完成本机进程内/同机验收；若开始跨设备或外部访问，该推断立即失效。

## 10. 错题自检

- 没有记录、复制、散列或推测截图中的地址、SSID、设备或账号标识。
- 将文档安全、当前环境安全、本机loopback开发分别定级，未互相替代。
- 没有因Apple记录WPA2-PSK能力而接受当前低安全性Wi-Fi。
- 没有把低安全性Wi-Fi扩大成所有本机loopback开发的P1；保留了无外部副作用的精确边界。
- 没有把UU、宿主overlay或图形会话写成启动前FileVault路径。
- 没有把8GB、长期接电、SSH登录、FileVault解锁或文档PASS写成生产PASS。
- 没有修改v0.3、manifest、predecessor或任何真实设备/网络配置。

TASK_STATE_OK
