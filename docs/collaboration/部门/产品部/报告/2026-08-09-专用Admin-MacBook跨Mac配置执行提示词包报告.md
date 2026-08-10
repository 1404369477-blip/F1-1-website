---
title: 专用 Admin MacBook 跨 Mac 配置执行提示词包报告
type: product_handoff_report
status: final
decision: pass
date: 2026-08-09
department: 产品部
related_task: TASK-20260809-E915E4
implementation_authorized: false
production_deployment: unauthorized
external_calls: 0
---

# 专用 Admin MacBook 跨 Mac 配置执行提示词包报告

## 1. 结论

已形成 [F1+1 专用 Admin MacBook 配置执行交接提示词 v0.1](../../../../runbooks/F1+1-专用Admin-MacBook-配置执行交接提示词-v0.1.md)，作为 Codex/DeepSeek 跨 Mac 执行的单一文档入口。

提示词入口完成候选的 SHA-256 为 `aacdb684d70dce41c034247395329fde80e109eae390699726d5c7150c41c6be`（本报告完成后将再次机械复算）。

入口只固定提示词和后继用户门，没有执行真实配置。当前只有“只读预检与参数采集”可立即使用；逐阶段真实配置需等完整 production manifest/hash 和当阶段用户批准，独立验收/故障注入还需独立候选与单项故障授权。

## 2. 前置与输入身份

| 前置 | 任务状态 | 吸收结果 |
| --- | --- | --- |
| v0.2 产品整改 | `TASK-20260809-D6C29A` acknowledged | 绑定 v0.2 SHA-256 `c33ec34a656996812e0c301458b043938ce4245d792738f15536d7c12648d8e8` |
| v0.2 安全复验 | `TASK-20260809-ECEC1F` acknowledged，PASS / P0=0 / P1=0 / P2=1 | 继承 RPO/RTO、break-glass、public-host 全闭合语义；吸收恢复点 age 字段 P2 |
| 两机联动研究 | `TASK-20260809-CE1771` acknowledged | 选用唯一推荐“职责隔离三通道 + Admin server pull” |

提示词包内固定了 `AGENTS.md`、代理指南、Spec、v0.2 手册、双主机/专用 MacBook accepted ADR 及实施合同、安全 PASS 报告和研究报告的完整 SHA-256。目标 Agent 不得假设两台 Mac 绝对路径相同；任一文件为云端占位、冲突副本、缺失或 hash 不匹配都固定返回 `INPUT_IDENTITY_MISMATCH`。

## 3. 唯一路线与三组提示词

| 组 | 目标 | 允许动作 | 授权门 |
| --- | --- | --- | --- |
| `PROMPT-01` | 只读根定位、hash、合同读取和无敏感参数采集 | 只读文件/hash/本地无敏感事实；外部请求=0，写入=0 | 当前可使用 |
| `PROMPT-02` | 依次配置专用机、私有网络、本地目录、server-pull release、备份/RPO/RTO、public-host 与 break-glass | 只执行当前 STAGE 的精确已批准动作 | 完整不可变 manifest/hash + 精确候选 + 当阶段用户批准；不自动进下一阶段 |
| `PROMPT-03` | 独立安全验收、负例、故障注入和恢复 | 先只读计划；每次只执行一个精确已批准故障 | 独立会话/审查者 + 同一候选 hash + 每项故障注入单独用户批准 |

唯一路线已固定为：

- iCloud 只在工作 Mac/iPhone 侧放低风险、可重建协调文档；
- 私有 Git 传 commit/无密钥模板，独立 signer 生成不可变 signed release，Admin 在维护窗主动 fetch/verify/activate；
- 日常操作经 overlay 访问 Admin UI，维护按需使用传统 macOS OpenSSH，Screen Sharing 只作短时例外；
- 普通 Tailscale Standalone/App Store macOS 版本不能当 Tailscale SSH 服务端；
- 生产 SQLite、密钥、运行/服务目录和备份均不进 iCloud、Git 或工作 Mac。

## 4. 恢复点 age P2 的闭合

提示词已将恢复点时间收据固定为：

- `sourceStateCutCompletedAt` 是本次 Online Backup 捕获的源数据库状态 cut/snapshot 完成时间，禁止解释为最后一次业务写入时间；
- 每个点必须绑定 `sourceDbLogicalId`、`sourceDbIdentityHash`、`ledgerHighWaterMark`、`snapshotId`、`snapshotCompletedAt`、`snapshotBytesSha256`、`manifestSha256`、`remoteAuthenticatedReadbackCompletedAt`；
- 只有封闭 snapshot、签名/hash/manifest、异机持久化、远程认证回读和恢复验证全 PASS 的点才 eligible；
- `recoveryPointAgeSeconds = trusted_now - sourceStateCutCompletedAt`，对最新 eligible point 计算；空闲 DB 的新 snapshot 可以在 ledger high-water mark 不变时形成新 cut 时间；
- 时间、DB 身份、ledger 边界、snapshot 或远程回读无法证明时，继续 `RPO_BREACH`、`persistentWritesAllowed=0`。

## 5. 变更范围

本任务只新增：

- `docs/runbooks/F1+1-专用Admin-MacBook-配置执行交接提示词-v0.1.md`；
- 本产品报告。

未修改 accepted ADR、Spec、v0.1/v0.2 预配置手册、`app/`、`data/`、`design/` 或真实资源；未删除文件。本轮网络/外部请求、安装、登录、付费、密钥、上传和部署数均为 0。

## 6. 已验证

- 三组提示词均可独立复制，每组都含目标、路径定位、必读输入、固定 hash、允许/禁止动作、失败路径、证据和回传格式。
- 两台 Mac 绝对路径差异以项目根发现+相对路径解析处理。
- iCloud 占位、Waiting to Upload、未下载、冲突副本和 hash 失配均有失败关闭。
- 同步目录出现源代码、migration、部署脚本、`.git/`、运行/数据/备份/密钥目录时固定 `SYNC_SCOPE_VIOLATION`；只提供 doc-only 分离建议，不自行删除/移动用户文件。
- 若同步到的另一台 Mac 将成为 Admin Mac，它在规划期只能运行 PROMPT-01；退出个人 iCloud 与转入非同步输入属于另行授权的 `STAGE-1`。
- 同步目录、Git 和工作 Mac 的敏感信息与生产数据禁区已逐项列明。
- production manifest 可位于目标 Mac 的非同步受限位置；同步目录只保留 manifest ID/path hash 和内容 SHA-256，不放真实账号、IP、设备 ID 或凭据。
- 实施提示词每个 STAGE 都要求先输出精确目标/变更/风险/回退/证据和一个用户问题，完成后停止，不会自动续行。
- 独立验收提示词要求同一候选 hash、审查隔离和逐项故障授权，且 `NOT_AUTHORIZED/UNKNOWN` 不能冒充 PASS。

## 7. 未验证

- 目标 Mac 的项目路径、iCloud 同步状态、文件 hash 和 Codex/DeepSeek 工具能力；
- 精确 MacBook/macOS、账号、FileVault、网络、overlay、Git/signer、OpenSSH、密钥、SQLite、备份、public-host 和监控；
- production manifest、任何真实实施、外部连接、故障注入、RPO/RTO 或恢复收据。

以上全部保持 Unknown/closed。

## 8. 错题自检

- 没有把 iCloud 当服务、部署、数据库、备份、密钥或成功收据。
- 没有将个人 Apple Account/iCloud 变成专用 Admin Mac 的运行依赖。
- 没有让工作 Mac、Git、iCloud 或 public-host 持有主库、恢复点、生产密钥或成为第二 writer。
- 没有把普通 Tailscale macOS 客户端写成 Tailscale SSH 服务端。
- 没有把恢复点 age 实现为“自最后业务写入以来的时间”。
- 没有用一个批准问题概括全部阶段，也没有提供无确认的一键执行。
- 没有将提示词文档完成写成真实实施或生产 PASS。

TASK_STATE_OK
