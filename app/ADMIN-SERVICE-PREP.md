# F1+1 Admin / Public Projection prepare-only 运行清单

本清单对应真实 RSS 公开投影 B 段本地候选。它只授权本地构建、核验与 prepare；不授权 SSH、固定 M1 操作、真实数据库迁移、`launchctl` load、Tailscale、公开 cutover 或公网变更。

## 固定运行边界

- Admin API/UI 只监听 `127.0.0.1:3101`；内部投影 receiver 只监听 `127.0.0.1:3102`；公开 Next 保持 `127.0.0.1:3000`。
- Admin sender 独占审核数据库与 Ed25519 私钥。public receiver/reader 只持有 public projection root、验签公钥和 key ID，不能读取 Admin 数据根或私钥。
- 投影 wire 闭集只有 `POST /internal/projections` 与 `GET /internal/projections/receipts/{deliveryId}`；要求 loopback、精确 Host 和 sender service identity。
- sender 每 60 秒单 worker tick；响应未知只进入 receipt GET 对账，明确 404 后才允许重投同一已存签名包。
- public read mode 必须显式二选一：`public-multimedia-synthetic` 或 `public-real-snapshot`。real 每次读取并校验 `active.json → committed generation → Ed25519 signature → manifest/records`；无 active 返回合法 empty，损坏返回 503，禁止 synthetic fallback。
- 公开外链保持普通 `target=_blank` 且 `rel="noopener noreferrer"`；现有 v0.2 DOM/CSS/布局不变。

## release successor

`f1plus1-runtime-release-manifest-v2` 替代旧 679786 的 38 项 Admin 结论。builder 只接受当前 HEAD 恰有一个 parent，89 项 runtime 全部由 HEAD 跟踪，worktree/index 对这些路径 clean，且每项工作树 blob 与 HEAD blob 一致；manifest 动态记录该 commit、tree、parent，并逐文件绑定 A+B 运行闭包、production `.next`、Node 24.18.0、五个生产依赖根及 M1 arm64 平台包实际字节。任何 staged、modified、deleted、renamed、intent-to-add、untracked runtime 或 merge HEAD 均 fail closed；当前尚未提交的脏工作树禁止调用 builder。

builder 不再从旧 commit 重构 `package.json`；它直接要求五个 release/projection script 的名称与命令精确存在，并要求四类依赖字段与 `package-lock.json` root 一致。target verifier 不读取 `.git`，只接受外部固定 manifest SHA-256；Git 三字段必须为小写 40 位 object ID 形状，runtime、Next、production dependencies、Node、content root 与 release root 仍按目标机实际字节完整重算，不因动态 commit 放宽。

`.next` 只排除九个 Next 构建/诊断可变文件：`cache/.previewinfo`、`cache/.rscinfo`、`cache/.tsbuildinfo`（增量构建缓存），`diagnostics/build-diagnostics.json`、`diagnostics/framework.json`、`diagnostics/route-bundle-stats.json`（构建诊断），`trace`、`trace-build`、`turbopack`（构建追踪/缓存）。其余常规文件全部按 path/mode/size/SHA-256 入清单；symlink、特殊文件、缺失、额外文件或字节漂移均拒绝。

```bash
ADMIN_TARGET_NODE_PATH="/绝对路径/.local/node-v24.18.0-darwin-arm64/bin/node" \
  npm run release:build-and-manifest

ADMIN_EXPECTED_RELEASE_MANIFEST_SHA256="<外部固定的清单SHA-256>" \
  npm run admin:verify-release-stage
```

清单固定写入 `.local/release/admin-service-release-manifest.json`（0600）。只有 fresh stage verifier 返回 `status=release-verified`，后继才可进入目标机 prepare；本任务没有生成、传输或启用目标机 release。

首个检查点提交后必须在 clean HEAD 上各执行一次且只能执行一次：`src/tests/admin-release-manifest.test.ts` 聚焦 Vitest、Node 24 typecheck、限定 release-manifest/test/runbook/`.gitignore` 的 `git diff --check`。随后才可重新 build/生成新外部 manifest SHA 并执行 target verifier；临时 clean Git fixture PASS 和既有 `d14ee6…` manifest 不能代替 post-commit clean-HEAD 收据。

## Admin prepare-only 输入

以下值不得写入 Git：

- `F1_ADMIN_CANONICAL_ORIGIN`
- `F1_ADMIN_OPERATOR_REF`
- `F1_ADMIN_TAILSCALE_APP_CAPABILITY_ID`（用户控制的小写 DNS 域名 + `/cap/f1-admin-device`）
- `F1_ADMIN_TRUSTED_IDENTITIES_JSON`
- `F1_ADMIN_PROJECTION_SIGNING_KEY_ID`
- `F1_ADMIN_PROJECTION_SIGNING_PRIVATE_KEY_PATH`
- `F1_ADMIN_PROJECTION_VERIFY_KEY_PATH`
- `F1_ADMIN_PUBLIC_READ_MODE`
- `F1_ADMIN_SYNTHETIC_ROLLBACK_RELEASE`
- `F1_ADMIN_SYNTHETIC_ROLLBACK_HASH`
- `F1_ADMIN_PROJECTION_SENDER_SERVICE_IDENTITY`
- `F1_ADMIN_PROJECTION_RECEIVER_SERVICE_IDENTITY`
- `F1_ADMIN_REVIEW_DATABASE_PATH`（必须指向已存在的唯一 `f1plus1-rss-real-private.sqlite`）
- `F1_ADMIN_REVIEW_DATABASE_DEV`（外部 preflight 收据）
- `F1_ADMIN_REVIEW_DATABASE_INO`（外部 preflight 收据）

```bash
npm run admin:prepare-macos
npm run admin:status
```

Admin deployment schema 固定为 `admin-service-deployment-v3` 并直接拒绝 v1/v2；`trustedIdentities` 首版精确一行，使用精确 ASCII login、同一 operatorRef 与三个唯一的 43 字符 `sourceRefs`，依次绑定 M5、新 iPhone 与旧 iPad；旧两项输入、重复项与 `deviceRefs` schema 直接拒绝。`Tailscale-User-Login` 与 `Tailscale-App-Capabilities` 在静态页、登录和业务路由前统一闭集解析；遗留 `x-f1-approved-device-ref` 存在即返回通用 401。manifest 显式分离 `targetReleaseAppRoot` 与 `reviewDatabasePath + dev/ino/uid/nlink`。prepare 只做 existing-only 身份门，不打开或迁移 SQLite；Admin HTTP 与独立 sender 只能从同一 manifest 打开该路径，missing 不创建，运行时只接受 user_version 1/2/3 并原位追加至 3。私钥/公钥必须为同一 Ed25519 key pair，文件为当前用户拥有、单硬链接且无 group/other 权限；Admin data root、review DB 与 public projection root 分离。生成的 plist 固定 `RunAtLoad=false`、`KeepAlive=false`。

## Public prepare-only 输入

- `F1_PUBLIC_READ_MODE=public-multimedia-synthetic|public-real-snapshot`
- `F1_PUBLIC_SIGNING_KEY_ID`
- `F1_PUBLIC_VERIFY_KEY_PATH`
- `F1_PUBLIC_PROJECTION_SENDER_SERVICE_IDENTITY`
- `F1_PUBLIC_PROJECTION_RECEIVER_SERVICE_IDENTITY`
- `F1_PUBLIC_SYNTHETIC_ROLLBACK_RELEASE`（外部固定的上一 synthetic `BUILD_ID`）
- `F1_PUBLIC_SYNTHETIC_ROLLBACK_HASH`（外部固定的上一 synthetic DB SHA-256）
- `F1_PUBLIC_SYNTHETIC_ROLLBACK_APP_ROOT`（旧 live synthetic 根；必须与 target release 不同）
- `F1_RELEASE_MANIFEST_PATH`
- `F1_RELEASE_MANIFEST_SHA256`（外部固定的唯一清单 SHA-256）

real 模式会把 public projection root、verify key path 与 signing key ID 精确注入 Next plist；synthetic 模式禁止混入这些 real read inputs。public-only deployment manifest 不含 Admin data root、session、recovery fence 或签名私钥；receiver plist同样固定 disabled、prepare-only。

public prepare 先调用同一 release verifier 重算 target release 的 source/Node/dependency/`.next` 闭包，再从独立 rollback root 只读核验旧 `BUILD_ID` 与 synthetic DB 的 hash/身份，在系统私有临时根生成 public-beta、quick-tunnel 与 receiver 三份 plist。公开日志固定在 `publicDataRoot/logs`，不会在 target release 创建 `.local`。public deployment manifest v2 记录 target、rollback、public data/projection 四根与 rollback DB 收据；三份新 plist 只指 target release。全部 manifest/key/root/rollback 校验成功后才进入原子替换；任一步失败恢复原字节。三份 plist 始终 `RunAtLoad=false`、`KeepAlive=false`，命令不调用 `launchctl`。

## 后继启用与回退锚点

本候选不能直接 load。后继 cutover 前必须同时证明：至少一代真实 active snapshot；对应 outbox 为 `succeeded`；真实 feed/detail 200；公网无 Admin/internal 路由；上一 synthetic release/hash 可验证回退。

若投影投递失败，先停 sender 并保留 Admin DB/outbox/audit。若 active generation 损坏，回到上一已验证 active pointer；若 real reader 候选整体失败，把 public read-mode/release 指针切回 manifest 中的精确 synthetic release/hash。回退不删除或改写私有审核、publication、projection 或 outbox 事实。
