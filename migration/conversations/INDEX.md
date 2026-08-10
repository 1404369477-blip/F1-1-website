# F1+1 有效对话归档索引

## 1. 覆盖范围

本目录保存主任务、统筹部和七个业务部门共 9 个 Codex 任务的可移植对话内容。2026-08-02 通过 Codex 只读 `read_thread` 分页读取全部可见 turn，并按以下规则导出：

- 保留用户消息；
- 保留跨部门 `codex_delegation` 的正文与来源任务 ID；
- 保留 Agent 的 `final_answer`；
- 保留 turn ID、开始时间和完成/进行中状态；
- 排除内部 reasoning、工具原始输出、临时 commentary、浏览器/终端状态、凭证与 Codex 本机数据库。

该归档属于“有效上下文导出”，不追求 Codex 内部事件流的逐字节镜像。共保留 190 个历史 turn、312 条用户/delegation 输入和 185 条 final answer。导出文件中没有发现读取接口的截断标记；单条读取上限为 12,000 字符，长报告的正式全文仍以项目内落盘报告为准。

## 2. 文件清单

| 文件 | 角色 | Codex task ID | turn | 用户/delegation | final answer |
| --- | --- | --- | ---: | ---: | ---: |
| `00-main.md` | 主任务 | `019fb2b1-fb60-7792-adb4-e0e876a32947` | 49 | 57 | 44 |
| `01-lead.md` | 统筹部 | `019fb368-828c-7461-bc1e-debc14d1cd1c` | 2 | 2 | 2 |
| `02-product.md` | 产品部 | `019fb369-ae6d-7131-9199-7dc088542ead` | 21 | 41 | 20 |
| `03-research.md` | 研究部 | `019fb36c-1f86-78d3-a6d7-f87f124bd710` | 8 | 16 | 9 |
| `04-design.md` | 设计部 | `019fb36e-c81c-7991-9357-e19a1df6ba23` | 34 | 40 | 32 |
| `05-data.md` | 数据部 | `019fb371-9834-78d3-a7b3-4f4c62819520` | 17 | 40 | 19 |
| `06-development.md` | 开发部 | `019fb374-7c86-7882-9e51-76114ce69e7f` | 15 | 35 | 16 |
| `07-security.md` | 安全部 | `019fb377-10f9-7213-ba73-1a717dc76d77` | 22 | 44 | 20 |
| `08-testing.md` | 测试部 | `019fb379-9212-7e80-a5df-587d339936c4` | 22 | 37 | 23 |

每个文件的 SHA-256 由本目录 `SHA256SUMS` 覆盖。目标机完成完整复验后，portable/warm 迁移归档和大体积输入 manifest 已按用户授权清理；原始归档哈希与清理收据保留在迁移验收报告中。

## 3. 恢复时的权威顺序

1. `docs/spec.md`
2. accepted ADR
3. `docs/collaboration/tasks/*.json`
4. 部门四文档与正式落盘报告
5. `docs/progress.md`
6. `migration/CURRENT-HANDOFF.md`
7. 本目录的对话导出

对话中存在历史 FAIL、后继修复、提案和被 supersede 的判断。读取时必须按时间与任务状态核对，不能把旧 final answer 直接当成当前结论。

## 4. Codex 任务同步与离线回退

- 同一 Codex 账号在新 Mac 能看到原任务：继续使用原 task ID，本目录只作校验和快速检索。
- 原任务未同步：以磁盘控制面重建主任务和必要部门任务，并把新 task ID 记录到会话真值；旧 ID 保留作历史。
- 不复制源机器 Codex 的 auth、SQLite、缓存或历史数据库来强行恢复 UI。
- 接班提示词见 `../DEPARTMENT-HANDOFF-PROMPTS.md`；总控提示词见 `../RESUME-PROMPT.md`。
