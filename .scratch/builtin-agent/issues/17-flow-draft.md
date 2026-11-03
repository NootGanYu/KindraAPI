# 17: Flow 草稿编辑与版本入口

**What to build:** Agent 修改一个 Execution Flow 草稿，显示候选及冲突。

**Blocked by:** [08 接口字段并发合并与冲突审阅](08-api-conflict-merge.md)

**Status:** ready-for-agent

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [ ] Flow 草稿独立于页面状态；切项目和退出不隐式保存。
- [ ] Flow 有版本入口、候选提醒和双栏 Diff；逻辑修改创建独立本机候选。
- [ ] 基于稳定 event ID 自动合并无冲突字段，同字段冲突需要确认。
- [ ] 真实存储及 UI 验证重启恢复、冲突和不改正式 Flow。
- [ ] 在引入本票能力前完成窄路径兼容重构，并验证外部 MCP 权限和行为回归。
