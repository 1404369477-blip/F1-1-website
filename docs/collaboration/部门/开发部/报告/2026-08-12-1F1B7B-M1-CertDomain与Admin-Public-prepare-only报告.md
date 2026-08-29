# TASK-20260812-1F1B7B｜M1 CertDomain 与 Admin/Public prepare-only

## 结论

`status=final`，`decision=pass`。固定 M1 的 `CertDomains` 已由空变为精确一个；由此构造的 `https://<CertDomain>/` canonical origin 通过 deployment-v3 严格校验。针对已验签 d186 release，Admin deployment-v3 与 Public deployment-v2 均已 prepare-only，全部服务保持 `disabled`，没有执行 load、Serve、Funnel、Grant、bootstrap、DB 迁移或 public cutover。

## 冻结收据

- d186 target：`[M1-HOME]/F1-1-website/releases/d186e4285198e78185aaa23a0c218313c78f2adf0aa5f377fbf380dc01307de1/app`。
- release manifest SHA-256：`6f4642999797aea6d220cc01ec4d9500416a37a5db7de8eaafc573991bff770d`。
- CertDomain SHA-256：`b3fe6ddefa9f7adfdaa06e2c5e6d99e4249f401195acb5a88de474dbc7eacd01`；count=`1`。
- canonical origin SHA-256：`330fc5ba65f39a015ffb014b33b892eebe121f505b28792b883cef46920039fe`。原值不写普通报告。
- Admin manifest：`[M1-HOME]/Library/Application Support/F1Plus1/Admin/deployment.json`，SHA-256 `f4d581400b6ac3ae039c4e1d1d9db26061f66ae0014ff1439762ddd6b12423e8`。
- Public manifest：`[M1-HOME]/Library/Application Support/F1Plus1/Public/projection-deployment.json`，SHA-256 `3a4824e27aaa0658fe64b4b9f55a6bc437e0a969fa3a7d631e5c8729f4ddff3d`。
- Admin `--status`：PASS；收据 SHA-256 `c6fd33ab3b1589e73fc7bad0f0ed8d9802ddd58e2e664215a83f8c444216278c`。
- read mode：两份 manifest 均为 `public-real-snapshot`。
- signing key ID、sender/receiver service identity、synthetic rollback release/hash：Admin、Public、PrepareInputs 三方逐字一致；普通报告不暴露原值。
- review DB：path/dev/ino 与 PrepareInputs 一致；prepare 未打开、迁移或写数据库。
- Ed25519：Admin 私钥与 Public 侧隔离 verify key 配对 PASS。

## 根与 plist

- Admin/Public/projection/verify/logs 目录均 uid501、mode `0700`、真实目录。
- Admin deployment/plist/session/recovery/bootstrap state、Public deployment/plist/log、隔离 verify key 均 uid501、mode `0600`、nlink1。
- disabled plist 精确 `4` 份：Admin 私有 plist、Public receiver 私有 plist、LaunchAgents public-beta 与 quick-tunnel。全部 `RunAtLoad=false`、`KeepAlive=false`。
- Public receiver plist 保存在 Public 私有根，未复制到 LaunchAgents；这符合 prepare-only 未启用边界。
- 为满足 rollback `BUILD_ID` owner-only 读取门，创建独立只读 rollback anchor；live app 字节未改。早期两个错误位置的隔离 rollback 根未被 deployment 引用，后继清理任务可在身份门后删除。

## 执行与零启用边界

- Admin 正式 prepare 成功 `1` 次。
- Public 正式 prepare 成功 `1` 次；其前的调用均在生产安全门处 fail closed、Public manifest 未落盘。
- 最终只读核验 `1` 次 PASS。
- 3101/3102 listener：均 absent。
- 没有调用 `launchctl` load/bootstrap、`tailscale serve` 写、Funnel、Grant、device approve、DB CLI 或 cutover。
- Public prepare 按合同替换了 public-beta/quick-tunnel plist 为指向 d186 的 disabled 候选；既有运行进程没有被 reload 或停止。quick-tunnel 旧 plist 首先仅将 mode `0644` 归一为 `0600` 且 SHA 不变，才能通过正式 backup 门。

## 下一步唯一用户授权项

下一阶段会改变对外/运行态，需用户明确授权一次受控启用：

1. 在 Tailscale 管理面确认唯一 iOS peer 就是拟授权 iPhone，并批准 M5/iPhone 两个精确 selector 到 capability `1404369477-blip.github.io/cap/f1-admin-device` 的最小 Grants 映射；排除额外宽 Grant。
2. 授权先加载内部 receiver/Admin/sender 的 disabled plist，再配置 Tailscale Serve 到 Admin loopback；随后做 M5+iPhone header/passkey 验收。
3. Public real cutover 仍应等待至少一个验签 active snapshot 与 outbox succeeded，不应和 Admin 首次 load 合并猜测执行。

## mistake-check / 未验证

- login、sourceRefs、selector、私钥和 key ID 原值没有进入普通报告或 Git。
- prepare 成功不等于 service 已启动；3101/3102 当前无 listener。
- CertDomain 可用于 canonical origin，不代表 Serve 已配置；本任务没有执行 Serve。
- 本地 peer-map selector 候选仍缺管理面 approval/Grant 权威收据。
- 未验证 Admin HTTP、Passkey、sender/receiver delivery、active snapshot、真实公开 feed/detail 或公网隔离；这些属于后继 load/cutover。
