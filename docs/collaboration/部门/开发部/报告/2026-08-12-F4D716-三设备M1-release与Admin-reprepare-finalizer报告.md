# TASK-20260812-F4D716｜三设备 M1 release 与 Admin reprepare finalizer

## 结论

`status=final`，`decision=pass`。复用 2C5185 的唯一 build/manifest，未重跑 build 或 builder；闭包外 M1-target harness 本地验签通过，最小 delta 在固定 M1 上形成并原子固化新 release，M1 target verifier通过；PrepareInputs加入独立 iPad sourceRef，Admin deployment-v3以三项唯一ref重新prepare且保持disabled。

## Release

- Git commit `b5d3d7c315d44865eef2af8236b06ceccde4e9b6`，tree `9f190eb0f420e430a62ccdd233cbb328ea4d2264`。
- manifest SHA `6e67778938af40360f5cf2200bbd14766cbe61e50051448cd99f9c1133eb2ed4`。
- content root `54923d5f949de6d4514ec998f27c2b28aea942dd98de70bae332077da56ee0f2`。
- release root `74580c8a31299b30babdd0bb98e74e967d904a40e2d6f35008a236a71ccb5308`。
- runtime89；Next322/13,399,239 bytes/root40746f5f；packages44；Node SHA ee6fb0e0。
- 本地闭包外 harness check一次、实际验签一次PASS。
- delta：3 changed / 0 deleted，archive 1,900,032 bytes，SHA `7664c2ca02f743ba571d40782d0b2961457007643b196651c13c02b468114d96`。
- M1 final：`[M1-HOME]/F1-1-website/releases/74580c8a31299b30babdd0bb98e74e967d904a40e2d6f35008a236a71ccb5308/app`；stage verifier一次PASS后原子rename。

## 三设备 Admin reprepare

- PrepareInputs SHA `866599f3aa9365931a90990f215740b0a31fe6d46bb2969dcb1efabec7d7c8b3`；schema v2，sourceRefs roles精确 `m5/iphone/ipad` 且三个原值互异。原值未进入报告/Git。
- 新 Admin manifest SHA `9933b90e296ee228b88a13d6c93b5d258afb2d0cb854ad1fb20169acc789a22c`，target为新74580c release，trusted identity一行/三ref、serviceState disabled。
- 旧两设备 Admin root保留为 `[M1-HOME]/Library/Application Support/F1Plus1/Admin-two-device-1F1B7B`，没有覆盖或删除。
- 新 Admin plist `RunAtLoad=false`、`KeepAlive=false`。
- review DB dev/ino不变；没有打开/迁移/写DB。
- 3101/3102均absent；没有load/bootstrap、Serve/Grant/Funnel、Public cutover。
- Public manifest保持既有disabled候选；本任务未将public live切到新release。

## mistake-check / 未验证

- 中间 reprepare scratch 脚本两次机械字段错误均在新 Admin prepare 之前fail closed；第一次已将旧Admin root原子挪到保留路径并更新PrepareInputs，随后没有服务或DB动作。最终脚本只读旧manifest canonical origin并成功新prepare。
- 三个sourceRef及login/selector/key原值不在报告或Git。
- 新release与新Admin manifest仍未load；没有把prepare当成上线。
- Tailscale device approval/Grant、Serve、Admin loopback运行、Passkey、sender/receiver和public cutover仍未验证。
