# GitHub Pages 本次错误核查

2026-09-23 23:12（北京时间）核查完成。最近30次运行27次成功、3次失败，三个提交均已成功推送到gh-pages。

- run35877944551（截图b85f2e7）及35875673633在 Require current branch head 退出1；等待期间已有新提交，因此拒绝部署旧版本。
- run35869439222在创建Pages部署时返回HTTP500，GitHub服务端失败；不归因于Node20警告或用户推送权限。第一次log-failed请求30s超时，后经单job日志取得原错误。
- 后续run35878067878/105e8a3于23:02:10部署成功。23:06公网_deployment.json与该成功commit同文件逐字一致，current指向同bundle。

未重跑旧版本、未改权限/Actions版本/工作流或M1发布器。旧版本显示优化只评估为后续小切片，方案见 ../x-maintenance-integration-20260922/pages-superseded-audit/REPORT.md。

原始列表、两次旧head失败日志、第三次单job错误、成功记录及HTTPS响应存本目录。仅核该时间窗口，不声称未来部署零故障。
