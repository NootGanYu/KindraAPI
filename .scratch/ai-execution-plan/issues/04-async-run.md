# 04: 异步启动与查询 Run

**What to build:** 在 UI 和 MCP 公开可查询的 Run，并保持旧同步执行兼容；本票只需最小本地 Run 元数据及初末结果。

**Blocked by:** 01: 共享 UI 与 MCP 运行入口

**Status:** resolved

- [x] start_flow_run 接受 project_id、flow_id、environment_id、request_id，立即返回 run_id 和真实状态。
- [x] 同项目同 request_id 且输入相同返回原 Run；输入不同拒绝，不重复发请求。
- [x] get_flow_run 按项目和 run_id 查询状态与已可用的结果，界面可显示运行状态。
- [x] 同一 Project / Flow 同时仅一个活动 Run，冲突请求明确拒绝。
- [x] 旧 execute_flow 正常完成返回原摘要；最多等待 20 秒，超时返回 run_id 和真实状态以供查询。
- [x] 工具连接断开不重启或重放运行；外部 MCP 无暂停流程正常执行。
- [x] 真实存储、loopback 和 MCP 适配验证幂等、活动锁、旧接口兼容；不要求逐步报告。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。

## Answer

- `72fb7de`：共享运行管理分配 Run 身份与活动锁，提供 `startFlowRun` / `getFlowRun` / `waitForFlowRun`；UI IPC 与 MCP 异步启动查询，旧同步工具最多等待 20 秒。幂等输入记录与初末结果保存在 `offline-data-local/projects/<project_id>/executions/runs`，兼容读取旧报告。
- `4cdb28a`：合并工单 02，保留完整事件树、UI revision 检查。
- `0cc10c2`：实际 BrowserWindow IPC、MCP adapter、真实 TCP MCP 断连、受控 loopback、持久化与 20 秒等待上限回归。重复 request_id 不重放，不同输入及活动 Flow 冲突明确拒绝；只读可查询，跨项目不可读。
- 验证：`npm run test:flow-async`、`npm run test:flow-entry`、`npm run test:flow-definitions`、`npm run typecheck`、`npm run build` 全部通过。全量 smoke 的既有文档导出失败沿用基线记录，不属于本票变更。
- 03 继续集成快照初始元数据及运行版本标签；05 继续逐步进度、脱敏与重启中断策略。本票完成最小本地 Run 初末状态。
