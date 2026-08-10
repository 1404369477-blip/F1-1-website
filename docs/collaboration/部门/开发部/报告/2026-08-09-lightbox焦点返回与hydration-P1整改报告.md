---
type: development_delivery_report
status: final
date: 2026-08-09
department: 开发部
task_id: TASK-20260809-4C59A9
domain_stage: M5最终公开页P1整改
decision: scoped_pass_with_successor
summary: P1-01 lightbox 三类关闭路径焦点返回与 P1-02 production React#418 在任务范围内关闭；真实多图 P1-03、异常存储与触发元素卸载的实机故障注入留 successor，公开页整体未标 PASS。
---

# TASK-20260809-4C59A9｜lightbox 焦点返回与 hydration P1 整改报告

## 0. 结论

任务限定的 `P1-01 LIGHTBOX_FOCUS_RETURN` 与 `P1-02 PRODUCTION_HYDRATION_418` 结论为 **SCOPED PASS**。公开页整体仍有 `P1-03 REAL_MULTI_MEDIA` 阻断，本报告不把公开页整体写成 PASS。

本轮显式遵循 `COR-20260809T102214-960E65`：以 1440×900、390×844 的同视口深浅截图及关键布局实测证明视觉未改向；仅对两项已授权 P1 提供真实入口、状态链路和关闭/恢复路径。多图能力没有复制单图、扩 DTO、补静态数据或使用隐藏分支伪造完成。

## 1. 改动与边界

| 文件 | 改动 |
|---|---|
| `app/src/features/stories/feed-experience.tsx` | 保存触发元素与 `publicId`；关闭动画结束且背景 `inert` 清除后，依次返回精确触发元素、同条媒体、同条展开按钮、搜索、品牌或工具按钮；加入关闭重入、cancel 与异常兜底。 |
| `app/src/components/f1/theme-preference.ts` | 统一非敏感主题 storage/cookie key 与 `dark|light` 类型守门。 |
| `app/src/components/f1/f1-page-shell.tsx` | 用 `useSyncExternalStore` 对齐 SSR snapshot、hash 与 localStorage；主题切换同步非敏感 cookie，不使用 `suppressHydrationWarning` 或延迟帧。 |
| `app/src/app/layout.tsx` | 只读请求 cookie，经 `dark|light` 白名单后形成 `initialTheme`，同值写入 html/body 并传给 Shell。 |
| `app/src/tests/public-ui.test.ts` | 聚焦检查焦点恢复、重入/动画异常兜底、SSR cookie 与 hydration 约束。 |
| `docs/collaboration/部门/开发部/报告/TASK-20260809-4C59A9-evidence/` | 最终 production 实例的四张截图及证据索引。 |

未修改 `globals.css`、accepted API/DTO、DB/data、Spec/ADR、冻结设计、package/lockfile；未新增依赖、部署、Git 写入、真实采集、真实媒体或外部 I/O。`globals.css` SHA-256 保持 `abed20076cf1d4fe6f6e007fd12491a0e363e7cafcd76bb9016b56add63af688`，`public-api.ts` SHA-256 保持 `87c4b0d535558ee7313d7e26074d63789b77acd86ffd668696ec5c711bbc2256`。

## 2. 功能追踪

### P1-01｜LIGHTBOX_FOCUS_RETURN

真实 production 页面在 1440×900 与 390×844 各执行一次完整矩阵：

| 路径 | 精确原主图恢复 | `#main-content[inert]` | dialog | 后续键盘操作 |
|---|---|---|---|---|
| Escape | PASS（两视口） | 已清除 | 0 | PASS |
| 关闭按钮 | PASS（两视口） | 已清除 | 0 | PASS |
| 背景外点 | PASS（两视口） | 已清除 | 0 | PASS |

实现把焦点恢复推迟到 lightbox 卸载后的 layout effect，保证旧 effect cleanup 已移除 `inert`；关闭逻辑具备重复调用守门、animation `finish/cancel` 与异常路径兜底。触发元素消失时的降级顺序已落代码并由聚焦测试静态约束；本轮未通过人工删除 DOM 注入该异常，实机故障注入列入 §7。

### P1-02｜PRODUCTION_HYDRATION_418

- 同一 production 实例在 1440 与 390 分别完成 dark 首载/刷新、切换 light、light 刷新；最终浏览器控制台日志为 `[]`，React `#418` 命中为 `0`。
- 1440 同步执行首条展开、详情加载、搜索无匹配与清空恢复；状态均可达。
- SSR `curl` 收据：`Cookie: f1p1-theme=light` 返回 `html/body data-theme="light"` 与“当前浅色主题”按钮；`dark` 返回对应深色三项。
- `useSyncExternalStore` 的 server snapshot 与 layout 的 cookie `initialTheme` 相同；客户端 snapshot 只接受 hash/localStorage 中的 `dark|light`。未使用 `suppressHydrationWarning`。

## 3. cookie 安全与运行影响

| 项 | 结论 |
|---|---|
| 范围 | 非敏感显示偏好，名称 `f1p1-theme`；不承载身份、权限、秘密或业务状态。 |
| 值守门 | 服务端与客户端均只接受 `dark`、`light`；其他值回退默认 dark。 |
| 写入属性 | `Path=/; SameSite=Strict; Max-Age=31536000`。 |
| 本地属性说明 | 当前任务是 `http://127.0.0.1`，故未写 `Secure`；由浏览器端主题按钮写入，故不能使用 `HttpOnly`。这项 cookie 不得复用于安全决策。 |
| SSR 影响 | `cookies()` 使 App Router 页面按请求动态渲染；本轮 build 中 `/`、详情页及 API 均显示 `ƒ`。这是消除正常主题刷新首帧分叉的明确代价。 |
| 外部 I/O | `0`。页面仅访问任务专用 `127.0.0.1` 同源 API；主题只写浏览器 localStorage/hash/cookie。 |

## 4. 视觉证据

证据索引：`docs/collaboration/部门/开发部/报告/TASK-20260809-4C59A9-evidence/README.md`。

| 视口 | 深浅证据 | 关键实测 | 结论 |
|---|---|---|---|
| 1440×900 | `01` dark、`02` light | timeline/首条 840px，主图 640×360，右下工具 184.16×60，无横向溢出 | 与冻结 token/布局 MATCH |
| 390×844 | `03` dark、`04` light | 首条 358px，主图 358×201.375，Dock 390×52，无横向溢出 | 与冻结 token/布局 MATCH |

四张证据均显示 12 条状态并展开首条，来自最终 cookie/`useSyncExternalStore` 代码的同一 production 实例。本轮没有改动 CSS；颜色 token、布局、响应式和动效字节零漂移。浏览器控制工具自身曾产生一条到其 Statsig 服务的超时日志，该日志来自工具进程，未进入页面 console；页面 console 收据仍为 `[]`，应用资源与代码没有新增外部 URL。

## 5. 固定 Node24 收据

工具链：项目内隔离 Node `24.18.0`、随附 npm `11.16.0`，minimal env，`NEXT_TELEMETRY_DISABLED=1`。

| 命令 | 结果 |
|---|---|
| `npm run test -- src/tests/public-ui.test.ts` | PASS，1 file / 12 tests，230ms。 |
| `npm run lint` | PASS，0 errors；保留 3 条已有 `@next/next/no-img-element` 性能 warning。 |
| `npm run typecheck` | PASS，exit 0。 |
| `npm run build` | PASS，Next 16.2.11；全部路由为按请求动态渲染 `ƒ`。 |

按统筹收口要求，没有追加 full check、第二轮 build/typecheck 或其他功能测试。

## 6. 进程与清理

本轮 production 实例只监听 `127.0.0.1:3000`，health 返回 `status=ready`、`externalCalls=0`、Node `24.18.0`。验收后只停止本任务启动会话并确认端口释放；没有停止其他进程，也没有清理共享依赖、工具链、DB 或工作区文件。

## 7. 未关闭项与 successor

1. `P1-03 REAL_MULTI_MEDIA`：accepted DTO 当前只能给出 0/1 张媒体；真实多图入口仍阻断，交 successor，前端未造数据。
2. 触发元素在关闭动画期间被真实卸载的浏览器故障注入未运行；代码和聚焦测试已固定同条媒体→同条展开→搜索→品牌→工具的安全降级顺序，不宣称实机注入 PASS。
3. cookie 被浏览器策略拒写、localStorage 异常或旧用户只有 localStorage 而尚无 cookie 时，SSR 首帧与客户端偏好切换的无闪烁表现未在本轮证明；React hydration 结构仍使用确定 server snapshot，不以此扩写任务结论。该异常存储路径交 P1 successor。
4. 聚焦测试以适配器、静态 markup 与源码合同为主；本轮真实浏览器补齐了六条正常关闭路径，组件级异常卸载仍未挂载执行。

## 8. 自检

- 独立只读对抗复核结论为 `P0=0、P1=0`：幂等关闭、inert cleanup 后焦点恢复、cookie 初始主题与 `getServerSnapshot` 同值均满足本任务出口；reviewer 同样明确 P1-03 仍归独立 successor。
- 奥卡姆边界：没有新增实体、DTO、依赖、服务端主题设置或 fallback 数据。
- 墨菲边界：覆盖重复关闭、animation cancel/异常、两视口三关闭路径、深浅刷新、SSR cookie 白名单与 React#418 控制台检查。
- 没有把组件预留、静态分支、NOT_RUN 或文档声明计入已完成项。
- 本任务只关闭 P1-01/P1-02；公开页整体仍等待 P1-03 successor。

TASK_STATE_OK
