---
type: system_adr
status: draft
date: 2026-08-09
department: 产品部
decision_id: ADR-VS-RSS-0-001
related_task: TASK-20260808-291BE4
input_tasks:
  - TASK-20260808-493D17
  - TASK-20260808-CAD1DB
  - TASK-20260808-33A937
decision_scope: VS-RSS-0 单次本地低频 RSS 运输与幂等诊断试验
authorization_state: user_required
amends: none
---

# ADR-VS-RSS-0-001：本地低频 RSS 试验系统合同（draft）

> 本文件是待用户确认的系统合同草案，不是 accepted ADR、执行授权、第三方权利许可或生产放行。任何真实请求继续关闭，直到 §11 的唯一问题得到肯定答复，且 §5 的实施与独立复验门槛全部通过。

## 1. 决策目标

用一次可计数、可删除、失败关闭的本地试验，验证 RSS 运输安全层、来源限定、稳定身份、发布时间、重复读取去重和临时数据清理。试验不验证生产内容权利、商业再展示、中文摘要、图片、完整删除同步或长期 15 分钟 SLO。

本草案不修改现有 accepted ADR、Base 单一真值、provider、领域 schema、公开 DTO 或 app 业务能力。

## 2. 输入真值与确定性边界

### 2.1 已确认事实

- 研究、数据、安全任务 `TASK-20260808-493D17`、`TASK-20260808-CAD1DB`、`TASK-20260808-33A937` 均已由统筹部 ACK。
- 本地 inventory 是 59 个 X 候选、RSS 0、`enabled=false` 59；当前不存在已授权且已启用的 RSS Source。
- 研究部在 2026-08-08 只读观察到 Motorsport F1 RSS 返回 50 条，50/50 具有 GUID、原链和 `pubDate`；该时间点的可达性不证明未来可用性。
- 数据门禁包的离线 validator PASS；Source 39/39、source_item 18/18、游标、幂等、时间、权利、退避和人工审核出口已有映射。
- 安全部当前结论为 `FAIL / P0=0 / P1=2`：Formula1.com 内容持久化范围与公开条款证据冲突；RSS 运输安全合同尚未实现和通过负例复验。

### 2.2 产品建议

- 选择 Motorsport F1 RSS 作为 VS-RSS-0 唯一真实来源，目的限于运输、链接、稳定 ID、发布时间和去重诊断。
- Formula1.com RSS 只保留为后续可选的“瞬时结构失败关闭”样本，不进入本次用户授权问题。
- 采用三次、至少间隔 15 分钟的 GET 上限；该设计能观察重复读取和条件请求，不足以承诺长期 15 分钟 SLO。
- 所有条目级临时诊断在最后一次请求后 24 小时内删除，只保留无内容的聚合验收收据。

### 2.3 Unknown

- Motorsport RSS 在执行时的可达性、地区差异、ETag/Last-Modified、GUID 稳定性、编辑/删除语义和长期错误率。
- Motorsport 针对 F1+1 具体运营主体、商业形态的内容存储、摘要、归因、展示和媒体权利。
- 运输安全实现、真实负例复验、真实 Collector/SQLite/Base、人工审核 UI 与生产出口。
- 试验窗口内是否出现新条目；若没有合格 `published_at` 的新条目，15 分钟指标必须报告 `unknown/not_measurable`。

## 3. 方案比较与唯一推荐

| 方案 | 范围 | 收益 | 代价/风险 | 结论 |
| --- | --- | --- | --- | --- |
| A. Motorsport 单源诊断 | 固定一个 F1 专题 RSS，三次有界 GET，只保留最小临时诊断 | 可同时验证稳定 ID、原链、`pubDate`、条件读取和去重 | 权利仍 Unknown；只允许内部临时诊断 | **唯一推荐** |
| B. Motorsport + Formula1.com | 主源外增加一次 Formula1.com 瞬时结构观察 | 可验证无 `pubDate`、无图片和内容持久化拒绝 | 增加第二来源和权利边界，对主试验出口没有必要贡献 | 本轮不采用；可另案 |
| C. 继续零真实请求 | 只保留 synthetic 测试 | 外部风险最低 | 无法验证真实响应、条件头和源端字段稳定性 | 用户拒绝 A 时采用 |

采用 A 符合最小充分原则：一个来源即可回答当前运输层问题，加入第二来源会扩大授权面与失败组合。

## 4. 提议的精确试验合同

### 4.1 来源与执行窗口

- 唯一来源：`https://au.motorsport.com/rss/f1/news/`
- 请求方法：仅 `GET`。
- 授权有效期：仅一次 VS-RSS-0 运行；三次真实请求及响应处理均须在 `2026-08-15T23:59:59+08:00` 前完成，因此首次请求最晚为 `2026-08-15T23:29:00+08:00`。若调度或响应耗时使后续请求无法在截止前完成，则取消后续请求，不得补发。
- 请求上限：最多 3 次真实 GET 尝试，计划为 `T0`、`T0+15min`、`T0+30min`；任意两次尝试间隔不得少于 15 分钟。
- 失败不增加请求预算，不做现场网络重试；触发停止条件后取消剩余计划请求。
- 单来源同时最多 1 个在途请求；每次最多解析前 20 个 item。
- 第 2、3 次可在同一受控进程内使用第 1 次响应提供的 ETag/Last-Modified 做条件 GET；不得为了补字段执行文章页、媒体或其他 second-hop。
- 重定向为 0 次；没有另行批准的 redirect allowlist。

### 4.2 数据保留

| 层级 | 允许内容 | 最长期限 |
| --- | --- | --- |
| 进程内瞬时 | 原始响应字节；ETag/Last-Modified 原值；解析所需 GUID、标题、描述、作者、enclosure | 单次解析或本次受控进程结束即清除；不得写磁盘或日志 |
| 本地临时诊断 | 固定 `source_id`、来源限定后的 item identity SHA-256、已校验 canonical article URL、`published_at`、`first_seen_at`、`last_seen_at`、response hash、`rights_status=unknown`、`missing_unconfirmed`、状态/原因码、字节/条目计数、耗时 | 最后一次实际请求结束后 24 小时内删除 |
| 永久验收收据 | `source_id`、allowlist 配置 hash、尝试时间、成功/失败/304 聚合计数、条目数量、去重数量、是否可测 SLO、清理完成时间、不可逆 manifest/hash | 可留在本地产品/测试/安全报告；不含完整来源/条目 URL、标题、描述、作者、GUID、媒体或响应头原文 |

明确禁止持久化 title、description、author、原始 GUID、原始 XML、enclosure/媒体 URL、图片、全文、Cookie、token、解析 IP 清单、完整响应头、stack 或本地路径。临时 canonical article URL 仅用于链接与去重诊断，不进入 Base、领域 Content、Publication、PublishedProjection 或公开页面。

条目身份机械规则固定为：`external_id` 优先取非空 GUID/Atom ID；缺失时取规范化后的 entry canonical URL；两者均缺失则以 `IDENTITY_MISSING` 拒绝该完整响应。幂等键逐字为小写十六进制 `SHA-256(UTF8(source_id + U+001F + external_id))`。同一受控进程在三次响应之间只在内存中保留 external_id 精确输入字节，用于 hash 相同时的字节比较；不得写盘、写日志或进入永久收据，进程结束立即清除。进程状态丢失或无法完成字节比较时以 `IDENTITY_COLLISION_UNRESOLVED` 失败关闭并进入人工出口。`published_at` 只接受有效源时间，否则为 null 且 `timestamp_confidence=unknown`。

### 4.3 删除与缺失语义

- 原始响应在完成单次解析或失败关闭时立即释放，不保留部分内容。
- 临时诊断必须在最后一次实际请求结束后 24 小时内通过受控清理命令删除，并生成只含计数、路径哈希和时间的删除收据。
- item 从后续响应消失只记 `missing_unconfirmed`；不得自动判定撤稿或删除。
- 明确权利通知、来源明确 404 或合同停止时，终止试验并清除仍存在的临时条目；本草案不定义生产删除巡检。

## 5. 实施前门槛

用户回答“批准”只批准 §4 的有界真实请求，不会直接触发请求。实际执行前必须同时满足：

1. 开发部只用 synthetic/恶意 fixture 实现 §6 十项运输安全合同，不访问外部。
2. 测试部、安全部分别完成独立负例复验，结论均为 `PASS / P0=0 / P1=0`。
3. 运行配置逐字绑定 §4.1 URL、3 次总预算、15 分钟最小间隔、20 item、1 MiB、无重定向、无 second-hop、24 小时删除。
4. `Source` 仍为 `validating/proposed/enabled=false`；authorization/platform/adapter gate 不能由用户批准自动升级。
5. 执行前重读 authorization、stop、`source_config_epoch`、`source_safety_epoch` 与 TaskEnvelope fences；任一不通过即拒绝。
6. 不在用户批准的有效期内完成上述条件时，本次授权失效并保持零真实请求。

## 6. 十项运输安全合同

1. **精确 allowlist：** 只接受固定 `https` origin 与精确 path；拒绝 userinfo、fragment、非 443 端口、IP literal、通配子域和 query。URL 只能来自受审配置。
2. **DNS/IP：** 每次连接重新解析；实际 connect 目标拒绝 loopback、private、link-local、multicast、unspecified、CGNAT、文档/保留地址与 IPv4-mapped IPv6；混合公网/非公网解析整体拒绝。
3. **重定向：** 本试验固定 0 次；任何 3xx 失败关闭，不跟随，不转发 Authorization/Cookie。
4. **方法、TLS 与超时：** 仅 GET；TLS 使用系统信任链并校验请求 hostname，禁止忽略证书、hostname 或链错误。连接 3 秒、首字节 5 秒、总计 10 秒。证书/hostname 错误、超时、中断或部分响应不解析、不保留、不推进游标。
5. **响应：** 声明长度或解压后实际字节超过 1 MiB 立即中止；默认拒绝 content-encoding。只接受 `application/rss+xml`、`application/xml`、`text/xml`，拒绝缺失 MIME、HTML/JSON 与 sniffing。
6. **XML：** 禁用 DTD、DOCTYPE、外部/参数实体、XInclude 与网络 schema；完整响应最多 10,000 个 XML element/attribute/text 节点，最大嵌套深度 32，单个 element text 或 attribute value 最多 16,384 个 UTF-8 字节，pilot item 上限 20。实现必须在不落盘的流式/内存阶段先完成整个文档的结构、schema 与 unknown-semantics 检查，再统计 item 总数；上述检查通过后，RSS/Atom item 数量 `>20` 固定以 `XML_ITEM_LIMIT` 拒绝完整响应。不得在读到第 21 项时提前接受、只截取前 20 项，或跳过后续 schema/unknown-semantics 检查。任一超限、schema 异常或非完整 parse 均拒绝完整响应，不落盘、不推进游标。
7. **并发/重试：** 单来源一个在途；真实 pilot 不增加三次预算、不现场重试。synthetic 合同继续验证 network/5xx `60/300/900s`、429 `Retry-After` 限在 `60..3600s`、parse `300/900/1800s` 后 dead-letter，并在每次理论重试前重读全部 fences。
8. **原子/缺失：** 所有新 observation 集合、inbox intent 集合与临时 cursor 必须在同一事务提交。一次已尝试的写事务只有三者全部提交或三者全部未提交两种合法结果；observation 集合内部部分提交，或三者任一提交状态与另外两者不同，均固定以 `ATOMIC_COMMIT_PARTIAL` 失败关闭。事务结果在产品语义上整体拒绝：不得接受或读取部分写入，并在继续任何请求前回滚；若存储层报告部分写入或游标推进已持久化，则立即停止试验并保持阻断，直到受控恢复证明 observation、inbox intent 与 cursor 均无残留/未推进。304 不产生 observation。消失只记 `missing_unconfirmed`。
9. **日志：** 本规则只检查本次 VS-RSS-0 `operation_id` 的独立 trial log sink。允许字段仅为 source_id、事件时间、固定状态/原因码、字节/条目计数、耗时、尝试序号和不可逆哈希；禁止记录完整 URL/query、feed 内容、标题/描述/作者、响应头原文、IP 清单、stack、Cookie、token 或本地路径。日志字段 allowlist 必须在 emit 前、且在数据事务与游标提交前完成校验；本次 operation 任一拟写日志包含一个或多个禁止字段时，固定以 `LOG_POLICY_VIOLATION` 失败关闭并禁止 emit/commit。若事后发现 trial sink 已形成违规日志，则立即停止，禁止字段和值不得复制进失败收据，并保持 blocker，直到违规日志删除且数据/游标受控恢复证明零残留。
10. **出口/CSP：** 本次 VS-RSS-0 使用独立 pilot store/profile，不产生与本次 `operation_id`/`source_id` 关联的 Publication/PublishedProjection；媒体为空，不新增第三方 `img-src`；本试验不向公开页提供条目原链。仅当本次 operation 新产生或关联的 Publication 数量 `>0`、PublishedProjection 数量 `>0`，或本次 pilot profile/CSP 允许第三方媒体来源时，固定以 `EGRESS_POLICY_VIOLATION` 失败关闭；立即停止试验，不接受任何公开产物，不推进游标。既有 `public-synthetic` 等无关对象始终只读且不得计数、删除或修改；无法证明隔离域时预检失败关闭。本任务只定义本地失败关闭与清理门槛，不授权外部补偿或删除动作。若未来另案展示原链，必须重新验证 HTTPS、新窗口隔离与 `noreferrer noopener`。

### 6.1 唯一主 reason code 与机械出口

每个失败判定只允许一个 `primary_reason_code`。固定停止 reason code 集合为：`FENCE_STALE`、`URL_NOT_ALLOWLISTED`、`DNS_NON_PUBLIC`、`REDIRECT_REJECTED`、`TLS_CERT_INVALID`、`TLS_HOSTNAME_MISMATCH`、`CONNECT_TIMEOUT`、`FIRST_BYTE_TIMEOUT`、`TOTAL_TIMEOUT`、`RESPONSE_TOO_LARGE`、`MIME_REJECTED`、`XML_DTD_REJECTED`、`XML_NODE_LIMIT`、`XML_DEPTH_LIMIT`、`XML_FIELD_LIMIT`、`XML_SCHEMA_INVALID`、`UNKNOWN_SEMANTICS`、`XML_ITEM_LIMIT`、`IDENTITY_MISSING`、`IDENTITY_COLLISION_UNRESOLVED`、`ATOMIC_COMMIT_PARTIAL`、`LOG_POLICY_VIOLATION` 和 `EGRESS_POLICY_VIOLATION`。

四类新增主 reason code 的触发和出口固定如下：

| `primary_reason_code` | 唯一机械触发 | 完整响应 / 事务 | 游标 | 保留与继续请求 |
| --- | --- | --- | --- | --- |
| `XML_ITEM_LIMIT` | XML 结构、schema 与 unknown-semantics 检查通过后，解析出的 RSS/Atom item 数量 `>20` | 拒绝完整响应；不截断接受，不启动写事务 | 临时与业务游标均不推进 | 原始/部分响应与条目均不保留；取消剩余请求 |
| `ATOMIC_COMMIT_PARTIAL` | 已尝试写事务中 observation 集合内部部分提交，或 observation 集合、inbox intent 集合、cursor 三者提交状态不全相同；包括向量中的 `observations_committed != inbox_intent_committed` | 整体事务拒绝；部分写入不可见、不可接受，须回滚；不能证明零残留时保持阻断 | 失败关闭出口须恢复为未推进；检测时已推进也命中本码 | 验收出口必须证明 observation、inbox intent 与 cursor 零残留/未推进；取消剩余请求 |
| `LOG_POLICY_VIOLATION` | 本次 operation 的 trial log 拟写字段含 §6.9 allowlist 之外的字段；包括 `title` 或 `stack` | emit 前拒绝当前完整响应/运行；禁止把违规值复制进收据 | 数据与游标 commit 前拦截；若事后发现则须受控恢复为未推进 | 删除本次 operation 的违规本地日志并证明零残留；只可保留该 reason code 与聚合计数；取消剩余请求 |
| `EGRESS_POLICY_VIOLATION` | 本次 operation 新产生/关联的 `Publication>0`、`PublishedProjection>0`，或本次 pilot profile 的第三方媒体 `img-src`/等价出口被允许，任一成立 | 拒绝当前完整响应/运行；关联公开产物不得成为真值或继续流转 | 失败关闭出口须恢复为未推进 | 只清理本次 operation 的本地残留并关闭其媒体出口；既有对象不动，外部补偿未获授权；取消剩余请求 |

主 reason code 优先级固定为：`EGRESS_POLICY_VIOLATION` > `LOG_POLICY_VIOLATION` > `ATOMIC_COMMIT_PARTIAL` > 其余按执行管线首次失败。其余管线顺序固定为 `FENCE_STALE` → URL → DNS/IP → redirect → TLS chain → TLS hostname → connect timeout → first-byte timeout → total timeout → response size → MIME/content-encoding → DTD/XInclude → XML node → XML depth → XML field → XML schema → unknown semantics → XML item → identity missing → identity collision。检测到前三类后置不变量破坏时，它们按上述优先级覆盖先前候选主码；其他同时出现的信号只能作为无敏感值的聚合审计计数，不得成为第二个主 reason code。

四类新增失败的公共机械结果均为 `decision=reject`、`complete_response_rejected=true`、`cursor_advanced=false`、`data_retained=false`；这些字段描述受控恢复后的失败关闭出口，初始检测收据可如实记录曾出现部分提交、游标推进、违规日志或本次 operation 的本地公开残留。`data_retained=false` 指失败关闭出口已证明本次 operation 无授权保留数据；`cursor_advanced=false` 指游标已恢复至事务前位置。若恢复证明未完成，则该向量保持 blocker，不得把任务判为通过。稳定身份缺失、碰撞无法逐字节排除、schema 异常，或新增不可识别字段影响身份、原链、时间、权利或解析语义时，继续使用既有对应 reason code 立即取消剩余请求、丢弃完整/部分响应、不持久化、不推进临时或业务游标；不得改用宽松解析或猜测字段。

## 7. 成功标准

以下全部满足才可把 VS-RSS-0 记录为本地技术试验 PASS：

- 真实外部请求总数 `1..3`，全部仅命中固定 feed；无 redirect、second-hop、媒体请求、Base/provider 或其他外部 I/O。
- 单响应不超过 1 MiB、最多解析 20 项，MIME/XML/超时/公网 IP 检查均有收据。
- 相同 source-scoped external identity 在重复响应中产生相同幂等 hash；同一响应或跨响应重复项不产生第二诊断项。
- `published_at` 只使用 feed 的有效源时间；缺失时为 null，禁止以 `first_seen_at` 冒充。
- 有合格新条目时计算 `observed_at - published_at`；没有分母时报告 `unknown/not_measurable`，不得报告 15 分钟 PASS。
- title/description/author/GUID/XML/媒体没有落盘或进入日志；所有临时 canonical URL 与条目级诊断在 24 小时内删除并有聚合清理收据。
- 运行期间 Source 保持 proposed/disabled；本次 `operation_id`/`source_id` 关联的 Publication/PublishedProjection=0，既有对象不计入且只读不动；Base writes=0，provider switch=false，公开输出=0。

任一失败只允许形成原因码和清理收据，不得扩大请求、改用 Formula1.com/FIA、启用 second-hop、保留部分内容或放宽网络控制。

## 8. 回退

- 实施门槛未通过：保持零真实请求，删除本地实现候选产生的临时 fixture 输出。
- 真实试验开始后失败：取消剩余请求，清除原始响应和临时条目，保持 Source disabled，不推进业务游标。
- 用户撤回、授权过期、条款/权利冲突或 stop/fence 变化：立即停止并执行同一清理出口。
- 回退不修改 Base、provider、accepted ADR、Spec、data schema 或公开 DTO。

## 9. 本草案未授权的能力

- Formula1.com、FIA 或其他 RSS 请求；文章 metadata/正文 second-hop；媒体下载、代理、缓存、缩略图或第三方前端加载。
- title/description/author 的持久化、中文翻译/摘要、内容归档、公开原链或任何公开展示。
- 新 Source 启用、Base/SQLite 业务入库、provider/Collector 切换、生产定时任务、部署、付费或外发。
- 自动审核、自动发布、Publication/PublishedProjection、15 分钟生产 SLO 宣称。
- 对 Motorsport 内容再使用权、商业权利或生产许可的任何推定。

## 10. Formula1.com 可选结构样本

Formula1.com RSS 只作为未来可选的瞬时失败关闭样本：最多一次 GET、最多 20 item，不持久化 title/description/author/GUID/原链，不执行翻译、摘要、归档或 second-hop，只输出字段存在性与计数。它不包含在本次唯一推荐或 §11 的用户问题中；若未来确有必要，需新的精确授权与实施/复验收据。

## 11. 唯一用户确认问题

**是否批准一次 VS-RSS-0 条件试验：仅在十项运输安全控制完成且测试、安全独立复验均达到 `P0=0 / P1=0` 后，只对 `https://au.motorsport.com/rss/f1/news/` 最多执行 3 次 GET（T0、T+15 分钟、T+30 分钟；首次请求最晚为 2026-08-15 23:29:00，三次请求及响应处理均须在 2026-08-15 23:59:59 前完成；均为北京时间；无法按时完成、失败或逾期均取消后续且不补请求；0 重定向、0 second-hop、每次最多 1 MiB/20 项），原始 XML、标题、描述、作者、GUID 和媒体不落盘，仅将身份哈希、已校验原链、源发布时间、首次/末次观察时间及无内容诊断保留在本地最多 24 小时后删除，全程不写 Base、不切 provider、不进入 Content/Publication/公开页、不做摘要或图片；批准只覆盖该试验，不代表第三方权利许可或生产放行？请只回答“批准”或“拒绝”。**

默认答案为“拒绝”。用户未明确回答“批准”时，真实请求保持关闭。
