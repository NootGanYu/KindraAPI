# 04: 用例运行与结果持久化

**What to build:** 单条运行、运行全部（串行）、结果落盘且不置 dirty。

**Blocked by:** 01, 03

**Status:** ready-for-agent

- [ ] 新增 IPC `target:run-case` / `target:run-cases`，复用现有 executor 与当前环境
- [ ] 单条运行返回 `CaseRunResult`
- [ ] 运行全部串行执行，汇总 `{ total, passed, failed, error }`
- [ ] 新增 IPC `target:save-case-run`，只更新 `cases[].last_run`
- [ ] 前端运行后更新草稿中的 `last_run`，但不修改 `dirty`
- [ ] 运行过程有 loading 与取消/防重复点击
- [ ] 未知 case、禁用 case、执行异常返回可读错误
- [ ] 不写入请求历史
- [ ] typecheck 通过；smoke 对 demo-server 覆盖通过/失败/异常
