# 04: 异步启动与查询 Run

**What to build:** 在 UI 和 MCP 公开可查询的 Run，并保持旧同步执行兼容；本票只需最小本地 Run 元数据及初末结果。

**Blocked by:** 01: 共享 UI 与 MCP 运行入口

**Status:** claimed

- [ ] start_flow_run 接受 project_id、flow_id、environment_id、request_id，立即返回 run_id 和真实状态。
- [ ] 同项目同 request_id 且输入相同返回原 Run；输入不同拒绝，不重复发请求。
- [ ] get_flow_run 按项目和 run_id 查询状态与已可用的结果，界面可显示运行状态。
- [ ] 同一 Project / Flow 同时仅一个活动 Run，冲突请求明确拒绝。
- [ ] 旧 execute_flow 正常完成返回原摘要；最多等待 20 秒，超时返回 run_id 和真实状态以供查询。
- [ ] 工具连接断开不重启或重放运行；外部 MCP 无暂停流程正常执行。
- [ ] 真实存储、loopback 和 MCP 适配验证幂等、活动锁、旧接口兼容；不要求逐步报告。
- [ ] 执行本票相关类型检查及 build，保持现有检查通过。
