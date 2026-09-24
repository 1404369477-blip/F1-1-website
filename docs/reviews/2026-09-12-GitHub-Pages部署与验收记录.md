# GitHub Pages 部署与验收记录

2026-09-12 22:41，Asia/Shanghai。正式任务 `TASK-20260912-C9F7C8`；用户已授权完整只读新闻站及 M1 更新后自动同步。**实际GitHub Pages已上线，M1定时同步及`/f1`固定新入口接续均通过主控与独立验收。** 两个自然无变化周期已核实；生产406→下一自然代尚未发生，隔离变化/恢复反例已通过，精确边界见下文。

合同与范围由 [实施合同](2026-09-12-GitHub-Pages公开新闻站实施合同.md) 统一维护。本记录只承载固定候选、执行收据和验收状态，不覆盖已有 Function 的历史状态。

## 入口及权限

目标公开入口：[F1+1](https://1404369477-blip.github.io/f1plus1/)。独立静态仓库 `1404369477-blip/f1plus1`，id `1367286521`；GitHub Pages 配置为 workflow 发布且 HTTPS 强制开启。首个实际部署commit为`c6cb6c0adb90629c5695b6a103c33c9a4a05a55f`；Actions run `34697727765` attempt2成功，首次失败记录保留。

M1 专用 Ed25519 deploy key 只登记于该静态仓库（id `163077481`），私钥留在 M1 专用0700目录、0600文件；SSH固定443和官方已核实独立known_hosts。严格SSH读取空仓库已通过，权限链独审通过。原业务仓库与广权限凭据不进入同步服务。

证据根：`scratch/github-pages-20260912/`。仓库/Pages配置、key登记及实际SSH收据分别为 `github-repository-created.json`、`github-pages-configured.json`、`github-add-deploy-key.stdout`、`m1-key-final-identity-git-auth.json`。

## 已冻结前端与公开数据

| 内容 | 固定身份与结果 |
| --- | --- |
| 已确认设计 | `design/ui/F1+1-v0.2-全站设计/F1+1-v0.2-final-20260808.html`；SHA-256 `5a84bfb27294ebd727369118a95528f5b788bfacbe2d56cc03fcb006f6168cb1` |
| 前端R2源码候选 | `frontend-candidate-manifest-r2.json`；SHA-256 `65637d11a8cdb642d3d278f390acce80dcdd598bfd08c29e30f31e227eedb868`，32件 |
| UI构建清单 | `frontend-build-r2/site.build-receipt.json`；SHA-256 `70f0aa60480a58d987d94b2d6c01c88986e1598e8d9061d9b97366bc2dca254e`，43件公开壳文件 |
| 当前投影基线 | M1公开V1 generation406，manifest `7b2a41edd8bb94dffdb8d7bf7c50fedf7247979583ef3447d5eac204752da0cc`；562条公开记录。V2 active缺失，保留精确503后回退V1 |
| 已验证样本bundle | `8467b994d3d1657f956a307bd20c289ad126171710afdbb5f48e5f0e07140c03`；2075个规范请求引用，1298个去重正文 |
| 导出等价性 | 原验签reader/http为oracle，完整562详情、192分页及V2问题响应共1321请求逐项比较成功；不读审核DB |
| 前端验证 | 4个测试文件46项；类型检查、构建与43文件HTTP字节hash通过；Admin/API不存在路径返回404 |
| 独立审查 | `independent-frontend-browser-review-r2.md`，SHA-256 `f57d6f90390b15adcf0873909fe12d61d9522b6b4e0055788be40e4bb5656854`；全部2075规范key经R2传输读取通过 |

初始R1对错版200接受过宽的缺陷保留在历史证据中；R2限制静态传输按v1/v2规范键严格匹配成功DTO，不修改动态API兼容边界。

## 视觉、交互与既有缺口

R2运行中首页、详情均覆盖1440/1024/390 × 深/浅主题，共12张截图，尺寸与SHA已独立复算。证据为 `browser-r2/visual-matrix.json`、`image-dimensions-and-hashes.json` 及对应JPEG；映射既有公开壳、条目、工具、媒体和状态视觉锚点。

`browser-r2/interaction-checks.json` 验证缺指针、坏index/body、503均显示失败并可重试恢复12条；撤回更新清理旧游标及展开缓存；经签名空集合清空列表，下一合法代可恢复。首页搜索、分页、展开、详情、原文与lightbox的原始操作证据保留在R1记录，R2相关UI组件/CSS未变，R2正常六格与关键故障重新实跑。

原站没有可达分类控件或独立来源下拉；只保留已加载内容搜索和原有API分类/source兼容。设置来源偏好/通知占位的历史缺口不升级。外部来源图阻断时显示浏览器破图，没有自定义onError占位；`browser-r2/media-failure-boundary.json`记录该继承缺口及清除故障后12条/图片恢复。上述缺口不被写为本轮新增完成能力。

## 历史：21:50前的生产执行计划

- 同步器固定候选及安装helper仍在独审：必须区分已push和实际Pages已部署，公开marker同时绑定bundle/UI/workflow；无变化周期也须核对remote及live。
- 首次生产导出、push、Actions及HTTPS实读尚未执行；M1同步定时器尚未加载。
- `/f1`静态Pages采样后继正在隔离实现：验证首屏公开DTO，分别报告M1业务与同步新鲜度未知，不能伪造动态health。
- 尚需记录M1安装前后精确身份、首次实际Pages部署、自然定时周期、失败恢复及固定巡检入口实跑，然后更新统一生产入口及正式任务。

上述为当时计划；以下实际收据与本文顶部最新状态覆盖其执行状态。

## 21:50–21:51 M1安装与首次同步

最终publisher R2审查清单 `exporter-sync/review-manifest-r2.json` SHA `c3097f7b9047fa96b5bc3aa76a1564da4680af53f5a225eca037a5f44dbc4d0e`，33件已由主控和独审分别复算。唯一dispatcher SHA `84d5caeddfe60128235ac1e42e13ca33121ba523434571fc0285e6c254a7a274`；bindings SHA `f9d17887f4c84e99bcfcc0feb31b6caede88b90ea90e66cb4877db509f1cb549`；helper SHA `0b4d3ec5edbb376b1c47dd4ac2ba7334b8d7fc10a0f6129d42776c7d541cd731`。独审以Node24实际重跑publisher18项、installer15项通过；操作系统锁4项通过。

实际preflight于21:48:28通过：27输入、SSH、六plist和四常驻服务一致，无生产写入。原文 `exporter-sync/run-records/9a71f3ab-3edf-4c6b-9671-27522480f1cf/stdout`，SHA `5f369a5b7a5b7e607820561c336736c7f0cac466c85efe8cb0be3b3be179a5e7`。

在原有效窗口内安装成功，原文 `run-records/0f45a1ac-2f45-4394-b715-36a04db35264/stdout`，SHA `d5c191bade81aee1400bf57734cb939af764b694223f843e6501f3a04dce9d64`；随后inspect原文 `run-records/563f3dfa-3706-4fc0-8ea0-6d9348a47b39/stdout`，SHA `bdcba0032bb24d6d2481526c7592b6123f47b0a6a28718329080f768be04865f`。两路径均相对本证据根的`exporter-sync/`。目标为M1 `.pages-publisher/runtime-20260912-r2`，52件精确文件、27输入绑定、目录0700/文件0600；publisher job不存在、worker未运行，业务服务动作0。

独审逐阶段放行首次sync，主控于21:51启动唯一固定入口；此时不表示已push或实际部署完成。

## 首次push与GitHub环境许可修正

首次sync实际返回`PUSHED_PENDING_DEPLOYMENT`，原文 `exporter-sync/run-records/6762d713-f828-4536-b0d2-c944db686baf/stdout`，SHA `8a7eaa447e13dea2f935fcf4b1824ed96f9ba19bec5a0f2cb3c6188cc6fef783`。生产bundle为`fc431f3a62d7d31d59c2b57a1e7f916437bbfc2bed3f7b346863b06c45de658d`，同一generation406的首次实际M1导出；与较早本地验证样本的bundle不同，生成时间和请求trace身份在新导出中重新形成，UI候选不变。远端commit `c6cb6c0adb90629c5695b6a103c33c9a4a05a55f`，已push与已deploy分别记录，lastDeployed仍null。

Actions run `34697727765` 第一尝试在分配runner前被环境分支策略拒绝：新建`github-pages`环境仅允许`main`（policy59790588），本次专用分支为`gh-pages`。主控按[GitHub官方分支策略API](https://docs.github.com/en/rest/deployments/branch-policies)精确新增`gh-pages/type=branch`（policy59794817），保留main及其余环境规则。此前已冻结运行包及workflow均不修改。原始before/mutation/after/annotations存`github-environment-repair/`；该修正已独审认可范围。

重跑前M1 active再次核实仍generation406、manifest7b2a41ed…da0cc且V2 pointer缺失；21:58:57针对同一个commit重跑原Actions run。首轮失败保留，不将重跑授权或命令成功当作部署成功。


## 22:02–22:20 实际上线、浏览器与定时启用

第二次固定sync返回`DEPLOYED`，原文 `exporter-sync/run-records/c852f518-8a3e-4fe8-a273-37e2311bb159/stdout` SHA `bd8d46749be06ba56d99c93b1257c2b4ee662c89b39fa5588f8c6805b63225c2`。当前bundle/UI/workflow三项与实际Pages一致，无再次push。

主控22:07真实HTTPS验收记录`root-live-pages-r1.json`：42/42产品静态文件均200且字节hash一致；首页/详情直达200，公开Admin、动态health及不存在路径404；current/index/首屏12条/详情数据均匹配。43件壳文件中的`.nojekyll`由固定官方upload-pages-artifact打包规则排除，是构建控制文件，不是产品缺资源。相关官方action字节及修正前后的探测证据保留。

真实公网Safari首页12条、点击详情、中文摘要与3条要点、图片、3相关条目以及详情刷新后恢复均通过；已返回首页供使用。`live-safari-r1/`保留页面AX与截图，截图含浏览器其他页签，仅本机私有证据，不进入公开静态仓库。独审已核对页面与截图并放行定时启用；本地同一UI六格及失败矩阵仍为前述固定R2证据。

22:20:28固定dispatcher `enable`返回`TIMER_ENABLED`，原文`exporter-sync/run-records/700dd40e-b8ac-4b6a-bfee-0ba52026f306/stdout` SHA `862cc76e660e307f7543f9bd77265b548a2bc9905d2954ee7167d37808bae3fc`。随后inspect `run-records/0ca7a2f9-e766-4ef2-950a-cfd431faf62d/stdout` SHA `0bae122fe28faa8c2a888bee0cf49255d0b3176090898e1134b2dd5c98af7eee`：job已加载、参数身份正确，六业务plist与四常驻进程保持。自然周期结果另行追加，不以enable代替同步验收。


## 22:23–22:26 自然周期最终核收

`exporter-sync/timer-natural-observation.json` SHA `aa1971504258e5582d14928be25b7e4d6f23b213a29b1a03e3c13aaaf9bca40d`，同名Markdown SHA `58b7c4eabb38bdca80196ee918b9ad5b1dbb526278708e81689e9106f19f931d`；主控逐件重算两组40件原始证据，`root-timer-evidence-recomputation.json`为PASS，独审另行全量复核通过。

真实自然`checkedAt`从22:23:20.487推进至22:24:12.822，launchd runs从3至4，两轮last exit均0。M1指针、远端HEAD、Pages marker/index/首屏均为相同generation406及固定bundle；六业务plist、四常驻进程与两个周期业务job参数不变。没有手动sync/kickstart，没有额外push，状态日志保持1049字节，全部33件冻结输入未变。StartInterval为30秒；串行工作本身及调度会占用时间，不能把该值解释为30秒内完成公开更新的保证。

本轮自然生产源一直是generation406，未实观测406切到下一代后由timer自动push的组合路径。按合同允许的真实或隔离证据：首次M1真实导出/push/部署、同入口自然调度及无变化对账、最终18项中的代次切换/网络失败恢复/撤回/合法空站反例共同满足本次部署验收。该组合判断已由独审明确认可；下一次合法active自然变化后补充生产新代证据，不人为制造generation，也不借本轮处理未知gen407。


## 同步器独审与运行管理

最终同步器独立审查记录为 `scratch/github-pages-20260912/independent-publisher-review-r2.md`，22:29追加自然周期总评后的SHA `e431c4d7772425bf6b99f37efa2d4be7d918d811f21d6aa6ac07ab76eb0b5db8`。停止或恢复同步必须沿用 `exporter-sync/INSTALL-CLI.md` 中固定dispatcher与bindings的`disable`/`enable`入口，先核查精确运行身份，不手动改plist，不删除站点或密钥。`disable`持久移出plist并保留审计副本，运行包/凭据/最后成功站点继续保存。

原业务源码工作区包含大量此前未提交改动，本次未整体暂存或混合提交。公开静态仓库已经提交并部署精确允许产物；业务工作区的本次候选由文件清单和哈希绑定。下一次发布UI变更必须形成新的固定构建清单及独审，不能改现役已绑定输入后假设同步器会接受。


## `/f1` R2实际安装与超时诊断（R3接续前）

22:12:36实际原子交换R2，新14件成为固定reporter路径；旧13件完整保存在同父`candidate-site-status-20260911-direct-r1-pages-20260912-r1`。Hermes外层配置与Gateway保持、无服务重启。`site-status-successor/actual-apply.stdout` SHA `a78eb483985fcec234c052e30178e7a04acf62a0698c76a898e01c5d9c823c37`；两次真实postverify SHA分别 `614e505d5a5840cf33f8eec7bf396c9ce761c16ecf55636a8f477629bbec8d96`、`804440229bb21199457a2ef1f2937a338719a16df8a33bfe0861f3f36d0aead5`。文件身份核验通过，实际Pages报告均HTTP_TIMEOUT；不将该安装核验写成端到端通过。

M1同Node24与相同环境的只读探针对照定位两个问题：默认250ms地址尝试可能在连接建立前连续切换，1000ms尝试可越过pointer；随后identity传输760205字节索引读速不足，IPv4强制或仅提高到16秒均仍超时。gzip将同一索引压至106042字节，完整pointer/index/v2问题/v1首屏连续6.536秒与6.012秒通过，hash/schema及12条均一致。详细分段证据保留在`site-status-successor/diagnose-*.json`；诊断使用内存参数替换，没有修改现役文件。

R3的最低充分修复是1000ms双栈地址尝试、gzip且压缩前后双重大小上限、16秒单次完整链总时限；不新增第三方依赖或持久连接，外层24/27秒报告回收边界保持。R3实际安装与最终收据在后续章节记录；截至本节，R2已安装但Pages报告未通过。


## 22:39–22:40 `/f1` R3安装与最终核收

R3 bindings SHA `59129a6ffd768d4831f9e7ee86dbce7f290424be872a5ca2b07fd9b81f0af874`，新manifest `05bf52992772c17a2684cf98ece85af4d6a199bb8fe574474f3776316688b89f`；新runtime `1cc2ef168e5bd019c019900dcbcce5780bfef3ab2a4c2a06d189141b78a5649e`。主控和独审均复核old14/new14、仅四件差异、固定helper/stage及实际prepare计划。正式55项Pages/runtime、完整tsc、三组native候选回放、8项安装反例和stage重复拒绝通过；独审另行99项site-status及tsc通过，原40项Python因源码不变继承。

实际plan SHA `249f7add996da4f40c5344b36591528cb81f742152144694e8023ae441ca00cc`，14:38:03Z生成，旧/新/父目录同dev、UID501/0700且inode独立。22:39:28原子交换成功，`site-status-successor/r3/actual-apply.stdout` SHA `8cdc7caf7d959ccdc198021d0de829dd063b4a6412b0b4f6c78f61b70befd548`；`gatewayChanges=0`。新14件位于原固定入口，前R2的14件和最初13件分别完整保留于两个独立NEXT，guard释放、Hermes配置SHA保持。

两次固定无参数正式reporter现场结果：

| 证据，相对`site-status-successor/r3/` | 原始stdout SHA256 | 用时/结果 |
| --- | --- | --- |
| `actual-postverify-r1.stdout` | `48357f9dd45ec63028098021754b43737dba48838415ffb2b1e543703a310ac4` | 3.1555秒，exit0/stderr0，Pages200/12条 |
| `actual-postverify-r2.stdout` | `006261de37c3e2d080ed3bf9dbf4ad4753ad4b6e6503d0cb5b73e6d09196b4bd` | 3.9754秒，exit0/stderr0，Pages200/12条 |

两次均验证新14/前14/原13、Hermes配置、plan和guard；主控汇总`root-actual-acceptance.json`及独审最终门禁均PASS。Pages读取成功与业务总体状态分开报告：RSS实际成功间隔/草稿/待发布超时，41个unknown及1个未决投递继续存在；备份与Admin登录的结论只对应报告采样范围。`/f1`单次探针仍明确同步新鲜度未知，不把导出时间当成最近成功对账时间。本次未重新发送或收取微信/Telegram消息；固定reporter现场验收不冒充用户手机实收，原原生入口既有实收证据保留。

当前安装/停用/回退入口统一为 `site-status-successor/COMMANDS.md`；R3安装已完成，禁止重跑历史stage/apply。回退必须先核当前新14与前R2旧14完整身份，用实际R3 plan SHA；原13保留但不得越过已安装后继盲用R2旧安装命令。

## 最终交接范围

公开固定网址为 https://1404369477-blip.github.io/f1plus1/ 。M1仅同步已激活且验证通过的合法公开投影，30秒配置间隔串行检查；GitHub发布有实际耗时，不承诺30秒内更新。M1断网时最后成功版本仍可读取，新发布/撤回在下一次成功同步与Pages部署后生效。管理后台、业务凭据、审核库、备份均未暴露到静态仓库。

本轮部署和巡检接续已核收；既有RSS积压、gen407未决投递/新恢复合同、真实Admin登录、X生产及原UI占位/外图失败表现均保持原归属。生产新代自动上线的组合路径待下一合法active自然变化后补证，不因此修改业务生成代。统一运行入口为`docs/当前生产状态与执行待办.md`，旧任务3B83D5仍waiting_input。


## 22:44 正式任务收口

`TASK-20260912-C9F7C8`已通过正式任务工具完成并ACK（completion receipt `899488c8902a463a`），8件交付物本地路径核验成功；`rebuild-index`返回TASK_INDEX_OK，`doctor`返回TASK_DOCTOR_OK（490任务、完整历史验证）。`/f1`R3最终独审文件`site-status-successor/r3/independent-review.md` SHA `a16e4087b43b0e2eb06269bc13358f3f67243e359988d3bd493e8bde8a37e720`。未验证项与旧任务边界已写入正式任务，不把本轮完成扩展成全站所有业务恢复。

本任务本地3921/3931/3932预览服务及3925 SSH对照转发均已核实PID/用途后停止，产物、截图、复现材料与可用Safari网站页签保留；清理记录分别见`site-status-successor/r3/cleanup-preview-services.json`与`root-local-cleanup.json`。
