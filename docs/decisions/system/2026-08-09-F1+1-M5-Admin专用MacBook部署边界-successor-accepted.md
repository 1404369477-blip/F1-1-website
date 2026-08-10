---
type: system_adr
status: accepted
date: 2026-08-09
decision_id: ADR-M5-ADMIN-DEDICATED-MACBOOK-001
task_id: TASK-20260809-00EFBB
department: 产品部
amends: ADR-M5-ADMIN-MACBOOK-HOST-001
authorization_state: user_confirmed
authorization_evidence: 用户于当前会话明确选择 A：专用 MacBook
implementation_state: not_implemented
production_deployment: unauthorized
predecessor_bytes_unchanged: true
---

# ADR-M5-ADMIN-DEDICATED-MACBOOK-001：Admin 专用 MacBook 部署边界 successor

## 1. 决策

`admin-host` 固定采用用户控制、位于家中或办公室、以常开为运维目标的**专用 MacBook**。专用含义冻结为：该设备不承担日常个人工作，不安装与 Admin 运行、维护、安全或恢复无关的常驻软件，不把个人账号、个人同步盘、个人浏览器资料或个人开发环境作为 Admin 服务依赖。

本 successor 只关闭 [ADR-M5-ADMIN-MACBOOK-HOST-001](2026-08-09-F1+1-M5-Admin-MacBook主机落点-successor-accepted.md) 的“专用或共用”分支选择。前序双主机、唯一写主、独立 public-host、Mac/iPhone 等价、私有入口、`RTO≤4h`、`RPO≤15m`、异机加密备份和单一生产门禁全部继续有效。

## 2. 状态边界

| 项目 | 当前状态 | 说明 |
| --- | --- | --- |
| 专用 MacBook | 已确认 | 用户选择 A；共用设备分支退出当前路线 |
| 专用设备/OS/账号安全基线 | 已确认合同要求 | 尚未配置或验证 |
| 具体 MacBook、OS 版本、地点、供电、overlay、备份介质、密钥、public-host | 未确认 | 只能由后继不可变 deployment manifest 固定 |
| 本地实现、实机 Mac/iPhone、跨网、休眠/断电/更新、RTO/RPO 演练 | 未实施/未验证 | accepted 文档不构成运行收据 |
| 生产部署 | 未授权 | 仍只认一份不可变 `PRODUCTION-DEPLOYMENT-MANIFEST`/hash 的用户批准 |

## 3. 专用设备基线

deployment manifest 必须逐项固定并由后继安全/测试证明：

1. **设备用途**：无日常个人工作负载；最小安装清单和进程基线；新增常驻软件须重新过安全门。
2. **OS 身份**：Admin 服务使用独立、非交互、无管理员/sudo 的专用服务账号；人类维护只用具名、最小数量、可审计的运营账号。root/本地管理员属于可信运维边界，不能作为普通日常账号。
3. **登录**：自动登录关闭；服务启动不依赖图形用户登录；屏幕锁定、会话超时和远程维护均不绕过应用认证。
4. **磁盘与 secret**：FileVault 必须开启并回读；恢复密钥、服务 secret、签名材料和备份解密材料不以明文驻留个人 shell、浏览器、同步盘或仓库，实际托管/轮换方案仍待 manifest。
5. **电源与休眠**：可靠电源、禁止服务期睡眠；合盖、运输、关机、更新和重启均先进入维护窗，形成并回读 `≤15m` 异机恢复点。
6. **私有访问**：Mac/iPhone 仅经私有 overlay、设备/策略准入与应用强认证访问；公网 Admin、端口转发、UPnP、隐藏 URL 和公网隧道全时禁止。
7. **单写主与公开主机**：Admin MacBook 是唯一写主；public-host 继续独立、只读、可丢弃且不可反向提升。

上述任何一项为 false、unknown 或缺收据，真实部署保持关闭。专用设备不得被写成已经配置、在线、加密或通过演练。

## 4. 故障、恢复与回退

运行故障与 overlay freshness 机械规则继续逐字继承 [MacBook 主机补充实施合同 v0.1](../../spec/F1+1-M5-Admin-MacBook主机补充实施合同-v0.1.md)。本 successor 追加以下专用分支规则：

| 事件 | 立即动作 | 恢复/回退 |
| --- | --- | --- |
| 仅有签名 allowlist 可证明的 benign 软件基线偏差 | 进入维护窗，阻断 mutation，记录基线漂移 | 清除偏差并复验同一签名基线后恢复 |
| 未知进程、个人同步/profile、基线来源或完整性 unknown | 关闭全部远程 Admin，停止相关服务，保全脱敏审计；按潜在失陷撤销/轮换可能暴露的 session、overlay、签名和备份凭据 | 从干净镜像重建，证明 DB/secret 未暴露或完成轮换，并全基线复验后恢复 |
| 服务账号获得交互登录或管理员/sudo | 立即停服务、撤权、轮换受影响凭据 | 重建非交互最小账号，复验文件族/进程/secret 与 writer=1 |
| 自动登录、FileVault、私有监听或应用认证不满足 | 关闭全部远程 Admin 读写 | 修复并回读同一基线；禁止临时公网旁路 |
| 设备丢失/失陷 | fence 旧主，撤销设备、会话、passkey、服务和签名/备份凭据 | 从异机加密恢复点重建干净专用 MacBook；旧主不可写后才提升 |
| 设备无法继续专用 | 不静默转为共用设备 | 保持生产关闭；返回用户形成新的 successor 后才可改变路线 |

实施失败时只撤销本 successor 的专用分支选择，回到已确认 MacBook 落点且设备隔离分支待重新决策的 predecessor 状态。回退不得产生第二写主、同机 public/Admin、公网 Admin、数据库双活或第二业务真值。

## 5. 后继门禁

| 阶段 | 前置与出口 |
| --- | --- |
| 开发 | 只在另行获批的本地 synthetic 边界实现/验证专用 profile 和 readiness；不得操作真实设备 |
| 安全（manifest 批准前） | 只读审查合同、fixture 与 probe 模拟；不得读取或改动真实设备、FileVault、自动登录、账号、网络或 secret |
| 测试（manifest 批准前） | 只运行 synthetic/fixture 故障矩阵；合盖/重启/断电等仅模拟，不触发真实设备动作 |
| 实机安全/测试/生产 | 精确设备/OS/地点/账号/电源/overlay/备份/public-host/密钥/监控/成本全部进入不可变 manifest 并获用户批准后，才在同一授权窗口执行真实配置、故障复验和部署 |

## 6. 授权与禁止项

本决策不授权购买、安装、设备配置、账号创建、FileVault 修改、自动登录修改、休眠/更新策略修改、网络/端口/overlay 配置、密钥生成或轮换、备份服务、public-host、DNS/TLS、付费、外发或生产部署。

旧 accepted ADR 与合同保持字节不变。本 successor 不修改领域实体、状态机、SQLite schema、API DTO、app、data 或 design。
