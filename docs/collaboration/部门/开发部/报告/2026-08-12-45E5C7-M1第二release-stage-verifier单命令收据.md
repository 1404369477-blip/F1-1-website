---
task_id: TASK-20260812-45E5C7
status: final
decision: pass
department: 开发部
---

# M1 第二 release stage verifier 单命令收据

## 结果

任务唯一远端白名单命令执行 `1` 次并以退出码 `0` 结束。唯一 JSON 收据精确命中全部合同字段：

- `status=release-verified`
- `rootKind=stage`
- `manifestSha256=34c1032cc6adca96990cf35b092c2d61b940a2bda8fdd53a0c8ccfbb6e7c8d95`
- `gitCommit=5d5963671550b45e9c01fbc727bc6aeac73447e4`
- `contentRootSha256=2aae04864325f9db436b72267b578df681efdc51f79f81d8348a5490b5e8c153`
- `releaseSha256=6d402a5d0b81fcf2d20e9720e3d0eef5f6e2ea63bb939ca8c7921df85159eb02`
- `runtimeFiles=19`
- `dependencyPackages=8`
- `dependencyFiles=118`
- `nodeSha256=ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`

## 执行边界

- 远端命令数：`1`
- 额外远端 preflight/grep/stat/shasum：`0`
- 第二条远端命令：`0`
- 正式 overlay/prepare/RSS 请求/清理：`0`
- 正式路径写入：`0`

## 未验证

正式路径验签、prepare-only、唯一真实采集、紧随其后的 stop 及公开面零漂移由后继独立任务执行。

TASK_STATE_OK
