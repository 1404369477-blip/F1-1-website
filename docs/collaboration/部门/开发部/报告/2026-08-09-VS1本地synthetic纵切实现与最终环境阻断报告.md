# TASK-20260809-D6114C｜VS1 本地 synthetic 纵切实现与最终验收报告

- 日期：2026-08-09
- 部门：开发部
- 任务状态结论：`PASS / READY_TO_COMPLETE`（TS2775 已按窄授权修复；唯一一次 clean-room 固定完整链 exit 0）。
- 实现结论：三个 Function ID 的本地 synthetic 纵切已落盘，真实 worker、76/76 测试、25-case contract test、lint、typecheck、build 与完整 `check` 全部通过。开发任务可以完成；Function ID 仍须等待数据/安全/测试独立 ACK 后由产品矩阵另行改为 complete。
- Canonical：`ADR-M5-VS1-LOCAL-PIPELINE-002`、`F1+1-VS1本地synthetic纵切实施合同-v0.2`，并继承 v0.1 未被 successor 修改的全部条款。

## 1. 范围与边界

本轮只实现：

1. `COLLECT-MOCK-002`：固定 fixture adapter、单 job selector、live TaskEnvelope、CSPRNG lease、五 fence、最多三次的 1s/3s fixture-clock retry、dead-letter、no-work、closed operator receipt。
2. `CONTENT-PROCESS-003`：`normalize-text-v1`、`synthetic-quality-v1`、Content identity、Event fingerprint/union/CAS/collision、幂等 replay。
3. `SUMMARY-MOCK-004`：当前 case allowlist lookup、确定性 Summary、immutable ReleaseBundle、approved-chain fail closed。

保持关闭：真实 provider、RSS、Base、外部 AI、非 loopback I/O、Admin、人工审核 mutation、发布、部署。未修改公开 UI、设计、accepted ADR/Spec、冻结 data、依赖或 lockfile。

## 2. 落盘产物

### 2.1 运行入口

- `app/scripts/vs1-worker.ts`：guard 先于业务模块动态导入；只接受精确 `--once`；成功只输出三行六字段 V-OP JSONL。
- `app/scripts/vs1-contract.ts`：在任何 VS1 业务模块导入前安装进程级 no-egress guard，随后运行 25 个 mandatory registry case、replay 与 no-work。
- `app/package.json`：`worker:mock`、`test:contract` 已指向真实实现；`check` 包含 `test:contract`。

### 2.2 合同、数据库与测试

- `app/fixtures/vs1-local-pipeline-v1.json`：25 个 case；23 个 candidate attempt；012 是唯一 candidate 缺 `mock_summary` 例外。
- `app/fixtures/vs1-local-pipeline-seed-v1.json`：固定 Source、clock、五 fence 与显式 precondition graph。
- `app/fixtures/vs1-local-pipeline-manifest-v1.json`：绑定 registry、seed、四份冻结合同与六个实际迁移 hash。
- `app/migrations/vs1/0001..0006`：任务隔离 SQLite 的现有领域表/内部运行表等价迁移；Event 含冻结 schema 要求的四个审计字段。
- `app/src/server/vs1/fixture.ts`：closed Zod schema、重复 JSON key 拒绝、owner-controlled regular-file/hardlink/permission/hash 边界、v0.2 唯一 012 条件。
- `app/src/server/vs1/pipeline.ts`：单 handle、WAL/FULL/foreign_keys/busy timeout、无 ATTACH、0700/0600、事务/失败结算、strict insert-or-return、Event CAS、hash/receipt。
- `app/src/server/vs1/no-egress.ts`：覆盖 fetch、WebSocket、net/Socket、HTTP/HTTPS/HTTP2/TLS、DNS callback/promise、dgram、child_process、cluster 与 worker_threads。
- `app/src/tests/vs1-contract.test.ts`：mandatory case、012 负例、双 serializer golden、单变量扰动、真实事务回滚、replay、no-work、Event schema、insert-or-return 污染和 no-egress 出口测试。

## 3. 对抗审查整改

两路只读对抗审查初轮发现 P0=1、P1 多项；当前代码已经完成以下局部整改：

- Event 创建/碰撞/合并统一通过 closed payload 构造器，补齐 `created_at/updated_at/created_by_ref/updated_by_ref`；迁移、物化列和 payload 同步。
- Event update 使用 old canonical/member/status/epoch/updated_at 条件并要求 `changes=1`；ready Summary/Bundle supersede 也要求逐行精确命中。
- SourceObservation、CapturedItem、Summary、ReleaseBundle 的 insert-or-return 回读并核对全部相关物化列与 canonical payload；污染差异 fail closed。
- approved-chain hash 覆盖 ReviewDecision 与 Publication，失败前后要求完整旧链 byte-identical。
- failure settlement 重验 Outbox/Inbox/TaskAttempt envelope bytes/hash、lease token/expiry/deadline、五 fence 与 stop；Source 状态按来源边 guard CAS。
- production worker 与 `test:contract` 入口均在业务模块导入前安装 no-egress；CLI 失败的 `externalCalls` 使用实际 guard 计数。
- v0.2 parser 覆盖 012 合法/null/空对象/空串、其他 candidate 缺 summary、non-candidate 携带 candidate/summary、大小写/近似 ID；Event golden 由生产与独立 reference serializer 复算。

复核结果在最终链之前收敛为 `P0=0`；两路最后指出的严格 insert-or-return 与 test 入口 guard 残余随后已修入当前候选，但依照用户要求没有再追加独立审查或冗余测试。

## 4. 验证事实

### 4.1 最终整改前的聚焦收据

- 固定 Node `24.18.0`：`test:contract` 曾达到 8/8 PASS，耗时约 395ms。
- 固定 Node `24.18.0`：`typecheck` 曾 exit 0。

这些收据发生在最后两处严格 insert-or-return/test-entry 修订之前，只作为开发过程证据，不能代表当前最终候选通过。

### 4.2 唯一最终命令链

最终链按 accepted 顺序准备执行：`verify:env → db:migrate → seed:fixtures → runtime:assert-ready → worker:mock -- --once → test → test:contract → lint → typecheck → build → check`。

结果：未越过第一步。

1. 首次调用误把用于 shell 定位本地工具链的 `F1_NODE_BIN/F1_NPM_CLI` 导出给子进程；`verify:env` 以 `ENV_UNKNOWN`、`externalCalls=0` 非零退出。未执行 migration、worker 或测试。
2. 纠正为非导出 shell 变量后，继承环境仍含项目明确禁止的 `NO_PROXY`；`verify:env` 以 `ENV_FORBIDDEN`、`externalCalls=0` 非零退出。再次未执行 migration、worker 或测试。

用户要求最终链失败即 block，且第二次前已声明不再重试。因此没有用第三次 `env -u NO_PROXY` 或 `env -i` 绕过本轮失败收据。

### 4.3 清理与状态

- 两次最终调用均在 `verify:env` 停止，没有创建本轮 VS1 任务数据库、receipt 或 sidecar。
- 先前开发探针产生的 `TASK-20260809-D6114C-*` 临时根已通过任务专用 cleanup helper 清除；最终扫描为空。
- `app/package-lock.json` SHA-256 保持 `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3`，未新增依赖。
- 外部调用为 0；没有启动网站、真实 provider、RSS、Base、AI、Admin、发布或部署能力。

## 5. 当前源码 hash

| 文件 | SHA-256 |
| --- | --- |
| `app/package.json` | `e39a413a0ae2000b781433e983a9df48c26b0f5c1db1ce950e2b0b6dd6be7752` |
| `app/scripts/vs1-worker.ts` | `57fcea6ac269daccce8a21072198b4ccc3f0529823a79383a97d0a3af67de814` |
| `app/scripts/vs1-contract.ts` | `7f52c992ffdd3a92c06d3c87aa0babcce83e4fa12c55f3933968e246a0f40297` |
| `app/src/server/vs1/fixture.ts` | `7c21bf9e3e0c38a166a831613118daf0f3fcf837d08ca6723553e732133326e9` |
| `app/src/server/vs1/no-egress.ts` | `a8c117708d31fb236e059183c9b08c6a56ab091ac38bde121ef0234e85a22d2d` |
| `app/src/server/vs1/pipeline.ts` | `a74240b8d479cfec2fd0e83bc6146fd05ab6b85e12e7149d4b016dc1b92cf806` |
| `app/src/tests/vs1-contract.test.ts` | `d43658bd81f20e42691256430dd036e329853c7759af595494d5d86c933862cf` |
| `app/src/tests/public-synthetic-seed.test.ts` | `b191b3e56b2236464d5c211f789f6e7e8dea19e39caab8726ca52495fac3ebb0` |
| registry | `21347151fbc69de403dd4d7b7aec3f315e2d8de4646f622d8b5377924f610ee1` |
| seed | `4ab8a3bab537c82e43612fa11b81cdacea2043d4027bd09fcf91b04f5677a648` |
| manifest | `7343f8bc76d68b7993b29ed5232e3487621effb3a27518e0f754a5dd07fef39e` |

## 6. 历史阻断与已关闭出口

前两次恢复历史的环境首错为：

```json
{"event":"cli_failure","status":"rejected","reasonCode":"ENV_FORBIDDEN","externalCalls":0}
```

随后统筹在验收链外完成键名核对，并授权 `env -i` clean-room。第一轮 clean-room 已证明环境门可以通过，并暴露 `npm test` 的确定性复制首错：

```text
ENOTSUP: operation not supported on socket, copyfile
.../app/migrations/vs1 -> .../migrations/vs1
```

`app/src/tests/public-synthetic-seed.test.ts` 的 `copyFiles` helper 原先对 migration 根每个条目直接调用 `copyFileSync`；本任务新增的 `app/migrations/vs1` 是目录，因此两个隔离测试在复制阶段失败。统筹随后仅授权修复该兼容缺口。当前 helper 已通过 `Dirent` 只复制根普通文件、跳过目录并维持 `0600`；最新 clean-room 链确认 public-synthetic 测试 3/3、全量测试 76/76 均通过。

该历史 TS2775 阻断已在 revision 12 的窄授权下关闭：`scripts/vs1-contract.ts` 先取得显式 `assertModule`，再以 `typeof import("node:assert").strict` 绑定 `assert`。no-egress guard 仍在任何 VS1 业务模块导入前安装，其余模块继续动态导入，运行语义和测试场景未变化。

修订后只执行了一次同规格 clean-room 固定完整链，结果 exit 0；任务专属 receipt/V-OP 已固化并完成临时根清理。数据/安全/测试独立 ACK 仍属于开发任务后的门禁，不影响本开发任务完成，也不在本报告中提前把三个 Function ID 改为 complete。

## 7. 错题自检

- 没有把开发过程的历史收据冒充最终收据；最终 PASS 只引用 revision 12 修订后的唯一 clean-room 完整链。
- 没有在完整链通过前 complete 任务，也没有提前把三个 Function ID 改为 complete。
- 没有修改公开 UI、冻结合同/data、package-lock 或依赖。
- 没有执行第三次最终链、外部 I/O、真实 provider 或任何越权能力。
- 没有遗留任务临时数据库、receipt、WAL/SHM 或本地服务进程。

## 8. Resume 后唯一恢复验收收据

- 任务状态在执行前为 `claimed`，`claimed_by=开发部/019fb374-7c86-7882-9e51-76114ce69e7f`，revision=6。
- 运行包装：每个命令单独使用 `env -u NO_PROXY PATH=<项目Node24优先的最小PATH>`；工具链定位变量未 export；没有修改系统环境或 App 安全合同。
- 固定链在首个 `npm run verify:env` 以 exit 1 停止，输出为上节 `ENV_FORBIDDEN` closed JSON。
- `db:migrate`、`seed:fixtures`、`runtime:assert-ready`、`worker:mock`、`test`、`test:contract`、`lint`、`typecheck`、`build`、`check` 均未开始。
- 本轮没有代码、依赖、公开 UI、数据库或外部能力变更；`externalCalls=0`。
- `TASK-20260809-D6114C-*` 临时根最终扫描为空，无 DB、receipt、WAL/SHM 清理对象。

## 9. `env -i` clean-room 唯一验收收据

### 9.1 环境边界

- 任务执行前：`execution_state=claimed`、`claimed_by=开发部/019fb374-7c86-7882-9e51-76114ce69e7f`、revision=8。
- 每个 npm 子进程统一位于同一个非交互 `/bin/sh` clean room；外层只传 `HOME`、项目 Node24 前置的最小 `PATH`、`TMPDIR`、`LANG=C`、`LC_ALL=C`。
- 没有传入 token/key/proxy、`LOG_`、`CODEX_` 或外层应用键；没有修改系统环境、`env.ts`、安全合同或实现。

### 9.2 通过项

| 顺序 | 命令 | 结果 |
| --- | --- | --- |
| 1 | `verify:env` | exit 0；Node 24.18.0；fixture/mock/manual_only；externalCalls=0 |
| 2 | `db:migrate` | exit 0；userVersion=3；SQLite 3.53.1；WAL/FULL/busy250/FK1 |
| 3 | `seed:fixtures` | exit 0；public-synthetic v0.4；12 条图；`inserted=false`；externalCalls=0 |
| 4 | `runtime:assert-ready` | exit 0；`status=ready,scope=local-only` |
| 5 | `worker:mock -- --once` | exit 0；三个 Function ID 均 PASS/PIPELINE_READY；externalCalls=0 |

worker receipt：

- artifact SHA-256：`6fa1dca33174062d4a63875d94eb8b7a17473c9685caeeedfe87fd59cd8da3a6`
- DB after SHA-256：`35b4a96ab05b1b60b3403606b1221adfc9bb3f0b220beb9f17017949b4fd877f`
- Event golden：`4fbc236a8b27e1f1f45b7165ed5a2374ba35730aaa49f860a2ff94c46874c6b1`
- `transactionCommitted=true`；observation/capture/content/event/summary/bundle/audit 各 `+1`；dead-letter `0`。
- 该轮 receipt/V-OP 的 hash 历史保留在本节；项目证据文件现已由第 10 节的更新候选原字节取代。

### 9.3 首个失败与停止点

- 第 6 步 `npm test`：exit 1。
- 汇总：7 个 test files 中 6 PASS、1 FAIL；76 tests 中 74 PASS、2 FAIL。
- `src/tests/vs1-contract.test.ts` 当前候选 9/9 PASS，mandatory transaction case 通过。
- 两项失败均来自 `src/tests/public-synthetic-seed.test.ts:83` 的同一 `copyFileSync(directory)` 首错；分别对应 root-drift 与 appended-migration rollback 的隔离副本准备。
- `test:contract`、`lint`、`typecheck`、`build`、`check` 因 `set -e` 均未开始。

### 9.4 清理

- full receipt 和三行 V-OP 已先以原字节固化到项目报告证据目录；receipt hash 回算与 stdout artifactHash 一致。
- 随后使用任务专用 cleanup helper 删除 `TASK-20260809-D6114C-f9rYPX`，并删除本轮两个明确的失败测试临时目录。
- 最终扫描无 `TASK-20260809-D6114C-*`、`f1plus1-v04-root-drift-*` 或 `f1plus1-v04-migration-rollback-*` 残留。
- 没有保留临时 DB、WAL/SHM、测试副本或服务进程；外部调用仍为 0。

## 10. `copyFiles` 窄修复后的唯一 clean-room 链

### 10.1 唯一代码修订

- 文件：`app/src/tests/public-synthetic-seed.test.ts`
- SHA-256：`b191b3e56b2236464d5c211f789f6e7e8dea19e39caab8726ca52495fac3ebb0`
- `copyFiles` 改为读取 `Dirent`，只复制 `entry.isFile()` 的 migration 根普通文件，目录和 symlink 均跳过；目标文件继续 `chmod 0600`。
- 生产 `readMigrations`、VS1 实现、依赖、lockfile、公开 UI、Spec/ADR/data/design 均未修改。

### 10.2 完整链结果

| 顺序 | 命令 | 结果 |
| --- | --- | --- |
| 1 | `verify:env` | exit 0；Node24；fixture/mock/manual_only；externalCalls=0 |
| 2 | `db:migrate` | exit 0；SQLite 3.53.1；WAL/FULL/busy250/FK1 |
| 3 | `seed:fixtures` | exit 0；public-synthetic v0.4；12 条图；`inserted=false` |
| 4 | `runtime:assert-ready` | exit 0 |
| 5 | `worker:mock -- --once` | exit 0；三 Function ID 全 PASS |
| 6 | `npm test` | exit 0；7/7 test files、76/76 tests PASS |
| 7 | `test:contract` | exit 0；25 cases、externalCalls=0 |
| 8 | `lint` | exit 0；0 errors、3 条既有 `<img>` warning |
| 9 | `typecheck` | exit 2；12 个 `TS2775`，全部位于 `scripts/vs1-contract.ts` |
| 10–11 | `build`、`check` | 因 `set -e` 未开始 |

精确首错示例：

```text
scripts/vs1-contract.ts(14,5): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
```

### 10.3 最新 worker 证据与清理

- receipt/artifact SHA-256：`65b81840b20c37afa473fb37abfdb8fcbf2dbe2e8488dcf8e1aee9b8b6fffa25`
- DB after SHA-256：`d896ec31fd80f605ce5d76461a883a8b92f16d1c39459d0fefdc99d9b28c433f`
- V-OP 文件 SHA-256：`9f6ae81b72fb4d0440fb51654e8a01ca25d16d8ce2bc58ebe12df87f2848b45c`
- 当前证据：`docs/collaboration/部门/开发部/报告/证据/TASK-20260809-D6114C/op-vs1-vs1-happy-001.json` 与 `vop.jsonl`。
- receipt 原字节 hash 与 stdout artifactHash 一致；三行均 `PASS/PIPELINE_READY/externalCalls=0`。
- 固化证据后已通过任务专用 helper 删除 `TASK-20260809-D6114C-9YWiYu`；最终无任务根或 `f1plus1-v04-*` 测试临时目录残留。

## 11. TS2775 窄修复后的最终 clean-room 验收

### 11.1 唯一代码修订

- 文件：`app/scripts/vs1-contract.ts`
- SHA-256：`7f52c992ffdd3a92c06d3c87aa0babcce83e4fa12c55f3933968e246a0f40297`
- 动态导入从 `[{ strict: assert }, ...]` 拆为 `[assertModule, ...]`，随后以 `const assert: typeof import("node:assert").strict = assertModule.strict` 建立显式类型绑定。
- no-egress guard 先安装的顺序未变；security CLI、fixture 与 pipeline 仍在 guard 后动态导入；没有修改测试 case、运行分支、依赖、lockfile、公开 UI 或外部能力边界。

### 11.2 唯一完整链

执行环境统一为 `env -i`，只传 `HOME`、项目 Node24 前置的最小 `PATH`、`TMPDIR`、`LANG=C`、`LC_ALL=C`；没有传入 token/key/proxy、`LOG_`、`CODEX_` 或外层应用键。固定顺序与结果如下：

| 顺序 | 命令 | 结果 |
| --- | --- | --- |
| 1 | `verify:env` | exit 0；Node 24.18.0；fixture/mock/manual_only；externalCalls=0 |
| 2 | `db:migrate` | exit 0；applied=[]；userVersion=3；SQLite 3.53.1；WAL/FULL/busy250/FK1 |
| 3 | `seed:fixtures` | exit 0；public-synthetic v0.4；12 条；`inserted=false`；externalCalls=0 |
| 4 | `runtime:assert-ready` | exit 0；local-only ready |
| 5 | `worker:mock -- --once` | exit 0；三个 Function ID 均 `PASS/PIPELINE_READY`；externalCalls=0 |
| 6 | `npm test` | exit 0；7/7 test files、76/76 tests PASS |
| 7 | `test:contract` | exit 0；25 cases；externalCalls=0 |
| 8 | `lint` | exit 0；0 errors；3 条既有公开 UI `<img>` warning |
| 9 | `typecheck` | exit 0 |
| 10 | `build` | exit 0；Next 16.2.11 production build 成功 |
| 11 | `check` | exit 0；内部重复门全部通过；`test:p1` 确认 SIGINT 停止、3000/3101 端口与进程组清空、externalCalls=0 |

构建路由仅含 `/`、`/_not-found`、`/api/health`、`/api/public/feed`、`/api/public/stories/[publicId]`、`/stories/[publicId]`；本任务没有新增公开或 Admin 路由。

### 11.3 最终 worker 证据

- receipt/artifact SHA-256：`d6c93b0d0ad690f7177b2e071695228d6e320743a1162d7a0722198bb31ab7a4`
- DB before SHA-256：`4afdfcd6ed7d36d16288cb116cd7775ae9129edcefbb39dff9d5e30f0d3a52ec`
- DB after SHA-256：`b676b11629e0af4fc55940856426c7cb607f603a0d9b3813e89c92e884f9e420`
- domain before/after SHA-256：`1ce9b36d3b618366c070f99ff7a4ee8ca4d63b0961c3968008674f7a11ae0737` → `dfb2f4ab0d1179b0d964f9e334db84b69ce92341ca81d185263c8483e4d2ca13`
- Event golden：`4fbc236a8b27e1f1f45b7165ed5a2374ba35730aaa49f860a2ff94c46874c6b1`
- V-OP 文件 SHA-256：`642f1576f96efcf97f05ae2613ac2432b0deffe5a5004b4a002fc547f86d2b5a`
- `transactionCommitted=true`；observation/capture/content/event/summary/bundle/audit 各 `+1`；dead-letter `0`；三行 V-OP 均 `externalCalls=0`。
- 固化路径：`docs/collaboration/部门/开发部/报告/证据/TASK-20260809-D6114C/op-vs1-vs1-happy-001.json` 与 `vop.jsonl`。

### 11.4 清理与未验证项

- receipt 固化后，通过任务专用 `cleanupVs1TaskRoot` 删除 `TASK-20260809-D6114C-M27TUz`；最终扫描无 `TASK-20260809-D6114C-*` 或 `f1plus1-v04-*` 临时目录。
- `app/package-lock.json` SHA-256 仍为 `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3`；没有新增依赖。
- 未验证：数据部、安全部、测试部对该最终候选的独立 ACK；真实 provider/RSS/Base/外部 AI/非 loopback I/O/Admin/发布/部署均继续关闭且不在本任务授权范围内。
