# 14: 端到端验证与文档

**What to build:** 用进程内真实 MQTT broker 跑通完整链路，补齐 UI 自动化与文档，确保 typecheck、build 与现有 smoke 不回归。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** ready-for-agent

- [ ] 引入 `aedes` 作为 devDependency，smoke 在随机端口启动与关闭 broker
- [ ] smoke 覆盖：Profile CRUD 与版本、测试连接、持久连接、冲突、并发上限、订阅、发布、消息落盘/轮转/导出、Attempt、MCP 全部工具与权限
- [ ] smoke 覆盖错误分类：DNS、TCP 拒绝、认证失败、ACL 拒绝、协议版本不兼容、超时
- [ ] UI 自动化覆盖：导航、新建/编辑 Profile、测试连接、连接/断开、订阅、收件箱视图切换、发布、定时发布停止
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] 现有 smoke（HTTP、Flow、MCP、OpenAPI）不回归
- [ ] README 增加 MQTT 模块说明、支持范围与「不含脚本/压测/代理」的边界
- [ ] 文档链接到 `GLOSSARY.md` 的 MQTT 分组与 ADR-0003 / ADR-0004
- [ ] 手动验收清单：用真实 broker 验证 3.1.1 与 5.0 各一次连接、一次订阅、一次发布、一次重连
- [ ] 记录已知限制：搜索仅当前已加载消息、凭据随配置导出、消息不参与项目 Git
