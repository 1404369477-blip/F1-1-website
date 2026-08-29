---
type: audit_report
department: 安全部
target: TASK-20260812-42DB75 固定 M1 Admin 部署与私有入口只读 preflight
status: final
date: 2026-08-12
related_task: TASK-20260812-42DB75
decision: pass
severity_count: { P0: 0, P1: 0, P2: 4 }
tags: [M1, admin-service, preflight, tailscale, loopback, release-closure, read-only]
summary: "PASS。SSH只读预检确认固定M1身份、Node24、公开Beta/RSS基线健康，3101无listener、Admin label/plist/私有根均不存在；Tailscale 1.96.5已安装且节点Running/Online，但未启用Serve证书域。M1仍是无.git的5d5963系release package，Admin commit 54e694c的34文件及SimpleWebAuthn 22包生产依赖尚未同步。本轮0传输/0安装/0登录/0load/0迁移/0DB写。"
---

# TASK-20260812-42DB75 固定 M1 Admin 部署与私有入口只读 preflight 报告

## 1. 结论

**PASS；P0=0，P1=0，P2=4。**

可进入后续“精确 release 同步 → 生成不可变 deployment manifest → 单独 prepare-only”阶段。当前不得 load Admin、启用 Tailscale Serve、迁移真实 DB 或开放 mutation。

四项 P2 是后续部署输入/实机证据缺口，未构成本次只读预检阻断：

1. Tailscale 已在线，但 Serve/TLS/精确 canonical origin/Grant/device approval 尚未形成证据；
2. Admin commit `54e694c13b7369819448a2c3b072cb0fbbc49b7b` 的运行闭包与 `@simplewebauthn/server` 生产依赖未到 M1；
3. 投影 Ed25519 验签公钥、key ID、bootstrap generation/hash 尚未生成/冻结；
4. RPO 15 分钟的异机一致性备份与 recovery fence 还未实施，所以后续 prepare 必须保持 `writerReady=false` 且 mutation=0。

## 2. 审查方法与严格边界

通过用户已授权 SSH alias `f1plus1-m1-uu` 运行白名单只读命令：`id/uname/sw_vers/stat/df/shasum/lsof/launchctl print/plutil/curl/Tailscale status --json`，以及用固定 Node 24 的 `DatabaseSync(...,{readOnly:true})` 读取 RSS 私有库。所有身份输出都做了去账号、去设备名、去 IP、去 tailnet 标识处理。

本轮远程操作为：

- 传文件/scp/rsync：`0`；
- 安装/更新/下载：`0`；
- Tailscale 登录/授权/up/Serve/Funnel：`0`；
- `launchctl bootstrap/load/kickstart/bootout`：`0`；
- Admin prepare/启动：`0`；
- migration/SQLite mutation/业务发布：`0`；
- 公开 Beta 和 RSS 服务更改：`0`。

说明：命令中两次只读 SQLite 查询因 shell 引号错误在 SQL prepare 阶段失败，没有执行写事务；后续使用更窄的只读查询成功。一次 Tailscale 状态命令因 zsh 保留变量名在状态读取前停止，后续改用非保留变量名只读成功。

## 3. M1 主机与运行基线

| 检查项 | 只读实值（脱敏） | 结论 |
| --- | --- | --- |
| 运行身份 | UID `501`，用户名仅记录 12 位 hash，home basename 与既有收据一致 | PASS |
| 硬件/OS | `arm64`，macOS `26.5.1` | PASS |
| 非 iCloud app root | `/Users/<redacted>/F1-1-website/app`，普通目录，UID 501 | PASS |
| Git 形态 | 运行根无 `.git`，仍是 release package | PASS（符合既有部署形态） |
| 可用磁盘 | 约 `269.8 GB` | PASS |
| Node | `v24.18.0`，固定 arm64 绝对路径 | PASS |
| Node SHA-256 | `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a` | MATCH |

## 4. Admin/3101 冲突门

| 检查项 | 结果 | 结论 |
| --- | --- | --- |
| TCP 3101 listener | `0` | PASS |
| `gui/501/com.f1plus1.admin-service` | not loaded | PASS |
| `~/Library/LaunchAgents/com.f1plus1.admin-service.plist` | absent | PASS |
| `~/Library/Application Support/F1Plus1/Admin` | absent | PASS |
| M1 app 内 Admin service/UI/0002 migration | absent | EXPECTED：尚未同步 |
| M1 `package.json` SimpleWebAuthn | absent | EXPECTED：尚未同步 |
| M1 `node_modules/@simplewebauthn/server` | absent | EXPECTED：尚未同步 |

没有发现未知 listener、残留 Admin plist 或已 load Admin label，因此未触发“首错即停”修复禁区。

## 5. Tailscale 当前事实

| 检查项 | 脱敏实值 | 结论 |
| --- | --- | --- |
| macOS App | `/Applications/Tailscale.app` present | PASS |
| 客户端版本 | `1.96.5` | PASS |
| 应用进程 | present | PASS |
| BackendState | `Running` | PASS |
| 本节点 | Online | PASS |
| peer 数 | `2` | INFO，不输出对端身份 |
| MagicDNS suffix | present | INFO，不输出具体值 |
| CertDomains | `0` | UNKNOWN：尚无 Serve HTTPS/canonical domain 证据 |
| server tag | 未观察到 | UNKNOWN：未实施 server role/tag |
| key expiry | 存在到期时间 | INFO；未改动 |

预检纠正了任务形成时的旧 Unknown：Tailscale 并非缺失，且该节点已 Running/Online。本轮没有调用登录、授权、up、Serve、Funnel 或设备批准操作；Grant/device approval/异端可达仍为 Unknown。

## 6. 现有服务、RSS 与公开面

| 对象 | 只读结果 | 结论 |
| --- | --- | --- |
| `com.f1plus1.public-beta` | running，PID 与既有基线一致 | PASS |
| `com.f1plus1.quick-tunnel` | running，当前 PID 与既有基线一致 | PASS |
| Quick Tunnel upstream | 只含 `http://127.0.0.1:3000`，无 `3101` | PASS |
| `com.f1plus1.receipt-refresh` | loaded/not running，last exit `0`，interval `43200s` | PASS |
| `com.f1plus1.rss-collector` | loaded/not running，last exit `0`，interval `900s`，runs `17` | PASS |
| RSS source | `enabled=1 / stop_epoch=4 / last_reason=OK` | PASS |
| RSS private DB | mode `0600`，UID 501，user_version `1`，20 candidates | PASS |
| RSS latest run | `succeeded/OK`，`new=0/updated=0/duplicate=20` | PASS |
| public DB | size `737280`，inode `24546198`，mode `0600`，UID 501，nlink 1 | MATCH |
| public DB SHA-256 | `949c78d505e4c032d2495174deaf62d24f9d99b76284ad7ba6fb29a5ac83bb50` | MATCH |
| local home/detail | HTTP `200/200` | PASS |
| public home/detail | HTTP `200/200` | PASS |
| 公网 Admin/internal 负向 | 4 类路由全为 HTTP `404`，响应体字节一致 | PASS |

`quick-tunnel` 的 `runs=2/last exit=1` 表示其 KeepAlive 历史上有过一次退出并由 launchd 重启；当前进程正在运行，四个页面探针通过，所以本任务仅记为历史可用性信号，不停止或修复。

## 7. 本地 commit 54e694c Admin 运行/依赖闭包

### 7.1 Git 身份

- commit：`54e694c13b7369819448a2c3b072cb0fbbc49b7b`；
- tree：`e5b1d165e1ba6aaca820d15d29be9428dcc6661a`；
- parent：`5d5963671550b45e9c01fbc727bc6aeac73447e4`；
- `5d596367...` 是 `54e694c...` 的 ancestor；
- Admin 候选与已有 M1 RSS release 可做单向增量 overlay，但 M1 根无 `.git`，不能执行 `git pull`；
- 当前 Admin 运行相关路径在本机工作树内无 dirty/untracked 状态。

### 7.2 文件闭包

commit 共变更 34 个文件，其中 M1 最小运行/部署闭包为：

- `app/package.json`、`app/package-lock.json`；
- `app/migrations/rss-real/0002_admin_review_publish.sql`；
- `app/scripts/admin-service.ts`、`app/scripts/admin-install-macos.ts`；
- `app/src/admin-ui/{index.html,app.css,app.js}`；
- `app/src/server/admin-service/{auth,deployment,runtime,server,storage,webauthn}.ts`；
- `app/src/server/review-real/{backend,error,mapping,migration,projection,repository,routes,schema,security}.ts`；
- 复用 M1 已有的 RSS/DB/runtime/security 模块与 `0001_rss_real.sql`。

三个 `app/src/tests/*` 是候选审计/交付闭包，不是 M1 服务启动必需文件。`ADMIN-SERVICE-PREP.md` 与 Spec/ADR/进度文档是运维和追溯闭包，不是运行模块。

后续同步应用精确白名单 release package/候选目录原子切换，并在切换前保留现行 `5d5963` 系运行目录作回退锚。不应把当前脏工作树全量复制到 M1。

### 7.3 新增生产依赖闭包

`@simplewebauthn/server@13.3.2` 从 lockfile 闭包遍历得到 22 个包（全部有 integrity）：

```text
@simplewebauthn/server@13.3.2
@hexagon/base64@1.1.28
@levischuck/tiny-cbor@0.2.11
@peculiar/asn1-android@2.8.0
@peculiar/asn1-cms@2.8.0
@peculiar/asn1-csr@2.8.0
@peculiar/asn1-ecc@2.8.0
@peculiar/asn1-pfx@2.8.0
@peculiar/asn1-pkcs8@2.8.0
@peculiar/asn1-pkcs9@2.8.0
@peculiar/asn1-rsa@2.8.0
@peculiar/asn1-schema@2.8.0
@peculiar/asn1-x509@2.8.0
@peculiar/asn1-x509-attr@2.8.0
@peculiar/utils@2.0.3
@peculiar/x509@1.14.3
asn1js@3.0.10
pvtsutils@1.3.6
pvutils@1.2.0
reflect-metadata@0.2.2
tslib@2.8.1
tsyringe@4.10.0
```

后续 release builder 应像 RSS manifest 一样锁定这 22 包的 lockfile version/integrity 和实际 `node_modules` 递归内容根。只复制顶层 `@simplewebauthn/server` 会缺失转移依赖，不得进入 M1 启动候选。

## 8. deployment 前置输入分类

| 输入 | 当前状态 | 后续处置 |
| --- | --- | --- |
| Admin bind | 已知：代码锁定 `127.0.0.1:3101` | manifest 固定，无覆盖 |
| fixed Node | 已知：`v24.18.0` + 上述 SHA | manifest 锁定 |
| app root | 已知：M1 非 iCloud release root | 新候选目录切换后固定 |
| Tailscale 版本/在线 | 可自动发现：`1.96.5`、Running/Online | 实施窗口重新只读回读 |
| canonical HTTPS origin | 可从后续 Serve/CertDomains 发现；当前为 Unknown | 启用 HTTPS/Serve 前冻结精确 origin，不入 Git |
| operator ref | 必须后续生成的 opaque 引用 | 不写账号/邮箱原文 |
| trusted identity login | 可由 Tailscale identity 头的实施配置确定 | 只写私有 manifest，普通报告不留原文 |
| M5/iPhone device refs | 必须后续分别生成并批准 | 两端独立，不使用共享设备引用 |
| projection signing key ID | 必须后续生成 | 只保存 opaque ID |
| projection verify public key | 必须后续生成，0600 私有文件 | 只将公钥路径写入私有 manifest；私钥另域 |
| bootstrap generation/hash | 必须由首个签名全量 snapshot 生成 | 未有精确 pin 时不运行 receiver |
| recovery fence | prepare 会生成 `clockTrusted=false/writerReady=false/lastSuccessfulRecoveryPointAt=null` | 备份门未过时保持 fail-closed |
| bootstrap token | prepare 后本地 TTY 生成，TTL `≤10m` | 不在报告、URL、仓库或同步剪贴板传递 |

## 9. 回退基线与后续硬门

当前精确回退基线：

- 公开 DB：SHA/size/inode/mode/UID/nlink 与第 6 节一致；
- 现有四个 plist SHA 已只读记录：`public-beta 59151b3e…`、`quick-tunnel 0c039749…`、`receipt-refresh e9938d6b…`、`rss-collector 60cd3b0d…`；
- RSS：source `enabled=1/epoch4`，collector interval `900s`，last exit `0`，20 条 private candidates；
- public：local/public home/detail 全部 200，公网 Admin/internal 为通用 404；
- Admin：3101 listener=0、label unloaded、plist/data root absent。

后续最小实施硬门：

1. 从精确 commit `54e694c...` 产生可验证的 Admin release manifest，包含上述 runtime 文件与 22 包依赖内容根；
2. 用候选目录原子切换/精确 overlay，不全量复制工作树；同步后先只读验签；
3. 冻结 Serve canonical origin、operator/device refs、Grant/device approval 与投影签名 bootstrap pin；
4. 事先形成公开 Beta/RSS 回退锚和合格一致性备份收据；
5. 单独执行 prepare-only，确认 disabled plist/0600 私有文件且 3101 listener 仍为 0；
6. 另一任务才可 load 3101，再另一任务才可启用 Serve；Funnel 继续为 0；
7. 备份过期/时钟不可信/`writerReady=false` 时必须 mutation=0，只读队列可在后续单独开放。

## 10. 已验证、未验证与错题自检

**已验证**：M1 身份/Node/磁盘；3101/Admin label/plist/root 无冲突；Tailscale App/版本/Running/Online；public-beta/quick-tunnel/receipt-refresh/RSS collector 状态；RSS source/epoch/private DB/candidate/latest run；public DB 精确身份；本地与公网四页 200；公网 Admin/internal 四类 404；Git commit/tree/parent；Admin 文件闭包和 SimpleWebAuthn 22 包依赖闭包。

**未验证**：Serve/TLS/canonical origin/Grant/device approval；M5/iPhone 跨网与撤销；Admin release manifest 实现与 M1 同步；投影签名 key/bootstrap snapshot；prepare/load/passkey/真实 migration；异机备份/RPO/RTO；public projection switch。

**错题自检**：未输出账号、设备名、IP、tailnet、MagicDNS suffix、token、Cookie、Tailscale identity 原文、私钥或完整设备唯一标识；未传输、安装、登录、load、迁移、写 DB、修改网络、更改服务或发布内容。历史 quick-tunnel last-exit 和三次只读命令引号/保留变量错误均如实记录，没有冒充产品故障或隐藏。
