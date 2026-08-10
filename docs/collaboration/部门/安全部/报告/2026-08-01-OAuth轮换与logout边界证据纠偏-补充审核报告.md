---
type: audit_report
department: 安全部
target: OAuth 轮换与 logout 边界证据纠偏
status: final
date: 2026-08-01
related_task: TASK-20260801-C51A87
decision: pass
tags: [OAuth, refresh_token, logout, revoke, 版本锁定, 证据纠偏]
summary: 条件式 PASS；吸收研究部官方证据，修正旧执行包关于 logout 仅清本地、refresh 生命周期和撤权证明的边界。OAuth v2 token 缩窄、refresh 一次性轮换及旧 access 在到期前并存已纳入新门禁；官方 CLI main 的 revoke 后删本地且忽略 revoke 错误已登记，但其与本机 v1.0.68 的精确运行映射仍为 Unknown，成功 JSON 不得作为服务端撤权证明。
---

# OAuth 轮换与 logout 边界证据纠偏补充审核报告

## 1. 任务范围与禁止动作

- 本补充只读取任务 JSON、研究部官方证据报告、原安全报告和仓库日志；不改写原历史报告。
- 本轮没有执行 `auth status`、`auth check`、`auth scopes`、`login`、`device-code`、`logout`、`revoke`、`refresh` 或任何其他认证命令。
- 本轮没有访问外部网络、官方站点、真实租户、真实 Base、应用、token、成员或资源 ACL。
- 本轮没有保存 token、refresh token、open_id、appId、完整 URL 或认证原始 JSON。
- 本报告只负责调和证据与修订未来用户确认门禁，不授权重授权、token 刷新、撤权、logout 或飞书资源操作。

## 2. 证据来源与版本边界

### 2.1 研究部官方证据

本报告吸收 `TASK-20260801-F4526F` 及其本地文件 `docs/collaboration/部门/研究部/报告/2026-08-01-飞书OAuth最小Scope与撤权轮换官方语义核验.md` 的官方一手资料整理。该报告记录的资料范围包括飞书官方 OAuth v2 文档、官方 `larksuite/cli` 仓库源码与变更日志、以及本机 CLI 帮助和嵌入文档；研究部报告本身未执行认证或真实资源操作。

### 2.2 已确认的 OAuth v2 语义

以下语义由研究部报告引用的官方 OAuth v2 资料支持：

1. token 交换可以将本次 token scope 缩窄到用户已授权集合的子集；请求越界、重复项等错误需要以官方响应处理。
2. 刷新 user access token 时可以按用户已授权集合的子集请求 scope；响应中的 `scope` 是该 token 的实际生效范围，应以响应为准。
3. refresh token 一次性使用；刷新成功会返回新的 refresh token，旧 refresh token 立即失效。旧 refresh token 不能作为失败后的盲重试凭证。
4. 刷新成功不会立即使旧 access token 失效；旧 access token 在自身到期前仍可使用。因此存在旧 access token 与新 access token 的并存窗口，旧 refresh token 没有并存窗口。
5. 用户历史 grant 的单 scope 删除、公开服务端撤销全部 grant 的确切 API、撤权完成时延、事件投递和恢复语义仍为 `Unknown`。

### 2.3 CLI 版本与源码冲突

研究部报告同时记录了以下一手证据：

- 本机安装包版本为 `@larksuite/cli` **v1.0.68**；本机帮助显示 `auth login`、`auth logout` 为写风险命令。
- 官方仓库当前 `main` 的 `cmd/auth/logout.go` 实现尝试用 refresh token（无 refresh token 时回退 access token）调用 `larkauth.RevokeToken`，随后删除本地 token/config；撤权调用错误被忽略，最后仍输出成功形状的 `{ok:true, loggedOut:true}`。
- 官方 `CHANGELOG.md` 的 v1.0.53 条目记录过 `auth logout` 的服务端撤销行为；官方 device flow 源码会在授权 scope 中自动补 `offline_access`（若缺失）。这两项是官方源码/变更日志事实；它们与本机 v1.0.68 二进制的逐行映射仍为 `Unknown`。
- 本机 embedded `lark-shared` skill 仍写成“`auth logout` 只清本地登录态”，与当前仓库源码/变更日志存在漂移。

版本裁决：官方仓库 main 与 v1.0.53+变更日志足以证明“当前官方实现设计上尝试服务端 revoke 后清理本地凭证”，也足以证明“成功 JSON 不能证明 revoke 成功”。这些材料没有把 main 的精确代码路径与本机 v1.0.68 二进制逐行绑定，因此“本机 v1.0.68 每次 logout 必然执行该 revoke 路径”的结论保持 `Unknown`。仓库 `main` 是可变分支，未来实际操作前还必须固定 commit 或发布版本，并核对对应源码/变更日志；本任务不执行该操作。

## 3. 纠偏后的安全结论

### 3.1 logout/revoke 边界

`auth logout` 不再按“只清本地”作为唯一语义记录。当前安全结论分成三层：

| 层次 | 可确认内容 | 不能确认的内容 |
|---|---|---|
| 官方 main / 变更日志 | logout 设计上尝试服务端 revoke，再删除本地 token/config | main 代码是否与本机 v1.0.68 完全一致 |
| 命令返回 | revoke 错误被实现忽略；本地删除后仍可能返回成功 JSON | `{ok:true, loggedOut:true}` 是否代表服务端已撤权；不能代表 |
| 服务端状态 | 研究部资料确认存在撤权事件语义 `auth.user_access_token.revoked_v4` | 当前用户 grant 是否已删、撤权是否完成、旧 access 是否立即失效、事件是否已送达 |

因此，未来任何 logout 操作都必须把“本地凭证已删除”和“服务端结果”记录成独立层次：revoke 请求是否被接受、某个 token 是否被撤销、历史 grant 是否删除、所有旧 access/refresh 是否失效。HTTP 响应或撤权事件可以作为对应层次的证据，不能自动证明历史 grant 已删除或所有 token 已失效。若只得到成功 JSON、没有独立服务端证据，服务端撤权状态必须写为 `Unknown`。

### 3.2 refresh 与旧 access 并存

- 旧 access token 在刷新后仍可能有效至自身到期；新 token 验证通过不代表旧 access 已失效。
- 旧 refresh token 在刷新成功后立即失效；任何失败恢复都禁止盲重试旧 refresh token。
- 新 refresh token 必须在安全、独立且可审计的凭证上下文中完成保存和可读性确认，再允许继续使用；本地报告、日志和 shell 输出不能保存其原文。
- 轮换窗口必须同时记录：旧 access 过期时间、新 access 过期时间、新 refresh 是否已持久化、旧 refresh 是否已消费、消费者当前使用哪个 token。只保存脱敏状态和时间，不保存凭证原文。

### 3.3 scope 缩窄与历史 grant

- token 级缩窄已获官方证据支持：交换或 refresh 时请求已授权集合的子集，响应 `scope` 作为实际 token 范围。
- token 级缩窄不会自动删除用户历史 grant。历史 grant 的单 scope 删除仍为 `Unknown`。
- 原执行包中的“新 scope manifest”只能定义新 token 的候选范围；它不应被描述为平台已删除旧 grant。
- CLI device flow 自动补 `offline_access` 的事实（官方源码层面；本机 v1.0.68 映射仍 `Unknown`）必须进入新旧 scope diff；若用户不希望后台续期，必须在执行前确认 CLI 版本是否允许排除或改用不含 refresh 的授权路径。

## 4. 修订后的无损轮换门禁

### 阶段 A：版本锁定与证据准备

1. 固定实际执行的 CLI 版本、源码/变更日志对应版本和运行上下文；v1.0.68 未完成源码逐行绑定前，logout 行为保持 `Unknown`。
2. 把 M3/A read scope、维护例外、`offline_access`、未知权限和排除项分别列出；不把 token 缩窄清单当作历史 grant 删除清单。
3. 用户确认是否需要 refresh；若不需要，候选 manifest 不应无理由包含 `offline_access`。若必须使用当前 CLI device flow，必须把自动追加 `offline_access` 标为已知行为并纳入用户确认。
4. 保留旧 access 仍有效的时间窗口；记录旧 access 的到期时间和旧 refresh 的待消费状态，禁止在新凭证可验证前执行 logout。

### 阶段 B：获取或刷新新 token

未来经用户明确确认后，执行者只能使用已确认的 scope 子集。可采用以下两种路径之一，具体路径必须在执行前由用户选择：

**授权码/新授权路径**

- 使用精确 scope 子集请求新 token；响应中的 `scope` 是验收依据。
- 不把新 token 的成功当作旧 grant 已删除的证据。
- 若采用当前 CLI device flow，预期会自动补 `offline_access`；多余 scope 或自动补项超出用户确认时停止。

**refresh 路径**

- 用旧 refresh token 只执行一次受控 refresh，并在请求中显式使用已确认的 scope 子集。
- 成功后立即保存新 refresh token 的受控存在性，并读取新响应的 `scope`、过期时间和 token 状态摘要。
- 禁止重用旧 refresh token；失败或响应不完整时不能盲重试。
- 旧 access token 保留至自身到期或用户另行撤权，不把 refresh 成功解释为旧 access 已失效。

### 阶段 C：新 token 验证

1. 检查 token 返回的 `scope` 是否为用户确认的精确子集，是否出现额外 write/delete、权限管理或 `offline_access`。
2. 验证新 access 的到期时间、新 refresh 的受控保存状态，以及旧 access 的剩余有效窗口；任何一项无法确认都停止切换。
3. 仅在独立资源门禁批准后进行固定 M3/A 只读 canary；只读失败不能通过扩大 scope、切 bot 或使用 raw API 补救。
4. 先完成新 token 的身份、scope、资源读回和凭证存储验证，再讨论消费者切换；A/base_direct provider 和 Base 真值仍有独立用户门禁。

### 阶段 D：旧 token 与 logout/revoke 门禁

1. 新 token 验证失败、scope 漂移、资源 403、refresh 响应不完整或凭证保存失败时，保持旧 access 窗口，不执行 logout/revoke。
2. 新 token 全部验证通过后，用户单独决定是否清除本地凭证或请求服务端撤权；logout 不得作为轮换的前置步骤。
3. 若实际调用 logout，必须保存分层的脱敏结果：
   - 本地结果：本地 token/config 是否已删除；
   - 请求层结果：revoke 请求是否被接受及返回的错误/状态；
   - token 层结果：是否有证据证明目标 access/refresh 已撤销；
   - grant 层结果：是否有证据证明历史 grant 或全部相关 token 已删除/失效；`auth.user_access_token.revoked_v4` 只按事件语义记录，不能越级证明 grant 层完成。事件收据还必须能匹配目标用户/令牌并具备可审计的来源认证，单独看到事件类型不够。
4. 只收到 `ok=true`、`loggedOut=true` 或本地文件消失时，服务端撤权仍记为 `Unknown`。实现忽略 revoke 错误时，不能把成功 JSON提升为服务端证明。
5. 服务端撤权未获独立证明时，不能自动重试 logout、不能盲目重授权、不能删除资源或切换业务 provider；交用户/平台管理员处理。

## 5. 修订后的验证矩阵与回退

| 验证项 | 通过条件 | 失败处理 |
|---|---|---|
| CLI 版本 | 实际二进制、源码/变更日志和执行上下文一致 | 停止 logout/revoke；版本行为标 `Unknown` |
| 新 token scope | 返回 `scope` 精确等于用户确认子集，无未授权额外项 | 停止使用新 token，保留旧 access 窗口 |
| refresh 状态 | 新 refresh 已受控保存；旧 refresh 不再重用；过期时间有脱敏记录 | 不盲重试旧 refresh；转用户确认的重新授权路径 |
| 旧 access 窗口 | 旧 access 的到期时间已知且回退窗口覆盖切换 | 暂停消费者切换，不能先 logout |
| M3/A read canary | 固定资源只读成功，schema/分页/唯一性/生效谓词通过 | 不扩大 scope、不切 provider、不写资源 |
| logout 本地结果 | 本地删除状态有脱敏收据 | 将本地状态与服务端状态分开登记 |
| revoke 请求/token 层结果 | 有与目标 token 匹配的独立 HTTP/平台/撤权事件证据；请求被接受不等同 token 已撤销 | 请求层或 token 层无法确认时记 `Unknown`；不凭成功 JSON判定成功 |
| grant 删除 | 有公开官方契约或平台明确收据 | 保留为 `Unknown`；token 缩窄不当作 grant 删除 |

### 回退原则

- 新授权或 refresh 失败：旧 access 不变，停止切换；旧 refresh 是否已消费需单独判断，禁止盲重试。
- 新 token 已生成但验证失败：在旧 access 有效窗口内维持旧路径或停机；不执行 logout。
- 新 token 验证通过但 logout/revoke 结果不明：新旧凭证状态分别登记，服务端撤权保持 `Unknown`，等待用户/平台管理员确认。
- 旧 refresh 已消费且新 refresh 丢失或不可读：不能依赖旧 refresh 恢复；转受控重新授权，不能删除业务资源或恢复第二真值。
- 任何阶段出现凭证原文、认证原始 JSON、token 写入仓库/日志，立即停止并按密钥泄露事件处理。

## 6. 失败路径与停止条件

1. **版本映射失败：** 无法把官方 main 源码/变更日志映射到本机 v1.0.68 时，不声称本机 logout 必然执行 server revoke；不得执行 logout 作为探针。
2. **refresh 一次性失败：** refresh 成功后旧 refresh 已失效，新 refresh 未保存、响应不完整或重试返回已使用/已撤销错误时停止；保留旧 access 窗口，转用户确认的重新授权。
3. **本地删除与服务端撤权分裂：** logout 返回成功或本地凭证消失，但没有独立 revoke 证据时，判定“本地清理已发生、服务端撤权 Unknown”；不得自动清理更多凭证、重试或把结果写成撤权完成。

## 7. 用户确认点

用户在未来任何认证状态变更前，需要逐项确认：

1. 实际执行 CLI 版本和官方源码 commit/release 是否固定，是否取得对应源码/变更日志收据；
2. 是否采用授权码/新授权路径或一次性 refresh 路径；
3. 新 token 的精确 scope 子集、是否包含 `offline_access`，以及 device flow 自动补 scope 的影响；
4. 是否接受旧 access 在到期前继续有效，及旧 refresh 在成功 refresh 后立即失效；
5. 新 refresh 的安全存储、读取确认和失败回退窗口；
6. 新 token 验证通过前禁止 logout/revoke；
7. 是否允许执行 logout；若允许，是否接受本地凭证可能先被删除、服务端 revoke 结果可能因实现忽略错误而未知；
8. 服务端撤权的独立证明来源（平台收据、事件或管理员确认）；仅 CLI 成功 JSON不满足该门禁；
9. 是否将历史 grant 单 scope 删除继续保持 `Unknown`，不把 token 缩窄写成平台 grant 删除；
10. 任何失败是否停留在旧 access 窗口、停止 provider/业务切换并等待用户或平台管理员处理。

## 8. 对原安全报告的明确取代关系

本补充不修改原文件 `docs/collaboration/部门/安全部/报告/2026-08-01-OAuth142scopes最小化与无损轮换执行包-审核报告.md`。从本补充发布起，以下原表述在涉及 logout、refresh 和撤权证明时由本报告取代：

| 原报告位置/原表述摘要 | 本补充取代后的表述 |
|---|---|
| 第 7.2 节：`auth logout --json` 为写风险，“清除本机 token；不能当作服务端撤权” | 官方 main/变更日志显示 logout 设计上尝试 server revoke 后删本地；实现忽略 revoke 错误，成功 JSON不能证明服务端撤权；本机 v1.0.68 的精确路径仍 Unknown。 |
| 第 7 节末段：`auth logout` “只清本机登录态” | 该句不再作为当前统一结论；改用“版本相关：官方实现尝试 revoke 后清本地，嵌入 skill 仍写只清本地，必须固定版本并分别验证本地清理与服务端撤权”。 |
| 第 8 阶段 5 第 2 点：logout“只清本机登录态”，服务端撤权全为 Unknown | 改为“logout 可能先尝试 revoke 再清本地；错误可被忽略；服务端结果必须有独立证据，成功 JSON不够”。 |
| 第 8 阶段 2/3：轮换重点为新旧 token 并存能力 Unknown | OAuth v2 refresh 一次性轮换已获官方证据支持：旧 refresh 立即失效，旧 access 在到期前继续有效；并行凭证存储和 CLI 本机映射仍 Unknown。 |
| 第 12 节未验证项：refresh token 生命周期整体 Unknown | 改为“v2 一次性 refresh、旧 access 并存窗口已验证；具体 v1.0.68 CLI存储/刷新实现、过期时间和服务端撤权后时序仍 Unknown”。 |
| 第 13 节错题自检：没有把 CLI logout 描述为服务端撤权 | 改为“没有把 logout 成功 JSON或本地删除写成服务端撤权完成；已登记官方实现尝试 revoke、忽略错误及版本漂移”。 |

原报告关于“当前任务不执行认证状态变更”“不保存凭证”“用户确认前不运行 login/logout/revoke/refresh”“历史 grant 单 scope 删除 Unknown”的边界继续有效。

## 9. 已验证 / 未验证

### 已验证

- `TASK-20260801-C51A87` 已领取；任务只授权只读文档纠偏，不授权认证状态或飞书资源变更。
- 研究部官方证据已提供 OAuth v2 token scope 缩窄、refresh 一次性轮换、旧 access 到期前继续有效、撤权事件语义和 scope/grant/ACL 分层。
- 研究部官方 CLI 源码/变更日志证据显示 logout 设计上尝试 revoke 后删除本地凭证，且实现忽略 revoke 错误；成功 JSON不能单独证明服务端撤权。
- embedded `lark-shared` 与官方实现/变更日志的 logout 语义漂移已被明确记录，未沿用单一旧结论。
- 原安全报告的相关句子已列出取代关系；原报告文件未修改。

### 未验证

- 官方 main 源码与本机 v1.0.68 二进制的逐行映射；因此本机 v1.0.68 logout 的实际 revoke 调用仍为 `Unknown`。
- 当前用户实际 grant、服务端撤权状态、撤权事件是否送达、撤权完成时延、旧 access 的现场失效时间。
- 当前 CLI 对 refresh token 的本地保存、轮换、并行 token 选择和失败恢复实现。
- 历史 grant 单 scope 删除、公开服务端撤权 API 的请求/幂等/完成契约和授权管理 UI 的当前操作步骤。
- 任何真实 login/logout/revoke/refresh、token 状态、资源 ACL 或飞书资源读写结果。

## 10. 错题自检与结论

- 没有修改原安全报告，也没有把本补充写成对历史取证时态的回写。
- 没有把官方 main 代码直接冒充本机 v1.0.68 的现场行为；版本映射明确保留为 `Unknown`。
- 没有把 logout 成功 JSON、本地凭证删除或 CLI 返回码写成服务端撤权完成。
- 没有把 token scope 缩窄写成历史 grant 单 scope 删除。
- 没有把 refresh token 当作可重复使用，也没有忽略旧 access 在到期前继续有效的并存窗口。
- 没有提出先 logout 再轮换；新 token 验证、旧 access 窗口、独立撤权证据和失败回退均设为前置门禁。
- 没有执行任何 auth 命令、外部访问、token 操作或飞书资源操作。

**结论：条件式 PASS。** 本补充已吸收研究部官方证据，纠正原执行包对 logout、refresh 和服务端撤权证明的过窄表述。后续执行必须固定 CLI 版本；refresh 按一次性 token 处理并保留旧 access 到期前的并存窗口；logout 可能尝试 server revoke 后删除本地凭证，revoke 错误可被忽略，成功 JSON不能证明服务端撤权。用户未确认精确路径、凭证存储、旧 access 保留窗口和独立撤权证据前，安全部不执行任何认证状态变更或飞书资源操作。
