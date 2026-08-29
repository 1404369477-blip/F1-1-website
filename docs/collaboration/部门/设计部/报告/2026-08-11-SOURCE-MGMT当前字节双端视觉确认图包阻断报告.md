---
task_id: TASK-20260811-A32E0E
department: 设计部
status: blocked
date: 2026-08-11
scope: /admin/sources current-byte visual-confirmation package only
---

# SOURCE-MGMT 当前字节双端视觉确认图包：渲染阻断收据

## 结论

本轮未形成可交付的四张新截图，任务按渲染失败路径阻断。没有复用任何历史 PNG，也没有生成用户确认包。

## 已固定的输入

- 统筹冻结 manifest：`docs/collaboration/部门/统筹部/报告/2026-08-09-SOURCE-MGMT-001视觉候选统筹冻结manifest.json`
  - SHA-256：`7686511f56f65ca5838ee9c907a24ac930d92974397d9b398d0d9ac90495f155`
- 当前 `/admin/sources` 候选：`design/ui/F1+1-M5-admin-sources-preview-v0.1/index.html`
  - SHA-256：`0d73ea294972627a7a832b42d999381da1fc4c8ea602b9fdbd04b11985156d68`

两项输入在领取后均复算一致；本轮未改动候选、正式 App、Spec、ADR，范围不含 Reviews。

## 一次首选渲染与一次本地兜底

1. 首选本地 Chrome 无头批次仅访问冻结本地 `file:` 候选，目标为 active 状态下的 1440×900、390×844 各深浅一张。进程以退出码 `134` 结束且没有创建四张目标文件。
2. 允许的一次本地 Quick Look 兜底只生成一个 `1440×1440` 的候选缩略图；它不具备指定 URL 查询状态、390 视口或四张精确尺寸，不能作为本任务证据，已作废清理。

因两条允许路径均未产生完整、当前字节、尺寸精确的四图，继续渲染会违反“首选一次、最多一次本地兜底”的限制，故停止。

## 已验证

- 两个指定输入的 SHA-256 与任务固定值一致。
- 候选为本地自包含 HTML；其 CSP 将 `connect-src`、`img-src`、`font-src`、`media-src`、`object-src`、`frame-src`、`base-uri`、`form-action` 设为 `none`。这属于候选静态零外联约束。
- 本轮没有启动正式 App、浏览器服务或外联，没有改动候选与受保护范围。

## 未验证 / 未生成

- 四张当前字节 PNG：1440×900 dark/light、390×844 dark/light。
- 运行时 `document.scrollWidth` 与 `window.innerWidth` 收据。
- 桌面固定操作列、局部横向控制和全部六项操作在新截图中的可见性与键盘可达性。
- 移动卡片、“新增本地信源”及“查看详情与操作”入口在新截图中的可见性。
- 候选运行时的零外联、无横向溢出及用户视觉确认。

## 错题自检

- 没有把旧证据或 Quick Look 非等价缩略图标记为当前截图。
- 没有用静态 HTML 断言替代运行时尺寸、焦点或可达性证据。
- 没有扩大到 `/admin/reviews`、Open Design、网络、正式 App 或额外渲染重试。

## 恢复条件

统筹需在不改变固定候选 SHA 的前提下，提供可用的本地等价渲染能力，或重新授权一个明确且可审计的渲染路径；恢复时仍需重新生成四张新图，不能采用本轮已作废输出。
