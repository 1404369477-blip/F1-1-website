# 旧 profile 封闭收据代码 ADR

- 日期：2026-08-09
- 任务：`TASK-20260809-8DB77E`
- 状态：implemented candidate，等待数据部独立复验
- 范围：`m3-shadow`、`public-synthetic` 与 v0.4 data pins
- 明确关闭：第三 SQLite、scoped 0003、Repository、V1/V2 API、公开前端、Admin、真实外部 I/O

## 1. 决策

采用一个 profile-scoped validator 模块和一个只接受精确 profile ID 的 CLI。每次 CLI 进程只创建一个 `DatabaseSync`，只打开所选 profile 的 canonical SQLite；禁止 `ATTACH/DETACH`，禁止读取另一 profile 数据库，禁止文件复制导入。

命令入口：

```text
<Node 24.18.0> --experimental-strip-types scripts/profile-closed-receipt.ts m3-shadow
<Node 24.18.0> --experimental-strip-types scripts/profile-closed-receipt.ts public-synthetic
```

CLI 只接受上面两个精确参数；无参数、额外参数或其他 profile 均失败关闭。命令没有网络模块、provider/Base、subprocess 或 HTTP 行为，收据固定 `externalCalls=0`。

## 2. M3 恢复

当 `app/.local/f1plus1.sqlite` 不存在时：

1. 在 `app/.local/.m3-restore-*` 私有临时目录创建同 basename 候选；
2. 使用现有 `0001/0002/0003` 与现有 `seedSourceFixture`；
3. 校验 migration schema/ledger、59×39 Source、59/59 disabled、`e7a831…9f17` projection、M3 profile ledger 与公开领域表全空；
4. `wal_checkpoint(TRUNCATE)` 达到 `busy/log/checkpointed=0/0/0`，关闭唯一 SQLite handle，确认无 WAL/SHM/journal；
5. 使用同文件系统的排他 hard-link publish：canonical 目标已存在时 link 失败且禁止覆盖，安装后立即删除候选 link 并要求 canonical `nlink=1`、`0600`；
6. 任一步失败只清理已证明属于 `.m3-restore-*` 的 allowlist 临时文件，不改其他工作区文件。

canonical 已存在时不 rebuild、不 seed，直接进入封闭校验。目标在检查后出现、属于 symlink/hard-link 或 profile ledger 不匹配时拒绝。

hard-link publish 的崩溃窗口由固定恢复状态机封闭：只认唯一 `.m3-restore-XXXXXX`、`0700`、当前 owner、目录内唯一 `f1plus1.sqlite`；canonical 与 candidate 必须同 dev/ino 且恰好 `nlink=2` 才允许完成 candidate unlink，canonical 缺失时只允许 `nlink=1` candidate 重新走完整 migrate/seed/validate。空目录只在 canonical 为安全单链接或目标缺失时清理。多候选、额外文件、identity 不同或 link count 不符均停止。receipt 只能在 canonical `nlink=1`、候选目录消失、父目录 fsync 后生成。

## 3. public-synthetic 校验

`app/.local/f1plus1-public-synthetic.sqlite` 必须已存在。validator 只执行：

- v3 schema/migration ledger 校验；
- 固定 v0.4 manifest、fixture、generator、validator root 校验；
- `1/12/12/12/10/12/12/12/12` counts 与全部 stored canonical payload 校验；
- `wal_checkpoint(TRUNCATE)`、关闭、无 sidecar 与 closed DB SHA；
- 打开前/关闭后 DB SHA 必须相同，保证本次校验没有改变旧库字节或逻辑内容。

不调用 public seed，不修表，不写业务行。

## 4. root 公式

所有 root 使用 `SHA-256(canonical-json-v1(value))`：

- `schemaFingerprintSha256`：复用 `database.ts` 已冻结的 `sqlite_schema + table_xinfo + index + FK` 快照，必须精确等于 v3 `ad2f86…d23b`；
- `migrationLedgerRootSha256`：`migration_ledger` 全列、全行，列按 `cid`，行按 canonical bytes 排序；
- `storedProfileLedgerSha256`：`fixture_profile_ledger` 全列单行快照；
- `profileLedgerRootSha256`：public 使用 frozen profile-ledger 文件 root `1f7719…af1`；M3 的历史 ledger 外部 root 仍为 `NULL`，收据使用完整 stored ledger row root，不回写旧表；
- `logicalContentRootSha256`：除 `migration_ledger` 外的 12 张旧 schema 逻辑表，包含 fixture/source/profile ledgers 与全部公开领域表；列按 `cid`，行按 canonical bytes 排序；
- `validatorArtifactSha256`：validator 模块与受控 CLI 两个文件的 `{project-relative path,file SHA}` canonical manifest root。

SQLite bytes、schema、migration ledger、profile ledger、逻辑内容分开绑定，避免用单一计数冒充完整性证明。

## 5. receipt envelope

固定文件：

- `app/.local/receipts/m3-shadow.closed.json`
- `app/.local/receipts/public-synthetic.closed.json`
- `app/.local/receipts/public-synthetic.data.closed.json`

目录固定 `0700`，文件固定 `0600`、regular、single-link。receipt 只含项目相对路径。写入使用同目录 `O_EXCL + O_NOFOLLOW` 临时文件、`fdatasync`、atomic rename、目录 `fsync`。

每个 envelope 的 `receiptSha256` 是排除自身后的完整 core canonical SHA。已有 receipt 必须先通过 schema、时间、权限和自哈希校验；新一轮 stable fields 必须与旧 receipt 全等，只允许 `validatedAt` 与由此派生的 `receiptSha256` 改变。DB bytes、validator artifact、revision、root、counts 任一漂移均拒绝覆盖旧 receipt。

reader 还要求原始 UTF-8 字节逐字等于 `canonical-json-v1(parsed) + LF`，因此重复键、额外空白、额外换行即使 parse 后值相同也会被拒绝。receipt 目录在 chmod 前先 lstat 确认 real directory；写入前后同时固定 `.local` 与 `receipts` 的 dev/ino。validator 模块与 CLI 路径固定在 canonical project root，逐组件拒绝 symlink/group-world writable，再以 `O_NOFOLLOW` 打开并比较 descriptor/path identity、size 与 mtime。

public data receipt 与 public DB receipt 共用 `public-demo-12-v0.4-manifest-v2` revision，并绑定：

```text
manifest  3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554
fixture   c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4
graph     4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526
ledger    1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1
generator 34ecfa83fec1f89a22d877e554c4ce5c4d11c1bad6b7f09f123fea3ede1cb81a
validator 058be83bdded7f5c60028f0a2e537c510e9386934284684fffb119d2e487360c
```

## 6. 安全与并发边界

- canonical app root、`.local`、receipt dir 和 DB basename 均为固定 allowlist；拒绝绝对路径、`..`、symlink chain、非当前用户、group/world 权限和多 hard-link。
- `openSafeDatabase` 继续承担 parent identity、`O_NOFOLLOW` guard、SQLite inode identity、WAL/FULL/busy/FK/temp/trusted-schema 与 ATTACH authorizer。
- 旧库打开前只允许 sidecar 完全不存在，或唯一已知的只读关闭残留形态：private regular single-link WAL 精确 `0` 字节并与 private regular single-link SHM 精确 `32768` 字节成对出现；非零 WAL、未知 SHM、单边 sidecar 或 rollback journal 在创建 SQLite handle 前拒绝，避免“先 recovery 改 main、后报 drift”。
- 旧库在打开前与关闭后逐字 SHA 相等；M3 新候选位于不可预测的 `0700` 临时目录。两条路径共同关闭“逻辑 root 读取后被其他连接改写”的窗口。
- receipt 自哈希和唯一 canonical encoding 用于检测 accidental/unauthorized byte drift；它没有冒充签名或密钥认证。后继 launcher 仍须按 accepted 合同复核 validator SHA、receipt hash、DB 当前 SHA、revision 和 sidecar 缺失。

## 7. 回退与后继门槛

本任务不自动删除已恢复的 M3 canonical 或任何 receipt。若独立数据复验失败，BA9999 继续 blocked；后继受控任务可依据 closed DB SHA、receipt SHA 与 temp ownership 移动本任务产物到可恢复隔离位置。第三 profile 实施仍须等待本任务被 ACK，并按其独立 migration selector/data/runtime 合同执行。
