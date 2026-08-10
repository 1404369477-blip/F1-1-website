# F1+1 当前施工断点（M5 post-clean）

> 本文件记录 Apple M5 / macOS 26.6 目标机终验与清理后的续接真值。产品合同仍以 `docs/spec.md` 和 accepted ADR 为准；任务所有权与状态只以 `docs/collaboration/tasks/TASK-*.json` 为准。

## 1. 一句话状态

新 Mac 迁移、经用户授权的精确清理和 post-clean 独立终验已经完成；项目回到 M4 本地施工。开发部已完成 VS-0 两项 P1 的本地整改并等待统筹核收与独立安全复验，安全部正在形成 VS-1 session/CSRF 合同候选。VS-0 最新独立安全结论仍为 FAIL，R5 用户门禁与 R12 no-egress 均未关闭，真实外部能力继续 closed。

## 2. 当前真值顺序

1. `docs/spec.md`
2. `docs/decisions/system/` 下 accepted ADR
3. `docs/collaboration/tasks/<TASK>.json`
4. 当前部门交接班文档与正式报告
5. `docs/progress.md`
6. 本文件及其他迁移说明

迁移终验和清理成功只证明项目在目标机可继续，不改变产品范围、任务状态、安全结论或用户授权。

## 3. 目标机与 post-clean 终验

- 目标机：Apple M5、arm64、macOS 26.6（Build 25G72）。
- Git：分支 `main`，HEAD `a9691e71b1552592cc5ded8d5db66c336262301c`，remote 为空；dirty worktree 是项目真实状态，禁止用 reset/checkout/clean 清理。
- 项目运行层：Node `24.18.0`、npm `11.16.0`、SQLite `3.53.1`；`app/node_modules/`、精确 Node 工具链和两份 SQLite 均保留。
- 已 ACK 的测试终验 `TASK-20260802-574A6D`：`decision=pass`、P0=0、P1=0；测试报告记录当时 `TASK_DOCTOR_OK | tasks=93 | full_history_validated=true`。
- 9/9 个 Codex 任务已经通过 `list_threads/read_thread` 在应用层与磁盘侧核对，主任务和八个部门任务都指向当前项目目录。
- 两份 SQLite 均以只读方式通过 `integrity_check=ok`，保持 WAL、39 列、59 行且 59 行 `enabled=0`；该结果没有开放真实 provider 或外部采集。
- post-clean 完整检查收据覆盖 Node24、Vitest 32/32、lint、typecheck、build 和 task doctor；后续开发任务已形成自己的完成收据，但仍需统筹核收和后继独立安全复验。

权威终验报告：`docs/collaboration/部门/测试部/报告/2026-08-02-新Mac迁移完整复验与清理后回归报告.md`。

## 4. 已删除与保留边界

### 清理后持续不存在

- `migration/bundles/`
- `migration/manifests/`
- `migration/portable-assets/`
- `migration/scripts/`
- `app/.local/toolchains/downloads/`
- literal TMPDIR Node compile cache
- `.obsidian/plugins/obsidian-local-rest-api/data.json`
- Homebrew 旧 `simdjson`

项目清理释放约 `298.6 MiB`，Homebrew 清理释放约 `6.6 MB`。这些路径当前不存在；不得把其中的归档、manifest、vendored 资产或恢复/验证脚本描述为现存产物，也不得为本断点重新生成。

### 清理时删除、施工恢复后可重建

- `app/.next/`
- `app/node_modules/.vite/`
- `app/tsconfig.tsbuildinfo`
- 项目内的 `__pycache__`、`*.pyc`、`.DS_Store`

post-clean 终验时这些可重建缓存已删除；当前只读检查已观察到 `.next`、Vitest cache 和 `tsconfig.tsbuildinfo` 因开发恢复而再次存在。它们不是迁移归档、manifest、portable assets 或恢复脚本，也不能据此否定清理收据。本统筹任务没有创建、删除或修改这些缓存。

### 明确保留

- `app/node_modules/`
- `app/.local/toolchains/node-v24.18.0-darwin-arm64/`
- `app/.local/f1plus1.sqlite`
- `app/.local/vs0-acceptance.sqlite`
- `.git/` 与当前 dirty worktree
- `docs/`、任务 JSON、部门报告与协作协议
- 本目录中的迁移说明、交接材料和 `migration/conversations/`
- `.obsidian/plugins/obsidian-local-rest-api/` 插件本体、`.obsidian/community-plugins.json` 启用记录及根 `.gitignore` 的精确忽略规则

旧 Local REST 凭证处置的时态必须分开：安全部 `TASK-20260802-026EC3` 是删除前只读审查，结论为 `fail`；用户随后满足门禁并授权精确删除，最终删除结果由测试部 post-clean `pass` 复验闭环。任何文档都不得写出旧凭证值，也不得把插件本体误列为已删除。

## 5. 历史迁移证据（对应文件已经删除）

以下 hash 只保留为历史验证收据，不能作为当前可下载、可解包或可执行文件的入口：

| 历史对象 | SHA-256 / 结果 |
| --- | --- |
| portable tar | `5bff483c6fc042db6f74b10e8c3daf8edced8398caaa53b18f1db657ed92aa5a`；3700 members |
| warm tar | `ddd54f1117eac6b03e3d5f9b1f149bc18aab702b3dfe58862be92106729cc14e`；29157 members |
| 历史 `migration/bundles/SHA256SUMS` | `b9f5614b311f5fc433a683e1515b2ee8933e68605530e566be741441c4b628cd` |
| 当前对话校验清单 | `migration/conversations/SHA256SUMS`，SHA-256 `40481017e7d5ea6b7330a210e4c3ecb7cd13e42316cec14629e310e33fcf1797`，10/10 通过 |

归档在删除前已完成外层 hash、隔离解包、symlink 边界和 Node24 完整检查；删除动作发生在目标机迁移已完成且用户授权之后。当前恢复依赖目标机上的现存项目、Git、任务真值、报告和对话保留材料，不依赖已删除归档。

## 6. 当前活动任务

### `TASK-20260802-7A9C48` — 开发部 `completed`，待统筹核收

范围只包括两项 VS-0 P1：

- 任意 `npm run dev/start -- <附加参数>` 必须非零拒绝，不能覆盖固定 `127.0.0.1:3000`；
- verify/migrate/seed/runtime 等 CLI 负例只能输出稳定 allowlist JSON，不能泄漏绝对路径、stack、源码行、URL 或 secret。

开发部已提交 `docs/collaboration/部门/开发部/报告/2026-08-02-M4-VS-0启动参数与CLI错误泄漏整改报告.md`，本地收据包含 Node24 完整 check、42/42 测试、6 组真实 npm argv 负例、4 组 CLI 泄漏负例、固定 `127.0.0.1:3000` health ready、重复 migration/seed 零漂移和 `externalCalls=0`。任务当前已 `completed`，但尚未统筹 ACK，也没有后继独立安全 PASS；开发部 PASS 不能改写 VS-0 最新独立安全 FAIL。

### `TASK-20260802-6F7563` — 安全部 `claimed`

范围只包括 VS-1 本地/loopback 管理 API 的 session、Origin/Host、CSRF、nonce、CORS、缓存、错误码和零写入失败语义候选。任务只能产出安全合同候选，不改 `app/`，不开放真实账号、外部端口或生产能力，也不等同于 VS-1 实现授权。

### `TASK-20260802-FFC67A` — 测试部 `claimed`

这是 `7A9C48` 的后继独立测试任务，正在只读复验启动 argv、CLI allowlist JSON、固定 loopback health、完整 check、重复 migrate/seed 与零漂移。测试部不得修改应用；即使测试 PASS，仍需另派安全部做后继独立安全复验，VS-0 当前继续 FAIL。

## 7. VS-0 断点与历史 hash

以下 hash 是迁移冻结点的历史对照，保留用于检查漂移；它们不证明当前任务已完成：

| 文件 | SHA-256 |
| --- | --- |
| `app/package.json` | `95e2e7403c612bd6dac7375c8444c43d920b1c7a34949d3c047a4413093d5ac2` |
| `app/package-lock.json` | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` |
| `app/scripts/serve.ts` | `ce42e19e707dc306abbcafe1cdec143abaddb1e989cda9524334652f069e787a` |
| `app/src/server/security/cli.ts` | `1126cca2471da18160b8d870bd4a1d030610324e5b0c1e1ccbf78e4c7ce42e85` |
| `app/src/server/security/log.ts` | `f69347a4d054cb4ce05f92bd333fba4b80b00dfe21108db110da12c7e41e4b00` |
| `app/src/tests/vs0.test.ts` | `96a8a69f61b997bf680ff95ec614aee758efa62ecaba19e3cc256753434bdeca` |

最新独立安全决策仍为 `FAIL`：P0=1（R5 同 UID TOCTOU 用户门禁）、两项 P1 已由 `7A9C48` 提交开发整改 PASS 但尚待独立安全确认、P2=3，R12 OS/系统调用级 no-egress 仍 pending。迁移、清理和开发自验都没有越过这些独立安全边界。

## 8. VS-1 候选边界

现有产品、数据、设计、安全和测试材料都属于候选、蓝图或测试计划。`6F7563` 完成后仍需统筹整合、确认字段与门禁，再决定是否派发正式实现；不得将候选写成已实施。

## 9. 飞书与所有真实外部能力

- M3 影子 Base 的既有历史收据保留：2 张表、3 个 grid、1 个未分享 form，主表 59 条影子记录均 `enabled=false`，手机捕获表 0 条。
- 目标机的飞书 OAuth/Keychain 按迁移合同未带入；重新登录后的 auth、scope、直接协作者和真实资源可读性未在本收口中验证。
- 真实 Base provider、Collector、X/Instagram/Reddit 抓取、AI 摘要、媒体抓取、公开发布、部署、付费和其他生产外部 I/O 全部保持 closed/Unknown。

## 10. 续做顺序

1. 统筹核验并核收已完成的 `7A9C48`；不得把开发自验扩展为独立结论。
2. 测试部完成已 claimed 的 `FFC67A` 独立回归。
3. 测试通过后另派安全部做后继独立安全复验；R5 用户门禁和 R12 pending 继续单列。
4. 用户单独决定 R5 同 UID 威胁模型；未确认前维持 VS-0 FAIL/closed。
5. 安全部完成 `6F7563` 候选后，由统筹整合 VS-1 产品/数据/设计/测试合同并识别用户门禁。
6. 只有获得正式任务与相应门禁后才进入 VS-1 实现；VS-2、VS-3 和真实外部能力继续后置。

## 11. 对话与交接保留

主任务、统筹、产品、研究、设计、数据、开发、安全和测试共 9 个 Codex 任务已同步；`migration/conversations/` 仍保留 9 份有效对话导出、索引与校验清单，10/10 hash 已通过。对话导出只作恢复证据，权威级低于 Spec、accepted ADR、任务 JSON 和正式报告。
