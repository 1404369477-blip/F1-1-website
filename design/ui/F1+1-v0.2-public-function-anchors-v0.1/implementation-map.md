# F1+1 v0.2 公开页全功能视觉锚点候选 · 实现映射

## 1. 候选身份与修正说明

- 固定候选：`F1+1-v0.2-public-function-anchors-candidate-20260809.html`。
- 唯一视觉输入：`../F1+1-v0.2-全站设计/F1+1-v0.2-final-20260808.html`，SHA-256 `5a84bfb27294ebd727369118a95528f5b788bfacbe2d56cc03fcb006f6168cb1`。
- 当前候选以该冻结 HTML 的逐字节副本为起点，再在副本内增补 Function ID 视觉状态；顶栏、品牌、时间轴、字体、颜色、媒体、证据行、Dock、主题与动效均沿用冻结实现。
- 首版独立视觉外壳已因偏离最新冻结基准而撤回，并被当前冻结稿派生候选覆盖。首版浏览器记录不作为当前候选证据。
- 冻结文件、正式 App、Spec、accepted ADR、DTO 与数据合同均未修改。
- Admin、sources、RSS、真实采集、生产部署、媒体权利与真实路由接线不在本候选。

## 2. 六格样板入口

同一候选通过 DRAFT 控件或 URL hash 切换三宽与双主题，所有入口绑定同一文件与同一 SHA：

| 视口 | 深色 | 浅色 |
| --- | --- | --- |
| 1440 | `#theme=dark&width=1440&state=timeline` | `#theme=light&width=1440&state=timeline` |
| 1024 | `#theme=dark&width=1024&state=timeline` | `#theme=light&width=1024&state=timeline` |
| 390 | `#theme=dark&width=390&state=timeline` | `#theme=light&width=390&state=timeline` |

这六个入口是可渲染样板配置。六张 PNG 因浏览器调用被取消而保持 `Unknown`，不能把入口存在等同于截图验收通过。

## 3. Function ID → 视觉锚点 → 开发出口

| Function ID | `data-od-id` / 组件 | 候选可见状态 | 开发逐项出口 |
| --- | --- | --- | --- |
| `PUB-FEED-003` | `PUB-FEED-003-filters`、`PUB-FEED-003-search`、`PUB-FEED-003-empty` | 全部、赛事新闻、车手社交、名宿历史、赛场趣事；搜索无匹配 | 筛选绑定正式 `contentType` scope；切换时重置 cursor；搜索与分类共同作用时不得串页或重排旧内容 |
| `PUB-FEED-004` | `PUB-FEED-004-state` | `loading/empty/error/404/nomore/partial/offline` | 每态只给一个主说明和一个可继续动作；失败路径不得回退静态 Demo；重试同一读取 |
| `PUB-FEED-005` | `PUB-FEED-005-pagination` | 加载更多、append、已无更多、partial 保留已读条目 | 不透明 cursor 绑定当前筛选；append 不重复/不重排；partial 仅重试失败页 |
| `PUB-DETAIL-001` | `PUB-DETAIL-001-route` | 独立详情标题、中文详情、三条关键点、三条关联、原文与返回入口 | 正式 `/stories/{publicId}` 使用唯一 PublishedProjection；关联最多三条；返回信息流入口持续可用 |
| `PUB-DETAIL-004` | `PUB-DETAIL-004-inline-*` | 行内成功、行内 404、行内读取失败、同 publicId 恢复 | 错误留在当前条目内；时间线和已读内容保持；404 不泄露内部存在性 |
| `PUB-DETAIL-005` | `PUB-DETAIL-005-state` | 独立详情 404、读取失败、同 URL 重试、返回信息流 | 非法/未公开/不存在统一为公开 404；通用失败重试当前 URL；失败仍可返回信息流 |
| `UI-TOP-001` | `UI-TOP-001-topbar`、`UI-TOP-001-brand`、`UI-TOP-001-back-to-top` | 最新冻结顶栏与回顶工具 | 复用冻结几何；鼠标/键盘均可回顶；reduced-motion 瞬时；完成后焦点进入 `V-PUB-SHELL` |
| `UI-ACCORDION-001` | `UI-ACCORDION-001-*` | 单条展开、连续互斥、外点关闭、整条居中 | 定位对象为完整 `.tl-item`；高于视口时上边距下限 16px；reduced-motion 使用即时滚动 |
| `UI-THEME-002` | `UI-THEME-002-toggle` | 深浅主题切换、localStorage try/catch 回退 | 最近主题可恢复；读写异常不得抛出；无偏好或异常时默认深色；正式 App 还需避免 SSR/CSR 闪烁 |
| `UI-A11Y-001` | `V-PUB-SHELL` 与上述交互锚点 | 44px 主控件、3px 焦点环、reduced-motion、reduced-transparency、forced-colors、safe-area | 读屏、键盘、200% 缩放、强制色与真实设备必须在正式候选逐项运行；静态 CSS 仅提供设计锚点 |
| `0/1/4 media successor` | `PUB-MEDIA-0-*`、`PUB-MEDIA-1-*`、`PUB-MEDIA-4-*` | 0 图不制造空媒体框；1 图仅主图；4 图主图 + 证据行缩略图 | 使用正式有序媒体数组；图片失败保留标题、摘要和来源；媒体权利与代理策略另走门禁 |

## 4. 状态与恢复矩阵

| 状态 | 可见内容 | 恢复动作 | 正式实现约束 |
| --- | --- | --- | --- |
| `timeline` | 最新冻结时间线 + 分类 + 0/1/4 媒体 + 分页 | 无 | 正式 feed 单一投影 |
| `loading` | 与时间线同构的 5 条骨架 | 等待当前读取 | 不混入旧 Demo |
| `empty` | 无内容说明 | 刷新/清除正式 scope | 当前筛选保持可识别 |
| `error` | 聚合读取失败 | 重试同一 GET | 固定 Problem reason，不泄露内部信息 |
| `404` | 公开入口未找到 | 返回时间线 | 与内部存在性解耦 |
| `nomore` | 当前 scope 已读完 | 返回顶部 | 保留已读条目 |
| `partial` | 已读时间线 + 局部失败说明 | 重试失败项 | 同 cursor 重试，不清空成功页 |
| `offline` | 网络受限说明 | 刷新/重连 | 禁止以静态 Demo 冒充最近内容 |
| `inline-404` | r2 条目展开并显示公开 404 | 重试 r2 | 保留 feed 和当前阅读位置 |
| `inline-error` | r2 条目展开并显示读取失败 | 重试 r2 | 保留 feed 和当前阅读位置 |
| `detail` | 独立详情成功 | 返回资讯流 | 正式路由 `/stories/{publicId}` |
| `detail-404` | 独立公开 404 | 重试同 URL / 返回资讯流 | 非法、未公开、不存在同形 |
| `detail-error` | 独立详情读取失败 | 重试同 URL / 返回资讯流 | 不改变 URL，不创建第二对象 |

右下设置面板中的状态按钮仅用于设计证据导出，正式产品不得出货。正式开发必须从真实代码路径或正式 local synthetic fixture 到达同一视觉状态。

## 5. 最新冻结几何与 token

| 区域 | 冻结规则 | 1440 / 1024 / 390 要求 |
| --- | --- | --- |
| 外层 | `.app max-width:880px`，`padding-inline:clamp(16px,3.5vw,40px)` | 1440 内层约 800px；1024 模拟外层 1024px、时间线最多 920px；390 外层 390px、左右 16px、内容约 356px |
| 顶栏 | 44px 主控件 + 上下 8px + 1px 边线 | 桌面约 61px；移动上下 6px，约 57px；F1+1 圆点与 `v0.2 DRAFT` 层级保持冻结稿 |
| 时间轴 | `64px 1fr`，列间距 32px；线 `left:78px`，节点 `left:74px/top:38px` | 700px 以下改单列，隐藏轴线和节点，日期/时间置于条目左上 |
| 标题/摘要 | 标题 20px/1.18，摘要 13.5px/1.6，完整显示 | 不做卡片化或 line-clamp，不减少首屏信息结构 |
| 主媒体 | 原始比例、`max-width:100%`、桌面 `max-height:360px`、圆角 4px | 700px 以下 `max-height:280px`；不强制裁成 16:9 |
| 缩略图 | 桌面高 32px、gap 5px；移动高 22px、gap 3px | 与来源证据行底部对齐；1 图不显示；4 图保持一行 |
| 展开 | 240ms 网格行展开；完整条目计算视口居中 | reduced-motion 动画近零且滚动 `auto`；条目高于视口时保持顶部 16px |
| 工具 | 1440 右下固定无框文字；1024/390 为底部 Dock | Dock 高 `48px + safe-area`，展开最大 `440px + safe-area`，背景拦截穿透 |
| 主题 | 冻结 `oklch` 深浅 token | 正文实色，玻璃只用于悬浮工具；forced-colors 改系统色，reduced-transparency 取消 blur |

## 6. 与冻结 v0.2 的全部可见差异

| 增量 | 原因 | 正式实现 |
| --- | --- | --- |
| kicker 下新增五段分类筛选 | `PUB-FEED-003` | 是，连接正式 `contentType` |
| 时间线末尾新增“加载更多 / 已无更多” | `PUB-FEED-005` | 是，连接正式 cursor |
| r3 改为 0 图样例并显示无媒体说明线 | 0 媒体 successor | 0 图几何和内容连续性进入；样例文案不进入 |
| partial 状态在已读时间线下显示局部失败条 | 保留成功页并恢复失败 cursor | 是 |
| DRAFT 状态控件新增行内 404/error、独立详情/404/error | `PUB-DETAIL-001/004/005` 取证入口 | 控件否；这些状态和正式路由是 |
| 独立详情与详情错误在同文件中作为设计状态渲染 | 为开发固定内容层级与恢复动作 | 页面结构是；正式开发使用真实路由 |
| forced-colors 增补系统色规则，回顶后焦点进入主阅读区 | `UI-A11Y-001`、`UI-TOP-001` | 是 |

以下变化不产生页面主体视觉差异：页面 title/meta 更新为候选身份；`data-od-id` 改为 Function ID；脚本增加筛选、分页、状态与安全回退映射。

冻结稿原有 `v0.2 DRAFT`、设置面板的正式项占位、DRAFT 宽度/状态/降级控件和页脚证据链接继续属于设计状态标识。开发需要复现其承载的顶栏、Dock、主题和状态几何；`DRAFT` 文本、占位设置项、证据状态切换器和无效本地文档链接不得出货。

## 7. 开发验收出口

1. 实现身份必须绑定冻结输入 SHA 与获用户确认后的增量候选 SHA；用户确认前不得替换公开视觉基线。
2. 每个 Function ID 必须从正式页面、正式 local synthetic fixture 或正式故障注入可达；隐藏调试分支不算完成。
3. 同一实现候选提供 1440/1024/390 × 深浅六格运行证据，并与实现 hash、数据 profile 和浏览器断言绑定。
4. 逐项验证分类 scope/cursor、加载更多 append/partial、行内与独立详情错误恢复、A→B 互斥与整项居中、主题存储异常、回顶焦点。
5. 逐项运行键盘、读屏、200%、forced-colors、reduced-transparency、reduced-motion 和实体安全区；静态 CSS 不替代运行验收。
6. Kimi 每批使用预处理至长边 1600 的 1–2 张对比图，最多 3 张；结论绑定截图并由设计部人工复核。Kimi 不替代像素差异、浏览器、无障碍或用户确认。

## 8. 当前证据边界

- 已验证：冻结输入 SHA 未漂移；当前候选的脚本可被 JavaScript 解析；目标 Function ID、七类 feed 状态、两类 inline 状态、三类独立详情状态、三宽、双主题、0/1/4 媒体、44px、焦点、forced-colors、reduced-motion/reduced-transparency 与 safe-area 静态锚点存在。
- 已取消：旧独立视觉外壳的浏览器记录；它与当前冻结稿派生候选不绑定，不能复用。
- `Unknown`：当前候选六张 PNG、完整浏览器交互、390 实测中心差、200%/读屏/实体安全区、Storage getter/setter 抛错、正式 App/数据/路由接线。
- Kimi：`Unknown`。没有读取当前候选截图，也没有本任务视觉结论；未继续申请授权或重试。
- Open Design：未进入生成流程。该流程会新增 brief/用户输入门，与本任务“取消审批等待、只用现有本地产物收口”的授权边界冲突。
