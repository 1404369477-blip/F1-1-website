# TASK-20260812-8EB56C｜M1 Admin 域名无关 prepare 前置输入

## 结论

`status=final`，`decision=pass`。固定 M1 已生成并只读复核 Admin 域名无关 prepare 输入；未创建 deployment manifest 或 plist，未运行 prepare，未调用 `launchctl`，未打开/迁移/写 review DB，未改 live/public/RSS 服务。

## 冻结产物

- 输入根：`[M1-HOME]/Library/Application Support/F1Plus1/PrepareInputs`，uid `501`，mode `0700`。
- 私钥：`private/projection-signing-private.pem`，uid `501`，mode `0600`，nlink `1`，size `119`。报告与 stdout 未记录私钥字节或私钥哈希。
- 验签公钥：`public/projection-verify.pem`，uid `501`，mode `0600`，nlink `1`，SHA-256 `8a4e42c355e0d7b8cd9b1a537d8e4830554c4a53286851c29ff7ab3244bf99b2`。
- 安全配置：`admin-prepare-inputs.json`，uid `501`，mode `0600`，nlink `1`，SHA-256 `234b7c53320e17973738ca652849ea193199e24afbfdd973aec79e74962d99ee`。
- 后继 prepare runner：`run-admin-prepare.mjs`，uid `501`，mode `0600`，nlink `1`，SHA-256 `f1f1a95cc53afed0cec0e6f4c5fb2faac4574e748f7c8b9260c93be760c07602`。本任务未执行 runner。
- 任务专属闭包外生成/核验脚本：M1 SHA-256 `3c92405070405ad859b1936a8e6de0217f83074dba4ea06023af953494ccb9aa`；固定 Node 24 `--check` 通过。

## 身份与配对收据

- Ed25519 公私钥类型与派生公钥逐字配对：PASS；公钥 DER fingerprint SHA-256 `8e52ac4c47082ce0020edd1425bab1c60c440a7aa542c7954925d1cfbba2fb46`。
- operatorRef SHA-256：`0093396451da9c3356c4a13fdaa450c6f82cbc85b3251757a44a1b5c453349d1`。
- M5 sourceRef SHA-256：`68b4a680ee5b8c80e40322e5afb6b9eb599890985a7e5b5ba596011102adec25`。
- iPhone sourceRef SHA-256：`f73c6bcda2ce5f7406b307ce4178c67faafb1f2a4b2b58314c6d4dfe1cff62d5`。
- sourceRefs：精确 `2` 个、各 `43` 字符、互不相同：PASS。
- sender identity SHA-256：`9ab0fcfc41af7876086b781717632bc465d3510310a3fd4e707dca803edc7091`。
- receiver identity SHA-256：`71883c67b4faf50e2582ed9e972fd6883145a871fcaba79af3686cb33078142e`；与 sender 不同。
- review DB 仅 `lstat` 身份复核，path/dev/ino/uid/nlink 与配置匹配；未打开数据库。
- synthetic rollback BUILD_ID 与 DB SHA 锚点只读复核匹配；read mode 已固定 `public-real-snapshot`。

## 零漂移与执行次数

- 生成前后 protected-state receipt SHA-256 均为 `8ba224c726642d50fd52b26116f88104e3b6ec8eccc604af42d598634f6fb821`。
- receipt 覆盖 live app 身份、synthetic rollback BUILD_ID/DB、review DB 身份、既有 F1+1 LaunchAgent plist 字节、public/RSS job 状态、3000/3101/3102 listener、Admin deployment/plist 缺失状态。
- 结果：`protectedStateDrift=false`、`deploymentManifestOrPlistChanged=false`、`externalCalls=0`。
- 生成成功 `1` 次；生成后只读核验 `1` 次。未运行项目 Vitest/typecheck/diff/build，因为未修改 runtime 或仓库候选代码。
- 两次生成前失败：第一次在 Node 文件 mode 前置谓词处停止；第二次在 PEM 导出值清零类型处停止。两次均发生于正式 `PrepareInputs` 原子 rename 前，未生成密钥材料或秘密输出；只保留任务允许的空 `Admin`、`Public/projection` 私有根。随后同一闭包外脚本最小修正并成功生成一次。

## 尚需用户/管理面提供

1. `F1_ADMIN_CANONICAL_ORIGIN`：最终 HTTPS Admin origin，必须仅含根路径。
2. `F1_ADMIN_TAILSCALE_APP_CAPABILITY_ID`：用户控制的小写 DNS 域名加 `/cap/f1-admin-device`。
3. `F1_ADMIN_LOGIN`：M5 与 iPhone 实际请求头 `Tailscale-User-Login` 的精确 ASCII login。
4. Tailscale Grants 中 M5 与 iPhone 的精确 source selectors，并将两者分别映射到已生成的 M5/iPhone sourceRef。映射完成后由操作者显式设置 `F1_ADMIN_SOURCE_SELECTORS_READY=confirmed`。

上述四项未确定前，runner fail closed；本任务未替用户或产品作定案。

## 后继唯一命令模板

在固定 M1 上、完成 Tailscale capability 与两个 source selector 映射并确认真实 login/origin 后，后继任务可执行：

```bash
F1_ADMIN_CANONICAL_ORIGIN='https://<admin-origin>/' \
F1_ADMIN_TAILSCALE_APP_CAPABILITY_ID='<owned-domain>/cap/f1-admin-device' \
F1_ADMIN_LOGIN='<exact-tailscale-user-login>' \
F1_ADMIN_SOURCE_SELECTORS_READY=confirmed \
[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node \
  '[M1-HOME]/Library/Application Support/F1Plus1/PrepareInputs/run-admin-prepare.mjs'
```

该命令会进入真正 prepare，并写 deployment/plist；必须作为新的已授权任务执行。本任务没有运行它。

## 未验证边界与 mistake-check

- 未验证：Tailscale 登录身份、capability policy、M5/iPhone selector 实际匹配、最终域名与 HTTPS origin；这些都依赖用户/管理面输入。
- 未验证：真正 Admin prepare、plist 字节、3101/3102 服务启动、真实投影闭环与 cutover；均超出本任务。
- mistake-check：秘密值只存在 M1 mode `0600` 文件；stdout、报告与 Git 仅包含路径、权限、大小、哈希和布尔配对收据。闭包外脚本本地位于 ignored `scratch/`，没有复制秘密回本机。
