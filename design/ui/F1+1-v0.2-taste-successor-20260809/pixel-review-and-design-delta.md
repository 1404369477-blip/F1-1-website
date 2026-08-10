# F1+1 v0.2 taste successor · 像素复核与设计增量

## 1. 不可变输入与交付边界

- 冻结输入：`../F1+1-v0.2-全站设计/F1+1-v0.2-final-20260808.html`
- 冻结 SHA-256：`5a84bfb27294ebd727369118a95528f5b788bfacbe2d56cc03fcb006f6168cb1`
- 隔离候选：`F1+1-v0.2-taste-successor-candidate-20260809.html`
- 候选用途：仅供用户视觉确认，不替换冻结基线，不作为正式 App 已实现证明。
- 未修改：冻结 HTML/index、`app/`、Spec、accepted ADR、公开页开发候选。

## 2. 五项像素复核

| 项目 | 状态 | 可见证据 | 结论与影响 |
|---|---|---|---|
| 浅色 Dock 实感 | verified | 冻结 1024/390 浅色图显示底部为硬实色条；successor 1024/390 浅色图显示透明到背景的渐变，并保留内容可读性 | 原实现视觉重量可接受，但与规范不一致；候选改为渐变 + 12px 模糊，reduced-transparency 时回退实色 |
| 深色底层次 | verified | 冻结与 successor 深色图均能区分页底、内容面与时间轴，首图表面未与底色糊成一片 | 保留深色底 token，不加额外泛光、渐变或高亮卡片 |
| Barlow Condensed 落屏 | verified（当前环境为未加载） | Open Design 本机预览中 `document.fonts.status=loaded`，但 `document.fonts.check('18px "Barlow Condensed"')=false`，已加载字体集中没有 Barlow；computed family 只证明声明，不能证明实际字形来源 | 删除无效 `Inter Tight` fallback；当前候选仍依赖远程字体，正式实现应自托管或提供可验证的窄体后备。冻结 PNG 只能显示视觉外观，无法证明具体字体文件 |
| 390 缩略图密度与触控 | verified（视觉）/ Unknown（真机 coarse） | successor 390 深浅图中 28px 缩略图可区分且不挤压来源；内置浏览器 390 视口无横向溢出 | fine-pointer 从 22px 调到 28px；coarse-pointer CSS 设 44×44。真实手机手指命中、不同 DPR 与安全区仍需真机补证 |
| 最差真实图裁切区文字对比 | verified（当前构图不适用） | 六格中正文、标题、证据文字均在独立底色上，真实主图没有叠字 | 当前构图不存在“图上文字最差裁切区”风险；以后如引入图上字，必须另做最差裁切对比度验证 |

## 3. P1/P2 逐项裁决

| 编号 | 裁决 | 证据 | 候选动作 | 影响 |
|---|---|---|---|---|
| P1-1 390 时间线隐喻丢失 | 修改 | 冻结 390 图无发丝轴/节点；核心定位仍是“信息 + 时间 + 时间线” | 390 恢复 1px 轴线与 7px 节点，正文只右移 14px | 核心隐喻恢复；空间成本可控 |
| P1-2 Dock 规范漂移 | 修改 | 冻结 CSS 为实色，规范写渐变模糊；浅色图可见硬底边 | 1024/390 改透明→`--dock-bg`→`--bg` 渐变与 12px blur；降级回实色 | 规范与实现重新一致；弱化硬横条 |
| P2-1 日期/标题同重 | 修改 | 冻结为日期 20/600、标题 20/700 | 日期降到 18px，标题保持 20/700 | 层级更清楚，不扩大标题占位 |
| P2-2 trace 可发现性 | 修改 | 冻结默认 opacity .50 | 默认提高到 .68，coarse 保持 .85 | 搜索/展开/工具可发现性提升，仍保持克制 |
| P2-3 浅色 faint 4.64:1 临界 | 保留并设护栏 | 现有对比度表为 4.64:1，六格未见丢失 | 不继续降亮度或叠加透明度；正式实现仍需 WCAG 复验 | 避免无证据调色造成全局漂移 |
| P2-4 失效字体 fallback | 修改 | 代码未加载 `Inter Tight`；Open Design 预览还证明 Barlow 当前未落屏 | 删除 `Inter Tight`；把 Barlow 自托管列为实现出口，不在本候选引入新字体资产 | 清理虚假 fallback；不静默增加外部依赖 |
| P2-5 文档落后 v0.2j/k | 修改 | 冻结文档写摘要 2 行/移动缩略图 32px，与 HTML 不一致 | 本文件记录 successor 的真实增量；冻结文档保持不可变 | 候选可追溯，避免改写冻结基线历史 |

## 4. 可见验证收据

- Open Design MCP 独立项目：`F1+1 v0.2 taste successor 20260809`。
- Open Design 本机预览导入内容摘要与候选 SHA 一致。
- 内置浏览器在 1440×900、1024×768、390×844 分别导出深浅 PNG；六图均为 RGB、non-interlaced PNG。
- 运行读取：三宽 `scrollWidth === innerWidth`；390 `lineDisplay=block`；1024/390 Dock 使用渐变与 `blur(12px) saturate(1.2)`；桌面日期为 18px；trace 为 .68。
- 390 可见图确认轴线与节点存在，主图、来源、缩略图、下一条标题无相互遮挡。

## 5. 未验证与唯一补证路径

- Open Design Cloud 当前未登录；未启动外部登录或审批。因此没有云端视觉代理结论。
- Kimi 本轮未读取 successor 六图、没有视觉结论；不得写成通过。
- Barlow 在当前 Open Design 本机预览未加载；生产环境字体自托管与字形一致性未验证。
- 真实 coarse-pointer 44px 命中、实体安全区、读屏、200% 缩放、forced-colors 实机、低性能设备未验证。
- 用户尚未确认 successor。唯一推进路径：用户查看六格后决定“接受候选 / 保留冻结稿 / 指定单项调整”；接受后再由统筹部建立后继冻结或实现任务。

