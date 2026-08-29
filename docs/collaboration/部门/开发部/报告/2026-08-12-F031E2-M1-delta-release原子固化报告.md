---
type: department_report
status: final
date: 2026-08-12
department: 开发部
task_id: TASK-20260812-F031E2
decision: pass
external_calls: 0
---

# F031E2 M1 delta release 原子固化报告

## 结论

固定 M1 已从既有只读验签 release 的 APFS clone 应用精确 delta，并将新版本以同盘原子 rename 固化为：

`[M1-HOME]/F1-1-website/releases/8e70b2b745e3013d4667b7eb646c91f5286e8906b9254deaef5fffb6666ff30a/app`

本链没有执行 prepare、数据库写入、plist 写入、launchctl 修改、load 或 cutover。新版本尚未成为 live app。

## 继承与本任务执行

- 旧 base target verifier：继承 `50BBC7` 唯一一次 PASS，manifest `58b6da76…9c95f`、content `b3886d55…2e987`、release `f8684975…462a6`。
- APFS `cp -cR` clone：继承 `50BBC7` 唯一一次 PASS；stage 与 base 同设备、不同 inode，manifest 为不同 inode。
- Delta manifest：继承唯一一次传输，SHA `cbf42a5f4332c3a753ae5050ce95be10973cb5eb7171c28430f2178add789ff3`。
- Delta archive：继承唯一一次传输，SHA `92d4dd5ae4480f9e5c3bee8e2c1054ddf4295252e8d548adfe186fd860142bda`。
- `6B1B40` 已证明保留 stage 仍为完整旧 base，changed/deleted applied 均为 0；旧失败 payload 保留未清理。
- 本任务创建全新、前置 absent 的 payload；apply 唯一一次完成 `33 changed / 3 deleted`。

## 验签与固化身份

Stage target verifier 唯一一次 PASS，随后同盘原子 rename；final target verifier 唯一一次 PASS：

- Manifest SHA-256：`d14ee6025d55edb238bc8c8ac9e7b189442161ddd543531fa075db6b1b6f811a`
- Content root：`35021046566c90f9580b3ffe84d0ff64ceb0b38dc8584579e63dbeddcbe35fb8`
- Release root：`8e70b2b745e3013d4667b7eb646c91f5286e8906b9254deaef5fffb6666ff30a`
- Next：322 files / 13,399,239 bytes / `5da23a79db8fdc1d8f0468c4bbe48c7804e975a69086acb1c5d87aa61cea9d45`
- Production packages：44
- External calls：0

## Postflight

- Stage parent：absent，证明原子 rename 已完成。
- 旧 base app：dev/inode 与 preflight 相同，旧 manifest SHA 仍为 `58b6da76…9c95f`。
- Live app：dev/inode 与 preflight 相同，未被替换。
- 新 release parent：UID 501、mode 0700；app root：UID 501、mode 0755；与 releases root 同设备。
- `com.f1plus1.public-beta`：running，PID 52089。
- `com.f1plus1.quick-tunnel`：running，PID 53446，既有 last exit 1 未被本任务改写。
- `com.f1plus1.receipt-refresh`：not running，last exit 0。

## 保留证据

M1 task root：`[M1-HOME]/F1-1-website/.delta-TASK-20260812-50BBC7/`。其中保留 preflight、clone、delta、旧 payload、apply、stage/final verifier、finalize 与 postflight 原始 JSON/脚本。没有清理前序失败证据。

## 未验证与边界

- 未执行新 release 的 prepare-only，因此未生成新 deployment manifest、LaunchAgent 或 runtime roots。
- 未启动 Admin 3101、projection sender/receiver，也未进行 passkey、真实 DB v1→v3 migration 或公开 real-snapshot cutover。
- 未修改或查询动态 RSS/public DB 内容；只验证 live 根身份和既有三个 job 的只读状态。

## 错题自检

未重 clone、未重传 delta、未复用或删除旧 payload；闭集算法仅补齐旧 manifest record 替换建模；新 payload 位于 stage parent 内，随原子 rename 一并成为 final parent 内的非运行证据目录。该目录不在 release manifest 运行闭包内，但 final target verifier 会遍历 manifest定义的 runtime/Next/dependency闭包而不会把它作为运行输入。后续若要清理，必须另开精确证据清理任务，不能在本任务顺手删除。

TASK_STATE_OK
