---
title: VS1固定Node24动态安全收据successor复验报告
type: audit_report
department: 安全部
target: TASK-20260809-ED377D动态证据P1后继关闭
status: final
date: 2026-08-09
related_task: TASK-20260809-D33AF3
decision: pass
tags: security,vs1,no-egress,node24,successor
summary: 固定Node24与npm及关键候选哈希匹配，唯一clean-room test contract运行通过25 cases且externalCalls为零，无敏感输出或临时残留，关闭ED377D唯一P1
---

# VS1 固定 Node24 动态安全收据 successor 复验报告

## 1. 唯一结论

**PASS。P0=0，P1=0；继承 P2=2。**

本后继任务只关闭已 ACK 的 `TASK-20260809-ED377D` 唯一 P1：固定 Node24 路径错误导致独立动态证据缺失。没有重复静态长审、运行其他 npm script、修改候选、安装依赖、联网或操作正式数据。

本轮同一冻结候选的工具链与关键 artifact 哈希在命令前后完全匹配；唯一 clean-room `test:contract` 命令 `exit 0`，输出 `cases=25`、`externalCalls=0`；精确任务前缀下没有临时根、SQLite、DB、receipt、WAL 或 SHM 残留。

PASS 只适用于 VS1 本地 synthetic 候选的 Node 进程级动态安全合同；不外推 OS/系统调用级 no-egress、同 UID 路径竞争、生产或任何真实外部能力。

## 2. 工具链与候选身份

| 项目 | 任务真值 SHA-256 | 命令前 | 命令后 |
|---|---|---|---|
| 项目 Node 24.18.0 | `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a` | MATCH | MATCH |
| npm CLI 11.16.0 | `8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7` | MATCH | MATCH |
| package | `e39a413a0ae2000b781433e983a9df48c26b0f5c1db1ce950e2b0b6dd6be7752` | MATCH | MATCH |
| lock | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` | MATCH | MATCH |
| worker | `57fcea6ac269daccce8a21072198b4ccc3f0529823a79383a97d0a3af67de814` | MATCH | MATCH |
| contract entry | `7f52c992ffdd3a92c06d3c87aa0babcce83e4fa12c55f3933968e246a0f40297` | MATCH | MATCH |
| fixture loader | `7c21bf9e3e0c38a166a831613118daf0f3fcf837d08ca6723553e732133326e9` | MATCH | MATCH |
| no-egress | `a8c117708d31fb236e059183c9b08c6a56ab091ac38bde121ef0234e85a22d2d` | MATCH | MATCH |
| pipeline | `a74240b8d479cfec2fd0e83bc6146fd05ab6b85e12e7149d4b016dc1b92cf806` | MATCH | MATCH |
| VS1 test | `d43658bd81f20e42691256430dd036e329853c7759af595494d5d86c933862cf` | MATCH | MATCH |
| registry | `21347151fbc69de403dd4d7b7aec3f315e2d8de4646f622d8b5377924f610ee1` | MATCH | MATCH |
| seed | `4ab8a3bab537c82e43612fa11b81cdacea2043d4027bd09fcf91b04f5677a648` | MATCH | MATCH |
| manifest | `7343f8bc76d68b7993b29ed5232e3487621effb3a27518e0f754a5dd07fef39e` | MATCH | MATCH |

工具链版本由任务真值绑定到上述精确项目内 artifact；本轮以 SHA-256 独立重算确认身份，没有使用系统 Node/npm 或替代工具链。

## 3. 唯一动态命令收据

### 3.1 环境

- `env -i` clean room。
- 只传固定用户目录、项目 Node24 前置最小 `PATH`、`TMPDIR=/tmp`、`LANG=C`、`LC_ALL=C`。
- 使用任务真值指定的项目内 Node 和 npm CLI。
- 只执行一次现有 `test:contract`；没有执行 test、check、build、lint、typecheck、worker 或其他 npm script。

### 3.2 结果

| 字段 | 结果 |
|---|---|
| exit | `0` |
| event | `vs1_contract` |
| status | `ok` |
| cases | `25` |
| externalCalls | `0` |
| 重试 | `0` |
| 网络/安装/外部凭据 | `0` |

候选结构化输出为：

```json
{"event":"vs1_contract","status":"ok","cases":25,"externalCalls":0}
```

npm 正常 banner 只显示公开包名、脚本名和仓库相对入口；候选结构化输出及 stderr 没有绝对路径、用户目录、stack、源码行、URL、token、key、secret、fixture 正文或 receipt 内容。stderr 为空。

## 4. 清理与零残留

动态命令结束后，只读扫描以下精确前缀：

- `/tmp/TASK-20260809-D33AF3-*`
- `/tmp/TASK-20260809-D6114C-*`（候选 pipeline 实际使用的冻结前缀）

结果：

| 对象 | 数量 |
|---|---:|
| 临时任务根 | 0 |
| `*.sqlite` / `*.db` | 0 |
| receipt `*.json` | 0 |
| `*-wal` | 0 |
| `*-shm` | 0 |

没有执行额外清理命令；零残留来自候选自己的 `finally`/cleanup 路径。

## 5. 对 ED377D 的继承与关闭

继承 ED377D 已核收静态结论：候选 20 项 hash 匹配；guard 在业务导入前安装；任务要求的 Node 进程出口、fixture/路径/hash/closed schema、日志/receipt allowlist、lease/five fence/stop、成功与失败结算、retry/dead-letter、016A-G、replay/no-work 和 cleanup 静态控制流成立。

本轮动态收据补齐了 ED377D 未运行的 `test:contract`：25 cases 实际通过、进程 guard 真实计数保持 0、失败路径均由该合同入口执行并完成任务根清理。ED377D 的 P1-01 因此由本 successor 关闭。

## 6. P0/P1/P2、未验证项与错题自检

- **P0：0。** 没有出现真实外部调用、凭据泄漏、候选漂移或清理失败。
- **P1：0。** 固定工具链身份、唯一动态命令、25 cases、`externalCalls=0`、输出与零残留均满足验收出口。
- **P2-01（继承）：OS/系统调用级 no-egress 未验证。** Node 进程级 guard 不证明内核、防火墙、原生扩展或生产隔离。
- **P2-02（继承）：同 UID 路径 TOCTOU 未机械验证。** 固定 hash 能约束内容，不能完整证明分步 `realpath/lstat/readFile` 的稳定 inode。

未验证：OS/系统调用级隔离、同 UID 恶意竞争、真实 provider/RSS/Base/AI/Admin/发布/部署/生产能力、平台网络与凭据。上述能力继续 closed/Unknown。

错题自检：只运行一次动态命令；未运行其他 npm script；未重复静态长审；未修改或清理候选；未安装、联网、使用系统 Node 或外部凭据；未把 `externalCalls=0` 外推为 OS 级能力；未覆盖 ED377D 的 FAIL 历史，只以 successor 收据关闭其唯一 P1；未把 VS1 本地 synthetic PASS 扩大为生产或真实外部能力放行。

TASK_STATE_OK
