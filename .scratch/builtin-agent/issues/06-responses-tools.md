# 06: Responses 只读工具计划

**What to build:** Responses 连接通过能力检测后执行同等只读计划。

**Blocked by:** [02 Responses 协议文本对话](02-responses-chat.md), [05 只读连续操作与依赖](05-read-only-steps.md)

**Status:** claimed

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [ ] Responses 的工具请求、结果和多轮流正确呈现。
- [ ] 相同项目范围、脱敏、授权与拒绝行为适用。
- [ ] 文本模型不能触发工具连续操作。
- [ ] 两种回环协议运行相同只读契约测试。
