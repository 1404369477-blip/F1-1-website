---
type: work_report
department: 设计部
task_id: TASK-20260812-253682
title: Admin UI投递对账与内存草稿successor报告
status: completed
observation_date: 2026-08-12
scope: 仅修app/src/admin-ui/app.js中的真实delivery对账、内存草稿恢复和mutation busy guard；不改视觉、HTML、CSS、截图、后端或部署
---

# Admin UI 投递对账与内存草稿 successor 报告

## 1. 结果

测试部 `TASK-20260812-338928` 提出的两项 P1 与一项同 JS 重入 P2 已在 `app/src/admin-ui/app.js` 完成最小修正。

- predecessor SHA-256：`1123845193308472ff75b93701569306055f67cbf4a6f791f13cd9f5560c09ec`
- successor SHA-256：`58a0d014741a26b950c6afd1caa64fb9c73fb856eb7426bcd653d6b68d4b184d`
- successor 字节数：`67,369`

`index.html` 与 `app.css` 字节未变；既有四张 PNG 与 2×2 总览图逐项保持原 SHA，没有重新运行浏览器截图。

## 2. P1-01：真实 delivery receipt 对账

新增真实端点：

```text
GET /api/admin/deliveries/{deliveryId}
```

实现边界：

- 查询必须从当前 `detail.delivery.id` 取得精确 `op-snapshot-<64 hex>` 标识；不接受手填或新的 publish 身份。
- 响应必须为 `admin-public-projection-receipt-v1`，并严格校验 `deliveryId`、`snapshotManifestHash`、`snapshotGeneration`、`status`、active generation/hash、`reasonCode=null`、`receivedAt` 与 `activatedAt`。
- `status` 只允许 `active|superseded`。active 收据必须与 active generation/hash 自洽；superseded 收据必须指向另一份非空 active hash，且 active generation 不早于当前 generation。
- 收据通过校验后才回读同一个 candidate detail；receiver receipt 与私有 detail 分开保存在 UI 状态并分开展示，没有把 receipt 推断成数据库已回写。
- `404/409/503/401/网络失败` 均保留同一 delivery 查询出口；该处理函数不存在 `executeMutation`、`publishMutation` 或 `adapter.mutate` 路径。

## 3. P1-02：仅内存草稿恢复与明确丢弃

用户编辑标题、摘要或私有备注时，页面内存 `Map` 保存：

- `candidateId`
- `sourceRevision`
- `sourceVersionTag`
- `latestBundleVersionTag`
- `editable.titleZh`
- `editable.summaryZh`
- `editable.notes`

草稿不进入 `localStorage`、`sessionStorage`、URL、console 或日志；现有 `localStorage` 仍只保存 `f1-admin-theme`。

当 mutation 遇 401，重新完成 passkey 登录后会先加载真实详情，再显示：

- “重新套用草稿”；
- “明确丢弃草稿”。

409 加载最新状态后使用同一恢复出口。若来源版本或 Bundle 已变化，页面明确提示人工合并；重新套用只把文本复制回表单并标记为未保存，用户仍须手动执行新的 revision。登录和恢复函数均没有 mutation 调用，不会自动重放旧 operation。

成功保存 revision 后删除对应内存草稿；导航时原有“丢弃未保存输入”确认也会删除当前候选草稿。

## 4. P2：mutation 重入闸

- `saveRevision`、`confirmAction` 与最终 `executeMutation` 三个入口均在首行检查 `state.busy`。
- 确认提交时同步禁用 dialog confirm/cancel；工作区按钮与编辑控件也随 busy 禁用。
- 所有 mutation 出口通过 `finally` 恢复 busy 与控件状态。
- 一次动作只创建一个 operationId；busy 期间的重复 submit/辅助技术事件直接返回。

## 5. 唯一检查与 diff-check

只执行了一次纯静态契约检查和一次 diff-check，同一命令内完成，结果均为 PASS：

- 静态契约：12 项 PASS；
- diff-check：12 项 PASS；
- 收据：`docs/collaboration/部门/设计部/报告/证据/TASK-20260812-253682/static-contract-and-diff-check.json`。

检查覆盖 delivery endpoint/schema/identity/status/receipt→detail 顺序、同 delivery 失败路径、内存草稿字段、浏览器存储边界、恢复/丢弃、无自动 replay、三层 busy guard、finally 恢复，以及 HTML/CSS/五张视觉证据 SHA 不变、静态根没有新增文件、无冲突标记/尾随空白/CRLF、JS 小于 2 MiB。

## 6. 未验证与错题自检

未验证：

- 未启动浏览器、3101 服务、M1、Tailscale、passkey 或真实 RSS；
- 未对真实 `active|superseded|404|409|503|401` 响应做运行冒烟；
- 未验证 iPhone 真机与辅助技术；
- 既有视觉截图仍是 predecessor 的历史视觉证据，只能证明布局方向没有要求变化。

错题自检：

- 只修改 `app/src/admin-ui/app.js`；没有修改 `index.html`、`app.css`、public Next、后端、Spec、ADR、部署、旧 manifest 或 PNG。
- 没有使用 localStorage/sessionStorage 持久化私有草稿。
- 没有把 receiver receipt 合并成 private detail，也没有用 detail 继续冒充 delivery 对账。
- 没有在 401/409 后自动恢复表单并提交，也没有重放旧 mutation。
- 没有重新运行四图、浏览器、M1 或网络任务。

任务交付状态：`TASK_STATE_OK`
