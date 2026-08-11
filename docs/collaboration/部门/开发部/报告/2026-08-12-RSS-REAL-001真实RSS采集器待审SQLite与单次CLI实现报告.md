# RSS-REAL-001 真实 RSS 采集器、待审 SQLite 与单次 CLI 实现报告

## 1. 结论

`TASK-20260812-76189F` 已按精确范围完成本地实现，Function ID 覆盖 `RSS-SAFE-001`、`RSS-PILOT-002`、`REAL-SOURCE-003`。实现只增加后端 RSS 模块、私有三表 migration、单次 CLI、聚焦测试及精确 npm 依赖/脚本；没有修改 `app/src/app/**`、公开页面或公开 synthetic 数据源。

产品实施真值为：

- `docs/decisions/system/2026-08-12-F1+1-RSS-REAL-001单一真实RSS采集纵切-successor-accepted.md`
- SHA-256：`1d22d5022699cd2bd1885f19c076093b37220ba6bd458b3aaa9bdcdacaa4bdf9`

该 successor 已吸收内容更新冲突的最终修正：机器层更新保留 `review_status`、全部 `editor_*` 与 `editor_based_on_source_revision`，通过审核基线小于 `source_revision` 派生需要复审。

## 2. 实物

| 产物 | 作用 |
| --- | --- |
| `app/src/server/rss/types.ts` | 固定 source/profile/URL、预算、reason code、HTTP/解析/收据类型 |
| `app/src/server/rss/transport.ts` | 显式 `RSS_REAL_IO=true` 门、固定 URL、无代理、DNS 全结果公共 IP 检查、连接地址 pin、TLS、0 redirect、identity encoding、MIME/1 MiB/超时/条件请求边界 |
| `app/src/server/rss/parser.ts` | 严格 UTF-8、DTD/ENTITY/XInclude 拒绝、深度 32、节点 10,000、字段 16,384 bytes、整份最多 60 条、校验后按规则选最新 20 条、description 纯文本化 |
| `app/migrations/rss-real/0001_rss_real.sql` | 私有 `source`、`ingest_run`、`pending_review_candidate` 三表与必要唯一约束/索引，WAL/FULL 由安全数据库入口固定 |
| `app/src/server/rss/repository.ts` | 固定 15 分钟 slot、单在途 run、scheduler gap、`BEGIN IMMEDIATE` 原子写、幂等/修订、失败收据、429 下一可运行时间及 401/403/404 停源 |
| `app/scripts/rss-collect-once.ts` | 无 URL 参数的单次 operator；只输出一行脱敏 JSON 收据 |
| `app/src/tests/rss-real.test.ts` | 合法 RSS、DTD、61 条超限、非 allowlist URL、复见幂等、内容更新与人工字段不覆盖 |
| `app/package.json` / `app/package-lock.json` | 精确 `fast-xml-parser@5.10.1` 与 `rss:collect-once` 命令 |

完整身份收据：

- migration SHA-256：`c03c5c0bd5887e9e74453c91602bae76f6a7c74db513a2d9ff808ad498807ef3`
- Node 24 / SQLite v1 完整 schema fingerprint：`b6b21a0b6f1918ea7f93a08b66bdc517b5827dff62eefe662e663e0998a8a719`
- 私有 profile：`rss-real-private`
- 固定 source：`motorsport-f1-news`
- 固定 feed：`https://www.motorsport.com/rss/f1/news/`

## 3. 关键行为

1. CLI 不接收运行时 URL 或额外参数；`RSS_REAL_IO` 只有字面量 `true` 才会进入 DNS/GET 路径。
2. transport 每次先解析 DNS；任一解析结果属于非公共地址即整次拒绝，HTTPS request 的 lookup 只返回本次已核验地址，TLS hostname 继续固定为 `www.motorsport.com`。
3. 任何 redirect、非 identity 压缩、非 allowlist MIME、声明或实际超过 1 MiB、DTD/ENTITY/XInclude、深度/节点/字段/item 超限均整份失败关闭。
4. 200 响应的 run、全部候选 insert/update 与 source validator/成功游标在同一 `BEGIN IMMEDIATE` 事务提交；解析失败发生在事务前，只写失败 run，不写候选或推进 validator。
5. `dedupe_key=SHA-256(source_id + U+001F + external_id)`；同 payload 只更新 `last_seen_at`，变化 payload 只更新机器字段并递增 `source_revision`。
6. repository 的内容变化 SQL 未包含 `review_status`、`editor_title`、`editor_excerpt`、`editor_notes` 或 `editor_based_on_source_revision`，聚焦测试已把人工状态置为 `approved` 后验证全部保持。
7. CLI 收据只含 profile/source/run/slot、状态、reason、计数、响应 hash 与 `externalCalls`；不输出 feed 内容、header、IP、stack 或本机绝对路径。

## 4. 已验证

- 聚焦 Vitest，仅运行一次：固定 Node `24.18.0` 下执行 `vitest run src/tests/rss-real.test.ts --config vitest.config.ts`，结果 `1 file passed / 3 tests passed`。
- Node 24 静态类型，仅运行一次：固定 Node `24.18.0` 下执行 `npm run typecheck`，结果 PASS。
- `git diff --check`：仅运行一次，结果 PASS。
- 测试全程使用内存 SQLite 与本地 XML fixture；真实请求次数为 0。

## 5. 未验证与边界

- 未对 Motorsport.com 发真实请求，因此当前 200/304/redirect/MIME/ETag/Last-Modified、地区可达性与实际 RSS 字段仍为运行期 Unknown。
- 未运行全量 `check`、build、lint、其他测试或 CLI；严格遵守任务限定验证预算。
- 未创建或启用 LaunchAgent，未初始化 M1 私有生产目录，未生成部署 manifest、release/commit/plist hash，也未做 15 分钟调度、停机回退、测试部或安全部独立复验。
- 未部署、未提交 Git、未写 Base、未调用文章页/媒体/API/AI，未创建 ReleaseBundle、Publication、PublishedProjection 或公开 DTO。
- 当前实现候选仍只允许进入后续测试/安全门；真实定时启用和公开数据切换均未放行。

## 6. 错题自检

- 合同身份使用修正后的最终 SHA，没有沿用冲突修正前的 `61fff97e…c9c3b`。
- schema 门同时检查 migration SHA、三表/列、外键/完整性与完整 sqlite schema fingerprint，可识别列名相同但约束或索引漂移。
- 304 后数据库失败、DNS 失败和解析失败的 CLI 收据均按已进入网络路径记 `externalCalls=1`；显式 I/O 门前失败保持 0。
- 机器更新 SQL 不修改人工字段或人工状态，复审需求只由 revision 差值派生。
- 没有触碰无关脏文件，没有真实请求、部署或 Git 提交。

TASK_STATE_OK
