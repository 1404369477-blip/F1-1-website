---
type: department_report
status: final
date: 2026-08-12
department: 开发部
task_id: TASK-20260812-50B654
decision: pass
external_calls: 0
---

# 50B654 两个空 Next 目录清理与 release 验签 delta 收口报告

## 结论

仅删除 `.next/server/app 2` 与 `.next/server/chunks 2` 两个精确重复空目录。删除前两者均为真实目录、uid 501、mode 0700、entry count 0、非 symlink 且 realpath 与输入逐字相同；各使用一次 `rmdir`，删除后均 absent。未删除其他路径，未改 runtime、manifest 或其他 `.next` 字节。

闭包外 M1 target harness 唯一一次验签 PASS：manifest `d14ee6025d55edb238bc8c8ac9e7b189442161ddd543531fa075db6b1b6f811a`；content root `35021046566c90f9580b3ffe84d0ff64ceb0b38dc8584579e63dbeddcbe35fb8`；release root `8e70b2b745e3013d4667b7eb646c91f5286e8906b9254deaef5fffb6666ff30a`；runtime 89、Next 322 / 13,399,239 bytes / root `5da23a79…9d45`、production packages 44 / dependency root `517c29e4…2ffe`。

## Delta 产物

基线为既有 M1 release `f868497562332e6b365479f48105aba298783aa23513a0b962ac2ba318f462a6`，旧 manifest 从保留 tar 只读取出且 SHA 为 `58b6da76…9c95f`。新 delta 包含 33 个新增/修改文件与 3 个删除路径，changed payload 合计 4,283,903 bytes；路径均来自旧/新 manifest 闭包，测试、报告、DB、PEM、secret/token/private-key 与其他敏感路径为 0。

- manifest: `scratch/TASK-20260812-748EA3/f868-to-8e70-delta-manifest.json`
  - size: 5,747 bytes
  - SHA-256: `cbf42a5f4332c3a753ae5050ce95be10973cb5eb7171c28430f2178add789ff3`
- archive: `scratch/TASK-20260812-748EA3/f868-to-8e70-delta.tar`
  - size: 4,344,832 bytes
  - SHA-256: `92d4dd5ae4480f9e5c3bee8e2c1054ddf4295252e8d548adfe186fd860142bda`

两项产物均 mode 0600、uid 501、nlink 1；archive 路径集合与 manifest changed 集合逐字相等。删除清单只记录在 manifest，不在 tar 内制造占位文件。

## 验证预算

- production build：继承 72B4B1 唯一 PASS，本任务 0 重跑。
- release builder：继承 72B4B1 唯一 PASS，本任务 0 重跑。
- 闭包外 target harness：唯一一次 PASS。
- Node 24 typecheck：唯一一次 PASS。
- 目标 release 文件限定 `git diff --check`：唯一一次 PASS。

## 未验证与边界

未在 M1 应用或重建 delta，未执行 M1 target verifier、SSH、传输、prepare、真实 DB、LaunchAgent、load 或 cutover。delta 只是受控传输候选；目标机必须先验证旧 release root，再在全新 stage 应用 changed/deleted，最后以新 manifest 外部 SHA 执行唯一 target verifier。

## 错题自检

未把空目录清理扩大为通用删除；未重build/builder；未修改 runtime 或 release identity；未将静态 delta 校验写成目标机应用成功；未包含 `.local` 数据库、密钥、测试或报告。

TASK_STATE_OK
