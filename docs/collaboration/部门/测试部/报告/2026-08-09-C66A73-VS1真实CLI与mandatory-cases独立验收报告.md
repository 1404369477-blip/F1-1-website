---
type: audit_report
department: 测试部
target: TASK-20260809-D6114C已ACK的VS1最终候选
status: final
date: 2026-08-09
related_task: TASK-20260809-C66A73
decision: fail
tags: [M5, VS1, clean-room, worker, contract-test]
summary: 固定Node24 clean-room中的worker:mock与test:contract均一次exit0；三Function ID、happy receipt、25 case总数、012唯一例外、rollback/replay/no-work及externalCalls=0取得证据。test:contract未断言各case recoveryAction及retry 1s/3s、最多三次、dead-letter/attempt history精确值，任务要求的mandatory证据不完整，P0=0/P1=1，唯一结论FAIL。
p0: 0
p1: 1
p2: 0
---

# TASK-20260809-C66A73 VS1 真实 CLI 与 mandatory cases 独立验收报告

## 结论

`FAIL`。P0=0、P1=1、P2=0。

两个授权真实出口均在同一固定 Node24 clean-room 中一次运行并 exit 0。happy worker 的三 Function ID、六字段 V-OP、完整 receipt/hash、事务提交、实体增量和 `externalCalls=0` 均通过；contract 入口确实运行 25 个 registry case，并覆盖 rollback、replay 与 no-work。

P1-01：`test:contract` 的实际断言范围没有覆盖任务要求的全部 mandatory 属性。入口未断言每个 case 的 `recoveryAction`，也未断言 `VS1-RETRY-014` 的 1s/3s fixture clock、最多三次，以及 `VS1-DEAD-015` 的 dead-letter/attempt history 精确值；最终 stdout 只有 `cases=25` 汇总。由于本任务禁止追加自制执行入口，也禁止用实现逻辑或开发报告替代独立运行证据，这些项目保持未验证，不能 PASS。

## 候选 hash 门禁

领取前与结束时复算一致：

| 对象 | SHA-256 |
|---|---|
| successor ADR | `95421002e6b5b52061d6d41b6342f92bb919bfdf937ca00ab69fc9f9a2cc5612` |
| v0.2 合同 | `2913bc78bd43969f8354b63d9906b346839102d76f05702d6c41f54145c4ed6c` |
| `package.json` | `e39a413a0ae2000b781433e983a9df48c26b0f5c1db1ce950e2b0b6dd6be7752` |
| `package-lock.json` | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` |
| worker | `57fcea6ac269daccce8a21072198b4ccc3f0529823a79383a97d0a3af67de814` |
| contract entry | `7f52c992ffdd3a92c06d3c87aa0babcce83e4fa12c55f3933968e246a0f40297` |
| fixture loader | `7c21bf9e3e0c38a166a831613118daf0f3fcf837d08ca6723553e732133326e9` |
| no-egress | `a8c117708d31fb236e059183c9b08c6a56ab091ac38bde121ef0234e85a22d2d` |
| pipeline | `a74240b8d479cfec2fd0e83bc6146fd05ab6b85e12e7149d4b016dc1b92cf806` |
| VS1 test | `d43658bd81f20e42691256430dd036e329853c7759af595494d5d86c933862cf` |
| registry / seed / manifest | `21347151fbc69de403dd4d7b7aec3f315e2d8de4646f622d8b5377924f610ee1` / `4ab8a3bab537c82e43612fa11b81cdacea2043d4027bd09fcf91b04f5677a648` / `7343f8bc76d68b7993b29ed5232e3487621effb3a27518e0f754a5dd07fef39e` |
| migrations 0001..0006 | `dc235534...`, `3c96d4be...`, `f1014f95...`, `276e31b4...`, `f5a8e18f...`, `c27b9c02...`；均与任务 JSON 完整值一致 |

## 真实 worker:mock 出口

运行环境为 `env -i`，固定 Node `24.18.0` / npm `11.16.0`，临时根 0700。命令 `npm run worker:mock -- --once` exit 0。

| Function ID | status | reasonCode | recoveryAction | externalCalls | artifactHash |
|---|---|---|---|---:|---|
| `COLLECT-MOCK-002` | PASS | `PIPELINE_READY` | `NO_ACTION` | 0 | `5a73a236...040c3` |
| `CONTENT-PROCESS-003` | PASS | `PIPELINE_READY` | `NO_ACTION` | 0 | `5a73a236...040c3` |
| `SUMMARY-MOCK-004` | PASS | `PIPELINE_READY` | `NO_ACTION` | 0 | `5a73a236...040c3` |

full receipt 原字节 SHA-256 与三行 `artifactHash` 精确一致。receipt 为 0600、2429 bytes，`transactionCommitted=true`；source observation、capture、content、event、summary、release bundle、audit 各 `+1`，dead-letter `0`；`attempt=1`、五 fence 均为 1、`externalCalls=0`、`recoveryAction=NO_ACTION`。DB 文件 SHA-256 `084144e7c8adeaddf03306472c6c97ddf04863a9f6ad0ae94d88aa51c1fd89a2` 与 receipt `dbAfterHash` 一致。

## test:contract 与 25 case

`npm run test:contract` exit 0，stdout：

```json
{"event":"vs1_contract","status":"ok","cases":25,"externalCalls":0}
```

registry 机械复算：25 个唯一 case、23 个 candidate attempt；唯一 candidate 缺 summary 项为 `VS1-SUMMARY-MISSING-012`。入口实际执行 23 个结果 case，并单独执行 replay 和 no-work：

- 012 与 016A-G、017：断言 `domainBeforeHash == domainAfterHash`，证明任务合同列出的回滚链没有领域字节漂移。
- replay：断言 replay receipt 与 happy receipt 深等，三条 V-OP 均为 `IDEMPOTENT_REPLAY`。
- no-work：断言 `receipt=null`，三条 V-OP 均为 `NO_WORK`。
- 每个结果 case：断言 reasonCode、exit code、三条 V-OP、receipt `externalCalls=0`；结束 guard 总数为 0。

未覆盖的 mandatory 精确断言形成 P1-01，详见结论。

## 临时根、进程与清理

- clean-room：`/private/tmp/TASK-20260809-C66A73-cleanroom.IYfbfB`，创建权限 0700。
- worker 只留下一个 0700 子根、0600 receipt/SQLite；contract 各 case 使用生产 cleanup helper 自清理。
- 证据读取后已删除整个精确 clean-room 根，复查路径不存在；扫描无本任务 `TASK-20260809-D6114C-*` 子根。
- 两个命令均为同步 exit 0，无后台任务会话或监听端口；未启动网站。

## 已验证 / 未验证

已验证：候选 hash 首尾一致；固定 Node24 clean-room；三 Function ID happy V-OP；full receipt/hash/DB hash；25 case 总数与 registry 派生数；012 唯一例外；016A-G/012/017 rollback hash；replay；no-work；各结果 case reason/exit/V-OP 数量/receipt externalCalls=0；临时根清理。

未验证（P1）：每个非 happy case 的 `recoveryAction` 精确值；retry 1s/3s fixture clock 与最多三次；dead-letter/attempt history 精确值。系统 `sqlite3 -readonly` 在沙箱中无法打开 0600 临时 DB，但原文件 SHA-256 已独立回算并精确命中 receipt `dbAfterHash`；该工具限制未影响上述 P1 判定。

## 错题自检

- 只运行任务授权的两个 npm 真实出口；未运行 build、check、普通 test 或整站回归。
- 没有因两个命令 exit 0 就外推 mandatory 全覆盖；逐条对照入口断言，保留缺口 P1。
- 没有用开发报告、实现静态逻辑或额外自制 runner 替代独立可执行证据。
- 没有修改候选、fixture、合同、数据库、依赖、lockfile 或外部资源。
- clean-room 与 worker 子根已清理；未请求提权，也没有将 `ps` 沙箱拒绝误判为候选缺陷。

TASK_STATE_OK
