---
type: audit_report
department: 安全部
status: final
date: 2026-08-02
related_task: TASK-20260802-026EC3
domain_stage: project-migration-target-credential-disposition-review
execution_mode: local_read_only
decision: fail
severity_count: { P0: 0, P1: 2, P2: 1 }
target: ".obsidian/plugins/obsidian-local-rest-api/data.json; plugin manifest/community enablement; migration exclusions; Git ignore; local process and client boundary"
target_revision: "git:a9691e71b1552592cc5ded8d5db66c336262301c; metadata observed 2026-08-02T18:48+08:00"
tags: [migration, obsidian, local-rest-api, credential-disposition, read-only]
summary: "唯一建议：保留插件和精确 .gitignore 规则；由用户在确认 Obsidian 已退出、客户端已切换且安全选项明确后，仅删除旧 data.json，随后按插件缺失配置路径重新生成 API key 与 TLS 材料并逐一更新客户端。本轮因进程占用、配置安全开关值和外部客户端依赖无法独立证明，未执行删除或重生成，结论为 FAIL（P1 处置门禁）。"
---

# 旧机 Obsidian Local REST 凭证处置安全复核

## 1. 唯一建议与结论

本轮唯一建议是：**保留 `obsidian-local-rest-api` 插件，仅由用户控制删除旧 `data.json`，在确认客户端迁移和 Obsidian 退出后，按插件的缺失配置路径重新生成新 API key、私钥、公钥和 TLS 证书；不删除插件，不复制或恢复旧配置，不把任何值写入报告、仓库或日志。** 当前结论为 **FAIL**，P0=0、P1=2、P2=1。

FAIL 由两个仍开放的安全门组成：

1. 迁移安全排除的凭证配置仍存在，文件权限为 `0644`；旧 API key/TLS 材料是否仍被任何客户端使用无法在本轮独立证明。
2. 本机进程清单受 `sysmond` 不可用影响，外部客户端不在仓库范围内；`lsof` 当时未观察到打开句柄，不能据此证明 Obsidian 已退出或不存在其他依赖。

这份 FAIL 约束后续处置顺序，不批准本会话执行删除。用户需要单独控制删除、重生成、客户端重配和最终复验。

## 2. 审查范围与安全边界

任务 `TASK-20260802-026EC3` 已按协议领取，取证基线为项目 Git `a9691e71b1552592cc5ded8d5db66c336262301c`。本轮只读检查了：

- `.obsidian/plugins/obsidian-local-rest-api/data.json` 的路径、存在性、文件类型、模式、所有者、大小、mtime、结构类型和顶层键名；没有把任何 JSON 字段值、API key、私钥、证书正文或公钥正文输出到终端、报告、任务 JSON、日志或备份。
- `.obsidian/community-plugins.json`、插件 `manifest.json`、`.gitignore`、Git 跟踪/忽略/历史状态。
- `migration/SECURITY-EXCLUSIONS.md`、`migration/manifests/archive-exclusions.txt` 和 restored-project verifier 的精确排除合同。
- 插件 bundle 中的默认绑定地址、默认端口、缺失配置时的生成逻辑、`saveData` 持久化路径和“Reset all crypto”行为；未执行 bundle、未启动插件、未调用 API。
- `lsof` 对目标文件的句柄观察、受限的进程检查结果，以及仓库内非 `data.json` 的客户端引用扫描。

没有删除、移动、复制、chmod、启动 Obsidian、生成新凭证、修改 `.gitignore`、修改插件配置、安装依赖、联网或访问外部资源。

## 3. 脱敏独立证据

### 3.1 文件与 Git 状态

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 目标路径 | **存在** | `./.obsidian/plugins/obsidian-local-rest-api/data.json` |
| 文件元数据 | **已验证** | 常规文件；owner `hoyin:staff`；mode `0644`；size `3724` bytes；mtime `2026-07-31T13:46:52+0800`。未读取或输出值。 |
| 结构元数据 | **已验证** | JSON root 为 object，顶层键数为 5；仅记录键名 `apiKey`、`crypto`、`enableInsecureServer`、`insecurePort`、`port`，未记录任何对应值。 |
| 当前 Git 跟踪 | **未跟踪** | `git ls-files --error-unmatch -- .obsidian/plugins/obsidian-local-rest-api/data.json` 未命中。 |
| 当前 Git 忽略 | **已验证** | `.gitignore:18` 精确忽略 `.obsidian/plugins/obsidian-local-rest-api/data.json`；`git check-ignore -v` 命中同一条规则。 |
| Git 历史 | **未发现路径历史** | `git log --all -- <target>` 无输出；不能替代凭证泄露的历史扫描，但没有发现该路径的 Git 提交记录。 |

`0644` 使文件对拥有工作区访问权的本地主体可读。上层 `Documents` 当前 mode 为 `0700`，降低了普通本机用户从路径遍历读取的可能性；这不改变凭证明文落盘和旧凭证仍可能有效的风险。

### 3.2 迁移排除合同

- `migration/SECURITY-EXCLUSIONS.md:7` 将该路径定义为含旧机 API key、TLS 私钥、证书和公钥的本机配置，目标机处理方式为由插件重新生成，且不进入 Git/迁移包。
- `migration/manifests/archive-exclusions.txt:8` 将同一路径列为 API key/TLS private key/cert 排除项。
- `migration/scripts/verify-restored-project.sh:85-88` 只要该路径存在就返回 `RESTORE_VERIFY_FAIL | excluded Obsidian Local REST secret config is present`。
- 测试部 pre-clean 报告已独立记录同一文件重新出现导致清理门禁 FAIL；本轮保留该历史事实，没有把它改写为 post-clean 或已清理。

因此，当前文件的正确迁移语义是“旧机私有配置残留，必须在用户控制下处置并按需重生成”，不是把文件加入迁移包、Git 或普通备份。

### 3.3 插件启用、版本与生成路径

- `.obsidian/community-plugins.json:4` 仍启用 `obsidian-local-rest-api`。
- `manifest.json` 显示插件 `Local REST API with MCP`、版本 `5.0.3`、desktop-only；插件 bundle、manifest 和 styles 当前均存在，但这些文件未被本任务修改。
- bundle 中的静态默认值为：绑定地址 `127.0.0.1`、HTTPS 端口 `27124`、HTTP 端口 `27123`、`enableInsecureServer=false`。`loadSettings()` 会把 `data.json` 合并到默认值；本轮没有读取配置值，因此旧文件中是否显式打开不安全 HTTP、是否改变端口等保持未验证。
- `onload()` 在 `settings.apiKey` 缺失时使用 CSPRNG 产生新随机材料并保存新 API key；在 `settings.crypto` 缺失时生成 2048-bit RSA key pair、自签 TLS certificate，并保存 `cert/privateKey/publicKey`。这证明删除旧配置后存在本地重生成路径。
-设置页的“Reset all crypto”会删除 `apiKey` 与 `crypto` 字段、保存设置并重新加载插件；本轮没有点击或调用该动作。

保留插件是最小变更：插件本体仍是重生成机制，任务证据没有要求删除它；删除插件会让依赖该本地 API 的客户端失效并增加重新安装/来源验证范围。

### 3.4 进程与客户端占用

- `ps`/`pgrep` 无法取得进程列表，系统返回 `sysmond service not found` / `Cannot get process list`；该环境不能证明 Obsidian 是否正在运行。
- `lsof -nP -- .obsidian/plugins/obsidian-local-rest-api/data.json` 返回 exit 1 且无句柄输出，表示取证瞬间没有观察到该文件的打开句柄；它不能证明进程已经退出，也不能排除启动后已读入内存的旧凭证或其他副本。
- 仓库范围扫描没有找到明确的 Local REST API 客户端配置；外部脚本、快捷指令、MCP 客户端、编辑器集成和其他本机进程不在本任务可证明范围内。

## 4. 风险分级

| 编号 | 等级 | 判定 | 处置出口 |
| --- | --- | --- | --- |
| P1-01 | P1 | 迁移排除的旧凭证配置存在，权限 `0644`，且当前旧 API key/TLS 材料是否仍被客户端使用未知。 | 用户确认客户端清单并完成切换后，仅删除旧 `data.json`；不得复制旧值或写入报告。 |
| P1-02 | P1 | 进程清单、配置安全开关值和外部客户端占用无法独立验证；`lsof` 的无句柄观察不足以证明安全删除时机。 | 由用户确认 Obsidian 完全退出、客户端已停用/切换，并确认 HTTPS/loopback 安全选项后再处置。 |
| P2-01 | P2 | 插件已启用且插件文件当前未被 Git 跟踪；本轮没有独立验证插件来源、签名或重新安装链路。 | 保留当前插件用于本地重生成；后续若重装，另行固定来源和版本，不把本轮 PASS 扩展为供应链结论。 |

本轮没有形成 P0 证据：当前代码的默认绑定是 loopback，未观察到外部网络调用或真实客户端行为；`enableInsecureServer` 等旧配置值未读取，相关风险已经在 P1-02 保留，不能据默认值推断当前运行态安全。

## 5. 唯一处置流程（用户控制）

### 5.1 删除前门禁

1. 用户确认 Obsidian 已完全退出，并暂停所有可能调用 Local REST API 的脚本、MCP 客户端、快捷指令和编辑器集成；本任务不执行进程操作。
2. 用户确认旧客户端不再把旧 API key 或旧 TLS certificate 作为有效凭证；任何清单、截图或收据都必须遮蔽值。
3. 用户确认插件仍需保留，并在重新生成后使用 HTTPS + loopback；不安全 HTTP 必须保持关闭，绑定地址不能改为 `0.0.0.0` 或其他外部地址。
4. 删除前只保留路径、mode、size、mtime 等非秘密元数据；禁止复制文件、导出值、计算并传播可关联凭证的内容摘要。

### 5.2 最小动作

由用户在上述门禁满足后，仅删除：

```text
.obsidian/plugins/obsidian-local-rest-api/data.json
```

不要删除 `.obsidian/plugins/obsidian-local-rest-api/`，不要修改插件源文件，不要修改任务/报告/Spec/ADR/data/design。当前 `.gitignore:18` 已有精确规则，不需要再添加重复规则。

### 5.3 删除后与按需重生成

1. 在重新打开 Obsidian 前，用户用仅检查存在性的 verifier 确认旧 `data.json` 已不在工作区；该阶段可复核迁移排除门已解除。
2. 只有在确实需要本地 API 时才重新打开/启用插件。缺失 `apiKey`/`crypto` 时，插件会在 onload 中生成新 API key、2048-bit RSA 私钥/公钥和自签 TLS 证书并保存到新的配置文件。
3. 如果选择设置页的“Reset all crypto”，只由用户在 UI 中操作；该动作会同时废弃旧 API key 和旧 TLS 材料，随后重新加载插件。
4. 将新凭证只写入各客户端的受控秘密存储，并逐一替换旧 API key、旧证书信任或固定指纹；禁止把值写进仓库、普通日志、任务 JSON 或报告。
5. 重新生成后的 `data.json` 仍属于私有配置，必须继续由 `.gitignore` 和迁移排除合同保护；再次运行“目标工作区应无该文件”的 pre-clean verifier 时，应在报告中注明这是按需生成后的预期差异，而不是把新配置重新纳入迁移包。

### 5.4 回退与失败路径

- 删除前发现 Obsidian/客户端仍在使用旧配置：停止删除，先完成客户端迁移；不通过复制旧文件回退。
- 重新生成后某客户端失效：只从受控秘密存储恢复客户端配置，或再次由插件生成一套新的凭证；不恢复旧 `data.json`。
- 证书信任失败：重新分发新证书的受控信任材料，或暂时停用该客户端；不得为绕过证书问题打开不安全 HTTP 或外部绑定。
- 无法确认是否存在外部客户端：保持旧文件不动并继续 P1-02，直到用户完成客户端盘点；本轮不把“仓库无引用”写成“全机无引用”。

## 6. 必测失败路径与反向检查

1. **旧文件残留**：当前目标文件存在，且迁移 verifier 明确会 exit 4；证明安全排除门确实阻断残留配置。
2. **权限与泄露边界**：文件为 `0644`，上层 `Documents` 为 `0700`；检查结果只用于风险分级，没有读取值或把文件复制到临时目录。
3. **占用误判**：进程清单不可用、`lsof` 无句柄；将占用结论保留为 Unknown，避免把一次点-in-time 观察当作已安全关闭。
4. **客户端误判**：仓库没有明确客户端引用，外部客户端仍 Unknown；不以代码搜索结果替代客户端迁移确认。
5. **重生成可达性**：静态代码确认缺失配置触发新 API key 与新 TLS 材料生成；没有执行生成器、启动插件或真实 API 请求。

## 7. 已验证 / 未验证

### 已验证

- 目标文件存在、类型、owner、mode、size、mtime 和 JSON 结构元数据；没有输出任何 JSON 值。
- 文件未被当前 Git 跟踪，精确 `.gitignore` 规则已存在，Git 历史没有该路径提交记录。
- 迁移排除合同、归档排除清单和 restored-project verifier 对该路径的处理一致。
- 插件仍在 community plugin enablement 中，manifest 版本为 `5.0.3`。
- 插件默认 loopback/端口、缺失配置时的 API key/TLS 生成路径、`saveData` 持久化和 Reset all crypto 入口已从本地 bundle 静态核对。
- 取证瞬间 `lsof` 未观察到目标文件打开句柄；仓库范围客户端引用未发现。

### 未验证

- Obsidian 进程当前是否运行、是否已把旧凭证读入内存；系统进程清单因 `sysmond` 不可用而无法取得。
- `enableInsecureServer`、端口等旧 `data.json` 配置值及当前实际监听状态；本轮禁止读取这些值。
- 外部脚本、MCP 客户端、快捷指令、编辑器集成或其他本机进程是否依赖旧 API key/证书。
- 删除后用户实际重生成、客户端重新配置、旧凭证失效和新证书信任验证。
- 插件包的供应链来源、签名、未来重装路径；这些不影响本轮“保留插件、只处置旧配置”的最小建议。

## 8. 错题自检

- 没有输出、持久化或备份 `data.json` 的任何 API key、私钥、证书、公钥或其他配置值；报告只保留路径和非秘密元数据。
- 没有把 `.gitignore` 规则误写成凭证已经失效；忽略规则只能防止未来 Git/迁移带入，不能轮换旧凭证。
- 没有把默认 `127.0.0.1`、默认关闭 HTTP 或 `lsof` 无句柄误写成当前运行态已证明；旧配置值和进程状态均列为未验证。
- 没有把仓库无客户端引用扩大成全机无客户端；外部客户端依赖仍要求用户确认。
- 没有自行删除、移动、复制、chmod、启动 Obsidian、生成凭证或修改 `.gitignore`；没有同步删除插件。
- 没有把测试部历史 pre-clean FAIL 改写成 post-clean 已完成；本任务只新增本独立安全处置报告。

## 9. 需要用户决定

用户需要在执行任何处置前确认：

1. 是否已停用并盘点所有旧 Local REST API 客户端；
2. 是否确认 Obsidian 已完全退出且允许仅删除 `data.json`；
3. 是否确认保留插件、按需重新生成新 key/TLS 材料，并将新值只放入受控秘密存储；
4. 是否确认 HTTPS + loopback 保持启用，HTTP insecure 和外部绑定保持关闭。

本任务至此只提交安全建议和边界，不替用户执行上述动作。

TASK_STATE_OK
