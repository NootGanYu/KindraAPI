# 重构基线

本目录用于重构前后对比，不依赖外部服务：

- `screenshots.json`：每个状态的 WebP/PNG 路径、视口、截图 SHA-256。
- `regions.json`：topbar/rail/main/statusbar/模式条/请求面板/响应面板/弹窗的 bounding box。
- `tokens.json`：body/topbar/rail/statusbar/按钮/输入/Tab/表头/Tag/Modal/Card 的计算样式。

重构后重跑 `npm run ui:inventory`，对比：

1. `sha256` 变化 → 视觉发生变化的状态。
2. `regions.json` 尺寸变化 → 布局漂移。
3. `tokens.json` 颜色/字号/圆角变化 → 设计令牌漂移。
