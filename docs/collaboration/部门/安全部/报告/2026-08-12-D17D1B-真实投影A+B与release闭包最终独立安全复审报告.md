---
type: audit_report
department: 安全部
target: "TASK-20260812-D17D1B / A+B real projection and release closure"
status: final
date: 2026-08-12
related_task: TASK-20260812-D17D1B
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
review_mode: static_read_only_first_blocker
tags: [real-projection, release-manifest-v2, next-build, prepare-only, rollback, first-blocker]
summary: "FAIL。冻结A/B报告、accepted ADR、release-manifest源码与本地产物SHA均匹配，runtime88/overlay29/base59/packages44计数匹配；但公开Next实际以start模式消费.next构建输出，v2 manifest的88项runtime closure中.next为0项，public installer也未消费外部manifest SHA锚点，只检查BUILD_ID存在。该installer还会在projection prepare成功前替换用户真实LaunchAgents目录下两份既有plist。由此，同一已验证manifest可对应不同公开执行字节，prepare失败亦可能留下live plist磁盘漂移。P0=0/P1=1/P2=0；按首阻断停止，五层发布门全部不放行，M1运行项保持Unknown。"
---

# 真实投影 A+B 与 release 闭包最终独立安全复审报告

## 1. 最终裁决

**FAIL；P0=0，P1=1，P2=0。**

冻结文件身份和声明计数均匹配，但内容寻址 release 没有覆盖公开 Next 真正执行的 `.next` 构建输出。目标机 public installer 同时绕过外部 manifest 锚点，并在后续 projection prepare 尚未成功时改写真实 LaunchAgent plist。该边界允许“manifest 验证成功，实际公开执行字节不同”，也允许 prepare 中途失败后既有服务的磁盘配置发生漂移。

该问题直接阻断精确 release 身份、prepare-only 和 synthetic 回退保证，定级 **P1-01**。依任务的首个 P0/P1 即停止规则，本报告不再扩展运行审查；M1 stage、真实密钥、真实 DB、listener、sender 到 active、公开 feed/detail 及回退演练均保留 `Unknown`。

本轮没有执行测试、typecheck、网络请求、SSH、数据库读取或写入、服务操作。仓库内唯一业务写入是本报告；任务状态更新由协作任务工具完成。

## 2. 输入、身份与闭包计数

### 2.1 固定输入 SHA-256

| 对象 | 独立只读实算 SHA-256 | 状态 |
|---|---|---|
| A 报告：`2026-08-12-39D4DD投影outbox-single-sender与无hash首包自举实现报告.md` | `93b58b7bfad349fdb1ff94ca6b59d469e1e8fed8e7b8de8e87b3ffe606d6ddb6` | MATCH |
| B 报告：`2026-08-12-B78DAF真实投影B段HTTP公开快照与release-successor实现报告.md` | `71d03dd9d9fa9ab634dfd560f03eaa6c945d003eafa816cb40051b37be2a6085` | MATCH |
| accepted ADR：`ADR-M5-REAL-PROJECTION-RUNTIME-002` | `c94542dc579b49e2cb02ae8a4e92b140f7ff4ad8c8ef007c397f633b45dc149d` | MATCH / accepted |
| release manifest 源码 | `2378be0eda0adc4980c503d79a591c882c51cd3c260f6cb71b24547a4d86f5d7` | MATCH |
| public repository | `2b5ef415bea49ce8435317df676c64b510170b834d39f3df0b09d50d455460a3` | MATCH |
| 本地 builder manifest | `7c318e8469fefbef29fd94c06f0cc3f1e290a2517fb6370743a48eb4f7fabb34` | MATCH |
| public installer | `717d5a2c15a64ac3fc4fda7d35b5084a55baf2abaa59f725dfaf691a41babfc5` | 已绑定 |
| public serve 入口 | `af013608f8ea37fec13f9691f34c9fe9795d5237f70cfb57d78093050cc98e3a` | 已绑定 |

### 2.2 builder manifest 实值

| 字段 | 独立只读实值 | 状态 |
|---|---|---|
| schema | `f1plus1-runtime-release-manifest-v2` | MATCH |
| Git commit | `54e694c13b7369819448a2c3b072cb0fbbc49b7b` | MATCH |
| Git tree | `e5b1d165e1ba6aaca820d15d29be9428dcc6661a` | MATCH |
| Git parent | `5d5963671550b45e9c01fbc727bc6aeac73447e4` | MATCH |
| runtime / overlay / base | `88 / 29 / 59` | MATCH |
| production packages | `44` | MATCH |
| dependency roots / platform packages | `5 / 3` | MATCH |
| Node | `24.18.0`；SHA `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a` | MATCH |
| runtime content root | `1b45de559d55a8cfa9e69556f9415c43659710b7e42e477abc8c34965afb784d` | MATCH |
| dependency content root | `517c29e4a226a5a47ccee85a5063c9ca985aff124760af936acec5c867dd2ffe` | MATCH |
| release root | `73f567da54c38e1ff5c181123fddc6ae2bc34fbcf21009061b74c779bf609c25` | MATCH |
| `.next/` runtime records | `0` | **P1 证据** |

清单文件为 `0600`；本轮只读解析，没有重建或改写清单。

## 3. 首个阻断：P1-01 公开执行闭包可绕过，prepare 会提前改写 live plist

### 3.1 可重复成立的静态证据

1. `app/src/server/admin-service/release-manifest.ts:46-135` 的完整 runtime allowlist 共 88 项，包含源文件、配置、迁移和脚本，未包含任何 `.next/**` 文件；`runtimeFiles()` 和依赖闭包是 verifier 在 `:474-560` 重算的全部内容边界。
2. `app/scripts/serve.ts:144-154` 将 `next` 二进制、`start` 模式和 `appRoot` 交给子进程；生产公开服务因此消费 `appRoot/.next` 的构建产物。
3. `app/scripts/install-macos-public-beta.ts:98-101` 仅确认 `.next/BUILD_ID` 和 synthetic SQLite 是普通文件。它没有核对 BUILD_ID、route/server chunks、静态资源和构建 manifests 的 SHA，也没有调用 `readVerifiedAdminReleaseManifest()` 或读取外部 expected manifest SHA。
4. 同一 installer 的 `atomicWrite()` 在 `:39-45` 使用 `renameSync(candidate, path)` 覆盖目标；没有“目标已存在则拒绝”、既有字节 CAS、备份或 rollback receipt。
5. `app/scripts/install-macos-public-beta.ts:163-174` 先把 `com.f1plus1.public-beta.plist` 和 receipt-refresh plist 写入真实 `~/Library/LaunchAgents`；直到 `:176-189` 才执行 `preparePublicProjectionDeployment()`。后一步失败时，前两次替换已经完成。
6. 两份 public plist 均带 `RunAtLoad=true`（`:61-84`）。该命令本身没有调用 `launchctl`，所以本轮没有静态断言“命令执行当刻已加载”；已加载 job、登录重建或重启后的实际行为仍可能受新磁盘 plist 影响。输出 `installed-not-loaded` 无法证明既有 job 状态。
7. accepted ADR 第 37-39 行要求 cutover 基于内容寻址 release manifest，并保留上一精确 synthetic release 回退；运行清单第 26 行要求 fresh-stage verifier 成功后才能 prepare。当前执行路径无法证明这两个前置成立。

### 3.2 安全影响

- 攻击者、误操作或陈旧构建可在不改变 v2 manifest SHA 的情况下替换 `.next`，随后由公开服务执行或响应这些未绑定字节。
- target verifier 成功只证明 88 项源码/脚本、生产依赖和 Node；它无法证明真正服务的页面、route handlers、server chunks、BUILD_ID 和静态资源与候选一致。
- installer 在 projection manifest、keypair、服务身份或 public root 校验失败之前已经改写既有 public plist，prepare-only 不能维持现有服务磁盘状态零漂移。
- installer 从当前 SQLite 自算 rollback hash、从当前 `.next/BUILD_ID` 自读 rollback release，二者没有外部预期锚点。若本地输入本身已漂移，生成的“回退锚点”会把漂移值记录为真值。

### 3.3 最小修正

1. 为公开构建产物增加独立、不可变且外部锚定的 build manifest；至少闭合 `.next/BUILD_ID`、服务端 route/app chunks、运行 manifests 和公开静态资源的精确文件集、mode、size、SHA-256，并拒绝 symlink、额外可执行文件及文件集漂移。也可把该闭包纳入现有 v2 manifest，前提是 verifier 在目标机执行前逐项重算。
2. public prepare 必须消费外部固定的 release/build manifest SHA；先完成全部 manifest、Node、依赖、build、synthetic rollback release/hash、keypair、路径和身份验证，随后才可生成候选工件。
3. prepare-only 仅写入 task-private 或 release-private stage；禁止写 `~/Library/LaunchAgents`。若目标 plist 已存在，prepare 应 fail closed 并保持原字节、mode、inode 指向和 loaded state 不变。
4. 另建明确授权的 cutover 命令：先保存既有 plist、BUILD_ID、synthetic DB hash/read-mode 与 loaded state 的外部锚定回退收据，再以 CAS/原子切换更新 release 指针；任何一步失败均回到原字节。
5. 修复后的最小高价值验收只需两条：篡改任一 `.next` 执行文件后 verifier 必须拒绝；让 projection prepare 在末步失败后，两份既有 plist 必须逐字节不变且无 load/bootstrap。该验收不在本任务执行。

## 4. 首阻断前已覆盖的静态边界

以下仅表示已读实现中观察到对应约束；它们不能抵消 P1，也不代表运行通过：

- A 段 sender 的 single-worker lease、unknown 到 receipt reconcile、404 后同包重投和终态 receipt/audit 路径；
- receiver 的 loopback/Host/service identity、Ed25519、空根 gen1/null previous、committed generation 与 active pointer 连续链；
- public reader 的 active → committed → signature/manifest/records 逐请求校验、empty/corrupt/V2/no-fallback 分支；
- Admin/public deployment v2 的逻辑资源根、key ID/public/private key角色和 disabled receiver plist；
- public route 的显式 read-mode 接线与 public repository 的公开字段边界；
- base/overlay/production dependencies/Node 现有 verifier 身份，以及生产依赖 `.bin` symlink 排除的代码路径。

发现 P1-01 后没有继续尝试证明这些边界的完整运行正确性，也没有新增第二个 finding。

## 5. 分层放行裁决

任务合同规定只有 `P0=0/P1=0` 才能进入下一层；本轮 `P1=1`，裁决如下：

| 层级 | 裁决 | 原因 |
|---|---|---|
| 提交精确 Git 候选作为发布候选 | **不放行** | 可保留为带阻断标记的源码检查点；当前 manifest 无法绑定实际 Next 构建执行字节 |
| 同步 M1 fresh stage | **不放行** | stage verifier 无法发现 `.next` 漂移 |
| 执行 prepare-only | **不放行** | installer 绕过外部锚点并提前替换真实 LaunchAgent plist |
| load internal receiver / Admin | **不放行** | 上一层未通过，真实 key/DB/listener 状态仍 Unknown |
| 切换 public read-mode | **不放行** | content-addressed cutover 与精确 synthetic rollback 尚未成立 |

本裁决没有删除、回退或修改开发成果；统筹部可在 P1 最小修正完成后创建一次聚焦 successor 审查。

## 6. Unknown

- M1 上 fresh stage 的目录、权限、链接、Node 与实际 release 文件身份；
- M1 Ed25519 keypair、Admin/public 用户或服务身份及私钥隔离；
- 真实 `0003` migration、DB schema/integrity、recovery fence、passkey/Tailscale；
- internal receiver 是否仅监听 loopback、Host/identity 拒绝与 crash 后 O_EXCL 行为；
- sender 实际投递、unknown/404/重投、receipt/audit 事务和至少一代 active snapshot；
- 公开 feed/detail 200、V2 406、corrupt 503、无 internal/Admin 公网路由、原文 URL 实际出口；
- 上一 active pointer 与上一精确 synthetic release 的真实回退演练；
- 现有 public LaunchAgent 是否 loaded，以及其当前 plist/BUILD_ID/DB 精确身份。

这些项目没有被静态推断为通过或失败。

## 7. 自审与任务边界

- 已完整回读安全部上岗引导、岗位说明、交接班文档、收件箱、任务 JSON、A/B 报告及 accepted ADR；
- 已独立实算任务要求的主要 SHA，并只读解析现有 builder manifest；冻结 SHA 和声明计数没有漂移；
- P1 以实际执行闭包和写入顺序为证据，没有把“可能”直接当作已发生的运行事故；
- 没有声称 installer 当前已 load 服务；结论限定为磁盘 plist 被提前替换及未来服务状态缺少保护；
- 没有读取或输出密钥、session、passkey、数据库正文、运营身份或公网 origin；
- 没有执行 test、typecheck、build、网络、SSH、数据库操作、installer、service、launchctl 或清理；
- 发现首个发布阻断后即收口，没有扩展到任务外，也没有用未验证项放行后继层。

TASK_STATE_OK
