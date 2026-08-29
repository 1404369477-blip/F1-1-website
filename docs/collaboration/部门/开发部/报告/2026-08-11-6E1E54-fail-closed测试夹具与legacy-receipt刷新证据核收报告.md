---
title: TASK-20260811-6E1E54 fail-closed测试夹具与legacy receipt刷新证据核收报告
date: 2026-08-11
department: 开发部
task_id: TASK-20260811-6E1E54
status: final
decision: pass
claimed_by: 开发部/internal-agent:receipt_formalizer
externalCalls: 0
---

# 结论

TASK-20260811-6E1E54 在自身授权边界内完成。当前测试文件的唯一 successor 增量是把 `/tmp` 动态迁移数据库上的 canonical 正向 oracle 调用改为明确预期 `RECEIPT_TAMPER: closed receipt binding changed` 的 fail-closed 断言，`assertLegacyClosedReceipts` import 保留且实际使用。生产冻结常量、validator 实现、SQLite 与 package-lock 没有因本任务修改。

动态执行由统筹会话授权的 `fallback executor` 先行完成：一次固定 Node 24 聚焦批次 `5/5 PASS`，M3 与 public 受控刷新各一次 `exit 0`，真实 canonical `assertLegacyClosedReceipts` 一次 `PASS`。本任务由 `开发部/internal-agent:receipt_formalizer` 领取，只独立重算当前字节、包络、权限、freshness 和残留状态；本报告不把动态执行归功于本任务，也不冒充原开发部 Codex 窗口。

本结论只解除 legacy receipt freshness 与测试夹具阻断。`TASK-20260811-0F65C1` 整链、build、全量测试、Web 服务、网络和公开站可用性均不在本任务内，没有由此获得放行。

# 证据来源分层

## A. fallback executor 已运行收据

以下是统筹会话提供的 `/root/dev_receipt_successor` 原始短收据，当时未落独立日志文件。本任务没有重跑：

| 执行项 | 次数 | 结果 |
|---|---:|---|
| `git diff --check` | 1 | `exit 0` |
| 固定 Node `24.18.0` + Vitest `src/tests/profile-closed-receipt.test.ts --config vitest.config.ts` | 1 | `exit 0`，1 file passed，`5/5 PASS`，duration `1.59s`，tests `1.44s` |
| M3 legacy receipt CLI | 1 | `exit 0`，`restoredM3=false`，DB SHA `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0`，logical root `f6ae0064360f4d79f418e2e5d128199854e6939ae706e7fc1403c258f2962549`，self hash `21b9f5d2f6751cf82278472e609a823654db488416ce0d12267edf06c5acc801`，`externalCalls=0` |
| public legacy receipt CLI | 1 | `exit 0`，DB SHA `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041`，logical root `6be7af63590b1a3e258885691eb35964813b00a27bcb62fca8e6c409d4ca7a3a`，profile self hash `712dec909fba6379b9a0dd0ae7ccbe40b91edde3eb3c12b731f279d3821814e1`，`externalCalls=0` |
| 真实 canonical `assertLegacyClosedReceipts` | 1 | `exit 0`，`{"assertLegacyClosedReceipts":"PASS","externalCalls":0}` |

fallback executor 记录的禁止链调用次数均为 `0`：`0F65C1`、build、full tests、Web 服务、网络。本任务亲自执行这些链的次数同样为 `0`。

## B. 本任务亲自只读核验

本任务亲自执行的操作仅包含 `shasum`、`stat`、`jq`、`cmp`、`rg`、`find` 和标准文本变换的只读复算。没有 import 或调用业务模块，没有打开 SQLite 连接，没有生成新 receipt。

# 测试 successor 字节

| 检查 | 本任务只读结果 |
|---|---|
| 当前测试文件 SHA-256 | `064d5338003bf532e6677950337b714083c0d22fe5f4bf74c5b378e533371d1b` |
| fail-closed 断言精确计数 | `1` |
| `assertLegacyClosedReceipts` import 精确计数 | `1` |
| `assertLegacyClosedReceipts(roots.projectRoot)` 调用精确计数 | `1`，仅位于上述 fail-closed 断言 |
| 将该两行断言在标准输出流中逆变换回旧正向调用后的 SHA-256 | `b4eb27991ee30645ebdfed862abe1e094ff8dccb15efa5ea7c9b09caf0e4cb97`，精确等于 `TASK-20260811-34C7F1` 冻结测试 SHA |

因此，可以把当前 successor 增量唯一归因为上述 fail-closed 断言，不需要修改生产 expectation 迎合 `/tmp` 动态 DB。

# validator 冻结身份

| 对象 | SHA-256 |
|---|---|
| `app/src/server/db/closed-receipt.ts` | `099c571ec2034ad74d6a2ebed3ca501e0414e2c0c262ba0d24b7823bc6ece820` |
| `app/scripts/profile-closed-receipt.ts` | `ecd8706b7962e41660255c4bd11eebdbdad193ccc945f1d8e442bb6cb8e64ea8` |
| 对上述两项 `{path,sha256}` canonical 数组独立复算的 root | `712fe5d6e9d693eaf0d531b481253374d9c5a8b4d912ab4f05157700879f57f2` |
| `app/validator-manifests/legacy-profile-validator-v2.json` | `f88c9d2ef08ed6e20e8a60df3af346a08e6c91012896a97e8aa0c09c7105e0f2` |
| `app/src/server/db/public-multimedia-synthetic.ts` | `047037b73dae8c3ace781c5873b9eb2c606e966cb7bdffbbed83c3dfd11023a9` |

manifest `rootSha256`、runtime `CLOSED_VALIDATOR_SHA256` 与独立复算值三者全等，revision 均为 `legacy-profile-validator-v2`。

# 三份 receipt 与两份 marker

本任务只读复算时，五份 JSON 均为 canonical bytes，删除 `receiptSha256` 后按递归 key 排序 JSON 不带换行重算，五份 self hash 全部与声明值一致。

| 对象 | 文件 SHA-256 | self hash | 绑定 root | 时间 / freshness |
|---|---|---|---|---|
| M3 profile receipt | `8ddf26bd4df59dd1bd2e96d0f2c4d9c428763fd916d1bb6175c9699cf244fa42` | `21b9f5d2f6751cf82278472e609a823654db488416ce0d12267edf06c5acc801` | `712fe5...57f2` | `2026-08-11T12:01:27.338Z`；复核时 age `1211s`，24h `PASS` |
| public profile receipt | `2a018f6875a23cebb67d078278c4bebd7fdb324a36f31bde7d3ae91d18abcc81` | `712dec909fba6379b9a0dd0ae7ccbe40b91edde3eb3c12b731f279d3821814e1` | `712fe5...57f2` | `2026-08-11T12:01:36.400Z`；复核时 age `1202s`，24h `PASS` |
| public data receipt | `235489462fd498faee0a1ce4c81a181d0db80465dde374cd88fabf9282c93021` | `466bd29dabb9334c55956dc18ee28a6178520e53d51b745c3ce78a68e388e395` | `712fe5...57f2` | `2026-08-11T12:01:36.400Z`；复核时 age `1202s`，24h `PASS` |
| M3 marker | `9c36cd85edae6c817bc8839ee2a95ae4dedfe2d6a7ec903800e369a187c49134` | `55d2c74f5ee52743764fc784f85f87bc5e947222ac75ea1e0237b4c7c397697f` | previous `2a8c89...6d83` → current `712fe5...57f2` | 无 freshness 字段；结构绑定 `PASS` |
| public marker | `1eb92c9e68e640aac131a527e34c923f6e99ee041a13ad4f8a51b4cad8d31330` | `cbca89be1de4f0bec6c5e4e158624d15f5f21271227bcc74331c05d0e693aa15` | previous `2a8c89...6d83` → current `712fe5...57f2` | 无 freshness 字段；结构绑定 `PASS` |

五份文件均为当前 uid `501` 所有的普通单链接文件，权限 `0600`；`app/.local/receipts` 和 `app/.local/validator-migrations` 均为真实目录、权限 `0700`。三份 receipt 的 `externalCalls=0`，marker 的 `externalCalls=0`。

# legacy DB 和 lockfile 零漂移

| 对象 | 当前 SHA-256 | inode | mode / nlink | 对照结论 |
|---|---|---:|---|---|
| `app/.local/f1plus1.sqlite` | `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0` | `4199350` | `0600 / 1` | 等于 34C7F1 任务前冻结值和 fallback 执行收据，零漂移 |
| `app/.local/f1plus1-public-synthetic.sqlite` | `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041` | `3093547` | `0600 / 1` | 等于 34C7F1 任务前冻结值和 fallback 执行收据，零漂移 |
| `app/package-lock.json` | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` | — | — | 等于 1FB5FE/34C7F1 冻结值和 fallback 执行收据，零漂移 |

M3 receipt 的 `closedDbSha256`、`logicalContentRootSha256` 与实际 DB/fallback 收据一致；public profile receipt 也与实际 DB/fallback 收据一致。public profile 与 data receipt 共用 `validatedAt=2026-08-11T12:01:36.400Z`、revision、manifest/profile-ledger 绑定，当前没有观察到部分刷新态。

# 残留与范围外 P2

本任务亲自只读检查的任务所属范围内残留结果：

- `app/.local/receipts` 下 transaction、`journal.json`、tmp、lock、candidate、rollback、task-owned backup：`0` 项。
- 两个 legacy DB 的 `-wal`、`-shm`、`-journal`：`0` 项。
- 四类测试临时根 `f1plus1-closed-receipt-*`、`f1plus1-closed-migration-*`、`f1plus1-closed-set-*`、`f1plus1-closed-negative-*`：`0` 项。

执行前已存在的两份 public-multimedia SQLite 备份不属于 legacy receipt transaction：

| 范围外对象 | 当前只读观察 | 判定 |
|---|---|---|
| `app/.local/f1plus1-public-multimedia-synthetic.backup-a9cfdee00431407c.sqlite` | SHA `a1f712aacf0d78664ea9962dfe9902c194422ce099bab968a84d9a2c64cbf50c`，307200 bytes，mtime `2026-08-09T17:10:07+0800` | 范围外 P2；没有 before SHA，不声称本轮前后零漂移，不删除 |
| `app/.local/f1plus1-public-multimedia-synthetic.pre-update-20260809.sqlite` | SHA `b3810f57ba5f3e335ee27bba5a57c445473225f37bcdb50e31a82e41aa6ad3ff`，307200 bytes，mtime `2026-08-09T16:54:58+0800` | 范围外 P2；没有 before SHA，不声称本轮前后零漂移，不删除 |

# 已验证

- fallback executor 原始短收据明确记录一次 `5/5 PASS`、M3/public 各一次受控刷新和一次真实 canonical oracle `PASS`；本任务没有重跑。
- 本任务独立只读确认 successor 测试 SHA、唯一 fail-closed 增量、import/调用精确计数和逆变换 34C7F1 SHA。
- 冻结 validator root 由两个 artifact 当前 SHA 独立复算，与 manifest 和 runtime 常量一致。
- 三 receipt 两 marker 的文件 SHA、canonical bytes、self hash、revision/root、权限、nlink、owner 和 `externalCalls=0`；三 receipt 的24h freshness。
- 两个 legacy DB 与 package-lock 相对前序冻结收据零漂移；DB SHA 与 receipt 绑定一致。
- 任务所属 legacy transaction 残留、legacy DB sidecar 和四类 `/tmp` 测试根均为零。

# 未验证

- 本任务没有亲自动态复现 `5/5`、两次刷新或 canonical oracle；这些仅由 fallback executor 原始短收据支持。
- 两份 pre-existing public-multimedia 备份没有执行前基线，当前只能确认存在、当前 hash/大小/时间；作为范围外 P2 保留。
- `0F65C1`、lint/typecheck/build、全量测试、production HTTP、Web 服务、浏览器与任何外部能力均 `NOT_RUN`。
- 本任务不是独立安全部或测试部复验，不能替代同一候选的后续安全/测试/设计核收。

# 错题自检

- 身份边界：任务以 `开发部/internal-agent:receipt_formalizer` 领取；报告没有写成原开发部窗口亲自重跑或 ACK。
- 证据分层：动态 PASS 属于 fallback executor 收据，本任务仅为当前字节只读复算；两者已分列。
- 首次 self-hash 手工复算命令误把 `jq` 输出末尾换行计入 hash，产生五条虚假 FAIL；立即用 `jq -cjS` 不带换行重算，五份全部精确 PASS。两次均只读，没有修改任何字节。
- 清理边界：只宣称 task-owned legacy transaction/sidecar 零残留；已存在 multimedia 备份保持 P2/Unknown，没有删除或追溯为本轮产物。

机器证据：`app/evidence/TASK-20260811-6E1E54/manifest.json`。

本任务判定：`TASK_STATE_OK`。
