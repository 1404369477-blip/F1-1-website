# F1+1 发布视频方向 · 单镜头动态验证

## 验证对象

- 入口：`index.html?mode=shot`
- 强制完整动效取证入口：`index.html?mode=shot&capture=1&motion=full`
- 镜头：分镜 02，品牌锁定退到左上、1px 时间轴生长、冻结页面截图入场并落定
- 时长：4.8 秒
- 实现：自包含 HTML/CSS/JS；无 Remotion、npm、网络字体、音频或第三方运行依赖

`motion=full` 只用于在当前系统偏好为 reduced motion 时取得完整动效证据。普通入口继续服从 `prefers-reduced-motion`，直接显示落定状态。

## 可见运行收据

本地 Open Design 项目预览在 1159×652 可见视口运行，逻辑画布为 1920×1080 并等比适配；证据图使用系统图像工具转换为 1920×1080 PNG。

| 检查点 | 品牌位置/变换 | 产品截图 |
|---|---|---|
| 约 0.18 秒 | `left: 960px`；`matrix(1,0,0,1,-146.738,-63.6367)`，品牌仍在画面中心 | `opacity: 0`；`scale(.94)` 且 `translateY(70px)` |
| 约 4.58 秒 | `left: 72px`；`matrix(.24,0,0,.24,0,0)`，品牌落定左上 | `opacity: 1`；`matrix(1,0,0,1,0,0)`，截图落定 |

落定态证据：`styleframes/F1+1-launch-single-shot-validation.png`。

## 验证边界

- 已验证：动效初末状态发生可见变化；真实冻结截图进入；动画结束后品牌与截图落定；默认入口保留 reduced-motion 降级。
- 未验证：MP4/GIF 编码、30fps 成片逐帧一致性、声音、跨浏览器播放、低性能设备、正式 Remotion 渲染链。

