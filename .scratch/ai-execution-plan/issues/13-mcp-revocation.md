# 13: 运行期间 MCP 权限撤销

**What to build:** 在 MCP 发起的 Run 中持续执行现有项目和工具权限策略，权限撤销后阻止后续操作，同时用户仍可在 UI 停止。

**Blocked by:** 12: 有界取消与远端结果未知

**Status:** resolved

- [x] 创建和更新保持现有 write 约束；启动要求 execute，查询要求只读权限及项目允许。
- [x] 每次 MCP 控制及继续前重新校验 enabled、项目允许列表和相应权限。
- [x] MCP 权限撤销后，由 MCP 发起的 Run 不再执行后续步骤，并显示明确状态。
- [x] 撤权不影响 UI 实际取消和停止 Run；已完成请求不被重放。
- [x] UI 与 MCP 使用各自身份及策略，不通过伪造 MCP 配置获取权限。
- [x] MCP 无自动解除用户手动暂停的能力；无暂停且权限有效的旧调用保持兼容。
- [x] 至少一个真实 TCP 或 stdio MCP 测试结合 loopback 和真实存储验证撤权、后续阻止和 UI 取消。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。

## Answer

已在 MCP 适配器和真实 TCP 桥接按当前持久权限重新校验；调用方较窄授权不会被当前配置扩大。Flow 运行以 source 区分 UI/MCP，MCP 来源在每个完整逻辑步骤前检查 enabled、允许项目和 execute，失权进入 `permission_revoked` 并保留活动锁。恢复权限不自动推进；用户继续会同时复核权限及已审阅快照 revision。UI 取消始终可用，无 MCP 继续工具。

实现提交：`642aff3`；合入 08 并保留刷新复核：`930c592`。新状态纳入 UI 展示、本地中断恢复及活动 Flow 删除保护；原有 write 与接口文档校验不变。

## Validation

- `test:flow-revocation` 先观察到撤权后 Run 错误通过的红灯，再通过真实 TCP + 临时存储 + loopback + Electron IPC 验证 execute/关闭 MCP/项目移除，后续请求不发送、只读查询、UI 停止、手动恢复幂等、legacy 同步返回及写权限。
- 组合测试覆盖采用新快照后撤权阻止继续，恢复权限后 API revision 再变仍被拒绝。
- `test:flow-entry`、`test:flow-definitions`、`test:flow-snapshot`、`test:flow-async`（含 20 秒等待及真实 TCP 断连）、`test:flow-progress`、`test:flow-pause`、`test:flow-loop-resume`、`test:flow-dependencies`、`test:flow-cancel`、`test:flow-refresh`、`test:client-sync` 通过。
- `typecheck`（node/web）、`build` 通过；真实 Electron `test:flow-refresh-ui`、`test:flow-cancel-ui`、`test:flow-progress-ui` 通过。进度 UI fixture 改为等待真实 HTTP 到达，消除提前调用 release 的时序假设。
- 所有 MCP 测试 fixture 明确保存测试权限，避免依赖临时构造的配置绕过当前设置。
