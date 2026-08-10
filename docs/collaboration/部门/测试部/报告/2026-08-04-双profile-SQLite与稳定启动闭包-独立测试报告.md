---
type: audit_report
department: 测试部
target: TASK-20260804-253A43；TASK-20260802-3760F6
status: final
date: 2026-08-04
related_task: TASK-20260804-9F2DAD
decision: pass
sqlite_decision: pass
startup_decision: pass
tags: [M4, SQLite, public-synthetic, Next, stable-closure, read-only]
summary: 稳定冻结105文件完整闭包后，public-synthetic-seed 3/3、p1-cli 13/13、test:p1均一次通过；SQLite与启动分别P0=0、P1=0、P2=0，整体PASS。
---

# 双 profile SQLite 与稳定启动闭包独立测试报告

## 1. 结论

- `sqlite_decision=PASS`：`P0=0 / P1=0 / P2=0`。
- `startup_decision=PASS`：`P0=0 / P1=0 / P2=0`。
- 整体：`decision=PASS`。

本结论仅覆盖下述冻结闭包及指定行为出口，不放行 Repository/API、R5、R12、真实外部能力或部署。

## 2. 冻结闭包

- 完整源/配置/迁移/测试/四组必要 data：`105` 个文件；测试前后聚合 SHA-256 均为 `8c9de378656dee691318ab63e9c8a870f4d96d7d16a60c5a41ca2ef2ab43411c`。
- SQLite 报告列出的 12 项实现 SHA 与正式候选逐项一致。
- 启动候选三项 SHA 一致：`serve.ts=5ee435…a6979`、`p1-acceptance.ts=bcfd9f…0d29c`、`p1-cli.test.ts=614241…f71e`。
- 正式共享 `.next` 由冻结源一次构建：186 个文件，manifest SHA-256 `ab96819e46b51eeb24bc7e99a977f22bd756c9149581c9b1961b40ea50f36ea3`；源闭包构建前后不变。

首次隔离 build 因测试封装使用外指 `node_modules` symlink 被 Turbopack 在编译前拒绝，按 NOT_RUN 前置处理，不计功能轮次。统筹随后授权由同一冻结源在正式 `app/` 只生成一次共享 `.next`，供测试与安全复用。

## 3. 实际验证与结果

1. `public-synthetic-seed.test.ts` 只运行一次：`1 file / 3 tests PASS`。
   - 两个 profile 为不同 SQLite 文件与 inode；
   - public 实体精确为 `1/12/12/12/10/12/12/12/12`，approved→published join 为 12，ledger 为 1；
   - public 二次 seed 为零写；root 漂移写前拒绝、seed 故障全事务回滚、v3 migration 故障回滚到 v2、ATTACH 与跨 profile 混用拒绝；
   - M3 保持 59×39、59 disabled、无 `src-active`、无 public 内容，投影 hash 为 `e7a8312c70a9a49922aedb3cfbeaa190db8f5dce8d4ab45db1570748fc329f17`。
2. `p1-cli.test.ts` 只运行一次：`1 file / 13 tests PASS`。
   - dev/start 附加 argv、四类既有 CLI 失败及 dev/start 端口冲突、start 缺失 build 均按 exact 四字段安全 JSON 收敛；没有原始 Next banner、URL、Error、stack、path、address 或 port 穿透。
3. `test:p1` 只运行一次：PASS。
   - `127.0.0.1:3000`、health `ready`、`externalCalls=0`；
   - `SIGINT` 后 `stopped=true`、`portsClear=[3000,3101]`、`processGroupClear=true`。

未运行完整 check、lint、typecheck、第二轮目标套件或同质探针。

## 4. 未验证与清理

- 未验证正常 dev HMR 长时间体验、R5 完整 TOCTOU、R12 系统调用级 no-egress、Repository/API、真实平台与部署。
- 正式 `.local` 未生成 SQLite 文件；目标测试创建的数据库、profile/p1 临时目录、主隔离副本和首次封装失败 panic log均已清理。
- 额外清理了前一轮失真测试确认归属本测试会话的三个精确 TMPDIR：`f1plus1-p1-next-vEsoiw`、`f1plus1-p1-next-V6GIP7`、`f1plus1-p1-next-XxeIi7`。
- 按统筹指令保留一次构建的共享正式 `.next` 供安全部复用并由安全流程统一清理；测试部未重建或再次修改它。

## 5. 错题自检

- 只把冻结稳定闭包上的一次有效行为结果计入 PASS；隔离 build 包装失败未伪装成候选功能失败。
- 没有重复目标套件、完整 check、修代码、ACK 或扩大放行。
- 清理只使用逐项确认归属的精确路径，没有使用宽泛 glob，也没有触碰安全部目录。

