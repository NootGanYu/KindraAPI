# 09: 获批保存接口定义

**What to build:** 已批准计划含独立 save 步骤时保存接口并关联候选。

**Blocked by:** [08 接口字段并发合并与冲突审阅](08-api-conflict-merge.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 授权计划含 save 时校验通过自动保存，不再重复确认；无 save 时正式定义不变。
- [x] 分别检查草稿基线和正式 revision；冲突暂停，其他候选链不受影响。
- [x] 延用文档硬性校验：缺业务依据要求澄清，新建和增量更新保持现有规则。
- [x] 正式版本关联候选且 MCP 及文档校验回归通过。


## Answer

- 实现提交 `9772ba3`；后续合并 `1b03ce2`、`20d8370` 已同步集成至 `7124378`，保留第 10 票执行快照/取消/未知结果和第 13 票恢复/撤销语义。
- `proposeSavePlan` 提供独立 `save_api` 工具步骤；计划面板展示正式保存的影响和依赖。一次批准自动按真实步骤顺序采纳本计划候选，再同步检查主进程草稿 `base_revision`、正式 revision 和未决冲突；无 save 的修改仍只生成本机候选。批准前先同步编辑器草稿，保存事件更新打开页的基线与 dirty 状态，避免回传旧投影。
- 当前应用链保存后在独立 review 记录关联正式 `version_id`、版本号与 revision，候选原始快照不修改；其他待确认候选保留。版本入口显示关联的正式版本。
- MCP 写入口窄提取 `prepareApiDocumentation` 和共享 `assertDocumentationPaths`；新建全量门槛仍由 MCP 回归覆盖。Agent 保存同时使用原始 patch 意图与真实草稿增量，覆盖 save-only、参数、原始 JSON 新字段和响应字段；未知业务规则暂停并要求澄清，不能用空 args 绕过。嵌套 patch 形状、稳定参数 ID、伪造系统参数及无效 JSON 也在正式写入前阻断。
- TDD 红灯证据：初始缺少 `proposeSavePlan`；直接传嵌套 query patch 时错误保存缺规则字段；`request.header:null` 仍能进入待批准状态；伪造 `is_system:1` 与无效 JSON 错误保存。逐项修复后真实应用命令和 Chat Completions/Responses 回环同契约全部通过。
- 通过：`typecheck`、`build`、`test:agent-save`（两协议）、`test:agent-plan-protocols`、`test:agent-execution`（两协议）、`test:documentation`、`test:client-sync`、`test:agent-drafts`、`test:agent-merge`、`test:agent-editor-lifecycle`、`test:agent-candidate-undo`。最后一轮命令回归使用当前工作树独立 `.tmp`。
- 真实 Electron UI 通过：`test:agent-save-ui`（独立保存步骤、一次批准、无手工采纳、正式版本关联、dirty 清除、文档缺项提示且不保存）；以及 `test:agent-execution-ui`、`test:agent-draft-ui`（真实退出与恢复）、`test:agent-candidate-undo-ui`。全部使用隔离 userData，无真实项目配置修改，未 push。
