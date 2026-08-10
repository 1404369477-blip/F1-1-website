---
type: development_delivery_report
status: final
decision: fail
date: 2026-08-02
department: 开发部
task_id: TASK-20260802-158240
domain_stage: M4-C-VS0-local-foundation
blocking_gate: M4-local-SQLite-same-uid-threat-model-user-confirmation
---

# M4 VS-0 安全地基与 fixture provider 实现报告

## 1. 唯一结论

**FAIL。**

VS-0 的实现与本地运行验收已完成：Node `24.18.0` / npm `11.16.0` 下两次完整
`npm run check` 均 exit 0；新建隔离 DB 首次 migration 应用 v1/v2，59×39 seed
首次 `inserted=true`，重复 migration/seed 分别为 `applied=[]`、`inserted=false`；
32/32 个 Vitest 用例通过；lint、typecheck、Next production build、loopback health
均通过，58 个 app 非生成文件的前后 SHA-256 清单两轮完全相同。

当前不能给 VS-0 最终安全 PASS。Node 24 `node:sqlite` 的 `DatabaseSync` 仍以 pathname
打开主库和 sidecar，无法接收已由应用以 `O_NOFOLLOW` 打开的 fd，也没有本轮获准的
broker/VFS/openat 隔离层。当前实现已把普通误配、链接替换、权限、owner、主库 inode、
sidecar 和 ATTACH 面缩窄，并在 health 明示
`filesystemIsolation=local_trusted_user`、`toctouProof=false`、
`networkEnforcement=pending`。恶意同 UID 进程的瞬时竞争仍未被强证明排除；现行 accepted
R5 保持强 TOCTOU 要求。产品部 `TASK-20260802-214FED` 的方案 B 仍为 proposed，明确要求
用户接受 owner-only 本地单用户威胁模型并另建 successor ADR。在该用户门禁和新的独立
安全复验完成前，本报告保持 FAIL；不代替用户接受方案 B。

开发部当前自审分类为 `P0=1（上述合同/威胁模型阻断）`、`P1=0`。P1=0 只代表本轮
代码修正后的开发自审，不能覆盖安全部对旧 snapshot 的终审结论；需安全部按本报告核心
SHA 重新独立复验。

## 2. 本轮落盘范围

### 2.1 migration、schema receipt 与 ledger

- 保留既有 `0001_local_foundation.sql` 与 `0002_source_fixture.sql` 字节，不改写已应用
  migration；当前 SHA-256 分别为
  `9c8c083b8f3c566023e9438c254d5b1c09d87430dec08f6e6905ed84b6fb3176`、
  `12a755754744689f977ac8b8d5d4443ec63cd5612aaff50eb920badf1ebfb031`。
- `database.ts` 新增逐版本 object manifest。每条 migration 执行前，任何同名
  table/view/index/trigger 均以 `MIGRATION_PRECLAIM` fail closed，`IF NOT EXISTS`
  无法再让预建弱对象静默获得 ledger/user_version。
- 每次 migrate 及每次 seed 都从 `sqlite_schema`、`pragma_table_xinfo`、
  `pragma_index_list`、`pragma_index_xinfo`、`pragma_foreign_key_list` 生成确定性 snapshot，
  对比静态 receipt：v1
  `512ac36dd348860362380372bb3c1ae3001272fe68d64a9233068493a1b36f5e`；v2
  `f1beab525006000a5877327fefde6981f05798439ab246319c3a5a63629f2f1a`。
  该 snapshot 覆盖列、类型、NOT NULL、PK、default、CHECK 的 canonical SQL、唯一索引、
  partial-index WHERE、index columns/collation/order 和 FK。
- schema receipt 和 `PRAGMA integrity_check` 在写入 `user_version`/ledger 前位于同一
  `BEGIN IMMEDIATE` 事务内；任何不一致都会回滚本版本。
- ledger 按 v1..current 精确核对记录数量、排序、`migration_id`、canonical
  `applied_at`、可审计 `sqlite_version`、migration SHA 和 `append_only=1`；文件 hash
  漂移返回 `MIGRATION_DRIFT`。
- v1/v2 未新增 UPDATE/DELETE trigger，避免原地改写历史 migration 或擅自创建 v3。
  当前 append-only 由应用唯一写路径和每次访问 fail-closed 校验保证；它不构成 SQLite
  层物理不可变。通过其他 SQLite 客户端进行 live UPDATE/DELETE 的瞬间仍可能发生，
  下一次 migrate/seed/health 会拒绝该漂移。

### 2.2 SQLite 路径、连接和事务

- local `F1_DB_PATH` 仅接受 `.local/<单一 basename>.sqlite`；local npm dev/start
  固定并验证 `127.0.0.1:3000`。测试根也只允许一个直接 basename，禁止嵌套。
- 启动设置 `umask 077`；检查 app root、`.local`/测试根、parent、DB 及 sidecar 的当前
  owner uid；目录 0700，DB/WAL/SHM/journal/backup 0600，final file 和 sidecar 必须
  regular、single-link。
- 主库先用 `O_NOFOLLOW`；记录 app/root/parent/final dev+ino；SQLite 构造后核对
  `database.location()`/realpath，并以 `/dev/fd` 构造前后同 inode descriptor 数量增量
  确认 SQLite 保持该 inode 打开。构造后及 PRAGMA 后再次核对全链身份。
- 合法的 private WAL/SHM crash residue 会在构造前接受严格检查，允许 SQLite 恢复；
  symlink/hardlink/权限或 owner 异常 sidecar 在 SQLite 接触前拒绝。
- `DatabaseSync` 显式使用 `allowExtension=false`、`defensive=true`、`timeout=250`；连接
  固定 WAL、`synchronous=FULL`、`foreign_keys=ON`、`busy_timeout=250`、
  `temp_store=MEMORY`、`trusted_schema=OFF`。authorizer 拒绝 ATTACH/DETACH；重新开启
  extension 会失败。
- `withImmediateTransaction` 只在 callback 执行前对 SQLITE_BUSY/LOCKED 做 3 次有界
  获取尝试和固定短 backoff；callback 一旦开始不会被重放。锁持续占用时返回
  `LOCK_CONTENTION`。

### 2.3 fixture、59×39 seed 与 provider

- `validateFixturePath` 检查使用中的 allowed root 及每个中间路径组件，拒绝 root/中间/
  final symlink、hardlink、非当前 owner、group/world-write、越界和非 regular file。
- fixture 上限为 16 MiB；以 `O_NOFOLLOW` fd 读取固定 fstat size，读前/读后核对
  dev/ino/size/mtime/uid/nlink/mode，并从同一份稳定 bytes 计算 hash 和 JSON parse。
  provider 不再在校验后重新按 pathname 读取。
- 原始 M3 provider 保留冻结 59×33 字节合同；Source seed 单独读取 accepted
  33→39 implementation bridge。bridge/mapping/schema/projection 的 pinned hash、39字段、
  59 行、双唯一、排序、conservative defaults 和 59/59 `enabled=false` 每次重验。
- 59 行写入与 `source_seed_ledger` 同处一个 `BEGIN IMMEDIATE`；已有 ledger 时重算实际
  DB projection hash，空 ledger + 非空 rows、ledger drift 或任一 enabled 行均拒绝。

### 2.4 health、启动门与日志

- health 不再硬编码 ready。它验证 runtime config、capability、DB schema/ledger/
  integrity、bridge hash、seed ledger 和 59 行 projection；失败只返回安全
  `not_ready/unverified`，不存在 DB 时不会创建文件。
- `runtime:assert-ready` 不执行 migration 或 seed；打开 SQLite 可能完成 WAL 恢复与
  sidecar 维护。`dev`/`start` 在同一 script 内先运行该门禁。项目 `.npmrc` 为
  `ignore-scripts=true`，因此实现没有依赖会被跳过的 npm pre-hook。
- npm dev/start 显式绑定 `127.0.0.1:3000`；local APP_PORT/ORIGIN 漂移返回
  `APP_COMMAND_PROFILE`。
- `/api/health` ready 为 HTTP 200，not_ready 为 HTTP 503；DTO 不输出绝对路径、URL、
  secret、source id 或原始 payload，并明确本地单用户/TOCTOU/R12 的真实边界。
- 结构化日志运行时校验 safe key、level、label/ref/hash/attempt 和
  `externalCalls===0`。发现任一 unknown/private/格式异常字段时，只输出固定
  `event=redacted_incident`、`reasonCode=redacted_fields` 及已确认安全的 level/
  externalCalls 字段；URL、路径、opaque ref、非法 hash 和 `externalCalls=1` 不会透传。

### 2.5 操作说明

- `app/README.md` 已从“33→39 bridge 阻断、seed exit 2、check 停止”的旧状态改为
  当前 59×39 seed、runtime readiness、loopback 启动、schema receipt 与残余门禁。
- `worker:mock` 与 `test:contract` 继续为显式 pending 非零命令；完整 R12、VS-1–3、
  Repository 业务能力、真实 provider/Base/Collector/采集/AI/媒体/表单/发布/部署仍关闭。
- 未新增依赖、未运行 install/ci、未修改 lockfile；`package-lock.json` SHA-256 仍为
  `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3`。

## 3. 机械验证收据

所有正式命令使用项目隔离工具链
`app/.local/toolchains/node-v24.18.0-darwin-arm64/bin` 和最小环境；未访问互联网、真实
provider、Base 或其他外部服务。

| 验证 | 结果 | 收据 |
|---|---:|---|
| 新 DB 首次 `db:migrate` | PASS | `applied=[0001,0002]`；user_version=2；SQLite 3.53.1；WAL/FULL/FK/temp_store/busy_timeout 全部符合 |
| 新 DB 首次 `seed:fixtures` | PASS | `inserted=true`；59×39；59 disabled；writesToBase=false；externalCalls=0；projection=`e7a831...9f17` |
| 同 DB 重复 migrate/seed | PASS | `applied=[]`；`inserted=false`；记录和 projection 不增不漂移 |
| `runtime:assert-ready` | PASS | status=ready；DB mode `-rw-------`，owner 为当前用户 |
| `npm run test` | PASS | Vitest 1 file、32/32 tests |
| `npm run lint` | PASS | exit 0，无 warning |
| `npm run typecheck` | PASS | strict TypeScript exit 0 |
| `npm run build` | PASS | Next 16.2.11；`/`、`/api/health` dynamic；NFT warning 已清零 |
| `npm run check` 第一次 | PASS | verify→migrate→seed→runtime-ready→test→lint→typecheck→build 全部 exit 0 |
| `npm run check` 第二次 | PASS | 全链再次 exit 0；58 个非生成 app 文件 SHA 清单与第一次及执行前一致 |
| `npm run start` + loopback health | PASS | bootstrap 先输出 ready；Next 仅显示 `127.0.0.1:3000`；GET `/api/health` 返回 ready、Node24、SQLite3.53.1、59-source-disabled 和 pending enforcement 边界 |
| missing DB 启动负例 | PASS | start exit 1；`HEALTH_DB_MISSING`；未创建目标 DB |
| local 端口漂移负例 | PASS | APP_PORT/ORIGIN=3010 时 exit 1，`APP_COMMAND_PROFILE` |

## 4. 32 个测试覆盖的主要失败路径

- 错误 Node、非 loopback host、origin 漂移、真实 I/O/provider 开关、未知/secret/proxy
  环境变量；
- fixture allowed-root/中间/final symlink、hardlink、越界、missing、owner/权限合同、
  16 MiB 上限和稳定 fd bytes；
- 日志 secret/private payload、URL/path、非法 hash、opaque ref、`externalCalls=1`；
- health 缺 DB 不创建、迁移/seed 完成后 ready，DTO 无路径或 secret；
- fresh/repeated migration、rollback、39列、WAL/FULL/FK/temp_store/timeout、0600；
- 预建弱 table、同名 view/index/trigger、伪 ledger；
- applied schema 加列、删索引、错误 partial-index WHERE、伪造 ledger field；
- ledger table/record 缺失、user_version ahead、schema/ledger 每次 migrate/seed 重验；
- 59×39 seed 双次幂等、59 disabled、accepted projection hash；
- BEGIN IMMEDIATE 持锁有界失败、callback 0 次，解锁后 callback 仅 1 次；
- `.local`、final、parent symlink，nested DB path，sidecar symlink/hardlink；合法 WAL/SHM
  并发/恢复路径；ATTACH 与 extension enable 拒绝。

## 5. 首轮问题、修复与作废收据

1. 安全终审在旧 snapshot 机械复现 `IF NOT EXISTS` 弱表绕过；已用 object preclaim、
   schema receipt、ledger 精确校验及对应负例收口。
2. 旧实现 health 静态 ready、fixture 二次 pathname read、单次 BEGIN、日志运行时接受
   `externalCalls=1`、README 仍写 bridge blocked；本轮均已修正并加入负例。
3. 初版 sidecar 强化一度拒绝任何既存 WAL/SHM，会破坏正常 crash recovery/并发；复核后
   改为构造前严格验证合法 private sidecar，并同时保留恶意链接拒绝测试。
4. 初版 dev/start 使用 npm predev/prestart；真实启动发现 `.npmrc ignore-scripts=true`
   会跳过该 lifecycle。门禁已内联到 dev/start 同一 script；重新实跑证实 bootstrap 在
   Next 启动前执行，missing DB 会阻断且不创建文件。
5. 一次组合命令只在首个 npm 子命令前设置 PATH，后续 test 回落到系统 Node25，产生
   19 个 NODE_VERSION 预期拒绝。该收据作废；随后使用 `export PATH` 或每条 `env -i`
   固定 Node24，focused test、两轮完整 check 和 live start 均通过。
6. Next build 曾因动态文件路径产生 NFT whole-project tracing warning；在保留 runtime
   外部 fixture/migration 读取的前提下，为受控动态 fs/path 调用增加 Turbopack ignore
   标记，最终两轮 build warning=0。

## 6. 未验证、残余风险与停止条件

- **阻断 P0：** 恶意同 UID 并发进程仍可能针对 pathname reopen/sidecar 时间窗竞争；
  当前防御降低窗口并提高可检测性，health 明示 `toctouProof=false`。用户尚未接受
  owner-only 单用户威胁模型，successor ADR 尚未创建，安全部尚未对当前核心 SHA
  重新终审。accepted R5 和 VS-0 最终安全门禁保持阻断。
- migration ledger 没有 SQLite UPDATE/DELETE trigger；当前保证是应用路径 append-only
  与下次访问 drift fail-closed。若后续需要物理不可变，应追加新 migration，不能原地改
  v1/v2。
- 完整 R12 OS/系统调用级 DNS/HTTP/raw socket/subprocess/child_process deny-all 仍为
  pending；health 明示 `networkEnforcement=pending`。本轮只证明 fixture-only 路径无
  主动外部调用，未将它扩写为进程沙箱收据。
- `/dev/fd` identity 增量门依赖当前 Darwin 本地运行环境；Linux/Windows、共享账号、
  网络文件系统、容器共享目录、多用户与生产存储均未验证、未放行。
- worker:mock、test:contract、VS-1–3、admin/session/CSRF、生产角色/存储/备份、真实
  provider/Base/Collector/采集/AI/媒体/表单/发布/部署/付费能力未实现或未授权。
- 当前只验证 loopback start/health；没有外部端口、域名、TLS、部署或公网收据。

停止条件：用户不接受方案 B 时保持当前 FAIL，转方案 A（broker/VFS/OS 隔离）或方案 C
（暂缓）；用户接受方案 B 后仍须先落 successor ADR/Spec 范围和独立安全复验，P0=0、
P1=0 后才可由统筹决定 VS-0 安全 PASS。任何新 schema/fixture/lock/路径/权限/外联漂移
均立即 fail closed，VS-1 与外部能力继续关闭。

## 7. 错题自检

- 没有把 32/32 tests、两轮 check 或 loopback health 扩大解释为强 TOCTOU、完整 R12、
  VS-1 或生产放行。
- 没有把 `/dev/fd` 计数、location()/realpath 和 pre/post inode 检查写成 fd/VFS 绑定证明。
- 没有替用户接受产品部方案 B，也没有修改 Spec、accepted ADR、data 或 design。
- 没有原地修改 v1/v2 migration，没有把代码级 ledger drift 检测写成物理 append-only。
- 没有删除共享 `.local/f1plus1.sqlite`、node_modules 或工具链；新建验收 DB 位于 gitignored
  `.local/vs0-acceptance.sqlite`，用于首次/重复命令收据。
- 没有安装依赖、执行 npm ci、访问互联网或触发真实外部 I/O；唯一 socket 收据为授权
  范围内的 `127.0.0.1:3000` 本地 health。
- 保留安全旧 snapshot 的 FAIL 历史；本报告要求按当前 SHA 独立重验，不用开发自审覆盖
  安全结论。

TASK_STATE_OK
