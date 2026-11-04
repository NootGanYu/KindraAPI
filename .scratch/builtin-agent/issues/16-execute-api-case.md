# 16: 执行并分析 API Case

**What to build:** 在授权范围内使用草稿执行用例，显示断言和结果分析。

**Blocked by:** [11 既有脚本、文件和变量授权](11-script-file-variables.md), [15 编辑与保存 API Case](15-edit-api-case.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 执行固定草稿及环境快照，结果与断言可见且对模型脱敏；运行结果不改变定义 revision 或待保存状态。
- [x] 已有脚本及副作用按计划授权；范围改变或环境删除暂停。
- [x] 取消和远端结果未知不自动重发，已成功用例不重复执行。
- [x] 回环目标服务及真实用例执行器验证结果、失败和重试边界。


## Answer

- 实现提交 `54e177d`，已同步集成 `dbaeb69`（包括票 18 Flow 保存）；本票仅在独立工作树实施，未 push。
- 新增 Renderer/IPC 同源命令 `proposeExecuteCasePlan`，`ReadPlanInput.caseIds` 按接口限定明确用例，模型仅能提出这些 `execute_api_case` 步骤且每个用例一次。用户可选择多个接口下的用例、环境、额外请求额度和变量写回权限；计划显示用例名称、覆盖后的方法/地址及依赖。Case 执行明确拒绝 `saveResponse=true`，没有隐含定义或响应保存。
- 复用 `request/cases.ts` 中真实请求与断言路径，提取 `executeApiCase` 供原手动执行和 Agent 共用；Agent 传入票 11 的真实执行快照、policy、取消信号、文件解析器及传输完整性跟踪，不绕过实际网络/脚本检查。原手动执行仍保存 `last_run`，Agent 只保存脱敏本机计划报告，不改正式定义、revision、草稿及 dirty 状态。
- 在解析请求前应用用例覆盖，批准显示因此包含覆盖后的目标、方法、上传文件及继承脚本。当前用例删除/禁用、目标/脚本/文件范围变化、文件内容变化或环境删除会暂停；普通 body/断言编辑不会改变已批准的执行快照。沿用运行变量演进与冲突安全差量写回；用例断言或脚本断言失败在写回前阻断，并阻断依赖，用例间明确独立的步骤可继续。
- 报告包括真实请求/响应、用例断言 actual/message、脚本断言、状态及网络次数，失败报告也发给模型分析；模型、事件与本机记录均为脱敏投影。Renderer 直接展示用例结果、HTTP 状态、时间和各断言结果。未知/取消请求不重发，重复批准被拒绝，重启不重放。
- TDD 红灯：起初没有用例执行命令；脚本断言失败但用例结果错误显示 passed；批准后禁用用例仍发送；普通编辑错误触发范围暂停；UI 缺少用例入口。分别修复后通过真实应用边界验证。
- `test:agent-case-execution` 在 Chat Completions 和 Responses 两协议通过，使用隔离 userData、真实 storage/Case executor/Postman sandbox 与 loopback model/HTTP。覆盖草稿覆盖请求、固定环境与普通字段快照、变量跨用例演进、断言失败分析及依赖阻断、禁止失败变量写回、额外请求与用例文件上传、变化文件/越界请求/禁用用例/删环境暂停、未保存新用例、远端断连与取消 unknown、单次派发、脱敏、正式定义和编辑草稿完全不变。
- `test:agent-case-execution-ui` 真实 Electron 旅程通过：编辑器修改用例覆盖→选择用例→覆盖后目标审批→拒绝无请求→批准一次真实请求→可见断言/报告→原编辑器保留未保存内容→重启历史可读且不重发。
- 通过 `typecheck`、`build`、`test:agent-execution`（双协议）、`test:agent-effects`（双协议）、`test:agent-case-edit`（双协议）、`test:debug-runtime`。合并票 18 后再次通过用例执行双协议和真实 UI、Flow 保存双协议和真实 UI。
- 后续统一续轮修复者可直接复用 `prepareExecution(..., permissions, apiCase)` 与 `executeSnapshot`；本票未扩大到动态模型/工具续轮改造。
