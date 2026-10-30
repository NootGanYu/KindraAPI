# 04: 文件夹说明与分享显示开关

**What to build:** 文件夹富文本说明的编辑入口、数据透出与分享页展示；新增 show_design/show_cases 开关。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `TargetSummary` 增加 `description?: string`
- [ ] 侧边栏文件夹右键菜单增加「编辑说明」，复用 `ApiDescriptionDialog`
- [ ] 保存时不改变接口/文件夹的其他字段，写入后刷新 targets
- [ ] 分享页导航项展示说明摘要，文件夹页展示完整富文本
- [ ] 说明经 `sanitizeRichHtml` 处理后输出
- [ ] `DocSettings`、`DocShareDialog` 增加 `show_design`、`show_cases`，默认 true
- [ ] 开关持久化并在渲染时读取；旧分享缺省视为 true
- [ ] typecheck 通过；smoke 覆盖说明展示与开关关闭后不输出分区
