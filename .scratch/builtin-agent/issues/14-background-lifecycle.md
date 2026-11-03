# 14: Agent 会话生命周期与后台项目

**What to build:** 跨项目切换继续原任务，退出安全暂存并恢复。

**Blocked by:** [03 多连接与任务绑定](03-model-connections.md), [10 首次执行接口草稿与未知结果](10-execute-api.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 任务固定原项目、获批环境和模型配置，不读取新项目内容。
- [x] 隐藏到托盘与退出区分；退出前提醒、终止所有项目任务并仅暂存 Agent 草稿，重启不自动重放请求。
- [x] 每项目草稿独立于页面状态；退出仅补未快照内容并去重。
- [x] Electron UI 与真实命令测试切项目、退出、恢复和纯手工草稿行为。

## Answer

- 退出等待所有项目中的模型和计划取消完成并落盘，再补录 Agent 草稿；无窗口退出也走同一准备流程。异常中断后的运行步骤恢复为暂停，已发送的执行步骤标为结果未知，不自动重放。
- 隔离 userData 的真实 Electron 验证覆盖跨项目切换、窗口隐藏继续运行、退出确认、真实请求取消后重启为未知、Agent 草稿恢复、纯人工草稿退出保存；回环模型及目标服务验证原项目与固定配置、环境和请求定义。
- 验证：`npm run typecheck`、`npm run build`、`npm run test:agent-chat`、`npm run test:agent-execution`（两协议）、`npm run test:agent-draft-ui`、`npm run test:agent-execution-ui`。实现提交 da6b814、b68608b。
