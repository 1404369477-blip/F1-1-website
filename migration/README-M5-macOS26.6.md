# F1+1 → Apple M5 / macOS 26.6 迁移终验与清理记录

## 1. 当前结论

F1+1 已从 Apple M1 / macOS 26.5.2 迁移到 Apple M5、arm64、macOS 26.6（Build 25G72）。迁移归档在删除前通过外层 hash、隔离解包、symlink 边界、项目 Node24 完整检查和目标机 post-clean 独立终验；随后按用户授权完成精确清理。

已 ACK 的测试任务 `TASK-20260802-574A6D` 最终为 `decision=pass`、P0=0、P1=0。该 PASS 只覆盖迁移完整性、目标机运行层、清理边界和任务/对话恢复，不代表 VS-0 安全、R5、R12、VS-1 或任何真实外部能力已放行。

## 2. 当前权威入口

项目已经位于目标机，当前不需要再次解包或运行迁移恢复脚本：

1. 先读 `docs/handoff.md` 和 `migration/CURRENT-HANDOFF.md`。
2. 产品与工程合同以 `docs/spec.md` 和 accepted ADR 为准。
3. 任务状态只认 `docs/collaboration/tasks/TASK-*.json`。
4. 进度与证据分别看 `docs/progress.md`、部门正式报告和 `migration/conversations/INDEX.md`。

辅助迁移文档可能保留冻结期上下文；与 post-clean 结论冲突时，以本文件、`CURRENT-HANDOFF.md`、任务 JSON 和已 ACK 终验报告为准。

## 3. 目标机终验证据

### 3.1 环境与项目基线

- 硬件/系统：Apple M5、arm64、macOS 26.6。
- Git：分支 `main`，HEAD `a9691e71b1552592cc5ded8d5db66c336262301c`，remote 为空；dirty worktree 是迁移并继续施工后的预期状态。
- 项目运行层：Node `24.18.0`、npm `11.16.0`、SQLite `3.53.1`。
- `app/node_modules/`、项目内精确 Node24 工具链、`app/.local/f1plus1.sqlite` 和 `app/.local/vs0-acceptance.sqlite` 均保留。
- 两份 SQLite 的只读 `integrity_check=ok`，保持 WAL、39 列、59 行且 59 行 `enabled=0`。
- post-clean 完整检查收据覆盖 Vitest 32/32、lint、typecheck、build 和 task doctor；测试部终验记录当时 `TASK_DOCTOR_OK | tasks=93 | full_history_validated=true`。

### 3.2 任务与对话

- 主任务、统筹、产品、研究、设计、数据、开发、安全和测试共 9 个 Codex 任务，已通过应用层 `list_threads/read_thread` 与磁盘映射核对为 9/9 可见。
- `migration/conversations/`、索引和校验清单保留；`migration/conversations/SHA256SUMS` 的文件 SHA-256 为 `40481017e7d5ea6b7330a210e4c3ecb7cd13e42316cec14629e310e33fcf1797`，内容校验 10/10 通过。
- 当前开发部 `TASK-20260802-7A9C48` 为 `completed`：开发报告以 Node24 完整 check、42/42 测试和真实子进程负例判定两项 P1 整改 PASS；任务仍待统筹核收和后继独立安全复验。
- 测试部后继 `TASK-20260802-FFC67A` 已为 `claimed`，正在对当前应用快照做独立回归；测试完成后仍需独立安全复验。
- 当前安全部 `TASK-20260802-6F7563` 为 `claimed`，只产出 VS-1 本地管理 API session/CSRF 安全合同候选。

## 4. 清理结果

### 4.1 清理后持续不存在

迁移终验通过并获得用户授权后，已删除：

- `migration/bundles/`
- `migration/manifests/`
- `migration/portable-assets/`
- `migration/scripts/`
- `app/.local/toolchains/downloads/`
- literal TMPDIR Node compile cache
- `.obsidian/plugins/obsidian-local-rest-api/data.json`
- Homebrew 旧 `simdjson`

项目目录释放约 `298.6 MiB`，Homebrew 清理释放约 `6.6 MB`。上述迁移归档、manifest、portable assets 和脚本当前不存在；本文仅保留历史收据，不提供也不暗示可执行入口。不得为本断点重建这些迁移产物。

### 4.2 清理时删除、施工恢复后可重建

post-clean 终验时还删除了 `app/.next/`、`app/node_modules/.vite/`、`app/tsconfig.tsbuildinfo` 及项目内的 `__pycache__`、`*.pyc`、`.DS_Store`。当前只读检查已观察到 `.next`、Vitest cache 和 `tsconfig.tsbuildinfo` 因开发恢复再次存在；它们属于可重建施工缓存，不属于已删除的迁移归档。本统筹收口没有重建或修改这些缓存。

### 4.3 已保留

- Git、dirty worktree、Spec、ADR、应用代码、数据、设计、研究、任务 JSON、部门报告和协作协议。
- `app/node_modules/`、精确 Node 24.18.0/npm 11.16.0 工具链、两份 SQLite。
- 本目录剩余的迁移说明、交接材料和 `migration/conversations/`。
- Obsidian Local REST 插件本体、`.obsidian/community-plugins.json` 启用记录和根 `.gitignore` 的精确忽略规则。

清理没有触及 Codex 登录状态、飞书 OAuth/token/Keychain、浏览器 profile、SSH/GPG、真实环境变量或其他外部资源；这些机器级能力和秘密仍由各自系统管理。

## 5. Local REST 旧凭证的时态

必须同时保留两段事实：

1. 安全部 `TASK-20260802-026EC3` 是删除前只读处置审查，`decision=fail`、P0=0、P1=2、P2=1；报告没有读取或输出 API key、私钥、证书等凭证值，也没有执行删除。
2. 用户随后确认删除前门禁并授权仅删除旧 `data.json`；统筹执行精确删除，测试部在 `TASK-20260802-574A6D` 的 post-clean 阶段复验文件已不存在、插件和忽略规则仍保留，最终迁移终验为 PASS。

后续如果用户需要 Local REST API，应由插件在本机按需生成新私有材料并重新配置客户端；新值继续只存在于受控秘密存储，不得写入仓库、任务 JSON、报告或普通日志。本收口没有验证重新生成后的客户端、证书信任或监听状态。

## 6. 历史归档收据

以下对象已经删除，hash 仅用于证明删除前验收历史；不能作为当前文件路径或恢复入口：

| 历史对象 | 删除前验证结果 |
| --- | --- |
| `F1+1-portable-M5-macOS26.6-20260802.tar.gz` | SHA-256 `5bff483c6fc042db6f74b10e8c3daf8edced8398caaa53b18f1db657ed92aa5a`；3700 members |
| `F1+1-warm-arm64-node24-M5-macOS26.6-20260802.tar.gz` | SHA-256 `ddd54f1117eac6b03e3d5f9b1f149bc18aab702b3dfe58862be92106729cc14e`；29157 members |
| 历史 `migration/bundles/SHA256SUMS` | SHA-256 `b9f5614b311f5fc433a683e1515b2ee8933e68605530e566be741441c4b628cd` |

删除前隔离复验使用归档副本完成 Node `24.18.0`、npm `11.16.0`、SQLite `3.53.1`、Vitest 32/32、lint、typecheck、build、task doctor、symlink 边界和排除项检查。该收据只证明归档当时可验证；归档删除后的当前项目可持续性由目标机 post-clean 终验、保留的运行层和现存 Git/任务真值承担。

## 7. VS-0 关键 checkpoint 历史

以下 hash 保留为迁移断点对照；任务已完成后的合法代码变更可能产生新 hash，历史值不代表当前代码或独立安全结论：

| 文件 | SHA-256 |
| --- | --- |
| `app/.node-version` / `app/.nvmrc` | `55075b5ec4e8b31936cbbc282b8829116d1fd48f2f2f1856dee592a6650700ce` |
| `app/package.json` | `95e2e7403c612bd6dac7375c8444c43d920b1c7a34949d3c047a4413093d5ac2` |
| `app/package-lock.json` | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` |
| `app/.npmrc` | `be7906950cc4de765c6933ebada746d495050d9a6b4b61ddf0d261d0a8c747b1` |
| `app/scripts/serve.ts` | `ce42e19e707dc306abbcafe1cdec143abaddb1e989cda9524334652f069e787a` |
| `app/src/server/security/cli.ts` | `1126cca2471da18160b8d870bd4a1d030610324e5b0c1e1ccbf78e4c7ce42e85` |
| `app/src/server/security/log.ts` | `f69347a4d054cb4ce05f92bd333fba4b80b00dfe21108db110da12c7e41e4b00` |
| `app/src/tests/vs0.test.ts` | `96a8a69f61b997bf680ff95ec614aee758efa62ecaba19e3cc256753434bdeca` |

后续开发会合法改变其中部分文件；届时以任务产出、开发验证和独立复验收据解释 hash 变化，不能把迁移冻结 hash 当作不可修改合同。

## 8. 当前安全与业务门禁

- 最新 VS-0 独立安全结论仍为 `FAIL`。
- R5 同 UID TOCTOU 威胁模型需要用户单独决定；未确认前保持 closed。
- R12 OS/系统调用级 no-egress 仍 pending。
- `TASK-20260802-7A9C48` 已提交两项 P1 的开发完成收据；该任务 PASS 仍不能替代统筹核收、后继独立安全复验、R5 用户门禁或 R12 验证。
- `TASK-20260802-FFC67A` 只负责独立测试回归；即使未来 PASS，也不能代替安全部对两项 P1 和残余风险的独立复验。
- `TASK-20260802-6F7563` 只形成候选合同；候选不等于实现、产品决策或用户放行。
- 飞书重新登录后的 auth、scope、Base ACL/资源可读性尚未在本次收口中验证。
- 真实 Base/provider/Collector、X/Instagram/Reddit 等平台采集、AI 摘要、媒体处理、公开发布、部署、付费和其他真实外部 I/O 全部继续 closed/Unknown。

## 9. 剩余不确定性

- 测试部因本机 `sysmond service not found` 无法独立复现进程列表；统筹删除前确认无 Obsidian 进程、目标句柄及 27123/27124 监听，测试部未取得相反证据，因此保留为 P2 环境可见性 Unknown。
- OAuth/Keychain 按迁移合同未带入；飞书真实 auth/资源能力需用户重新登录后另行验证和授权。
- Local REST 新凭证是否重生成、客户端是否重新配置、证书是否受信以及实际监听状态均未验证。
- 已完成开发任务和在办安全任务的最终项目结论仍以任务 JSON、统筹核收与必要独立审核为准。

## 10. 续做入口

无需恢复迁移包。直接从现存项目续做：

1. 统筹核验并核收已完成的 `TASK-20260802-7A9C48`。
2. 测试部完成已 claimed 的 `TASK-20260802-FFC67A` 独立回归。
3. 测试通过后另派安全部复验两项 P1；R5 用户门禁与 R12 pending 继续单列。
4. 安全部按 `TASK-20260802-6F7563` 完成 VS-1 session/CSRF 候选合同。
5. 统筹整合 VS-1 候选并识别用户确认点；未获正式任务前不进入实现。
