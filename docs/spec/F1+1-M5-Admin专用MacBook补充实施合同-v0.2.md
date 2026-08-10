---
type: product_implementation_contract
status: accepted_contract_pending_implementation
date: 2026-08-09
task_id: TASK-20260809-00EFBB
decision_id: ADR-M5-ADMIN-DEDICATED-MACBOOK-001
department: 产品部
supersedes_for_current_implementation: F1+1-M5-Admin-MacBook主机补充实施合同-v0.1.md
scope: 专用 Admin MacBook 设备基线、恢复与后继门禁增量
production_deployment: unauthorized
---

# F1+1 M5 Admin 专用 MacBook 补充实施合同 v0.2

## 1. 现行入口与继承

本合同是 [ADR-M5-ADMIN-DEDICATED-MACBOOK-001](../decisions/system/2026-08-09-F1+1-M5-Admin专用MacBook部署边界-successor-accepted.md) 的现行实施入口。它完整继承 [MacBook 主机补充实施合同 v0.1](F1+1-M5-Admin-MacBook主机补充实施合同-v0.1.md) 的访问、readiness、故障、overlay freshness、备份、RPO/RTO、public-host 与 production manifest 规则，只把原 §6 的分支固定为“专用”。v0.1 保留为不可改写历史。

## 2. 当前真值

| 类别 | 精确内容 |
| --- | --- |
| 已确认 | 家中或办公室、以常开为运维目标的专用 Admin MacBook；无日常个人工作；独立 public-host；Mac/iPhone 私有入口；唯一写主；`RTO≤4h`、`RPO≤15m` |
| 已关闭问题 | `ADMIN-MACBOOK-DEDICATION=dedicated`；共用设备分支不再是现行路线 |
| 已形成/已接受合同 | 本 successor 与实施合同文档；不构成设备或运行实现 |
| 已实施 | 无；设备与运行实现为 0 |
| 未确认/未验证 | 精确设备/OS/地点、账号、FileVault、自动登录、供电/UPS、睡眠、overlay/CGNAT、备份目标/密钥、具体 public-host 资源/供应商/地域/配置与运行收据、DNS/TLS、监控、成本、实机双端和部署 |

## 3. 专用基线的机械合同

deployment manifest 与同一候选的实施收据必须闭合下列项：

| 控制 | 必须值 | 失败动作 | 恢复证据 |
| --- | --- | --- | --- |
| `device_usage` | `dedicated_admin_only` | 仅签名 allowlist 的 benign 偏差进入维护窗并关 mutation；未知个人负载/进程关闭全部远程 Admin并停相关服务 | 干净镜像、软件/进程基线重扫及同 hash 回读；潜在失陷须有凭据撤销/轮换收据 |
| `service_account` | 独立、非交互、无 admin/sudo | 停服务、撤权、轮换受影响 secret | 账号属性、目录 owner、进程 UID 与无交互登录收据 |
| `operator_accounts` | 具名、最小数量、可审计；不得作为日常个人账号 | 未知账号或未受信任管理员即部署关闭 | 账号清单 hash、权限回读和审计链 |
| `automatic_login` | `disabled` | 关闭全部远程 Admin | OS 设置回读与重启复验 |
| `filevault` | `enabled_verified` | 关闭全部远程 Admin 和 mutation | 加密状态回读；恢复密钥只记录托管引用，不记录材料 |
| `personal_sync_or_profile` | `absent` | 任一存在或 unknown 时关闭全部远程 Admin、停相关服务、保全脱敏审计，并撤销/轮换可能暴露的 session、overlay、签名和备份凭据 | 干净镜像；同步客户端/个人浏览器资料/个人开发环境为 0；DB/secret 零暴露证明或完整轮换收据 |
| `sleep_policy` | 服务期 `sleep_inhibited` | 进入维护/恢复态 | 合盖、空闲、重启后的 readiness 回验 |
| `publicly_reachable_admin_listener_count` | `0` | 立即隔离和撤销临时入口 | 公网可达 Admin listener、端口映射、UPnP 和公网隧道均为 0；精确 allowlist 的一个私有 Admin origin 与可选单个 loopback 维护 listener 另行复验，独立 public-host 的公开只读 GET listener 不计入该指标 |
| `writer_count` | `1` | mutation=0，fence 所有候选主 | 唯一写主、旧主不可写、数据库文件族完整性收据 |
| `backup_age` | `<15m` | 按 RPO breach 关高风险 mutation | 加密异机异故障域恢复点、hash/manifest、回读与演练 |

每项在 deployment manifest 中绑定唯一 probe、证据来源、采样 TTL、closed reason code、owner、告警与恢复回读。任一缺失或 unknown 按 v0.1 的 access/mutation 分层失败关闭。

## 4. 生命周期、故障与回退增量

1. 合盖、运输、计划关机、OS 更新或重启前，先停止新高风险 mutation、对账在办 operation，并形成/回读 `≤15m` 异机恢复点。
2. 意外睡眠、重启、断电、FileVault/自动登录漂移、账号提权后，先保持远程 Admin 关闭；只有 v0.1 `remote_access_ready` 与本合同全部专用基线通过才恢复。软件/进程偏差只有签名 allowlist 可证明为 benign 时可只进入维护窗；任何未知进程、个人同步/profile 或基线完整性 unknown 一律按潜在失陷关闭全部远程 Admin、停相关服务并执行撤销/轮换与干净重建。
3. 宽带/CGNAT/overlay 异常不得打开公网旁路。控制面离线只按 v0.1 的签名 freshness 收据和可信 UTC 五分钟上限保留最小只读。
4. 丢失/失陷时撤销旧设备身份、会话/passkey、服务/签名/备份凭据并 fence 旧主；从加密异机恢复点重建干净专用设备。
5. 设备无法维持专用时，禁止自动切换共用分支。真实部署保持关闭，等待新的用户决策与 successor。
6. 回退只回到 `ADR-M5-ADMIN-MACBOOK-HOST-001` 的“MacBook 落点已确认、设备隔离分支待重新决定”；public-host 继续 last-known-good，禁止第二写主、双活、同机 public/Admin 或公网 Admin。

## 5. 后继实施与验收

| 阶段 | Owner | 前置 | 交付与验收出口 |
| --- | --- | --- | --- |
| `DEV-ADMIN-DEDICATED-01` | 开发部 | Admin 业务/视觉及本地实施授权另行满足 | 仅在 synthetic 环境实现专用 profile、readiness probes 与 fail-closed；无真实设备/网络 |
| `SEC-ADMIN-DEDICATED-01` | 安全部 | 同一候选 hash；production manifest 尚未批准 | 只读审查合同与 fixture/probe 模拟中的账号/权限、FileVault、自动登录、软件/进程基线、R5 文件族、secret、overlay/no-public-admin、丢失撤权；不读取或改动真实设备/配置 |
| `TEST-ADMIN-DEDICATED-01` | 测试部 | 同一候选 hash；production manifest 尚未批准 | 只运行 synthetic/fixture：正常、benign allowlist 偏差、未知进程/个人同步/profile、未知账号、提权、自动登录、FileVault、睡眠/合盖/重启/更新/断电、宽带/overlay、备份超龄、旧主未 fence；不触发真实设备故障 |
| `SEC/TEST-ADMIN-DEDICATED-REAL-01` | 安全/测试 | 不可变 production manifest/hash 已获用户批准；精确设备 hash 与实施窗口已登记 | 才执行实机账号/FileVault/自动登录/监听/睡眠/网络/丢失恢复等安全与故障复验；未知基线证明远程 Admin/服务=0、脱敏审计保全、DB/secret 零暴露或凭据完整轮换 |
| `OPS-ADMIN-DEDICATED-01` | 统筹/开发/安全/测试 | 上述同一 production manifest 授权窗口和实机复验通过 | 才完成部署提升；Mac/iPhone、writer=1、`publicly_reachable_admin_listener_count=0`、私有/loopback allowlist、独立 public-host GET、RPO/RTO 和完整回退实机 PASS |

## 6. Production manifest 继续未决的精确字段

- 设备型号/序列资产引用、支持的 OS 与补丁版本、家中或办公室的精确地点和物理访问责任；
- 专用服务账号、具名运营账号、FileVault/恢复密钥托管引用、自动登录、屏幕锁和服务启动方式；
- 最小软件/进程基线、目录和生产 SQLite/DB-WAL-SHM/journal/backup 文件族、R5 威胁范围；
- 电源/充电器/电池/UPS、合盖/睡眠、维护与更新窗口；
- overlay 产品/策略/控制面故障、运营商/CGNAT、私有 origin；
- 异机备份目标/地域/故障域、加密/密钥/保留、替代恢复设备与演练；
- 独立 public-host、域名/TLS、接收身份、监控、告警、成本、RTO/RPO 与回退。

字段齐全、hash 冻结和用户批准三者缺一时，真实设备配置和生产部署均保持未授权。

## 7. 禁止项

- 不得把“专用”写成设备已购买、已清空、已加密、已联网、已备份或已通过演练。
- 不得使用个人账号、个人同步盘、个人浏览器资料或个人开发环境承载服务或 secret。
- 不得以专用设备选择替代 Admin 业务/视觉、production manifest、真实网络/密钥或部署授权。
- 不得修改 v0.1、双主机 predecessor、领域 schema、状态机、API DTO、app、data 或 design。
