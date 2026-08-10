# F1+1 VS-1 本地 synthetic 采集、清洗去重与 mock 中文摘要纵切实施合同 v0.1

- 状态：`accepted contract / pending implementation`
- 日期：2026-08-09
- 决策入口：[`ADR-M5-VS1-LOCAL-PIPELINE-001`](../decisions/system/2026-08-09-F1+1-VS1本地synthetic纵切-accepted.md)
- 适用 Function ID：`COLLECT-MOCK-002`、`CONTENT-PROCESS-003`、`SUMMARY-MOCK-004`
- 领域机械合同：`data/mvp-contract-v0/schema.json`、`state-machine.json`、`runtime-envelope.schema.json`、`internal-contract.schema.json`
- 当前实施状态：`P1-blocker`；`worker:mock` 与 `test:contract` 仍为 pending，本文不得作为运行 PASS 证据

## 1. 目标与硬边界

开发部可据本文拆成一个本地纵切实施任务，无需补产品语义。唯一 operator 入口为：

```text
cd app
npm run worker:mock -- --once
```

每次执行最多处理一个到期 collection operation。数据源只能是仓库内固定 fixture registry；整个进程、子进程和浏览器均不得产生非 loopback 网络、DNS、raw socket、真实文件下载或第三方调用，`externalCalls=0`。

允许：任务隔离 SQLite、fixed fixture adapter、现有领域表与 internal runtime 表、确定性 hash/summary、operator receipt。

禁止：Admin UI/API、真实 provider、RSS、Base、公开或自动发布、部署、生产存储、真实媒体、外部 AI/翻译、新领域实体、第二套领域 schema、静态 UI 第二真值。

## 2. 运行介质、目录与启动门禁

### 2.1 任务隔离库

- `worker:mock` 与 `test:contract` 必须由 wrapper 创建权限 `0700` 的任务临时根，并在其中创建唯一 SQLite 文件；数据库权限 `0600`。
- 该库只应用现有 VS-1 blueprint 的 `0001..0006` 等价迁移与本合同所需 fixture seed；不得打开、ATTACH、复制或改写任何现行 profile DB。
- 运行进程只持有一个 SQLite handle；禁止第二 DB、跨库查询与 fallback。
- 运行前校验 Node `24.18.0`、npm `11.16.0`、lock 一致、fixture manifest/hash、schema/state/envelope/internal-contract hash、SQLite foreign keys、WAL/FULL、busy timeout 上限和 no-egress guard。任一失配在租约前退出。
- fixture registry 固定为 `app/fixtures/vs1-local-pipeline-v1.json`，共享 seed 固定为 `app/fixtures/vs1-local-pipeline-seed-v1.json`，manifest 固定为 `app/fixtures/vs1-local-pipeline-manifest-v1.json`；manifest 必须绑定前两文件最终字节 SHA-256 以及 schema/state/envelope/internal-contract SHA-256。改变任何输入字节即形成新 fixture version。

### 2.2 选择与一次性语义

`--once` 只按 `(next_attempt_at, job_id)` 升序选择首个 `job_status in (pending,retryable_failed)` 且到期的 job。选中后，同一进程、同一任务根内最多执行该 operation 的 3 次尝试；fixture clock 按固定 `1s/3s` 前进，不真实 sleep，也不选择第二 job。没有 job 时不创建数据，输出三条 `NO_WORK` V-OP receipt 并以 0 退出。禁止循环轮询或隐式处理第二项。

### 2.3 固定 seed graph

每个 case 都在新任务根从同一基线生成，只允许下列 case identity 替换；开发不得另选 Source、epoch 或 clock：

- Source 逐字段复制 `data/mvp-contract-v0/fixtures.synthetic.json` 中 `source_id=src-queued` 的 39 字段；只把 `onboarding_operation_id` 替换成当前 case 的 operation id。初始状态固定 `collection_onboarding_status=queued,lifecycle_status=proposed,enabled=true,source_stop_status=clear,adapter_status=ready,adapter_authorization_status=valid,platform_allowed=allowed`，两个 source epoch 均为 1。
- 固定 `authorization_version=1,policy_epoch=1,recovery_epoch=1`；初始 clock 为 `2026-08-09T12:00:00Z`。
- `slug = lowercase(case_id)`，只允许 `[a-z0-9-]`；`task_id=task-vs1-<slug>`、`operation_id=op-vs1-<slug>`、`job_id=job-vs1-<slug>`、`idempotency_key=activate:src-queued:op-vs1-<slug>`，`reconcile_key=null`。
- `payload_hash=SHA-256(canonical-json-v1({"case":<当前 registry case 完整对象>,"source_id":"src-queued"}))`，因此 attempts/candidate/mock_summary/precondition/fault_injection 任一变化都会改变 payload hash。
- TaskEnvelope 的 schema/aggregate 固定为 `mvp-local-v0.3/TaskEnvelope/source/src-queued`，五 fence 为 1，seed template 固定 `attempt=1,lease_token=synthetic:lease:00000000000000000000000000000000,lease_expiry=2026-08-09T12:05:00Z,deadline=2026-08-09T12:15:00Z`。placeholder 只用于 seed 校验；每次 acquire 必须用 §7.1 的 live envelope 原子替换 Outbox 当前 envelope，并绑定 inbox/task_attempt hash，不得回传 token。
- Outbox 初始固定 `operation_type=source_activation,aggregate_type=source,aggregate_id=src-queued,job_status=pending,attempt=0,max_attempts=3,last_error_code=null,next_attempt_at=2026-08-09T12:00:00Z,published_at=null`；created/updated 为初始 clock，actor 为 `synthetic:vs1-worker`。
- inbox、task_attempt、dead_letter、source_observation、CapturedItem、Content、Event、Summary、ReleaseBundle、AuditEvent 初始为空。`VS1-APPROVED-017` 和 Event merge/day case 的显式前置图是唯一例外，必须由 registry 完整列出且进入 manifest hash。

seed validator 必须逐字段复算 Source、Envelope、Outbox、payload/envelope hash、空表 counts 与 manifest；任何缺失/额外字段或不等值在 worker 启动前返回 `SEED_GRAPH_MISMATCH`。

## 3. fixture adapter 输入合同

fixture 顶层为 closed JSON，`additionalProperties=false`。每个 case 只允许：

```json
{
  "fixture_version": "vs1-local-pipeline-v1",
  "case_id": "VS1-...",
  "precondition": "empty|same_content|same_event|different_day|fingerprint_collision|approved_chain|stale_fence|no_work",
  "attempts": [
    {
      "attempt": 1,
      "adapter_outcome": "candidate|HTTP_429|HTTP_500|HTTP_502|HTTP_503|HTTP_504|COLLECTION_TIMEOUT|DB_LOCK_CONTENTION|INVALID_FIXTURE",
      "fault_injection": "none|after_capture|after_content|after_event|after_summary|after_bundle|before_ack_cas|before_audit",
      "candidate": {
        "external_id": "synthetic-...",
        "external_url": "https://synthetic.invalid/...",
        "content_kind": "article",
        "language": "en",
        "title": "...",
        "body": "...",
        "published_at": "2026-08-09T00:00:00Z"
      },
      "mock_summary": {
        "title_zh": "...",
        "summary_zh": "..."
      }
    }
  ]
}
```

规则：

- `attempts` 长度为 1–3，attempt 必须从 1 连续递增且不得超过 Outbox max_attempts；worker 第 N 次只读取 `attempt=N` 的元素。
- `precondition` 必须是上列 enum；seed validator 根据它装载 manifest 已绑定的唯一前置图或 repository collision test double，禁止运行时任意注入。`no_work` 必须使 Outbox seed 为空；其余默认使用 §2.3 基线。
- `fault_injection` 每个 attempt 必填；正常值 `none`。其余七值只允许 `VS1-PARTIAL-016A..016G` 各自使用一个，进入真实 transaction branch 后在对应写点抛出固定内部错误。
- 每个 attempt 中，`candidate` 与 `mock_summary` 仅在 `adapter_outcome=candidate` 时必需；其他 outcome 时二者必须缺失。candidate outcome 必须是序列最后一项；其后不得再有 attempt。
- URL host 必须逐字为 `synthetic.invalid`，只作为证据字段，adapter 不解析、不连接。
- `external_id` 1–255 UTF-8 bytes；title 输入最多 4096 bytes；body 输入最多 65536 bytes；summary 两字段必须满足现行 Summary schema。
- JSON 非 UTF-8、语法错误、重复 key、额外字段、非有限数字、字段超长、非法 RFC3339 或非法 enum 一律 `INVALID_FIXTURE`，领域零写入。合法 JSON escape 解码后出现的 NUL/控制字符交由 `normalize-text-v1` 返回 `CONTENT_NORMALIZATION_INVALID`。
- adapter 每次返回零或一个 candidate；数组、多 item 或真实 URL 均 `FIXTURE_CARDINALITY_VIOLATION`，不做截断。

`mock_summary` 是 fixture adapter 的确定性输出模板，只在内存中参与 Summary 计算，不落入 CapturedItem、Content、AuditEvent 或公开 DTO；它不构成第二领域实体。

## 4. 确定性 normalization 与质量门禁

### 4.1 `normalize-text-v1`

对 title/body 分别执行，顺序不得改变：

1. 拒绝 U+0000，以及除 TAB/LF/CR 外的 U+0001–U+001F 和 U+007F；
2. `CRLF → LF`，剩余 `CR → LF`；
3. 每行将连续 TAB/U+0020 折叠为一个 U+0020，并删除行首、行尾 TAB/U+0020；
4. 删除首尾空行，内部空行保留一个 LF；title 的内部 LF 改成一个 U+0020 后再折叠；
5. 不做 Unicode normalization、case fold、翻译、标点替换或语义改写。

结果超过 Content schema 长度、title/body 为空或 language/content_kind 不合法时失败关闭。`content_hash_input` 与 `content_version_hash` 继续按现行 data contract 的 `canonical-json-v1` 重算，不另造 hash 公式。

### 4.2 `synthetic-quality-v1`

只检查 normalization 后 title 或 body 的区分大小写 ASCII 前缀，固定优先级：

1. 输入/normalization 失败：`CONTENT_NORMALIZATION_INVALID`；
2. title 或 body 为空：`CONTENT_EMPTY`；
3. 前缀 `SYNTHETIC_ONLY:AD:`：`CONTENT_OBVIOUS_AD`；
4. 前缀 `SYNTHETIC_ONLY:SPAM:`：`CONTENT_SPAM`；
5. 前缀 `SYNTHETIC_ONLY:OFF_TOPIC:`：`CONTENT_F1_UNRELATED`；
6. title 与 body 均不以 `SYNTHETIC_ONLY:F1:` 开头：`CONTENT_RELEVANCE_UNKNOWN`；
7. 其余进入内容幂等与 Event dedupe。

第 1–6 项均在 Content 插入前停止。`INVALID_FIXTURE` 在 adapter 前失败，CapturedItem 为零。candidate 已通过 fixture/URL 结构校验后，Content normalization 失败、empty、广告、垃圾、离题或 relevance unknown 都保留一个 CapturedItem，固定 `normalization_status=valid,dedup_status=pending,content_id=null`；这里的 CapturedItem normalization 只陈述其 raw/canonical URL 已有效，内容处理结论只进入本次 AuditEvent/receipt。合格内容完成 content/Event 去重后才把 CapturedItem CAS 为 `dedup_status=unique|linked_existing` 并填入 content_id。不得借用 CapturedItem 状态表达第二套 quality machine。

这些标记只能用于 synthetic fixture。实现不得据此宣称真实内容质量识别完成。

## 5. 幂等、Event dedupe 与 canonical 选择

### 5.1 身份与幂等

- SourceObservation：既有唯一 `(source_id,external_id)`；重投返回既有 observation identity。
- inbox：唯一 `(operation_id,idempotency_key)` 与 `envelope_hash`。
- Content：既有 content-ingest key `(platform,source_id,external_content_id,content_version_hash)`。
- Event：唯一 `dedup_fingerprint`。
- Summary：唯一 `(content_id,summary_version_hash)`。
- ReleaseBundle：`release_bundle_id` 与 `bundle_hash` 必须一一对应；同输入返回原行。
- Outbox：唯一 `idempotency_key` 与 `(operation_id,operation_type)`。

所有派生 ID 使用 `"<prefix>-" + first32hex(SHA-256(canonical-json-v1(identity_input)))`；identity_input 的字段和顺序必须在实现旁的 golden test 固定，禁止随机 UUID。既有 fixture ID 不追溯改算。

### 5.2 `event-dedup-v1`

fingerprint 输入只含：

```json
{
  "content_kind": "<Content.content_kind>",
  "language": "<Content.language>",
  "normalized_body": "<Content.normalized_body>",
  "normalized_title": "<Content.normalized_title>",
  "published_day_utc": "<UTC YYYY-MM-DD or null>"
}
```

`dedup_fingerprint = lowercase_hex(SHA-256(canonical-json-v1(input)))`。`published_at` 先转 UTC 日历日；缺失保持 JSON `null`。禁止加入 source/content/capture ID、URL、抓取时间或 epoch。

Event member 以 `(content_id,content_version_hash,capture_id or "")` 按 Python 字符串/Unicode code point 升序；member_content_ids 去重并按同一 key 排序，首项成为 canonical。写入使用 `BEGIN IMMEDIATE`、fingerprint unique 与 union CAS。

相同 fingerprint 时，repository 从现有 `canonical_content_id` 读取 Content，重建精确 canonical input bytes 后比较。不同 bytes、缺失或无法重建均返回 `DEDUP_COLLISION_UNRESOLVED`，Event 为 `needs_review`，本次 Summary/Bundle 零写入；禁止仅凭 hash 自动合并。

现有 Event 不追溯改算。golden：既有候选报告中的同日输入 hash 为 `28e7cc3933ca7193c166016fa77a298af838c54aefbc09e964d9e653db0f86b7`，改为另一 UTC 日的 hash 为 `44213206cdf97ad0baf3a43e719a6a0320da4d6d840c3bda4986908ab9eafdfd`。

## 6. mock Summary 与 immutable Bundle

只对合格且为 Event canonical 的 Content 执行：

1. 用 `content_version_hash` 在当前 fixture case 内读取唯一 `mock_summary`；缺失、多值或 content hash 不匹配为 `SUMMARY_FIXTURE_NOT_ALLOWLISTED`。
2. 固定 `summary_schema_version=summary-schema-v1`、`summarizer=synthetic:mock-summary-v1`、`deterministic=true`、`language=zh-CN`、`summary_status=ready`、`summary_version=v1`。
3. `summary_hash_input` 逐字段回指当前 Summary schema；`input_content_hash=Content.content_version_hash`；按 `canonical-json-v1` 计算 `summary_version_hash`。
4. 组装 `ReleaseBundle(release_status=ready,immutable=true,bundle_version=v1)`；canonical payload 必须包含当前 Content/Summary/Source 快照、`rights_status=unknown`、空 media、`manual_only` policy、当前五 fence 与 `mvp-local-v0.3` schema 标识，并逐层重算 payload/bundle hash。
5. 同输入重跑返回原 Summary/Bundle；任何 hash/fence/schema/FK/unique 不一致全事务回滚。

若相同 Event 的新 member 改变 canonical，只允许 supersede 仍处于 `ready` 的旧 Summary/Bundle，再为新 canonical 建 ready 版本。若旧 Summary/Bundle/Content 已 approved、rejected、publish_queued、published 或关联 ReviewDecision/Publication/Projection，返回 `APPROVED_CHAIN_PRESENT`，不修改任何旧链。本合同不实现人工审核或已批准版本修订。

## 7. lease、五 fence、事务与 ACK

### 7.1 lease

- lease token 使用至少 128-bit CSPRNG，每次 acquire/retry 都生成新 token；不得写日志或 receipt。
- `now < lease_expiry <= deadline <= started_at+900s`；完成 CAS 同时校验 job、attempt、lease token、lease 未过期。
- 五 fence 精确为 `source_config_epoch,source_safety_epoch,authorization_version,policy_epoch,recovery_epoch`。租约前、adapter 前、结果提交前各重读一次；任一不符返回 `STALE_FENCE`，adapter/领域写入为零。
- source 必须 `enabled=true`、stop clear、adapter=`synthetic_fixture`。其余值 fail closed。

本切片消费既有 activation transaction 产生的 `OutboxJob(operation_type=source_activation,aggregate_type=source)` 与对应 TaskEnvelope；禁止新增 `collection` operation type。Outbox job 的 idempotency key 继续是冻结的 source-activation key，内容、Event、Summary 和 Bundle 分别使用其既有 repository 幂等键。

每次 attempt 的 acquisition 必须是独立 `BEGIN IMMEDIATE`：按 selector 重读唯一 job → 校验 `pending|retryable_failed`、`next_attempt_at<=fixture_clock`、Source/stop/五 fence → CAS Outbox 为 `leased` 并把 attempt 加 1 → 生成新 live lease token、`lease_expiry=clock+300s`、`deadline=min(clock+900s,seed deadline)` → 以稳定的 task/operation/aggregate/payload/idempotency/five-fence 字段和当前 attempt/lease/expiry/deadline 构造完整 live TaskEnvelope，并通过 `runtime-envelope.schema.json` → 原子替换 `outbox_job.task_envelope` → insert 唯一 `(job_id,attempt_no)` task_attempt=`leased` 并写当前 `envelope_hash` → 首次 insert inbox=`received`，retry 更新同一 inbox 的 live envelope bytes/hash → Source 按现有 `queued|collection_failed→collecting` 守卫 CAS → COMMIT。任何 CAS/unique/schema/fence 失败全回滚，adapter 不运行。

live envelope 的 `payload_hash`、operation/idempotency key 与五 fence 在重试间逐字不变，只有 attempt、lease token、lease_expiry 可变；deadline 保持 seed deadline。上一 task_attempt 只保留其 envelope hash，当前 Outbox 与 inbox 保存当前完整 envelope。adapter 前及结果/failure settlement 完成 CAS 必须同时证明 `SHA-256(canonical-json-v1(current live envelope))` 与当前 inbox/task_attempt envelope_hash 三者相等。live token 只进入受限 SQLite 字段，日志/receipt 禁止出现。

### 7.2 结果状态映射

| 结果 | Source | CapturedItem | Content | Event | Summary / Bundle | inbox / attempt / Outbox |
| --- | --- | --- | --- | --- | --- | --- |
| 合格唯一、事务成功 | `collecting→active` | `normalization_status=valid,dedup_status=unique,content_id=<current>` | canonical 在同一事务逐边 CAS `captured→normalized→dedup_pending→review_pending`；非 canonical 逐边到 `dedup_pending` 后停止 | 单 member=`canonical`；多 member=`merged`；canonical/member 顺序按 §5 | canonical 为 `ready/ready`；非 canonical 无当前 Summary/Bundle | `processing→acked / succeeded / succeeded` |
| 同 identity/content 重投 | 保持 `active` | 返回既有 capture/identity，不新增 | 返回既有 Content，不改变状态 | 不新增 member | 返回既有当前对象 | 返回已完成 operation receipt，不新建 result transaction |
| empty / normalization / 明确质量过滤 | `collecting→active` | `normalization_status=valid,dedup_status=pending,content_id=null` | 零新增 | 零新增 | 零新增 | `processing→acked / succeeded / succeeded`；operator 以过滤 PASS 结算 |
| relevance unknown | `collecting→active` | `normalization_status=valid,dedup_status=pending,content_id=null` | 零新增 | 零新增 | 零新增 | `processing→acked / succeeded / succeeded`；unknown 不升级 |
| `INVALID_FIXTURE` / cardinality 永久失败 | `collecting→collection_failed` | 结果事务回滚，零新增 | 零新增 | 零新增 | 零新增 | inbox=`rejected`；attempt/Outbox=`terminal_failed`，随后 Outbox=`dead_letter` |
| transient 且仍有预算 | `collecting→collection_failed`，下次尝试前按现有守卫回 `collecting` | 零新增 | 零新增 | 零新增 | 零新增 | inbox 保持 received；attempt=`retryable_failed`；Outbox=`retryable_failed` |
| stale fence/stop/lease | `stopped`、`cancelled` 或原状态，严格沿现有 Source guard | 零新增 | 零新增 | 零新增 | 零新增 | attempt/Outbox=`stale_epoch` 或 `cancelled`，禁止 adapter/result write |
| fingerprint collision | 保持 `active` | `valid,needs_review,content_id=<current>` | 当前 Content 可保留为 `dedup_pending` | Event=`needs_review` | 零新增 | operation 成功 ACK，但 receipt=`DEDUP_COLLISION_UNRESOLVED`、`status=FAIL`，后续自动处理关闭 |

表中没有新状态或通配 transition。canonical 改变时，新 canonical 从 `dedup_pending→review_pending`；旧 canonical Content 保持 `review_pending`，只把仍为 ready 的旧 Summary/Bundle 标记 superseded，禁止新增 `review_pending→dedup_pending` 逆向边。旧 Content 没有当前 ready Bundle，因此不会形成第二审核项。碰撞 case 是已知、已落审计的业务阻断结果，不进入自动 retry；operator 以非零退出并保留同事务证据。

### 7.3 一个结果事务的固定顺序

adapter 计算在事务外完成；随后单个 `BEGIN IMMEDIATE` 按下列顺序写入：

1. 再验 lease、deadline、source enabled/stop 与五 fence；
2. insert-or-return SourceObservation；
3. inbox `received→processing` CAS；
4. insert-or-return CapturedItem；
5. 在内存完成 normalization 与 quality decision；过滤 case 跳到第 10 步；
6. insert-or-return `Content(content_status=captured)`，验证 content-ingest key/hash，逐边 CAS `captured→normalized→dedup_pending`；禁止直接写终态；
7. Event fingerprint、精确 bytes 碰撞检查、member union 与 canonical CAS；当前 Content 成为 canonical 时再按冻结 guard CAS `dedup_pending→review_pending`，非 canonical 保持 `dedup_pending`；
8. 仅对 Event 当前 canonical Content 的 Summary insert-or-return；
9. immutable ReleaseBundle insert-or-return；
10. inbox `processing→acked`、attempt→`succeeded`、Outbox `leased→succeeded`；
11. 追加精确一条脱敏 AuditEvent；
12. COMMIT 后才向 worker 返回 ACK 并写 receipt。

任一步失败必须 ROLLBACK。随后开启唯一 failure-settlement `BEGIN IMMEDIATE`：以 job/attempt/当前 lease token CAS 并重读五 fence；按 §8 更新 inbox、task_attempt、Outbox、Source、`last_error_code/next_attempt_at`，预算耗尽时同时写 dead_letter，最后追加精确一条不含原文、URL query、token 或 fixture 正文的 AuditEvent，再 COMMIT。状态更新与 AuditEvent 任一步失败都回滚整个 settlement；此时 job 可保持 leased，进程必须非零退出并要求归档重建，禁止无审计地补写状态。

`VS1-REPLAY-002` 是 `test:contract` 对 inbox handler 的重复投递测试：先完成 HAPPY，再把相同 envelope bytes 交给 handler；handler 命中已 succeeded operation/acked inbox 后只读返回原 full receipt，不经过 Outbox selector、不新开结果或失败事务、不新增 AuditEvent。HAPPY 后再次运行 operator `--once` 的正确结果是 `NO_WORK`。

## 8. retry、dead-letter 与 reason codes

### 8.1 自动 retry

可重试：`HTTP_429,HTTP_500,HTTP_502,HTTP_503,HTTP_504,COLLECTION_TIMEOUT,DB_LOCK_CONTENTION`。这些都是 fixture 模拟结果或本地 SQLite busy，绝不触发 HTTP。

不可重试系统失败：`INVALID_FIXTURE,FIXTURE_CARDINALITY_VIOLATION,DB_CORRUPTION,SCHEMA_HASH_MISMATCH,SEED_GRAPH_MISMATCH,SUMMARY_FIXTURE_NOT_ALLOWLISTED,APPROVED_CHAIN_PRESENT,STALE_FENCE,LEASE_INVALID,STOP_ASSERTED` 及未知 code。`CONTENT_NORMALIZATION_INVALID` 是已 ACK 的过滤结果；`DEDUP_COLLISION_UNRESOLVED` 是已 ACK 的业务阻断结果。二者的 Outbox 均 succeeded，不进入 retry/dead-letter。

- `max_attempts=3`；第 1 次失败后 `1s`，第 2 次后 `3s`，无 jitter；第 3 次失败后 `leased→terminal_failed→dead_letter`，不得有第 4 次。同一个 `--once` 进程按 fixture clock 前进并完成这些尝试，不重新创建任务根或数据库。
- 每次 retry 复用 operation/idempotency key、TaskEnvelope payload hash，取得新 lease 并重验五 fence。
- `attempt` 从 1 开始；`next_attempt_at` 用注入的 UTC clock 计算，测试禁止真实 sleep。
- 本切片任何 collection outcome 都不得进入 `reconcile_wait`。

### 8.2 恢复

自动失败后，由同一 `--once` 进程推进注入的 fixture clock，并在同一任务根与数据库内继续下一 attempt。dead-letter、schema/corruption、碰撞、批准链或 stop/fence 问题只能按 receipt 的 `recoveryAction` 修复。

本切片不实现原 dead-letter job requeue。恢复步骤固定为：保留失败库及 receipt 作审计 → 关闭 SQLite/checkpoint/WAL-SHM=0 → 生成 closed DB hash → 在新 `0700` 临时根重新 migrate/seed → 新 operation/key 重跑。禁止修改或清理其他 profile。

## 9. 固定 fixture 案例

所有 mandatory case 必须进入同一个版本化 registry 与 manifest；每个 case 单独创建新任务隔离库。`Δ` 表示该次运行后相对 seed 的新增行。

| Case | 固定输入/前置 | 唯一结果 | Mandatory delta / 断言 |
| --- | --- | --- | --- |
| `VS1-HAPPY-001` | `candidate`；title=`SYNTHETIC_ONLY:F1: Synthetic race result`；body=`SYNTHETIC_ONLY:F1: Driver A wins.`；summary=`合成赛果`/`车手A赢得本地合成比赛。` | `PIPELINE_READY` | observation/capture/content/event/summary/bundle 各 `+1`；outbox succeeded；一条 audit；externalCalls=0 |
| `VS1-REPLAY-002` | `test:contract` 在 HAPPY 后直接重复投递同 envelope bytes | `IDEMPOTENT_REPLAY` | 绕过 selector、只读返回原 receipt；所有表 `+0`；不产生第二 audit；operator 再跑则 NO_WORK |
| `VS1-CONTENT-DUP-003` | 新 operation，同 source/external/content hash | `CONTENT_DUPLICATE_REUSED` | Content/Event/Summary/Bundle `+0`；既有 identity/hash 不变 |
| `VS1-EVENT-MERGE-004` | 不同 source/external，但 normalized event input 与 HAPPY 同日同值 | `EVENT_MEMBER_MERGED` | Content `+1`、Event `+0`、member union；只有 canonical 一条 ready Summary/Bundle |
| `VS1-EVENT-DAY-005` | 与 HAPPY 同文，published_at 改下一 UTC 日 | `EVENT_NEW_DAY` | Event `+1`；fingerprint 等于固定不同日 golden |
| `VS1-NORMALIZE-006A` | candidate 含禁止控制字符 | `CONTENT_NORMALIZATION_INVALID` | capture `+1(valid,pending,null)`；Content/Event/Summary/Bundle `+0`；Outbox succeeded |
| `VS1-EMPTY-006B` | title/body normalization 后为空 | `CONTENT_EMPTY` | capture `+1(valid,pending,null)`；Content/Event/Summary/Bundle `+0` |
| `VS1-AD-007` | title 前缀 `SYNTHETIC_ONLY:AD:` | `CONTENT_OBVIOUS_AD` | capture `+1`；Content/Event/Summary/Bundle `+0` |
| `VS1-SPAM-008` | body 前缀 `SYNTHETIC_ONLY:SPAM:` | `CONTENT_SPAM` | capture `+1`；Content/Event/Summary/Bundle `+0` |
| `VS1-OFFTOPIC-009` | title 前缀 `SYNTHETIC_ONLY:OFF_TOPIC:` | `CONTENT_F1_UNRELATED` | capture `+1`；Content/Event/Summary/Bundle `+0` |
| `VS1-UNKNOWN-010` | 无正/负 synthetic marker | `CONTENT_RELEVANCE_UNKNOWN` | capture `+1`；Content/Event/Summary/Bundle `+0`；unknown 不升级 |
| `VS1-HASH-COLLISION-011` | repository test double 返回同 fingerprint、不同 canonical bytes | `DEDUP_COLLISION_UNRESOLVED` | Event needs_review；Summary/Bundle `+0`；无自动 merge |
| `VS1-SUMMARY-MISSING-012` | 合格 canonical Content，但 mock_summary 缺失 | `SUMMARY_FIXTURE_NOT_ALLOWLISTED` | 整个结果事务回滚；outbox terminal_failed 后 dead-letter |
| `VS1-STALE-FENCE-013` | adapter 返回前提升任一 fence | `STALE_FENCE` | candidate/result domain `+0`；旧 lease 不可完成 |
| `VS1-RETRY-014` | attempts 数组依次 `HTTP_503`、`COLLECTION_TIMEOUT`、`candidate` | `PIPELINE_READY` | fixture clock 前进 `1s/3s`，同 op/key、新 lease，attempt 3 成功 |
| `VS1-DEAD-015` | 三次 `HTTP_503` | `HTTP_503` | attempt=3，Outbox dead_letter，零 candidate/domain 写入，无第4次 |
| `VS1-PARTIAL-016A..016G` | 七个独立 case，`fault_injection` 依次为 `after_capture,after_content,after_event,after_summary,after_bundle,before_ack_cas,before_audit` | 依次 `TX_CAPTURE_WRITE_FAILED`、`TX_CONTENT_WRITE_FAILED`、`TX_EVENT_CAS_FAILED`、`TX_SUMMARY_WRITE_FAILED`、`TX_BUNDLE_WRITE_FAILED`、`TX_ACK_CAS_FAILED`、`TX_AUDIT_WRITE_FAILED` | 每个 case 均恢复到事务前 counts/hash；failure settlement 原子完成；不可 partial commit |
| `VS1-APPROVED-017` | 同 Event 已存在 approved/Publication 关联链且新 member 改 canonical | `APPROVED_CHAIN_PRESENT` | 旧链逐字不变，新 Summary/Bundle `+0` |
| `VS1-NO-WORK-018` | 无到期 job | `NO_WORK` | 所有表、DB hash 不变，exit 0 |

## 10. receipt 合同

处理到 operation 时，`--once` 在 `0700` 的任务根下写一个权限 `0600` 的 full receipt；receipt 文件名为 `<operation_id>.json`，最终字节 SHA-256 为 `artifactHash`。stdout 只输出三行 JSONL，按 Function ID 固定顺序，每行严格六字段：

```json
{"functionId":"COLLECT-MOCK-002","status":"PASS|FAIL|NO_WORK|NOT_APPLICABLE","reasonCode":"...","artifactHash":"<64hex or null>","externalCalls":0,"recoveryAction":"..."}
```

随后依次为 `CONTENT-PROCESS-003`、`SUMMARY-MOCK-004`。上游失败时下游为 `NOT_APPLICABLE`，reasonCode=`UPSTREAM_FAILED`；过滤成功时 collect/process 为 PASS，summary 为 NOT_APPLICABLE，reasonCode 为对应过滤码。NO_WORK 不写 full receipt，三行均固定 `artifactHash=null,reasonCode=NO_WORK,recoveryAction=NO_ACTION`，其余 mandatory full-receipt 字段不适用。stderr 只写脱敏诊断，不写 fixture 正文、URL query、lease、token、DB 绝对路径或环境变量。

full receipt 为 closed JSON，至少包含：schemaVersion、fixtureVersion/hash、operationId/idempotencyKey/envelopeHash、sourceId、attempt、leasePresent(boolean)、fiveFences、transactionSequence、reasonCode、entityDeltas、canonical IDs、content/event/summary/bundle hash、dbBeforeHash、dbAfterHash、externalCalls、cleanupStatus、recoveryAction。`leasePresent` 只证明存在，禁止包含 token。

seed 完成后必须 `wal_checkpoint(TRUNCATE)`、关闭唯一 handle、确认 `-wal/-shm` 不存在或为 0，再对主 DB 最终字节计算 `dbBeforeHash`；worker 随后才重新打开唯一 handle。最终结果或 failure settlement COMMIT 后执行相同步骤，关闭 handle 后计算 `dbAfterHash`，再写 full receipt。checkpoint/close/hash 任一步失败固定为 `DB_HASH_UNAVAILABLE`，不得声称 PASS。整个过程任一时刻仍只允许一个 SQLite handle。

### 10.1 closed receipt 映射

`recoveryAction` 只允许：`NO_ACTION`、`NO_ACTION_FILTERED`、`RETRY_IN_SAME_RUN`、`ARCHIVE_AND_RESEED_TASK_DB`、`FIX_FIXTURE_AND_RESEED_TASK_DB`、`RESTORE_CONTRACT_AND_RESEED_TASK_DB`、`RESOLVE_COLLISION_THEN_RESEED`、`CLEAR_STOP_OR_REFRESH_FENCES_THEN_RESEED`、`HAND_OFF_APPROVED_CHAIN_TO_ADMIN`。

| reasonCode | 终态 status | recoveryAction |
| --- | --- | --- |
| `PIPELINE_READY,IDEMPOTENT_REPLAY,CONTENT_DUPLICATE_REUSED,EVENT_MEMBER_MERGED,EVENT_NEW_DAY` | `PASS` | `NO_ACTION` |
| `CONTENT_NORMALIZATION_INVALID,CONTENT_EMPTY,CONTENT_OBVIOUS_AD,CONTENT_SPAM,CONTENT_F1_UNRELATED,CONTENT_RELEVANCE_UNKNOWN` | collect/process=`PASS`，summary=`NOT_APPLICABLE` | `NO_ACTION_FILTERED` |
| 首两次 `HTTP_429,HTTP_500,HTTP_502,HTTP_503,HTTP_504,COLLECTION_TIMEOUT,DB_LOCK_CONTENTION` | 只记入 full receipt attempt history，不产生 stdout 终态 | `RETRY_IN_SAME_RUN` |
| 第三次仍为上述 transient code | collect=`FAIL`，下游=`NOT_APPLICABLE` | `ARCHIVE_AND_RESEED_TASK_DB` |
| `INVALID_FIXTURE,FIXTURE_CARDINALITY_VIOLATION,SUMMARY_FIXTURE_NOT_ALLOWLISTED` | 对应当前/下游=`FAIL/NOT_APPLICABLE` | `FIX_FIXTURE_AND_RESEED_TASK_DB` |
| `DB_CORRUPTION,SCHEMA_HASH_MISMATCH,SEED_GRAPH_MISMATCH,DB_HASH_UNAVAILABLE` | collect=`FAIL`，下游=`NOT_APPLICABLE` | `RESTORE_CONTRACT_AND_RESEED_TASK_DB` |
| `DEDUP_COLLISION_UNRESOLVED` | collect=`PASS`，process=`FAIL`，summary=`NOT_APPLICABLE` | `RESOLVE_COLLISION_THEN_RESEED` |
| `STALE_FENCE,LEASE_INVALID,STOP_ASSERTED` | collect=`FAIL`，下游=`NOT_APPLICABLE` | `CLEAR_STOP_OR_REFRESH_FENCES_THEN_RESEED` |
| `APPROVED_CHAIN_PRESENT` | collect/process=`PASS`，summary=`FAIL` | `HAND_OFF_APPROVED_CHAIN_TO_ADMIN` |
| 七个 `TX_*_FAILED` 与未知 code | 当前 Function=`FAIL`，下游=`NOT_APPLICABLE` | `ARCHIVE_AND_RESEED_TASK_DB` |
| `UPSTREAM_FAILED` | `NOT_APPLICABLE` | 与上游同一个 recoveryAction |
| `NO_WORK` | `NO_WORK` | `NO_ACTION` |

## 11. 验收命令与 Owner

开发必须把 `worker:mock` 与 `test:contract` 从 pending script 替换为正式实现，并将 contract test 纳入 `check`。固定验收顺序：

```text
cd app
npm run verify:env
npm run db:migrate
npm run seed:fixtures
npm run runtime:assert-ready
npm run worker:mock -- --once
npm test
npm run test:contract
npm run lint
npm run typecheck
npm run build
npm run check
```

依赖 bootstrap 不属于本任务运行验收。`verify:env` 必须只读复核既有 Node/npm、`package-lock.json` 与 `node_modules` tree hash；缺依赖时本任务 fail closed。任何 `npm ci/install`、registry 访问或 lifecycle bootstrap 必须进入独立获授权任务及安全收据，不能计入本切片 `externalCalls=0`。

Owner 与出口：

| Function ID | 主责 | 必须交付 | 独立验收 |
| --- | --- | --- | --- |
| `COLLECT-MOCK-002` | 开发；数据复核表/Envelope；安全复核 lease/fence/no-egress | adapter、selector、lease/retry/dead-letter、transaction、receipt | 测试覆盖 PRE/SEED/SRC/LEASE/FENCE/STOP/TX/IDEM/RETRY/DEAD；安全证明 externalCalls=0 与秘密零泄露 |
| `CONTENT-PROCESS-003` | 开发；产品/数据维护 normalization、quality、dedupe 合同 | normalizer、quality gate、content idempotency、Event CAS/collision | 测试覆盖 18 case 的 processing 子集、并发/重复/回滚；数据核对 schema/hash/count |
| `SUMMARY-MOCK-004` | 开发；数据复核 Summary/Bundle hash | fixture lookup、Summary、immutable Bundle、approved-chain fail closed | 测试复算 hash/幂等/supersede/partial；安全核对无外部模型、无原文日志 |

只有以下条件同时成立，矩阵状态才可改为 `complete`：全部 mandatory case PASS；上述命令全 0；`check` 实际调用 `test:contract`；`rg` 证明两个 script 不再指向 pending；测试/安全独立 ACK P0=0/P1=0；完整 receipt 可复算；非 loopback externalCalls=0；Admin/真实 provider/RSS/Base/发布/部署仍关闭。

## 12. 失败与回退

- 运行失败：保留 closed failure DB/receipt，按 receipt 的唯一 recoveryAction 在新任务根重建；不得就地修表。
- 实施失败：删除本切片新增代码、fixture 与 package script 映射，恢复最后可机械证明的 app ACK 基线；若该基线无法逐字节恢复，保持 worker/test fail closed。
- 合同冲突：停止冲突 case，记录唯一冲突字段/状态/hash 与两份来源；禁止新增实体、字段或第二 schema 绕过。
- 本地切片 PASS 不解锁 Admin、真实 provider、RSS、Base、自动/外部发布、部署或生产。
