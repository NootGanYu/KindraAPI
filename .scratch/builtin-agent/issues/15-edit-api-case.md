# 15: 编辑与保存 API Case

**What to build:** Agent 在接口草稿内修改单接口用例并审阅、保存。

**Blocked by:** [09 获批保存接口定义](09-save-api.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 参数覆盖及断言显示为候选差异；不含 save 不修改正式定义。
- [x] 按稳定 case ID 合并并发变更，冲突需解决；获批 save 延用 revision 和文档门槛。
- [x] 版本恢复包含用例及其他可编辑字段，保留身份与运行记录；现有不完整恢复不可冒充完整恢复。
- [x] 真实存储和命令覆盖编辑、冲突、保存及恢复。


## Answer

- 实现提交 `e1a62d0`，基于并已同步最新集成 `c077b48`，仅在第 15 票独立工作树实施；没有增加用例执行能力。
- `propose_api_change` 支持 `cases`，现有候选双栏 Diff 展示参数覆盖和断言；没有独立 save 步骤时不写正式定义。沿用第 09 票保存授权、真实草稿基线、正式 revision、文档硬门槛及版本关联。
- 按稳定 `case_id` 合并用例；增加 `assertion_id` 合并以保留同一用例不同断言上的独立修改。同字段冲突进入现有四方审阅，未解决时阻断正式保存。嵌套校验覆盖完整用例、覆盖参数和断言，拒绝坏类型、重复 case/assertion/param ID 及模型提交 `last_run`。
- 正式版本恢复改为完整 `targetDefinition`，包括 cases/custom_attributes/design/mark/tags/parent/sort 等可编辑字段，历史中不存在的可选字段会移除；保留当前 target/project/type 身份、创建时间与按 case ID 对应的最新运行记录。版本恢复确认文案明确完整范围及正式保存行为。
- 版本签名和 revision 统一采用 `targetDefinition` 口径，运行结果不产生定义版本，排序和移动纳入定义。比较历史快照时重新计算口径，旧格式签名不会触发无意义的迁移版本。
- TDD 红灯：最初 cases 被白名单拒绝；运行结果更新后的普通保存错误增加版本；旧恢复未恢复用例；同一用例不同断言被当作整组冲突。分别修复后命令与真实存储回归通过。
- `test:agent-case-edit` 在 Chat Completions/Responses 两协议通过：草稿候选、case/assertion 稳定 ID 合并、并发同字段冲突、显式保存、文档阻断、坏类型/重复 ID/runtime 写入拒绝、完整版本恢复与版本签名边界。
- `test:agent-case-edit-ui` 真实 Electron 旅程通过：生成/批准用例修改→候选覆盖和断言双栏 Diff→人工覆盖地址冲突→四方选择→单独批准保存→接口用例编辑器显示结果→通过原正式版本入口完整恢复并保留运行结果。
- 通过 `typecheck`、`build`、`test:documentation`、`test:client-sync`、`test:agent-save`、`test:agent-merge`、`test:agent-candidate-undo`、`test:agent-plan-protocols`、`test:agent-flow-drafts`、`test:agent-editor-lifecycle`、`test:debug-runtime`。测试使用隔离 userData 和工作树独立 `.tmp`，没有修改真实项目配置，未 push。
