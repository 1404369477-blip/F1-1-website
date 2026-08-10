# TASK-20260809-4C59A9 视觉与运行证据索引

## 纠偏与范围

- 纠偏收据：`COR-20260809T102214-960E65`。
- 本任务只关闭 `P1-01 lightbox 焦点返回` 与 `P1-02 production React #418`。
- `P1-03 真实多图` 继续阻断，交全功能 successor；本证据不把公开页整体标为 PASS。

## 当前截图

| 文件 | DOM 验收视口/主题 | 导出像素 | SHA-256 | 说明 |
|---|---|---|---|---|
| `01-1440x900-dark.jpg` | 1440×900 / dark | 1048×900 | `846829f7c231dce147201237f2f54db43a8ca963b55855b5f4b1b303e820cd6c` | Browser 对 1440 截图归一为 1048×900；DOM 实测 `innerWidth=1440`。 |
| `02-1440x900-light.jpg` | 1440×900 / light | 1048×900 | `9adb581b01e243e8827c52c4008808e78ecb4adbdecd81f86a74c02bb3ebcaf4e` | 与深色证据使用同一 production 实例、同一展开状态。 |
| `03-390x844-dark.jpg` | 390×844 / dark | 390×844 | `a50cfebc1575208b475071b04fe3e9d9095abf4f8031f4c93a30d61f0ee9a074` | 原生 390×844 导出。 |
| `04-390x844-light.jpg` | 390×844 / light | 390×844 | `350869bf906b154e1b04c7320a49cc1a6cafdbcf3130ae7cd35b1cb3ea7822c7` | 与深色证据使用同一 production 实例、同一展开状态。 |

四张截图均来自最终 cookie/`useSyncExternalStore` 代码的同一个 production 实例。1440 与 390 均完成深浅切换和刷新；截图状态均为 12 条、首条展开。最终控制台日志为空，`React#418=0`。

本任务未改 `globals.css`；当前与测试部冻结候选的 CSS SHA-256 均为 `abed20076cf1d4fe6f6e007fd12491a0e363e7cafcd76bb9016b56add63af688`。因此浅色 token、布局和响应式字节没有漂移。

## 关键视觉布局对照

| 视口 | 冻结候选 | 本轮实测 | 结论 |
|---|---|---|---|
| 1440×900 | timeline 840px；固定右下工具；无横向溢出 | timeline 840px；首条 840px；主图 640×360；工具 184.16×60；无横向溢出 | MATCH |
| 390×844 | 首条 358px；主图 max-height 280px；Dock 390×52；无横向溢出 | 首条 358px；主图 358×201.375、max-height 280px；Dock 390×52；`scrollWidth=clientWidth=390` | MATCH |

生产页面无 `DRAFT`，资源审计无外部 URL；截图显示时间线、主图、证据行、桌面工具和移动 Dock 的视觉方向未改变。

## 功能收据

### P1-01｜LIGHTBOX_FOCUS_RETURN

1440×900 与 390×844 各执行三条真实路径：

| 关闭路径 | 精确返回原主图 | `#main-content[inert]` 清除 | dialog | 键盘继续 |
|---|---|---|---|---|
| Escape | PASS（两视口） | PASS | 0 | PASS |
| 关闭按钮 | PASS（两视口） | PASS | 0 | PASS |
| 背景外点 | PASS（两视口） | PASS | 0 | PASS |

触发元素若卸载，代码按稳定 `publicId` 依次恢复到同条媒体、同条展开按钮、搜索框、品牌或工具按钮，不以 `body` 为恢复目标。

### P1-02｜PRODUCTION_HYDRATION_418

- 1440：dark 首载/刷新 → light 切换 → light 刷新。
- 390：dark 首载/刷新 → light 切换 → light 刷新。
- 同一 production 实例内继续执行单条展开、详情加载、搜索 1 条和空白恢复 12 条。
- 最终页面 console 日志 `[]`；React `#418` 命中数为 `0`。
- SSR 使用白名单 cookie 决定 `initialTheme`，hydration 的 `useSyncExternalStore` `getServerSnapshot` 使用同一值；没有显式延迟帧，也没有使用 `suppressHydrationWarning`。
- `curl` 携带 `f1p1-theme=light` 时，SSR HTML 的 `html/body data-theme` 与主题按钮均为浅色；携带 `dark` 时三者均为深色。

## 边界

- 没有新增依赖、外部请求、真实媒体、DTO/data/DB 改动、部署或 Git 写操作。
- `P1-03` 没有通过复制单图、静态数据或隐藏入口处理。
- cookie 仅为非敏感显示偏好：名称 `f1p1-theme`，值只接受 `dark|light`，写入属性为 `Path=/; SameSite=Strict; Max-Age=31536000`。本地 HTTP 无 `Secure`，客户端写入所需故无 `HttpOnly`；不得用于秘密或权限判断。
