# 21: 对象删除后的候选保留与恢复

**What to build:** 接口或 Flow 被用户、MCP 或授权操作删除后，项目汇总仍可审阅候选和墓碑。

**Blocked by:** [12 接口创建与项目候选汇总](12-create-api-candidates.md), [13 候选恢复与单对象撤销](13-candidate-undo.md), [18 Flow 计划保存与恢复](18-save-flow.md)

**Status:** claimed

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [ ] 删除前保留候选和撤销所需墓碑，删除不抹去 Agent 审阅证据。
- [ ] 不新增独立 Agent 删除功能；既有删除来源均保留候选证据。
- [ ] 候选不采纳保留历史，恢复和撤销检查后续冲突。
- [ ] 真实存储验证删除、重启、项目汇总及 Git 边界。
