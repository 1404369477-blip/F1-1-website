---
type: work_report
department: 研究部
target: HyperFrames(HeyGen 开源 HTML→MP4 视频框架)深度调研,及其对 F1+1 发布视频渲染器/方法论选型的补充——修正 2026-08-11 Qwen-MM-Plugins 评估中对 hyperframes 成熟度的低估,并为任务 A 工具验证补充必测项
status: final
date: 2026-08-11
related_task: 无(用户 2026-08-11 主会话直接委托;配套 2026-08-09 发布视频调研报告与派单建议书,2026-08-11 Qwen-MM-Plugins 评估报告)
decision: add_hyperframes_to_task_A_tool_validation
tags: [HyperFrames, HeyGen, 发布视频, video-shotcraft, Remotion, 渲染器选型, HTML视频, frame.md, agent-skill]
summary: HyperFrames 是 HeyGen 开源的开源 HTML→确定性 MP4 视频框架(heygen-com/hyperframes,Apache-2.0,40.5k★,2026-03 创建至今日均发版)。不是小工具:自带 19 个 agent skill(Claude Code/Codex/Cursor/Gemini 通用),其中 /product-launch-video 工作流专做"网站→产品宣传片",含真实站点 capture、frame.md 设计系统转译、门禁化 7 步流水线、并行 frame-worker 子代理,并有真实成片案例(huly.io 端到端)。frame.md 概念("每个品牌有 design.md,但没有一个为镜头而写")正是 F1+1 冻结设计→视频的转译需求。结论:video-shotcraft 不再具有明显独占优势,任务 A 工具验证须将 HyperFrames+product-launch-video 与 video-shotcraft+Remotion 并列实测,由证据决定任务 B 渲染器;两者均 Apache-2.0、均真实截图纪律。hyperframes-launches(示例仓库)无许可证,只读参考。
---

## 1. 调研边界与方法

- 检索日期 **2026-08-11**;范围:GitHub(`gh` API + 源码阅读)+ npm registry 只读。
- 未安装、未渲染、未调用付费 API;仅读取公开元数据、README、官方 guide、skill SKILL.md 与关键源码。
- 证据分级沿用研究部惯例:A=官方仓库/官方文档/npm registry 直接支撑;B=许可证或维护状态一项待复核;C=社区自述;合理推断=研究判断。
- Star 数为 2026-08-11 快照。

## 2. 先给结论

1. **HyperFrames 是发布视频选型里被低估的重量级选手**:HeyGen 开源,`heygen-com/hyperframes`(Apache-2.0,TypeScript,40,515★,3,859 fork,2026-03-10 创建至今每日发版,8-11 仍在推送)。npm CLI `hyperframes` v0.7.106,maintainer 含 `vance@heygen.com`(A)。此前 Qwen-MM-Plugins 评估中"hyperframes 2026-03 才发布、年轻"的描述**低估其成熟度**——40k★ 在 5 个月内追上 Remotion 量级(55.9k★ 多年积累),是 HTML 合成方向的事实标准。
2. **它有专做"网站→产品宣传片"的 `/product-launch-video` skill,与 video-shotcraft 正面竞争**:真实站点 capture(`npx hyperframes capture <url>`,抓真实截图/DOM/品牌 tokens,capture 失败即 hard stop、禁止合成兜底)→ frame.md 设计系统(把品牌 design.md 反转为面向镜头的规格)→ 门禁化 7 步流水线 → 并行 frame-worker 子代理 → 终渲染(A,SKILL.md)。有真实端到端成片案例(huly.io,"screens are captured, not mocked")(A,官方 guide)。
3. **关键差异化:HTML 合成 + frame.md 转译,与 F1+1 天然同构**:F1+1 设计部工作在 HTML/CSS、冻结设计是单 HTML 文件;HyperFrames 就是"写 HTML 渲染视频",无 React/Remotion 学习曲线。frame.md("每个品牌有 design.md,但没有一个为镜头而写")直接对应把冻结设计 tokens/规则转译为视频规格的需求(A,README)。video-shotcraft 的 Q1 真实截图纪律、30x-video 的动效确定性,HyperFrames 的 capture+determinism 规则同样满足(A)。
4. **因此选型判断升级**:video-shotcraft 不再具有独占优势。任务 A 工具验证须把 **HyperFrames+/product-launch-video** 与 **video-shotcraft+Remotion** 并列实测(冻结 HTML 输入→真实截图→动效→渲染全链路、中文渲染、依赖体积),由证据决定任务 B 渲染器,而非预设(A/合理推断)。
5. **许可证干净,云依赖可选**:主框架 Apache-2.0;TTS/BGM 走 HeyGen 云(可选,`~/.heygen` 凭据,不入 env)或有离线兜底(Kokoro TTS);`music: none` 支持纯静默版。hyperframes-launches(示例仓库)确认**无许可证**,只读参考不采用(A)。F1+1 的 ENV_FORBIDDEN 纪律不受威胁。

## 3. 项目本体(A)

- **定位**: "Write HTML. Render video. Built for agents."——HTML/CSS/JS + 可 seek 动画 → 确定性 MP4;本地 CLI、agent skill、或 HeyGen 托管的云渲染/Studio。
- **规模**: 单仓 13 个包(cli/core/engine/lint/parsers/player/producer/sdk/shader-transitions/studio/studio-server/aws-lambda/gcp-cloud-run)。渲染链:无头 Chrome(puppeteer-core)+ ffmpeg;节拍分析(onnxruntime-node)、本地预览服务(hono)、字体(fontkit)。引擎要求 Node ≥22 + FFmpeg。
- **19 个 agent skill**(Claude Code/Cursor/Gemini CLI/Codex 通用):
  - 路由 `/hyperframes`(意图层,brief 确认门)。
  - 创作工作流 `/product-launch-video`、`/faceless-explainer`、`/pr-to-video`、`/embedded-captions`、`/talking-head-recut`、`/motion-graphics`、`/music-to-video`、`/slideshow`、`/general-video`、`/remotion-to-hyperframes`(Remotion→HTML 迁移)。
  - 领域 skill `/hyperframes-core`(构图契约)、`/hyperframes-animation`、`/hyperframes-keyframes`、`/hyperframes-creative`、`/media-use`(音频/素材 OS)、`/hyperframes-cli`、`/hyperframes-registry`、`/figma`。
- **安装**: `npx skills add heygen-com/hyperframes --full-depth`(或非交互 `npx hyperframes skills update` 装核心集);也有 Claude Code 插件市场(`.claude-plugin/marketplace.json`,core-skills 插件)。
- **frame.md 设计系统**: 多套已发布设计模板(biennale-yellow/blockframe/blue-professional/bold-poster/broadside/capsule…),`build-frame.mjs` 把 preset 的 FRAME.md 与品牌 tokens 确定性 remix(按角色映射 ink/canvas/accents,换品牌字体),自校验退出码。

## 4. /product-launch-video 工作流解剖(A)

门禁化 7 步(用户门禁在 Step 0/3/6,其余自动):

1. **Step 0 Setup**:确认 brief(`BRIEF.md` 为真值,意图层不问废话)、`hyperframes init`、`auth status` 展示语音/BGM 用 HeyGen 还是本地引擎(未登录不视为失败,可 offline/go)。
2. **Step 1 Capture**:`npx hyperframes capture <url>` 抓真实截图/整页 1x plate(1920 视口)、DOM、品牌 tokens/字体、资产目录。**失败即 hard stop**(`capture/BLOCKED.md`),禁止合成兜底;site tour 场景真实截图是视觉源真值,只重建需要动的组件,不整页重画。
3. **Step 2 设计系统**:选一个已发布 frame preset,`build-frame.mjs` 确定性 remix 品牌 tokens→本项目 `frame.md` + 字幕皮肤。
4. **Step 3 分镜与脚本**:story-design 出 `STORYBOARD.md`/`SCRIPT.md`,计划门(用户确认或 autonomous heads-up);不用 blueprint 硬套 beat。
5. **Step 3.1 音频**:TTS 旁白(HeyGen 或离线 Kokoro,`--voice` 指定)+ BGM(按 storyboard 的 `music:` mood 从 HeyGen 曲库检索,非生成);`music: none`+无 SCRIPT.md = 全静默标记,`audio.mjs` 干净跳过。
6. **Step 4 逐帧视觉设计**:先草图(wireframe 每帧,布局确认)再写进 STORYBOARD;每帧 time-coded shot sequence 对旁白展开(不前置加载);跨帧连续元素用 `handoff_in/handoff_out` 数值接缝(并行 worker 不得各画各的接缝);动效名须用 motion-language 词表,不得自造。
7. **Step 5 逐帧实现**:每帧派一个 frame-worker 子代理并行实现,`stage-assets.mjs` 落地已命名资产。
8. **Step 6 终渲染**:`hyperframes render` 输出 MP4(含 lint/check/snapshot 证据)。

## 5. 与 video-shotcraft 对比(A)

| 维度 | video-shotcraft(现首选) | HyperFrames /product-launch-video |
|---|---|---|
| 定位 | 网站→电影感产品视频,152 镜头配方卡+8 阶段流水线+判例审美法则+已验收模板(Ink Press 36.2s) | 网站/产品→宣传片,门禁化 7 步流水线+frame.md 设计系统+frame-worker 子代理 |
| 渲染引擎 | Remotion(React 逐帧,≤3 人免费) | 自研 HTML/CSS/GSAP→无头 Chrome(确定性,可 seek) |
| 真实截图纪律 | Q1 判例:真实截图+元素抠图+坐标 json,禁手搓 UI | `capture` 真实截图/DOM/tokens,失败 hard stop,禁合成兜底;有 huly.io 端到端成片 |
| 设计系统转译 | 品牌→动效参数推导表(合理推断) | **frame.md**:把 design.md 反转为面向镜头的规格,已发布多套设计模板 |
| 关注度/维护 | 4,257★,社区较集中 | 40,515★,3,859 fork,每日发版,HeyGen 公司背书,Discord |
| 验收机制 | 判例法则自检清单 | lint/check/snapshot + review-loop 门禁 + 客观证据 |
| 语言/文档 | 中英日文档 | 英文文档(官网 docs/showcase/playground) |
| 云依赖 | 无 | 可选:HeyGen 云渲染/TTS(需 ~/.heygen 凭据);离线 Kokoro 兜底;`music:none` 静默版 |
| 中文 | 自带中文文档 | 需自配 CJK 字体(设计部验证项) |
| 成熟度 | 有已验证模板 | 5 个月 40k★,版本迭代极快(API 可能漂移) |

## 6. F1+1 适配判断(合理推断,供统筹/设计吸收)

1. **任务 A 工具验证必须并列实测 HyperFrames 与 video-shotcraft**:两者都 Apache-2.0、都真实截图纪律、都满足"冻结 HTML→真实截图→动效→渲染"要求。区分点在:①设计部熟悉 HTML/CSS(HyperFrames 零 React 门槛)vs 已有 Remotion 社区生态(video-shotcraft);②frame.md 对冻结设计的直接转译价值;③40k★ 社区与每日发版的维护确定性 vs video-shotcraft 已验证模板的稳。**由实测证据(渲染质量/中文渲染/依赖体积/断点恢复)决定任务 B 渲染器,不再预设首选**。
2. **capture 对本地输入的适配需实测**:`new URL(url)` 只校验格式、不限制 scheme(A,源码),localhost 与 file:// 大概率可用,但"冻结 HTML 单文件/本地生产站点 `npm run start`"能否直接 capture 属任务 A 必测项;不行则用本地静态服务器托管冻结 HTML 后 capture。
3. **F1+1 冻结设计天然是 frame.md 的输入**:冻结设计 tokens(色板/字体/留白/运动气质)可经 build-frame 确定性 remix 进 frame 规格,比手写 Remotion React 更贴近设计部工作方式;但"蓝紫霓虹"等 AI 模板味 preset 须对照反 AI 模板味黑名单改写(与 Qwen 评估同一条门禁)。
4. **音频策略有完整梯度**:无旁白无 BGM(静默版,`music:none`)/ 仅 BGM / 中文旁白(Kokoro 离线或 HeyGen 云)。F1+1 可在任务 A 出口让用户在这三档选,不必预设。
5. **安全边界合规**:HeyGen 凭据走 `~/.heygen` 不进 env,符合 ENV_FORBIDDEN 纪律;云渲染可选,本地渲染默认;hyperframes-launches(无许可证)只读参考。
6. **依赖提示**:新增 npm 依赖(Node ≥22 已满足,ffmpeg 需本机安装)按项目规则逐项向用户说明。

## 7. 风险 / 未覆盖项

- **版本漂移**:CLI/skill 5 个月数百版,API 可能变动;任务 A 实测应记录锁定版本。
- **中文渲染**:官方未提 CJK 自带字体,F1+1 中文字幕/文案需验证 HyperFrames 无头 Chrome 的中文字体加载(对照 Qwen 评估里 LXGW 文楷思路)。
- **capture 本地输入、断点恢复、长渲染稳定性**在本机实测为 Unknown,归任务 A。
- **HeyGen 云服务条款/成本**未核验;若启用云 TTS/云渲染需另行评估并获用户确认。
- 未安装/未渲染/未调用任何付费服务。

## 8. 建议下一步

1. **更新派单建议书任务 A**:details 的"工具验证"一节由"最小验证 video-shotcraft+Remotion"扩展为"并列验证 HyperFrames+/product-launch-video 与 video-shotcraft+Remotion"(冻结 HTML capture、中文渲染、依赖体积、断点恢复、示例镜头渲染质量),由证据选任务 B 渲染器;任务 B 维持 user_required。
2. 设计部任务 A 吸收 frame.md 概念与 /product-launch-video 的 review-loop 门禁为参考;Qwen 评估里的脚本化验收门禁(review_gate/black_check 等)仍可叠加。
3. 本报告与 Qwen 评估合并为发布视频选型证据链:引擎层(Remotion/HyperFrames)×方法论层(video-shotcraft/HyperFrames product-launch-video/Qwen video-edit 门禁)。
4. 统筹部按更新后建议书派单;用户最终以任务 A 出口的可视化样片与实测数据决定渲染器与音频档位。

## 9. 证据清单(主要来源)

- github.com/heygen-com/hyperframes — README、.claude-plugin/marketplace.json、skills/product-launch-video/(SKILL.md、references/story-design.md 等)、docs/guides/product-launch-video.mdx、packages/cli/src/capture 源码、git/trees 递归目录树;Apache-2.0,40,515★(2026-08-11)
- npm registry — `npm view hyperframes`:v0.7.106,Apache-2.0,maintainers 含 vance@heygen.com,created 2026-03-23,数百版本
- github.com/heygen-com/hyperframes-launches — 392★,**无许可证**(license API 404),只读参考
- 配套:2026-08-09-发布视频方案与视频制作Skill生态调研.md;2026-08-09-设计部发布视频任务建议书.md;2026-08-11-Qwen-MM-Plugins-video-edit评估与发布视频方案补充.md
