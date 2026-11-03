# 01: 配置模型并进行项目文本对话

**What to build:** 在项目面板配置 Chat Completions 连接并进行可恢复的文本对话。

**Blocked by:** None (can start immediately)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 配置地址、模型、协议及 Key，连接测试可见成功和错误；Key 安全保存在本机且普通读取、日志不泄露。
- [x] 显示仅文本能力并允许聊天，未检测到工具能力时不提供连续工具操作。
- [x] 对话按项目本地保存、重启可读且可删除，不进入项目 Git。
- [x] 回环模型通过真实应用命令验证，Electron UI 可展示对话。

## Answer

已交付项目 Agent 页面、Chat Completions 连接配置/检测、仅文本能力提示、主进程流式聊天、会话恢复与删除。系统 safeStorage 异步加密保护 Key；普通配置仅返回 has_key；错误、消息与分块事件屏蔽连接 Key。所有 Agent 记录保存在 localRoot/agent，未写入项目 Git 目录。

应用命令边界为 `src/main/agent/service.ts` 的 `agentCommands`，Renderer 经 `api.agent` / `agent:*` IPC 使用同一命令；后续协议可扩展 `model.ts`，计划授权在此基础上接入。当前仅文本对话，不读取接口或提供连续业务工具。

验证：`npm run test:agent-chat`（真实安全存储、回环流、仅文本能力、跨项目隔离、删除、错误及分块密钥脱敏）；`npm run test:agent-ui`（真实 Electron IPC、连接配置、聊天、关闭重启、删除、Git/密钥边界）；`npm run typecheck`；`npm run build`。

另经用户授权使用本机配置在隔离 userData 验证真实 `deepseek-v4.1-flash` / Chat Completions：能力检测与文本对话通过。测试未修改日常配置，未复制或输出 Key。
