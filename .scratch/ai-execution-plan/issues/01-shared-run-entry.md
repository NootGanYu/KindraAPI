# 01: 共享 UI 与 MCP 运行入口

**What to build:** 建立薄的公共运行入口，让现有界面和 MCP 继续以原有方式执行 Execution Flow，为后续受控运行提供共同接缝。此票不重写执行引擎。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 界面可保存并运行既有 Flow，返回原有结果。
- [x] MCP 既有执行操作可运行相同 Flow 并返回原有摘要。
- [x] 两个入口共用运行入口，项目和环境参数不丢失。
- [x] 既有事件、条件、循环及脚本行为保持兼容。
- [x] 真实临时存储和 loopback HTTP 验证两个公开入口的请求及结果。
- [x] 原有运行相关回归通过，无需引入异步 Run 或暂停功能。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。

## Answer

实现提交：`d2719bf`（重构：统一界面与 MCP 的已保存流程运行入口）。

- 公共入口：`src/main/flow/service.ts` 的 `runSavedFlow(projectId, flowId, environmentId?)`。按项目读取已保存 Flow，委托原引擎；`flow:run` 与 `execute_flow` 均接入，调用方保留独立权限策略。
- 已确认测试边界沿用 spec 的 Testing Decisions：真实临时项目存储、loopback HTTP、实际 Electron renderer IPC 与 MCP `callTool`；不替换存储或内部执行协作者。
- TDD：先添加公共入口行为测试，缺失 service 模块时失败；引入入口后请求及报告通过。随后增加两个适配器的兼容回归，涵盖八类事件、循环迭代、脚本断言、token 传递、条件与禁用节点、环境参数、项目隔离、缺失 Flow 和执行权限拒绝。
- 验证通过：`npm run test:flow-entry`、`npm run typecheck`（node/web）、`npm run build`、`git diff --check`。
- `npm run smoke` 已运行；既有流程登录/token 与后续 MCP/MQTT 回归完成，最终失败于无关且基线已有的 `doc html excludes orphan field docs`。集成分支在本实现前也复现该文档断言，不将其标记为本票回归。
- 原引擎请求环境与脚本环境可能不一致的既有问题，按依赖图留给 03 的运行快照解决；本票原样传递环境参数，没有提前重写引擎。
