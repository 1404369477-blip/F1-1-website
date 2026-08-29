# F1+1 release successor R2 工程证据闭包 v2

状态：`successor R2 engineering remediation / evidence closure`  
产品状态：不改变既有 accepted decision；不授权 deploy、M1、production 或长期服务。

## Supersedes 关系

本 R2 successor 记录 supersedes：

- `docs/decisions/system/2026-08-23-F1+1-release-successor-工程证据闭包-v1.md`：其中关于 `/bin/cp -cR` 与旧 candidate 的证据只保留为历史记录；R2 以本 ADR 与新 evidence envelope 为准；
- `docs/decisions/system/2026-08-12-F1+1-真实RSS人工审核与公开投影最小纵切-successor-accepted.md`：旧 accepted 正文保持 immutable，从 Git HEAD 精确恢复，SHA-256 为 `7192e03d9bdbd98232a7c6896ab737b5bc8da13bfa6e822e84b9208bf2f24ce7`。

旧 accepted ADR 的本地工作树字节、Git HEAD 提取字节和 R2 candidate 副本相同；R2 不改写旧 accepted 文件。

## R2 关闭的 P1 缺陷

1. P1-1 evidence envelope：`scratch/2026-08-23-release-successor-r2-remediation/evidence/envelope-manifest.json` 列出 report、receipt、inner manifest、path metadata、target verifier、target-stage receipt/tree 和验证日志的哈希。`envelopeRootSha256` 对排除自身字段的 manifest body 计算；独立 `envelope-anchor.json` 记录 envelope manifest SHA、envelope root SHA、receipt SHA 与 report SHA，避免 receipt 与 manifest 自引用。`verify-envelope.mjs` 会逐项重算并执行 receipt 单字节篡改负例，任意 receipt 字节漂移都 fail closed。
2. P1-2 target 自包含：R2 target root 是独立物理复制的 release closure，运行 Node 与 working directory 均位于 `evidence/target-stage-root`，不使用 candidate/app 或其父目录。target verifier 实际读取 target app parent 的 `AGENTS.md`、`README.md`、`.env` 和记录的 candidate-source 相对入口；均返回 `ENOENT`，并计算 `sourceParentAccess`，未写死为常量。target manifest/plist 不出现 candidate path；legacy bootstrap 不在 Admin/Public closure 或 plist。
3. P1-3 clone-copy：允许的 Admin fixture 测试使用逐项递归 copy 保留 hardlink/symlink；大树 copy 使用 Node native recursive copy，但复制后逐项核验 inode、nlink、symlink target 并在不一致时拒绝。测试包含 hardlink、symlink 与 path-escape 负例；production target tree 最终 `hardlinkCount=0`，symlink target 均在 target root 内。`/bin/cp -cR` 已移除。
4. P1-4 accepted ADR：旧 accepted ADR 从 Git HEAD 只读提取并恢复原字节；本 R2 ADR 记录 supersedes 关系，旧 accepted 正文不覆盖其他文档改动。

## R2 验证身份

- Admin path set：113，SHA-256 `65108cd552f9302990bf397b1fa6ddfda8347c0b0e46c6b53d6a308640813d21`；Public path set：82，SHA-256 `3bfa3d74898c13576f79de8efde27907a7a5da885af19736adff3d99145587a0`；
- fixed toolchain：Node `24.18.0`、npm `11.16.0`，physical offline `npm ci`；
- candidate、manifest、target-stage、build、test、envelope 的最终字节和命令以同目录 `report.md`、`receipt.json`、`envelope-manifest.json`、`envelope-anchor.json` 为准；
- Admin stage、target-stage deployment verifier、focused lint、full typecheck、RaceFans `36/36`、focused three-file suite `26/26` 均要求 exit 0；
- target service state 固定为 `disabled`，只使用 disposable Ed25519 test key，`productionSigningKey=false`；没有部署、LaunchAgent、生产密钥、外部网络或付费 API。

## Evidence 位置

R2 evidence root：

`[M5-HOME]/Documents/F1+1/scratch/2026-08-23-release-successor-r2-remediation/evidence/`

full Vitest/npm `run check` 可记录为 `NOT_RUN`；这不改变上述 focused acceptance 的 exit-0 收据。共享工作树不提交，其他用户改动保持原状。
