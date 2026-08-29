---
type: audit_report
department: 安全部
target: "TASK-20260812-378614 / FA5D66 .next file mode blocker"
status: final
date: 2026-08-12
related_task: TASK-20260812-378614
decision: fail
severity_count: { P0: 0, P1: 1, P2: 0 }
review_mode: local_static_read_only
tags: [next-build, file-mode, release-manifest, mechanical-successor]
summary: "FAIL（当前候选），P0=0/P1=1/P2=0。现有production .next共322个入闭包普通文件：37个0600、285个0664；全部uid501/gid20、nlink1、非symlink且realpath精确，0个执行位。当前谓词因0664含group-write而在next-server.js.nft.json首错；未见异主、多链接、symlink、越界或共享构建根证据。唯一规则：task-owned fresh build完成后、manifest生成前，所有被next start消费的普通非执行文件机械归一为0644；目录0755；若未来出现经明确allowlist判定的直接执行文件才0755；全树必须当前uid、regular/dir、nlink1（文件）、realpath精确且group/other不可写。私钥/DB/manifest继续0600，私有目录0700。builder归一后记mode入manifest，target verifier逐字匹配且不得现场chmod。可直接派单一机械successor。"
---

# Next production build 文件 mode 规则只读裁定报告

## 1. 裁定

**当前候选 FAIL；P0=0，P1=1，P2=0。**

`TASK-20260812-FA5D66` 的 production build 已存在，但 release fresh-stage 会被当前文件身份谓词拒绝。根因精确收敛为：322 个纳入 `.next` 内容闭包的普通文件中，285 个 mode 为 `0664`，带 group-write；当前 `fileRecord()` 明确拒绝 `(mode & 0022) != 0`。

首错文件的身份本身没有出现 symlink、异主、多硬链接或 realpath 越界：

`next-server.js.nft.json | mode=0664 | uid=501 | gid=20 | nlink=1 | regular=true | symlink=false | realpath_exact=true | size=41554`

因此这是 **fresh build 输出权限未归一化**，可以用单一机械 successor 修复。当前 blocked 任务不能继续生成 release manifest，也不能进入 target verifier、installer 或 M1 stage。

本轮没有执行 build、test、typecheck、verifier、installer、网络、SSH、数据库或服务操作；没有修改 `.next`、代码、配置或任务实现。

## 2. 实际 `.next` 分布

审查根：`[M5-HOME]/Documents/F1+1/app/.next`；当前 UID/GID：`501/20`。

### 2.1 纳入 manifest 的普通文件

| 属性 | 只读实值 |
|---|---:|
| 文件数 | `322` |
| 总字节 | `13,373,354` |
| mode `0600` | `37` |
| mode `0664` | `285` |
| UID `501` | `322/322` |
| GID `20` | `322/322` |
| `nlink=1` | `322/322` |
| regular file | `322/322` |
| symlink | `0` |
| realpath mismatch | `0` |
| group/other writable | `285` |
| owner executable | `0` |
| 任意执行位 | `0` |

37 个 `0600` 文件包括 `BUILD_ID`、顶层构建 manifests 和 types 等；285 个 `0664` 文件包括 `next-server.js.nft.json`、服务端/客户端 chunks、route/page artifacts、source maps 和静态 CSS/JS。当前产物中没有需要以文件执行位直接启动的 `.next` 文件。

### 2.2 目录

| 属性 | 只读实值 |
|---|---:|
| 目录数 | `57` |
| mode `0700` | `55` |
| mode `0755` | `2` |
| UID `501` / GID `20` | `57/57` |
| symlink | `0` |
| realpath mismatch | `0` |
| group/other writable | `0` |

目录 `nlink` 为 `2..79`，符合普通目录链接计数语义；不得把“文件 nlink 必须为 1”机械套给目录。

### 2.3 明确排除的九项

当前九项全部存在：6 项 `0600`、3 项 `0644`。它们是已枚举的 cache/diagnostics/trace/turbopack 构建可变项，没有被纳入 322 项 release records。本任务只裁定 mode，不重新裁定这九项的排除语义。

## 3. 当前谓词与首错

`app/src/server/admin-service/release-manifest.ts:234-246` 对每个闭包文件要求：

- regular file；
- 非 symlink；
- `nlink=1`；
- `uid=currentUid()`；
- `(mode & 0022) == 0`；
- `realpath(file) == absolute path`；
- resolved path 不越过闭包 root；
- 将 `path/mode/size/SHA-256` 写入 manifest。

`.next` root 和递归目录在 `:252-278` 同样要求当前 UID、非 symlink、realpath 精确、group/other 不可写；所有非目录/非普通文件都 fail closed。target verifier 在 `:609-624` 用相同函数重建 `.next` records，再与外部 SHA 锚定 manifest 逐字比较。

当前首错来自 `next-server.js.nft.json` 的 `0664`。它满足 regular、uid、nlink、realpath 与边界条件，只违反 group-write 禁止位。其后还有 284 个同类 `0664` 文件；只修首文件会把错误顺移，不能闭合任务。

## 4. 唯一精确权限规则

机械 successor 应采用以下一套规则，不能增加第二种模糊策略：

### 4.1 production `.next` 内容闭包

在 **task-owned fresh production build 已成功、manifest 生成之前**，对未排除的整棵 `.next` 闭包机械归一：

1. 普通、由 Node/Next 读取的非执行文件：精确 `0644`；
2. 目录：精确 `0755`；
3. 当前构建实值没有执行文件，因此本 successor 不得按扩展名猜测执行性，也不得生成 `0755` 文件；
4. 未来若确有必须由 OS 直接执行的构建文件，须先把精确相对路径加入代码 allowlist，再允许该文件精确 `0755`；没有 allowlist 一律 `0644`；
5. 文件必须 regular、非 symlink、`nlink=1`、`uid=currentUid()`、`realpath==absolute`、位于 `.next` real root 内；
6. 目录必须 directory、非 symlink、`uid=currentUid()`、`realpath==absolute`、位于 `.next` real root 内；
7. group/other write 在所有文件和目录上都拒绝；异主、多链接文件、symlink、special file、realpath 越界直接阻断，禁止用 chmod 掩盖；
8. GID 记录可进入诊断收据，但信任判定不依赖固定 GID；安全边界由 owner UID、类型、链接、realpath 与禁止 group/other write 组成。

### 4.2 私有与敏感工件

以下规则维持现有严格边界，不能随 `.next` 放宽：

- private key、SQLite DB、release/deployment manifest、plist、receipt、secret/config：精确 `0600`；
- 私有 data/stage/log/root 目录：精确 `0700`；
- 固定 Node 可执行文件：精确 `0755`，且继续要求当前 UID、regular、nlink1、非 symlink、realpath 精确和外部 SHA 绑定。

### 4.3 builder 与 target verifier 的职责

- builder：仅在确认 root、全部目录和文件满足 owner/type/nlink/realpath/no-symlink/no-special 边界后执行机械 chmod；然后读取归一化后的 mode/size/SHA，写入唯一 manifest。若遇异主、多链接、symlink、特殊文件或越界，立即失败，禁止 chmod/chown 修补。
- target verifier：完全只读；重建精确文件集合，并逐项核对 manifest 中的 `path/mode/size/SHA-256`。它只能接受文件 `0644`（或未来精确 executable allowlist 的 `0755`）和目录 `0755`；任何缺失、额外、mode/byte 漂移都失败。target verifier 不得 chmod。
- installer：先调用同一只读 verifier；验证成功前不得写 stage 或 live plist。installer 不承担 `.next` 权限修复。

## 5. 机械 successor 边界

**可以直接派一个机械 successor，无需重新做架构决策。**

允许范围：

1. 在 release build-and-manifest 入口中加入一个本地、无网络的 `.next` 权限归一函数；
2. 只处理 task-owned fresh build 的 `.next`；先验证身份边界，再将目录统一 `0755`、当前所有闭包普通文件统一 `0644`；
3. builder 在 chmod 后生成 manifest，收据继续报告 next file count/bytes/root；可额外报告 mode 分布；
4. verifier 把精确 `0644/0755` 规则编码为 fail-closed 条件，并保持 manifest mode 逐字比较；
5. 更新一组聚焦测试，覆盖：`0664→0644` 全树归一成功；symlink/异主/多链接/越界/special file 不得被 chmod 掩盖；target 的 `0664/0600/0755` 非 allowlist 文件均拒绝；
6. 沿用 FA5D66 原验证预算，从首错之后按任务工具恢复：不额外增加 build/test/typecheck 次数，不进入 M1。

禁止范围：

- 不修改 sender、receiver、reader、公开视觉、accepted ADR；
- 不 chown、不复制或跟随 symlink、不放行 group/other write；
- 不在 target verifier 或 installer 现场“顺便 chmod”；
- 不把 private key、DB、manifest 或私有目录改成 `0644/0755`；
- 不扩大到 SSH、M1、load、cutover、真实 DB 或外部网络。

## 6. 定级、放行与 Unknown

### P0

无。

### P1-01

当前 fresh build 有 `285/322` 个闭包文件为 `0664`，release verifier 按正确的禁止 group-write 边界拒绝。候选暂不能生成可信 manifest或进入 stage。状态：**明确、可机械修复**。

### P2

无。

### 放行

- 可派机械 successor：**是**；
- 可恢复 FA5D66 的 manifest/验证链：**仅在归一化修复落地后**；
- 可同步 M1、执行 installer、load 或 cutover：**否**。

### Unknown

- 机械归一后的 manifest count/root/SHA；
- 聚焦测试、typecheck 和 diff-check结果；
- target M1 上归一后的实际 mode/uid/nlink/realpath；
- installer 原子提交与回退的运行证据。

## 7. 自审

- 只回读任务指向的 blocked 候选、当前 `.next` lstat/realpath 分布和现有谓词；
- 没有运行 build、test、typecheck 或 verifier；
- 没有修改 `.next` mode、owner、字节、代码、配置、manifest 或任务实现；
- 没有网络、SSH、DB、service、installer 或 M1 操作；
- 没有把普通目录的 nlink 大于 1 误判成文件多链接；
- 没有把 `0664` 扩大成 symlink/异主事故；285 项唯一共同失败条件是 group-write；
- 没有建议放宽 group/other write，也没有让 target verifier 修补输入。

TASK_STATE_OK
