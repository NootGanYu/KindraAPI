# 14: 全链路验收

**What to build:** 字典模块按 spec 与 9 张实机截图完成交付：smoke、UI 自动化、真实 MySQL 导入、typecheck 与 build 全部通过，并确认现有 API、文档、流程自动化与 MCP 没有回归。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** resolved

- [x] `npm run typecheck` 与 `npm run build` 通过
- [x] smoke 覆盖字典、模型、引用、MySQL 与全部新增 MCP 工具，并全部通过
- [x] UI 自动化覆盖导航、字典、模型编辑器、API 引用与数据库导入，并全部通过
- [x] 使用本机临时 MySQL 完成一次真实连接、表结构导入与模型可编辑验证，结束后清理临时库
- [x] 按 9 张截图完成 UI 走查：页内标签、三入口空态、字典子标签/分页/开关、列设置、连接弹窗、新建菜单、模型编辑器双模式、引用徽标与解除
- [x] 现有 API 调试、文档分享、流程自动化与 MCP 工具保持通过
- [x] 验收记录写入本 ticket 的 `## Comments`

## Comments

2026-10-25 · 实现完成

- 完整验收通过：`npm run typecheck`、`npm run build`、`npm run smoke`、`npm run test:ui`。
- smoke 使用临时 MySQL 8.4.9（127.0.0.1:3307）完成真实连接、表读取、update/skip/copy 三种同名策略导入与类型映射验证，结束后清理临时库与模型。
- UI 自动化 12 步覆盖导航、字典、模型编辑器、复制/移动/拖拽/删除警告、API 引用/失效引用、数据库连接与导入。
- 现有 API 调试、流程自动化、文档与 MCP 回归通过（46 个工具）。
