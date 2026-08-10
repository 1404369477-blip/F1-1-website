---
type: data_delivery_report
status: final
date: 2026-08-04
department: 数据部
task_id: TASK-20260804-504B0D
domain_stage: p1_triage
decision: data_boundary_pass_handoff_development
tags: [M4, public-synthetic, SQLite, integrity, responsibility-boundary]
summary: 单次隔离 canonical migration/seed 与单次聚焦完整性核验通过；12 条发布图、root/hash/fence/ledger/profile 及 Repository feed/detail 数据读取有效，数据边界未复现缺陷，后续 owner 为开发部运行时握手诊断。
---

# public-synthetic 运行完整性失败责任边界诊断

## 1. 单一结论

`DATA_BOUNDARY_PASS；NEXT_OWNER=开发部`。

本轮在任务专属 `/tmp/F1plus1-TASK-20260804-504B0D` 内完成一次 canonical 隔离 migration/seed，以及一次聚焦完整性核验。生成结果、SQLite 落盘图、四 root、ledger、12 条 `public-demo-*` 发布链、五 fence、内容/摘要/媒体字段和当前 `PublicStoryRepository` 的 feed、有效详情、未知详情均通过。

数据边界没有出现可归责于 fixture、生成器、migration、seed、hash/fence、ledger/manifest、profile 或 12 条发布图的失败点。测试部此前真实 HTTP 窗口报告的首个失败仍位于运行中 API 请求：`/api/public/feed` 进入 closed `500 PUBLIC_READ_INTEGRITY_FAILED`。由于同一冻结数据在本轮隔离 SQLite 与当前 Repository 直接读取时通过，该问题移交开发部检查真实进程的数据库/配置/构建产物握手。是否以及如何修改实现，需另行派单。

## 2. 执行边界

- 工作区业务代码、`data/`、配置、Spec、accepted ADR 全程只读。
- SQLite 主文件、WAL/SHM、收据和临时诊断脚本只位于任务专属 `/tmp` 目录。
- 未启动 Next、网站、浏览器、worker 或任何外部连接；`externalCalls=0`、`writesToBase=false`、`realContentImported=false`。
- 工作区新增内容仅为本报告、任务状态和完成里程碑事实日志。

## 3. canonical 生成

唯一一次实际生成命令：

```bash
env -i PATH=/Users/hoyin/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin:/usr/bin:/bin \
  /Users/hoyin/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types \
  /tmp/F1plus1-TASK-20260804-504B0D/generate.ts
```

结果：

| 项目 | 结果 |
| --- | --- |
| SQLite 路径 | `/tmp/F1plus1-TASK-20260804-504B0D/f1plus1-public-synthetic.sqlite` |
| migration | `0001`、`0002`、`0003`；`user_version=3` |
| runtime | Node `24.18.0`；SQLite `3.53.1`；WAL；foreign keys=1；synchronous=2 |
| fixture/profile | `public-demo-12-v0.4` / `public-synthetic` |
| inserted | `true` |
| safety | `syntheticOnly=true`、`externalCalls=0`、`writesToBase=false`、`realContentImported=false` |
| DB SHA-256（清理前） | `7c139aa66bd054c9e070ea43654812a6b12b73536e7cda27583ace6ed2b0a31e` |
| generation receipt SHA-256 | `ab76b5ac6ac7f1cb46eded5f82c0a095ee7478ae1529f19266d935a2923047ad` |

精确行数：

| Source | CapturedItem | Content | Summary | MediaCandidate | ReleaseBundle | ReviewDecision | Publication | PublishedProjection |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 12 | 12 | 12 | 10 | 12 | 12 | 12 | 12 |

## 4. 聚焦完整性核验

唯一一次完成业务核验的命令：

```bash
env -i PATH=/Users/hoyin/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin:/usr/bin:/bin \
  /Users/hoyin/Documents/F1+1/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-transform-types \
  /tmp/F1plus1-TASK-20260804-504B0D/integrity.ts
```

结果为 `PASS`，共完成 908 个带定位指针的断言：

- `assertPublicSyntheticSeeded` 通过 migration state、profile/path、ledger、行数、存储 payload 与四 root 检查。
- 12 个唯一 `public-demo-*` projection 均具备唯一 Content → Summary → ReleaseBundle → ReviewDecision → Publication → PublishedProjection 关系。
- 12/12 `source_id=src-active`；Content/Summary/payload/bundle/decision/published-version hash 均按当前 canonical JSON 规则复算一致。
- 每条 Bundle、Decision、Publication 与 canonical payload 的 `source_config_epoch`、`source_safety_epoch`、`authorization_version`、`policy_epoch`、`recovery_epoch` 对齐且均为正整数。
- 12 条 content/summary snapshot、来源、时间、访问状态和媒体呈现满足 Repository 当前读取约束；10 条合成媒体与 2 条无媒体均未触发外部资源。
- 当前 `PublicStoryRepository.getFeed({})` 返回 12 条；选取有效详情 `public-demo-qualifying-window` 返回成功并形成 related；合法未知 ID 返回 `null`，对应 HTTP 层应转为 404。
- 完整性收据 SHA-256：`dbc26a6e74c5f216b7f845fa91d4885e4a6e4a4879ba0a7818b61d79d2e52a53`。

冻结 root 与输入字节复算：

| 产物 | SHA-256 |
| --- | --- |
| `manifest.json` | `3b296868dc0c0000fb94856b334ff7d1f698e3e80d4bb02e7062142dc1a0e554` |
| `profile-ledger.json` | `1f7719490a18a49842427907b53c3dbde5813709a2ad611f7cfaca891880caf1` |
| `generate_public_fixture.py` | `34ecfa83fec1f89a22d877e554c4ce5c4d11c1bad6b7f09f123fea3ede1cb81a` |
| `validate_public_fixture.py` | `058be83bdded7f5c60028f0a2e537c510e9386934284684fffb119d2e487360c` |
| `fixtures.public-synthetic.json` | `c7d9d88b170214b283a214625d6fd2028fd8eb3a6a2701c556cb2364eb9941e4` |
| fixture graph（manifest/ledger/seed receipt） | `4be9f7e868a8bf21551bdcdc05d6b0d027e1a0ea43fd16dd2c7ea2b2ff9ba526` |

## 5. 首个失败点与责任边界

### 本轮数据链

未发现失败点。canonical 生成、落盘验证及当前 Repository 直接读取全部通过。

### 上游真实 HTTP 证据

`TASK-20260804-697D1B` 首个已记录失败点是 seed 成功后的真实 `GET /api/public/feed` 返回 `500 PUBLIC_READ_INTEGRITY_FAILED`；有效详情与合法未知详情随后也进入同一 closed 500。未知详情在查找 public ID 前需要先加载整张发布图，因此它也返回完整性错误，说明失败发生在运行时全局图加载阶段。这一解释属于基于调用顺序和既有 HTTP 收据的推断；本任务按边界未启动网站，未取得真实进程内部原始异常。

本轮隔离 SQLite 对相同全局图加载成功，排除了当前冻结数据包本身的确定性缺陷。责任边界落在开发部的真实运行时握手或当时被测构建快照。

## 6. 开发部最小握手检查项

开发部可按以下顺序定位，避免重复生成数据：

1. 在真实请求进程中记录 `dataProfile`、canonical `dbPath`、数据库 realpath/dev/inode，以及 seed 进程对应值，确认请求打开同一文件。
2. 在 `asPublicReadError` 归一化前，以不泄漏到 HTTP DTO 的本地诊断收据记录首个内部错误码/断言阶段，区分 root drift、ledger/profile/path、行数、stored payload 与 Repository DTO 断言。
3. 核对启动顺序为 migration → seed → readiness → serve，并确认请求期间没有 DB 重建、sidecar 清理、旧连接或跨 profile 进程。
4. 核对真实 Next 构建实际包含的 `public-synthetic.ts`、`repository.ts`、`runtime.ts` 与任务窗口冻结 SHA，排除 `.next`/热更新/旧 server chunk 漂移。
5. 对 feed、有效详情、合法未知详情复用同一 DB 身份收据；未知详情预期在发布图完整时返回 404，不应因一次请求后的全局状态变化转为 500。

## 7. 已验证

- 一次 canonical 隔离 migration/seed；一次完成的聚焦完整性核验。
- migration/seed receipt、SQLite 运行参数、profile/path、四 root、ledger、manifest、fixture graph。
- 12 条 projection 和完整发布链；Source、Content、Summary、Media、Bundle、Decision、Publication 的身份、状态、hash 与 fence。
- Repository feed=12、一个有效详情和一个合法未知详情；无外连、无 Base 写入、无真实内容导入。
- 关闭数据库后任务目录内无 WAL/SHM/journal；任务结束前已删除整个任务专属 `/tmp` 目录并复核不存在。

## 8. 未验证

- 按任务边界未启动网站或真实 Next/HTTP 进程，未复现上游 500 的进程内原始异常、数据库 inode 或构建 chunk。
- 未运行全量测试、build、lint、typecheck、浏览器或网络级 no-egress 审计。
- 本轮只对一个有效详情直接检查 related；12 条 feed 及其底层数据均已验证，12/12 detail/related HTTP 矩阵未重复执行。
- 未判断真实 HTTP 失败是否已被其他并发候选修订消除；该判断由开发部后续正式窗口完成。

## 9. 错题自检

- 首次聚焦脚本启动使用 Node strip-only，业务模块加载前因 TypeScript 参数属性不受支持而退出；此时脚本尚未打开数据库、执行断言或写收据。随后使用同一固定 Node 的 `--experimental-transform-types` 完成唯一一次实际业务核验。该准备错误没有产生第二次 seed，也没有改变工作区或 SQLite。
- 未把测试部既有 500 直接归因给数据，也未把本轮 isolated PASS 推断成真实 HTTP 已恢复。
- 未修改 app/data/config/Spec/ADR，未启动网站，未把 `/tmp` 收据作为长期项目产物。
- 当前不确定项是上游真实进程的首个内部异常；报告已明确交给开发部，不使用猜测替代证据。

TASK_STATE_OK
