# 12: 有界取消与远端结果未知

**What to build:** 用户和经授权 MCP 可取消活动或暂停的 Run，并如实看到已发送请求可能产生的未知远端结果。

**Blocked by:** 05: 进度与本地中断记录；06: 完整步骤暂停并手动继续

**Status:** resolved

- [x] UI 和 cancel_flow_run 可有界请求取消活动或暂停 Run，返回真实状态；仅在本地任务停止推进且在途工作妥善结束或隔离后释放活动锁，避免与新 Run 重叠。
- [x] 已发送请求不能保证撤销时明确表达远端结果未知，不伪称回滚。
- [x] 取消不自动重试或重放，已完成部分结果保留并可在重启后查看。
- [x] 重复取消安全且不会重复发请求；取消与失败、用户暂停分别表达。
- [x] 连接断开或超时不重新启动 Run，后续可按 run_id 查询。
- [x] 权限变化时 UI 仍可执行停止能力，不依赖 MCP 权限。
- [x] 受控 loopback、真实存储和 UI/MCP 测试覆盖进行中请求及暂停取消。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。


## Answer

实现提交：`baf40af`；与工单 07 集成的合并提交：`2ab4a21`。

- UI `flow:run:cancel` / `flows.cancelRun` 与经执行权限校验的 MCP `cancel_flow_run` 共用取消入口。取消等待至多 1 秒，未结束时返回 `cancelling`；活动锁仅由引擎完成后的清理释放。
- Run 自有 AbortController 中止等待、网络与脚本执行，并唤醒暂停门以退出；每个事件和循环迭代检查信号，完成部分结果保持不变。取消状态为 `cancelled`，已发送而未确认的请求另记 `remote_outcome: unknown`，界面明确显示无法回滚及不自动重试。
- 执行器从实际请求开始回调记录在途状态，拒绝晚到回调；取消前未发送的请求不会误标远端未知。UI 停止独立于 MCP 权限。
- 测试公共边界仍为已确认的真实临时存储、loopback、实际 MCP 适配和 Electron IPC／界面，无内部模拟。

验证通过：`test:flow-cancel`（等待／在途／暂停／前脚本／嵌套循环取消，活动锁与后续 Run，不重放，独立进程读取）；`test:flow-cancel-ui`（真实取消按钮与未知结果提示）；`test:flow-progress`、`test:flow-pause`、`test:flow-loop-resume`、`test:flow-dependencies`、`test:flow-snapshot`、`test:flow-async`、`test:debug-runtime`；node/web typecheck、build。

## Comments

- 已同步集成分支 `842361b`，保留嵌套游标、迭代标识和逻辑步骤暂停边界。工单 13 可在既有 `source` 与运行边界上追加实时权限策略；UI cancel 不依赖 MCP 配置。
- 未执行 git push。
