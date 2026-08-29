---
type: coordinator_supplemental_evidence
department: 统筹部
date: 2026-08-11
status: final
decision: advisory
related_task: TASK-20260811-EE3F90
---

# Kimi / frontend-design 审查 · 统筹只读预审

## 1. 身份与边界

本报告是统筹部针对外部审查输入的只读补充证据，供正式设计部执行 `TASK-20260811-EE3F90` 时独立核验。它不代表正式设计部结论，不 claim、complete 或修改任务状态，也不修改 Spec、accepted ADR、冻结设计、taste successor 或正式 App。

只读输入：

- `docs/collaboration/部门/设计部/报告/2026-08-11-frontend-design透镜v0.2冻结设计深度审视.md`
- `design/ui/F1+1-v0.2-全站设计/index.html`，SHA-256 `5a84bfb27294ebd727369118a95528f5b788bfacbe2d56cc03fcb006f6168cb1`
- 同目录 `design-system.md`、`brand-spec.md`、`F1+1-v0.2-token-map.json`
- `TASK-20260809-F1358A`、其设计报告及隔离 taste successor

本轮未运行浏览器、测试或外联，也未重新核验外部新闻真实性、图片权利或第三方服务状态。现有截图只作为已落盘历史视觉证据读取。

## 2. 总结

外部审查的大部分代码级发现成立；B2 与 E2 需修正。当前未发现推翻 v0.2 视觉方向的 P0。公开页继续实现或发布视频取材前，应优先关闭五组 P1：设计真值漂移、移动缩略图 44px 触控、错误文案与图片语义、桌面 trackpad 冲突裁定、第三方热链与本地稳定资产边界。

最小 successor 应只修客观真值、触控、错误文案和语义，不自动合入 `TASK-20260809-F1358A` 中尚未获用户确认的审美调整。

## 3. A–F 逐项裁定

| 编号 | 证据状态 | 裁定 | 优先级 | 最小动作 |
|---|---|---|---|---|
| A1 标题未用 Display 字体 | `verified`：`.tl-title` 无 `font-family`，继承 Body | 同意 | P1 | 增加 `.tl-title { font-family: var(--font-display); }`；正式 App 另证 Barlow 自托管与真实落屏 |
| A2 880/920 列宽冲突 | `verified`：shell 880px，1440 下扣除 padding 后内容约 800px，文档/token 写 920px | 同意真值漂移；无证据证明 920 更优 | P1 真值阻断 | 优先保留用户已确认渲染，successor 文档明确 `shell=880px / content≈800px`；若改 920，另做可视候选 |
| A3 主图 360/280 与文档 255 冲突 | `verified` | 同意漂移；无证据证明缩到 255 更优 | P1 真值阻断 | 保留桌面 360px、移动 280px并同步 successor 文档/token |
| A4 移动缩略图 22px 与文档 32px 冲突 | `verified`：后置移动规则覆盖 earlier coarse 规则 | 同意 | P1 | 可见图建议 28px；外层原生按钮提供 44×44 命中区 |
| A5 摘要完整显示与“两行截断”冲突 | `verified` | 同意漂移 | P1 真值阻断 | 保留完整中文摘要；文档/token 改为 `lineClamp:none` |
| B1 缩略图触控不足 | `verified` | 同意 | P1 | 用 `<button class="ph-thumb-hit">` 承担 44×44 命中和 ARIA，内部图片保持较小视觉尺寸；移动证据区可分行 |
| B2 证据行/原文入口仅 22px | `反证 + Unknown` | 不接受原报告的整体断言 | P2 补证 | 22px 多为非交互元数据/缩略图行；原文链接静态 CSS 为默认 32px、coarse 44px。真机复核原文链接命中区，不扩大整条非交互证据行 |
| C1 “7 条示例”实际 10 条 | `verified` | 同意 | P1 | 由 `FEED.length` 或 API `total` 生成，删除手写数量 |
| C2 页脚与样例来源冲突 | `verified` | 同意 | P1 | 候选文案建议：“F1+1 设计样板 · 示例资讯来自所标注来源；中文摘要仅供快速浏览，完整内容以原始来源为准。”；正式口径由产品确认 |
| C3 alt 为截断文件名 | `verified` | 同意 | P1 | 主图用中文人物/场景描述；缩略图 `alt=""`，外层按钮提供“查看第 N 张：主题”可访问名称 |
| D1 `wheel/deltaX` 劫持风险 | 代码风险 `verified`；真实浏览器影响 `Unknown` | 同意风险 | P1 决策门 | Mac Chrome/Safari 实机验证；现有 Function 明确要求 trackpad，设计部不得自行删除。若冲突成立，由产品/用户裁定仅 lightbox 捕获或取消桌面 wheel |
| D2 手势复杂度泄漏 | `verified`：hover/click/pointer/wheel/lightbox 多套输入并存 | 基本同意 | P2 | 不新增手势实体；若获准收敛，优先摘除桌面 inline wheel，保留缩略图、键盘、触屏路径 |
| E1 同日日期重复 | `verified` | 属 v0.3 设计输入，不能直接定为当前缺陷 | P2 产品门 | 候选方向为每日首条显示日期，其余条目仅显示时刻；改变信息架构前由产品确认 |
| E2 中文提炼层级过弱 | `部分反证` | 不接受“首页中文提炼缺失”表述 | P1 产品语义门 | 折叠态 `.tl-lead` 已是中文摘要，展开 `.tl-zh` 是第二层内容要点；先确认两层产品命名，再决定是否改为“内容要点”、15px/`--fg` |
| E3 相对时间未设计且 fixture 冲突 | `verified`：字段未渲染，同日混有“今日/昨日” | 同意数据卫生问题；无当前视觉缺陷 | P2 | 当前 successor 删除或忽略静态 `aggregatedAt`；v0.3 若显示相对时间，应由 `publishedAt` 计算并保留精确 `<time datetime>` |
| F1 meta 含修订日志 | `verified` | 同意 | P1（分享/公开前） | 设计候选使用简短产品描述；正式 App 去掉“设计样板”字样并按产品 SEO 合同落地 |
| F2 第三方图片热链 | `verified`；权利/稳定性 `Unknown` | 同意风险 | P1（视频/运行前） | 历史设计证据可保留；public-synthetic 与发布视频只使用固定、可复算、权利状态明确的本地资产 |

## 4. 最小 integrity successor

建议正式设计部另建：

`design/ui/F1+1-v0.2-integrity-successor-20260811/`

从 SHA-256 为 `5a84bfb2…6168cb1` 的冻结 HTML 直接派生，不覆盖旧目录。最小交付包括候选 HTML、successor 设计说明、token map、delta、SHA256 清单，以及 1440/1024/390 × 深浅六格证据。

建议最小 token 与 CSS：

```css
:root {
  --shell-max: 880px;
  --content-max: 800px;
  --media-max-block: 360px;
  --media-max-block-mobile: 280px;
  --thumb-visual-block-mobile: 28px;
  --target-min: 44px;
}

.tl-title { font-family: var(--font-display); }

.ph-thumb-hit {
  inline-size: var(--target-min);
  block-size: var(--target-min);
  display: grid;
  place-items: center;
  border-radius: var(--r-sm);
}

.ph-thumb-hit > img {
  display: block;
  block-size: var(--thumb-visual-block-mobile);
  max-inline-size: 38px;
  object-fit: cover;
}

.tl-original-link {
  min-block-size: var(--target-min);
  padding-inline: 8px;
  align-items: center;
}

@media (max-width: 700px) {
  .tl-ev {
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .ev-right {
    justify-self: end;
    min-block-size: var(--target-min);
  }
}
```

缩略图语义建议：

```html
<button
  type="button"
  class="ph-thumb-hit"
  aria-label="查看第 3 张：法拉利 499P 在蒙扎测试"
  aria-pressed="false"
>
  <img class="ph-thumb" src="…" alt="">
</button>
```

同一 successor 还应完成：kicker 数量数据驱动；meta/页脚勘误；主图中文 alt；A2/A3/A5 文档和 token 唯一真值同步。D1 保持显式 P1，未获产品/用户裁定前不静默改变 trackpad 合同。E1–E3 只作为 v0.3 输入。F2 在视频/运行候选中换成本地 synthetic 资产。

## 5. 与 `TASK-20260809-F1358A` 的关系

建议定义为“并行、选择性复用”，暂不定义为替代。

可复用：六格导出与 hash 清单方法、隔离 successor 纪律、删除无效 `Inter Tight` fallback、对 44px 风险的方向性判断。

不自动继承：桌面日期 18px、trace `.50 → .68`、390 恢复时间轴、Dock 渐变模糊、把 coarse 缩略图直接变成 44×44 裁切图。这些属于未获用户确认的审美或布局调整。integrity successor 应让客观勘误和可访问修复独立可判断。

## 6. 用户/产品门

1. 是否接受以当前渲染为真值，将 A2/A3/A5 同步为 880/约800、360/280、完整摘要。
2. 是否接受移动证据区必要时分为两行，以保证真实 44px 命中。
3. D1 若实机确认冲突，是否允许修改现有 trackpad Function 合同。
4. 页脚版权、来源和中文摘要免责声明的正式口径。
5. F2 的媒体权利与发布视频本地资产策略。
6. E1 同日分组、E2 两层中文内容命名与权重、E3 是否显示相对时间。
7. integrity successor 是否与 F1358A 合并，以及哪一候选最终替换冻结基线。

## 7. Unknown 与风险

- Barlow 自托管、离线和跨平台实际落屏仍为 `Unknown`。
- iPhone 真机 coarse-pointer、DPR、安全区、VoiceOver、200% 缩放与 forced-colors 仍为 `Unknown`。
- D1 在 Mac Chrome/Safari 中是否实际触发前进/后退冲突仍为 `Unknown`。
- 当前 Motorsport 图片的授权、热链稳定性、CSP 与发布视频使用权仍为 `Unknown`。
- 本轮没有联网核验示例新闻真实性、更新时间或权利状态。
- 新 successor 尚未由正式设计部制作，因此没有新 HTML、六格截图、hash 或用户确认。
- 正式结论仍以设计部执行 `TASK-20260811-EE3F90` 后的任务产物为准。
