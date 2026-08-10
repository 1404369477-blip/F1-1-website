---
title: 固定 M1 Mac TEMP-LOCAL 精确执行包 v0.5 报告
type: product_final_report
status: final
decision: pass_documentation_gate
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-9ACCE0
execution_state: blocked_waiting_for_47ef67_pass_ack
production_authorized: false
external_side_effects: 0
---

# TASK-20260809-9ACCE0｜固定 M1 Mac TEMP-LOCAL 精确执行包 v0.5 报告

## 1. 结论

文档交付门 PASS。v0.5 已将用户的“当前 Wi-Fi 先本机跑起来”收敛为一次固定 MacBook Air M1 的 `TEMP-LOCAL` 预览，并固定候选身份、只读计划、单一用户确认、0700 不同步临时根、复制闭集、Node24/lock、127.0.0.1:3000/3001、synthetic/local SQLite、健康门、停止门与脱敏 closed receipt。

运行门当前不通过。`TASK-20260809-47EF67` 在本报告收口时仍为 `claimed`，未有 PASS/ACK 收据。v0.5 的现行激活态因此是 `WAIT_47EF67`：目标 Mac Agent 最多可以只读生成计划，当前不得复制、启动、监听或打开页面。当 47EF67 结论为 FAIL/BLOCKED，或任一候选 hash 漂移时，v0.5 必须回传 `BLOCKED_47EF67`/`CANDIDATE_IDENTITY_MISMATCH` 并失败关闭。

本任务没有执行候选、没有创建临时根、没有启动 Node/App/浏览器，也没有读取或修改设备、网络、账号、密钥、真实数据和生产资源。

## 2. 产出与固定收据

| 产出 | 路径 | bytes | SHA-256 |
|---|---|---:|---|
| v0.5 精确执行 runbook | [runbook v0.5](../../../../runbooks/F1+1-固定M1-Mac-TEMP-LOCAL精确执行runbook-v0.5.md) | 16244 | `f5b6d5108339f7d57fe35efba6c6b36a52ace1846953cf687303af39794114c0` |
| v0.5 closed manifest | [manifest v0.5](../../../../runbooks/F1+1-固定M1-Mac-TEMP-LOCAL精确执行runbook-v0.5.manifest.json) | 14015 | `76faa7cbb2270edc00d5322d1646a97006a21710377a04bab60969fab4839614` |
| 固定 Mac 执行交接提示词 | [Codex/DeepSeek 提示词 v0.5](../../../../runbooks/F1+1-固定M1-Mac-TEMP-LOCAL执行交接提示词-v0.5.md) | 6640 | `0d565b5edb5a787036838931108180f9f7c2978e8fd7e8fd59fc6f045ac91088` |
| 产品 final 报告 | 本文 | 任务完成时外部绑定 | 任务 artifact ledger 绑定最终字节 |

manifest 不自包含自身 hash，避免循环自引用。runbook 和提示词由 manifest 逐字节绑定；manifest 和本报告的最终 hash 由任务 JSON `artifacts` 外部绑定。

predecessor v0.4 经只读复算仍为：

```text
sha256=68f7622b41888e573de79f5537893c23983c691bbbc6ae73452b4fe1155e74db
```

## 3. 已确认、建议和 Unknown

### 3.1 用户已确认

- 固定设备脱敏事实：MacBook Air（M1，2020）、8GB、macOS 26.5.1、可长期接电、Wi-Fi only。
- 当前 Wi-Fi 只记录为 `legacy_wpa_low_security`。
- 当前授权上限为一次 TEMP-LOCAL 本机预览；后续再配置独立/安全网络。

### 3.2 产品建议（已写入合同）

- 目标 Agent 先只读解析路径、候选和运行门，对外仅使用路径/账号别名。
- 47EF67 completed+PASS+ACK、候选全量 hash 精确命中、端口空闲和闭集完整后，只问一次执行确认。
- 临时根默认保留为 0700；清理另行精确授权，避免宽泛删除。

### 3.3 Unknown / 尚未验证

- 47EF67 最终结论、统筹 ACK、App 进程级 no-egress wrapper 与收据算法。
- 固定 M1 Mac 上的 iCloud 来源实路径、当前闭集字节、Node24、node_modules、build 和 DB。
- 临时根创建、复制后 hash、实际 loopback 启动、健康、同机浏览、`externalCalls=0` 和停止零残留。
- 任何网络、远程、SSH/FileVault、RPO/RTO 或生产能力。

## 4. 已验证

1. v0.4 SHA-256 复算精确匹配 ACK 收据，原文件未修改。
2. v0.5 候选五个主 hash 与 47EF67/F67080/8B5FF9 已落盘身份收据一致。
3. 11 源码按冻结顺序复算的标准输出 SHA-256 为 `7b1e8977c3e7296f4e5cf165b106bc322c2ef19dbd5e506f51e2c4ec92465281`。
4. 当前工作区只读复算了 Node binary、package/lock、DB、build 收据，以及 `.next`、`node_modules` 普通文件闭集和 `src/server` 三个树根。
5. manifest 可由 JSON 解析；`files` 中 runbook/提示词 bytes 与 SHA-256 与实文一致；候选列表、环境变量、reason code、receipt 顶层字段和权限布尔值均为闭集。
6. 执行提示词固定三段流程：只读预检、单一用户确认、获批后一次执行；47EF67 门未过时只能回传阻断。
7. 当前文档不包含截图中的地址、SSID、MAC、IP、序列号、账号、密钥或设备唯一标识。
8. 本任务没有联网、没有执行候选、没有安装依赖、没有启动端口、没有修改 app/data/design/spec/accepted ADR/v0.4。

## 5. 授权与能力边界

| 能力 | 现行态 |
|---|---|
| v0.5 文档/闭集/交接提示词 | 已形成 |
| 目标 Mac 只读生成计划 | 用户已授权；须遵守脱敏与闭集 |
| TEMP-LOCAL 复制/运行 | 用户授权上限已确认；当前受 47EF67 PASS/ACK 与目标 Mac 单一确认门阻断 |
| LAN/overlay/公网、远程 Admin/SSH | closed |
| UU/Tailscale/FileVault/Firewall/路由器/网络变更 | closed |
| 真实账号/密钥/数据/provider/Base/采集/表单/媒体/发布 | closed |
| 上传、备份、部署、生产 | closed |

## 6. 错题自检

- 没有把用户的“先跑起来”扩张为网络变更、远程、真实数据或生产授权。
- 没有把文档交付 PASS 写成候选已运行或已验收。
- 没有把 8B5FF9 的 FAIL/BLOCKED 当作 47EF67 的最终结论，也没有把 47EF67 当前 `claimed` 写成 PASS。
- 没有在 47EF67 收据尚缺时自行发明 Seatbelt/no-egress 执行规则；这是当前唯一执行阻断。
- 没有使用 npm install/ci 或联网补齐策略；Node/lock/node_modules/build/DB 缺失时固定停止。
- 没有保存、散列或编码截图中的地址或设备唯一标识。
- 没有修改 v0.4、app、data、design、Spec 或 accepted ADR，也没有创建真实资源。
- 临时根默认保留，清理另行授权；文档未提供宽泛递归删除命令。

## 7. 当前阻断

`TASK-20260809-47EF67` 尚未形成 completed+PASS+ACK 收据。该阻断不影响 v0.5 文档包交付，会持续阻止目标 Mac 的复制、运行和浏览器动作。后续若 47EF67 PASS/ACK，目标 Mac Agent 还必须先复算全部候选和只问一次用户确认；任一门失败都保持 fail closed。
