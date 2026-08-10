---
title: Admin MacBook doc-only 协调包 v0.2 交付报告
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-F80FF1
status: final
decision: pass
implementation_state: planning_only
production_authorized: false
external_calls: 0
---

# Admin MacBook doc-only 协调包 v0.2 交付报告

## 1. 结论

`TASK-20260809-F80FF1` 的文档交付已完成：

1. 新增 v0.2 successor，将目标 Agent 的唯一入口固定为独立 `doc-only coordination bundle` 根；目标 Agent 不读取同步项目根、源码根或运行目录。
2. 新增 closed-set manifest 模板，固定 12 个 Markdown 文档、逐文件字节数与 SHA-256、读取顺序、六项 `Unknown/manifest` 门及机械拒绝规则。
3. v0.1 保持原字节与原 SHA-256：`aacdb684d70dce41c034247395329fde80e109eae390699726d5c7150c41c6be`。
4. 当前只形成文档与导出模板；未导出真实 bundle，未移动仓库，未配置设备，未执行安装、注册、付费、网络探针、上传或部署，`external_calls=0`。

## 2. 产出

| 产出 | 路径 | SHA-256 | 状态 |
|---|---|---|---|
| v0.2 successor / 三组提示词 | `docs/runbooks/F1+1-专用Admin-MacBook-配置执行交接提示词-v0.2.md` | `97b0dbdf452d7200d4165d8e1629b6424e8ffcdea0aba8237e46c764e428527e` | final / planning-only |
| doc-only bundle manifest 模板 | `docs/runbooks/F1+1-Admin-MacBook-doc-only-coordination-bundle-v0.2.manifest.json` | `c8471041b6134d76745f0d85ace6791d44e81ffb4d0f23e38a5cc326b90769b9` | template-not-exported |
| 本报告 | `docs/collaboration/部门/产品部/报告/2026-08-09-Admin-MacBook-doc-only协调包-v0.2交付报告.md` | 报告落盘后由任务工具校验 | final |

## 3. 独立 bundle 闭合集

manifest 的 `files[]` 只记录 bundle 内相对路径、角色、字节数与哈希，不携带项目根绝对路径。导出方使用下表做一次性只读复制；目标 Agent 不使用“导出来源”列，也不回查项目根。

| bundle 相对路径 | 固定导出来源 | 角色 |
|---|---|---|
| `prompts/execution-handoff-v0.2.md` | `docs/runbooks/F1+1-专用Admin-MacBook-配置执行交接提示词-v0.2.md` | prompt |
| `history/execution-handoff-v0.1.md` | `docs/runbooks/F1+1-专用Admin-MacBook-配置执行交接提示词-v0.1.md` | historical_prompt |
| `guides/agent-entry.md` | `AGENTS.md` | guide_export |
| `guides/agent-guide.md` | `docs/agent-guide.md` | guide_export |
| `contracts/product-spec.md` | `docs/spec.md` | contract_export |
| `contracts/admin-preconfiguration-v0.2.md` | `docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.2.md` | contract_export |
| `contracts/admin-dual-host-adr.md` | `docs/decisions/system/2026-08-09-F1+1-M5-Admin双主机拓扑-successor-accepted.md` | contract_export |
| `contracts/admin-dual-host-contract-v0.2.md` | `docs/spec/F1+1-M5-Admin双主机实施合同-v0.2.md` | contract_export |
| `contracts/admin-dedicated-macbook-adr.md` | `docs/decisions/system/2026-08-09-F1+1-M5-Admin专用MacBook部署边界-successor-accepted.md` | contract_export |
| `contracts/admin-dedicated-macbook-contract-v0.2.md` | `docs/spec/F1+1-M5-Admin专用MacBook补充实施合同-v0.2.md` | contract_export |
| `evidence/admin-preconfiguration-security-pass.md` | `docs/collaboration/部门/安全部/报告/2026-08-09-Admin-MacBook预配置手册-v0.2整改独立安全复验报告.md` | evidence_export |
| `evidence/dual-mac-three-channel-research.md` | `docs/collaboration/部门/研究部/报告/2026-08-09-两台MacBook配置期同网与运行期跨网联动方案.md` | evidence_export |

`bundle-manifest.json` 是根目录唯一 JSON 特例，不进入自己的 `files[]`，避免自哈希循环；最终 manifest SHA-256 必须走包外可信通道传给目标 Agent。导出时的实际文件集必须精确等于上述 12 个文档加根 manifest，共 13 个普通单链接文件。

## 4. 机械拒绝出口

v0.2 与 manifest 共同固定以下停止线：

- 拒绝 bundle 外路径、绝对路径、`..`、向上遍历、父/兄弟目录读取、项目根/源码根/运行根定位、远程 URL、下载或 `latest`/glob 发现。
- 拒绝缺项、多项、改字节、哈希不匹配、未知 schema/role、符号链接、硬链接、socket、device、FIFO 与额外挂载。
- 拒绝 `app`、`data`、`migration(s)`、`.git`、`src/source`、源码、构建产物、运行/服务目录、密钥与恢复材料、生产 DB/SQLite 文件族、备份载荷、恢复归档、未脱敏日志、真实账号/IP/设备标识。
- 任一输入缺失、额外、变化、不安全、Unknown 或未验证，统一 fail closed；不得通过扫描同步项目根补齐。

## 5. 六项 P1 收敛

| 门禁 | 当前状态 | production manifest 与运行证据出口 |
|---|---|---|
| `MANIFEST-P1-01-FILEVAULT-UNATTENDED-REBOOT` | Unknown | FileVault + 断电/重启组合证据；无人值守不可恢复即停止 |
| `MANIFEST-P1-02-ONSITE-UNLOCK` | Unknown | 现场责任人、SLA、授权与演练收据；缺任一项即停止 |
| `MANIFEST-P1-03-COLD-STANDBY` | Unknown | 异机冷备、解密托管、恢复点与 RTO/RPO 演练；不可联合证明即停止 |
| `MANIFEST-P1-04-OLD-PRIMARY-EPOCH-FENCE` | Unknown | 新旧主 epoch/writer=1/旧主负向写入证据；旧主仍可写即停止 |
| `MANIFEST-P1-05-SSH-INTERFACE-NEGATIVE` | Unknown | 普通 Tailscale macOS 不冒充 Tailscale SSH；传统 OpenSSH 若启用需 manifest、allowlist 与负例收据 |
| `MANIFEST-P1-06-GIT-SIGNER-PROVIDER-FAILURE-DOMAIN` | Unknown | Git、签名者、私有访问、备份供应方联合故障矩阵及至少一个独立恢复出口 |

六项只进入 manifest 停止线；本任务没有把其中任何一项写成已解决或已实施。

## 6. 已验证

- v0.1 当前 SHA-256 与任务固定值一致，未修改其正文。
- v0.2 只包含三段可复制提示词；每段均逐阶段单问确认并有固定回传字段。
- PROMPT-01 只认 bundle 相对路径与包外 manifest hash，不扫描项目根。
- PROMPT-02 固定私有 Git/签名 release、目标 Mac 非同步运行目录及 Admin server pull；当前仓库迁移明确留给未来用户批准的非破坏步骤。
- PROMPT-03 固定独立验收与恢复，不将连通成功外推为安全、RPO/RTO 或生产放行。
- manifest 可被 JSON 解析，12 个路径唯一、角色属于闭合集、读取顺序与文件集一一对应，六项门禁均存在。
- 12 个导出源当前字节数与 manifest 中的 SHA-256 已逐项复算一致。
- 两个新文档未出现 `/Users/...` 绝对路径；零外部调用，零真实配置。

## 7. 未验证

- 独立 doc-only bundle 尚未真实导出、同步或在目标 Mac 上读取；`status=template_not_exported`。
- 目标 Mac、iCloud 同步完成态、私有 Git、签名者、overlay、OpenSSH、FileVault、现场恢复、冷备、epoch fencing、供应商联合故障与 RPO/RTO 均未做真实验证。
- 当前项目仓库或未来 live runtime 是否处于非同步本地路径未验证；本任务没有移动或删除任何现有文件。
- 生产 manifest 尚不存在，生产部署仍未授权。

## 8. 错题自检

- 未把用户的文档编制授权外推为设备、网络、安装、上传或部署授权。
- 未要求目标 Agent 从 iCloud 同步项目根、源 Mac 绝对路径或整个仓库定位。
- 未把 `.git`、源码、构建、运行数据、密钥、生产 DB、备份或未脱敏日志纳入 bundle。
- 未原地修改 v0.1，也未修改 accepted ADR、app、data、design 或 migration。
- 未把六项 P1 的建议、Unknown 或未来门禁写成已确认事实。
- 未创建真实 bundle、真实账号、真实网络或真实设备资源。

## 9. 任务状态

本报告落盘后按任务协议执行 diff check、task doctor 与 complete。`TASK_STATE_OK` 只证明任务状态、产出路径和本地校验已持久化，不代表 bundle 已导出、目标 Mac 已配置或生产已放行。

