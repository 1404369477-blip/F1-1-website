# spec —— 规格文档

> 每个要做的功能,**动手写代码前**先在这写一份 spec:说清楚要什么、不要什么、怎么算做对了。
> 一个功能一个文件,复制 [`_template.md`](_template.md) 开始。

## 已有规格

| 规格 | 状态 | 说明 |
|------|------|------|
| [F1+1 v0.2 最终实现级产品合同](F1+1-v0.2-最终实现级产品合同.md) | final | 绑定 2026-08-08 冻结 HTML 与 SHA-256，规定公开信息流最终 UI/交互、验收与回退边界 |
| [F1+1 初版全功能追踪矩阵 v0.1](F1+1-初版全功能追踪矩阵-v0.1.md) | active initial traceability | 按 Function ID 记录全部初版用户出口、依赖、视觉锚点、恢复、Owner、证据和唯一三态 |
| [public-multimedia-synthetic 本地运行实施合同 v0.1](F1+1-public-multimedia-synthetic本地运行实施合同-v0.1.md) | accepted contract / pending implementation | 固定第三公开 profile、scoped migration、V1/V2 协商、V2 App 接线、失败与完整回退 |
| [VS-1 本地 synthetic 纵切实施合同 v0.2 successor](F1+1-VS1本地synthetic纵切实施合同-v0.2.md) | accepted contract / pending implementation | 当前入口；继承 v0.1 并纠正英文 HAPPY/Event 日期 golden，固定 012 为唯一 Summary 缺失条件分支 |
| [VS-1 本地 synthetic 纵切实施合同 v0.1](F1+1-VS1本地synthetic纵切实施合同-v0.1.md) | historical predecessor | 初始 mock 采集、处理、摘要、事务与收据合同；两个机械冲突由 v0.2 successor 覆盖，历史字节不改 |
| [M5 Admin 双主机实施合同 v0.2](F1+1-M5-Admin双主机实施合同-v0.2.md) | accepted contract / pending implementation | 固定独立 Admin 主机、唯一写主、公开只读投影、Mac/iPhone 等价、Admin→public 单向 push、RTO/RPO 和唯一生产部署门禁 |
| [M5 Admin 专用 MacBook 补充实施合同 v0.2](F1+1-M5-Admin专用MacBook补充实施合同-v0.2.md) | accepted contract / pending implementation | 当前入口；用户已选 dedicated，固定专用设备/OS账号、FileVault、自动登录、最小软件/进程基线与后继门禁，真实配置和部署仍未授权 |
| [M5 Admin MacBook 主机补充实施合同 v0.1](F1+1-M5-Admin-MacBook主机补充实施合同-v0.1.md) | historical predecessor | 初始主机落点、私有双端链与专用/共用分支合同；dedicated 已由 v0.2 successor 关闭，历史字节不改 |

## 为什么先写 spec

- 逼自己想清楚边界,避免边写边改方向。
- 是和未来的自己 / 协作者对齐的依据。
- 写不出 spec,往往说明需求还没想明白。
