# TASK-20260809-9D61AD 独立收据

## 唯一命令

- 环境：固定 Node `24.18.0` / npm `11.16.0`，`env -i` 0700 clean-room。
- 命令：`npm run test:contract`
- 次数：1
- exit code：0
- stdout：`event=vs1_contract`、`status=ok`、`schemaVersion=vs1-contract-assertion-receipt-v1`、25 cases、`externalCalls=0`、`assertionReceiptHash=98258fe9591688216707afc16dc7a84c8b1a6d370cd9851c275ee3a0e5992e85`。
- 25/25 `assertionResult=PASS`；25/25 `externalCalls=0`。

## 三个绑定 hash

| 对象 | SHA-256 |
|---|---|
| `app/scripts/vs1-contract.ts` | `00591f56b1d148113259bfb21d227138fc7b177a25240befcc1391dcdc73b1e4` |
| 固化 assertion receipt 文件 | `2fcaefd2998ad9b5c4885c5d7b64a1ee290be4c9cf898b98a19f85c99ce08750` |
| `{schemaVersion,cases,externalCalls}` 无换行 core | `98258fe9591688216707afc16dc7a84c8b1a6d370cd9851c275ee3a0e5992e85` |

固化收据路径：`docs/collaboration/部门/开发部/报告/证据/TASK-20260809-3A8C0E/vs1-contract-assertion-receipt-v1.json`。

## 原 P1 精确关闭

- `VS1-RETRY-014`：`HTTP_503/1s → COLLECTION_TIMEOUT/3s → PIPELINE_READY/0s`，attempt=3，最终 exit 0 / `NO_ACTION`。
- `VS1-DEAD-015`：三次 `HTTP_503`，延迟 `1s/3s/0s`，`deadLetterDelta=1`，exit 1 / `ARCHIVE_AND_RESEED_TASK_DB`。
- `VS1-SUMMARY-MISSING-012`、`VS1-PARTIAL-016A..G`、`VS1-APPROVED-017`：`domainRollbackVerified=true`。
- replay：`IDEMPOTENT_REPLAY`、exit 0、`NO_ACTION`。
- no-work：`NO_WORK`、exit 0、`NO_ACTION`。
- 每个 case 均输出 `caseId/reasonCode/exitCode/recoveryAction/assertionResult/externalCalls`。

## 清理

- 候选自带 helper 在唯一命令内清除了所有 VS1 case taskRoot。
- 统筹随后精确删除只含本次 Node compile cache 的 `/private/tmp/TASK-20260809-9D61AD-cleanroom.mCsGk1`。
- 测试部只读复扫 `TASK-20260809-9D61AD-*`、`TASK-20260809-3A8C0E-*`、`TASK-20260809-D6114C-*` 三个前缀，结果均为 `NO_MATCH`。

