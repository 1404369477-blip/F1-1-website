---
title: 多媒体 profile 与 V1/V2 API 独立安全复验报告
type: audit_report
department: 安全部
target: DEV-MM-BACKEND-01..03 固定候选
status: final
decision: pass
date: 2026-08-09
related_task: TASK-20260809-4A5381
tags: security,multimedia,sqlite,api,no-egress
summary: 固定多媒体候选一次目标测试5项通过，旧真值零漂移，新profile权限与闭链、原子恢复、V1/V2及进程级no-egress满足门禁
candidate_scope: DEV-MM-BACKEND-01..03
p0: 0
p1: 0
p2: 2
external_calls: 0
---

# 多媒体 profile 与 V1/V2 API 独立安全复验报告

## 1. 唯一结论

**PASS（仅限本任务固定候选与本地 synthetic profile）**。

固定候选的 exact migration、独立 SQLite profile、原子安装与恢复、单 profile/ATTACH 隔离、0/1/4 图与第五图上限、SQLite 闭链、hash/rights/safety/order、V1/V2/406/500/no-store、应用错误脱敏及进程级 no-egress 均通过静态审查与一次目标测试。前后哈希证明旧两库、三份 closed receipt、旧 migration 与候选核心文件零漂移；新库为普通文件、0600、nlink=1，未留下 WAL/SHM/candidate。

本结论不放行真实媒体、外部调用、生产部署或 OS 级网络隔离，也不替代构建产物追踪复验。

## 2. 候选哈希绑定

| 对象 | SHA-256 |
|---|---|
| scoped `0003_public_multimedia_synthetic_profile.sql` | `1f88116c62d2d29e469ff0dce356d07b41c8b142a00769774a3cf67709968b43` |
| `public-multimedia-synthetic.ts` | `844d8edc2520d5e0dcf446e9f0d4b11ea843624c8f1b8e423c0c1236c664bfe0` |
| `public-multimedia-profile.ts` | `257cd0e6e8c33b121b4e2e12ff3476cfaf0b478d1d776954955e9527f545db58` |
| 目标测试 | `67d00829e0ccae0f47cf5de2d7bc3b3e93dbe702930c26a95dc8197f4075601b` |
| `.env.example` | `f9a734a97cd01d5b35c643d404e658a74cfaba51ec64a8114874d43273350f42` |
| DB profile | `8963ead3c6c5a926e8241dceb2972af13b86a5038becc7e6910ac7a6ae82b437` |
| seed | `161447db10429c110918e904830e62b7df1acf03132700655e625490fcc92199` |
| db-migrate | `9bce219ba4ebafe6c6ad1a69d9634f3ab354286ecf8978ffb86680df7f766ea6` |
| seed-fixtures | `5cfcbf01328a44711ba4d8ca3677e4fb4b56a3cb0d5fba424e5f5a7a34ad46da` |
| serve | `1bc41e1b30d9606f83a7a07cf55fbf5007d7f04b7e762543df41f507d7c00ee4` |
| health route | `bf52544d19876637b64476a0cb036e0313c9b00c516262d53afa6690acaf50ed` |
| public runtime | `cb1572bb295c0615e4d3ff82c5793b81eecab720aee54cbe9bc4d21fd8aa1036` |
| public types | `64d61d5f4e255592febc333ec690bb94cb95f0f8bc2beede150268462e8aa95` |
| public error | `28df8e9d3074242143660d1f97f81fd1631d7e479828d8e0c0d74c76c8058d03` |
| public HTTP | `348b6f0abeebaacd3108eeba1f793b006a4e53c1373e84fb401977471c80c8a0` |
| repository | `4c114687da195eb1a077889e924c43760901e30f2fc61e397b46f6341843ec1c` |
| story route | `dc831de603ac3d8def6733b0831867001d1ebc2763be395c99819c57207a059f` |
| 新 multimedia SQLite | `a1f712aacf0d78664ea9962dfe9902c194422ce099bab968a84d9a2c64cbf50c` |

上述对象在目标测试前冻结，测试后逐项回读一致。

## 3. 旧真值零漂移

| 对象 | 测试前后 SHA-256 |
|---|---|
| `0001_local_foundation.sql` | `9c8c083b8f3c566023e9438c254d5b1c09d87430dec08f6e6905ed84b6fb3176` |
| `0002_source_fixture.sql` | `12a755754744689f977ac8b8d5d4443ec63cd5612aaff50eb920badf1ebfb031` |
| 旧 `0003_public_synthetic_profile.sql` | `57df4d990cded9d69551d0acf97615ef5d9fd3d5ecceb05ebb10d3812549498a` |
| M3 SQLite | `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0` |
| public-synthetic SQLite | `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041` |
| `m3-shadow.closed.json` | `4309961dd363413444821f29586a15eec96cc18b396a3f8aad44330ec5d5bbdc` |
| `public-synthetic.closed.json` | `2c5ca3555b108761fb5b224e0cad77a29d8fc16e56d3eb4d6b80448365492803` |
| `public-synthetic.data.closed.json` | `71286412fcfc04428145b86ba2a174d93417e6604f16883a7a5a87f7e76cacdc` |

三份 receipt 的 canonical self-hash 也独立复算匹配：`feb172dd…a843`、`a6acb4a8…0e81`、`75e2d0e5…984a`。旧 canonical SQLite 未经 SQLite 打开；仅做字节哈希和元数据检查。两旧库、三 receipt 均为 uid 501、mode 0600、nlink=1。

## 4. 文件、迁移与数据库证据

- 新 canonical DB：普通文件、uid 501、mode 0600、nlink=1；测试前后哈希均为 `a1f712…50c`。
- scoped selector 精确选取旧 `0001`、旧 `0002` 与 multimedia scoped `0003`；`PRAGMA user_version=3`。
- 私有副本以 immutable read-only URI 检查，`PRAGMA integrity_check=ok`。
- ledger 精确值：profile=`public-multimedia-synthetic`、contract=`public-read-v0.2`、fixture=`public-multimedia-0-1-4-v0.5`、synthetic_only=1、external_calls=0、writes_to_base=0、real_media=0。
- ledger 根：migration selector=`336a8721…600c`、schema fingerprint=`b39672c4…efe8f`、profile ledger=`f762c35c…54e1`。
- 表计数：projection/content/summary/release bundle/review/publication 各 3；media candidate 5。三条公开内容的媒体数精确为 0、1、4。
- INSERT 与 UPDATE 两条 max-four trigger 均存在；目标测试覆盖第五张 INSERT、第五张 UPDATE 拒绝。
- 测试前后均无 canonical `-wal`、`-shm`、candidate 或运行时 backup sidecar 残留。

## 5. 原子安装、恢复与 profile 隔离

静态控制流确认：候选通过 no-replace hardlink 安装；安装中验证同 dev/ino 与 nlink=2，解除候选链接后 final 必须 nlink=1。恢复只接受精确单一 candidate 与精确 sidecar 形状；多 candidate、链接/身份/owner/mode 异常均 fail-closed。数据库打开前验证 regular file、非 symlink、owner、0600、nlink 与身份稳定性。

运行时使用单一 multimedia profile handle；SQLite authorizer 明确拒绝 ATTACH/DETACH，避免跨 profile 读取。旧 receipt 以文件描述符前后身份、canonical bytes、self-hash、expected binding、freshness 与 DB hash 校验，不通过旧 canonical DB 的 SQLite 查询完成验证。

一次目标测试还覆盖 28 个写入故障注入点，均回滚为零领域行；幂等重放不增加记录。

## 6. 闭链、HTTP 与脱敏

- Repository DTO 由 SQLite projection→content→summary→release bundle→review→publication 闭链构造，并校验内容/摘要/bundle hash、rights、safety、发布顺序、最多四图和 gallery 完整性；未发现 expected DTO 第二真值或 partial-gallery fallback。
- 精确 V2 media type 返回 V2；默认/兼容路径返回 V1；不支持的 Accept 返回 406。闭链、hash、rights、safety 或顺序异常返回 500，异常第五图存量也 fail-closed 为 500。
- 响应统一 `Cache-Control: no-store`。
- Problem 响应负例断言无绝对用户路径、stack、SQL、`content_hash_input`、`rights_status` 等内部字段。
- 测试在模块加载前封锁网络原语，结束断言 `externalCalls=0`；未启动真实 HTTP listener。
- Vitest 自身 runner banner 显示工作区绝对路径。该输出属于本地测试工具日志，未进入应用 HTTP/Problem 响应；如未来将测试日志外发，应在日志出口另行脱敏。

## 7. 唯一动态收据

在任务专属 0700 临时根内，使用项目内现有 Node/Vitest 仅运行一次目标文件：

- test files：1 passed；tests：5 passed；exit=0；
- 无 build、check、完整套件、真实 HTTP 或其他 npm script；
- 新 DB 仅复制到 mode 0600、nlink=1 的私有副本，SQL 检查为 immutable read-only；
- 测试后完成候选/旧真值哈希回读与精确残留扫描；
- 任务临时根已按精确路径清理。

## 8. P0 / P1 / P2

- P0：0。
- P1：0。
- P2-1：`f1plus1-public-multimedia-synthetic.pre-update-20260809.sqlite` 保留于 canonical `.local`，SHA=`b3810f57…d3ff`，当前为普通文件、uid 501、0600、nlink=1，且运行时精确路径/命名不会选中。它仍是同一故障域内的额外明文 synthetic 数据副本，增加留存、备份和误取风险。后续应由数据保留策略决定归档或受控删除；本任务未处置。
- P2-2：开发报告所述构建 tracing warning 尚未通过本任务验证。部署打包前须证明 scoped migration、SQLite profile 与 receipt 资源均进入产物且不误纳入 pre-update 文件；本任务未运行 build。

## 9. 已验证

- 固定候选及旧真值的测试前/后 SHA-256；旧库未被 SQLite 打开。
- 新库/旧库/receipt 的文件类型、owner、mode、nlink 与 sidecar 状态。
- exact migration、ledger、schema、0/1/4 数据形状、第五张 INSERT/UPDATE 拒绝。
- 安装/恢复、链接/权限/身份、single-profile/ATTACH 的 fail-closed 控制流。
- seed 事务、幂等、28 点故障回滚。
- SQLite 闭链、hash/rights/safety/order 与 V1/V2/406/500/no-store。
- 应用 Problem 错误脱敏与目标测试进程 `externalCalls=0`。
- pre-update 备份的隔离、权限、运行时不可选中性与清理风险。

## 10. 未验证

- OS/容器/防火墙层 no-egress；结论仅到本次进程级网络原语封锁。
- 真实 HTTP listener、反向代理、生产 headers 与公网行为。
- 真实媒体、真实外部来源、Base 写入或生产能力。
- build/部署 tracing、安装包内容及生产文件系统差异。
- crash/power-loss 的物理故障注入；原子安装与恢复结论来自控制流和现有聚焦测试。

## 11. 错题自检

- 未继承开发部 PASS；独立冻结并回读所有任务要求的候选与旧真值哈希。
- 未打开 canonical 旧 DB，未重生成 receipt，未启动真实 HTTP，未运行 build/check/full suite。
- 唯一目标测试只运行一次；只读 SQL 因普通 read-only 打开受限后，改用 immutable 私有副本，没有重跑测试。
- 将进程级 no-egress 与 OS/生产隔离分开，未外推能力。
- 将保留的 pre-update 文件记为 P2 留存风险，没有删除或把它误判为运行时选中对象。
- 将 Vitest runner 的绝对路径输出与应用 Problem 响应分开记录，没有掩盖工具日志边界。
- 临时根按任务精确路径清理；canonical 候选与旧真值未修改。

TASK_STATE_OK
