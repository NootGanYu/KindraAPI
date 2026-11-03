# 01: 共享 UI 与 MCP 运行入口

**What to build:** 建立薄的公共运行入口，让现有界面和 MCP 继续以原有方式执行 Execution Flow，为后续受控运行提供共同接缝。此票不重写执行引擎。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 界面可保存并运行既有 Flow，返回原有结果。
- [ ] MCP 既有执行操作可运行相同 Flow 并返回原有摘要。
- [ ] 两个入口共用运行入口，项目和环境参数不丢失。
- [ ] 既有事件、条件、循环及脚本行为保持兼容。
- [ ] 真实临时存储和 loopback HTTP 验证两个公开入口的请求及结果。
- [ ] 原有运行相关回归通过，无需引入异步 Run 或暂停功能。
- [ ] 执行本票相关类型检查及 build，保持现有检查通过。
