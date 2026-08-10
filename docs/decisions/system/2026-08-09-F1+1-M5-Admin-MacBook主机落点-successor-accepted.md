---
type: system_adr
status: accepted
date: 2026-08-09
decision_id: ADR-M5-ADMIN-MACBOOK-HOST-001
task_id: TASK-20260809-2F423C
department: 产品部
amends: ADR-M5-ADMIN-DUAL-HOST-001
authorization_state: user_confirmed
authorization_evidence: 用户于当前会话确认家中或办公室常开的 MacBook 作为独立 Admin 主机
implementation_state: not_implemented
production_deployment: unauthorized
predecessor_bytes_unchanged: true
---

# ADR-M5-ADMIN-MACBOOK-HOST-001：Admin MacBook 主机落点 successor

## 1. 决策

在 [ADR-M5-ADMIN-DUAL-HOST-001](2026-08-09-F1+1-M5-Admin双主机拓扑-successor-accepted.md) 的窄范围内，`admin-host` 的物理落点固定为用户控制、位于家中或办公室、以常开为运维目标的 MacBook。`public-host` 继续是独立主机，只承载可重建的公开只读投影；它不持有 Admin 路由、可写主库或 Admin mutation 凭据。

本决策只接受主机形态与相应实施约束。未执行或批准真实 MacBook 配置、私有网络、端口、DNS/TLS、密钥、备份服务、公开主机、部署、付费或外发。

## 2. 状态边界

| 项目 | 当前状态 | 说明 |
| --- | --- | --- |
| 独立 Admin 主机 + 独立 public-host | 已确认 | 继承 predecessor；唯一写主和公开只读投影不变 |
| Admin 主机形态 | 已确认 | 家中或办公室的用户控制 MacBook |
| Mac/iPhone 日常入口 | 已确认合同方向 | 两端经私有 overlay 客户端访问同一 Admin origin，功能与权限等价 |
| MacBook 常开、供电、休眠、更新策略 | 已确认合同要求 | 尚无设备配置或运行收据 |
| MacBook 专用或共用 | **未确认；本 successor 唯一未决输入** | 部署前必须由用户回答，不能从“常开”推断 |
| 具体设备、地点、overlay 产品、运营商/CGNAT、域名/TLS、备份介质、密钥 | 未确认 | 只能由后继不可变 deployment manifest 固定 |
| 本地实现、实机验证、跨网验证、RTO/RPO 演练 | 未实施/未验证 | 文档 accepted 不等于运行通过 |
| 生产部署 | 未授权 | 继续只认 predecessor 的单一 `PRODUCTION-DEPLOYMENT-MANIFEST` 用户门禁 |

## 3. 唯一访问链

外出访问的日常链固定为：

```text
Mac 或 iPhone
  -> 设备健康且已登录的私有 overlay 客户端
  -> 私有策略/设备准入
  -> Admin MacBook 的私有 Admin origin
  -> 用户+设备+passkey/session+Origin+一次性 CSRF+CAS/五 fence
  -> 唯一可写 Admin SQLite
```

- 两端都在线且健康、私有策略与应用认证全部通过时才可访问；任一环节不能证明即失败关闭。
- overlay 只提供私有可达性，不能替代应用身份、授权、会话、审计、CAS 或 fence。
- 同机浏览器可使用 loopback；这条路径不能充当 Mac/iPhone 跨网收据。
- 家庭/办公室网络处于 CGNAT 时，只有所选 overlay 能以出站连接建立私有链且通过实测，才可视为可达。不得为绕过 CGNAT 开端口转发、UPnP、隐藏 URL、公网 Admin 或公网隧道。
- 公网 Admin 入口在日常和应急均保持不存在。break-glass 只恢复私有 overlay 或受控本地/带外访问，并继续满足 predecessor 的硬门和追加式审计。

## 4. MacBook 运行约束

1. **供电**：服务期连接可靠电源；电池只提供短时缓冲，不计作异机备份或已证明的 RPO/RTO 冗余。断电或供电状态不能证明时，Admin 进入不可用/恢复态，public-host 继续 last-known-good。
2. **休眠与合盖**：服务期禁止系统睡眠。合盖、运输、计划睡眠或人工关机先进入维护窗，阻断新高风险 mutation，完成 `≤15m` 可证明恢复点后再停止；恢复时重新走完整启动门禁。
3. **启动与重启**：冷启动、意外重启或唤醒后先保持 mutation 关闭。只有可信时钟、FileVault/磁盘、应用与配置 hash、overlay、私有监听、唯一写主、备份时龄和 synthetic 自检全部通过才开放。
4. **系统更新**：只在受控维护窗执行。更新前形成并回读 `≤15m` 的加密异机恢复点；更新后重启并完成同一启动门禁。失败时恢复最后可机械证明的 app/config/database 组合，禁止降级到静态 Demo 或第二写主。
5. **丢失或失陷**：立即 fence 旧主，撤销 overlay 设备身份、会话/passkey、服务凭据与相关密钥，按凭据可能泄露处理；使用干净的同类或替代 MacBook 从异机恢复点重建。旧主不可机械证明失去写能力前，候选主不得提升。

## 5. 网络、overlay 与公开主机故障

| 故障 | 立即状态 | 恢复出口 |
| --- | --- | --- |
| 家庭/办公室宽带中断 | Admin 远程入口不可用；不开放公网替代 | 网络恢复后重验两端连接、设备健康、私有策略与应用认证 |
| CGNAT/地址变化 | 保持私有出站链；不能证明可达则关闭 Admin | 所选 overlay 在真实网络上通过收据后恢复；不配置端口映射 |
| overlay 控制面或策略不可用 | 新登录、提权和 mutation 关闭；远程只读仅在补充实施合同的可信 UTC 时间不变量、签名 freshness 收据和 `offlinePolicyTTL≤5m` 全部有效时继续 | TTL 到期、未来签发/时钟回拨或任一 freshness 输入 unknown 时关闭全部远程 Admin；控制面恢复后重新认证；必要时只走私有或受控本地/带外 break-glass |
| Admin MacBook 失效 | Admin mutation=0，fence、撤权、进入四小时恢复 | 异机恢复、只读验证、唯一写主提升、Mac/iPhone 与投影回验 |
| public-host 失效 | Admin 主库继续；公开 last-known-good 不可用或隔离 | 从 Admin 已签名全量投影重建；public-host 不反向修复主库 |

## 6. 专用与共用设备的唯一分支

用户回答“专用”时，deployment manifest 必须证明：不承载日常个人工作负载、最小软件集、独立服务身份、物理访问控制、补丁与维护责任明确。

用户回答“共用”时，deployment manifest 必须额外证明：独立 OS 服务账号与数据目录、FileVault、个人进程无法读取数据库/备份/签名材料、个人 shell/keychain 不保存服务 secret、普通登录用户不能绕过应用认证、个人更新/重启与 Admin 维护窗协调、退出个人会话不影响服务且服务异常时失败关闭。macOS root/本地管理员属于能够控制进程、数据库和运行秘密的可信运维边界；全部此类账号必须具名、最小化并纳入审计。存在未受信任的本地管理员时，共用分支不合格并保持部署关闭。

两条分支都保持一个写主、相同 RTO/RPO、相同应用认证和同一生产门禁。共用设备分支无法证明隔离时，生产部署保持关闭。

## 7. 备份与恢复边界

- `RPO≤15m`、`RTO≤4h`、加密异机保存、hash/manifest、异故障域和隔离恢复演练全部继承 predecessor。
- 唯一合格的日常备份必须离开该 MacBook 且处于不同物理故障域。MacBook 内置盘、同机外接盘、同桌长期连接盘、同一家庭路由器存储或 public-host 单独承担备份，都不能作为唯一异机恢复点。
- 备份目标、地域、保留、加密密钥托管、恢复用替代设备和成本仍未选择。不能证明时钟或 `backupAge≤15m` 时，按 RPO breach 关闭高风险 mutation。
- public-host 是可丢弃只读副本，不充当 Admin 主库备份或提升源。

## 8. 唯一未决问题

> 这台常开 MacBook 是否作为专用 Admin 主机，不承担日常个人工作？

回答“是”进入专用设备实施分支；回答“否”进入共用设备隔离分支。该回答只选择部署前的设备隔离合同，仍不批准购买、设备配置、网络、端口、密钥、真实备份或生产部署。

## 9. 继承、回退与禁止项

- predecessor 的唯一写主、公开只读投影、Mac/iPhone 等价、单向 push、幂等、RTO/RPO、break-glass 和单一生产门禁全部继续有效。
- 本 successor 不改领域实体、状态机、SQLite schema、API DTO 或 app；旧 accepted ADR 与实施合同保持字节不变。
- 本 successor 若无法实施，只撤销 MacBook 落点候选并回到“独立 Admin 主机形态待定”；不得回退到同机公开/Admin、双写、公网 Admin、端口映射或公开隧道。
