# TASK-20260812-3540A4｜Tailscale 真实 login 与双端 selector 只读冻结

## 结论

`status=final`，`decision=pass-with-management-plane-unknowns`。M5 本机与固定 M1 的全新 `tailscale status --json` 双视图静态身份集合逐字一致；唯一 M5 self 与唯一 iOS peer 已分别冻结为 M5/iPhone DNS selector 候选，并与 8EB56C 的 `m5`/`iphone` sourceRef role 建立 owner-only 映射。真实 ASCII login 双视图一致。

本任务对 tailnet、device、policy、Serve、Funnel、服务、数据库和 deployment 均为零写。

## 受限证据

所有原始 login、DNS selector、节点 ID/key/IP 与设备身份只存在 `scratch/TASK-20260812-3540A4/` 的 owner-only、git-ignored、mode `0600` 文件；普通报告只记录 hash。

| 证据 | SHA-256 |
|---|---|
| M5 fresh status | `f2b4a6d127b469973d57c17fa55cd6653739fa974f475a0624d96bb82157861e` |
| M1 fresh status | `8a32b8b0df300ad2019acbd2b17b77e98e029c1feca169b0ee107cb1e6dcda3a` |
| owner-only 冻结配置 | `33f00a6b0e94543b727c51107fc83b775795e7547579f45d9402fbd125806ab6` |

冻结配置固定 capability ID `1404369477-blip.github.io/cap/f1-admin-device`，但报告不重复原始 login 或 selector。

## 机械核收

- 节点集合：M5/M1 两端均精确 `3` 个；node ID 集合与每节点的 public key、HostName、DNSName、IP 集合、OS、UserID、tag、sharee 静态字节一致。
- login SHA-256：`e1c49663f0b6db0db259d7c89805099f24ec4d52e4fd70cdc3d6db7337235447`；M5/M1 user map 逐字一致、可满足 Admin visible-ASCII login 输入。
- M5 selector SHA-256：`f0b5b950c4c4f46c61834fbe75349f5ff254190a19d73fd6e3e9f64c58da8834`。
- iPhone selector SHA-256：`48ee30cac1e4e05f9dd250362d9ccb034ac758fa8b10934c59fffce45f17b085`。
- selector 精确两个且互不相同；M5 selector 映射 PrepareInputs `sourceRefs.m5`，iPhone selector 映射 `sourceRefs.iphone`。
- owner：两个候选的 UserID 相同，双视图一致；tagged node=`0`，`ShareeNode=true`=`0`。这些是本地 peer-map 线索，未扩大为管理面权威结论。
- `CertDomains`：两个视图均为空，count=`0`，集合 hash `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`。因此 canonical HTTPS origin 仍不能固定。
- Serve/Funnel：M5、M1 四次只读 `status --json` 均 exit `0` 且为空对象；四个 JSON SHA-256 均为 `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356`。当前无 Serve/Funnel 配置。

## 管理面 Unknown

- device approval：本地 CLI peer map 无权威字段，保持 `Unknown`。
- Grants/policy 可见性：本地 CLI 没有当前管理面政策全文或 canonical hash，保持 `Unknown`。
- selector 语法：已冻结两个唯一真实 DNSName 字节作为候选；是否直接使用 DNSName、`device:`、`user:` 或 tag selector，仍需用户在 Tailscale 管理台按当前 Grants 语法确认。
- iOS peer 的现实设备归属：技术上为双视图唯一 iOS peer且同一 UserID；本任务没有替用户做现实设备确认。

这些 Unknown 不阻断 login/selector 候选冻结，不构成 device approval 或 Grant 放行。

## 最小后继输入

后继管理面步骤只需要用户确认两个事实：

1. 双视图唯一 iOS peer 确实是拟授权的 iPhone。
2. Tailscale 管理台中使用何种精确 source selector 语法将 M5/iPhone 候选分别映射至受限冻结配置中的两个 sourceRef；同时核对 device approval 与没有额外宽 Grant。

另需先启用 M1 HTTPS/Serve 所需的 tailnet DNS/证书能力并只读回收 `CertDomain`，才能固定 canonical origin。本任务没有执行这些写操作。

## mistake-check

- 没有把同一 UserID、`ShareeNode=false` 或 tag 空集合误写成管理面 ownership/approval 权威证据。
- 没有把 DNSName 候选直接宣称为已生效 Grants selector。
- 没有把空 `CertDomains` 猜成域名。
- 没有把 Serve/Funnel 空状态解释成已配置。
- 原始身份未进入任务 JSON、普通报告或 Git；报告只保留 SHA-256、数量和状态。
