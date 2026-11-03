# 09: 步骤覆盖冲突选择

**What to build:** 用户在暂停后审阅新 API 与步骤覆盖的冲突，明确选择本轮实际请求，再手动继续。

**Blocked by:** 08: 暂停后保存并刷新剩余引用

**Status:** resolved

- [x] 新 API 修改被步骤覆盖的字段时展示冲突，body 整体覆盖亦展示；未冲突覆盖保留。
- [x] 用户可逐项选择新 API 值或保留步骤覆盖，并看到实际生效请求。
- [x] 字段删除或类型不兼容必须解决，否则保持暂停。
- [x] 选择仅写本 Run revision，不隐式改持久 Flow input；后续运行读取其原定义。
- [x] 保存失败、删除或并发更新时阻止继续并提示重新审阅。
- [x] 授权范围扩大时继续保持暂停，票 10 完成前不得借冲突选择绕过授权。
- [x] 真实存储和 loopback/UI 测试覆盖字段、body、解决与未解决状态。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。

## Answer

- 实现提交：`2501764`，运行中权限整合：`b2358f5`；本票分支已合入最新集成分支 `995abd1`，并组合验证票 10。
- `resolveFlowRunConflict` / UI IPC 逐字段选择新 API 或步骤覆盖；保留未冲突覆盖，展示删除/类型变化和实际生效请求。候选 input 保存在内存，仅采用时写入引擎克隆的 Flow，不修改持久 Flow。
- revision、接口删除、未解决冲突及范围授权独立检查。选择改变请求后使此前范围确认失效，需重新确认；采用与继续仍为独立动作。冲突旧/新/覆盖值统一脱敏。
- 修复运行时新增覆盖参数的随机 ID 导致重复捕获误判 revision 的问题，使用稳定的运行内 ID。

## Validation

- TDD：真实存储与 loopback 公开服务测试先因缺少冲突选择入口失败；Electron 真实界面测试先因缺少冲突控件失败，再实现并通过。
- `npm run test:flow-conflicts`：字段/body、删除/类型变化、下一轮仍用持久覆盖、并发更新/删除、凭据脱敏、覆盖与范围审批互不绕过。
- `npm run test:flow-conflicts-ui`：真实按钮选择、有效预览、采用后保持暂停、手动继续和持久 Flow 不变。
- `test:flow-scope`、`test:flow-scope-ui`、`test:flow-revocation`、`test:flow-refresh`、`test:flow-loop-resume`、`test:flow-progress`、`test:flow-pause`、`test:flow-cancel` 通过。
- node/web `typecheck`、`build`、`git diff --check` 通过。UI 定位器兼容 Ant Design 加载图标的可访问名称前缀。
