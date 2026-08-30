# Scrub log

Original plaintext values are not recorded. `sha12` is SHA-256 of the replaced substring, first 12 hex chars.

## Original unpushed commits (52e6549..HEAD before rebuild)

Recorded before `git reset --soft 52e6549`:

| hash | title |
| --- | --- |
| `f1b6878b4bdba0e4152f1257858f398dbdda22fb` | fix(ui): eliminate double scroll and dock directly to top once |
| `71ae68a1ce422a1a3d27c9a17304fdeb7ae488af` | feat(ui): pure borderless card zoom, background blur, and smooth top-docking |
| `8f305e15599e43bc157705cce0d159da9aab02c3` | feat(ui): fluid in-place card expansion with smooth zoom transition |
| `6b6e4b2e54468ae69e0ae005dcc1de1771196457` | fix(public): hide duplicate chinese refinement |
| `4b37f72093384bdcf47a6e3fc81ad392cdc78adb` | fix(public): sort timeline by source time |

## Replacement rows

336 replacements across 115 files. `in_inventory=false` means the file was outside gemini's pending-tree inventory but had to be scrubbed so new-commit whole-tree `git grep` is 0 (origin `52e6549` already contained some `[EPHEMERAL-TUNNEL-URL]` / `[M1-HOME]` / `[M5-HOME]` hits).

| file | line | placeholder | sha12 | kind | in_inventory |
| --- | ---: | --- | --- | --- | --- |
| `docs/collaboration/tasks/TASK-20260804-795FB0.json` | 24 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/tasks/TASK-20260812-0196EB.json` | 25 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-047E93.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-047E93.json` | 13 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-049D92.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-049D92.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-049D92.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-049D92.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-05CCAF.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-0E53C4.json` | 17 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-2B6D52.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-2B6D52.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-3844EF.json` | 16 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-3BC9C6.json` | 16 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-3BC9C6.json` | 41 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-418763.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-418763.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-418763.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-45E5C7.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-45E5C7.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-45E5C7.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-45E5C7.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-49B22E.json` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-4F7345.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-50B654.json` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-50B654.json` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-50BBC7.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-670A4F.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-670A4F.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-670A4F.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-670A4F.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-6B1B40.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-72B4B1.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-748EA3.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-78D6BC.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-7B8E33.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-817BA9.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-85E90D.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-85E90D.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-85E90D.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-A66510.json` | 7 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-B04945.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-B04945.json` | 47 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-B4EE80.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-B91E89.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-C682F8.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-D1A0A8.json` | 2 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-D1A0A8.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-D460D7.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-D460D7.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-E7DA7C.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-F4D716.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-F5F741.json` | 23 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-F5F741.json` | 23 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-F5F741.json` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-F5F741.json` | 26 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260813-3446F3.json` | 29 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260813-53677C.json` | 27 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | true |
| `docs/collaboration/tasks/TASK-20260813-EDBB77.json` | 13 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/collaboration/tasks/TASK-20260815-850FF6.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260815-ABF219.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-C层预检通过与VS-0窗口报告.md` | 37 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-C层预检通过与VS-0窗口报告.md` | 38 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-C层预检通过与VS-0窗口报告.md` | 39 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 31 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 33 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 34 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 35 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 36 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-VS0-M3种子投影产品决策报告.md` | 16 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-VS0-M3种子投影产品决策报告.md` | 69 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 33 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 34 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 34 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 36 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开读模型与API接线v0.4-accepted收口报告.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开读模型与API接线v0.4-accepted收口报告.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开读模型与API接线v0.4-accepted收口报告.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开读模型与API接线v0.4-accepted收口报告.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4-SQLite启动核收与公开API在办状态同步报告.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4-SQLite启动核收与公开API在办状态同步报告.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4-SQLite启动核收与公开API在办状态同步报告.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 49 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 50 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 66 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 67 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 68 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 69 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 42 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 43 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 47 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 48 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 49 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 50 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 51 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-02-M4-C层Node24与SQLite能力预检安全复验报告.md` | 112 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-02-M4-C层Node24与SQLite能力预检安全复验报告.md` | 122 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-02-M4前沿候选许可平台条款与供应链增量准入复核.md` | 101 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-02-M4前沿候选许可平台条款与供应链增量准入复核.md` | 102 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-12-34285A-精确DB路径与app-cap候选最终限定复审报告.md` | 67 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-345AB2-M1第二release-stage全量mode漂移机械恢复安全裁定.md` | 48 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-378614-Next-production-build文件mode规则只读裁定报告.md` | 33 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-3844EF-bb0aa-clean-release与非force推送最终只读复审报告.md` | 60 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-3844EF-bb0aa-clean-release与非force推送最终只读复审报告.md` | 75 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-6320CD-四根解耦与Serve-app-cap最终静态对抗复审报告.md` | 84 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-6320CD-四根解耦与Serve-app-cap最终静态对抗复审报告.md` | 120 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-C0BACB-M1新release-prepare输入只读核对报告.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-C0BACB-M1新release-prepare输入只读核对报告.md` | 31 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-D53D87-M1既有plist权限基线只读裁定报告.md` | 32 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-02-M4-C层Node24与SQLite能力预检报告.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-02-M4-C层Node24与SQLite能力预检报告.md` | 59 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-02-M4-C层Node24与SQLite能力预检报告.md` | 301 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-02-M4-VS-0启动参数与CLI错误泄漏整改报告.md` | 112 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-09-v0.2最终公开信息流正式App落地报告.md` | 67 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-049D92-M1已验签state原子晋升版本release报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-0E53C4-A66510固定Node24路径机械验证报告.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B-M1-CertDomain与Admin-Public-prepare-only报告.md` | 9 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B-M1-CertDomain与Admin-Public-prepare-only报告.md` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B-M1-CertDomain与Admin-Public-prepare-only报告.md` | 14 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B后继-最小启动就绪只读收敛.md` | 21 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B后继-最小启动就绪只读收敛.md` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B后继-最小启动就绪只读收敛.md` | 23 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 31 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 38 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 39 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 54 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-325056-M1第二release双文件原子overlay与正式验签报告.md` | 32 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-3BC9C6-clean-HEAD固定Node24-typecheck-finalizer报告.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-3BC9C6-clean-HEAD固定Node24-typecheck-finalizer报告.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-49B22E-本机两项旧RSS残留精确永久删除报告.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-49B22E-本机两项旧RSS残留精确永久删除报告.md` | 35 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-8EB56C-M1-Admin域名无关prepare前置输入报告.md` | 9 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-8EB56C-M1-Admin域名无关prepare前置输入报告.md` | 54 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-8EB56C-M1-Admin域名无关prepare前置输入报告.md` | 55 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-A156EC-M1-fresh-stage分块传输与目标验签最终报告.md` | 28 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-A156EC-M1-fresh-stage分块传输与目标验签最终报告.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-A156EC-M1-fresh-stage分块传输与目标验签最终报告.md` | 34 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-A66510-Release身份门clean-commit-successor实现报告.md` | 54 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-B91E89-唯一review-DB精确路径先验锚定报告.md` | 15 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-B92A75-M1真实RSS-900秒调度启用与RunAtLoad收据.md` | 10 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-C682F8-M1第二release唯一真实RSS三阶段受控执行报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-D460D7-M1第二release远端stage根漂移首错阻断报告.md` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-D460D7-M1第二release远端stage根漂移首错阻断报告.md` | 102 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 15 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 16 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 120 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 122 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 122 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-EC09C3-M1-Admin运行态启动与DB-v3原位迁移报告.md` | 20 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F031E2-M1-delta-release原子固化报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F031E2-M1-delta-release原子固化报告.md` | 53 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F055A6-Next空目录xattr探针兼容与manifest验签报告.md` | 38 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F4D716-三设备M1-release与Admin-reprepare-finalizer报告.md` | 16 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F4D716-三设备M1-release与Admin-reprepare-finalizer报告.md` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F5F741-bb0aa新release增量同步M1原子固化报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-3446F3-Tailscale三设备Grant-IP选择器纠正报告.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-3446F3-Tailscale三设备Grant-IP选择器纠正报告.md` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-3446F3-Tailscale三设备Grant-IP选择器纠正报告.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-53677C-公开站v0.2冻结视觉生产部署报告.md` | 7 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-53677C-公开站v0.2冻结视觉生产部署报告.md` | 44 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-53677C-公开站v0.2冻结视觉生产部署报告.md` | 54 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-53677C-公开站v0.2冻结视觉生产部署报告.md` | 55 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-14-自动初审与人工恢复生产启用报告.md` | 16 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-14-自动初审与人工恢复生产启用报告.md` | 32 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 24 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 17 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 27 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 28 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 30 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 139 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 159 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 189 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-Event去重与最近采集映射候选.md` | 16 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-SQLite迁移与fixture映射蓝图.md` | 17 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-SQLite迁移与fixture映射蓝图.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-SQLite迁移与fixture映射蓝图.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-SQLite迁移与fixture映射蓝图.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 24 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 27 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 28 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 29 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 30 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 15 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 24 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 27 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 28 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 29 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 30 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 31 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-04-public-synthetic运行完整性失败责任边界诊断.md` | 35 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-04-public-synthetic运行完整性失败责任边界诊断.md` | 36 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-04-public-synthetic运行完整性失败责任边界诊断.md` | 65 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-04-public-synthetic运行完整性失败责任边界诊断.md` | 66 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 38 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 65 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 66 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 224 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 378 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-新Mac迁移完整复验与清理后回归报告.md` | 30 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-新Mac迁移完整复验与清理后回归报告.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/TASK-20260811-E1DCF2-evidence/runtime-receipt.json` | 6 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/测试部/报告/TASK-20260811-E1DCF2-evidence/runtime-receipt.json` | 13 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/测试部/报告/TASK-20260811-E1DCF2-evidence/runtime-receipt.json` | 46 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/测试部/报告/TASK-20260811-E1DCF2-evidence/runtime-receipt.json` | 46 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/研究部/报告/2026-08-09-设计部发布视频任务建议书.md` | 45 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/研究部/报告/2026-08-09-设计部发布视频任务建议书.md` | 81 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/交接班文档.md` | 79 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/2026-08-15-Open-Design方向整合与21秒静音审片样片完成报告.md` | 38 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/capture-results.json` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/capture-results.json` | 55 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/capture-results.json` | 91 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/capture-results.json` | 127 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 8 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 13 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 28 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 54 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 93 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 132 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 171 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 201 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 208 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 213 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/render-recipe.md` | 4 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/static-check.json` | 33 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/static-check.json` | 38 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/static-check.json` | 43 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-253682/static-contract-and-diff-check.json` | 140 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 24 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 25 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 26 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 27 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 57 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 69 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-23-F1+1-release-successor-工程证据闭包-v1.md` | 36 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/decisions/system/2026-08-24-F1+1-release-successor-R2-工程证据闭包-v2.md` | 34 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/decisions/system/2026-08-24-F1+1-v6到v10双语完整Admin生产successor-accepted.md` | 157 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/decisions/system/2026-08-30-F1+1-数据可再生性分层与RPO重定级-proposed.md` | 69 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-30-F1+1-数据可再生性分层与RPO重定级-proposed.md` | 293 | `[PRIVATE-TAILNET]` | `6c57d5b66992` | tailnet | true |
| `docs/handoff.md` | 7 | `[EPHEMERAL-TUNNEL-URL]` | `5e7695aa4dff` | tunnel-url | true |
| `docs/handoff.md` | 9 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/handoff.md` | 10 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | true |
| `docs/handoff.md` | 10 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 20 | `[PRIVATE-TAILNET]` | `6c57d5b66992` | tailnet | true |
| `docs/progress.md` | 105 | `[EPHEMERAL-TUNNEL-URL]` | `5e7695aa4dff` | tunnel-url | true |
| `docs/progress.md` | 122 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 125 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 133 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 141 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 142 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 145 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 161 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 163 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 164 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 213 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/progress.md` | 228 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | true |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 7 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 12 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 14 | `[EPHEMERAL-TUNNEL-URL]` | `948f3fd24f9c` | [EPHEMERAL-TUNNEL-URL]-substring-leftover | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 24 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 40 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 75 | `[EPHEMERAL-TUNNEL-URL]` | `948f3fd24f9c` | [EPHEMERAL-TUNNEL-URL]-substring-leftover | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 75 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 81 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 82 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 83 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 105 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 111 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 117 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 118 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 9 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 10 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 16 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 31 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 32 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 54 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 56 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 74 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 75 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 76 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 79 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 81 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 89 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 99 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 111 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 121 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 132 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/spec/F1+1-v6到v10双语完整Admin与公开部署实施合同-v1.0.md` | 660 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/spec/F1+1-初版全功能追踪矩阵-v0.1.md` | 100 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/spec/F1+1-双语完整Admin与公开部署Function矩阵-v1.0.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/spec.md` | 14 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/spec.md` | 113 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/当前生产状态与执行待办.md` | 27 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/当前生产状态与执行待办.md` | 28 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/当前生产状态与执行待办.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/当前生产状态与执行待办.md` | 30 | `[M1-LAN-HOSTNAME]` | `17d1b023d6ad` | lan-hostname | true |
| `docs/当前生产状态与执行待办.md` | 31 | `[CODEX-TASK-ID]` | `38a34954f282` | codex-task-id | true |
| `docs/当前生产状态与执行待办.md` | 38 | `[EPHEMERAL-TUNNEL-URL]` | `5e7695aa4dff` | tunnel-url | true |
| `docs/当前生产状态与执行待办.md` | 43 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/当前生产状态与执行待办.md` | 51 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| file | line | placeholder | sha12 | kind | in_inventory |
| --- | ---: | --- | --- | --- | --- |
| `docs/collaboration/tasks/TASK-20260804-795FB0.json` | 24 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/tasks/TASK-20260812-0196EB.json` | 25 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-047E93.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-047E93.json` | 13 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-049D92.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-049D92.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-049D92.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-049D92.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-05CCAF.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-0E53C4.json` | 17 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-2B6D52.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-2B6D52.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-3844EF.json` | 16 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-3BC9C6.json` | 16 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-3BC9C6.json` | 41 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-418763.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-418763.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-418763.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-45E5C7.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-45E5C7.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-45E5C7.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-45E5C7.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-49B22E.json` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-4F7345.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-50B654.json` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-50B654.json` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-50BBC7.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-670A4F.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-670A4F.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-670A4F.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-670A4F.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-6B1B40.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-72B4B1.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-748EA3.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-78D6BC.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-7B8E33.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-817BA9.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-85E90D.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-85E90D.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-85E90D.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-A66510.json` | 7 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-B04945.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-B04945.json` | 47 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-B4EE80.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-B91E89.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-C682F8.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-D1A0A8.json` | 2 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-D1A0A8.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-D460D7.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-D460D7.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-E7DA7C.json` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-F4D716.json` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-F5F741.json` | 23 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-F5F741.json` | 23 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260812-F5F741.json` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260812-F5F741.json` | 26 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260813-3446F3.json` | 29 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/tasks/TASK-20260813-53677C.json` | 27 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | true |
| `docs/collaboration/tasks/TASK-20260813-EDBB77.json` | 13 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/collaboration/tasks/TASK-20260815-850FF6.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/tasks/TASK-20260815-ABF219.json` | 19 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-C层预检通过与VS-0窗口报告.md` | 37 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-C层预检通过与VS-0窗口报告.md` | 38 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-C层预检通过与VS-0窗口报告.md` | 39 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 31 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 33 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 34 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 35 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-M4-VS-1重试与validation-job决策候选.md` | 36 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-VS0-M3种子投影产品决策报告.md` | 16 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-02-VS0-M3种子投影产品决策报告.md` | 69 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 33 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 34 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 34 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开数据API接线v0.4-proposed工作包.md` | 36 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开读模型与API接线v0.4-accepted收口报告.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开读模型与API接线v0.4-accepted收口报告.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开读模型与API接线v0.4-accepted收口报告.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-03-公开读模型与API接线v0.4-accepted收口报告.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4-SQLite启动核收与公开API在办状态同步报告.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4-SQLite启动核收与公开API在办状态同步报告.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4-SQLite启动核收与公开API在办状态同步报告.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 49 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 50 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 66 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 67 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 68 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-04-M4公开前端PASS与v0.4数据门禁状态同步报告.md` | 69 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 42 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 43 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 47 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 48 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 49 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 50 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/产品部/报告/2026-08-07-实现级设计合同v0.2同步报告.md` | 51 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-02-M4-C层Node24与SQLite能力预检安全复验报告.md` | 112 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-02-M4-C层Node24与SQLite能力预检安全复验报告.md` | 122 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-02-M4前沿候选许可平台条款与供应链增量准入复核.md` | 101 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-02-M4前沿候选许可平台条款与供应链增量准入复核.md` | 102 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/安全部/报告/2026-08-12-34285A-精确DB路径与app-cap候选最终限定复审报告.md` | 67 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-345AB2-M1第二release-stage全量mode漂移机械恢复安全裁定.md` | 48 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-378614-Next-production-build文件mode规则只读裁定报告.md` | 33 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-3844EF-bb0aa-clean-release与非force推送最终只读复审报告.md` | 60 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-3844EF-bb0aa-clean-release与非force推送最终只读复审报告.md` | 75 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-6320CD-四根解耦与Serve-app-cap最终静态对抗复审报告.md` | 84 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-6320CD-四根解耦与Serve-app-cap最终静态对抗复审报告.md` | 120 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-C0BACB-M1新release-prepare输入只读核对报告.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-C0BACB-M1新release-prepare输入只读核对报告.md` | 31 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/安全部/报告/2026-08-12-D53D87-M1既有plist权限基线只读裁定报告.md` | 32 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-02-M4-C层Node24与SQLite能力预检报告.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-02-M4-C层Node24与SQLite能力预检报告.md` | 59 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-02-M4-C层Node24与SQLite能力预检报告.md` | 301 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-02-M4-VS-0启动参数与CLI错误泄漏整改报告.md` | 112 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-09-v0.2最终公开信息流正式App落地报告.md` | 67 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-049D92-M1已验签state原子晋升版本release报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-0E53C4-A66510固定Node24路径机械验证报告.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B-M1-CertDomain与Admin-Public-prepare-only报告.md` | 9 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B-M1-CertDomain与Admin-Public-prepare-only报告.md` | 13 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B-M1-CertDomain与Admin-Public-prepare-only报告.md` | 14 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B后继-最小启动就绪只读收敛.md` | 21 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B后继-最小启动就绪只读收敛.md` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-1F1B7B后继-最小启动就绪只读收敛.md` | 23 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 31 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 38 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 39 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-2B6D52-M1真实RSS旧stage与迁移残留精确清理首错阻断报告.md` | 54 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-325056-M1第二release双文件原子overlay与正式验签报告.md` | 32 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-3BC9C6-clean-HEAD固定Node24-typecheck-finalizer报告.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-3BC9C6-clean-HEAD固定Node24-typecheck-finalizer报告.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-49B22E-本机两项旧RSS残留精确永久删除报告.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-49B22E-本机两项旧RSS残留精确永久删除报告.md` | 35 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-8EB56C-M1-Admin域名无关prepare前置输入报告.md` | 9 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-8EB56C-M1-Admin域名无关prepare前置输入报告.md` | 54 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-8EB56C-M1-Admin域名无关prepare前置输入报告.md` | 55 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-A156EC-M1-fresh-stage分块传输与目标验签最终报告.md` | 28 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-A156EC-M1-fresh-stage分块传输与目标验签最终报告.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-A156EC-M1-fresh-stage分块传输与目标验签最终报告.md` | 34 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-A66510-Release身份门clean-commit-successor实现报告.md` | 54 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-B91E89-唯一review-DB精确路径先验锚定报告.md` | 15 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-B92A75-M1真实RSS-900秒调度启用与RunAtLoad收据.md` | 10 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-C682F8-M1第二release唯一真实RSS三阶段受控执行报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-D460D7-M1第二release远端stage根漂移首错阻断报告.md` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-D460D7-M1第二release远端stage根漂移首错阻断报告.md` | 102 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 15 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 16 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 120 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 122 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-E157BC-M1真实RSS单次受控采集实施报告.md` | 122 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/开发部/报告/2026-08-12-EC09C3-M1-Admin运行态启动与DB-v3原位迁移报告.md` | 20 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F031E2-M1-delta-release原子固化报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F031E2-M1-delta-release原子固化报告.md` | 53 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F055A6-Next空目录xattr探针兼容与manifest验签报告.md` | 38 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F4D716-三设备M1-release与Admin-reprepare-finalizer报告.md` | 16 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F4D716-三设备M1-release与Admin-reprepare-finalizer报告.md` | 22 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-12-F5F741-bb0aa新release增量同步M1原子固化报告.md` | 17 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-3446F3-Tailscale三设备Grant-IP选择器纠正报告.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-3446F3-Tailscale三设备Grant-IP选择器纠正报告.md` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-3446F3-Tailscale三设备Grant-IP选择器纠正报告.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-53677C-公开站v0.2冻结视觉生产部署报告.md` | 7 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-53677C-公开站v0.2冻结视觉生产部署报告.md` | 44 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-53677C-公开站v0.2冻结视觉生产部署报告.md` | 54 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-13-53677C-公开站v0.2冻结视觉生产部署报告.md` | 55 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-14-自动初审与人工恢复生产启用报告.md` | 16 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/开发部/报告/2026-08-14-自动初审与人工恢复生产启用报告.md` | 32 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 24 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-01-本地MVP数据合同与安全样例.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 17 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-C层SQLite与Repository实现交接蓝图.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 27 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 28 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 30 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 139 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 159 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-0-seed-enrichment解阻报告.md` | 189 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-Event去重与最近采集映射候选.md` | 16 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-SQLite迁移与fixture映射蓝图.md` | 17 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-SQLite迁移与fixture映射蓝图.md` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-SQLite迁移与fixture映射蓝图.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-M4-VS-1-SQLite迁移与fixture映射蓝图.md` | 20 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 24 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 27 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 28 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 29 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.2升级与P0闭合.md` | 30 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 15 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 21 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 22 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 24 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 25 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 26 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 27 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 28 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 29 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 30 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-02-本地MVP数据合同v0.3-A轴阻断闭合.md` | 31 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-04-public-synthetic运行完整性失败责任边界诊断.md` | 35 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-04-public-synthetic运行完整性失败责任边界诊断.md` | 36 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-04-public-synthetic运行完整性失败责任边界诊断.md` | 65 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/数据部/报告/2026-08-04-public-synthetic运行完整性失败责任边界诊断.md` | 66 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 38 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 65 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 66 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 224 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-M4-C层Node24与SQLite能力预检测试复验报告.md` | 378 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-新Mac迁移完整复验与清理后回归报告.md` | 30 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/2026-08-02-新Mac迁移完整复验与清理后回归报告.md` | 32 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/collaboration/部门/测试部/报告/TASK-20260811-E1DCF2-evidence/runtime-receipt.json` | 6 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/测试部/报告/TASK-20260811-E1DCF2-evidence/runtime-receipt.json` | 13 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/测试部/报告/TASK-20260811-E1DCF2-evidence/runtime-receipt.json` | 46 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/测试部/报告/TASK-20260811-E1DCF2-evidence/runtime-receipt.json` | 46 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/研究部/报告/2026-08-09-设计部发布视频任务建议书.md` | 45 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/研究部/报告/2026-08-09-设计部发布视频任务建议书.md` | 81 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/交接班文档.md` | 79 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/2026-08-15-Open-Design方向整合与21秒静音审片样片完成报告.md` | 38 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/capture-results.json` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/capture-results.json` | 55 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/capture-results.json` | 91 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/capture-results.json` | 127 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 8 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 13 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 18 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 23 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 28 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 54 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 93 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 132 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 171 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 201 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 208 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/manifest.json` | 213 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/render-recipe.md` | 4 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/static-check.json` | 33 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/static-check.json` | 38 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-0C206C/static-check.json` | 43 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/collaboration/部门/设计部/报告/证据/TASK-20260812-253682/static-contract-and-diff-check.json` | 140 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 24 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 25 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 26 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 27 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 57 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-12-F1+1-不可变release与唯一持久数据回退根解耦-successor-accepted.md` | 69 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-23-F1+1-release-successor-工程证据闭包-v1.md` | 36 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/decisions/system/2026-08-24-F1+1-release-successor-R2-工程证据闭包-v2.md` | 34 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/decisions/system/2026-08-24-F1+1-v6到v10双语完整Admin生产successor-accepted.md` | 157 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/decisions/system/2026-08-30-F1+1-数据可再生性分层与RPO重定级-proposed.md` | 69 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/decisions/system/2026-08-30-F1+1-数据可再生性分层与RPO重定级-proposed.md` | 293 | `[PRIVATE-TAILNET]` | `6c57d5b66992` | tailnet | true |
| `docs/handoff.md` | 7 | `[EPHEMERAL-TUNNEL-URL]` | `5e7695aa4dff` | tunnel-url | true |
| `docs/handoff.md` | 9 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/handoff.md` | 10 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | true |
| `docs/handoff.md` | 10 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 20 | `[PRIVATE-TAILNET]` | `6c57d5b66992` | tailnet | true |
| `docs/progress.md` | 105 | `[EPHEMERAL-TUNNEL-URL]` | `5e7695aa4dff` | tunnel-url | true |
| `docs/progress.md` | 122 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 125 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 133 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 141 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 142 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 145 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 161 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 163 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 164 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/progress.md` | 213 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/progress.md` | 228 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | true |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 7 | `[EPHEMERAL-TUNNEL-URL]` | `2223e7f6f1dd` | tunnel-url | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 12 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 14 | `[EPHEMERAL-TUNNEL-URL]` | `948f3fd24f9c` | [EPHEMERAL-TUNNEL-URL]-substring-leftover | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 24 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 40 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 75 | `[EPHEMERAL-TUNNEL-URL]` | `948f3fd24f9c` | [EPHEMERAL-TUNNEL-URL]-substring-leftover | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 75 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 81 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 82 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 83 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 105 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 111 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 117 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1公开Beta-SSH运行收据-v0.1.md` | 118 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 9 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 10 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 16 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 31 | `[M5-HOME]` | `1fb1dae72043` | m5-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 32 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 54 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 56 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 74 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 75 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 76 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 79 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 81 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 89 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 99 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 111 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 121 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/runbooks/F1+1-固定M1真实RSS采集器部署与回退-v0.1.md` | 132 | `[M1-HOME]` | `83ab04368baa` | m1-home | false |
| `docs/spec/F1+1-v6到v10双语完整Admin与公开部署实施合同-v1.0.md` | 660 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/spec/F1+1-初版全功能追踪矩阵-v0.1.md` | 100 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/spec/F1+1-双语完整Admin与公开部署Function矩阵-v1.0.md` | 19 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/spec.md` | 14 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/spec.md` | 113 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/当前生产状态与执行待办.md` | 27 | `[M5-HOME]` | `1fb1dae72043` | m5-home | true |
| `docs/当前生产状态与执行待办.md` | 28 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/当前生产状态与执行待办.md` | 29 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |
| `docs/当前生产状态与执行待办.md` | 30 | `[M1-LAN-HOSTNAME]` | `17d1b023d6ad` | lan-hostname | true |
| `docs/当前生产状态与执行待办.md` | 31 | `[CODEX-TASK-ID]` | `38a34954f282` | codex-task-id | true |
| `docs/当前生产状态与执行待办.md` | 38 | `[EPHEMERAL-TUNNEL-URL]` | `5e7695aa4dff` | tunnel-url | true |
| `docs/当前生产状态与执行待办.md` | 43 | `[PRIVATE-ADMIN-HOST]` | `b3fe6ddefa9f` | full-admin-host | true |
| `docs/当前生产状态与执行待办.md` | 51 | `[M1-HOME]` | `83ab04368baa` | m1-home | true |

## Rebuild result (no push)

New local commits on `codex/first-public-release` (`52e6549` is still `origin/codex/first-public-release`):

| hash | title | files |
| --- | --- | ---: |
| `b7bc31e58dc678b88d712927daf71ad3a9d38df8` | chore: harden gitignore and scrub private identifiers from docs | 435 |
| `8dfc6dd024628738b6579a235bf4aa8d56c42eec` | feat(app): carry forward unpushed application work | 171 |
| `f4390ae1f6f8b0cd6b1d277f77954328f9d3a966` | data: add x-source selection and inventory | 3 |

c3 skipped: docs already landed in c1.

Backup tag `scrub-backup-20260830` = `f1b6878b4bdba0e4152f1257858f398dbdda22fb`.

## Verification gates

Run against `git rev-list 52e6549..HEAD` (b7bc31e, 8dfc6dd, f4390ae). `git status --porcelain` empty.

| gate | result |
| --- | --- |
| `[PRIVATE-TAILNET]` whole-tree per new commit | 0 / 0 / 0 |
| `[M1-HOSTNAME]` | 0 / 0 / 0 |
| `[EPHEMERAL-TUNNEL-URL]` | 0 / 0 / 0 |
| `[M1-LAN-HOSTNAME]` | 0 / 0 / 0 |
| `[CODEX-TASK-ID]` prefix | 0 / 0 / 0 |
| `[M1-HOME]` and `[M5-HOME]` on `-- docs data` | 0 / 0 / 0 |
| tag `scrub-backup-20260830` exists | yes, `f1b6878` |
| `docs/private-endpoints.local.md` ignored | yes (`*.local.md`) |
| `existing-authority-schema8.sqlite` ignored | yes (`*.sqlite`) |
| `.claude/` ignored | yes |
| scratch originals / this log ignored | yes (`scratch/*`) |

### app/ accepted residual at HEAD

`[M1-HOME]`: **6 files / 17 lines**. `[M5-HOME]`: 0.

Files: `app/scripts/admin-bootstrap-owner-handoff 2.ts`, `app/scripts/admin-bootstrap-owner-handoff.ts`, `app/scripts/admin-production-migrate-v10.ts`, `app/scripts/prepare-v10-release-candidate.ts`, `app/src/server/admin-service/deployment.ts`, `app/src/tests/admin-service.test.ts`.

### `git ls-files | grep -iE 'sqlite|\\.local|^scratch/|\\.claude'`

Not only `scratch/README.md`. Extra matches are:

- origin-tracked `deployment/bootstrap/legacy/f1plus1.sqlite` and `f1plus1-public-synthetic.sqlite` (already at `52e6549`; `*.sqlite` does not untrack)
- markdown report filenames containing `SQLite` (case-insensitive grep)
- allowed `scratch/README.md`

No `.local` / `.local.md` / `.claude/` / new sqlite databases were added by this rebuild.

## Deviations from the prompt

1. Scrub set expanded by 27 docs files beyond gemini inventory so whole-tree `git grep` on new commits is 0. Origin `52e6549` already contained `[EPHEMERAL-TUNNEL-URL]` and `[M1-HOME]`/`[M5-HOME]` in docs/runbooks and older reports.
2. Leftover `[EPHEMERAL-TUNNEL-URL]` / `[EPHEMERAL-TUNNEL-URL]` (Cloudflare docs path and a grep example in the public-beta runbook) also replaced with `[EPHEMERAL-TUNNEL-URL]` so substring grep is 0.
3. `.gitignore` also gained `*.local.md` because `*.local` does not match `private-endpoints.local.md`.
4. After `git reset --soft 52e6549`, a mixed `git reset` was required so `git add` of corresponding paths produced exclusive commits (otherwise c1 would have included the whole f1b6878 tree).
5. Root `-` and the 12 `app/` junk dirs were untracked; deletion is working-tree only (nothing to record as a git delete).
6. Cursor injected `Co-authored-by: Cursor <cursoragent@cursor.com>` on all three new commits.
7. c3 skipped as allowed.
