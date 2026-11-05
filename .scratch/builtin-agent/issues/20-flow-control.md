# 20: Flow 条件循环与部分成功

**What to build:** 在已授权 Flow 中执行条件、循环与依赖步骤并分析结果。

**Blocked by:** [19 跨接口 Flow 草稿执行](19-execute-flow.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 条件和循环读取运行变量，保持计划目标与环境范围。
- [x] 逐对象保留成功，失败节点及依赖暂停；不能证明独立则保守阻塞。
- [x] 重试仅未完成步骤，未知远端结果不自动重试；不宣称整批原子回滚。
- [x] 真实 Flow 执行器及回环服务覆盖分支、循环、失败和计数。


## Answer

已在真实 `runFlow` 的 Agent policy 中补齐 `if` / `loop` / 独立 `script`，与既有 API/内联请求、断言、等待和分组共用执行链。条件、Flow脚本和Postman请求脚本共享权威 `ExecutionVariables.values`；环境/全局/局部变量在同轮演进，嵌套循环恢复外层 `loop_index`。实际回归发现 Postman 在脚本后替换 `state._variables`，现已从当前scope读取，避免条件读到过期局部变量。原手动/MCP Flow 默认行为不变。

审批前冻结Flow/节点/环境及依赖快照。循环只接受1至50整数，嵌套展开上限1000；审批显示节点最大调用数、额外请求累计次数、独立脚本/条件SHA256。动态查询值可以由本轮变量提供，方法、主机、路径和查询字段名仍由原请求policy锁定，脚本改变目标会在实际发送前暂停。独立脚本支持原Flow已有的变量、响应、断言、日志能力，不授予网络、文件或shell。

Agent脚本/条件不再运行旧的宿主函数shim：只有JSON文本进入空的null-prototype context，所有pm/console/expect/内建对象均在context内创建；禁止字符串/Wasm代码生成，求值及返回JSON均有超时，宿主只接收JSON字符串，不读取不可信异常的属性。应用命令无害 `typeof process/require/Buffer/fetch`、`constructor`与栈帧探针均验证宿主能力不可达；未以timeout代替授权隔离。

失败立即停止本Flow后续依赖和后续循环；保留已成功节点及迭代结果，条件不成立/禁用为skipped，依赖阻塞为paused；独立计划步骤沿用既有依赖调度继续。已发送断连为unknown，已发送断言失败也不能通过恢复命令重发，不宣称远端回滚。

新增 `resumePlan(projectId, planId, stepIds)`：必须明确选择可恢复未完成步骤，核对原范围/环境/依赖后生成pending恢复修订并再次审批。Flow检查点按节点路径和循环迭代缓存完成结果、分支判定及最后响应；恢复跳过成功请求和已完成脚本，只继续未发送边界。`executeSnapshot`只有授权派发数与原生传输启动数均为0时才标retryable。原始快照与检查点仅留主进程内存；重启、关闭、删除记录失效，不声称已实现跨重启恢复。最终统一续轮实现须按continuation-design补安全持久ledger与显式新范围审批，不能读取普通脱敏报告重建可重放请求。对票22提供 `clearProjectPlanContexts` / `hasActivePlanOperations` 清理与运行guard接口。

Renderer展示逐节点状态、循环迭代、实际运行轮数，选择未完成步骤后生成待批准恢复计划。恢复文案明确保留成功、不重发未知、不回滚远端副作用。

验证：

- TDD红→绿：最初真实计划命令拒绝if；局部变量API→条件回归发现未同步；恢复命令最初缺失；轮转/同脚本set-unset变量泄露红测由全轮历史值脱敏修复。各自补实现后通过。
- `npm run test:agent-flow-control`（Chat Completions / Responses）：API脚本→Flow脚本→条件→循环变量传递、局部请求头、真假分支、有界循环、每次及累计额外请求、目标越界零发送、脚本显式变量写回、constructor/栈帧/宿主全局探针、断言失败及unknown停止循环、恢复审批前范围改变拒绝、取消后恢复只发送剩余迭代、已发送失败/unknown拒绝重试、轮转及同节点set/unset的历史值脱敏。
- `npm run test:agent-flow-execution`双协议：保留既有依赖快照、同环境、冲突写回、失败/unknown独立计划、上传、额外请求、脱敏和本机报告；危险脚本测试更新为安全执行时拒绝，而非整类节点拒绝。
- `npm run test:agent-execution`、`npm run test:agent-effects`、`npm run test:agent-case-execution`双协议回归通过。
- node/web类型检查（关闭incremental/composite）、`npm run build`通过。
- `npm run test:agent-flow-control-ui`真实Electron：审批显示循环最多3次，首迭代后取消，勾选恢复并重新批准仅发index1/2；重启零重放。
- 无push；未改原checkout。

最终统一修复的已知跨票问题：Postman节点单个script内部 `pm.variables.set('z', ['postman','temporary','value'].join('-')); console.log(pm.variables.get('z')); pm.variables.unset('z')` 的中间值不会出现在beforeRequest/onVariables最终scope；额外真实命令审计确认该值仍出现在报告。20的节点历史集合与独立Flow shim不能覆盖该内置Postman边界，复现脚本及具体证据已交协调者执行最终统一修复，未声称最终变量集合足以脱敏所有脚本历史。
