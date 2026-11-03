# 07: 嵌套循环中暂停和恢复

**What to build:** 将步骤边界暂停和手动继续扩展到嵌套循环，保留迭代进度及变量，不重跑已完成操作。

**Blocked by:** 06: 完整步骤暂停并手动继续

**Status:** resolved

- [x] UI 或 MCP 请求暂停后，嵌套循环在当前逻辑步骤完整结束后暂停。
- [x] Run 保存恢复所需的游标、嵌套调用栈及变量，从正确迭代继续。
- [x] 运行实例使用稳定 event ID 和 iteration 标识；已完成迭代不会重发请求。
- [x] 重复继续幂等，已提取 token 和对象 ID 保持可用。
- [x] 条件及分组内部可在逻辑步骤边界暂停；嵌套迭代使用完整路径，避免相同 event 在不同外层轮次碰撞。
- [x] 原有条件、循环和脚本行为不因暂停支持改变。
- [x] 为后续剩余步骤新快照预留迭代识别，已完成迭代不被重写，不依赖票 08 实现。
- [x] 真实存储和受控 loopback 测试覆盖嵌套循环及 UI 继续。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。

## Answer

实现提交：`14e442e`。嵌套循环、条件和分组沿现有异步调用栈在完整逻辑步骤边界暂停，继续保留原运行变量与已完成结果。内层循环退出后恢复外层或进入循环前的 `loop_index`。

每个结果携带稳定 `instance_id` 和完整 `iteration_path`；公开 Run 与本机证据包含 `cursor.stack`（根到当前子列表、各层下一事件下标和循环轮次）及 `after_instance_id`。未来迭代可据此区分于已完成实例，刷新定义不会重写已完成结果。运行变量原值仍只留在内存，展示和持久证据继续使用统一脱敏，重启不自动恢复。

## Comments

- 按已确认的测试边界执行 TDD：真实临时存储、loopback HTTP、MCP 适配及 Electron UI IPC。首轮先复现“含循环的流程暂不支持暂停”，实现后通过；第二轮先复现缺少完整迭代身份／游标，再实现并通过。
- 新增 `npm run test:flow-loop-resume`：两层各两轮循环，含 if/group 和完整前置／请求／后置脚本；MCP 与 UI 分别暂停，重复 UI 继续不重发，token／对象 ID 继续可用，四个请求实例标识不碰撞，首次已完成结果在第二次暂停后保持不变，公开和持久游标一致。
- 通过 `test:flow-entry`、`test:flow-definitions`、`test:flow-snapshot`、`test:flow-async`、`test:flow-pause`、`test:flow-progress`、`test:flow-dependencies`、`test:flow-loop-resume`、`typecheck`、`build`、`git diff --check`。
- 原票 06 的循环拒绝测试更新为循环步骤边界暂停／手动继续验收；其原有线性暂停兼容验证保留。
- 完成前已同步集成分支 `9b7ba45`，未执行 push。
