---
type: work_report
department: 研究部
target: 专用 Admin MacBook 在中国大陆的私有访问与异机备份候选
status: final
date: 2026-08-09
related_task: TASK-20260809-B05A67
decision: managed_overlay_first_but_china_dual_device_test_required
tags: [admin, macbook, iphone, private-overlay, backup, sqlite, rpo, rto, china]
summary: 官方资料支持形成托管 Tailscale、自托管 Headscale、纯 WireGuard 三套候选；任何一套的中国大陆稳定性都没有一方保证，必须在唯一 production manifest 获批后做 Mac/iPhone 受控实测。三套均以在线一致 SQLite 快照、五分钟尝试、异机加密仓库、manifest/hash 和隔离恢复演练为共同硬门。
---

# 专用 Admin MacBook 私有访问与异机备份候选

## 0. 结论

截至 2026-08-09，官方/第一方公开资料可以支持三个候选组合，**不能支持现在批准供应商或宣布中国大陆可用**：

1. **验证顺序 P0：托管 Tailscale + `restic@0.19.1` + Backblaze B2（Object Lock 组合行为待验证）**。Mac/iPhone 客户端、NAT 穿透、relay、设备移除和控制面故障语义最完整，运营负担最低。Tailscale 没有给出中国大陆稳定可达 SLA；B2 也没有中国大陆数据区。两端真实稳定性、费用方案资格、控制元数据地域、B2 跨境上传，以及 restic 与 Object Lock 的精确兼容性均为 `Unknown`。Object Lock 在 Gate C 全部通过前不能计为防删控制 PASS。
2. **验证顺序 P1：自托管 `headscale@0.28.0` + 官方 Tailscale Apple 客户端 + 自托管 DERP + `restic@0.19.1` + B2**。控制面、策略和日志位置可自选，退出自主性更高；同时新增公开 HTTPS 控制端、DERP/STUN、Linux/BSD 主机、升级、数据库、TLS、监控和备份责任。中国大陆可用性取决于实际主机地域、运营商与链路，仍为 `Unknown`。
3. **验证顺序 P2：纯 WireGuard 星型拓扑 + 独立中继主机 + `restic@0.19.1` + 异地 SFTP 仓库**。协议和供应商耦合最小，官方提供 macOS/iOS 客户端；它不提供身份控制面、策略版本、设备健康、集中撤权、relay 自动选择或五分钟 freshness 收据。更适合作为默认关闭的冷备私有通道候选，不能直接承担当前日常 Admin 合同。

研究部建议先验证 P0 的**网络适配性**，因为它用最少自管实体验证中国大陆 Mac/iPhone 能否稳定进入同一私有 Admin origin；备份管线与五分钟签名 freshness 是彼此独立的硬门。即使网络连续观测通过，在安全/开发完成 freshness producer、签名、可信 UTC、TTL、设备/策略版本来源及控制面离线失败关闭前，P0 也不能升级为日常 Admin 候选。若托管服务不能提供可验证的官方信号来可靠生成收据，P0 的日常 Admin 适配失败，只保留本地/带外路径或进入 P1。若 P0 因地区可达、计划/数据地域、备份或退出要求失败，再验证 P1；P2 只在组织愿意承担人工密钥与中继运维时保留。

所有方案都必须保持：Admin 应用只监听 loopback/私有接口；公网 Admin listener、端口转发、UPnP、隐藏 URL和长期公网 Admin 隧道为 0；overlay 不能替代应用 passkey/session/Origin/CSRF/CAS/fence；public-host 不能用作主库备份或反向恢复源。

本任务没有登录、注册、安装、购买、修改网络、运行真实网络探针或上传数据。

## 1. 方法与证据边界

### 1.1 证据类型

| 标签 | 含义 |
|---|---|
| 已证实 | 官方文档、官方定价、官方仓库/发布页直接陈述的能力或限制 |
| 推断 | 从已证实机制对本项目合同作出的工程判断，需产品/安全吸收 |
| Unknown | 官方资料没有回答，或必须通过目标账号、地区、设备和运营商实测 |
| 需国内双端实测 | 只有中国大陆 Mac 与 iPhone 真实链路、故障与恢复收据才能关闭 |

### 1.2 研究限制

- 只读访问 Tailscale、Headscale、WireGuard、SQLite、Node.js、restic、Backblaze 和 Apple 的官方/第一方页面。
- 没有把全球状态页、境外节点列表或端到端加密宣传外推为中国大陆可用性。
- 没有使用社区测速、论坛、博客、聚合评测或百度补齐地区证据。
- 当前价格和版本按 2026-08-09 公开页面记录；最终采购价格、税费、汇率和服务资格以用户确认时的目标账号报价为准。

## 2. 共同访问合同

### 2.1 双端与 NAT/CGNAT

- Tailscale 数据通道基于 WireGuard，官方提供 macOS/iOS 客户端；设备可直接连接，也可使用 Peer Relay 或 DERP。hard NAT 组合通常转为 relay，连接类型取决于双方网络。[Tailscale device connectivity，访问于 2026-08-09](https://tailscale.com/docs/reference/device-connectivity)
- Tailscale 的 DERP 只转发已加密 WireGuard 包，不能取得设备私钥或解密流量；控制面仍收集 IP、OS、版本、公钥、连接状态等元数据。[Tailscale security，访问于 2026-08-09](https://tailscale.com/security)、[control/data planes，访问于 2026-08-09](https://tailscale.com/docs/concepts/control-data-planes)
- Headscale 官方稳定版文档明确支持官方 Tailscale iOS/macOS 客户端通过 custom coordination server 连接。[Headscale Apple clients，访问于 2026-08-09](https://headscale.net/stable/usage/connect/apple/)
- WireGuard 官方安装页列出 macOS 与 iOS App Store 客户端；其 NAT keepalive 只维持已知 peer endpoint 的映射，不提供自动协调/relay 选择。[WireGuard install](https://www.wireguard.com/install/)、[WireGuard quick start](https://www.wireguard.com/quickstart/)，访问于 2026-08-09。

上述事实只证明产品能力。中国大陆家庭宽带、蜂窝网络、跨运营商、CGNAT、UDP/TCP 443、DERP/自托管中继的稳定性均需国内双端实测。

### 2.2 控制面、relay 与撤权

| 控制 | 托管 Tailscale | Headscale | 纯 WireGuard |
|---|---|---|---|
| 控制面 | Tailscale 集中 coordination server；认证/设备/策略/公钥分发由服务承担 | 自托管 Tailscale-compatible 控制服务器 | 无控制面；配置文件与公钥人工分发 |
| relay | 直连优先，Peer Relay 后再 DERP | 可使用 DERP map、embedded/custom DERP；实际部署与容灾由自己承担 | 需要固定公网可达 peer/中继；无自动地域选择 |
| 控制面故障 | 已建立通信和缓存规则可继续到 key 过期；不能新增设备、刷新/交换 key、更新规则或撤权 | 相同客户端缓存行为的精确持续时间未在 Headscale 文档证明；必须实测 | 配置继续工作；没有策略新鲜度或集中撤权服务 |
| 设备撤权 | 管理台/API 移除后设备立即失去 tailnet 资源连接；未启用 device approval 时可再次加入 | node 删除、策略和 key 由自管服务承担；升级兼容性与恢复需自验 | 从所有相关 peer 删除旧公钥并分发新配置；遗漏任一 peer 会留下访问面 |
| freshness 合同 | 官方没有本项目 `{deviceId,policyVersion,...expiresAt≤5m}` 签名收据格式 | 需自行实现/证明 | 原生不具备；若另建即新增控制面 |

Tailscale 官方说明 coordination server 是集中组件；停机时现有密钥与缓存 ACL 可继续，但不能新增设备、刷新密钥、更新规则或撤销现有用户密钥。[Coordination server outage，访问于 2026-08-09](https://tailscale.com/docs/reference/coordination-server-down) 官方设备移除文档说明移除后立即断开 tailnet 资源；未启用 device approval 时设备可能重新加入。[Remove a device，访问于 2026-08-09](https://tailscale.com/docs/features/access-control/device-management/how-to/remove)

Tailnet Lock 可降低对托管控制面公钥分发的信任，但官方说明它与 device approval 互斥，需要安全保存 disablement secrets，并建议至少两个 signing nodes。[Tailnet Lock，访问于 2026-08-09](https://tailscale.com/docs/features/tailnet-lock) 选择哪一项会改变丢机恢复和重新加入流程，必须进入 production manifest，研究部不代替用户或安全部选择。

## 3. 三个组合方案矩阵

| 维度 | P0 托管 Tailscale + restic/B2 | P1 Headscale + 自托管 DERP + restic/B2 | P2 WireGuard 中继 + restic/SFTP |
|---|---|---|---|
| Mac/iPhone | 官方客户端，两端支持 | 官方 Tailscale Apple 客户端可配置 custom server | 官方 WireGuard Apple 客户端 |
| NAT/CGNAT | 自动尝试直连，失败转 Peer Relay/DERP | 客户端可做 NAT traversal；DERP 部署/地图/可达由自管 | 至少一个固定可达 relay peer；NAT 端常需 keepalive |
| 日常 Admin 合同适配 | **仅网络适配优先验证**；五分钟签名 freshness 未实现前不合格 | 可自建 freshness/策略出口，实施责任高 | 原生缺身份、设备姿态与策略 freshness，不直接适配日常入口 |
| 中国大陆证据 | **Unknown**；官方无大陆稳定 SLA | **Unknown**；取决于自选主机、DNS/TLS、运营商和 DERP | **Unknown**；取决于 UDP 中继地址、运营商和路由 |
| 控制面/relay SPOF | 托管控制面是集中组件；DERP 多区域，已建连接可暂续 | 单 Headscale/单 DERP 是 SPOF；若做冗余需新增一致性和运维合同 | 单 relay 是 SPOF；增加 relay 会增加手工配置与路由选择 |
| 撤权 | 管理台/API；Tailnet Lock 或 device approval 二选一 | 自管 node/keys/policy；控制库与签名材料也需备份 | 手工删 peer key 并重发；撤权完成性最难证明 |
| 控制元数据地域 | Tailscale 托管；精确处理/留存地域需目标合同确认 | 由自选控制主机决定；OIDC/监控仍可能引入第三方 | relay 可见公网地址和加密流量；配置/日志由自管决定 |
| 备份一致性 | Node/SQLite Online Backup → 封闭 snapshot → manifest/hash → restic → B2 | 同左；控制面自身数据库另有独立备份责任 | 同一 Admin DB 管线；SFTP 目标需独立异地设备 |
| 备份隔离 | B2 与 Admin 主机异机；B2 区域为美东/美西/欧中/加拿大东，无大陆区 | 同左；应避免 B2 与 Headscale 主机同供应商/账号故障域 | SFTP 目标必须异地点、异电源、异账号；经同一 relay 会形成共同故障 |
| 运维复杂度 | 低—中 | **高**：公网 HTTPS、TLS、DERP/STUN、OS、SQLite、升级、监控 | 中—高：peer、key、中继、防火墙、撤权、路由全手工 |
| 退出/迁移 | 导出 ACL/设备清单和应用配置；迁往 Headscale/纯 WG 需逐设备重新 enrollment | 配置/策略/SQLite 自有；客户端可改 custom server，但版本升级有迁移约束 | 配置格式简单；换中继仍须所有 peer 更新 endpoint/key |
| 软件/服务成本 | Tailscale Personal $0 只适合非商业个人用途；Standard 公开价 $8/user/月；生产资格 Unknown。B2 $6.95/TB/月起 | Headscale BSD-3-Clause、restic 开源；另付控制/DERP 主机、域名/TLS/监控和 B2 | WireGuard/restic 开源；另付中继、异机设备/场地/带宽/维护 |
| 当前结论 | **先验证网络适配；freshness 与备份分别过门** | P0 失败或数据主权/退出要求更高时验证 | 冷备通道候选；不直接作为日常方案 |

价格来源：[Tailscale pricing，访问于 2026-08-09](https://tailscale.com/pricing)、[Backblaze B2 pricing，访问于 2026-08-09](https://www.backblaze.com/cloud-storage/pricing)。Tailscale Personal 页面明确限个人非商业用途；F1+1 最终是否符合该资格为 `Unknown`。B2 当前页面为 `$6.95/TB/month` 起，免费 egress 上限和交易规则可能随用量/时间变化，生产预算需以 manifest 冻结。

## 4. Headscale 与纯 WireGuard 的额外事实

### 4.1 Headscale

- 官方仓库将其定义为 Tailscale 控制服务器的开源自托管实现，BSD-3-Clause；2026-08-09 官方稳定 release 为 `v0.28.0`。[Headscale repository/releases](https://github.com/juanfont/headscale)
- 官方要求公共 IP、生产建议 HTTPS 443、现代 Linux/BSD 和专用服务账号；embedded DERP 还需要公开 TCP 443 与 UDP 3478，metrics/debug 不应公开。默认假设 SQLite 数据库和含私钥/策略的 data directory。[Headscale requirements，访问于 2026-08-09](https://headscale.net/stable/setup/requirements/)
- 这些公开端口属于 overlay 控制/relay 基础设施，不能转发到 Admin 应用。若 production manifest 无法证明它们与 Admin origin、凭据、日志和主库隔离，P1 淘汰。
- 单节点 Headscale、单 DERP、TLS/DNS 或其 SQLite 损坏都会扩大故障面；官方资料没有为本项目提供 HA、五分钟 signed freshness 或中国大陆 SLA。均为调用方责任。

### 4.2 纯 WireGuard

- 官方协议使用 UDP 和静态公钥 peer 模型，提供加密通道；不提供用户身份、设备 posture、ACL 版本、审计、自动 relay 或集中设备生命周期。[WireGuard protocol，访问于 2026-08-09](https://www.wireguard.com/protocol/)
- 在 CGNAT/防火墙后接收入站包通常需要公开 peer 或 keepalive；本项目不得在家庭路由器启用端口转发或 UPnP，因此候选必须使用与 Admin MacBook 独立的公共中继主机。
- 中继只开放 WireGuard UDP，不开放 Admin HTTP。任何以中继反代/暴露 Admin、使用共享 root 凭据或把 peer 配置写入仓库的设计立即排除。
- 本项目五分钟 freshness 与设备撤权要求若由额外服务补齐，方案已演变为自建控制面，应回到 P1 重新比较，不能继续称为“最小 WireGuard”。

## 5. 共同备份管线

### 5.1 一致 SQLite 快照

运行中的主库、`-wal`、`-shm` 或 journal 文件不得直接复制后宣称为恢复点。SQLite 官方 Online Backup API 会把活动数据库复制成单一一致 snapshot；完成时目标是源在复制开始时的位级快照。项目的 Node 24 `node:sqlite` 提供 `backup(sourceDb, path)`，封装 `sqlite3_backup_*`，源连接保持可用，其他连接写入会让 backup 重启。[SQLite Online Backup API](https://www.sqlite.org/backup.html)、[Node 24 `node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)，访问于 2026-08-09。

共同顺序必须固定为：

1. 每 `≤5m` 尝试 Node/SQLite Online Backup 到同文件系统临时文件；不直接复制活动 DB/WAL/SHM。
2. backup 完成、目标连接关闭且文件落盘后，以新的只读连接重新打开封闭 snapshot 执行 `PRAGMA quick_check`；生产是否还需定期 `integrity_check` 由数据/安全冻结。
3. 生成项目合同已有的 manifest：`backupId,startedAt,completedAt,sourceSchemaVersion,applicationVersion,sqliteVersion,journalMode,sourceLogicalId,contentHash,fileSize,encryptionKeyVersionRef,targetFailureDomainClass,verificationResult,previousBackupId,reasonCode`。
4. 对封闭 snapshot bytes 计算 SHA-256；manifest 使用项目 canonical JSON 规则再算独立 hash，签名方式与 key version 由 manifest 冻结。
5. restic 只读取 snapshot + manifest + signature/receipt，上传到异机仓库。每个五分钟点必须按 production manifest 冻结的认证读标准，回读远端对象、manifest/签名、版本及 retention 状态；只读 identity/size 元数据不足以证明合格恢复点。
6. 固定频率执行完整远端验证：下载、解密、复算 snapshot `contentHash` 与 manifest hash，并在新的只读连接执行 SQLite quick/integrity/schema/ledger 检查。频率、全量/抽样比例和成本由 production manifest 冻结；对象级认证读和周期完整验证任一失败，该点都不能计入 RPO 成功点或推进 `lastSuccessfulRecoveryPoint`。
7. `backupAge≥10m` 预警；`≥15m` 或时钟不可信时关闭新的 revision/approve/reject/publish 和设备/权限变更。上传失败、认证回读失败、完整验证失败或 hash 不符不能推进成功时间。

### 5.2 加密、保留与防删除

- restic `0.19.1` 是 2026-07-05 的官方最新 release；仓库由 password/key 访问，支持本地、SFTP、S3/B2 等 backend。[restic release](https://github.com/restic/restic/releases/tag/v0.19.1)、[repository setup](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)，访问于 2026-08-09。
- restic 仓库加密不能替代 key 托管。丢失密码会造成不可恢复；把 repository credential 与解密材料都放在 Admin MacBook 会使失机同时失去恢复能力。
- `restic check` 默认验证结构；读取并验证实际 pack data 需 `--read-data` 或分片 `--read-data-subset`，会产生时间/带宽成本。[restic repository checking](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)，访问于 2026-08-09。
- Backblaze Object Lock 可在保留期内阻止修改/删除，启用后 bucket 级 Object Lock 不能关闭；锁错期限可能只能通过关闭账号处置。[B2 Object Lock，访问于 2026-08-09](https://www.backblaze.com/docs/cloud-storage-object-lock) 这些事实只证明 B2 自身能力。官方证据没有证明 `restic@0.19.1` 会按项目预期设置 retention，也没有证明默认 retention 对 restic 临时 lock、index、pack、`forget/prune`、密钥轮换和退出的组合行为；全部为 `Unknown`。
- B2 公开区域为 US West、US East、EU Central、Canada East，账号创建时选择且之后不能改变；没有中国大陆区域。[B2 data regions，访问于 2026-08-09](https://www.backblaze.com/docs/cloud-storage-data-regions)

推荐保留策略只作为待确认起点：5 分钟恢复点保留 24 小时、小时点保留 7 天、日点保留 35 天、月点保留 12 个月；Object Lock 目标可设为覆盖最短勒索恢复窗。准确容量、法规、删除与预算未经用户确认，不能进入 production manifest；组合验证未通过前也不能将 Object Lock 计入防删 PASS。

### 5.3 Time Machine 的位置

Apple 官方说明 Time Machine 默认每小时备份最近 24 小时，且可使用加密外置盘、另一台 Mac 或 NAS。[Time Machine frequency](https://support.apple.com/en-us/104984)、[backup destinations](https://support.apple.com/en-lamr/102423)，访问于 2026-08-09。默认一小时频率不能证明 `RPO≤15m`；同机或同桌外置盘也不满足异机异故障域。Time Machine 可作为系统/应用重建的第二层辅助手段，不能替代上述五分钟 SQLite 恢复点管线。

## 6. 单点故障与失败关闭

| 故障 | P0 | P1 | P2 | 项目动作 |
|---|---|---|---|---|
| Admin MacBook/宽带/电源 | 三者都失去远程 Admin | 同 | 同 | mutation=0；public-host 保持 last-known-good；从异机点恢复 |
| 控制面不可达 | 既有连接可能暂续；新增/刷新/撤权失败 | 自管控制面失效；精确缓存语义待测 | 无控制面 | 只在项目五分钟 freshness 收据仍有效时保留最小只读，否则全部远程 Admin 关闭 |
| relay/UDP 不可用 | 转其他 DERP/Peer Relay 的实际大陆效果待测 | 需第二 DERP 才能去单点；新增实体 | 单 relay 直接中断 | 禁止公网旁路；恢复原私有通道或受控本地/带外 |
| 设备丢失 | 管理台移除 + app session/passkey/secret 撤销 | 自管 node/key + 全凭据撤销 | 全 peer 移除旧 key | 旧主/旧设备 fence 证据完成前 writer=0 |
| 备份上传失败 | B2 独立于 overlay，仍受国际链路影响 | 同 | SFTP 若共用 relay 会同步失败 | 10m 预警；15m 关高风险 mutation；不推进 last-success |
| 备份账号/仓库损坏 | 独立 key 可缓解；Object Lock 组合效果待 Gate C 证明，仍可能有账号级风险 | 同 | 自有 SFTP 主机/账号失陷风险 | hash/manifest/read-data/隔离恢复失败即隔离该点，不宣称恢复成功 |
| 解密材料丢失 | 三者均不可恢复 | 同 | 同 | 解密 key 至少一份在 Admin 主机故障域外受控托管；定期恢复演练 |

## 7. 推荐验证顺序与退出条件

所有真实步骤均须等唯一 `PRODUCTION-DEPLOYMENT-MANIFEST`/hash 获用户批准；以下是未来验证设计，不构成授权。

### Gate A：离线 synthetic 备份合同

- 用 synthetic SQLite/WAL workload 验证每五分钟 Online Backup、closed snapshot、quick/integrity check、manifest/hash、失败不推进 last-success、10/15 分钟 fail-closed。
- 使用本地模拟 backend，不登录或上传；验证 restic/key/backend 之前先验证独立恢复目录、旧主 fence、writer=1 和四小时 runbook。
- 失败退出：直接复制活动 DB/WAL、manifest 字段不足、hash 不能复算、时钟不可信仍继续 mutation，任一出现即停止。

### Gate B：P0 中国大陆双端私有访问

- 用户批准精确 Tailscale 计划、身份方式、Tailnet Lock 或 device approval、Mac/iPhone/client versions 与测试窗口后，分别验证家庭/办公室宽带、用户实际 iPhone 蜂窝和至少一个外部 Wi‑Fi。
- 记录直连/Peer Relay/DERP、首次连接、切网重连、前后台、Admin 全 Function ID、应用再认证、设备移除、控制面/relay 故障；不开放公网 Admin。
- 独立验证 freshness producer、签名 key/version、可信 UTC、`expiresAt≤5m`、设备/策略版本来源；收据缺失、过期、签名/来源无法证明或控制面不可达超过 TTL 时，必须关闭远程 Admin mutation，且不能靠网络连通性观测替代。
- 建议至少连续 7 天观测，任何无法解释的长期不可达、撤权后仍可访问、freshness 门失败仍有 mutation 或必须靠公网旁路恢复均判 P0 失败。若托管控制面的官方可用信号不足以可靠生成该收据，P0 不得升级为日常入口。

### Gate C：P0 异机备份与四小时恢复

- 用户批准精确 B2 region、预算、Object Lock mode/默认 retention、key 托管、retention 后，用 synthetic/可销毁数据验证 5 分钟周期、国际链路中断、凭据撤销、对象 retention 回读和 hash。
- 精确验证 restic/B2 组合：retention 覆盖范围，临时 lock 生命周期，连续两轮 backup，restore，`check`/`--read-data`，`forget/prune`，合法过期删除，密钥轮换，以及账号/仓库退出；任一项失败时 Object Lock 不能计为防删 PASS。
- 从一台干净替代 Mac 在隔离网络恢复：取 manifest → 验签/hash → 解密 → SQLite integrity/schema/ledger → 启动只读 → writer=1/fence → Mac/iPhone 私有访问；全程计时必须 `≤4h`，选点必须 `≤15m`。
- 失败退出：B2 连续无法维持 15 分钟窗口、解密材料与主机同失、restic/Object Lock 组合不能覆盖目标对象或阻断合法 lock/保留/退出、远端认证读/完整验证失败，或四小时恢复失败。

### Gate D：P1 / P2 递进

- P0 地区/供应商门失败后才验证 P1；固定 Headscale/clients/DERP 版本、控制主机地域、TLS、OIDC/注册、备份、升级/回滚和第二恢复入口。
- P1 仍失败或用户要求最小供应商耦合时，P2 只验证默认关闭的冷备通道。纯 WireGuard 无法形成五分钟 signed policy freshness 时，不得提升为日常入口。
- 任一方案退出时：撤销用户/设备/peer/auth/API/backup keys，清除 DNS/relay/control server，验证 Admin public listener=0，导出脱敏配置/策略/审计/manifest，保留最后可恢复点，回到本地/带外关闭态。迁移期间不得并行产生两个写主。

## 8. Production manifest 仍需用户确认

### 8.1 设备与运营

- 精确 MacBook 型号/资产引用、`device_usage=dedicated_admin_only`、macOS/补丁、家中或办公室地点、物理访问责任、供电/UPS、电池、合盖/睡眠和维护窗；
- 非交互且无 admin/sudo 的专用 `service_account`、具名 `operator_accounts`（不得作为日常个人账号）、`automatic_login=disabled`、`personal_sync_or_profile=absent`、FileVault/恢复密钥托管、屏幕锁、服务启动、软件/进程 allowlist；
- `publicly_reachable_admin_listener_count=0`、`writer_count=1`，以及同 UID、root/本地管理员在 R5 威胁模型内的可见性、不可声称隔离项与补偿控制；
- 替代恢复 Mac 的型号、位置、可获得时限与 clean image/hash。

### 8.2 Overlay

- P0/P1/P2 精确选择、供应商/计划/版本/许可证、账号 owner、付款主体、预算上限、数据/日志地域与保留；
- Mac/iPhone client version、设备 enrollment、identity provider、MFA/passkey、ACL/grant、Tailnet Lock 或 device approval、recovery/disablement secret；
- Headscale/DERP 或 WireGuard relay 的主机、地域、供应商、IP/DNS/TLS、端口、服务账号、数据库、升级、监控、备份和退出；
- Admin 私有 origin、证书、private bind、运营商/CGNAT/IPv4/IPv6、允许的 connection type、延迟/可用性阈值；
- `remote_access_ready` 每个谓词及其唯一 probe、证据来源、TTL、closed reason、owner、告警和恢复回读；
- 五分钟 freshness receipt 的生产者、签名 key/version、可信 UTC、TTL、设备/策略版本来源、控制面不可达语义、probe、owner、告警和失败 reason；
- 控制面、relay、宽带、丢机、撤权、切网与 break-glass 的真实 runbook。

### 8.3 备份与恢复

- Node/SQLite Online Backup 精确实现版本、每 `≤5m` 调度、并发/超时/磁盘满、quick/integrity check 和 staging 清理；生产 SQLite `db/-wal/-shm/journal/backup` 文件族的打开、关闭、checkpoint、owner/permission、归档与恢复规则；
- restic 精确 version/hash/来源、backend、目标账号/bucket/path、B2 region 或 SFTP 主机/地点、独立故障域证明；
- repository credential、restic password/key、manifest signing key 的托管引用、分权、轮换、撤销和丢失恢复；
- Object Lock mode/默认 retention/对象级 retention、版本保留、5m/小时/日/月策略、restic lock/index/pack 与 `forget/prune` 兼容、合法过期删除、容量增长、API/存储/egress/税费预算、删除与账号退出；
- backup manifest canonicalization/signature、每点远端认证回读标准、周期完整下载/解密/hash/SQLite 检查、`check --read-data` 周期与比例、告警通道、10m/15m failure action；
- 隔离恢复设备、runbook、RPO/RTO 计时起止、旧主 fencing、writer=1、应用/SQLite/schema/ledger/双端验收和演练频率。

本节只是网络与备份研究增量，production manifest 必须完整继承两份现行专用 MacBook 合同的全部机械字段；本节不能替代或缩减它们。完整继承字段、本节增量、不可变 manifest hash 和用户批准任一缺失，真实安装、账号开通、付费、网络配置、备份上传或生产部署均保持关闭。

## 9. 已验证、未验证与错题自检

### 已验证

- Tailscale 的 Mac/iPhone、直连/Peer Relay/DERP、hard NAT、控制面停机、设备移除、Tailnet Lock/device approval 互斥和公开计划价格语义。
- Headscale 官方 Apple 客户端接入、公共 IP/HTTPS 443/DERP STUN 要求、SQLite/data directory 与 `v0.28.0` 稳定版事实。
- WireGuard 官方 macOS/iOS 客户端、UDP、静态 peer、公私钥和 NAT keepalive 语义。
- SQLite Online Backup 与 Node 24 `node:sqlite backup()` 的一致快照能力。
- restic `0.19.1`、repository/key、SFTP/S3 backend、结构/pack data 检查能力。
- B2 公开价格、Object Lock 与四个公开区域；Apple Time Machine 默认小时频率和加密/网络目标能力。
- 三组合的控制面、relay、撤权、成本、单点、退出与项目 RPO/RTO 责任映射。

### 未验证 / Unknown

- 任一 overlay、control plane、DERP/relay、B2 或 SFTP 在中国大陆目标家庭/办公室宽带、iPhone 蜂窝、跨运营商和 CGNAT 下的稳定性、延迟、丢包、切网和长期可用性。
- 目标账号的 Tailscale 计划资格、最终价格/税费、身份提供方、控制元数据地域/留存和 Tailnet Lock/device approval 选择。
- Headscale/DERP/WireGuard 中继的具体地域、供应商、TLS/DNS、运维、日志、HA、升级/恢复与法规要求。
- Node 24 backup、restic/B2/SFTP、Object Lock、五分钟调度、hash/manifest/key 托管、RPO/RTO 在真实设备与异机上的运行结果；restic/B2 Object Lock 的 retention 覆盖、lock 生命周期、backup/restore/check/prune/过期删除/轮换/退出全部 Unknown。
- P0 五分钟签名 freshness producer 所需的官方信号、可信来源、控制面离线失败关闭及端到端实现尚未验证；网络适配通过不能关闭该门。
- 建议的保留周期、Object Lock 期限、Worker/进程权限、监控和预算均待产品/安全/用户冻结。
- 当前没有安装、账号、资源、真实网络、真实备份对象或 production receipt。

### 错题自检

- 没有把全球状态、官方客户端存在或加密机制写成中国大陆可用；全部地区结论保持 Unknown/待双端实测。
- 没有把 overlay 当作应用认证，也没有把公开 Headscale/DERP/WireGuard 端口写成公开 Admin。
- 没有把 SQLite 主文件或活动 WAL/SHM 直接复制当作一致备份。
- 没有把 restic 加密、B2 Object Lock 或 Time Machine 单独写成 RPO/RTO PASS。
- 没有把 restic 与 B2 Object Lock 的分别成立外推为组合兼容或防删 PASS。
- 没有用 P0 网络连通性观测替代五分钟签名 freshness 硬门。
- 没有把 Tailscale Personal 免费计划外推到生产资格。
- 没有把 Headscale/纯 WireGuard 的自托管写成低运维或自动高可用。
- 没有登录、注册、安装、购买、配置网络、运行真实探针、上传数据或修改 Spec/ADR/app/data。

## 10. 官方证据索引

所有页面访问日期：2026-08-09。

1. [Tailscale device connectivity](https://tailscale.com/docs/reference/device-connectivity)
2. [Tailscale connection types](https://tailscale.com/docs/reference/connection-types)
3. [Tailscale control and data planes](https://tailscale.com/docs/concepts/control-data-planes)
4. [Tailscale coordination server outage](https://tailscale.com/docs/reference/coordination-server-down)
5. [Tailscale remove a device](https://tailscale.com/docs/features/access-control/device-management/how-to/remove)
6. [Tailscale Tailnet Lock](https://tailscale.com/docs/features/tailnet-lock)
7. [Tailscale security](https://tailscale.com/security)
8. [Tailscale pricing](https://tailscale.com/pricing)
9. [Headscale repository and releases](https://github.com/juanfont/headscale)
10. [Headscale requirements](https://headscale.net/stable/setup/requirements/)
11. [Headscale Apple clients](https://headscale.net/stable/usage/connect/apple/)
12. [WireGuard install](https://www.wireguard.com/install/)
13. [WireGuard quick start](https://www.wireguard.com/quickstart/)
14. [WireGuard protocol](https://www.wireguard.com/protocol/)
15. [SQLite Online Backup API](https://www.sqlite.org/backup.html)
16. [Node.js v24 `node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
17. [restic 0.19.1 release](https://github.com/restic/restic/releases/tag/v0.19.1)
18. [restic repository setup](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)
19. [restic repository checks](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)
20. [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
21. [Backblaze B2 Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock)
22. [Backblaze B2 data regions](https://www.backblaze.com/docs/cloud-storage-data-regions)
23. [Apple Time Machine backup frequency](https://support.apple.com/en-us/104984)
24. [Apple Time Machine destinations](https://support.apple.com/en-lamr/102423)
25. [Apple encrypted Time Machine backups](https://support.apple.com/en-euro/guide/mac-help/mh21241/26/mac/26)
