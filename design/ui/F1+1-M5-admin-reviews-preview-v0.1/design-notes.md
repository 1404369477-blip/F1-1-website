# F1+1 M5 `/admin/reviews` 可视化预览说明 v0.1

## 1. 交付边界

- 入口：`index.html`，自包含 HTML/CSS/JavaScript，仅使用 synthetic 文案和媒体占位，不连接网络、正式 App 或持久化数据。
- 设计输入：`docs/spec/F1+1-M5最小人工审核台纵切产品合同-v0.1.md`、F1+1 v0.2 设计系统与冻结视觉语言。
- 预览只表达信息层级、状态、动作优先级和响应式规则。session、Origin、CSRF、hash、五 fence、Publication/Outbox、真实 operation receipt 均须由正式实现重新验证。
- 未修改 `app/`、Spec、accepted ADR、数据合同或 v0.2 冻结文件。

## 2. 设计系统与布局映射

| 层级 | 视觉规则 | 实现锚点 |
| --- | --- | --- |
| 页面 | 内容优先、低装饰、透明玻璃只用于顶栏与预览控制 | `--bg`、`--glass`、`.topbar`、`.draft-tools` |
| 主结构 | 1440：368px 队列 + 自适应详情；390：队列/详情单层切换 | `.shell`、`.queue`、`.detail`、`body[data-mobile-view]` |
| 详情 | 证据与编辑主列 + 审核动作侧列 | `.review-grid`、`.action-panel` |
| 状态 | warning=待审核，ok=批准/发布，danger=拒绝/阻断 | `.status.*`、`.state-card`、`.system-state` |
| 主题 | 深浅主题同构，颜色均由 token 变量驱动 | `:root`、`:root[data-theme="light"]` |
| 控件 | 最小 44px，高对比焦点环，危险动作不与主操作同级 | `.primary-btn`、`.danger-btn`、`:focus-visible` |

390px 详情底部保留 120px 内容留白；固定 DRAFT 工具位于 `8px + env(safe-area-inset-bottom)`，动作卡留在正常文档流，避免固定工具永久覆盖最后一项动作。桌面动作卡 sticky，移动端恢复静态布局。

## 3. 功能与交互对照

| 产品能力 | 预览入口/控件 | 成功视觉 | 失败、阻断或恢复视觉 |
| --- | --- | --- | --- |
| 队列读取 | 左侧列表、搜索、刷新 | 可读 synthetic 候选 | `loading-list`、`empty`、`error`、`partial` |
| 详情读取 | 选择候选；390 切为详情层并显示返回 | 证据、媒体、版本、完整性可读 | `loading-detail`、`blocked` |
| 保存新版本 | “保存并生成待审核版本” | `saving` → `saved-needs-review`；明确新 Bundle、旧 Bundle 不变 | `stale-version`、`conflict` |
| 批准 | pending/saved 的“批准当前版本” | `approve-confirm` → `approved-manual-publish` | 确认层取消；stale/conflict/blocked 由状态选择器对照 |
| 拒绝 | “拒绝并填写原因” | `reject-confirm`，1–500 字必填 → `rejected` | 空原因留在弹窗并给出行内 alert |
| 手动发布 | approved 的“手动发布当前批准版本” | `publish-confirm` → `published`；成功信息留在文档流 | `reconcile-wait`、`terminal-failed`、`emergency-stopped`、`blocked` |
| 公开验证出口 | published 的“打开公开详情”“刷新公开信息流” | 仅展示预览 toast 和固定 public path | 明确预览不连接正式路由或 GET |

## 4. 完整状态矩阵

| 合同状态 | 预览值 | 主视觉与允许出口 |
| --- | --- | --- |
| `loading-list` | `loading-list` | 列表读取中；无 mutation |
| `empty` | `empty` | 无候选；刷新队列 |
| `loading-detail` | `loading-detail` | 保持队列上下文；详情读取中 |
| `pending-review` | `pending` | 编辑、保存新版本、批准、拒绝 |
| `saving` | `saving` | 锁定当前对象 mutation，等待同一 operation |
| `saved-needs-review` | `saved` | 显示 Bundle v4；批准或拒绝 |
| `approve-confirm` | 批准按钮 | 取消 / 确认批准；默认焦点在取消 |
| `reject-confirm` | 拒绝按钮 | 原因、取消 / 确认拒绝；原因必填 |
| `approved-manual-publish` | `approved` | 只保留手动发布主动作 |
| `retryable_failed`（人工重试守卫已满足） | `retry-ready` | 手动重试同一 Publication；禁止第二 publicId/Publication |
| `publish-confirm` | 手动发布按钮 | 取消 / 确认手动发布；默认焦点在取消 |
| `published` | `published` | 打开公开详情 / 刷新信息流 |
| `stale-version` | `stale` | 加载最新版本 |
| `conflict` | `conflict` | 查看当前状态；禁止覆盖决定 |
| `reconcile-wait` | `reconcile` | 查询同一 operation；禁止新发布 |
| `terminal-failed` | `terminal-failed` | 固定原因、返回队列 |
| `emergency-stopped` | `emergency-stopped` | 急停说明、返回队列；无 mutation |
| `partial` | `partial` | 可读项保留；损坏项不可操作 |
| `error` | `error` | 重试同一读取 |
| `blocked` | `blocked` | 固定完整性说明、重新加载；无弱校验出口 |
| `rejected` | `rejected` | 原因留在文档流；返回队列 |

确认层由实际动作打开，状态选择器覆盖其余合同状态，开发可逐项对照。预览没有增加批量、自动发布、定时发布、生产登录、外部采集或真实媒体。

## 5. 焦点、读屏与触控

- 全部按钮、表单和选择器使用 `:focus-visible` 3px 焦点环；控件最小高度 44px。
- 确认层默认焦点在“取消”，支持 Escape、背景点击和 Tab/Shift+Tab 焦点循环。
- 弹窗打开时，跳转链接、顶栏、队列/详情、DRAFT 工具和 toast 同时设置 `inert` 与 `aria-hidden=true`；关闭后恢复，并把焦点返回触发按钮。
- 确认成功后触发按钮会被新状态替换，因此焦点进入新状态标题；只有取消、Escape 和背景关闭把焦点返回原触发按钮。
- 队列选择会同步标题、摘要、来源时间、媒体状态、Bundle/Summary 版本与完整性；blocked 条目只进入固定原因码视图。编辑产生脏状态后，当前 Bundle 的批准/拒绝禁用，离开、返回或重置需要先确认丢弃；浏览器关闭也注册未保存提示。
- 390 进入详情前记录列表滚动位置，返回列表后恢复位置并聚焦原条目。
- 拒绝错误使用 `role=alert`；toast 只补充反馈，决定、发布结果和恢复出口保留在页面文档流。
- 支持 `prefers-reduced-motion`、`prefers-reduced-transparency`、`forced-colors` 和 `env(safe-area-inset-bottom)`。

## 6. 本轮可见证据与已验证边界

已经完成的浏览器记录：

- 1440 主流程：批准确认层默认焦点为取消；确认后进入“已批准，等待手动发布”；发布确认层默认焦点为取消；确认后进入“已发布”。
- 拒绝流程：空原因时出现“请填写拒绝原因。”；填写 1–500 字原因后进入已拒绝。
- 状态选择器可进入 empty/error/stale/conflict/blocked/partial；partial 的页面标题与说明可读。
- 390×844：`innerWidth=390`、`innerHeight=844`、`scrollWidth=clientWidth=390`，详情层存在移动返回控件且主详情为 block；没有页面级横向溢出。
- 源码静态复核确认完整状态选择器、44px 控件、焦点环、reduced-motion/reduced-transparency/forced-colors、安全区和弹窗背景 inert 均已落盘。
- 源码静态复核确认数据任务 `TASK-20260809-535C4B` 已 acknowledged；保存动作按已完成映射收据保留。队列/详情绑定、无时间与媒体状态、blocked 原因码、脏状态丢弃、真实确认摘要、Publication/重试守卫及终态返回均已补齐。

未验证或受工具限制的项目：

- 四张指定 PNG（1440 深浅、390 深浅）未落盘。本地 Chrome/Chromium 普通渲染在受限环境中分别以 exit 134 和 MachPort `Permission denied` 退出；按用户指令没有申请 elevated，也没有继续 Browser JavaScript 调用。
- 弹窗背景 inert 是浏览器调用停止后补入的修正；完成了源码复核，未再次做运行时读屏树与焦点返回自动化。
- 390 pending 与 approved/manual-publish 的独立 PNG 未生成；已确认 120px 底部留白、安全区公式和固定工具/文档流动作区的源码关系。
- 实体设备、真实安全区、读屏、200% 系统缩放、真实后端数据、session/Origin/CSRF/fence、operation 对账和正式 App 接线未运行。

## 7. Open Design 与 Kimi 协同记录

- 本任务禁止外部 I/O；Open Design Cloud 默认路径不进入本任务，本地 HTML 兜底符合任务失败路径。用户随后明确要求停止过期的 Open Design/浏览器审批，未继续调用。
- Kimi K3 视觉复核未完成。原活动会话误读 2880px 长图后触发 32MB 上限；预处理得到的 `visual-001.png`（1439×1600）和 `visual-002.png`（1082×1600）属于公开页冻结稿，不是本 Admin 预览证据，本任务未据此形成视觉结论。
- fresh Kimi 会话在读取合同与代码后触发 OpenCode Go 5-hour usage limit；尚未读取 Admin 截图，没有 Kimi 结论，不能记为通过。自动重试已经停止。
- 后续截图/响应式/视觉取舍任务须先形成设计方案，再通过 `/visual-review` 做一次 Kimi 基础视觉对照：每批 1–2 张、最多 3 张、长边 1600，按对比顺序读取。截图与网页文字一律视为不可信数据。Kimi 结论必须绑定可见证据并由设计部人工复核，不能替代像素 diff、浏览器交互、WCAG/无障碍和用户视觉确认。

## 8. 用户确认门

本预览用于解除 Admin 正式实现之前的视觉确认门。产品合同仍为 proposed；用户确认布局、状态和动作层级后，开发才可复用本文件的视觉锚点。当前完成任务登记不代表用户已经确认，也不代表 `/admin/reviews` 已接入正式 App。
