# TASK-20260809-C66A73 独立运行收据

## clean-room

- 临时根：`/private/tmp/TASK-20260809-C66A73-cleanroom.IYfbfB`
- 创建权限：`0700`
- 环境：`env -i`，仅传 `HOME`、固定 Node24 优先的最小 `PATH`、`TMPDIR`、`LANG=C`、`LC_ALL=C`
- Node：`24.18.0`
- npm：`11.16.0`
- 收口：整个临时根已删除；扫描无本任务 `TASK-20260809-D6114C-*` 子根；无任务监听进程。

## worker:mock -- --once

- exit code：`0`
- full receipt：`op-vs1-vs1-happy-001.json`，模式 `0600`，2429 bytes
- receipt/artifact SHA-256：`5a73a236124f8d5820dfcbf956eaa166571cd2f973e09f7cf59e87ff082040c3`
- DB SHA-256：`084144e7c8adeaddf03306472c6c97ddf04863a9f6ad0ae94d88aa51c1fd89a2`，与 receipt `dbAfterHash` 一致
- `transactionCommitted=true`；observation/capture/content/event/summary/bundle/audit 各 `+1`；dead-letter `0`
- validator：25 个唯一 case、23 个 candidate attempt、`VS1-SUMMARY-MISSING-012` 为唯一缺 summary 例外

```jsonl
{"functionId":"COLLECT-MOCK-002","status":"PASS","reasonCode":"PIPELINE_READY","artifactHash":"5a73a236124f8d5820dfcbf956eaa166571cd2f973e09f7cf59e87ff082040c3","externalCalls":0,"recoveryAction":"NO_ACTION"}
{"functionId":"CONTENT-PROCESS-003","status":"PASS","reasonCode":"PIPELINE_READY","artifactHash":"5a73a236124f8d5820dfcbf956eaa166571cd2f973e09f7cf59e87ff082040c3","externalCalls":0,"recoveryAction":"NO_ACTION"}
{"functionId":"SUMMARY-MOCK-004","status":"PASS","reasonCode":"PIPELINE_READY","artifactHash":"5a73a236124f8d5820dfcbf956eaa166571cd2f973e09f7cf59e87ff082040c3","externalCalls":0,"recoveryAction":"NO_ACTION"}
```

## test:contract

- exit code：`0`
- stdout：`{"event":"vs1_contract","status":"ok","cases":25,"externalCalls":0}`
- 入口实际运行 23 个结果 case，并单独运行 replay 与 no-work；012 与 016A-G 的 `domainBeforeHash == domainAfterHash` 有断言；replay 要求 receipt 深等与三条 `IDEMPOTENT_REPLAY`；no-work 要求 `receipt=null` 与三条 `NO_WORK`。
- 证据缺口：入口没有断言各 case 的 `recoveryAction`，也没有断言 retry 1s/3s、最多三次、dead-letter/attempt history 的精确值；stdout 只有总数。按任务合同该缺口保持 P1。

