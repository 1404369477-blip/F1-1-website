# F1+1 · v0.2-draft · 设计系统说明（时间线优先 · 真实内容迭代）

> **状态：DRAFT v0.2 草案**。仅用于设计收敛与评审，不覆盖 v0.1、不改动正式 app / Spec / ADR。
> 交付物：`index.html`（可浏览器预览、可继续编辑的时间线样板）· `evidence.html`（证据墙）· `brand-spec.md` · 本文件 · `F1+1-v0.2-token-map.json`（实现级 token/组件映射，供实现合同）· `F1+1-v0.2-对比度验证.md`（WCAG 对比度复核）。
> 数据语义沿用现有公开 feed / detail，**无新增后端实体**。
> 数据已接入 **Motorsport.com F1 RSS 真实内容**（10 条，含中文提炼与真实多图），用于实测图片排版与真实来源链路。

---

## 1. 设计原则（收敛后）

1. **信息 + 时间 + 时间线是唯一核心**：整页以一条纵向时间轴呈现内容项；「发布时间 + 标题/摘要」为每项主体；内容按时间倒序。
2. **视觉层级压到三层**：时间轴 → 条目 → 证据小字。
3. **去干扰**：移除顶部导航、品牌字标（仅极小「F1+1」标记）、hero/lead 大卡、分类筛选条、胶囊按钮组、draft 面板。
4. **详情就地展开**：点条目在时间线内展开（手风琴一次一个），中文提炼 + 证据行；点击核心区外部自动收起。
5. **图片是主要展示内容**：每条内容以单张主图（原始比例、限高、不裁切）+ 缩略图导航呈现；悬停缩略图可预览、点击固定；单图内容不显示缩略图。
6. **玻璃材质克制**：仅悬浮工具与 toast 使用；时间线主体实色，靠发丝线/留白建立层级。
7. **默认深色 + 完整浅色**。
8. **轻量状态**：loading / empty / error / 404 / nomore / partial / offline 以骨架与单行文本呈现，均带返回/重试/刷新出口。
9. **可访问降级成立但轻**：reduced-transparency / reduced-motion / 焦点环 / 44px 触控保留。
10. **悬停浮现（Progressive Reveal）**：必要 UI 痕迹（顶栏工具、搜索、功能按钮、展开指示）低对比常驻，鼠标/键盘聚焦时浮现（全对比 + 微放大 1.04）；正文/日期/证据链保持全对比。
11. **真实内容中文呈现**：真实来源的标题/摘要/提炼以中文呈现，尽量保留原文表达与语境语气；无作者信息时不显示作者段。

---

## 2. Tokens（可实施映射）

### 2.1 颜色（OKLch，深/浅）

| Token | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--bg` | `oklch(0.145 0.008 252)` | `oklch(0.97 0.005 250)` | 页面底 |
| `--bg-elev` | `oklch(0.172 0.01 252)` | `oklch(0.99 0.003 250)` | 展开条目底 / 条目聚焦底 |
| `--surface` | `oklch(0.205 0.012 252)` | `oklch(1 0 0 / 1)` | seg / 降级表面 |
| `--surface-2` | `oklch(0.25 0.013 252)` | `oklch(0.94 0.006 250)` | 骨架 / 图片占位底 |
| `--fg` | `oklch(0.94 0.006 252)` | `oklch(0.22 0.012 252)` | 正文 / 提炼 |
| `--fg-strong` | `oklch(0.985 0.003 252)` | `oklch(0.14 0.012 252)` | 标题 |
| `--muted` | `oklch(0.68 0.012 252)` | `oklch(0.46 0.015 252)` | 摘要 / 次要（≥4.5:1） |
| `--faint` | `oklch(0.60 0.012 252)` | `oklch(0.54 0.015 252)` | 极次要 / 证据小字 / 时间 |
| `--border` | `oklch(0.285 0.012 252)` | `oklch(0.88 0.008 250)` | 发丝线 / 时间轴 |
| `--border-strong` | `oklch(0.48 0.014 252)` | `oklch(0.64 0.01 250)` | 控件边界 / 节点（非文本 ≥3:1） |
| `--accent` | `oklch(0.73 0.117 246)` | `oklch(0.47 0.14 246)` | 交互蓝（链接 / 选中 / 焦点） |
| `--accent-deep` | `oklch(0.6 0.125 246)` | `oklch(0.42 0.14 246)` | 交互 hover |
| `--signal` | `oklch(0.70 0.168 38)` | `oklch(0.50 0.15 35)` | 直播标记 / 品牌圆点 |
| `--on-accent` | 深色文字 | 白色文字 | seg 选中前景 |
| `--focus` | `oklch(0.76 0.13 246)` | `oklch(0.44 0.14 246)` | 键盘焦点环 |
| `--ok` | `oklch(0.72 0.15 155)` | `oklch(0.48 0.13 155)` | 成功 / 恢复 |
| `--danger` | `oklch(0.68 0.19 25)` | `oklch(0.52 0.16 25)` | 错误 |

### 2.2 字体

- Display（标题 / 日期 / 状态码）：`Barlow Condensed` 500–800 → CJK 黑体。日期 20px 粗体为时间线锚点（从 28px 收敛，避免过于突出）。
- Body（摘要 / 提炼 / 证据）：`Inter` 400–600 → CJK 黑体 → 系统 sans。提炼 14px / 1.6。
- Mono（时刻 HH:MM / 状态码）：`SF Mono / Menlo / Consolas`。

### 2.3 间距 / 圆角 / 图片

- 间距：4/8/12/16/24/32/48/64/96 px（`--s-1 … --s7`）。
- 圆角：`6 / 10 / 14 px`（`--r-sm/md/lg`）；**新闻/正文图片用 4px**（对齐 v0.1 图片 4px 硬边）。
- 图片：主图**原始比例、限高 255px**（`max-width:100%` + `max-height:255px`、左对齐、不裁切），4px 圆角，柔和投影（`0 1px 3px` + `0 8px 24px`），**无外框**；缩略图高 40px（移动端 32px）、4px 圆角、低不透明度 `.55`。
- 图片策略：**整图缩放不裁切**、呈现原始比例；单图内容不显示缩略图。

### 2.4 材质（Glass，克制）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--glass-bg` | 深 55% / 浅 50% 透明 surface | 悬浮工具 FAB / 面板 |
| `--glass-bg-strong` | 深 85% / 浅 85% 透明 | toast |
| `--blur` | 16px（低性能端 8px） | backdrop-filter |
| `--glass-border` | 白 10% / 黑 8% | 玻璃发丝边 |
| `--glass-hi` | `inset 0 1px 0` 高光 | 玻璃顶部高光 |

降级链：`backdrop-filter` 缺失或 `reduced-transparency` → `background: var(--surface)`；低性能设备 → `blur(8px)`。

### 2.5 动效（Motion）

| Token | 值 | 说明 |
| --- | --- | --- |
| `--t-fast / --t-base` | 140ms / 240ms | 状态过渡 / 展开动画 |
| `--ease` | `cubic-bezier(.22,.61,.36,1)` | 统一缓动 |
| 展开动画 | 240ms `0fr → 1fr` | 详情逐步展开，底部证据行随之下移 |
| lightbox 放大 | 340ms | 从源图位置缩放过渡到居中，背景逐步灰度 + 模糊 |
| 直播圆点 | 2.4s 呼吸 | 尊重 reduced-motion 时静止 |
| 展开箭头 | 240ms 旋转 | 尊重 reduced-motion 时瞬时 |

---

## 3. 组件

| 组件 | 规则 | data-od-id |
| --- | --- | --- |
| 极简顶栏 | 实色 + 发丝线；「F1+1」标记 + DRAFT 徽标 + 搜索框 + 主题 seg；控件均为 `.trace` 低对比常驻 | `topbar` `brand-min` `draft-mark` `search` `theme-toggle` |
| 搜索 | `.search` **无框**低对比（透明底、faint 文字）；hover/focus-within 浮现（`surface` 底 + 全对比 + 放大）；实时过滤时间线（客户端） | `search` `search-input` |
| 主题切换 | `.seg` **无框**透明；按钮默认 faint，hover → `fg` + `bg-elev`；选中态 accent 文字 + 浅底（非实心填充） | `theme-toggle` |
| 时间线 | 单列居中（max **920px**）；左侧 1px 纵向发丝轴 + 每项节点；宽屏不改变列数 | `timeline` `tl-list` |
| 时间标记 | 左列 64px **左对齐**：时刻（mono 11px）在上对齐「分类」行、日期（display 20px）在下对齐「标题」行；节点与轴对齐日期行 | `tl-item-*` |
| 条目 | 实色表面；标题 hover 变 accent（不降对比）；摘要钳 2 行 | `tl-item-*` |
| 主图 + 缩略图导航 | 单张主图（原始比例、限高 255px、左对齐、可点开放大）+ 左下方缩略图；**悬停缩略图临时切换主图、移走恢复、点击固定**；单图内容不显示缩略图 | `tl-media` `media-*` |
| 就地展开 | 手风琴一次一个，`0fr→1fr` 动画；展开：中文提炼（14px/1.6、满宽）→ 底部证据行；**点击核心区外部自动收起** | `tl-item-*` |
| lightbox | 点击主图 → 从原位置缩放放大、居中全彩；背景 `.app` 灰度 + 模糊 + 压暗；多图支持翻页（‹› 按钮 / 左右方向键 / Esc）；放大图 max 70vw/70vh | `lightbox` `lb-prev` `lb-next` `lb-count` |
| 悬浮工具 | 唯一玻璃浮层：主题 / 宽度 / 状态 / 降级模拟 | `draft-tool-toggle` `draft-tool` |
| 状态 | loading 骨架；empty / error / 404 / **nomore / partial / offline** 单行文本 + 返回路径 | `state-box` |

---

## 4. 状态与交互

| 状态 | 前景/背景 | 说明 |
| --- | --- | --- |
| hover | 标题/标记 → `accent`；条目底 → `bg-elev`；seg → `fg` | 前景亮度不降、对比不降 |
| focus-visible | 3px `--focus` 外环 + 2px offset | 所有可聚焦元素（含条目按钮） |
| 展开聚焦 | 展开条目高亮（标题 accent + 浅底）；**其余条目灰度降对比**（opacity .38 + grayscale .85，触屏 .5/.7） | `#tl.is-focusing` |
| active | seg 选中 = accent 文字 + 浅底；条目按下 → `surface-2` | |
| 图片导航 | 悬停缩略图 → 主图临时切换；移走 → 恢复当前图；点击 → 固定切换并激活 | `.ph-thumb` hover / click |
| 点击外部 | 详情展开时点击核心区（展开内容）外部 → 自动收起并恢复主页面 | `bindCollapseOutside` |
| 展开滚动 | `scrollIntoView({block:'start'})` + `scroll-margin-top:20px`：标题保持在视口顶部可见 | |

### 4b. 悬停浮现（Progressive Reveal）

| 层级 | 状态 | 实现 |
| --- | --- | --- |
| 低对比常驻 | 默认 | `.trace` 统一 `opacity: .5`；顶栏内控件鼠标进入顶栏先浮现到 `.85` |
| 悬停浮现 | `.trace:hover` | `opacity: 1` + `scale(1.04)`，150ms ease-out |
| 键盘聚焦 | `.trace:focus-visible` / `.search:focus-within` | 同样全对比 + 微放大；搜索整组一并浮现 |
| 触屏降级 | `@media (pointer: coarse)` | 基准对比提升到 `.85` |
| 减少动效 | `prefers-reduced-motion` / `[data-rm]` | 取消 scale，只保留对比度变化 |
| 证据/调试 | `#reveal=1`（`html[data-reveal]`） | 全部痕迹强制显形 |

**覆盖范围**：顶栏标记、主题 seg、搜索框、悬浮工具 FAB、条目展开指示（hover/focus 从 .35 浮现到 .9）。日期、标题、摘要、证据链不受低对比影响。

---

## 5. 响应式映射

| 宽度 | 布局 |
| --- | --- |
| 1440 | 单列居中（max 920px），发丝轴在左；单张主图（原始比例限高）+ 缩略图导航 |
| 1024 | 与 1440 相同单列 |
| 390 | 单列重排：时间/日期并排（日期在前），发丝轴与节点隐藏；主图限高、缩略图 32px；触控目标 ≥44px |

实现：`.app { container-type: inline-size }` + `@container` + `@media` 兜底；无页面级水平滚动。

---

## 6. 可访问与降级映射

| 场景 | 实现 |
| --- | --- |
| `prefers-reduced-transparency` | 玻璃 → `var(--surface)` 不透明，`backdrop-filter: none` |
| `prefers-reduced-motion` | 过渡 → `.01ms`；lightbox 缩放/淡入淡出、展开动画均跳过，滚动用 `auto` |
| 低性能设备 | `blur(8px) saturate(140%)` |
| 键盘焦点 | `:focus-visible` 3px 外环；条目为原生 `<button>`；`.trace:focus-visible` 同样浮现 |
| 触控目标 | 交互 ≥44px（原文链接、lightbox 翻页按钮 ≥44px）；`pointer: coarse` 痕迹基准对比 `.85` |
| 图片可访问 | 真实图有 alt（配图 N + 主题）；lightbox `role="dialog"` + `aria-modal` |
| 玻璃层文字保护 | 悬浮工具 / toast 有发丝边 + 高光；lightbox `+N` 徽标带文字阴影保证可读 |

---

## 7. 证据链（可扫读、低打扰、无冗余标签）

**条目（折叠）**：`信源 · 时间`（11.5px faint；作者存在时 `信源 · 作者 · 时间`，无作者不显示该段）
**条目（展开）**：中文提炼（14px/1.6，满宽）→ 详情图集（全部真实图）→ 底部证据行 `信源 · [作者] · 时间` + 「前往原文 ↗」（accent 文本链接，44px 触控）

说明：来源/作者/时间等**直接显示有效信息，不再带「来源」「作者」「原发」等说明标签**；`unknown` 不渲染（作者缺失时跳过该段）。

---

## 8. 验证与导出

- 打开 `index.html`，URL 参数驱动：`#theme=dark|light`、`#width=1440|1024|390`、`#state=timeline|loading|empty|error|404|nomore|partial|offline`、`#open=r1`（预展开）、`#search=…`、`#reveal=1`。
- 实测场景：
  - **真实多图**：r1（汉密尔顿/法拉利，4 图）、r8（威廉姆斯，4 图）→ 缩略图完整图 + 截断模糊 `+N`；r4/r5/r9（3/3/2 图）。
  - **图片 lightbox**：点任一图放大居中全彩、背景灰度模糊；多图翻页（‹› / 方向键）。
  - **点击外部收起**：展开详情后点击空白处恢复主页面。
  - **无作者**：真实源无 byline → 证据行不含作者段。
- `evidence.html`（同源 iframe 墙）可在浏览器打开并导出 PNG。
- 边界：草案产物，等待用户体验确认；**未宣称应用到正式产品**。已导出的 PNG 证据来自时间线极简迭代（深浅 × 1440/1024/390、就地展开、悬停浮现、搜索、loading、汇总墙），最新交互与真实内容请直接预览 `index.html`。
