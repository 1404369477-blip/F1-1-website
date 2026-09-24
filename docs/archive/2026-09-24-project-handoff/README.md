# 2026-09-24 项目进度归档

这是用户要求的长上下文归档，用于保留历史并让新窗口按精简入口接续。**归档没有把项目、X接入或备份稳定性标为完成。**

## 从哪里继续

- [当前生产状态与下一步](../../当前生产状态与执行待办.md)：当前事实唯一摘要。
- [新窗口接续指南](../../handoff.md)：阅读顺序、环境、材料、必要readback、禁重放清单和可复制提示。
- [当前任务与分工](../../collaboration/当前工作分工与交接.md)：正式TASK状态和生产写入边界。
- [近期进度](../../progress.md)：里程碑及重要失败。

## 原文完整保存

四份整理前原文共 **1661行 / 453730字节**，逐字节复制为`.txt`，避免把旧Markdown里的相对链接误渲染成新目录路径。每份的原路径、大小和SHA在[manifest.json](manifest.json)。查阅原文中的相对链接时，必须从对应原文的`source`目录解析；该信息也记录在`sourceRelativeLinksResolveFrom`字段中。原文里的命令和旧“当前状态”只作历史资料，不可直接执行。

| 原位置 | 保存副本 | 字节数 | SHA-256 |
|---|---|---:|---|
| `docs/当前生产状态与执行待办.md` | [原文](originals/docs/当前生产状态与执行待办.md.txt) | 90227 | `ad9d40bdc5f8511764f2410a820278eac186d43c51592d00ea69a5b8a085cc83` |
| `docs/handoff.md` | [原文](originals/docs/handoff.md.txt) | 77202 | `883d15acbb02cbaf9fe018d4bbf4ffde87200e15966f0adbcf75b59f1612d8ad` |
| `docs/progress.md` | [原文](originals/docs/progress.md.txt) | 246267 | `aea284a437f9962c5791cacd908f0567674afa9a6c8873c8d5894dfecf27faa7` |
| `docs/collaboration/当前工作分工与交接.md` | [原文](originals/docs/collaboration/当前工作分工与交接.md.txt) | 40034 | `c01f18e092f8a3a770ebc919ef7979437f5b9cd0f146754e71c4eb76079ea06c` |

## 证据与工作区

- [工作区归档前快照](workspace-before.json)：分支、HEAD、脏文件清单；不含未提交文件全文。**这不是源码或数据库整机备份**，其他未提交工作仍在当前工作区。
- [关键证据索引](evidence-index.json)：7份小文件原件副本，包括云端字节独审、清理实机独审、外部分析原文、GitHub故障结论和D1BAB4任务快照；从这里按相对路径打开副本。
- [21:51只读实机回件](evidence/current-observation-r2/stdout.json)：新PID689遗留锁、最新RP、RSS日志、M1空间、当前部署/trust摘要及readback存在性。其[执行结果](evidence/current-observation-r2/result.json)为远端exit0；原件SHA `3cbbd0fcc1fe881f2359639555b7968e3edc37c0155c4684244eb8d7da659836`。
- [首轮只读失败](evidence/current-observation/result.json)保留：假设Public/deployment.json存在导致FileNotFoundError，无生产写入；r2将该路径明确记录为未检查。不能把这个取证脚本错误当网站故障。
- 原始执行脚本、native证据和大部分历史回件仍位于工作区`scratch/`。归档只索引/复制必要小材料，没有复制数据库、密文或缓存。

## 验证与限制

原文和证据副本须按两个manifest复算；新四入口检查本地链接和任务状态，结果见[核验记录](validation.json)。正式任务通过`agent_team_task.py rebuild-index`和`doctor`检查；本轮交接的独立复核见[独审结果](handoff-review.json)。

业务运行状态会随时间变化。21:51采样没有验证Public最新页面、新签名登记、当前完整X入库数或持续RPO；后续以主状态明确列出的第一步刷新。当前发现的新备份锁和RSS错误未在归档任务中修复。

## 后续维护

当前状态文件维护最新结论，详细时间线写原任务日志；新窗口优先读精简入口，只有追溯特定失败时才读取这里的历史。不要重新把整段历史复制回四份入口，不删除本归档或原失败证据。
