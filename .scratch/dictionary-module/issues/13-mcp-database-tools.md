# 13: MCP：数据库连接与导入工具

**What to build:** AI agent 可以通过 MCP 读取、创建、更新、删除 MySQL 连接，测试连接并导入表结构；测试与导入受 `allow_execute` 控制；任何响应都不返回数据库密码、私钥或 passphrase；删除连接必须显式确认。

**Blocked by:** 10, 11

**Status:** ready-for-agent

- [ ] 提供 `list_db_connections`、`create_db_connection`、`update_db_connection`、`delete_db_connection`
- [ ] 提供 `test_db_connection` 与 `import_db_schema`
- [ ] 列表与详情响应不包含密码、私钥或 passphrase
- [ ] 创建与更新接受常规连接参数，并按 ADR-0002 明文保存
- [ ] 删除连接要求 `confirm: true`，且不删除已导入模型
- [ ] `test_db_connection` 与 `import_db_schema` 在 `allow_execute` 关闭时被拒绝
- [ ] SSH 启用的连接在测试/导入时返回明确的后续支持错误
- [ ] 导入支持选择表、目标目录与同名策略，并返回生成/跳过/更新的模型摘要
- [ ] smoke 覆盖每个工具的成功路径、权限拒绝、凭据脱敏与导入摘要
- [ ] typecheck 与 build 通过
