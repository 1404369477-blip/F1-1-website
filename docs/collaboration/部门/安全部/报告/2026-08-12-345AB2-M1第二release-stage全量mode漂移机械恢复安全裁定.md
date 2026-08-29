---
type: audit_report
department: 安全部
target: "TASK-20260812-345AB2 / D460D7 retained stage mode-only recovery"
status: final
date: 2026-08-12
related_task: TASK-20260812-345AB2
decision: pass
severity_count: { P0: 0, P1: 0, P2: 0 }
tags: [RSS-REAL-001, M1, release-stage, mode-drift, manifest, chmod]
summary: "PASS（带机械前置）。D460D7 已留证 137/137 文件 SHA 与 size 匹配、137/137 仅 mode 从签名 manifest 的 0644/0755 收紧为 0600/0700，正式 app/DB/LaunchAgent 未 overlay 或执行。外部锚定 manifest SHA 为 34c1032c…c8d95；本地同字节 manifest 静态展开得到 137 个唯一安全相对目标、134×0644 与3×0755、content/release root 与 D460D7 期望逐字一致。允许机械后继在原 retained stage 先完成全量只读闭包/owner/link/symlink/路径检查，再仅对 manifest 137项以无跟随文件描述符按精确mode执行chmod，随后唯一一次运行现有verifier。不得改manifest、verifier、builder或重新传输。verifier恢复期望root后可继续同一第二release的原stage流程；任一前置或后验不符立即停止。"
---

# M1 第二 release stage 全量 mode 漂移机械恢复安全裁定

## 1. 裁定

**PASS（带强制前置）；P0=0，P1=0，P2=0。**

允许开发/实施后继在 D460D7 保留的原 task stage 内机械恢复 137 个 manifest file record 的精确 mode；恢复完成后只运行一次现有 release verifier。verifier 必须恢复固定 content root 与 release root，随后才可沿 D460D7 原 stage 的 backup/overlay 门继续同一个第二 release。

本结论不授权当前安全任务执行 chmod、SSH、测试、verifier、overlay、prepare、真实请求或 900 秒 load。本轮没有连接 M1，没有修改 stage、manifest、代码或部署对象；唯一写入是本安全裁定报告。

## 2. 已确认输入与根因

D460D7 报告当前读取 SHA-256 为 `f988f3750a6432b867b3bee4b22db66dbf1f58b5ee529350068d8ff58c6fc4ed`。其证据链为：

- 第一次且唯一一次 stage verifier 在正式 overlay 前以 `RELEASE_MANIFEST: release content closure or deterministic roots changed` 阻断（D460D7 报告第 3–15、57–68 行）。
- stage 探针记录 137/137 file record、SHA mismatch=0、size mismatch=0、mode mismatch=137；manifest 文件 SHA 相同（第 69–81 行）。
- 期望 mode 为 `0644`/`0755`，stage 因 `umask 077` 解包变为 `0600`/`0700`（第 13–15、118–120 行）。
- 正式 overlay、backup、installer、source enable、wrapper、真实 RSS、DB 写和 900 秒 load 均为 0（第 83–108 行）。

固定 release manifest：

- SHA-256：`34c1032cc6adca96990cf35b092c2d61b940a2bda8fdd53a0c8ccfbb6e7c8d95`；
- Git commit：`5d5963671550b45e9c01fbc727bc6aeac73447e4`；
- content root：`2aae04864325f9db436b72267b578df681efdc51f79f81d8348a5490b5e8c153`；
- release SHA-256：`6d402a5d0b81fcf2d20e9720e3d0eef5f6e2ea63bb939ca8c7921df85159eb02`。

本地保留的同 SHA manifest 只读展开结果为：19 个 runtime record 加 118 个递归依赖 record，共 137 个映射后的唯一目标；安全相对路径异常 0；mode 仅有十进制 420（`0644`）134 项和 493（`0755`）3 项。其 commit/content/release 值与 D460D7 报告逐字一致。

现有 verifier 会把每个文件的 mode、size 与 SHA 写入 file record（`app/src/server/rss/release-manifest.ts` 第 97–112 行），递归读取依赖目录（第 114–140 行），并在外部 manifest SHA 核对后重算当前文件、依赖、Node 与 roots，要求 canonical manifest 字节完全一致（第 252–306 行）。因此统一 mode 收紧足以解释已观察的 root 漂移，按签名 manifest 恢复 mode 是与现有 verifier 合同一致的最小修复。

## 3. 强制机械前置

后继必须在第一次 chmod 前一次性完成以下只读 preflight；任一项不满足即停止且不得运行 verifier：

1. **固定 stage 身份**：目标只能是 D460D7 保留的 `[M1-HOME]/F1-1-website/.rss-release-TASK-20260812-D460D7/stage-app/`。task root 与 stage root 必须存在、为 UID 501 所有的真实目录、mode `0700`、无 symlink，realpath 仍在该 task root 内。
2. **外部 manifest 锚**：stage manifest 必须是 UID 501、单链接、非 symlink、mode `0600` 的普通文件，实际 SHA 必须精确为 `34c1032c…c8d95`。expected mode 只能从这份已锚定 manifest 的 file record 读取，不得从报告、tar metadata、当前 stage mode 或硬编码推导。
3. **manifest 语义固定**：schema、commit、Node、content root、release root、19+118 记录必须与上述身份一致；映射后的绝对目标必须恰为 137 个且唯一。允许 mode 仅为 manifest 中的 `0644`/`0755`，数量应为 134/3。
4. **路径封闭**：runtime path 以 stage app root 为唯一 anchor；dependency path 以 `stage-app/node_modules/<manifest package name>/` 为唯一 anchor。拒绝绝对路径、NUL、空段、`.`、`..`、规范化后逃逸、重复目标及不在固定 package root 内的目标。
5. **完整闭包**：递归枚举 stage 后，普通文件集合必须恰为 manifest 本身加 137 个映射目标；不得有缺失或额外文件。目录只允许作为这些目标的父路径；任何 symlink、socket、FIFO、device 或其他特殊节点均拒绝。
6. **目标身份**：137 个目标及每层父目录均不得是 symlink；每个目标必须是 UID 501、`nlink=1` 的普通文件，realpath 位于正确 anchor。chmod 前再次确认每项 SHA 与 size 等于 manifest；137 项应继续保持 mismatch=0。
7. **操作实现**：先完成全部 137 项 preflight，再开始任何写操作。禁止 shell 拼接、glob、递归 `chmod -R` 和跟随 symlink 的路径操作；应以固定 root 打开目标，使用 `O_NOFOLLOW`/等价无跟随机制核对 `fstat` 后对文件描述符执行精确 `fchmod`。只修改权限位，不改 owner、时间以外内容、文件名、目录、manifest 或其他 stage 项。

## 4. chmod 后唯一后验

机械 chmod 完成后必须按以下顺序执行：

1. 只读复核 137/137 mode 与 manifest 完全相等，SHA/size 仍 137/137 相等，owner/link/realpath/闭包集合保持；manifest 字节 SHA 仍为 `34c1032c…c8d95`。
2. 以同一个外部 expected manifest SHA，只运行一次未修改的 `readVerifiedRssReleaseManifest`。不得放宽校验器、改 manifest、重新运行 builder、重新打包或重新传输。
3. 唯一成功条件为 verifier PASS，且重算 content root 精确恢复 `2aae0486…8c153`、release SHA 精确恢复 `6d402a5d…59eb02`。
4. verifier FAIL、任一 chmod/fstat 异常或后验漂移时立即停止；保留 stage 与证据，不进入正式 backup/overlay，不运行第二次 verifier。

## 5. 是否可在原 stage 继续

**可以，但只能由新的已授权机械后继执行上述修复门。**

理由：现有证据表明 manifest、137 个 payload 文件的 SHA/size 与传输 tar 身份均保持，差异被完整限定为 manifest 已绑定的 mode；正式 app 与生产状态尚未进入 overlay。重新 builder 或重新传输会扩大变量，并不能修复解包 umask 的确定性原因。

stage verifier PASS 后，可以继续 D460D7 原有的正式 backup/overlay 阶段。overlay 手段必须保存已恢复 mode；正式路径仍须按原任务执行 overlay 后 release 重验。任何正式路径 identity/root 漂移继续按原首错门停止。原任务中的 prepare、唯一真实请求、立即 stop、公开状态零漂移及禁止 900 秒 load 条件全部保留。

## 6. 严重度与边界

| 项目 | 裁定 | 说明 |
|---|---|---|
| P0 | `0` | 漂移在正式 overlay 前被 verifier 阻断，未触达生产 DB、采集或公开服务。 |
| P1 | `0` | 已观察差异完全限定为签名 manifest 中可机械恢复的 mode；强制路径、symlink、闭包、owner/link 与唯一 verifier 门可保持 fail closed。 |
| P2 | `0` | 未发现需要放宽 manifest/verifier或引入第二 release 身份的残留设计问题。 |
| 原 stage 机械恢复 | **放行（带前置）** | 仅按第 3–4 节执行。 |
| 同一第二 release | **放行继续** | stage verifier 恢复两个固定 root 后，返回 D460D7 原 backup/overlay 门。 |
| 真实采集/900 秒 | **本裁定不新增授权** | 沿用 D460D7 既有一次实采与禁止 900 秒条件。 |

## 7. Unknown 与自审

### Unknown / 后继必须实机确认

- M1 保留 stage 当前是否仍存在且未被后续动作改变；
- task root/stage/manifest/137 目标的实时 owner、mode、link、realpath、symlink 与额外闭包状态；
- chmod 后 SHA/size/mode、唯一 verifier 结果及正式 overlay 是否保留 mode；
- M1 prepare、唯一真实采集、stop、人工字段与公开 synthetic/服务零漂移结果。

### 自审

- 没有把 D460D7 报告的历史只读探针外推为当前 M1 实时状态；所以 PASS 带强制 live preflight。
- 没有把“137 个 SHA/size 相等”单独当成 symlink、owner、link 和闭包安全证据；这些均列为写前硬门。
- 没有授权递归 chmod、manifest/verifier修改、第二次 builder/传输/verifier或直接 overlay。
- 没有执行 SSH、测试、chmod、verifier或任何 M1 写操作，也没有扩展到 D460D7 mode-only 恢复之外的问题。
