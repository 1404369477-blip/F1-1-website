---
type: data_security_successor_report
status: final
date: 2026-08-12
department: 数据部
task_id: TASK-20260812-D8A278
predecessor_audit: TASK-20260812-0D4DCB
decision: pass
external_calls: 0
real_database_writes: 0
synthetic_database_writes: 0
---

# TASK-20260812-D8A278 Publication、Outbox、Audit 三项 P1 最小闭合报告

## 1. 结论

`0D4DCB` 指出的三项 P1 已按最小 successor 闭合，修改范围严格限制为 `0002_admin_review_publish.sql`、`mapping.ts` 和既有聚焦测试。`schema.ts`、`0001`、RSS 采集核心、真实与 synthetic SQLite、API、UI、网络和 M1 均未改动。

## 2. 新冻结 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `app/migrations/rss-real/0002_admin_review_publish.sql` | `c0c696fc9f884ea9d74101f687276255687093e8e02736b7fc1efa9fa578c4ee` |
| `app/src/server/review-real/mapping.ts` | `139f05fdbd2b45e5b5a8d4c95b58b864b8e7a48d99c796a00a489e74a4f3730e` |
| `app/src/tests/review-real-data.test.ts` | `a8e29e626099d281f1db3cfee93a833b9785670c814b407fd7a0f94cd3b632fa` |
| 未修改的 `app/src/server/review-real/schema.ts` | `389245a0c7f56140f673e171842934a4c62d9fbe6511a3a4a725d2b45e9e456b` |

## 3. 三项闭合

### P1-01 Publication 唯一身份与发布时间

- 新增 `publication_no_delete`，queued 和 published Publication 均禁止删除。
- `decision_id/bundle_id/public_id/approved_bundle_hash/publish_generation/created_at` 全部不可更新。
- `publication_published_at_guard` 只允许一次原子 `queued + published_at=NULL → published + published_at=非空`。
- 先写时间、只改状态、发布后改时间、queued/published DELETE、改 createdAt 均由 SQL 失败关闭。

### P1-02 ProjectionOutbox 初态、预算与不可重建

- 新增 `projection_outbox_no_delete`。
- INSERT 固定要求 `pending`、`attempt_count=0`、空 lease、空 reason，TaskEnvelope `attempt=0`；直接插入 succeeded/terminal 或携带初始 lease 均被拒绝。
- 新增 `attempt_count<=max_attempts`，冻结 `max_attempts/created_at` 和全部 delivery/snapshot/envelope 身份。
- acquire 只允许 `pending|retryable_failed → leased`，attempt 必须恰好 `+1` 且不超过预算，并在同一 UPDATE 设置两项 lease。
- 离开 leased 必须在同一 UPDATE 清理 lease；失败/reconcile 状态要求 reason；同状态重置 attempt、lease 或 reason 被拒绝。

### P1-03 AuditEvent 前驱链与 canonical hash

- `audit_event_predecessor_guard` 固定：首条 previous hash 为 genesis `NULL`；后续事件必须逐字引用当前最大 `audit_seq` 的 `event_hash`。
- `mapping.ts` 新增 `AUDIT_GENESIS_PREVIOUS_HASH`、`buildAuditEventMaterial`、`verifyStoredAuditEvent`。
- Audit hash 固定为 `SHA-256(canonical-json-v1({previous_event_hash,event_payload}))`；payload 先经现有 strict `AuditEventPayloadSchema`，存储后要求 event JSON 为 canonical bytes 并重算 hash。
- 第二条 NULL parent、错误 parent、并发旧 parent、伪造 event hash、额外私有字段均有聚焦负例。

SQLite migration 本身不引入自定义 SHA-256 函数；后继唯一 Repository 必须在同一 `BEGIN IMMEDIATE` 中读取最后事件、调用 build、插入、调用 stored verify。SQL predecessor trigger负责阻断断链与并发旧 parent，mapping 负责闭合 payload 和 canonical hash。

## 4. 限定验证

验证预算严格各使用一次，无重跑、无首错：

1. 固定 Node `24.18.0` 聚焦测试：`1 file / 3 tests PASS`，测试耗时 `17ms`，总时长 `143ms`，exit `0`。
2. 固定 Node `24.18.0` `tsc --noEmit`：exit `0`，无输出。
3. 所有产物落盘后的唯一 diff-check：PASS，零 whitespace error。

聚焦测试同时保留原有三项覆盖，并新增：

- Publication queued/published 删除、拆分发布、发布后改时间和冻结 identity 负例；原子发布正例。
- Outbox 伪终态、初始 lease、超预算、删除、冻结 max/created、非法状态、attempt 重置负例；合法 acquire→retryable 正例。
- Audit genesis、正确第二事件、NULL/wrong/stale parent、伪 hash、额外 private field 负例，以及 update/delete append-only 旧门。
- `0001` 与采集核心固定 SHA pin、内存 migration/FK/integrity、公开 allowlist/private notes 零泄露原测试继续通过。

## 5. 零漂移

- `0001_rss_real.sql` 与七项 RSS 采集核心/旧测试 SHA 由同一聚焦测试继续逐项 pin。
- 六个现存本地 SQLite 的 SHA-256、字节数与 mtime 前后相同；无 WAL/SHM 新增。
- 真实 DB 写入 `0`，synthetic DB 写入 `0`，外部请求 `0`，SSH/M1 操作 `0`。

## 6. 保留边界

- `0D4DCB` 的 P2 snapshot generation/parent 形状继续保留，按任务确认不扩展。
- Repository、Route Handler、session/CSRF/fresh re-auth、真实事务、receiver/签名/active pointer 和 M1 migration 仍未实现或运行。
- 本任务的 PASS 只证明数据 successor 的 SQL/纯函数/内存聚焦候选，仍需安全部对新 SHA 只读复审。

## 7. 错题自检

- 没有修改 schema 公共合同或 Projection record 语义。
- 没有新增实体、列、依赖、API、UI、网络或自动发布入口。
- 没有用应用层口头约定替代 Publication/Outbox 删除、初态、状态和 Audit predecessor 的 SQL guard。
- 没有声称 SQL 自身能计算 SHA-256；canonical Audit hash 的 build/verify 职责已显式交给唯一 Repository。
- 没有处理任务外 P2，也没有增加第二轮测试。

TASK_STATE_OK
