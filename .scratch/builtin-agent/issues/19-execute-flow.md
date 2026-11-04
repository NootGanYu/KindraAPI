# 19: 跨接口 Flow 草稿执行

**What to build:** 在计划范围执行包含多个接口节点的 Flow 草稿。

**Blocked by:** [17 Flow 草稿编辑与版本入口](17-flow-draft.md), [11 既有脚本、文件和变量授权](11-script-file-variables.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 入口及节点绑定同一获批环境，固定 Flow、接口及模型引用本轮依赖快照；后续新运行仍实时解析模型引用。
- [x] 运行变量可演进，写回差量检查冲突；环境删除或范围变化暂停。
- [x] 本票先交付直线跨接口节点，20 补齐同一首版的条件与循环；失败后的依赖节点停止，独立计划步骤遵循 05，不能仅凭流程节点结构推断独立。未知结果不自动重发，取消状态准确。
- [x] 回环服务与真实执行器验证跨接口顺序、快照、环境和请求计数。


## Answer

已通过应用命令 `proposeExecutePlan` / `approvePlan` 接入 `execute_flow`，Renderer「执行草稿」支持选择 Flow 及接口混合计划。使用既有 `runFlow`、`sendRequest` 真实执行链；可选主进程 `FlowExecutionPolicy` 固定获批环境并禁止手动执行器的隐式变量、发送记录及报告写入。手动/MCP Flow 默认行为和原报告目录保留。

`prepareFlowExecution` 在计划生成时固定 Flow 草稿、节点参数覆盖、接口草稿、模型引用展开、祖先请求默认值、设置及所有节点脚本/文件/请求授权。运行中只核对原始定义的安全范围，不重新解析模型作为运行输入；下一轮仍实时解析 `model_id`，正式定义保持引用。Flow/接口/环境删除、脚本或文件配置变化在执行边界暂停；文件 resolver 和 beforeRequest 复用票11拦截。节点脚本摘要、文件SHA256/大小、额外请求方法地址次数列入本地审批，额外请求额度按各节点明确列出。

节点共享同轮 `ExecutionVariables`，Flow 全部成功且用户明确允许时才差量 CAS 写回；冲突保留外部修改。直线节点失败停止后续依赖；独立计划步骤仍按票05调度，绝不从节点结构自行认定独立。传输中断及已发送取消为 `unknown` 且不自动重发；等待阶段取消为 `cancelled`。Agent 报告存放 localRoot 的计划记录；Flow signature 的 stable JSON 仅保留内存，公开只返回 SHA256，节点凭据/动态变量在审批、报告和模型上下文中脱敏。

本票支持 api/request/assert/wait/begin 直线组合，明确拒绝启用的独立 script/if/loop；没有调用旧的不安全宿主 VM 来假称支持。票20补安全条件、循环及独立脚本；安全策略须仅让可序列化数据和context内函数进入VM，禁止host process/fs/shell可达，不能只依赖timeout。

验证：

- 红→绿：首条真实命令因“仅支持修改Flow”失败；环境在请求后删除原误报failed的回归先红后修为paused；自定义查询认证字段在审批泄露的回归先红后纳入节点快照脱敏。
- `npm run test:agent-flow-execution`：Chat Completions与Responses均通过。回环计数覆盖双接口顺序/同环境、草稿节点参数、运行中改模型与祖先默认仍固定本轮、下轮实时模型、显式变量写回/CAS冲突、环境删除、API/Flow范围改变、断言停止、断连接/取消unknown不重发、wait取消、内联请求、额外请求授权、上传/文件变更、独立计划继续、VM危险节点拒绝、手动报告保留、本机报告隔离和凭据脱敏。
- `npm run test:agent-execution`、`npm run test:agent-effects`：原API执行及脚本/文件副作用双协议回归通过。
- 合入最新 `codex/builtin-agent`（含票18）后，`npm run test:agent-flow-save`、Flow执行双协议、node/web类型检查通过。
- `npm run build` 与 `npm run test:agent-flow-execution-ui`：真实Electron选择Flow、审批范围/脚本指纹、拒绝零请求、批准运行未保存草稿、脱敏报告、正式定义不变及重启不重放通过。
- 类型检查使用 `tsc -p tsconfig.node.json --noEmit --composite false --incremental false` 和对应web配置；没有push。
