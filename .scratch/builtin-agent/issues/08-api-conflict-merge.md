# 08: 接口字段并发合并与冲突审阅

**What to build:** 用户与 Agent 并发编辑接口时合并无冲突字段并处理冲突。

**Blocked by:** [07 首次接口草稿修改与候选](07-api-draft-candidate.md)

**Status:** ready-for-agent

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [ ] 基线、当前草稿和提案中无冲突字段自动合并；仅冲突字段需要确认，不能静默覆盖。
- [ ] 冲突以 base/current/agent 和结果选择呈现，未解决时不能保存。
- [ ] 按稳定实体 ID 识别参数；raw body 与脚本整体比较，保留后续人工修改。
- [ ] 应用命令及 Electron UI 验证不同字段、同字段、重命名和候选状态。
