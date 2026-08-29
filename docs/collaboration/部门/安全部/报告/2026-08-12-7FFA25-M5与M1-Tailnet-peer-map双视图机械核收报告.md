---
type: audit_report
department: 安全部
target: "TASK-20260812-7FFA25 / M5与M1 Tailnet peer-map双视图"
status: final
date: 2026-08-12
related_task: TASK-20260812-7FFA25
decision: pass
severity_count: { P0: 0, P1: 0, P2: 2 }
review_mode: dual_view_read_only_mechanical_reconciliation
tags: [tailscale, peer-map, M1, M5, iPhone, selector-candidate, restricted-evidence]
summary: "PASS；P0=0/P1=0/P2=2。M5本机与M1 SSH的status双视图均含同一组3个节点，node ID、key、host、DNS、IP、OS、UserID、tag/sharee线索与key-expiry存在性的脱敏集合一致。M5本机self与唯一iOS peer可冻结为后续管理面交叉核验的selector候选身份束，尚不构成已批准Grant selector。精确值仅留在git-ignored、owner-only受限scratch。"
---

# M5 与 M1 Tailnet peer-map 双视图机械核收报告

## 1. 裁定

**PASS；P0=0，P1=0，P2=2。**

M5 本机和固定 M1 的 Tailscale `status --json` 双视图已在同一窄窗口只读取得。M1 只执行一条最小远端 status 命令，原始 JSON 立即写入任务专属 owner-only scratch，后续只在本地做脱敏集合对比。

两端都观测到同一组 3 个节点，静态身份集合完全一致：

- M1：在 M1 视图中是 self，在 M5 视图中是 macOS peer；
- M5：在 M5 视图中是 self，在 M1 视图中是 macOS peer；
- iPhone 候选：两端视图中都是唯一 iOS peer。

因此，**M5 self 和唯一 iOS peer 可冻结为“后续管理面交叉核验输入”的 selector 候选身份束**。这一裁定不授予 Grant，也不证明 device approval、政策中可用 selector 语法或设备现实所有权。

## 2. 受限证据

| 证据 | 权限与 Git 边界 | SHA-256 |
|---|---|---|
| `scratch/TASK-20260812-7FFA25/m5-status.json` | owner UID501，mode0600，父目录0700，`.gitignore` 命中 | `c9bd169bc88dec4041c490017436e5cc143fb3943bd20ff81a480448e5d1b6e2` |
| `scratch/TASK-20260812-7FFA25/m1-status.json` | owner UID501，mode0600，父目录0700，`.gitignore` 命中 | `c0f860f728cb3c3c76fe05be1938c901b329ff6215381d8914aed6316afad85c` |

上述两文件含精确节点值，仅用于后续管理面交叉核验。普通报告与任务 JSON 不包含 login、IP、DNSName、node key、device/node ID 原值。

## 3. 双视图机械对比

### 3.1 集合结果

| 检查项 | M5 视图 | M1 视图 | 裁定 |
|---|---:|---:|---|
| BackendState | Stopped | Running | 动态状态差异，不影响静态身份集 |
| 节点数 | 3 | 3 | PASS |
| 共同 node ID hash | 3 | 3 | PASS |
| 单侧多出节点 | 0 | 0 | PASS |
| OS 分布 | macOS=2，iOS=1 | macOS=2，iOS=1 | PASS |
| UserID hash 种类 | 1 | 1 | PASS |
| user/login hash map | 同一组 | 同一组 | PASS |
| tailnet hash | 同一 | 同一 | PASS |
| tagged node 数 | 0 | 0 | PASS（局部线索） |
| `ShareeNode=true` 数 | 0 | 0 | PASS（局部线索） |

### 3.2 静态身份一致性

对每一个共同 node ID，两端的以下字段均一致：

- public/node key hash；
- HostName hash；
- DNSName hash；
- Tailscale IP hash 集合；
- OS；
- UserID hash；
- tag hash 集合；
- `ShareeNode` 线索；
- key-expiry 字段存在性。

唯一字段差异是 M1 节点的 `Online`：M1 运行视图为 true，M5 backend 已停止的本地视图为 false。该差异属于快照时效与本地 backend 状态，没有形成 node/DNS/IP/UserID 身份漂移。M1 当前视图中 M5 和 iPhone 候选的 `Online` 均为 false。

## 4. Selector 候选冻结边界

### 可冻结为后续交叉核验输入

1. **M5 候选**：以 M5 本地 self 身份束为唯一候选；该身份束在 M1 视图中有且只有一个完全匹配节点。
2. **iPhone 候选**：以双视图唯一 iOS peer 身份束为唯一候选；两端的 node/DNS/IP/UserID/key 脱敏束全部一致。
3. 两个候选的精确值仅从上述受限证据读取；后续任务不得从报告中的 hash 反向猜测。

### 尚不可冻结为生产 Grant selector

- 用户尚未在本任务中对唯一 iOS peer 完成现实设备确认；
- local peer map 不提供 device approval 管理面权威证据；
- local peer map 不提供现行 Grants、额外宽 Grant 或 policy canonical hash；
- 将 DNSName、host alias 或 IP 中的哪一种精确字节形式用作当前 policy source selector，须由后续管理面/政策语法核验确认。

## 5. Known / Discoverable / Unknown

| 输入 | 状态 | 结论 |
|---|---|---|
| M1/M5 双视图节点集 | Known | 3/3 一致 |
| M5 self 身份束 | Known | 可作后续交叉核验候选 |
| 唯一 iOS peer 身份束 | Known | 可作后续 iPhone 交叉核验候选 |
| 三节点同一 user/login hash | Known | 双视图一致 |
| M5/iPhone 真实 selector 字节候选 | Discoverable | 仅存于受限 scratch；等管理面核验 |
| device approval | Unknown | 不从 peer map 推导 |
| Grants / policy canonical hash | Unknown | 不从 peer map 推导 |
| 全局 shared-node / 多用户边界 | Unknown | 双视图只有局部线索 |
| 用户对 iOS peer 的现实设备确认 | Unknown | 后继用户/管理面门 |

## 6. Finding

### P0 / P1

无。双视图没有节点集或静态身份漂移，也没有 tag/shared 阻断线索。

### P2-01：M5 与 iPhone 候选当前离线

M1 运行视图对这两个候选均显示 `Online=false`。这不阻断身份候选束的静态冻结，会阻断真实可达、Serve header 和 Passkey 验收。任何管理面或部署操作前需再读当时状态。

### P2-02：peer map 不是管理面授权权威

device approval、Grants、额外宽 Grant、policy canonical hash、全局 shared-node 边界仍为 Unknown。后续只读管理面核验必须将结果与本轮受限候选束精确交叉。

## 7. 最小下一动作

以本轮受限候选束为输入，开一个管理面零写只读核验：

1. 由用户确认唯一 iOS peer 就是拟批准 iPhone；
2. 管理面核对 M5/iPhone device approval、所有者、shared 状态和精确 selector 字节；
3. 回读 Grants，排除额外宽 Grant，并形成 policy canonical hash；
4. 任一精确身份值与本轮受限候选束不一致时停止。

本报告不放行 Grant/Serve/device 修改、sourceRef 生成、prepare 或 load。

## 8. 错题自检

- 仅执行任务允许的两端 status 只读取证与一次本地脱敏机械对比；未扩展到管理面、Serve、Funnel、Grant 或 device。
- 没有把 M5 backend `Stopped` 误写为在线，也没有用 M5 的过时 online 视图覆盖 M1 运行视图。
- 没有把双视图身份一致扩大成 device approval、Grant 或政策通过。
- 精确标识只存于 mode0600、git-ignored 的任务 scratch；普通报告仅保留 hash、数量和唯一性。
- 未修改 Tailscale、网络、服务、密钥、数据库或任何项目产物。

TASK_STATE_OK
