---
type: audit_report
department: 安全部
status: final
date: 2026-08-04
related_task: TASK-20260804-B9D885
domain_stage: SQLite与启动稳定闭包独立安全复验
execution_mode: isolated_read_only_security_review
decision: fail
severity_count: { P0: 0, P1: 1, P2: 1 }
target: "TASK-20260804-253A43 + TASK-20260802-3760F6 stable candidate"
tags: [M4, SQLite, trust-root, Next, security-review]
summary: "FAIL：SQLite部分静态确认testDatabasePathOverride可由启动前NODE_ENV=test打开，而serve在runtime readiness之后才改为production，命中本任务P1失败路径。Next直接文件静态边界未见放宽，但安全部未完成独立端口冲突和SIGINT行为收据，记NOT_RUN/P2，不放行。"
---

# SQLite信任根与 Next 启动稳定闭包安全复验

## 结论

- **SQLite：FAIL，`P0=0 / P1=1 / P2=0`。**
- **Next 启动：FAIL / NOT_RUN，`P0=0 / P1=0 / P2=1`。**
- **整体：FAIL，`P0=0 / P1=1 / P2=1`。**

SQLite P1 来自静态可达路径：`loadRuntimeConfig()` 仅以 `process.env.NODE_ENV === "test"` 开启 `allowTestDatabasePath`；`serve.ts` 先执行 `assertRuntimeReady()`，之后才把 `NODE_ENV` 改为 `production`。因此启动命令进程可在运行准备阶段继承 `NODE_ENV=test` 并打开任意 `.local/<name>.sqlite` 的测试路径覆盖。这命中任务明确的“`testDatabasePathOverride` 可在 local/production 启用” P1 失败路径。

## 冻结闭包

- `TASK-20260804-253A43` 报告的 12 个实现 SHA 全部匹配。
- `TASK-20260802-3760F6` 的 `serve.ts` / `p1-acceptance.ts` / `p1-cli.test.ts` 三个 SHA 全部匹配。
- 隔离副本初始 app 闭包为 75 个文件，复合 SHA-256 `f301b663e911267757018af0f68afedb253dec778d14a9673d354b04607ce18e`。
- 四个必要 data 目录为 30 个文件，复合 SHA-256 `aceaae8a88b7e9472fe015a725d2e7efeae0da0b0383dee0c27eaceae235c301`。
- 初始候选没有 `.next`；测试部后续生成的共享 `.next` 未被安全部作为独立行为证据。

## 最小证据

### SQLite

- 静态确认四个 root SHA 是 `public-synthetic.ts` 包外常量；`loadPublicPackage()` 在 `withImmediateTransaction()` 之前通过 no-follow/owner/permission/stable-descriptor 路径读取并核对四根。
- 静态确认 public seed 的实体与 ledger 写入均位于同一 `BEGIN IMMEDIATE` 事务，异常路径回滚。
- 静态确认 `openSafeDatabase()` 对路径、symlink、owner、权限和 inode 进行约束，并用 SQLite authorizer 拒绝 `ATTACH/DETACH`。
- 隔离副本 canonical `public-synthetic` migration 到 schema v3 成功，SQLite 3.53.1、WAL/FULL/busy-timeout/foreign-key/temp-store 收据正常。
- root-drift 准备轮的补丁未实际改变 SHA，随后正常 seed 成功；该轮不计为攻击 PASS。工具后续异常挂起，统筹指令停止新检查后，未继续为取得 PASS 重跑。

### Next 启动

- 静态确认 argv gate、`127.0.0.1:3000`、runtime readiness 顺序没有放宽。
- Next child stdout/stderr 仍为 pipe 并在父进程排空；child error/非零 exit 进入 `runSafeCli` 四字段封闭输出。
- SIGINT/SIGTERM 的静态handler仍为一次性注册、转发child、child终止后移除。
- 安全部未完成自主的 `start` 端口冲突与 SIGINT 清理，因此不把测试部收据写成安全部 PASS。

## 未验证

- root 实际漂移后的零 seed 写入、production/local override 真实子进程、cross-profile/ATTACH 行为探针未完成；SQLite P1 已可由静态可达路径确立，无需为重复结论追加攻击。
- Next 端口冲突、SIGINT/process-group/3000/3101 清理和实际四字段唯一输出未由安全部独立验证。
- R5、R12、VS-0 整体、Repository/API 与真实外部能力仍未放行。

## 清理与错题自检

- 已删除本轮精确隔离目录 `/private/tmp/f1plus1-security-stable-g4eCYb`，其中包含的临时 node_modules、DB 与失败准备物一并清理。
- 按统筹指令已删除共享生成物 `app/.next`；未删除任何测试部目录。
- 没有把无效 root-drift 准备轮写成 PASS，没有继承测试部行为结论，没有为取得通过继续耗费性重试。

TASK_STATE_OK
