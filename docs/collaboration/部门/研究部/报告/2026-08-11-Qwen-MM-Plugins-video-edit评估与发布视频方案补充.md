---
type: work_report
department: 研究部
target: Qwen-MM-Plugins 项目评估,及其 video-edit 能力与发布视频首选方案 video-shotcraft 的对比,作为《2026-08-09-发布视频方案与视频制作Skill生态调研》的补充材料
status: final
date: 2026-08-11
related_task: 无(用户 2026-08-11 主会话直接委托;配套调研报告 2026-08-09,派单建议书 2026-08-09)
decision: supplement_video_shotcraft_keep_primary
tags: [Qwen-MM-Plugins, video-edit, hyperframes, video-shotcraft, 发布视频, 多模态插件, MCP, 评估]
summary: Qwen-MM-Plugins(Apache-2.0,1753★,2026-08-11 仍在推送)是 Qwen 官方多模态插件集,8 个能力各含 skill+MCP。其中 video-edit 是"剪辑导演型"skill——面向用户已有真实素材的剪辑任务,设计型交付物一律转手给 npx hyperframes(npm CLI,Apache-2.0,v0.7.106,2026-03 才发布),非"网站→产品视频"专用,不替代 video-shotcraft 作为 F1+1 发布视频首选。但其脚本化验收门禁(review_gate 带字节级哈希/black_check/loudness_check/contact_sheet/beat_grid)与两套产品宣传片原子资产包(tech-promo-neon-ui、prompt-to-product-ui)值得只读吸收进任务 B 的 QA 链;qwen_tts 与中文 OTF 字体(LXGW 文楷子集)为未来中文旁白/字幕渲染留了选项。DashScope 生成工具为可选云依赖,按量计费,与"真实资产纪律"和反 AI 模板味黑名单需小心对冲。
---

## 0. 勘误(2026-08-11,同日补充)

> 本报告对 hyperframes 的成熟度判断**低估**。深入调研后确认:hyperframes 实为 HeyGen 开源、40,515★、Apache-2.0 的完整 HTML→MP4 框架(`heygen-com/hyperframes`,2026-03 创建至今每日发版),自带 19 个 agent skill 与专做"网站→产品宣传片"的 `/product-launch-video` 工作流,与 video-shotcraft 构成渲染器+方法论双层的并列候选。全文修正:§6.3 的"hyperframes 是可议备选渲染器"应改为"任务 A 工具验证并列实测 HyperFrames 与 video-shotcraft,由证据决定任务 B 渲染器"。详见 [2026-08-11-HyperFrames调研与发布视频渲染器选型补充.md](2026-08-11-HyperFrames调研与发布视频渲染器选型补充.md)。本报告 §4/§5 中关于 Qwen video-edit skill 自身定位与门禁脚本吸收的判断不受影响。

## 1. 调研边界与方法

- 检索日期 **2026-08-11**,范围:GitHub(`gh` CLI + GitHub API 只读)+ npm registry 只读查询(`npm view`)。
- 未登录、未安装、未调用任何付费 API、未写入外部服务;仅读取公开仓库元数据、公开文档与 npm 包元数据。
- 证据分级沿用研究部惯例:**A** = 官方仓库/官方文档/npm registry 直接支撑;**B** = 主要事实可支撑但许可证或维护状态有一项待复核;**C** = 社区自述,仅作机制观察;**合理推断** = 研究判断,与事实分开标注。
- Star 数为 2026-08-11 查询快照;只反映社区关注度,不构成质量或许可证据。

## 2. 先给结论

1. **Qwen-MM-Plugins 不是发布视频的替代方案,而是补充**(A)。它是 Qwen 官方(QwenLM)多模态插件集,8 个能力;其中 `video-edit` 的自我定位是"剪辑导演 skill",面向**用户提供已有真实素材**的剪辑任务(vlog/蒙太奇/回顾/风格复刻),而 F1+1 发布视频是"从 brief 出发、无实拍素材、用真实页面截图组装的宣传片"——正是 video-edit 明确声明"直接走 hyperframes、不经本 skill"的场景(A,SKILL.md)。它的两个 workflow 是 `style-replication` 与 `vlog-multi-source`,**没有"网站→产品宣传片"专用流程**。
2. **最值得吸收的是它的证据化验收门禁**(A):`plan_gate.sh`/`scene_gate.sh`/`review_gate.sh`(review_gate 输出字节级身份哈希,无哈希=无效验收)、`black_check.sh`(黑帧客观检测)、`loudness_check.sh`、`contact_sheet.sh`(全长抽帧证据)、`beat_grid.py`(卡点误差表,≤3f)。这与 F1+1"证据化终检、独立复验"纪律高度同构,可直接移植进任务 B 的 QA 链,比 video-shotcraft 文档化的验收更脚本化、更客观。
3. **渲染链路是新的三层层叠依赖,且很年轻**(A/B):Qwen skill(Apache-2.0)→ `npx hyperframes` CLI(Apache-2.0, v0.7.106, 2026-03-23 首次发布)→ ffmpeg;生成侧另需 DashScope 云(按量计费)。`hyperframes` skill 家族(core/creative/registry/media/cli)各子包许可证本轮**未逐项核验**(B),引用前需复核。
4. **两套产品宣传片原子资产包可直接当"功能小品"配方**(A):`tech-promo-neon-ui`(霓虹描边/光标胶囊/聚焦扫描/环点聚合)与 `prompt-to-product-ui`(prompt 输入/UI 逐层生成/浮层拼贴/仪表盘点亮/风格滑杆)。其中 tech-promo-neon-ui 自带"近黑背景+少量发光元素"的克制规则,与 F1 暗色竞技调性可嫁接;但蓝紫粉霓虹配色须对照反 AI 模板味黑名单(§3.4)逐条自检,不得无脑套用。
5. **中文能力是它独有的增量**(A/合理推断):skill 自带 LXGW 文楷(LXGW WenKai)OFL 字体的中文子集(woff2 分包),解决无头浏览器中文渲染缺 CJK 字体的摩擦;`qwen_tts`(Qwen3-TTS-Flash)可作未来中文旁白选项。这两点对 video-shotcraft 是空白。

## 3. Qwen-MM-Plugins 项目本体速览(A)

- 仓库 `QwenLM/Qwen-MM-Plugins`:Apache-2.0,主语言 Python,1753★/83 fork,**2026-08-11 当天仍在推送**,未归档。一句定位:"Make any agent harness multimodal-native."
- 架构:一个能力 = 一个 **skill**(让模型知道有这套工具)+ 一个可选 **MCP server**(工具本体,`uvx` 按需拉起,需 [uv],免手动 pip)。支持 Claude Code / Codex / Qoder / OpenClaw / Qwen Code / Gemini CLI。
- 8 个能力:core(本地动态分辨率读图/视频/文档/3D + 裁剪标注抽帧)、api(DashScope VL/OCR/grounding/Omni 音视频/ASR/SAM3)、search(Serper 网页+反查图)、video-memory(长视频图记忆)、video-edit(剪辑+生成)、blender(驱动运行中 Blender)、freecad(驱动运行中 FreeCAD)、edu-agent(讲题视频,纯 skill)。
- 安装:Claude Code 插件市场 `claude plugin marketplace add https://github.com/QwenLM/Qwen-MM-Plugins.git && claude plugin install qwen-mm-plugins-<cap>@qwen-mm-plugins`。
- 对 F1+1 有用的仅 core 与 video-edit 两个;其余为 3D/CAD/教育视频,与本项目无关。

## 4. video-edit 能力解剖(A)

- **身份**:SKILL.md 自述"editing director"。两条信念:craft before compliance(品味在计划期落地,不在验收期发现);own the edit, delegate the design(本 skill 只管剪辑判断,设计型交付物转手 hyperframes 流水线,禁止重实现)。
- **执行模式按需缩放治理**:Delegated(自主)/ Co-creation(默认,三方向门禁 + 生成样张检查)/ Fine-tuning(逐条确认修改范围)。
- **标准流程 10 步**:resume 检查 → source review(真看素材)→ taste contract(设计读解+三个旋钮+签名设备)→ 方向门禁 → 时间线计划(节奏骨架/音频优先剪辑/节拍切镜;多场景建 Scene Ledger 锁定时间盒)→ **plan_gate.sh**(FAIL 不得开始组装)→ 素材准备(黄金段/seek-safe 重编码/有限校正)→ 组装(HyperFrames 转手;多场景逐场景渲染-LOCK-过 **scene_gate.sh** 才能整片渲染)→ 混音(两轨制)→ **final review**(自检 + 独立工具核验分离)→ persist。
- **验收证据化**:**review_gate.sh** 一条命令跑 ffprobe→loudness→black_check,输出带**字节级身份哈希**的 `REVIEW GATE` 块,必须原文粘贴进 verdict;手写 "pass" 而无 gate 输出 = 跳过验收。black_check 对"时间线有空洞→转场处黑帧"做客观兜底;beat_grid 出节拍误差表。
- **独立复验**:final-review 明确要求 clean-context 独立子代理核验(harnes 无子代理能力则用 vision_chat 对抗评审替代并注明),与 F1+1"测试部独立复验、不沿用设计部自测"纪律同构。
- **渲染转手**:设计型交付物一律走 `hyperframes` skill 家族(hyperframes-core 构图契约/STORYBOARD.md → creative 设计规格 → registry 预装块 → media 音视频引擎 → cli lint/check/snapshot/render)。本 skill 只交 taste contract、素材包、节奏计划、抠像资产、动效参考(借风格不借运行时,spring 预采样成 CSS keyframes / GSAP CustomEase,禁直接引 motion.dev 运行时)。
- **生成工具(DashScope 云,可选)**:`qwen_image`(文生图/图编辑/翻译)、`qwen_tts`(Qwen3-TTS-Flash,中文)、`wan_s2v`(Wan2.2-S2V 数字人唇形)、`wan_t2v`(Wan2.7 文生视频)、`happyhorse`(视频生成与剪辑)。均需 `DASHSCOPE_API_KEY`(环境表标注 **optional**——不用生成侧,本地剪辑/门禁/hyperframes 照常工作)。
- **自带资产**:字体(西文 ~30 款 OFL 子集 + 中文 LXGW 文楷子集)、SFX 3 个(chime/pop/whoosh,含 txt 许可)、atom-packs 2 套(tech-promo-neon-ui / prompt-to-product-ui,各含 atoms.json+preview.html+README)、motion/transition demo 脚本、check_env 自检脚本。

## 5. 与 video-shotcraft 关键对比(A)

| 维度 | video-shotcraft(首选,4257★) | Qwen video-edit(1753★ 全仓) |
|---|---|---|
| 定位 | 专为"前端项目/网页→电影感产品视频";152 张镜头配方卡 + 8 阶段流水线 + 判例审美法则 + 已验收模板(Ink Press 36.2s) | 剪辑导演 skill,面向已有真实素材的剪辑;设计型交付物转手 hyperframes |
| 对"网站发布视频"对口度 | **完全对口**(Q1 真实截图纪律与冻结 HTML 天然一致) | 不对口(无此专用 workflow;promo 从 brief 出发直走 hyperframes) |
| 渲染引擎 | Remotion(React 逐帧渲染;≤3 人组织免费) | `npx hyperframes`(HTML/CSS/GSAP → 无头 Chrome 渲染;Apache-2.0,2026-03 才发布,年轻) |
| 验收机制 | 判例法则自检清单(研究部已提取为任务 A/B 验收表) | 脚本化门禁 + 字节哈希 + 黑帧/响度/抽帧/节拍客观证据,更硬 |
| 生成能力 | 无(纯真实截图) | 可选 DashScope:文生图/TTS 中文/文生视频/数字人,按量计费 |
| 中文 | 有中文文档;CJK 渲染需自备字体 | 全中文文档 + 自带 LXGW 文楷中文子集 + 中文 TTS |
| 依赖 | Remotion + skill 本体,自包含 | 三层:Qwen skill + hyperframes CLI + ffmpeg;生成侧加云 |
| 成熟度 | 4257★,有已验收模板,判例沉淀 | 全仓 1753★,video-edit cookbook 无实测案例,TBD 居多 |

## 6. F1+1 适配判断(合理推断,供统筹/设计吸收)

1. **任务 A/B 首选维持 video-shotcraft 不变**:其"网站→产品视频"对口度、已验收模板与自包含性仍优于 Qwen video-edit;Qwen 这条链的 hyperframes 渲染器比 Remotion 年轻 2 个数量级关注度,且多了云依赖与未逐项核验的子包许可证,不应替代首选。
2. **吸收 Qwen 的验收门禁脚本进任务 B QA 链**(推荐):`review_gate.sh`(字节哈希证据)、`black_check.sh`、`loudness_check.sh`、`contact_sheet.sh`、`beat_grid.py` 均为 Apache-2.0 下自包含 bash/python,与 F1+1 证据化终检纪律同构。任务 B 的"逐镜头 QA + 判例自检"可叠加这套客观门禁,产出比"编号 ✓/✗"更强的机器可核验证据。实现方式:只读吸收脚本(复制进 scratch 工程验证后按项目依赖规则决定是否随工程入库),不整装 Qwen 插件。
3. **吸收产品宣传片原子资产包为"功能小品"配方**:tech-promo-neon-ui(近黑+光边,契合 F1 暗色竞技)与 prompt-to-product-ui 的原子动效清单可作 Act 3 三个功能小品(手风琴展开/缩略图导航/lightbox)的运镜/入场参考。**门禁**:两包配色偏蓝紫粉霓虹,须逐条对照反 AI 模板味黑名单(调研报告 §3.4:紫/蓝紫渐变背景、扩散圆环、心跳脉冲等禁用)改写,不得无脑套用;评审时把"AI 试金石"当作硬门。
4. **记录中文能力为未来选项**(不阻塞本次):若用户后续要中文旁白或中文字幕渲染,qwen_tts(Qwen3-TTS-Flash)与自带 LXGW 文楷子集是现成候选;本次任务 B 若出静默版或无旁白版则无需引入。
5. **不装插件本身**:core 与 video-edit 两个能力对 F1+1 当前任务的边际收益(读视频 + 剪辑门禁)低于其引入的依赖面(MCP server、uv/uvx、可能触发 DashScope key 进环境);门禁脚本与资产包可只读吸收,不必让插件进入项目 harness 环境。

## 7. 风险 / 未覆盖项

- **hyperframes 依赖链许可证未逐项核验**(B):`npx hyperframes` 主 CLI 已核验 Apache-2.0,但 hyperframes skill 家族各子包(core/creative/registry/media/cli)及依赖本报告未逐包核验,采纳 Qwen 渲染链前需复核。
- **DashScope 生成成本未核验**:按量计费的具体价格、额度、区域可用性本报告未查,若启用生成侧需另行核实并向用户说明。
- **年轻度**:hyperframes 首次发布 2026-03-23,video-edit cookbook 无实测案例;渲染/门禁脚本在本机 Node 24 的实测为 Unknown,归任务 A 工具验证环节。
- **风格冲突**:tech-promo-neon-ui 的霓虹配色与反 AI 模板味黑名单存在张力,吸收时须改写,不能整包直用。
- 未实际安装/运行 Qwen 插件或 hyperframes;未调用任何 DashScope 生成 API;未写入外部服务。

## 8. 建议下一步

1. 统筹部可维持 2026-08-09 派单建议书的任务 A/B 结构与命令不变(首选仍是 video-shotcraft);本报告作为补充材料随派单给设计部。
2. 设计部任务 A 工具验证环节可把 Qwen `review_gate.sh` 等脚本纳入对比验证(与 video-shotcraft 判例自检并行),为任务 B 选型沉淀证据。
3. 若用户倾向"HTML/GSAP 合成而非 Remotion 写 React",hyperframes 是可议备选渲染器——但先复核其 skill 家族许可证与在本机的实测。
4. 中文旁白/字幕需求待用户在任务 A 出口表态后再评估引入 qwen_tts 的可行性与成本。

## 9. 证据清单(主要来源)

- github.com/QwenLM/Qwen-MM-Plugins — README/README.zh.md、.claude-plugin/marketplace.json、cookbooks/video-edit/usage.md、src/capabilities/video-edit/skill/(SKILL.md、engines/{README,hyperframes.md,ffmpeg-direct.md}、review/final-review.md、workflows/style-replication.md、assets/atom-packs/*、assets/sfx/*)、git/trees 递归目录树;Apache-2.0,1753★(2026-08-11)
- npm registry — `npm view hyperframes`:v0.7.106,Apache-2.0,created 2026-03-23
- 配套:docs/collaboration/部门/研究部/报告/2026-08-09-发布视频方案与视频制作Skill生态调研.md;2026-08-09-设计部发布视频任务建议书.md
