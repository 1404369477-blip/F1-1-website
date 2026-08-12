---
type: system_adr
status: accepted
date: 2026-08-12
department: 产品部
decision_id: ADR-M5-REAL-REVIEW-PUBLISH-001
related_task: TASK-20260812-28FA62
authorization_state: user_confirmed
authorization_evidence: 用户持续要求完成前后端数据库核心功能初版，已授权固定M1真实采集，并明确初期全部公开内容须人工审核、禁止自动发布
supersedes_for_real_rss:
  - ADR-M5-REVIEW-SYNTHETIC-001
implementation_state: pending
visual_state: user_gated
---

# ADR-M5-REAL-REVIEW-PUBLISH-001：真实 RSS 人工审核与公开投影最小纵切 successor

## 决定

真实 RSS 主链采用“私有唯一写主 + 显式人工决定 + 第二次手动发布 + 单向全量公开快照”。固定 M1 现有 `rss-real-private` SQLite 继续作为真实候选写主，在只追加 `0002_admin_review_publish.sql` 后承载人工审核与发布业务真值；公开站只读取独立 active snapshot，不直接打开私有库。

批准与发布分为两个用户动作：approve 只创建 immutable Decision 和唯一 queued Publication；manual publish 才在 Admin 事务中提交 PublishedProjection 并创建唯一 `snapshot_sync` outbox。公开 receiver 原子激活快照并返回 active receipt 后，`/` 与 `/stories/{publicId}` 才能读取该版本。自动发布固定为 0。

## 理由

1. 当前 20 条真实候选已经在私有三表中稳定存在，复用同一候选库可避免复制、跨库关联与第二审核真值。
2. Admin 与公开出口处于不同故障域，SQLite 无法跨库原子提交；唯一 outbox + 内容寻址全量快照能明确区分业务成功、投递成功和结果未知。
3. 单 M1 先以两个 loopback 进程和两个资源根运行，未来迁移到独立 public-host 只改接收端地址、服务身份和 deployment manifest，业务状态、DTO、hash、outbox 与 receipt 不变。
4. 0 图、手工中文标题/摘要、真实原文链接已经构成可用初版；媒体和 AI 会增加权利、安全与依赖面，继续后置。

## 精确边界

- 现有 RSS `0001`、采集器、调度和 `pending_review_candidate` 机器更新语义保持不变。
- 新 migration 只新增 `review_bundle/review_decision/publication/published_projection/projection_outbox/admin_operation/audit_event` 七表和必要触发器/索引。
- 旧 Admin 11 DTO/111 槽位映射保留为 synthetic 历史证据；真实 RSS 使用 v0.2 candidate-first DTO，并由后继数据 mapping 逐字段落盘。
- 公开 record 只允许人工中文标题/摘要、来源元数据、0 图、经过验证的 Motorsport HTTPS 原链和最小详情；私有备注永不公开。
- 现有 `public-multimedia-synthetic` 数据库只读保留，不能混入真实行；它只作为精确回退 release。
- 后端合同已接受；Admin UI/CSS、视觉、真实 Mac/iPhone/overlay、production deployment manifest 仍按独立门禁推进。

## 被拒绝的方案

| 方案 | 拒绝原因 |
| --- | --- |
| 真实候选复制到旧 `review-synthetic` | 形成第二候选真值，且旧映射不匹配当前三表 |
| 直接写现有 public synthetic SQLite | 破坏冻结 hash/count，混淆真实与演示数据 |
| Admin 请求直接跨库写公开 DB | 无跨 DB 原子性；崩溃会误报发布或形成半状态 |
| approve 即 publish | 绕过用户要求的第二次显式手动发布 |
| JSON/React state 直接充当审核真值 | 缺少 CAS、幂等、审计与可恢复身份 |
| 首版同时做 AI/图片/多源 | 扩大依赖与权利风险，延迟最小闭环 |

## 实施与回退

唯一实施入口为 [真实 RSS 人工审核与公开投影最小实施合同 v0.1](../../spec/F1+1-真实RSS人工审核与公开投影最小实施合同-v0.1.md)。

实现失败时关闭 Admin mutation/投递，RSS 采集和私有候选继续运行，公开站继续 last-known-good；不执行 down migration、不删除候选、不新建 publicId、不回写公开副本。视觉未确认只阻断页面实现，不能用来改写已经接受的后端业务语义。
