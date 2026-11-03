# 08: 接口字段并发合并与冲突审阅

**What to build:** 用户与 Agent 并发编辑接口时合并无冲突字段并处理冲突。

**Blocked by:** [07 首次接口草稿修改与候选](07-api-draft-candidate.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 基线、当前草稿和提案中无冲突字段自动合并；仅冲突字段需要确认，不能静默覆盖。
- [x] 冲突以 base/current/agent 和结果选择呈现，未解决时不能保存。
- [x] 按稳定实体 ID 识别参数；raw body 与脚本整体比较，保留后续人工修改。
- [x] 应用命令及 Electron UI 验证不同字段、同字段、重命名和候选状态。

## Answer

新增 `main/agent/merge.ts` 字段三方合并：比较 base/current/agent，保留双方无冲突修改；参数数组通过稳定 param_id 识别实体，重命名不改变身份。raw body、脚本等字符串原子比较；重复/未知身份数组保守处理，数组顺序单独呈现冲突。无冲突字段直接进入本机草稿，冲突字段暂保留 current。

候选原始快照保持不变，`AgentCandidate.merge` 的审阅记录单独保存 current/result/conflicts/choices/review_id。`resolveCandidate` 要求每个冲突明确选择 base/current/agent，并校验审阅令牌、草稿签名与正式 revision；审阅期间发生新编辑会刷新冲突，不能以旧选择覆盖。正式 revision 变化继续暂停，待后续保存票处理。

版本入口展示每个冲突的基线、当前内容、Agent 内容和选择后的结果。`storage/agentConflicts.ts` 在 saveTarget 同步存储边界阻止未解决冲突写入，覆盖现有手工 Save、版本恢复及 MCP 写入；运行记录更新不经过该定义保存边界。重启后仍从本机记录检查，不依赖内存锁。

验证通过：`test:agent-merge`（不同字段、同字段、明确选择、稳定 ID 重命名、raw/script 原子冲突、旧审阅失效、顺序冲突、解决后保存）、`test:agent-merge-ui`（真实 Electron 四方展示、既有 Save 拒绝、重启后继续拒绝、明确选择并保存）、`test:agent-drafts`、`test:agent-draft-ui`、`test:client-sync`、`test:documentation`、`typecheck`、`build`。

### 编辑会话基线补充修复

已复现并修复“放弃关闭后的纯手工镜像仍存活、后续计划又给旧镜像绑定新磁盘 revision”的组合问题。Renderer 在关闭标签或离开项目时按同一同步队列调用 `releaseEditorDraft`，只释放非 Agent 镜像；Agent-owned 草稿继续保留。同步消息携带真实编辑基线，计划按所选草稿来源固定 revision，并正确标记 draft 来源，不再借用新磁盘 revision。

新增 `test:agent-editor-lifecycle`：真实 Zustand 编辑入口与主进程命令、真实 MCP 更新，验证放弃关闭不复活内容、MCP 新字段保留、Agent-owned 关闭保留、活动旧草稿与排队同步保持原 revision。`test:agent-merge-ui` 增加真实“放弃并关闭”后生成候选的旅程。上述测试以及双协议计划、07 草稿 UI 和退出恢复均通过。
