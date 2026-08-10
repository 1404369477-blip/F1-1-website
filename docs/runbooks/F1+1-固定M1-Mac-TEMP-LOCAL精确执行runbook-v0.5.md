---
title: F1+1 固定 M1 Mac TEMP-LOCAL 精确执行 runbook v0.5
type: temp_local_execution_runbook_successor
status: conditionally_executable
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-9ACCE0
predecessor: docs/runbooks/F1+1-专用Admin-Mac-旧WPA临时运行与安全网络升级runbook-v0.4.md
predecessor_sha256: 68f7622b41888e573de79f5537893c23983c691bbbc6ae73452b4fe1155e74db
temp_local_authorized: true
network_remote_production_authorized: false
candidate_mutation_authorized: false
external_side_effects: 0
---

# F1+1 固定 M1 Mac TEMP-LOCAL 精确执行 runbook v0.5

## 0. 文档性质与当前激活态

本文是已 ACK v0.4 的 append-only successor。v0.4 保持原路径、原字节与 SHA-256，v0.5 不覆盖或回写历史。

用户已授权一次 `TEMP-LOCAL` 本机预览准备：固定 Mac 本机、loopback、synthetic/local SQLite、`externalCalls=0`、同机浏览器。以下能力仍未授权：安装或下载依赖、登录或真实账号、网络配置、UU、SSH/Remote Login、FileVault、Tailscale、Firewall、路由器、LAN/overlay/公网监听、真实 provider/Base/数据/密钥、发布、上传和部署。

当前 `TASK-20260809-47EF67` 仍为 `claimed`，未有 PASS/ACK 收据。因此当前激活态为 `WAIT_47EF67`：目标 Mac Agent 可做只读规划，不得复制候选、创建临时根、启动进程或打开页面。只有 47EF67 的任务 JSON 已 `completed`、结论 PASS/P0=0/P1=0 且经统筹 ACK，才能进入本文的单一用户确认门。若结论是 FAIL/BLOCKED、报告缺失或候选漂移，v0.5 保持 `FAIL_CLOSED`。

## 1. 脱敏设备与隐私边界

允许记录的固定事实只有：

- MacBook Air（M1，2020）；
- 8GB 内存；
- macOS 26.5.1；
- 可长期接电；
- Wi-Fi only；
- `current_wifi_security=legacy_wpa_low_security`。

严禁读取、复制、转写、散列、编码或输出截图特定的 Wi-Fi/路由器地址、SSID、密码、MAC、IP、序列号、磁盘标识、设备 ID、Apple Account、overlay ID、密钥、token 或其他唯一标识。绝对路径和当前账号只在目标 Mac 进程内用于路径安全判定，对话和收据一律使用 `<SOURCE_ROOT>`、`<TEMP_ROOT>` 与 `<LOCAL_USER>` 别名。

## 2. 候选和前置固定收据

### 2.1 predecessor 与候选主收据

| 对象 | 固定 SHA-256 / 结论 |
|---|---|
| v0.4 runbook | `68f7622b41888e573de79f5537893c23983c691bbbc6ae73452b4fe1155e74db` |
| 11 源码顺序聚合 | `7b1e8977c3e7296f4e5cf165b106bc322c2ef19dbd5e506f51e2c4ec92465281` |
| canonical local synthetic DB | `eb2d7ad2787a290f7a13adcb063215d58654bc9f66d1d8ff60b98f14592b9551` |
| `.next/BUILD_ID` 文件 | `8155e435b052ae87467671cfc0bdfc59bf931922eb55fcf16f03fc68a5efb1c5` |
| `.next/build-manifest.json` | `b8c57b58a1f524871415bd233871800d9608e35f2f4f188b2d58675e38f0881c` |
| `.next/server/middleware-manifest.json` | `3e662212864bc4c124cfc53fa5d428813c619852b447c9fd2d9926cd39d7a4a6` |
| Node | `24.18.0`; darwin-arm64 `bin/node` SHA `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a` |
| `app/package-lock.json` | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` |
| `app/node_modules/.package-lock.json` | `d20b937d69ac116f7fe6eeec5eba611e1dc88dda02eb4d55c7f96e2cf3a1d361` |

上述候选是 preview/acceptance 候选，不是生产发布物。本任务不修改候选、不重建 build、不运行 npm install/ci/build/test。

### 2.2 只读复算树根

`TREE-SHA256-LINES-v1` 唯一算法：在 bundle root 下，对闭集中所有普通文件的相对路径按 `LC_ALL=C` 升序排列；每行固定为 `<file_sha256><two spaces><relative_path>\n`；对完整 UTF-8 字节流再计算 SHA-256。文件名含换行、文件数不符、多出普通文件或出现未允许链接时立即拒绝。

| 闭集树 | 普通文件数 | `TREE-SHA256-LINES-v1` |
|---|---:|---|
| `app/.next` | 200 | `d282b899667fb48c6ed44ae46da3abaadcfe148ed471c4c31cef240712eddb70` |
| `app/node_modules` 普通文件；所有 `.bin` 目录不复制 | 21110 | `dbefc0ae930804c6afb8582e3b539b17a6845120b86a343ad06c83b387ab24f8` |
| `app/src/server` | 30 | `bf20ef675c2b44c7bf1772e826ee7de2dcce99685bf697aa57ebb30ecdea8139` |

`app/.next` 和 `app/src/server` 的 symlink 必须为 0。`app/node_modules` 不复制任何 `.bin` 目录或 symlink，目标树必须只有上表 21110 个普通文件。

### 2.3 11 源码聚合顺序

目标 Agent 必须按 manifest 列出的 11 条路径顺序执行 `shasum -a 256`，再对完整标准输出计算 SHA-256。禁止按目录枚举顺序、locale 顺序或当前 `find` 顺序替代 manifest 顺序。

## 3. 闭集复制范围

来源是用户指定的 iCloud 项目副本；来源根只读。目标是不位于 iCloud/CloudStorage/Dropbox/OneDrive/Google Drive/Git 工作树的 `/private/tmp/f1plus1-temp-local-9acce0`，权限 `0700`。目标路径已存在、为 symlink、不属于当前本地用户或权限无法精确置为 `0700` 时停止。

唯一复制闭集：

1. `app/.next/**` 的 200 个普通文件；
2. `app/node_modules/**` 的 21110 个普通文件，排除所有 `.bin` 目录和全部 symlink；
3. `app/src/server/**` 的 30 个普通文件；
4. manifest 列出的 11 个候选源码文件；
5. `app/scripts/serve.ts`、`app/package.json`、`app/package-lock.json`、`app/.node-version`、`app/.nvmrc`、`app/.npmrc`、`app/.env.example`、`app/next.config.ts`；
6. `app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/node`；
7. `app/.local/f1plus1-public-multimedia-synthetic.sqlite`；
8. `data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json`；
9. `data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/manifest.json`；
10. v0.5 runbook、v0.5 closed manifest 与v0.5 交接提示词的只读副本。

禁止复制 `.env`、其他 `.local` 文件、WAL/SHM、旧 DB/备份、receipt/log/screenshot、`.git`、用户文件、真实数据、账号、密钥、网络配置或闭集外任何项。复制只能在单一确认后执行，并在启动前对目标副本重算全部根和单文件 hash。

## 4. 精确阶段

### Stage 0｜只读规划，当前可执行

1. 只读解析 iCloud 候选根和当前本地账号；不向对话、日志或收据输出实值。
2. 确认来源根不是 symlink，闭集文件为单链接普通文件，除闭集树外不遍历其他目录。
3. 复算 v0.4、候选主收据、Node/lock、三个树根和 11 源码顺序聚合。
4. 只读检查 `/private/tmp/f1plus1-temp-local-9acce0` 不存在，3000/3001 无监听，不停止任何现有进程。
5. 回读 47EF67 任务及报告。未 `completed+PASS+ACK`、任一 P0/P1 或报告/hash 无法绑定时，输出 `BLOCKED_47EF67` 并停止，不问执行确认问题。
6. 仅在所有只读门通过时，生成完整命令预览，然后只问一个确认问题。

### Stage 1｜单一确认

问题必须一次性包含任务 ID、五个候选主 hash、`<SOURCE_ROOT>` 已内部解析、目标 `/private/tmp/f1plus1-temp-local-9acce0`、固定端口 3000/3001、只有 loopback/synthetic、终止后默认保留 0700 目录，以及所有禁止能力。

唯一问题模板：

> 已完成只读计划：47EF67=PASS/ACK，候选五个主 hash 与 v0.5 manifest 全部匹配，来源别名为 `<SOURCE_ROOT>`，目标为 `/private/tmp/f1plus1-temp-local-9acce0`，只使用 127.0.0.1:3000/3001、synthetic DB 与同机浏览器，`externalCalls=0`；未授权安装、网络变更、UU/SSH/FileVault/Tailscale/Firewall、真实账号/数据、外联或部署；停止后默认保留 0700 临时目录待后续单独清理授权。是否批准严格按本命令预览执行一次 TASK-20260809-9ACCE0 TEMP-LOCAL？

只有明确肯定回答才能进入 Stage 2。回答中变更候选、路径、端口、网络、数据或保留策略时，原计划失效；Agent 只做新的只读计划，不沿用旧确认。

### Stage 2｜本地闭集复制

1. `umask 077`，创建精确的 `/private/tmp/f1plus1-temp-local-9acce0`，权限回读必须是 `0700`。
2. 使用本地文件复制工具只复制第 3 节闭集；不执行 npm、Git、包管理器、网络请求或 lifecycle script。
3. 目标根内禁止 `.env`、非目标 DB、WAL/SHM、symlink、hardlink、socket、device、FIFO 和闭集外文件。
4. 复算所有单文件 hash、三个树根和 11 源码聚合；任一不符即停止，不重建、不修补、不下载。

### Stage 3｜启动前门

1. Node 输入必须是闭集中的精确 arm64 二进制，`--version` 必须为 `v24.18.0`；只允许这一次本地进程检查，不运行 npm。
2. 3000/3001 两个端口必须无监听；若被占用，停止并报告，不杀死占用者、不自选新端口。
3. 进程环境只允许本节闭集字段。任何 proxy、credential、`DATABASE_URL`、`AUTO_PUBLISH`、`REAL_*=true`或未知 app 环境字段都拒绝。
4. 必须使用 47EF67 PASS/ACK 固定的 App 进程级 no-egress 包装和收据规则。v0.5 不得在 47EF67 收据出现前自行猜测 Seatbelt/sandbox 规则。
5. 启动环境唯一业务配置：

```text
APP_ENV=local
APP_PORT=3000
APP_BIND_HOST=127.0.0.1
APP_PUBLIC_ORIGIN=http://127.0.0.1:3000
F1_DATA_PROFILE=public-multimedia-synthetic
F1_DB_PATH=.local/f1plus1-public-multimedia-synthetic.sqlite
SOURCE_CONFIG_PROVIDER=fixture
SOURCE_FIXTURE_PATH=../data/mvp-contract-v0.6-public-multimedia-pagination-synthetic/runtime-graph.public-multimedia-pagination-synthetic.json
ADAPTER_MODE=mock
SUMMARY_MODE=fixture
MEDIA_MODE=fixture
PUBLISH_MODE=manual_only
REAL_FEISHU_IO=false
REAL_EXTERNAL_IO=false
REAL_FORM_SUBMIT=false
ADMIN_ACCESS_MODE=local_dev_only
LOG_LEVEL=info
```

### Stage 4｜一次启动与本机预览

命令模板的参数、环境和 wrapper 顺序由 Stage 0 完整显示并在 Stage 1 一次确认中冻结。启动主体只能是：

```text
cd <TEMP_ROOT>/app
<47EF67_PASS_ACK_NO_EGRESS_WRAPPER> \
  <TEMP_ROOT>/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/node \
  --experimental-strip-types \
  <TEMP_ROOT>/app/scripts/serve.ts start
```

启动后仅允许：

1. 健康请求 `GET http://127.0.0.1:3000/api/health`；必须 HTTP 200、`status=ready`、`scope=local-only`、`dataGate=accepted-public-multimedia-synthetic`、`externalCalls=0`、Node `24.18.0`；
2. 同一台 Mac 的本地浏览器打开 `http://127.0.0.1:3000/`；禁止使用系统 Chrome 的真实账号 profile，只能沿用 47EF67 PASS/ACK 批准的同机、无外联、脱敏浏览方式；
3. 只读浏览公开 synthetic feed/detail；不访问 Admin、不提交表单、不打开原文链接、不使用真实账号/数据。

健康门、监听回读或 no-egress 收据任一为 FAIL/Unknown 时，不打开浏览器并立即进入 Stage 5。

### Stage 5｜停止与零残留门

1. 向本任务进程发送预览中冻结的正常停止信号，有界等待；不使用宽泛进程名杀死。
2. 只对记录的任务 PID/子孙 PID 执行有界强制停止，先回读 PID 对应的 executable 与临时根。
3. 127.0.0.1:3000/3001 监听数必须为 0；非 loopback 监听数必须一直为 0；任务进程数必须为 0。
4. `externalCalls=0`、`realAccountsRead=0`、`realDataRead=0`、`secretsRead=0`、`networkChanges=0`、`servicesConfigured=0`、`deploymentActions=0` 必须有闭集收据；任一无法证明按 FAIL 处理。
5. 默认保留 `/private/tmp/f1plus1-temp-local-9acce0` 为 0700 受控本地目录，不删除、不移动、不上传。清理属于后续单独授权；必须先实路径回读精确命中任务根、无进程/监听/句柄、再优先移至可恢复隔离位置；禁止对用户目录、iCloud 根、项目根或任何宽泛路径使用递归删除。

## 5. 精确失败关闭码

| reasonCode | 唯一触发 | 恢复出口 |
|---|---|---|
| `BLOCKED_47EF67` | 47EF67 未 completed+PASS+ACK、FAIL/BLOCKED 或证据缺失 | 不复制、不确认、不运行；等精确后继收据 |
| `CANDIDATE_IDENTITY_MISMATCH` | 任一文件/树/聚合 hash 或数量不符 | 保留源候选不动，不重建/修补 |
| `RUNTIME_INPUT_MISSING` | Node/lock/node_modules/build/DB/fixture 任一缺失 | 停止，不联网下载或安装 |
| `CLOSED_SET_VIOLATION` | 多项、缺项、特殊文件、未允许链接或其他 `.local` 对象 | 停止，保留脱敏证据 |
| `TEMP_ROOT_UNSAFE` | 目标已存在、位于同步树、非 0700、所有者不符或为链接 | 不改动现有对象，回传阻断 |
| `PORT_PRECONDITION_FAILED` | 3000/3001 已有监听或无法证明为空 | 不杀进程、不换端口，停止 |
| `NON_LOOPBACK_LISTENER` | 任何非 127.0.0.1 监听或监听范围 Unknown | 立即停任务进程，端口/进程清零 |
| `EXTERNAL_IO_DETECTED` | DNS/非 loopback HTTP/raw socket/代理/子进程外联非 0 或 Unknown | 立即停止，保全脱敏收据，不重试 |
| `REAL_AUTHORITY_DETECTED` | 真实账号/密钥/数据/provider/Base/生产对象被读取或请求 | 停止、隔离任务进程，升级安全处理 |
| `HEALTH_NOT_READY` | 健康收据任一固定字段不符 | 不打开浏览器，停止并清零 |
| `STOP_ZERO_NOT_PROVEN` | 停止后监听/进程或关键零值任一无法证明 | 结果 FAIL，保留目录和收据，不自动清理 |

## 6. 脱敏 closed receipt

最终 JSON `additionalProperties=false`，必须只有 manifest 列出的字段：

```json
{
  "schemaVersion": "f1plus1-temp-local-receipt-v0.5",
  "taskId": "TASK-20260809-9ACCE0",
  "mode": "TEMP-LOCAL",
  "result": "PASS|FAIL|BLOCKED",
  "reasonCode": "OK|<closed reasonCode>",
  "gate47ef67": "PASS_ACK|BLOCKED|FAIL|UNVERIFIED",
  "candidate": {
    "sourceAggregateSha256": "<64hex>",
    "canonicalDbSha256Before": "<64hex>",
    "buildIdFileSha256": "<64hex>",
    "buildManifestSha256": "<64hex>",
    "middlewareManifestSha256": "<64hex>"
  },
  "runtime": {
    "nodeVersion": "24.18.0|UNVERIFIED",
    "bindHost": "127.0.0.1|NONE",
    "publicPort": 3000,
    "internalPort": 3001,
    "healthHttpStatus": 200,
    "healthStatus": "ready|not_ready|NOT_RUN",
    "dataGate": "accepted-public-multimedia-synthetic|NOT_RUN",
    "sameMacBrowser": true,
    "syntheticOnly": true
  },
  "guards": {
    "externalCalls": 0,
    "realAccountsRead": 0,
    "realDataRead": 0,
    "secretsRead": 0,
    "networkChanges": 0,
    "uuChanges": 0,
    "sshChanges": 0,
    "fileVaultChanges": 0,
    "tailscaleChanges": 0,
    "firewallChanges": 0,
    "deploymentActions": 0
  },
  "shutdown": {
    "loopbackListenerCount": 0,
    "nonLoopbackListenerCount": 0,
    "taskProcessCount": 0,
    "retention": "retained_0700|not_created"
  },
  "redaction": {
    "sourceRootAliasOnly": true,
    "tempRootAliasOnly": true,
    "localUserAliasOnly": true,
    "sensitiveIdentifierCount": 0
  },
  "unverified": []
}
```

BLOCKED 或未运行时，HTTP 数字字段按 manifest 的 nullable 规则设为 `null`，禁止伪造 200/PASS。收据不含绝对路径、账号、网络地址、进程命令全文、fixture 正文或任何唯一设备标识。

## 7. 已验证与未验证

已验证（本文编制阶段的只读证据）：

- v0.4 当前 SHA-256 与 ACK 值一致；
- 候选的 11 源码聚合、DB、BUILD_ID、build manifest 与 middleware manifest 固定值来自开发/测试已落盘收据；
- 本工作区只读复算得到 Node、lock、DB、build 单文件 hash 及三个树根；
- 候选启动合同固定 127.0.0.1:3000/3001、public-multimedia-synthetic、fixture/mock/manual_only 和真实 I/O false。

未验证：

- 47EF67 的最终 PASS/ACK 及其 no-egress wrapper/receipt；
- 固定 M1 Mac 上的实际 iCloud 来源根、Node/build/node_modules/DB 字节与闭集复制；
- 实际启动、健康、同机浏览、no-egress、停止和零残留收据；
- 任何网络、远程、FileVault、RPO/RTO 和生产能力。

## 8. 当前结论

v0.5 已把用户授权压缩为一次固定 M1 Mac 的 TEMP-LOCAL 本机预览，并固定候选、复制闭集、单一确认、启动输入、健康出口、停止门和收据。当前执行仍由 47EF67 最终 PASS/ACK 阻断；该门满足后也只能在目标 Mac 完成 Stage 0 只读计划和一次用户确认后运行。
