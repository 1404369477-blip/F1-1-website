# F1+1 `/admin/sources` Design Candidate

状态：`Design Candidate / local synthetic / user confirmation required`

## 固定证据

- 产品合同 SHA-256：`a4b7230c89b0083f6d3f412d2c3f3f767c7f131d4ea422f85fe5721f75df686b`
- 冻结视觉 SHA-256：`5a84bfb27294ebd727369118a95528f5b788bfacbe2d56cc03fcb006f6168cb1`
- 冻结 baseline artifact：`data/m4-vs0-seed-enrichment-v0/source-seed-enriched.json`，SHA-256 `d4da9fc24c792c0471bcd24c525a46dcef1e521b36a870fd111e7310243888b2`，sorted projection root `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`。
- 安全 successor 补充 pin：产品 v0.3 SHA-256 `90ee4ed30d325b7b2833582cc0ac8134aefc7fbc2dcd43ec9d20c0f726b2f1fe`；它补充安全语义，不替换本任务固定的 v0.2 输入。
- 实现载体：`index.html`，单文件 HTML/CSS/JS，无外部字体、包、图片或网络依赖。
- CSP 将 `default-src`、`connect-src`、`img-src`、`font-src`、`media-src`、`object-src`、`frame-src` 全部关闭；只允许当前单文件内联样式和脚本。运行时设计目标 `externalCalls=0`。

## 视觉继承

继承冻结 v0.2 的冷灰黑深浅主题、紧凑编辑密度、1px 发丝线、窄体标题节奏、信号橙和仅用于浮层/Dock 的透明玻璃。未引入装饰性紫色。由于交付必须完全离线，Barlow Condensed 由本机窄体字体栈近似；浏览器没有对应本机字体时回退至系统无衬线。正文使用系统 UI 字体，URL/状态证据使用本机等宽字体。

## 结构与功能

- 1440：语义 table，覆盖 handle/URL、platform、lifecycle、enabled、onboarding、normalization、dedup、三门、最近 mock、updated_at、actions；详情从右侧 Drawer 打开。表格上方有持续可见的横向浏览提示与“← 列 / 列 →”键盘按钮，表格 region 自身可聚焦，最右 actions 列固定在可视区。
- 390：同一数据和 action controller 重排为卡片，详情、新增、确认和收据均为 full-screen layer；保留新增、validate、activate、stop、retire、dead-letter requeue，validation retry 复用 validate。
- 冻结 baseline 共 59 条，直接投影受 pin artifact 的 `source_id`、handle、canonical URL 及固定状态；全部 `baseline / disabled / read only`。任何 mutation 动作不显示，仅保留固定 actions 列中的详情入口。
- 四条 local synthetic 演示对象覆盖 proposed、active、dead-letter 与 validation failed，可在界面内继续新增。validation failed 行提供“重新验证”，仍调用 validate controller，并在确认层说明 fresh command identity、fresh CSRF 与 fresh SourceExpected 由可信运行时生成且不进入可编辑 UI。
- Drawer 包含不可点击的纯文本 URL 与显式复制按钮。HTML 不含 `a`、`link`、`img` 外链、预取、表单提交或网络 API。
- 危险确认显示当前对象、当前状态、预期结果和不可逆边界。收据只显示 command operation、operation_type、status、source、reason、updated_at。

## 状态与展示 alias

演示 Dock 可依次切换：`loading`、`filter-empty`、`partial`、`error`、`guard-shell`、`conflict`、`stale`、`blocked`、`dead-letter`、`active`、`stopped`、`response-unknown`。

- `guard-shell` 将 session、Host、Origin 与 CSRF 拒绝统一呈现为固定安全错误，候选不区分或暴露内部 token、Cookie、nonce、key 与校验细节；恢复出口只返回受保护入口或保持只读。
- `conflict` 明确覆盖 identity、`source_id` 与 canonical URL 碰撞：业务零写入，刷新 Source 后再以 fresh CAS 重新确认。界面不允许用户编辑 command identity 或 idempotency key。
- `unknown` 的固定可见标签是“未核验 / unknown”，只读且没有 mutation 出口。

已固定展示 alias：`unknown`、`restricted`、`failed`、`disabled`、`enqueued`、`enabled`、`normalization_pending`、`dedupe_pending`、`adapter_check_pending`、`proposed`、`manual_only`。它们仅存在于 read model，不写回 Source。

## 捕获入口

支持 query 参数：

```text
?theme=dark|light&viewport=mac|iphone&state=<state>&capture=1
```

建议四个冻结候选入口：

```text
index.html?theme=dark&viewport=mac&state=active&capture=1
index.html?theme=light&viewport=mac&state=active&capture=1
index.html?theme=dark&viewport=iphone&state=active&capture=1
index.html?theme=light&viewport=iphone&state=active&capture=1
```

## 恢复与安全语义

- response loss 显示“结果待确认”，唯一恢复路径为 GET command operation 后刷新 Source；界面明确禁止更换 operation/key 盲重试。
- validation retry 使用新的 command identity、fresh CSRF 与 fresh SourceExpected 调用 validate；不会生成 job、Outbox 或 TaskEnvelope。
- dead-letter requeue 复用原 business operation、key 与唯一 source_activation Outbox，只增加 retry generation。
- 不注册 DELETE、retry route、真实外联、第二 Outbox、第二 writer 或新增领域实体。

## 可访问性

所有控制至少 44px；移动端包含 safe-area；Drawer/Dialog 支持 focus trap、focus return 与 Escape；跨“详情→确认/收据→关闭”链路按稳定 `data-action + data-id` 重新定位原触发器，避免 DOM 重建后把焦点交回失效节点。键盘与触控进入同一 action controller，并用 busy 锁阻止重复 mutation。状态变化使用 `aria-live`。样式包含 200% zoom 下的流式重排、`forced-colors` 和 `prefers-reduced-motion` 分支。

桌面恢复与响应式策略：页面本身不横滚；高密度 table 仅在带边框的局部 region 内横滚，region 可由 Tab 聚焦，原生横向输入与上方两个 44px 按钮共享同一 scroll position 收据。最右 actions 列 sticky 固定，详情始终可达；validate、重新验证、activate、stop、retire、dead-letter requeue 均在详情 Drawer 的 sticky action footer 中可达。窄于 700px 或显式 `viewport=iphone` 时不保留横向表格，完整数据和同一 action controller 重排为卡片 + 全屏层，不删操作。

现有四张 PNG 保留为修订前 normal/active 参考图。一次本地 CLI 重新渲染未产生新文件或输出，所以本次修订后的桌面 sticky actions、横滚提示、390 无横溢和键盘滚动实机截图仍为 `Unknown`；不得以旧图代替新图，也不重复尝试渲染。

## 诚实边界

这是交互视觉候选。59 条 baseline 行来自受 pin 本地只读 artifact；新增对象、operation 与 receipt 仍是 local synthetic 演示数据。它不实现服务端 session、CSRF、CAS、SQLite、Outbox worker 或真实 GET/POST。产品 v0.3 已由 `TASK-20260809-A4392B` ACK，安全合同层复验 `TASK-20260809-1CEA8D` 已 ACK/PASS（P0/P1/P2=0）；本候选吸收 guard-shell、零写 conflict 和凭据不暴露的视觉约束。正式实现、运行时、SQLite/并发语义、11+16 mandatory golden 与用户视觉确认仍未完成，因此 `SOURCE-MGMT-001` 的实现/上线门保持关闭。
