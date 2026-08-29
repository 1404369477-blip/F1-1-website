# TASK-20260812-9B0DB6｜新 iPhone 身份冻结与 sourceRef restricted 改绑

## 结论

`status=final`，`decision=pass`。固定 M1 fresh 视图已由旧 3 节点增至 4 节点，新增节点精确一个且为 iOS、在线、与旧 iPad 的 node ID/key/DNS 均不同；旧 iPad 仍以原 identity 独立保留。M5 本机 CLI 此时无法启动，fresh M5 原始视图不可得；已使用 M1 同一 fresh JSON 作为两次只读机械解析输入，没有伪造第二设备视图，并把“双物理视图”列为未验证。

owner-only restricted v2 配置已把既有 `iphone` role/sourceRef 只改绑到新 iPhone selector；M5 selector/sourceRef 零漂移。旧 iPad selector保留为独立 `retainedDevices.ipad`，Admin Grant 状态为 `undecided`，未与新 iPhone 共用 sourceRef。

## 受限收据

- restricted v2 SHA-256：`5bc169f6de3bc878e0e563d2cf53f58a4c20a03bd5ee8197c7d061e900e57d87`，mode0600、uid501、nlink1、Git ignored。
- 新 iPhone selector SHA-256：`b8d6cf5c6fc03f2e7789767e10ff75247e03e813f9fdae683721fcf25da81e04`。
- 旧 iPad selector SHA-256：`48ee30cac1e4e05f9dd250362d9ccb034ac758fa8b10934c59fffce45f17b085`。
- M5 selector SHA-256：`f0b5b950c4c4f46c61834fbe75349f5ff254190a19d73fd6e3e9f64c58da8834`。
- 节点数 `4`；新增 iOS `1`；旧 iPad retained=`true`；identity unchanged=`true`；新 iPhone online=`true`；tailnet writes=`0`。
- device approval 仍无法从 CLI peer map 权威证明，保持 `Unknown`。

## 三设备 successor 范围

当前 production schema 明确只允许两个 sourceRef：

- `AdminTrustedIdentityDeploymentSchema.sourceRefs` 固定 `.length(2)`；
- `admin-install-macos.ts` 固定一条 trusted identity；
- `server.ts` 启动门固定 `sourceRefs.length === 2` 且唯一。

因此，用户已授权的 M5 + 新 iPhone + 旧 iPad 三设备不能由当前 deployment-v3 表达。最小 successor 必须：

1. 把 deployment trusted identity sourceRefs 从精确 2 改为精确 3，并维持全部唯一、同一 operator/login。
2. 把 Admin server 启动门从精确 2 改为精确 3；路由的 `includes(sourceRef)` 行为无需另增实体。
3. 更新 `admin-install-macos.ts` 的输入验证、对应聚焦测试、release runtime identity/manifest（这些运行文件改变后需要新 release）。
4. 在 PrepareInputs 安全生成第三个独立 `ipad` sourceRef；不得复用新 iPhone 或 M5 sourceRef。
5. 生成新 deployment-v3 manifest并重新 prepare Admin；Public manifest中的 sender/receiver/key/read-mode不因第三设备变化，可保持，但新 release与 Admin target root必须一致时仍需按 release/cutover合同处理。

当前 M1 prepared Admin manifest仍是两 sourceRef；本任务没有修改 production schema、PrepareInputs、prepared manifests或服务状态。

## mistake-check

- 旧 iPad没有删除、退出、重命名、覆盖 identity或复用sourceRef。
- 没有把单一 M1 fresh JSON虚构成M5/M1两物理视图；报告明确 fresh M5 unavailable。
- restricted映射只保存原始身份于0600 ignored文件；普通报告只含hash。
- 没有写tailnet/device/policy/Serve/Funnel，没有load服务或打开DB。
