---
title: F1+1 固定 M1 Mac TEMP-LOCAL 执行交接提示词 v0.5
type: codex_deepseek_execution_handoff_prompt
status: conditionally_executable
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-9ACCE0
runbook: docs/runbooks/F1+1-固定M1-Mac-TEMP-LOCAL精确执行runbook-v0.5.md
external_side_effects_at_creation: 0
---

# F1+1 固定 M1 Mac TEMP-LOCAL 执行交接提示词 v0.5

将以下整段复制给固定 Mac 上的 Codex 或 DeepSeek。该 Agent 必须先做只读计划，只在所有门通过并获得一次精确用户确认后执行。

```text
<F1PLUS1-TEMP-LOCAL-V05-START>

你是 F1+1 固定 M1 Mac 的 TEMP-LOCAL 执行 Agent。你必须完整读取用户提供的 v0.5 runbook 与 closed manifest，按 readOrder 执行，不得从项目父目录、聊天记忆或网络补全语义。

任务：TASK-20260809-9ACCE0。
已授权上限：一次固定 MacBook Air（M1，2020）/8GB/macOS 26.5.1 上的 TEMP-LOCAL 本机预览，只有 127.0.0.1:3000/3001、synthetic/local SQLite、externalCalls=0 和同机浏览器。
当前网络事实只能记为 legacy_wpa_low_security，不读取或输出其名称和地址。

永久禁止：
- 读取、复制、转写、散列、编码或输出截图中的 Wi-Fi/路由器地址、SSID、密码、MAC、IP、序列号、磁盘标识、设备 ID、Apple Account、overlay ID、token 或密钥；
- 安装、下载、npm install/ci、lifecycle script、Git pull/checkout/reset、登录或创建账号；
- 启用、检查或修改 UU、SSH/Remote Login、FileVault、Tailscale、Firewall、Sharing、路由器、Wi-Fi 或端口转发；
- LAN、overlay、公网监听，任何 DNS/非 loopback HTTP/raw socket/代理外联；
- 真实 provider/Base/账号/密钥/数据/媒体/表单/发布/备份/上传/部署；
- 修改 iCloud 来源、候选、v0.4、app/data/design/spec/ADR 或历史报告。

隐私规则：绝对来源路径、当前账号和用户目录实值只能留在本机进程内。对话、命令预览和收据使用 <SOURCE_ROOT>、<TEMP_ROOT>、<LOCAL_USER> 别名。不读截图，不查询系统网络地址、SSID、MAC 或 IP。

第一段：只读预检，严禁写入和启动
1. 只读解析用户指定的 iCloud 项目根，对外只称 <SOURCE_ROOT>。只检查 manifest 闭集，不遍历用户其他文件。
2. 验证 v0.5 manifest JSON 闭集、v0.5 runbook/prompt hash、v0.4 hash，然后复算所有 candidatePins、treeRoots 和 orderedSourceFilesAggregate。
3. 只读检查 TASK-20260809-47EF67。只有 execution_state=completed、结论 PASS/P0=0/P1=0、报告已统筹 ACK 且 candidate hash 全部相同才通过。当前任何 claimed/pending/FAIL/BLOCKED/Unknown 均输出 BLOCKED_47EF67 并停止，不问执行问题。
4. 只读检查 `/private/tmp/f1plus1-temp-local-9acce0` 必须不存在，127.0.0.1:3000/3001 无监听。不停止现有进程，不自选其他端口。
5. 确认 Node 二进制、package-lock、node_modules、build、DB、fixture 和 no-egress wrapper 全部存在；缺失时输出 RUNTIME_INPUT_MISSING，禁止联网补齐。
6. 仅在全部通过后，依照 runbook Stage 2–5 生成一份完整命令预览。命令中的实路径对用户仍使用别名，但内部执行对象必须是已回读的唯一实路径。

第二段：只问一个问题
必须逐字输出：
“已完成只读计划：47EF67=PASS/ACK，候选五个主 hash 与 v0.5 manifest 全部匹配，来源别名为 <SOURCE_ROOT>，目标为 /private/tmp/f1plus1-temp-local-9acce0，只使用 127.0.0.1:3000/3001、synthetic DB 与同机浏览器，externalCalls=0；未授权安装、网络变更、UU/SSH/FileVault/Tailscale/Firewall、真实账号/数据、外联或部署；停止后默认保留 0700 临时目录待后续单独清理授权。是否批准严格按本命令预览执行一次 TASK-20260809-9ACCE0 TEMP-LOCAL？”
问完即停。没有明确肯定回答时不执行。回答修改任一固定输入时，丢弃当前计划并返回第一段只读预检。

第三段：获得单一确认后严格执行
1. umask 077，创建精确的 /private/tmp/f1plus1-temp-local-9acce0，回读 owner/0700/realpath；任一不符即停。
2. 从 <SOURCE_ROOT> 只读复制 manifest.copyClosedSet；排除所有 .bin、symlink、其他 .local、.env、WAL/SHM、receipt/log/screenshot、.git 与闭集外对象。
3. 启动前重算目标副本全部 hash/tree/count。任一漂移输出 CANDIDATE_IDENTITY_MISMATCH，不修补、不重建、不下载。
4. 使用 47EF67 PASS/ACK 的精确进程级 no-egress wrapper，使用 manifest 的唯一环境字段与 <TEMP_ROOT>/app/.local/toolchains/node-v24.18.0-darwin-arm64/bin/node，执行 `--experimental-strip-types <TEMP_ROOT>/app/scripts/serve.ts start`。不运行 npm。
5. 健康请求只能是 GET http://127.0.0.1:3000/api/health。需同时命中 HTTP 200/status=ready/scope=local-only/dataGate=accepted-public-multimedia-synthetic/externalCalls=0/Node24.18.0。
6. 只在健康门 PASS 后，按 47EF67 PASS/ACK 的脱敏同机浏览方式打开 http://127.0.0.1:3000/，只读预览 synthetic feed/detail，不用真实账号 profile，不打开外部链接。
7. 无论 PASS/FAIL，都按记录的 PID 有界停止。最终 127.0.0.1:3000/3001 listener=0、nonLoopbackListener=0、taskProcess=0；无法证明即 STOP_ZERO_NOT_PROVEN。
8. 默认保留 <TEMP_ROOT> 为 0700，不删除、不移动、不同步。清理必须是后续单独授权。
9. 输出 manifest.receiptSchema 定义的 additionalProperties=false 脱敏 JSON。任何绝对用户路径、账号、SSID/MAC/IP、设备唯一标识、fixture 正文、密钥/token 不得进入收据。

标准回传：
TASK_ID: TASK-20260809-9ACCE0
MODE: TEMP-LOCAL
PLAN_ONLY: true|false
USER_CONFIRMATION: received|not_requested|not_received
GATE_47EF67: PASS_ACK|BLOCKED|FAIL|UNVERIFIED
CANDIDATE_HASHES: exact_match|mismatch|unverified
COPY_CLOSED_SET: exact_match|not_created|mismatch
BIND_HOST: 127.0.0.1|NONE
HEALTH: ready|not_ready|NOT_RUN
SAME_MAC_BROWSER: used|NOT_RUN
EXTERNAL_CALLS: 0|FAIL|UNVERIFIED
REAL_ACCOUNTS_READ: 0
REAL_DATA_READ: 0
NETWORK_CHANGES: 0
SERVICES_CONFIGURED: 0
DEPLOYMENT_ACTIONS: 0
EXIT_LOOPBACK_LISTENERS: 0|FAIL|NOT_RUN
EXIT_NON_LOOPBACK_LISTENERS: 0|FAIL|NOT_RUN
EXIT_TASK_PROCESSES: 0|FAIL|NOT_RUN
TEMP_ROOT_RETENTION: retained_0700|not_created
RESULT: PASS|FAIL|BLOCKED
REASON_CODE: OK|<closed reasonCode>
RECEIPT_SHA256: <64hex|NOT_CREATED>
UNVERIFIED: <closed list>

<F1PLUS1-TEMP-LOCAL-V05-END>
```

此提示词本身不授权当前文档任务执行命令。目标 Agent 在 47EF67 尚未 PASS/ACK 时的唯一合法结果是 `BLOCKED_47EF67`。
