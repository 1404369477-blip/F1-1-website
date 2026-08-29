---
type: audit_report
department: 安全部
target: AA08F9最终数据候选与授权VersionTag schema
status: final
date: 2026-08-12
related_task: TASK-20260812-C334CE
decision: pass
tags: [rss-real, sqlite, publication, outbox, audit-chain, version-tag, final-gate]
summary: 四份冻结目标SHA精确匹配，已知Publication与Outbox REPLACE、Audit REPLACE及低位序号分叉均被关闭，授权12位VersionTag未削弱服务端完整hash校验；P0为0、P1为0，数据层可供后端使用。
---

# TASK-20260812-C334CE 绑定 VersionTag 后的数据层最终限定放行报告

## 1. 最终结论

**PASS：P0=0，P1=0，P2=1。**

四份冻结目标 SHA-256 全部匹配。7920C6 的已知绕过已逐项 CLOSED：Publication 和 ProjectionOutbox 的 BEFORE INSERT guard 会在 SQLite 执行唯一冲突替换前主动发现既有身份并中止；AuditEvent 同时拒绝既有 seq/id/hash 冲突，并在 INSERT 后要求新 seq 精确等于前一最大 seq 加一，因此 REPLACE 与低位空闲 seq 分叉均无法落库。

授权 schema 变化只把三个客户端 Bundle CAS 字段从容易误导的 64 位 `*Hash` 改为 12 位小写十六进制 `*VersionTag`。Repository 从经过完整 canonical/hash 复验的 64 位 Bundle hash 取前 12 位比较；bundleId、candidateId、sourceRevision、sourcePayloadHash、publicId、generation、Publication/Decision/Bundle 的服务端完整 hash 链仍同时校验，没有把短 tag 当作持久身份或唯一安全依据。

**最终放行边界**：当前数据层 migration、mapping、schema 及已审 Repository 的相应 CAS 用法可供 backend 继续集成。该结论不放行真实 M1 migration、API/session/CSRF、sender/receiver、签名、active pointer、公开切换或部署。

## 2. 冻结身份

| 对象 | 本会话只读 SHA-256 | 任务冻结值 | 结果 |
| --- | --- | --- | --- |
| `app/migrations/rss-real/0002_admin_review_publish.sql` | `1d373f90cf881a58a15966ffe12ed01c3a651380d5f4f5aa9de468d79a798263` | 同左 | PASS |
| `app/src/tests/review-real-data.test.ts` | `ccbe2938c653346e82241ef17fecda74b3ba2c446eeeaa1d51023f8c4fad7b4b` | 同左 | PASS |
| `app/src/server/review-real/mapping.ts` | `139f05fdbd2b45e5b5a8d4c95b58b864b8e7a48d99c796a00a489e74a4f3730e` | 同左 | PASS |
| `app/src/server/review-real/schema.ts` | `2c00bfc6916f4fded2d8e09f96193c428c157c0797c10081e749aba7620b2fde` | 同左 | PASS |

前任 B88335 因旧 schema 身份漂移按失败路径停止，没有混入本结论。C334CE 已重新绑定统筹授权的新 schema SHA。

## 3. 限定复审方法

- 只读检查 7920C6 已知的 Publication REPLACE、Outbox REPLACE、Audit REPLACE、低位 audit_seq 分叉。
- 只读检查新增四个聚焦负例的源码与数据部记录的单次 `3/3 PASS` 收据；没有重跑。
- 只读检查三组 VersionTag schema、Repository 比较来源和其后的服务端完整 hash 复验。
- 严格保持目标修改 `0`、测试 `0`、typecheck `0`、网络/SSH `0`、数据库写入 `0`；没有扩展新一轮数据审查。

## 4. 已知绕过最终裁定

### 4.1 Publication REPLACE：CLOSED

`publication_guard_insert` 在正常批准关系检查前，查询现存 Publication 并拒绝以下任一冲突：

```text
publication_id / decision_id / bundle_id / public_id
```

因此使用同 Decision/Bundle、不同 publicId 的 `INSERT OR REPLACE` 会在隐式 DELETE 发生前由 `PUBLICATION_APPROVAL_INVALID` 中止。现有 queued 行保持原值，replacement 行不能出现；该闭合不依赖连接是否启用 `recursive_triggers`。

### 4.2 ProjectionOutbox REPLACE：CLOSED

`projection_outbox_guard_insert` 主动拒绝以下现存唯一身份冲突：

```text
delivery_id / publication_id / idempotency_key / reconcile_key /
(snapshot_generation, snapshot_manifest_hash)
```

使用同 Publication、不同 delivery/key 的合法 pending replacement 也会在冲突替换前由 `PROJECTION_OUTBOX_INVALID` 中止。旧 delivery、Envelope、attempt 与 key 不被删除或替换；同样不依赖 recursive delete trigger。

### 4.3 Audit REPLACE 与序号分叉：CLOSED

Audit 有三层静态闭包：

1. BEFORE INSERT 严格对齐 event JSON 与外列，并主动拒绝现存 `audit_seq/event_id/event_hash` 冲突，封住 REPLACE。
2. BEFORE predecessor guard 要求首条 parent 为 NULL、后续 parent 精确等于当前最大 audit_seq 的 event_hash。
3. AFTER sequence guard 要求 `NEW.audit_seq = previous MAX(audit_seq) + 1`；显式高位跳号、低位空闲 seq 和非最大插入均整条回滚。

mapping 继续以 `SHA-256(canonical-json-v1({previous_event_hash,event_payload}))` 构建和读后复验 hash。三层共同保证事件只能沿唯一最大序号追加。

## 5. VersionTag CAS 最终裁定：PASS

### 5.1 API 命名与长度

授权后的三个字段为：

```text
latestBundleVersionTag
bundleVersionTag
approvedBundleVersionTag
```

它们都由 `VersionTagSchema` 限定为恰好 12 位小写十六进制。字段名没有继续把短值描述为完整 hash，符合产品合同“API 可使用短 versionTag、完整 hash 不进入 URL/正文/日志”的边界。

### 5.2 服务端完整 hash 没有降级

- `latestBundle()` 先调用 `verifyStoredReviewBundle`，对 canonical payload、64 位 payload hash 和 64 位 bundle hash 做读后复算。
- revision 同时比较精确 candidateId、sourceRevision、完整 sourcePayloadHash、latestBundleId，再比较 `bundleHash.slice(0,12)`。
- approve/reject 同时比较精确 candidateId、sourceRevision、bundleId、候选完整 sourcePayloadHash/editor revision，再比较短 tag；写入 Decision/Publication 的仍是完整 bundle hash。
- publish 先以完整 publicId 定位精确 Publication，并比较 generation/status/tag；随后重新验证 Bundle 完整 hash，且要求 latest Bundle、Candidate source hash/revision、Decision approved hash、Publication approved hash 全部逐字一致。

短 tag 只承担界面版本提示和客户端 CAS 的一层比较；稳定 ID、来源修订和服务端完整 256 位 hash 链仍共同决定 mutation 是否可执行。没有出现仅凭 48 位 tag 发布或覆盖内容的路径。

## 6. 已有测试证据的只读核对

测试源码包含且数据部记录单次聚焦运行 `1 file / 3 tests PASS`：

1. Publication `INSERT OR REPLACE` 被拒绝，旧行逐字段不变，新 ID 不存在。
2. Outbox `INSERT OR REPLACE` 被拒绝，旧行逐字段不变，新 delivery 不存在。
3. Audit 同 eventId REPLACE 被拒绝，行集不变。
4. 显式低位 `audit_seq=0` 被 sequence guard 拒绝，行集不变。

本安全复审只阅读代码和既有收据，没有把该收据改写为本部门独立动态运行。

## 7. P2 与未验证项

### P2-01：Snapshot generation/parent 形状

原 P2 按任务边界保留：snapshot schema 自身尚未把 generation 与 parent 的形状完全联动。该项已明确交由 backend/receiver 最终审查，在 receiver 上线前必须由 active generation、previous hash、bootstrap pin 和签名校验共同关闭。它不阻断当前数据层供 backend 集成，也不构成公开 receiver 的放行。

### 未验证

- Repository/API 的动态并发、response-loss、DB busy、session/Origin/CSRF/fresh re-auth。
- 真实 migration runner、M1 数据库升级与回退。
- sender/receiver、Ed25519、active pointer、bootstrap pin、公开 reader/cutover。

上述未验证项继续由后继开发与独立动态安全/测试门负责。

## 8. 最终放行与错题自检

- **数据层最终结论：PASS，可供 backend 使用。**
- 没有把数据层 PASS 外推为 API、Admin UI、真实发布、公开切换或生产部署 PASS。
- 没有重新运行已有测试、typecheck、数据库或网络操作。
- 没有修改 migration、test、mapping、schema、Repository、App、Spec 或 accepted ADR。
- 四个已知绕过和授权 VersionTag 是本轮唯一裁定对象；未扩展新的同层审查。

TASK_STATE_OK
