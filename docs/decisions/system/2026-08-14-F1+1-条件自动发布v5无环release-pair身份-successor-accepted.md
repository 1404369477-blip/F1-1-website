---
type: system_adr
status: accepted
date: 2026-08-14
department: 产品部
decision_id: ADR-M5-BACKLOG-AUTO-PUBLISH-003
authorization_state: inherited_user_confirmed_scope_no_new_choice
authorization_evidence_ref: 2026-08-14 当前主会话用户消息，message ID unavailable
implementation_state: contract_accepted_code_pending
runtime_phase: disabled
supersedes_decision_id: ADR-M5-BACKLOG-AUTO-PUBLISH-002
supersedes_scope: 双release构建身份、pair锚、stage验证与0005迁移入口身份
predecessor_002_sha256: 329b8680d44bc0877abd176ba8f5b104c35c336ca914a22f1f898996ab357a49
predecessor_v0_2_sha256: a9b2ff909d5e5107f05d1445cbc336d3e7370e3a118f1c9d4cb104d1eb3de0b3
review_input: scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review-apc8.md
review_input_sha256: 87501099946b12798ab5e6f1db437753a6a6ab58f12752bb7360884f3f8e88a7
---

# ADR-M5-BACKLOG-AUTO-PUBLISH-003：条件自动发布 v5 无环 release-pair 身份 successor

## 决定

接受 `ADR-M5-BACKLOG-AUTO-PUBLISH-002` 的最小身份 successor。删除实施语义中的双向最终 manifest SHA 内嵌：full manifest 不记录 fallback manifest SHA，fallback manifest 不记录 full manifest SHA；两者都不记录 pair receipt最终SHA，也不记录任何由上述最终SHA派生的值。构建、stage或部署不得尝试求取SHA固定点。

full与fallback各自独立生成确定性、内容寻址的最终manifest。每份manifest只声明自己的closure和唯一角色：

- full：`releaseRole="full_v5"`；
- fallback：`releaseRole="v5_manual_only_fallback"`。

两份manifest都记录同一个`pairContractRoot`。该root只由构建前已经冻结、且不含任一最终manifest SHA、pair receipt SHA、stage receipt SHA或部署manifest SHA的兼容输入计算。两份manifest完成并封存后，在两个release closure之外生成第三份canonical `release-pair-receipt-v1`；它记录两个最终manifest SHA及两边release/content root。receipt自身最终文件SHA只由外部任务/部署manifest锚定，永远不写回任一release manifest或receipt自身。

运行态继续`disabled`。本决定没有构建manifest/receipt，没有修改app/tests/DB/M1/deploy/key，也没有授权migration 0005、load、cutover或enablement。

## 精确取代范围

旧accepted文件保持原字节：001、002、实施合同v0.1/v0.2均不原地修改。

本决定精确取代002及v0.2中以下语义：

1. “两个内容寻址manifest相互固定对方SHA”；
2. `full.pairedManifestSha256=fallback.manifestSha256`与反向等式；
3. 以“互钉manifest SHA”为stage/迁移/切换门；
4. `RB-11`中依赖上述双向字段的负例。

002/v0.2的v4/v5 opener边界、pre/post-COMMIT双层回退、fallback人工能力与硬禁能力、outbox producer/sender、备份/quiesce/DB锁、灾难恢复、再升级以及其他负例全部继续有效。发生身份条款冲突时，以003与实施合同v0.3为准。

## 三个互相分离的hash domain

### 1. compatibility domain

`pair-contract-input-v1`是closed canonical对象，至少包含：

- schema版本与generation rule字面量；
- 同一Git commit/tree；
- 严格有序的migration 0001..0005 path/SHA数组及其selector root；
- `user_version=5`和精确schema fingerprint；
- operation closed union、fresh binding、legacy provenance、audit/outbox producer合同的版本与artifact root；
- DB opener、fallback capability、collector guard、sender合同版本；
- 目标Node的OS/arch/绝对路径/version/binary SHA及其root；
- 两份release manifest schema版本；
- receiver loopback/public last-known-good的合同版本。

该对象禁止出现任一manifest/receipt/stage/deployment最终SHA、release root、content root、时间、随机数或目标DB瞬时inode。计算：

```text
pairContractRoot = SHA-256(UTF8(canonical-json-v1(pair-contract-input-v1)))
```

### 2. independent release-manifest domains

两份release manifest分别包含`pairContractRoot`、自身`releaseRole`、兼容输入的可复算身份、自己的runtime closure、release/content roots、Git/Node/migration/schema身份和自己的capability闭集。每份最终文件SHA只覆盖该份manifest的最终canonical文件字节：

```text
manifestFileBytes  = UTF8(canonical-json-v1(strict-manifest-object) + "\n")
manifestSha256     = SHA-256(manifestFileBytes)
```

manifest对象内禁止`pairedManifestSha256`、`pairReceiptSha256`、`fullManifestSha256`、`fallbackManifestSha256`、任一stage receipt SHA，以及语义等价别名。release/content root不覆盖manifest文件本身，也不覆盖外部pair receipt；其domain和字段排除必须由版本化manifest schema显式列出。

### 3. external pair-receipt domain

两份manifest最终SHA都已得到后，构建者按closed schema生成一份`release-pair-receipt-v1`。receipt记录：`pairContractRoot`、full/fallback manifest最终SHA、各自release/content root、Git commit/tree、migration selector root、`user_version=5`、schema fingerprint、operation contract root、Node target root、两个manifest schema版本/角色，以及generation rule字面量。

```text
pairReceiptBytes   = UTF8(canonical-json-v1(release-pair-receipt-v1) + "\n")
pairReceiptSha256  = SHA-256(pairReceiptBytes)
```

receipt对象不包含自身SHA、stage receipt SHA或部署manifest SHA。receipt路径位于两个release closure之外。外部统筹任务与production deployment manifest分别固定`pairReceiptSha256`、`fullManifestSha256`和`fallbackManifestSha256`；expected值不得从待验证的manifest/receipt自身回读。

## 有限构建次序

1. 冻结`pair-contract-input-v1`，canonical复算`pairContractRoot`。
2. 独立构建`full_v5` closure和manifest；封存文件后计算full manifest最终SHA。
3. 独立构建`v5_manual_only_fallback` closure和manifest；封存文件后计算fallback manifest最终SHA。第2、3步可以交换或并行，结果不互相依赖。
4. 从两份已封存manifest及compatibility input生成唯一canonical pair receipt，计算其最终SHA。
5. 外部任务/deployment manifest锚定三个SHA。任何release重建、manifest单字节变化或root变化都废弃旧receipt；重新生成新receipt和新外部锚，禁止回填旧文件。

该流程在有限次hash计算后结束，不存在递归字段、字段排除猜测或固定点搜索。

## canonical、文件与唯一性门

`canonical-json-v1`固定为：UTF-8无BOM；对象key只允许schema列出的ASCII key并按ASCII byte升序；数组保持schema定义顺序；字符串必须是有效Unicode scalar且已NFC；整数必须是JSON safe integer；禁止浮点、`-0`、NaN/Infinity、duplicate key、unknown key、缺失key、隐式默认和nullable替代。输出无额外空白，文件末尾精确一个LF。所有SHA使用小写64hex。

raw parser必须在普通JSON对象化之前拒绝同一object level的duplicate key。strict schema要求每个key精确出现一次；full/fallback角色分别精确出现一次，两个manifest path、inode和SHA必须互异，pair receipt不得把角色位置互换。

在M1上，两份manifest、pair receipt、两个stage receipt和pair-verifier receipt都必须是deployment manifest指定的绝对路径、owner-owned普通文件、mode `0600`、`nlink=1`、非symlink，`realpath(path)=path`。pair receipt的realpath不得位于任一release root/closure内。verifier使用no-follow只读FD，比较open前lstat、FD首次/末次fstat与close前路径lstat的dev/inode/uid/mode/nlink/size；期间替换、hardlink、truncate、append、chmod、chown或路径漂移全部拒绝。

## M1 stage与独立pair verifier

0005前必须在M1、生产DB之外的隔离恢复副本上分别完成：

1. full manifest verifier、release closure复算、v4→v5、full v5 opener与合同指定HTTP/DB smoke；
2. fallback manifest verifier、release closure复算、精确v5 opener、人工HTTP/fresh/outbox sender smoke及全部fallback硬禁负例；
3. 两份strict `release-stage-verification-v1` receipt，分别固定role、pairContractRoot、manifest SHA、release/content root、Git/tree、migration/schema/operation/Node身份、smoke result root/counts、隔离DB identity和`productionDatabaseTouched=false`；
4. 由独立pair verifier读取外部三个expected SHA、两份manifest、pair receipt、两份stage receipt，重算compatibility root、两份manifest最终SHA/closure、pair receipt全部字段和最终SHA，并验证两个stage receipt属于同一pair且均PASS。

pair verifier的artifact SHA、两份stage receipt SHA和最终pair-verifier receipt SHA由外部deployment manifest锚定，不进入两份release manifest或pair receipt。pair verifier成功只证明身份/stage门，不能启用runtime。

## migration与post-COMMIT切换

0005迁移入口必须从owner-only production deployment manifest一次性取得不可覆盖的`expectedPairReceiptSha256`、`expectedFullManifestSha256`和`expectedFallbackManifestSha256`，并与外部任务交接值逐字相等；同时读取两份stage receipt与pair-verifier PASS锚。HTTP请求、环境变量、CLI自由参数、release manifest或pair receipt都不能覆盖这些expected值。

在接触生产DB前先完成全部文件/closure/pair/stage验证。进入DB锁与migration transaction后保持对应只读FD打开，并在COMMIT前再次fstat/路径复核；任一replacement/drift使事务回滚，DB保持v4。post-COMMIT full失败时，只接受同一外部pair receipt中`releaseRole=v5_manual_only_fallback`且最终SHA等于expected fallback SHA的release；其他fallback即使pairContractRoot相同也拒绝。

## 必须拒绝的身份负例

以下任一情况均在生产DB打开、listener/worker或外联前失败；若已经进入未提交migration事务则整体ROLLBACK并证明DB仍v4：

1. 任一manifest含对方SHA、pair receipt SHA、自身SHA、stage/deployment SHA或等价递归字段；
2. duplicate/unknown/missing key、非canonical顺序/转义、BOM、额外空白、缺少/多余LF、非NFC、uppercase hash；
3. 两份manifest角色重复、交换、同路径、同inode、同最终SHA，或role不在精确二值闭集；
4. pairContractRoot、Git/tree、migration order/SHA、schema fingerprint、operation/fresh/outbox合同或Node target任一不一致；
5. pair receipt任一manifest SHA、release/content root、角色、generation rule或schema/migration身份漂移；
6. pair receipt位于任一release closure内，或receipt被写回manifest后重新hash；
7. expected三个SHA缺失、来自待验证文件、可由HTTP/env/CLI覆盖、与deployment manifest或外部任务锚不一致；
8. manifest/receipt/stage文件不是0600、owner、nlink1、普通文件和精确realpath，或open/read/verify/COMMIT期间发生replacement/drift；
9. full/fallback任一stage receipt缺失、FAIL、错role/manifest/pair root、smoke root不符、触碰production DB，或pair verifier未独立重算；
10. post-COMMIT尝试切换到相同pairContractRoot下但不属于外部receipt精确fallback SHA的release。

## 未变更边界

- 002定义的双层回退、fallback能力、sender、灾难恢复和再升级继续有效；本决定只修无环身份与迁移入口。
- 001的用户授权和安全初审范围不变，没有新增用户选择。
- 0005、v5 fingerprint、两个release、pair receipt、stage/pair verifier和M1运行均为`Unknown / 未实现`。
- APC8为`FAIL / P1=1`且first-P1-stop；003需由APC10从头复审，不能继承APC8未裁定维度的PASS。
