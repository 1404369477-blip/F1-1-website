---
type: audit_report
department: 安全部
target: "TASK-20260809-F1466E 启动期 no-egress 与精确 loopback 监听冲突"
status: final
date: 2026-08-10
related_task: TASK-20260810-F213DE
decision: pass
severity_count: { P0: 0, P1: 0, P2: 1 }
tags: [SOURCE-MGMT-001, startup, no-egress, loopback, dns-lookup, fail-closed]
summary: "PASS（诊断与修复合同）。首个拒绝调用已机械定位为server.listen(127.0.0.1)进入Node net.lookupAndListen后调用被guard patch的dns.lookup(host,{all:true},cb)，externalCalls由0增1并在OS bind前抛EXTERNAL_IO_FORBIDDEN。唯一推荐是guard持有的一次性、精确数字loopback监听能力：不调用OS DNS，严格返回all-aware地址数组，随即耗尽许可并在listening回调复核server.address；所有named-host DNS及出站connect/http/https/fetch/child process继续拒绝。当前F1466E保持BLOCKED。"
---

# SOURCE-MGMT 启动期 no-egress 与 loopback 监听冲突独立诊断报告

## 1. 唯一结论

**诊断 PASS；P0=0，P1=0，P2=1。F1466E 继续 BLOCKED。**

首个被拒调用已精确定位：`server.listen(config.port, config.bindHost)` 在 Node 24 的 `net.Server.listen` 内进入 `lookupAndListen`，即使 `config.bindHost` 已是数字字面量 `127.0.0.1`，该监听分支仍调用 `dns.lookup("127.0.0.1", {all:true}, callback)`。现行 guard 把 `dns.lookup` 无条件替换为 `denied`，因此 `externalCalls: 0→1` 并同步抛出 `EXTERNAL_IO_FORBIDDEN`；OS listener尚未创建，健康请求随后得到ECONNREFUSED。

唯一推荐为：在 no-egress guard 内新增**一次性精确数字loopback监听能力**，由guard专用方法包裹 `server.listen`。该能力只为当前已验证的 `127.0.0.1` 或 `::1`、单个固定端口、单次 `options={all:true}` 的内部地址归一化提供无DNS结果；不得调用OS resolver。许可在同步进入 `server.listen` 时arm，在第一次精确lookup时先consume，再以all-aware数组返回；监听完成后必须复核 `server.address()` 与期望地址、family、port逐字一致。所有出站connect/http/https/http2/tls/fetch/WebSocket/dgram、named-host DNS、dns promises、child process、cluster和worker thread继续fail closed。

这项修复只消除“精确入站loopback listener建立”与通用no-egress patch的冲突；raw authority、Host/Origin、session/CSRF、runtime guard、单profile/handle/writer和生产关闭边界均不得放宽。

## 2. 固定输入与完整性

| 输入 | 本轮 SHA-256 | 结果 |
|---|---|---|
| `app/evidence/TASK-20260809-F1466E/manifest.json` | `022e6f674a334a35be94fb785d036c6d33166db30ff485eb28bc2228d3a93b1a` | 固定；F1466E blocked、ready=false、ECONNREFUSED、successfulExternalCalls=0 |
| `app/src/server/vs1/no-egress.ts` | `a8c117708d31fb236e059183c9b08c6a56ab091ac38bde121ef0234e85a22d2d` | 固定；dns.lookup当前无条件denied |
| `app/src/server/source-management/server.ts` | `237378effd935da5a950aa0bc89679341e06f40cec5ff8a9da93b53baa10b83e` | 固定；runtime初始化后直接server.listen(host) |
| `app/src/server/source-management/runtime.ts` | `11d6449cefcc76f564035dab05ba8da3df6e19b8b47a1b56cfa8561fe9abca2f` | 固定；持有DB/profile lock，close时restore guard |
| `app/scripts/serve.ts` | `3c785dfcd37af524fbad064e5cb1c3662abc365541de506aa02c882b1fd2716c` | 固定；先装guard，再readiness并启动source management server |

任务真值固定 Repository SHA 为 `741aad53d872f837afbe1d3c94bb3047deb54d711d76045f6b2e1684c4598912`。本轮未修改上述文件、产品合同、canonical DB、manifest、依赖或lockfile。

## 3. 精确调用链与 externalCalls

```text
app/scripts/serve.ts
  installNoEgressGuard()
    dns.lookup = denied
  assertRuntimeReady(config)
  runSourceManagementServer(config, guard)
    initializeSourceManagementRuntime(guard)
      openSourceManagementDatabase()
      acquire profile lock / open DB
    node:http.createServer(...)
    server.listen(port, "127.0.0.1")
      node:net Server.listen
      node:net lookupAndListen
      dns.lookup("127.0.0.1", {all:true}, callback)
      guard.denied()
        externalCalls 0 -> 1
        throw EXTERNAL_IO_FORBIDDEN
```

独立零外网最小探针使用固定Node `24.18.0`，只在任务专属0700临时目录创建脚本，绑定系统分配的毫秒级loopback临时端口，没有启动产品实例、打开产品DB或访问外部地址。探针脚本SHA为 `796efd12f872fcb98e06b9a4300f7cd5a0d8d3b732e3fed24eab2f5ff246db94`，运行后临时根已精确清理。

当前guard收据：

```json
{
  "before": 0,
  "after": 1,
  "error": "EXTERNAL_IO_FORBIDDEN: VS1 worker permits no network or DNS calls",
  "firstFrames": ["no-egress.ts:denied", "node:net:lookupAndListen", "node:net:Server.listen"],
  "listening": false
}
```

同源机械证据进一步确认精确调用签名为 `hostname="127.0.0.1", options={"all":true}`。这解释了F1466E的全部启动现象：guard记录一次被拒I/O，进程在listen前退出，端口未建立，首个health连接被拒。

## 4. 第一性原理分层

| 类别 | 方向与能力 | 当前合同 |
|---|---|---|
| 入站精确loopback监听 | OS在单一IP literal和单一端口建立listener；没有远端连接发起 | 启动所必需，可在精确能力内允许 |
| 本进程数字地址归一化 | Node `Server.listen(host)`内部为数字IP调用`dns.lookup(...,{all:true})` | 可由guard无DNS地合成精确结果；不得开放通用lookup |
| 出站loopback连接 | 本进程调用net.connect/http/fetch访问任意loopback服务 | 继续拒绝；source-management server无需发起连接 |
| named-host解析 | localhost、任意域名、dns resolve/lookup/promises | 继续拒绝；禁止hostname alias |
| 非loopback外联 | DNS/socket/HTTP(S)/TLS/WebSocket/dgram/provider | 继续拒绝并计数 |
| 子执行面 | child_process、cluster、worker_threads | 继续拒绝，防止绕过guard |

入站listener与出站connect的能力不同。当前实现把Node内部监听地址归一化也计入“外部调用”，造成兼容性阻断；修复必须只给listener建立所需的一次性内部归一化，不得把loopback出站或通用DNS一并放开。

## 5. 唯一推荐修复合同

### 5.1 Guard API与一次性能力

由 `NoEgressGuard` 暴露唯一的listener入口，例如：

```text
listenExactLoopback(server, { host, port }, onListening)
```

调用者不得直接操作通用DNS许可。该方法必须：

1. 在arm前断言 `externalCalls===0`，host逐字为配置已验证的`127.0.0.1`或`::1`，port为配置固定的1024–65535整数；
2. 建立单个不可重入token，绑定`server identity + host + port + family + use_count=1`；已有token、已消费token或第二server立即拒绝；
3. 同步调用 `server.listen(port, host)`；从arm到Node调用lookup之间不得await、回调用户代码或暴露token；
4. patched `dns.lookup`只在token为armed、hostname逐字相同、options为仅含`all:true`、callback为函数时进入允许分支；在调用callback前先原子consume；
5. 允许分支**不调用原始dns.lookup或任何OS resolver**，使用next-tick返回：IPv4为`[{address:"127.0.0.1",family:4}]`，IPv6为`[{address:"::1",family:6}]`；
6. 任何hostname别名、附加option、`all:false`、promise lookup、第二次lookup、错family或错server都调用统一denied，使externalCalls递增并失败关闭；
7. listening回调第一步读取`server.address()`，必须精确等于期望address/family/port且不为`0.0.0.0`、`::`或其他wildcard；不一致立即关闭server、清理runtime并以固定reason失败；
8. listener验证完成后token状态为consumed且不可恢复；正常请求期间不存在任何DNS allowance。

### 5.2 强制all-aware语义

Node 24 `lookupAndListen`以 `{all:true}` 请求地址数组。旧式callback：

```text
callback(null, "127.0.0.1", 4)
```

不满足该API语义；机械收据已证明它可能使Node落到 `{address:"::",family:"IPv6"}` wildcard监听。该实现必须作为强制失败向量，禁止以“回调里包含127.0.0.1”为通过依据。

唯一允许返回：

```text
callback(null, [{address:"127.0.0.1",family:4}])
```

或IPv6选择下的精确数组等价物。最终安全依据仍包括 `server.address()` 实际值复核；仅检查callback输入不够。

### 5.3 继续拒绝的集合

以下调用在listener已成功建立后仍须同步/异步稳定拒绝，每次使`externalCalls`严格`n→n+1`，且listener/runtime进入失败收口：

- `dns.lookup("localhost"|任意named host)`、所有`dns.resolve*`和`dns/promises.*`，包括数字loopback；
- `net.connect`、`net.createConnection`、`Socket.prototype.connect`，包括连接本服务自身；
- `http.request/get`、`https.request/get`、`http2.connect`、`tls.connect`；
- `fetch`、`WebSocket`、`dgram.createSocket`；
- `child_process`全部执行入口、`cluster.fork`、`worker_threads.Worker`。

本轮临时guard验证：精确all-aware listener建立前后`externalCalls=0`、实际address=`127.0.0.1`/IPv4；随后named-host DNS、dns promises数字地址、net loopback connect、http loopback get、fetch loopback和child process六个向量逐项拒绝，计数从0依次增至6；listener正常关闭。

### 5.4 TOCTOU与不可恢复性

- host/port/family从已经验证且进程生命周期不可变的config快照取得；wrapper不得重新读取env。
- token必须在调用callback前consume，防止callback重入或第二次lookup借用窗口。
- `server.address()`验证发生在ready、session、CSRF或HTTP响应前；地址不符从未进入ready。
- 禁止“临时restore guard→listen→重新安装”。该路径制造无guard窗口并丢失准确externalCalls。
- 禁止先在guard外预绑定fd/handle再交给runtime；它扩大启动前无guard窗口、owner与清理复杂度。
- guard只能在server停止、连接关闭、DB关闭、profile lock释放后restore；restore后进程不得继续提供runtime。

## 6. 启动失败与正常退出的清理顺序

### 6.1 启动任一步失败

固定顺序：

1. 原子标记`ready=false`，禁止session/CSRF/业务handler可达；
2. 若server已监听，先停止accept，再`closeAllConnections`并等待`close`完成；未监听也要清除error/listening/signal handlers；
3. 调用`closeSourceManagementRuntime()`：关闭SQLite handle，确认WAL/SHM策略，释放唯一profile lock；
4. 验证server无listener、DB handle关闭、lock不存在、任务临时文件无残留；
5. 最后调用guard.restore；若`externalCalls>0`保留固定脱敏reason并非零退出，绝不继续运行；
6. 输出allowlist启动失败收据，禁止原始stack、path、host、secret或DB细节。

现行`runSourceManagementServer`在`server.listen` reject时没有finally关闭已初始化runtime；F1466E依赖进程退出并由harness精确移除了遗留lock。successor必须把上述失败清理写进同一try/finally，避免再次遗留profile lock。

### 6.2 正常SIGINT/SIGTERM

固定顺序：停止接收新请求→关闭现有连接并等待server close→关闭DB→释放profile lock→验证无listener/WAL/SHM/lock→restore guard→移除signal handlers→按信号语义退出。不得先restore guard再等待server或DB收口。

## 7. 开发与测试验收向量

### 7.1 开发最小实现出口

- 仅修改guard与source-management listener/cleanup接线；不改Spec、raw/session/CSRF、路由、DB schema、依赖或其他profile。
- 数字IPv4与IPv6各验证一次exact all-aware返回和`server.address()`；产品任务可按其固定配置只运行对应主向量，另一族用注入式单元向量。
- allowance owner、use-count、config快照、actual address和清理状态必须可注入/可断言；不得记录真实端口外的敏感环境。

### 7.2 必须通过的正向量

1. `127.0.0.1 + {all:true}`返回单元素IPv4数组；listener实际为127.0.0.1，externalCalls=0。
2. `::1 + {all:true}`返回单元素IPv6数组；listener实际为::1，externalCalls=0。
3. 监听成功后guard仍installed；HTTP请求只由外部测试进程发起，服务进程不需要出站connect。
4. SIGINT和SIGTERM分别按§6顺序释放server/DB/lock，guard最后restore。

### 7.3 必须通过的失败向量

1. naive旧式callback `(null,"127.0.0.1",4)`若产生`::`/wildcard，必须被actual-address复核拒绝；任何wildcard均为首错。
2. callback数组为空、多地址、错地址、错family、附加属性或resolver error：启动失败，ready=false，完整清理。
3. hostname=`localhost`、大小写/空白/zone-id/其他literal、options缺失/含额外key/`all!=true`、promise API、第二次lookup：denied且externalCalls+1。
4. listener成功后逐项调用net/http/https/fetch/dns named-host/child process：全部拒绝；不得因loopback而放行。
5. 在arm与lookup、lookup callback、address复核、DB open、server close、DB close、lock release各fault point注入失败：无ready、无session、无残留listener/DB/lock，guard最后restore。
6. 第二server、第二port、重复listen或并发arm：失败关闭，不创建额外listener。

## 8. 排除的备选

1. **restore guard后listen再重装：排除。** 它在runtime期间制造任意DNS、socket、HTTP和child process窗口，违反任务失败路径。
2. **通用允许数字IP或任意localhost DNS/connect：排除。** 这会开放出站loopback访问其他本机服务，也可能让hostname/解析语义进入授权面。

若实现团队无法提供guard-owned、一次性、all-aware、actual-address复核的无DNSlistener能力，应保持F1466E BLOCKED并提交新安全successor，不能选择上述备选。

## 9. 已验证、未验证与错题自检

### 已验证

- 首个被拒调用、Node内部调用链、精确hostname/options、异常与externalCalls `0→1`已机械复现。
- exact all-aware数字loopback结果可建立127.0.0.1/IPv4 listener且externalCalls保持0。
- naive旧式callback存在落到IPv6 wildcard的机械反例，已纳入强制失败向量。
- 在精确listener允许模型下，named-host DNS、dns promises、net/http/fetch loopback出站与child process仍逐项拒绝并递增计数。
- 产品代码、DB、端口、依赖和保护文件未修改；任务临时根已清理。

### 未验证 / P2

- 推荐能力尚未进入产品实现，F1466E仍未达到ready，closed receipt与完整HTTP链继续NOT_RUN。
- IPv6实际产品启动、各fault point、SIGINT/SIGTERM与DB/lock清理顺序尚未由successor运行。
- 本轮只验证进程级guard语义，未外推为OS级no-egress、生产网络隔离或同UID恶意进程防护。

### 错题自检

- 已区分入站listener、数字地址归一化、出站loopback连接和非loopback外联。
- 没有因数字IP放开通用DNS，也没有允许任意localhost出站。
- 没有采用naive单地址callback；强制`all:true`数组语义并复核actual address。
- 没有建议restore guard窗口、预绑定未受guard约束的handle、关闭guard或放宽raw/session/CSRF。
- 没有把F1466E的successfulExternalCalls=0写成“无尝试”；本报告记录guard拒绝计数为1。
- 没有修改产品文件、启动产品实例、访问外网或留下任务临时资源。

TASK_STATE_OK
