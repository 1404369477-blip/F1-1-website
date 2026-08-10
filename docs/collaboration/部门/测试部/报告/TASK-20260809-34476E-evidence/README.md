# TASK-20260809-34476E 共享证据清单

## 冻结候选

五个实现文件在验收前后 SHA-256 均与任务冻结值一致：

- `public-api.ts`: `87c4b0d535558ee7313d7e26074d63789b77acd86ffd668696ec5c711bbc2256`
- `f1-page-shell.tsx`: `d479c02791bec2f2c0cf9fd2bed1e99c9bae2195978d981226339d754fe626ac`
- `feed-experience.tsx`: `a6f9dd6d0a9998ebf54b935cc976345e4ea1a1eddcaff62bcce5aa03dee43c58`
- `globals.css`: `abed20076cf1d4fe6f6e007fd12491a0e363e7cafcd76bb9016b56add63af688`
- `public-ui.test.ts`: `46f82aae14d73f49c04671834b0a881342a05e58149da075ee74ea252df0b3e5`

## HTTP 基线

- Health: HTTP 200、`status=ready`、`scope=local-only`、`dataGate=accepted-public-synthetic`、`externalCalls=0`。
- Feed: HTTP 200、12 条、首项 `public-demo-qualifying-window`、`pageSize=12`、`hasMore=false`。
- Detail: 首项 HTTP 200，`publicId` 一致，`relatedItems=3`。

## 六张视觉证据

| 文件 | 验收视口/主题 | PNG SHA-256 | 说明 |
|---|---|---|---|
| `01-1440x900-dark.png` | 1440×900 / dark | `de3dd62cb0bcf47dc32daabdb219154d0e45efae032ad56c5855a161c1c9cda7` | DOM `clientWidth=1440`；Browser 导出归一为 1048×900 |
| `02-1440x900-light.png` | 1440×900 / light | `e2aa969ac6840ebceab44ae028fe6647094c73f4bcc6a34ef5c8d99ec0b6945e` | DOM `clientWidth=1440`；Browser 导出归一为 1048×900 |
| `03-1024x768-dark.png` | 1024×768 / dark | `d345cd6029c41dc8668445713e9a3d97293aa6fe82e71bebda72b8c56f8881e5` | PNG 1024×768 |
| `04-1024x768-light.png` | 1024×768 / light | `1c7413dd532e8075c54ff567e23084eca1131ec725569f1ca1fc142a5be5c195` | PNG 1024×768 |
| `05-390x844-dark.png` | 390×844 / dark | `61fbed9f7da4cfbc26ac98215d2cad6762ba22ae9b073447d810ae4338744409` | PNG 390×844 |
| `06-390x844-light.png` | 390×844 / light | `34f18a1e209a9ce0cf9d87604e0a4b3f30497de4ebcd199e3a051d45391541a8` | PNG 390×844 |

三档均为 12 条、深浅主题生效、`scrollWidth=clientWidth`。1024/390 Dock 全宽 52px、16px blur、`pointer-events:auto`；抽样最小按钮命中盒 44px。

## 交互与故障证据

- 设置面板可打开，Escape 与页面外点可关闭。
- 搜索“头盔涂装”为 1 条；不存在关键字为明确无结果；清空恢复 12 条。
- 单条展开精确为 1，详情正文和关键点可见。
- 单图 lightbox 打开后 dialog=1、`#main-content[inert]`；Escape 最终关闭 dialog，但焦点落到 `body`，未返回触发图，记录 P1。
- `prefers-reduced-motion: reduce` 命中；抽样动画/过渡均为 `1e-05s`。
- 生产控制台两次捕获同一 React minified error #418，记录 P1。
- 页面资源审计未发现外部 HTTP(S) 资源，production 页面无 DRAFT。
- empty/error/404/partial/offline 浏览器故障注入按统筹收口指令标 `NOT_RUN`。
- accepted DTO 仅单 media，设计中的真实多图/缩略图/翻页出口无法由正式数据到达；按 COR-20260809T102214-960E65 列 P1 阻断，不再以 `NOT_RUN` 视为完成。

## 清理

- 任务 production 实例已停止；127.0.0.1:3000 和 127.0.0.1:3001 无监听。
- 浏览器视口与 reduced-motion override 已重置，任务标签已关闭。
- HTTP 临时收据只保留上述脱敏摘要，原始 `/private/tmp/34476E-*` 文件已删除。
