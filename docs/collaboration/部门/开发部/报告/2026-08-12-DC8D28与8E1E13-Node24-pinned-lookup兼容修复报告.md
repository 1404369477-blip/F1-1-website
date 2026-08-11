# DC8D28 与 8E1E13 Node 24 pinned lookup 兼容修复报告

## 1. 结论

`TASK-20260812-DC8D28` 与机械后继 `TASK-20260812-8E1E13` 已形成最小 Node 24 lookup 兼容候选：pinned lookup 在 `lookupOptions.all=true` 时返回只含已选中地址的单元素 `LookupAddress[]`，在 scalar 形态下继续返回同一 address/family；HTTPS request 显式设置 `autoSelectFamily:false`，避免对已经完成 DNS public 判定和单地址 pin 的结果再次进行地址族竞速。

修复没有重新 DNS、没有引入多地址 fallback，也没有改变固定 URL、DNS 全量 public 判定、TLS/SNI、零 redirect、timeout、MIME、size、no-proxy 或拒绝响应终止边界。没有修改 repository、parser、types、collector、deployment、lock 或 DB schema。

DC8D28 的唯一一次 focused Vitest 为 `1 file / 7 tests PASS`。其唯一一次 typecheck 因 `node:https` 的 `RequestOptions` 声明不直接列出 `autoSelectFamily` 而失败，随后按首错纪律停止。8E1E13 仅把 options 对象赋给无断言交叉结构类型 `RequestOptions & { autoSelectFamily: false }` 再传入 `httpsRequest`；没有改变运行时字节语义，没有修改测试，也没有重跑 Vitest。后继唯一一次 Node 24 typecheck 与唯一一次 diff-check 均 PASS。

## 2. 根因与修复

M1 分层诊断已高置信确认：Node 24 可用 `lookupOptions.all=true` 调用 HTTPS request 的自定义 lookup；旧实现无条件执行 scalar callback，因返回形态不符合 Node 24 合同而在建连前产生 `ERR_INVALID_IP_ADDRESS`，最终映射为脱敏 `NETWORK_FAILURE`。

本次修复新增纯 helper `createPinnedRssLookup`：

- 输入只接收上游已完成 public 判定后选中的单一 `{ address, family }`。
- family 继续按既有规则归一为 `4 | 6`。
- `lookupOptions.all === true` 时回调 `[{ address: selected.address, family }]`。
- 其他情况回调 `selected.address, family`。
- 每次只回调一个已 pin 地址，不重新解析，不返回其他 DNS 地址。

HTTPS request 同时显式包含 `autoSelectFamily:false`。当前 `@types/node` 的 `node:https.RequestOptions` 没有直接列出该透传的 `net` option，因此 8E1E13 使用以下无断言结构类型组织 options：

```ts
const requestOptions: RequestOptions & { autoSelectFamily: false } = {
  // existing fixed request options
  autoSelectFamily: false
};
```

该变量可结构化传给 `httpsRequest`，没有使用 `any`、`unknown` cast、`ts-ignore` 或删除纵深限制。

## 3. 纯本地回归

`app/src/tests/rss-real.test.ts` 新增一个不发起网络的回归用例，覆盖：

- IPv4 pin + `all=true`：callback 恰调用一次，error 为 null，返回恰一个元素的数组，address 与 family `4` 保真，第三参数未设置。
- IPv6 pin + `all=false`：callback 恰调用一次，返回 scalar address，family 为 `6`，没有数组退化。

该用例直接验证导致实机失败的 Node 24 callback shape，同时验证单地址 pin 没有被扩张。

## 4. 最终文件 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `app/src/server/rss/transport.ts` | `a55b76fa8899173341671a3c8e13d67c47e6f74d8fd6e0ff68a29e1abc134028` |
| `app/src/tests/rss-real.test.ts` | `b797fac7a914c075226535c42e4a2c660d666f2ed0a95fe18b9c74fd936400d2` |

## 5. 限定验证收据

- DC8D28 focused Vitest：仅运行一次；固定 Node `24.18.0` 执行 `vitest run src/tests/rss-real.test.ts --config vitest.config.ts`；结果 `1 file passed / 7 tests passed`，PASS。
- DC8D28 Node 24 typecheck：仅运行一次；首错为 `src/server/rss/transport.ts(333,21): error TS2769`，具体原因是对象字面量属性 `autoSelectFamily` 不存在于当前 `node:https.RequestOptions` 声明；随后停止，没有运行当轮 diff-check。
- 8E1E13 focused Vitest：`0` 次；按后继合同继承 DC8D28 的行为测试收据，没有重跑。
- 8E1E13 固定 Node 24 typecheck：仅运行一次，`npm run typecheck` 退出码 `0`，PASS。
- 8E1E13 diff-check：仅运行一次，`git diff --check -- app/src/server/rss/transport.ts app/src/tests/rss-real.test.ts` 退出码 `0`、无输出，PASS。
- 未运行 full suite、build、lint、check 或其他测试/typecheck/diff-check。

## 6. 外部状态与未验证

外部动作：

- 网络请求：`0`。
- SSH：`0`。
- M1 访问或修改：`0`。
- private/public DB 读写：`0`。
- 部署、LaunchAgent load、wrapper、collector：`0`。

因此继承前序已确认的 M1 状态：source disabled、`stop_epoch=3`、RSS job unloaded；本任务没有触碰或重新核对 M1。

未验证：

- 修复候选在 M1 的安全只读复审、release manifest、传输与部署；属于后继发布任务。
- 修复后的唯一真实 HTTPS/RSS 请求、HTTP 200/304、parse 与 candidate 路径；本任务明确禁止网络和 M1。
- 900 秒调度；本任务没有加载 LaunchAgent。

## 7. 错题自检

- all/scalar 两种 callback shape 均由纯本地测试覆盖，helper 没有返回第二地址。
- `autoSelectFamily:false` 得以保留；机械类型后继没有以删除行为选项规避类型错误。
- 没有使用 `any`、类型断言、`unknown` cast 或 `ts-ignore`。
- 前驱 typecheck 首错后没有重跑或继续 diff-check；后继没有重跑已 PASS 的 Vitest。
- 后继只改 transport 的 options 组织和新增本报告，没有修改测试或其他生产模块。
- 三项验证次数符合两个任务各自预算，0 网络、0 SSH、0 M1、0 DB。

TASK_STATE_OK
