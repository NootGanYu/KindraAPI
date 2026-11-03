# 01: 配置模型并进行项目文本对话

**What to build:** 在项目面板配置 Chat Completions 连接并进行可恢复的文本对话。

**Blocked by:** None (can start immediately)

**Status:** claimed

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [ ] 配置地址、模型、协议及 Key，连接测试可见成功和错误；Key 安全保存在本机且普通读取、日志不泄露。
- [ ] 显示仅文本能力并允许聊天，未检测到工具能力时不提供连续工具操作。
- [ ] 对话按项目本地保存、重启可读且可删除，不进入项目 Git。
- [ ] 回环模型通过真实应用命令验证，Electron UI 可展示对话。
