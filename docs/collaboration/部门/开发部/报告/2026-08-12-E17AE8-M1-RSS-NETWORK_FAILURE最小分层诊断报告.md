# E17AE8 M1 RSS `NETWORK_FAILURE` 最小分层诊断报告

## 1. 结论

`TASK-20260812-E17AE8` 已在保持 RSS source disabled、`stop_epoch=3`、`com.f1plus1.rss-collector` unloaded 的条件下完成最小分层诊断。诊断没有运行 wrapper 或 collector，没有写 private/public DB，没有修改代码、manifest、plist或公开服务。

根因置信度为高：Node 24 发起 HTTPS 请求时可按默认 auto-family-selection 路径，以 `lookupOptions.all=true` 调用产品的自定义 pinned lookup；当前实现始终按单地址回调形态返回 `address` 与 `family`，没有在 `all=true` 时返回 `LookupAddress[]`。这违反 Node 24 lookup 回调合同，导致请求在建连前以 `ERR_INVALID_IP_ADDRESS` 失败，随后被 transport 归并为脱敏 `NETWORK_FAILURE`。

证据链为：DNS 解析得到公开 IPv4 地址且 IPv4/IPv6 默认路由均存在；对实际选择的公开 IPv4 直连 TLS 成功且证书 hostname 校验通过；使用与产品一致的 pinned lookup 形态执行唯一一次 headers-only HTTPS GET 时，在 6 ms 内、尚未收到 HTTP headers 且未读取正文前精确失败为 `ERR_INVALID_IP_ADDRESS`。本地固定 Node 24 类型合同同时确认：`all=true` 时 lookup callback 地址参数应为地址数组，且 auto-family-selection 默认开启。

本任务没有实施修复，也没有再次运行真实 RSS 请求。最终 source、job、private 聚合、public DB 与公开服务均零漂移；诊断临时文件计数为 0。

## 2. 前置安全门

诊断前只读核对结果：

- 固定 source：`enabled=0`、`stop_epoch=3`、`last_reason_code=NETWORK_FAILURE`。
- private `ingest_run` 总数：`1`。
- `com.f1plus1.rss-collector`：明确 unloaded。
- 未执行 enable、resume、bootstrap、load、wrapper、collector 或任何 DB 写入。

安全门通过后才进入分层诊断。

## 3. DNS 与路由层

对 `www.motorsport.com` 使用 `dns.lookup({ all: true, verbatim: true })` 的只读结果为 4 个地址，地址族顺序均为 IPv4，public 分类均为 true。按合同仅记录顺序、family 与地址 SHA-256 前缀，不记录原始 IP：

| 顺序 | family | public | IP SHA-256 前缀 |
| ---: | ---: | :---: | --- |
| 0 | 4 | true | `83cb26a88d40` |
| 1 | 4 | true | `2d716aa3ced4` |
| 2 | 4 | true | `c0f3a978d289` |
| 3 | 4 | true | `87d907b05cc2` |

路由与接口只读事实：

- IPv4 默认路由存在，接口为 `en0`。
- IPv6 默认路由存在，接口为 `en0`。
- `en0` 上观察到 IPv4 地址 1 个、IPv6 地址 5 个，其中 public IPv6 4 个。

结论：没有观察到“DNS 首选 IPv6但主机无 IPv6 路由”或“DNS 仅返回特殊/私有地址”的证据。DNS 轮转会改变具体地址，因此后续连接仅记录各自实际选中地址的 SHA 前缀。

## 4. TLS-only 层

仅执行 1 次 TLS-only 连接，未发送 HTTP method、path、headers 或 body：

- 目标：当次 DNS 顺序选择的首个公开地址。
- family：IPv4。
- IP SHA-256 前缀：`65c1a3ce1574`。
- 固定 SNI：`motorsport.com`。
- 上限：3 秒。
- 结果：TLS 成功。
- 证书 hostname 校验：通过。
- 耗时：314 ms。

首选地址 TLS 已成功，因此按任务分支没有执行第二次 IPv4 TLS。该结果排除当次地址的基础 TCP/TLS 不可达，并触发唯一一次 headers-only GET 诊断资格。

## 5. 唯一 headers-only HTTPS GET

仅执行 1 次 headers-only HTTPS GET，使用固定 host/path/header 与产品同形态 pin 策略：

- host：`www.motorsport.com`。
- path：`/rss/f1/news/`。
- SNI：`motorsport.com`。
- headers：固定 RSS `Accept`、`Accept-Encoding: identity`、`User-Agent: F1Plus1-RSS-REAL-001/1.0`。
- 当次选中 family：IPv4。
- 当次选中 IP SHA-256 前缀：`c0f3a978d289`。
- transport connection count：`1`。
- 结果：failed。
- 精确错误码：`ERR_INVALID_IP_ADDRESS`。
- HTTP status：未收到。
- body read：false。
- body saved：false。
- 耗时：6 ms。

请求在收到 headers 前失败，因此没有可记录的 MIME、encoding、length 或 redirect。没有读取、保存或 drain 响应正文。此后没有再发起任何网络连接。

TLS-only 与 GET 的地址 SHA 前缀不同源于 DNS 轮转；已定位的 callback-shape 错误与具体公开地址无关。

## 6. 已证实根因与最小修复

产品 `app/src/server/rss/transport.ts` 的 pinned lookup 当前无条件执行单地址回调，逻辑等价于：

```ts
callback(null, selected.address, selected.family === 6 ? 6 : 4)
```

Node 24 的 lookup 合同允许网络层以 `all=true` 请求地址列表；此时 callback 第二参数必须为 `dns.LookupAddress[]`。固定 Node 24 的 `net`/`dns` 类型定义同时表明：

- lookup callback 的地址参数是 `string | dns.LookupAddress[]`；
- `LookupOptions.all=true` 时回调返回所有地址组成的数组；
- `net.getDefaultAutoSelectFamily()` 对应的默认 auto-family-selection 为 true。

动态诊断中，与产品相同的无条件 scalar 回调在请求建连前稳定产生 `ERR_INVALID_IP_ADDRESS`；直连同类公开 IPv4 的 TLS 则成功。结合静态合同，根因置信度评定为高。

精确最小修复建议：

1. pinned lookup 检查 `lookupOptions.all`。
2. 当 `all === true` 时回调单元素数组：`[{ address: selected.address, family }]`。
3. 其他情况继续回调标量：`selected.address, family`。
4. 可在已经完成单地址安全 pin 的 request 上显式设置 `autoSelectFamily: false` 作为纵深限制，避免 Node 对单地址 pin 再执行地址族竞速；核心兼容修复仍是正确支持两种 lookup 回调形态。

该修复无需增加业务实体、schema 或部署对象。

建议回归向量：

- 单元测试直接调用 pinned lookup：`all=true` 必须返回恰一个元素的 `LookupAddress[]`；`all=false`/未设置时必须返回 scalar address 与正确 family。
- 覆盖选中 IPv4 与 IPv6 两条分支，验证 family 保真。
- 使用 Node 24 与本地 loopback TLS server 做无外网集成测试，证明请求可到达 response headers，且不再产生 `ERR_INVALID_IP_ADDRESS`。
- 保持既有 DNS 全量解析、特殊地址拒绝、DNS pin、Host/SNI、proxy deny、连接/总超时与拒绝响应有界终止测试。
- 验证底层错误可在受控诊断中区分，同时外部任务收据继续脱敏。

## 7. 连接预算与禁止项核对

| 动作 | 实际次数 | 合同上限/要求 |
| --- | ---: | --- |
| TLS-only | 1 | 最多 2 |
| headers-only HTTPS GET | 1 | 最多 1 |
| wrapper | 0 | 必须 0 |
| collector | 0 | 必须 0 |
| private/public DB 写 | 0 | 必须 0 |
| HTTP body read/save | 0 | 必须 0 |
| 代码/manifest/plist 修改 | 0 | 必须 0 |
| SSH 外的额外部署动作 | 0 | 必须 0 |

没有执行第二次 TLS、第二次 GET、RSS 入库重试、900 秒任务 load、站点重启或生产 DB 修改。

## 8. 最终状态与零漂移

诊断结束后的只读核对：

- source：`enabled=0`、`stop_epoch=3`、`last_reason_code=NETWORK_FAILURE`。
- private `ingest_run`：总数 `1`，没有新增 run。
- `pending_review_candidate`：总数 `0`，没有新增 candidate。
- private DB：`PRAGMA integrity_check=ok`。
- RSS job：明确 unloaded。
- 公开 synthetic DB：SHA-256 `949c78d505e4c032d2495174deaf62d24f9d99b76284ad7ba6fb29a5ac83bb50`、size `737280`、inode `24546198`、mode `0600`、UID `501`、单链接，均与诊断前一致。
- `com.f1plus1.public-beta`：PID `52089` 且 running，与诊断前一致。
- `com.f1plus1.quick-tunnel`：PID `53446` 且 running，与诊断前一致。
- `com.f1plus1.receipt-refresh`：保持 loaded、last exit `0`。

## 9. 临时资源清理

- 诊断脚本均以内联方式执行，没有创建远端或本地诊断脚本文件。
- 任务专属临时文件最终计数：`0`。
- 没有删除或改写正式 private DB、release/deployment manifest、plist、collector logs、wrapper receipt 或 stop receipt。

## 10. 未验证与错题自检

未验证：

- 修复后的 HTTPS/RSS 成功路径；本任务禁止代码修改和第二次真实请求。
- 上游实际 HTTP status、response headers、RSS MIME/encoding/content；唯一 GET 在建连前失败。
- 原 E157BC wrapper 当次 DNS 具体选中地址；既有脱敏收据没有记录该值。本结论依赖与具体地址无关的 lookup callback 合同与动态复现。
- HTTP 200/304、解析、candidate 创建/更新/重复、人工字段保护与 900 秒调度路径。

错题自检：

- 报告没有记录任何原始 IP，仅记录 family、顺序与 SHA-256 前缀。
- TLS-only 恰 1 次；首选成功后没有浪费第二次 TLS 配额。
- headers-only GET 恰 1 次；未收到 headers，未读取或保存正文，失败后没有重试。
- 没有运行 wrapper/collector，没有执行 DB 写、代码修改、部署、load、restart 或第二次真实请求。
- source disabled、`stop_epoch=3`、job unloaded、private 聚合与 public 服务/DB 零漂移均在结束时复核。
- 根因定位为高置信度；修复和回归向量仅作为后继建议，本任务没有宣称已实施或验证修复。

TASK_STATE_OK
