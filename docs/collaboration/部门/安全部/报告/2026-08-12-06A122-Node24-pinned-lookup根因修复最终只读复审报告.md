---
type: audit_report
department: 安全部
target: "TASK-20260812-06A122 / Node 24 pinned lookup compatibility fix"
status: final
date: 2026-08-12
related_task: TASK-20260812-06A122
decision: pass
severity_count: { P0: 0, P1: 0, P2: 0 }
tags: [RSS-REAL-001, Node24, DNS-pin, HTTPS, ERR_INVALID_IP_ADDRESS]
summary: "PASS。四项精确输入 SHA 全部匹配。pinned lookup 在 Node 24 传入 all=true 时返回只含已选 public 地址的单元素 LookupAddress 数组，scalar 分支继续返回同一地址与 4|6 family；HTTPS 请求显式 autoSelectFamily=false。修复没有再次解析 DNS、没有多地址 fallback，固定 URL、DNS 全量 public 判定、TLS/SNI、代理拒绝、零 redirect、timeout、MIME、encoding、size 与拒绝响应终止边界保持。测试精确覆盖实机 ERR_INVALID_IP_ADDRESS 的两种 callback shape，限定范围未发现 P0/P1/P2。放行第二个精确 release 与一次 M1 受控实采；900 秒仍不加载。"
---

# Node 24 pinned lookup 实机根因修复最终只读复审报告

## 1. 结论

**PASS；P0=0，P1=0，P2=0。根因修复 CLOSED。**

允许形成第二个精确 Git commit/release，并在既有授权和实施围栏内只执行一次 M1 修复后真实采集。当前结论不授权加载 900 秒 LaunchAgent。

本轮只读检查冻结文件与行级调用序；没有运行测试、产品脚本、网络、SSH、M1、wrapper、collector、release builder、部署或 `launchctl`，没有修改实现。唯一写入是本安全报告。

## 2. 精确输入

| 对象 | 固定 SHA-256 | 结果 |
|---|---|---|
| `app/src/server/rss/transport.ts` | `a55b76fa8899173341671a3c8e13d67c47e6f74d8fd6e0ff68a29e1abc134028` | MATCH |
| `app/src/tests/rss-real.test.ts` | `b797fac7a914c075226535c42e4a2c660d666f2ed0a95fe18b9c74fd936400d2` | MATCH |
| Node 24 lookup 修复开发报告 | `c9cc917b7f3dcfcddf758a383801040703cb54aeb18f91cd0b219993fc964a0b` | MATCH |
| M1 `NETWORK_FAILURE` 分层诊断报告 | `d04337bd114c558af62398e5faa61f451f5d179c92d0ae25f60bcaf7c6231aa8` | MATCH |

未触发 `SNAPSHOT_DRIFT`。

## 3. 根因与修复闭合

前驱诊断的精确事实是：Node 24 可用 `lookupOptions.all=true` 调用自定义 lookup；旧实现仍返回 scalar address/family，实机在收到 HTTP headers 前产生 `ERR_INVALID_IP_ADDRESS`（诊断报告第 5–10、58–76、80–101 行）。

当前 `createPinnedRssLookup` 的调用合同为：

- 先把上游选中 family 收敛为联合类型 `4 | 6`（`app/src/server/rss/transport.ts` 第 148–153 行）。
- `lookupOptions.all === true` 时回调 `[{ address: selected.address, family }]`，数组恰含一个已选地址，随后立即返回（第 153–157 行）。
- 其他分支回调 scalar `selected.address, family`（第 158–159 行）。

这与 Node 24 的两种 lookup callback shape 一致，且两条分支都只返回传入 helper 的同一个 pin。实机 `ERR_INVALID_IP_ADDRESS` 所对应的 callback 形态缺口已静态关闭。

## 4. pin 与网络边界保持

### 4.1 没有重新 DNS 或多地址 fallback

产品仍只执行一次 `dnsLookup(RSS_FEED_HOST, { all: true, verbatim: true })`，对返回数组执行非空和全量 public 判定，再固定选择 `addresses[0]`（`transport.ts` 第 272–300 行）。`createPinnedRssLookup(selected)` 只持有该单一选择（第 330 行）；其 `all=true` 结果也只有该地址。修复没有第二次 DNS、地址轮换或失败后尝试其他地址的路径。

### 4.2 `autoSelectFamily=false` 不破坏 pin

HTTPS options 以无断言的结构交叉类型 `RequestOptions & { autoSelectFamily: false }` 声明，显式设置 `autoSelectFamily:false`，并使用同一个 pinned lookup（第 332–345 行）。该值关闭 Node 地址族自动竞速，不会增加地址；实际连接仍只能取得 helper 返回的选中地址。

目标代码没有使用 `any`、`unknown` cast、`as` 类型断言、`@ts-ignore` 或 `@ts-expect-error`。交叉类型声明属于变量类型标注，不改变运行时 options 字节。

### 4.3 既有输入与响应边界保持

- 固定 HTTPS URL、host、path、无端口/query/hash/credentials 的检查仍在第 117–138 行。
- proxy 环境拒绝仍在第 162–165、263–267 行。
- DNS 必须全量 public、只选首地址的顺序仍在第 272–300 行。
- request 继续固定 HTTPS、443、GET、path、SNI、`agent:false`、headers 与 lookup（第 322–345 行）。
- redirect、429、401/403/404、5xx、304、200、MIME、encoding、declared length 和实际 body size 处理保持在第 350–417 行。
- connect、first-byte、total timeout 与 request/response destroy 路径保持在第 420–445 行。

限定修复没有改变 TLS/SNI、redirect、timeout、MIME、encoding、size、validator、代理或响应终止语义。

## 5. 回归覆盖静态复核

`app/src/tests/rss-real.test.ts` 第 122–149 行直接调用 pinned lookup，覆盖：

- IPv4 + `all=true`：回调一次、error 为 null、返回单元素数组、address 与 family 4 保真、第三参数未设置；
- IPv6 + `all=false`：回调一次、返回 scalar address、明确不是数组、family 6 保真。

该用例精确覆盖实机根因的 array/scalar callback shape，并验证单地址 pin 没有扩张。开发报告记录的既有 focused Vitest、后继 typecheck 与 diff-check 收据只作为输入读取，本轮没有重跑。

## 6. 严重度与放行

| 项目 | 裁定 | 依据 |
|---|---|---|
| P0 | `0` | 未发现可导致越权、公开写入或安全围栏失守的新增路径。 |
| P1 | `0` | Node 24 callback 根因闭合；单地址 public pin、SNI/TLS 与所有既有网络硬门保持。 |
| P2 | `0` | 两种 callback shape/family 有精确回归覆盖；限定范围未见剩余兼容或类型规避问题。 |
| 第二个精确 commit/release | **放行** | 必须把本报告 MATCH 的 transport 纳入新的干净 Git HEAD，并重新生成、独立固定 release manifest/content/release SHA。 |
| 一次 M1 受控实采 | **放行** | 只允许新 release prepare 后经 wrapper 执行一次；开始前确认 source/job 围栏，结束后立即 stop，并保存脱敏收据与零漂移核对。 |
| 900 秒 load | **不放行** | 修复后真实 HTTPS/RSS、parse/candidate、人工字段保护、synthetic 零漂移及 stop 后零新增 run 尚无新动态收据。 |

## 7. Unknown 与自审

### Unknown / 未验证

- 第二个真实 Git commit、release manifest/content/release SHA 及 GitHub/M1 同步结果；
- 修复后的 M1 HTTPS/RSS 状态、headers、MIME、response size、200/304、parse、candidate 与人工字段行为；
- M1 当前 Node/依赖/DB/launchd 文件身份、一次实采收据、公开 synthetic 零漂移和停采后零新增 run；
- 900 秒节奏与长期调度稳定性。

### 自审

- 没有用开发部测试收据替代本轮动态执行；本轮严格保持 0 测试、0 网络、0 SSH、0 M1。
- 没有把类型通过外推成 M1 实采成功；真实结果保持 Unknown。
- 没有把一次受控实采放行扩大为 900 秒 load。
- 没有扩展到 Node 24 lookup 修复及其直接保持边界之外的背景问题。
