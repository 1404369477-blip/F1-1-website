---
type: system_adr
status: accepted
date: 2026-08-09
department: 产品部
decision_id: ADR-M5-ADMIN-DUAL-HOST-001
related_task: TASK-20260809-061961
input_tasks:
  - TASK-20260809-5708AA
  - TASK-20260809-1D7401
authorization_evidence: 用户2026-08-09明确选择A独立小型服务器；Mac与iPhone全功能、RTO≤4h、RPO≤15m已确认
authorization_state: user_confirmed
amends_if_implemented: ADR-M5-REVIEW-SYNTHETIC-001
decision_scope: Admin独立主机、公开只读主机、唯一写主、单向投影、双端等价与RTO/RPO
production_deployment: unauthorized
---

# ADR-M5-ADMIN-DUAL-HOST-001：Admin 独立主机与公开只读投影 successor（accepted）

## 1. accepted 结论

用户已选择 **A：独立小型 Admin 服务器**。后继 Admin 生产拓扑固定为两个物理与信任边界分离的主机：

1. `admin-host`：承载 Admin 应用、处理链与唯一可写 SQLite 主库；
2. `public-host`：只承载公开站与可重建的最小只读投影；
3. Mac 和 iPhone 都通过私有客户端访问同一 Admin 能力集，两端的功能、权限和恢复出口等价；
4. 任意时刻只有一个写主，公开主机不持有主库、Admin mutation 或备份解密权限；
5. 恢复目标固定为 `RTO ≤ 4h`、`RPO ≤ 15m`。

本 ADR 只接受上述窄范围拓扑与运行不变量。它不批准任何真实主机、供应商、账号、地域、域名、证书、私网产品、存储、密钥、监控、备份介质、付费或部署。

## 2. 和既有 Admin 合同的关系

- `ADR-M5-REVIEW-SYNTHETIC-001` 当前仍是 draft；本 ADR 不替它回答 `ADMIN-DECISION`，不接受其业务实施范围。
- Admin 视觉候选仍受 `ADMIN-VISUAL` 独立用户门禁约束。
- 已有 Content→Summary→ReleaseBundle→ReviewDecision→唯一 Publication→PublishedProjection 领域链、人工批准与显式手动发布语义保持不变。
- 本地 app 当前仍只允许 loopback local-dev；拓扑 accepted 不等于 Admin 业务已实现、视觉已确认或生产已放行。

本决定不修改旧 accepted ADR 正文字节。后续冲突仅由新 successor 显式修订，不原地重写历史。

## 3. 双主机唯一数据真值

```text
Mac / iPhone
  → 私有策略执行点
  → admin-host / Admin API
  → 唯一可写 SQLite 主库
  → PublishedProjection 领域事实
  → 签名不可变投影包
  → public-host 投影接收器
  → 原子激活的只读公开副本
  → 公开站 GET
```

业务真值只在 `admin-host` 的主库。`public-host` 上的文件或只读库是可丢弃的分发副本，其中不保留未公开对象、审核备注、用户/设备/会话、主库路径、凭据或内部日志。公开副本不反向同步，不用于修复主库，不能提升为写主。

## 4. 最小跨主机接口决策

选择 **Admin 主动 push 不可变投影包**。公开主机不拉取 Admin 数据，也不查询 Admin API/主库。中立对象存储、队列或云传输产品暂不选型。

跨主机语义仅包含两个内部能力：

```text
PUT /internal/projections/{deliveryId}
GET /internal/projection-receipts/{deliveryId}
```

- `PUT` 只能写入 staging；签名、hash、schema、generation、previous hash、数量/大小与公开字段 allowlist 全部通过后才能原子激活。
- `GET` 只返回某个 delivery 的最小收据；不返回 Admin 对象、主库查询结果或 mutation 能力。
- 同 `deliveryId + snapshotManifestHash` 重投返回同一收据；同 `deliveryId` 不同 hash 拒绝。响应丢失时只查同一 delivery，不生成第二 Publication、publicId 或投影。
- 传输实现必须使用相互认证的私有通道，公开 Web 进程不获得接收器写权限。

本接口复用现有 `snapshot_sync` Outbox/TaskEnvelope、SnapshotReconciliation 和 AuditEvent 的 internal contract，不新增领域实体。`deliveryId` 逐字等于该 OutboxJob 的 `operation_id`，不再引入第二操作标识。详细 closed DTO、顺序、reason code 与本地模拟出口由同日实施合同固定。

## 5. 发布与投影激活的原子边界

snapshot_sync 严格串行：任意时刻最多一个 `pending|leased|retryable_failed|reconcile_wait` intent。Admin 主库中的人工发布事务提交唯一 Publication 与 PublishedProjection；没有未结算 intent 时，同一 Admin DB 事务还必须写入唯一 `snapshot_sync` Outbox intent。已有未结算 intent 时，新 PublishedProjection 作为唯一业务真值持久化；启动前、每次 publish commit 后和每次 snapshot intent 结算后的幂等扫描器比较“当前 PublishedProjection 全集 root”与“最后 confirmed active full snapshot root”，差异时在前任务结算后创建下一个 intent。这个比较来自主库事实和已结算收据，不新增 dirty 实体。崩溃重启后必须在 Admin ready 前执行同一扫描，因此不会遗失后继分发。

新 snapshot 的 generation/previous hash 只以以下一个受控父状态为准：非空 receiver 取当前 confirmed active；首次空 receiver 取 `generation=0,hash=null` sentinel；重建空 receiver 可重放 Admin 持有的最后成功签名 full snapshot，或以 Admin 最后已结算 active 收据为父节点生成下一 full snapshot，两种均须用精确 bootstrap pin。已 terminal 的 intent 不是父节点。

包外可恢复故障（身份/请求通道、signing key 未激活、存储/激活、emergency stop）不固化为接收端 rejected receipt；修复后沿既有 `retryable_failed→leased` 或 `dead_letter→pending` 人工 requeue 复用同 intent/key/package。只有包字节/代际的永久错误持久 rejected；它们须修订 manifest core 或重基于 receiver active，得到新 hash/key 后创建 replacement。旧 terminal intent 保留审计。不可变全量快照候选先在内容寻址路径落盘/fsync，再在主库事务内重验 root/收据并绑定 intent。跨主机网络调用始终在事务外。

Admin 页面必须分开显示：

- `业务发布已提交`：Publication/PublishedProjection 已在主库确认；
- `公开分发 pending | active | retryable_failed | unknown | terminal_failed`：仅为 internal delivery receipt 映射；
- 只有收到 `active|superseded` 成功收据时才确认该 delivery 已分发；当前公开链接仅在最新 full snapshot `active` 时可用。其余状态保留业务发布事实并提供同 delivery 查询/有界重试。

Publication 的 `reconcile_wait` 仍只服务已有 Publication 的业务提交未知结果。跨主机投影未知结果只修订 internal `outbox_job`：`operation_type=snapshot_sync` 的 `leased→reconcile_wait`；同 `deliveryId/reconcile_key` 查询确认 active 时 `reconcile_wait→succeeded`，确认未提交且 attempt 有预算、five fences/stop 当前时 `reconcile_wait→retryable_failed`，确认终态失败时 `reconcile_wait→dead_letter`。这是本 successor 对既有机器合同的唯一状态迁移增量，不改 Publication，不增加状态或实体。SnapshotReconciliation 仍只记录 partial/empty/stale 时保留 last-known-good 的既有失败语义。

## 6. Mac / iPhone 全功能等价

Mac 与 iPhone 分别登记、分别撤销设备信任，通过私有策略执行点访问同一 HTTPS Admin origin、同一角色与同一 API 集。队列、详情、修订、批准、拒绝、显式手动发布、operation 对账与故障恢复全部同等可达。

iPhone 可以使用单列响应式布局，高风险 mutation 增加新鲜 passkey、前台显式确认和更严限流。这些控制不删除功能、不降级为只读。私有网络只提供可达性；服务端仍必须验证用户、设备、passkey、会话、精确 Origin、一次性 CSRF、CAS/幂等与审计。

## 7. RPO、RTO 与标准冗余

- 备份尝试基准间隔 `≤5m`；最近一个已完成一致性校验并异故障域持久化的恢复点年龄必须 `≤15m`。
- 达到 10m 预警；达到 15m 记为 RPO breach，关闭新的高风险 mutation，公开 last-known-good 只读可继续。
- 备份使用 SQLite 在线一致快照或经独立验证的等价方式；禁止分别复制活动 `db/-wal/-shm`。备份必须加密，密文与解密材料分域。
- 标准冗余固定为：可重建 public-host + 至少一个已验证的异故障域恢复点 + 可重建的 Admin 冷备环境/配置。不引入 SQLite 双写、数据库主主或公开主机代行写入。
- 故障后顺序为：fence 旧主→选择 `≤15m` 恢复点→恢复为只读→完整性、双端认证、无公网监听验证→明确提升唯一写主→synthetic mutation→重建并原子激活公开投影。
- 完整恢复链从事故宣告到公开投影恢复必须 `≤4h`。任一步失败时 Admin mutation 保持关闭。

备份保留周期属于生产部署 manifest 参数。本地 synthetic 验收只固定“当前恢复点 + 至少一个已演练 last-known-good”，不借此选择生产保留期。

## 8. 生产部署唯一门禁

生产实施前必须生成一份不可变 `PRODUCTION-DEPLOYMENT-MANIFEST`，计算 SHA-256，由用户对完整 manifest 做一次批准/拒绝。manifest 至少固定：

- 两台主机供应商/形态、地域/故障域、主体和费用上限；
- 公开/Admin 域名与证书、私有客户端/策略点、冷备通道与 break-glass 操作人；
- 投影 push 的具体传输/认证实现、签名密钥与轮换；
- 备份介质、加密/KMS、故障域、保留/删除周期；
- 容量、监控/告警、审计去向、补丁、运营 Owner、恢复演练与回退点；
- 中国大陆 Mac/iPhone 与主要网络环境的实测结果。

未有该 manifest 及其用户批准收据时，`PRODUCTION` 为 `user-gated`：零真实主机、零部署、零网络/域名/证书变更、零付费。

## 9. 拒绝的替代方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 公开站与 Admin 同主机 | 拒绝 | 用户已选独立主机；公开面失陷会放大横向风险 |
| public-host 主动拉取 Admin | 拒绝 | 为公开面增加指向 Admin 的可达性与凭据 |
| 两主机共享/双写 SQLite | 拒绝 | 引入多写者、网络文件系统和分区一致性风险 |
| 公开投影当恢复源 | 拒绝 | 公开副本不完整，且可能处在受攻击故障域 |
| 为追赶 RTO 临时开启公网 Admin | 拒绝 | 违反私有入口和应用强认证硬门 |

## 10. accepted 不等于运行通过

当前可宣称：拓扑、数据方向、双端能力等价、恢复目标和最小跨主机语义已 accepted。不可宣称：Admin 业务已 accepted/实现、视觉已确认、备份/RPO/RTO 已运行验证、主机已创建或生产已放行。

实施出口只认 [F1+1 M5 Admin 双主机实施合同 v0.2](../../spec/F1+1-M5-Admin双主机实施合同-v0.2.md)和对应的独立开发/数据/测试/安全收据。
