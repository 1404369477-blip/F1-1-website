---
title: F1+1 专用 Admin MacBook 服务器预配置手册 v0.1
type: planning_runbook
status: planning_only
date: 2026-08-09
department: 产品部
task_id: TASK-20260809-8A0B98
decision_receipt: DEC-20260809T181921-EC703A
implementation_authorized: false
production_deployment: unauthorized
---

# F1+1 专用 Admin MacBook 服务器预配置手册 v0.1

## 0. 先看这一页

本手册用于提前准备一台专用 Admin MacBook。当前只允许整理参数、责任人、清单、标签、表格与验收模板；不得据此安装软件、登录账号、购买服务、生成密钥、调整真实 Mac、路由器、防火墙、端口、备份目标或部署应用。

### 已确定的系统边界

用户已通过 `DEC-20260809T181921-EC703A` 确认继续采用双主机。本手册逐项继承 [Admin 双主机实施合同 v0.2](../spec/F1+1-M5-Admin双主机实施合同-v0.2.md) 与 [Admin 专用 MacBook 补充实施合同 v0.2](../spec/F1+1-M5-Admin专用MacBook补充实施合同-v0.2.md)：

```text
专用 Admin MacBook
  - 后台 UI/API
  - 采集与处理
  - 唯一可写 SQLite 主库（writer=1）
  - 审核、人工发布控制与备份调度
  - 仅私有 Admin 入口，无公网 Admin
             |
             | 单向签名的只读公开投影
             v
独立 public-host
  - 公网只读网站
  - 无 Admin mutation、无主库、无备份解密材料、无签名私钥
```

下列硬门不得弱化：

- Admin MacBook 为专用机，不承载日常个人工作、个人 iCloud/同步、个人浏览器资料或个人开发环境。
- Admin 与 public-host 始终独立；禁止同机合并、共享主目录、共享主库、双向同步或让 public-host 提升为写主。
- Admin 公网入口始终为 0；允许范围只有一个后继 manifest 精确批准的私有 Admin origin，以及可选的单个 loopback 维护 listener。
- 任一时刻 `writer_count=1`；无法证明时先关 mutation，并 fence 所有候选写主。
- Mac 与 iPhone 的 Admin 功能等价；可调整布局和交互层级，不得删减功能、恢复动作或审计收据。
- 恢复目标为 `RPO≤15m`、`RTO≤4h`；活跃 SQLite 主文件或活跃 `DB/WAL/SHM` 文件族不得直接复制后宣称为有效备份。

### 四种状态怎么用

| 状态 | 含义 | 当前允许的动作 |
| --- | --- | --- |
| `PREP｜现在可准备` | 纯纸面/本地文档准备，不改变真实系统 | 填参数表、选责任人、准备资产标签、列采购需求、设计验收表；不得购买或配置 |
| `DECIDE｜需用户决策` | 选择会改变成本、地点、服务、密钥或运维责任 | 用户逐项确认后写入唯一 production manifest；尚未确认时保持 Unknown |
| `AUTH｜需真实实施授权` | 会改变设备、账号、网络、密钥、服务或外部资源 | 必须绑定不可变 manifest/hash、精确设备身份、实施窗口和回退方案，另获用户批准 |
| `VERIFY｜实施后验收` | 只在真实实施完成后执行 | 由开发、安全、测试或运营在同一候选上取得回读、故障与恢复收据 |

任何条目从 `PREP` 进入 `AUTH` 前，都必须先关闭其 `DECIDE` 项。某项尚未决定或无法证明时，禁止用默认值填充。

## 1. 用户先准备的参数表

现在可以复制本表并填写；填写不会构成购买、安装或部署授权。

| 参数 ID | 需用户提供的精确值 | 当前状态 | 为什么需要 |
| --- | --- | --- | --- |
| `U-DEVICE-01` | MacBook 型号、年份、Apple silicon、内存、SSD 容量、资产编号；尚未购买时填候选范围 | `DECIDE` | 决定支持的 macOS、磁盘余量、散热与恢复替代性 |
| `U-SITE-02` | 家中或办公室二选一、具体房间、物理访问人员、被盗/进水/断电风险 | `DECIDE` | 固定主机故障域和物理责任 |
| `U-POWER-03` | 常用电源、是否配 UPS、期望断电支撑时间、合盖或开盖放置 | `DECIDE` | 影响常开、维护与恢复策略 |
| `U-OPS-04` | 具名运营人员名单及联系方式；每人是否需要管理员权限 | `DECIDE` | 固定最小账号、告警和审计归属 |
| `U-KEY-05` | FileVault 恢复材料和备份解密材料的托管责任人、离机位置、双人恢复要求 | `DECIDE` | 避免主机丢失时同时失去恢复能力 |
| `U-NET-06` | 宽带运营商、路由器型号、是否 CGNAT、是否有以太网、备用网络 | `PREP`；仅记录事实 | 为后继私有 overlay 实测设计输入；不改端口或 UPnP |
| `U-OVERLAY-07` | 私有 overlay 路线、账号/付款主体、身份提供方、设备准入、预算上限、日志地域/保留 | `DECIDE` | 供应商尚未选择；连通性不能替代应用认证与五分钟 freshness 门 |
| `U-BACKUP-08` | 异机备份目标、地域、故障域、预算、保留周期、删除与退出要求 | `DECIDE` | 证明 `RPO≤15m` 并避免同机同失 |
| `U-RECOVERY-09` | 替代恢复 Mac 的来源、位置、预计取得时长、负责人 | `DECIDE` | `RTO≤4h` 必须从设备不可用时开始计时 |
| `U-MAINT-10` | 更新/重启维护窗口、允许的最长只读/停写时间、告警渠道 | `DECIDE` | 更新不得形成第二写主或超龄恢复点 |
| `U-PUBLIC-11` | public-host 资源、地域、运营责任、域名/TLS 责任人 | `DECIDE`；保持独立 | 用于公开只读投影恢复；不得合并到 Admin MacBook |

## 2. 分阶段预配置总表

### Phase A：硬件、地点与专用化

| ID | 项目 | `PREP｜现在可准备` | `DECIDE｜需用户决策` | `AUTH｜需真实实施授权` | `VERIFY｜实施后验收` | Owner | 失败关闭与恢复 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `A-01` | 设备资产 | 建立候选参数表、资产标签模板、保修与替代机需求 | 精确型号/容量/资产归属 | 购买、开箱、抹盘、重装 | 序列资产引用、硬件诊断、磁盘容量与设备 hash | 用户/统筹 | 型号或资产不明：设备不得进入候选；换设备需新 manifest |
| `A-02` | 专用机边界 | 列允许软件类别：macOS、私有入口客户端、项目 runtime、监控/备份；列个人软件禁区 | 允许软件/进程签名 allowlist 的审批人 | 清空个人数据、删除个人 profile/同步/开发环境、安装允许软件 | 个人 iCloud/同步/浏览器资料/个人开发工具=0；未知进程=0；allowlist hash | 用户/安全 | 未知个人进程或同步：关闭全部远程 Admin、停服务、保全审计，必要时轮换凭据并干净重建 |
| `A-03` | 放置与物理安全 | 画出电源、网线、通风、液体/儿童/访客风险图 | 家中/办公室具体位置、可接触人员 | 实际放置、线缆固定、柜体或防盗措施 | 现场照片/资产记录、温度与物理访问清单 | 用户/运营 | 无法证明物理边界：保持未部署；迁移地点需重新评估故障域 |
| `A-04` | 电源与散热 | 记录充电器功率、UPS 候选规格、断电支撑目标、合盖风险 | UPS/备用电源与开盖/合盖策略 | 连接 UPS、改电源设置、布置散热 | 断电/来电、温度、合盖、充电器拔插收据 | 用户/运营/测试 | 意外睡眠或过热：关远程 Admin 和 mutation，恢复供电/散热后过完整 readiness |

### Phase B：macOS、账号与磁盘保护

| ID | 项目 | `PREP｜现在可准备` | `DECIDE｜需用户决策` | `AUTH｜需真实实施授权` | `VERIFY｜实施后验收` | Owner | 失败关闭与恢复 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `B-01` | macOS 版本 | 记录项目支持目标、补丁策略、beta 禁止项、回退前置 | 精确 macOS/补丁版本与维护窗口 | 更新、重启、关闭 beta、改自动更新设置 | OS build、补丁日期、重启后完整门禁；更新前后 app/data hash | 开发/安全/测试 | 版本不在 manifest 或更新失败：服务保持关闭，回退到已验证系统镜像或重新冻结版本 |
| `B-02` | 运营账号 | 设计最少具名账号表与角色；禁止共享账号 | 账号人数、每人 admin/standard 权限、恢复责任 | 创建/删除/提权账号、配置登录密码或 passkey | 账号清单 hash、权限回读、离职/丢机撤权演练 | 用户/安全 | 未知账号或未受信任管理员：部署关闭；清理并轮换相关凭据后复验 |
| `B-03` | 服务账号 | 冻结要求：独立、非交互、无 admin/sudo、不得日常登录 | 服务账号名称和 UID 分配规则 | 创建账号、目录、进程身份；具体命令须按目标 macOS 官方本机文档复核 | 账号不可交互登录、无 sudo/admin、进程 UID 与目录 owner 一致 | 开发/安全 | 服务以运营/admin/root 身份运行：停服务、撤权、修正 owner 并轮换可能暴露的 secret |
| `B-04` | 自动登录与屏幕锁 | 记录必须值：automatic login disabled；设计锁屏超时和唤醒再认证 | 锁屏超时、现场维护例外 | 关闭自动登录、设置锁屏/唤醒认证 | 重启出现登录窗口；睡眠/锁屏后需认证；设置回读 | 安全/测试 | 自动登录或锁屏失效：关闭全部远程 Admin，修复并做重启/唤醒复验 |
| `B-05` | FileVault | 选择恢复材料托管模型模板；文档只保存托管引用，禁止保存密钥值 | 恢复 key 或机构托管方式、离机位置、双人流程 | 开启 FileVault、生成/托管恢复材料 | `enabled_verified`、重启解锁、恢复演练、仓库中无密钥值 | 用户/安全 | FileVault 状态 unknown/关闭：关闭全部远程 Admin；恢复材料丢失时不得继续部署 |

Apple 官方说明：FileVault 开启后需要登录密码才能访问数据，并要求恢复 key 存放在加密启动盘之外；启用 FileVault 会关闭自动登录。上述事实只支持规划，实际按钮、恢复方式和用户解锁范围必须按目标 OS 现场复核。

### Phase C：共享服务、私有入口与本机网络

| ID | 项目 | `PREP｜现在可准备` | `DECIDE｜需用户决策` | `AUTH｜需真实实施授权` | `VERIFY｜实施后验收` | Owner | 失败关闭与恢复 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `C-01` | macOS 共享服务 | 准备默认关闭清单：File Sharing、Media Sharing、Printer Sharing、Internet Sharing、Bluetooth Sharing、Remote Login、Screen Sharing、Remote Management、Remote Application Scripting、Content Caching | 是否保留一个受控本地维护入口；默认无 | 改 Sharing 设置 | 每项回读；未批准共享服务=0；维护入口身份/来源/日志符合 manifest | 安全/测试 | 出现未知共享服务：关闭全部远程 Admin，先关闭服务再查原因 |
| `C-02` | 防火墙 | 固定目标：macOS Firewall 开启；只允许 manifest 精确服务；共享服务关闭优先于仅靠 firewall 放行 | 精确私有 Admin listener 与可选 loopback listener | 开启/修改 firewall、应用例外 | firewall 状态、入站 allowlist、拒绝矩阵 | 安全/测试 | 任意额外入站：隔离主机、撤销临时入口，恢复到精确 allowlist |
| `C-03` | 无公网 Admin | 准备路由器核对表：端口转发=0、UPnP 映射=0、公网隧道=0、隐藏 URL 不算隔离 | 路由器 owner 与检查窗口 | 登录路由器、关闭 UPnP/删除映射、改 ACL | `publicly_reachable_admin_listener_count=0`；外部网络负例；public-host GET 单独通过 | 用户/安全/测试 | 公网 Admin 可达：立即隔离、撤销入口/会话/设备凭据，保全审计后复验 |
| `C-04` | 本机局域网 | 记录以太网口、路由器/DHCP、固定租约候选；不直接写死未经确认的地址 | 以太网优先、固定 DHCP lease、备用网络策略 | 插网线、改 DHCP/静态地址、改 DNS | 断线、换网、重启、地址漂移与回退收据 | 用户/运营 | 地址/网络 unknown：远程 Admin 关闭；禁止临时开放公网端口救援 |
| `C-05` | 私有 overlay | 使用研究报告三路线作候选；不选择供应商，不创建账号 | 路线、计划、身份、设备准入、Mac/iPhone 客户端、日志/地域/费用、五分钟签名 freshness producer | 注册、安装、登录、设备加入、ACL、密钥、真实网络探针 | Mac/iPhone 全 Function ID；直连/relay、切网、撤权、控制面故障、`issuedAt≤trusted_now<expiresAt` 且 TTL≤5m | 用户/产品/安全/测试 | freshness/时钟/策略/设备任一 unknown 或过期：关闭全部远程 Admin；不得用“还能连通”代替授权新鲜度 |

Apple 官方说明 macOS 的 Sharing 设置可分别开启 Remote Login、Screen Sharing、Internet Sharing 等服务；Firewall 只能限制入站连接，已经开启的 Sharing 服务仍应逐项关闭。私有 overlay 的供应商、计划和配置目前都未选择。

### Phase D：常开、睡眠与更新维护

| ID | 项目 | `PREP｜现在可准备` | `DECIDE｜需用户决策` | `AUTH｜需真实实施授权` | `VERIFY｜实施后验收` | Owner | 失败关闭与恢复 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `D-01` | 睡眠策略 | 记录目标：接电服务期阻止自动睡眠；显示器关闭可独立；Power Nap 不能等同服务常开 | 合盖/开盖、夜间、断电、电池低电量策略 | 改 Battery/Lock Screen 能源设置 | 空闲、显示器关闭、合盖、拔电、来电、重启后的 readiness | 用户/测试 | 睡眠或唤醒异常：停 mutation，恢复电源/唤醒后重新过全部门禁 |
| `D-02` | 更新策略 | 准备更新前检查表：停止新 mutation、对账 operation、形成并回读 `<15m` 恢复点、记录旧版本 | 自动下载/安全更新/大版本维护窗口 | 改更新设置、执行更新/重启 | 更新前后 OS/app/DB schema、writer=1、私有入口与双端回验 | 开发/安全/测试 | 更新失败或门禁漂移：保持服务关闭，从已验证系统/数据恢复 |
| `D-03` | launchd 启动 | 设计一个服务单元、一个 worker 策略、依赖顺序和失败次数上限；不写目标机命令 | 服务启动方式、维护人员、重启策略 | 写 plist、加载服务、配置进程环境 | 最小环境、精确 Node、UID、工作目录、stdout/stderr 脱敏、崩溃/重启/停机 | 开发/安全/测试 | 循环重启、环境污染或 root 运行：停服务，恢复 last-known-good plist/hash |

Apple 官方支持在电源适配器供电时阻止显示器关闭后的自动睡眠；后台进程也可能改变睡眠行为。真实 MacBook 的合盖行为、硬件差异与 OS 版本必须实机验证，手册不把 Power Nap 当作后台服务存活保证。

### Phase E：应用运行时、目录与唯一写主

| ID | 项目 | `PREP｜现在可准备` | `DECIDE｜需用户决策` | `AUTH｜需真实实施授权` | `VERIFY｜实施后验收` | Owner | 失败关闭与恢复 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `E-01` | Node runtime | 记录项目 accepted pin `Node 24.18.0`、来源/hash/安装方式候选；禁止自动追随 latest | 供应链来源、升级窗口 | 安装 Node/npm、修改 PATH、lock | version/hash、最小 env、typecheck/build/test、安全 deny-all | 开发/安全/测试 | 版本或 hash 漂移：服务不启动；回到精确 accepted pin |
| `E-02` | 目录布局 | 预先设计 `/service`、`/config`、`/data`、`/backup-staging`、`/logs` 的逻辑职责；实际绝对路径由 manifest 固定 | 磁盘位置、容量阈值、日志保留 | 创建目录、owner/mode、复制应用 | service UID 只读代码/config，主库与 secret 最小写；无 hardlink/symlink 越界 | 开发/安全 | owner/mode/path 不符：写前拒绝；修复权限并轮换可能暴露 secret |
| `E-03` | SQLite 文件族 | 列出主库、`-wal`、`-shm`、journal、checkpoint、backup snapshot；固定同一主库仅一个 writer | 精确路径、WAL/checkpoint、磁盘空间门 | 创建/迁移数据库、启动 writer | `writer_count=1`、旧主 fenced、integrity/schema/ledger、忙/满盘/断电故障 | 数据/开发/安全/测试 | writer>1 或身份 unknown：mutation=0，fence 所有候选主，确认唯一主后恢复 |
| `E-04` | Admin 双端 | 用矩阵列出 Mac/iPhone 每个 Admin Function ID、再认证、错误与恢复；当前只准备表 | 视觉与业务门禁、设备要求 | 实现/部署 Admin UI/API | 两端完整等价，逐 Function ID 真入口、失败、恢复和审计 | 产品/设计/开发/测试 | 任一端功能删减或占位：不得生产放行 |

当前 Node 24 官方文档页面显示 `node:sqlite` 为 release candidate，并提供 `sqlite.backup(sourceDb,path)`；项目仍固定已接受的 Node 24.18.0，后继实施不得因官方 latest 页面更新而自动升级。

### Phase F：一致备份、监控与恢复

| ID | 项目 | `PREP｜现在可准备` | `DECIDE｜需用户决策` | `AUTH｜需真实实施授权` | `VERIFY｜实施后验收` | Owner | 失败关闭与恢复 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `F-01` | 五分钟一致快照 | 冻结流程模板：每≤5m 用 SQLite Online Backup 生成封闭 snapshot，关闭后 quick/integrity check，计算 bytes hash | 超时、并发、完整检查周期 | 写调度/脚本并运行 | 连续周期、写入并发、满盘/中断、时间回拨；每点可复算 | 数据/开发/测试 | 失败不推进成功点；10m 预警，15m 或时钟不可信关高风险 mutation |
| `F-02` | manifest/hash | 准备字段模板：backupId、起止时刻、schema/app/sqlite 版本、source logical ID、bytes/hash、key version ref、target failure domain、previous backup、验证结果 | canonicalization、签名/密钥责任 | 生成签名 key、写 manifest/receipt | snapshot、manifest、signature、远端对象逐字匹配 | 数据/安全 | 任一 hash/字段/signature 失配：该点隔离，不计入 RPO |
| `F-03` | 异机加密备份 | 基于研究报告保留 restic/SFTP/S3/B2 等候选；只做比较表 | backend、地域、费用、账号、保留、Object Lock、删除/退出、key 托管 | 安装、注册、付费、创建仓库、上传 | 远端认证回读、下载/解密/hash/SQLite 检查、凭据撤销、合法删除 | 用户/产品/安全/测试 | 上传或回读失败：不推进恢复点；解密材料丢失：该仓库不可宣称可恢复 |
| `F-04` | Time Machine | 可列为系统重建辅助层 | 目标盘/NAS和加密 | 配置 Time Machine | 还原系统/应用文件抽查 | 用户/运营 | 默认小时频率不能满足 RPO≤15m；不得替代 F-01/F-03 |
| `F-05` | 监控与告警 | 准备指标与 reason code：电源/睡眠、磁盘、writer、backup age、hash、overlay freshness、public projection、服务状态 | 告警渠道、值班人、保留周期 | 接入监控/发送告警 | 注入每类失败，证明告警、关闭动作、恢复回读 | 运营/安全/测试 | 告警通道 unknown：相关高风险能力保持关闭 |
| `F-06` | 隔离恢复演练 | 准备从零 runbook 与计时表 | 替代 Mac、演练频率、恢复目标 | 下载真实备份、解密、恢复、启动 | `incident_declared_at` 到 Admin/公开链恢复≤4h；恢复点年龄≤15m；旧主 fenced、writer=1、Mac/iPhone与 public GET PASS | 全部门 | 任一步失败：维持 last-known-good public 只读，Admin mutation=0，修订后重演 |

SQLite 官方 Online Backup API 在完成时生成源数据库的一致 snapshot；Node 24 的 `node:sqlite backup()` 封装该 API。活动数据库主文件、WAL、SHM 的文件级复制不能替代该流程。Time Machine 默认小时级备份也不能单独证明 `RPO≤15m`。

## 3. 至少八类错误配置：关闭与恢复

| 错误配置/事件 | 如何发现 | 立即关闭动作 | 恢复条件与证明材料 |
| --- | --- | --- | --- |
| 公网可达 Admin listener、端口转发、UPnP 或公网隧道存在 | 外部网络负例、路由器映射与本机监听回读 | 隔离 Admin、关闭全部远程 Admin、撤销临时入口/会话，保全脱敏审计 | `publicly_reachable_admin_listener_count=0`；端口转发/UPnP/公网隧道均为 0；私有 origin 单独 PASS |
| `writer_count>1`、旧主仍可写或主身份 unknown | lease/fence/进程/DB 文件族收据 | 全部 mutation=0，fence 所有候选主 | 唯一主、旧主不可写、数据库完整性和幂等对账收据 |
| 个人 iCloud/同步、个人浏览器 profile、个人开发环境或未知进程出现 | 软件/进程/profile allowlist 扫描 | 关闭全部远程 Admin，停服务，保全审计；按潜在失陷处理 | 干净镜像、未知项=0；DB/secret 零暴露证明或 session/overlay/签名/备份凭据完整轮换 |
| 自动登录开启、FileVault 关闭/unknown 或恢复材料同机同失 | OS 设置与托管引用回读 | 关闭全部远程 Admin | 自动登录 disabled、FileVault enabled_verified、离机恢复材料与恢复演练收据 |
| 主机睡眠、合盖停机、过热、断电或更新重启未做维护门 | 电源/睡眠/温度/进程/health 监控 | 停新 mutation；public-host 保持 last-known-good | 电源/散热恢复、`<15m` 恢复点回读、重启后全部 readiness PASS |
| 备份点年龄≥15m、可信时钟 unknown、上传/远端回读失败 | trusted UTC + latest recoverable point | 关闭 revision/approve/reject/publish 和权限/设备变更 | 新恢复点经远端认证回读、hash/manifest/解密/SQLite 检查 PASS；时钟可信 |
| 直接复制活跃 DB/WAL/SHM 被当成备份 | 备份 manifest 缺 Online Backup 收据或文件族状态不一致 | 隔离并标记该点无效，不计入 RPO | 重新生成封闭 Online Backup snapshot，完成完整性、hash、manifest 和异机回读 |
| overlay 连通但 freshness 过期/未来签发/策略或设备状态 unknown | 签名 freshness receipt 与 trusted UTC | 关闭全部远程 Admin，禁止用连通性绕过 | `issuedAt≤now<expiresAt`、`0<expiresAt-issuedAt≤5m`、签名/策略/设备/session 全部有效 |

## 4. 实施窗口必须提交的证据包

真实实施得到另行授权后，每个窗口必须绑定同一不可变 production manifest/hash，并至少提交：

1. 设备与 OS：资产引用、OS build、补丁、FileVault、自动登录、账号/权限、专用软件/进程 allowlist。
2. 入口：本机 listener、Sharing、Firewall、路由器端口转发/UPnP、公网负例、私有 origin、Mac/iPhone 双端功能证据。
3. 唯一写主：主库/文件族身份、writer/fence、旧主不可写、SQLite integrity/schema/ledger。
4. 备份：每≤5m snapshot、manifest/hash/signature、异机认证回读、最新可恢复点年龄、10m/15m 失败动作。
5. 恢复：替代 Mac 隔离恢复、解密、完整性、启动、writer=1、双端 Admin 与 full public projection/public GET；RTO/RPO 计时。
6. 清理：临时账号、入口、密钥、staging、日志敏感字段和旧候选均按 manifest 收口。

证据包缺任一 mandatory 项时，状态保持 `pending_implementation`，不得写成部署完成。

## 5. 当前允许交付给谁

- 用户：填写第 1 节参数；审阅硬门和责任人；不执行真实配置。
- 产品部：维护参数、状态和唯一 production manifest 决策包。
- 开发部：在另行授权前只读本手册；可以设计 synthetic probe/fixture，不接触真实设备。
- 安全部/测试部：在另行授权前只做合同与 synthetic/fixture 审查；真实设备安全/故障注入必须等待精确设备 hash、manifest/hash 和实施窗口授权。
- 运营：提前准备联系方式、维护时段和纸面恢复演练；不得登录、安装、注册、付费或上传。

## 6. 官方证据与证据边界

访问日期均为 2026-08-09；只引用官方一手页面或已核收研究报告。页面说明的是产品能力，无法替代本项目实机验收。

| 主题 | 官方来源 | 本手册采用的事实 | 仍待验证 |
| --- | --- | --- | --- |
| FileVault | [Apple：Protect data on your Mac with FileVault](https://support.apple.com/en-euro/guide/mac-help/mh11785/mac)、[FileVault recovery options](https://support.apple.com/en-mide/guide/mac-help/mh35881/mac) | FileVault 保护启动盘；恢复 key 应离开加密启动盘并妥善保管 | 目标 OS 的实际启用、用户解锁范围和恢复演练 |
| 自动登录 | [Apple：If you don’t see a login window](https://support.apple.com/en-mide/guide/mac-help/mchlp1158/26/mac/26) | FileVault 开启时自动登录被禁用；多用户应使用独立账号 | 实际设置与重启回读 |
| 睡眠 | [Apple：Set sleep and wake settings](https://support.apple.com/en-ie/guide/mac-help/mchle41a6ccd/mac)、[If your Mac sleeps or wakes unexpectedly](https://support.apple.com/en-gb/guide/mac-help/mchlp2995/mac) | 接电时可以阻止显示器关闭后的自动睡眠；后台进程也会影响睡眠 | 目标 MacBook 合盖、断电、重启和长期运行行为 |
| Sharing | [Apple：Change Sharing settings](https://support.apple.com/guide/mac-help/change-sharing-settings-mchl26e04309/mac) | Remote Login、Screen Sharing、Internet Sharing 等为独立可开关服务 | 目标 OS 清单与精确回读 |
| Firewall | [Apple：Change Firewall settings](https://support.apple.com/en-gb/guide/mac-help/-mh11783/mac) | Firewall 用于阻止不需要的互联网或其他网络入站；Sharing 服务还需单独关闭 | 私有 origin 与本地例外规则 |
| 系统更新 | [Apple：Keep your Mac up to date](https://support.apple.com/guide/mac-help/keep-your-mac-up-to-date-mchlpx1065/mac)、[Background updates](https://support.apple.com/en-us/101591) | macOS/安全更新可自动下载或安装，部分更新需要重启 | 项目维护窗、回退和重启门禁 |
| Node SQLite | [Node.js v24 `node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) | `backup(sourceDb,path)` 封装 SQLite backup API；当前官方 v24 页面标注 release candidate | 项目固定 24.18.0 的真实运行、升级与供应链 |
| SQLite 一致快照 | [SQLite Online Backup API](https://www.sqlite.org/backup.html) | 完成的 Online Backup 生成一致 snapshot；运行中允许其他连接继续工作 | 项目并发、超时、重启、满盘和恢复点验证 |
| 私有连接候选 | [Tailscale device connectivity](https://tailscale.com/docs/reference/device-connectivity)、[coordination server outage](https://tailscale.com/docs/reference/coordination-server-down) | 连接可能为 direct/peer relay/DERP；控制面离线时策略/设备更新和撤权受限 | 供应商选择、中国大陆目标网络、五分钟 freshness producer |
| restic 候选 | [restic repository setup](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)、[repository checks](https://restic.readthedocs.io/en/stable/045_working_with_repos.html) | 仓库需要独立凭据/密码；真实 pack data 检查需要读取数据 | backend、版本、保留、防删、费用、上传与恢复组合 |
| Time Machine | [Apple：Time Machine frequency](https://support.apple.com/en-us/104984)、[backup destinations](https://support.apple.com/en-lamr/102423) | 默认小时级频率；可使用外置或网络目标 | 只可作辅助系统恢复，不能单独证明 RPO≤15m |
| 三路线研究 | [已核收研究报告](../collaboration/部门/研究部/报告/2026-08-09-专用Admin-MacBook私有访问与异机备份候选.md) | overlay/备份候选、Unknown、Gate A-D 与退出条件 | 全部真实账号、网络、费用、地区可用性和组合运行 |

## 7. 当前停止线

截至本手册发布：

- 设备/OS/地点、账号、FileVault、供电/UPS、睡眠、网络、overlay、Node、launchd、目录、SQLite 主库、备份目标、密钥、监控、public-host 和恢复 Mac 均未实施或验证。
- 没有登录、安装、注册、购买、生成密钥、改网络、运行真实探针、上传备份或部署。
- 真实操作只能由新任务引用本手册、accepted 合同和不可变 production manifest/hash，并在用户逐项授权后开始。
