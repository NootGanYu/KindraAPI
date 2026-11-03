# 04: 只读计划解释当前接口

**What to build:** 用户批准只读 Agent Plan，Agent 读取当前项目接口并解释。

**Blocked by:** [01 配置模型并进行项目文本对话](01-model-chat.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 面板展示项目、对象、目标、环境和只读步骤；拒绝计划不调用工具。
- [x] 读取当前接口时可使用未保存草稿，无草稿时读取已保存定义；读取不触发正式保存。
- [x] 应用命令逐步检查项目与对象范围；外部 MCP 原权限和行为保持回归。
- [x] 模型输入及工具结果脱敏认证头、Cookie、Key 和环境变量值；响应文档不能成为授权指令。
- [x] 真实项目存储及回环模型验证读取、拒绝越权、可见结果和项目隔离。
- [x] 在引入本票能力前完成窄路径兼容重构，并验证外部 MCP 权限和行为回归。

## Answer

已交付项目「只读计划」面板及模型工具闭环：模型仅凭目标和对象编号提出 `read_api`，用户批准后主进程复核项目、接口和环境，优先读取未保存草稿，脱敏后交给模型解释。拒绝、越权、环境删除、重复批准和响应中的新增工具要求均不能扩权；定义不发生保存。

- 公共命令：`src/main/agent/plans.ts`，由 `agentCommands`/IPC/preload 共用；`src/shared/agentPlan.ts` 是后续多步骤契约入口。
- `src/main/business/apiRead.ts` 提供与 MCP 共享的读取投影；权限仍在各入口独立校验，未伪造 MCP 开启状态。
- 按项目保存计划、脱敏结果与解释至 `localRoot`，可查看和删除；重启恢复历史且不自动执行。模型配置在生成计划时固定，兼容项目默认及显式本轮连接。
- `src/main/agent/redaction.ts` 统一处理环境/全局变量值、Header/Cookie/Auth/Key 和 JSON 内敏感字段；聊天输入与流式输出也应用同一保护。
- TDD：先观察缺失计划命令、批准尚未执行、缺失删除命令、UI入口缺失和 JSON 密码泄露的失败，再逐片实现。

验证：`typecheck`、`build`、`test:agent-plan`、`test:agent-plan-ui`（含真实 Electron 授权/拒绝/重启与 Git 边界）、`test:agent-chat`、`test:agent-responses`、`test:agent-connections`、`test:documentation`、`test:client-sync` 通过。

真实服务使用隔离 userData：`glm-5.3` / Chat Completions 完成能力检测、生成计划、获批读取和解释；未打印或提交密钥，未改用户日常配置。本次 `deepseek-v4.1-flash` 探针只确认文本能力，入口按检测结果阻止工具计划。Responses 只读工具计划由 06 号票实现，当前明确禁用。
