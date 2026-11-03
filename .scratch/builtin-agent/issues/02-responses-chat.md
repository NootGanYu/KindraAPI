# 02: Responses 协议文本对话

**What to build:** 选择 Responses 协议并完成相同的连接检测和项目对话。

**Blocked by:** [01 配置模型并进行项目文本对话](01-model-chat.md)

**Status:** claimed

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [ ] 两协议显式选择并正确处理不同的流和错误；不影响已有 Chat Completions。
- [ ] 仅文本模型仍可聊天并明确工具操作不可用。
- [ ] 凭据保护、项目会话和删除行为保持一致。
- [ ] 回环 Responses 服务覆盖连接、流和错误。
