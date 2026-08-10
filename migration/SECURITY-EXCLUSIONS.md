# 迁移安全排除清单

## 1. 明确排除的项目文件

| 路径 | 原因 | 目标机处理 |
| --- | --- | --- |
| `.obsidian/plugins/obsidian-local-rest-api/data.json` | 本机配置包含 64 字符 API key、TLS 私钥、证书和公钥 | 由目标机插件重新生成；重新配置后把该路径加入本机私密备份，不进入 Git/迁移包 |
| `app/.next/` | 生成物含缓存和可能的旧绝对路径 | 在目标机 `npm run build` 重建 |
| `app/tsconfig.tsbuildinfo` | TypeScript 增量缓存 | 在目标机重建 |
| `.DS_Store`、`__pycache__/`、`*.pyc` | 设备/解释器缓存 | 自动重建 |
| `docs/collaboration/.locks/*` | 进程锁文件没有跨机恢复价值；空 `.locks/` 目录保留 | task 工具按需重建锁文件 |

## 2. 明确排除的用户与系统状态

- `/Users/hoyin/.codex/auth.json`；
- Codex 本地 SQLite 状态库、会话缓存、历史、日志、shell snapshot、installation id；
- `/Users/hoyin/.codex/config.toml` 的值；其中存在 shell/MCP 环境变量配置，迁移包只记录非敏感的键名和启用能力；
- macOS Keychain；
- 飞书 CLI OAuth/token、用户身份缓存；
- Chrome、Codex 内置浏览器和其他浏览器 profile/cookie/session；
- SSH、GPG 私钥与 agent socket；
- 任何真实 `.env`、`.env.local`、密码、cookie、API token 或私钥；
- 其他项目和其他 Codex 任务的文件。

## 3. 已执行的项目侧检查

- 查找真实 `.env`、`.env.local`、常见 `*.pem`/`*.key`：未发现；`app/.env.example` 只含 fail-closed 本地默认值并保留。
- 常见私钥、OpenAI/GitHub/Slack/AWS token、Bearer blob 模式扫描：唯一真实敏感命中为 Obsidian Local REST 配置，已排除。
- 若干 `sk-` 命中来自 `task-...` 业务 ID、CSS 类名或测试文案的字符串片段，属于正则误报；没有作为真实 token 处理。
- 两份 SQLite 共扫描 125 行：上述常见秘密模式命中 0。
- Git remote 为空，没有 remote URL 或嵌入式 remote credential。
- portable 主归档在隔离目录解包后再次检查排除项和 symlink 边界。

## 4. 检查局限

模式扫描只能降低误带凭证的概率，不能给出数学意义上的零风险证明。完整 Git 历史与报告可能包含作者信息、历史绝对路径、公开 URL、飞书资源描述和业务内部决策；这些属于用户要求迁移的项目资料。迁移介质应加密或受控，且不应公开分享。
