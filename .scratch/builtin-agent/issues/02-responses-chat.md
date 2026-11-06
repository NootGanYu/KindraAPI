# 02: Responses 协议文本对话

**What to build:** 选择 Responses 协议并完成相同的连接检测和项目对话。

**Blocked by:** [01 配置模型并进行项目文本对话](01-model-chat.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 两协议显式选择并正确处理不同的流和错误；不影响已有 Chat Completions。
- [x] 仅文本模型仍可聊天并明确工具操作不可用。
- [x] 凭据保护、项目会话和删除行为保持一致。
- [x] 回环 Responses 服务覆盖连接、流和错误。

## Answer

已通过协议无关模型入口按连接选择 Chat Completions / Responses；Responses 使用独立适配器、`store: false`、完整本地会话输入，处理语义 SSE、完成/失败/未完成/截断与取消，不重试或切换协议。配置窗口保留显式协议选择及重启恢复；凭据与本机记录沿用 01 边界。

测试证据：
- TDD：应用命令测试先失败于“不支持的模型协议”，补实现后通过；UI 测试先失败于缺少 Responses 选项，补界面后通过。
- `npm run test:agent-responses`：回环连接/文本能力、流式内容、凭据脱敏、会话删除、401、失败/不完整/无效 JSON/截断流、取消与不自动重放。
- `npm run test:agent-chat` 与 `npm run test:agent-ui`：既有 Chat Completions 回归。
- `node scripts/agent-ui-smoke.cjs --responses`：真实 Electron 协议配置、聊天、重启后协议及会话恢复、删除、凭据和 Git 边界。
- `npm run typecheck`、`npm run build` 通过。
- 用户提供服务在隔离 userData 下用 `deepseek-v4.1-flash` 验证 Responses 能力探针和流式聊天成功；未复制/输出密钥、未改日常配置。

协议参考：[OpenAI Responses 创建与流事件](https://developers.openai.com/api/reference/resources/responses/methods/create)。工具计划执行仍由 06 交付，本票只含能力探针和文本对话。
