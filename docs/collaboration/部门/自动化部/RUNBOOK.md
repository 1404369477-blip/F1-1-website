# 自动化部（M1运行办公室）RUNBOOK

## 日常只读巡检

1. 从 M1 owner-only inbox 读取唯一 task contract，验证 taskId、有效期、body SHA 和治理文档 SHA。
2. 以原子独占方式领取 taskId lease；已有活动 lease 时返回 `TASK_IN_PROGRESS`，过期或不一致时进入 reconcile，不能另起并发任务。
3. 展示状态可读 `latest.json`；任务执行只读合同绑定的不可变 `receipts/by-sha/<sha>.json`，验证 schema、machineId、年龄、SHA 和副作用声明。
4. 汇总 RSSHub 1200、collector、refiner、automatic review、Admin 3101、Public 3000、receiver 3102、projection active、review DB 只读快照、备份与失败收据。
5. 流量能力存在时只读聚合收据，不能直接把原始 access log 纳入 AI prompt 或治理文档。
6. outbox 只写脱敏聚合、reasonCode、年龄、hash 和建议；原子落盘后由 M5 统筹部核验。

## 异常等级

- `warning`：服务仍可读，但存在备份龄、历史 stderr、投影龄、plist/live 漂移、流量聚合缺失等需跟进问题。
- `critical`：listener/launchd、DB integrity/schema、collector/refiner 新鲜度、Public 健康或异机备份门失败。

发现 `critical` 时只报告，不自动重启。统筹部另行派发诊断、修复、部署或回退任务。

## 受控变更

生产变更必须有独立任务、精确输入 SHA、备份/RPO 证据、回退锚、fresh 用户授权和安全/测试门。日常只读 lease 不能扩张为生产写授权。

## 已知后继

1. RSSHub 接入 production collector catalog：独立开发/数据/安全/测试任务。
2. 条件自动发布：继续等待既有安全合同与实现门闭合。
3. Ops observer 安装：候选复核通过后再单独取得安装授权。
4. 流量聚合 producer：先固定结构化 schema、隐私预算、保留期和独立测试，再申请代码/部署任务；当前不启用。
