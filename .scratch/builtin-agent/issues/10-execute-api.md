# 10: 首次执行接口草稿与未知结果

**What to build:** 批准执行后运行接口草稿并分析结果。

**Blocked by:** [07 首次接口草稿修改与候选](07-api-draft-candidate.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 计划显示方法、目标、环境及实际副作用；运行固定项目、环境及草稿定义快照。
- [x] 固定继承参数、引用模型及环境等本轮依赖；正式定义保留 model_id，后续新运行解析当时模型。本地请求使用必要真实凭据，返回模型和记录的内容脱敏。
- [x] 11 尚未支持脚本、上传及变量副作用前，遇到此类执行显式拒绝，不能静默略过；响应内指令不增加权限。
- [x] 支持取消并显示实际状态；服务收到请求后断连时记录结果未知，绝不自动重发。
- [x] 回环目标 HTTP 计数验证实际网络与模型流可取消、未知结果和已成功步骤不重发；运行报告本地保存至用户手动删除，不进 Git。
- [x] 在引入本票能力前完成窄路径兼容重构，并验证外部 MCP 权限和行为回归。


## Answer

已实现 `execute_api` 草稿执行计划，复用既有计划授权、依赖调度和两协议工具契约。UI 展示请求方法、脱敏目标、获批环境、草稿来源和实际副作用，并提供真实取消。执行与正式保存分离；失败/未知步骤阻断依赖，明确独立步骤可继续，已结束计划不能再次批准重放。

执行前在内存固定接口、父级继承、全局请求默认值、环境/全局变量、Cookie、模型引用生成结果和请求设置；发送使用同一快照，正式 `model_id` 与预览原文保持不变。后续新运行重新解析最新模型。脚本、上传和变量写回在本阶段显式拒绝；runtime beforeRequest 再验证获批方法/地址，独立 fileResolver 拒绝文件读取，禁止未经授权的重定向。手动与 MCP 保留原默认执行语义。

真实凭据仅用于本机网络，模型与本机计划/报告脱敏；剔除可绕过脱敏的响应 base64，补齐 URL userinfo、Basic 认证及回显保护。报告复用本机 plan 记录，重启可查看、可手动删除，不进入项目目录/Git。

通过真实计数目标验证无响应断连、HTTP 200 后部分 body 断连与取消均为远端结果未知。依赖库会将 close 合成 end，故使用局部 AsyncLocalStorage + Node diagnostics_channel 检查原始 HTTP parser/HTTP2 stream 完整性；观察缺失保守视为未知。正常 chunked、gzip、204、TLS HTTP2 与 auto 均有成功对照，无额外重发。

验证：

- TDD：首个执行命令缺失 → 草稿真实发送；模型生成取消 paused → interrupted；URL userinfo 泄露 → 脱敏；审批来源错误 → 正确草稿来源；200 部分响应误报成功 → unknown。测试均经真实应用命令、隔离 userData、真实存储/执行器与回环模型/目标，无业务 helper mock。
- `test:agent-execution`：Chat Completions / Responses 全部通过，涵盖依赖快照、真实凭据、回显脱敏、环境删除、未知依赖阻断、独立继续、脚本文件拒绝、模型/网络取消、响应指令无授权、不重放及 MCP enabled/project/execute/原重定向语义。
- `typecheck`、`build`、`test:agent-execution-ui` 通过；UI 验证范围展示、拒绝零请求、批准一次草稿请求、来源、本机报告和重启不重放。
- 合并最新集成后重跑双协议 execution/read-plan、agent-merge、agent-editor-lifecycle、documentation、client-sync、debug-runtime 均通过；早期 agent-plan-steps、agent-drafts 回归亦通过。并发验收 bundle 使用 ticket10 专用临时文件避免共享 node_modules 输出冲突。
- 实现提交 `e436042`，集成同步提交 `e58cdae`（包含 08 的真实草稿基线与 source 规则）；未 push。

11 续接事项记录在本机 `/tmp/kindra-builtin-agent-context/execution-hook-notes.md`：脚本沙箱桥的 ALS 传播、所有 started 子请求与响应完整性配对，以及既有 MCP `execute_api(save_response=true)` 派生写权限缺口。后者按协调决定由 11 修复；10 不开放 save_response 或其他写回参数。
