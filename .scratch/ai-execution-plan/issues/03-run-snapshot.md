# 03: 绑定环境的运行快照

**What to build:** 启动时从已保存定义构建本轮 Execution Snapshot，使界面和 MCP 的请求、脚本及变量使用同一环境。保持旧引擎接口，可通过注入快照解析实现，不依赖异步 Run handle。

**Blocked by:** 01: 共享 UI 与 MCP 运行入口

**Status:** resolved

- [x] Run 固定 Project、Environment、Server、Flow、API、继承、模型与脚本定义；两个环境的 loopback 地址与脚本变量一致。
- [x] API 和全局变量在运行中的普通编辑不悄悄改变本轮，下一轮使用已保存新定义。
- [x] 未保存草稿需用户主动保存；运行按钮不隐式保存。
- [x] 模型引用仅在运行上下文解析，不回写 API；普通编辑和单接口发送保持实时生成。
- [x] 初始变量复制到运行上下文，步骤提取 token 和对象 ID 可供后续步骤使用。
- [x] 界面区分运行版本和编辑版本，MCP 与 UI 均能使用快照执行。
- [x] 文件外部依赖记录摘要并在使用前核对，变更时阻止继续并提示审查。
- [x] 使用真实存储和 loopback 测试隔离、变量传递及旧流程兼容。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。

## Answer

已实现，核心提交 `e50558a`，并整合工单 02 的 Flow revision 和工单 04 的异步 Run。

- 公共运行入口启动时固定 Flow、选定 Environment/Server 和全部有效请求（API、继承默认值、模型生成结果、脚本、Cookie），请求执行器仅在普通单接口发送时继续实时读取。
- API 与 Flow 脚本共享本轮环境、全局和本地变量；运行输出不回写环境和全局定义。Postman script 回调保留 `pm.variables` 对象 ID，后续请求与 Flow 脚本可读取输出。
- `FlowRun.snapshot` 记录 Flow revision、环境、各请求内容签名与文件 SHA-256；异步启动即返回版本，UI 分别显示编辑版本和运行版本。04 提供主动保存提示，运行按钮不隐式保存。
- 文件使用前验证摘要，并从已核对字节创建流；变更/删除阻止当前和后续请求并提示审查。新 Run 重新捕获文件。

验收：`npm run test:flow-snapshot`（先复现环境错误和文件修改仍发送，再实现通过）覆盖真实临时存储、两个 loopback 环境、运行中 API/父目录/全局/模型修改、token/对象 ID 传递、MCP 下一轮使用新定义、模型不回写、文件阻止与新轮发送、异步初始版本。

兼容验收：`test:flow-entry`、`test:flow-definitions`、`test:flow-async`（含真实 TCP 断开及 20 秒上限）、node/web typecheck、build 全部通过。完整 smoke 的既有文档断言失败已由集成基线确认，不属于本票改动。
