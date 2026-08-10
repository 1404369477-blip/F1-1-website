---
type: implementation_contract
status: accepted_contract_pending_implementation
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-55302B
decision: ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001
scope: public-multimedia-synthetic 本地运行 profile、V2 API 与最终多图 UI 接线
---

# F1+1 `public-multimedia-synthetic` 本地运行实施合同 v0.1

## 1. 开工前置

本合同只能在 [ADR-M5-PUBLIC-MULTIMEDIA-RUNTIME-001](../decisions/system/2026-08-09-F1+1-public-multimedia-synthetic运行profile与V2接线-successor-accepted.md) 的本地 synthetic 边界内实施。开发开工前必须取得：

1. `DATA-MM-01` 完整 runtime graph、manifest/root 与两次确定性 validator PASS；
2. v0.5 五个当前 artifact SHA 与 accepted ADR 相同；
3. M3 与 `public-synthetic` 的独立 closed receipt 均绑定 checkpoint 后关闭的 DB SHA-256、无 WAL/SHM、schema/ledger/count、artifact revision、validator SHA 与验证时间；v0.4 data receipt 绑定同一 revision 的 manifest/artifact SHA；launcher 无 SQLite handle 复核当前字节后均有效；
4. 任务 impact 只覆盖 `app/` 内的新 profile/接线文件和必要测试；无外部副作用；
5. 候选基线绑定 Node 24 LTS、lockfile、数据 root、migration selector root 和 App git/content hash。

任一前置缺失时停止，不创建 SQLite、不修改 App、不启动 HTTP。

## 2. 唯一配置与文件落点

| 配置/文件 | 精确合同 |
| --- | --- |
| `F1_DATA_PROFILE` | 新增唯一 allowlist 值 `public-multimedia-synthetic` |
| `F1_DB_PATH` | `.local/f1plus1-public-multimedia-synthetic.sqlite` |
| `SOURCE_FIXTURE_PATH` | `../data/mvp-contract-v0.5-public-multimedia-synthetic/runtime-graph.public-multimedia-synthetic.json` |
| scoped migration | `app/migrations/profiles/public-multimedia-synthetic/0003_public_multimedia_synthetic_profile.sql` |
| data roots | `data/mvp-contract-v0.5-public-multimedia-synthetic/` 的 manifest/root pins |
| API Accept | `application/vnd.f1plus1.public-read-v0.2+json` |
| external I/O | 非 loopback 出站精确为 0 |

开发必须扩展现有 profile selector，不复制一套环境解析器。旧 `m3-shadow` 与 `public-synthetic` 分支行为、默认值、路径和 health 收据保持逐字兼容。

## 3. 开发任务

### `DEV-MM-01`：profile 与 migration

实施：

- 把 `public-multimedia-synthetic` 加入 closed profile union；
- 选择精确的 0001/0002/scoped-0003 有序列表；
- scoped 0003 只复用现有表并存储 immutable `media_presentations` snapshot；`public_media_candidate.content_id` 使用一对多 FK，`media_candidate_id` 保持主键，`(content_id,media_candidate_id)` 唯一，写前 trigger 限制每个 Content 0–4 行；同一 `fixture_profile_ledger` 增加 selector root、schema fingerprint 两个 64-hex 字段和 `real_media=0` 字段，不另建 root 表；
- 增加该 schema 的 object manifest 与 fingerprint；
- 拒绝旧 0003、新 0003 同时出现、非连续版本、未知 migration、预占对象或 ledger 漂移。

成功：新空库 `user_version=3` 且只有所选 schema。失败：写前拒绝或事务全回滚。恢复：删除仅属于临时候选的空库，修正 selector 后重跑；不改旧 migration。

### `DEV-MM-02`：fixture、seed、ledger 与启动

实施：

- 只读取 `DATA-MM-01` 的完整 runtime graph；
- 一个 immediate transaction 写完整领域闭图和唯一 profile ledger；
- 写后关闭连接，再只读复算 FK/hash/count/roots/V1/V2 预期；
- 通过受控命令创建/重建新 profile；目标文件归属不明时拒绝；
- health/ready 回执增加新 profile、contract、migration、fixture、root 字段，不泄露绝对路径。

成功：0/1/4 三条公开链均由唯一 Projection 可读，重复 seed 行数不变。失败：零部分行、ready=false、HTTP 未监听。恢复：只移动或删除已证明属于本 profile 的候选文件。

### `DEV-MM-03`：Repository 与 API

实施：

- 保留 V1 类型与默认行为；新增 closed V2 union；
- Repository 验证 `media_refs[]`、canonical media、`media_presentations[]` 与 MediaCandidate 同长、同序、同 identity/hash/rights/safety；
- feed/detail/related 复用同一个版本选择器；
- 缺失、`*/*`、`application/json` 返回 V1；精确 V2 Accept 返回 V2；其余全部值返回 406；
- 完整性失败返回 500，响应无 stack/path/SQL/hash 输入或 rights evidence。

成功：V1 的 0/null 与稳定首图逐字兼容，V2 的 0/1/4 数组逐项等于机器预期。失败：整请求关闭。恢复：同一 GET 在修复数据后重试，不写业务状态。

### `DEV-MM-04`：最终 App V2 接线

实施：

- 公共 feed/detail 请求明确发送 V2 Accept；
- client schema 只接受 0–4 个 closed media item；
- 删除或阻断所有单图复制、静态数组、mock 拦截和 placeholder 扩写；
- 0 图不显示缩略图/导航，1 图不显示翻页，4 图按 DTO 顺序呈现主图与四缩略图；
- hover 只预览，leave 恢复已固定图；click/Enter/Space 固定；pointer/touch/trackpad 一次最多前进一张；
- lightbox 前后/方向键/手势/Escape/背景关闭可达，关闭后焦点返回精确触发图；
- 406/500/断连使用现有公开错误和重试出口，不自动请求 V1 构造多图。

成功：正式 production build 的同源 API 和浏览器真实到达 0/1/4。失败：候选阻断，不以组件分支或测试注入收口。恢复：回退完整 v0.4 App/profile 组合。

## 4. 测试、安全与设计矩阵

| ID | 必须通过的机械出口 |
| --- | --- |
| `MM-DATA-01` | DATA-MM-01 完整图两次生成 receipt 相同；0/1/4、总媒体 5；全部 FK/hash/count/root PASS |
| `MM-MIG-01` | 新 selector 只含 exact 0001/0002/scoped-0003；ledger 三个新增字段与 manifest/graph/generator/validator root 公式一致；旧 migration SHA 零漂移 |
| `MM-ISO-01` | 三个 SQLite 路径互异；每进程只开所选 DB；旧库 closed receipt 绑定当前 DB SHA 且 WAL/SHM=0；第二 handle/ATTACH/cross-profile query/copy 全拒绝 |
| `MM-SEED-01` | seed 失败注入每个写点均 0 部分提交；同 Content 4 个 MediaCandidate 可写、第5个由DB拒绝；两次 seed row count/root 相同 |
| `MM-API-01` | 无 Accept、`*/*`、JSON→V1；精确 V2→V2；其余 vendor/多值/参数化/text/plain/非法值→406；每请求与完整响应只有一个版本 |
| `MM-API-02` | feed/detail/related 同版本；0/1/4 V2 与 V1 降级准确；第五图/重复/乱序/坏 hash/rights/safety 失败整请求 500 |
| `MM-UI-01` | production browser 真实显示 0/1/4；无前端复制、静态 media array 或请求拦截 |
| `MM-UI-02` | mouse、keyboard、pointer、touch、trackpad 单步；lightbox focus trap/return；reduced-motion 与 200% 缩放 |
| `MM-SEC-01` | 非 loopback DNS/HTTP/raw socket/proxy/subprocess 外联=0；CSP/日志/Problem 无敏感字段 |
| `MM-RB-01` | 停止新进程后，旧 v0.4 app+public-synthetic 组合仍 V1-only PASS；旧 DB/data/migration/root 零漂移 |
| `MM-DESIGN-01` | 对冻结 HTML SHA `5a84bfb27294ebd727369118a95528f5b788bfacbe2d56cc03fcb006f6168cb1` 的 mandatory 多图/响应式/焦点差异=0 |

测试和安全必须绑定同一 App/data/migration/DB root 候选。只要任一 mandatory 为 `NOT_RUN`、SKIP、静态检查或组件预留，对应 Function ID 继续 `P1-blocker`。

## 5. 失败恢复表

| 失败 | 固定动作 | 禁止动作 |
| --- | --- | --- |
| runtime graph 不完整 | `DATA-MM-01` 阻断，回数据部补同一合同 | 从旧 DB/前端猜字段 |
| profile/path/selector/root 失配 | ready=false，关闭 DB/HTTP | 自动选择其他 profile |
| seed 部分失败 | 事务回滚，清理已证明归属的临时文件 | 覆盖 canonical DB、down migration |
| V2 Accept 不支持 | 406 `PUBLIC_MEDIA_VERSION_UNSUPPORTED` | 默默返回 V2 或混版 |
| 领域链/媒体完整性失败 | 500 `PUBLIC_READ_INTEGRITY_FAILED`，整请求 0 item | 跳坏图、返回部分 gallery |
| 浏览器交互/焦点失败 | 阻断新候选，修复后同 hash 重验 | 用设计 Demo 或人工注入替代 |
| 新路线回退 | 完整切回可证明的 v0.4 App+DB+config | 运行时双读、复制库、静态 fallback |

## 6. 完成定义

以下条件全部满足，四个 Function ID 才能从 `P1-blocker` 转 `complete`：

1. `DATA-MM-01`、`DEV-MM-01..04` 全部交付；
2. `MM-DATA/MIG/ISO/SEED/API/UI/SEC/RB/DESIGN` 全部 PASS；
3. 测试、安全、设计三方 P0=0/P1=0，并由统筹 ACK；
4. 0/1/4 图来自同一正式 V2 API，没有前端第二数据源；
5. 旧 M3、v0.4 data、`public-synthetic` DB/migration/App 根零漂移；
6. 外部调用、真实媒体、Base 写入、Admin/RSS/部署均为 0/关闭。

本合同完成不代表真实媒体、外部来源、生产部署或自动发布获准。
