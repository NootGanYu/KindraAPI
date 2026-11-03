# 06: Responses 只读工具计划

**What to build:** Responses 连接通过能力检测后执行同等只读计划。

**Blocked by:** [02 Responses 协议文本对话](02-responses-chat.md), [05 只读连续操作与依赖](05-read-only-steps.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] Responses 的工具请求、结果和多轮流正确呈现。
- [x] 相同项目范围、脱敏、授权与拒绝行为适用。
- [x] 文本模型不能触发工具连续操作。
- [x] 两种回环协议运行相同只读契约测试。

## Answer

已让同一计划服务通过 `completeModel` 使用两协议。Responses 适配器将通用工具消息转换成 `function_call` / `function_call_output`，严格按 `call_id` 对齐结果并转换工具 schema；不再限制只读计划必须使用 Chat Completions。两协议支持完整工具流后才生成待批准计划，解释流逐次经过 `projectRedactor.stream` 脱敏。计划依赖调度、项目/对象校验、拒绝/重新确认逻辑沿用 04–05。

验证证据：
- TDD：同一只读契约先失败于 Responses 协议被拒绝，接通后通过；工具流断言先失败于未启用 stream，扩展后通过；真实 UI 先复现 Responses 按钮被禁用，开放能力判断后通过。
- `npm run test:agent-plan-protocols`：两协议各自运行同一单对象与多步骤测试，覆盖批准前不读、拒绝、跨项目/越权、脱敏（含流式秘密前缀）、不完整工具流、缺少调用 ID、指令注入、仅文本禁用、顺序依赖、部分成功、独立步骤、草稿读取及禁止重放。
- `node scripts/agent-plan-ui-smoke.cjs` 及 `--responses`：真实 Electron 计划范围、批准/拒绝、解释、重启读取与 Git 边界均通过。
- `npm run typecheck`、`npm run build`、`test:agent-chat`、`test:agent-responses`、`test:agent-connections` 通过。
- 隔离 userData 使用用户提供的服务，`deepseek-v4.1-flash` / Responses 完成能力探针、模型提出计划、批准后读取并解释；全部步骤 succeeded，未输出密钥，也未执行接口 HTTP 请求。

协议参考：[Responses 创建与函数调用输入](https://developers.openai.com/api/reference/resources/responses/methods/create)。
