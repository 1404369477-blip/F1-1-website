# F1+1 0007 fence 与 rollback successor 实施合同 v1.0

- 合同状态：`accepted-contract / contract CLOSED_PASS`
- 当前门：`0007-successor-implementation-review-pending`
- Slice1：`successor implementation AUTHORIZED_PENDING / engineering gate BLOCKED`
- SQL/app/tests/data：`NOT_CHANGED`
- ADR：[ADR-F1PLUS1-0007-FENCE-ROLLBACK-SUCCESSOR-001](../decisions/system/2026-08-24-F1+1-0007-fence与rollback-successor-accepted.md)

## 1. 范围

本合同只冻结新0007 successor的fence truth transition、业务rollback operation收敛、身份生成和复审门。它不生成SQL，不授权migration，不提前实现0008/0009/0010，也不改变R3 external pin。

旧0007 frozen candidate全部原字节保留，旧contract/manifest/raw/canonical/post-schema身份统一标记`SUPERSEDED_FOR_IMPLEMENTATION`。新successor必须保留编号`0007`并生成全新身份，禁止静默复用旧SHA。

## 2. 数据合同

### 2.1 singleton

`internal_control`目标合同在既有字段上增加：

```sql
deletion_fence_receipt_id TEXT NULL
  REFERENCES generic_fence_receipt(fence_receipt_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
publication_fence_receipt_id TEXT NULL
  REFERENCES generic_fence_receipt(fence_receipt_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT
```

CHECK固定为相应state=`clear`时receipt id必须非NULL；initial fail-closed seed可为NULL。任何后续state变化必须同时更新对应receipt pointer，pointer变化也必须伴随state变化。trigger必须验证pointer命中的receipt为同operation、同kind、global scope、同old/new state和同epochs；另一个fence state/pointer必须逐字不变。

### 2.2 verified receipt

每份receipt至少绑定：

```text
receiptId
scopeKind=global
scopeId=null
fenceKind=deletion|publication
oldState
newState=clear|blocked|unknown
truthEvidenceIdentitySha256
truthEvidenceSha256
issuer=f1plus1-system-supervisor-v1
issuedByOperationId
operationRequestHash
externalSupervisorHandoffId
externalSupervisorHandoffReceiptSha256
executableIdentitySha256
oneTimeNonce
schemaSha256
releaseSha256
manifestSha256
sourceConfigEpoch
sourceSafetyEpoch
authorizationVersion
policyEpoch
recoveryEpoch
writerEpoch
expectedControlVersion
observedAt
verifiedAt
expiresAt
receiptSha256
```

`receiptSha256`是domain-separated receipt-core hash：hash输入覆盖上述payload中除`receiptSha256`和`externalSupervisorHandoffReceiptSha256`外的全部字段；这两个字段必须排除以禁止self-hash和双向hash固定点。`observedAt`是truth采样时刻，`verifiedAt`是DB外supervisor完成验证并签发handoff的时刻，两者不得互代。生成顺序固定为：先算receipt-core `receiptSha256`；DB外supervisor handoff payload再精确包含`handoffId=externalSupervisorHandoffId`、`authorizedTruthReceiptSha256=receiptSha256`、`authorizedOperationId=issuedByOperationId`、`operationRequestHash`、`executableIdentitySha256`、release/manifest、nonce、`verifiedAt`和`expiresAt`并计算handoff receipt hash；最后DB row保存这两个已确定hash，禁止重新计算含handoff hash的所谓final receipt hash。handoff receipt hash必须逐字等于`externalSupervisorHandoffReceiptSha256`。gateway通过外部verifier核对OS、executable、release、manifest、nonce、时限以及该handoff签发链后，operation只能持久化这份已绑定payload，不能改字段或重新hash冒充签发。operation request hash必须覆盖同一operationId、fence kind、old/new state、receiptId/nonce、truth evidence identity/hash、expected control version、schema/executable/release/manifest、五epoch、writer epoch、issuer和observed/verified/expires；request、handoff、receipt任一字段不等即拒绝。receipt immutable、append-only；相同handoff、nonce、receiptId或truth evidence replay拒绝。

### 2.3 seed

唯一seed为：

`disabled / stopped / clear / fenced / deletion unknown / publication blocked / both receipt pointers NULL`。

migration、startup、readiness、GET、fallback启动和recovery opener均不得把seed自动改为clear，不得生成占位clear receipt。

## 3. owner、operation与capability

唯一singleton fence operation为：

```text
system_supervisor / system_producer / control / fence_update
```

每个phase都必须有exact policy/action row；clear只在disabled或paused通过事务guard，收紧为blocked/unknown允许四phase。删除所有Admin singleton fence-update action row。generic scoped fence签发与singleton fence transition可以共用同一closed operation family，但每个operation必须精确绑定本次receipt和`internal_control:1`，不能使用wildcard policy。

operation entity set固定恰好两项：

1. `generic_fence:<receiptId>`，mutation=`insert`；
2. `internal_control:1`，mutation=`update`。

多一项、少一项、重复项、wrong identity selector或跨entity permit全部拒绝。required input fence set使用机器policy的exact template；不能由caller用空集或额外receipt改变模板。

capability只在持久operation从`requested→authorized`提交后由gateway返回opaque secret。secret不得持久化、序列化、进入JSON/HTTP、由worker自建或在startup重建。operation terminal后、rollback blocked后、lease过期或gateway关闭时必须销毁secret。

## 4. closed transition

一个operation只改变一个fence kind且要求`OLD.state<>NEW.state`：

- `unknown→blocked|clear`；
- `blocked→unknown|clear`；
- `clear→blocked|unknown`。

`unknown|blocked→clear`仅允许control当前phase为`disabled|paused`。其余edge允许四phase。另一个fence state和pointer、phase、global/emergency stop、recovery state、五epoch、writer epoch、writer authority receipt必须不变；仅control version递增1、updatedAt和updatedByOperationId更新。

禁止：clear→clear、unknown→unknown、blocked→blocked、一次改变两项、无receipt更新pointer、只改pointer不改state、只改state不改pointer、把blocked receipt用于clear。

## 5. 唯一事务顺序

每次transition必须在同一个gateway-owned `BEGIN IMMEDIATE` 内按顺序执行：

1. fresh读取operation、owner handoff、control、schema/release/manifest、五epoch和writer epoch；
2. CAS operation state/version、owner/action policy、authorized lease和expected control version；
3. 验证DB外supervisor handoff的executable/release/manifest/nonce/expiry；
4. 验证truth evidence identity/hash、receipt canonical hash、issuer、scope、kind、old/new state、timestamp和epochs；
5. 为两项exact entity binding创建两个一次性write permit；
6. INSERT immutable verified receipt；
7. UPDATE singleton唯一目标state与receipt pointer，`WHERE version=expectedControlVersion`；SQL trigger JOIN同事务内receipt并逐字段验证；
8. consume两个permit；
9. append hash-chained internal-operation audit；
10. post-read receipt/control/epoch/schema/release/manifest；
11. operation写`succeeded`、result hash并COMMIT。

成功路径的receipt、singleton、permit consume、audit和operation `succeeded`必须一次COMMIT。任何一步失败先整笔rollback：singleton、receipt、permit、成功audit和`succeeded`均不出现部分提交；rollback确认后第一步立即revoke并删除内存capability secret，随后才用独立settlement事务CAS原operation为`blocked`、reason=`FENCE_TRANSITION_TRANSACTION_ROLLED_BACK`并写失败audit。postcheck专用reason=`FENCE_POSTCHECK_FAILED`。settlement失败时secret也不得恢复。不得先提交receipt再另事务clear，不得先clear再补receipt。

## 6. CAS、fresh、epoch与audit

- authorize和writer transaction各执行一次fresh reread。
- control必须精确匹配expected version；更新必须changes=1。
- 时间常量固定：`MAX_RECEIPT_AGE_SECONDS=60`、`MAX_RECEIPT_LIFETIME_SECONDS=60`、`MAX_FUTURE_CLOCK_SKEW_SECONDS=5`、`AUTHORIZED_LEASE_SECONDS=60`。比较式为`-5s<=commitAt-observedAt<60s`、`0<expiresAt-observedAt<=60s`、`expiresAt>commitAt`、`commitAt<authorizedLeaseExpiresAt`；超过5秒future skew、超龄、超TTL、lease到期、非法UTC、缺失、时钟Unknown或解析失败均拒绝。writer precheck和postcheck都重验lease未到期。
- receipt的schema/release/manifest、`sourceConfig/sourceSafety/authorization/policy/recovery`五epoch和writer epoch必须逐字等于当前control和operation expected；任何漂移整笔rollback。
- audit至少记录operationId、owner、fence kind、old/new state、receipt id/hash、truth evidence identity/hash、control old/new version、schema/release/manifest、五epoch、writer epoch、reason和result hash；敏感payload不得进入audit。
- postcheck位于success事务COMMIT前。失败时先rollback singleton和success artifacts，再由独立settlement事务把原operation收敛到`blocked / FENCE_POSTCHECK_FAILED`；禁止在rollback的事务中声称blocked已提交。

## 7. business rollback收敛

### 7.1 已知rollback

纯DB composite callback抛错且business `BEGIN IMMEDIATE`明确rollback后：

```text
authorized → blocked
reason_code = BUSINESS_TRANSACTION_ROLLED_BACK
externalCalls = 0
```

不得保持authorized，不得标reconcile_required，不得隐式retry。`terminal_failed`保留给durable attempt的known permanent failure。

gateway在捕获业务异常的`finally`第一步立即把capability标记revoked并从内存secret registry删除，之后才尝试settlement；即使settlement失败且进程仍存活，旧secret也不能重用。随后开启独立`BEGIN IMMEDIATE`：

1. CAS同operation/version仍为authorized；
2. 证明不存在该operation的external attempt；
3. 依据固定SHA的`operation-effect-inventory.json`证明每个bound entity仍为请求preimage，且不存在已提交业务outbox、领域receipt或业务audit效果；
4. 写domain-separated rollback result hash；
5. append internal-operation audit；
6. transition blocked并COMMIT；
7. COMMIT后确认capability secret仍不存在。

业务表、业务audit和业务outbox继续保持rollback后的零变化；internal-operation audit用于记录安全收敛。

### 7.2 orphan authorized

authorized capability必须有持久`ownerSessionId/authorizedAt/authorizedLeaseExpiresAt`，且`authorizedLeaseExpiresAt-authorizedAt=60s`。每次writer precheck、postcheck和普通terminal transition均要求`commitAt<authorizedLeaseExpiresAt`。唯一例外`operation_orphan_block`要求`commitAt>=authorizedLeaseExpiresAt`、session sealed，并在同一`BEGIN IMMEDIATE` snapshot内完成§7.2全部proof、session/operation CAS和audit。lease不能自动续期；时钟Unknown拒绝authorize。startup不恢复secret。

owner session持久表固定为`gateway_owner_session(owner_session_id PRIMARY KEY,owner_process,executable_identity_sha256,release_sha256,manifest_sha256,started_at,lease_expires_at,state active|sealed,sealed_at,seal_reason NULL|PROCESS_EXITED|LEASE_EXPIRED|OWNER_REVOKED,external_session_receipt_sha256,version)`；CHECK要求active时`sealed_at/seal_reason`均NULL，sealed时二者非NULL，唯一edge为`active→sealed`且version+1。只允许DB外owner-supervisor verified handoff创建，seal只由下述cleanup supervisor operation执行，禁止DELETE、反向转换或普通startup补行；缺session行一律Unknown，不能当作process已退出。session一旦sealed，gateway必须在同一控制路径先revoke并删除该`owner_session_id`关联的全部内存capability secret，再允许任何后续settlement；sealed session即使原lease时间尚未到也不能授权或write。

`internal_operation`目标schema增加`owner_session_id TEXT REFERENCES gateway_owner_session(owner_session_id) ON UPDATE RESTRICT ON DELETE RESTRICT, expected_owner_session_version INTEGER, authorized_at TEXT, authorized_lease_expires_at TEXT`。state=`authorized`及其后继非terminal active state时四字段必须非NULL；authorize一次写入后immutable，terminal不得续期或换session；`authorized_lease_expires_at-authorized_at=60s`。authorize、writer precheck、writer postcheck及普通terminal CAS都必须在同一snapshot按FK JOIN该session，逐字要求session `state=active`、`owner_process=operation.owner`、executable/release/manifest与operation expected相等、session version等于`expected_owner_session_version`，并同时满足`authorizedAt>=session.startedAt`、`commitAt<authorized_lease_expires_at<=session.lease_expires_at`；任一不等、session sealed、任一lease到期或Unknown均拒绝并销毁secret。唯一例外是`operation_orphan_block`专用terminal分支：它必须按下段proof要求看到session已sealed，或在同一事务先CAS `active→sealed`再CAS operation blocked；该分支禁止普通业务write和success terminal。

orphan cleanup的exact控制身份为`system_supervisor / system_producer / control / operation_orphan_block`；该新action必须有逐phase closed policy。entity set恰好两项：`internal_operation:<orphanOperationId>` mutation=`update`与`internal_operation_audit:<cleanupEventId>` mutation=`insert`，两项各自一次性permit。owner supervisor只可对以下exact集合执行cleanup：lease已过期；operation仍authorized；session行已sealed，或DB外session receipt与session identity/version证明owner process终止后在同一事务先CAS sealed；无external attempt；完整entity binding逐项重算仍等于请求preimage（insert目标仍不存在，update/delete目标version+hash未变）；所有operation-attributed business outbox、domain receipt和business audit均不存在。查询集合由`operation-effect-inventory.json`按mutation coverage逐table/action/query冻结并固定SHA；missing table/query、未覆盖mutation、动态SQL、count非0或任一Unknown均禁止cleanup。proof、session CAS与operation CAS必须处于同一`BEGIN IMMEDIATE` snapshot。成功把原operation置blocked，reason=`AUTHORIZED_CAPABILITY_ORPHANED`，append audit并告警。

任一证明Unknown时保持fail closed并升级人工恢复；不得clear fence、重放callback、重签capability、创建successor business operation或修改attempt identity。已有`attempt_committed|in_flight|reconcile_required`全部排除，继续same-identity reconcile。

## 8. 必须负例

### 8.1 fence

- Admin/worker/browser/raw repository尝试clear；
- self-signed、缺失、过期、wrong executable/release/manifest handoff；
- startup/migration/GET自动clear；
- 一次改变两个fence；same-state write；clear在backlog/live；
- 无receipt、占位receipt、Unknown receipt、过期或future receipt；
- wrong scope/id/kind/state/issuer/hash/evidence/operation；
- wrong policy/recovery/writer/schema/release/manifest；
- duplicate/extra/missing entity或permit；
- receipt与singleton分两个事务；
- control CAS race、receipt replay、old epoch replay；
- receipt insert后control失败；control/audit/permit/postcheck任一步失败；
- authorizer未安装、callback异常、unknown SQLite action、ATTACH/DETACH/temp object、second writer；
- 每个crash point重启后验证singleton没有部分clear。

所有clear负例固定为：`singleton unchanged / pointer unchanged / no committed receipt / externalCalls=0`。

### 8.2 rollback

- callback第一项、中间项、outbox前、outbox后、audit前抛错；
- business rollback后仍authorized；
- rollback失败路径错误进入reconcile或自动retry；
- settlement CAS conflict；settlement自身rollback；
- gateway在销毁secret前崩溃；
- expired lease但存在attempt/outbox/effect；
- orphan proof任一Unknown；
- startup自动重建capability；
-旧secret、old owner session或old writer epoch replay。

预期：已知纯DB rollback最终blocked；可能越过外部边界的attempt只走same-identity reconcile。

## 9. 新身份生成

身份使用无环`0007-successor-identity-v2`算法，生成顺序不可交换：

1. **source schema**：在existing-only精确inode上按顺序应用受审0001..0006，使用项目sqlite_schema canonical JSON/code-point排序算法重算；预期基线需与受审schema6一致，漂移即阻断。
2. **raw SQL**：`SHA-256(new 0007 SQL UTF-8 raw bytes)`。
3. **canonical SQL**：把新SQL中两处tagged migration canonical 64-hex归零，对完整UTF-8 raw bytes做SHA-256；回填两处后重新归零复算必须一致。
4. **post schema**：从exact schema6执行单次`BEGIN IMMEDIATE` apply，要求`user_version=7 / foreign_key_check=[] / integrity_check=ok`，再按同一sqlite_schema算法重算。
5. **artifact manifest**：候选根内唯一排除路径恰为`manifest.sha256`与`identity-receipt.json`；envelope和anchor必须位于候选根外，候选根出现任何`envelope*|anchor*`文件直接FAIL。其余regular non-symlink内容文件按relative POSIX path的Unicode code point排序，每行`lowercase-64hex + two ASCII spaces + UTF-8 relative path + LF`；拒绝NUL、反斜杠、absolute、`.`/`..`segment、duplicate、symlink，末行有LF。verifier必须证明`candidate regular-file set = manifest entries ∪ {manifest.sha256,identity-receipt.json}`。`manifestRawSha256=SHA-256(manifest bytes)`。
6. **contract identity**：`SHA-256(UTF8("f1plus1-0007-successor-contract-identity-v2\n") || UTF8(canonicalJsonV1({manifestRawSha256,entries:[{path,artifactSha256}...],sourceSchemaSha256,sqlRawSha256,sqlCanonicalSha256,postSchemaSha256})))`。`canonicalJsonV1`固定为：schemaVersion=`canonical-json-v1`；object key按Unicode code point升序且拒绝duplicate key；array保持输入顺序；string必须是有效Unicode scalar且不得做NFC/NFD归一化；escape逐码点固定为：U+0022输出ASCII code-unit序列[U+005C,U+0022]，U+005C输出[U+005C,U+005C]；U+0008/U+0009/U+000A/U+000C/U+000D分别输出反斜杠加ASCII `b/t/n/f/r`；其余U+0000..U+001F输出ASCII反斜杠、`u00`及两位小写hex；solidus U+002F不escape；其余scalar直接UTF-8编码，禁止用`u` escape替代可直接编码字符。只接受null、boolean、string及finite safe integer，拒绝float、NaN、Infinity和`-0`；输出为UTF-8、无BOM、无末尾LF、紧凑`,`/`:`且无额外空白。固定vector：输入object按语义为`{"z":"/","a":"中\\n","n":-1}`，canonical UTF-8 hex=`7b2261223a22e4b8ad5c6e222c226e223a2d312c227a223a222f227d`，byte length=`28`，SHA-256=`9eff116c6bf172b5934ecbc0ca69579dfff1d806bb3a530a3d435443e6cdce5b`。entries逐字等于artifact manifest；receipt和manifest自身均不进入entries；successor verifier必须先逐字通过该vector再计算身份。
7. **identity receipt**：六身份确定后才写`identity-receipt.json`，它只引用已确定值，不参与artifact manifest或contract identity。独立evidence envelope位于候选根外，覆盖artifact manifest、identity receipt、verifier输出和review artifacts；其manifest精确排除自身，外部anchor固定envelope root。禁止receipt/manifest自引用或用字段规范化掩盖环。

新identity receipt必须同时固定source/raw/canonical/post-schema/manifest/contract六身份、`0007-successor-identity-v2`、exact Node/npm/SQLite binary identity、verifier和所有机器矩阵SHA。old/new任一字段混用直接FAIL。

## 10. 重审门与文件集合

必须重审：

- successor SQL、ADR、合同、interfaces、state transitions；
- machine operation/action/required-fence/entity policy；
- authorizer、handoff、capability和second-writer矩阵；
- receipt schema/vectors、rollback/orphan schema/vectors；
- mutation inventory、preflight、backup/recovery runbook；
- offline verifier、receipt、manifest及exact-runtime复验；
- gateway、mutation port、owner supervisor、authorizer、phase、recovery、release pair；
- internal-operation gateway tests、production-faithful schema7 E2E、crash/CAS/concurrency负例；
- full_v7/manual_only_fallback_v7及pair/stage/release verifier；
- 0008、0009、0010和deployment manifest中的全部0007 pin。

门分两级，禁止混用：

1. `0007-successor-contract-review-pending`只审本ADR、实施合同、Function矩阵与Spec同步；该级禁止SQL/app/tests/data写入。独立合同复审`P0=0/P1=0`后进入`0007-successor-implementation-review-pending`。
2. `0007-successor-implementation-review-pending`才允许另行派单生成隔离SQL、六身份、实现和E2E；新身份全量固定、authorizer/crash/CAS/rollback负例通过、production-faithful E2E无workaround且独立实现安全/测试复审`P0=0/P1=0`后，才可关闭Slice1工程门并继续0008。

现行状态：

`contract CLOSED_PASS / 0007-successor-implementation-review-pending / Slice1 successor implementation AUTHORIZED_PENDING / engineering gate BLOCKED`

contract gate关闭前禁止修改或实施SQL/app/tests/data；该门现已`CLOSED_PASS`，只授权另行派发隔离implementation候选。implementation gate关闭前不得继续0008，也不得进行真实DB、M1或production动作。

## 11. NOT_RUN

- successor SQL/raw/canonical/post-schema/manifest/contract identity：`NOT_CREATED`；
- app、SQL、tests、data实现：`NOT_CHANGED`；
- production-faithful schema7 E2E：`NOT_RUN`；
- real DB/M1/backup/restore/network/model/X/publish/deploy：`NOT_RUN`；
- R3 external pin：`UNCHANGED`。

## 12. 合同门正式关闭

独立复审闭包固定为：report SHA-256 `6c73bd52fc2617717302994f1ffe5571db1b2a78bdc05515a01a87a387e5aa8b`；receipt SHA-256 `74e959ca3a321d191d4fd7f02723f94a2b0e843bea685c93be93ac84c02daff8`；manifest SHA-256 `73ef34bb4466beea632b4cee5552be75f045a235682613acc255800f2828ff4f`，根目录`scratch/2026-08-24-0007-successor-contract-independent-review/`，manifest `2/2 OK`。结论为`PASS / P0=0 / P1=0 / P2=0`及`MICRO_PASS / P0=0 / P1=0`。

合同门现为`CLOSED_PASS`，第二门`0007-successor-implementation-review-pending`生效。该状态只授权隔离生成successor SQL、六身份、实现、负例与production-faithful E2E；第二门关闭前，Slice1工程、0008、真实DB、M1和production保持blocked。§11的NOT_RUN仍是当前事实。
