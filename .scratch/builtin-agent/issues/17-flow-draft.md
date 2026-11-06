# 17: Flow 草稿编辑与版本入口

**What to build:** Agent 修改一个 Execution Flow 草稿，显示候选及冲突。

**Blocked by:** [08 接口字段并发合并与冲突审阅](08-api-conflict-merge.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] Flow 草稿独立于页面状态；切项目和退出不隐式保存。
- [x] Flow 有版本入口、候选提醒和双栏 Diff；逻辑修改创建独立本机候选。
- [x] 基于稳定 event ID 自动合并无冲突字段，同字段冲突需要确认。
- [x] 真实存储及 UI 验证重启恢复、冲突和不改正式 Flow。
- [x] 在引入本票能力前完成窄路径兼容重构，并验证外部 MCP 权限和行为回归。

## Answer

- Flow 使用独立的主进程草稿、`flow_id`、不可变候选及可变审阅记录；本机保存于项目 Git 外。编辑、页面切换、切项目与退出均不隐式保存正式 Flow，退出补录按内容去重。已合入票据14的异步退出等待，模型/计划停止落盘后再暂存 Flow。
- `propose_flow_change` 复用两协议的 AgentPlan 权限复核与依赖调度，可与 API 修改同轮；Flow 以独立 kind/flow_id 标识，未伪装成 Target。共享候选 P 序号、稳定 ID 三方合并、双栏 SnapshotDiff 与逐字段冲突组件。
- 原 Flow 编辑页增加版本入口及待确认数量；冲突保留基线、当前、Agent 内容及用户选择结果。按 `event_id` 合并，保留独立字段编辑；未解决冲突由存储层阻止所有正式保存入口。Run 的自动保存入口在主进程再次检查 Agent 所有权，必须先主动保存，无法靠 Run 绕过。
- TDD 证据：实际应用命令先失败于不支持 Flow 计划，再实现获批候选/草稿；Run 防隐式保存从缺失命令到通过；错误 Flow input 原被接受为 pending，补齐边界校验后暂停；真实 UI 暴露冲突确认事件 previous 快照错误，修复后恢复正确投影。
- 验证：`npm run typecheck`、`npm run build`、`npm run test:agent-flow-drafts`（Chat Completions / Responses、混合API+Flow、P序号、稳定event_id合并、候选不可变、冲突保存阻断、MCP权限/原保存、Git边界）；`npm run test:agent-flow-ui`（实际计划批准、版本提醒、双栏Diff、四方冲突、切页面/项目、退出重启恢复、Run屏障、主动Save）；`test:documentation`、`test:client-sync`、`test:debug-runtime`、`test:agent-merge`、`test:agent-merge-ui`、`test:agent-save`、`test:agent-plan-protocols`、`test:agent-editor-lifecycle` 均通过。
- 实现提交：667435c；生命周期合并：4dbf1ac。交付前合入最新集成分支并再次执行 Flow 双协议及编辑生命周期测试；未 push，未修改用户原工作区。Flow 正式版本/历史恢复由18实现，受权执行由19/20实现。
