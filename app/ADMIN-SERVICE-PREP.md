# F1+1 Admin 独立服务 prepare-only 运行清单

本清单对应 `TASK-20260812-B2CB5F` 的本地候选。它只描述准备与检查，不授权安装 Tailscale、加载 LaunchAgent、连接固定 M1、迁移真实数据库或开放任何公网入口。

## 固定边界

- 唯一监听：`127.0.0.1:3101`，代码不接受 host/port 覆盖。
- 私有 HTTPS：运行配置只接受一条 canonical HTTPS origin；WebAuthn RP ID 精确取该 origin 的 hostname。
- 静态入口：`GET|HEAD /admin/reviews`；固定资产只有 `/admin/assets/app.css` 与 `/admin/assets/app.js`。
- 公开 Next：本候选不修改 `src/app`、公开端口 `3000`、Cloudflare Quick Tunnel 或公开数据库。
- 安装器：`admin:prepare-macos` 只生成私有目录、0600 配置/secret/bootstrap 文件和 disabled plist；没有 `launchctl load/bootstrap/kickstart` 代码。
- bootstrap token 原文只进入 0600 本机文件。CLI 只返回 token 文件路径和过期时间，不输出 token 值。

## 认证与业务顺序

1. 首次注册：`bootstrap/options → bootstrap/verify`；challenge 最长 2 分钟，bootstrap token 最长 10 分钟且成功后消费。
2. 日常登录：`login/options → login/verify`；成功后获得 `__Host-f1_admin_session`。
3. 普通 mutation：用同一请求体向 `/api/admin/csrf` 取得一次性 `x-csrf-token`，再提交原 mutation。
4. 手动发布：`fresh/options → fresh/verify`（两步都携带完整 PublishRequest）→ 使用旋转后的 session 再取 CSRF → publish 同时提交 `x-csrf-token` 与 `x-f1-fresh-reauth`。
5. 审核 DTO 使用 `sourceVersionTag`（当前完整 `sourcePayloadHash` 的前 12 位）；完整 64 位 hash 留在服务端。

## 端点闭集

| Method | Path | 用途 |
| --- | --- | --- |
| `GET/HEAD` | `/admin/reviews` | 独立静态 Admin shell |
| `POST` | `/api/admin/auth/bootstrap/options` | 首次注册 options |
| `POST` | `/api/admin/auth/bootstrap/verify` | 首次注册 verify |
| `POST` | `/api/admin/auth/login/options` | passkey 登录 options |
| `POST` | `/api/admin/auth/login/verify` | 登录 verify 与 session cookie |
| `POST` | `/api/admin/auth/fresh/options` | publish fresh passkey options |
| `POST` | `/api/admin/auth/fresh/verify` | fresh verify、session 轮换与 receipt |
| `GET/POST` | `/api/admin/reviews...`、`/api/admin/operations...`、`/api/admin/csrf` | 既有 `admin-review-v0.2` route facade |
| `GET` | `/api/admin/deliveries/{deliveryId}` | receiver receipt 对账 |
| `POST` | `/internal/projections` | 签名全量 projection package 接收 |
| `GET` | `/internal/projections/receipts/{deliveryId}` | 内部 receipt 对账 |

未知 method/path、百分号/反斜线/查询串/点段、非 loopback peer、错 Host、错 Origin、错 `Sec-Fetch-Site`、非精确 JSON Content-Type、未列入 allowlist 的 Tailscale identity/device 均关闭。

## 后继部署输入（当前不执行）

prepare-only CLI 需要以下运行窗输入，值不得写入 Git：

- `F1_ADMIN_CANONICAL_ORIGIN`
- `F1_ADMIN_OPERATOR_REF`
- `F1_ADMIN_TRUSTED_IDENTITIES_JSON`
- `F1_ADMIN_PROJECTION_SIGNING_KEY_ID`
- `F1_ADMIN_PROJECTION_VERIFY_KEY_PATH`
- `F1_ADMIN_PROJECTION_BOOTSTRAP_GENERATION`
- `F1_ADMIN_PROJECTION_BOOTSTRAP_HASH`

候选命令：

```bash
npm run admin:prepare-macos
npm run admin:status
```

只有后继 deployment manifest 获用户批准后，才允许在固定 M1 单独执行准备。LaunchAgent load、Tailscale Serve、真实 passkey 注册、真实 DB migration 与 public projection 切换必须分别保留独立任务和回退收据。

## 回退

当前任务没有加载服务，因此回退为停止使用候选文件并保留私有 manifest/DB 供审计。后继若曾加载服务，固定顺序为：关闭 mutation → 关闭 Serve → 停止 `3101` → 回读 listener=0；公开 `3000` 与 RSS collector 不动。
