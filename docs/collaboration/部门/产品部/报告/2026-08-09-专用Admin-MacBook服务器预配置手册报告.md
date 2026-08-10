---
title: 专用 Admin MacBook 服务器预配置手册报告
type: product_planning_report
status: final
decision: pass
date: 2026-08-09
department: 产品部
related_task: TASK-20260809-8A0B98
implementation_authorized: false
external_calls: 0
---

# 专用 Admin MacBook 服务器预配置手册报告

## 1. 结论

已形成 [F1+1 专用 Admin MacBook 服务器预配置手册 v0.1](../../../../runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.1.md)。手册达到 planning-only 出口：用户可直接填写准备参数，技术人员可据此编制后继不可变 production manifest 与实施任务；当前没有触碰真实设备或部署。

手册吸收 `DEC-20260809T181921-EC703A` 后，将现行边界固定为：

- 专用 Admin MacBook 只承载后台、采集处理、审核、唯一写主与备份调度；
- 公开网站继续由独立 public-host 提供公网只读访问；
- Admin 公网入口始终为 0，`writer_count=1`；
- Mac/iPhone Admin 功能等价；
- `RPO≤15m`、`RTO≤4h`；
- 真实安装、账号、网络、备份上传、密钥、供应商和部署仍未授权。

## 2. 交付结构

手册将每项工作分成四个机械状态：

| 状态 | 出口 |
| --- | --- |
| `PREP` | 现在可准备的纸面参数、清单、责任人和验收模板 |
| `DECIDE` | 仍需用户提供的精确设备、地点、人员、网络、overlay、备份、密钥与成本参数 |
| `AUTH` | 必须由不可变 manifest/hash、精确设备身份、实施窗口和回退方案另获授权的真实动作 |
| `VERIFY` | 实施后由安全/测试/开发/运营取得的回读、故障、恢复与双端证据 |

内容覆盖：

- 硬件、地点、物理访问、供电、UPS、散热、合盖与睡眠；
- macOS 版本/更新、具名运营账号、无 sudo 非交互服务账号、自动登录、屏幕锁与 FileVault；
- 个人 iCloud/同步/浏览器 profile/开发环境禁区；
- Sharing、Firewall、以太网、固定局域网地址、端口转发/UPnP=0、无公网 Admin；
- 私有 overlay 选择前后的边界与五分钟签名 freshness；
- Node24、launchd、目录/权限、SQLite 文件族与唯一写主；
- 每≤5m Online Backup、manifest/hash、异机加密备份、监控告警；
- 替代恢复 Mac、旧主 fencing、隔离恢复、`RPO≤15m` 与 `RTO≤4h` 全链验收。

## 3. 错误配置与恢复覆盖

手册列出八类可判定错误配置及关闭/恢复路径，超过任务要求的至少三类：

1. 公网可达 Admin listener、端口转发、UPnP 或公网隧道；
2. `writer_count>1`、旧主仍可写或主身份 unknown；
3. 个人 iCloud/同步、个人 profile、个人开发环境或未知进程；
4. 自动登录开启、FileVault 关闭/unknown、恢复材料同机同失；
5. 睡眠、合盖停机、过热、断电或无维护门的更新重启；
6. 恢复点超龄、可信时钟 unknown、上传/远端回读失败；
7. 活跃 DB/WAL/SHM 文件复制被误当成一致备份；
8. overlay 仍连通但策略/设备/session freshness 过期或 unknown。

每项均固定发现证据、立即关闭动作、恢复条件与证明材料；任何 unknown 默认 fail closed。

## 4. 官方证据

访问日期统一记录为 2026-08-09。手册使用 Apple、Node.js、SQLite、Tailscale、restic 官方页面，以及已核收研究报告，覆盖 FileVault/恢复 key、自动登录、睡眠、Sharing、Firewall、系统更新、`node:sqlite backup()`、SQLite Online Backup、私有连接候选、restic 与 Time Machine。

本轮只读取公开官方页面，没有登录、注册、付费、下载、安装、网络探针、上传或外部写入。官方页面只证明产品能力；目标 Mac、目标网络和目标账号行为继续要求实施后验证。

## 5. 变更范围

只新增：

- `docs/runbooks/F1+1-专用Admin-MacBook服务器预配置手册-v0.1.md`；
- 本产品报告。

未修改 accepted ADR、`app/`、`data/`、`design/`、现有 Spec、数据库、依赖或真实资源；未删除文件。

## 6. 已验证

- 手册显式绑定两份现行 accepted 实施合同和用户决定收据；
- 双主机、专用机、独立 public-host、无公网 Admin、writer=1、Mac/iPhone 等价、RPO/RTO 与一致备份逐项可追溯；
- 每一实施阶段均包含 `PREP/DECIDE/AUTH/VERIFY`、Owner、失败关闭与恢复；
- 用户待提供参数已形成 11 项精确清单；
- 八类错误配置均有关闭和恢复出口；
- 官方链接为直接一手来源并标注统一访问日期；
- Markdown 链接、目标关键词、禁区扫描、`git diff --check` 与任务 doctor 已纳入完成校验。

## 7. 未验证

- 精确 MacBook、macOS、地点、运营账号、FileVault、恢复材料、UPS、电源、睡眠与散热；
- overlay 供应商/计划、身份、设备准入、中国大陆目标网络可用性、五分钟 freshness producer；
- Node/launchd/目录/权限、SQLite 主库、备份调度与实际 writer/fence；
- 异机备份目标、restic/backend、保留、防删、解密材料与组合恢复；
- public-host、DNS/TLS、投影推送、监控告警、Mac/iPhone 双端和 RPO/RTO 实机演练；
- 所有真实安装、账号、网络、密钥、上传与部署动作。

## 8. 错题自检

- 没有把专用 MacBook 与 public-host 合并；
- 没有把供应商候选写成已选；
- 没有把 FileVault、Firewall、overlay、restic、Time Machine 或官方文档能力写成实机 PASS；
- 没有给版本不明或不可逆的猜测性命令；
- 没有把活跃 DB/WAL/SHM 复制写成合格备份；
- 没有把私有网络连通性当作应用认证或 freshness；
- 没有执行安装、账号、网络、密钥、付费、探针、上传或部署。

TASK_STATE_OK
