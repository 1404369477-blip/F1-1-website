# F1+1 环境与工具清单

记录时间：2026-08-02（Asia/Shanghai）

## 1. 机器与系统

| 项目 | 源机器实测 | 目标 |
| --- | --- | --- |
| Apple 芯片 | M1 | M5 |
| 架构 | arm64 | arm64 |
| macOS | 26.5.2 | 26.6 |
| build | 25F84 | 目标机安装后核验 |
| Shell | zsh | zsh 建议，脚本使用 bash |
| Xcode CLT | `/Library/Developer/CommandLineTools` | 重新安装并核验 |

## 2. 项目运行时

| 项目 | 固定版本/值 | 来源 |
| --- | --- | --- |
| Node.js | 24.18.0 | `app/.local/toolchains/node-v24.18.0-darwin-arm64`；warm layer |
| npm | 11.16.0 | 同一隔离工具链 |
| package manager | `npm@11.16.0` | `app/package.json` |
| Next.js | 16.2.11 | lockfile |
| React / React DOM | 19.2.0 | lockfile |
| TypeScript | 5.9.3 | lockfile |
| Vitest | 4.1.10 | lockfile |
| SQLite | Node 内置 `node:sqlite` 路径；当前报告记录 SQLite 3.53.1 | 目标机由 Node24 实测 |
| package-lock SHA-256 | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` | 打包前实测 |
| package.json SHA-256 | `95e2e7403c612bd6dac7375c8444c43d920b1c7a34949d3c047a4413093d5ac2` | 中断整改断点 |

源机器全局 Node 25.5.0/npm 11.8.0 仅用于普通系统工具，不满足项目 M4 固定运行时。项目检查必须使用 Node 24.18.0/npm 11.16.0。

## 3. 开发与操作工具

| 工具 | 源版本 | 迁移策略 |
| --- | --- | --- |
| Codex desktop | 26.727.51351，build 6119，bundle `com.openai.codex` | 在目标机重新安装并登录；不复制 auth/state/cache |
| Git | 2.50.1 Apple Git-155 | Xcode CLT 重装 |
| Python | 3.9.6 | Xcode CLT/系统工具；项目协作脚本已在该版本通过 doctor |
| Homebrew | 6.0.14 | 通过 Homebrew 官方入口重装 |
| ripgrep | 15.1.0 | `brew install ripgrep` 或兼容后继版本 |
| lark-cli | `@larksuite/cli` 1.0.68 | 固定版本重装并重新登录；不复制 Keychain/token |
| Obsidian | 项目 `.obsidian/` 插件与设置已保存 | 应用重装；Local REST secret 重新生成 |

## 4. 直接相关个人 Skills

Portable 主归档在 `migration/portable-assets/skills/` 内保存：

- `agent-team` 2.0.6：当前八部门、任务状态机、接班与审核协议的生成来源；
- `vibe-project-foundation`：项目初始地基模板与验证脚本。

飞书 CLI 的 `lark-shared` 指导由 `@larksuite/cli` 包内提供，未从源机器凭证目录导出；重装 1.0.68 后再只读核对。AI Hot v1.2.3 仅被研究和固定审计，没有安装为当前项目 Skill，因此迁移包不把第三方代码加入运行环境。

源机器还安装了 defuddle、GSAP、Obsidian、video-downloader、visual-image-collection 等个人 Skills。当前项目控制面和续接入口没有依赖它们，故只在清单中记录，不复制到项目包。

## 5. Codex 插件/能力

源配置记录以下插件启用：documents、spreadsheets、presentations、pdf、template-creator、browser、computer-use、visualize、sites、chrome。它们属于 Codex 管理的版本化插件缓存，应在新 Mac 通过账号/插件管理重新取得。直接复制 cache 可能遗留平台路径、签名状态和旧版本文件，因此没有进入归档。

## 6. Codex 配置键清单（无值）

源 `config.toml` 的值没有进入包。项目相关键类别如下：

- 模型、reasoning、verbosity、service tier；
- `features.multi_agent`、`features.memories`、`features.js_repl`；
- 项目 trust level，包括旧路径 `/Users/hoyin/Documents/F1+1`；
- shell environment policy 与若干外部服务/MCP 环境变量；
- marketplace/plugin enablement；
- desktop follow-up、sleep、locale、reasoning UI 设置；
- memories 开关；
- open-design、node_repl、computer-use MCP 定义。

目标机项目路径与用户名可能变化，旧 absolute path 配置不能直接复用。先在 Codex UI 中添加/信任恢复后的项目，再按需要手工恢复非敏感设置与插件。

