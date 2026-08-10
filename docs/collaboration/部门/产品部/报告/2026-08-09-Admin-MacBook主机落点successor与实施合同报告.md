---
type: department_report
status: final
decision: pass
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-2F423C
p0: 0
p1: 0
p2: 0
external_effects: none
---

# TASK-20260809-2F423C｜Admin MacBook 主机落点 successor 与实施合同报告

## 1. 结论

任务通过。用户已确认的“家中或办公室常开的 MacBook 作为独立 Admin 主机”已收敛为唯一窄范围 accepted 入口 `ADR-M5-ADMIN-MACBOOK-HOST-001`，并形成补充实施合同、Spec/矩阵/索引/进度同步。公开只读主机继续独立；唯一写主、Mac/iPhone 全功能等价、`RTO≤4h`、`RPO≤15m` 与单一生产部署门禁均继承 predecessor。

本任务没有操作真实 MacBook、网络、端口、overlay、DNS/TLS、密钥、备份服务、公开主机或部署。MacBook 专用或共用仍是该主机落点唯一未决输入，未自行选择。

## 2. 产出

1. [ADR-M5-ADMIN-MACBOOK-HOST-001 accepted](../../../../decisions/system/2026-08-09-F1+1-M5-Admin-MacBook主机落点-successor-accepted.md)
2. [M5 Admin MacBook 主机补充实施合同 v0.1](../../../../spec/F1+1-M5-Admin-MacBook主机补充实施合同-v0.1.md)
3. [初版全功能追踪矩阵 v0.1](../../../../spec/F1+1-初版全功能追踪矩阵-v0.1.md)
4. [Spec](../../../../spec.md)
5. [Spec 索引](../../../../spec/README.md)
6. [Progress](../../../../progress.md)

predecessor 保持字节不变：

- `ADR-M5-ADMIN-DUAL-HOST-001` SHA-256：`f214bede47428ea297bd95bae350c21cac0d6f675f8e1ac76c938f9d5f706e89`
- `F1+1-M5-Admin双主机实施合同-v0.2.md` SHA-256：`b30994d509d78c018be29399e2ca52959efa49937727331fa4729b37366189bb`

## 3. 已冻结的合同增量

- `admin-host` 物理形态：用户控制、位于家中或办公室、以常开为运维目标的 MacBook。
- `public-host`：继续独立，只承载可丢弃、可重建的公开只读投影，不持有 Admin 路由、主库或 mutation 凭据。
- 双端入口：Mac/iPhone 经私有 overlay、设备/策略准入与应用强认证访问同一 Admin origin；同机 loopback 不替代跨网收据。
- 公网边界：日常和应急均无公网 Admin listener、端口转发、UPnP、隐藏 URL 或公网隧道；break-glass 只恢复私有或受控本地/带外访问。
- MacBook 生命周期：供电、禁止睡眠、合盖/运输维护窗、冷启动、重启、系统更新、断电、设备丢失均有失败关闭和恢复出口。
- overlay 控制面故障：mutation 立即关闭；既有远程最小只读只接受签名 closed freshness 收据、可信 UTC `issuedAt≤now<expiresAt` 与 `0<duration≤5m`，任一 unknown 或到期关闭全部远程 Admin。
- 共用分支：root/本地管理员属于具名、最小化、可审计的可信运维边界；存在未受信任管理员即不合格。专用分支要求无日常个人工作负载和最小软件集。
- 备份与恢复：异机、加密、异物理故障域、hash/manifest、隔离恢复演练；同机/同桌外置盘、家庭路由器存储或 public-host 都不能单独满足备份。
- 生产门禁：仍只认一份不可变 `PRODUCTION-DEPLOYMENT-MANIFEST`/hash 的用户批准；本选择没有批准真实实施或部署。

## 4. 对抗审查与整改

| 审查 | 首轮 | 整改 | 聚焦复验 |
| --- | --- | --- | --- |
| 产品/范围 | P0=0/P1=1 | 从本地 `ADMIN-PROFILE-001`/`ADMIN-SEC-002` 移除专用/共用 deployment 轴，只保留在真实设备/部署门禁 | PASS，P0=0/P1=0 |
| 领域/架构 | P0=0/P1=3 | 闭合本地管理员信任边界；拆分 remote access 与 mutation 门；修正 deployment 轴；补 production R5/file family 与 readiness 机械证据 | PASS，P0=0/P1=0 |
| 安全/恢复 | P0=0/P1=2，聚焦后 P1=1 | 全时禁止公网 Admin 旁路；冻结 overlay freshness closed 收据、UTC 时间与五分钟硬上限；本地管理员信任边界失败关闭 | PASS，P0=0/P1=0 |

最终三路均为 `P0=0 / P1=0`。P2 建议已一并吸收，没有遗留 P2。

## 5. 已验证

- 任务 JSON 为本部门已 claim，impact 仅覆盖六份产品文档且 external effect 为 none。
- accepted successor、补充合同、矩阵、Spec、Spec 索引和 progress 的链接与现行时态一致。
- 已确认、未确认、已实施、未实施/未验证四类状态逐项分开。
- Mac/iPhone 外出访问链、供电/休眠/合盖/更新、宽带/CGNAT/overlay、设备丢失/共用、异机备份、RTO/RPO 和回退均有合同出口。
- `ADMIN-MACBOOK-DEDICATION` 只阻断真实设备配置与生产部署，不阻断另行获批的本地 synthetic profile/security 实施。
- 公开主机保持独立、只读和不可提升；生产 deployment manifest 未获用户批准。
- predecessor 两份 accepted 文档 SHA-256 与任务前收据一致。
- 三路独立只读对抗审查最终均为 P0=0/P1=0。
- `git diff --check`、目标文件存在性、关键语义扫描与任务 doctor 通过。

## 6. 未验证 / 阻断

唯一需要用户回答的本任务输入：

> 这台常开 MacBook 是否作为专用 Admin 主机，不承担日常个人工作？

其他运行事实继续未验证：精确 MacBook/OS/地点、专用或共用分支证据、供电/电池/UPS、休眠/合盖策略、overlay 产品与策略、运营商/CGNAT、跨网 Mac/iPhone、FileVault/R5、备份目标/地域/密钥/保留、恢复设备、真实 `RPO≤15m`/`RTO≤4h` 演练、public-host、DNS/TLS、监控、成本与完整 production manifest。它们不阻断本合同交付，只阻断真实设备实施或生产部署。

## 7. 错题自检

- 未把“常开”写成已验证设备事实；它是待实施的运维目标。
- 未把 MacBook 主机形态确认外推为专用设备答案、Admin 业务/视觉批准或生产部署批准。
- 未创建或操作设备、网络、端口、UPnP、DNS/TLS、overlay、密钥、备份服务、公开主机或外部资源。
- 未开放临时或长期公网 Admin；break-glass 只允许私有或受控本地/带外访问。
- 未把 overlay 当作应用认证替代品，也未在 freshness unknown 时保留远程读取。
- 未把 public-host 当主库、备份或恢复提升源；未新增第二写主、第二 Publication/Projection、第二 schema 或业务真值。
- 未原地修改 predecessor accepted ADR/实施合同；两份 SHA-256 保持不变。
- 未修改 `app/`、`data/`、`design/`，未执行外部 I/O、付费、外发或部署。

## 8. 任务状态

产品产出和独立审查已完成；按任务工具持久化为 `completed` 后，以 `TASK_STATE_OK` 回传统筹部。专用/共用答案与全部真实实施继续保持用户/生产门禁。
