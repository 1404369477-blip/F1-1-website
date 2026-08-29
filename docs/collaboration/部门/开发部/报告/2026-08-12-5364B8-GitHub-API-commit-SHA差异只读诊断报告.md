---
type: implementation_report
department: 开发部
status: final
date: 2026-08-12
related_task: TASK-20260812-5364B8
decision: pass
tags: [git, github-api, commit-object, sha1, readonly-diagnosis]
---

# TASK-20260812-5364B8 GitHub API commit SHA 差异只读诊断报告

## 1. 结论

根因已完整复现：本地 commit message 的 Git raw body 末尾包含一个 LF (`0x0a`)，GitHub REST `create commit` 用字符串字段创建的孤儿 commit 末尾没有该 LF。其他 tree、parent、author、committer、Unix 时间和 `+0800` 时区与本地一致。

这一个字节导致 commit body 长度由本地 `306` 变为 API 对象 `305`，完整 Git object preimage 由 `commit 306\0<body>` 变为 `commit 305\0<body-without-final-LF>`，因此 SHA-1 分别为：

- 本地：`95b21d106c95afe076847df8a74442eb7c240de8`
- API 孤儿对象：`896d5fb623dfbed79f2ff610ab0e32e33edf4560`

将本地 raw commit body **仅删除最后一个 LF** 后，按 `commit 305\0...` 重算得到 `896d5fb6…560`，与 GitHub API 孤儿 commit SHA 精确相等。

## 2. 精确字节差异

### 2.1 Git object preimage 的首个差异

- offset：`9` （从 0 开始）
- 本地字节：`0x36` (`6`)，对应 object header `commit 306\0`
- API 重建字节：`0x35` (`5`)，对应 object header `commit 305\0`

这是 body 长度变化对 object header 的直接反映。

### 2.2 commit body 的首个差异

两个 body 的前 `305` 字节完全一致。在 body offset `305`：

- API body：EOF
- 本地 body：`0x0a` (LF)

本地最后 16 字节：`b'admin candidate\n'`；API 重建 body 最后 16 字节：`b' admin candidate'`。

## 3. 字段核对

| 字段 | 本地 `95b21d` | API `896d5f` | 结果 |
| --- | --- | --- | --- |
| tree | `9d71a028…eb36` | 同值 | 一致 |
| parent | `5d596367…47e4` | 同值 | 一致 |
| author name/email | `chanaiai` / GitHub noreply | 同值 | 一致 |
| author time | `1786497438 +0800` | API 显示 UTC `2026-08-12T01:17:18Z`；对象 SHA 反推证明 raw 保留 `+0800` | 一致 |
| committer | 与 author 同一身份/时间 | 同值 | 一致 |
| message 可见文字 | `feat: add real review and private admin candidate` | 同值 | 一致 |
| message 末尾 | LF | EOF | **唯一差异** |
| encoding/signature | 无 encoding/gpgsig header | API `unsigned`，payload/signature 为 null | 无额外字节 |

## 4. 唯一推荐修正路径

**推荐用普通 Git smart-HTTP push 把本地已有 commit `95b21d…` 快进推到远端，不重建本地 commit，不再用 GitHub REST `create commit` 复制该对象。**

原因：普通 Git push 传输的是已有 Git object 原始字节，能保留末尾 LF 并保持 SHA `95b21d…`。GitHub REST `create commit` 接口只接受 message 字符串字段；已观察到它创建出去除末尾 LF 的对象，继续对字符串 payload 试错无法给出原始字节不被规范化的保证。

后继执行应使用以下硬门：

1. push 前再次读取远端 ref，必须精确为 parent `5d596367…47e4`；
2. 只允许 fast-forward，不 force；
3. 如 smart-HTTP 失败、远端父漂移或返回 SHA 不是 `95b21d…`，立即停止，不用 API 孤儿 commit 替代；
4. push 后回读 ref/tree/parent，必须与本地三者精确相等。

不推荐将本地分支改指向 API 孤儿 commit `896d5f…`。该做法会重写本地检查点身份，与 AB853B 已冻结的本地 commit 目标冲突，且没有产品收益。

## 5. 零写证据与边界

- 诊断后本地 `HEAD` 仍为 `95b21d106c95afe076847df8a74442eb7c240de8`。
- GitHub 远端 `codex/first-public-release` 仍为 `5d5963671550b45e9c01fbc727bc6aeac73447e4`。
- 未创建 blob/tree/commit，未更新 ref，未 force。
- 未改本地 commit/config/index/worktree，未运行测试、build、M1 或服务。
- 本任务只诊断；普通 Git push 须由独立后继任务执行。

## 6. 错题自检

- 已用两个已有 commit SHA 和 Git object preimage 重算复现，没有仅凭 API JSON 显示值猜测。
- 已排除时区规范化；将 `+0800` 改为 `+0000` 不会得到 API SHA。
- 已证明唯一差异是 body 末尾 LF，两 body 的前 305 字节完全一致。
- 未将 API 孤儿 commit 挂到 ref，未改写本地历史。

TASK_STATE_OK
