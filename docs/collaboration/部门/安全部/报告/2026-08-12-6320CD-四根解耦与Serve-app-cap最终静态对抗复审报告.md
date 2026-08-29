---
type: audit_report
department: 安全部
target: "TASK-20260812-6320CD / F3FA8B + B5FA49 composite candidate"
status: final
date: 2026-08-12
related_task: TASK-20260812-6320CD
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
review_mode: static_read_only_fail_fast
tags: [deployment-v3, existing-only, four-roots, tailscale-app-cap, release-gate]
summary: "FAIL；P0=0/P1=1/P2=0。组合候选的当前文件SHA与F3FA8B非重叠项及后继B5FA49重叠项匹配，但Admin prepare把同一环境同时提供的reviewDatabasePath与dev/ino作为完整选择依据，仅约束绝对路径、固定basename和现有owner-private inode；任意另一同名私库及其自洽dev/ino可被写入v3 manifest，未固定accepted合同的首版唯一reviewDatabasePath。四根合同OPEN；按首P1停审，Serve app-cap合同保持UNKNOWN且未宣告CLOSED。禁止新build/release、M1 fresh stage、prepare、load与cutover。"
---

# 四根解耦与 Serve app-cap 两项候选最终静态对抗复审报告

## 1. 最终裁定

**FAIL；P0=0，P1=1，P2=0。**

首个 P1 出现在 Admin `reviewDatabasePath` 的部署输入锚定层。根据任务的 fail-fast 边界，本报告在该 finding 成立后停止扩展；未继续裁定 public rollback/data-root 事务、raw-header parser、三元 session、release overlay 等后续层。

两个 accepted 合同的闭合状态：

| accepted 合同 | 本轮状态 | 理由 |
|---|---|---|
| `ADR-M5-REAL-PROJECTION-RUNTIME-003` 四根解耦 | **OPEN** | 首版唯一 review DB 路径仍可被同一部署环境中的任意同名绝对路径及其自洽 dev/ino 替换。 |
| `ADR-M5-ADMIN-PRIVATE-IDENTITY-002` Serve app-cap 身份 | **UNKNOWN / 未宣告 CLOSED** | SHA 门已核对；按首 P1 停审，raw header、JSON 闭集、login/sourceRef 交叉和 session 重放没有完成直接代码裁定。 |

本轮没有执行测试、typecheck、build、verifier、installer、网络、SSH、数据库、tailnet、服务或目标机操作；唯一业务写入是本安全报告。

## 2. 输入与 SHA 门

### 2.1 已全文回读

- `docs/collaboration/tasks/TASK-20260812-6320CD.json`
- `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md`
- `docs/decisions/system/2026-08-12-F1+1-Tailscale-Serve-app-cap私有入口身份-successor-accepted.md`
- `docs/collaboration/部门/开发部/报告/2026-08-12-3CDDF8-F3FA8B-四根解耦deployment-v3与existing-only私库实现报告.md`
- `docs/collaboration/部门/开发部/报告/2026-08-12-B5FA49-Serve-app-cap身份parser与deployment-v3实现报告.md`

### 2.2 组合候选 SHA-256

B5FA49 是 F3FA8B 之后的身份 successor，覆盖其重叠运行文件；下表以 B5FA49 的后继 SHA 绑定重叠项，以 F3FA8B SHA 绑定非重叠项。当前字节均与对应报告匹配。

| 文件 | 当前独立实算 SHA-256 | 绑定来源 | 结果 |
|---|---|---|---|
| `app/src/server/admin-service/deployment.ts` | `378595f3480f29f6e531846a26e8b64b7924b4cfeaa81ebbc9e18a04acd468e7` | B5FA49 | MATCH |
| `app/src/server/admin-service/server.ts` | `65ba5e7a847d5ac2c113d6a85a9504a7530b0f942af915662cd49cbb7072ea83` | B5FA49 | MATCH |
| `app/src/server/admin-service/runtime.ts` | `77c7594bc6fea3a60455d370ef7e3cea25883e6bcb08ad83a88431fab8839abd` | B5FA49 | MATCH |
| `app/src/server/db/database.ts` | `2aab55cc0bd9b83b312e6a1492c4680541c05a2f159f4eaa72941b6d3d7adc57` | F3FA8B | MATCH |
| `app/src/server/review-real/migration.ts` | `149e7e143640be5be7fbe21202c3705709d371b165e3e9a281c45890fc431004` | F3FA8B | MATCH |
| `app/scripts/admin-install-macos.ts` | `0b020fa445e2f327ff3fa78d70aeecb522c330c7fa501f04f7a703f5307312eb` | B5FA49 | MATCH |
| `app/scripts/admin-service.ts` | `51e5e1ccc2e94ff00554819b7555b17bcc0991ffd1c1ca17bb793c2be6990ea4` | B5FA49 | MATCH |
| `app/scripts/projection-sender.ts` | `03387aedfceccd8b5ea5d96e99e95d84f4ef21dbf700c7de4b04c87b6d631e` | F3FA8B | MATCH |
| `app/src/server/public/deployment.ts` | `d126d60c09d79ce26baf03a93e1cc93f17d308df221c264d61fb7b46c5f5d05e` | F3FA8B | MATCH |
| `app/scripts/install-macos-public-beta-core.ts` | `2039c6e25de03721739bb81d030467fd67f10c00d506a6d2b21355eec4902a20` | F3FA8B | MATCH |
| `app/src/server/admin-service/release-manifest.ts` | `4e452f503f3cb1a71798d45ed2d5c558c8da5cfa440409d14eabf9265e0eee05` | F3FA8B/B5FA49 | MATCH |
| `app/src/tests/admin-service.test.ts` | `a2ef392beb93c1a49fad506f426ee2f9e18a7ea89c166591e094fa01e9ce0bb9` | B5FA49 | MATCH |
| `app/src/tests/public-install-release.test.ts` | `e389aab3ffc06a14ec38d1bf696c01296c64c1b83ffd8628e067e721cf167807` | F3FA8B | MATCH |
| `app/src/tests/admin-release-manifest.test.ts` | `51efeec218dcdfc6c41f7a214f04f833ddba486be8fd8dba70c7428ad6515ede` | F3FA8B | MATCH |
| `app/ADMIN-SERVICE-PREP.md` | `ab98e03b90ae4d87f2bfb508fea18dcdf2ac6d78167e52fde35ad2cac9226582` | B5FA49 | MATCH |

输入文档 SHA：

| 对象 | SHA-256 |
|---|---|
| 四根 accepted ADR | `267229eaf2ae2c2126dc1c793ad1836ff551434c225f304508041c6e5f427391` |
| Serve app-cap accepted ADR | `9514d2c9de10821dc12e1ec4035dd0825d2ed6eddc4508831985ed7a6acf6246` |
| F3FA8B 开发报告 | `3486d20b81358a7f1453117309cf80bc746d280f05c29285164a82e830e0e924` |
| B5FA49 开发报告 | `aef8ea9a932cdcca717a9326cfca8ee511b8f7eee76ea544372d7a60609d1bb1` |

SHA 门结论：**MATCH**。该结论只证明本报告裁定的代码身份，没有抵消下述语义 P1。

## 3. P1 finding

### P1-01：Admin prepare 对首版唯一 review DB 缺少独立路径锚，可固化任意第二绝对路径

#### Accepted 合同

四根 ADR 固定首版唯一：

```text
[M1-HOME]/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite
```

同一 ADR 要求 Admin runtime 与 sender 只从 canonical manifest 取得这一路径，禁止环境覆写、第二 path、缺失创建或请求级选择。该唯一性用于保证现有 RSS collector 与唯一 Admin writer 观察同一私库。

#### 当前实现

`app/scripts/admin-install-macos.ts:89-94` 同时从当前进程环境读取：

- `F1_ADMIN_REVIEW_DATABASE_PATH`
- `F1_ADMIN_REVIEW_DATABASE_DEV`
- `F1_ADMIN_REVIEW_DATABASE_INO`

`app/src/server/admin-service/deployment.ts:357-372` 只要求：

1. path canonical absolute；
2. dev/ino 为安全整数；
3. 该 path 当前 inspect 得到的 dev/ino 与同一调用所给 dev/ino 相等。

`app/src/server/db/database.ts:284-346` 对候选执行了有价值的 existing-only 保护：固定 basename、父目录 realpath、owner/private、single-link、`O_NOFOLLOW|O_RDWR`、前后 inode/目录身份一致，且没有 `O_CREAT`。这些谓词能拒绝 missing-create、直接 symlink 和检查窗口内的身份漂移，但没有证明候选就是 accepted 合同固定的唯一路径。

因此，另一目录中只要存在同名、当前 UID、owner-private、single-link 的 SQLite 文件，部署者把该路径及其实际 dev/ino 一并放入环境即可通过 prepare，并被写入 `admin-service-deployment-v3` manifest。后续 Admin runtime 与 sender忠实读取同一 manifest，反而会共同使用这条第二 path；现有 RSS collector 仍可继续写 accepted 合同中的原路径。

#### 影响

- 可能把 migration、人工审核、发布 outbox 和 sender 查询导向另一私库；
- 现有 RSS collector 与 Admin writer 可形成路径/数据分叉；
- `dev/ino` 收据只证明“所选文件没有在检查中漂移”，无法证明“所选文件是首版唯一真值”；
- v3 canonical manifest 会把错误选择持久化，后续同 manifest 一致性无法纠正根选择错误。

该风险可由部署环境误配或受控部署入口内的参数替换触发。它违反首版明确固定路径及“禁止第二 path”的 accepted 合同，等级为 **P1**。

## 4. 唯一最小 successor

在 `app/scripts/admin-install-macos.ts` 的任何文件 inspection 或 deployment 写入前，加入独立于环境输入的首版 canonical path 规则：

1. 代码中的首版 M1 生产路径固定为 `[M1-HOME]/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite`；也可由任务冻结、只读且先验验签的 deployment receipt 提供，但该 receipt 必须在本次环境参数之外生成并绑定 exact path。
2. 删除 `F1_ADMIN_REVIEW_DATABASE_PATH` 的选择能力，或要求其 canonical 值与上述固定值逐字相等；失配应返回一个稳定通用错误。
3. 继续复用现有 `lstat/realpath/O_NOFOLLOW/fstat/uid/mode/nlink/dev/ino` 谓词；dev/ino 只能作为固定路径的身份收据，不能参与选择路径。
4. successor 的机械边界只需覆盖两个出口：固定路径 + 正确 dev/ino 可进入 prepared-disabled；另一 owner-private 同名 DB + 自洽 dev/ino 必须在创建 `Admin dataRoot`、manifest、plist、bootstrap、session key 或日志之前失败，目标工件计数保持 0。

该 successor 只修正根选择锚，不需要改数据库 schema、审核业务、Serve parser、session、public installer或 release manifest。

## 5. 分层放行

| 层级 | 裁定 | 原因 |
|---|---|---|
| 当前组合源码身份 | **已绑定，未安全放行** | SHA 匹配；P1-01 仍 OPEN。 |
| 新 build / release manifest | **不放行** | 任务明确要求 P0/P1=0；当前 P1=1。 |
| M1 fresh stage | **不放行** | 同上；不得把含开放 P1 的候选推进到目标机。 |
| public/Admin prepare-only | **不放行** | 任意第二 review DB path 可在 Admin prepare 中固化。 |
| receiver/Admin load、sender、迁移、真实投影 | **不放行** | 上游 prepare 身份未闭合，且运行层未复审。 |
| public read-mode / cutover | **不放行** | 本任务始终无该授权；后续层仍 Unknown。 |

## 6. 按 fail-fast 保持 Unknown 的层

- public `syntheticRollbackAppRoot` 的任意绝对路径、外部 anchor 独立性、target/rollback/data-root 全闭包分离；
- public prepare 失败时 live 零写与提交中断逐字恢复的当前组合候选；
- deployment v1/v2 全入口写前拒绝；
- Admin HTTP 与 sender 对同一 manifest 的全部调用路径；
- raw `Tailscale-User-Login` / `Tailscale-App-Capabilities` 的重复、Node 合并、UTF-8 byte 上限、JSON prototype、未知字段和 legacy X 头；
- login/sourceRef 交叉匹配、operator/tailnet-user/device 三元 challenge/session/fresh 绑定与跨 ref 重放；
- 89 项 runtime 与 successor overlay、后续新 `.next` production 闭包。

以上项目没有被开发报告或已有测试收据替代为安全 PASS。

## 7. 自审与未确定项

- Finding 直接绑定 accepted ADR 的固定值和当前生产代码，结论置信度高；未依赖开发报告的行为转述。
- 已将 F3FA8B 与后继 B5FA49 的重叠 SHA 明确分层，避免把前置报告旧 SHA 漂移误判成候选漂移。
- existing-only opener 的 no-create/no-follow/identity 谓词只作为局部正面证据；本报告没有据此扩大为四根合同 CLOSED。
- 按任务要求在首个 P1 后停止，没有推测 Serve app-cap 或剩余部署层通过。
- 没有运行任何动态验证，也没有修改候选代码、accepted ADR、Spec、生产配置或外部状态。

TASK_STATE_OK
