# 18: Flow 计划保存与恢复

**What to build:** 批准独立 save 后保存 Flow，并支持版本恢复。

**Blocked by:** [17 Flow 草稿编辑与版本入口](17-flow-draft.md), [09 获批保存接口定义](09-save-api.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 无 save 保持正式定义；批准 save 校验基线后保存并关联候选，不影响其他候选。
- [x] 未解决冲突阻止保存，恢复候选到草稿不隐式保存。
- [x] Flow 版本和可编辑字段可恢复，保留身份和运行记录。
- [x] 真实存储验证并发、保存、恢复及现有手动 Flow 行为回归。

## Answer

- 实现提交 `32023e0`；`193d6e0` 固定编辑器首次读取的保存基线；`8e74c8a` 保证 Flow 的完整内容签名只保留本机，模型仅收到版本标识；`acbbfd6` 补充当前 Flow 页面接收后台保存事件的 UI 回归。合并提交 `8b78093` 已同步脚本授权集成 `7123240`，`b5e99f4` 同步最新票据认领记录至 `1b9717c`。
- 两协议共用独立 `save_flow` 步骤，批准前在可见计划中补齐同 Flow 修改依赖；执行端复核正式 revision、草稿原始基线和候选所属计划，自动采纳本计划候选并保存，不重复授权。已应用草稿中的候选链会关联正式版本；其他待确认候选保留。
- Flow 正式保存记录本机 `v` 版本，旧 Flow 首次修改保留修改前版本，只有时间戳变化不增加版本。版本恢复与候选恢复均只进入草稿并检查并发冲突；恢复名称、描述、环境及完整事件树，保留当前对象身份、创建时间和手动 Flow 运行报告。未解决冲突在存储边界阻止正式保存。
- 版本入口区分 `v` 与 `P`、显示候选关联版本和双栏 Diff，并提供恢复到草稿及显式载入最新定义。人工保存和 Agent 保存均同步页面状态；恢复草稿退出仅暂存，重启后须主动保存。
- `test:agent-flow-save` 在 Chat Completions / Responses 两协议通过：无 save 不保存、独立获批 save、候选关联与保留、正式版本恢复、候选恢复、首次编辑基线与外部并发、冲突阻断、显式人工保存、时间戳去重、运行报告保留、Git 工作区仅出现获批正式 Flow 定义变更，模型保存结果不含完整 revision。
- `test:agent-flow-save-ui` 真实 Electron 旅程通过：选择 Flow 生成并批准保存计划、v/P 关联与 Diff、恢复旧版到草稿、退出重启恢复、手动保存、恢复未采纳候选、当前页面接受后台保存并清除草稿提示。
- 合并后通过 `typecheck`、`build`、`test:agent-flow-drafts`、`test:agent-save`、`test:agent-effects`、`test:agent-effects-ui`、`test:documentation`、`test:client-sync`；含双协议保存与脚本副作用回归。仅使用隔离 userData、回环模型/HTTP 与工作树独立测试输出，未修改原始工作区，未 push。
