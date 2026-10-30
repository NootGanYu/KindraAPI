# 06: MCP 设计与用例工具

**What to build:** 通过 MCP 读写设计、CRUD 用例并运行。

**Blocked by:** 01, 04

**Status:** ready-for-agent

- [ ] `get_api_design` / `update_api_design`
- [ ] `list_api_cases` / `get_api_case` / `create_api_case` / `update_api_case` / `delete_api_case`
- [ ] `run_api_case` / `run_api_cases`
- [ ] 沿用现有 MCP 写门控：读与运行按现有 execute 权限，写操作需开启写开关
- [ ] 参数校验：未知 project/api/case_id、非法断言返回可读错误
- [ ] 运行结果与 UI 共享 `last_run` 持久化
- [ ] 工具描述与现有风格一致；不新增前缀
- [ ] typecheck 通过；smoke 覆盖每个工具的成功、权限拒绝与参数错误
