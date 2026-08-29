---
type: audit_report
department: 安全部
target: "TASK-20260812-C0BACB / M1 prepare input gate"
status: final
date: 2026-08-12
related_task: TASK-20260812-C0BACB
decision: pass
severity_count: { P0: 0, P1: 0, P2: 3 }
review_mode: remote_read_only_input_inventory
tags: [M1, prepare-only, release-verifier, review-db, rollback, tailscale, key-material]
summary: "PASS；P0=0/P1=0/P2=3。8e70 final target verifier本轮只读PASS；唯一review DB、旧synthetic rollback、三live plist、listener与当前Tailscale基础状态均已核实。Admin/Public roots、keypair及deployment均不存在；CertDomains=0、Serve/Funnel为空、目标app-cap=0，device approval/Grants/policy hash无法从本机CLI证明。当前不能prepare。最小下一动作是用户先提供capability域名并授权管理面只读核验真实login、M5/iPhone selectors、device approval、Grants与policy hash；随后另行受控任务生成owner-only keypair/sourceRefs/opaque refs并再做零写preflight。"
---

# M1 新 release prepare 输入与可执行缺口只读核对报告

## 1. 裁定

**PASS（完成输入盘点）；P0=0，P1=0，P2=3。当前 prepare：BLOCKED。**

本轮已证明新 release 与既有数据/回退基线适合作为后继输入来源，未发现已有不安全 key 或路径。prepare 必需的私有身份、密钥与 tailnet 管理面值仍不完整，因此本报告不放行执行 Admin/Public prepare。

本轮只通过既有 SSH alias 执行只读身份、SHA、只读 target verifier、SQLite read-only、plist、listener 和 Tailscale 状态查询。未生成 key/sourceRef，未创建 data root、manifest 或 plist，未修改 tailnet、launchd、服务或数据库，未访问页面。

## 2. 已核实的目标机基线

### Release 与 Node

- final app root：`[M1-HOME]/F1-1-website/releases/8e70b2b745e3013d4667b7eb646c91f5286e8906b9254deaef5fffb6666ff30a/app`；UID501、mode0755、真实目录。
- manifest：UID501、mode0600、regular、nlink1、SHA `d14ee6025d55edb238bc8c8ac9e7b189442161ddd543531fa075db6b1b6f811a`。
- Node：`[M1-HOME]/.local/node-v24.18.0-darwin-arm64/bin/node`；UID501、regular、nlink1、mode0755、SHA `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`。
- 本轮 target verifier：`release-verified`；content root `35021046566c90f9580b3ffe84d0ff64ceb0b38dc8584579e63dbeddcbe35fb8`；release root `8e70b2b745e3013d4667b7eb646c91f5286e8906b9254deaef5fffb6666ff30a`；Next 322 / 13,399,239 bytes；packages 44；externalCalls=0。

### 唯一 review DB

- 固定路径存在且 realpath exact；UID501、mode0600、regular、nlink1。
- `dev=16777233`、`ino=24570709`、size `102400`。
- read-only SQLite：`user_version=1`、`integrity_check=ok`、`database_list=main,temp`。
- 该值可直接形成 `F1_ADMIN_REVIEW_DATABASE_PATH/DEV/INO` 的只读 preflight 收据；prepare仍不得在本任务执行。

### Synthetic rollback

- rollback app root为旧 live app，真实且与8e70 target不同。
- `.next/BUILD_ID`存在、长度21；只在受限执行中读取，报告仅记录 SHA `a2afeaff06edb2e668444bee169b29db53268692c63dad51ec422aa36ec8f20d`，不复制原值。
- synthetic DB：UID501、mode0600、regular、nlink1、`dev=16777233`、`ino=24546198`、size737280；SHA `949c78d505e4c032d2495174deaf62d24f9d99b76284ad7ba6fb29a5ac83bb50`。

### Live rollback anchors 与 listeners

| 对象 | SHA / mode | 当前状态 |
|---|---|---|
| public-beta plist | `59151b3e…bf91` / 0600 | loaded/running，PID52089 |
| quick-tunnel plist | `0c039749…acc` / 0644 | loaded/running，PID53446 |
| receipt-refresh plist | `e9938d6b…c367` / 0600 | loaded/not-running |
| 3101 | listener 0 | Admin未加载 |
| 3102 | listener 0 | receiver未加载 |

quick-tunnel 0644的限定安全裁定沿用 `TASK-20260812-D53D87`；新工件仍必须0600。

## 3. Prepare 输入矩阵

### 3.1 Admin 输入

| 输入 | 状态 | 权威来源 | 可自动生成 | 当前动作 |
|---|---|---|---|---|
| target release root | Known | 已验签8e70 final | 否 | 固定使用上述路径 |
| review DB path/dev/ino | Known | 本轮M1只读identity | 否 | 使用本轮收据；执行前再读一次 |
| `F1_ADMIN_PUBLIC_READ_MODE` | Decision required | 产品/部署顺序 | 否 | prepare阶段建议固定 `public-real-snapshot`，须统筹确认与public一致 |
| synthetic rollback release | Known restricted | 旧live BUILD_ID | 否 | 受限任务直接读取原值，不写普通报告 |
| synthetic rollback hash | Known | 旧live synthetic DB SHA | 否 | 使用 `949c78…bb50` |
| canonical HTTPS origin | Unknown | Tailscale CertDomain/Serve | 否 | CertDomains当前为0；用户/管理面先建立并回读 |
| operatorRef | Missing | 本地CSPRNG opaque ref | **是** | 后继受控任务生成，不含账号信息 |
| capability ID | Unknown | 用户控制的小写DNS域 + suffix | 否 | 用户必须提供控制域名；当前目标app-cap为0 |
| trusted login | Discoverable, not frozen | Tailscale管理状态/真实Serve头 | 部分 | 当前CLI可读一个login且仅记录hash；必须与真实Serve头逐字确认后写owner-only配置 |
| M5/iPhone source selectors | Unknown | Tailscale管理面 | 否 | 用户/管理面分别确认精确selector |
| 两个 sourceRefs | Missing | 2×32-byte CSPRNG | **是** | selector冻结后在受限任务生成，互异43-char base64url |
| trusted identities JSON | Missing composite | login + operatorRef + sourceRefs | 部分 | 上述四项完整后机械生成owner-only输入 |
| Ed25519 private/public key pair | Missing | M1受限CSPRNG/key generator | **是** | 当前Admin/Public根及预期key文件均absent；另任务生成0600、核同pair |
| signing key ID | Missing | opaque CSPRNG/ref | **是** | 与keypair同任务生成 |
| sender service identity | Missing | opaque CSPRNG/ref | **是** | 必须与receiver不同 |
| receiver service identity | Missing | opaque CSPRNG/ref | **是** | 必须与sender不同 |
| private/verify key paths | Path decision | 四根隔离合同 | **是（路径）** | 先冻结Admin-private/Public-verify的精确独立路径，再创建；当前均不存在 |

### 3.2 Public 输入

| 输入 | 状态 | 来源 | 可自动生成 | 当前动作 |
|---|---|---|---|---|
| `F1_RELEASE_MANIFEST_PATH/SHA256` | Known | 8e70 final | 否 | 使用final manifest路径 + `d14ee602…11a` |
| public read mode | Decision required | 部署顺序 | 否 | 必须与Admin manifest一致 |
| signing key ID | Missing shared | 与Admin keypair任务 | 是 | 同一key ID |
| public verify key path | Missing | 与Admin公钥同字节、public-only路径 | 是 | 只写公钥，禁止私钥进入Public root |
| projection sender/receiver identities | Missing shared | 与Admin opaque refs任务 | 是 | 与Admin manifest逐字一致且二者不同 |
| rollback app root | Known | 旧live root | 否 | 使用固定旧live app |
| rollback release原值 | Known restricted | BUILD_ID | 否 | 受限任务读取 |
| rollback DB hash | Known | 本轮SHA | 否 | `949c78…bb50` |

### 3.3 代码/环境入口

8e70 release 的实际 CLI 必填字段与 `ADMIN-SERVICE-PREP.md`一致。`.env.example`只覆盖公开运行默认项，没有Admin secret/identity值；prepare必须使用受限、一次性、owner-only进程环境，不得写 `.env`、Git、普通报告或shell history。

## 4. Tailscale Known / Unknown

| 项目 | 本轮事实 | 状态 |
|---|---|---|
| 客户端 | 1.96.5；Backend Running；self online | Known |
| current login | 本地管理状态可读；报告只记录12位hash，不输出原文 | Discoverable，未与Serve头冻结 |
| CertDomains | 0 | Blocking Unknown |
| Serve config | 可读且为空 | Blocking Missing |
| Funnel | 可读且为空 | PASS边界；继续保持0 |
| 当前self app-cap | 目标suffix计数0 | Blocking Missing |
| device approval | 本机CLI状态不提供权威证明 | Blocking Unknown |
| Grants / 精确M5+iPhone selectors | 本机CLI状态不提供 | Blocking Unknown |
| policy canonical hash | 本机CLI状态不提供 | Blocking Unknown |

## 5. Finding

### P0 / P1

无。未发现既有不安全key、第二review DB、未知3101/3102 listener或身份漂移。

### P2-01：Admin/Public roots与key material尚未创建

这是预期的pre-prepare状态，但使key隔离、owner/mode、pair match尚无动态证据。

### P2-02：tailnet管理面关键输入无法从本机CLI闭合

device approval、Grants、selectors与policy hash必须从管理面回读；当前本机状态不能替代。

### P2-03：当前没有CertDomain、Serve或目标app-cap

这符合尚未启用私有入口的阶段，但 canonical origin/capability/真实header均未形成，prepare仍被阻断。

## 6. 最小下一动作

**先完成一个零写的用户/管理面输入确认任务。** 用户只需先提供其控制的 capability DNS 域名，并授权受限管理面只读核验；执行方随后只读取得并脱敏冻结：实际 login、M5/iPhone两个精确source selectors、device approval、现有宽Grants/shared-node风险、目标policy草案与canonical hash、可申请的CertDomain。任一项仍Unknown时停止。

该零写输入任务通过后，再开独立受控生成任务：在M1 owner-only临时/目标根生成Ed25519 pair、两个sourceRefs、operatorRef、key ID、sender/receiver identities及一次性配置收据。生成任务仍不执行prepare、tailnet变更、load或DB迁移。安全复验所有输入后，才可派prepare-only任务。

## 7. 自审

- 没有输出真实login、IP、device/node key、BUILD_ID原文、token或key bytes。
- target verifier是任务要求的只读核对，externalCalls=0；第一次错误Node路径未执行程序，随后使用已冻结真实Node路径成功，没有修改状态。
- SQLite只以readOnly打开；Python sqlite尝试因权限语义在open前失败，随后用固定Node readOnly成功；没有写事务。
- 当前结论只完成输入盘点，不构成prepare、load、Serve、Passkey、migration或cutover授权。

TASK_STATE_OK
