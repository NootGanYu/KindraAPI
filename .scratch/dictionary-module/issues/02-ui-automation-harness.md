# 02: UI 自动化测试底座

**What to build:** 能在本地或 CI 启动已构建的 openPost，打开字典入口并断言页面加载，为后续每个 UI 切片提供可复用的自动化缝。优先复用现有调试 CDP 开关，或使用 Playwright Electron；不引入第二套 UI 测试框架。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 自动化脚本可以启动已构建应用并等待主窗口就绪
- [ ] 可以导航到字典入口并断言路由/页面标题加载
- [ ] 提供可复用的启动、导航、关闭与失败截图/日志辅助
- [ ] 测试使用独立临时用户数据目录，结束后清理，不污染真实项目
- [ ] 测试不依赖外部网络
- [ ] 现有 smoke 流程保持通过
- [ ] typecheck 与 build 通过
