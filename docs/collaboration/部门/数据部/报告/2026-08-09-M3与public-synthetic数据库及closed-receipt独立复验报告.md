---
task_id: TASK-20260809-385B52
department: 数据部
status: final
decision: pass
summary: M3与public-synthetic两库及三份closed receipt独立复算一致，canonical数据库全程未打开SQLite handle，P0=0，P1=0。
external_calls: 0
---

# M3 与 public-synthetic 数据库及 closed receipt 独立复验报告

## 1. 结论与审查边界

对已 ACK 的 `TASK-20260809-8DB77E` 固定候选完成独立数据复验，结论为 `PASS`：

- M3 canonical 数据库、public-synthetic canonical 数据库及三份 closed receipt 的文件身份、权限、hash、closed envelope、数据 root 与冻结 pin 全部匹配。
- canonical 数据库全过程仅做文件级 `lstat`、字节读取、SHA-256 与复制，没有创建任何 SQLite handle。
- schema、ledger、logical root、counts 与 M3 projection 的 SQLite 查询只在 `/tmp/TASK-20260809-385B52-*` 私有副本进行；临时根为 `0700`，副本为 `0600`，连接使用 `mode=ro&immutable=1`，每次仅见 `main`，没有 sidecar，结束后临时根已清理。
- 未运行 receipt generator、profile CLI、worker、seed、migration、测试或实现修复；未重写任何 canonical receipt。
- 审查前后 canonical 数据库、receipt、validator/CLI SHA 全部相同；`externalCalls=0`；P0=0，P1=0。

## 2. 文件身份、权限与 closed 状态

| 对象 | 模式 | 类型 / 链接 | SHA-256 |
| --- | --- | --- | --- |
| `app/.local` | `0700` | real directory | — |
| `app/.local/receipts` | `0700` | real directory | — |
| `app/.local/f1plus1.sqlite` | `0600` | regular, `nlink=1` | `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0` |
| `app/.local/f1plus1-public-synthetic.sqlite` | `0600` | regular, `nlink=1` | `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041` |
| `m3-shadow.closed.json` | `0600` | regular, `nlink=1` | `4309961dd363413444821f29586a15eec96cc18b396a3f8aad44330ec5d5bbdc` |
| `public-synthetic.closed.json` | `0600` | regular, `nlink=1` | `2c5ca3555b108761fb5b224e0cad77a29d8fc16e56d3eb4d6b80448365492803` |
| `public-synthetic.data.closed.json` | `0600` | regular, `nlink=1` | `71286412fcfc04428145b86ba2a174d93417e6604f16883a7a5a87f7e76cacdc` |

两库的 `-wal`、`-shm`、`-journal`、`.journal` 均不存在。第三数据库 `app/.local/f1plus1-public-multimedia-synthetic.sqlite` 不存在。

## 3. 受控副本数据库复算

### 3.1 M3 shadow

| 核验项 | 独立复算值 | receipt | 结果 |
| --- | --- | --- | --- |
| closed DB SHA | `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0` | 同值 | PASS |
| schema fingerprint | `ad2f86e03d9aa8727fe7555729e65a18e4c3986a572ca88cb52cc96245afd23b` | 同值 | PASS |
| migration ledger root | `ea8a4705b512beeaf848d9c61b5a4e71d1c15f78966e040f68197edcd36cb4c6` | 同值 | PASS |
| stored/profile ledger root | `48637139dc9655572677aa003e88c63f3e1263ea47c08cade9d9b09261cea2bd` | 同值 | PASS |
| logical content root | `f6ae0064360f4d79f418e2e5d128199854e6939ae706e7fc1403c258f2962549` | 同值 | PASS |
| 59×39 projection | `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17` | 同值 | PASS |

精确 counts：

```json
{"sources":59,"captured_items":0,"contents":0,"summaries":0,"media_candidates":0,"release_bundles":0,"review_decisions":0,"publications":0,"published_projections":0}
```

另外机械核对 `enabled=false` 为 59/59；八张公开领域表均为 0。M3 artifact revision 为 `m4-vs0-seed-enrichment-manifest-v0.3`，fixture manifest pin 为 `d4da9fc24c792c0471bcd24c525a46dcef1e521b36a870fd111e7310243888b2`。

### 3.2 public-synthetic

| 核验项 | 独立复算值 | receipt | 结果 |
| --- | --- | --- | --- |
| closed DB SHA | `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041` | 同值 | PASS |
| schema fingerprint | `ad2f86e03d9aa8727fe7555729e65a18e4c3986a572ca88cb52cc96245afd23b` | 同值 | PASS |
| migration ledger root | `797cfa512aacebe4bdc39b9ef30504bcbed4a18212cb0e88997b34719d2edafb` | 同值 | PASS |
| stored ledger row root | `0641556828de349f0a5af64043d8f6790bee9a2ff759286459e760199640605a` | 同值 | PASS |
| accepted profile ledger root | `1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1` | 同值 | PASS |
| logical content root | `6be7af63590b1a3e258885691eb35964813b00a27bcb62fca8e6c409d4ca7a3a` | 同值 | PASS |
| fixture graph | `4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526` | 同值 | PASS |

精确 counts：

```json
{"sources":1,"captured_items":12,"contents":12,"summaries":12,"media_candidates":10,"release_bundles":12,"review_decisions":12,"publications":12,"published_projections":12}
```

artifact revision 为 `public-demo-12-v0.4-manifest-v2`，与 public data receipt 完全一致。

## 4. 三份 closed receipt

三份 receipt 均通过：

- UTF-8 原始字节精确等于 `canonical-json-v1(parsed) + LF`；
- duplicate-key detector 零命中；
- key set 与各自 closed envelope 完全相等，无额外字段；
- 仅含项目相对路径，没有绝对路径字符串；
- `externalCalls=0`；
- 排除 `receiptSha256` 后独立计算完整 core hash，与 envelope 声明一致。

| Receipt | validatedAt | 独立复算 envelope hash | 结果 |
| --- | --- | --- | --- |
| M3 profile | `2026-08-09T08:28:04.100Z` | `feb172dd97dc03744dcfdaa7c75caaa9562d1ae43e886e12f6e103f3f1d0a843` | MATCH |
| public profile | `2026-08-09T08:28:04.193Z` | `a6acb4a8593c820c9543f77d618f5b71a31198a51953f10dfb0aa16d3fb70e81` | MATCH |
| public v0.4 data | `2026-08-09T08:28:04.193Z` | `75e2d0e57120dde8b4c691070ff84acaab05fa4f7b9a894a684fe2a712c5984a` | MATCH |

public data receipt 六项冻结 pin 独立计算如下，并与 DB receipt revision / validator artifact 交叉一致：

| Pin | SHA-256 |
| --- | --- |
| manifest | `3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554` |
| fixture file | `c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4` |
| canonical graph | `4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526` |
| profile ledger | `1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1` |
| generator | `34ecfa83fec1f89a22d877e554c4ce5c4d11c1bad6b7f09f123fea3ede1cb81a` |
| validator | `058be83bdded7f5c60028f0a2e537c510e9386934284684fffb119d2e487360c` |

## 5. Validator 身份与失败路径静态复核

源码身份：

| 文件 | SHA-256 |
| --- | --- |
| `app/src/server/db/closed-receipt.ts` | `6466fad6f69912cca2cebcc93a2fd07fc6096fe7582efd37c8d5fc9aa0cf3048` |
| `app/scripts/profile-closed-receipt.ts` | `beeae3aba02b156e095c3622e94648750075cd5c789808a956181f6aa5fddacb` |
| `app/src/tests/profile-closed-receipt.test.ts` | `1e5428e640d8ee44c8a9dc7ad321011553e9342a0cc2d822479def0ee8b5258a` |

模块与 CLI 的 canonical artifact manifest root 独立复算为 `2a8c89ace30b1e9cac876adb0583ec47e43ce6d6806616a58fac7823ca586d83`，与三份 receipt 全部一致。

静态逐项复核结果：

- 固定 canonical app root、固定数据库 basename、固定 receipt allowlist；拒绝绝对路径、`..`、path escape、symlink component、非 current owner、group/world writable 与多 hard-link。
- validator artifact 通过 `O_NOFOLLOW` descriptor 读取，并在读取前后比较 dev/ino/size/mtime/path identity。
- `openSafeDatabase` 建立 `O_NOFOLLOW` 路径 guard，SQLite authorizer 拒绝 `ATTACH/DETACH`；profile validator 同时执行 `assertSingleDatabase`。
- cross-profile 由固定 profile config、profile ledger 与 exact counts/root 共同拒绝。
- 在 SQLite handle 创建前检查 sidecar：非零 WAL、单边 WAL/SHM、未知 SHM 与 rollback journal 均失败关闭；canonical DB 字节在 validation 前后必须相等。
- receipt reader 强制 canonical bytes、自哈希、schema、时间与稳定字段；重复键、额外空白、篡改、旧字节漂移均拒绝。
- receipt 写路径采用同目录 `O_EXCL + O_NOFOLLOW` 临时文件、`fdatasync`、atomic rename 与目录 `fsync`，并固定父目录 identity。
- M3 no-clobber 采用排他 hard-link publish；恢复状态机只接受单一、私有、精确命名候选及可对账 inode/nlink 组合，歧义状态失败关闭。
- 目标测试源码覆盖 ATTACH、cross-profile、DB/receipt/validator symlink、path escape、duplicate key、receipt hash tamper、closed DB byte drift、非零 WAL、hard-link publish 恢复、权限与 sidecar。为遵守本任务“不得重生成 receipt”边界，本次没有再次执行该会生成临时 receipt 的测试。

未发现会改变本任务结论的 P0/P1。

## 6. 审查前后零漂移与临时副本收据

- 两个 canonical DB、三份 receipt、validator module 与 CLI 的审查前后 SHA 完全相同。
- 审查后再次确认 canonical 两库仍为 `0600 regular nlink=1`，WAL/SHM/journal 不存在；第三数据库仍不存在。
- 受控审查临时根：`/tmp/TASK-20260809-385B52-*`；创建模式 `0700`，数据库副本 `0600`。
- 每个副本仅打开一个 `mode=ro&immutable=1` handle；`PRAGMA database_list` 仅含 `main`，路径位于任务临时根。
- 两个副本均未生成 WAL/SHM/journal；完成后任务临时根已精确清理，扫描无残留。

## 7. 已验证 / 未验证

已验证：两库和三 receipt 当前精确 SHA；权限、regular/single-link、relative-path、sidecar absent、第三 DB absent；M3 59×39、59/59 disabled、公开域 0、e7a8 projection；public 固定九项 counts 与 4be9 graph；schema fingerprint、migration/profile ledger root、logical root；三 receipt canonical bytes、closed keys、duplicate-key absent、envelope self-hash、revision 与 validator artifact 绑定；v0.4 六项 pin；实现的 path/no-follow/symlink/ATTACH/cross-profile/nonzero-WAL/canonical-byte/tamper/M3 no-clobber 恢复门；审查前后零漂移；`externalCalls=0`。

未验证：第三 public-multimedia-synthetic profile、scoped migration、Repository/API/前端、多媒体运行链、真实 provider/Base/AI/网络及生产能力均未实施或不属于本任务；本次未执行会生成临时 receipt 的目标测试，也未运行 generator/CLI/typecheck。相关实现测试已有开发任务收据，本报告只采用独立静态复核与受控只读副本机械复算作为数据门证据。

## 8. 错题自检

- canonical 数据库没有被 SQLite、Node `DatabaseSync`、Python `sqlite3` 或 sqlite CLI 打开；所有 SQL 查询仅指向先复制到 `0700` 临时根的副本。
- 没有把文件 SHA、logical root、schema fingerprint、fixture graph、profile ledger root或receipt envelope hash混为同一 scope。
- 没有运行会更新 `validatedAt` 或改写 canonical receipt 的生成入口，也没有 checkpoint canonical 数据库。
- 没有因发现历史 sidecar 事故而重演事故；审查后机械确认 canonical bytes 与 sidecar 状态零漂移。
- 没有修改 validator、ADR、数据库或数据合同来使候选通过；当前 P0=0、P1=0。

## 9. 状态

数据部独立门禁结论：`PASS`。`TASK-20260809-385B52` 可完成并交统筹核收；后继任务是否恢复由统筹部依据任务真值处理。
