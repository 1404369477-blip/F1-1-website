# ADR-F1PLUS1-0007-FENCE-ROLLBACK-SUCCESSOR-001：0007 fence truth 与 rollback 收敛 successor

- 状态：`accepted-contract / contract CLOSED_PASS`
- 当前门：`0007-successor-implementation-review-pending`
- 实施状态：`Slice1 successor implementation AUTHORIZED_PENDING / NOT_IMPLEMENTED / NOT_APPLIED / NOT_DEPLOYED`
- 后继状态：Slice1 implementation候选可另行派发；Slice1工程关闭、0008、0009、0010及production继续blocked
- 实施合同：[F1+1-0007-fence与rollback-successor实施合同-v1.0](../../spec/F1+1-0007-fence与rollback-successor实施合同-v1.0.md)

## 1. 决定

接受一个编号仍为`0007`、身份必须全新的 fence/rollback successor。旧 frozen 0007 的所有文件和证据保持原字节，只把下列身份标记为：

`SUPERSEDED_FOR_IMPLEMENTATION`

| 旧身份 | SHA-256 | 保留规则 |
|---|---|---|
| contract identity | `8dffe664191aab20d70244280e5d95b926c5206f22d788e33391494f93bee5ad` | 原字节保留，只可作为历史证据 |
| candidate manifest raw | `feb9986e9e434dc8d9393f9556ab853e8029877137f3e0e834e93d3cf96c958b` | 原字节保留 |
| migration SQL raw | `ab32bb74fb404656bbdf6f84cc8a6967e18f8ed797f59ec27125291e5c26a163` | 禁止继续实施 |
| migration SQL canonical | `d651a156ad1264562962be13fb1742d2e41bd85d1523284e056f2458a4c44797` | 禁止继续实施 |
| source schema 6 | `396af1d629a1bed95ec846770aaf26a3483d58b4ff28ce9d9f2c876a9987f8a9` | 继续作为候选source基线，须现场复算 |
| disposable post schema 7 | `f3c0c049575b3121cccc8e66438481c70931df461cd941b95aaa54100844ad60` | 旧post-schema，仅作历史证据 |

新successor在生成并通过独立复审前没有可引用的SQL raw、canonical、post-schema、manifest或contract identity。不得把旧值复制到新receipt，也不得把文档accepted解释成migration授权。

## 2. 决策理由

旧SQL存在一条可执行的Admin singleton fence transition，但该路径无需verified truth receipt即可把`deletion_fence_state`或`publication_fence_state`从`unknown|blocked`改为`clear`，还可在一次UPDATE中同时清两项。它只证明Admin operation、handoff和permit存在，无法证明fence truth已经clear。这与旧冻结状态表的“Unknown不能在没有verified successor receipt时直接clear”冲突。

因此新successor必须冻结：

1. one fence / one verified receipt / one operation；
2. singleton fence只由`system_supervisor`写；
3. receipt插入、singleton CAS、permit consume、audit和operation终态处于同一个`BEGIN IMMEDIATE`；
4. 无receipt、Unknown、过期、wrong scope/kind/issuer/hash/epoch/writer/operation或CAS漂移均整笔rollback；
5. 启动、migration、GET、普通Admin或普通环境变量均不能自动clear；
6. DB业务事务已知rollback后，durable operation必须从`authorized`收敛到`blocked`，不能保持可重用授权。

receipt和operation request必须绑定`source_config/source_safety/authorization/policy/recovery`五epoch及writer epoch、target old/new state、truth evidence、expected control version和schema/release/manifest。时间常量固定为receipt age 60秒、receipt lifetime 60秒、future skew 5秒、authorized lease 60秒；比较边界以实施合同§6为准。

## 3. 唯一actor与权限

singleton deletion/publication fence transition的唯一actor为：

```text
owner_process=system_supervisor
operation_kind=system_producer
capability_class=control
control_action=fence_update
```

handoff和truth evidence receipt payload只能由DB外owner supervisor签发。生成顺序固定为先算不含自身及handoff hash的truth receipt-core `receiptSha256`，再由handoff精确pin该hash、`operationRequestHash`、operationId、receiptId、handoffId、executable、release、manifest、一次性nonce、verifiedAt和expiresAt并计算handoff hash，最后truth receipt row保存两hash；禁止双向hash固定点。gateway逐字重算并核对同一签发链。普通Admin、HTTP payload、worker、browser、repository、环境变量、自由CLI参数或operation本身均不能自证truth、签handoff或mint capability。authorized fence operation只负责验证外部签发payload，并在同一writer transaction持久化其immutable receipt row和singleton projection；`issuedByOperationId`记录持久化operation，不把它升级为truth issuer。

`admin_http + phase_control`不再拥有singleton `fence_update` action。Admin仍保留phase、global stop、emergency stop的既定动作；这些动作不能代替deletion/publication truth。

## 4. seed与closed edge

新0007 seed继续fail closed：

```text
phase=disabled
global_stop_state=stopped
emergency_stop_state=clear
recovery_state=fenced
deletion_fence_state=unknown
publication_fence_state=blocked
deletion_fence_receipt_id=NULL
publication_fence_receipt_id=NULL
```

每个operation只允许改变一个fence kind。另一个state和receipt pointer必须逐字不变。same-state UPDATE禁止。

| 目标edge | `disabled` | `paused` | `backlog` | `live` |
|---|---:|---:|---:|---:|
| `unknown→clear` | allow | allow | block | block |
| `blocked→clear` | allow | allow | block | block |
| `clear→blocked|unknown` | allow | allow | allow | allow |
| `unknown↔blocked` | allow | allow | allow | allow |

所有edge都要求同operation verified receipt；进入更严格状态同样要保留truth来源和审计。启动时不自动创建receipt，不自动转换state。

## 5. rollback终态

纯DB composite mutation callback抛错且SQLite已确认业务事务rollback时，operation必须使用现有安全语义`authorized→blocked`，reason固定为`BUSINESS_TRANSACTION_ROLLED_BACK`。该路径不得进入`reconcile_required`，因为没有请求越过进程边界；`terminal_failed`继续保留给durable external attempt的已证明永久失败。

gateway捕获业务rollback后先无条件revoke并销毁内存capability，再开启独立`BEGIN IMMEDIATE`，CAS同一operation/version，依据固定SHA的operation-effect inventory证明没有external attempt、全部bound entity仍为preimage、没有已提交业务outbox/receipt/audit效果，写result hash和internal-operation audit并置`blocked`。settlement失败继续fail closed并告警，secret不得因settlement rollback恢复。

authorized capability必须绑定精确60秒owner-session lease。operation通过FK固定owner session和expected session version；authorize、writer pre/post和普通terminal CAS都须在同一snapshot JOIN并证明session仍active、same owner/executable/release/manifest/version，且operation lease不晚于session lease。`operation_orphan_block`是唯一sealed-session terminal分支，只适用实施合同§7.2的expired-lease与完整effect-proof条件。session sealed时先销毁所有attached内存secret，未过期operation也不能继续write。进程崩溃后，owner supervisor只可按固定effect inventory，把lease过期、无attempt、entity仍为preimage且无已提交业务outbox/receipt/audit效果的orphan operation机械置`blocked`并审计；禁止自动重授权、重放、retry、clear fence或创建新capability。`attempt_committed|in_flight|reconcile_required`继续走same-identity reconcile，不能走orphan cleanup。

## 6. 身份与复审门

新successor必须按无环`0007-successor-identity-v2`重新生成；六身份确定后写identity receipt：

- source schema 6 fingerprint；
- new SQL raw SHA-256；
- new SQL canonical SHA-256；
- new disposable post-schema 7 fingerprint；
- artifact manifest raw SHA-256；
- new contract identity；
- verifier、machine policy、authorizer matrix、mutation inventory及其SHA；
- old identities与`SUPERSEDED_FOR_IMPLEMENTATION`关系。

artifact manifest明确排除manifest自身、identity receipt和envelope/anchor；contract identity绑定manifest raw、entries及source/raw/canonical/post-schema；identity receipt不反向参与manifest或contract identity。完整算法、事务合同和负例见实施合同。

门分两级：第一门contract review只审文档并禁止SQL/app/tests/data写入；其独立复审已达到`P0=0/P1=0`并进入implementation review pending，现可另行派单生成隔离SQL、六身份和E2E。implementation review未以`P0=0/P1=0`关闭、任一身份Unknown、old/new混用或E2E仍含workaround时，Slice1工程门继续blocked。

`contract CLOSED_PASS / 0007-successor-implementation-review-pending / Slice1 successor implementation AUTHORIZED_PENDING`

## 7. 保持不变的边界

- R3 external envelope pin原字节和语义保持不变；本ADR不重新签发或覆盖它。
- 旧accepted ADR、旧frozen 0007目录、旧R4/exact-runtime证据、旧Slice1报告均不改字节。
- 本ADR没有修改app、SQL、测试、data、DB、M1、服务、网络、密钥、模型、发布或production。
- `PRODUCTION-DEPLOYMENT-MANIFEST`仍是生产瞬时值与不可逆动作的唯一门。

## 8. 合同独立复审关闭 pin

独立复审结论为`PASS / P0=0 / P1=0 / P2=0`，canonical escaping等价微复核为`MICRO_PASS / P0=0 / P1=0`：

- report：`scratch/2026-08-24-0007-successor-contract-independent-review/report.md`，SHA-256 `6c73bd52fc2617717302994f1ffe5571db1b2a78bdc05515a01a87a387e5aa8b`；
- receipt：`scratch/2026-08-24-0007-successor-contract-independent-review/receipt.json`，SHA-256 `74e959ca3a321d191d4fd7f02723f94a2b0e843bea685c93be93ac84c02daff8`；
- manifest：`scratch/2026-08-24-0007-successor-contract-independent-review/manifest.sha256`，SHA-256 `73ef34bb4466beea632b4cee5552be75f045a235682613acc255800f2828ff4f`，内容校验`2/2 OK`。

因此合同门正式`CLOSED_PASS`，仅授权另行派发隔离的Slice1 successor implementation候选。新SQL、六身份、实现与无workaround E2E仍待第二门复审；Slice1工程关闭、0008及production继续blocked。历史FAIL、旧0007 frozen bytes与R3 external pin均保留。
