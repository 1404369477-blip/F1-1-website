# 交接文档

> 用途：换设备、隔了一段时间回来或交给其他会话续做时，先读本文件，再以 `docs/spec.md`、accepted ADR 和任务 JSON 为准。

## 当前状态快照

- **2026-08-29 当前唯一接班入口**：先读 [当前生产状态与执行待办](当前生产状态与执行待办.md) 和五条当前任务 JSON：`TASK-20260829-FCC322`、`TASK-20260829-BBFF2A`、`TASK-20260829-082F2C`、`TASK-20260829-0ED611`、`TASK-20260829-E59ACA`。固定 M1 Public Beta 最近有 `candidate-v10-20260829-220859` 与 Quick Tunnel HTTP 200 证据；URL `[EPHEMERAL-TUNNEL-URL]` 只记录最近已知值，接班必须现场重新发现并验证。生产 DB 已是 schema10，但 `backup_recovery_point=0`、`phase=disabled`、`global_stop=stopped`、`recovery=fenced`，旧 RSS LaunchAgent 未加载且指向 2026-08-13 release，RSS identity/policy仍含占位hash，所以持续采集当前没有恢复。27个X账号只完成一次登录态页面只读验收，尚无生产registry收敛和自动worker。Backup V2候选独立审查为BLOCK，整改前禁止部署。下方2026-08-13及更早快照只作历史，不能覆盖本段。

- **第一版真实闭环 / 当前接班锚点（2026-08-13）**：发布分支 `codex/first-public-release` 与远端均为 `fb0a938fa42fe9d28a8fe675aa963d5ba715aabb`；固定 M1 当前运行内容寻址 release `a7540b2e25cd88874986fcf3197ec8cabebc3886f956bdf6c875c5c949c94e3c`。真实 RSS 以 `900s` 调度，DeepSeek 生成中文整理，唯一 review SQLite 为 v4/integrity ok；用户已经完成一次 revision→approve→fresh re-auth manual publish，outbox succeeded，Public active generation=1。公开 feed/detail/API、中文标题/摘要和来源图均已实跑；公开 Admin/internal 路由为 404。Admin 固定入口是 `https://[PRIVATE-ADMIN-HOST]`，iPhone 与 iPad Passkey 实机登录已由用户确认；M5 登录流程相同但本轮没有用户实机完成收据。公开站仍由 Quick Tunnel 暴露，URL 可变；M5 的 v4 异机加密备份已再次 `backup-complete`，但未把 Public active/generation 文件纳入同一恢复点。390px 公开首页/详情和 Admin 长 delivery ID 溢出已修复并进入当前 release。下方 2026-08-12 及更早快照是历史状态，不得据此把 live 环境回退为 synthetic 或未加载状态。
- **第一版公开 beta / M1 部署（2026-08-12 00:22）**：第一版 synthetic 公开站已上线到固定 M1。release 分支为 `codex/first-public-release`；M1 使用精确 release package、官方 arm64 Node 24.18.0 与非 iCloud 运行目录 `[M1-HOME]/F1-1-website`。`com.f1plus1.public-beta` 和 `com.f1plus1.quick-tunnel` 正在运行，receipt refresh 每 12 小时执行且 last exit=0；M1 当前 AC 供电、AC/电池 `sleep=0`。常驻临时地址为 `[EPHEMERAL-TUNNEL-URL]`，公网 home/detail=200、Admin session=404。运维主通道为 UU 映射后的 `ssh f1plus1-m1-uu`。Quick Tunnel 地址重启会变化且无 SLA，中国大陆异网质量仍 Unknown；真实采集、AI 摘要、Admin UI 和自动发布不随本次上线开放。完整运行/关闭/回退见 [SSH 运行收据](runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md)。
- **v0.2 公开页 Kimi/frontend-design 审查跟进（2026-08-11 13:35）**：用户已明确要求设计部复核并给出具体优化方案，统筹已建立 `TASK-20260811-EE3F90`（`queued / user_confirmed`，输入报告 SHA=`a4022a97…a487`，冻结 HTML SHA=`5a84bfb2…f6168cb1`）。现有设计部窗口未归档且上一 turn 已结束，但 Codex 线程写入接口未送达派单；不得误写为设计部已领取。为避免停摆，统筹已形成一份不替代设计部结论的[只读预审](collaboration/部门/统筹部/报告/2026-08-11-Kimi-frontend-design审查统筹只读预审.md)，SHA=`f58aee1d…b29d8`：多数代码级发现成立，B2（证据行/原文 22px）和 E2（中文提炼层级）存在反证；推荐独立 integrity successor 只闭合真值、44px、错误文案/alt/meta 与媒体边界，不自动并入未获用户确认的 taste 审美变化。正式设计部仍须领取任务、独立核验并交付隔离 HTML、六格证据和 hash；用户确认前不得替换冻结稿、派公开页视觉实现或启动发布视频。
- **SOURCE-MGMT-001 最终后端事实（2026-08-11 12:54）**：开发 `TASK-20260810-91AF6E`、测试 `TASK-20260810-92C716`、数据 oracle `TASK-20260811-3D190C` 与安全 `TASK-20260811-FAD506` 已形成完整本地 synthetic 后端闭环，FAD506 已由统筹 ACK，最终结论 `PASS / P0=0 / P1=0 / P2=0`。closed DB SHA=`ddf3778c…e939`、logical root=`7cae9bb8…e6a`、oracle SHA=`1ced08f0…248e`；正式 DB handle=0、`externalCalls=0`。产品 `TASK-20260811-0345AC` 已完成并 ACK Spec/功能矩阵时态同步，当前 Function 仍为 `P1-blocker`，只剩视觉确认、真实页面实现和同候选三路运行验收；不得再按本文件下方 2026-08-10 的“最终安全仍 pending”历史段落恢复旧探针链。
- **SOURCE-MGMT-001 视觉确认恢复（2026-08-11 13:00）**：设计 `TASK-20260811-A32E0E` 与测试后继 `TASK-20260811-E1DCF2` 均在首张当前截图前被宿主浏览器启动权限阻断，未建立候选缺陷；前者已 superseded，后者已按 `ENVIRONMENT_BLOCKED` 收口。四张既有 PNG 仍只属于最后一次结构修订前参考图；当前固定 HTML SHA=`0d73ea29…6d68`，应由用户直接打开 [交互候选](../design/ui/F1+1-M5-admin-sources-preview-v0.1/index.html) 做方向确认。确认只覆盖 Mac 表格+Drawer、iPhone 卡片+全屏详情和六操作稳定入口，不覆盖真实页面、运行态响应式或安全验收。

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

- **2026-08-22 R6/typecheck 集成交接**：共享工作树已应用 R6 current-source patch（21 files / 17 frozen hunks）及独立 PASS 的六文件 typecheck 修复；`app/scripts/rss-collect-once.ts` 使用 R6 merged bytes 保留 source-id 修复，`app/src/server/rss/transport.ts` 的重叠部分最终 hash 单独记录。full typecheck、focused lint、RaceFans/RSS 36/36 与隔离 Next build PASS；R6 全套 release focused gate 仍 NOT PASS，原因包括共享 `.env` fail-closed、当前 runtime 文件集 114 与冻结 `toHaveLength(97)` assertion 漂移，以及 public-install 两项超时。P0=0；R6 P2=2，typecheck review P2=1。未部署、未启动服务/LaunchAgent、未触碰 M1/生产/真实数据库/外网。收据：`scratch/2026-08-22-release-integration-r6-typecheck/`。继续推进前应先由统筹决定 97/114 契约是否进入新的冻结决策并完成 isolated public-install gate；不得把当前 partial PASS 写成可发布。
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
- SOURCE-MGMT-001 本地 synthetic raw 管理 API、session/Origin/一次性 CSRF、identity、operation/audit、单 writer 与失败关闭已经开发、测试、数据 oracle 和安全最终门闭合；真实 `/admin/sources` 页面仍未编码，当前等待用户确认固定交互候选。审核队列仍只有合同与候选，业务/视觉门未关闭。
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

## 2026-08-23 release successor 交接

- successor 工程验证已形成 `PASS_NO_DEPLOY` 闭包。审计入口：[release successor report](../scratch/2026-08-23-release-successor-evidence/report.md)、[receipt](../scratch/2026-08-23-release-successor-evidence/receipt.json)、[manifest hashes](../scratch/2026-08-23-release-successor-evidence/manifest.sha256)；最终候选为 `../scratch/2026-08-23-release-successor-evidence/candidate-4`。
- 当前身份固定为 Admin 113 / root `65108cd552f9302990bf397b1fa6ddfda8347c0b0e46c6b53d6a308640813d21` 与 Public 82 / root `3bfa3d74898c13576f79de8efde27907a7a5da885af19736adff3d99145587a0`。final `.next` 在 focused Vitest 之后由 Admin verifier 重验，byte identity 与 dependency closure 未漂移。
- 接班者必须把 target-stage 收据中的 disposable test key 与生产签名区分开；本次未获得生产密钥，deploy/M1/production 继续 `NO`。任何 runtime root 漂移、target stage 回读源码父目录或 final `.next` focused test 失败，都应立即 fail closed，不得放宽 timeout、绕过 `.env`、权限或签名门。
- `app/scripts/public-release-bootstrap.ts` 仅属 legacy/local synthetic 命令，不是当前 Admin/Public target release。历史 `96/98/stale97/114` 记录不覆盖当前 113/82 successor identity；保留历史记录以便追溯。

<!-- F1PLUS1-R3-EXTERNAL-ENVELOPE-PIN-BEGIN -->
```json
{
  "schemaVersion": "f1plus1-r3-envelope-trust-root-pin-v1",
  "evidenceRootRelative": "scratch/2026-08-23-release-successor-r2-remediation/evidence",
  "envelopeAnchorRelative": "scratch/2026-08-23-release-successor-r2-remediation/evidence/envelope-anchor.json",
  "envelopeAnchorSha256": "7215c03755c2892d67c7beb8ce890d7caa2ba54e5787933f098e2f4c75dd035b",
  "envelopeManifestSha256": "99f0410c1dfdcef109fb379757b6c0b569e576f7e9728adce397e45cc3fed9c3",
  "envelopeRootSha256": "a2265c9d119b131e1b7920dc4c7e791abea7a7177ce2673754158825a7ed078d",
  "selfReference": false
}
```
<!-- F1PLUS1-R3-EXTERNAL-ENVELOPE-PIN-END -->

R3 pin v1 above is superseded by the following final receipt-normalized pin; the verifier binds only this V2 marker.

<!-- F1PLUS1-R3-EXTERNAL-ENVELOPE-PIN-V2-BEGIN -->
```json
{
  "schemaVersion": "f1plus1-r3-envelope-trust-root-pin-v2",
  "evidenceRootRelative": "scratch/2026-08-23-release-successor-r2-remediation/evidence",
  "envelopeAnchorRelative": "scratch/2026-08-23-release-successor-r2-remediation/evidence/envelope-anchor.json",
  "envelopeAnchorSha256": "dd80ea7db78dcf099cd729e6cc2e0f577311445982a9e7c0cf0cbedf308c3a36",
  "envelopeManifestSha256": "003785d940c0a12c9db2dc22b6a7912028dc4e27b6cd329fe277da1d2cac6bf3",
  "envelopeRootSha256": "15f35cd51d813fadecfe09e93d01af9e9b5e6c253d0d11a568919380c00d8407",
  "selfReference": false
}
```
<!-- F1PLUS1-R3-EXTERNAL-ENVELOPE-PIN-V2-END -->

## 2026-08-24 release successor R2 交接

- R2 唯一证据根：`../scratch/2026-08-23-release-successor-r2-remediation/`。先读 `report.md`、`receipt.json`、`envelope-manifest.json`、`envelope-anchor.json`，再运行独立 `evidence/verify-envelope.mjs`；receipt 任意 byte 漂移必须 fail closed。
- 当前 candidate：HEAD `2d590366159b7b1f83c673351fdce4f7fef9bbbb`，唯一 parent `da4fa8d9d7478d38b6787f6ce544c3ad9856e5e3`，tree `e8a191a2cf1770f7ce460934d95d932d0e51f637`；Admin manifest SHA `f494863594de2b139099e96a6a940778546c2f66a75ced98099095f510850588`；release root `814e08f792b3b6da134140f2a61ea9a9d50075adf1139fa5fb51d7cb8e9369d0`；Next root `9cbaad3f8c46ad688e7141292d7b4533bcf9c0aaaf265594bfbe6d850a47ca2d`。
- R2 验收已记录 Admin 113 / Public 82、focused 26/26、RaceFans 36/36、Admin stage、真正 self-contained target verifier、focused lint、full typecheck 与 dependency closure 后验 PASS。target 服务仍 `disabled`，仅 disposable test key；deploy/M1/production/LaunchAgent/真实签名/网络保持 `NO`。
- P1-2 复验要点：target verifier 的 `verifierWorkingDirectory` 与 target root 相同，target root tree hardlink=0、symlink=30，parent/source-entry probes 为 `ENOENT`；任何 target manifest/plist 指向 candidate/app 或父目录，或者 legacy bootstrap 进入 closure，都停止并回报。
- P1-4 旧 accepted ADR 原字节 SHA-256 为 `7192e03d9bdbd98232a7c6896ab737b5bc8da13bfa6e822e84b9208bf2f24ce7`，R2 ADR `docs/decisions/system/2026-08-24-F1+1-release-successor-R2-工程证据闭包-v2.md` 记录 supersedes；旧正文保持 immutable。full `npm run check` 与 full unfiltered Vitest 为 `NOT_RUN`。

## 2026-08-24 双语完整 Admin successor 接班入口

接班先读：

1. [accepted successor ADR](decisions/system/2026-08-24-F1+1-v6到v10双语完整Admin生产successor-accepted.md)；
2. [实施合同 v1.0](spec/F1+1-v6到v10双语完整Admin与公开部署实施合同-v1.0.md)；
3. [Function 矩阵 v1.0](spec/F1+1-双语完整Admin与公开部署Function矩阵-v1.0.md)。

当前唯一顺序是 `schema6 → 0007 gateway/recovery/phase → 0008 X manual inbox → 0009 bilingual → 0010 source registry`。旧 accepted v5文件保留历史语义和原字节，其中 `0005_auto_publish_policy/user_version=5` 实施身份已被新ADR精确取代；现行0005/0006分别仍是Autosport和RaceFans/The Race。

Slice 0只有文档产出。R3只关闭engineering release/build evidence gate；0007是未应用frozen candidate，0008/0009/0010、双语Public、完整Admin/ops和production仍未实现或未部署。Open Design frozen目标仍标记`NOT_DEPLOYED / realApi=false`，不能作为真实API/DB收据。

用户已授权最终部署目标和持续工程推进；生产瞬时值与不可逆动作继续等待不可变`PRODUCTION-DEPLOYMENT-MANIFEST`。任何后继开发任务必须逐Function ID绑定Mac+iPhone真实入口、状态/恢复、冻结视觉身份和production gate；Admin不得使用公网裸入口。

## 2026-08-24 双语完整 Admin Slice 0 R2 交接更正

前一接班段只能理解为目标合同入口，不能理解为Slice 0已通过。首轮独立审核根 `../scratch/2026-08-24-bilingual-admin-contract-review/` 的receipt为 `FAIL / P0=0 / P1=2 / P2=2`；R2已更新同三份新文档并保持旧accepted、R3外部pin、app/data不变。当前时态是 `R2_REVIEW_PENDING`。

R2复审必须机械确认：所有route strict DTO/Problem与HTTP/cache/pagination；CAS/idempotency/fresh/capability；Candidate/LanguageSlot/Bundle/Approval/Publication/Projection/Source/X/Phase/Operation/Attempt/Delivery的closed transition；unknown response只查同一identity；Ops统一snapshot的asOf/freshness/unit/unavailable union及logs/traffic/API/cost/alert隐私边界；Function矩阵不再把correct/withdraw、Audit UI或Security UI记成current。复审PASS及其receipt/manifest hash落账前，不得进入Slice 1或写complete。

## 2026-08-24 双语完整 Admin Slice 0 R3 交接更正

R2复审根 `../scratch/2026-08-24-bilingual-admin-contract-review-r2/` 结论为 `FAIL / P0=0 / P1=2 / P2=1`；R3只修改三份Slice 0新文档并在三份主文档尾部追加本更正，当前为 `R3_REVIEW_PENDING`。接班复审应机械核对：Source两个正交enum及0010映射无冲突；PublicFeed/PublicDetail V1与V2完全分型；标准浏览器header不被应用allowlist误杀且forwarded/auth敏感header拒绝；FreshAction逐route closed；无`plus`、`0..max`、`action:string`、无类型field或无上限integer；Release role后缀与pair receipt同schema；Cost明确actual zero、actual unknown、estimate-only三态。独立PASS前禁止进入Slice 1。

## 2026-08-24 双语完整 Admin Slice 0 R4 交接更正

当前状态为 `R4_REVIEW_PENDING`。唯一复审焦点是Source：三份新文档必须逐字保留canonical `identity_status/relevance_status/monitorability`，枚举和默认与当前Spec一致；0010必须覆盖普通新source、四RSS和59X mapping；activate与queued claim必须显式读取三列、五个activation guard和五个epoch fence。派生read model只能返回clear/blocked/unknown或clear/stale/unknown，不能成为持久字段或canonical alias。任一真值/receipt/identity Unknown时零写零外联。独立PASS前禁止进入Slice 1。

R4语义校正：上一句的`identity Unknown`只指派生guard/fence的真值身份或receipt identity为Unknown；canonical `identity_status=unknown`、`relevance_status=unknown`、`monitorability=unknown`按当前Spec允许`statusGuard=clear`，不得因此单独阻断。只有派生guard=`blocked|unknown`或epoch fence=`stale|unknown`时零写零外联。

## 2026-08-24 双语完整 Admin Slice 0 R4 关闭交接

独立复审根`scratch/2026-08-24-bilingual-admin-contract-review-r4/`已给出`PASS / P0=0 / P1=0 / P2=0 / Slice0Gate=CLOSED_PASS`，Slice 0目标合同文档门现为`COMPLETE`。固定身份：report SHA-256 `3e6c69ee2c3f67523b0cfd6c9ea15ed1eee1692c2d61d371516e207345de3a22`；receipt SHA-256 `03327aa1af9119e55681f591e24bd4160c657973392bfe2bc53f45b01fe5d4aa`；manifest SHA-256 `09fa3a08e3736d29a198ced3e71e4983b9ccc2dbcc26440bfd665ba9cc44f022`。

接班者可进入后继工程切片，但必须继续逐Function保持`implementation-pending/engineering-candidate/production-gated`真值。历史FAIL、R3 external pin、Open Design `NOT_DEPLOYED / realApi=false`和`PRODUCTION-DEPLOYMENT-MANIFEST`生产门均未被本次文档关闭覆盖。

## 2026-08-24 0007 fence/rollback successor 接班更正

前一段“可进入后继工程切片”已被0007 fence P0覆盖。当前先读：

1. [0007 fence/rollback successor accepted ADR](decisions/system/2026-08-24-F1+1-0007-fence与rollback-successor-accepted.md)；
2. [0007 successor实施合同](spec/F1+1-0007-fence与rollback-successor实施合同-v1.0.md)；
3. [独立P0裁决](../scratch/2026-08-24-0007-fence-contradiction-audit/report.md)。

旧 frozen 0007确有Admin `phase_control/fence_update` transition，Slice1报告称trigger让合法operator永远无法clear不成立；真正P0是该路径无需verified truth receipt即可clear singleton fences。旧identity全部`SUPERSEDED_FOR_IMPLEMENTATION`且原字节保留。当前为`0007-successor-contract-review-pending / Slice1 BLOCKED`；0008/0009/0010和production继续blocked。

接班复审必须机械确认：one-fence/one-receipt、supervisor-only、clear仅disabled/paused、收紧edge四phase可用、receipt+singleton CAS+permit+audit+terminal同一事务；business rollback收敛blocked、no attempt/outbox/effect证明、secret销毁和orphan lease。新SQL与六类identity仍未创建。R3 external pin、Open Design和production manifest门均保持不变。

门禁禁止混用：当前contract review只审八份文档，`P0=0/P1=0`后进入`0007-successor-implementation-review-pending`；届时才可另行派发隔离SQL/identity/E2E任务。实现复审关闭前Slice1和0008继续blocked。R3 V2 marker原字节保留只表示pin未被本任务改写，不表示当前retained target root已重新通过完整envelope verifier。

## 2026-08-24 0007 successor 合同关闭交接

独立审核闭包固定为report `6c73bd52fc2617717302994f1ffe5571db1b2a78bdc05515a01a87a387e5aa8b`、receipt `74e959ca3a321d191d4fd7f02723f94a2b0e843bea685c93be93ac84c02daff8`、manifest `73ef34bb4466beea632b4cee5552be75f045a235682613acc255800f2828ff4f`，根目录`scratch/2026-08-24-0007-successor-contract-independent-review/`，manifest `2/2 OK`；结论`PASS / P0=0 / P1=0 / P2=0`及`MICRO_PASS / P0=0 / P1=0`。

接班者现在可以另行派发隔离的0007 successor implementation候选，当前门为`0007-successor-implementation-review-pending`。授权范围仅含新SQL、六身份、实现、负例与无workaround E2E；在第二门独立复审`P0=0/P1=0`前，Slice1工程关闭、0008、真实DB、M1和production继续blocked。旧FAIL、旧0007及R3 external pin不得重写。

## 2026-08-24 可信单用户 M1 quick-launch 交接

用户已选择可信单用户M1快速上线并接受same-UID残余风险；现行入口是[quick-launch successor ADR](decisions/system/2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md)，当前`review-pending`。该overlay在首版quick-launch范围内覆盖上一段high-assurance 0007先行阻断，R7保留为`DEFERRED / NOT_SHARED / NOT_PRODUCTION`，旧accepted与全部复审证据不改。

接班顺序：shared旧0007 exact raw `ab32bb74fb404656bbdf6f84cc8a6967e18f8ed797f59ec27125291e5c26a163`作为trusted-local capability/accounting → 0008 X manual disabled → 0009 bilingual → 0010 source registry → full_v10/manual_only_fallback_v10。bootstrap必须走gateway/authorizer和既有Admin `phase_control/fence_update`，一次一fence；禁止drop trigger、裸UPDATE或test workaround。合法路径在production-shaped disposable DB失败时立即退回blocked，另立最小additive候选复审。

首版自动能力只有RSS collect与zh-CN/en refine；人工review，private/fresh人工publish；automatic review/publish、59 X自动采集和oEmbed均disabled。上线前必须证明Admin loopback/Tailscale-only/Funnel=0、Passkey/session/Origin/CSRF/fresh/audit、auto worker五处为0、signed snapshot/LKG、off-host backup age与RPO≤900秒、COMMIT前rollback及COMMIT后同schema fallback。用户确认绑定本线程自然语言，`evidenceId=NOT_ISSUED`；production manifest仍固定真实host/UID/path/network/key/model/source/backup/cutover值。

## 2026-08-24 quick-launch automatic-zero P1 交接更正

上段“auto worker五处为0”由[quick-launch ADR §10唯一`AutoAutomationZeroVector`](decisions/system/2026-08-24-F1+1-可信单用户M1快速上线-successor-accepted.md#10-autoautomationzerovector-唯一合同)精确覆盖，不能解释为独立worker PID或WebAuthn fresh operation。Manifest必须固定`quickLaunchCutoverAt/release/manifest/reviewDatabaseIdentity/autoProcessIdentitySetSha256/scheduleInventorySha256`。

接班实现必须分别对`automatic_reviewer/review/system-auto-review-v1`与`automatic_publisher/publish/system-auto-publish-v1`生成五轴收据：active process、schedule registration、active owner handoff、post-cutover或遗留nonterminal operation、post-cutover或遗留queued/nonterminal effect均为0。exact SQL、owner/kind/channel/producer/outbox type/status闭集见ADR §10；cutover前terminal legacy/audit/provenance必须保留。

当前`runtime.ts`仍无条件注册两个60秒interval并在listen后启动两个tick，因此现行build为FAIL；即使独立PID为0也不能放行。后继release需静态AST/call-graph和跨至少一个60秒窗口的进程外运行收据。独立FAIL report/receipt pin为`5fb3c8aa3bbbd453a69a7ef28222ebb9c0b56c69a1343dc1e19bd83cadfa5554`/`96ab78b838856fe5d2dabc20d51eaab5c9a76de1cb7f39bade41efcca9c40624`；当前仍`review-pending`，app/DB/M1/production未改。

## 2026-08-24 quick-launch R2 合同门关闭交接

R2独立复审结论为`PASS / P0=0 / P1=0 / P2=0 / quick-launch contract gate=CLOSED_PASS`；report SHA-256 `9a75a70c462be4c76d5d0b4c5db8925e6a574b6a9f1fab05e1297dc8674bcadf`、receipt SHA-256 `763737f8c6eddd05d2e09232e948b5e55ebd917369d474558dbe3cba73928d70`、manifest SHA-256 `5020a905065ffaabc1bcc89a1ba43906240429faef22350fe7d526eb39f7687d`，证据根`scratch/2026-08-24-trusted-single-user-m1-quick-launch-independent-review-r2/`。当前状态收口为`contract CLOSED_PASS / engineering authorized pending`。该关闭只授权后继工程候选按既有合同另行实施与复审，不表示实现、production-shaped E2E、M1或production通过。首轮FAIL及其整改历史保留；当前`runtime.ts`两个60秒interval和两个startup tick继续令review/publish的schedule轴`FAIL / NO_DEPLOY`，必须由后继release移除或机械拒绝注册并取得§10全部收据后才可继续部署门。
