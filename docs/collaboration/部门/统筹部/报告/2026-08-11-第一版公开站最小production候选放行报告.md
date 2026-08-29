---
title: F1+1 第一版公开站最小 production 候选放行报告
date: 2026-08-11
department: 统筹部
task_id: TASK-20260811-BB3641
status: final
decision: pass_with_external_deployment_gate
---

# 结果

F1+1 第一版公开站已经形成可部署的本地 production 候选。当前候选使用 Node 24.18.0、Next.js 16.2.11 与 `public-multimedia-synthetic` SQLite：公开信息流有 24 条本地合成内容、每页 12 条、四类筛选、详情页、相关内容和 404。正式外部主机、域名、DNS、TLS 尚未选择，因此本报告不把“本地 production 可运行”写成“已经公网发布”。

用户明确要求优先快速上线。本轮只保留四个上线必要门，且没有运行全量测试、重复聚焦测试、六格浏览器矩阵、AT 矩阵或 OS 级 no-egress：

1. lint：一次，`exit 0`，0 错误；保留 3 条 `<img>` 性能 warning。
2. typecheck：一次，`exit 0`。
3. production build：一次，`exit 0`；页面和 API 路由均生成。
4. production loopback HTTP：真实启动后验证首页、health、feed 第 1/2 页、分类筛选、详情 API、详情页面、合法格式 404 与 no-store。

# 当前可以使用的公开功能

| 功能 | 真实入口 | 结果 |
| --- | --- | --- |
| 首页 | `/` | 200，HTML 与 F1+1 品牌壳层可达 |
| 健康状态 | `/api/health` | 200，`ready`，`externalCalls=0` |
| 信息流第 1 页 | `/api/public/feed` | 12 条，`hasMore=true`，`no-store` |
| 信息流第 2 页 | `/api/public/feed?cursorAt=...&cursorId=...` | 12 条，`hasMore=false`，`no-store` |
| 四类筛选 | `/api/public/feed?contentType=race_news` 等 | 真实筛选；赛事新闻样本为 6 条 |
| 内容详情 API | `/api/public/stories/public-page2-race-news-24` | 200，中文标题、正文、关键点和 3 条相关内容 |
| 内容详情页 | `/stories/public-page2-race-news-24` | 200；服务端先输出 loading 壳层，客户端同源拉取详情 |
| 不存在内容 | `/api/public/stories/public-missing-local` | 404，`PUBLIC_STORY_NOT_FOUND`，`no-store` |

# 一次烟测脚本误判

首个 HTTP runner 对产品合同做了三项错误假设：读取 `item` 或顶层 `publicId`，实际 DTO 为 `story.publicId`；要求 client component 的服务端 HTML 已包含最终异步标题，实际 SSR 应输出 loading 壳层；使用格式非法的 `does-not-exist` 期待 404，产品按合同正确返回 400 `PUBLIC_ID_INVALID`。

该 runner 出现首错后已停止，没有原样重跑。精确 successor 只检查上述三项纠正后的合同并一次通过。这个错误属于验收脚本，不构成产品缺陷。

# 构建与数据身份

- Git 分支：`main`
- 当前 HEAD：`ee450639613ffc43e7b860b3237bdde296f0416d`
- GitHub remote：`https://github.com/1404369477-blip/F1-1-website.git`
- 工作区：尚有本节点未提交变更；当前 build 不能仅凭 HEAD 复建，须先完成精确 Git 节点提交。
- `.next/BUILD_ID` SHA-256：`21c1a89cd88ac431c76aae702bb1b27a0860ff58da88bbbd9f6344bfbfacc5b8`
- `.next/required-server-files.json` SHA-256：`77b4987e2cf7fc48e9757979ead879c0729e0369a5b962e6d79c5b9a963c65a1`
- 公开多媒体 SQLite SHA-256：`eb2d7ad2787a290f7a13adcb063215d58654bc9f66d1d8ff60b98f14592b9551`
- package-lock SHA-256：`89807e33818cfb851b57da65a5675e413e5593d01d6773c3a71a6cc6ea3d85d3`

完整逐文件身份见 [release manifest](../../../../../app/evidence/TASK-20260811-BB3641/manifest.json)。

# 运行清理

两次 production smoke 都已精确停止。最终 `127.0.0.1:3000` 与 `127.0.0.1:3001` 无 listener，任务临时目录为 0。服务关闭后出现 0 字节 WAL 和 32768 字节 SHM；在确认无进程占用、WAL 为 0 字节、正式 DB SHA 未漂移后，已用精确路径 unlink 两个运行 sidecar。最终无 WAL、SHM 或 journal，DB SHA 仍为冻结值。

# 已知限制

- 当前内容全部是本地 synthetic 数据；真实 X、Instagram、Reddit、新闻网站、飞书 Base、AI 摘要和自动发布仍未接入。
- Admin 页面尚未形成公开可用入口。production build 中存在 Admin API 路由；公网反向代理必须显式拒绝 `/api/admin/*` 和 `/admin/*`，只开放公开路由及 Next 静态资源。
- 设计部 390px integrity successor 在内部执行者额度错误前出现未完成字节变动，SHA 清单和截图未随之更新；本 release 不引用该隔离 successor，继续使用已冻结的 5a84 设计基线及当前 App。
- lint 有 3 条 `<img>` 性能 warning；build 有一条 Turbopack NFT 动态文件追踪 warning。两者当前均未阻断生产构建，部署包边界仍需在目标主机核对。
- 没有做全量回归、六格视觉、真实设备辅助技术或 OS 级网络系统调用验证，符合本轮快速上线范围；这些风险需要上线后的日志和真实使用反馈驱动修复。

# 下一门

真正公网发布仍需要确定唯一外部承载位置。推荐优先使用与 Admin MacBook 分离的持久 Node 主机；如果选择固定 M1 MacBook 做临时 beta，需要接受 Wi-Fi、家庭网络、断电/睡眠和公网隧道的额外可用性风险。

目标主机确定后，部署动作只需：提交并推送当前精确节点、在目标机安装/复用 Node 24、放置本地 SQLite 与 receipts、production build、用守护进程运行、反向代理仅放行公开路径、配置 TLS、执行一次公网首页/详情/health smoke，并开启最小日志与回退。

# 错题自检

- 没有把本地 loopback 可运行写成公网已上线。
- 没有把 synthetic 数据写成真实采集结果。
- HTTP harness 的三项误判已单列，未通过修改产品合同迎合脚本。
- 没有因为用户要求快速上线而取消构建、启动、主链或外部路由隔离四个必要门。
- 任务初始两个 pointer 漏写 `app/` 前缀；本报告使用真实路径纠正，未静默改写任务历史。

本任务判定：`TASK_STATE_OK`。
