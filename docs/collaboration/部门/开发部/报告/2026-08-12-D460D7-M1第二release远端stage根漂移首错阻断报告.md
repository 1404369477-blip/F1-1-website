# D460D7 M1 第二 release 远端 stage 根漂移首错阻断报告

## 1. 结论

`TASK-20260812-D460D7` 在正式 overlay 之前被远端 stage release verifier 阻断，任务已按 `REMOTE_STAGE_RELEASE_ROOT_MISMATCH` 标记 blocked。没有重跑 builder、传输或 verifier，没有覆盖 M1 正式 app 路径，没有执行 installer prepare、source enable、wrapper、真实 RSS 请求、stop 或 900 秒 load。

首错原文：

```text
ConfigError: RELEASE_MANIFEST: release content closure or deterministic roots changed
```

后续仅用一个不调用 verifier 的只读身份探针核对 stage：137/137 个闭包文件的 SHA 与 size 全部一致，但 137/137 个文件 mode 全部不一致。期望 content/release root 与根据 stage 实际 mode 重算的 root 因而不同。

直接原因是本任务解包命令在 `umask 077` 下运行；归档内期望的 `0644`/`0755` 文件在 stage 被收紧为 `0600`/`0700`。正式 app、private DB、公开 DB、LaunchAgent 与服务没有进入该解包路径。

## 2. 阶段 A 只读 preflight

阶段 A PASS：

- M1 固定用户：UID `501`、`chanai`。
- app root：`[M1-HOME]/F1-1-website/app`，真实路径一致且不在 iCloud。
- 固定 Node：`24.18.0`；SHA-256 `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`。
- RSS source：`enabled=0`、`stop_epoch=3`、`last_reason_code=NETWORK_FAILURE`。
- private DB：完整 `assertRssSchema` PASS、`integrity_check=ok`、run `1`、candidate `0`。
- `com.f1plus1.rss-collector`：明确 unloaded。
- 公开 DB：SHA-256 `949c78d505e4c032d2495174deaf62d24f9d99b76284ad7ba6fb29a5ac83bb50`、size `737280`、inode `24546198`、mode `0600`、UID `501`、单链接。
- local/public home 与固定 detail 均为 HTTP `200`。
- `com.f1plus1.public-beta`：running，PID `52089`。
- `com.f1plus1.quick-tunnel`：running，PID `53446`。
- `com.f1plus1.receipt-refresh`：last exit `0`。
- M1 当时正式 release manifest SHA-256：`f9765974eb3bc1be3515ea202781efb300b14d3a20f4f56cbb92cf206fbe9e96`。

## 3. 第二 release 唯一 builder

前置身份：

- 本地 HEAD：`5d5963671550b45e9c01fbc727bc6aeac73447e4`。
- tree：`cc0193fe0082e783ce25befddcecf855ec74e417`。
- 唯一 parent：`7f5cab64e25d01c74005fbb24c4f0e2905291f1d`。
- 安全复审 `TASK-20260812-06A122`：PASS，P0/P1/P2 均为 0。
- GitHub 同步 `TASK-20260812-48D35A`：ACK，远端 ref 精确等于目标 commit。

release builder 恰执行一次并 PASS：

- status：`built-from-clean-git-head`。
- externalCalls：`0`。
- git commit：`5d5963671550b45e9c01fbc727bc6aeac73447e4`。
- release manifest SHA-256：`34c1032cc6adca96990cf35b092c2d61b940a2bda8fdd53a0c8ccfbb6e7c8d95`。
- content root：`2aae04864325f9db436b72267b578df681efdc51f79f81d8348a5490b5e8c153`。
- release SHA-256：`6d402a5d0b81fcf2d20e9720e3d0eef5f6e2ea63bb939ca8c7921df85159eb02`。
- 闭包：19 个 runtime 文件、8 个递归生产依赖 package、118 个依赖文件。
- Node SHA-256：`ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`。

builder 后的本地独立逐字核对确认 canonical manifest、runtime/依赖 file record、依赖 root、Node、content root 与 release root全部匹配。没有第二次 builder。

## 4. 精确传输与 stage 首错

任务 tar：

- 条目数：`138`，即 1 个 manifest + 19 个 runtime 文件 + 118 个依赖文件。
- size：`626012` bytes。
- SHA-256：`da03e816c14a83df3896f5a5e3fd4ae782e6b33fb79589324a088160a9077963`。
- 本地与 M1 传输后 SHA/size 精确一致。
- 远端 tar 路径安全门 PASS：138 个唯一相对路径，无绝对路径或 `..`。

远端 stage 解包后第一次且唯一一次执行 `readVerifiedRssReleaseManifest`，立即得到本报告首错。没有重跑 verifier。

只读实际身份探针结果：

| 项目 | manifest 期望 | stage 实际 |
| --- | --- | --- |
| manifest SHA-256 | `34c1032cc6adca96990cf35b092c2d61b940a2bda8fdd53a0c8ccfbb6e7c8d95` | 相同 |
| content root | `2aae04864325f9db436b72267b578df681efdc51f79f81d8348a5490b5e8c153` | `9c6fda9e2f1a0681dd43671c73c62bd6944f2ab4633f87cefcc8827e2ebbe75c` |
| release SHA-256 | `6d402a5d0b81fcf2d20e9720e3d0eef5f6e2ea63bb939ca8c7921df85159eb02` | `53101c7ba64b5e7d4e3f1de7bc753abf154e583961b79bbe5131b5f89a347cfd` |
| file records | 137 | 137 |
| SHA mismatch | 0 | 0 |
| size mismatch | 0 | 0 |
| mode mismatch | 0 | 137 |

首个 mode 样本均为期望 `0644`、stage 实际 `0600`：migration、`package-lock.json`、`package.json`、release builder 与 collector。stage 中 `src/server/rss/transport.ts` 的 SHA-256 仍精确为 `a55b76fa8899173341671a3c8e13d67c47e6f74d8fd6e0ff68a29e1abc134028`，size `16394`，但 mode 为 `0600`。

## 5. 停止点与证据保留

停止时计数：

- builder：`1`，PASS。
- tar/传输：`1`，SHA/size PASS。
- remote verifier：`1`，FAIL；未重跑。
- formal overlay：`0`。
- formal backup：`0`；没有正式字节需要恢复。
- installer prepare：`0`。
- source enable：`0`。
- wrapper：`0`。
- 真实 RSS 请求：`0`。
- control stop：`0`；source 从未启用。
- 900 秒 load：`0`。
- private/public DB 写：`0`。

证据按首错纪律保留：

- M1：`[M1-HOME]/F1-1-website/.rss-release-TASK-20260812-D460D7/`
  - `release.tar.gz`
  - `stage-app/`
- 本地：`/var/folders/dz/l8yd2gqj22z1xgrcl1z_wbkr0000gn/T//TASK-20260812-D460D7-release.1qPEeZ/`
  - `rss-second-release.tar.gz`

旧 `TASK-20260812-772F48` Trash 备份未删除。正式 private DB、release/deployment manifest、plist、logs 与公开 synthetic DB 均未触碰。

## 6. 后继最小路径

后继不需要重跑 builder或重新传输。最小机械路径是在现有 stage 内严格按已验签 manifest 的每条 file record 恢复精确 mode，拒绝路径逃逸、symlink、非单链接、owner/SHA/size 不符；随后只执行一次 stage verifier。只有期望 content/release root 完全恢复，才可重新进入正式 backup/overlay 门。

该建议不授权当前 blocked 任务继续执行，也不授权 source enable、真实请求或 900 秒 load。

## 7. 错题自检

- 解包前设置 `umask 077` 是本轮错误：它保护了新文件私密性，但改变了 manifest 已绑定的 mode，因此 stage release root 必然漂移。
- 第一条只读身份探针因括号缺失产生一次本地求值 `SyntaxError`；该探针未调用 verifier、未写文件或 DB。纠正后只执行一次成功的只读身份核对，并如实记录。
- verifier 首错后没有重跑 builder、传输或 verifier，也没有进入 overlay、prepare、enable 或 wrapper。
- 没有预写或保留 PASS/TASK_STATE_OK 结论；本报告结论明确为 blocked。
- preflight 后没有任何命令以正式 app、private/public DB、LaunchAgent 或公开服务为写目标。

TASK_BLOCKED: REMOTE_STAGE_RELEASE_ROOT_MISMATCH
