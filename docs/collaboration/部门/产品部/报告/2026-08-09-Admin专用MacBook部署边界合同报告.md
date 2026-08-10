---
type: department_report
status: final
decision: pass
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-00EFBB
p0: 0
p1: 0
p2: 0
external_effects: none
---

# TASK-20260809-00EFBB｜Admin 专用 MacBook 部署边界合同报告

## 1. 结论

任务通过。用户明确选择 A（专用 MacBook）已形成现行唯一窄范围 accepted 入口 `ADR-M5-ADMIN-DEDICATED-MACBOOK-001` 和 v0.2 实施合同；原“专用或共用”问题已关闭，共用设备分支退出当前路线。

本次只形成产品合同。真实 MacBook、OS、账号、FileVault、自动登录、供电/休眠、overlay、网络、端口、密钥、备份服务、public-host 和生产部署均未操作、未验证、未授权。

## 2. 产出

1. [专用 MacBook successor accepted](../../../../decisions/system/2026-08-09-F1+1-M5-Admin专用MacBook部署边界-successor-accepted.md)
2. [专用 MacBook 补充实施合同 v0.2](../../../../spec/F1+1-M5-Admin专用MacBook补充实施合同-v0.2.md)
3. [初版全功能追踪矩阵 v0.1](../../../../spec/F1+1-初版全功能追踪矩阵-v0.1.md)
4. [Spec](../../../../spec.md)
5. [Spec 索引](../../../../spec/README.md)
6. [Progress](../../../../progress.md)

## 3. Predecessor 字节保持收据

任务领取前只读 SHA-256：

- `ADR-M5-ADMIN-MACBOOK-HOST-001`：`9638f181b6e7f4f127ea5dbaa8bd925d846bb0ea34bd1d14f9491e0418bf7ffb`
- `F1+1-M5-Admin-MacBook主机补充实施合同-v0.1.md`：`6025fa214207fedb9ced8e22a443cebe21f0c078d937573c67a1258033325534`

完成后复算与上述逐字相等。旧 accepted successor 与 v0.1 合同未原地修改；v0.2 作为现行实施入口，旧文档保留历史链。

## 4. 已冻结的专用设备合同

- 设备用途：专用 Admin，不承担日常个人工作，不依赖个人账号、同步盘、浏览器资料或个人开发环境。
- OS 身份：独立、非交互、无 admin/sudo 的服务账号；具名、最小数量、可审计的运营账号；root/本地管理员属于可信运维边界。
- 登录与磁盘：自动登录关闭；服务不依赖图形用户登录；FileVault 必须开启并回读；恢复密钥和 secret 只记录托管引用。
- 运行边界：可靠电源、服务期禁止睡眠；合盖/关机/更新/重启先进入维护窗并形成 `≤15m` 异机恢复点。
- 访问：Mac/iPhone 经私有 overlay、设备/策略准入和应用强认证使用同一 Admin origin；公网 Admin、端口转发、UPnP、隐藏 URL 和公网隧道全时禁止。
- 数据：唯一写主；public-host 继续独立、公开只读、可丢弃且不可反向提升。
- 备份：加密异机、不同物理故障域、hash/manifest、回读和隔离演练；`RPO≤15m`、`RTO≤4h` 继承不变。
- 基线漂移：签名 allowlist 可证明的 benign 偏差只进入维护窗；未知进程、个人同步/profile 或完整性 unknown 立即关闭全部远程 Admin、停相关服务、保全脱敏审计、撤销/轮换可能暴露的凭据，并从干净镜像重建。
- 监听指标：`publicly_reachable_admin_listener_count=0`；精确 allowlist 的一个私有 Admin origin 和可选单个 loopback 维护 listener 单独验收，独立 public-host 的公开只读 GET listener不计入该指标。

## 5. 后继门禁

| 阶段 | 当前权限与出口 |
| --- | --- |
| 开发 | 只有另行获批的本地 synthetic 实施；不操作真实设备或网络 |
| manifest 前安全/测试 | 只读合同、fixture 和 probe 模拟；不读取或改变真实 FileVault、自动登录、账号、网络或 secret，不触发实机合盖/重启/断电 |
| manifest 后实机安全/测试 | 仅在不可变 production manifest/hash 已获用户批准、精确设备 hash 和授权窗口登记后执行 |
| 生产 | 上述同一授权窗口内通过实机安全/故障复验后，才允许提升部署；writer=1、公网 Admin=0、Mac/iPhone、RPO/RTO 与回退均须 PASS |

## 6. 对抗审查

| 审查 | 首轮 | 修订 | 最终 |
| --- | --- | --- | --- |
| 产品/时态 | P0=0/P1=2 | “文档已形成”与“设备实现为 0”分开；独立 public-host 架构与具体资源状态分开 | PASS，P0=0/P1=0 |
| 安全/恢复 | P0=0/P1=1 | 专用基线漂移分 benign allowlist 与潜在失陷两级；unknown 关闭全部远程 Admin并停服务 | PASS，P0=0/P1=0 |
| 领域/架构 | P0=0/P1=3 | manifest 前后 SEC/TEST 分段；同步基线失陷动作；闭合公网 Admin listener 计数与私有/public-host 排除 | PASS，P0=0/P1=0 |

领域审查的 predecessor 哈希 P2 已由本报告第 3 节闭合。最终 `P0=0 / P1=0 / P2=0`。

## 7. 已验证

- 任务已正式 declare-impact 并 claim，写入路径只覆盖新 successor、新实施合同和允许的产品状态文档；external effect 为 none。
- dedicated 用户确认、唯一现行入口、v0.2 合同、Spec、矩阵、Spec 索引与 progress 时态一致。
- “已形成合同”“已实施为无”“具体资源未确认/未验证”“生产未授权”四类边界分开。
- 专用服务账号、运营账号、FileVault、自动登录、最小软件/进程、secret、生命周期、访问、单写主、public-host、备份与回退均有合同和后继验收出口。
- manifest 批准前的安全/测试不能触发实机动作；实机复验与部署继续绑定同一不可变 manifest/hash、设备 hash 和用户授权窗口。
- 三路只读对抗审查最终均为 P0=0/P1=0。
- predecessor 两份 SHA-256 完成前后相等。
- 目标链接、Markdown、关键时态、`git diff --check` 和任务 doctor 通过。

## 8. 未验证

- 精确 MacBook 型号、资产、OS/补丁、家中或办公室的具体地点和物理访问控制；
- 服务/运营账号、FileVault、恢复密钥托管、自动登录、屏幕锁、软件/进程基线、R5 文件族和 secret；
- 电源、电池、UPS、合盖/睡眠、更新/重启、overlay、运营商/CGNAT、私有 origin；
- 异机备份目标、地域、加密密钥、保留、替代恢复设备和隔离演练；
- 具体 public-host 资源/供应商/地域/配置、DNS/TLS、接收身份、监控、成本；
- 实机 Mac/iPhone、`writer_count=1`、`publicly_reachable_admin_listener_count=0`、真实 `RPO≤15m`/`RTO≤4h` 与 production manifest。

这些未验证项不阻断本合同交付，只阻断真实设备配置、实机故障复验或生产部署。

## 9. 错题自检

- 未把 dedicated 写成设备已购买、已清空、已配置、已加密、已联网或已通过演练。
- 未把设备分支确认外推为 Admin 业务、视觉、真实网络、密钥、备份或生产部署批准。
- 未操作 MacBook、FileVault、自动登录、账号、休眠、更新、overlay、端口、密钥、备份、public-host、付费或外部资源。
- 未允许 manifest 批准前的安全/测试触发真实设备动作。
- 未在专用基线 unknown 时保留远程读取；未把 benign 偏差与潜在失陷混为同一降级。
- 未把私有 Admin listener 或 public-host 公开 GET 错计为公网 Admin；公网可达 Admin listener 始终为 0。
- 未修改旧 accepted successor/v0.1、领域 schema、状态机、API DTO、app、data 或 design。
- 未新增第二写主、数据库双活、第二 Publication/Projection、第二 schema 或第二业务真值。

## 10. 任务状态

产品合同和三路审查已完成；任务工具持久化为 `completed` 后返回 `TASK_STATE_OK`。真实设备与生产部署继续关闭。

