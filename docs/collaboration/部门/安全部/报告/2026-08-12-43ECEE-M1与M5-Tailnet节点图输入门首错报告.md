---
type: audit_report
department: 安全部
target: "TASK-20260812-43ECEE / M1与M5本机Tailnet节点图可冻结输入门"
status: final
date: 2026-08-12
related_task: TASK-20260812-43ECEE
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
review_mode: local_and_existing_ssh_read_only_first_failure
tags: [tailscale, peer-map, M1, M5, iPhone, selector, first-failure, redaction]
summary: "FAIL；P0=0/P1=1/P2=0。M5本机只读peer map已脱敏解析，在该单侧快照内可区分当前M5、一个macOS peer与唯一iOS peer，且三者UserID/login hash一致。首次M1 SSH命令在本地zsh引号解析阶段报错，未建立SSH或执行远端CLI。依任务‘SSH/CLI首错即FAIL并停止’，未重试；缺少M1独立交叉视图，M5/iPhone selector不得冻结。"
---

# M1 与 M5 Tailnet 节点图输入门首错报告

## 1. 裁定

**FAIL；P0=0，P1=1，P2=0。**

本轮只完成 M5 本机单侧 peer map 的只读脱敏核对。首次 M1 SSH 命令在本地 shell 解析阶段以 `unmatched quote` 失败；该命令没有建立 SSH 会话，也没有在 M1 执行 Tailscale CLI。任务失败路径精确要求“SSH/CLI 首错即 FAIL 并停止”，因此本轮没有重试，也没有执行其他 CLI/SSH 查询。

由于缺少 M1 独立视图交叉验证，M5 与 iPhone 的精确 source selector 当前不得冻结，也不得进入 Grant、prepare 或 Serve 配置。

## 2. 敏感数据处理边界

- 本轮没有创建 scratch 证据文件。原始 login、IP、DNSName、node key、device/node ID 只在进程内解析，没有写入任何文件。
- 本报告只保留 SHA-256、数量、布尔状态和唯一性判断；不包含真实标识值。
- 本地命令输出只产生脱敏摘要；没有保留原始 `status --json`。

## 3. M5 本机已验证事实

### 3.1 状态与数量

| 字段 | 本轮只读结果 | 分类 |
|---|---|---|
| BackendState | `Stopped` | Known（快照时点） |
| MagicDNS suffix | present | Known |
| CertDomains | 0 | Known（本地快照） |
| self | 1 个 macOS、offline、tag=0 | Known |
| peers | 2 个 | Known |
| peer OS | macOS=1，iOS=1 | Known |
| users | 1 个 | Known |
| self + 2 peers 的 UserID hash | 三者相同 | Known |
| login hash 与 current-tailnet hash | 相同 | Known（只表示字节一致，不等同管理面认证） |
| peer tags | 两个 peer 均为 0 | Known（快照内） |
| ShareeNode | self 和两个 peer 均未出现 true | Discoverable（局部字段） |
| key-expiry 字段 | self 和两个 peer 均 present | Known（仅存在性） |

### 3.2 脱敏唯一性

- self ID hash：`938a0de7…053b4`。
- 唯一 macOS peer ID hash：`5db331e1…f14c4`。
- 唯一 iOS peer ID hash：`e97dfa6d…8a34`。
- 三个 ID hash 互不相同；三个 DNSName hash 互不相同；每个节点各有 2 个不同 IP hash。
- 在 **M5 这一份本地快照内**，iOS peer 按 OS 维度唯一，macOS peer 也唯一；它们与 self 的 user hash 一致。

上述唯一性只是快照属性，不能单独证明“当前批准的固定 M1”或“用户指定 iPhone”的现实所有权，也不能代替管理面 device approval 与 Grant 证据。

## 4. Known / Discoverable / Unknown 输入矩阵

| 输入 | 状态 | 冻结裁定 |
|---|---|---|
| M5 self 节点的脱敏身份与快照状态 | Known | 可用于后继交叉比对，不可单独作 Grant selector |
| 单侧快照中唯一 macOS peer 候选 | Discoverable | 未从 M1 视图复核，不冻结 |
| 单侧快照中唯一 iOS peer 候选 | Discoverable | 未从 M1 视图复核，不冻结 |
| 三节点同一 UserID/login hash | Known（局部快照） | 不证明管理面允许或 Serve 真实头值 |
| 精确 M5 source selector | Unknown | 不冻结 |
| 精确 iPhone source selector | Unknown | 不冻结 |
| M1 对等 peer map | NOT_RUN（首错后停止） | 无交叉证据 |
| device approval | Unknown | 必须由管理面读取 |
| Grants 及额外宽 Grant | Unknown | 必须由管理面读取 |
| policy canonical hash | Unknown | 必须由管理面读取/规范化 |
| HTTPS / CertDomains 管理面状态 | Unknown | M5 本地快照仅显示 0，不替代管理面 |
| shared node / 多用户全局边界 | Unknown | 局部 `ShareeNode` 未出现 true，无法证明全局不存在 |

## 5. P1-01：M1 交叉视图因首错未取得

首次 M1 SSH 调用的嵌套 heredoc 引号在本地 zsh 解析时不闭合，返回非零并显示 `unmatched quote`。由于 shell 在调用 `ssh` 前已拒绝命令，M1 端执行数为 0，远端读取/写入均为 0。

影响：无法用 M1 的 self/peer 视图验证 M5 候选与 iPhone 候选是否在双端一致唯一，也无法将任一 DNS/host alias/IP 候选写入受限 deployment 输入。

## 6. 最小 successor

下一任务只做一件事：重新执行 M5 + M1 双视图的只读节点图对齐。为避免嵌套 shell 引号，远端命令应使用最小单行 `status --json` 并将输出通过本地受限解析器脱敏，或把只读解析器作为经 SHA 固定的 stdin 脚本传入。验收仅需：

1. M1/M5 双视图对同三节点的 ID/DNS/IP/UserID hash 集合一致；
2. M5 与 iPhone 各存在一个、且只存在一个用户明确批准的 selector 候选；
3. 真实值仅短暂存放于 owner-only 0600、git-ignored 的任务专属 scratch，完成后可选择零保存；普通报告仍只留 hash/数量/唯一性。

即使双视图通过，device approval、Grants、policy canonical hash 和 HTTPS 管理面状态仍需后续管理面只读核对；它们不从 local peer map 推导。

## 7. 未验证 / NOT_RUN

- M1 `status --json` 与双视图集合一致性；
- 真实 M5/iPhone selector 值及用户对候选设备的现实确认；
- device approval、Grants、policy hash、CertDomains/HTTPS 管理面证据；
- Serve/Funnel、app-cap、prepare、key/sourceRef 生成、load 和任何网络配置。

## 8. 错题自检

- 没有重试首错，也没有用旧报告代替本轮 M1 实时只读证据。
- 没有把 M5 单侧快照内的 OS 唯一性扩大成设备所有权、device approval 或 Grant 唯一性。
- 没有在普通报告或磁盘上保留 login、IP、DNSName、node key 或 device/node ID 真值。
- 没有改动 Tailscale 管理面、Serve、Funnel、Grant、device、prepare、密钥、数据库或服务状态。

TASK_STATE_OK
