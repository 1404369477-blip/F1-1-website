# TASK-20260813-74F915｜Tailscale 三设备 HuJSON 最小合并工具

## 结论

`status=final`，`decision=candidate-ready-approved-shape`。受限的文件化合并/验证工具已生成，并对用户复制的真实 pre-policy 生成了三设备最小 candidate。工具仅在根 `grants` 数组末尾插入三条 canonical Grant，pre-policy 的其他原字节及非 grants 语义保持不变，rollback 与pre-policy原字节完全一致。统筹已采用快速零破坏决策：保留现有全开规则，只新增三条 app-cap Grant。全程0 clipboard read、0 Tailscale API/CLI写、0 management/Serve/Funnel/device/service/DB操作。

## 受限收据

- 任务目录：`scratch/TASK-20260813-74F915`，mode0700、uid501、Git ignored。
- 工具 SHA-256：`39d32f2a8c37fd48fb8dae2f297128be6006c2113693d1d05a61cbf492775e3e`；受限目录内工具/输入/输出均 owner-only。
- 冻结的 C1FBDB package SHA-256：`51546a89c9a702247ba48a42185556ef7345442cea4875271804fa5bea0bea3f`。
- 真实 pre-policy SHA-256：`f732d21e94ee9c09ca3c8a90d627ff26c0bf888de14e1e0364054777716e21cf`，size2255。
- 真实 candidate SHA-256：`e457ee1e50de0fa36df242db77735bf351b9928a24777c59e7cfc5b4a9f7d0bf`，size3331、mode0600、nlink1。
- rollback SHA-256：`f732d21e94ee9c09ca3c8a90d627ff26c0bf888de14e1e0364054777716e21cf`，与pre-policy完全相同。
- 真实合并收据：新增Grant `3`，目标capability Grant精确 `3`，selector/sourceRef均三项唯一，`nonGrantPolicySemanticDrift=false`，`prePolicyByteRestorable=true`。

原始 login、selector、sourceRef、policy 字节未进入本报告或 Git。

## synthetic 最小验证

- 首次合并：只增加3条Grant，其他语义零漂移。
- 幂等再运行：`already-applied-idempotent`，新增0条，candidate SHA不变。
- rollback：与synthetic pre-policy SHA相同。
- clipboard/external write：均为0。

## 已证实的宽放风险

真实 pre-policy 已含一条等价宽放规则，脱敏结构计数为：

- source wildcard：`1`
- destination wildcard：`1`
- all ports：`1`
- any broad rule：`1`
- 可能覆盖本次 M1 tcp:443：`1`

这条规则会使三条精确 Grant 无法单独构成最小访问边界。工具明确 `automaticBroadRuleRemoval=false`，没有删除或改写它。候选策略现已停在本地 restricted artifact，未提交到 Tailscale。

## 已采用决策与剩余边界

统筹已明确采用“保留现有全开规则，三条 app-cap Grant 按candidate新增”的零破坏决策。因此candidate符合当前已决策形状，但全开网络规则仍在；三条 app-cap Grant 只收窄后端可接受的 capability/sourceRef 映射，不能宣称整个 tailnet 的网络访问已是最小授权。本任务仅交付本地candidate，仍未提交policy或启用Serve。

## mistake-check

- 工具没有读取剪贴板；真实输入由统筹部已有受限文件导入。
- 一次真实执行前首先因输入在相邻受限目录而被工具的task-root门拒绝，无输出/外部写；随后以0600原字节副本进入任务目录完成合并。
- 没有把HuJSON注释/顺序全量重写为JSON；插入以外的pre-policy字节可完整恢复。
- 宽放规则只做结构计数，未在普通报告重复真实policy。
