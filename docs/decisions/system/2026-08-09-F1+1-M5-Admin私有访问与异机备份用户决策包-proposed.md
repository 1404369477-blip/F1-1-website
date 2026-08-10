---
type: user_decision_package
status: proposed
date: 2026-08-09
task_id: TASK-20260809-9AE33E
department: 产品部
scope: 专用 Admin MacBook 的私有访问与异机备份候选路线
authorization_state: decision_required
implementation_state: not_started
supplier_selected: false
production_deployment: unauthorized
external_effects: none
---

# F1+1 M5｜Admin 私有访问与异机备份用户决策包（proposed）

## 1. 当前结论

本包提出三个互斥的下一阶段路线，**没有接受任何供应商或技术组合**。产品部唯一推荐 **A：托管 overlay 优先验证路线**，理由是它以最少自管实体先回答中国大陆 Mac/iPhone 私有访问是否适配，同时把 freshness 与备份恢复继续留在各自独立门。

用户未来选择 A/B/C，只确定下一阶段的合同和验证顺序。该选择不自动授权安装软件、注册账号、选择付费计划、购买资源、配置网络、生成或上传密钥、运行真实网络探针、上传数据、创建 public-host 或部署。

本包继承的不可变边界：

- `publicly_reachable_admin_listener_count=0`；禁止家庭端口转发、UPnP、隐藏 URL 和公网 Admin 隧道；
- `writer_count=1`；禁止第二写主、数据库双活和 public-host 反向提升；
- Mac 与 iPhone 功能等价，overlay 不能替代 passkey/session/Origin/CSRF/CAS/fence；
- 专用 Admin MacBook，不承担日常个人工作；
- `RPO≤15m`、`RTO≤4h`、加密异机异故障域恢复点、manifest/hash 和隔离恢复演练；
- public-host 继续独立、公开只读、可丢弃；
- 真实 production manifest 未获批准。

## 2. 事实、产品推断与 Unknown

本节只吸收已 ACK 的[研究报告](../../collaboration/部门/研究部/报告/2026-08-09-专用Admin-MacBook私有访问与异机备份候选.md)，不增加外部调查。

### 2.1 已证实事实

- Tailscale 官方提供 macOS/iOS 客户端，基于 WireGuard，连接可在直连、Peer Relay 与 DERP 间选择；控制面停机时既有连接和缓存规则可能暂续，但新增设备、刷新密钥、更新规则或撤权受限。
- Headscale `v0.28.0` 是研究时点的官方稳定版，可配合官方 Tailscale Apple 客户端；生产要求公开控制端和自管 TLS/主机，DERP/STUN 也由部署方负责。
- WireGuard 官方提供 macOS/iOS 客户端，使用 UDP 和静态 peer；原生不提供用户身份控制面、设备健康、ACL 版本、集中撤权或自动 relay 选择。
- SQLite Online Backup 与 Node 24 `node:sqlite backup()` 能生成一致快照；直接复制活动 DB/`-wal`/`-shm` 不能宣称为合格恢复点。
- restic `0.19.1` 支持加密仓库及 SFTP/S3/B2 等 backend；读取验证实际 pack data 需要 `--read-data` 或分片验证。
- B2 提供 Object Lock 与公开区域；研究时点没有中国大陆区域。Object Lock 启用和保留语义会影响删除、退出和恢复操作。
- Apple Time Machine 默认小时级备份，不能单独证明本项目 `RPO≤15m`。

版本、价格和服务条款仅是研究报告截至 2026-08-09 的证据快照，最终值须在受控验证前重新冻结。

### 2.2 产品推断

- A 的自管实体最少，适合先验证中国大陆双端网络适配；网络通过仍不能证明日常 Admin 合格。
- B 提供更强的控制面、策略和日志位置自主性，同时引入公开控制端、DERP/STUN、TLS、主机、升级、数据库、监控和备份责任。
- C 的供应商耦合最小，撤权、peer/key 分发和中继运维最难机械证明；它只适合作为默认关闭的冷备私有通道候选，不能直接满足当前日常 Admin freshness 合同。
- B2 或 SFTP 与 Admin 主机物理分离不自动等于异故障域；账号、地域、电源、网络、key custody 和恢复设备仍须独立证明。

### 2.3 Unknown

- 任一 overlay/control plane/relay、B2 或 SFTP 在中国大陆目标宽带、iPhone 蜂窝、跨运营商、CGNAT、切网与长期运行下的稳定性、延迟和丢包；
- Tailscale 目标计划资格、最终价格/税费、身份提供方、元数据地域/留存，以及 Tailnet Lock 或 device approval 的生产选择；
- Headscale/DERP/WireGuard 中继的具体地域、供应商、TLS/DNS、合规、日志、升级、恢复与 HA；
- B2 跨境/区域适配，`restic@0.19.1` 与 Object Lock 在 lock/index/pack、backup/restore/check/prune/过期删除/轮换/退出上的组合行为；
- 五分钟签名 freshness producer 是否能从所选控制面取得可信、可签名、可版本化的设备与策略事实；
- 所有真实费用、容量、保留、密钥托管、实机 RPO/RTO 与 production 收据。

## 3. 三个互斥路线

### ROUTE-A｜托管 overlay 优先验证路线（唯一推荐）

```text
托管 Tailscale 候选
+ restic@0.19.1 候选
+ Backblaze B2 候选
```

选择含义：先编制 `ROUTE-A` 的精确验证合同；`GATE-A` 本地 synthetic 通过后，再分别向用户申请 `GATE-B-N` 网络、`GATE-B-F` freshness 与 `GATE-C` 可销毁备份窗口。选择 ROUTE-A 不代表上述服务已批准或 production 选型已完成。

| 维度 | proposed 结论 |
| --- | --- |
| 用户影响 | Mac/iPhone 使用官方私有客户端；应用强认证不变 |
| 公开事实成本 | 研究时点 Personal 资格有限；Standard 有公开单用户价格；B2 有公开容量价 |
| 项目实际成本 | `Unknown`；账号资格、税费、汇率、容量、API/egress 和 Object Lock 成本待冻结 |
| 运维 | 低—中；仍需设备/策略、freshness producer、备份、key、告警与恢复演练 |
| 主要优点 | 自管实体最少，最快获得中国大陆双端适配证据 |
| 主要风险 | 大陆稳定性无 SLA；控制/元数据地域、计划资格、freshness 官方信号和 restic/Object Lock 组合均 Unknown |
| 淘汰条件 | 必须依赖公网 Admin 旁路；双端长期不可达；撤权后仍可访问；控制面事实无法生成五分钟签名 freshness；备份/RTO-RPO 独立门失败且无同路线修复 |
| 退出 | 撤销用户/设备、上传/API/传输凭据；恢复解密材料转移到 manifest 指定的受控托管并完成离线 restore 回读，迁移/保留完成后才按删除收据销毁；导出脱敏 ACL/设备/审计和恢复 manifest，验证公网 Admin=0 |

### ROUTE-B｜自托管控制面路线

```text
headscale@0.28.0 候选
+ 官方 Tailscale Apple 客户端候选
+ 自托管 DERP 候选
+ restic@0.19.1 / B2 候选
```

选择含义：跳过 `ROUTE-A` 的托管控制面路线，先编制 `ROUTE-B` 的自托管控制面、DERP、TLS、身份、升级/恢复和 freshness 合同。任何真实主机、域名、端口、账号或费用仍须单独批准。

| 维度 | proposed 结论 |
| --- | --- |
| 用户影响 | Mac/iPhone 仍用兼容客户端；需承受控制端升级/故障窗口 |
| 成本 | 软件许可成本低；主机、域名/TLS、DERP、监控、备份、运维与值守成本 `Unknown` |
| 运维 | 高；控制服务、公开 HTTPS、DERP/STUN、SQLite、策略、日志、升级、回退和第二恢复入口均自管 |
| 主要优点 | 控制面/策略/日志位置和退出路线更自主，可自行实现 freshness 出口 |
| 主要风险 | 单控制端/DERP/TLS/DNS/数据库形成更大故障面；大陆可用性仍 Unknown；公开基础设施必须与 Admin origin 完全隔离 |
| 淘汰条件 | 控制/DERP 端口触达 Admin 应用；无法证明 private origin 和凭据隔离；单点恢复超过 4 小时；运维/成本不可接受；freshness 或撤权无法闭合 |
| 退出 | 撤销 node/OIDC/TLS 与上传/API/传输凭据，关闭 DNS/DERP/control server；恢复解密材料先转入受控托管并完成离线 restore 回读，迁移/保留完成后才按删除收据销毁；writer 保持 1 |

### ROUTE-C｜纯 WireGuard 冷备通道路线

```text
WireGuard 独立中继候选
+ restic@0.19.1 候选
+ 异地 SFTP 仓库候选
```

选择含义：只形成默认关闭的冷备私有通道和异地备份验证合同；日常远程 Admin 保持关闭并继续待决。若后续再增加身份、设备姿态、策略版本和 freshness 控制服务，该路线已演变为 `ROUTE-B`，须重新决策。

| 维度 | proposed 结论 |
| --- | --- |
| 用户影响 | 日常远程 Admin 继续关闭；故障时按受控冷备流程人工启用 |
| 成本 | 软件许可成本低；独立中继、SFTP 设备/主机、场地、带宽与维护成本 `Unknown` |
| 运维 | 中—高；peer、key、endpoint、撤权、中继、防火墙、备份仓库和恢复全手工 |
| 主要优点 | 协议/供应商耦合较低，作为冷备路径边界清楚 |
| 主要风险 | 原生缺身份控制面、设备健康、集中撤权、relay 自动选择与签名 freshness，不能直接承载日常 Admin |
| 淘汰条件 | 需要家庭端口转发/UPnP；中继反代 Admin HTTP；peer/key 撤权无法证明；SFTP 与中继或 Admin 同故障域；冷备恢复超过 4 小时 |
| 退出 | 删除 peer/中继与上传/传输凭据；恢复解密材料转入受控托管并完成离线 restore 回读，迁移/保留完成后才按删除收据销毁；验证相关端点撤权并保留脱敏恢复 manifest |

## 4. 为什么推荐 A

A 以最少自管实体先回答“目标 Mac/iPhone 网络能否稳定到达同一私有 Admin origin”。B 在没有网络适配证据前增加多个生产级运维面；C 无法满足现行五分钟策略 freshness，当前只能承担冷备。

推荐 A 仍受四个限定：

1. A 当前只是验证顺序，不是供应商批准；
2. 网络适配、签名 freshness、备份恢复互不替代；
3. Tailscale 中国大陆稳定性、目标计划资格、元数据地域与官方信号适用性继续 Unknown；
4. B2 地域/跨境与 restic/Object Lock 组合继续 Unknown。

## 5. 三条独立门

| 独立门 | 只证明什么 | 不能替代什么 | 失败动作 |
| --- | --- | --- | --- |
| `N-NETWORK-ADAPTATION` | Mac/iPhone 在指定宽带/蜂窝/Wi‑Fi/CGNAT 下可达私有 origin，切网和撤权行为符合合同 | 不能证明策略新鲜、备份成功、RPO/RTO 或生产安全 | 远程 Admin 保持关闭；不得开公网旁路 |
| `F-FRESHNESS-5M` | closed 7 字段 `{deviceId,policyVersion,deviceDecision,sessionId,issuedAt,expiresAt,signature}` 可由可信事实生成；可信 UTC `now` 满足 `issuedAt≤now<expiresAt`、`0<expiresAt-issuedAt≤5m` | 不能由 ping、连通、客户端在线或控制台截图替代 | 未来签发、时钟回拨、解析/签名/policy/decision/session 任一 unknown、`deviceDecision!=allow` 或到期都关闭全部远程 Admin；不保留 mutation 例外 |
| `B-BACKUP-RECOVERY` | 一致 snapshot、manifest/hash、异机加密回读、`RPO≤15m` 与 `RTO≤4h` 恢复 | 不能证明 overlay 或 freshness 合格 | 10m预警、15m关高风险 mutation；失败点不推进 last-success |

日常 Admin 候选只有 `N-NETWORK-ADAPTATION + F-FRESHNESS-5M + B-BACKUP-RECOVERY` 和专用设备/应用安全全部通过才可进入 production manifest。`ROUTE-C` 只尝试冷备通道时，不宣称满足日常 Admin。

## 6. Gate A–D 顺序

路线只使用 `ROUTE-A|ROUTE-B|ROUTE-C`，执行门只使用 `GATE-A|GATE-B-N|GATE-B-F|GATE-C|GATE-D`；任务、receipt 和 manifest 禁止用裸 `A/B/C` 作为机械 ID。

### GATE-A｜本地离线 synthetic 备份合同

- 只用 synthetic SQLite 和本地模拟 backend，验证 Online Backup、封闭 snapshot、SQLite 检查、manifest/hash、五分钟 fixture clock、10/15 分钟失败关闭、writer=1 和四小时 runbook。
- 不安装候选依赖、不注册服务、不联网、不上传。
- 任一活动 DB/WAL 直接复制、hash 不可复算、失败仍推进 last-success 或时钟 unknown 仍 mutation，立即退出。

### GATE-B-N｜所选路线的受控双端网络适配窗口

- 只有用户另行批准精确供应商/版本/账号/计划/设备/网络/时间窗后执行。业务数据库、内容、secret 和备份载荷必须零上传；协议必需的账号、设备标识、公钥、控制/连接元数据须逐字段 allowlist，并冻结处理主体、地域、留存、删除和日志证据，出现额外字段立即停止。
- ROUTE-A 验证托管 overlay；ROUTE-B 验证自托管 control/DERP；ROUTE-C 只验证默认关闭的冷备通道。
- 覆盖家庭/办公室宽带、iPhone 蜂窝、外部 Wi‑Fi、切网、前后台、撤权、控制面/relay 故障和应用再认证；只形成网络适配收据，公网 Admin 始终为 0。

网络窗口只产生 `N-NETWORK-ADAPTATION` 收据，不能顺带通过 freshness。

### GATE-B-F｜独立五分钟签名 freshness 窗口

- 可以与 `GATE-B-N` 使用同一已批准测试时段，但使用独立输入、任务和收据；连通、切网、在线状态或撤权 UI 不能替代 freshness。
- 固定 producer、设备事实来源、policy version 来源、签名 key/version、可信 UTC 和 closed 7 字段；验证 `issuedAt≤now<expiresAt`、`0<expiresAt-issuedAt≤5m`。
- mandatory 注入：未来签发、时钟回拨、时间解析异常、签名错误、policy/device decision/session unknown、`deviceDecision=deny`、TTL 到期、控制面失联和设备撤权。每项预期都是关闭全部远程 Admin 且无 mutation 例外。
- provider 不能给出可签名、可版本化的官方事实时，`F-FRESHNESS-5M` 失败；网络适配 PASS 不能提升该路线为日常入口。

### GATE-C｜受控异机备份和四小时恢复窗口

- 只有用户另行批准精确 backend、region/host、预算、key custody、保留、可销毁数据和窗口后执行。
- 验证 snapshot→manifest/signature→restic→远端认证回读→下载/解密/hash/SQLite→替代设备→writer=1 的全链。
- `ROUTE-A/ROUTE-B` 的 B2/Object Lock 必须验证 lock/index/pack、两轮 backup、restore、read-data、forget/prune、过期删除、轮换和退出；组合未通过不得计防删 PASS。
- 合格恢复点必须已完成一致 snapshot、异机持久化、authenticated read、manifest/signature/hash 与 SQLite 完整性证明。运行中 RPO 门固定为 `trusted_now - latest_recoverable_source_commit_completed_at <15m`；事故时固定为 `incident_declared_at - latest_recoverable_source_commit_completed_at ≤15m`。`remote_authenticated_read_completed_at - source_commit_completed_at` 只作为传输/验证延迟指标，不能代替 RPO；任一时钟不可信或远端验证未完成，该点失败且不推进 last-success。RTO 从故障注入后 `incident_declared_at` 起，到替代 Admin 完成完整性/应用只读、旧主 fence、`writer_count=1`、Mac/iPhone 私有回验、恢复点重新建立，并完成最新全量公开投影的重建/签名/push/原子激活、取得 active projection receipt、public GET PASS 且临时恢复/break-glass 能力计数归零的 `service_restored_at` 止，必须 `≤4h`；超时保持 Admin mutation 关闭，public-host 只保留 last-known-good 或隔离态。

### GATE-D｜失败后的递进或退出

- ROUTE-A 因地区、计划/地域、freshness 或备份路线无法闭合时，回用户决定是否进入 ROUTE-B；不自动切换。
- ROUTE-B 失败或用户只需要最低耦合冷备时，回用户决定是否进入 ROUTE-C；ROUTE-C 不升级为日常入口。
- 任一路线退出都撤销身份/设备/peer 与上传/API/传输凭据、清除控制/relay/DNS、验证公网 Admin=0，禁止并行写主。恢复解密材料按 manifest 转移到受控托管并完成离线 restore 回读；保留期/迁移完成后才按删除收据销毁。若选择立即销毁解密材料，该仓库不得再计作最后恢复点，必须先生成并验证替代恢复点。

## 7. 未来 production manifest 增量

用户选择路线后，下一阶段合同至少准备以下字段；真实值仍由后续批准冻结：

### 7.1 路线与成本

`route_id,supplier_or_project,exact_version,license_or_plan,account_owner,payment_owner,budget_cap,price_quote_at,region,data_residency,log_retention,exit_owner`

### 7.2 私有访问

`mac_client_version,iphone_client_version,identity_provider,mfa_or_passkey,enrollment,acl_or_grant,device_approval_or_lock,control_host,relay_hosts,dns_tls,private_admin_origin,publicly_reachable_admin_listener_count,allowed_private_and_loopback_listeners,carrier_cgnat,connection_type_threshold,availability_threshold`

### 7.3 Freshness 与撤权

`freshness_producer,closed_7_fields,source_of_device_truth,source_of_policy_version,signing_key_version_ref,trusted_utc_probe,issued_at_le_now_lt_expires_at,duration_gt_0_le_5m,future_or_rollback_or_parse_unknown_action,device_decision_allow_only,session_validity,closed_reason_codes,revocation_sla,control_plane_outage,device_loss_runbook,break_glass`

### 7.4 备份与恢复

`sqlite_backup_implementation,schedule_le_5m,snapshot_checks,manifest_canonicalization,manifest_signature,backend,backup_region_or_host,failure_domain,key_custody,retention,object_lock_or_sftp_controls,authenticated_read,full_read_data_check,restore_device,rpo_clock,rto_clock,fencing,writer_count`

完整字段、manifest hash 和用户批准任一缺失，真实安装、账号、付费、探针、上传或部署均保持关闭。

## 8. 单一用户选择问题

> 下一阶段请选择一条路线：A（推荐）先编制托管 Tailscale + restic/B2 的精确验证合同；B 编制 Headscale + 自托管 DERP + restic/B2 的精确验证合同；C 只编制纯 WireGuard + restic/SFTP 的冷备通道验证合同，并保持日常远程 Admin 关闭。是否选择 A、B 或 C？

选择只授权对应的**下一阶段本地合同编制**。`GATE-B-N/GATE-B-F/GATE-C` 的任何真实安装、注册、账号、计划、费用、网络探针、密钥、上传或部署仍须后续一份精确不可变授权；`GATE-A` 的本地 synthetic 实施也须由后继任务明确授权后才能开始。

## 9. 当前未授权与回退

- 当前供应商选择：无。
- 当前账号/计划/费用：无。
- 当前安装、网络探针、上传、资源或部署：0。
- 当前 accepted ADR、Spec、app、data、design 修改：0。
- 用户拒绝全部路线时，保持本地/带外 Admin 关闭态、public-host last-known-good 和 writer=1；不降低既有专用设备、安全、备份或恢复合同。
