# 交接文档

> 用途：换设备、隔了一段时间回来或交给其他会话续做时，先读本文件，再以 `docs/spec.md`、accepted ADR 和任务 JSON 为准。

## 当前状态快照

- **信源管理修复后复验（2026-08-10 12:29）**：开发 `875B6C` 已 ACK。测试最终后继 `TASK-20260810-92C716` 已以 `PASS / P0=0 / P1=0 / P2=0` 完成并由统筹 ACK：closed DB 副本 integrity=ok，Repository 精确为59 baseline+1 `local_synthetic`，本地项为 retired/stopped/disabled，AdminSessionStore create/get/destroy 与销毁后401语义通过；本轮没有重开 server，最终结论组合 A3293F 同候选真实 HTTP、进程内 Store 与 `http.ts` 静态映射，不能外推真实 provider、Admin UI 或部署。安全 `70EC0F` 与后继 `AD6AD9` 均因安全 harness 自身首错 blocked，未建立产品缺陷：前者误把 `cpSync.mode` 当文件权限，后者把弱权限副本已经正确 fail-closed 的 `DB_PATH` 过度限定为 `DB_PERMISSIONS`。正式 DB SHA 始终为 `ddf3778c…e939`，未启动 server/readiness/fixture、`externalCalls=0`、零残留；错误 basename、SQLite/profile/audit 内容根与第二 writer 出口仍 `NOT_RUN`。下一安全后继只允许复用已证明的弱权限拒绝，并单次运行剩余出口，禁止重复 raw/session/CSRF/identity/no-egress 与完整 HTTP 矩阵。
- **信源管理页面架构（2026-08-10 01:20）**：产品 `TASK-20260810-8A055D` 已完成并由统筹 ACK，唯一 proposed 候选为 B：一个 Node 进程、一个 source profile、一个 SQLite writer、一个 exact-loopback raw listener；raw gate 先行，同一请求随后进入同进程 Next production handler，`/admin/sources`、Admin API、health 与 closed hashed assets 同源。候选合同 SHA `7d7bf37f…a6681`、产品报告 SHA `664ef910…c135`。禁止 sidecar、第二进程/端口/writer、静态假数据页、孤立 Next page 与 raw gate 绕过。页面/CSS/运行接线仍关闭，直到 `91AF6E` 与同候选独立测试/安全闭环，并获得用户对 v2 视觉 manifest 的精确确认。
- **信源管理后端（2026-08-10 07:58）**：开发 `TASK-20260810-91AF6E` 已完成并由统筹 ACK。三文件精确 SHA 与冻结值一致；固定 Node24 typecheck、production build、唯一 `127.0.0.1:3019` HTTP、session/CSRF、59 baseline + 1 local overlay、list/add/validate/activate/stop/retire、operation、response-loss replay、closed receipt与candidate/protected内容前后比对均 PASS，`externalCalls=0`。closed DB SHA=`ddf3778c…e939`，logical root=`7cae9bb8…e6a`；PID/端口/profile lock/WAL/SHM/tmp均已清理。开发[报告](collaboration/部门/开发部/报告/2026-08-10-91AF6E五项Node24静态类型收敛与SOURCE-MGMT启动闭环报告.md) SHA=`65d2ea23…9374`，[manifest](../app/evidence/TASK-20260810-91AF6E/manifest.json) SHA=`7b0658d9…87b3`。原测试 `2467B0` 与安全 `59C88E` 仍绑定 blocked `F1466E`，不得领取；精确 successor 测试 `TASK-20260810-37CA8F` 与安全 `TASK-20260810-A5F239` 已派入既有正式窗口，等待同候选独立 `P0=0/P1=0` 后再评估后端完整核收。
- **早期公开页复验时态（2026-08-10 01:00）**：已恢复的安全 `TASK-20260809-22EC6D` 与设计 `TASK-20260809-379161` 都发现当前五实现文件相对 `TASK-20260809-34476E` 旧快照全量 SHA 漂移；两部门均未启动服务、浏览器或新采样。安全任务以 `FAIL / SNAPSHOT_DRIFT / P0=0 / P1=1 / P2=0` 完成并由统筹 ACK；设计任务按失败路径 blocked。旧34476E六图、运行收据、lightbox焦点和React #418结论只属于旧快照，不能证明当前F67080候选。恢复出口是固定M1普通Terminal下的同SHA浏览器矩阵，再创建或恢复绑定新候选的设计/安全复验；不授权379161只审历史快照。
- **当前最短关键路径（2026-08-09 22:38）**：测试任务 `TASK-20260809-47EF67` 已按 `ENVIRONMENT BLOCKED` 收口；Codex 宿主中的 `sandbox-exec` 在 App/浏览器启动前返回 `sandbox_apply: Operation not permitted`（exit 71），所以浏览器矩阵次数仍为 0、五个 Function 全部 `NOT_RUN`，候选没有被判成功或失败。安全后继 `TASK-20260809-43AE8C` 已完成并 ACK，唯一推荐路径是在固定 M1 的普通 Terminal 以当前用户执行冻结 runner：先做不启动 App/浏览器的双 Seatbelt Phase 0，只有两份 profile apply 与精确 loopback 正/负例全通过才进入唯一一次功能矩阵。该后继仍需用户一次精确确认；禁止 `sudo`、安装、下载、外网、候选修改、系统 Chrome与无 Seatbelt 降级。
- **信源管理**：产品 v0.3（SHA `90ee4ed…b2f1fe`）和安全复验均已 ACK，合同层 `P0=0/P1=0/P2=0`；开发可行性勘察也已核收。`/admin/sources` 候选已生成四图和交互 HTML；设计部同一正式窗口后来恢复并完成诚实收口，任务 `TASK-20260809-08CCEF` 已 ACK。现行 [统筹冻结 manifest v2](collaboration/部门/统筹部/报告/2026-08-09-SOURCE-MGMT-001视觉候选统筹冻结manifest.json) 绑定当前候选、SHA 清单、报告、v0.3 和安全复验，[用户确认入口](collaboration/部门/统筹部/报告/2026-08-09-SOURCE-MGMT-001视觉候选恢复冻结与用户确认入口.md) 已同步；四张 PNG 仍是最后一次结构修订前参考图，正式实现必须独立关闭 sticky actions、键盘横滚和 390 无横溢的运行 `Unknown`。用户确认前不派正式实现。
- **人工审核台**：`/admin/reviews` 的 [产品合同](spec/F1+1-M5最小人工审核台纵切产品合同-v0.1.md)、111 槽位机器映射和 approve→唯一 queued Publication→显式 manual publish 时序已核收；[交互候选](../design/ui/F1+1-M5-admin-reviews-preview-v0.1/index.html) 任务 `69BC5A` 已 ACK。产品后端先行裁决 `TASK-20260809-DCEFF8` 已 ACK，唯一结论 B：现行合同同时保留 `ADMIN-DECISION` 与 `ADMIN-VISUAL`，`review-synthetic` 第三物理 SQLite profile successor 仍是 `draft / user_required`，所以当前不得派 SQLite/API/session/CSRF/worker 或 UI 实现。后端唯一解锁问题是用户是否批准纯本地 loopback、manual-only、`external_calls=0` 的第三 profile 与 Admin 后端；获批后还须先形成 accepted successor，且 UI/CSS/client 继续等待视觉确认。后继 `133584` 的 8 图包因当前宿主渲染能力阻断，没有改候选；现有交互 HTML 仍可直接判断方向。正式运行证据均未实现。
- **固定 M1 Mac**：TEMP-LOCAL v0.5 的 [精确执行 runbook](runbooks/F1+1-固定M1-Mac-TEMP-LOCAL精确执行runbook-v0.5.md)、[closed manifest](runbooks/F1+1-固定M1-Mac-TEMP-LOCAL精确执行runbook-v0.5.manifest.json) 与 [Codex/DeepSeek 交接提示词](runbooks/F1+1-固定M1-Mac-TEMP-LOCAL执行交接提示词-v0.5.md) 已完成并 ACK。该包仍为 `WAIT_47EF67`，且 `47EF67` 已环境 `BLOCKED`，所以旧包不能运行。现行后继依据为 [最小替代执行面安全裁决](collaboration/部门/安全部/报告/2026-08-09-47EF67环境阻断后最小替代执行面安全裁决.md)：获得用户精确确认后，测试部先生成冻结 runner，再由用户在固定 M1 普通 Terminal 运行 Phase 0；只有 Phase 0 通过才进入一次 loopback/synthetic 浏览器矩阵。旧 WPA 不因此开放远程、网络变更、真实数据或生产。
- **阶段**：M5 本地 Build Loop；`public-synthetic` 公开链与第三个 `public-multimedia-synthetic` 后端 profile 均已有正式完成和独立证据。多媒体后端 `DEV-MM-01..03` 已通过门禁，公开页 `DEV-MM-04` 仍等待用户视觉确认；任何后端 PASS 都不能外推为公开页面完成。
- **目标机**：Apple M5、arm64、macOS 26.6；迁移及经用户授权的精确清理完成后，独立终验已通过，P0=0、P1=0。
- **公开前端**：原开发任务 `TASK-20260802-C29BB8` 与后继 P1 整改 `TASK-20260803-CD4228` 均已由统筹 `acknowledged`；整改后精确快照的独立测试 `TASK-20260803-5991EE` 和设计核验 `TASK-20260803-8C9709` 均为 `PASS / P0=0 / P1=0 / P2=2` 且已由统筹 `acknowledged`。该 PASS 覆盖固定 Node24、51/51、390/1440 深浅主题、四项原 P1、44px、共享 Shell、HTTP/console/零外部资源；AT 实机、原生 200% 缩放、真实 forced-colors 与 public-demo+SQLite/API 接线后的新 SHA 快照仍须复验。
- **启动安全**：原安全任务 `TASK-20260802-68F43E` 的 `FAIL / P0=0 / P1=1` 历史保留；后继开发 `TASK-20260802-3760F6` 已完成受控 Next 子进程输出与信号清理。测试 `TASK-20260804-9F2DAD` 为启动 `PASS / P0=0 / P1=0 / P2=0`；安全任务 `TASK-20260804-B9D885` 后续发现的 `NODE_ENV=test` 数据库覆盖 P1 已由 `TASK-20260804-A01DF7` 关闭，并经 `TASK-20260804-A1A095` 真实 CLI 复验通过。相关任务均已 ACK；R5/R12 与整体生产放行仍不随之开放。
- **公开后端前置**：用户已确认 U1/U2；[ADR-M4-PUBLIC-READ-001](decisions/system/2026-08-03-F1+1-公开读模型与API接线-v0.4-successor-accepted.md) 已冻结双 profile/SQLite、最小 `mvp-local-v0.4`、12 个 `public-demo-*`、projection-first feed/detail DTO/cursor/Problem、迁移/回退与失败关闭。首轮数据安全/测试 FAIL 历史保留；数据整改 `TASK-20260803-D53BF3`、安全复验 `TASK-20260804-0AEACE`、测试复验 `TASK-20260804-00972D` 均已 ACK。双 profile migration/seed/四 root pin 的 `TASK-20260804-253A43` 及其测试/安全整改闭包也已 ACK。
- **多媒体后端**：数据 `TASK-20260809-385B52`、开发 `TASK-20260809-BA9999`、安全 `TASK-20260809-4A5381`、测试 `TASK-20260809-B98C66` 均已 `acknowledged`。已验证独立 SQLite、exact migration、原子 0/1/4 图 seed、5 个 synthetic media、Repository、默认 V1/精确 V2 API、406/500/no-store 和旧 profile 零漂移；结论限 `DEV-MM-01..03`，`externalCalls=0/realMedia=0/writesToBase=false`。
- **最新产品状态同步（2026-08-09）**：产品 `TASK-20260809-DE4B65` 已由统筹 ACK，多媒体状态同步只解除产品文档旧时态；`DEV-MM-04` 仍等待用户对运行中公开页候选的视觉确认。VS1 的 `COLLECT-MOCK-002`、`CONTENT-PROCESS-003`、`SUMMARY-MOCK-004` 已由开发 `D6114C/3A8C0E`、数据 `5A9316`、测试 `C66A73/9D61AD`、安全 `BCF8B1/D33AF3` 的 ACK 证据闭合为 `complete`，出口限固定 Node24、本地 synthetic operator 与 V-OP/25-case 收据。真实媒体/provider、飞书 Base、外部 AI、Admin 实现、OS 级 no-egress、部署和全部非 loopback 外部 I/O 继续 closed 或保持独立门禁。
- **多媒体 P2**：保留的 `app/.local/f1plus1-public-multimedia-synthetic.pre-update-20260809.sqlite` 不被精确 runtime 路径选中，但仍增加同故障域留存、备份和误取风险，须由后继数据保留策略处置；Turbopack NFT 对动态本地路径的 tracing warning 与最终部署包内容尚未验证，须留到另行获授权的部署打包门禁。
- **旧状态校正**：`795FB0` 已由任务工具取代为 `54BB47`；`3AF992` 已取代为已 ACK 的 `4451C2`。`C25855` 继续保留 `blocked`，因为它是更早 `16B34F` 的替代锚点，协议禁止再次收口以免历史链失效；其现行能力缺口已由 `F01A13` 的启动/脱敏/HTTP 后继证据覆盖，但生产部署、R5、R12 与真实外部能力仍未放行。
- **会话提示**：部门正式窗口已经登记；后续只续用现有窗口与当前 TASK JSON，不创建重复部门窗口，不重复领取已完成、已取代或由现会话 `claimed` 的任务。

## 目标机终验与清理真值

- 已 ACK 的测试终验 `TASK-20260802-574A6D` 结论为 `pass`：M5/macOS 26.6、Git 基线、项目 Node 24.18.0/npm 11.16.0、两份 SQLite、关键断点 hash、9/9 个 Codex 任务同步和清理后保留边界均通过；测试报告记录当时 `task doctor=93`。
- 清理共释放约 `298.6 MiB` 项目空间，另清理 Homebrew 旧 `simdjson` 约 `6.6 MB`。
- `migration/bundles/`、`migration/manifests/`、`migration/portable-assets/`、`migration/scripts/` 已按授权删除；相关归档、manifest、vendored 资产和恢复脚本只保留历史验证收据，不再是现存或可执行产物，也不得为本断点重建。
- 明确保留：`app/node_modules/`、项目内精确 Node 24 工具链、`app/.local/f1plus1.sqlite`、`app/.local/vs0-acceptance.sqlite`、`.git/`、任务/报告、迁移交接文档及 `migration/conversations/`。
- 旧机 Obsidian Local REST `data.json` 已在用户授权和删除前门禁满足后删除；插件代码、启用记录和精确 `.gitignore` 规则保留。安全部 `TASK-20260802-026EC3` 的 read-only `fail` 历史不覆写，后续删除结果由测试部 post-clean `pass` 收据闭环；未记录任何凭证值。

## 怎么把本地环境跑起来

项目以 `app/.local/toolchains/node-v24.18.0-darwin-arm64/` 中的精确 Node 24.18.0/npm 11.16.0 为已验证运行层，`app/node_modules/` 当前保留。执行命令前先读 `app/README.md` 和当前任务真值；不要使用已删除的迁移验证脚本，也不要把已核收的启动/SQLite 局部门禁扩张为 R5、R12、Repository/API、真实外部能力或生产放行。

- 本地跑公开站点（2026-08-07 已核收的早期 v0.2 实现）：在 `app/` 内按序 `npm run verify:env`、`npm run db:migrate`、`npm run seed:fixtures`、`npm run build`，再 `npm run start`，浏览器打开 `http://127.0.0.1:3000/` 与一条 `/stories/public-demo-*`（早期 v0.2 时间线界面，`public-synthetic` 数据）。`npm run check` 与 `npm run test:public-http` 为全量/真实 HTTP 验证命令；该 app 尚未落地 2026-08-08 冻结候选。
- 已知限制：`npm run dev` 因 Next 16 dev（Turbopack）向其 dev-server 子进程注入 `NODE_OPTIONS`，与应用 R1 fail-closed 拒绝冲突，dev 模式下公开 API 路由返回 `ENV_FORBIDDEN`；浏览器演示与正式验证以 `npm run start` 为准。

## 现在卡在哪 / 待决策

- `DEV-MM-04` 是当前多媒体公开页唯一剩余实施门：需先绑定运行中候选、精确 app/data hash 与视觉证据并取得用户确认，再实施/验收 thumbnail、键盘、pointer/touch/trackpad、lightbox 和焦点返回；在此前保持 `user-gated`。
- `DEV-MM-01..03` 的独立 profile、seed、Repository 与 V1/V2 API 已完成且有开发/安全/测试 ACK；不得把该局部闭环外推到公开 UI、真实采集、真实媒体、生产部署或系统级 no-egress。
- 59 个真实 Source 继续留在 `m3-shadow` 且全部 disabled/validating；12 条内容只在物理隔离的 `public-synthetic` 中逐字复用 `src-active`。首轮数据 FAIL 与启动/数据库覆盖 FAIL 继续作为历史缺陷输入，不得删除或改写；后继整改 PASS 也不得外推到 API、前端接线或真实平台。
- accepted R5 的同 UID TOCTOU 威胁模型仍需用户决定；未确认前保持 closed。
- R12 OS/系统调用级 no-egress 仍为 pending。
- 本地管理 API session/Origin/CSRF 目前只有已核收的候选合同，不代表 admin 实现或放行；审核队列和信源管理页尚未编码。
- 飞书重新登录后的 auth、真实 Base/provider/Collector、真实平台采集、AI/媒体处理、公开发布、部署、付费和其他外部 I/O 均保持 closed/Unknown。

## 关键文件

- 当前开发准绳：[spec.md](spec.md)
- 公开读模型/API accepted 合同：[ADR-M4-PUBLIC-READ-001](decisions/system/2026-08-03-F1+1-公开读模型与API接线-v0.4-successor-accepted.md)
- accepted 系统决策：[decisions/system/](decisions/system/)
- 当前进度：[progress.md](progress.md)
- 多媒体后端开发完成：[DEV-MM-01..03 完成报告](collaboration/部门/开发部/报告/2026-08-09-DEV-MM-BACKEND多媒体独立profile与V1-V2-API完成报告.md)
- 多媒体独立安全门禁：[多媒体 profile 与 V1/V2 API 独立安全复验报告](collaboration/部门/安全部/报告/2026-08-09-多媒体profile与V1-V2-API独立安全复验报告.md)
- 多媒体独立测试门禁：[多媒体 profile 原子 seed 与 V1/V2 HTTP 独立验收报告](collaboration/部门/测试部/报告/2026-08-09-B98C66多媒体profile原子seed与V1-V2-HTTP独立验收报告.md)
- 当前工作分工与任务索引：[collaboration/当前工作分工与交接-2026-08-07.md](collaboration/当前工作分工与交接-2026-08-07.md)
- 任务真值：[collaboration/tasks/](collaboration/tasks/)
- 最终设计冻结任务：[TASK-20260808-54BB47](collaboration/tasks/TASK-20260808-54BB47.json)
- 当前统筹真值校正任务：[TASK-20260808-4802F7](collaboration/tasks/TASK-20260808-4802F7.json)
- 公开前端实现报告：[M4 VS-1 公开信息流与内容详情前端实现报告](collaboration/部门/开发部/报告/2026-08-02-M4-VS-1公开信息流与内容详情前端实现报告.md)
- 公开前端浏览器收据：[M4 VS-1 公开前端本地浏览器验收收据](collaboration/部门/统筹部/报告/2026-08-02-M4-VS-1公开前端本地浏览器验收收据.md)
- 公开前端独立测试 PASS：[M4 VS-1 公开前端 P1 整改独立回归报告](collaboration/部门/测试部/报告/2026-08-03-M4-VS-1公开前端P1整改独立回归报告.md)
- 公开前端独立设计 PASS：[M4 VS-1 公开前端 P1 整改独立设计核验报告](collaboration/部门/设计部/报告/2026-08-03-M4-VS-1公开前端P1整改独立设计核验报告.md)
- v0.4 数据首轮安全 FAIL：[v0.4 公开数据机器合同独立安全审查](collaboration/部门/安全部/报告/2026-08-03-v0.4公开数据机器合同独立安全审查.md)
- v0.4 数据首轮测试 FAIL：[v0.4 公开数据机器合同与 12 条发布图独立测试报告](collaboration/部门/测试部/报告/2026-08-03-v0.4公开数据机器合同与12条发布图-独立测试报告.md)
- v0.4 数据五项 P1 整改交付：[v0.4 公开数据机器合同五项 P1 整改报告](collaboration/部门/数据部/报告/2026-08-04-v0.4公开数据机器合同五项P1整改报告.md)
- v0.4 数据整改安全复验：[v0.4 公开数据机器合同五项 P1 整改安全聚焦复验](collaboration/部门/安全部/报告/2026-08-04-v0.4公开数据机器合同五项P1整改-安全聚焦复验.md)
- v0.4 数据整改测试复验：[v0.4 公开数据机器合同五项 P1 整改聚焦测试复验](collaboration/部门/测试部/报告/2026-08-04-v0.4公开数据机器合同五项P1整改-聚焦测试复验报告.md)
- 双 profile SQLite 实现：[v0.4 双 profile SQLite 迁移与原子 seed 实现](collaboration/部门/开发部/报告/2026-08-04-v0.4双profile-SQLite迁移与原子seed实现报告.md)
- SQLite 与稳定启动测试闭包：[双 profile SQLite 与稳定启动闭包独立测试](collaboration/部门/测试部/报告/2026-08-04-双profile-SQLite与稳定启动闭包-独立测试报告.md)
- 数据库覆盖与 Next 安全出口复验：[真实 CLI 数据库覆盖与 Next 安全出口聚焦复验](collaboration/部门/安全部/报告/2026-08-04-真实CLI数据库覆盖与Next安全出口聚焦复验.md)
- 早期 v0.2 生产 HTTP / 体验测试 PASS：[v0.2 时间线前端独立验收](collaboration/部门/测试部/报告/2026-08-07-v0.2时间线前端独立验收报告.md)
- 早期 v0.2 M4 安全 PASS：[v0.2 前端 M4 门禁独立安全复验](collaboration/部门/安全部/报告/2026-08-07-v0.2前端M4门禁独立安全复验报告.md)
- 启动错误脱敏独立安全复审：[VS-0 启动参数与 CLI 脱敏整改快照独立安全复审](collaboration/部门/安全部/报告/2026-08-02-M4-VS-0启动参数与CLI脱敏整改快照独立安全复审.md)
- post-clean 迁移断点：[../migration/CURRENT-HANDOFF.md](../migration/CURRENT-HANDOFF.md)
- 新 Mac 独立终验：[新 Mac 迁移完整复验与清理后回归报告](collaboration/部门/测试部/报告/2026-08-02-新Mac迁移完整复验与清理后回归报告.md)
- 对话保留索引：[../migration/conversations/INDEX.md](../migration/conversations/INDEX.md)

---
最近更新：2026-08-09
