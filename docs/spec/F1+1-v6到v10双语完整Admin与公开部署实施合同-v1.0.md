# F1+1 v6→v10 双语完整 Admin 与公开部署实施合同 v1.0

状态：`accepted target / Slice 0 COMPLETE / implementation pending`  
决策入口：[ADR-F1PLUS1-V6-V10-BILINGUAL-ADMIN-PRODUCTION-001](../decisions/system/2026-08-24-F1+1-v6到v10双语完整Admin生产successor-accepted.md)  
Function 索引：[双语完整 Admin 与公开部署 Function 矩阵 v1.0](F1+1-双语完整Admin与公开部署Function矩阵-v1.0.md)

## 1. 目标和当前事实

目标是把当前 schema 6 / v4运行链演进为一个可在 Mac 与 iPhone 完整操作的私有 Admin、一个双语公开读站和一条可观察、可回退、最终可公开部署的默认内容链。

当前真实事实：

- review SQLite `user_version=6`；0005来自 Autosport，0006来自 RaceFans/The Race；
- Admin `3101` 当前仅挂载 review/auth基础，source-management仍是 synthetic且未并入真实 Admin；
- Public DTO只有中文 `titleZh/summaryZh/leadZh/bodyZh/keyPointsZh`；
- DeepSeek refinement只生成中文；
- automatic review每60秒只看最新100，automatic publish每60秒、每批20，但仍属现行 v4语义；
- public real snapshot reader/sender/receiver已有基础；
- health仍含 local-only/fixture语义；
- traffic、集中 logs、metrics、alerts、cost和data-quality dashboard尚未形成真实生产链；
- 59 X source保持 proposed/disabled；当前只允许人工 status URL，官方 oEmbed默认disabled；
- release successor R3只关闭 engineering evidence gate，deploy/M1/production仍为 `NO`。

## 2. 系统不变量

1. 只有 InternalOperationGateway 可颁发 DB mutation或外联 capability；浏览器、worker、adapter、repository和模型网关不能自签。
2. 唯一 review SQLite是业务写主；Public主机只读签名 immutable generation和active pointer。
3. Admin只经 private overlay/Serve app-cap进入loopback `3101`；Passkey、session、Origin、CSRF、CAS和适用的fresh re-auth缺一时零写。
4. Mac与iPhone操作语义、结果、审计和恢复等价。
5. Public不包含原始 excerpt/body/HTML、prompt、model raw response或私有编辑备注。
6. 中文和英文分别版本化；任一不完整或stale时不能形成双语自动发布bundle。
7. 未知外联结果只reconcile同一attempt/delivery，不能自动创建第二请求、Publication、snapshot或outbox。
8. observability缺producer时显示unavailable/unknown，不能用0或self-report冒充健康。
9. 每级schema有同schema full/fallback pair；COMMIT后无down migration。
10. 所有生产值由不可变 `PRODUCTION-DEPLOYMENT-MANIFEST` 固定。

## 3. 数据与状态机

### 3.1 内容链

```text
collected → normalized → deduplicated
→ bilingual_pending → bilingual_complete
→ safety_review_pending → approved|rejected|manual_override
→ publication_queued → delivery_pending → active
```

任一步可进入 `blocked|failed|reconcile_required|stale|withdrawn`。失败恢复必须保留同一candidate/operation/delivery身份，只有明确未提交证据时才允许有界重试。

### 3.2 语言槽

`zh-CN|en` 分别使用：

```text
missing → queued → running → complete
                    ↘ blocked|failed|reconcile_required
complete → stale
```

每个槽绑定 `sourceRevision/inputContentHash/sourceFactSetHash/sourceReleaseHash/promptSchemaVersion/promptSha256/modelRouteReceiptHash/draftHash`。`both`重跑创建两个受同一parent operation约束的子operation，不允许一个返回冒充两个独立结果。

### 3.3 原文和版权边界

- `canonicalUrl/sourceTitle/sourceAuthor/sourcePublishedAt`可作为必要来源证据；
- `sourceExcerpt`只在私有域并受生产retention policy；
- Public展示本站中文/英文整理、来源名、作者、时间和原文链接；
- 英文整理不标为原文或官方翻译；
- copy-risk、rights、license、deletion和media是独立gate；任一Unknown不等于许可；
- 只有明确允许的媒体进入bundle，或由明确source policy生成零媒体bundle。

## 4. Migration 合同

| Migration | 目标 | 当前状态 | 生产前置 |
|---|---|---|---|
| 0007 | gateway、operation、durable attempt、phase、fence、recovery point、writer epoch | frozen candidate，未实现 | authorizer/supervisor/second-writer/backup/full-fallback实证 |
| 0008 | 人工X URL inbox，oEmbed默认disabled | 待冻结窄successor | 绑定0007；59 disabled；外联由manifest显式开门 |
| 0009 | 双语draft/bundle/approval/publication/projection | apply=false候选 | 绑定0007/0008、真实route/budget、最终schema identity |
| 0010 | 真实source registry和Admin source单一真值；schema必须含canonical `identity_status/relevance_status/monitorability`及§5.8精确enum，派生read model不入canonical表 | 待设计实现 | 四RSS/59X/新source按§5.8逐字段映射；activate/queue显式读三列、5 guards、5 epoch fences；缺列、未知old enum或非法交叉状态整笔rollback |

COMMIT前失败整体rollback；COMMIT后切同schema manual-only fallback。任何替代DB、`ATTACH`、活跃DB/WAL/SHM复制、旧runtime试开新schema均拒绝。

## 5. API 最小闭集

### 5.1 Public

```text
GET /api/public/feed?v=1|2
GET /api/public/stories/{publicId}?v=1|2
GET /api/health
```

v1保持当前中文兼容；v2返回固定 `defaultLanguage=zh-CN`、`availableLanguages=[zh-CN,en]` 和同一projection内的两个localized对象。不能按浏览器语言让同一缓存身份返回不同bytes。

### 5.2 Admin auth/recovery identity

```text
POST /api/admin/auth/bootstrap/options
POST /api/admin/auth/bootstrap/verify
POST /api/admin/auth/login/options
POST /api/admin/auth/login/verify
POST /api/admin/auth/fresh/options
POST /api/admin/auth/fresh/verify
GET|DELETE /api/admin/session
POST /api/admin/csrf
GET /api/admin/operations/{operationId}
GET /api/admin/deliveries/{deliveryId}
```

### 5.3 Reviews/publication

```text
GET /api/admin/reviews
GET /api/admin/reviews/{candidateId}
POST /api/admin/reviews/{candidateId}/revision
POST /api/admin/reviews/{candidateId}/rerun-language
POST /api/admin/reviews/{candidateId}/approve
POST /api/admin/reviews/{candidateId}/reject
POST /api/admin/publications/{publicId}/publish
POST /api/admin/publications/{publicId}/correct
POST /api/admin/publications/{publicId}/withdraw
```

`rerun-language`只接受 `zh-CN|en|both`，并CAS当前source revision/content hash/draft hash。

### 5.4 Sources/X/phase

```text
GET|POST /api/admin/sources
GET /api/admin/sources/{sourceId}
POST /api/admin/sources/{sourceId}/validate|activate|stop|retire|requeue|authorization
GET|POST /api/admin/x-submissions
GET /api/admin/x-submissions/{submissionId}
POST /api/admin/x-submissions/{submissionId}/resolve-oembed|retire
GET /api/admin/auto-publish/policy
POST /api/admin/auto-publish/control
```

phase control action闭集为 `start_backlog|enter_live|pause|resume_backlog|resume_live|stop`。oEmbed disabled时 `resolve-oembed`必须稳定返回capability disabled且 `externalCalls=0`。

### 5.5 Ops

```text
GET /api/admin/ops/overview|pipeline|logs|traffic|apis|cost|release|backup|audit
```

首版GET-only；GET不改变CSRF/operation/alert状态，不执行外联、shell、backup、restart或deploy。

### 5.6 R2 规范类型、传输和错误合同

本节取代§3.1中“任一步可进入任意失败态”的宽泛表述，并闭合§5.1–5.5的实现语义。JSON对象均为closed object：未列字段、重复key、非UTF-8、NaN/Infinity、数字字符串和JSON顶层非object一律400。时间为带`Z`的RFC3339 UTC毫秒；ID为`^[a-z0-9][a-z0-9_-]{7,63}$`；SHA为64位小写hex；`https-url`只允许规范化后的https绝对URL；`relative-path`必须以单个`/`开头且禁止`//`、dot segment、query和fragment；`base64url`禁止padding并按括号内解码字节计长；整数禁止浮点。所有Admin响应含`Cache-Control: no-store`、`Vary: Cookie, Tailscale-User-Login, Tailscale-App-Capabilities`、`X-Content-Type-Options: nosniff`；Public成功响应含强`ETag`和`Cache-Control: public,max-age=60,stale-while-revalidate=300`，签名/active-pointer无效返回503且`no-store`。

通用类型：

```text
Problem = {
  type: "about:blank", title: string(1..120), status: integer(100..599),
  reasonCode: ProblemCode, requestId: ID, operationId?: ID,
  retryable: boolean, retryAfterSeconds?: integer(1..300)
}
ProblemCode =
  INVALID_REQUEST|UNAUTHENTICATED|FORBIDDEN|CAPABILITY_DISABLED|
  FRESH_REQUIRED|CSRF_INVALID|NOT_FOUND|GONE|CONFLICT|STALE_CAS|
  IDEMPOTENCY_MISMATCH|RATE_LIMITED|DEPENDENCY_UNAVAILABLE|
  RECONCILE_REQUIRED|INTEGRITY_FAILURE|INTERNAL_ERROR
PageMeta = {limit: integer(1..100), nextCursor: string(1..2048)|null, asOf: timestamp}
OperationKind = "create_revision"|"rerun_language"|"approve"|"reject"|
  "publish"|"correct"|"withdraw"|"source_create"|"source_validate"|
  "source_activate"|"source_stop"|"source_retire"|"source_requeue"|
  "source_authorization"|"x_submit"|"x_resolve_oembed"|"x_retire"|
  "phase_control"
ResourceType = "candidate"|"language_slot"|"bundle"|"approval"|
  "publication"|"source"|"x_submission"|"phase"
MutationMeta = {
  idempotencyKey: ID, expectedRevision: integer(0..2147483647),
  requestHash: SHA, clientRequestId: ID
}
Accepted = {operation: OperationDTO, reconcileUrl: relative-path(1..512)}
```

错误映射固定为：400 INVALID_REQUEST；401 UNAUTHENTICATED；403 FORBIDDEN/CAPABILITY_DISABLED/CSRF_INVALID；404 NOT_FOUND且仅用于从未存在或越权时防枚举；409 CONFLICT/STALE_CAS/IDEMPOTENCY_MISMATCH；410 GONE用于已retire且过retention的ID；428 FRESH_REQUIRED；429 RATE_LIMITED并带`Retry-After`；503 DEPENDENCY_UNAVAILABLE/INTEGRITY_FAILURE；未知提交结果返回202 `Accepted`且operation进入`reconcile_required`，不得返回可安全重试的5xx。其他Problem不得暴露路径、堆栈、原文、provider响应或secret。

`requestHash=sha256(JCS({method,canonicalPath,resourceId,expectedRevision,bodyWithoutMeta}))`；JCS按RFC 8785，`bodyWithoutMeta`只含该route列出的业务字段，不能包含idempotencyKey/clientRequestId/requestHash。服务端重算不等即400。CAS同时比较resource revision及route列出的所有hash/ID；任一不等为409 STALE_CAS且响应不回显当前私有内容。

分页统一使用不透明base64url cursor，解码内容由服务端签名并绑定`route+filters+sort+asOf+lastSortKey+lastId`；cursor过期或绑定不一致为400。Admin默认/最大limit为50/100；Public为12/50。Admin列表默认`createdAt:desc,id:desc`，允许的sort仅各route表所列；相同`asOf`快照内翻页，最后一页`nextCursor=null`。GET不得创建operation。相同URL、query、授权主体与ETag的`If-None-Match`命中返回304空body。

所有Admin mutation必须同时携带私有Serve身份、有效session、匹配Origin、一次性`X-CSRF-Token`、`Idempotency-Key`及body中的`MutationMeta`；header/body key不一致为400。idempotency作用域为`operatorRef+route+resourceId+idempotencyKey`，保留30天；同key同requestHash返回原202/200字节，同key异hash为409。需要fresh的route还要求不超过300秒的fresh grant，grant绑定`operatorRef+sessionId+action+resourceId+requestHash`且只能消费一次。capability闭集为`review:read|review:write|publish:write|source:read|source:write|source:authorize|x:read|x:write|phase:read|phase:write|ops:read|security:read|restore:write`。

### 5.7 Auth、operation、attempt与delivery DTO

```text
LoginOptionsRequest =
  | {requestId:ID,ceremony:"bootstrap"}
  | {requestId:ID,ceremony:"login"}
FreshAction = "PUBLISH"|"CORRECT"|"WITHDRAW"|
  "SOURCE_ACTIVATE"|"SOURCE_STOP"|"SOURCE_RETIRE"|"SOURCE_AUTHORIZATION"|
  "PHASE_START_BACKLOG"|"PHASE_ENTER_LIVE"|"PHASE_PAUSE"|
  "PHASE_RESUME_BACKLOG"|"PHASE_RESUME_LIVE"|"PHASE_STOP"
FreshOptionsRequest = {requestId:ID,ceremony:"fresh",action:FreshAction,
  resourceType:"publication"|"source"|"phase",resourceId:ID,
  requestHash:SHA}
OptionsResponse = {
  ceremonyId: ID, publicKey: WebAuthnPublicKeyOptionsJSON,
  expiresAt: timestamp, rpId: string(1..253), origin: https-url
}
VerifyRequest = {ceremonyId: ID, credential: WebAuthnCredentialJSON}
SessionDTO = {
  authenticated: true, operatorRef: ID, sessionId: ID,
  capabilities: Capability[], createdAt: timestamp, expiresAt: timestamp,
  freshUntil: timestamp|null
}
CsrfDTO = {token: string(32..256), expiresAt: timestamp, sessionId: ID}
OperationDTO =
  | {state:"accepted"|"running", operationId:ID, kind:OperationKind,
     resourceType:ResourceType, resourceId:ID, requestHash:SHA,
     createdAt:timestamp, updatedAt:timestamp, pollAfterMs:integer(250..5000)}
  | {state:"reconcile_required", operationId:ID, kind:OperationKind,
     resourceType:ResourceType, resourceId:ID, requestHash:SHA,
     createdAt:timestamp, updatedAt:timestamp, reconcileReason:
     "response_lost"|"lease_expired"|"external_unknown", pollAfterMs:integer(250..5000)}
  | {state:"succeeded", operationId:ID, kind:OperationKind,
     resourceType:ResourceType, resourceId:ID, requestHash:SHA,
     createdAt:timestamp, updatedAt:timestamp, completedAt:timestamp,
     resultRef:{type:ResourceType,id:ID,revision:integer(0..2147483647)}}
  | {state:"failed"|"cancelled", operationId:ID, kind:OperationKind,
     resourceType:ResourceType, resourceId:ID, requestHash:SHA,
     createdAt:timestamp, updatedAt:timestamp, completedAt:timestamp,
     reasonCode:ProblemCode, retryable:boolean}
AttemptDTO =
  | {state:"prepared"|"sent", attemptId:ID, operationId:ID,
     channel:"model"|"oembed"|"public_receiver", requestHash:SHA,
     ordinal:integer(1..3), createdAt:timestamp, deadlineAt:timestamp}
  | {state:"unknown", attemptId:ID, operationId:ID,
     channel:"model"|"oembed"|"public_receiver",
     requestHash:SHA, ordinal:integer(1..3), createdAt:timestamp,
     deadlineAt:timestamp, reconcileAfter:timestamp}
  | {state:"succeeded"|"failed", attemptId:ID, operationId:ID,
     channel:"model"|"oembed"|"public_receiver", requestHash:SHA,
     ordinal:integer(1..3), createdAt:timestamp,
     completedAt:timestamp, responseReceiptHash:SHA|null,
     reasonCode:ProblemCode|null}
DeliveryDTO =
  | {state:"queued"|"sending", deliveryId:ID, publicationId:ID,
     generationId:ID, payloadHash:SHA, attemptId:ID|null,
     createdAt:timestamp, updatedAt:timestamp, pollAfterMs:integer(250..5000)}
  | {state:"reconcile_required", deliveryId:ID, publicationId:ID,
     generationId:ID, payloadHash:SHA, attemptId:ID,
     createdAt:timestamp, updatedAt:timestamp, reconcileReason:
     "response_lost"|"receipt_missing"|"receiver_unknown"}
  | {state:"delivered", deliveryId:ID, publicationId:ID,
     generationId:ID, payloadHash:SHA, attemptId:ID,
     createdAt:timestamp, updatedAt:timestamp, deliveredAt:timestamp,
     receiverReceiptHash:SHA}
  | {state:"failed"|"cancelled", deliveryId:ID, publicationId:ID,
     generationId:ID, payloadHash:SHA, attemptId:ID|null,
     createdAt:timestamp, updatedAt:timestamp, completedAt:timestamp,
     reasonCode:ProblemCode}
```

WebAuthn的RP ID、Origin、challenge/session TTL、cookie名/domain/path/SameSite/Secure/HttpOnly值必须来自production manifest；challenge为单次、120秒，verify成功或失败即消费；session绝对TTL 8小时、idle TTL 30分钟；CSRF单次、10分钟并绑定session+method+path。bootstrap只在DB中零credential且manifest提供一次性bootstrap authority时可用，成功后永久关闭。operation不存在/越权404，超过30天retention为410；non-terminal返回200加`Retry-After: ceil(pollAfterMs/1000)`，terminal永久不可回转。delivery同理，保留至少90天。response loss后客户端只GET原operation/delivery；服务端只查同一idempotency/requestHash/attempt或receiver receipt，禁止创建新attempt，直到明确`failed + retryable=true`且新idempotency key发起有界重试。

FreshAction映射是closed且大小写敏感：publication三个route分别为`publish→PUBLISH`、`correct→CORRECT`、`withdraw→WITHDRAW`，resourceType=`publication`且resourceId为Publication ID；source高风险action分别为`activate→SOURCE_ACTIVATE`、`stop→SOURCE_STOP`、`retire→SOURCE_RETIRE`、`authorization→SOURCE_AUTHORIZATION`，resourceType=`source`且resourceId为Source ID；phase action分别映射`start_backlog→PHASE_START_BACKLOG`、`enter_live→PHASE_ENTER_LIVE`、`pause→PHASE_PAUSE`、`resume_backlog→PHASE_RESUME_BACKLOG`、`resume_live→PHASE_RESUME_LIVE`、`stop→PHASE_STOP`，resourceType=`phase`且唯一resourceId固定`auto-publish-policy`。requestHash必须等于随后mutation的§5.6重算值；action、resourceType、resourceId、requestHash任一不等为403且fresh grant不消费。restore/emergency ingress当前没有本合同内HTTP mutation route，因此FreshAction中不提供对应值；只有独立successor新增exact route/action后才能签发。

### 5.8 逐实体 closed state transition

每次允许转换必须在一个`BEGIN IMMEDIATE`中完成CAS、实体写、Operation更新、AuditEvent追加及需要时Outbox追加；actor/capability不符或from-state不符零写并返回403/409。

| Entity | Closed states与唯一转换 | Actor/capability | 失败/恢复 |
|---|---|---|---|
| Candidate | `captured→normalized→deduplicated→reviewable`; 任一处理态→`blocked|failed`; `blocked|failed→normalized`仅requeue；`reviewable→superseded`仅新source revision | worker gateway；requeue=`review:write` | 无`withdrawn`；旧revision只读 |
| LanguageSlot | `missing→queued→running→complete`; `queued|running→blocked|failed|reconcile_required`; `complete→stale`; `blocked|failed→queued`用新operation；`reconcile_required→running|complete|failed`只同attempt receipt | model gateway；rerun=`review:write` | 每槽最多3次attempt；both是一个parent+两个child |
| Bundle | `draft→reviewable→superseded`；只有两个current complete槽可创建reviewable | gateway | immutable；输入/hash变化只建新bundle |
| Approval | `pending→approved|rejected|manual_override|superseded`; approved等终态不可改，输入漂移→superseded并建新pending | `review:write` | manual_override永不进system-auto |
| Publication | `queued→publishing→published`; `publishing→reconcile_required|failed`; `reconcile_required→published|failed`; `published→correction_queued|withdrawal_queued`; correction/withdrawal queued各自→`publishing→published|reconcile_required|failed`并建新revision | publish/correct/withdraw=`publish:write`+fresh | 当前代码只实现publish；correct/withdraw为pending |
| Projection | `staged→active→superseded`; active可因withdrawal→`withdrawn`; 签名/内容错误的staged→`invalid` | signed receiver | active pointer原子换代；失败保留LKG |
| Source | `lifecycle_status`只允许`proposed→active→paused→active`及`active→retired`，retired终态。`collection_onboarding_status`使用本节下方16值与完整edge闭集；validating绝不属于lifecycle。canonical三列始终存在：`identity_status`、`relevance_status`、`monitorability`；任何派生guard不得替代 | read/source:read；add/validate/requeue=source:write；activate/stop/retire/auth=source:authorize+fresh | 新源默认proposed/validating/disabled且canonical三列unknown；activate与queue claim均显式读取canonical三列、五个activation guard和五个epoch fence |
| XSubmission | `submitted→validated→candidate_created|retired`; `submitted|validated→duplicate|blocked`; `validated→oembed_pending`仅flag启用；`oembed_pending→oembed_resolved|reconcile_required|blocked`; reconcile只同attempt→resolved|blocked | x:write；oEmbed还需manifest capability | retention：URL/hash/audit 365天；oEmbed payload 30天；retired终态 |
| Phase | `disabled→backlog→live`; `backlog|live→paused`; `paused→backlog|live`; 任一非disabled→disabled。enter_live只从backlog且零集合；resume保留原cutoff/epoch | phase:write+fresh | 每次转换增epoch并写cutoff/required fences |
| Operation/Attempt/Delivery | 只允许§5.7 union从左到右转换 | gateway | terminal不可回转；unknown只reconcile |

X URL canonicalization固定为：解析后scheme必须https、host小写且仅`x.com|twitter.com`、去fragment/query、移除默认端口、path必须精确`/{screenName}/status/{decimalStatusId}`，screenName匹配`[A-Za-z0-9_]{1,15}`，status ID保留十进制字节；canonical form固定`https://x.com/{screenNameLower}/status/{statusId}`。dedupe key为`sha256("x-status-v1\\n"+statusId)`，同status返回既有Submission，body差异不新建。XCreateRequest=`{meta:MutationMeta,submittedUrl:https-url}`；响应202 Accepted。OEmbedResolveRequest=`{meta:MutationMeta}`，provider URL、timeout（5秒）、response上限262144字节、redirect（0）、attempt上限（1）由manifest固定；disabled时403 CAPABILITY_DISABLED且externalCalls=0。

SourceCreateRequest=`{meta:MutationMeta,displayName:string(1..200),canonicalFeedUrl:https-url,siteUrl:https-url,sourceKind:"rss"|"x_manual",collectionMode:"rss"|"manual_url"}`，创建结果202。SourceReason=`OPERATOR_REQUEST|VALIDATION_PASSED|VALIDATION_FAILED|POLICY_CHANGE|CREDENTIAL_ROTATION|INCIDENT|RETIREMENT`；SourceActionRequest=`{meta:MutationMeta,reasonCode:SourceReason,authorizationRef:ID|null}`。SourceDTO固定包含`sourceId:ID,revision:integer(0..2147483647),displayName:string(1..200),canonicalFeedUrl:https-url|null,canonical_url_valid:boolean,siteUrl:https-url,sourceKind:"rss"|"x_manual",collectionMode:"rss"|"manual_url",enabled:boolean,lifecycle_status:LifecycleStatus,collection_onboarding_status:CollectionOnboardingStatus,normalization_status:NormalizationStatus,dedup_status:DedupStatus,identity_status:IdentityStatus,relevance_status:RelevanceStatus,monitorability:Monitorability,adapter_status:AdapterStatus,adapter_authorization_status:AdapterAuthorizationStatus,authorization_expires_at:timestamp|null,platform_allowed:PlatformAllowed,source_stop_status:SourceStopStatus,source_config_epoch:integer(1..2147483647),source_safety_epoch:integer(1..2147483647),activation_readiness:ActivationReadiness,epoch_fences:EpochFenceReadModel,createdAt:timestamp,updatedAt:timestamp,allowedActions:SourceAction[]`。

唯一枚举为：LifecycleStatus=`proposed|active|paused|retired`；CollectionOnboardingStatus=`validating|activation_pending|queued|collecting|active|normalization_failed|dedup_needs_review|linked_existing|blocked_adapter_missing|blocked_authorization|blocked_platform|queue_failed|collection_failed|stopped|cancelled|dead_letter`；NormalizationStatus=`pending|valid|invalid`；DedupStatus=`pending|unique|needs_review|linked_existing`；IdentityStatus=`unknown|verified|needs_review`；RelevanceStatus=`unknown|qualified|rejected`；Monitorability=`unknown|monitorable|restricted|unavailable`；AdapterStatus=`unchecked|ready|missing|unavailable`；AdapterAuthorizationStatus=`unknown|valid|invalid|expired`；PlatformAllowed=`unknown|allowed|blocked`；SourceStopStatus=`clear|manual|compliance|authorization|platform`。列表sort只允许`displayName:asc|updatedAt:desc`，filter只允许`lifecycle_status,collection_onboarding_status,identity_status,relevance_status,monitorability,sourceKind,enabled`。

`activation_readiness`是只读派生对象，禁止持久化或作为canonical三列alias。ActivationGuardReason=`READY|CANONICAL_INVALID|NORMALIZATION_NOT_VALID|DEDUP_NOT_UNIQUE|IDENTITY_NEEDS_REVIEW|RELEVANCE_REJECTED|MONITORABILITY_RESTRICTED|MONITORABILITY_UNAVAILABLE|PLATFORM_BLOCKED|AUTHORIZATION_INVALID|AUTHORIZATION_EXPIRED|ADAPTER_MISSING|ADAPTER_UNAVAILABLE|STOP_SET|INPUT_UNKNOWN`；GuardDatum=`{state:"clear"|"blocked"|"unknown",reasonCode:ActivationGuardReason}`；ActivationReadiness=`{statusGuard:GuardDatum,platformGuard:GuardDatum,authorizationGuard:GuardDatum,adapterGuard:GuardDatum,stopGuard:GuardDatum}`。唯一推导为：statusGuard仅在`canonical_url_valid=true,normalization_status=valid,dedup_status=unique,identity_status∈{unknown,verified},relevance_status∈{unknown,qualified},monitorability∈{unknown,monitorable}`时clear；明确invalid/needs_review/linked_existing/rejected/restricted/unavailable按对应reason blocked；任一字段缺失或越界时unknown/INPUT_UNKNOWN。platformGuard在allowed时clear、blocked时blocked、canonical值unknown或缺值时unknown；authorizationGuard在valid且expiry存在并晚于asOf时clear，在invalid/expired或已过期时blocked，在canonical值unknown/缺时间时unknown；adapterGuard在ready时clear、missing/unavailable时blocked、unchecked/缺值时unknown；stopGuard仅clear时clear，其他合法值blocked，缺值/越界unknown。canonical status值`unknown`与GuardDatum状态`unknown`语义不同：前三个canonical unknown按上述statusGuard允许，platform/auth/adapter的unknown阻断。任一guard为blocked或unknown均禁止activate及queued→collecting；读取失败不得回填canonical status。

五个epoch fence的唯一真值和DTO固定为：EpochFenceDatum=`{current:integer(1..2147483647)|null,expected:integer(1..2147483647),state:"clear"|"stale"|"unknown",truthReceiptHash:SHA|null}`；EpochFenceReadModel=`{sourceConfigEpoch:EpochFenceDatum,sourceSafetyEpoch:EpochFenceDatum,authorizationVersion:EpochFenceDatum,policyEpoch:EpochFenceDatum,recoveryEpoch:EpochFenceDatum}`。唯一真值依次为Source行的`source_config_epoch`、Source行的`source_safety_epoch`、0007 authorization registry当前version、auto/media/source policy singleton当前epoch、0007 common recovery point当前epoch；expected来自同一operation创建时冻结的五值。只有current=expected且truth receipt存在并通过hash/schema/current-writer验证时clear；current存在但不等时stale；真值缺失、读取失败、receipt缺失/无效、writer/recovery identity不明时unknown。stale或unknown均零写、零外联且进入blocked/reconcile，不得显示clear、不得用0、默认1或canonical status代替。

| Read-model key | 唯一真值 | clear | unknown |
|---|---|---|---|
| `sourceConfigEpoch` | 当前Source行`source_config_epoch` | 等于operation expected且Source row hash/receipt有效 | 行/字段/row receipt缺失、非法或读取失败 |
| `sourceSafetyEpoch` | 当前Source行`source_safety_epoch` | 等于operation expected且Source row hash/receipt有效 | 行/字段/row receipt缺失、非法或读取失败 |
| `authorizationVersion` | 0007 authorization registry当前version | 等于operation expected且authorization receipt有效、未过期 | registry/版本/receipt/expiry缺失、非法或读取失败 |
| `policyEpoch` | auto/media/source policy singleton当前epoch | 等于operation expected且policy receipt与manifest identity有效 | singleton/epoch/receipt/manifest identity缺失、非法或读取失败 |
| `recoveryEpoch` | 0007 common recovery point当前epoch | 等于operation expected且writer/recovery receipt有效 | recovery point/epoch/receipt/writer identity缺失、非法或读取失败 |

CollectionOnboardingStatus只允许以下有向edge，括号外不存在任何隐式edge：`validating→normalization_failed|dedup_needs_review|linked_existing|activation_pending`；`activation_pending→blocked_platform|blocked_authorization|blocked_adapter_missing|queued`；`blocked_platform|blocked_authorization|blocked_adapter_missing→activation_pending`；`normalization_failed|dedup_needs_review→validating`；`queued→collecting|stopped|cancelled|queue_failed`；`queue_failed→activation_pending|dead_letter`；`collecting→active|collection_failed|stopped|cancelled`；`collection_failed→collecting|dead_letter`；`active→stopped|cancelled`；`stopped|cancelled|dead_letter→activation_pending`。linked_existing为终态。每条guard逐字继承`data/mvp-contract-v0/state-machine.json` SHA-256 `d5ca45fd60c2ad08c60929abd714f6e80c43c20f561be0c0a18e3baa17c7c120`的`state_machines.source_onboarding`；该文件漂移即0010 blocked。

0010迁移映射固定如下：四条schema6 RSS的`source_id/feed_url/enabled`逐字复制为`sourceId/canonicalFeedUrl/enabled`；`stop_epoch,etag,last_modified,last_attempt_at,last_success_at,next_eligible_at,last_reason_code`保留在collector runtime state且逐字复制。四RSS共同映射`canonical_url_valid=true,normalization_status=valid,dedup_status=unique,identity_status=unknown,relevance_status=unknown,monitorability=unknown,adapter_status=ready,adapter_authorization_status=valid,platform_allowed=allowed,source_config_epoch=stop_epoch,source_safety_epoch=stop_epoch`；authorization expiry和truth receipt必须由production manifest钉死的当前授权证据提供，缺失即rollback。四RSS的`enabled=1`映射`lifecycle_status=active,collection_onboarding_status=active,source_stop_status=clear`；`enabled=0`只允许在manifest给出精确stop证据与`source_stop_status=manual|compliance|authorization|platform`时映射`lifecycle_status=paused,collection_onboarding_status=stopped`，否则rollback。

59 X只从production manifest钉死的inventory逐ID导入，固定`enabled=false,lifecycle_status=proposed,collection_onboarding_status=validating,normalization_status=pending,dedup_status=pending,identity_status=unknown,relevance_status=unknown,monitorability=unknown,adapter_status=unchecked,adapter_authorization_status=unknown,platform_allowed=unknown,source_stop_status=clear,source_config_epoch=1,source_safety_epoch=1,sourceKind=x_manual,collectionMode=manual_url`。普通新source使用相同默认，仅sourceKind/collectionMode取请求闭集。任何old source ID/URL不在四RSS精确集合、重复canonical URL、未知old enum、canonical三列缺失/改名、`validating|stopped`写入lifecycle、四RSS被降为proposed或59 X被启用均整笔rollback。

activate事务和queued→collecting lease claim必须在同一writer snapshot中显式读取并审计`identity_status,relevance_status,monitorability`原值、五个ActivationReadiness结果及五个EpochFenceDatum。activate只在五guard和五epoch fence全clear时写`enabled=true/queued`；queued claim除相同条件外还要求same operation/key与fresh lease。任一canonical列缺失、非法、在CAS后漂移，或任一派生值blocked/stale/unknown，均零写、provider前`externalCalls=0`；不得用派生Datum反写三列或绕过expected epoch。

### 5.9 Route registry

| Route | exact request | success response/status | sort/cache/auth/fresh |
|---|---|---|---|
| Public feed v1 | query `v=1,source?,contentType?,cursor?` | PublicFeedV1 200/304 | 继承当前cursor排序；public cache |
| Public detail v1 | path publicId, query `v=1` | PublicDetailV1 200/304 | public cache；不存在404 |
| Public feed v2 | query `v=2,limit,cursor,category?` | PublicFeedV2 200/304 | `publishedAt:desc,publicId:desc`; public cache |
| Public detail v2 | path publicId, query `v=2` | PublicDetailV2 200/304 | public cache；不存在404 |
| health | 无query | HealthDTO 200或503 | no-store；只读sealed receipts |
| auth options/verify/session/csrf | §5.7 exact DTO | 对应OptionsResponse/SessionDTO/CsrfDTO 200；DELETE session 204 | no-store；verify限5次/15分钟 |
| operations/deliveries detail | path ID，无query | §5.7 union 200 | no-store；session+resource capability |
| reviews list | ReviewListQuery | ReviewListDTO 200 | sort `createdAt:desc|updatedAt:desc`；review:read |
| review detail | path candidateId | ReviewDetailDTO 200 | review:read |
| revision/rerun/approve/reject | RevisionRequest/RerunRequest/DecisionRequest | Accepted 202 | review:write；approve/reject不需fresh |
| publish/correct/withdraw | PublishRequest/CorrectRequest/WithdrawRequest | Accepted 202 | publish:write+fresh |
| sources list/detail/create/actions | §5.8 Source DTO/body | GET 200；mutation Accepted 202 | source capability；高风险action fresh |
| X list/detail/create/actions | GET filter仅state/sourceId，sort `createdAt:desc`；POST见§5.8 | GET页面/DTO 200；mutation Accepted 202 | x capability；bounded limit |
| policy GET | 无query | PhaseDTO 200 | phase:read |
| phase control | PhaseControlRequest | Accepted 202 | phase:write+fresh |
| ops endpoints | `window:"15m"|"1h"|"24h"|"7d",limit?`；logs另有cursor,severity?,eventType? | OpsSnapshot 200 | ops:read；no-store；limit默认100最大500 |

Public v2的localized规则由§5.11的V2类型唯一表达。只有两个槽均current complete才可生成V2；V1完全使用独立V1类型，禁止向V1追加localized、generation或英文键。

### 5.10 Ops统一snapshot、bounded schema与隐私

```text
Freshness =
  | {state:"fresh", observedAt:timestamp, maxAgeSeconds:integer(1..2147483647),
     ageSeconds:integer(0..2147483647)}
  | {state:"stale", observedAt:timestamp, maxAgeSeconds:integer(1..2147483647),
     ageSeconds:integer(0..2147483647)}
  | {state:"unknown", observedAt:null, maxAgeSeconds:integer(1..2147483647), reasonCode:
     "producer_missing"|"receipt_invalid"|"clock_invalid"|"source_unavailable"}
ProducerRef = {producerId:ID, receiptId:ID, receiptHash:SHA,
               producedAt:timestamp, schemaVersion:string(1..80)}
Datum<T> =
  | {availability:"available", freshness:Freshness, unit:OpsUnit, value:T,
     producer:ProducerRef}
  | {availability:"unavailable", freshness:Freshness, unit:OpsUnit,
     value:null, producer:ProducerRef|null}
OpsUnit = "state"|"items"|"events"|"aggregate_buckets"|
  "attempt_aggregates"|"minor_currency_units"|"release_identity"|
  "recovery_point"|"audit_events"
OpsSnapshot<T> = {schemaVersion:"f1plus1-ops-snapshot-v1", snapshotId:ID,
  asOf:timestamp, window:"15m"|"1h"|"24h"|"7d",
  generatedFromReceiptHashes:SHA[], sectionName:OpsSectionName,
  section:Datum<T>, alerts:AlertDTO[0..100]}
OpsSectionName = "overview"|"pipeline"|"logs"|"traffic"|"apis"|
  "cost"|"release"|"backup"|"audit"
OverviewSection = {processState:"running"|"stopped"|"unknown",
  listenerState:"reachable"|"unreachable"|"unknown",
  publicState:"reachable"|"unreachable"|"unknown",
  schemaState:"match"|"drift"|"unknown",
  releaseState:"match"|"drift"|"unknown",
  pipelineBlocked:integer(0..9007199254740991),
  reconcileRequired:integer(0..9007199254740991),
  backupRpoState:"within"|"breach"|"unknown"}
PipelineSection = {captured:integer(0..9007199254740991),
  normalized:integer(0..9007199254740991),
  reviewable:integer(0..9007199254740991),
  languageQueued:integer(0..9007199254740991),
  languageRunning:integer(0..9007199254740991),
  languageBlocked:integer(0..9007199254740991),
  approvalPending:integer(0..9007199254740991),
  publicationQueued:integer(0..9007199254740991),
  deliveryPending:integer(0..9007199254740991),
  reconcileRequired:integer(0..9007199254740991),
  failed:integer(0..9007199254740991),
  oldestPendingAt:timestamp|null}
LogsSection = {items:LogEventDTO[0..500], page:PageMeta}
TrafficSection = {buckets:TrafficBucketDTO[0..672]}
ApisSection = {items:ApiAggregateDTO[0..100]}
CostSection = {items:CostDTO[0..100]}
ReleaseSection = ReleaseDTO
BackupSection = BackupDTO
AuditSection = {items:AuditDTO[0..500], page:PageMeta}
```

每个path只返回与其`sectionName`匹配的closed section；无数据时`section`必须为Datum unavailable，禁止省略或填0。fresh阈值：process/listener/reachability 120秒，pipeline/API/log 300秒，traffic 600秒，cost 86400秒，backup 900秒，release/schema 3600秒。snapshot的`asOf`取服务器当前时间，所有receipt必须`producedAt<=asOf`且时钟未来漂移不超过30秒；超限为unknown。

unit映射固定为：overview=`state`，pipeline=`items`，logs=`events`，traffic=`aggregate_buckets`，apis=`attempt_aggregates`，cost=`minor_currency_units`，release=`release_identity`，backup=`recovery_point`，audit=`audit_events`。

- logs：最多500条，LogEventDTO为`{eventId:ID,timestamp:timestamp,severity:"info"|"warn"|"error"|"critical",eventType:LogEventType,component:Component,operationId:ID|null,resourceType:ResourceType|null,resourceId:ID|null,reasonCode:ProblemCode|null}`；`LogEventType=AUTH_SUCCESS|AUTH_FAILURE|OPERATION_STATE|ATTEMPT_STATE|DELIVERY_STATE|SOURCE_STATE|PHASE_STATE|BACKUP_STATE|INTEGRITY_STATE|OBSERVER_STATE`；`Component=admin|collector|refiner|review_worker|publish_worker|sender|receiver|observer|backup`。resourceType与resourceId必须同时null或同时非null。无message/raw/stack/path/payload字段，retention 30天。
- traffic：聚合桶最多672个，TrafficBucketDTO为`{bucketStart:timestamp,bucketSeconds:900,routeClass:"feed"|"detail"|"asset"|"health"|"other",statusClass:"2xx"|"3xx"|"4xx"|"5xx",requests:integer(0..9007199254740991),bytesOut:integer(0..9007199254740991),latencyMsP50:integer(0..2147483647)|null,latencyMsP95:integer(0..2147483647)|null}`；仅公开ingress sealed receipt，retention 90天；禁止IP及hash、Cookie/Auth、UA、body、query、full URL、referrer和单请求记录。
- API：最多100个聚合项，ApiAggregateDTO为`{routeId:ID,providerId:ID|null,outcome:"succeeded"|"failed"|"unknown",attempts:integer(0..9007199254740991),latencyMsP50:integer(0..2147483647)|null,latencyMsP95:integer(0..2147483647)|null,lastAttemptAt:timestamp|null,lastReceiptHash:SHA|null}`；outcome=unknown时lastReceiptHash必须null；只读durable attempt/result。
- cost：币种只允许manifest列出的ISO-4217。CostDTO为`{providerId:ID,currency:string(3..3),periodStart:timestamp,periodEnd:timestamp,budgetMinor:integer(0..9007199254740991),actual:ActualCost,estimate:EstimatedCost}`；ActualCost=`{availability:"available",freshness:Freshness,amountMinor:integer(0..9007199254740991),receiptHash:SHA}|{availability:"unavailable",freshness:Freshness,reasonCode:"billing_receipt_missing"|"billing_receipt_invalid"|"provider_unavailable"}`；EstimatedCost=`{availability:"available",freshness:Freshness,amountMinor:integer(0..9007199254740991),method:"token_rate_v1"|"request_rate_v1",inputHash:SHA}|{availability:"unavailable",freshness:Freshness,reasonCode:"estimate_disabled"|"rate_missing"|"usage_missing"}`。actual amountMinor=0明确表示有有效billing receipt的零费用；actual unavailable表示未知；estimate available且actual unavailable明确表示只有估算。actual与estimate不得相加或互相冒充。
- alerts：AlertDTO为`{alertId:ID,severity:"info"|"warning"|"critical",reasonCode:AlertReason,subjectType:AlertSubjectType,subjectId:ID|null,firstObservedAt:timestamp,lastObservedAt:timestamp,inputSnapshotId:ID,inputHash:SHA}`；`AlertReason=PRODUCER_UNKNOWN|PRODUCER_STALE|SCHEMA_DRIFT|RELEASE_DRIFT|BACKUP_RPO_BREACH|PIPELINE_BLOCKED|DELIVERY_RECONCILE_REQUIRED|ERROR_RATE_HIGH|BUDGET_THRESHOLD|SECURITY_IDENTITY_DRIFT|PUBLIC_UNAVAILABLE`；`AlertSubjectType=system|producer|schema|release|backup|pipeline|delivery|budget|security|public`。alert为snapshot纯函数，无ack/silence mutation；同`reason+subject+inputHash`稳定同ID。阈值全部来自manifest：缺阈值即PRODUCER_UNKNOWN，不能自选默认。
- privacy：Ops响应、receipt和audit都禁止credential、session/csrf、完整login/email、IP/hash、UA、请求/响应body、source原文、prompt、model raw、stack、绝对路径和自由文本；operator、device、source均只返回opaque Ref。解析失败必须使对应Datum unavailable并产生INTEGRITY_FAILURE，禁止丢字段后继续标fresh。

`AlertDTO.subjectId`在system/schema/release/public时必须null，其余必须ID。

### 5.11 剩余DTO closed definitions

```text
PublicContentTypeV1 = "race_news"|"driver_social"|"legends_history"|"paddock_fun"
PublicStateV1 = "available"|"restricted"|"media_missing"|"ready"
PublicOriginalLinkV1 =
  | {enabled:false,url:null,reason:"synthetic_only"|"source_restricted"}
  | {enabled:true,url:https-url,reason:null}
PublicRelatedSourceV1 = {publicId:string(1..127),sourceId:string(1..127),
  displayName:string(1..120),originalUrl:https-url|null}
PublicSourceV1 = {sourceId:string(1..127),
  platform:"x"|"instagram"|"reddit"|"website"|"rss",
  displayName:string(1..120),byline:string(1..120),
  accessStatus:"available"|"restricted"}
PublicMediaV1 =
  | null
  | {kind:"synthetic_placeholder",assetRef:string(1..180),
     altZh:string(1..300),captionZh:string(1..300)|null,
     creditDisplay:string(1..120)|null,
     tone:"night"|"blue"|"amber"|"violet"|"slate"}
  | {kind:"source_image",assetRef:https-url,
     mimeType:"image/jpeg"|"image/png"|"image/webp"|"image/avif",
     declaredBytes:integer(1..20971520),altZh:string(1..300)}
PublicStoryCardV1 = {publicId:string(1..127),contentType:PublicContentTypeV1,
  state:PublicStateV1,titleZh:string(1..400),summaryZh:string(1..1200),
  publishedAt:timestamp,sourcePublishedAt:timestamp|null,
  sourceTimeStatus:"known"|"unknown",source:PublicSourceV1,
  media:PublicMediaV1,originalLink:PublicOriginalLinkV1,
  relatedSources:PublicRelatedSourceV1[0..20]?}
PublicStoryV1 = {publicId:string(1..127),contentType:PublicContentTypeV1,
  state:PublicStateV1,titleZh:string(1..400),summaryZh:string(1..1200),
  publishedAt:timestamp,sourcePublishedAt:timestamp|null,
  sourceTimeStatus:"known"|"unknown",source:PublicSourceV1,
  media:PublicMediaV1,originalLink:PublicOriginalLinkV1,
  relatedSources:PublicRelatedSourceV1[0..20]?,
  leadZh:string(1..400),bodyZh:string(1..1200)[0..8],
  keyPointsZh:string(1..240)[0..8]}
PublicPageV1 = {pageSize:12,hasMore:boolean,
  nextCursor:null|{cursorAt:timestamp,cursorId:string(1..127)}}
PublicFeedV1 = {schemaVersion:"public-read-v0.1",
  items:PublicStoryCardV1[0..12],page:PublicPageV1}
PublicDetailV1 = {schemaVersion:"public-read-v0.1",story:PublicStoryV1,
  relatedItems:PublicStoryCardV1[0..3]}

LocalizedV2 = {title:string(1..200),summary:string(1..600),
  lead:string(1..600),body:string(1..12000),
  keyPoints:string(1..240)[1..8],contentHash:SHA}
PublicMediaV2 = {kind:"image",url:https-url,alt:string(1..300),
  width:integer(1..8192),height:integer(1..8192),
  rightsPolicyId:ID,mediaHash:SHA}
PublicSourceV2 = {name:string(1..200),author:string(1..200)|null,
  publishedAt:timestamp|null,canonicalUrl:https-url}
PublicStoryCardV2 = {publicId:ID,category:string(1..80),
  defaultLanguage:"zh-CN",availableLanguages:["zh-CN","en"],
  localized:{"zh-CN":LocalizedV2,"en":LocalizedV2},
  source:PublicSourceV2,publishedAt:timestamp,updatedAt:timestamp,
  media:PublicMediaV2[0..1]}
PublicStoryV2 = {publicId:ID,category:string(1..80),
  defaultLanguage:"zh-CN",availableLanguages:["zh-CN","en"],
  localized:{"zh-CN":LocalizedV2,"en":LocalizedV2},
  source:PublicSourceV2,publishedAt:timestamp,updatedAt:timestamp,
  media:PublicMediaV2[0..4]}
PublicFeedV2 = {schemaVersion:"public-read-bilingual-v2",
  items:PublicStoryCardV2[0..50],page:PageMeta,
  generationId:ID,generationHash:SHA}
PublicDetailV2 = {schemaVersion:"public-read-bilingual-v2",
  story:PublicStoryV2,relatedItems:PublicStoryCardV2[0..12],
  generationId:ID,generationHash:SHA}

CandidateDTO = {candidateId:ID, revision:integer(0..2147483647), state:CandidateState,
  sourceId:ID, sourceRevision:integer(0..2147483647), canonicalUrl:https-url,
  sourceTitle:string(1..300), sourceAuthor:string(1..200)|null,
  sourcePublishedAt:timestamp|null, inputContentHash:SHA,
  sourceFactSetHash:SHA, createdAt:timestamp, updatedAt:timestamp}
LanguageSlotDTO = {slotId:ID, language:"zh-CN"|"en",
  revision:integer(0..2147483647), state:LanguageSlotState,
  sourceRevision:integer(0..2147483647), inputContentHash:SHA,
  sourceFactSetHash:SHA, sourceReleaseHash:SHA,
  promptSchemaVersion:string(1..80), promptSha256:SHA,
  modelRouteReceiptHash:SHA|null, draftHash:SHA|null,
  failureReason:ProblemCode|null, updatedAt:timestamp}
BundleDTO = {bundleId:ID, revision:integer(0..2147483647),
  state:"draft"|"reviewable"|"superseded",
  zhSlotId:ID, zhDraftHash:SHA, enSlotId:ID, enDraftHash:SHA,
  sourceRevision:integer(0..2147483647), bundleHash:SHA, createdAt:timestamp}
ApprovalDTO = {approvalId:ID, state:"pending"|"approved"|"rejected"|
  "manual_override"|"superseded", bundleId:ID, bundleHash:SHA,
  actorRef:ID|null, reasonCode:DecisionReason|null, decidedAt:timestamp|null}
PublicationDTO = {publicationId:ID, publicId:ID,
  revision:integer(0..2147483647),
  state:PublicationState, bundleId:ID, bundleHash:SHA,
  generationId:ID|null, deliveryId:ID|null, createdAt:timestamp, updatedAt:timestamp}
ReviewSummary = {candidate:CandidateDTO, slots:{"zh-CN":LanguageSlotDTO,
  "en":LanguageSlotDTO}, currentBundle:BundleDTO|null,
  approval:ApprovalDTO|null, publication:PublicationDTO|null,
  allowedActions:ReviewAction[]}
ReviewAction = "edit_zh"|"edit_en"|"rerun_zh"|"rerun_en"|
  "rerun_both"|"approve"|"reject"|"publish"|"correct"|"withdraw"
DecisionReason = "EDITOR_APPROVED"|"EDITOR_REJECTED"|"COPY_RISK"|
  "RIGHTS_UNKNOWN"|"FACT_CONFLICT"|"SOURCE_STALE"|"CORRECTION"|"WITHDRAWAL"
SourceAction = "validate"|"activate"|"stop"|"retire"|"requeue"|"authorization"
HealthCheckName = "public_generation"|"public_receiver"|"schema"|"release"|"observer"
HealthCheckDTO = {name:HealthCheckName,
  state:"ok"|"degraded"|"unavailable"|"unknown",
  observedAt:timestamp|null,receiptHash:SHA|null}
HealthDTO = {status:"ok"|"degraded"|"unavailable",asOf:timestamp,
  freshness:Freshness,checks:HealthCheckDTO[5..5]}
ReviewListQuery = {limit:integer(1..100),cursor:string(1..2048)?,
  state:CandidateState?,sourceId:ID?,
  sort:"createdAt:desc"|"updatedAt:desc"?}
ReviewListDTO = {items:ReviewSummary[0..100],page:PageMeta}
ReviewDetailDTO = {candidate:CandidateDTO,
  languageSlots:{"zh-CN":LanguageSlotDTO,"en":LanguageSlotDTO},
  bundles:BundleDTO[0..20],approval:ApprovalDTO|null,
  publication:PublicationDTO|null,allowedActions:ReviewAction[],
  revision:integer(0..2147483647)}
RevisionRequest = {meta:MutationMeta,language:"zh-CN"|"en",
  title:string(1..200),summary:string(1..600),lead:string(1..600),
  body:string(1..12000),keyPoints:string(1..240)[1..8]}
RerunRequest = {meta:MutationMeta,language:"zh-CN"|"en"|"both"}
DecisionRequest = {meta:MutationMeta,bundleId:ID,bundleHash:SHA,
  reasonCode:DecisionReason}
PublishRequest = {meta:MutationMeta,publicationId:ID,
  publicationRevision:integer(0..2147483647),bundleHash:SHA,
  reasonCode:"EDITOR_APPROVED"}
CorrectRequest = {meta:MutationMeta,publicationId:ID,
  publicationRevision:integer(0..2147483647),bundleHash:SHA,
  replacementBundleId:ID,replacementBundleHash:SHA,reasonCode:"CORRECTION"}
WithdrawRequest = {meta:MutationMeta,publicationId:ID,
  publicationRevision:integer(0..2147483647),bundleHash:SHA,
  reasonCode:"WITHDRAWAL"}
PhaseAction = "start_backlog"|"enter_live"|"pause"|
  "resume_backlog"|"resume_live"|"stop"
PhaseControlRequest = {meta:MutationMeta,action:PhaseAction,
  expectedPhase:"disabled"|"backlog"|"live"|"paused",
  expectedEpoch:integer(0..2147483647),cutoffAt:timestamp|null}

XSubmissionDTO = {submissionId:ID, revision:integer(0..2147483647),
  submittedUrl:https-url, canonicalUrl:https-url, statusId:string(1..32),
  dedupeKey:SHA, state:XSubmissionState, sourceId:ID|null,
  oembedAttemptId:ID|null, candidateId:ID|null,
  retentionExpiresAt:timestamp, createdAt:timestamp, updatedAt:timestamp}
PhaseDTO = {phase:"disabled"|"backlog"|"live"|"paused",
  epoch:integer(0..2147483647), revision:integer(0..2147483647),
  cutoffAt:timestamp|null,
  resumeTarget:"backlog"|"live"|null, batchLimit:integer(1..20),
  collectorIntervalSeconds:900, requiredFenceHash:SHA,
  blockingReasons:PhaseBlockReason[], updatedAt:timestamp,
  allowedActions:("start_backlog"|"enter_live"|"pause"|
    "resume_backlog"|"resume_live"|"stop")[]}
PhaseBlockReason = "RUNNING_COLLECTOR"|"PENDING_OUTBOX"|"WAITING_ITEM"|
  "MANUAL_OVERRIDE"|"FAILED_ITEM"|"RECONCILE_REQUIRED"|"STALE_ITEM"|
  "BACKUP_RPO_BREACH"|"SCHEMA_DRIFT"|"RELEASE_DRIFT"|"POLICY_UNKNOWN"
```

V1兼容身份pin为`app/src/server/public/types.ts` SHA-256 `fdef33df25a7c7878d7f39dd5c54c5d4e43c1b1e46322a207a142e6b9e7d1a48`中的`PublicFeedItemV1/PublicFeedResponseV1/PublicStoryDetailResponseV1`，§5.11只是把其字段边界完全展开；实现若发现展开值与该pin字节或现行compat vector不一致，必须保持V1旧字节并阻断R3合同，不能静默改变V1。V2不继承当前代码里名为`PublicFeedItemV2`的多媒体中文schema；本合同的V2唯一标识是`public-read-bilingual-v2`。

`CandidateState`、`LanguageSlotState`、`PublicationState`和`XSubmissionState`分别等于§5.8对应行出现的全部状态且不得扩展。字符串trim后不得为空，禁止C0/C1及bidi控制符；数组保持输入顺序且禁止重复。revision从0开始每次合法mutation加1，上限2147483647。GET review detail响应exact为`{candidate:CandidateDTO,languageSlots:{"zh-CN":LanguageSlotDTO,"en":LanguageSlotDTO},bundles:BundleDTO[0..20],approval:ApprovalDTO|null,publication:PublicationDTO|null,allowedActions:ReviewAction[],revision:integer(0..2147483647)}`；bundles按revision desc且最多20。

`SourceDTO.allowedActions`的类型为`SourceAction[]`且必须由§5.8的`lifecycle_status+collection_onboarding_status`与服务端capability交集确定。revision mutation中的title/summary/lead/body/keyPoints约束与LocalizedV2相同；`language`决定唯一被写槽，其他槽零写。

WebAuthn JSON使用以下closed adapter而非透传浏览器任意字段：

```text
WebAuthnPublicKeyOptionsJSON = {challenge:base64url(32..256), timeout:120000,
  rp:{id:string(1..253),name:"F1+1 Admin"},
  user?:{id:base64url(1..256),name:string(1..200),
  displayName:string(1..200)},
  allowCredentials?:{type:"public-key",id:base64url(1..1024),
  transports:("internal"|"hybrid"|"usb"|"nfc"|"ble")[]}[0..20],
  pubKeyCredParams:{type:"public-key",alg:-7|-257}[],
  userVerification:"required", attestation:"none"}
WebAuthnCredentialJSON = {id:base64url(1..1024),
  rawId:base64url(1..1024),type:"public-key",
  response:{clientDataJSON:base64url(1..65536),
  authenticatorData:base64url(1..65536),signature:base64url(1..65536),
  userHandle:base64url(1..1024)|null,
  attestationObject?:base64url(1..65536)},clientExtensionResults:{}}
```

所有二进制字段为无padding base64url且解码上限65536字节；verify拒绝未知extension、crossOrigin=true、Origin/RP/challenge不匹配、signCount倒退或credential未绑定当前operator。bootstrap options必须含user且不得含allowCredentials；login/fresh必须含allowCredentials且不得含user。DELETE session无body；POST csrf无body；其他route收到未列query或body字段即400。JSON mutation成功统一202 Accepted，GET成功200/304，DELETE session 204；没有隐式200 mutation。

header闭集只约束应用拥有的安全/自定义header及其multiplicity：`Tailscale-User-Login`、`Tailscale-App-Capabilities`必须由Serve在剔除同名入站值后各注入exactly one；`X-CSRF-Token`、`Idempotency-Key`、`X-F1-Fresh-Reauth`在需要它们的mutation上各exactly one，在其他route出现则拒绝；`Origin`在mutation和WebAuthn上exactly one；`Cookie`可由HTTP栈合并后交给严格cookie解析器，session cookie重名或非预期Admin cookie为400。所有这些header的逗号拼接、多实例、空值或超长（单值上限4096字节）均拒绝。`Authorization`、`Proxy-Authorization`、`Forwarded`、`X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Real-IP`、`X-F1-Approved-Device-Ref`出现即拒绝且不记录值；应急代理如未来需要其中任一header必须另立successor。

`Host`、`Connection`、`Content-Length`、`Transfer-Encoding`、`Accept`、`Accept-Encoding`、`Accept-Language`、`Cache-Control`、`Pragma`、`If-None-Match`、`Sec-Fetch-*`、`Sec-CH-UA-*`、`User-Agent`及其他标准HTTP/browser传输header由HTTP栈按协议处理；应用可以忽略，不能因为未列而400，也不能把它们纳入identity、authorization、CAS、requestHash、audit或rate-limit主体。HTTP栈必须拒绝冲突Content-Length/Transfer-Encoding、非法Host和header语法；应用只使用manifest固定authority校验后的canonical path。

### 5.12 Exact route展开

§5.1–5.5中的竖线只为目录缩写，实现时的closed route逐条如下，禁止新增别名、尾随动作或method：

| Method + path | request schema | response schema |
|---|---|---|
| `GET /api/public/feed?v=1` | §5.9 V1 feed query | PublicFeedV1 |
| `GET /api/public/feed?v=2` | §5.9 V2 feed query | PublicFeedV2 |
| `GET /api/public/stories/{publicId}?v=1` | §5.9 V1 detail query | PublicDetailV1 |
| `GET /api/public/stories/{publicId}?v=2` | §5.9 V2 detail query | PublicDetailV2 |
| `GET /api/health` | empty | §5.9 health DTO |
| auth六个POST | bootstrap/login options=`LoginOptionsRequest`且ceremony匹配path；fresh options=`FreshOptionsRequest`；verify三条=`VerifyRequest` | OptionsResponse或SessionDTO |
| `GET /api/admin/session` | empty | SessionDTO |
| `DELETE /api/admin/session` | empty | empty 204 |
| `POST /api/admin/csrf` | empty | CsrfDTO |
| `GET /api/admin/operations/{operationId}` | empty | OperationDTO |
| `GET /api/admin/deliveries/{deliveryId}` | empty | DeliveryDTO |
| `GET /api/admin/reviews` | §5.9 reviews query | `{items:ReviewSummary[],page:PageMeta}` |
| `GET /api/admin/reviews/{candidateId}` | empty | §5.11 review detail |
| `POST /api/admin/reviews/{candidateId}/revision` | §5.9 revision body | Accepted |
| `POST /api/admin/reviews/{candidateId}/rerun-language` | §5.9 rerun body | Accepted |
| `POST /api/admin/reviews/{candidateId}/approve` | §5.9 decision body | Accepted |
| `POST /api/admin/reviews/{candidateId}/reject` | §5.9 decision body | Accepted |
| `POST /api/admin/publications/{publicId}/publish` | §5.9 publish body | Accepted |
| `POST /api/admin/publications/{publicId}/correct` | §5.9 correct body | Accepted |
| `POST /api/admin/publications/{publicId}/withdraw` | §5.9 withdraw body | Accepted |
| `GET /api/admin/sources` | §5.8 filters/page | `{items:SourceDTO[],page:PageMeta}` |
| `POST /api/admin/sources` | SourceCreateRequest | Accepted |
| `GET /api/admin/sources/{sourceId}` | empty | SourceDTO |
| 六个source action POST：`validate,activate,stop,retire,requeue,authorization` | SourceActionRequest | Accepted |
| `GET /api/admin/x-submissions` | §5.9 X filters/page | `{items:XSubmissionDTO[],page:PageMeta}` |
| `POST /api/admin/x-submissions` | XCreateRequest | Accepted |
| `GET /api/admin/x-submissions/{submissionId}` | empty | XSubmissionDTO |
| `POST /api/admin/x-submissions/{submissionId}/resolve-oembed` | OEmbedResolveRequest | Accepted或403 Problem |
| `POST /api/admin/x-submissions/{submissionId}/retire` | `{meta:MutationMeta,reasonCode:"OPERATOR_REQUEST"|"RETIREMENT"}` | Accepted |
| `GET /api/admin/auto-publish/policy` | empty | PhaseDTO |
| `POST /api/admin/auto-publish/control` | §5.9 phase body | Accepted |
| 九个ops GET：`overview,pipeline,logs,traffic,apis,cost,release,backup,audit` | §5.9 ops query | OpsSnapshot |

每个Ops path的`sectionName`必须等于path末段，并使用§5.10同名Section DTO；overview不拼接其他原始section，只返回固定OverviewSection摘要和alerts。AuditAction只允许`OperationKind|AUTH_LOGIN|AUTH_FRESH|AUTH_LOGOUT|CSRF_ISSUE|INTEGRITY_CHECK`。AuditSubject=`{resourceType:ResourceType|"session",resourceId:ID}|{resourceType:"system",resourceId:null}`；AuditDTO为`{auditId:ID,timestamp:timestamp,actorRef:ID,action:AuditAction,subject:AuditSubject,operationId:ID|null,fromRevision:integer(0..2147483647)|null,toRevision:integer(0..2147483647)|null,outcome:"succeeded"|"failed"|"denied",reasonCode:ProblemCode|null,eventHash:SHA,previousEventHash:SHA|null}`，不含自由文本。

ManifestReleaseRole=`full_v7|manual_only_fallback_v7|full_v8|manual_only_fallback_v8|full_v9|manual_only_fallback_v9|full_v10|manual_only_fallback_v10`。PairReceiptRef=`{schemaVersion:7|8|9|10,pairReceiptHash:SHA,pairContractRoot:SHA,full:{releaseRole:"full_v7"|"full_v8"|"full_v9"|"full_v10",manifestHash:SHA},fallback:{releaseRole:"manual_only_fallback_v7"|"manual_only_fallback_v8"|"manual_only_fallback_v9"|"manual_only_fallback_v10",manifestHash:SHA}}`。ReleaseDTO=`{schemaVersion:7|8|9|10,manifestReleaseRole:ManifestReleaseRole,manifestHash:SHA,releaseRoot:SHA,pair:PairReceiptRef,stageReceiptHash:SHA}`。三个role的数字后缀必须逐字等于schemaVersion；full与fallback必须来自同一pair receipt，manifestReleaseRole必须逐字等于其中一个role且manifestHash等于对应manifestHash；禁止返回`full|manual_only_fallback`别名。

BackupDTO=`{recoveryPointId:ID,dbSnapshotHash:SHA,auditHeadHash:SHA,outboxHeadHash:SHA,createdAt:timestamp,offHostReceiptHash:SHA|null,lastRestoreDrillAt:timestamp|null,rpoSeconds:integer(1..2147483647),rtoSeconds:integer(1..2147483647)}`。§5.10是Ops唯一规范；§7只作来源摘要，冲突时以§5.10–5.12为准。

### 5.13 R3 canonical conformance vectors

以下均为必须自动化的validator vector：

1. V1 feed对象只含`schemaVersion/items/page`且item只含PublicStoryCardV1字段时PASS；同对象加入`localized`、`generationId`或英文键时FAIL。
2. V2 detail含两个localized槽、`media=[]`、valid generation identity时PASS；缺任一语言、加入`titleZh`或media第5项时FAIL。
3. 请求包含合法Host、Accept-Encoding、Sec-Fetch-Site且不含自定义mutation header的GET必须PASS；出现任一`Forwarded`或两个`Tailscale-User-Login`必须在业务处理前FAIL。
4. fresh options的`action=PUBLISH/resourceType=publication/resourceId=publication-0001/requestHash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`与随后相同hash的publish mutation配对时PASS；任一小写action、`SOURCE_STOP`绑定publication或hash不等时FAIL。
5. Source默认`lifecycle_status=proposed/collection_onboarding_status=validating`时PASS；`lifecycle_status=validating`、未知onboarding值或四RSS被映射为proposed时FAIL并使0010事务rollback。
6. Traffic requests=`9007199254740991`时PASS，增加1时FAIL；Audit system subject必须`resourceId=null`，非system subject的resourceId=null时FAIL。
7. Release schemaVersion=9且roles=`full_v9/manual_only_fallback_v9`、当前manifestHash命中对应pair member时PASS；任一`full`别名或v8/v9后缀混用时FAIL。
8. actual available且amountMinor=0并有receipt表示实际零费用；actual unavailable且estimate available表示estimate-only，两者PASS；actual available缺amount或receipt、actual unavailable携带amount均FAIL。

## 6. Admin 页面和权限

页面：`/admin/ops/**`、`/admin/reviews/**`、`/admin/sources/**`、`/admin/x-submissions/**`、`/admin/security`。

| Capability | read | editor | publisher | operator/security |
|---|---:|---:|---:|---:|
| ops/review/source/audit读取 | ✓ | ✓ | ✓ | ✓ |
| 中英文编辑/重跑 |  | ✓ | ✓ | ✓ |
| approve/reject |  | ✓ | ✓ | ✓ |
| publish/correct/withdraw |  |  | fresh | fresh |
| source add/validate/requeue |  | ✓ | ✓ | ✓ |
| source activate/stop/retire/auth |  |  |  | fresh |
| phase、credential、backup |  |  |  | fresh |
| restore/emergency ingress |  |  |  | fresh + external authority/TTL |

权限以服务端`allowedActions`和persistent capability为准，客户端隐藏按钮不构成授权。两端均需真实路由、loading/empty/error/partial/offline/reconcile/fresh-expired状态和恢复出口。

### 6.1 Open Design 冻结输入

视觉根为 `[M5-HOME]/Library/Application Support/Open Design/namespaces/release-stable/data/projects/f1plus1-bilingual-detailed-extract-preview/`：

- Admin `index.html`：`4a9e088beb0f8464f7a293b3be399d81e53c6c6ce91efa866aab00edc3c9002c`；
- Public `public-preview.html`：`c661a0192349b4a13064eea1e16cf82f2b787fbe82d9e0aff34a5749cce7b260`；
- `design-notes.html`：`bbee8e9ad29bc0bb03cf1284bd6da1154dbd8a26a7f3c0b9387963c451706e02`；
- freeze manifest：`0431f203baf7fc47d10ec897f118cb1d1397d2216e57194ea62bde31601fb502`；
- QA：`7f20c3dd859ac61138ed67c387c1e5440fdad561171c198e7f265be443af647c`；
- touch measurements：`2d90a790f37118bb8c829d457eea978e524ad76d0534d86d561045194d93e31d`；
- screenshot manifest：`7550f5f59b132a7ece0d4ef90734fb1a7df4410634277035175ac6d05586cb56`。

冻结意图是 Public 每story zh/en、Admin zh/en/both及retry zh/en/rerun。文件状态为 `NOT_DEPLOYED / realApi=false`，不能作为真实接线或production验收收据。

## 7. Observability 真值

| 能力 | 真实来源 | 缺失语义 |
|---|---|---|
| process/listener/public reachability | 进程外sealed observer receipt | unknown |
| DB/schema | existing-only opener、fingerprint、integrity/FK、identity | drift/unknown |
| pipeline | source/ingest/candidate/draft/operation/outbox/receipt | stale/unknown |
| traffic | public ingress aggregate receipt | unavailable，不是0 |
| API | durable external attempt/result receipt | unknown |
| cost | provider usage/billing receipt + budget ledger | unavailable；estimate另标 |
| logs | allowlisted structured events | unavailable |
| backup | common recovery-point/off-host/drill receipt | breach/unknown |
| alerts | 同一snapshot服务端纯函数 | unknown不算healthy |

traffic不得记录IP/hash、Cookie/Auth、UA、body、query、full URL或referrer；logs不得返回source payload、原文、prompt、model response、stack、secret或绝对路径。

## 8. Automatic phase/cutoff/fallback

`disabled→backlog`与collector claim由同一个SQLite writer lock串行。backlog只处理cutoff内当前版本、双语complete、policy clear、approved-only的Publication，oldest-first、batch `1..20`。任何waiting/manual_override/failed/reconcile/stale、非终态outbox、backup breach或drift阻止live。

进入live需要fresh控制和机械零集合证明；collector在下一自然900秒槽恢复。每个system batch只产生一份全量snapshot和一个outbox；unknown只查同delivery。

fallback理解同一schema，允许读取、人工review、fresh publish/correct/withdraw、same-delivery sender和fresh pause/stop；硬禁auto review/publish、enter/resume backlog/live、collector网络、raw queue扫描和system snapshot/outbox创建。

## 9. 实施切片和写入边界

| Slice | 允许写入 | 验收出口 | 失败路径 |
|---|---|---|---|
| 0 合同 | docs/ADR/spec/matrix/progress/handoff | 本合同、链接、hash、旧accepted与R3 pin不变 | 身份/状态混写即撤回文档增量 |
| 1 0007 | 0007 migration、gateway、现有mutation入口、tests、release verifier | exact v6→v7、authorizer、durable attempt、双锁、recovery、full/fallback | raw writer/self-sign/second writer/unknown retry任一存在则blocked |
| 2 0008 | X manual migration/module/routes/tests | 59 disabled、URL-only、oEmbed-disabled零外联 | 轮询/自动公开/无attempt外联即blocked |
| 3 0009 | bilingual migration/module/refinement/review tests | strict zh/en、stale invalidation、legacy LKG | 假英文/raw source泄露/fixture authority进production即blocked |
| 4 Public v2 | public schema/reader/routes/UI/tests | v1兼容、v2双语、六格视觉、签名损坏503 | cache identity漂移或未清版权数据即blocked |
| 5 Admin reviews | admin route composition/UI/tests | Mac+iPhone全功能、fresh/CSRF/CAS/reconcile | 任一端减功能或source/review双身份即blocked |
| 6 0010 sources | migration/source repository/routes/UI/tests | 四RSS无漂移、single source truth、59 manual | 第二production source DB或env启用即blocked |
| 7 Ops read model | ops adapters/GET/UI/tests | unavailable诚实态、零mutation/外联、脱敏 | self-monitor假健康/traffic假0即blocked |
| 8 auto successor | gateway workers/phase control/tests | cutoff、双锁、bilingual/media/backup/outbox门 | 沿用v4最新100语义冒充successor即blocked |
| 9 producers | observer/traffic/cost sealed receipt和runbook候选 | PII=0、freshness、producer无业务写权 | app自签或producer写业务表即blocked |
| 10 production | 仅manifest逐项允许的目标 | backup/stage/migrate/private Admin/backlog/live/public cutover收据 | COMMIT前rollback；COMMIT后同schema fallback |

## 10. Production manifest 必填值

manifest必须固定：Admin/Public主机和UID、DB path/dev/inode/mode、private/public域名、Tailscale/app-cap/ACL/device policy、0001..0010 SHA/schema、full/fallback/pair/stage/verifier、Node/npm、签名/凭证路径、provider/model/prompt/预算、四RSS与59X inventory、版权/media/deletion policy、备份加密/off-host/retention/drill、observer/traffic/log/cost/alert producer、phase/cutoff/batch/interval/backpressure。

工程切片可在用户当前授权下继续。真实migration、模型/密钥/费用、oEmbed、M1、Serve、备份、phase离开disabled、public cutover、deploy/restore和真实发布仍必须逐项通过production manifest。

## 11. Slice 0 R4 文档门关闭

独立复审固定为：report `scratch/2026-08-24-bilingual-admin-contract-review-r4/review-report.md` / SHA-256 `3e6c69ee2c3f67523b0cfd6c9ea15ed1eee1692c2d61d371516e207345de3a22`；receipt `scratch/2026-08-24-bilingual-admin-contract-review-r4/review-receipt.json` / SHA-256 `03327aa1af9119e55681f591e24bd4160c657973392bfe2bc53f45b01fe5d4aa`；manifest `scratch/2026-08-24-bilingual-admin-contract-review-r4/manifest.json` / SHA-256 `09fa3a08e3736d29a198ced3e71e4983b9ccc2dbcc26440bfd665ba9cc44f022`。结论为`PASS / P0=0 / P1=0 / P2=0 / Slice0Gate=CLOSED_PASS`。

Slice 0只完成目标合同文档门。本文全部`implementation-pending`、`engineering-candidate`与`production-gated`时态保持原义；没有因此完成migration、Admin/Public Function、M1或production部署。

## 12. 0007 fence/rollback successor 追加门

旧 frozen 0007 的Admin singleton fence clear缺少verified truth receipt，现有Slice1 E2E又通过drop trigger后直接UPDATE建立测试状态。旧0007 contract/manifest/SQL raw/SQL canonical/post-schema身份统一为`SUPERSEDED_FOR_IMPLEMENTATION`，旧证据原字节不改。

0007后继实施必须逐字遵守[F1+1-0007-fence与rollback-successor实施合同-v1.0](F1+1-0007-fence与rollback-successor实施合同-v1.0.md)：one-fence/one-verified-receipt、system-supervisor-only、receipt与singleton CAS/audit/terminal同一`BEGIN IMMEDIATE`、clear仅disabled/paused、business rollback `authorized→blocked`及orphan lease收敛。新六类身份未生成、独立复审未达到`P0=0/P1=0`或production-faithful E2E仍含workaround时，状态固定为`0007-successor-contract-review-pending / Slice1 BLOCKED`。本追加不改变R3 external pin或任何Function实现/production真值。

本append-only段是0007的effective status，覆盖本文§11历史CLOSED_PASS对Slice1的放行含义。当前contract review只审文档；通过后进入implementation review pending，才允许另行派单生成隔离SQL六身份和E2E。

## 13. 0007 successor 合同门正式关闭

独立审核闭包：report SHA-256 `6c73bd52fc2617717302994f1ffe5571db1b2a78bdc05515a01a87a387e5aa8b`；receipt SHA-256 `74e959ca3a321d191d4fd7f02723f94a2b0e843bea685c93be93ac84c02daff8`；manifest SHA-256 `73ef34bb4466beea632b4cee5552be75f045a235682613acc255800f2828ff4f`；根目录`scratch/2026-08-24-0007-successor-contract-independent-review/`；manifest `2/2 OK`；结论`PASS / P0=0 / P1=0 / P2=0`及`MICRO_PASS / P0=0 / P1=0`。

现行状态为`contract CLOSED_PASS / 0007-successor-implementation-review-pending / Slice1 successor implementation AUTHORIZED_PENDING`。该授权只允许另行派发隔离SQL、六身份、实现、负例和无workaround E2E候选；Slice1工程门、0008与production继续blocked。旧FAIL、旧0007 frozen bytes、`SUPERSEDED_FOR_IMPLEMENTATION`和R3 external pin保持原义。

## 14. 可信单用户 M1 quick-launch 实施 overlay

现行quick-launch合同入口为[ADR-F1PLUS1-TRUSTED-SINGLE-USER-M1-QUICK-LAUNCH-001](../decisions/system/2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md)，状态`review-pending`。该overlay只改变首版实施顺序与威胁模型，本文Public V1/V2 DTO、Source/X状态机、route、fresh、CAS/idempotency、privacy、observability和production manifest语义保持有效。

唯一迁移顺序改为`schema6 → shared旧0007/trusted_local_capability_accounting_v1 → 0008 → 0009 → 0010`。旧0007只提供single-writer、operation、idempotency、attempt、outbox、audit、budget、phase/accounting；same-UID本地进程被显式信任，因此Admin无verified truth receipt清singleton fence、loopback header伪造、凭证/DB/audit篡改均是用户已接受的残余风险，禁止表述为high-assurance。R7继续deferred，不能作shared/runtime/production claim。

旧0007 bootstrap必须使用现有gateway/authorizer：restore/control把recovery推进ready、Admin `phase_control/fence_update`一次只改一个singleton fence、clear global stop、创建逐scope fence receipt并进入live。禁止drop trigger、裸UPDATE和test workaround。production-shaped disposable证明若显示合法Admin路径不可执行，则本路线重新blocked，只能另立additive `0011_trusted_local_control_bootstrap`并复审；本合同不预先授权0011。

quick-launch运行闭集为：RSS collect自动；0009 zh-CN/en refine自动；人工review；private Admin fresh人工publish/correct/withdraw；Public signed snapshot；59 X disabled/manual URL；oEmbed disabled。`automatic_reviewer`与`automatic_publisher`必须分别通过quick-launch ADR §10唯一`AutoAutomationZeroVector`；`fresh operation`术语删除，自动化零门与WebAuthn fresh无关。普通环境变量无启用权。

上线硬门固定为Admin loopback/Tailscale-only/Funnel=0、Passkey/session/Origin/一次性CSRF/fresh≤300秒/audit、manual publish only、signed snapshot/LKG、迁移前verified off-host backup、`backupAgeSeconds<=900`、COMMIT前transaction rollback、COMMIT后同schema`manual_only_fallback_v10`与必要时verified recovery point恢复并记录loss window/audit fork。任一Unknown为`NO_DEPLOY`。

用户确认绑定为`current_thread_user_instruction`，没有外部evidence ID，固定`evidenceId=NOT_ISSUED`。production部署仍要求不可变`PRODUCTION-DEPLOYMENT-MANIFEST`钉死host/UID/path/inode、migration/release、网络/身份、key、provider/model/budget、source/policy、scheduler禁用证据、backup/RPO和cutover/rollback值。

## 15. Quick-launch automatic-zero P1 极窄更正

唯一机器合同逐字继承[quick-launch ADR §10](../decisions/system/2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md#10-autoautomationzerovector-唯一合同)，不得在实现合同另立同义DTO或查询。`PRODUCTION-DEPLOYMENT-MANIFEST`必须固定`quickLaunchCutoverAt/releaseSha256/manifestSha256/reviewDatabaseIdentity/autoProcessIdentitySetSha256/scheduleInventorySha256`；cutover边界为`>=`。cutover前terminal legacy operation/audit/publication/outbox保留且不计数；cutover后任何匹配auto operation/effect无论终态均计数；cutover前仍nonterminal/queued的匹配对象也计数。

Review exact域为`automatic_reviewer/review/db_mutation/none`、runtime producer `automaticReviewTick/automaticReviewBatch`、legacy actor `system-auto-review-v1`，schema7 outbox允许集为空，legacy effect只为revision/approve/reject及其三类audit。Publish exact域为`automatic_publisher/publish/db_mutation/none`、`automaticPublishTick/automaticPublishBatch`、`system-auto-publish-v1`，schema7 outbox kind只为`projection_delivery|withdraw_delivery`，legacy只为publish/publication/`snapshot_sync` projection outbox。状态闭集、named-parameter SQL、distinct-set失败语义全部以ADR §10为唯一真值。

Review与publish各自五轴固定为`activeProcessInstances=0 / registeredSchedules=0 / activeOwnerHandoffs=0 / prohibitedOperations=0 / prohibitedEffects=0`。schedule轴必须覆盖Admin进程内timer/startup call、独立PID、LaunchAgent、cron、plist、scheduler registry及owner handoff issuer。当前`runtime.ts` SHA-256 `9b8f831a165686e41eb2ae0b8d1652812e4e590102dd57573c53f05aa09729df`含两个无条件60秒interval和两个startup tick，当前build必定FAIL；quick-launch build须提供静态AST/call-graph与跨至少一个60秒窗口的进程外运行收据，证明registration/invocation均为0。

独立FAIL pin为report `5fb3c8aa3bbbd453a69a7ef28222ebb9c0b56c69a1343dc1e19bd83cadfa5554`、receipt `96ab78b838856fe5d2dabc20d51eaab5c9a76de1cb7f39bade41efcca9c40624`。当前保持`quick-launch-contract-review-pending`；仅PID=0但内嵌timer存在必须FAIL，cutover前terminal历史存在必须PASS，cutover后任一auto operation即使no-work/terminal也必须FAIL。

## 16. Quick-launch R2 合同门关闭

R2独立复审结论为`PASS / P0=0 / P1=0 / P2=0 / quick-launch contract gate=CLOSED_PASS`；report SHA-256 `9a75a70c462be4c76d5d0b4c5db8925e6a574b6a9f1fab05e1297dc8674bcadf`、receipt SHA-256 `763737f8c6eddd05d2e09232e948b5e55ebd917369d474558dbe3cba73928d70`、manifest SHA-256 `5020a905065ffaabc1bcc89a1ba43906240429faef22350fe7d526eb39f7687d`，证据根`scratch/2026-08-24-trusted-single-user-m1-quick-launch-independent-review-r2/`。当前状态收口为`contract CLOSED_PASS / engineering authorized pending`。该关闭只授权后继工程候选按既有合同另行实施与复审，不表示实现、production-shaped E2E、M1或production通过。首轮FAIL及其整改历史保留；当前`runtime.ts`两个60秒interval和两个startup tick继续令review/publish的schedule轴`FAIL / NO_DEPLOY`，必须由后继release移除或机械拒绝注册并取得§10全部收据后才可继续部署门。
