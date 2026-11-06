# 22: 整轮跨对象本地撤销与审计

**What to build:** 对一轮接口、用例和 Flow 的本地修改展示差异并安全撤销。

**Blocked by:** [15 编辑与保存 API Case](15-edit-api-case.md), [21 对象删除后的候选保留与恢复](21-deleted-object-candidates.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 展示 Git Diff 风格变更及冲突；后续人工编辑冲突需确认，不覆盖无关修改。
- [x] 恢复所有可编辑字段并保留对象身份、运行记录及候选审阅历史。
- [x] 明确远端请求及外部副作用不能回滚；不声称整批原子撤销。
- [x] 隔离真实存储和 Electron UI 覆盖混合对象、冲突与重启；Agent 记录不进 Git、可删除。

## Answer

- 实现提交 `fc4d57a`，合入最新集成 `f8749e6`。`src/main/agent/turnUndo.ts` 按候选实际应用顺序逆序回放，`src/main/storage/agentConflicts.ts` 对 `review`/`partial` 且含冲突的撤销记录加保存屏障；`drafts.ts`/`flowDrafts.ts` 提供 `commitTurnUndo*` 与删除对象恢复草稿，保留对象身份、运行记录和候选审阅历史。彻底删除项目 Agent 记录时通过 `clearProjectPlanContexts` 直接导出清理暂停上下文；`hasActivePlanOperations` 守卫进行中的操作。
- `src/renderer/src/components/AgentTurnUndoPanel.tsx` 提供 Git Diff 风格差异、冲突单选、暂停/放弃、审计历史和删除记录确认。放弃审阅会把记录置为 `cancelled` 且不改动草稿。
- 验收：`npm run typecheck`；`npm run test:agent-turn-undo`（8 项 PASS，覆盖混合 API/Case/Flow、人工字段、stale 冲突、应用顺序、新建/删除对象、重启、记录删除）；`npm run test:agent-turn-undo-ui`（Electron 全流程，含取消审阅后草稿不变、重启冲突、删除记录保留正式定义与连接）；合并后回归 `npm run test:agent-flow-control` 双协议 PASS。
