# 进度日志

> 按时间倒序记录「做了什么、发现了什么、卡在哪」。这是项目的"流水账",越勤快越值钱。
> 每条建议格式:日期 + 做了什么 + 下一步。

---

## 2026-08-30

- 🧭 **提出「数据可再生性分层与 RPO 重定级」提案，尚未采纳**：新增 `docs/decisions/system/2026-08-30-F1+1-数据可再生性分层与RPO重定级-proposed.md`，状态 `proposed / awaiting_user_decision`。核心论点：`TASK-20260829-FCC322` 的 8 项阻断中有 5 项（prune 误删、DB与projection共同恢复边界、RPO 取完成时间、远端 consume 幂等/tombstone、projection verifier 过宽）不是标准过高，而是为达成全局 `RPO≤900s` 而选择的「增量 + prune + 远端消费 + 双源对齐」架构自身产生的复杂度；另 3 项（schema10 正式验证、加密对象 kind/keyId 与 O_EXCL、失败与 stale lock 不静默）是恢复正确性要求，提案不建议放宽。提案把 schema10 的 67 张表按可再生性分为 T0 不可再生（人工审核决定、审计链、Passkey、`x_manual_submission`，外加 `docs/spec.md`、`docs/decisions/`、478 条 TASK JSON、`design/`）、T1 付费可再生（DeepSeek 双语产出）、T2 免费可再生（RSS 抓取内容与公开投影），并对 T0 用 append-only 日志 + 5 分钟异机推送、对 T1/T2 用每日 `VACUUM INTO` 全量快照。本次只写入该提案文件与本条记录，未修改 `docs/spec.md`、任何 accepted ADR、任务 JSON、代码、SQL 或生产配置；现有 `RPO≤900s` 硬门在用户确认前继续有效。

- 🔬 **`VACUUM INTO` 一致性快照机制已在 disposable 环境实测通过**：`scratch/2026-08-30-rpo-retier-proposal-check/check.mjs`，未触碰生产 DB。SQLite `3.51.3`（`VACUUM INTO` 需 3.27+），源库 `WAL` 模式含 500 行与 1 个 trigger；快照产物为单一自包含文件，无 `-wal`/`-shm` 旁文件，`user_version=10` 与 trigger 均保持，`quick_check=ok`。该结果支持提案中「单文件快照可直接加密异机传输、无需把 DB/WAL/manifest 关联成同一恢复边界」的主张。注意实测使用环境默认 `node v22.23.1`，非项目钉定的 `24.18.0`；机制在 SQLite 层实现，但正式实施仍须在钉定版本复验。

- 📋 **工作区状态盘点（只读，未做任何清理）**：工程工作区存在 545 处未提交改动（460 untracked + 85 modified，约 946 MB），其中 `docs/collaboration/` 下 354 个文件未提交，含 478 个 TASK JSON（共 25,331 行）——即任务真值与产品决策历史当前无异机副本。`.gitignore` 未覆盖 `design/`（920 MB）、`.worktrees/`（75 MB）、`.next/`，根目录 `node_modules/` 规则仍为注释状态。另发现 `app/` 下有 12 个 2026-08-07 由拼错 shell 命令创建的垃圾目录（`--headless=new`、`--screenshot=`、`--window-size=1440,2000`、`http:`、`ls`、`-la`、`~` 等）及根目录一个名为 `-` 的 39 KB 文件。以上均**未**执行删除或 `.gitignore` 修改，等用户决定。

- 🔍 **公开站降级行为已读码核实，修正提案初稿表述**：公开站**从不读数据库**，只读 `<projectionRoot>/active.json` → `generations/<hash>.json` → Ed25519 验签（`app/src/server/review-real/projection.ts:271`）。三种后果：DB 丢失但投影完好=访客完全无感；`active.json` ENOENT=空时间线 200；`active.json` 在但 generation 缺失/验签失败=整站 503。结论：T2「RSS 内容可再生」论断更强；投影文件单列 T2′（重建需 T0 人工发布 + fresh WebAuthn）；**部分丢失比完全丢失更糟**，恢复顺序必须先 `generations/` 后 `active.json`。已写入提案 §4 T2 补充与 §8.6。

- 🧭 **用户就提案 §12 的决定**：q2 T1 =「先测成本再定，暂按 T0」，解除入口 `COST-OBS`（提案 §6）；q3 `FCC322` 由提案决定 = **条件性 supersede**（现在冻结不推进，提案获批才收口，3 项正确性要求逐条转入新任务，见提案 §6.1）；q1 已由上条读码回答；q4 授权 commit+push 但触发下条阻断。

- ⛔ **T0 异机副本被「remote 是公开仓库」阻断，停在 commit 前**：`.gitignore` 已补（`node_modules/`、`.next/`、`.worktrees/`、`design/`、`*.sqlite`/`*.db`），待提交从 946 MB 降至 4.9 MB / 534 条。但 remote `github.com/1404369477-blip/F1-1-website` **visibility=public**（最后 push 2026-08-13 停在 `52e6549`）。`git grep [PRIVATE-TAILNET] 52e6549` 为空即私有 Admin 地址**尚未泄露**，但本地未推送的 `8f305e1` 已含该地址，待提交文件中 Tailscale 私有地址在 5 个文件、Quick Tunnel 地址在 6 个文件，另含 hostname/UID/绝对路径/设备授权细节。真实凭证扫描阴性（`sk-` 命中均为 `TASK-` 误报，DeepSeek key 走环境变量）。直接 push 属 A 级「扩大公网暴露」，故未 commit 未 push，等用户决定仓库可见性方案。**缓解前 T0 实际 RPO 仍为无穷。**

- 🤖 **按用户指示改为多模型子 Agent 并行**：kimi-k3 产出 67 表 T0/T1/T2 分层草案、opus-5 对提案做对抗性审查、gemini-3.7-flash 做待提交文件敏感字符串全量清单，产物统一进 `scratch/2026-08-30-rpo-retier-proposal-check/`，均为草案/证据，未并入正式文档。

- ✅ **用户已选定仓库路线：保持公开，脱敏后推送**。方案定稿见 `scratch/2026-08-30-rpo-retier-proposal-check/scrub-and-push-plan.md`：占位符 + `docs/private-endpoints.local.md` 本地真值文件（`*.local` 已被忽略）；被脱敏文件先存原始副本到 scratch 保审计；5 个未推送 commit 打安全标签后 soft reset 重建为干净提交；推送前逐模式 `git grep` 全零命中才推。执行等 gemini 敏感清单完成后由 grok-4.6 子 Agent 落地，主 Agent 核收验证门后 push。

- 📊 **kimi 逐表分层草案已完成并并入提案**：`scratch/2026-08-30-rpo-retier-proposal-check/table-classification-draft.md`，净 63 表（初稿 67 系误算）：T0=29 / T1=5 / T2=25 / T2′=4，12 表疑义（按规则先按 T0 保护）。两条落地硬约束已由主 Agent 验证并写入提案 §4/§7：①`0007` 第 813 行 `rpo_seconds CHECK(BETWEEN 0 AND 900)` 与第 881 行 `valid_backup_recovery_point_v1` 视图把旧 RPO 写死在 schema 层，提案获批后需 additive 迁移配套（独立合同）；②新增依赖传递规则「任何表的实际恢复保证等于重建链上最弱上游的保证」。草案待独立复核，opus 审查针对的是并入前版本，需注意版本差。

- 下一步：等 opus 对抗审查与 gemini 敏感清单；gemini 完成后派 grok 执行脱敏与重建提交。提案 §7 文档改动与新备份实现仍待提案获批。

## 2026-08-29

- 📚 **当前生产真值、恢复队列与 Agent 接班文档已统一同步**：新增 `docs/当前生产状态与执行待办.md`，集中固定 M5/M1 目录、当前 Public/Quick Tunnel 的置信边界、schema10 DB 与 control 状态、RSS/X 信源现状、Backup V2 独立审查阻断、端到端/Admin 剩余出口、证据索引和接班行为边界。`docs/spec.md`、`docs/roadmap.md` 与 `docs/handoff.md` 已增加 2026-08-29 当前事实覆盖，明确 2026-08-20 及更早的“四源自动运行/自动发布”只保留历史审计价值。正式建立五条当前任务真值：`TASK-20260829-FCC322`（Backup V2整改）、`TASK-20260829-BBFF2A`（M1 schema10恢复与RSS身份闭包）、`TASK-20260829-082F2C`（两源canary与900秒持续采集）、`TASK-20260829-0ED611`（27 X registry与低风险灰度）、`TASK-20260829-E59ACA`（双语/人工审核/Public/Admin端到端上线）。本次文档同步未执行生产DB、服务、LaunchAgent、网络、备份或发布动作。

- ⛔ **Backup V2候选独立对抗审查为BLOCK，禁止部署**：候选语法和固定Node路径可读，但 prune 可能依据损坏point误删、SQLite验证缺schema10完整结构与runtime invariant、DB与projection无共同恢复锚点、RPO时间使用完成时间、consume非幂等、对象身份/路径/O_EXCL不足、projection verifier过宽及stale lock静默等 P0/P1 尚未关闭。整改和 disposable 故障注入由 `TASK-20260829-FCC322` 负责；通过独立复审前不得安装备份LaunchAgent、更新production recovery fence或宣称verified recovery point。

- ⛔ **M1 RSS生产恢复预检为BLOCKED**：生产DB `user_version=10 / quick_check=ok`，Admin/projection `candidate-v10-20260829-091305` 与 Public `candidate-v10-20260829-220859` 文件闭包可核验；但 `backup_recovery_point=0`、`clockTrusted=false`、`writerReady=false`、`phase=disabled`、`global_stop=stopped`、`recovery=fenced`，RSS route/authorization/policy 仍为占位hash，两个旧RSS plist指向2026-08-13 release且未加载，历史1609条queued publication与1条reconcile_wait必须隔离。恢复顺序固定为 Backup V2闭包→verified异机恢复点→合法control与真实RSS hash→新plist→仅Motorsport/The Race单次canary→两个自然900秒周期。

- ✅ **27个X账号只读页面验收已完成，但持续采集仍未实现**：首批5条与剩余22条均在M1现有Chrome登录会话中串行只读通过，未观察到challenge/rate-limit/restricted；该证据只覆盖当次页面可读。生产registry尚未从旧59条收敛到27条，X worker、调度、去重、入库、人工审核和公开投影均待 `TASK-20260829-0ED611` 落地。禁止读取cookie值、绕过挑战或采用Nitter/RSSHub/未文档化GraphQL。

- 🧭 **59 条 X 候选完成用户第二轮精简**：`data/x-source-selection-v1.csv` 已逐条落账为 `keep=27 / replace_with_rss=1 / drop=31`。移除 `Carlossainz55`、`ZBrownCEO`、`autosport`、`Motorsport`，加入并保留 `alex_albon`、`PierreGASLY`；F 组只保留 `ZhouGuanyu24`、`NicoRosberg`，G/I 全部移除，H 三条全部保留。Sky Sports 已实测官方 `https://www.skysports.com/rss/12433` 返回 RSS 2.0，当前 20/20 条均为 F1 内容，因此将 `SkySportsF1` 标为 `replace_with_rss`。精简后为 27 个 X 账号 + 1 条 Sky F1 RSS，共 28 个有效输入；尚未写入生产 source registry 或启用采集。

- ⚡ **消除二次自动定位，实现单次平滑置顶贴靠（发布 candidate-v10-20260829-220859）**：
  1. **消除二次定位与抖动**：排查并彻底移除了历史代码中随 `detailStates` 异步加载触发的二次居中滑动逻辑（`setTimeout 260ms` 与 `block: "center"`），消除了用户反馈的“放大后画面自动滑动两次”的抖动问题。
  2. **单次直接贴在顶部（block: "start"）**：
     - 展开动作仅触发一次直接、平滑的视口顶部对齐（`target?.scrollIntoView({ block: "start" })`，配合 `scroll-margin-top: 0px`）；
     - 打开瞬间标题完美贴在视口顶端，并且后续绝对不会发生任何二次自动定位；
     - 用户拥有完全自主、不被打断的上下滑动浏览体验。
  3. **自动化测试与生产热重载**：
     - 同步更新测试契约，`public-ui.test.ts` 26/26 项全部绿灯；
     - M1 生产机完成 Turbopack 编译，签名闭包 SHA-256：`94020755...`；
     - LaunchAgent 服务（PID 34066）无缝接管，公网 Cloudflare 隧道 200 OK 实时生效。

- 🎯 **卡片视觉纯粹化与自然滚动聚焦优化（发布 candidate-v10-20260829-122910）**：
  1. **背景同源与去外框（Borderless & Native Background）**：
     - 响应用户最新纠偏，彻底剔除卡片展开时的任何边框、高亮描边与不同色块背景（`background: transparent; border: none; box-shadow: none`）；
     - 卡片外观与主页面 100% 同色系无缝融合，纯粹仅将当前卡片内容在原位平滑微放大（`scale(1.025)`），不做任何外加款式。
  2. **全背景深度虚化（Deep Background Blur）**：
     - 展开时，页面顶栏、页脚及时间线上所有未展开卡片自动应用高阶虚化（`filter: blur(8px); opacity: 0.18;`），焦点卡片清晰透亮，主次视觉对比极具品质感。
  3. **标题平滑置顶对齐与解除滑动锁定**：
     - 彻底解除了之前导致页面无法滑动的 `body overflow: hidden` 锁以及全局遮罩拦截，用户展开后依然可随意上下滑动浏览卡片及其全部长文上下文；
     - 展开瞬间自动平滑将卡片标题顶部对齐至视口顶部（留出 16px 呼吸间距），彻底解决“标题出画看不见”的问题；
     - 点击任何虚化的背景区域或按 ESC 键，卡片瞬间丝滑缩回，背景虚化无缝褪去。
  4. **全量构建与生产验证**：
     - 本地单元测试 26/26 全部通过，无任何 lint/type 错误；
     - M1 生产机完成 Turbopack 生产编译，签名闭包 SHA-256：`8f5ca427...`；
     - LaunchAgent 服务（PID 17633）稳定在岗，公网访问 200 OK。

- ✨ **回归纯粹卡片美感：废除生硬外置弹窗，重构为原地原生卡片平滑浮升微放大动效（发布 candidate-v10-20260829-121654）**：
  1. **废除外置弹窗**：彻底移除突兀割裂的 `card-modal` 模态弹层及生硬的关闭按钮与顶栏，保持卡片 100% 原始视觉基因与排版结构。
  2. **原地平滑浮升放大（Fluid In-Place Expansion）**：
     - 点击卡片时，该卡片自身平滑微放大并向上浮升（`scale(1.02) translateY(-2px)`，配合 340ms 弹性贝塞尔曲线），自然呈现优雅立体阴影与柔和高亮边框；
     - 提炼内容（`tl-detail`）与核心要点在卡片内部平滑展开，未展开卡片柔和淡出虚化（`filter: blur(1.5px); opacity: 0.25;`）；
     - 背景铺设轻柔毛玻璃暗色遮罩（`.tl-focus-backdrop`），点击卡片外任意区域或按 `Escape` 键，卡片丝滑缩回时间线原状。
  3. **排查并消除后台启动挂起与端口竞争**：
     - 查清界面卡在后台执行命令的根因：原 `serve.ts` 启动时因孤儿进程暂持 3001 端口导致 15 秒超时，进而触发前台命令阻塞；
     - 将 `STARTUP_TIMEOUT_MS` 安全扩充至 45 秒，清理孤儿进程，并将 LaunchAgent 配置升级为系统级常驻守护（`KeepAlive: true`），彻底终结了界面转圈挂起的问题。
  4. **构建与生产部署验证**：
     - Turbopack 生产编译与 89 个运行时闭包哈希核验（SHA: `16a1497b...`）通过；
     - LaunchAgent 服务（PID 13063）端口 3000/3001 稳定监听，公网 Cloudflare 隧道 200 OK 正常提供服务。

- 🌟 **卡片前置无框窗口展开动效、满宽排版优化与英文原文切换落地（发布 candidate-v10-20260829-115619）**：
  1. **标题下排版满宽修复**：彻底移除 `globals.css` 中 `.tl-lead` 的 `max-width: 62ch` 限制，改为 `width: 100%; max-width: 100%`，消除大屏和移动端卡片右侧留白死区，排版自然撑满卡片。
  2. **前置无框窗口展开交互（Elevated Modal Sheet）**：
     - 点击卡片时平滑放大浮升为前置无框卡片窗口（`scale(0.93) -> scale(1)`，带贝塞尔曲线弹性动效），背景淡入深度毛玻璃暗色遮罩（`backdrop-filter: blur(16px)`）。
     - 标题与中英切换胶囊自然吸顶停靠（Sticky Header），正文与配图区域支持在窗口内随意纵向滚动阅读上下文。
     - 点击遮罩外部区域、点击右上角关闭按钮（✕）或按键盘 `Escape` 键，卡片带有柔和弹性动效自动缩小过渡回原位。
  3. **英文原版切换与展示打通**：
     - 解决此前在 V1 快照下 `EN` 按钮置灰不可点击的缺陷，打通 `getEnglishFallback` 映射，恢复了中英双语的无缝切换。
     - 点击 `EN` 可即时展示英文原版标题、出处媒体、英文报道导语与原报道全文直达链接；点击 `中` 可随时切换回深度提炼中文视图。
  4. **全量生产构建与部署验证**：
     - 本地 TypeScript 检查与 `public-ui.test.ts`（26/26）全部绿灯通过。
     - 在 M1 生产机完成 Turbopack 生产编译，签名生成发布候选 `candidate-v10-20260829-115619`。
     - 更新 `projection-deployment.json` 与 LaunchAgent 配置，重启服务（PID 4666 端口 3000 监听）。公网 Cloudflare 隧道 200 OK 正常提供服务。

- 🎨 **公开站视觉重塑：恢复图片为主视觉，收拢微型中英文切换，上线手机端上下滑卡交互**：
  1. **移除卡片顶层语言大切换**：彻底移除折叠态卡片头部显眼的 44px 蓝白大方块 `[中文 | English]`，消除干扰。
  2. **恢复大图主视觉**：移除 96×64 微缩图，恢复大主图限高呈现（桌面 360px、移动 260px，支持原比与点击放大），无论折叠或展开均保持强烈视觉张力。
  3. **微型化中英切换**：仅在用户主动展开卡片详情后的提炼标题行（`.tl-zh-head`）右侧，内嵌轻量低调的微型切换胶囊（`.lang-pill`，22px 高，11px 字体 `[中 / EN]`）。
  4. **手机端 TikTok/Reels 上下滑动体验**：落地 `CardDeck` 85dvh 滚动吸附组件，支持移动端沉浸上下滑卡与时间线双模切换。
  5. **测试与设计原型**：更新 `src/tests/public-ui.test.ts`（26/26 全部通过）；产出交互式全功能对比原型 `design/ui/F1+1-redesign-image-first-20260829/index.html`。
- 🚀 **已全量构建并部署上线至固定 M1 生产站**：
  1. 依据用户授权「你有信心的话可以直接部署」，将前端组件与样式内联至闭集运行时，严格遵守 89 个运行时文件不可变闭包合同。
  2. 在 M1 生产机运行 `prepare-v10-release-candidate.ts` 完成 Turbopack 生产编译与闭包签名，生成不可变发布候选 `candidate-v10-20260829-110621`。
  3. 更新投影部署清单 `projection-deployment.json` 与 LaunchAgent 配置，重载 `com.f1plus1.public-beta`（PID 85181 在岗，3000/3001 端口正常监听）。
  4. 验证通过：公网隧道 `[EPHEMERAL-TUNNEL-URL]` 返回 HTTP/2 200 OK，样式与提炼数据正常呈现。
- 🔧 **修复展开卡片提示「提炼内容暂不可用」与提示语问题（热修并发布 candidate-v10-20260829-112422）**：
  1. **根因定位**：生产投影目前服务的是已发布的 V1 快照（未包含 V2 bilingual-pointer）。首页 `fetchPublicFeed` 在遇 503 `PUBLIC_READ_INTEGRITY_FAILED` 时能正确降级至 V1 路由，但 `fetchPublicStory` 在 catch 块中遗漏了 `!isBilingualIntegrityUnavailable(error)` 降级条件，导致点击卡片展开详情时向 `/api/public/stories/[id]?v=2` 请求失败并抛错 503，同时 V1 映射未填入 `localized["zh-CN"]`。
  2. **代码修复**：
     - 在 `public-api.ts` 的 `fetchPublicStory` 中补全 `!isBilingualIntegrityUnavailable(error)` 自动降级至 V1 详情路由，并在 V1 映射中完整注入 `leadZh`、`bodyZh`、`keyPointsZh`。
     - 清理 `feed-experience.tsx` 与 `story-detail-experience.tsx` 中生硬的开发者调试文本 `"英文提炼暂不可用，当前保留中文 LKG。"`，统一展示规范的 `sourceNotice`。
  3. **生产重发与验证**：在 M1 执行打包生成 `candidate-v10-20260829-112422`，重载 `com.f1plus1.public-beta`（PID 88914）。经回放测试，`fetchPublicStory` 成功返回完整中文提炼导语与要点列表，公网站点已全面恢复正常。
- 📱 **手机端体验极简化与内容面积最大化（发布 candidate-v10-20260829-113405）**：
  1. **主页面顶栏彻底极简**：移除主页面常驻的 `[时间线 / 沉浸卡片]` 切换按钮，归拢至页面底部的「设置」抽屉面板（`settings-panel`），支持在「时间线」与「沉浸卡片」模式间无缝切换，保证主页首屏 100% 以内容为主角。
  2. **最大化手机端内容展示面积**：
     - 容器与顶栏瘦身：`.app` 左右内边距由 `clamp(16px, ...)` 压缩至 `12px`，顶部内边距减少 60%，时间线 kicker 间距减半，大幅释放首屏宝贵视野。
     - 图片 100% 满宽与原比自适应：废除此前在移动端强行保留 64px 缩略图列导致主图被严重挤扁压缩的缺陷，单图全面满宽展示（最大高度扩展至 300px~320px），视觉冲击力与阅读沉浸感拉满。
     - 信息流结构紧凑化：时间戳与分类微标紧凑并排，标题与正文行距专业调优，消除冗余留白。
  3. **生产构建与发布上线**：在 M1 生产机完成 Turbopack 生产编译并对 89 个运行时文件闭包校验签名，生成并部署发布候选 `candidate-v10-20260829-113405`（LaunchAgent PID 94323 在岗，3000/3001 端口正常监听）。公网 Cloudflare 隧道返回 HTTP/2 200 OK。

## 2026-08-20

- ✅ **RaceFans / The Race 配图已按用户授权接入 v4 热链（代码+live 热修；公开站尚未吃到新图）**：用户确认可以采用这两家配图。The Race 只开 `storage.ghost.io/.../content/images/`，RaceFans 只开 `www.racefans.net/wp-content/uploads/`；分类 RSS 无 enclosure 时从文章 `og:image` 取。不是 v5 media-policy，未开 `pbs.twimg.com` / Instagram / 任意 Ghost 租户。parser 接受 `media:content medium=image` 并从扩展名推断 MIME，缺 `length` 时 `declaredBytes=1`。`rss-real` 15/15、`rss-catalog` 1/1。外科拷贝到 collector `fb50b6a5…c789`、Admin `c8e1b263…097a`、public `5d99dc95…eaed`，投影 receiver 已重启；public 重建 `BUILD_ID=Ywl4g4xcwlpKAPt1e2BF6`。回退在 `[M1-HOME]/F1-1-website/.independent-rss-media-20260820/backup/`。无新 SQL，fingerprint 仍 `396af1d6…f8a9`。网络正常时只读核验：The Race 15/15 有 Ghost 图，RaceFans 文章 og:image 指向 `/wp-content/uploads/`。随后 DoH（`1.1.1.1` / `cloudflare-dns.com`）TCP 通但 TLS 握手超时，采集槽位 `1985788`/`1985789` 四源 `CONNECT_TIMEOUT`，审核库尚未写入新图。采集器/润色已恢复 enable，等 VPN/DoH TLS 恢复后下一槽会拉图并走 DeepSeek→自动初审。未部署 B 图先行、未接 X、未提交。

- 📐 **只处理最新内容（用户确认）**：自动初审继续只扫最新 100 条候选。RaceFans 8 条 8/1–8/13 旧稿（中文稿已有）留在 `pending_review` 不自动发布，不扩大扫描窗口、不补发 On This Day。未改代码。
- ✅ **RaceFans + The Race 已接入 live 采集→初审→自动发布**：按 Autosport `0005` 模式追加 `0006_independent_rss_racefans_the_race.sql`（SHA-256=`8239f037…3daf`），schema fingerprint `396af1d6…f8a9`。同一 review 库 `dev=16777233/ino=24570709` 升到 `user_version=6`（仍**不是** v5 自动发布合同）。The Race 用 `/rss/` 不是 `/feed/`；两家 0 图。catalog 四源 `live`，Formula1.com 仍 blocked。外科拷贝 `sources.ts`/`schema.ts`/`migration.ts`/`runtime.ts`/0006 SQL 到 Admin+collector，public 另拷 sources+schema 后重建 `BUILD_ID=JH8WFKcKLmZKjbvBUdJlV`。回退在 `[M1-HOME]/F1-1-website/.independent-rss-0006-20260820/backup/`。首两份 generation 69 因投影 receiver 仍载旧 schema 而 `DELIVERY_REQUEST_REJECTED`；receiver 重启后第三份 `op-snapshot-c8e45aa5…` 于 16:27Z `succeeded` 并激活 139 条（Motorsport 87 / Autosport 25 / The Race 15 / RaceFans 12）。公开 feed 首页已出现 The Race；RaceFans 最新稿是 8/16，按来源时间排在后面，详情 200、media 空。未整树覆盖、未部署 B 图先行、未接 X、未提交。

## 2026-08-19

- 🔍 **第三 RSS 只读核验（随后已接入）**：当晚对照后选定 The Race 与 RaceFans；当时尚未改采集器。接入结果见 2026-08-20。The Race 生产 URL 后来改成 `/rss/`，因为 `/feed/` 会 301。
- ✅ **人工 X 链接收件箱 sidecar 已落地（未接审核库、未装 LaunchAgent）**：用户确认先推进「贴链接、定时消化」，且发现仍由人做。新增 `app/src/server/tweet-inbox/`：drop 文件入队 → 只请求官方 `publish.x.com/oembed`（`omit_script`）→ 抽出纯文本写入独立 sqlite。拒绝 cookie/RSSHub/主页 URL/iframe。现行 RSS `source` 闭集与 Admin/投影 DTO 未改。`tweet-inbox.test.ts` 7/7。本机对 `https://x.com/jack/status/20` 官方 oEmbed 一次直连成功（纯文本、无图、无 iframe）。drop 模板已写到 `~/Library/Application Support/F1Plus1/TweetInbox/drop.txt`。下一步：往 drop 贴真实 F1 公开帖并设 `TWEET_INBOX_IO=true` 再跑 `npm run tweet-inbox-once`；通过后再考虑 LaunchAgent 与审核入库。未提交。

- 🔍 **RSS 新闻主链已自动采集→初审→发布；未再热修代码。** 对照 live 审核库 `dev=16777233/ino=24570709`、`user_version=5`、`integrity_check=ok`：98 条候选全部 `published`，当前稿中文草稿缺口 0，投影 generation 33 已 `succeeded` 并激活。采集器 900s（Motorsport+Autosport，最近槽位 `rss-run-1985699` 双源 200/OK）、DeepSeek refiner 900s（最近 `idle`）、Admin 60s 自动初审+`automaticPublishBatch`、receiver 3102、public-beta 3000 均在岗。今日失败是凌晨 VPN `DNS_REJECTED`×5 + `CONNECT_TIMEOUT`×1，之后 DoH 直连已恢复；另有 05:00 `SCHEDULER_GAP`×2。未跑通的是 X/Instagram/Reddit、v5 media-policy/phase 合同、B 图先行（git 有、未部署）。v4 正在自动发布带 RSS 配图的新闻，这与 v5「有图不能自动发」合同并存，上社交图前仍须另开门，不得 silently 放宽。已把 Spec 运行时态从「自动发布为 0 / 仍需人工点发布」覆盖为 2026-08-19 事实。未提交、未改 LaunchAgent、未接 X。
- ✅ **公开站重复新闻：聚类此前未进 live，现已放宽规则并热修进固定 M1**：用户仍看到双卡，是因为 live `5d99dc95…eaed` 的 snapshot reader 还在按原始记录分页，git 里的 `event-cluster` 从未拷过去。规则也过严（6 小时、标题汉字三元组 0.28、必须 2 个词表实体）。现改为 18 小时窗口、标题 token Jaccard、拉丁别名、动作/主题族，以及主题冲突时不合并。同 `sourceId` 仍不合并。对照当前投影 98 条合成 80 张卡、18 组双源事件；首页 4 组 Autosport+Motorsport 已合成一张。只拷了 `event-cluster.ts`、`snapshot-adapter.ts`、`types.ts`、`public-api.ts` 并给 live 证据行补了第二源原文。`BUILD_ID=zMkQJ8Nr34iEwoYPx941O`。回退在 `[M1-HOME]/F1-1-website/.public-reader-cluster-20260819/backup/`。未整树覆盖，未改审核库/投影，未部署 B 图先行。`event-cluster` + `public-timeline-order` + `public-api` + `public-ui` 最近一次 39 通过（其中 public-api 两例曾因 5s 超时抖动，单独重跑 17/17）。未提交。
- ✅ **社交呈现选定 B 图先行，已收进正式时间线（未部署 live）**：新闻折叠态标题+导语+96×64 露图；社交/名宿/趣事先出主图、一句中文、展开只露原帖。不嵌 iframe。v0.2 主图 360 合同未改。未部署。
- 🎨 **事件/社交卡四版 Demo 已落盘**：`design/ui/F1+1-social-event-card-demos-20260819/`。同一条时间线对比 A 同壳、B 图先行、C 一句压图、D 挂事件。默认打开 B。无 iframe、无外链图、不改 v0.2 冻结稿、不进 app。待用户看方向。
- 📐 **用户 13:07 锁定**：时间线不嵌官方推文 iframe；社交/带图内容走「规则筛选 → 审核 → 自动发布」。不是「永远只人工点发布」，也不是「抓到就倒进时间线」。与 v4「有图不能自动发」冲突，上社交图前必须另开 media-policy successor（白名单 + 签名代理 + 0/1/4），不得 silently 放宽现行门。方向见 [proposed ADR](decisions/system/2026-08-19-F1+1-社交呈现与媒体自动发布-proposed.md)。
- ✅ **方案 1 事件卡已在 git 工作区落地（未部署 live）**：公开读路径用确定性词表/三元组把双 RSS 同一赛事新闻合成一张卡；证据行 `Motorsport.com · Autosport`，展开后第二源原文链接，详情仍保留被藏那篇。不改审核库、不新开投影 generation。`event-cluster` + `public-timeline-order` + `public-api` + `public-ui` 共 34 通过。同 `sourceId` 不合并，所以 SQLite/快照页级一致测试仍是 12+3。未整树部署。
- 🔍 **X 信源：GitHub 上没有可上生产的免费方案**。Nitter / RSSHub Twitter 路由 / RSS-Bridge / twikit 都还在，但 2026 年都靠 guest token、登录 cookie 或未文档化 GraphQL，且会随 X 改包每周碎一次。这和 Spec「不绕过访问控制」、安全部 8/2 把 RSSHub 通用路由标 Red、8/8 研究把 X 标 `needs_user_auth + needs_payment` 一致。本机 RSSHub 在跑，但生产 collector 未接线。更优路径是：59 条白名单先当目录不采集；新闻继续走 RSS；X 用官方 embed 做人工精选；若要自动监听只开官方 API + `@F1`/车队闭集 + Filtered Stream + 预算帽。未改代码、未接 X、未付费。
- 🔍 **对照 AIHOT 后的采集结论**：GitHub `KKKKhazix/khazix-skills/aihot` 只是 Agent Skill/API 合同，不是服务端采集器。公开合同能确认精选/公开池分层、`publishedAt`/`discoveredAt` 双时间、72 小时慢推信源归位、事件聚簇（`sourceCount`）、正文按权利门禁、爆文榜不进公开池。服务端实现未开源。结合 X 调研，不建议刮 X 或把 AIHOT 当上游；更优是事件卡合并双 RSS，以及把社交当信号/官方 embed。未改代码、未接外部 API。
- 📐 **三方案复评（用户 8/19 13:03）**：方案 1 事件卡可做。方案 2 社交对产品设定有价值，须用符合 v0.2 时间线的不同卡片密度呈现，不进时间线嵌官方推文框。方案 3 可做但图片是主展示；应对齐 v0.2「图片是主要展示内容」和 P-05（官方媒体 URL / 签名代理优先，不刮盘）。与现行 v4「有图不能自动发布」、公开投影 `media.max(1)` 冲突，上社交图前要先开门。未改代码。
- ✅ **Autosport 已作为第二 RSS 源接入 live 审核库**：新增 `0005_second_rss_autosport.sql`（不是预留的 v5 自动发布 0005）。隔离 live 副本先迁过，指纹 `45c3a15f…3601`；Admin kickstart 后同一 `dev=16777233/ino=24570709` 升到 `user_version=5`，76 条 Motorsport 稿未丢。采集器一次双源：Autosport `20 new`，Motorsport `14 updated / 6 duplicate`，随后 DeepSeek 补齐中文稿并自动初审。回退在 `[M1-HOME]/F1-1-website/.autosport-0005-20260819/backup/`。Formula1.com 仍 blocked；DNS allowlist 未放宽 198.18。
- ✅ **公开站已读到 generation 19（Autosport + 今日 Motorsport）**：投影 11:48 已激活 96 条（Autosport 20 + Motorsport 76），但公开读者仍只认 Motorsport schema，`/api/public/feed` 报 `PUBLIC_READ_INTEGRITY_FAILED`。只从 collector 拷了 `rss/sources.ts` + `review-real/schema.ts` + `mapping.ts` 到 public release `5d99dc95…eaed` 后重建，`BUILD_ID=ylxPSrAloiIj6vydEC2bd`。本机与隧道 feed 现为 12 条混源、按 `sourcePublishedAt` 降序，首页/详情 200。回退在 `[M1-HOME]/F1-1-website/.public-reader-autosport-20260819/backup/`。库身份仍 `dev=16777233/ino=24570709`。采集器后续槽位全 duplicate，下一条新/更新稿才会出 generation 20。
- ✅ **Motorsport 采集已用直连 DoH 恢复**：采集器绕过 VPN fake-ip，仍拒绝非公网地址。今日成功槽位含 `rss-run-1985669` 与双源 `1985671`/`1985672`。
- ✅ **公开站排序/去重 A+B 已部署到固定 M1**：切片 A `4b37f72`（来源时间排序 + cursor v2 `timelineAt`）、切片 B `6b6e4b2`（隐藏重复中文提炼）。live public release 仍是 `5d99dc95…eaed`，A+B 之后又补了双源读者热修。
- ✅ **v4 自动发布已接到 Admin 并跑通存量**：在现有 `releaseNow` 上增加 `automaticPublishBatch`（actor=`system-auto-publish-v1`，每批最多 20）。这是 v4 运行切片，不是 v5 合同。回退在 `[M1-HOME]/F1-1-website/.auto-publish-v4-20260819/backup/`。
- 📐 **v0.3-draft rev2 设计候选已落盘待确认**：`design/ui/F1+1-v0.3-timeline-increment-draft-20260818/` 含折叠露图、右侧分类下拉、赛事顶栏平时/周末两态与 `race-detail.html`。v0.2 冻结基线未改。
- 🧪 **赛事条数据层最小切片已进 `app/src/modules/race/calendar.ts`**：静态 2026 R12/R13 UTC 场次 + 六态状态机；`src/tests/race-calendar.test.ts` 7/7 通过。未接入公开 feed，避免和 A/B 热修文件缠在一起。

## 2026-08-16

- 📐 **发布视频 v0.3「光标驱动交互之旅」草案已落盘(用户直接委派,待确认)**:用户要求聚焦页面设计/交互体验/功能设计,加入动态转场、缩放与模拟鼠标操作。先完成 GitHub 调研(`screenstudio-alt-skill` 的点击簇自动 zoom/弹簧相机/合成光标涟漪/竖版跟随、OpenScreen、video-shotcraft 镜头卡库等,结论:坚持 Remotion 程序化合成主线,录屏路线仅作花絮备选),随后产出 `design/video/F1+1-launch-cursor-showcase-v0.3/`:`storyboard.md`(26 秒 7 镜头:进站→卡片特写→主题切换→详情之旅→响应式→收束,只展示公开站真实能力)、`capture-plan.md`(7 项真实交互状态采集,同一生产候选身份门,hover 必须真实渲染)、`motion-cursor-spec.md`(光标/相机 token,继承 v0.2 全部约束)、`sources.md`(调研来源与权利边界)、`decision-card.md`(5 个确认问题)。v0.2 冻结资产与合同未动;Motorsport 权利门、静音、无域名 CTA 边界不变;未采集、未渲染、未安装任何依赖。

## 2026-08-14

- 📐 **自动发布合同 APC8 首个P1已形成无环release-pair身份successor，等待APC10从头复审**：输入`scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review-apc8.md` SHA-256=`87501099946b12798ab5e6f1db437753a6a6ab58f12752bb7360884f3f8e88a7`确认APC7的双向`pairedManifestSha256`会形成不可构建SHA固定点。新增`ADR-M5-BACKLOG-AUTO-PUBLISH-003`与实施合同v0.3：full/fallback各自生成独立canonical manifest，安全role精确为`full_v5|v5_manual_only_fallback`，只共享由预冻结Git/tree、migration/schema、operation/fresh/outbox合同和Node target等兼容输入计算且不含任何最终manifest/receipt SHA的`pairContractRoot`。两份manifest封存后在两个release closure外生成`release-pair-receipt-v1`，记录两manifest最终SHA与两边release/content root；receipt最终SHA由外部task/deployment manifest锚定且不回写。M1需分别stage verifier+HTTP/DB smoke，再由独立pair verifier重算manifest/receipt；0005入口把外部receipt SHA和两manifest SHA作为不可覆盖输入。closed canonical JSON、duplicate/unknown key、0600/nlink1/realpath、no-follow FD及replacement/drift负例已冻结。001/002/v0.1/v0.2保持原字节；本次未改app/tests/DB/M1/deploy/key，runtime继续`disabled`，APC8其余first-P1-stop维度不继承PASS。
- 📐 **自动发布合同 APC6 首个 P1 已形成 v5 双层回退 successor，等待 APC8 独立复审**：输入 `scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review-apc6.md` SHA-256=`81a066974c89c6f216ba4bd14829d4c7640cda70a7a063be9be3252e627b88dd` 确认现行 v4 opener/repository/collector 无法安全打开或写入 v5，原“回到现行 manual-only runtime并忽略v5附加表”主张不可执行。新增 `ADR-M5-BACKLOG-AUTO-PUBLISH-002` 与实施合同 v0.2：0005 COMMIT前故障只事务回滚并复核精确v4；COMMIT后普通代码回退只能切同候选、预构建且stage演练通过的`v5-manual-only-fallback`，旧v4永不打开v5。fallback完整理解v5 closed union/fresh/outbox producer，保留人工HTTP review/publish/correct/withdraw、fresh pause/stop、只读状态和producer合法outbox的same-delivery sender；硬禁internal auto/system auto、进入或恢复backlog/live、collector/refiner/自动worker与collector网络。迁移前备份恢复只作显式丢失窗口和audit fork的灾难恢复。001/v0.1保留不可变历史，本次没有新增用户产品选择，也没有改app/tests/DB/M1/部署/密钥；full/fallback、0005和运行验收仍未实现，runtime继续`disabled`。
- 📐 **自动发布合同 APC4 首个新 P1 已完成产品修订，等待 APC6 独立复审**：输入 `scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review-apc4.md` SHA-256=`3424c861bbf823bcce1366e14d61a2452c18a1756165422a03e939c4eeb05768` 已确认 APC2 原子栅栏关闭，并指出 operation channel/actor/fresh/legacy provenance 仍非 closed union。ADR、实施合同和 Spec 现冻结 `http_post|internal_auto_review|internal_auto_publish|legacy_http_shaped_unknown` 四通道矩阵：所有 phase control 只允许 manifest operator 的 HTTP fresh WebAuthn，且六值 controlAction 绑定 request/resource hash、fresh evidence和phase audit；auto-review revision/approve/reject 只允许 `system-auto-review-v1` internal；auto publish batch 只允许 `system-auto-publish-v1` internal；任何交叉写前拒绝。internal HTTP 字段全 null并使用 closed result DTO，旧 HTTP-shaped 行保持原字段且 provenance unknown。v5 重建 admin_operation/audit_event 会改变物理字节，合同只保证旧字段值与 canonical audit chain/FK/sequence相等；高风险 HTTP operation 持久绑定 fresh evidence与actor。本次仍未改 app/DB/M1/部署，runtime 继续 disabled，实现状态不升级。
- 📐 **自动发布合同 APC2 首个 P1 已完成产品修订，等待 APC4 独立复审**：输入只读安全报告 `scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review.md` SHA-256=`77675c89fd820ca25ea619f62cc5abda0a7371fa3458fbc0d929af1fd6ca3dec` 指出 `disabled→backlog` 与 collector claim 之间存在 TOCTOU。ADR、实施合同和 Spec 现冻结同一 review DB 的单一 writer-lock 栅栏：phase 事务必须在一个 `BEGIN IMMEDIATE` 内重读 singleton/source fence、证明 0 running slot并一起写 cutoff/phase/audit；collector claim 必须在自己的 `BEGIN IMMEDIATE` 内先读 singleton，`backlog|paused` 时 0 slot并在 DNS/socket 前 `externalCalls=0` 返回。barrier 验收固定覆盖 claim 先锁与 phase 先锁两种次序；已在 disabled claim 的 collector 必须先提交 terminal，新的 phase 事务才可成功。本次仍只改产品文档，没有修改 app/DB/M1/部署；runtime 继续 `disabled`，实现 P1-blocker 未升级。
- 📐 **存量优先确定性初审→条件自动发布 successor 已 accepted，实现仍是 P1-blocker**：产品部依据只读差距审计 `scratch/TASK-20260814-AUTO-PUBLISH-GAP/audit.md` SHA-256=`b989068960bb02d98b6e3f7565eef2f9587b9e4f15b41a35d9ac6a39090d4f88` 和 2026-08-14 当前主会话用户授权（message ID unavailable），新增 [ADR-M5-BACKLOG-AUTO-PUBLISH-001](decisions/system/2026-08-14-F1+1-存量优先确定性安全初审与条件自动发布-successor-accepted.md) 与[实施合同 v0.1](spec/F1+1-存量优先确定性安全初审与条件自动发布实施合同-v0.1.md)。决定只开放现有白名单源的 strict schema/URL/media identity 与 ASCII C0/C1/bidi 控制符闭集；unknown source/URL/media/policy 均 fail closed，不声称事实核查、版权判断或广义内容审核。当前 v4 没有 rights/license/policy 机器字段，所以非空 media 固定 `MEDIA_POLICY_UNKNOWN`/`waiting` 并阻止系统发布/live，只有当前无 media candidate 的精确 0 图路径可通过初版 media/policy 门。运行合同为 `disabled|backlog|live|paused`、默认 disabled、v5 additive singleton/cutoff/max20；backlog 时 collector 在 DNS/socket 前零外联，oldest-first 处理 cutoff 存量，`waiting|manual_override|failed` 阻止 live。`system-auto-publish-v1` 只发布当前 source revision/full hash + latest Bundle + approved Decision + queued Publication 全 CAS 一致的项，不扫 raw queued、不伪造 fresh receipt；人工按钮仍需 fresh WebAuthn。每批只有一份全量 snapshot/outbox，unknown 只 reconcile 同一 delivery，public 保持 last-known-good；存量清零后下一自然 900s 才恢复抓取。本次没有修改 app/测试/DB/M1/部署/密钥；M1 仍 `user_version=4`，实际自动发布为 0。
- ✅ **自动初审、拒绝原因回看和人工恢复已在固定 M1 启用**：规则只检查现有严格数据合同和不可见/双向文本控制字符；缺中文稿保持等待，安全通过只进入 `approved + Publication queued`，公开投影仍需人工发布。生产 catch-up 对 37 个当前来源版本全部通过、0 安全拒绝；另 15 个缺失当前中文稿由 DeepSeek 批处理补齐，最终 `missingCurrentDrafts=0`。生产状态为 candidates 39（approved 37 / published 2）、decisions approved 45、publications queued 39 / published 6；`published_projection=6`、`projection_outbox=6` 与启用前零漂移。collector/refiner 均恢复 `StartInterval=900s` 且主动周期 exit 0；Admin/receiver/public 继续分别只监听 `127.0.0.1:3101/3102/3000`。自动或人工拒绝继续保留原因；人工恢复生成新 revision，同一来源版本不会再次自动打回。
- ✅ **RSS 采集回滚故障已修复并在固定 M1 完成真实成功周期**：定位到 Motorsport feed 会精确回放历史 payload；旧 collector 会为同一候选/历史 payload 再插一条媒体版本，触发 `RSS_MEDIA_IDENTITY_INVALID`，并把整个 20 条事务降级为 `SQLITE_FAILURE`。`RssRepository` 现把精确历史 payload 回放计为 duplicate、保留当前较新 revision；隔离数据库逐条复现锁定 5 个冲突项，focused Vitest 9/9 与 Node24 typecheck 通过。M1 live collector 补丁 SHA=`de681481…39d3`，旧字节备份在 `[M1-HOME]/F1-1-website/.rss-collector-fix-20260814/backup/repository.ts`；真实 run `rss-run-1985203` 成功，50 条源记录中选取 20 条，`updated=12 / duplicate=8 / new=0 / externalCalls=1`，900 秒 LaunchAgent 保持加载且 last exit=0。
- ✅ **`REVIEW_CHINESE_REQUIRED` 已改为可操作中文反馈，当前中文草稿积压清零**：Refiner 从只处理 `pending_review` 扩为处理 `pending_review/approved/published` 的缺当前版本草稿项；Admin 单条与批量发布在发请求前显示“等待中文整理”数量，继续保持整批全成或全不成。修复部署后先补齐原有 3 条缺口，再在真实 RSS 成功周期后逐条补齐 12 条新版本草稿；每条均取得 `deepseek-chat` generated 收据且恰有 1 次外调。最终 39 个候选在各自当前 source revision 上的 DeepSeek 草稿缺失数为 0；DB 保持同一 dev/inode、`user_version=4`、`integrity_check=ok`。Admin、receiver、public 与 Quick Tunnel 均保持原有 loopback/运行边界。
- ✅ **审核台发布状态与批量发布修复已部署到固定 M1 Admin**：只在现行 Admin release `c8e1b263…097a` 原子替换 `index.html`、`app.css`、`app.js`、`repository.ts`、`schema.ts` 五个文件，并仅 `kickstart` `com.f1plus1.admin-service`。Admin 从 PID 18023 更新为 PID 25127，继续唯一监听 `127.0.0.1:3101`；固定 Tailscale 页面与新静态资源均返回 `200/no-store`，未认证 session 正确返回 `401`。候选已关闭来源更新后旧 Bundle 误用、批量范围/反馈、待审核与已发布混排、同候选多版公开投影并存四类问题；生产备份位于 M1 `[M1-HOME]/F1-1-website/.admin-review-fix-20260814/backup`。review DB 保持同一 `dev=16777233/ino=24570709`、`user_version=4`、`integrity_check=ok`，public-beta、receiver、Quick Tunnel 与 RSS jobs 的 PID/状态未因部署改变。真实 Face ID/Passkey 单条与批量发布仍需用户在 iPad/M5 页面执行，部署过程没有代替用户发布内容。
- ✅ **审核台一键/批量通过已部署到固定 M1 Admin**：只覆盖 live Admin release `c8e1b263…097a` 的 9 个审核 UI/后端文件并 `kickstart` `com.f1plus1.admin-service`。新 PID 监听 `127.0.0.1:3101`；public-beta 3000 与 receiver 3102 未动。回退副本在 M1 `[M1-HOME]/F1-1-website/.admin-quick-release-20260814`。iPad 需硬刷新同一 Tailscale Admin 入口。
- ✅ **审核台一键/批量通过**：详情主按钮改为「通过并发布」（保存当前中文稿 → 批准 → 一次通行密钥提交投递）。队列支持勾选已有审核版本的候选，一次批量通过并发布最多 20 条，仍只生成一份公开快照。旧的「仅批准 / 拒绝」保留。未改自动发布。










































## 2026-08-13

- ✅ **小范围可读性收口（本机代码）**：公开时间线不再把摘要复制成「中文提炼」；少于 12 条时不再显示「已经到底了」。新发布会把 DeepSeek `keyPointsZh` 写入公开投影，Admin 详情显示草稿要点。新增 `rss/catalog.ts` 作为下一刀信源清单（Autosport / RaceFans / 手工投递 ready，Formula1.com blocked）。未改 M1 运行库、未新开真实采集、未自动发布。
- ✅ **公开站已严格回归用户确认的 v0.2 冻结视觉并部署到固定 M1**：设计身份为 `design/ui/F1+1-v0.2-全站设计/F1+1-v0.2-final-20260808.html`，SHA-256 `5a84bfb2…8cb1`；提交 `52e6549…` 已普通非 force 推送。M1 当前运行内容寻址 release `5d99dc95…eaed`，`public-beta` 只监听 `127.0.0.1:3000`，health 继续为 `accepted-public-real-snapshot`；Admin 3101、receiver 3102、review DB、projection generation 1 与 Quick Tunnel 均未修改。主页和独立详情已统一回无外框的时间线视觉，移除五分类按钮、灰色原生按钮/卡片、breadcrumb、status badge 和可见 `PUBLIC API` 技术标签；真实中文标题、中文摘要和来源图片保留。生产 URL 同一候选已完成主页/详情 × 深浅 × 390/1024/1440 共 12 格截图与 DOM 门，横向溢出、分类控件、breadcrumb、status badge、可见旧技术标签均为 0；实体 iPhone/iPad Safari 最终主观复看仍由用户完成。详细收据见 [部署报告](collaboration/部门/开发部/报告/2026-08-13-53677C-公开站v0.2冻结视觉生产部署报告.md)。
- ✅ **第一版真实内容闭环已在固定 M1 上形成并对外可用**：真实 RSS 继续按 `900s` 周期采集，候选进入同一 owner-only SQLite 审核库；DeepSeek 中文整理、人工修订、批准、fresh re-auth 手动发布、单 sender 投递、generation 1 签名投影与公开 reader 已完成一次真实业务闭环。当前已发布文章具有中文标题、中文摘要、原文链接和真实 HTTPS 来源图；公开 feed、详情 API 与详情页均返回 `200`，Admin/internal 路由在公网继续为 `404`。
- ✅ **Admin 私有入口与双移动端已实机可用**：Admin 固定入口为 `https://[PRIVATE-ADMIN-HOST]`，只经 Tailscale Serve 到 M1 loopback `127.0.0.1:3101`；receiver 为 `127.0.0.1:3102`。唯一 review DB 已在原 dev/inode 上迁至 `user_version=4` 且 `integrity_check=ok`。用户已在 iPhone 与 iPad 通过同步 Passkey/Face ID 实际进入后台；两台设备仍分别绑定独立 Tailscale 设备身份与 session。M5 浏览器采用同一同步 Passkey 流程，但本轮没有用户实机完成收据。
- ✅ **公开真实站已切换到内容寻址 release 并完成移动端修复**：发布分支 `codex/first-public-release` 当前为 commit `fb0a938fa42fe9d28a8fe675aa963d5ba715aabb`，远端已同步；M1 live release root 为 `a7540b2e25cd88874986fcf3197ec8cabebc3886f956bdf6c875c5c949c94e3c`，health data gate 为 `accepted-public-real-snapshot`。来源图现在渲染真实 HTTPS 图片，公开文案已移除 synthetic 误导语义；公开页与 Admin 已分别修复 390px 长 ID/壳层宽度问题。390px 设备仿真复验中首页和详情 `document.scrollWidth=390`、越界元素为 0，真实图片自然尺寸为 `1200×799`。
- ✅ **备份在 schema v4 上继续运行**：M5 异机加密备份已在发布后得到新的 `backup-complete`，数据库 `integrity=ok`、`userVersion=4`，并通过 runner 内置的随机隔离解密与 SQLite 校验。当前备份闭包仍只覆盖 review SQLite，没有把 Public `active.json`/generation 文件纳入同一恢复点；因此只能宣称数据库可恢复，不能宣称公开投影灾难恢复已完整闭合。
- ⚠️ **当前对外地址边界**：公开站仍使用 Cloudflare Quick Tunnel，地址可能随隧道重启变化且无 SLA；Admin 的 Tailscale HTTPS 地址已经固定在 tailnet 内。自有域名、公开投影同边界备份、M5 实际 Passkey 登录确认和更多真实文章属于后续加固，不阻断当前初版核心闭环使用。

## 2026-08-12

- ✅ **M1 Admin/投影当前时态已同步，运行出口仍未闭合**：`F3FA8B/B5FA49/B91E89/34285A` 已关闭 deployment-v3、四根解耦、唯一固定 review DB existing-only opener 与 Serve app-cap parser 的本地候选；正式静态 Admin UI 及两项 P1/busy P2 也已闭合。`F031E2` 已在固定 M1 原子固化并验签未加载 `8e70b2b7…30a` release；`C0BACB` 证明唯一 review DB 为 v1/integrity ok、旧 synthetic rollback 与 live plist 可读，3101/3102 无 listener，Admin/Public roots、keypair、deployment 不存在，CertDomains=0、Serve/Funnel 空、目标 app-cap=0。因此 50 项 Function 计数保持 `20/6/24`，未运行用户出口不升级。当前唯一用户门是提供受控 capability DNS 域名并授权受限管理面只读核验真实 login、M5/iPhone selectors、device approval、Grants/shared-node、policy hash 与 CertDomain；通过后才可受控生成 key/sourceRefs/opaque refs，再依次 preflight、prepare-only、load、Passkey 双端、generation 1/manual publish 与 public cutover。

- ✅ **真实审核后端本地候选已完成，产品真值已机械对齐，尚未部署**：数据七表与 mapping、Review Repository/route facade、ProjectionReceiver、PublicSnapshotRepository 和完整 `sqlite_schema` 启动指纹均已落地；唯一端到端临时库正例、固定 Node24 typecheck 与最终限定安全门已有 `C334CE/739DF6/7B47E0` ACK 收据。产品合同的三个客户端 Bundle CAS 字段现与 schema 一致：`latestBundleVersionTag`、`bundleVersionTag`、`approvedBundleVersionTag`，均为 12 位小写十六进制，完整 64 位 hash 继续只由服务端复算和关联。九项 Admin/恢复 Function 继续为 `P1-blocker`：固定 M1 真实库尚未迁移，正式 opener/HTTP server、Tailscale/passkey、Admin UI、投递回执运行和 public origin 切换均未完成；当前公网仍只读 synthetic，真实自动发布为 0。

- ✅ **真实 RSS 候选到人工审核、显式发布和独立公开投影的唯一最小 successor 已接受**：固定 M1 的 `rss-real-private` 已有一次真实 HTTP 200 采集、一次 RunAtLoad 去重和一个零手动触发的自然 900 秒周期收据，共保留 20 条 `pending_review` 候选，现有 public synthetic 数据零漂移。产品 `TASK-20260812-28FA62` 冻结 candidate-first 主链：在现有三表后只追加七张审核/决定/发布/私有投影/outbox/operation/audit 表；批准精确生成 `1 Decision + 1 queued Publication + 0 Projection/Outbox`，用户第二次显式手动发布才生成私有 PublishedProjection 与唯一全量 `snapshot_sync` outbox；公开 `/` 与 `/stories/{publicId}` 只读独立 active snapshot。后端第一切片可立即实施，`/admin/reviews` UI/CSS 仍等待视觉 successor 的用户确认。当前公开站仍是 synthetic Beta，真实自动发布为 0；未来各周期稳定性、已有非空人工字段遇真实更新的动态保护、真实审核/发布代码、公开 snapshot reader、Mac/iPhone 私有入口与双主机实机均未验证。

## 2026-08-11

- 🌐 **第一版公开 synthetic beta 已通过 SSH 部署到固定 M1 并形成常驻公网入口**：发布分支 `codex/first-public-release` 已同步 GitHub，M1 非 iCloud 运行目录以精确 release package 部署；官方 arm64 Node 24.18.0、一次 `npm ci`、一次 bootstrap、一次 production build均通过。`com.f1plus1.public-beta` 与 `com.f1plus1.quick-tunnel` 正在运行，`com.f1plus1.receipt-refresh` 按 12 小时计划且 last exit=0；应用只监听 loopback。常驻临时地址为 `[EPHEMERAL-TUNNEL-URL]`，公网 home/detail=200、Admin session=404。M1 当前接交流电且 AC/电池 `sleep=0`。该 URL 属 Quick Tunnel，重启可能变化、无 SLA，中国大陆异网可达性仍需真实手机网络验证；真实采集、AI 摘要、Admin UI 和自动发布仍未上线。运行与回退见 `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md`。
- 🚀 **用户已选择固定 M1 MacBook 作为第一版临时 beta 主机，部署必需缺口已在 release 分支关闭**：已创建 `codex/first-public-release`。只读预检确认 UU 远程中的目标设备在线、为 arm64，已安装 Git、Homebrew Node/npm 与 gh；现有 Node 为 22.23.1，目标部署必须换用项目固定 Node 24.18.0。新增两份可公开的纯 synthetic legacy SQLite bootstrap 资产、原子 0600 本地安装入口、legacy receipt 自举与每 12 小时刷新入口、M1 用户级 launchd plist 生成器；production proxy 对公开 profile 增加 GET/HEAD 路径 allowlist，Admin 和其他路径统一 404。新代码固定 Node24 typecheck PASS；唯一 production build PASS；最小真实 HTTP 为 health/home/detail=200、Admin=404，随后服务和 3000/3001 已清理。公网隧道/域名仍待确定，尚未宣称公网已上线。
- ✅ **第一版公开站已形成最小 production 可部署候选，公网目标待确定**：`TASK-20260811-BB3641` 已在不重复 lint/typecheck/build/全量测试的前提下复用唯一 production build，完成首页、24 条双页 feed、分类筛选、详情 API、详情页 SSR 加载壳及真实缺失内容 404 的最小 HTTP 闭环；服务已停止，3000/3001 端口和运行期 SQLite sidecar 已清理，三份 canonical DB 与 `package-lock.json` 字节零漂移。放行范围仅为 `public-multimedia-synthetic` 公开只读站，内容仍为 synthetic；Admin API/页面、真实采集、自动发布及未完成的 390px 设计 successor 不进入本次候选。下一步只需确定独立云服务器或固定 M1 临时 beta 二选一，再按 `docs/runbooks/F1+1-第一版快速上线部署方案-v0.1.md` 执行公网部署、最小上线探针与可回滚发布。

- ✅ **SOURCE-MGMT-001 本地 synthetic 后端最终安全出口已闭合并完成产品事实同步**：数据 `TASK-20260811-3D190C` 交付冻结机器 oracle；安全后继 `TASK-20260811-FAD506` 以唯一固定 Node24 harness 闭合 5/5 audit payload/event hash 与 operation 关联、两个 append-only trigger、logical content root、第二 profile owner 和三次有界 `BEGIN IMMEDIATE` contention，结论 `PASS / P0=0 / P1=0 / P2=0`，并由统筹 ACK。closed DB SHA=`ddf3778c…e939`、logical root=`7cae9bb8…e6a`、正式 DB handle=0、`externalCalls=0`、零临时残留。产品 `TASK-20260811-0345AC` 随后完成并 ACK `docs/spec.md` 与初版功能矩阵的事实同步：raw 后端/API 已完成，但 `SOURCE-MGMT-001` 总状态继续为 `P1-blocker`，剩余出口严格收敛为当前视觉确认、真实 `/admin/sources` 页面实现，以及同一页面候选的设计/测试/安全三路运行验收。
- ⚠️ **当前 `/admin/sources` 四图自动恢复被执行环境阻断，改为直接交互 HTML 用户确认**：设计 `TASK-20260811-A32E0E` 的本地 Chrome 批次在首图前退出；测试后继 `TASK-20260811-E1DCF2` 复核固定 HTML SHA `0d73ea29…6d68` 与 Playwright/headless-shell 字节一致，但宿主拒绝 Seatbelt apply，唯一等价兜底又在页面创建前因 Chromium Mach rendezvous 权限拒绝以 SIGTRAP 退出。两次均未改候选、未复用旧 PNG、未建立产品缺陷；`A32E0E` 已由任务工具取代为 `E1DCF2`，`E1DCF2` 已按 `ENVIRONMENT_BLOCKED` 收口。当前不再重复同类渲染，用户可直接打开固定 [交互 HTML](../design/ui/F1+1-M5-admin-sources-preview-v0.1/index.html) 判断 Mac 表格+Drawer、iPhone 卡片+全屏详情及六操作入口；确认前不派真实页面编码。

## 2026-08-10

- ⚠️ **SOURCE-MGMT-001 测试出口已闭合，最终安全出口仍被探针假阴性阻断**：测试 `TASK-20260810-92C716` 已以 `PASS / P0=0 / P1=0 / P2=0` 完成并由统筹 ACK；单次 Node24 进程内 harness 验证 closed DB 副本 integrity、59 baseline+1 `local_synthetic`、retired/stopped/disabled 与 session destroy 后401语义，结合 A3293F 同候选真实 HTTP 和 `http.ts` 静态映射关闭测试缺口，未重复 server/build/typecheck/全量。安全 `70EC0F` 先因 `cpSync.mode` 参数误用停止；最小后继 `AD6AD9` 已修正复制+chmod，但产品对0644副本正确返回 `DB_PATH` 并写前失败关闭，harness 只允许 `DB_PERMISSIONS`，再次形成 operator assertion P1，未建立产品缺陷。错误 basename、profile/ledger/audit 内容根和第二 writer 仍 `NOT_RUN`；正式 DB SHA=`ddf3778c…e939`、`externalCalls=0`、无服务/端口/临时残留。下一步只允许安全部以语义级 fail-closed allowlist 复用已验证弱权限结果，并单次执行剩余未运行出口；禁止重复 raw/session/CSRF/identity/no-egress 与完整 HTTP 链。
- 🚧 **SOURCE-MGMT-001 raw target P1 已修复；完整实例复验已停止继续堆叠，最终缺口改为进程内收口**：开发 `875B6C` 已 ACK，raw-path 19/19与typecheck一次PASS。测试 `A3293F` 已独立验证真实 HTTP 至最终 list_after=200，唯一首错是 harness 把 `local_synthetic` 写成 `local_overlay`；`4CBFA7` 修正枚举后又在监听前因 shadow fixture 路径元数据触发 `FIXTURE_PATH`，两次均未建立产品缺陷，已分别 ACK，正式资产/外联/端口零漂移。安全 `742B8D` 已通过 raw危险路径18项、合法路径、Host/Origin/peer、内存session/CSRF/identity；`7CBD3F` 的 closed DB shadow 探针误设 `initial localRows=0`，而权威 closed DB 为59+1，产品数据一致，任务已block。为避免第三次重复完整环境和审批，后继测试 `92C716` 与安全 `70EC0F` 均禁止 server/readiness/fixture初始化：只用 closed DB物理副本做一次进程内 Repository/session/SQLite/audit核验，并复算既有 no-egress证据链。
- ✅ **`/admin/sources` 真实页面服务模型已唯一裁决并核收**：产品 `TASK-20260810-8A055D` 已完成并由统筹 ACK，唯一候选为 B——同一 Node 进程、同一 `source-management-synthetic` profile、同一 SQLite writer 与 exact-loopback `node:http` listener，raw request gate 先行，再把同一请求交给同进程 Next production handler；真实页面、Admin API、health 与 closed hashed assets 共用一个 origin。sidecar、第二进程/端口/writer、静态假数据页、孤立不可达 Next page 与 raw gate 绕过均被关闭。候选合同 SHA `7d7bf37f…a6681`，产品报告 SHA `664ef910…c135`；实施仍等待 `91AF6E` 及同候选测试/安全闭环，并等待用户确认 v2 视觉 manifest。
- ✅ **SOURCE-MGMT-001 后端开发闭环已完成并核收，进入测试/安全双路复验**：开发 `TASK-20260810-91AF6E` 已完成并由统筹 ACK；限定三文件 SHA 与冻结值一致，固定 Node24 typecheck、production build、唯一 `127.0.0.1:3019` HTTP、session/CSRF、list/add/validate/activate/stop/retire、operation、response-loss replay、closed receipt与候选/保护内容前后比对均 PASS，`externalCalls=0`。closed DB SHA=`ddf3778c…e939`，logical root=`7cae9bb8…e6a`；PID/3019/profile lock/WAL/SHM/tmp均已清理。旧测试 `2467B0` 和安全 `59C88E` 仍绑定 blocked `F1466E`，已创建精确 successor `37CA8F` 与 `A5F239` 并派回既有测试/安全窗口；后端完整核收仍等待两路同候选独立 `P0=0/P1=0`。
- ⚠️ **两张早期公开页复验任务已按真实快照漂移收口**：统筹恢复了已满足前置的安全 `TASK-20260809-22EC6D` 与设计 `TASK-20260809-379161`，两部门均只复用旧证据、没有重启页面或浏览器。五个当前实现文件已全部偏离 `34476E` 旧冻结 SHA；安全部按 `SNAPSHOT_DRIFT` 完成 `FAIL / P0=0 / P1=1 / P2=0` 并由统筹 ACK，设计部按同一失败路径 block，保留旧快照的 lightbox 焦点、React #418 与证据质量问题。旧六图和旧运行收据不能证明当前 F67080 successor；当前候选仍须在固定 M1 上形成同 SHA 浏览器矩阵后，再由设计/安全复验。

## 2026-08-09

- 🚧 **SOURCE-MGMT-001 的 no-egress/loopback 运行修复已通过聚焦安全门，现只剩五项 Node24 静态类型收敛**：产品 `TASK-20260809-95A738` 已裁决并 ACK 方案 A，开发 `BDBD33` 已落地独立 profile、59 基线只读 + local overlay、Admin API/Repository/六命令/worker，migrate、seed、readiness、5/5 与 lint 已通过；`F1466E` 又关闭了最后一处 SQLite 类型点并通过当时的 typecheck/build，但动态启动暴露 no-egress/listener 冲突。安全 `TASK-20260810-F213DE` 已完成并 ACK，冻结 guard-owned 一次性精确 loopback listener、all-aware 数组、实际地址复核和全部出站继续拒绝的合同。开发 `TASK-20260810-552BF1` 已按合同实现 guard/listener/清理并通过最终聚焦安全门 9/9及一次对抗审查；唯一最终链随后在 typecheck 首错停止，共5项固定错误：两处 `server.close` callback 类型、两处 wildcard 无交集比较、一处 `Server.closeAllConnections` 结构类型，build/3019 HTTP/closed receipt/after comparison均未运行。统筹已据收据将552BF1 block，并创建最小后继 `TASK-20260810-91AF6E`；开发部旧待批收口卡结束后即可领取。独立测试 `2467B0` 与安全复验 `59C88E` 继续 queued。
- ⚠️ **公开前端冻结候选已实现，Codex 宿主内浏览器终验以环境阻断收口**：开发候选已覆盖分类筛选、七状态、12+12 分页、失败后原位恢复、390/1024/1440 响应式和辅助技术锚点，固定 11 源码聚合 SHA 为 `7b1e8977c3e7296f4e5cf165b106bc322c2ef19dbd5e506f51e2c4ec92465281`。测试任务 `TASK-20260809-47EF67` 在 App/浏览器启动前因 Codex 宿主无法叠加 `sandbox-exec`（`sandbox_apply: Operation not permitted`，exit 71）按合同 `ENVIRONMENT BLOCKED`；浏览器矩阵次数为 0，五个 Function 全部 `NOT_RUN`，候选未被判定为功能失败。安全后继 `TASK-20260809-43AE8C` 已完成并由统筹 ACK：推荐在固定 M1 的普通 Terminal、当前用户权限下先执行不启动 App/浏览器的双 Seatbelt Phase 0；只有两份 profile apply 与精确 loopback 正/负例全部通过，才允许同一冻结 runner 消耗唯一一次功能矩阵。该路径仍需用户一次精确确认；禁止 `sudo`、安装、下载、外网、候选修改、系统 Chrome和无 Seatbelt 降级。
- ✅ **SOURCE-MGMT-001 v0.3 合同、安全与视觉候选均已核收，正式实现仍等待视觉确认**：产品 v0.3 SHA `90ee4ed30d325b7b2833582cc0ac8134aefc7fbc2dcd43ec9d20c0f726b2f1fe` 已经安全部独立复验 `PASS / P0=0 / P1=0 / P2=0` 并由统筹 ACK；现有代码落点也已完成只读可行性勘察。设计部同一正式窗口在恢复后完成 `/admin/sources` 的 1440/390、深浅主题候选、六操作/全状态交互、现行 SHA 清单和诚实时态报告，任务 `08CCEF` 已 ACK。统筹冻结 manifest 已升级为 v2，绑定当前候选、v0.3 和安全复验；四张 PNG 仍对应最后一次结构修订前的参考图，修订后 sticky actions、键盘横滚和 390 无横溢保持 `Unknown`，须在正式实现后独立关闭。用户确认前不得派正式 UI 实现。
- ⚠️ **最小人工审核台已完成后端先行 A/B 裁决，现行结论 B 要求先关闭两条用户门**：`/admin/reviews` 产品合同、111 个 DTO 槽位机器映射、approve 预留唯一 Publication 与显式 manual publish 时序均已核收；设计候选 `TASK-20260809-69BC5A` 已 ACK，覆盖编辑新版本、批准、拒绝、手动发布、published 及 conflict/stale/reconcile/blocked 等状态。产品 `TASK-20260809-DCEFF8` 已裁决并 ACK：现行合同仍要求 `ADMIN-DECISION` 与 `ADMIN-VISUAL` 同时成立，`review-synthetic` 第三物理 SQLite profile successor 仍为 `draft / user_required`，因此当前不得派后端或 UI 实现。后端的唯一解锁问题已经冻结为是否批准纯本地 loopback、manual-only、`external_calls=0` 的第三 profile 与 Admin 后端；即使获批，UI/CSS/client 仍等待用户确认现有交互候选。设计部后继 `TASK-20260809-133584` 的 8 图包因宿主渲染能力阻断，没有改动候选；用户可直接打开本地交互 HTML 判断方向，或在固定 M1 普通环境补渲染。
- ✅ **固定 M1 Mac 的旧 WPA TEMP-LOCAL v0.5 执行包已形成并核收，但既有激活门已失败关闭**：用户授权上限被固定为一次本机 loopback、synthetic、`externalCalls=0` 的预览；runbook、closed manifest、Codex/DeepSeek 交接提示词和产品报告已落盘并 ACK。v0.5 仍按自身合同保持 `WAIT_47EF67`，而 `47EF67` 已为环境 `BLOCKED`，所以该旧包不能据此复制、启动、监听或打开页面。安全部现已提出独立后继路线：用户精确确认后，在固定 M1 普通 Terminal 先做双 Seatbelt Phase 0，再决定是否进入唯一一次浏览器矩阵；它不会自动激活或改写 v0.5。网络变更、UU/SSH/FileVault/Tailscale、远程入口、真实数据与生产继续 closed。
- ✅ **VS1 本地 synthetic 三项 Function 已按最终独立证据闭合**：开发 `TASK-20260809-D6114C/3A8C0E`、数据 `TASK-20260809-5A9316`、测试 `TASK-20260809-C66A73/9D61AD`、安全 `TASK-20260809-BCF8B1/D33AF3` 的现行 ACK 链共同证明真实 `worker:mock -- --once` operator、三行 `PASS/PIPELINE_READY/externalCalls=0`、25/25 closed cases、014 有界重试、015 dead-letter、012/016A-G/017 回滚、replay/no-work 及领域事务/hash。`COLLECT-MOCK-002`、`CONTENT-PROCESS-003`、`SUMMARY-MOCK-004` 已同步为 `complete`；完成范围限固定 Node24 与本地 synthetic/V-OP 出口。Admin 队列可见性、真实 provider/Base/AI、OS/系统调用级 no-egress、非 loopback 外部 I/O、发布和部署继续 closed 或保持独立门禁。
- ✅ **Admin MacBook 已确认采用专用设备，合同吸收完成且真实实施继续关闭**：用户选择 A（专用）。新增 `ADR-M5-ADMIN-DEDICATED-MACBOOK-001` 与专用 MacBook 补充实施合同 v0.2，关闭原“专用或共用”分支；专用含义固定为无日常个人工作、独立非交互无 sudo 服务账号、具名最小运营账号、FileVault、自动登录关闭、最小软件/进程基线、私有 overlay、应用强认证、唯一写主、独立 public-host、异机加密备份及 `RTO≤4h`/`RPO≤15m`。这次确认只关闭设备隔离路线；真实 MacBook/OS/账号、FileVault、供电/睡眠、overlay、网络、密钥、备份、public-host 和 production manifest 均未配置、未验证、未授权。
- ✅ **Admin MacBook 主机落点已窄范围 accepted，真实实施仍关闭**：用户确认家中或办公室常开的 MacBook 作为独立 Admin 主机；新增 `ADR-M5-ADMIN-MACBOOK-HOST-001` 与补充实施合同，固定 Mac/iPhone 私有 overlay 访问链、MacBook 供电/禁止睡眠/合盖维护/更新重启门禁、宽带/CGNAT/overlay 故障关闭、设备丢失撤权、异机异故障域备份和 `RTO≤4h`/`RPO≤15m`。公开只读主机保持独立，端口转发、UPnP、隐藏 URL、公网 Admin/隧道在日常和应急均禁止；break-glass 只恢复私有或受控本地/带外访问。该节点当时仅余专用/共用待选，已由后继 `ADR-M5-ADMIN-DEDICATED-MACBOOK-001` 关闭；真实设备、网络、端口、密钥、备份服务和生产 deployment manifest 均未配置、未验证、未授权。
- ✅ **Admin 双端能力、入口与最终恢复硬门已按用户决策落账**：Mac 与 iPhone 必须具备全部后台操作能力，允许布局适配与高风险操作 fresh re-auth，禁止移动端功能删减；用户接受两端安装私有网络客户端，日常采用私有入口，应急只允许默认关闭的私有或受控本地/带外入口，公网 Admin 始终关闭。后续产品、设计、安全、数据、开发合同必须包含双端 Function ID 映射、真实入口/状态/失败恢复及标准级冗余/恢复方案；RTO 保持 `≤4 小时`，最终 RPO 为 `≤15 分钟`。每个后继任务必须绑定一致性备份、可证明的 `≤15 分钟` 恢复点窗口、加密异机保存、hash/manifest、隔离恢复演练和失败告警；禁止把活跃 SQLite/DB/WAL/SHM 文件复制当有效备份，也不得通过数据库双活、跨地域双活或公网入口绕过。安全部 `TASK-20260809-19F245` 已完成 C 方案安全架构候选并提交最终 PASS 报告，当前待统筹 ACK；具体备份拓扑、存储/密钥、Mac/iPhone 实机、DNS/TLS/源站 ACL、恢复演练及部署继续未验证或未放行。该决定只冻结后续合同与派单门禁，沿用现有部门窗口。
- ✅ **后续开发派单全局验收硬门已按用户要求落账**：所有开发任务必须高度贴合冻结视觉设计，并绑定精确设计版本/路径/SHA、Function ID 与矩阵行、真实入口、完整状态与失败恢复、1440/1024/390 × 深浅主题六格证据。占位、隐藏调试、DRAFT、静态复制、人工注入、组件预留、`NOT_RUN`、SKIPPED 或 TODO 均不能完成；缺视觉锚点必须 block 并退回设计部。该规则已写入 `docs/agent-guide.md` 的项目协作覆盖规则，并在 `docs/conventions.md` 设为开发开工前置；沿用现有部门窗口。
- ✅ **研究部完成 `TASK-20260809-14C467` Node 24 安全 RSS/XML 解析器最小选型**：只用 Node.js、npm registry、候选官方 GitHub 仓库/发布包源码和 GitHub Advisory Database；确认 Node 24.18.0 无内置 XML/DOM parser。唯一推荐为精确 `fast-xml-parser@5.10.1`，仅进入用户一次依赖确认后的 fixture-only disposable spike；条件回退为 `@xmldom/xmldom@0.9.10`，`saxes@6.0.0` 因官方仓库已归档而淘汰。报告逐项映射 VS-RSS-0 的 1 MiB、10,000 节点、深度 32、字段 16,384 UTF-8 bytes、20 item、完整响应拒绝、Worker 硬终止与 zero-network，并把保真配置、DOCTYPE/ENTITY 预拒绝、完整 validator、namespace URI、原子提交和独立 no-egress 收据固定为调用方硬门。独立对抗审查最终 PASS；未安装或执行候选、未改 lockfile、未发真实 RSS 请求、未改 Spec/ADR/app/data。Node 24 实跑、精确 lock、攻击 fixtures、资源峰值和系统调用级 no-egress 继续 Unknown，等待用户另行确认依赖后由开发部本地验证。

## 2026-08-08

- ✅ **研究部完成 `TASK-20260808-493D17` 首批采集路径官方证据刷新**：截至 2026-08-08 只用官方/第一方资料，直接只读复核 Motorsport.com Formula 1 RSS（50 条、均有 `pubDate` 与图片 enclosure）、Formula1.com RSS（10 条、无 item `pubDate`/图片）和 FIA News RSS（10 条、均有 `pubDate`）；形成 X、Reddit、Instagram 的授权/付费/速率/删除/摘要/图片矩阵。首条纵切建议仅保留两条 RSS 的本地低频非生产技术验证，且生产内容权利继续关闭；X 为 `needs_user_auth + needs_payment`，Reddit 为 `needs_user_auth` 且商业协议/价格 Unknown，Instagram API 为 `needs_user_auth`、consumer 发现为 `manual_only`、未经许可的网页自动采集为 `exclude`。59 条 X 白名单仍保持 identity/monitorability Unknown；仅 `@F1` 有 Formula 1 自有页面反向链接事实可交数据部复核。独立对抗审查 PASS；未登录、未付费、未绕控、未调用凭证 API、未修改 Spec/ADR/app/data。
- ✅ **协作真值与交接入口校正完成并已核收**（状态快照截至 22:19）：统筹 `4802F7`、设计 `54BB47`、开发 `9EE352`、研究 `493D17`、数据 `CAD1DB` 均已 `acknowledged`，任务系统为 `TASK_DOCTOR_OK | tasks=160 | full_history_validated=true`。产品 `00A9C9` 与安全 `33A937` 均为 `claimed`；测试部等待后继独立门禁任务。
- ✅ **用户确认的视觉 Demo 已冻结并核收**：设计部 `54BB47` 已产出不可变 HTML `F1+1-v0.2-final-20260808.html`、SHA-256 清单、1440/1024/390 深浅主题证据和 final 报告；冻结 HTML 与源文件 hash 均为 `5a84bfb27294ebd727369118a95528f5b788bfacbe2d56cc03fcb006f6168cb1`。任务已 `acknowledged`；产品部 `00A9C9` 已 resume 并正在同步最终合同。
- ✅ **两条过期任务已用任务工具正式取代**：`795FB0` → `54BB47`（最终设计冻结）；`3AF992` → 已 ACK 的 `4451C2`（生产 `npm run start` 与 `test:public-http` 已覆盖精确 `no-store`、完整 feed/detail/4xx 矩阵和零泄露）。旧阻断报告继续保留为历史证据。
- ⚠️ **`C25855` 明确保留为审计锚点**：它仍是已取代任务 `16B34F` 的 replacement；任务协议会拒绝再次取代，以防历史替代链失效。该 `blocked` 状态不代表现行启动/HTTP 仍受同一缺陷阻断；已 ACK 的 `F01A13` 覆盖 `p1-cli` 13 项启动/脱敏测试、真实生产 HTTP 闭环、`externalCalls=0` 和零泄露。R5、R12、生产部署及真实外部能力仍未放行。
- ⚠️ **2026-08-07 的 v0.2 产品合同、正式 app、测试 PASS 与安全 PASS 只覆盖早期快照**：冻结候选已形成，仍需完成最终合同、独立开发落地与新一轮测试/安全复验，旧 PASS 不自动继承。
- ✅ **设计部完成 v0.2 媒体区/悬浮按钮/设置面板多轮修订**（11 个设计任务均 `completed` + 统筹 ACK）：`5E78DB`（主图+右侧缩略图→被取代）、`F79058`（相册轮播→被取代）、`6838E5`（单主图+右下角缩略图+前往原文移入展开详情）、`3F4C36`（滑动切图含触控板双指 wheel）、`B60726`（缩略图与来源文本底对齐+前往原文同排同字号）、`DA83AC`（时间/日期对齐+中文提炼去前言）、`7B8F25`（移动端版面+修滑动翻两页）、`B8A440`（悬浮按钮无框文字）、`365A70`（摘要完整/按钮同行/缩略图底对齐）、`A71FA7`（手机端缩略图同排底对齐）、`D4F614`（主题单按钮+底部 Dock+点击外部收起+设置正式化）。
- ⚙️ **D4F614 之后主会话直接改 demo**（未走任务）：Dock 从渐变模糊改为主题背景色+顶部分割线、1024/390 功能区整体向上展开（设置内容内嵌、毛玻璃→主题背景统一）、Web 保持右下角三按钮+浮动面板、设置面板新增「客户端/宽度」（网页 1440/iPad 1024/手机 390）可见切换、安全区适配、Web 设置按钮切换 bug 修复。当前 `design/ui/F1+1-v0.2-全站设计/index.html` 即最新设计。
- 📌 **当前待办**：产品 `00A9C9` 完成最终合同 → 后继独立开发落地 → 测试/安全新快照复验；安全部正在 `33A937` 内只读形成首条 RSS 纵切的权利与入口安全门禁。设计 `54BB47`、开发 `9EE352`、研究 `493D17`、数据 `CAD1DB` 已核收。M4 部署 8 项门禁仍待用户确认，Git 工作区仍有大量未提交改动。

## 2026-08-07

- ✅ **v0.2 全站设计草案已收敛**（设计部会话，基于 TASK-20260804-795FB0 方向）：时间线优先极简——单列 920px、时间左列（时刻在上对齐分类、日期在下对齐标题）、就地展开手风琴（0fr→1fr 动画）、**单张主图（原始比例、限高、不裁切）+ 缩略图导航（悬停预览/点击固定）**、lightbox（从源图缩放放大、背景灰度+模糊、多图翻页）、展开聚焦/点击外部收起、悬停浮现 UI、44px 触控与 reduced-motion/transparency 降级。
- ✅ **接入真实内容并实测抓取链路**：Motorsport.com F1 RSS 可达可解析（50 条），浏览器端 fetch 会被 CORS 拦截（结论：真实抓取必须走服务端采集链路，网页只读）；5 篇文章页提取真实多图（2-4 张/条）；10 条真实资讯中文提炼注入时间线；无作者不显示作者段。
- ✅ **部署前准备完成**（开发部 TASK-20260807-A55149）：产出 `app/DEPLOYMENT-PREP.md`（上线前 8 项门禁、构建验证、配置要点、R2/R5/R12/R13 复核、静态预览部署、检查清单）；Node 24.18.0 工具链 + 干净环境下 `verify:env`（fixture/mock/manual_only、externalCalls=0）、`db:migrate`（SQLite 3.53.1/WAL/userVersion 3）、`seed:fixtures`（public-synthetic/v0.4/12 条、零外联、不写 Base）、`next build`（编译+TS 通过，路由 `/`、`/api/public/feed`、`/stories/[publicId]` 等）全部通过。**关键发现**：进程环境含代理/密钥/令牌类禁止变量（`HTTPS_PROXY`、`ANTHROPIC_AUTH_TOKEN`、`BRAVE_API_KEY`、`NO_PROXY` 等）会被 `verify:env` 以 `ENV_FORBIDDEN` 拒绝（R1 fail-closed 正确表现）——部署容器必须以最小化干净环境启动。
- ✅ **任务拆分派发各部门**：设计部 `TASK-20260807-CA04A8`（收尾 v0.2 草案证据）、产品部 `TASK-20260807-EA00A8`（v0.2 实现级设计合同同步）、开发部 `TASK-20260807-6CD2FB`（v0.2 落地公开信息流）、开发部 `TASK-20260807-A55149`（部署前准备）；流程：设计收尾 → 用户确认 v0.2 方向 → 产品合同 → 开发落地。
- ✅ **设计文档同步**：`design/ui/F1+1-v0.2-全站设计/design-system.md`、`brand-spec.md` 已更新为最终收敛方向（图片主图+缩略图、交互、token、响应式、证据链等）。
- ✅ **用户已确认 v0.2 方向**（2026-08-07），795FB0 登记为 `user_confirmed`；v0.2 确认门解锁 → 产品部 EA00A8（实现级设计合同同步）与开发部 6CD2FB（落地公开信息流）可正式推进。
- ✅ **规范审查整改（C3/C4/C5）**：C3 图片键盘可访问（tabindex+Enter/Space）与 lightbox 焦点管理（打开聚焦/关闭返回触发点）；C4 产出 `F1+1-v0.2-对比度验证.md`（文本 AA 全通过、`--border-strong` 由 1.9:1 修正为 3.0:1 达标）；C5 状态矩阵补 `nomore/partial/offline`（对齐 v0.1 §7.3）。
- ✅ **新增实现级交付物**：`design/ui/F1+1-v0.2-全站设计/F1+1-v0.2-token-map.json`（token/组件/状态/交互/响应式/URL 参数映射，供 EA00A8 合同与 6CD2FB 落地）；`F1+1-v0.2-对比度验证.md`（WCAG 对比度复核）。
- ⚠️ M4 应用仍不部署（正式上线需用户确认运营主体/地域/数据区域/平台条款/容量等门禁）。
- ✅ **统筹部收口**（本会话）：核收 4 个待核收回报——`7A9C48`（开发部 VS-0 启动参数/CLI 泄漏整改）、`EFA8A7`（数据部 v0.4 公开演示资讯领域映射包）、`3294F5`（开发部 390px 筛选弹窗局部滚动整改）、`538692`（开发部 公开前端 API 单一数据源接线）均 `TASK_ACK`；统筹部收件箱清空。
- ⚠️ **A55149（部署前准备）实物已完成但任务未正式收口**：`app/DEPLOYMENT-PREP.md` + 构建链验证全绿已核实，但 TASK JSON 仍 `queued`、report 为空；待开发部线程补正式收口报告 + `TASK_STATE_OK` 后由统筹核收。
- 🔎 **全局活动任务盘点**：待领取——产品部 `EA00A8`（实现级设计合同，关键路径）、开发部 `6CD2FB`（v0.2 落地，依赖 EA00A8）、设计部 `CA04A8`（收尾证据）；阻断——开发部 `3AF992`（no-store）、`C25855`（安全启动收据，待补正式收据）；等待输入——设计部 `795FB0`（方向已确认）。下一步解锁点不变：EA00A8 合同 → 6CD2FB 落地。
- ✅ **并行波 1 完成并核收**：产品部 `EA00A8`（产出 `design/ui/F1+1-v0.2-实现级设计合同.md`）、设计部 `CA04A8`（补齐 1024 宽深浅证据，`evidence/` 6 张齐备）、开发部 `A55149`（部署前准备正式收口）均 `TASK_STATE_OK` 并由统筹 `TASK_ACK`。
- ⚠️ **合同回指设计部 6 处草案交互缺口**（详情图集 vs 顶部图集、`+N` 截断、lightbox 无关闭按钮/焦点陷阱、`--blur` 18 vs 16、验收宽度档、`open` 深链语义）；设计部收尾同时记录 `brand-spec.md` token 漂移（`--blur` 18 vs 16、玻璃透明度、Display 字重）。均为设计草案与合同的对齐项,不阻断 6CD2FB(开发按合同实现),列为设计部后续核对。
- 🚧 **并行波 2 启动**：开发部 `6CD2FB`（将 v0.2 时间线设计落地到公开信息流前端）已解锁（EA00A8 合同就绪），正在执行。落地后派测试部/安全部体验视觉验收与独立安全复验。
- ✅ **并行波 2 完成并核收**：开发部 `6CD2FB` v0.2 时间线落地公开信息流（重写 `feed-experience.tsx` 为时间线+主图+缩略图+lightbox+7 状态，新增 `hash-params.ts`/`timeline-search.ts`，`globals.css` 加 OKLch 深浅 token；DTO/Repository/API 未改）。`npm run check` 全绿（精确 Node 24.18.0/npm 11.16.0 + `env -i` 干净环境，67 tests/lint 0/typecheck/build 静态/tests:p1），`externalCalls=0`，统筹 `TASK_ACK`。
- ⚠️ **实现与合同的 6 项偏差（有理由、未绕过 M4，已记入开发部实现报告）**：① 主图/lightbox 用 tone 渐变 data-URI 合成占位图（M4 media 仅 synthetic/display-only）；②「前往原文」当前禁用态（DTO `originalLink` 恒 null，保留真实 `<a>` 分支）；③ 作者 unknown/空隐藏；④ 搜索置于顶栏仅首页；⑤ 原生 `<img>` 替代 `next/image`（lint 留 3 条警告）；⑥ localStorage 键改 `f1p1-theme`。
- 🚧 **并行波 3 已派发**：测试部 `TASK-20260807-4451C2`（独立验收：功能矩阵/HTTP 闭环/对比度复核/1440·1024·390 三档视觉证据/可访问）、安全部 `TASK-20260807-F01A13`（独立安全复验：M4 门禁保持/externalCalls=0/无 token 泄露/REAL_* fail-closed）。
- ✅ **并行波 3 完成并核收**：测试部 `4451C2` **PASS / P0=0 / P1=0 / P2=1**——功能矩阵（Playwright 64 断言）、HTTP 闭环（`test:public-http` 全绿、externalCalls=0）、对比度 8 项达标、三档视觉证据（`scratch/visual/` 1440/1024/390 + 11 张）、可访问抽查通过；P2：reduced-motion 下手风琴 240ms 过渡未归零（记录建议）。安全部 `F01A13` **PASS / P0=0 / P1=0 / P2=2**——无外联（仅 data-URI xmlns 非网络）、REAL_* fail-closed、服务端 9 个冻结 hash 与快照逐字节一致、无密钥/日志泄漏、6 项偏差逐项安全评估；P2：前往原文 URL scheme 校验建议、工作区杂项目录清理建议。
- 👀 **待用户体验确认**：v0.2 时间线已实现并过三关（产品合同/测试验收/安全复验）。三档视觉证据可直接打开预览 `scratch/visual/`（1440/1024/390 PNG），或本地 `npm run start`(public-synthetic) 体验实际页面。

## 2026-08-06

- ✅ 务实本地技术闭环：本地公开站点已可运行（`npm run start` 生产模式 + `public-synthetic` profile）。新增 gitignored `app/.env` 翻转到 public-synthetic（`F1_DATA_PROFILE=public-synthetic`、`F1_DB_PATH=.local/f1plus1-public-synthetic.sqlite`、`SOURCE_FIXTURE_PATH=../data/mvp-contract-v0.4-public-synthetic/fixtures.public-synthetic.json`），`db:migrate` 生成库、`seed:fixtures` 幂等写入 12 条 `public-demo-*`、`runtime:assert-ready` ready；固定 Node 24.18.0 下 `npm run check` 全绿（verify:env → db:migrate → seed:fixtures → runtime:assert-ready → 64/64 测试 → lint → typecheck → build → test:p1）。浏览器演示以 `npm run start` 验证：`/`、`/stories/public-demo-*`、`/api/public/feed` 均 200，Ctrl-C(SIGINT) 退出码 130 属正常。
- ✅ 新增 `npm run test:public-http`（`app/scripts/public-http-acceptance.ts`）：对 `http://127.0.0.1:3000` 跑真实 Next HTTP 矩阵，全部通过——health `accepted-public-synthetic`/`12-public-synthetic`/`externalCalls=0`；feed 200/12 条/`publishedAt DESC + publicId DESC`/page=12/hasMore=false/nextCursor=null/每条 DTO 精确 11 键；4 个 category 筛选、source 筛选、未知 source 0 条；正向游标翻页 11 条且首条排除；非法 query/cursor 400 closed Problem（`PUBLIC_QUERY_INVALID`/`PUBLIC_CURSOR_PAIR_REQUIRED`/`PUBLIC_CURSOR_INVALID`/`PUBLIC_CURSOR_SCOPE_MISMATCH`）；有效详情 200、未知 publicId 404 `PUBLIC_STORY_NOT_FOUND`、非法 publicId 400 `PUBLIC_ID_INVALID`；全部 `Cache-Control: no-store`、无 `Access-Control-Allow-Origin`、Problem 精确键集。零泄露改为按 DTO 字段 allowlist 递归检查、只输出 `{absolute_path,scheme_url,runtime_keyword,unexpected_field}` 计数的安全分类器，全部为 0，结构性消除上次对 `synthetic.invalid`/`token` 的误报。
- ✅ 代码整改：`app/scripts/serve.ts` 修复 TS7053（第 2 行引入 `OutgoingHttpHeaders`、第 81 行 `headers` 加类型注解），并修复代理监听失败（端口占用）时未停止 Next 子进程导致进程悬挂的问题（proxy `error` 后追加 `stopChild(child, "SIGTERM")`）。测试同步：隔离 app 副本不再复制 gitignored `.env`（恢复其 m3-shadow 基线）；P1 失败信封测试改为断言 serve.ts 的结构化启动失败收据 + runSafeCli 信封两行输出（两者均保持脱敏），真实 CLI 子进程超时 10s→30s 覆盖 `next start` 冷启动；`react-hooks/set-state-in-effect` 2 处改为 React 推荐的 render-time 状态调整模式（`feed-experience.tsx`、`story-detail-experience.tsx`）。
- ⚠️ 发现：Next 16 dev（Turbopack）会在其 dev-server 子进程注入 `NODE_OPTIONS=--enable-source-maps --max-old-space-size=8192`（`next/dist/cli/next-dev.js`），与应用 R1 fail-closed 拒绝 `NODE_OPTIONS` 冲突，导致 dev 模式下公开 API 路由返回 `ENV_FORBIDDEN`；生产 `npm run start` 不注入该变量、不受影响。浏览器演示因此走 `npm run start`，dev 模式这一限制不构成本地站点不可用，已在本条目与 handoff 记录。
- ℹ️ 本条目是务实本地闭环，不是正式任务门禁：`TASK-20260804-AC25D4`（Repository/feed/detail API）状态保持不变（claimed/未交付），本闭环不替代其测试/安全复验与新快照定向回归。v0.1 视觉保持原样，v0.2 视觉落地待用户在设计部会话确认 Open Design brief 后另行执行；admin 审核队列/信源管理、真实 Base/provider/采集、AI/媒体、自动发布、部署、R5 决策、R12 no-egress 继续关闭。

## 2026-08-04

- ✅ 公开前端 P1 整改后的 10 文件精确快照已完成独立核收：测试部 `TASK-20260803-5991EE` 与设计部 `TASK-20260803-8C9709` 均为 `PASS / P0=0 / P1=0 / P2=2`，并已由统筹部 ACK。固定 Node24 的 51/51 测试、lint、typecheck、build、390/1440 深浅主题、四项原 P1、0/1/3/12、详情 44px、共享 Shell、主题保持、HTTP 200/200/404、console 与零外部资源均有独立证据。该 PASS 只适用于被核验快照；VoiceOver/NVDA/TalkBack 实机、原生 200% 缩放、真实 forced-colors，以及迁移到 `public-demo-*`、SQLite/API 单一数据源后的新快照继续待定向复验。
- ⚠️ v0.4 公开数据机器合同首轮独立门禁已完成且两份 FAIL 报告均已由统筹部 ACK：安全部 `TASK-20260803-8C85B4` 为 `P0=0 / P1=4 / P2=1`，测试部 `TASK-20260803-FB0D41` 为 `P0=0 / P1=1 / P2=1`。当前正常 fixture、12 套发布图、v0.3 11 项与 M3 59×39/e7a8 零漂移证据保留；FAIL 由 decision fence 可分裂、manifest/profile 语义未封闭、DTO mapping 可改指内部 URL、生成器输出 symlink 越界覆写，以及依赖待退役 app 输入且实际使用内嵌 STORIES 五类 P1 导致。
- ✅ v0.4 五类 P1 整改链已闭环并由统筹 ACK：数据部 `TASK-20260803-D53BF3` 建立 data-native 单一输入、exact decision fence、封闭 manifest/profile/ledger、DTO allowlist 和 symlink-safe 原子写；后继安全 `TASK-20260804-0AEACE` 与测试 `TASK-20260804-00972D` 均为 `PASS / P0=0 / P1=0 / P2=1`。首轮两份 FAIL 保留可追溯；测试 P2 为原生 Draft 2020-12 引擎未安装，安全 P2 的运行时四 root pin 已由后继 SQLite 实现关闭。
- ✅ 双 profile SQLite 与稳定启动链已核收：开发任务 `TASK-20260804-253A43` 完成物理隔离 migration、profile ledger、四 root pin 与原子 seed，开发任务 `TASK-20260802-3760F6` 收敛 Next 后置错误输出；测试 `TASK-20260804-9F2DAD` 对 SQLite 与启动均为 `PASS / P0=0 / P1=0 / P2=0`。安全 `TASK-20260804-B9D885` 的历史 FAIL 发现 `NODE_ENV=test` 可达任意数据库覆盖 P1；该缺陷由 `TASK-20260804-A01DF7` 最小整改，并由 `TASK-20260804-A1A095` 以真实 CLI 复验为 `PASS / P0=0 / P1=0 / P2=0`，上述实现与审核任务均已 ACK。
- 🚧 开发部已领取 `TASK-20260804-AC25D4`，当前仅在 accepted ADR 内实现 projection-first `PublicStoryRepository`、`GET /api/public/feed` 与 `GET /api/public/stories/{publicId}`。该任务仍为 `claimed`，接口尚未交付或放行；前端 API 接线、admin、真实 Base/provider/Collector、平台采集、AI/媒体、外部发布、部署和付费继续 pending/closed。

## 2026-08-03

- ✅ 用户已确认公开后端的两个产品决策，产品部据此创建不可原地改写的 [ADR-M4-PUBLIC-READ-001 accepted](decisions/system/2026-08-03-F1+1-公开读模型与API接线-v0.4-successor-accepted.md)：`m3-shadow` 与 `public-synthetic` 使用两个物理隔离的 profile/SQLite 文件；M3 59×39、59 条 disabled、权威 hash `e7a831…9f17` 和 v0.3 artifact 保持冻结；12 条公开 synthetic 采用最小 `mvp-local-v0.4` successor 与 `public-demo-*` 身份。accepted 合同同时冻结 projection-first read、feed/detail closed DTO、page size 12、筛选绑定 cursor、Problem reasonCode、迁移/回退与三类失败关闭；未修改 app、data、design 或既有 accepted 正文。
- 🕘 历史节点（2026-08-03 当日）：v0.4 accepted 当时只完成产品/系统合同门禁，数据机器合同和后端尚未实现；其后数据整改复验与 SQLite migration/seed 已按 2026-08-04 顶部条目闭环。
- 🔒 真实 Base/provider/Collector、平台采集、AI 摘要、真实图片/原链、自动/外部发布、部署、付费、生产认证和跨网络 admin 继续 closed。API 完整性失败不得降级到 `DEMO_STORIES`，`public-synthetic` 不得反写 M3 或 Base。

## 2026-08-02

- ✅ 首批公开前端最初在 2026-08-02 完成编码与主机验收；随后原开发任务 `TASK-20260802-C29BB8`、P1 整改 `TASK-20260803-CD4228` 均已由统筹 ACK。原快照审核 `TASK-20260802-887EA7`、`TASK-20260802-FA36FE` 已由后继精确整改快照审核取代；后继测试 `TASK-20260803-5991EE` 与设计 `TASK-20260803-8C9709` 均已 `PASS / P0=0 / P1=0 / P2=2` 并 ACK。当前适用边界以 2026-08-04 顶部条目为准，AT/200%/forced-colors 与 public-demo+SQLite/API 新快照仍待复验。
- 🕘 历史节点（2026-08-02 当日）：安全任务 `TASK-20260802-68F43E` 当时以 `FAIL / P0=0 / P1=1` 完成并 ACK，后继 `TASK-20260802-3760F6` 尚未执行；该启动缺陷及后续数据库覆盖 P1 已按 2026-08-04 顶部条目完成整改闭环，R5、R12 和整体生产放行仍未开放。
- 🕘 历史节点（2026-08-02 当日）：公开 DTO/数据图任务当时刚拆分，SQLite migration/seed、Repository/API 与前端接线均未实现；当前 migration/seed 已核收，Repository/API 以 `TASK-20260804-AC25D4` 在办，前端接线仍 pending。
- ✅ 新 Mac 迁移与经用户授权的精确清理已完成 post-clean 独立终验：已 ACK 的测试任务 `TASK-20260802-574A6D` 为 `decision=pass / P0=0 / P1=0`；Apple M5、arm64、macOS 26.6、Git 基线、项目 Node 24.18.0/npm 11.16.0、两份 SQLite、关键断点 hash、清理边界与 9/9 个 Codex 任务同步均通过，测试收据记录当时 `TASK_DOCTOR_OK | tasks=93`。清理释放约 `298.6 MiB` 项目空间，另清理 Homebrew 旧 `simdjson` 约 `6.6 MB`；终验与清理流程没有重建迁移归档，可重建施工缓存在开发恢复后允许按正常命令重新出现。
- ✅ 迁移临时交付已按用户授权精确清理：`migration/bundles/`、`migration/manifests/`、`migration/portable-assets/`、`migration/scripts/` 现已删除，归档及脚本只作为历史验证事实引用；`app/node_modules/`、精确 Node 24 工具链、两份 SQLite、`.git/`、任务/报告、迁移交接与 `migration/conversations/` 明确保留。旧机 Obsidian Local REST `data.json` 已在用户控制门禁满足后删除，插件与精确忽略规则保留；安全部 `TASK-20260802-026EC3` 的处置前 `decision=fail` 历史继续保留，删除后的闭环依据为测试部 post-clean PASS。
- ⚠️ 迁移结束没有改变业务与安全门禁：开发部 `TASK-20260802-7A9C48` 仍为 `completed`；测试部后继 `TASK-20260802-FFC67A` 与安全部合同任务 `TASK-20260802-6F7563` 均已由统筹 ACK。VS-0 最新独立安全结论仍为 FAIL，R5 同 UID 威胁模型待用户决定，R12 OS/系统调用级 no-egress 仍 pending；真实 Base/provider/Collector、外部平台采集、AI/媒体、公开发布、部署、付费及其他真实外部 I/O 继续 closed/Unknown。
- ✅ 研究部已完成 `TASK-20260802-8FF37A`《F1 聚合竞品与前沿工具雷达增量刷新》并已 `TASK_STATE_OK`：在 D11DCA/D9DA43 基线上只读复核 GitHub、X、Reddit、Product Hunt；按统筹带来源收据并经研究部 sparse clone 复核，把 AI Hot v1.2.1 固定历史、v1.2.2 历史观察与当前 v1.2.3 `f430c4b11eb7ce715d77768ff787855b7a025187` 分开；当前 9 文件与 manifest 六项载荷 hash 6/6 匹配。Top 12 逐项复核并去重新增 NewsPrism、AI News Open、OmniWire-MCP、News Digester、Perspective-AI、Product Hunt Bulletin，形成五类分层、差异/门禁矩阵、P0–T3 路线与三步 synthetic 验证建议。CLI 受限后使用官方内置只读页面；未登录、未安装、未真实采集、未外部写入，真实平台/权利/地域/运行状态继续 Unknown/conditional，5BD745 跨版本语义交叉仍是后续未验证项。详见研究部增量雷达报告。
- ✅ 开发部已完成 TASK-20260802-D2724D：独立静态审计官方 package-lock.json，lockfileVersion=3，399/399 resolved 均为 registry.npmjs.org，399/399 integrity 为 sha512，package/lock 精确依赖一致，无 latest/canary/preview/git/file/非官方源；sharp@0.34.5 与 unrs-resolver@1.12.2 的 hasInstallScript 仅作为 lock 元数据列出，生成使用 ignore-scripts 且无 node_modules，未运行 lifecycle。B 层 overall=PASS（P0=0/P1=0）；Node24/npm ci/SQLite/业务实现/build/test/security/真实端口仍为 C 层 pending。已修订 app/README，保留 F8BF72 的 PARTIAL 历史。详见开发部 lockfile 恢复与门禁闭合报告。
- ✅ 产品部已完成 TASK-20260802-84F061 实施状态同步：开发 D27E44、安全 7BFD99、测试 6F480F 均由统筹 ACK 为 `PASS / P0=0 / P1=0`；Node24.18.0/npm11.16.0、SQLite3.53.1、`npm ci --ignore-scripts`、lint/typecheck/build 与两路独立复验通过，`app/node_modules/` 当前存在且被 gitignored。首轮 FAIL、延迟清理误删 node_modules 及恢复/复验历史保留。该 2026-08-02 历史节点当时只允许 VS-0 安全地基与 fixture provider 本地开工，Repository/UI/API/完整 R12/VS-1–3 与真实外部能力当时仍 pending/closed；VS1 三项本地 mock Function 的现行完成态见本日顶部记录。
- ℹ️ `TASK-20260802-7F3D22` 的前一轮实施状态收据保留于产品部状态同步报告；当前 C 层时态以本节 `TASK-20260802-84F061` 条目和最新 Spec/accepted ADR 为准，历史收据不作为现行门禁。
- ⚠️ 开发部已领取 TASK-20260802-F8BF72 并完成 M4 B 层静态初始化：app/ 已升级为精确 Node 24.18.0 / npm 11.16.0 / Next 16.2.11 的单包 App Router scaffold，补齐版本文件、engine-strict/ignore-scripts、canonical 目录、安全 .env.example、Next/ESLint/TypeScript 配置和 pending 命令占位；本机只有 Node 25.5.0 / npm 11.8.0。官方 npm registry DNS 在限时内不可达，无法产生可信 package-lock.json，该项作为唯一 B 层阻断记录，未使用镜像或伪造 integrity；C 层 Node24/npm ci、SQLite、业务切片、build/test/security 与真实端口继续 pending。详见开发部 B 层初始化报告（collaboration/部门/开发部/报告/2026-08-02-M4-B层本地Web工程初始化报告.md）。
- ✅ 研究部已完成 `TASK-20260802-D9DA43`《F1+1 前沿方案综合评估与采用路线》：只读综合研究/开发/设计/安全四份已核收报告，形成 Top 12 交叉矩阵、AI Hot 合同模式专项结论、四档采用/验证路线、3 个本地 synthetic spike、X/Reddit/Instagram/RSS/OpenF1 独立门禁、拒绝清单与 owner；明确研究高分不等于生产准入，未修改 Spec、ADR、`app/`、`data/`，未执行外部 I/O。
- ✅ 研究部已完成 `TASK-20260802-D11DCA`《前沿 F1 资讯聚合竞品与生态全景调研》：只读覆盖 GitHub、X、Reddit、Product Hunt 与官方 F1/FIA 站点；去重保留 25 个产品/项目候选及 1 个 Product Hunt RSS 来源模式，完成证据强度、许可证/活跃度 Unknown、Top 10 评分与三档采用建议；未登录、未调用需凭证 API、未绕过限制或执行外部写操作。
- ✅ 产品部已领取并完成 `TASK-20260802-5BAF26` 的产品合同修订：只修改 Spec、M4 proposed ADR、进度与本产品收口报告，未触碰 data、app、accepted ADR、飞书资源、真实 provider 或外部 IO。
- ✅ 按统一 `mvp-local-v0.3` 基线重写 A 轴关键合同：规范化/查重有效且唯一后才激活；`platform > authorization > adapter` 阻断优先级；三门、stop、五 fence 同一事务原子写 `enabled=true`、`queued`、唯一 onboarding operation/outbox；Source、TaskEnvelope、Outbox 复用 operation id，worker lease 后才 collecting。
- ✅ 固化单一 Publication：同一 `(release_bundle_id, approved_bundle_hash)` 只有一个 public_id/generation；Publication、publish Outbox、TaskEnvelope 逐字复用 `idempotency_key`，`reconcile_key` 只做同记录查询；retryable/blocked/reconcile/stop/dead-letter 出口保留身份与 key。
- ✅ 固化可重建 hash：Content/Summary 指定不可变字段对象分别复算 version hash；release canonical payload 冻结来源、原链、权利、媒体、政策、schema、五 fence；`payload_hash`、`bundle_hash`、`approved_bundle_hash` 公式和 supersede 规则唯一。
- ✅ 固化 internal-only 观察/草稿/审计边界、`internal-contract.schema.json` 候选、三层 seed（公开投影与快照对账属于 synthetic 子集）和 `epoch=0` 永远 schema 拒绝；未把这些记录写成领域或 Base 真值。
- ✅ `TASK-20260802-8B5DCF` 已完成 A 轴 accepted 收口：安全部 `TASK-20260802-337780` 与测试部 `TASK-20260802-ABB9F8` 聚焦复验均为 `PASS / P0=0 / P1=0`；首轮 `P0=0/P1=1/FAIL` 与唯一时态 P1 历史保留。唯一 canonical M4 accepted ADR 为 [ADR-M4-KICKOFF-001](decisions/system/2026-08-01-F1+1-M4本地Kickoff系统路线-accepted.md)，旧 proposed 路径仅作历史跳转，不构成第二真值。
- ⚠️ 此前 `mvp-local-v0.2` 数据任务已交付并 ACK；`mvp-local-v0.3` 修订任务 `TASK-20260802-D80846` 已完成并由统筹部 ACK，且经两份聚焦复验 PASS；数据产物保持冻结，未在本任务修改。该历史节点的 A 轴静态合同已 accepted，C 层本地预检已 PASS 并允许 VS-0；Repository/UI/API/完整 R12/VS-1–3 当时仍 pending。现行 VS1 三项本地 mock Function 已完成；真实 Base/provider/Collector、真实采集、表单、AI、媒体抓取、外部发布、部署、付费与外发继续关闭。

## 2026-08-01

- ✅ 产品部已形成 [Spec v1 候选](spec.md) 与 [ADR-M4-KICKOFF-001 accepted](decisions/system/2026-08-01-F1+1-M4本地Kickoff系统路线-accepted.md)：选择本地 Next.js App Router + TypeScript、Node 24 LTS 目标、SQLite repository、fixture/mock worker、fail-closed 环境开关和四个纵向切片；A 轴静态合同已 accepted，B 层仅开放本地初始化，尚未写业务代码。
- ⚠️ 当前工作机 Node `v25.5.0` 不满足 M4 的 LTS 启动门禁；`app/` 仍只有地基 README。真实 Base/provider、采集、表单提交、自动发布、部署和付费边界继续关闭。
- ✅ 已吸收设计部核收的 [首批页面实现级设计合同](../design/ui/F1+1-首批页面实现级设计合同-v0.1.md) 与 [Token/map JSON](../design/ui/F1+1-首批页面token-map-v0.1.json)：四页、状态、响应式和无障碍矩阵进入 M4 候选验收；Appica UI/Base UI 仅作行为/语义参考，未选为技术依赖。
- ⚠️ 已吸收开发部 [M4 工程开工预检报告](collaboration/部门/开发部/报告/2026-08-01-M4工程开工预检报告.md)：scratch 逻辑探针重复通过且 `external_calls=0`，但真实本地端口、目标网络安装、Node 24 运行和生产存储仍未验证；不能把 Node 25/Python 3.14 或探针写成正式选型。
- ✅ 已吸收数据部 [本地 MVP 数据合同与安全样例](collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md)：`data/mvp-contract-v0/` 作为唯一领域字段/状态/幂等输入；M3 33/9 只映射到 Source/CapturedItem，domain-only 实体不反写 M3，unknown/批准 hash/epoch/outbox 不变量保持。
- ⚠️ 已吸收研究部 [飞书 OAuth 最小 Scope 与撤权轮换官方语义核验](collaboration/部门/研究部/报告/2026-08-01-飞书OAuth最小Scope与撤权轮换官方语义核验.md)：M4 固定 fixture-only runtime profile；未来只读按 granular scope、user grant/token scope、resource ACL 三层门禁，未触发重授权、撤权或 token 轮换。
- ✅ 用户另行明确授权后,已仅通过飞书 CLI 将 M3 影子 Base 六项公共权限一次收紧并 fresh read 为 `link_share_entity=closed`、`external_access=false`、`invite_external=false`、`share_entity=only_full_access`、`security_entity=only_full_access`、`comment_entity=anyone_can_edit`;维护者仍有 `manage_public=true`,没有重试或浏览器操作。
- ✅ ACL 写后再次核对资源目录、表单与数据不变量:仍为 2 张表、33+9 字段、3 个 grid 与 1 个未分享 form;主表 59×33 与离线载荷全等且 59 条全部 `enabled=false`,手机捕获表仍为 0 条,没有真值/provider/Collector/采集/发布切换。测试部后继 `TASK-20260801-508D03` 已在明确独立现场读取限制的前提下按带来源收据审计为 `decision=pass`,并由统筹部核收;直接协作者列表仍不可读并保持 Unknown,OAuth 142 scopes 风险继续独立跟踪。
- ✅ 用户另行授权后,已仅通过飞书 CLI 创建 `F1+1 信源库｜M3影子`:共 2 张表(`主信源` 33 字段、`手机捕获` 9 字段)、3 个 grid 视图和 1 个表单视图;未创建 workflow,未连接 Collector。
- ✅ 手机表单 `新增信源（手机）` 已回读为 `shared=false`:只显示首题 `raw_url`(必填)和第二题 `capture_note`(可选),五个内部处理字段均隐藏,底层 9 个字段完整保留,没有真实表单提交。
- ✅ 批次 `M3-20260801-X59-01` 已通过 typed `+record-batch-create --as user` 单次导入 59 条影子记录;全表和本批次均为 59 条,59 个 record ID/source_id/canonical_url 唯一,33 字段逐行与离线载荷一致,全部 `enabled=false` 且保守状态未提升。
- ✅ 表单字段配置所需的官方 Bitable v1 PATCH 已通过安全部窄白名单补充审查,两路对抗复核 PASS;除用户后来单独授权并已执行的六项 typed 公共 ACL PATCH 外,其余 raw API、delete、协作者增删、公开分享、真值/provider/Collector/采集/发布操作继续禁止。
- ⚠️ 收紧前的测试部任务 `TASK-20260801-57E98D` 已以 `decision=fail` 收口:失败原因是其会话 Keychain 未初始化,无法独立现场读取 Base,并未断言资源或数据存在缺陷。该失败历史不覆写为 PASS;目前六项公共 ACL 与写后不变量已经统筹部、独立现场对抗 Agent 和正式测试后继 `TASK-20260801-508D03` 分层复验通过,后继任务已核收。测试部后继使用带来源收据且明确自身未完成第二次现场读取;直接协作者边界仍为 Unknown。详见[执行收据](collaboration/部门/统筹部/报告/2026-08-01-M3飞书Base影子建库与59条导入-执行收据.md)。
- ⚠️ 为取得表单权限执行的 `--recommend` 用户态重新授权同时授予 142 个 scopes,包含超出本轮需要的 Base update/delete 等能力;本轮没有使用这些额外能力。令牌级最小权限尚未收敛,缩减或撤销需另获用户确认。
- ✅ 设计部已交付并通过核收 `F1+1` 全站设计规范 v0.1、深浅主题交互样板及两张视觉长图;未修改 accepted ADR 或正式应用。
- ✅ 用户已确认信源库采用“先 A、后 D”：先建立飞书 Base 单一业务真值并在独立门禁后由采集器在线直读，A 稳定后增加 `Base → 本地 last-known-good` 单向只读快照并在独立门禁后切换为 D。
- ✅ 产品部已建立窄范围 [ADR-SOURCE-001](decisions/system/2026-08-01-F1+1-信源库A到D演进路线-accepted.md)；现有信源库详细决策包继续保持 proposed。
- ✅ 在路线决策节点,统筹部曾只读验证飞书授权状态为用户身份 verified、token valid;当时没有访问或创建 Base,随后才按单独的 M3 授权执行上述影子资源操作。
- ✅ 三路独立只读审查已闭环：accepted 范围、切换门禁/故障不变量与跨文档时态均无残留 P0/P1。
- ✅ 测试部独立复验 A→D accepted 路线合同通过：0 阻断、0 重要、1 个一般证据追踪性问题；统筹部已补充不含 token、用户 ID 或资源 ID 的[飞书 CLI 鉴权状态脱敏收据](collaboration/部门/统筹部/报告/2026-08-01-飞书CLI鉴权状态-脱敏收据.md)。
- ⚠️ M3 影子 Base 的六项公共权限已收紧,但当前授权仍无法列出直接协作者名单,因此不能证明只对预期个人维护者开放,也不能证明存在外部协作者。Base 业务真值切换、A 采集器切换和 D 快照切换继续分别需要实现验证与用户确认;`app/` 尚未初始化。
- ✅ 安全部 `TASK-20260801-812839` 的 typed CLI 最小 ACL 方案已按用户后续授权执行:实际写入一次、六项 fresh read 全部命中目标,协作者清单仍为 Unknown。

## 2026-07-31

- ✅ 用户已确认新信源生效门禁：完成 URL 规范化与信源查重后,在平台适配器已有合法授权和可用能力时立即进入采集队列;身份与 F1 相关性允许保持 `unknown`,全部拟公开内容仍须人工审核。
- ✅ 产品部已把该决定吸收到 `docs/spec.md` 与信源库 proposed 决策包,补齐默认状态、入队条件、阻断/失败状态及公开审核门禁。
- ✅ 当前修订版已通过测试部独立复验：用户确认/产品建议边界、入队与失败状态机、在途安全栅栏、人工审核版本绑定及跨文档一致性均通过；0 阻断、0 重要，唯一一般项为本条进度时态同步，现已闭环。
- ✅ 已只读解析 `F1+1信源.md`：原件实际为 RTF，抽取 59 个 X 账号链接；去除 `?s=20` 并按 handle 大小写不敏感规范化后仍为 59 个唯一项，原件 SHA-256 保持不变。
- ✅ 数据部已建立 `data/x-source-inventory-v0.csv` 与分类字典：临时分类为组织/车队/赛事/品牌候选 15、车手/管理者候选 28、记者/评论员/媒体候选 12、车迷资讯/聚合候选 2、图片/娱乐/其他候选 2；全部身份、可监控性和启用状态仍为 `unknown/proposed`。
- ✅ 研究部已比较四种信源库真值方案并核收：A 飞书 Base、B Git JSONL、C SQLite、D 飞书 Base + 本地只读快照；截至 2026-07-31 的路线报告把身份/token/scope 与具体资源读取列为当时 unknown，后续 M3 已有 CLI 资源/表/59 条记录回读收据，Collector 的 `base_direct`/`base_snapshot` runtime provider 读取仍 unknown。
- ✅ 产品部已形成 `docs/decisions/system/2026-07-31-F1+1-信源库维护决策包-proposed.md`：提出 A 作为最小起步阶段、D 作为目标形态，Base 始终为唯一业务真值，本地快照只允许单向生成；该建议尚未获用户确认，未冻结 Spec。
- ✅ 此前的信源库 proposed 版本已由测试部独立验收：原件与 CSV 59/59 一一对应，本地链接、分类边界、飞书证据、单一真值、故障恢复、当时的立即采集限制、`agent_team_task.py doctor` 与 `git diff --check` 均通过；该报告早于本轮用户决定吸收，不代表当前修订版已由测试部复验。
- ✅ A/D 信源库路线截至 2026-07-31 尚为 proposed，已于 2026-08-01 通过窄范围 ADR 接受；真实飞书表格、表单、应用、资源级权限、同步器和采集器切换仍未获路线决定授权。

## 2026-07-30

- ✅ 已确认目标用户核心特征、指定信源范围、15 分钟采集目标、低质量初筛、初期人工审核及后续自动发布方向;地区边界与自动发布控制方式仍待确认。
- ✅ 已确认采用 `agent-team` 自动会话模式,团队配置为统筹、产品、调研、设计、数据、开发、安全、测试八个部门。
- ✅ 八部门正式协作层和对应 Codex 对话框已创建、完成首次接班并登记;误建的一个产品部副本已归档且未进入会话真值。
- ✅ 已完成并核收 `AI Hot` 公开产品与技术行为、多平台白名单采集方案、采集与发布安全基线三份报告。
- ✅ 测试部独立审核协作地基通过:八个正式会话与真值一致,误建副本已归档,重要一致性问题已修正。
- ✅ 产品部已综合三份报告形成 MVP 与系统架构 proposed 决策包;产品部三路对抗审查补齐最终公开载荷绑定、游标原子推进、异步交接、恢复围栏和 UI 预览门禁。
- ✅ 测试部已独立审核该决策包并判定 `pass`:无阻断或重要问题,四项一般级追踪性问题已记录。
- 🔎 M2 风险检查继续进行:下一步按顺序向用户确认决策包 U1–U16,再决定获授权技术实验范围;尚未冻结 Spec v1 或初始化 `app/`。
- ✅ 已按 `vibe-project-foundation` v0.1.0 的新版模板增量同步 UI / 设计可视化确认规则及多会话审核报告路径。
- ✅ 搭好开发前地基:`docs/` `app/` `design/` `scratch/` + `CLAUDE.md` 等 AI 工作层。
- ✅ 已创建 `docs/spec.md` 作为后续开发唯一准绳,并准备 `AGENTS.md` / `CLAUDE.md` 两个轻入口。
- 🕘 历史记录:当时的下一步是确认结构并进入 M1 Spec v0;当前已完成该步骤并进入 M2 风险检查。

---

<!-- 新进展加在这条线下方、上一条上方(倒序) -->

- 🚧 **v0.2 公开页设计勘误已建立正式后继任务，统筹只读预审已落盘**：用户明确要求设计部复核 Kimi/frontend-design 审查并给出具体优化方案；`TASK-20260811-EE3F90` 已按 `user_confirmed` 入队，绑定审查报告 SHA `a4022a97…a487` 与冻结 HTML SHA `5a84bfb2…f6168cb1`，要求逐项核验 A1–F2、交付精确优化动作、隔离 successor 与 1440/1024/390×深浅六格。正式设计部窗口未归档，但线程写入接口没有送达派单，当前任务仍为 `queued`，不得写成已领取。统筹为减少等待建立[只读预审](collaboration/部门/统筹部/报告/2026-08-11-Kimi-frontend-design审查统筹只读预审.md)（SHA `f58aee1d…b29d8`），结论仅作补充证据：多数代码级发现成立，B2/E2 需反证修正；最小 integrity successor 应只闭合设计真值、44px 命中、错误文案/alt/meta 与本地媒体边界，不自动吸收 F1358A 中未获确认的审美变化。未修改冻结设计、App、Spec、accepted ADR 或发布视频。
- 🔎 **v0.2 冻结设计 frontend-design 透镜深度审视完成（用户 2026-08-11 主会话直接委托，无正式 TASK，只读诊断）**：官方 `frontend-design` skill 已装用户级（`~/.claude/skills/`，不装进项目，沿用 taste-skill 处置先例）。以「路径+SHA-256 `5a84bf…`」为审视身份，证据为全量代码 + 5 张截图（dark/light × 1440/390 + `#open=r1` 展开态）+ CDP 实测（390×844@1x）。结论：方向与结构纪律获透镜正面确认（时间线即论点、结构即信息、聚焦灰度为唯一签名手势、AI-default 校准因简报冻结深色而合规）；发现按性质分组——A 制品与自有规范 5 处漂移（标题未用 Barlow Condensed、列宽 880/920、主图限高 360/255、缩略图 22/32、摘要截断已移除但文档未同步）、B 自设 44px 触控地板在触屏端被自家制品打破（缩略图 32×22、证据行 22px）、C 冻进制品的可见错误文案（kicker「7 条示例」实为 10 条、页脚占位声明与真实热链内容矛盾、alt 截断）、D 桌面触控板 wheel 劫持切图风险（back-swipe 冲突列入实机待验证）、E 真实内容暴露的设计缺口（同日分组缺失、提炼层级、相对时间无设计）、F meta/热链卫生项。**揭示时序张力：发布视频素材绑定当前 hash，C/F 类文案会被录进成片，建议统筹裁定「先勘误再录制」或「旧 hash 录制、勘误进下一版」**。本会话未改动冻结产物、未建 TASK；建议路由为设计部主导的「v0.2 勘误与裁定」TASK。证据：[审视报告](collaboration/部门/设计部/报告/2026-08-11-frontend-design透镜v0.2冻结设计深度审视.md)。

- ⛔ **公开页筛选、真实两页分页、七状态与无障碍核心闭环已完成实现但验收证据 blocked**：开发任务 `TASK-20260809-F67080` 已接入 ACK 的 PAGE2 successor；本地 profile 为 24 条、两页各 12、四类各 6。对抗审查发现离线刷新会清空已加载列表，该 P1 已修复；当前 Node24 聚焦测试 19/19、lint、typecheck、build 均通过。六格与七态/page2/a11y 运行观察来自修复前候选，且 Chrome/Updater harness 记录了后台外部端点尝试、未保留精确网络收据，无法绑定为当前候选的 clean-room 证据。遵守“不追加视觉轮次、浏览器阻断立即回报”，任务保持 blocked，等待隔离浏览器对当前 source/build/data hash 做一次同候选复验。`DEV-MM-04`、真实媒体/provider/Base、Admin、发布、部署与其他外部能力继续关闭。证据：[开发报告](collaboration/部门/开发部/报告/2026-08-09-筛选分页七状态与无障碍核心闭环实现报告.md)。

- ✅ 研究部已完成 `TASK-20260809-CE1771` 两台 MacBook 配置期同网与运行期跨网联动方案的官方证据研究：唯一推荐职责隔离的三通道 + Admin server pull——iCloud 只在工作侧承载低风险协调文档，工作 Mac 推送待签 Git commit，独立 signer 在审核后生成签名 release tag，私有 overlay 承载 Admin UI 与按需传统 OpenSSH；Admin 主动 fetch、验签/hash 后部署。Tailscale macOS Standalone/App Store 不能作为 Tailscale SSH 服务端，Screen Sharing 只作短时例外。生产 SQLite/DB-WAL-SHM、运行目录、生产运行/数据库/备份解密 key、审计主账和备份不得进入 iCloud、Git、工作 Mac 或 public-host；release signing key 由独立 signer 单独冻结。中国大陆跨网、目标账号、真实发布与RPO/RTO均保持 Unknown。本轮未安装、登录、创建远端、改网络或运行真实探针。

- ✅ 研究部已完成 taste-skill 安装评估(用户 2026-08-09 主会话委托):定位为 `Leonxlnx/taste-skill`(74.4k★,MIT),全文阅读其 1206 行主文档;结论为**选择性吸收、不装进项目开发链**——其自述范围排除产品 UI,且强意见型输出与"严格贴合冻结设计、缺口退回设计部"全局硬门冲突;建议设计部把 AI TELLS 黑名单与 60+ 条预飞行机械自检甄别转化为规范条目,个人级试用限用户级环境单一 skill;对发布视频双任务派单无影响。证据:[taste-skill评估与安装建议](collaboration/部门/研究部/报告/2026-08-09-taste-skill评估与安装建议.md)。
- ✅ 研究部已完成发布视频(launch video)方案只读调研(用户 2026-08-09 主会话直接委托,无正式 TASK):GitHub 上该场景已收敛为"Remotion 程序化视频引擎 + Agent Skill 方法论"链;官方 anthropics/skills 无 motion/视频类 skill,用户所指最可能为 vibe-motion/skills 或 iart-ai/motion-skills,对"网站发布视频"最对口的是 video-shotcraft(4257★,Apache-2.0,152 镜头卡+8 阶段流水线+判例审美法则);"优质发布视频"已提炼为可操作标准(5 幕结构/节奏与质感判例/反 AI 模板味黑名单/真实资产纪律/逐镜头静帧验收);Remotion 对 ≤3 人组织免费可商用,vibe-motion 与 remotion-dev/skills 许可证未声明列为 B 级待复核。已产出[调研报告](collaboration/部门/研究部/报告/2026-08-09-发布视频方案与视频制作Skill生态调研.md)与[设计部派单建议书](collaboration/部门/研究部/报告/2026-08-09-设计部发布视频任务建议书.md)(任务 A 方向设计 `user_confirmed` + 任务 B 成片制作 `user_required` 双门禁拆分,含可直接执行的 enqueue 命令);本会话非已登记统筹会话,未越权创建 TASK JSON,待统筹部派单。
- ✅ 研究部已完成 `TASK-20260809-B05A67`《专用 Admin MacBook 私有访问与异机备份候选》只读调研：基于 Tailscale、Headscale、WireGuard、SQLite/Node、restic、Backblaze 与 Apple 官方资料形成三套候选，推荐先验证托管 Tailscale 的网络适配，再验证 Headscale + 自托管 DERP，纯 WireGuard 仅作冷备；P0 网络观测不能替代五分钟签名 freshness 硬门，共同备份管线要求五分钟一致快照、异机加密、manifest/hash、远端认证回读、周期完整验证与隔离恢复。官方资料均未保证中国大陆稳定可达，真实 Mac/iPhone 双端链路、价格/地域、restic/B2 Object Lock 组合与 RPO/RTO 均保持 Unknown，只有唯一 production manifest 获用户批准后才能实测；本轮未登录、安装、购买、改网络、运行真实探针或上传数据。
- ✅ **多媒体本地 synthetic 后端 `DEV-MM-01..03` 已通过独立门禁，`DEV-MM-04` 继续受视觉确认门禁**：数据前置 `TASK-20260809-385B52`、开发 `TASK-20260809-BA9999`、安全 `TASK-20260809-4A5381`、测试 `TASK-20260809-B98C66` 均已由统筹 ACK。现行候选包含物理隔离的 `public-multimedia-synthetic` SQLite、exact `0001/0002/scoped-0003`、原子 0/1/4 图 seed、5 个 synthetic MediaCandidate、Repository 与默认 V1/精确 V2 的 feed/detail/related API；第五图、hash/rights/safety/order、非法 Accept 与链损坏均按合同 fail closed。独立门禁结论为 `P0=0/P1=0`，旧 M3/public-synthetic DB 与 migration/receipt 零漂移，运行收据为 `externalCalls=0/realMedia=0/writesToBase=false`。公开前端 `DEV-MM-04`、浏览器交互和视觉尚未获用户确认，公开页面媒体导航/lightbox 不得写成完成。P2 保留：`app/.local/f1plus1-public-multimedia-synthetic.pre-update-20260809.sqlite` 不被 runtime 选中但增加留存/备份/误取风险；Turbopack NFT 动态本地路径 tracing 与最终部署包内容尚未验证。真实媒体、provider、飞书 Base、Admin、RSS、发布、部署与外部 I/O 继续 closed。证据：[数据报告](collaboration/部门/数据部/报告/2026-08-09-M3与public-synthetic数据库及closed-receipt独立复验报告.md)、[开发报告](collaboration/部门/开发部/报告/2026-08-09-DEV-MM-BACKEND多媒体独立profile与V1-V2-API完成报告.md)、[安全报告](collaboration/部门/安全部/报告/2026-08-09-多媒体profile与V1-V2-API独立安全复验报告.md)、[测试报告](collaboration/部门/测试部/报告/2026-08-09-B98C66多媒体profile原子seed与V1-V2-HTTP独立验收报告.md)。

- ⚠️ **2026-08-22 R6 发布闭包与六文件 typecheck 修复已按冻结身份集成到共享工作树，但 build gate 仍未抬绿**：R6 current-preimage `21/21`、17-hunk decision map/replay 与 formal artifacts 复核通过；保留 `transport.ts` 两处 `15_000ms` bound 和 Admin manifest 精确 `97` assertion。六文件 typecheck 修复已独立复核；`rss-collect-once.ts` 的 source-id 修复由 R6 merged bytes 已携带，RSS transport 的重叠 hunk 由 exact 三方结果叠加两处 Node24 类型注解修复。精确 Node24.18.0/npm11.16.0 下 full typecheck、聚焦 lint、RaceFans/RSS production-shaped 36/36 测试与隔离 Next build 通过。完整四文件 R6 focused suite 在共享环境未通过：共享 `app/.env` 触发预期 unapproved-env fail-closed，隔离 current candidate 还暴露 `ADMIN_RELEASE_RUNTIME_FILES` 实际 114 与冻结 97 assertion 的契约漂移及两个 public-install 超时；因此 release build gate 保持 `NOT PASS`。未执行生产、M1、真实外网、真实数据库写入、服务/LaunchAgent、发布或付费 API；完整 Vitest 的既有 14 项阻断也未改写。精确收据与 manifest 见 `scratch/2026-08-22-release-integration-r6-typecheck/`。

## 2026-08-23 successor 工程验证更新

- ✅ 在物理隔离 clean tracked single-parent candidate-4 上完成 successor evidence closure：精确 Node 24.18.0/npm 11.16.0、offline `npm ci`、clean causal Next build、Admin manifest/stage verifier、Public closure、target-stage self-contained verifier、RaceFans production-shaped、focused lint、full typecheck 与最终 3-file focused Vitest 全部通过。最终 3-file suite 在同一最终 `.next` 上为 26/26；RaceFans production-shaped 为 36/36。
- ✅ 当前 release identity 为 Admin 113 与 Public 82。Admin path-list root=`65108cd552f9302990bf397b1fa6ddfda8347c0b0e46c6b53d6a308640813d21`；Public path-list root=`3bfa3d74898c13576f79de8efde27907a7a5da885af19736adff3d99145587a0`。旧 R6 的 `96/98/stale97/114` 数字不再代表当前 successor；旧 `97` 警告保留作历史事实，不能阻断已独立验证的 113 合同。
- ✅ target stage 只使用收据中标注 `disposable=true` 的临时测试签名；没有生产密钥因此没有伪造生产签名。服务、LaunchAgent、M1、生产、真实数据库写入、部署、真实外网和付费 API 均 `NO`。legacy `public-release-bootstrap.ts` 是 local synthetic/legacy 命令，未进入当前 Admin/Public closure。
- ✅ 正式证据位于 `scratch/2026-08-23-release-successor-evidence/`：`report.md`、`receipt.json`、`manifest.sha256` 及 `evidence/` 下的 manifest、path-list、closure、verifier、target-stage 与测试日志。共享工作树既有脏改动保留；本任务唯一新增代码验证修复是 Admin 测试 fixture 的 macOS `cp -cR` copy helper，避免扩大固定 60 秒测试门或改变生产运行逻辑。

## 2026-08-24 release successor R2 整改更新

- ✅ 独立 R2 evidence closure 已生成于 `scratch/2026-08-23-release-successor-r2-remediation/`。candidate 为 clean tracked single-parent，HEAD `2d590366159b7b1f83c673351fdce4f7fef9bbbb`、parent `da4fa8d9d7478d38b6787f6ce544c3ad9856e5e3`、tree `e8a191a2cf1770f7ce460934d95d932d0e51f637`。
- ✅ P1-1 外层 envelope 已由 `envelope-manifest.json`、外部 `envelope-anchor.json` 和独立 `verify-envelope.mjs` 关闭；receipt 单字节篡改三处负例均被拒绝。P1-2 target root、working directory、Node 和 deployment manifest 均位于独立 target-stage；实际 parent/source-entry probes 均 `ENOENT`，`sourceParentAccess` 为 probe 计算结果；target tree hardlink=0、symlink=30 且无 root escape。P1-3 已移除 `/bin/cp -cR`，copy helper 使用 hardlink-preserving recursion 或 native copy 后的 inode/nlink/symlink 审计，并覆盖 hardlink/symlink/path-escape 负例。P1-4 旧 accepted ADR SHA-256 `7192e03d9bdbd98232a7c6896ab737b5bc8da13bfa6e822e84b9208bf2f24ce7` 与 Git HEAD/工作树/candidate 一致，R2 ADR 记录 supersedes。
- ✅ R2 验收：Admin 113、Public 82、clean causal Next build、Admin stage、target-stage verifier、focused lint、full typecheck、RaceFans 36/36、最终 focused 3-file Vitest 26/26 和 dependency closure 后验均 PASS；最终 manifest SHA `f494863594de2b139099e96a6a940778546c2f66a75ced98099095f510850588`，release root `814e08f792b3b6da134140f2a61ea9a9d50075adf1139fa5fb51d7cb8e9369d0`，Next root `9cbaad3f8c46ad688e7141292d7b4533bcf9c0aaaf265594bfbe6d850a47ca2d`，dependency closure `22490 / e7095066b20d27efb16cdf2047735fbe75be9b232e69e54409d9f43e6342ac39`。
- ⛔ deploy、M1、production、LaunchAgent、真实签名、网络与付费 API 均 `NOT_RUN`；full `npm run check` 与 full unfiltered Vitest 为 `NOT_RUN`。disposable Vitest cache 已清理，target-stage root/home/rollback 作为审计产物保留。

## 2026-08-24 Slice 0：双语完整 Admin 与公开部署合同

- 用户已确认完整 Admin、双语详细提炼真实接线与最终公开部署目标；工程切片获准按安全合同持续推进。
- 新 accepted ADR、实施合同和 Function 矩阵已建立，冻结当前 `user_version=6` 后的 `0007→0008→0009→0010` 单一路线，并精确 supersede旧v5的失效 migration编号/schema身份；旧 accepted正文未改。
- Open Design目标绑定到 `f1plus1-bilingual-detailed-extract-preview` 的冻结文件和SHA：Admin `4a9e088b…002c`、Public `c661a019…b260`、freeze manifest `0431f203…502`；这些文件继续明确 `NOT_DEPLOYED / realApi=false`。
- 已区分当前实现、隔离工程候选、待实现和production-gated：当前真实链仍是schema6/v4语义；0007未进入共享app/DB，0008/0009/0010未生产实现，Admin/Public双语和完整Ops未部署。
- `PRODUCTION-DEPLOYMENT-MANIFEST` 继续固定主机、DB、网络/身份、migration/release、签名、模型/预算、source/版权/媒体、备份/恢复、观测和phase/cutoff值。用户目标授权没有跳过该门。
- 本Slice只写docs；app/data/DB/M1/production/service/network/key/model/publish均未触碰。未commit。

## 2026-08-24 Slice 0 R2 文档整改

- ⚠️ 前一节记录的Slice 0完成含义过早。独立审核 `scratch/2026-08-24-bilingual-admin-contract-review/review-receipt.json` 为 `FAIL / P0=0 / P1=2 / P2=2`；当前状态更正为 `accepted target / R2 review pending`，只有后继独立复审PASS并锚定新receipt后才能记complete。
- R2候选补齐每组route的strict DTO/Problem、分页/排序/cache/status、operation/CAS/idempotency/fresh/auth capability、逐实体closed transition、response-loss reconcile、Source/X有界合同、统一Ops snapshot/asOf/freshness/unit/unknown union，以及logs/traffic/API/cost/alerts的bounded schema和隐私禁区。
- Function矩阵已按当前代码缩窄：现有只确认publish后端，correct/withdraw为pending；Audit与Security分别拆成current backend基础和pending Mac/iPhone UI；现有v4 auto workers只标backend窄能力。旧accepted、R3 pin、app/data/DB/production均未改。

## 2026-08-24 Slice 0 R3 极窄文档整改

- ⚠️ R2复审为 `FAIL / P0=0 / P1=2 / P2=1`，Slice 0仍未关闭；时态为 `R3_REVIEW_PENDING`。
- Source已恢复唯一Spec的正交字段：`lifecycle_status=proposed|active|paused|retired`，`collection_onboarding_status`保留validating等16值及frozen完整edge；ADR默认、migration、DTO、Function矩阵逐字统一，并补四RSS/59X old→new mapping与rollback负例。
- Public V1按当前 `app/src/server/public/types.ts` hash固定中文compat身份，V2使用独立bilingual DTO；header只闭合应用自有安全header并拒绝forwarded/auth敏感header；FreshAction逐高风险route映射。Release返回版本化manifest role和pair receipt，Cost以actual/estimate各自availability union区分零、未知和估算。未改app/data/old accepted/R3 pin。

## 2026-08-24 Slice 0 R4 唯一P1极窄修订

- ⚠️ Slice 0仍为 `R4_REVIEW_PENDING`。本轮只修Source canonical status与派生fence混写。
- ADR、实施合同、SourceDTO、0010 mapping和Function矩阵均显式保留`identity_status/relevance_status/monitorability`的当前Spec枚举与unknown默认；四RSS、59X、新source、activate及queued claim均逐项覆盖。
- 删除`identityFence/relevanceFence/monitorabilityFence/rightsFence/mediaFence`替代字段；改为只读`activation_readiness`五guard与`epoch_fences`五Datum。每个epoch fence均固定唯一真值、clear和Unknown语义；任一blocked/stale/unknown零写零外联。未改app/data/old accepted/R3 external pin。

## 2026-08-24 Slice 0 R4 独立复审关闭

- ✅ R4独立复审为`PASS / P0=0 / P1=0 / P2=0 / Slice0Gate=CLOSED_PASS`；Slice 0目标合同文档门已`COMPLETE`。
- 关闭pin：`review-report.md` SHA-256 `3e6c69ee2c3f67523b0cfd6c9ea15ed1eee1692c2d61d371516e207345de3a22`；`review-receipt.json` SHA-256 `03327aa1af9119e55681f591e24bd4160c657973392bfe2bc53f45b01fe5d4aa`；`manifest.json` SHA-256 `09fa3a08e3736d29a198ced3e71e4983b9ccc2dbcc26440bfd665ba9cc44f022`；根目录`scratch/2026-08-24-bilingual-admin-contract-review-r4/`。
- 历史FAIL与R3 external pin保持不变。该关闭只允许进入后继工程切片，不表示0007–0010、完整Admin、双语Public、M1或production已实现/部署；生产动作继续等待不可变`PRODUCTION-DEPLOYMENT-MANIFEST`。

## 2026-08-24 0007 fence/rollback successor 合同落账

- ✅ 新建accepted-contract ADR与实施合同，冻结one-fence/one-verified-receipt、system-supervisor-only、同一`BEGIN IMMEDIATE`、control CAS、fresh receipt、policy/recovery/writer epoch、hash-chained audit、opaque capability及closed edge/seed。
- ✅ 冻结纯DB composite rollback为`authorized→blocked / BUSINESS_TRANSACTION_ROLLED_BACK`；独立settlement事务必须证明no attempt/no committed business outbox/effect并销毁capability。orphan authorized以owner-session lease过期和相同零效果证明收敛为blocked，禁止自动重授权、重放或clear。
- ✅ 旧0007 contract `8dffe664…e5ad`、manifest `feb9986e…958b`、SQL raw `ab32bb74…a163`、canonical `d651a156…4797`、post-schema `f3c0c049…d60`只标`SUPERSEDED_FOR_IMPLEMENTATION`；旧证据原字节未改。
- ⛔ 当前状态：`0007-successor-contract-review-pending / Slice1 BLOCKED`。新SQL/raw/canonical/post-schema/manifest/contract identity均`NOT_CREATED`；app/SQL/tests/data/DB/M1/network/model/publish/deploy均`NOT_RUN/NOT_CHANGED`。
- R3 external pin与Slice0 R4历史receipt保持原字节。R4历史CLOSED_PASS不覆盖本次新增P0；独立合同复审P0/P1归零前不得恢复Slice1。

- 门禁分层更正：当前`0007-successor-contract-review-pending`只需八份文档独立复审`P0=0/P1=0`，关闭后进入`0007-successor-implementation-review-pending`并只授权另行派发隔离implementation候选；新SQL六身份、authorizer/crash/CAS/rollback和无workaround E2E属于第二门。第二门关闭前Slice1、0008和production继续blocked。
- R3 V2 marker字节保持不变；本次没有把marker不变外推为当前完整envelope仍PASS。retained target root当前脏树漂移的来源未在本文档任务中归因。

## 2026-08-24 0007 successor 合同门关闭

- ✅ 独立审核闭包固定为report `6c73bd52fc2617717302994f1ffe5571db1b2a78bdc05515a01a87a387e5aa8b`、receipt `74e959ca3a321d191d4fd7f02723f94a2b0e843bea685c93be93ac84c02daff8`、manifest `73ef34bb4466beea632b4cee5552be75f045a235682613acc255800f2828ff4f`，根目录`scratch/2026-08-24-0007-successor-contract-independent-review/`，manifest `2/2 OK`；结论`PASS / P0=0 / P1=0 / P2=0`及`MICRO_PASS / P0=0 / P1=0`。
- ✅ 当前为`contract CLOSED_PASS / 0007-successor-implementation-review-pending / Slice1 successor implementation AUTHORIZED_PENDING`；可以另行派发隔离implementation候选。
- ⛔ 第二门尚未关闭：新SQL和六身份仍`NOT_CREATED`，production-faithful E2E仍`NOT_RUN`；Slice1工程门、0008、真实DB、M1与production继续blocked。
- 历史FAIL、旧0007 frozen evidence、`SUPERSEDED_FOR_IMPLEMENTATION`和R3 external pin均保留。

## 2026-08-24 可信单用户 M1 quick-launch 合同落账

- ✅ 新建accepted quick-launch successor ADR，记录用户选择“可信单用户M1 + 自动RSS采集/双语处理 + 人工审核发布 + Admin私网”及same-UID残余风险接受；状态保持`quick-launch-contract-review-pending`。
- 路线裁定为`schema6 → shared旧0007 trusted_local_capability_accounting_v1 → 0008 manual X → 0009 bilingual → 0010 source registry`。shared旧0007 raw SHA仍为`ab32bb74fb404656bbdf6f84cc8a6967e18f8ed797f59ec27125291e5c26a163`；只用于可信本地capability/accounting/audit，不作high-assurance claim。R7继续deferred。
- 首版硬禁automatic review/publish，RSS collect与双语refine可自动；人工publish要求private Admin和fresh≤300秒。59 X proposed/disabled/manual URL，oEmbed disabled。旧0007 bootstrap禁止drop trigger/raw UPDATE；合法Admin control路径失败则重新blocked并另审最小additive替代。
- 上线门固定private Admin、signed snapshot/LKG、verified off-host backup与RPO≤900秒、COMMIT前rollback、COMMIT后同schema fallback。用户确认没有外部ID，记录`evidenceId=NOT_ISSUED`；production manifest门不变。本轮只写docs，app/data/DB/M1/deploy均未改。

## 2026-08-24 quick-launch automatic-zero 唯一P1整改

- ⚠️ 独立审核为`FAIL / P0=0 / P1=1 / P2=0 / NOT_CLOSED`；report/receipt SHA-256固定为`5fb3c8aa3bbbd453a69a7ef28222ebb9c0b56c69a1343dc1e19bd83cadfa5554`/`96ab78b838856fe5d2dabc20d51eaab5c9a76de1cb7f39bade41efcca9c40624`。当前保持`quick-launch-contract-review-pending`。
- 新ADR §10定义唯一`AutoAutomationZeroVector`：manifest固定quickLaunchCutoverAt/release/manifest/DB identity/auto process identity set/schedule inventory；review/publish各自process、schedule-registration、owner-handoff、prohibited-operation、prohibited-effect五轴全0。cutover前terminal历史保留且不计数；cutover后任一auto op/effect以及cutover前遗留nonterminal/queued均FAIL。
- exact域、状态闭集和SQL已覆盖schema7/legacy operation、handoff、audit、publication、internal/projection outbox；缺表、未知status/type、identity或收据为Unknown/NO_DEPLOY。当前Admin内嵌两个60秒timer与两个startup tick明确使schedule轴FAIL，后继quick-launch build必须提供静态call-graph和跨60秒窗口运行收据。
- Positive/negative已冻结：历史terminal存在=PASS；PID为0但内嵌timer存在=FAIL；cutover后no-work/terminal auto operation任一存在=FAIL。本轮未改app/data/DB/M1/deploy。

## 2026-08-24 quick-launch R2 合同门关闭

R2独立复审结论为`PASS / P0=0 / P1=0 / P2=0 / quick-launch contract gate=CLOSED_PASS`；report SHA-256 `9a75a70c462be4c76d5d0b4c5db8925e6a574b6a9f1fab05e1297dc8674bcadf`、receipt SHA-256 `763737f8c6eddd05d2e09232e948b5e55ebd917369d474558dbe3cba73928d70`、manifest SHA-256 `5020a905065ffaabc1bcc89a1ba43906240429faef22350fe7d526eb39f7687d`，证据根`scratch/2026-08-24-trusted-single-user-m1-quick-launch-independent-review-r2/`。当前状态收口为`contract CLOSED_PASS / engineering authorized pending`。该关闭只授权后继工程候选按既有合同另行实施与复审，不表示实现、production-shaped E2E、M1或production通过。首轮FAIL及其整改历史保留；当前`runtime.ts`两个60秒interval和两个startup tick继续令review/publish的schedule轴`FAIL / NO_DEPLOY`，必须由后继release移除或机械拒绝注册并取得§10全部收据后才可继续部署门。
