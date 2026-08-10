# TASK-20260810-875B6C 开发部完成报告

## 1. 结论

任务结果：**PASS**。

现行 raw authority gate 已在任何 WHATWG URL pathname 规范化之前切分原始 path/query，并对 raw path 中的 literal `.`/`..` segment、literal backslash 和任意 percent-encoded path 字节失败关闭；URL 解析后还要求 `pathname` 与 raw path 逐字相等。A5F239 首错 `/api/admin/alias/../session` 现在稳定返回 `ADMIN_HOST_DENIED`，不能被规范化为合法 `/api/admin/session`。

本任务只修改 `security.ts` 与一个新建聚焦测试；没有修改 session、CSRF、路由、SQL、数据库、listener/no-egress、依赖、public/UI、Spec、ADR 或 `package-lock.json`。

## 2. 固定输入

| 输入 | SHA-256 | 结果 |
|---|---|---|
| A5F239 安全证据 manifest | `92339f02cf0f30075e1059b8e41df0d1d0c6b60f4236119917b8d4ebc138d764` | MATCH |
| 91AF6E 开发 manifest | `7b0658d9972df676acec689cb3d99ea23e74bf1abc2e51f9a169a9aa49b187b3` | MATCH |
| 91AF6E 开发报告 | `65d2ea230c0b78da12c0407b2a1e0fc0c84980502b6324621a33694546d99374` | MATCH |
| source-management closed DB | `ddf3778c62cf95f195b1f08db8b075d676069f4cc9fb39804063e1004dd2e939` | MATCH；未打开 |
| closed receipt 文件 | `fda5bc8727f1b39bbeaca99857d9baf248e3791f7075ea611aa2d86eb97732a1` | MATCH；未重生成 |

## 3. 最小实现

### 3.1 `app/src/server/source-management/security.ts`

- 修改前 SHA：`af0ce2df1b77279ad784676939ff9df1d29d828390a94983e3ecff776eb16779`。
- 修改后 SHA：`a455df964f86045ff4157142a7cd378f2f64a12bb46a54661daa711d0750f965`。
- 以原始 target 第一个 `?` 为边界提取 `rawPath`；query 字节不参与 path gate，继续交给既有下游 allowlist。
- URL 解析前拒绝 raw path 中任意 `\`、任意 `%`，以及按 `/` 分段后逐字等于 `.` 或 `..` 的 segment。
- 保留 HTTP/1.1 origin-form、首字符 `/`、前导 `//` 和 `#` 的既有拒绝。
- URL 解析后要求 `pathname === rawPath`；任何 normalization alias 失败关闭。
- Origin、Host、Forwarded、peer、no-egress 与返回 context 语义未改变。

### 3.2 `app/src/tests/source-management-raw-target.test.ts`

- SHA：`aa30872b9a0a16696d4c42f61314efa9c340d00c5233d2e52edbd61afe4d00c9`。
- 覆盖 literal `./`、`../`，开头/中间 dot segment，大小写 `%2e` 组合，literal/encoded dot 混合，`%2f`/`%2F`，`%5c`/`%5C`，literal backslash，普通 percent-encoded path 字节，absolute-form 和前导 `//`。
- 合法 `/api/admin/session` 保持通过。
- 合法 `/api/admin/sources?platform=x%2Dfeed&limit=100` 保持通过，返回 route path 仍为 `/api/admin/sources`；percent query 没有被 path gate 误拒绝。

## 4. 唯一验收批次

固定 Node：`24.18.0`。

| 验收 | 调用次数 | 结果 |
|---|---:|---|
| raw-target 聚焦测试 | 1 | 1 文件，19/19 PASS，0 FAIL，96 ms |
| typecheck | 1 | exit 0，无诊断 |

执行顺序为聚焦测试 PASS 后再执行 typecheck。没有修改后重跑，也没有额外单项探针。

只读对抗审查结论：P0=0、P1=0。审查确认 raw path/query 边界、encoded/literal 变体、解析后逐字等价及合法 session/list+query 均符合任务合同，未发现 query、route、Origin 或 session 语义被放宽或误改。

## 5. 保护与未运行项

保护文件保持：

- server：`5c40918c7ac45aa809ed106acdfa00c9b6d5c52fb90a0b9995a0a3998d83378f`
- no-egress guard：`5f008507164f2a1b8678435ec491e31bf6235700c50844ec1dca3801ada756d2`
- Repository：`741aad53d872f837afbe1d3c94bb3047deb54d711d76045f6b2e1684c4598912`
- 原 SOURCE-MGMT 5/5 测试：`cbeab917a8e5ac447a7117b65bde5d2a266b56adc1d20d01e7765aaa2d492e25`
- `package-lock.json`：`89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3`
- profile lock、WAL、SHM 均不存在。

按任务边界没有运行：production build、产品 HTTP 实例、DB migration/read、closed receipt、91AF6E 全链、9/9 no-egress、5/5 golden、lint，以及 A5F239 首错后的其余独立安全向量。

## 6. 未验证与错题自检

未验证：

1. 尚未由新建安全 successor 在本精确候选上重跑 A5F239 剩余攻击向量。
2. 尚未由新建测试 successor 独立验证本精确候选。
3. 未开启真实 provider、外部 API、UI、部署或生产数据能力。

错题自检：

- 原始 request target 在 URL 规范化前验证，没有再次依赖 normalized pathname 判断 dot segment。
- raw path 与 query 明确分离，没有因禁止 percent path 而误禁合法 percent query。
- 没有新增 debug route、测试专用运行入口或第二数据真值。
- 没有打开正式数据库、启动实例或重复前序全链。
- 没有把本地聚焦测试 PASS 外推为完整后端安全 PASS。

机器证据：`app/evidence/TASK-20260810-875B6C/manifest.json`。
