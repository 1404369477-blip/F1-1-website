---
type: audit_report
department: 安全部
target: 主题 cookie 与动态 SSR 边界定向安全复核
status: final
date: 2026-08-09
related_task: TASK-20260809-6680C2
decision: pass
tags: [theme-cookie, dynamic-ssr, loopback, secure-cookie, scoped-review]
summary: "SCOPED PASS：P0=0、P1=0、P2=0。f1p1-theme 仅接受 dark/light，非法值在 SSR 与客户端均回退 dark，不参与身份/权限/业务真值；Path=/、SameSite=Strict、Max-Age=31536000、Domain 缺省与客户端可读写在当前 loopback HTTP 开发边界可接受。生产必须 HTTPS+Secure、禁止共享缓存混用并重验动态 SSR 响应头；本报告不外推整站放行。"
---

# 主题 cookie 与动态 SSR 边界定向安全复核

## 结论

**SCOPED PASS：P0=0、P1=0、P2=0。** 本结论仅覆盖 `layout.tsx`、`theme-preference.ts` 和 `f1-page-shell.tsx` 的主题 cookie/动态 SSR 边界。不放行真实多图、整站、admin、采集、发布、真实媒体、部署或外部能力。

## 审查证据

- 冻结源码 SHA-256：`layout.tsx=6aff5ef078a87bab6f1db4a81d7e3cca37bd8afe7a91b6a708b98c6a37f68658`；`theme-preference.ts=d2e8429de2525e69688e8d8407e96bb6b72ba2edb9cf496e9db037560574846f`；`f1-page-shell.tsx=46c87b6955223e6756528088efd688c1502a3b05e38df41dcccb947f1330aaee`。
- cookie 名与 storage key 均为 `f1p1-theme`；服务端和客户端共用 `isF1Theme`，唯一允许值为 `dark|light`。缺失、非法、超长或任意文本都不会回显，SSR 回退 `dark`；未发现将 cookie 拼接到 HTML、CSS、URL、日志或查询。
- cookie 只决定 `html/body data-theme` 和主题按钮文案；全库定向搜索显示 cookie 读取只在 Root Layout，写入只在主题按钮。未参与 authentication、authorization、role、session、admin、provider、collector 或 publish 判定。
- 写入属性为 `Path=/; Max-Age=31536000; SameSite=Strict`，`Domain` 缺省因而保持 host-only。值不含凭证、身份、用户 ID、业务数据或秘密。
- `HttpOnly` 不适用于当前客户端主题按钮写入模型。该 cookie 必须永远保持非敏感、非权限、可丢失的显示偏好；若未来承载任何安全语义，必须改为服务端受控会话机制并重新审查。
- `cookies()` 使公开页按请求动态 SSR，用 cookie 白名单值同步 server snapshot；开发收据证明 dark/light 分别返回同值 `html/body` 主题和按钮文案，两视口刷新的 React #418=0。
- 这三个文件未发现 `fetch/XMLHttpRequest/WebSocket/EventSource/sendBeacon`、外部 URL、日志或错误内容回显。上游任务运行收据为 `externalCalls=0`、页面 console `[]`。

## 本地 HTTP 无 `Secure` 的边界

当前仅限 `http://127.0.0.1` loopback 开发实例，cookie 是可丢失的主题值，不含身份或秘密，也不参与任何安全判定。在这一精确边界内，为使本地 HTTP 能写入而缺少 `Secure` 可接受。

以下任一条成立时，该例外立即失效：绑定非 loopback、经局域网/公网访问、使用反向代理/外部域名、用于共享测试、cookie 增加任何身份/权限/业务语义，或以 HTTP 部署到可被第三方观测的链路。

## 生产前强制门槛

1. 公开入口只允许 HTTPS，HTTP 必须在受信边界作 308/301 跳转；启用 HSTS，并验证 TLS 终止与应用之间的可信链路。
2. 生产写入必须追加 `Secure`，继续保持 `SameSite=Strict; Path=/; Max-Age=31536000`和缺省 `Domain`。建议生产使用 `__Host-` 前缀的独立 cookie 名；若需兼容旧名，必须有明确迁移和删除旧 cookie 的收据。
3. 代码必须用明确、不信任请求 `X-Forwarded-Proto` 的受控生产配置决定 `Secure`；非 HTTPS 生产配置须 fail-closed，不得静默降级为无 `Secure`。
4. 对 `/`、`/stories/[publicId]` 实测 dark/light/非法/缺失 cookie：非法值必须回退 dark、不回显、不产生额外 `Set-Cookie`；响应不得含敏感日志或内部路径。
5. 动态 HTML 必须实测为 `Cache-Control: private, no-store` 或等价的禁止共享缓存策略；CDN/反代不得缓存并跨请求复用带主题的 SSR HTML。若采用缓存，需为 cookie 维度设计并完成独立安全复核，不得仅依赖应用内的动态标记。
6. 重验公开 API 的 `no-store`、`externalCalls=0`和动态 SSR 后的健康/feed/detail 语义无漂移；确认主题 cookie 仍只有一个代码读点与一个代码写点，不进入日志、监控标签、身份或业务真值。

## 已验证 / 未验证

**已验证：** 三文件哈希；`dark|light` 闭合白名单与非法值静态回退；cookie 属性、host-only、非敏感/非权限语义；读写点唯一；未发现外联、日志、敏感回显或后台能力引入；上游 dark/light SSR、hydration 与 `externalCalls=0` 运行收据。

**未验证 / NOT_RUN：** 非法/超长 cookie 的真实 production HTTP 响应；浏览器拒绝 cookie、localStorage 异常与 legacy 仅 localStorage 的首帧；任何 HTTPS/HSTS/CDN/反代/生产 `Secure`、HTML cache header 与跨用户缓存隔离；真实多图及整站其他功能。

## 错题自检

- 没有把非敏感主题 cookie 的 scoped PASS 写成整站或生产放行。
- 没有将本地 HTTP 无 `Secure` 推广到 LAN、反代、外部域名或生产。
- 没有把 `HttpOnly=false` 当成无条件安全；其成立条件是 cookie 永远非敏感、不参与安全判定。
- 没有修改任何实现，没有启动新实例、执行外联或扩大为整站审查。

## 任务收据

`TASK_STATE_OK | state_persisted | local_paths_checked=1 | external_declared=0 | 2026-08-09T11:12+08:00 | TASK-20260809-6680C2 | ee1cbfa0923775c2`

TASK_STATE_OK
