# 12: 接口创建与项目候选汇总

**What to build:** 创建尚未正式保存的接口草稿，项目汇总可审阅其候选。

**Blocked by:** [09 获批保存接口定义](09-save-api.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 尚未正式创建的对象在汇总可找到，候选和草稿不等同正式接口。
- [x] 新建文档缺失必填规则或业务依据时暂停澄清，不猜测；有效获批 save 才正式创建。
- [x] 不采纳只更新审阅状态并保留历史；候选不受既有 100 条正式历史裁剪。
- [x] 隔离项目存储测试创建、拒绝、重启及 Git 无新增候选。


## Answer

已实现新建接口草稿与项目候选汇总，沿用现有计划、草稿、候选、审阅和保存服务。

- `proposeCreateApiPlan` 使用工厂在内存固定新对象身份和父目录，`create_api` 步骤批准前不创建草稿或正式接口。批准后只在本机创建草稿、不可变候选及应用审阅记录。
- UI「新建接口草稿」可选择父目录、明确允许计划提出独立保存步骤。没有保存权限时模型添加 `save_api` 会使计划暂停；新建+保存或后续单独保存均必须有独立获批步骤。
- `saveApprovedApi` 识别 `new_object`，缺失正式对象的 revision 仍保持 null。使用完整新接口文档规则校验，缺必填/可空/业务含义等规则时保留草稿并暂停澄清；后续 save-only 不能退化成增量校验。已有接口仍使用09增量语义。
- 新增同步、内部使用的 `createAgentTargetChecked` 存储边界，检查对象不存在及父目录有效。普通 `saveTarget` 不能将标记为新建的 Agent 草稿直接创建为正式接口；退出暂存也不正式保存。
- 「项目候选汇总」以 `kind/entity_id/lifecycle` 统一展示 API 与 Flow；尚未正式创建对象可审阅差异、不采纳及恢复草稿。复用17共享P编号和Flow版本入口，不引入第二套候选系统；删除墓碑仍由21实施。
- 保存成功关联对应候选正式版本、清理已保存草稿状态，其他候选及拒绝历史不被清除。

实施提交：`2fa5216`、`c7404e0`、`d504e79`；交付前已合入集成 `c077b48`（包含17及14），合并提交 `f24e375`。

验证：

- TDD 红灯：新建应用命令缺失；普通保存能越过新建授权；项目汇总不含Flow；Electron缺少新建入口。对应实现后全部通过。
- `npm run test:agent-create`：Chat Completions/Responses 两协议、真实隔离存储及回环模型；验证批准前零对象、仅创建本机草稿、拒绝/恢复、独立保存创建正式接口、缺规则澄清与后续save-only全校验、澄清后保存、API/Flow共用P序号、拒绝越权保存、拒绝计划无草稿、父目录删除暂停。
- Git边界：隔离项目执行真实 `git init/status --porcelain`，创建和审阅前后项目文件内容及Git状态完全不变；正式历史裁剪到100条后未创建/已拒绝候选仍可从汇总读取。
- `npm run test:agent-create-ui`：Electron从新建计划批准进入项目汇总，不采纳后重启仍可找到并恢复，随后在独立修改与保存计划中选取尚未创建草稿，批准后汇总显示已正式保存。
- `npm run typecheck`、`npm run build`、`test:agent-flow-ui`、`test:agent-save-ui` 通过。
- 真实命令回归：`agent-save-smoke`、`agent-candidate-undo-smoke`、`agent-flow-draft-smoke`、`agent-plan-smoke`、`agent-plan-steps-smoke`、`documentation-smoke`、`client-sync-smoke`，独立12后缀bundle全部通过；`git diff --check`通过。
