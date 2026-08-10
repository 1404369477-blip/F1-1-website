---
title: F1+1 SOURCE-MGMT-001 本地 synthetic 信源管理纵切实现合同 v0.3
type: product_implementation_contract_successor
status: proposed
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-A4392B
function_id: SOURCE-MGMT-001
implementation_state: pending_security_reverification_and_implementation
profile_decision: acknowledged
external_calls: 0
production_authorized: false
immutability: append_only_successor_required
---

# F1+1 SOURCE-MGMT-001 本地 synthetic 信源管理纵切实现合同 v0.3

## 0. 唯一入口、不可变性与证据 pin

本文件是 `SOURCE-MGMT-001` 当前唯一产品实施入口，状态保持 `proposed`。它完整吸收 v0.2 的 profile、39字段、状态、operation/Outbox、UI、恢复与外部关闭边界，并以本文件的安全 MUST 覆盖 v0.2 中较宽的 session/CSRF 和 identity 描述。

本任务完成后，本文件按最终 SHA 视为不可变；任何实质变化必须新建 v0.4 successor，保留本文件字节。

| 输入 | 任务/状态 | 精确路径 | SHA-256 | 规范作用 |
|---|---|---|---|---|
| 产品 v0.2 | `TASK-20260809-68918B completed` | `docs/spec/F1+1-SOURCE-MGMT-001本地synthetic信源管理纵切实现合同-v0.2.md` | `a4b7230c89b0083f6d3f412d2c3f3f767c7f131d4ea422f85fe5721f75df686b` | 非安全主体合同；字节保持不变 |
| local Admin 安全候选 | `TASK-20260802-6F7563` / PASS-contract / NOT_RUN | `docs/collaboration/部门/安全部/报告/2026-08-02-M4-VS-1本地管理API会话与CSRF安全合同候选.md` | `e043705915c4c2489cdf3cb178677b4d5dc753781c98e8c10e7886d2a5462218` | raw authority、session、CSRF、拒绝零业务增量的规范性 MUST |
| v0.2 安全 FAIL | `TASK-20260809-96AF52 acknowledged` | `docs/collaboration/部门/安全部/报告/2026-08-09-SOURCE-MGMT-001-v0.2实施前独立安全审查报告.md` | `3055ff0fc81cfa471f14e32d5f333bee2c275783ed1df862781bda134097248e` | 两项 P1与 source_id碰撞 P2 的整改出口 |

任一 pin 漂移时，launcher、开发候选和安全复验都必须失败关闭。安全候选的规范性条件已在本文件逐项复述；开发不得只写“继承”后自行选择实现。

当前 `SOURCE-MGMT-001` 继续为 `P1-blocker`：本合同只关闭产品文字 P1，代码、浏览器、SQLite、并发和安全复验均未运行。

## 1. v0.2 主体合同继续有效

以下 v0.2 语义逐字继续有效，本 v0.3 不另造第二版本：

- 唯一 `source-management-synthetic` profile、单进程、单SQLite handle、单writer；禁止ATTACH、跨profile查询、跨库事务与public写入。
- baseline 固定59×39、59 disabled、projection root `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`；baseline mutation全403，不复制进local DB。
- Source persisted/API core严格39字段；onboarding只用16状态、lifecycle只用4状态；alias/view meta不回写。
- command receipt只用 `source_add|source_validate|source_activate|source_stop|source_retire|source_requeue`。
- Add/Validate/Stop/Retire不创建Outbox/TaskEnvelope；只有Activate创建或复用唯一 `source_activation`；requeue复用原business operation/key/job。
- DELETE与模糊retry route不注册；stop/retire保留全部历史；response loss只查询同command operation。
- externalCalls=0；真实URL/provider/Base/AI/媒体/发布/生产部署持续关闭。

若本文件和v0.2对安全或identity语义存在差异，以本文件为准；其他领域语义仍以固定v0.2为证据。

## 2. P1-1：Raw authority、session与CSRF强制合同

本节所有条款都是 **MUST**。任何 Unknown、缺失、漂移或不支持都在 session/nonce/业务 DB 变化前失败关闭。

### 2.1 启动与 canonical origin

单进程只允许二选一，启动后不可变：

```text
IPv4: APP_BIND_HOST=127.0.0.1
      APP_PUBLIC_ORIGIN=http://127.0.0.1:<APP_PORT>

IPv6: APP_BIND_HOST=::1
      APP_PUBLIC_ORIGIN=http://[::1]:<APP_PORT>
```

- `APP_PORT` 必须是 1024–65535 的十进制整数。
- canonical origin 必须由已验证 bind host/port 生成并与配置逐字比较。
- 禁止 localhost、userinfo、path/query/fragment、wildcard、默认端口省略、大小写别名、IPv6 zone id、协议相对 URL和多个origin。
- 只启用HTTP/1.1。HTTP/2、h2c、absolute-form request-target或双authority请求一律拒绝。
- 配置不成立时，在监听、读取业务DB或生成session前以 `ADMIN_BIND_CONFIG_DENIED` 非零退出。

### 2.2 每请求 raw gate顺序

框架合并/规范化/路由前，HTTP adapter必须保留 raw request-target与raw header multiplicity，并按以下顺序执行：

1. socket peer规范化后只接受 `127.0.0.1`、`::1` 或IPv4 loopback映射 `::ffff:127.0.0.1`；否则 `ADMIN_PEER_DENIED`。
2. 只接受origin-form request-target；absolute-form、非HTTP/1.1、upgrade/h2c均 `ADMIN_HOST_DENIED`。
3. Host必须恰好一个raw值；缺失、重复、comma-folding、空白变体、别名、Host与`:authority`并存、raw/normalized authority不一致均 `ADMIN_HOST_DENIED`。
4. 原始Host必须与canonical origin authority逐字相等。
5. 出现 `Forwarded`、任意 `X-Forwarded-*`、`X-Real-IP` 或代理覆盖头即 `ADMIN_PROXY_HEADER_DENIED`；不得读取其值决定权限。
6. mutation、session create/refresh/destroy、CSRF issue必须有唯一Origin且逐字等于canonical origin；缺失=`ADMIN_ORIGIN_REQUIRED`，不等=`ADMIN_ORIGIN_DENIED`。
7. Admin只读GET可无Origin；存在Origin时仍须exact match。
8. 每个session/CSRF/Admin入口都必须重新断言runtime no-egress ready；Unknown/缺失/漂移=`ADMIN_NO_EGRESS_REQUIRED`。

`/admin/*` 与 `/api/admin/*` 不返回任何CORS allow header；OPTIONS固定405。所有响应含 `Cache-Control:no-store, private`、`Pragma:no-cache`、`Referrer-Policy:no-referrer`、`X-Content-Type-Options:nosniff`。

### 2.3 单一内存session

Cookie唯一为：

```text
f1_local_admin_session
HttpOnly; SameSite=Strict; Path=/; Max-Age=<remaining absolute seconds>
```

- 不设置Domain；当前loopback HTTP不设置Secure。未来HTTPS必须另建合同。
- 进程启动用系统CSPRNG生成32 bytes session ID，编码为base64url无padding，长度43；明文只存在可清零内存缓冲，不进DB、文件、env、日志、HTML、URL、storage或analytics。
- 启动只生成一个UNCLAIMED authority。`POST /api/admin/session` 在exact raw gate与no-egress通过后原子 `UNCLAIMED→ACTIVE` 并通过Set-Cookie交付；服务端清零明文并只保留固定长度digest/metadata。
- 最多一个ACTIVE session；并发create由同一内存锁串行。已有ACTIVE且请求无当前有效cookie时返回409 `ADMIN_SESSION_ALREADY_ACTIVE`，不生成第二session。
- session仅进程内存；进程重启全部失效。
- absolute TTL=30分钟，idle TTL=10分钟，使用可注入单调时钟；GET不刷新idle，只有显式refresh可刷新idle且不得延长原absolute expiry。
- refresh用系统CSPRNG重新生成32 bytes新ID，旧ID立即失效并清除旧session全部nonce；destroy/timeout/restart同样失效。
- 时钟不可用、倒退、溢出时 `ADMIN_CLOCK_INVALID` 并关闭session。

session endpoints固定为：

| method/path | 精确输入 | 唯一成功出口 | 冲突/拒绝 |
|---|---|---|---|
| `POST /api/admin/session` | exact raw gate/no-egress、Origin、JSON canonical `{}`；无需旧session/CSRF | UNCLAIMED原子领取为201+Set-Cookie；请求已带当前有效session时200且不轮换 | 已有ACTIVE而无/错cookie时409，不创建第二session |
| `POST /api/admin/session/refresh` | 有效session、Origin、canonical `{}`、绑定本route/body的新CSRF | 200；新ID、旧ID/旧nonce立即失效；保留absolute expiry、刷新idle、Set-Cookie | 旧/过期session或CSRF错绑/重放拒绝，不生成ID |
| `DELETE /api/admin/session` | 有效session、Origin、empty body、绑定empty-body hash的新CSRF | 204；销毁session与全部nonce，Set-Cookie Max-Age=0 | 缺失/旧/过期session或nonce拒绝 |
| `GET /api/admin/session` | raw gate、有效session；无CSRF | 200；只返回state/absolute expiry/idle expiry，任何状态不变 | 缺失/过期为401，不创建或刷新session |

create/refresh响应不得在body返回session ID。session create/refresh/destroy之外不得Set-Cookie。

### 2.4 一次性CSRF

- token由服务端系统CSPRNG生成32 bytes，base64url无padding，长度43；TTL固定300秒。
- 每session最多32个未过期issued nonce；超限 `429 ADMIN_CSRF_CAPACITY`。
- 唯一签发入口是 `POST /api/admin/csrf`，要求有效session、exact Origin、canonical JSON，并只接受 `{body_sha256,method,path}` closed DTO。
- method必须为注册mutation的uppercase `POST|DELETE`；path必须是注册的exact path且无query/fragment；body_sha256必须是exact canonical request-body UTF-8 bytes的SHA-256小写64hex。
- 服务端绑定对象固定为 `{session_digest,method,exact_path,body_sha256,issued_at_monotonic,expires_at_monotonic,state=issued}`；客户端字段不得覆盖。
- token只经 `X-F1-CSRF-Token` 单值header消费；禁止comma folding。
- token只存页面内存闭包；禁止DOM attribute、URL、console、日志、storage和错误上报。body任一字节变化即丢弃token。
- 成功签发固定201，只返回 `{csrf_token,expires_in_seconds:300,method,path}`；不得返回session digest、body hash、issued time或内部state。

消费顺序固定：peer/Host/Origin/method/content-type/size/canonical JSON/session通过后，对token做固定长度digest和constant-time compare；随后在单进程nonce store原子临界区内比较session/method/path/body hash/expiry/state。唯一成功请求执行 `issued→consumed` 后才进入业务幂等/CAS事务。

- 并发消费只允许一个成功；第二个稳定返回 `ADMIN_CSRF_REPLAY`。
- consumed/expired tombstone保留到原expiry后10分钟。
- 安全检查、input、CAS、storage或业务事务失败，以及业务rollback，都不得把token恢复为issued。
- session refresh/destroy/timeout/restart使issued token不可用。
- 多进程、cluster、serverless、代理或第二Admin server使内存原子性失效，必须启动拒绝。

### 2.5 安全拒绝的零业务增量

raw gate、no-egress、body、session、CSRF任一拒绝前后，以下业务增量全部必须为0：

```text
Source
operation_receipt
OutboxJob
TaskEnvelope
Inbox
TaskAttempt
DeadLetter
domain AuditEvent
provider/adapter call
```

最多允许一条字段allowlist的redacted security AuditEvent和必要的内存session/nonce单向状态变化。security audit sink失败时请求整体fail closed，业务增量仍为0。错误响应不得回显raw authority、header、Cookie、session、CSRF、body、URL、source私密ID、stack、SQL或路径。

## 3. P1-2：Command、business、task与lease identity

### 3.1 通用原则

- 所有随机生成都使用平台自带CSPRNG；不得新增依赖、使用 `Math.random`、时间戳、计数器、UUID别名或由另一identity/hash截断派生。
- 每个identity域使用独立CSPRNG调用；相同随机bytes在不同域也不得复用。
- 编码只能是canonical lowercase hex；大写、奇数长度、非hex、padding、空白或额外分隔符全部拒绝。
- 服务端只验证codec、prefix、exact length、绑定和UNIQUE；服务端不得宣称可以验证客户端字符串的熵。客户端command安全保证只来自可信UI的Web Crypto生成器与固定测试向量。
- 客户端不得提交business operation/key、job、task或lease字段；`additionalProperties=false`在业务事务前拒绝。

### 3.2 Closed identity表

| identity | 唯一生成方与时点 | 原始随机bytes | canonical格式 | exact长度 | 生命周期/复用 |
|---|---|---:|---|---:|---|
| command operation | 可信UI首次发送前，`crypto.getRandomValues(new Uint8Array(32))` | 32 | `op-cmd-<64 lowercase hex>` | 71 | 每个用户command一枚；response-loss重放逐字复用 |
| command idempotency key | 可信UI首次发送前，独立Web Crypto调用 | 32 | `cmd-key:<64 lowercase hex>` | 72 | 与同command/path/body绑定；response-loss逐字复用 |
| business operation | 服务端首次activation或cancelled后新activation的同一 `BEGIN IMMEDIATE` 内，`node:crypto.randomBytes(32)` | 32 | `op-srcact-<64 lowercase hex>` | 74 | Source/Outbox/TaskEnvelope逐字同值；resume/requeue复用 |
| business idempotency key | 服务端同一activation事务内，独立Node crypto调用 | 32 | `srcact-key:<64 lowercase hex>` | 75 | Outbox/TaskEnvelope逐字同值；resume/requeue复用 |
| job id | 服务端同一首次/新activation事务内，独立Node crypto调用 | 32 | `job-srcact-<64 lowercase hex>` | 75 | 唯一Outbox job；resume/requeue复用 |
| task id | 服务端同一首次/新activation事务内，独立Node crypto调用 | 32 | `task-srcact-<64 lowercase hex>` | 76 | 同business operation的稳定TaskEnvelope identity；attempt/requeue复用 |
| live lease token | worker每次acquire/retry的独立事务内，在CAS前后同一原子获取流程用 `node:crypto.randomBytes(16)` | 16 | `synthetic:lease:<32 lowercase hex>` | 48 | 每attempt新值；永不复用、回显、日志或receipt |

上述格式逐字兼容现有schema：business operation匹配 `^op-[a-z0-9-]{6,128}$`；task匹配 `^task-[a-z0-9-]{6,128}$`；job匹配 `^job-[a-z0-9-]+$`；live lease逐字匹配 `^synthetic:lease:[a-f0-9]{32}$`；idempotency key长度小于255。

字段绑定唯一为：

| 存储/对象字段 | 必须写入的identity |
|---|---|
| `operation_receipt.command_operation_id` | command operation |
| `operation_receipt.command_idempotency_key` | command key |
| `operation_receipt.business_operation_id/business_idempotency_key/outbox_job_id` | 首次/新activation写server-owned对应值；其他command按复用规则引用或为null |
| `Source.onboarding_operation_id` | business operation；validate/add保持null |
| `OutboxJob.operation_id/idempotency_key/job_id` | business operation / business key / job id |
| `TaskEnvelope.operation_id/idempotency_key/task_id/lease_token` | business operation / business key / task id / 当前seed占位或live lease |
| command事务的domain AuditEvent `operation_id/task_id` | command operation / null |
| worker/acquire/settlement AuditEvent `operation_id/task_id` | business operation / stable task id |
| raw/session/CSRF拒绝的security AuditEvent | 可用时只放脱敏command ref；无可信identity时两字段为null，禁止回显输入 |

receipt是command与business域的唯一桥；Source、Outbox、TaskEnvelope或AuditEvent不得把command operation当business operation，也不得把business key写入command key列。

activation创建的seed TaskEnvelope若schema要求lease占位，只允许固定非授权值 `synthetic:lease:00000000000000000000000000000000`。该值不是live lease，worker与completion CAS必须显式拒绝。每次acquire用新的live lease原子替换当前envelope，并让Outbox、Inbox、TaskAttempt的envelope hash逐字一致。

### 3.3 生成、绑定与事务顺序

#### Command

客户端唯一顺序为：

1. 冻结 **command-independent** 请求输入：schema version、action字段、expected Source/fences及全部表单值；此时不构造body、不计算hash。
2. 分别调用Web Crypto生成command operation与command key；两次独立32-byte CSPRNG输出不得复用。
3. 把已冻结输入与command pair组装成完整closed DTO；此后不得补字段或使用别名。
4. 对完整DTO执行 `canonical-json-v1`，得到最终exact UTF-8 bytes及 `canonical_body_hash=SHA-256(final_bytes)`。
5. 用固定method、exact path和该body hash调用CSRF endpoint，领取绑定nonce。
6. mutation必须提交与第4步逐字相同的bytes、method、path和command pair。

任何表单值、expected Source/fence、action、method、path、command identity或serialization发生变化，都必须丢弃尚未消费的nonce，并从第1步重新走完整链；不得只重算hash、只换nonce或只换identity。nonce一旦消费，仍无恢复路径。

服务端在CSRF消费后验证exact codec/length，再按 `{command_operation_id,method,exact_path,canonical_body_hash}` 查receipt。同operation+同key+同path/body返回原receipt；同operation异key/path/body，或同key绑定其他operation/path/body，返回 `409 ADMIN_COMMAND_IDENTITY_CONFLICT`，业务增量0。低熵但codec合法的客户端值不能由服务端识别；实现、测试和报告不得把“语法通过”写成“熵已验证”。

#### First/new activation

1. 消费CSRF、查无command receipt、完成Source/gate/fence/CAS预检后，进入单writer `BEGIN IMMEDIATE`。
2. 在任何business row写入前，分别生成business operation/key、job、task并查询对应UNIQUE域。
3. 任一碰撞时在同一事务内丢弃整组，最多重新独立生成3组；不得只替换其中一枚形成混合身份。
4. 三组均碰撞或CSPRNG失败时返回 `500 ADMIN_BUSINESS_IDENTITY_GENERATION_FAILED`，事务全rollback，Source/receipt/Outbox/TaskEnvelope/domain audit增量0；CSRF保持consumed。
5. 成功组在同一事务写入Source.onboarding operation、唯一Outbox/TaskEnvelope、command receipt和AuditEvent；commit后才返回。

#### Lease

1. worker acquisition在独立 `BEGIN IMMEDIATE` 中先读取唯一job，验证pending/retryable、next_attempt、stop、five fence和deadline。
2. 每次生成16-byte live lease并查询全局UNIQUE；碰撞时最多独立重生成3次。
3. 三次失败或CSPRNG失败返回 `ADMIN_LEASE_IDENTITY_GENERATION_FAILED` 并rollback acquisition；Outbox状态、attempt、Source、Inbox、TaskAttempt和adapter call均不变。
4. 成功后CAS Outbox→leased、attempt+1、替换live TaskEnvelope、写Inbox/TaskAttempt envelope hash并提交；completion必须匹配同lease、未过期deadline和five fence。

### 3.4 Response loss、resume与requeue

- commit后response loss：UI用原command operation查询receipt，或用新CSRF+相同command operation/key/body显式重放；不得生成新command pair。
- precommit已知失败且无receipt：用户确认后可用新CSRF重放同command pair；不得自动重试。
- stopped resume与queue_failed retry：使用新command pair，逐字复用原business operation/key/job/task；acquire生成新lease。
- dead-letter requeue：使用新command pair，逐字复用原business operation/key/job/task，retry generation+1并生成新lease；不创建第二business identity。
- cancelled后新activation：使用新command pair，并在事务内生成全新的business operation/key/job/task。
- 若原business identity缺失、重复、codec不符或相互绑定不一致，返回 `409 ADMIN_BUSINESS_IDENTITY_INTEGRITY_FAILURE`，零业务写入；不得“修复”为新identity。

### 3.5 固定fixture vectors

以下bytes只用于注入式contract test，生产必须从CSPRNG取得：

| 域 | 注入bytes | 预期canonical值 |
|---|---|---|
| command operation | `00..1f` | `op-cmd-000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f` |
| command key | `20..3f` | `cmd-key:202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f` |
| business operation | `40..5f` | `op-srcact-404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f` |
| business key | `60..7f` | `srcact-key:606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f` |
| task id | `80..9f` | `task-srcact-808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f` |
| job id | `a0..bf` | `job-srcact-a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf` |
| live lease | `c0..cf` | `synthetic:lease:c0c1c2c3c4c5c6c7c8c9cacbcccdcecf` |

测试必须同时拒绝：大写hex、63/65hex、错prefix、prefix-only、非hex、padding、空白、客户端提交server-owned identity、零值live lease，以及同随机bytes跨域复用。

## 4. P2：96-bit source_id碰撞

local source_id继续使用v0.2固定公式：

```text
identity_input = canonical-json-v1({platform,raw_url}) exact UTF-8 bytes
full_identity_hash = SHA-256(identity_input)
source_id = "src-local-" + first24(lowercase_hex(full_identity_hash))
```

Add事务在任何Source/receipt/lineage/fence/audit写入前，对baseline与local effective set检查source_id与canonical URL：

1. source_id不存在：继续正常唯一性检查。
2. source_id存在且对existing Source的 `{platform,raw_url}` 重算full hash与incoming full hash逐字相同：返回 `409 ADMIN_SOURCE_ALREADY_PROPOSED` 和只读current ref；业务增量0。
3. source_id相同但full hash不同：返回 `409 ADMIN_SOURCE_ID_COLLISION`；Source、receipt、lineage、fence、Outbox、TaskEnvelope、domain audit增量0。不得自动加salt、后缀、延长ID、覆盖或创建第二Source。
4. canonical URL与其他Source冲突：返回独立 `409 ADMIN_SOURCE_CANONICAL_CONFLICT`；不得混写为source_id碰撞。

用户唯一恢复动作：打开现有Source核对；确认是不同输入后，修改 `synthetic.invalid` canonical path或platform，页面重新canonicalize，生成新的command pair与CSRF后再明确提交。客户端不得自动改输入或盲重试。

若未来输入扩展到真实、不可信或高规模来源，必须由新successor重新评估source_id位数；本合同不自动扩位。

## 5. Mandatory security golden

### 5.1 P1-1 raw/session/CSRF

| ID | 必须通过的机械出口 |
|---|---|
| `SRC-V3-RAW-01` | origin-form+单Host exact PASS；absolute-form、duplicate/comma/missing Host、Host+:authority、raw/normalized mismatch、HTTP2/h2c、proxy headers、非loopback peer逐项拒绝，session/nonce/业务增量0 |
| `SRC-V3-ORIGIN-02` | mutation/session/CSRF对missing/wrong/alias Origin稳定拒绝；GET无Origin只读；CORS header=0、OPTIONS=405 |
| `SRC-V3-SESSION-03` | 注入32-byte CSPRNG得到43-char base64url；单ACTIVE、并发create仅一笔、30m/10m单调TTL、refresh轮换、旧ID/重启/clock failure全部拒绝 |
| `SRC-V3-CSRF-04` | 32-byte token、session+method+exact path+body hash绑定、300s、capacity32；并发消费恰一成功；replay/expiry/wrong binding稳定拒绝；rollback后不恢复 |
| `SRC-V3-SEC-ZERO-05` | 每个raw/session/CSRF/no-egress拒绝前后Source/receipt/Outbox/Envelope/Inbox/Attempt/DeadLetter/domain audit hash与count相同；最多一条redacted security audit |

### 5.2 P1-2 identity

| ID | 必须通过的机械出口 |
|---|---|
| `SRC-V3-ID-CODEC-06` | §3.5七个vector逐字命中；所有大小写/长度/prefix/owner负例拒绝；runtime-envelope schema PASS |
| `SRC-V3-ID-OWNER-07` | 顺序唯一为冻结command-independent输入→独立生成pair→完整DTO→canonical bytes/hash→申请CSRF→提交同bytes；任一输入/identity/serialization变化丢弃nonce并全链重走；Web/Node owner与独立CSPRNG调用准确，服务端不声称客户端熵已验证 |
| `SRC-V3-ID-COLLISION-08` | command op/key各类UNIQUE冲突稳定409零写；business整组与lease各最多3次；耗尽时对应500/rollback/adapter=0 |
| `SRC-V3-ID-REUSE-09` | response-loss同command回原receipt；stopped/queue_failed/dead-letter复用business/job/task且新lease；cancelled新建全组；篡改/缺失逐项409零写 |
| `SRC-V3-ID-CONCURRENCY-10` | 两个并发activate最多一个business事实；loser读current/receipt；Outbox/operation/key/job/task唯一且无混组 |

### 5.3 P2 source_id

| ID | 必须通过的机械出口 |
|---|---|
| `SRC-V3-SOURCE-ID-11` | same 96-bit prefix+same full hash→already proposed；same prefix+different full hash→`ADMIN_SOURCE_ID_COLLISION`；canonical冲突独立reason；三类均零意外写入且恢复路径唯一 |

以上安全golden必须与v0.2的16项主体golden绑定同一app/data/design/profile hash。任一TODO/SKIPPED/NOT_RUN、P0/P1未清零或安全输入pin漂移时，功能保持 `P1-blocker`。

## 6. 精确开发与安全复验交接

### 开发

1. 使用Node24内置 `node:crypto` 与浏览器Web Crypto；不新增依赖。
2. 在HTTP adapter最前层实现raw request-target/header multiplicity与peer gate；框架已规范化值不能替代raw证据。
3. session/nonce store保持单进程内存与原子锁；多进程配置启动拒绝。
4. 按§3实现closed identity codec、owner、UNIQUE与事务；不得从客户端接收server-owned字段。
5. 按§4实现full hash碰撞区分，不新增Source字段或第二schema。
6. 输出固定vector、攻击矩阵、并发、rollback、response-loss与zero-delta receipts。

### 安全部

只读绑定v0.3最终SHA复验：三份输入pin、raw gate顺序、session/CSRF state machine、zero-delta、identity codec/owner/碰撞/复用、source_id碰撞、no-egress与日志。P0/P1任一存在时继续FAIL。

### 测试部

把§5十一项安全golden与v0.2十六项主体golden合并执行；每项必须有同候选hash、攻击输入、before/after root/count、reason code和恢复收据。fixture-only测试不得外推真实网络或生产认证。

## 7. 当前边界与回退

- 本任务只新增产品v0.3与产品报告；v0.2、app、data、design、accepted ADR和安全历史报告字节不改。
- 安全候选或FAIL报告pin漂移：不开工、不自动更新pin。
- identity与现有schema不兼容：停止并报告首个冲突；不改schema、不另造identity。
- CSPRNG、raw adapter、单进程原子性或no-egress无法证明：功能关闭。
- 真实外联、生产身份、跨主机Admin或多进程需求：进入独立用户授权和successor流程。

结论：两项合同P1与source_id碰撞P2已形成唯一、可机械复验的产品出口；实现与安全复验尚未完成，`SOURCE-MGMT-001` 继续为 `P1-blocker`，externalCalls=0。
