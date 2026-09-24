# F1+1 接续指南

> 整理日期：2026-09-24。本文件只说明如何接续和到哪里取材料。**最新运行状态、故障与优先级统一看[当前生产状态与执行待办](当前生产状态与执行待办.md)**；不要把本指南中的部署身份当作永久有效的执行授权。旧文档原文见[归档索引](archive/2026-09-24-project-handoff/README.md)。

## 新窗口先读

1. `AGENTS.md` → `docs/agent-guide.md`，然后读 `docs/spec.md` 顶部已确认决策；涉及某一功能时再定向读取相关合同和矩阵。
2. [当前生产状态与执行待办](当前生产状态与执行待办.md) → 本文件 → [当前工作分工](collaboration/当前工作分工与交接.md)及 [D1BAB4任务原件](collaboration/tasks/TASK-20260913-D1BAB4.json)。
3. `git status --short`，保留长期未提交修改。按当前优先级先做小范围只读刷新，不创建新一套演练、不跑历史脚本、不自动重做全量测试。
4. 原始证据按需读；通常无需读取453KB历史原文。`scratch/`中材料未纳入普通Git追踪，**本交接适用于当前完整工作区**；若换设备或新clone，须显式携带所需材料与manifest，不能假设仅拉Git就齐全。

可直接给新窗口的接续提示：

> 继续 F1+1。先读 docs/agent-guide.md、docs/spec.md 顶部确认事项、docs/当前生产状态与执行待办.md 和 docs/handoff.md，复用 TASK-20260913-D1BAB4。先刷新当前备份遗留锁、恢复点和RSS失败状态，再接续已验证readback的应用恢复、M1独立iCloud运行及X三源正式发布。已有授权不重复询问；不要重放已消费入口、重建已清sealed或混合提交脏树。每一步按真实证据验收并及时清理本次临时大文件。

## 环境、入口与运行身份

| 项目 | 值及使用方式 |
|---|---|
| 本地工作区 / 分支 | `/Users/hoyin/Documents/F1+1`；归档时 `codex/first-public-release`，HEAD `3a8fe968b13cabcdb832c1617e88469244d7591c` |
| M1连接与目录 | SSH alias `home-mac`；用户 `chanai`、UID501；仓库 `/Users/chanai/F1-1-website`。连接地址会变，先验证alias可达，不硬编码LAN地址 |
| 公开站 | https://1404369477-blip.github.io/f1plus1/ |
| Admin日常入口 | https://chanaimacbook-air.tail3bb60c.ts.net/admin/ops ，需私有网络和真实认证；用户已确认维护UI方向 |
| M1 Node | `/Users/chanai/.local/node-v24.18.0-darwin-arm64/bin/node`；v24.18.0，SHA `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a` |
| Python | M1 `/usr/bin/python3` 3.9.6；本地默认Python可能不同，实机候选检查3.9兼容 |
| 业务数据库 | `/Users/chanai/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite`；保持当前数据，不用旧演练库覆盖 |
| 现役业务版本 | `/Users/chanai/F1-1-website/releases/candidate-v10-20260922-rss-cache-v1/app`；部署hash及schema以主状态/只读回件为准 |
| 原备份调度 | `gui/501/com.f1plus1.backup-snapshot`，plist位于 `/Users/chanai/Library/LaunchAgents/com.f1plus1.backup-snapshot.plist` |
| 原备份工具 / runtime | `backup-runtime-releases/20260914-register-budget-r1/tools` + `backup-runtime-releases/20260921-register-stream-r1/runtime`；root SHA `d94176eba02ffe540818ec8f60d999380beb7653fcba5bf45b8584084ba30c78` |
| 原备份plist摘要 | `7facc565630382da2bf2b96200958323d271a602fd0cd6556d5020de1d999f10`；4参数、StartInterval30、RunAtLoad=false；执行前重读 |
| 备份状态目录 | `/Users/chanai/Library/Application Support/F1Plus1/Backup`，重点 `last-cycle.json`、`last-snapshot.json`、`last-register.json`、`last-application-drill.json`和日志 |
| RSS采集日志 | `/Users/chanai/F1-1-website/.ac5cc2/logs/rss-collector.stdout.log`；LaunchAgent `com.f1plus1.rss-collector` |
| M5旧observer | `/Users/hoyin/Library/Application Support/F1Plus1/BackupObserver/releases/20260923-transfer-budget-r2`；尚未完成退场；不能在M1独立备份验收前停它 |

环境描述不代替当前文件身份、运行进程及签名验证。归档前的只读脚本曾假设 `Public/deployment.json` 并失败，原失败保留；后继将该路径明确记为未查，**不能据此认为Public服务不存在**。

## 第一个执行切片：当前遗留锁与RSS失败

主状态已记录21:51的新PID689锁和超龄RP。先重新检查是否仍是同一锁，再捕获完整inode/dev/hash、调度参数、原生进程缺席和可用空间；不得使用08:57的PID41530/inode48190212执行参数。

- 正式恢复入口代码参考：M1 `releases/candidate-v10-20260912-rss-v6/app/scripts/backup-lock-recover.ts`及对应`src/server/backup-snapshot/lock-recovery.ts`。只允许按当前现场材料形成新的独立受审调用。
- 既有恢复控制逻辑参考：[9月24实现原件](../scratch/m1-space-cleanup-20260924/recover-and-clean-fixed.py)。**仅供阅读，已消费，不能执行。** 保持自然idle、停写证据、原锁隔离、finally恢复原调度及失败留档。
- 复核`last-register`的原RP时间、当前时刻、签名及正式登记；只启动调度、快照成功或静态`writerReady=true`均不足以称恢复。
- 当前RSS有`SQLITE_FAILURE`，先看准确失败阶段、采集/处理日志与恢复门，不直接推断数据库损坏或盲重启。备份故障与RSS错误因果尚未查明。
- 排查反复异常退出导致的锁/暂存遗留，复用现有snapshot supervisor候选，不通过扩大预算或降低保留/验证标准掩盖问题。

## 第二个切片：只使用现存readback完成应用恢复

M1包目录：

```text
/Users/chanai/F1-1-website/backups/icloud-readiness-canary-20260923-r4/work/dates/2026/09/23/1790176881821_528531270a64230a
```

保留的两个必要输入：

| 相对路径 | 字节数 | SHA-256（已在00:26全量读、08:53清理后复核；执行前再核） |
|---|---:|---|
| `readback/packages/1790176881821_528531270a64230a/manifest.json` | 139443 | `fa177cc80de26f10441ff954a6c46cca238299429b19edafc3a8f76bdb63f022` |
| `readback/objects/db-projection-snapshot.528531270a64230a1f0cd556649dbe24c194dc763b3ae85d3ef6042426dccb9a.e2f2c6fc36e07951` | 2390005072 | `45f967f66e5b4558c973fe094afc3738f00fce5840ca117df4c6ae4ba2d4e3a0` |

21:51只核了密文存在及大小，未再读2.39GB。原RP为 **2026-09-23T15:21:21.821Z**，历史包永远不能补登记为新鲜恢复点。`readback/latest.json`及原journal/manifest/失败记录保持；**sealed密文已按清单删除**。

参考原[历史应用恢复入口](../scratch/backup-icloud-successor-20260922/historical-drill-actual-r2/remote.py)和[canary接续说明](../scratch/backup-icloud-successor-20260922/installation/upload-r4/canary/README.md)，准备新的、绑定当前部署与现存readback的应用恢复调用。旧historical入口绑定另一个已清理包，不可重放。只在M1由既有工具使用密钥，不导出私钥/会话/Cookie。

成功出口包括数据库/投影一致、Admin/Public可启动、未授权访问被拒绝、签名收据、子进程退出，以及必要大文件清理。真实通行密钥另验。先验证磁盘可覆盖本次峰值及自然备份并行余量；应用恢复与审查完成后释放`restored`/`boot`/`readback`大文件并留小收据，不再复制整套sealed。

## 后续候选与依赖材料

| 材料 | 当前范围 / 接续要求 |
|---|---|
| [iCloud r4运行包](../scratch/backup-icloud-successor-20260922/upload-r4/README.md) | M1已暂存`backup-runtime-releases/20260923-icloud-provider-r4`；800叶；runtime root `bf88451a62f23a72395979baed384ba77739cbaa6bff646ab917f8e206a80a6a`；manifest raw SHA `432c5fd9c46b5e7185cdee131a4684a580af30eff66c5ebcf1c41023a6ef333c`。未正式启用，不重复stage |
| 当前production trust | `/Users/chanai/Library/Application Support/F1Plus1/Backup/icloud-provider-trust.json`；r3 SHA `f311c7b340e46a67e3a7e152132d309acebbbec949c12306d5f17c7c4f5d0031`，不是r4。原index非空，包含旧失败包 |
| [同key trust后继草案](../scratch/x-maintenance-integration-20260922/icloud-trust-r4/) | 未冻结/未完成独审；要保留非空index与原失败，不重用只允许空genesis的旧promoter，不重签历史超龄包 |
| [X安装r4](../scratch/x-maintenance-integration-20260922/installation-r4/README.md)与[材料接口](../scratch/x-maintenance-integration-20260922/installation-r4/interfaces-r1/README.md) | 本地26例安装/SQLite及9例接口有独审。恢复服务后不再要求正常公开代次静止；完整门仍在停写阶段验证。最终provider descriptor和真实安装plan未形成 |
| [0017外层材料](../scratch/x-maintenance-integration-20260922/migration-r2/outer-r2/) | 本地候选有独审，仍绑定旧provider/trust，plan/root/state/resume部分未绑定；生产不可执行。须绑定最终环境与当前完整数据库，不回灌旧尾部 |
| X已暂存APP | `/Users/chanai/F1-1-website/releases/candidate-v10-20260922-x-maintenance-v1/app`，未正式安装。真实维护认证、0017、三源新捕获签名/准入/发布均待 |
| X初始来源 | `F1`、`McLarenF1`、`ChrisMedlandF1`；先三源端到端，再扩展27源。旧9帖只读记录不能追签为新生产证据 |

先用当前平台实际可用工具核M1登录浏览器；遵守相应browser/Chrome技能。保留用户选择的M1采集和现有GLM/API key路线，不擅自改M5采集、不提取Cookie、不给旧native记录补签。

## 不能重放的操作

- RSS generation407/408的限定恢复及POST已经消费；未知投递按原语义处理，不盲重发、不修改旧账本。
- 原`run-byte-fixed.py`、`run-resume-fixed.py`及`resume-001`已执行；已清理sealed，不再执行`prepare_provider_package`重建。
- 旧canary及旧historical-drill固定入口绑定已释放文件；旧成功/失败保留为历史，不能重建成“新鲜”证明。
- 9月24`cleanup-fixed.py`和`recover-and-clean-fixed.py`已执行；旧PID41530锁已在`lock-incident-ww8oNv`，新PID689须新现场材料。
- iCloud既有stage/activation/rollback一次性入口均按原记录处理，r4 stage已消费；X installation-r2已经cancel-before，不能当作待继续安装。
- 不用旧数据库覆盖当前库，不手写控制表、fence或任务JSON，不停掉M5来假装M1独立成功，不修改原冻结脚本/收据以让检查通过。

## 证据按需读取

| 用途 | 入口 |
|---|---|
| 最新只读现场 | [21:51回件](archive/2026-09-24-project-handoff/evidence/current-observation-r2/stdout.json) |
| 原文及小证据副本 | [归档索引](archive/2026-09-24-project-handoff/README.md)，manifest可复算；失败取证也保留 |
| 清理、旧锁恢复实机独审 | [actual-review.json](../scratch/m1-space-cleanup-20260924/review/actual-review.json) |
| 云端字节实机独审 | [byte-actual-review.json](../scratch/pro-analysis-20260923/canary-review/byte-actual-review.json)；对应`cloud-complete-observation-r1/`保存46原件与2.39GB流式校验证据 |
| RSS历史成功、新内容自然闭环 | [执行记录](../scratch/rss-resume-20260921/STATUS.md)；`scratch/backup-icloud-audit-20260922/rss-natural-20260923-r5/` |
| iCloud旧部署/回退/失败线索 | [REPORT.md](../scratch/backup-icloud-audit-20260922/REPORT.md)；不把标题中的“当前”当最新运行态 |
| 本轮授权与UI确认 | [9月22日实施合同](reviews/2026-09-22-M1-iCloud备份与X正式接入实施合同.md) |
| 全站未完成范围 | [初版全功能追踪矩阵](spec/F1+1-初版全功能追踪矩阵-v0.1.md)，本归档不改其状态 |

`run-remote-evidence.py`只是传输/取证包装器：外层退出0不等于远端成功，必须看其`result.json.exitCode/timedOut`及实际stdout。涉及生产写入的入口必须独审通过、绑定新现场且仍在授权范围内；只读观察按实际需要直接进行，不按目录名或README示例盲跑历史写入命令。

## 工作区及任务交接

主任务仍claimed，旧窗口拥有者和任务列表见[协作入口](collaboration/当前工作分工与交接.md)。新窗口先确认无旧主控正在做生产写入，再通过正式任务工具接管或接续；子Agent句柄不会自动转移到新窗口。

本轮只归档/整理文档和只读核查。没有新的业务部署、生产清理、外发、PR或任务完成状态；未混合提交已有265项脏修改。原文已按字节保存，必要证据和现役备份保持。
