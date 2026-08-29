# 本地截图复现配方

- 任务：TASK-20260812-0C206C
- 工作目录：[M5-HOME]/Documents/F1+1
- 入口：本地临时 HTTP server 映射正式路径 `/admin/reviews`、`/admin/assets/app.css`、`/admin/assets/app.js`。
- Fixture：只有 loopback URL 显式携带 `fixture=review-ui-v1` 时启用；正式无参数入口默认请求真实 Admin API。
- 渲染器：Google Chrome 151.0.7922.137，headless + 本地 CDP，deviceScaleFactor=1。
- 网络：CDP Network 域直接阻断所有 HTTPS 请求，并记录全部 HTTP(S) 请求；若出现当前 `127.0.0.1` 临时 origin 之外的请求，整组截图失败且不生成 manifest。实测外部请求 0。
- 截图：1440×900 深色 pending、1440×900 浅色 approved、390×844 深色 pending 编辑/动作、390×844 浅色 approved 手动发布。
- 边界：fixture 内容与状态均为 synthetic，只验证正式静态 UI 的渲染、响应式与交互出口；不证明真实会话、真实 RSS、真实写入或 M1 运行。
