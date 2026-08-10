---
type: product_implementation_contract
status: accepted_contract_pending_implementation
date: 2026-08-09
task_id: TASK-20260809-2F423C
decision_id: ADR-M5-ADMIN-MACBOOK-HOST-001
department: 产品部
scope: Admin MacBook 主机落点、私有双端入口与运行恢复增量
production_deployment: unauthorized
---

# F1+1 M5 Admin MacBook 主机补充实施合同 v0.1

## 1. 适用与继承

本合同只实施 [ADR-M5-ADMIN-MACBOOK-HOST-001](../decisions/system/2026-08-09-F1+1-M5-Admin-MacBook主机落点-successor-accepted.md) 的主机落点增量。双主机、唯一写主、公开只读投影、分发协议、双端 Function ID、RTO/RPO 与生产门禁继续以 [M5 Admin 双主机实施合同 v0.2](F1+1-M5-Admin双主机实施合同-v0.2.md) 为准。

本合同不修改领域 schema、状态机、API DTO、app 或既有 accepted 正文，也不授权任何真实设备、网络、端口、密钥、备份服务、公开主机或部署操作。

## 2. 当前真值

| 类别 | 精确内容 |
| --- | --- |
| 已确认 | `admin-host` 为用户控制、家中或办公室、以常开为运维目标的 MacBook；`public-host` 独立；Mac/iPhone 走私有 overlay；公网 Admin 入口在日常和应急均不存在 |
| 未确认 | MacBook 专用或共用；精确设备/OS/地点、overlay 产品与策略、运营商/CGNAT、域名/TLS、备份介质/地域/密钥、监控、成本与部署 manifest |
| 已实施 | 仅本文档和 accepted successor；没有运行实现 |
| 未实施/未验证 | 设备配置、休眠/电源策略、跨网访问、实机两端、恢复点、故障注入、RTO/RPO、公开主机与生产部署 |

“常开”是必须通过实施和收据证明的运维目标，不能被记录为当前设备事实。

## 3. 运行准备谓词

本合同不新增领域状态。远程 Admin 读取只在 `remote_access_ready` 成立时开放：

```text
host_power_ok
and sleep_inhibited
and clock_trusted
and disk_encryption_verified
and app_config_hash_verified
and private_bind_verified
and overlay_device_policy_fresh
and application_auth_ready
and emergency_stop = clear
```

身份/设备、overlay 策略、应用认证、private bind、可信时钟、磁盘/配置完整性或 stop 任一为 false/unknown 时，关闭全部远程 Admin 读写。本地/带外只读只能沿 predecessor 的受控 break-glass 进入，不能复用失败的远程会话。

在 `remote_access_ready` 基础上，Admin mutation 还须满足：

```text
writer_count = 1
and backup_age < 15m
and maintenance_window = false
```

只有 backup age 超龄、处于维护窗或唯一写主尚未提升时，可在 `remote_access_ready` 仍完整成立的条件下保留受控最小只读；新的 revision/approve/reject/publish 和设备/权限变更保持关闭。public-host 只继续 last-known-good，不因任何 readiness 失败获得写能力。

## 4. Mac 与 iPhone 等价入口

| 端 | 日常入口 | 成功条件 | 失败/恢复 |
| --- | --- | --- | --- |
| Mac | 私有 overlay 客户端 → 同一 Admin HTTPS origin | 设备健康、策略新鲜、应用强认证和 §3 全通过 | 任一失败零 mutation；修复后重新认证并重载当前对象 |
| iPhone | 私有 overlay 客户端 → 同一 Admin HTTPS origin | 与 Mac 相同权限和全部 Function ID；高风险动作 fresh re-auth + 前台确认 | 不降级成功语义；断网/刷新按同 operation/delivery 恢复 |
| Admin MacBook 本机 | loopback → 同一应用 | 仍需用户/session/Origin/CSRF/CAS/fence | 只用于本地或带外维护；不算跨网或双端验收 |

私有 overlay 与 app auth 均为必需层。公网端口转发、UPnP、隐藏 URL、公网 Admin 和公网隧道均为禁止项。break-glass 只恢复私有 overlay 或受控本地/带外访问。

## 5. MacBook 生命周期与故障合同

| 场景 | 写入状态 | 必须动作 | 恢复出口 |
| --- | --- | --- | --- |
| 正常常开 | 仅 §3 全过时开放 | 可靠电源、禁止睡眠、健康/备份时龄监测 | 持续门禁；任一 unknown 立即关闭高风险 mutation |
| 合盖/运输/计划休眠/关机 | 维护窗，阻断新高风险 mutation | 等待在办 operation 对账，生成并回读 `≤15m` 异机恢复点，记录维护原因 | 开盖/开机后走完整冷启动门禁 |
| 意外睡眠/重启/断电 | 不可用/恢复态，mutation=0 | 保留公开 last-known-good，检查未决 operation、SQLite integrity、唯一写主和备份时龄 | 全部门禁和 synthetic 回验通过后恢复 |
| OS/安全更新 | 维护窗，mutation=0 | 更新前有效异机恢复点；记录 app/config/OS 版本；更新和重启 | 版本/hash/integrity/认证/overlay/双端回验；失败回最后可证明组合 |
| 宽带中断/CGNAT 变化 | 远程 Admin 不可用 | 禁止端口映射与公网旁路；保留 public-host | 所选 overlay 的实际链路与策略收据通过后恢复 |
| overlay 控制面/策略异常 | 新登录、提权和 mutation 关闭 | 远程只读仅在可信时钟与签名 freshness 收据有效、`offlinePolicyTTL≤5m` 时继续 | TTL 到期或任一输入 unknown 时关闭全部远程 Admin；控制面、策略和设备健康恢复后重新认证 |
| MacBook 丢失/失陷 | 立即 fence/隔离，mutation=0 | 撤销设备身份、会话、passkey、服务凭据和相关密钥；按泄露处理 | 干净设备异机恢复；旧主不可写、writer=1、全链回验 |
| public-host 故障 | 不改变 Admin 主库 | 隔离公开主机；不从公开副本反向恢复 | 由 Admin 已签名全量投影重建并原子激活 |

## 6. 专用/共用设备的闭合分支

`ADMIN-MACBOOK-DEDICATION` 是本合同唯一未决输入：

| 用户答案 | 部署前附加门禁 |
| --- | --- |
| 专用 | 无日常个人工作负载；最小软件集；独立服务身份；明确物理访问、补丁和维护责任 |
| 共用 | 独立 OS 服务账号/数据目录；FileVault；个人进程和个人 shell/keychain 无 DB、备份、签名或服务 secret；普通登录用户不能绕过 app auth；个人更新/重启与维护窗协调；服务退出失败关闭；全部 root/本地管理员均为具名、最小化、可审计的可信运维身份，存在未受信任管理员即不合格 |

任一分支都要求相同的唯一写主、认证、审计、RPO/RTO 与生产 manifest。共用设备隔离证据不完整时保持部署关闭。

## 7. 异机备份、RPO/RTO 与回退

1. 继承在线一致快照每 `≤5m` 尝试、`10m` 预警、`15m` 关闭高风险 mutation、`RPO≤15m` 与 `RTO≤4h`。
2. 合格恢复点必须加密、hash/manifest 可复算、回读通过、处于不同物理故障域且经过隔离恢复演练。
3. MacBook 内置盘、同机或同桌长期连接外置盘、同一家庭路由器存储和 public-host 均不能单独满足异机备份。
4. 备份供应商/地域/介质、密钥托管、保留周期和替代恢复设备由后继 deployment manifest 固定；当前全部未确认。
5. 不能证明可信时钟或 `backupAge≤15m` 时按 RPO breach 处理。恢复超出四小时或旧主 fencing 不可证明时，Admin mutation 继续关闭，public-host 只保留 last-known-good。
6. MacBook 落点实施失败时，回到“独立 Admin 主机形态待定”的 predecessor 状态；禁止回退到双写、同机公开/Admin、静态 Demo、公网 Admin 或第二业务真值。

## 8. Deployment manifest 的新增必填项

生产门禁仍只有 predecessor 的一份不可变 `PRODUCTION-DEPLOYMENT-MANIFEST` 与用户批准 hash。该 manifest 至少补齐：

- MacBook 型号、受支持 OS/补丁版本、资产所有者、物理地点和专用/共用答案；
- 供电、充电器、电池健康、是否配置独立 UPS、合盖/休眠/登录后启动和维护窗策略；
- FileVault 与恢复密钥托管、服务账号、目录权限、签名/备份 secret 注入与轮换；
- 生产 SQLite profile、数据库/`-wal`/`-shm`/journal/backup 文件族的打开、关闭、checkpoint、权限与恢复规则，以及恶意同 UID、root/本地管理员的明确威胁范围和 R5 收据；本地 synthetic 收据不得外推；
- overlay 产品、设备/用户策略、控制面故障策略、私有 origin、运营商/CGNAT 实测；
- 异机备份目标、物理故障域、加密、保留、监控、替代恢复设备和隔离演练收据；
- public-host 的独立供应商/地域、域名/TLS、接收身份与公开恢复；
- 成本、责任人、告警、RTO/RPO 演练和完整回退步骤。
- §3 每个 readiness 谓词的唯一 probe、证据来源、采样 TTL、closed failure reason code、owner、告警和恢复回读；缺项或 probe unknown 时按对应 access/mutation 失败关闭。

字段未全、hash 未冻结或用户未批准时，真实创建、配置和部署均不得开始。

## 9. 分阶段实施与 mandatory 验收

| 阶段 | 前置 | 出口 |
| --- | --- | --- |
| `PLAN-ADMIN-MACBOOK-01` | 用户回答专用/共用；仍不批准部署 | 完成两分支之一的不可变设备基线与失败关闭清单 |
| `DEV-ADMIN-MACBOOK-01` | 既有 Admin 业务/视觉门禁和本地实施授权另行满足 | 仅在受控 synthetic 环境验证 §3–§7；无真实跨网/部署 |
| `SEC/TEST-ADMIN-MACBOOK-01` | 同一候选 hash | 睡眠、合盖、重启、断电、宽带/CGNAT、overlay、丢失、共用隔离、生产 R5/文件族、readiness probe、备份超龄与四小时恢复均有独立收据 |
| `OPS-ADMIN-MACBOOK-01` | 唯一 production manifest/hash 获用户批准 | 才可操作真实设备、网络、密钥、备份和部署；完成 Mac/iPhone、RPO/RTO、writer=1 与公网 Admin=0 实机收据 |

本合同完成的必要证据：

1. Mac 与 iPhone 的 `ADMIN-PROFILE-001`–`ADMIN-RECOVER-008` 全部能力与失败恢复等价。
2. 私有入口之外的公开 Admin listener、端口映射、UPnP、隐藏 URL、长期公网隧道均为 0。
3. 睡眠/合盖/更新/断电后先关闭 mutation，完整启动门禁通过后才恢复。
4. 宽带、CGNAT、overlay 控制面故障不会提升 public-host、开公网旁路或产生第二写主。
5. 设备丢失与共用场景证明凭据撤销、进程/账号隔离、旧主 fencing、writer=1。
6. 异机备份不落在同一物理故障域，`RPO≤15m`、`RTO≤4h` 以真实时钟演练证明。
7. public-host 独立且只有公开只读投影；Admin 主库无法由公开副本反向覆盖。
8. 所有实机、网络、密钥、备份和部署证据在 production manifest 获批前都只能记为 pending/未验证。
9. `remote_access_ready` 中任一身份、策略、认证、私有监听或完整性门失败时，Admin 读取与 mutation 均关闭；只有 backup/维护/写主提升门失败且访问门仍完整成立时，才保留受控最小只读。

overlay freshness 收据使用 closed 输入 `{deviceId,policyVersion,deviceDecision,sessionId,issuedAt,expiresAt,signature}`；`deviceDecision` 只能为 `allow|deny`。只有系统可信 UTC `now`、签名和 policy version 全部通过，`deviceDecision=allow`、session 未过期、`issuedAt≤now<expiresAt` 且 `0<expiresAt-issuedAt≤5m` 时，控制面中断期间才允许既有远程会话继续最小只读。任何字段缺失、签名/版本不匹配、`issuedAt` 超前、时钟回拨/unknown、时间解析异常或到期都立即关闭全部远程 Admin 访问；不保留 mutation 例外。

## 10. 唯一未决问题

> 这台常开 MacBook 是否作为专用 Admin 主机，不承担日常个人工作？

该问题的答案只选择 §6 的部署分支，不授予任何真实实施或生产权限。
