---
type: audit_report
department: 测试部
target: TASK-20260809-4C59A9已ACK焦点返回与主题hydration修复
status: final
date: 2026-08-09
related_task: TASK-20260809-0DAE96
decision: pass
tags: [M5, lightbox-focus, hydration, scoped-review, snapshot-drift]
summary: 本任务启动时冻结源码对应的既有production build在1440与390必要矩阵中通过三种lightbox关闭焦点返回、主题SSR持久化和React418为0，任务范围P0/P1均为0；验收期间后继任务改动四个源码文件，当前工作树标SNAPSHOT_DRIFT且未验证，结论不得外推后继候选，多图P1-03继续独立阻断。
p0: 0
p1: 0
p2: 0
---

# TASK-20260809-0DAE96 焦点返回与主题 hydration 独立复核报告

## 结论

`SCOPED PASS`。本任务范围 P0=0、P1=0、P2=0：启动时冻结源码对应的既有 production build 已独立通过 MEDIA-LIGHTBOX-004 焦点返回子项、UI-RUNTIME-001 与 UI-THEME-002 正常持久化子项。

验收期间开发部启动后继任务并修改工作树，结束复算命中 `SNAPSHOT_DRIFT`。因此本报告只证明本轮已经启动并实际测试的旧 build；当前后继工作树未验证，不能继承本报告 PASS。公开页 P1-03 真实多图阻断继续存在，也不属于本任务关闭范围。

## 启动时绑定 SHA-256

| 文件 | 启动时基线 |
|---|---|
| `app/src/app/layout.tsx` | `6aff5ef078a87bab6f1db4a81d7e3cca37bd8afe7a91b6a708b98c6a37f68658` |
| `app/src/components/f1/theme-preference.ts` | `d2e8429de2525e69688e8d8407e96bb6b72ba2edb9cf496e9db037560574846f` |
| `app/src/components/f1/f1-page-shell.tsx` | `46c87b6955223e6756528088efd688c1502a3b05e38df41dcccb947f1330aaee` |
| `app/src/features/stories/feed-experience.tsx` | `b3a737d711062e5d80dbf81251e2990683994c0be66d6921483eee847ec2512a` |
| `app/src/tests/public-ui.test.ts` | `1ea68d1dcbfadfc75c459196f61ed13e4ae61c799808ed486325362814e752d8` |
| `app/src/app/globals.css` | `abed20076cf1d4fe6f6e007fd12491a0e363e7cafcd76bb9016b56add63af688` |
| `app/src/features/stories/public-api.ts` | `87c4b0d535558ee7313d7e26074d63789b77acd86ffd668696ec5c711bbc2256` |

## 独立必要矩阵

### 1440×900

| 关闭路径 | 精确返回原触发元素 | inert | dialog | Tab 可继续 |
|---|---|---|---|---|
| Escape | PASS | 已清除 | 0 | PASS |
| 关闭按钮 | PASS | 已清除 | 0 | PASS |
| 背景外点 | PASS | 已清除 | 0 | PASS |

主题：light 首载 → dark 切换与刷新 → light 切换与刷新；每次刷新后 `html/body data-theme` 与主题按钮一致。首条展开、搜索 1 条、清空恢复 12 条均完成，console error/warning 为 `[]`，React #418=0。

### 390×844

| 关闭路径 | 精确返回原触发元素 | inert | dialog | Tab 可继续 |
|---|---|---|---|---|
| Escape | PASS | 已清除 | 0 | PASS |
| 关闭按钮 | PASS | 已清除 | 0 | PASS |
| 背景外点 | PASS | 已清除 | 0 | PASS |

Escape 路径首次在 220ms 动画中间态读取时焦点尚未返回；继续等待同一次关闭完成后，`dialog=0`、`inert=false`、`activeElement=IMG[aria-label=放大图片]`，且与原触发 locator 精确等值为 true。该中间态不计失败，也没有重跑其他通过路径。

主题：light → dark 刷新 → light 刷新；两次刷新后 `html/body data-theme` 与主题按钮一致，console error/warning 为 `[]`，React #418=0。

### SSR cookie

- `Cookie: f1p1-theme=dark`：SSR HTML 命中两处 `data-theme="dark"` 与“当前深色主题”按钮。
- `Cookie: f1p1-theme=light`：SSR HTML 命中两处 `data-theme="light"` 与“当前浅色主题”按钮。
- Health：`ready`、`local-only`、`accepted-public-synthetic`、`externalCalls=0`。

## 结束时 SNAPSHOT_DRIFT

| 文件 | 结束时 SHA | 判定 |
|---|---|---|
| `layout.tsx` | `6aff5ef078a87bab6f1db4a81d7e3cca37bd8afe7a91b6a708b98c6a37f68658` | 未漂移 |
| `theme-preference.ts` | `d2e8429de2525e69688e8d8407e96bb6b72ba2edb9cf496e9db037560574846f` | 未漂移 |
| `f1-page-shell.tsx` | `8bcdc208a22fc2c8d0e05a616b74a612378fc2394ac163f431380aa3cd5ebce2` | 漂移；当前未验证 |
| `feed-experience.tsx` | `e069edfac541524c5f5e83f366f94d7fb645d314880059f2a3d5cfb387d13d36` | 漂移；当前未验证 |
| `public-ui.test.ts` | `97790c51e0b1be14d049c6dd57a8ee2ba16f564e6227f86ac447703d35cfbf35` | 漂移；当前未验证 |
| `globals.css` | `b1b407ebc80cedaff47ecca0ba79fa40eb3bb097da4c574869e8d0a993b7f1bc` | 漂移；当前未验证 |
| `public-api.ts` | `87c4b0d535558ee7313d7e26074d63789b77acd86ffd668696ec5c711bbc2256` | 未漂移 |

本任务未重建或重启后继候选；以上四个漂移文件及其生成物不受本报告结论覆盖。

## 未验证与边界

- P1-03 真实多图、异常存储、触发元素真实卸载、公开页整体和后继任务功能均未验证。
- 未运行 full check、build、全量回归、视觉全矩阵、外部 I/O、真实采集、发布或部署。
- 当前工作树因后继任务并发修改而未验证；需要新任务绑定后继冻结 SHA 后重新验收。

## 实例与错题自检

- 本任务只启动一个 production 实例；结束后已向该启动会话发送 SIGINT，3000/3001 均无监听。
- 390 第一次操作段在首次打开 lightbox 前 locator 超时，`results=[]`；读取当前 DOM 后从既有状态继续，没有重复 1440 或其他已通过路径。
- 390 Escape 的 220ms 读数属于关闭动画中间态；以 dialog 实际卸载后的最终 activeElement 判定，避免假阳性。
- 严格区分“旧 build scoped PASS”和“当前工作树未验证”，没有把结论外推后继候选，也没有把 P1-03 写成完成。
- 未修改实现、设计、Spec、DTO、DB/data、lockfile 或 Git。

TASK_STATE_OK
