---
type: work_report
department: 研究部
target: 飞书 OAuth 最小 scope 与撤权轮换官方语义
status: final
date: 2026-08-01
related_task: TASK-20260801-F4526F
decision: user_choice_required
tags: [OAuth, scope, user_access_token, refresh_token, 撤权, lark-cli, Base]
summary: 官方资料支持按操作拆分 Base 只读 scope，并确认 token 级缩窄、refresh 单次轮换与旧 access token 在到期前继续有效；用户 grant 的单 scope 删除、公开服务端撤权 API 与撤权后的恢复时序仍为 Unknown，且 lark-cli 文档与当前实现存在版本冲突。
---

## 背景

本报告为 `TASK-20260801-F4526F` 的收口证据。目标是核验飞书 OAuth 最小 scope、Base 只读能力、缩权、token 轮换、CLI logout 和服务端撤权语义，为后续产品与安全决策提供可追溯的一手证据。

取证日期为 **2026-08-01（Asia/Shanghai）**。资料范围仅包括：

- 飞书开放平台（`open.feishu.cn`）官方开发文档和权限/事件文档；
- Lark/Feishu 官方 CLI 仓库 `larksuite/cli` 及本机安装包的官方嵌入文档、变更日志；
- 本机 CLI 帮助文本的只读检查。

本次没有登录、登出、撤权、读取授权状态、调用 `auth status --verify`，也没有访问或修改任何真实 Base、租户、应用、token、成员或资源 ACL。CLI 的命令帮助只用于确认可用命令和风险标记。

## 结论

### 1. 有效访问由三层共同决定

应分别记录以下三层，不能把它们合并为一个“scope 已有/没有”的判断：

1. **App 已开通/发布的 API scope**：开发者在开放平台为应用申请并开通的能力；未开通时，授权页可能返回 `20027`。
2. **用户实际 grant**：用户在授权页同意的权限集合。飞书文档说明该集合会累积历史已同意权限；后续 token 可以从这个集合中进一步缩窄。
3. **资源 ACL/数据范围**：调用者作为用户、协作者、管理员或其他资源角色对具体 Base/文档的可读范围。API scope 通过后，资源 ACL 仍可能导致 403 或空结果。

对用户 token，可用的实际能力可按“`app_opened ∩ user_grant ∩ resource_acl`”理解；这是对官方三类限制的组合推导，交集表达式本身不是飞书 API 字段。

官方依据： [应用权限概述](https://open.feishu.cn/document/server-docs/application-scope/introduction?lang=zh-CN)、[如何选择 token 类型](https://open.feishu.cn/document/faq/trouble-shooting/how-to-choose-which-type-of-token-to-use?lang=zh-CN)、[权限概述](https://open.feishu.cn/document/server-docs/docs/permission/overview)（均于 2026-08-01 取证）。

### 2. Base 只读没有一个通用的“最小 scope”；应按操作拆分

下表给出当前公开权限列表可核对的粒度。精确 key 来自 [官方 scope 列表](https://open.feishu.cn/document/server-docs/application-scope/scope-list?lang=zh-CN)；Base API 文档中的“查看/评论/编辑/管理”是接口的聚合权限描述，不能反向改写成新的 granular key。

| 目标操作 | 建议的最小 granular scope | 官方用途/对应 API | 重要边界 |
|---|---|---|---|
| 读取 Base 元数据 | `base:app:read` | 获取多维表格信息；[获取多维表格元数据](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/get?lang=zh-CN) | 仍须通过具体 Base 的 ACL；不能推出可读所有表/记录 |
| 列出数据表 | `base:table:read` | 获取数据表信息；[列出数据表](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/list?lang=zh-CN) | 只覆盖表级元数据能力 |
| 列出字段 | `base:field:read` | 获取字段信息；[列出字段](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list?lang=zh-CN) | 不等同于读取记录值 |
| 列出视图 | `base:view:read` | 检索视图；[列出视图](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-view/list?lang=zh-CN) | 不等同于读取表中全部记录 |
| 读取表单元数据/表单数据 | `base:form:read` | 获取表单数据；[获取表单元数据](https://open.feishu.cn/document/server-docs/docs/bitable-v1/form/get?lang=zh-CN) | 页面 scope 文案为“获取表单数据”，表单资源 ACL 仍适用 |
| 按记录 ID 读取 | `base:record:read` | 检索特定记录、批量获取记录及相关记录读取事件 | 只给已有 ID 的读取路径；不要据此宣称可任意搜索 |
| 按条件查询/列出记录 | `base:record:retrieve` | 根据条件搜索记录；[搜索记录](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-table-record/search) | 高级权限 Base 还要求调用者具备相应管理员/协作者 ACL；结果为空不自动证明 scope 不足 |
| 读取自定义角色 | `base:role:read` | 查询自定义角色；[列出自定义角色](https://open.feishu.cn/document/server-docs/docs/bitable-v1/advanced-permission/app-role/list?lang=zh-CN) | 这是权限管理元数据，不是记录数据权限 |
| 读取 Base 协作者 | `base:collaborator:read` | 列出协作者；Base 资源模型见 [多维表格概述](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview?lang=zh-CN) | 仍受资源管理员/协作者边界影响 |
| 读取云文档/Base 的公共权限设置 | `docs:permission.setting:read`（scope 列表还列出 `docs:permission.setting:readonly`） | [获取公共权限设置](https://open.feishu.cn/document/server-docs/docs/permission/permission-public/get?lang=zh-CN) | API 页面将 scope 以聚合人类文案显示；`docs:permission.setting:read` 是该接口直接对应项，`readonly` 的接口映射需在实际授权前以当前控制台/CLI scope 元数据复核 |
| 需要 refresh token | `offline_access` | 持续访问已授权数据；必须同时在授权请求中申请 | 这不是 Base 数据 scope；会扩大凭证生命周期，只有确有后台续期需求才申请 |
| 订阅/读取 user token 撤权事件 | `auth:user_access_token:read` | 读取/订阅 user_access_token 或 refresh_token 撤权事件 | 该项服务于应用身份的事件能力，不等于当前用户的 Base 数据 grant |

两类聚合/历史名称需要谨慎处理：`bitable:app:readonly` 的官方文案为查看、评论和导出多维表格，覆盖面明显大于上述按操作拆分的 granular profile；历史 `bitable:bitable:readonly` 已标注不再维护，不能作为新的最小方案。当前 scope 列表页面的页面元数据显示最后更新时间为 2023-07-12，页面内容是动态权限表，因此正式实施前仍需在当日控制台或版本化 CLI scope 元数据复核；本报告只把页面中可直接核对的 key 作为公开证据。

## 精确 scope / 用途 / 证据 / 不确定性矩阵

| scope/能力 | 用途与官方证据 | App 开通 | 用户 grant | 资源 ACL | 置信度与不确定性 |
|---|---|---|---|---|---|
| `base:app:read` | scope 列表“获取多维表格信息”；Base 元数据 GET 文档 | 需开通并发布 | 需用户授权该 scope（用户 token） | 需对目标 Base 有可读范围 | 高；scope key 与用途均有官方行 |
| `base:table:read` | scope 列表“获取数据表信息”；列出数据表 GET 文档 | 同上 | 同上 | 目标 Base/表 ACL | 高 |
| `base:field:read` | scope 列表“获取字段信息”；列出字段 GET 文档 | 同上 | 同上 | 目标 Base/表 ACL | 高 |
| `base:view:read` | scope 列表“检索视图”；列出视图 GET 文档 | 同上 | 同上 | 目标 Base/表 ACL | 高 |
| `base:form:read` | scope 列表“获取表单数据”；获取表单元数据 GET 文档 | 同上 | 同上 | 表单/Base ACL | 高；接口页面同时展示聚合权限文案 |
| `base:record:read` | scope 列表“检索特定记录”；记录读取 API | 同上 | 同上 | 记录所属表/Base ACL | 高；不推导任意条件搜索 |
| `base:record:retrieve` | scope 列表“根据条件搜索记录”；记录搜索 POST 文档 | 同上 | 同上 | 高级权限时需要相应管理员/协作者资格 | 高；搜索接口的高级权限限制单独存在 |
| `base:role:read` | scope 列表与自定义角色列表 API 均直接出现 | 同上 | 同上 | 资源权限管理范围 | 高 |
| `base:collaborator:read` | scope 列表“列出协作者”；Base 角色/成员 API | 同上 | 同上 | 资源管理员/协作者边界 | 中高；具体 Base 成员 API 的页面会显示聚合权限文案 |
| `docs:permission.setting:read` | scope 列表与公共权限设置 GET 文档的直接映射 | 同上 | 同上 | 必须是目标资源协作者/具备权限，否则文档示例返回 403 | 高 |
| `docs:permission.setting:readonly` | scope 列表存在同名只读项 | 同上 | 同上 | 同上 | 中；scope 行已见，但当前 API 页面没有把该 key 单独映射出来 |
| `docs:permission.public:read` | 历史/兼容 scope 列表行 | 同上 | 同上 | 同上 | 中低；保留作历史证据，不推荐新设计依赖 |
| `offline_access` | OAuth 文档说明用于 refresh token | App 后端需允许，且授权请求申请 | 用户必须同意 | 不改变资源 ACL | 高；只影响续期能力 |
| `auth:user_access_token:read` | 官方事件列表将其列为 `auth.user_access_token.revoked_v4` 相关 scope | 需为事件能力开通 | 是否由用户 grant 取决于授权模式 | 与 Base ACL 无关 | 高；不得当作 Base 读 scope |
| `bitable:app:readonly` | scope 列表/接口聚合文案“查看、评论和导出” | 需开通 | 需 grant | 仍受 Base ACL | 中高；聚合范围较大，不是最小 granular profile |

“App 开通”只说明应用可申请该 API；“用户 grant”只说明该用户在 OAuth 授权集合中同意；“资源 ACL”决定该身份对某个具体资源是否可见。三列都满足前，接口才可能成功。

## OAuth 生命周期核验

### 授权与 token 级缩权（已验证）

官方 [获取 OAuth code](https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code) 文档说明：

- 授权请求的 `scope` 以空格分隔、大小写敏感；应用必须先在开发者后台开通，单次授权请求最多 50 个 scope。
- 用户 grant 是累积的：新的 `user_access_token` 包含用户历次同意的权限集合；新增权限需要再次授权。
- 需要 refresh token 时，授权 scope 必须包含 `offline_access`。

官方当前 v2 [获取 user_access_token](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token?lang=zh-CN) 文档说明：

- 交换 `authorization_code` 时，`scope` 可选，用于将本次 token 的权限缩窄到用户已授权集合的子集；省略时使用用户已授权的全部范围。
- 请求 scope 必须是授权 code/用户 grant 的子集；越界报 `20068`，重复项报 `20067`。
- 用户授权 A+B 时，第一次交换请求 A 得到 A；再次交换请求 B 得到 B，缩窄结果不会在 token 之间累积。
- 返回体 `scope` 是该 token 的实际生效范围，应以返回值为准；它不能单独证明用户 grant 已被删除。

因此，“缩窄某个 access token”是已验证能力；“从用户历史 grant 中删除一个 scope”没有在本次官方公开资料中找到对应能力或公开单 scope 删除 API，列为 **Unknown**。

### Refresh token 轮换与新旧 token 并存（已验证）

官方当前 v2 [刷新 user_access_token](https://open.feishu.cn/document/authentication-management/access-token/refresh-user-access-token?lang=zh-CN) 文档说明：

- refresh token 为一次性使用；刷新成功会返回新的 refresh token，旧 refresh token 立即失效。错误示例包括已撤销/已使用、过期、scope 越界及应用不允许 refresh。
- 刷新请求同样可用 `scope` 缩窄到用户已授权子集；省略时使用用户授权范围；重复缩窄不会累积；应读取响应 `scope`。
- **旧的 `user_access_token` 不受刷新影响，在自身过期时间到达前仍可正常使用。** 所以刷新后存在旧 access token 与新 access token 的并存窗口；旧 refresh token 没有并存窗口。
- 有效期应使用响应值；文档另提示用户通常需要在 365 天内重新授权。该时限与账户/产品策略相关，不能替代响应中的具体过期时间。

历史 v1 文档（[旧版创建/刷新 token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/create?lang=zh-CN)）仍可检索，但属于旧接口语义；当前设计只采用 v2 文档。

### 撤权事件与手动撤权（部分验证）

官方 [事件列表](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-list) 定义 `auth.user_access_token.revoked_v4`：当 `user_access_token` 或 `refresh_token` 被撤销时触发；该事件关联 `auth:user_access_token:read`。这证明服务端存在撤权状态和事件通知语义。

本次在公开 `open.feishu.cn` 开发文档中没有找到一个可供产品直接调用、用于删除某一用户历史 grant 或保证撤销全部 token 的公共 Feishu API 页面。因此以下内容保持 Unknown：

- 用户授权历史中单独移除一个 scope 的公开 API/保证；
- 通过公开 API 一次性撤销某个 grant 的确切请求、幂等性、影响范围和完成时延；
- 撤权事件的投递延迟、重试、完整 payload 和恢复窗口；
- Feishu 授权管理页面的具体 UI 操作作为 API 契约的替代证明。

## lark-cli 核验与版本冲突

本机 `/opt/homebrew/bin/lark-cli` 指向 `@larksuite/cli`，安装版本为 **1.0.68**；只读取了帮助、官方嵌入 skill 文本和变更日志，没有执行任何认证或资源命令。

### 命令面

`lark-cli auth --help` 显示 `check`、`list`、`login`、`logout`、`qrcode`、`scopes`、`status`，没有 `auth revoke`、`auth token` 或 `oauth` 命令。`auth login` 支持 `--scope`、`--exclude`、`--recommend`、`--device-code` 等参数；`auth logout` 的帮助将其标成写操作。命令存在不代表本次允许执行，故均未调用。

### 当前官方仓库实现

官方仓库的 [cmd/auth/logout.go](https://github.com/larksuite/cli/blob/main/cmd/auth/logout.go#L518-L627) 当前实现对保存的用户 token 逐个执行：优先取 refresh token、无则回退 access token，调用 `larkauth.RevokeToken`，然后删除本地 token/config；撤权调用的错误被忽略，最后输出 `{ok:true, loggedOut:true}`。官方 [internal/auth/revoke.go](https://raw.githubusercontent.com/larksuite/cli/main/internal/auth/revoke.go) 显示请求为表单 POST，包含 `client_id`、`client_secret`、`token`、`token_type_hint`；[internal/auth/paths.go](https://raw.githubusercontent.com/larksuite/cli/main/internal/auth/paths.go#L286-L307) 将撤权路径定义为 `/oauth/v1/revoke`，token v2 路径为 `/open-apis/authen/v2/oauth/token`。这是官方 CLI 的实现证据；本次没有把该路径升级为“公开 Feishu 开发文档保证的通用 API”，因为公开开发文档检索未找到对应契约页。

官方 CLI [device_flow.go](https://raw.githubusercontent.com/larksuite/cli/main/internal/auth/device_flow.go#L43-L72) 还显示：设备授权流程在请求 scope 中自动补上 `offline_access`（若缺失）。因此，使用当前 CLI 的 `auth login` 时，显式 `--scope` 不应被误读成最终请求的完整 scope 集合；需要 refresh 的 CLI 设计可能主动带上该 scope。

### 文档/版本冲突

本机 `lark-cli skills read lark-shared`（skill 版本 v1.0.0，取证日期同上）的指导文字称 `auth logout` 只清理本地登录状态，服务端授权应另行在飞书授权管理中取消，且 CLI 不支持单 scope revoke。已安装包的 [CHANGELOG.md](https://github.com/larksuite/cli/blob/main/CHANGELOG.md#L286-L305) 在 v1.0.53 记录“`auth logout` 服务端撤销用户 token”，当前仓库实现也确实先调用撤权再删本地凭证。两份一手资料存在版本/嵌入文档漂移，不能给出脱离版本号的“logout 只本地”结论。

本报告采用的可操作结论是：

- 当前官方仓库 `main` 实现**尝试**服务端撤权；本机 v1.0.68 的变更日志和二进制字符串也显示该能力。实现即使撤权失败仍会清理本地凭证；
- 撤权是否成功不能仅凭 logout 的 `{ok:true}` 判断，因为实现忽略撤权错误；
- 旧版或嵌入 skill 文档可能仍只描述本地清理。任何真实操作前必须固定 CLI 版本并核对对应源代码/变更日志；本任务禁止执行该操作。

## 失败路径（1–3）与恢复建议

以下是只读研究后的风险路径，不是本次执行记录：

1. **App scope 未开通/未发布**：授权或 token 交换返回 `20027`。恢复需在开发者后台开通并发布精确 scope，再重新授权；不应直接把聚合 `bitable:app:readonly` 当作补救。
2. **授权集合或 token scope 不匹配**：token 交换/刷新请求超出用户已授权集合时返回 `20068`，重复项可能返回 `20067`。恢复应读取响应 `scope`，按已授权子集重发；确需新能力时重新走增量授权。资源 403 或高级权限空结果还应先检查 ACL，不能盲目扩大 scope。
3. **refresh/撤权轮换失败**：旧 refresh token 一次性使用后再次使用可能返回 `20064`/`20073`，过期可能返回 `20037`；CLI logout 还可能出现“本地已删、服务端撤权结果未知”的状态，因为当前实现忽略撤权错误。恢复建议是停止使用被怀疑的凭证、保留审计记录、固定版本后按已授权范围重新授权；若收到 `auth.user_access_token.revoked_v4`，将 grant 标记为 revoked 并要求重新授权。事件延迟和恢复时序未由公开文档证明。

## 已验证 / 未验证矩阵

| 状态 | 结论 |
|---|---|
| 已验证 | App scope 需先开通/发布；用户 grant 累积；OAuth v2 交换/刷新可按授权子集缩窄；返回 `scope` 是 token 有效范围；重复缩窄不累积；refresh token 一次性轮换且旧 refresh 立即失效；旧 access token 在自身到期前继续有效；`auth.user_access_token.revoked_v4` 代表 user/refresh token 撤权事件；当前官方 CLI 源码在 logout 中尝试 `/oauth/v1/revoke` 后清本地凭证；device flow 自动补 `offline_access`。 |
| 部分验证 | `base:collaborator:read` 与 `docs:permission.setting:readonly` 的 API 页面映射粒度；聚合 scope 与 granular scope 的版本兼容；官方 CLI 撤权 endpoint 的 host 由品牌 endpoint resolver 决定。 |
| 未验证 / Unknown | 用户历史 grant 的单 scope 删除；公开 Feishu 手动撤销全部 token/grant 的 API 契约；撤权完成时延、幂等性、事件 payload 与重试；授权管理 UI 的当前具体步骤；不同 CLI 版本的 logout 细节是否一致；真实租户/Base ACL 下每个 scope 的实际 HTTP 结果。 |

## 错题自检

- [x] 未登录、未登出、未撤权，未执行 `auth status --verify` 或任何会读取授权状态的命令。
- [x] 未访问真实 Base、未使用 app token/table ID/user token/成员 ID，未改变资源 ACL。
- [x] 没有把 app 开通 scope、用户 grant、token 返回 scope 和资源 ACL 当作同一层。
- [x] 没有把 `base:record:read` 误写为条件搜索，也没有把 API 页面聚合权限文案伪装成 granular key。
- [x] 没有把 refresh token 当作可重复使用，也没有声称刷新会立即使旧 access token 失效。
- [x] 记录了当前 CLI 源码/变更日志与嵌入 skill 的 logout 冲突，没有沿用“只清本地”的单一旧结论。
- [x] 将没有公开官方契约支撑的 grant 级单 scope 删除、手动撤权 API 和恢复时序保留为 Unknown。

## 建议下一步

1. 由产品/安全先选择实际操作 profile（元数据、schema、按 ID 读、条件查询、权限元数据、refresh），再在开发者后台为该 profile 开通最小 granular scope。
2. 真实授权前固定 CLI 版本，确认 scope 列表和 device flow 是否自动追加 `offline_access`；把授权响应 `scope`、token 到期时间、refresh token 轮换状态作为审计字段。
3. 若业务需要“删除历史 grant 的单个 scope”或“保证所有 token 立即失效”，应把它作为飞书官方支持边界的待确认项，不以 CLI logout 成功 JSON 代替服务端撤权证明。

## 一手来源（均于 2026-08-01 取证）

- 飞书 OAuth 授权页与累计 grant：[获取 OAuth code](https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code)
- 飞书 v2 token 交换：[获取 user_access_token](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token?lang=zh-CN)
- 飞书 v2 refresh 轮换：[刷新 user_access_token](https://open.feishu.cn/document/authentication-management/access-token/refresh-user-access-token?lang=zh-CN)
- 飞书应用权限与 scope：[应用权限概述](https://open.feishu.cn/document/server-docs/application-scope/introduction?lang=zh-CN)、[权限列表](https://open.feishu.cn/document/server-docs/application-scope/scope-list?lang=zh-CN)
- 飞书 Base 与权限：[多维表格概述](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview?lang=zh-CN)、[获取元数据](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/get?lang=zh-CN)、[列出数据表](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/list?lang=zh-CN)、[列出字段](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list?lang=zh-CN)、[列出视图](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-view/list?lang=zh-CN)、[搜索记录](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-table-record/search)、[获取表单](https://open.feishu.cn/document/server-docs/docs/bitable-v1/form/get?lang=zh-CN)、[列出自定义角色](https://open.feishu.cn/document/server-docs/docs/bitable-v1/advanced-permission/app-role/list?lang=zh-CN)
- 飞书资源 ACL：[权限概述](https://open.feishu.cn/document/server-docs/docs/permission/overview)、[获取公共权限设置](https://open.feishu.cn/document/server-docs/docs/permission/permission-public/get?lang=zh-CN)、[撤权事件列表](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-list)
- 官方 CLI：[仓库 README](https://github.com/larksuite/cli)、[logout 实现](https://github.com/larksuite/cli/blob/main/cmd/auth/logout.go#L518-L627)、[撤权请求实现](https://raw.githubusercontent.com/larksuite/cli/main/internal/auth/revoke.go)、[OAuth 路径常量](https://raw.githubusercontent.com/larksuite/cli/main/internal/auth/paths.go#L286-L307)、[device flow](https://raw.githubusercontent.com/larksuite/cli/main/internal/auth/device_flow.go#L43-L72)、[变更日志](https://github.com/larksuite/cli/blob/main/CHANGELOG.md#L286-L305)
- 本机官方 CLI：`/opt/homebrew/bin/lark-cli` → `@larksuite/cli` v1.0.68；`lark-cli skills read lark-shared` v1.0.0（嵌入文档）。二者只做只读查阅，嵌入文档与当前仓库实现的 logout 语义冲突已在正文记录。
