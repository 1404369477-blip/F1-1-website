# schema10 逐表数据可再生性分层草案

> 草案，produced by kimi-k3 subagent 2026-08-30，待独立复核，不得直接并入提案

依据：`app/migrations/rss-real/0001`–`0010` 全部 SQL 迁移文本（未读取任何 .sqlite 生产文件）。
范围说明：0005/0006 为 `source`/`ingest_run` 的重建式迁移（`_v5`/`_v6` 临时表改名回原表），无净新增表；各迁移中的 `migration_000X_assert`/`_preflight` 为 TEMP 表，不计入。`bilingual_lineage_effective_safety_v1`、`valid_backup_recovery_point_v1`、`internal_operation_current_v1`、`authorized_gateway_write_permit_v1` 为 VIEW（无存储，随基表重建），单列于表后。
净表数 **63**（提案预估约 67，差异来自视图与 TEMP 表不计）。

分层定义（按提案）：T0 不可再生（人工判断与凭证，RPO≤15min）；T1 付费可再生（模型产出，重跑花钱；用户已决定暂按 T0 处理，但标出本质）；T2 免费可再生（公开抓取/运行时状态，无 RPO 要求）；T2′ 可再生但重建需人工介入（恢复目标跟随 T0）。

| 表名 | 所属迁移文件 | 分层 | 数据来源 | 丢失后果与重建路径 | 疑义（如有） |
|---|---|---|---|---|---|
| source | 0001（0005/0006 重建） | T2 | 迁移 SQL 硬编码的 RSS 源配置 + 运行时抓取状态（etag/last_modified/last_attempt_at 等） | 配置可从迁移文本确定性重建；运行时状态重抓即恢复。丢失仅失去抓取历史游标 | enabled/stop_epoch 若被运营人工改动过，改动部分不在迁移文本中；当前 schema 下未见人工变更入口 |
| ingest_run | 0001（0005 重建） | T2 | 系统运行时抓取日志 | 丢失后重跑采集即可继续；仅失去历史观测记录，无业务阻断 | — |
| pending_review_candidate | 0001 | **T0**（混合上调） | 抓取字段（title/excerpt/author/published_at/source_payload_hash）+ **人工编辑字段**（editor_title/editor_excerpt/editor_notes/editor_based_on_source_revision/review_status） | 抓取部分可重抓；人工修订文本与审核状态不可再生，丢失即永久丢失 | 典型混合表：整表上 T0 使免费抓取数据也被 15min RPO 约束，提案未给列级/拆表指引 |
| review_bundle | 0002 | T0 | 人工修订后的发布包（public_payload_json 来自人工编辑结果，editor_notes） | 人工编辑产物，不可再生；表级 immutable | — |
| review_decision | 0002 | T0 | 人工审核决定（approved/rejected + 理由） | 提案点名的不可再生人工判断；immutable | — |
| publication | 0002 | T0 | 人工发布决定衍生的发布记录 + 状态机 | 提案点名的混合表：身份字段绑定人工批准，状态机含人工语义；immutable 身份 + 受控状态迁移 | — |
| published_projection | 0002 | T2（依赖 T0 输入） | 由 review_bundle.public_payload_json 确定性派生的投影 JSON | 只要 T0 的 bundle/publication 在即可免费重算；无需新人工动作 | 若 T0 上游丢失则连带不可再生——派生物的可再生性以 T0 存活为前提，提案未明确"依赖 T0 的 T2"这一传递规则 |
| projection_outbox | 0002（0003 加索引/触发器） | T2 | 投递运行时状态机（lease/attempt/reconcile） | 丢失后可从 publication 重新入队，靠 reconcile_key 与对端对账；风险是 in-flight 丢失导致重复投递，幂等键兜底 | — |
| admin_operation | 0002 | T0 | 管理人工操作的请求/响应哈希凭证记录 | 人工动作凭证，审计链一环；immutable | — |
| audit_event | 0002 | T0 | 人工/系统操作的哈希链审计事件 | 提案点名的审计链；append-only + 前驱哈希链，部分丢失即全链不可信 | — |
| projection_delivery_receipt | 0003 | T2 | 对端（public 端）签发的投递激活回执 | 可通过 reconcile 从对端重新确认重建 | 疑义：若对端不保留历史，回执事实本身可能不可重建；它记录的是"对端已激活"的外部事实，介于 T0 凭证与 T2 对账数据之间 |
| rss_media_candidate | 0004 | T2 | RSS 抓取的媒体元数据（URL/类型/大小） | 重抓即可重建；immutable 但内容来自公开源 | — |
| machine_summary_draft | 0004 | **T1**（暂按 T0） | DeepSeek 模型产出（title_zh/summary_zh/key_points_zh，含 token 计数） | 重跑需付费调用模型；提案定义的 T1 典型 | 用户已决定暂按 T0 处理 |
| internal_control | 0007 | T2 | 系统运行时控制单例（phase/stop/epoch/writer_epoch） | 丢失后可重置回迁移初始值（disabled+fenced，安全方向）再经授权流程恢复 | 疑义：epoch 连续性被破坏后，与 internal_operation 中记录的历史 epoch 对不上，恢复语义需人工确认；介于运行时状态与恢复关键元数据之间 |
| internal_operation_policy | 0007 | T2 | 迁移 SQL 硬编码静态策略 | 从迁移文本重建 | — |
| internal_control_action_policy | 0007 | T2 | 迁移 SQL 硬编码静态策略（immutable） | 从迁移文本重建 | — |
| internal_required_fence_policy | 0007 | T2 | 由 policy 表派生的静态 fence 需求（immutable） | 从迁移文本重建 | — |
| owner_authorization_handoff | 0007 | T0 | owner supervisor 签发的授权交接（含 WebAuthn 验证 receipt、一次性 nonce） | 人工凭证动作（fresh WebAuthn）的直接产物；已消费记录是授权历史，不可再生 | — |
| internal_operation | 0007 | T0（混合上调） | 操作账本：系统操作（可重放）+ **人工授权操作**（admin_http 的 review/publish/phase_control，绑定 handoff 与 request_hash） | 系统操作可重放；人工授权操作的授权链事实不可再生 | 混合表：按规则上调 T0 |
| operation_entity_binding | 0007 | T0 | internal_operation 的不可变实体绑定（写许可的唯一来源） | 与操作账本一体，随 T0 | — |
| route_registry | 0007 | T2 | 路由/端点配置（绑定 release/manifest 哈希，immutable） | 从发布清单/迁移流程重建 | — |
| budget_account | 0007 | T2 | 预算账户运行时计数（consumed/reserved） | 可重置重建；代价是丢失历史消耗量，可能出现超支窗口 | 疑义：consumed_units 是付费事实的累计，丢失影响预算审计；介于运行时与付费凭证之间 |
| budget_reservation | 0007 | T2 | 预算预留运行时状态 | 未消费预留丢失→操作重走授权即可；已消费记录随 operation（T0）可查 | — |
| generic_fence_receipt | 0007 | T2 | gate-evaluator/system-supervisor 系统签发的 fence 回执 | 可由签发组件重新评估重签；immutable 但可再发行 | — |
| operation_fence_binding | 0007 | T0 | 操作与 fence 回执的不可变绑定（含 precheck/consume/postcheck 时间线） | 属操作授权事实链一部分，随 internal_operation 上 T0 | — |
| internal_external_attempt | 0007 | **T1**（暂按 T0，混合上调） | 外部调用尝试账本：RSS 抓取（免费）+ **模型调用（付费）** + 备份/对账 | RSS 部分重抓免费；模型调用记录重跑花钱；response_hash 等历史事实无法精确重建 | 疑义：单表混合免费/付费调用；作为账本其"事实记录"属性也接近凭证 |
| internal_operation_outbox | 0007 | T2 | 操作出站运行时状态（pending/leased/…） | 重放/对账重建 | — |
| internal_operation_audit | 0007 | T0 | 内部操作哈希链审计 | 审计链，append-only；部分丢失即链不可信 | — |
| gateway_write_permit | 0007 | T0 | 网关写许可（一次性，绑定 authorized operation） | 未消费 permit 理论上可由 authorizer 重签，但已消费记录是防重放的安全事实 | 疑义：消费状态丢失有重放风险（虽有唯一索引兜底）；派生物 vs 安全凭证之间，按规则拿不准上 T0 |
| gateway_entity_policy | 0007 | T2 | 迁移 SQL 硬编码静态策略 | 从迁移文本重建 | — |
| backup_recovery_point | 0007 | T0 | 备份恢复点元数据（备份哈希、加密密钥版本、off-host 回执、演练结果） | 丢失不丢备份本身，但丢失定位/验证备份所需的元数据，直接妨碍恢复；从 off-host 清单只能部分重建 | 疑义：这是备份系统自举元数据——对"承载 RPO 证据的表"自身定级，提案未覆盖；按规则拿不准上 T0 |
| projection_recovery_anchor | 0007 | T2 | 当前投影代际锚点单例（writer/recovery epoch） | 可经 projection receiver 与对端对账重建 | 疑义：重建依赖对端配合与 T0 的 operation 记录；恢复关键路径上的运行时状态 |
| x_manual_source_registry | 0008 | T2 | 59 行 X 源注册（内容来自 repo 内人工策展 inventory CSV；表级 immutable） | 表有 immutable 触发器，内容恒等于迁移插入值，可从迁移文本+CSV 确定性重建 | 疑义：内容本质是人工策展决定，但因 immutable 而免费可再生；若未来允许状态变更则需重评 |
| x_manual_operation | 0008 | T0 | 人工 X 提交/退休操作的语义映射（绑定 internal_operation） | 人工动作记录；append-only | — |
| x_manual_submission | 0008 | T0 | **人工提交的 X URL**（提案点名）+ 状态机 | 人工提交事实不可再生；append-only | — |
| x_manual_write_permit | 0008 | T0 | X 写许可（一次性，绑定授权 operation） | 同 gateway_write_permit 的防重放安全事实 | 疑义：同 gateway_write_permit |
| x_manual_audit | 0008 | T0 | X 操作哈希链审计 | 审计链，append-only | — |
| bilingual_authority_capability_v1 | 0009 | T2′ | 能力开关状态（closed/enabled），翻转需人工授权 permit + handoff | 状态本身可重建，但重建 enabled 态必须重走人工授权流程（fresh WebAuthn）；丢失回 closed 是安全方向 | — |
| bilingual_authority_permit_v1 | 0009 | T0 | 人工授权许可（一次性 nonce、authority_receipt_sha256 来自 WebAuthn 流程） | 人工授权凭证；immutable | — |
| bilingual_authority_audit_v1 | 0009 | T0 | 授权翻转审计 | 审计链；immutable | — |
| bilingual_authority_bridge_marker_v1 | 0009 | T0 | schema10 桥接授权标记（绑定 quick_launch permit 与 receipt） | 授权凭证链一环；immutable | — |
| bilingual_candidate_lineage_v1 | 0009 | T2 | lineage 投影/缓存（注释明示：mutable 列只是 cache，权威在 safety decision 链）+ public_id 分配 | 可从 decision 链（T0）+ candidate 重算状态字段 | 疑义：public_id 分配是否确定性可重算未在 schema 中自证；若分配含随机性则该列上 T0 |
| bilingual_lineage_safety_decision_v1 | 0009 | T0 | **人工安全决定链**（reviewer_actor_hash + fresh_verification_digest，decided_at−verified_at≤300s 的新鲜人工验证） | 提案点名的不可再生人工判断；append-only 决定链 | — |
| bilingual_operation_link_v1 | 0009 | T0 | 操作语义链接账本（含人工 approve/publish 操作链接） | 操作账本延伸，含人工操作事实；immutable | — |
| bilingual_language_slot_v1 | 0009 | T2 | 语言槽运行时状态机（引用 receipt/draft 哈希） | 状态可从 model_receipt/draft 表（T1）派生重建 | 疑义：重建依赖 T1 表存活；T1 若按 T0 保护则本表 T2 成立，存在层间依赖 |
| bilingual_model_receipt_v1 | 0009 | **T1**（暂按 T0） | 模型调用回执（route_receipt + budget_receipt，付费调用凭证） | 重跑付费；回执哈希是已付费事实 | 用户已决定暂按 T0 处理 |
| bilingual_language_slot_draft_v1 | 0009 | **T1**（暂按 T0） | DeepSeek 双语产出草稿（output_json） | 重跑付费；提案 T1 典型 | 用户已决定暂按 T0 处理 |
| bilingual_bundle_v1 | 0009 | **T1**（暂按 T0） | 由双语 draft 组装的 bundle（系统组装，payload 源自模型产出） | 组装本身免费，但组装原料（draft）付费；且组装前置依赖 T0 的 safety decision | 本质 T1；若 draft 表存活可免费重组装——是否因此降 T2 取决于 draft 的最终定级 |
| bilingual_approval_v1 | 0009 | T0 | **人工审批决定**（actor_ref，触发器强制 manual only，禁 system-*） | 提案点名的不可再生人工判断；immutable | — |
| bilingual_publication_v1 | 0009 | T0 | **人工发布/更正/撤回决定**（均需 admin_http 人工授权操作） | 提案点名的人工发布决定；身份 immutable + 受控状态机 | — |
| bilingual_public_projection_v1 | 0009 | T2′ | **DB 内签名投影**（payload_json + signature） | payload 可从 bundle 重算，但 signature 重签与 activate 需人工授权操作（admin_http authorized op）——符合"可再生但重建需人工介入" | 提案 T2′ 只描述了库外签名投影文件；本表是库内同构情形，提案应显式收纳 |
| bilingual_public_projection_active_v1 | 0009 | T2′ | 当前激活指针（CAS 状态机） | 指针可从 projection 表重算，但 activate 迁移需人工授权 | 同上 |
| bilingual_publication_outbox_v1 | 0009 | T2 | 投递运行时状态机 | 重入队 + reconcile 重建 | — |
| quick_launch_authority_v2 | 0010 | T2′ | 三项能力开关（bilingual_auto_refine / bilingual_manual_mutation / source_registry_management） | 同 bilingual_authority_capability_v1：重建 enabled 态需重走人工授权 | — |
| source_registry_migration_identity_v1 | 0010 | T2 | 迁移身份哈希记录（单例，immutable） | 从迁移文本+preflight 参数确定性重算 | — |
| quick_launch_authority_permit_v2 | 0010 | T0 | 人工授权许可（一次性 nonce + WebAuthn receipt） | 人工授权凭证；immutable | — |
| quick_launch_authority_audit_v2 | 0010 | T0 | 授权翻转审计 | 审计链；immutable | — |
| source_registry_v1 | 0010 | T0（混合上调） | 初始内容可从迁移重建，但后续全部 mutation（propose/enable/disable/retire）均需**人工授权 permit** | 初始态免费重建；人工运营决定（启用/停用/退役及其 epoch 推进）不可再生 | 混合表：迁移基线 T2 + 人工修订 T0，按规则整表上 T0 |
| source_registry_rss_config_v1 | 0010 | T2 | RSS 源配置（来自迁移 manifest，immutable） | 从迁移 manifest 重建 | 疑义：authorization_receipt_sha256 列引用人工授权凭证，配置本体免费可再生但含凭证引用 |
| source_registry_health_v1 | 0010 | T2 | 源健康观测（append-only 运行时数据） | 重新观测即可；仅失历史 | — |
| source_registry_history_v1 | 0010 | T0 | 源注册变更历史链（记录人工 mutation 的 action/revision/原因） | 人工运营决定的审计史；append-only | — |
| source_registry_outbox_v1 | 0010 | T2 | 源启用出站运行时状态 | 重放/对账重建 | — |
| source_registry_mutation_permit_v1 | 0010 | T0 | 源变更人工授权许可（绑定 handoff，一次性 nonce） | 人工授权凭证；immutable | — |

## 视图（无存储，随基表重建，不参与定级）

- `bilingual_lineage_effective_safety_v1`（0009）：decision 链 + registry + control 的派生视图。
- `valid_backup_recovery_point_v1`（0007）：backup_recovery_point 的过滤视图，**硬编码 rpo_seconds<=900**。
- `internal_operation_current_v1`、`authorized_gateway_write_permit_v1`（0007）：操作/许可的派生视图。

## 统计

| 分层 | 表数 | 占比（63 表） |
|---|---|---|
| T0 不可再生 | 29 | 46.0% |
| T1 付费可再生（暂按 T0 处理） | 5 | 7.9% |
| T2 免费可再生 | 25 | 39.7% |
| T2′ 重建需人工介入 | 4 | 6.3% |

T0 中含 4 张混合上调表（`pending_review_candidate`、`internal_operation`、`source_registry_v1`，以及部分混合的 `internal_external_attempt` 计入 T1）。T1 的 5 张：`machine_summary_draft`、`internal_external_attempt`、`bilingual_model_receipt_v1`、`bilingual_language_slot_draft_v1`、`bilingual_bundle_v1`。

## 疑义清单

| 表 | 疑义点 | 建议复核方向 |
|---|---|---|
| projection_delivery_receipt | 对端签发的外部事实回执：对端可重发则 T2，对端不留档则近 T0 | 确认 public 端回执保留策略 |
| internal_control | 运行时单例但承载 epoch 连续性，重置后与历史 operation 记录断链 | 恢复流程是否容忍 epoch 重置 |
| budget_account | consumed_units 是付费事实累计，丢失影响预算审计 | 是否并入 T1 或接受重置 |
| backup_recovery_point | 备份系统自举元数据，丢失妨碍一切恢复 | 提案需单独定义备份元数据层 |
| projection_recovery_anchor | 恢复关键路径上的运行时锚点，重建依赖对端 | 与 projection_delivery_receipt 一并确认 |
| gateway_write_permit / x_manual_write_permit | 已消费 permit 是防重放安全事实，非纯派生物 | 安全组确认重放兜底是否充分 |
| internal_external_attempt | 单表混合免费（RSS）与付费（模型）调用记录 | 是否按 route_class 逻辑拆分定级 |
| x_manual_source_registry | 人工策展内容但因 immutable 可免费重建 | 确认未来无状态变更入口 |
| bilingual_candidate_lineage_v1 | public_id 分配确定性未在 schema 自证 | 查 public_id 生成代码路径 |
| bilingual_language_slot_v1 | T2 成立以 T1 表存活为前提（层间依赖） | 提案需定义依赖传递规则 |
| source_registry_rss_config_v1 | 配置本体 T2 但含人工授权凭证引用列 | 列级拆分或接受整表 T2 |
| source / source_registry_v1 | 初始配置可重建 vs 人工运营修订不可再生的边界 | 以"迁移后是否发生人工 mutation"为界 |

## 对提案分层定义本身的缺陷意见

1. **RPO≤900 被硬编码进 schema 约束**：`backup_recovery_point.rpo_seconds CHECK (rpo_seconds BETWEEN 0 AND 900)` 与视图 `valid_backup_recovery_point_v1` 的 `rpo_seconds<=900` 把旧全局 RPO 写死在数据库层。分层重定级后 T0 要求 RPO≤15 分钟，现有 CHECK 无法表达分层 RPO，提案若不含 schema 迁移计划（放宽 CHECK、按层新增校验或视图重定义），新分级在数据库层无法落地也无法被验证。
2. **缺少"依赖传递"规则**：多张 T2 表（`published_projection`、`bilingual_language_slot_v1` 等）的免费可再生性以 T0/T1 上游存活为前提。提案只按单表定级，未声明"T2 的重建保证随其最弱上游退化"这一规则，恢复演练时会出现单表达标但链路不可重建的情况。
3. **混合表只有上调规则、没有成本出口**：`pending_review_candidate` 整表上 T0 后，约全部抓取内容都被 15 分钟 RPO 约束，备份成本/频率与旧全局方案相比下降有限。提案未给列级分层或拆表（人工列分离）的演进路径。
4. **哈希链审计表的部分丢失语义未定义**：`audit_event`/`internal_operation_audit`/`x_manual_audit` 是前驱哈希链，丢失中间任意一行即全链不可信。对链式结构，"RPO≤15 分钟"不等于"最多丢 15 分钟数据"——丢一行和丢一段的损害相同。提案应对链式表单独声明"零丢失"或"链锚点外置"。
5. **T1 暂按 T0 使 T1 层当前为空集**：5 张本质 T1 表全部上探后，分层实际退化为三层。提案未定义 T1 从 T0 剥离的触发条件（量级阈值？成本阈值？），"暂按"有永久化风险。
6. **备份系统自举未覆盖**：`backup_recovery_point` 承载恢复所需元数据（密钥版本、off-host 回执、演练证据），对它自身的定级决定"恢复能力本身是否可恢复"。提案把分层应用于业务表，但未处理备份元数据这一递归层。
7. **T2′ 的库内同构情形未显式收纳**：提案用库外签名投影文件定义 T2′，但库内已存在同构表（`bilingual_public_projection_v1`、`bilingual_public_projection_active_v1`、两张 authority 开关表），提案正文若只提文件不提库内表，逐表落地时会漏。
