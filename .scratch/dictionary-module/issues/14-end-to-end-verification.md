# 14: 全链路验收

**What to build:** 字典模块按 spec 与 9 张实机截图完成交付：smoke、UI 自动化、真实 MySQL 导入、typecheck 与 build 全部通过，并确认现有 API、文档、流程自动化与 MCP 没有回归。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** ready-for-agent

- [ ] `npm run typecheck` 与 `npm run build` 通过
- [ ] smoke 覆盖字典、模型、引用、MySQL 与全部新增 MCP 工具，并全部通过
- [ ] UI 自动化覆盖导航、字典、模型编辑器、API 引用与数据库导入，并全部通过
- [ ] 使用本机临时 MySQL 完成一次真实连接、表结构导入与模型可编辑验证，结束后清理临时库
- [ ] 按 9 张截图完成 UI 走查：页内标签、三入口空态、字典子标签/分页/开关、列设置、连接弹窗、新建菜单、模型编辑器双模式、引用徽标与解除
- [ ] 现有 API 调试、文档分享、流程自动化与 MCP 工具保持通过
- [ ] 验收记录写入本 ticket 的 `## Comments`
