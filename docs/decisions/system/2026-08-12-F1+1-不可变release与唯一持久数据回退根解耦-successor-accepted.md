---
type: system_adr
status: accepted
date: 2026-08-12
department: 产品部
decision_id: ADR-M5-REAL-PROJECTION-RUNTIME-003
related_task: TASK-20260812-0196EB
authorization_state: user_confirmed
authorization_evidence: 用户已授权固定M1快速上线、真实采集与首版部署；本successor只消除版本release与现有唯一数据/回退资产的路径耦合，不扩大业务范围
supersedes_runtime_details_of:
  - ADR-M5-REAL-PROJECTION-RUNTIME-002
implementation_state: contract_accepted_code_pending
visual_state: user_confirmed
---

# ADR-M5-REAL-PROJECTION-RUNTIME-003：不可变 release 与唯一持久数据、回退根解耦 successor

## 决定

第一版固定使用四个互不替代的根：

| 根 | 首版唯一值 / 语义 | 可写者 | 不变量 |
| --- | --- | --- | --- |
| `targetReleaseAppRoot` | `[M1-HOME]/F1-1-website/releases/<releaseRootSha256>/app`；首个已验签候选为 `f868497562332e6b365479f48105aba298783aa23513a0b962ac2ba318f462a6` | 部署事务 | 只承载内容寻址代码、依赖和 `.next`；服务脚本与 `WorkingDirectory` 指向它；不得承载业务数据库 |
| `reviewDatabasePath` | `[M1-HOME]/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite` | 现有 RSS collector 与唯一 Admin writer | 首版继续绑定当前唯一真实私库；必须已存在；原位追加 `0002/0003`；禁止复制、`ATTACH`、双写和缺失时创建 |
| `syntheticRollbackAppRoot` | `[M1-HOME]/F1-1-website/app` | 回退时只启动上一 synthetic release | 其 `.next/BUILD_ID` 与 `.local/f1plus1-public-multimedia-synthetic.sqlite` 是旧 live synthetic 的一对外部锚；prepare 只读核验，不把资产复制进新 release |
| `publicDataRoot` | `[M1-HOME]/Library/Application Support/F1Plus1/Public`；投影根为其 `projection/` | public receiver；Next reader只读 | 与 release/私库/rollback root 分离；既有 home-scoped 语义保持 |

Admin 的 `dataRoot=[M1-HOME]/Library/Application Support/F1Plus1/Admin` 继续只存 deployment manifest、session、Passkey、bootstrap、recovery fence 与日志。它不等同 `reviewDatabasePath`，也不能用模糊的 `reviewDataRoot` 替代数据库精确路径。

RSS collector 首版继续运行旧 live app 的已验签 LaunchAgent，仍写同一 `reviewDatabasePath`。本轮不替换 RSS plist、不迁移数据库、不把 collector 切到版本 release。长期将 collector 与私库迁入稳定 Application Support 根，必须另建“停采 → 一致性备份 → 同盘原子迁移 → inode/schema/恢复点复验 → 单写主恢复”的 successor；不得用在线复制完成。

## 为什么必须独立 successor

当前实现可静态证明两处会破坏上述真值：Admin 由 release `appRoot` 推导 `.local/f1plus1-rss-real-private.sqlite`，且安全 opener 在文件缺失时会创建新库；public prepare 又用同一 `appRoot` 同时校验新代码 release 和旧 synthetic `BUILD_ID`/SQLite。直接 load 会形成第二私库，或使正确的 rollback 资产因位于旧 live root 而无法通过 prepare。

`ADR-M5-REAL-PROJECTION-RUNTIME-002` 的人工审核、第二次显式手动发布、single sender、签名全量快照、无 hash generation 1 bootstrap、receipt 对账、public active reader 与 `auto-publish=0` 全部保留。本 successor 只取代其“deployment manifest 固定 Admin DB/root”和“synthetic rollback release/hash”的路径运行细节。

## Deployment v3 最小字段合同

### Admin manifest

`admin-service-deployment-v3` 必须新增并只认：

```text
targetReleaseAppRoot   = 绝对、已验签、不可变 release app 根
reviewDatabasePath    = 绝对、已存在的唯一 rss-real-private SQLite
reviewDatabaseIdentity = { dev, ino, uid, nlink=1 }
reviewSchemaTarget    = 3
```

保留 `dataRoot/staticRoot/sessionHashKeyPath/recoveryFencePath/publicProjectionRoot/key/origin/identity/readMode` 等现有 v2 字段。旧 `appRoot` 改名为 `targetReleaseAppRoot`，避免继续承担数据根语义；v1/v2 均写前拒绝，不做隐式转换。

prepare 的外部 CLI 输入固定新增：

```text
F1_ADMIN_REVIEW_DATABASE_PATH=[M1-HOME]/F1-1-website/app/.local/f1plus1-rss-real-private.sqlite
F1_ADMIN_REVIEW_DATABASE_DEV=<preflight receipt>
F1_ADMIN_REVIEW_DATABASE_INO=<preflight receipt>
```

`prepare` 必须用 `lstat + O_NOFOLLOW + fstat` 证明文件已存在、当前 UID、单硬链接、无 group/other 权限、父目录无 symlink，再把 dev/inode/uid/nlink 身份写入 canonical manifest；此阶段不打开 SQLite、不迁移。Admin HTTP runtime 和独立 sender CLI 只能从同一 manifest 取得 `reviewDatabasePath`，用 existing-only opener 复核同一 dev/inode 后连接 `main`；禁止接受任意环境变量覆写、缺失时 `O_CREAT`、第二 path 或请求级选择。连接后先拒绝 `ATTACH/DETACH`，再核验 WAL/FULL/foreign keys、`database_list=main,temp`、完整 schema/integrity；只有 user_version `1` 才按 `0002→0003` 在该 inode 原位迁移，`2` 只追加 `0003`，`3` 只复验，其他版本写前关闭。

### Public prepare / deployment manifest

public installer 的运行参数继续以当前脚本所在根作为 `targetReleaseAppRoot`，并新增：

```text
F1_PUBLIC_SYNTHETIC_ROLLBACK_APP_ROOT=[M1-HOME]/F1-1-website/app
F1_PUBLIC_SYNTHETIC_ROLLBACK_RELEASE=<旧live根的精确BUILD_ID内容>
F1_PUBLIC_SYNTHETIC_ROLLBACK_HASH=949c78d505e4c032d2495174deaf62d24f9d99b76284ad7ba6fb29a5ac83bb50
```

installer 必须先以外部 release manifest SHA 验证 `targetReleaseAppRoot`，随后只读验证 `syntheticRollbackAppRoot` 为绝对、真实、非 symlink、当前 UID 受控根；精确读取该根的 `.next/BUILD_ID` 与 owner-only/single-link synthetic SQLite，并与两个外部锚匹配。新 public/receiver plist 的程序与 `WorkingDirectory` 只指 `targetReleaseAppRoot`；rollback 根不进入新进程运行环境，不作为 real reader 数据 fallback。public deployment manifest 升级为 v2，持久化 `targetReleaseAppRoot`、`syntheticRollbackAppRoot`、rollback release/hash 与 rollback DB 的 dev/inode/uid/nlink 收据；旧 v1 拒绝。公开服务日志也必须放在 `publicDataRoot/logs`，prepare task stage 放系统私有临时根；new release 在验签后保持只读，不为日志或 stage 创建 `.local`。

real read-mode 下 Next 启动门不得要求新 release 内存在 synthetic DB：`public-real-snapshot` 的 readiness 只核验 release、projection root、verify key、active snapshot 状态；无 active 为合法 empty，损坏为 503。synthetic DB 仅用于独立 rollback release 启动。

## 首版 prepare、load、cutover 顺序

1. **冻结外部锚**：只读记录旧 live public/RSS plist、loaded state、旧 `BUILD_ID`、synthetic DB SHA/dev/inode/size/mode/uid/nlink、唯一 review DB path/dev/inode/schema/integrity、公开健康与 3101/3102 listener；RSS 自然运行允许数据库内容变化，但 dev/inode/path 不得漂移。
2. **prepare public**：在新 release 上验证 release manifest；对旧 rollback root 验证外部 anchors；生成并原子提交 disabled public/receiver manifests/plists。不得 `launchctl`，现有 loaded public 服务不受影响。
3. **prepare Admin**：验证 v3 manifest、existing-only review DB identity、密钥/路径/origin；生成 disabled Admin plist。此步不打开/迁移 DB；bootstrap token 延后到确定即将注册 Passkey的窗口生成，防止 prepare 时过期。
4. **迁移并启用内部链**：进入短维护窗，先证明 RSS 当前没有 running slot，保留 RSS LaunchAgent但用 SQLite `BEGIN IMMEDIATE` 串行化；Admin opener在同一唯一 inode 原位追加 `0002/0003`。复验 RSS 下一自然周期仍写同一库。随后只 load loopback receiver `3102` 和 Admin `3101`，仍不切公开 read-mode。
5. **私有入口与人工动作**：Tailscale HTTPS/身份、Passkey、recovery fence 与备份 freshness 全部通过后，Mac/iPhone 同一 Admin origin 才可执行 revision/approve；manual publish 仍需第二次显式确认。任何门 unknown 时 mutation=0。
6. **投递验证**：manual publish 产生唯一 outbox 后，sender 将 generation 1 投递至 receiver；必须得到匹配 receipt、outbox `succeeded`、active snapshot 与 real 候选 feed/detail 200。
7. **公开 cutover**：记录旧 plist/进程/健康的可恢复收据，CAS/原子替换 release/read-mode 指针，重载 public 到新 release `public-real-snapshot`；确认公网只有公开 GET，Admin/internal 路由为 0。成功后旧 live root仍只作精确 rollback anchor，暂不清理。

## 回退与失败路径

- **prepare 失败**：恢复 prepare 前 plist/manifest/log 原字节，0 load；唯一 review DB 与两个 live 服务不变。
- **DB 路径/身份/schema 失败**：Admin 与 sender保持 disabled；不得创建替代库、复制 DB/WAL/SHM、down migration 或修改 RSS plist。若 `0002/0003` 已提交，保留同一库的追加 schema，旧 collector继续兼容写其三表。
- **内部链或投递失败**：停 sender/Admin/receiver；保留同一 DB/outbox/audit 与 public last-known-good。结果未知只查同一 receipt。
- **公开 cutover 失败**：把 public plist/release/read-mode 恢复到 `syntheticRollbackAppRoot` 及其精确 BUILD_ID/DB hash，再回验 health/home/detail；不移动、删除或回写 review DB、projection generation。
- **长期迁移失败**：保持旧 live `reviewDatabasePath` 为唯一真值并恢复 collector；新目标保持不可提升。不得保留第二个可写副本。

## 开发最小落点与验收

最小代码落点由开发部自行组织，但行为出口必须覆盖：Admin deployment/CLI/runtime/sender、existing-only SQLite opener、public installer/deployment、real-mode readiness、相应测试/release manifest与 prepare 文档。不得修改人工审核业务实体、DTO、视觉或公开内容。

验收必须证明：

1. target release 与 review DB、rollback root 均为不同绝对根时 prepare 成功，new plist 只指 target release；所有 plist仍 disabled且无 `launchctl`。
2. review DB missing、inode/owner/private-mode/link/sidecar/schema 任一失配均在创建/迁移前失败；目录中不存在第二 `f1plus1-rss-real-private.sqlite`；Admin、sender与 collector 观察同一 dev/inode。
3. user_version 1→3 只在现有 inode原位发生，三张采集表及 20 条候选保留，下一 RSS 周期继续同库；SQLite `database_list` 无额外库，`ATTACH/DETACH` 拒绝。
4. rollback `BUILD_ID`/hash/path/identity 任一失配时 live plist零写；匹配时新 public plist指 new release，rollback收据指 old live root。
5. real mode 无需新 release synthetic DB即可启动；active为空/有效/损坏分别为 empty/200/503，禁止请求级 synthetic fallback。
6. load/cutover只在上述分层门之后执行；失败能恢复旧 synthetic health/home/detail，且 review DB/path/inode、private事实和 projection generation 零回退。

## 未变更边界

人工 revision/approve/reject、第二次显式 manual publish、single sender、签名全量快照、`auto-publish=0`、0 图首版、Mac/iPhone 功能等价与 `RTO≤4h/RPO≤15m` 均不变。真实媒体、AI、其他信源、自动发布、第二写主与长期公网 Admin 继续关闭。
