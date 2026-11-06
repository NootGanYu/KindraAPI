# 21: 对象删除后的候选保留与恢复

**What to build:** 接口或 Flow 被用户、MCP 或授权操作删除后，项目汇总仍可审阅候选和墓碑。

**Blocked by:** [12 接口创建与项目候选汇总](12-create-api-candidates.md), [13 候选恢复与单对象撤销](13-candidate-undo.md), [18 Flow 计划保存与恢复](18-save-flow.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 删除前保留候选和撤销所需墓碑，删除不抹去 Agent 审阅证据。
- [x] 不新增独立 Agent 删除功能；既有删除来源均保留候选证据。
- [x] 候选不采纳保留历史，恢复和撤销检查后续冲突。
- [x] 真实存储验证删除、重启、项目汇总及 Git 边界。

## Answer

- 在 storage 公共删除边界保存本机不可变墓碑：删除前正式定义、草稿、版本及编号；递归目录删除逐个保留子 API，UI/MCP 删除均覆盖，候选及审阅历史不清除。API/Flow 正式版本仍在原 localProjectDir 位置，原手工 Flow runs 不迁移。
- Git 丢弃、分支切换、拉取通过删除前本机 checkpoint 保留证据，结束时核对实际删除；中断的 checkpoint 在重启读取时核对。恢复命令不注册为模型删除工具。
- 项目汇总区分已删除/未创建/已保存，支持墓碑双栏审阅、候选拒绝/恢复、恢复删除前草稿以及独立主动正式保存。被删除的父目录不隐式重建，恢复到根目录并在 UI 明示。恢复保留原对象编号及历史版本。
- 恢复和 API 单候选撤销使用三方冲突审阅；旧草稿与删除前后来更新的正式定义也通过恢复候选合并。同编号重建、墓碑变化、审阅后再编辑均阻断旧操作。恢复保存复用 Agent 字段文档增量门槛与 storage 冲突屏障，缺业务规则保持草稿且暂停保存。
- TDD red→green：递归删除缺墓碑、删除 API/Flow 无法恢复、恢复保存绕过文档门槛、旧草稿忽略后续正式编辑；均有真实应用命令回归。
- 验证：`test:agent-deletion`（真实 MCP delete_apis/delete_execution_flow、候选拒绝/恢复/undo 冲突、fresh Electron 进程重启、正式版本/Flow runs/Git 隔离、同编号重建与缺文档恢复）；`test:agent-deletion-ui`（Electron 接口/Flow 汇总墓碑、拒绝/重启/恢复/独立保存、实时删除通知、实际 Git discard）；12/13/18 回归（create、candidate-undo、flow-save，12/18 两协议）、client-sync、documentation、node/web typecheck、build。
