# TASK-20260813-3446F3｜Tailscale 三设备 Grant IP 选择器纠正

## 结论

`status=final`，`decision=pass-candidate-only`。针对管理台返回的 `invalid address` 错误，已从冻结原 pre-policy 重新生成candidate，没有在错误candidate上叠补。三个 `src` 与 M1 `dst` 均使用已冻结节点对应的唯一 Tailscale IPv4；本次新增 Grant 中 MagicDNS选择器0个、hosts alias 0个。三个 app-cap sourceRef与C1FBDB冻结包逐字一致，原策略其他语义不变，已决定保留的宽放规则继续保留。全程0 clipboard、0 management/Serve/Funnel写。

## 身份与IP绑定收据

- 冻结三设备身份 SHA：`93df4440a5852b5429f3a8a90f877fafe877bb281f24433365d6ffe5eb1d5be5`。
- M5旧双视图收据 SHA：`f2b4a6d127b469973d57c17fa55cd6653739fa974f475a0624d96bb82157861e`。
- 包含新iPhone的M1先前视图 SHA：`d6af99a8d31215897ffc30df7ba808ad0e8112de13a702a650db9b3d26278fc0`。
- M1 fresh视图 SHA：`96851dd09e7ee4b8ef229a279a1c9f8ca343ce517a3f93c9e5e60990199b5c34`。
- M5/iPad/M1：M5视图与M1 fresh视图的node ID + Tailscale IP映射相同。
- 新iPhone：含新iPhone的M1先前视图与M1 fresh视图的node ID + Tailscale IP映射相同；当前fresh视图显示该节点离线，但固定IP未漂移。
- 三个source IPv4互异，且均与M1 target IPv4不同。

真实IP、DNS名、node ID、sourceRef原值未进入报告或Git。

## restricted artifacts

- candidate：`[M5-HOME]/Documents/F1+1/scratch/TASK-20260813-3446F3/three-device-ip-candidate.hujson`
- candidate SHA-256：`732845fd2ef810f1eddc8321927543e64aa0f86284ab6268118339988f6ac541`，size3271、mode0600、uid501、nlink1。
- rollback：`[M5-HOME]/Documents/F1+1/scratch/TASK-20260813-3446F3/rollback-pre-policy.hujson`
- rollback/pre-policy SHA-256：`f732d21e94ee9c09ca3c8a90d627ff26c0bf888de14e1e0364054777716e21cf`。
- structured receipt：`[M5-HOME]/Documents/F1+1/scratch/TASK-20260813-3446F3/ip-selector-receipt.json`
- 冻结 app-cap package SHA-256：`51546a89c9a702247ba48a42185556ef7345442cea4875271804fa5bea0bea3f`。

## 合并不变量

- 新增Grant精确3条，三条均为单source IPv4、单M1 destination IPv4、`tcp:443`、单一 app capability + 该设备唯一sourceRef。
- `sourceRefsUnchanged=true`、`sourceRefsUnique=true`。
- `nonGrantPolicySemanticDrift=false`。
- `broadWildcardRulesRetained=1`，符合已采用的零破坏决策。
- `magicDnsSelectorsInAddedGrants=0`、`hostsAliasesAdded=0`。
- `clipboardReads=0`、`externalWrites=0`。

## mistake-check / 未验证

- 一次尚未完成的本地生成尝试使用了不包含新iPhone的旧M5视图做全部节点交叉，在输出前以 `NODE_MISSING:iphone` fail closed；没有candidate/外部写。最终工具明确用包含新iPhone的M1先前视图与M1 fresh视图交叉新iPhone，M5/iPad/M1仍用M5+fresh M1交叉。
- candidate仅是本地HuJSON工件，尚未在Tailscale policy editor中重新编译/保存，因此管理面语法PASS、post-policy hash和真实Grant生效仍未验证。
- 宽放规则继续存在；三条app-cap映射收窄后端可接受身份，不等于整个tailnet网络边界最小化。
