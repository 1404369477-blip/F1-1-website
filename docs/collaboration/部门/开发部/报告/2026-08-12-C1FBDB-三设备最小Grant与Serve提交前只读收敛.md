# TASK-20260812-C1FBDB｜三设备最小 Grant 与 Serve 提交前收敛

## 结论

`status=final`，`decision=waiting-one-management-read`。M1 fresh peer map与三设备受限freeze精确匹配，M5、新iPhone、旧iPad三个selector互异；最终restricted一次提交包已生成，包含三条独立最小Grant、三个互异原始sourceRef的一对一绑定、M1 Serve argv、前后验证和精确回退顺序。全程0 tailnet/Serve/Funnel/service/DB写。

## 收据

- restricted final package SHA-256：`51546a89c9a702247ba48a42185556ef7345442cea4875271804fa5bea0bea3f`，mode0600、uid501、nlink1、Git ignored。
- selector hashes：M5 `f0b5b950…`、新iPhone `b8d6cf5c…`、旧iPad `48ee30ca…`；count3/unique。
- sourceRef hashes：M5 `68b4a680…`、新iPhone `f73c6bcd…`、旧iPad `bd2051fb…`；count3/unique，三个原值仅在restricted final package中。
- CertDomain/Serve target hash：`b3fe6ddefa9f7adfdaa06e2c5e6d99e4249f401195acb5a88de474dbc7eacd01`。
- Serve argv hash：`798df9783eea8bf1e2631aa461074749c9a9e91168f42d0288302705070d5b1c`。
- 当前 M1 Serve `{}`、Funnel `{}`；两者均未配置。

提交包固定：capability `1404369477-blip.github.io/cap/f1-admin-device`；三条Grant各只含一台精确selector、M1 `tcp:443`与该设备唯一sourceRef；Serve仅 HTTPS 443 → `http://127.0.0.1:3101`，带 `--accept-app-caps`；Funnel不启用。回退的第一步为 `tailscale serve reset`，第二步必须用提交前管理台导出的完整原policy字节恢复，最后核对canonical hash回到pre-hash。

## 唯一阻断

本地 Tailscale CLI没有读取当前管理面 ACL/Grants policy全文或canonical hash的入口。因此目前无法证明：

- 是否已有更宽的src→M1:443规则；
- capability namespace是否已有冲突定义；
- 三条最小映射合并后是否覆盖/重复现有Grant；
- 三设备device approval状态。
- 受限包中的真实DNSName候选在当前policy editor中应使用的精确selector语法。

唯一下一动作：在已登录的Chrome Tailscale管理台做一次只读，导出当前 policy/Grants完整文本与device approval状态，保存到0600 restricted artifact并计算pre-hash。未取得该输入前不得提交补丁或运行Serve。

## 一次事务顺序（取得pre-hash后）

1. 确认receiver/Admin loopback已健康；3101/3102未健康则停止。
2. 对管理台导出文本做canonical pre-hash，拒绝宽规则/冲突；把restricted package中的三设备条目最小合并并单次提交。
3. 回读policy canonical post-hash，证明仅预期diff；逐设备验证各自capability sourceRef，未列设备无capability。
4. 在M1执行restricted package内Serve argv一次；验证仅HTTPS443→127.0.0.1:3101、`accept-app-caps`精确capability、Funnel仍空。
5. 任一步失败：先`tailscale serve reset`，再以pre导出原字节恢复policy；复核post hash回到pre hash。

## mistake-check

- 原始selector/sourceRef/login/node key只在restricted artifact，普通报告只留hash。
- 没有把peer map当成device approval或policy权威。
- 没有执行policy/Serve/Funnel/device/service/DB写。
