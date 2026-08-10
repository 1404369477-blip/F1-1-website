# F1+1 发布视频 · 动效性格 tokens v0.1

## 基线

- 输入 HTML：`design/ui/F1+1-v0.2-全站设计/F1+1-v0.2-final-20260808.html`
- 输入 SHA-256：`5a84bfb27294ebd727369118a95528f5b788bfacbe2d56cc03fcb006f6168cb1`
- 画布：1920×1080，16:9，30fps
- 方向片时长：27 秒候选
- 声音：本轮无旁白、无 BGM、无 SFX；正式声音设计留待方向确认后单独授权

## 性格

“速度”由明确加速度、错峰和短促入场表达；“可信”由稳定镜头、真实页面截图和充分停留表达。整体能量偏高，装饰密度保持低位。

| Token | 值 | 用途 |
|---|---:|---|
| `motion.fps` | `30` | 帧基准 |
| `motion.micro` | `8f / 267ms` | 细节点、短标签 |
| `motion.ui` | `18f / 600ms` | UI 入场、控件状态 |
| `motion.hero` | `30f / 1000ms` | 主产品画面入场 |
| `motion.cameraArc` | `90f / 3000ms` | 仅用于时长允许的连续长镜头；短镜头按实际时长收敛，不强行截断停留 |
| `motion.hold.info` | `30–45f / 1–1.5s` | 关键信息落定后呼吸 |
| `motion.hold.brand` | `45–60f / 1.5–2s` | 首尾品牌记忆点 |
| `ease.enter` | `cubic-bezier(.16,1,.3,1)` | 主入场，快速启动、柔和落定 |
| `ease.exit` | `cubic-bezier(.7,0,.84,0)` | 退出，不拖尾 |
| `ease.linearOut` | `cubic-bezier(0,0,.2,1)` | 透明度和短位移 |
| `transform.overshoot` | `1.035` | 仅抽象品牌段；从通用 1.12 收敛，避免游戏化 |
| `transform.squash` | `0.06` | 仅 8f 内微形变，不用于产品 UI |
| `camera.shake` | `0` | 稳定 UI 宣传片禁手持抖动 |
| `blur.entry` | `6px → 0` | 单镜头产品入场，不能覆盖文字阅读阶段 |
| `stagger.short` | `3f / 100ms` | 功能标签错峰 |
| `stagger.long` | `6f / 200ms` | 三个产品小品之间 |

## 硬约束

- 禁用持续脉冲、心跳缩放、扩散涟漪、手持抖动、随机粒子、装饰性紫色渐变。
- 产品 UI 只用冻结 HTML 或冻结证据截图；不重画卡片、时间轴、媒体或控制器。
- 一帧一个论点；产品截图上不压标题文案。
- 大动作完成后至少静止 30 帧；首尾 wordmark 至少静止 45 帧。
- `prefers-reduced-motion` 下直接显示镜头落定状态。
