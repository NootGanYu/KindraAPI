# 11: 既有脚本、文件和变量授权

**What to build:** 计划透明呈现并授权既有请求脚本及其实际副作用。

**Blocked by:** [09 获批保存接口定义](09-save-api.md), [10 首次执行接口草稿与未知结果](10-execute-api.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 前后脚本、变量更新、额外请求和已配置文件上传纳入计划范围；新增/改脚本或扩目标/文件须重新确认。
- [x] 执行中变量可演进；获准差量写回检查冲突，环境删除或范围变化暂停。
- [x] 保存响应示例按实际参数同时检查执行和写入授权；未经 save 不正式保存。
- [x] 回环 HTTP、临时文件及真实执行器验证授权、请求计数和变量写回。


## Answer

已在同一计划/步骤契约内支持现有前后脚本、额外请求、已配置 binary/multipart 文件、运行变量演进及独立响应保存。UI 明确显示脚本摘要、上传路径/长度/哈希、额外方法/完整目标/最大次数、变量写回与响应保存范围；原始凭据仅用于本地实际请求，模型、计划、报告和响应快照继续脱敏。

执行复用原 Postman runtime。真实 beforeRequest 针对每次主请求、脚本子请求验证方法、URL、Host 与次数；运行变量可更新已批准目标的查询值，但不能扩大主机/路径/查询字段名。fileResolver 在运行库网络 hook 之前独立限制已获批普通文件路径、realpath 和内容哈希；发送使用固定文件快照，33 MiB 文件亦经真实上传验证。脚本、目标、文件配置变化及环境删除在发送前和执行结束时复查，暂停后续写回/保存。拒绝时同时中止整个 run、所有活动请求和脚本 host，无残留子请求继续发送。

运行变量在本轮内存共享，只有显式 writeVariables 授权才差量写回；先检查环境/全局全部变更键的原始基线，冲突保留人工值及无关修改，环境删除暂停。脚本断言失败保留失败状态并阻断变量提交与依赖保存，不能因为 HTTP 成功误报步骤成功。

响应保存由本地明确授权派生独立 save_api_response 步骤；模型 save_response=true 不会授予权限。该步骤依赖成功 2xx 执行，只保存所选真实响应示例的 raw/code/content_type，仍受字段文档和 revision 校验。其他 dirty 草稿、其他响应示例与未保存候选不落盘、不被标为已保存；Renderer 使用 saved_target 的真实正式基线保持 dirty。外部 MCP execute_api(save_response=true) 已在网络前要求 allow_execute 和 allow_write，普通执行与手动行为不变。

传输观察从每一个实际 started 请求开始配对原始响应，检查 HTTP parser/HTTP2 stream 的完整性及与获批请求次数一致。真实 sandbox pm.sendRequest 的无响应断连、200 部分 body 断连、活动子请求被范围拒绝中止均为 unknown；不自动重发，已结束计划不能重复批准。报告继续仅保存在本机 Agent 存储。

验证：

- 按已确认应用命令/事件 seam 做 TDD：真实脚本、计数 HTTP、临时文件和隔离 userData；额外请求拒绝、变量写回/冲突、文件变化、独立响应保存、环境最终检查、断言状态及较大上传均经过红绿验证。
- `test:agent-effects` 两协议通过；覆盖脚本登录、演进 bearer/query 认证、跨步骤变量、无隐式写回、环境删除、原始凭据脱敏、请求/Host/文件范围拒绝、并发资源中止、子请求断连、MCP 写授权，以及保留 dirty/candidate 的响应保存。
- `typecheck`、`build`、`test:agent-effects-ui`、`test:agent-execution-ui` 通过；Electron 验证显式范围、拒绝零请求、脚本/上传/变量/响应保存与重启不重放。
- 合并 12/14/15/17 后，双协议 execution/save/flow-draft/create/case-edit、documentation、client-sync、debug-runtime 回归通过；10 的 chunked/gzip/204/TLS HTTP2 完整性对照仍通过。
- 已同步最新集成 a24b1b9，提交包括 68bc00a、d91a026、2ad24eb、0b0b71d。未 push；本机 hook 证据和供 16/19 复用的 context/variables/responseOnly 接口说明在 `/tmp/kindra-builtin-agent-context/execution-hook-notes.md`。
