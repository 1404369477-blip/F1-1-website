---
type: audit_report
department: 测试部
target: TASK-20260809-BA9999最终候选
status: final
date: 2026-08-09
related_task: TASK-20260809-B98C66
decision: pass
tags: [M5, multimedia, sqlite, public-api, regression]
summary: 固定Node24完成目标测试、typecheck、必要build、真实CLI与loopback HTTP独立验收；三SQLite物理隔离且旧库/receipt/migration零漂移，新profile原子seed、28写点回滚、0/1/4媒体、V1/V2/406/完整性500/no-store及旧profile兼容均通过。P0=0/P1=0/P2=1，SCOPED PASS。
p0: 0
p1: 0
p2: 1
---

# TASK-20260809-B98C66 多媒体 profile 原子 seed 与 V1/V2 HTTP 独立验收报告

## 结论

`SCOPED PASS`。P0=0、P1=0、P2=1。

本轮独立证据满足任务全部验收出口：目标测试 5/5、typecheck、必要 production build、真实 CLI、两个 canonical profile 的 production loopback HTTP、隔离损坏库的六类完整性失败矩阵均通过。三 SQLite 保持物理隔离，受保护旧库、旧 migration、closed receipt 和本轮候选源码在验收前后零漂移；实例均已停止，`127.0.0.1:3000/3001` 无监听，新 canonical 无 WAL、SHM 或随机 candidate 残留，`externalCalls=0`。

P2-01 为既有 Turbopack NFT 动态本地路径 tracing warning；本轮未部署，未观察到运行时完整性绕过或外部 I/O。该项留给部署打包阶段，不阻断当前本地 synthetic 后端门。

## 候选身份与全量 SHA-256

| 对象 | 独立复算 SHA-256 | 结果 |
|---|---|---|
| scoped `0003` | `1f88116c62d2d29e469ff0dce356d07b41c8b142a00769774a3cf67709968b43` | PASS |
| `public-multimedia-synthetic.ts` | `844d8edc2520d5e0dcf446e9f0d4b11ea843624c8f1b8e423c0c1236c664bfe0` | PASS |
| `public-multimedia-profile.ts` | `257cd0e6e8c33b121b4e2e12ff3476cfaf0b478d1d776954955e9527f545db58` | PASS |
| 目标测试 | `67d00829e0ccae0f47cf5de2d7bc3b3e93dbe702930c26a95dc8197f4075601b` | PASS |
| `env.ts` | `f9a734a97cd01d5b35c643d404e658a74cfaba51ec64a8114874d43273350f42` | PASS |
| `profile.ts` | `8963ead3c6c5a926e8241dceb2972af13b86a5038becc7e6910ac7a6ae82b437` | PASS |
| `seed.ts` | `161447db10429c110918e904830e62b7df1acf03132700655e625490fcc92199` | PASS |
| `db-migrate.ts` | `9bce219ba4ebafe6c6ad1a69d9634f3ab354286ecf8978ffb86680df7f766ea6` | PASS |
| `seed-fixtures.ts` | `5cfcbf01328a44711ba4d8ca3677e4fb4b56a3cb0d5fba424e5f5a7a34ad46da` | PASS |
| `serve.ts` | `1bc41e1b30d9606f83a7a07cf55fbf5007d7f04b7e762543df41f507d7c00ee4` | PASS |
| `health.ts` | `bf52544d19876637b64476a0cb036e0313c9b00c516262d53afa6690acaf50ed` | PASS |
| public `runtime.ts` | `cb1572bb295c0615e4d3ff82c5793b81eecab720aee54cbe9bc4d21fd8aa1036` | PASS |
| public `types.ts` | `64d61d5f4e255592febc333ec690bb94cb95bf0f8bc2beede150268462e8aa95` | PASS |
| public `error.ts` | `28df8e9d3074242143660d1f97f81fd1631d7e479828d8e0c0d74c76c8058d03` | PASS |
| public `http.ts` | `348b6f0abeebaacd3108eeba1f793b006a4e53c1373e84fb401977471c80c8a0` | PASS |
| public `repository.ts` | `4c114687da195eb1a077889e924c43760901e30f2fc61e397b46f6341843ec1c` | PASS |
| story API route | `dc831de603ac3d8def6733b0831867001d1ebc2763be395c99819c57207a059f` | PASS |
| `package.json` | `e39a413a0ae2000b781433e983a9df48c26b0f5c1db1ce950e2b0b6dd6be7752` | PASS |
| `package-lock.json` | `89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3` | PASS |

## SQLite、migration 与 closed receipt

| 对象 | 验收前后 SHA-256 | 结果 |
|---|---|---|
| M3 canonical DB | `df82598ca2405ad2dfebd01503ac5615a10dcbd40807d308a87fa5c27fb519c0` | 零漂移 |
| public-synthetic canonical DB | `24536392e0ca00524010ba70ff55f754cd892e3f3f4652eb69ae6a182deaf041` | 零漂移 |
| public-multimedia canonical DB | `a1f712aacf0d78664ea9962dfe9902c194422ce099bab968a84d9a2c64cbf50c` | 零漂移 |
| `0001_local_foundation.sql` | `9c8c083b8f3c566023e9438c254d5b1c09d87430dec08f6e6905ed84b6fb3176` | 零漂移 |
| `0002_source_fixture.sql` | `12a755754744689f977ac8b8d5d4443ec63cd5612aaff50eb920badf1ebfb031` | 零漂移 |
| legacy `0003_public_synthetic_profile.sql` | `57df4d990cded9d69551d0acf97615ef5d9fd3d5ecceb05ebb10d3812549498a` | 零漂移 |
| M3 closed receipt | `4309961dd363413444821f29586a15eec96cc18b396a3f8aad44330ec5d5bbdc` | 零漂移 |
| public-synthetic profile receipt | `2c5ca3555b108761fb5b224e0cad77a29d8fc16e56d3eb4d6b80448365492803` | 零漂移 |
| public-synthetic data receipt | `71286412fcfc04428145b86ba2a174d93417e6604f16883a7a5a87f7e76cacdc` | 零漂移 |
| receipt validator | `6466fad6f69912cca2cebcc93a2fd07fc6096fe7582efd37c8d5fc9aa0cf3048` | 零漂移 |
| receipt CLI | `beeae3aba02b156e095c3622e94648750075cd5c789808a956181f6aa5fddacb` | 零漂移 |

新 canonical 独立读取得到 `integrity_check=ok`、`user_version=3`、唯一 `profile_id=public-multimedia-synthetic`、`contract_version=public-read-v0.2`、`fixture_set=public-multimedia-0-1-4-v0.5`、`synthetic_only=1`、`external_calls=0`、`writes_to_base=0`、`real_media=0`。三条 PublishedProjection 的媒体数精确为 0/1/4，总 MediaCandidate=5。DB 为当前用户持有的 regular `0600`、`nlink=1` 文件。

任务结束时无 `public-multimedia-candidate-*`、canonical WAL/SHM 或 symlink。已知 `f1plus1-public-multimedia-synthetic.pre-update-20260809.sqlite` 是开发报告明确保留、未被 runtime 引用的历史恢复文件，名称与随机 candidate 规则不匹配，本轮未删除或修改。

## 真实 CLI 与原子 seed

- 固定工具链：Node `24.18.0`、npm `11.16.0`，无安装、无联网。
- 目标 Vitest：`src/tests/public-multimedia-backend.test.ts`，exit 0，1 file / 5 tests PASS。
- typecheck：exit 0。
- 必要 production build：exit 0，公开 feed、detail、health 和页面路由均生成。
- `db:migrate`：exit 0；exact selector 为旧 0001 + 旧 0002 + scoped 0003，`userVersion=3`。
- `seed:fixtures` 连续两次：均 exit 0、`inserted=false`；roots、counts 与 canonical DB hash 不变。
- `runtime:assert-ready`：exit 0，`ready/local-only`。
- graph root：`6d4602ac73099dfb82610d46e835fc09f839e7a4c7a4a395f0c1a343fb8010f3`。
- selector root：`336a8721d75a24ac956b4d7cdecba4515fc136f96d89f91f3304293b0f6c600c`。
- schema fingerprint：`b39672c45af95027f9ae32a5610b1d2c71c49c38d79897e1d42a8a71771efe8f`。
- ledger root：`f762c35cc8231586b8b3d4b9d060df1407aa7424d8d7091b8e80e6304f9d54e1`。
- 目标测试逐个覆盖 28 个写点故障注入，全部整事务 rollback；重复 migrate/seed 保持幂等；INSERT 与 UPDATE 两条第五图路径均被 trigger 拒绝；ATTACH 被拒绝。

## Production loopback HTTP

### public-multimedia-synthetic

- health：HTTP 200，`ready`、`accepted-public-multimedia-synthetic`、Node24.18.0、SQLite3.53.1、scoped 0003、四 roots 精确命中、`externalCalls=0`。
- V1 feed：缺失 Accept、`*/*`、`application/json` 均 HTTP 200、`public-read-v0.1`、3 条、`no-store`。
- V2 feed：仅精确 `application/vnd.f1plus1.public-read-v0.2+json` HTTP 200，3 条媒体数 `[4,1,0]`、`no-store`。
- V2 detail：`public-mm-gallery` HTTP 200，story 4 图、related 2 条且媒体数 1/0、`no-store`。
- V1 detail：HTTP 200，维持 V1 媒体对象/空值结构、`no-store`。
- 参数化 vendor、多值 Accept、`text/plain` 与错误 vendor：均 HTTP 406、`PUBLIC_MEDIA_VERSION_UNSUPPORTED`、`no-store`。
- 非法 public ID：HTTP 400、`PUBLIC_ID_INVALID`、`no-store`。

### 隔离损坏库完整性矩阵

在任务专属 0700 临时根的物理隔离项目副本中，用同一 production build 与 loopback 实例逐项恢复 pristine DB 后注入；canonical 三库从未作为注入目标。

| 注入 | feed 结果 | detail/related补充 | 结果 |
|---|---|---|---|
| bad media hash | 500 / `PUBLIC_READ_INTEGRITY_FAILED` / `no-store` | gallery related 同为 500 | PASS |
| rights rejected | 500 / `PUBLIC_READ_INTEGRITY_FAILED` / `no-store` | 组件测试同链覆盖 | PASS |
| safety rejected | 500 / `PUBLIC_READ_INTEGRITY_FAILED` / `no-store` | 组件测试同链覆盖 | PASS |
| media_refs 乱序 | 500 / `PUBLIC_READ_INTEGRITY_FAILED` / `no-store` | 组件测试同链覆盖 | PASS |
| media_refs 重复 | 500 / `PUBLIC_READ_INTEGRITY_FAILED` / `no-store` | 组件测试同链覆盖 | PASS |
| 异常第五图 | 500 / `PUBLIC_READ_INTEGRITY_FAILED` / `no-store` | 组件测试同链覆盖 | PASS |

错误体未泄露绝对路径、SQL、stack 或内部 hash 输入。每个隔离实例停止后才恢复 pristine DB。

### legacy public-synthetic

- health：HTTP 200、`accepted-public-synthetic`、旧 0003、seed 12、`externalCalls=0`。
- V1 `application/json`：HTTP 200、12 条、`public-read-v0.1`、`no-store`。
- 精确 V2 vendor：HTTP 406、`PUBLIC_MEDIA_VERSION_UNSUPPORTED`、`no-store`。
- 实例停止后旧 DB hash 不变，无 sidecar。

## 进程、sidecar 与外部边界

所有服务只绑定 loopback。每轮均按实例 PID 精确停止；最终 3000/3001 无监听。canonical 新库运行产生的精确空 WAL（0 B）与 SHM（32768 B）在 owner/mode/nlink、无句柄确认后删除，DB hash仍为 `a1f712...f50c`；最终无 sidecar。真实媒体、Feishu/Base、provider、RSS、AI、Admin、发布、部署和任何公网 I/O 均未启用，运行收据为 `externalCalls=0`、`realMedia=0`、`writesToBase=false`。

## P0 / P1 / P2

- P0：0。
- P1：0。
- P2-01：production build 的 Turbopack NFT 对动态、受门禁本地路径给出 tracing warning。构建与本地运行均成功；部署产物内容未在本任务验证。

## 已验证 / 未验证

已验证：全量影响 SHA；三库物理隔离与 hashes；旧 migration/receipt 零漂移；exact selector、user_version、schema/ledger/roots/counts；0/1/4 与总媒体 5；第五图 INSERT/UPDATE；28 写点 rollback；重复 migrate/seed；目标测试、typecheck、必要 build；V1/V2/406/400/500；feed/detail/related 同版；全响应 no-store；legacy V1兼容与 V2拒绝；Node24；externalCalls=0；进程、端口、WAL/SHM/candidate 收口。

未验证：正式前端多媒体 UI、浏览器交互与视觉；真实媒体/外部 provider/Base/AI/Admin/发布；部署包 tracing 的最终内容；系统调用级全机网络抓包。前三类均在任务范围外且能力保持关闭，最后一项由目标测试 no-egress guard、最小 env、loopback 边界和运行收据交叉覆盖，不构成本任务 P1。

## 错题自检

- 未采信开发结论代替独立执行；开发报告仅用于定位 impact 清单。
- 旧 canonical DB 仅做 hash/最终只读核对；所有故障注入仅发生在任务专属物理副本。
- 明确区分真实 project CLI/受控 wrapper 的成功矩阵与隔离 direct Next production build 的完整性 500 矩阵。
- 没有把组件测试外推为 HTTP：六类完整性失败均取得真实 loopback 500，其中 bad hash 另核对 detail/related 整体失败。
- 没有把错误 vendor `public-read-v2` 当作 V2；最终使用精确 `public-read-v0.2` vendor。
- 只运行一次目标测试、一次 typecheck、一次必要 build；没有 full check、浏览器或无关整站回归。
- 对 SQLite 最终只读探针产生的精确 WAL/SHM 再次核对并清除；清除后 DB hash 和端口状态复核通过。
- 没有修改 app、Spec、ADR、data、design、依赖、lockfile或外部资源；仅写本测试报告并按受管任务流程收口。

TASK_STATE_OK
