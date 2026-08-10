---
type: work_report
department: 研究部
target: Leonxlnx/taste-skill(用户在 X 看到的 GitHub skill)内容与对 F1+1 的适用性
status: final
date: 2026-08-09
related_task: 无(用户 2026-08-09 主会话直接委托调研)
decision: absorb_selectively_do_not_install_project_wide
tags: [taste-skill, Claude-Skill, 前端设计, anti-slop, 安装评估, GitHub]
summary: Leonxlnx/taste-skill(74.4k★,MIT)是面向 landing page/作品集/改版的反 AI 模板味前端设计 skill,内容扎实(1206 行规则 + 60+ 条预飞行机械自检);但其自述范围明确排除产品 UI,且强意见型输出与 F1+1"严格贴合冻结设计、缺口退回设计部"的全局硬门存在冲突风险。建议不装进项目开发链,由设计部选择性吸收其黑名单与自检清单;若未来做营销落地页再评估在用户级环境单独安装。
---

## 1. 调研边界

- 用户 2026-08-09 主会话委托:查找 X 上被分享的 GitHub "taste skill",分析对 F1+1 的可用性并给出安装建议。
- 方法:GitHub API/`gh` 只读检索与全文阅读;未安装、未运行、未写入外部服务。Star 数为当日快照,仅作关注度信号(C 级),不作质量证据。

## 2. 定位:找到的是哪个

| 候选 | 关注度 | 许可证 | 判断 |
|---|---|---|---|
| **Leonxlnx/taste-skill** | 74.4k★ / 5.1k fork | MIT | **用户所指(名字完全匹配 + X 病毒式传播量级)**;2026-02 创建,2026-07-23 仍在维护;赞助含 Vercel OSS 计划、IMG.LY、animations.dev(Emil Kowalski)、Kimi 等(A) |
| pbakaus/impeccable | 57.2k★ | Apache-2.0 | 同生态"设计语言"底座,taste-skill 的思想近亲;备选 |
| senlindesign/taste-skill | 278★ | 未声明 | 同名不同物(逆向分析网站设计 tokens),排除 |
| h3nryprod01/design-taste | 26★ | — | 三合一流派合并版(emilkowalski/skill + impeccable + taste-skill),仅记录 |

注意:作者置顶声明有不法分子冒名发行加密代币骗局——这是病毒式仓库的常见伴随现象,不构成对内容的否定,但印证其传播量级;同时提示 **5 个月 74k★ 增长异常快,star 数一律不作质量证据**,以下判断全部基于全文本阅读。

## 3. 它是什么(内容评估)

单仓库 13 个 skill,主体是 `taste-skill`(安装名 `design-taste-frontend`,v2 实验版,SKILL.md 87KB/1206 行),外加风格变体(brutalist/minimalist/soft)、redesign、stitch、brandkit、imagegen 参考板等。自述定位原话:**"Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI."**

核心机制(已逐节阅读):

1. **§0 简报推断**:先"读空气"——页面类型/vibe 词/参考链接/受众/既有品牌资产/隐性约束,输出一行 Design Read 再动手;歧义时只准问一个问题。
2. **§1 三旋钮**:`DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY` 1–10 级,带信号→数值映射表和用例预设表;全部后续决策被三个旋钮门控。
3. **§2 设计系统地图**:简报到官方包的映射(Fluent/Material/Carbon/Polaris/Primer/GovUK/shadcn/Tailwind……),"是系统就装官方包,是美学就诚实标注为实现灵感";一个项目只准一套系统。
4. **§4 工程指令**:字体排印、色彩校准、布局多样化、卡片/阴影、交互状态、表单、版面硬规则、图像资产策略、内容密度、主题锁。
5. **§9 AI TELLS 黑名单**(带"Jane Doe 效应"等命名判例):禁 AI 紫渐变、纯黑 #000、过饱和强调色、三列等大特性卡、Inter 默认、假完美数字(99.99%)、Acme/Nexus 式假品牌名、"Elevate/Seamless/Unleash" 填充动词、div 假截图、失效 Unsplash 链接、em-dash 滥用等。
6. **§14 预飞行检查**:60+ 条**机械化**验收项(eyebrow 计数 ≤ ⌈区块数/3⌉、CTA 意图去重、8 区块至少 4 个布局家族、跑马灯每页至多 1 个、斜体下行字母行高余量……),任一条不过即不交付。
7. **附录**:各设计系统真实安装命令与官方文档链接、"Apple Liquid Glass 无官方 web 实现"的诚实标注。

**内容质量判断(合理推断)**:规则具体、可机械执行、带判例出处,不是空泛"要高级";与 30x-video 的 16 条品味法则、video-shotcraft 的判例审美法则同源互补(都禁紫渐变/三列卡/装饰横杠/假数据)。作为"把品味变成可验收项"的范式,是本轮调研中工程化程度最高的一份。

## 4. 对 F1+1 的可用之处

1. **反模板黑名单可直接比对吸收**:§9 清单与本项目设计规范、v0.2 冻结设计的实际选择(深色系、单列时间线、无三列卡)基本同向,可用来给设计规范补"禁止项"条目。
2. **预飞行清单范式**:把"品味"翻译成计数型/布尔型验收项的方法,值得设计部借鉴进视觉证据矩阵与验收出口(与调研报告 §3.5 的 12 条场景自检互补)。
3. **三旋钮参数化思维**:与 video-shotcraft 的品牌→动效参数推导表同构,可辅助设计部把 F1+1 的"高能竞技但克制"翻译成可复用 tokens。
4. **redesign-skill(先审计后改版)**:若未来对非冻结页面(如营销落地页、关于页)做改版,其"扫描→审计→定点进化 vs 全面重做决策树"流程可参考。
5. **对发布视频任务**:不直接适用(它是前端实现 skill,不是视频 skill);其反模板规则已被视频专用法则(30x-video/video-shotcraft)覆盖,无需为它改变既定派单。

## 5. 风险与不匹配项(为什么不建议装进项目)

1. **范围自述排除产品 UI**:F1+1 核心是资讯产品 UI(时间线/feed/详情/审核台),不是 landing page;skill 的主要火力区与项目主战场错位。
2. **与冻结设计硬门冲突(决定性)**:项目全局硬门要求开发严格贴合 v0.2 冻结设计(固定路径 + SHA-256),视觉缺口必须 block 退回设计部,**开发部不得自行补画、猜测或静默偏离**。taste-skill 是强意见型 skill,激活时会主动推动"偏离默认、按它的判断重做"——若在开发/实现会话中触发,有引导静默偏离冻结设计的现实风险。
3. **上下文成本**:主文档 87KB,激活时显著占用上下文;`npx skills add` 默认扫描安装全部 13 个 skill,误触发面大(如 redesign-skill 可能在维护任务中被意外激活并对冻结页面提"改版")。
4. **技术栈预设偏向营销页生态**(Tailwind/shadcn/GSAP sticky-stack/横向滚动),与 F1+1 Next.js 产品实现契约和已冻结视觉不完全对齐。
5. **安装面决策权属用户与统筹/产品**:按项目规则,新增依赖(含 skill)须先说明用途/替代/风险并经用户确认;项目级 `.claude/skills/` 会随仓库分发给所有协作会话,影响面远超个人试用。

## 6. 建议(结论)

1. **不建议**将 taste-skill 安装进 F1+1 项目级环境或开发链——范围错位 + 与冻结设计硬门冲突,风险大于收益。
2. **建议选择性吸收**:由设计部把 §9 AI TELLS 黑名单、§14 预飞行清单中与本项目设计规范不冲突的条目,甄别转化为设计规范补充与验收清单条目(转化时逐条标注来源与取舍);这不构成"安装",无依赖风险。
3. **个人级试用可选**:若用户想在设计探索会话体验,建议只装到用户级 `~/.claude/skills/`(不随仓库分发),且只装单一 skill:`npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"`;用于冻结设计之外的探索(如未来营销落地页),产出仍需过项目确认门禁。
4. **同类备选**:若日后需要"设计语言底座"型 skill,`pbakaus/impeccable`(57.2k★,Apache-2.0)可作对照评估对象。
5. 对正在派单的发布视频双任务**无影响**,不需要因此修改任务建议书。

## 7. 证据来源

- github.com/Leonxlnx/taste-skill — README、skills/taste-skill/SKILL.md(全文 1206 行)、skills/redesign-skill/SKILL.md、.claude-plugin/plugin.json、仓库元数据(2026-08-09 快照)
- github.com/pbakaus/impeccable、github.com/senlindesign/taste-skill、github.com/h3nryprod01/design-taste — 仓库元数据
- 关联:docs/collaboration/部门/研究部/报告/2026-08-09-发布视频方案与视频制作Skill生态调研.md(§3 反模板法则对照)
