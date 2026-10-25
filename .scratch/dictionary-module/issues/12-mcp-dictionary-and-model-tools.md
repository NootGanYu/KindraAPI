# 12: MCP：字典与模型工具

**What to build:** AI agent 可以通过 MCP 完整读取、创建、更新、删除自定义字典条目与数据模型；删除模型必须显式确认并返回引用它的接口；所有写操作受 `allow_write` 控制；工具名与现有 MCP 工具风格一致。

**Blocked by:** 04, 08

**Status:** resolved

- [x] 提供 `list_dictionary_entries`、`create_dictionary_entry`、`update_dictionary_entry`、`delete_dictionary_entry`
- [x] 提供 `list_data_models`、`get_data_model`、`create_data_model`、`update_data_model`、`delete_data_model`
- [x] 字典列表支持按内置、自定义或全部过滤
- [x] 模型工具可读写名称、别名、目录、描述与 schema
- [x] 删除模型要求 `confirm: true`，并返回引用该模型的接口列表
- [x] 写类工具在 `allow_write` 关闭时被拒绝，读取工具仍可用
- [x] 删除内置字典条目被拒绝；删除自定义条目成功
- [x] MCP 返回的模型引用使用稳定协议，便于后续工具解析
- [x] smoke 覆盖每个工具的成功路径、参数校验、权限拒绝与删除引用列表
- [x] typecheck 与 build 通过

## Comments

2026-10-25 · 实现完成

- 新增字典 4 个、模型 5 个 MCP 工具；写操作受 `allow_write` 控制，删除需 `confirm: true`。
- 字典支持 source 过滤；模型返回 schema 与引用数；删除模型/目录返回受影响接口列表。
