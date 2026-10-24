# 08 · MCP 实现分析

> 目标：把 Apipost 单机版的 MCP 实现讲透，便于你复刻一个「让 AI Agent 直接读写项目、执行接口与业务流程」的能力。

---

## 1. 一句话架构

```
AI 客户端 (Cursor / Claude Code / VSCode / Trae / Codex ...)
   │  stdio (JSON-RPC 2.0，逐行)
   ▼
mcp-stdio.js   —— 独立 Node 进程，只做协议适配
   │  TCP 127.0.0.1:<随机端口>，每行一个 JSON
   ▼
mcpService.js  —— Electron 主进程内的 TCP 服务 + token 校验
   │  IPC: webContents.send("mcp:request")
   ▼
Renderer 1550 chunk —— 真正的业务实现（读写本地数据、调用执行引擎）
   │
   ├─ fileDB  → 项目 JSON / executions/*
   └─ /proxy/v2/http → 请求执行引擎（postman-runtime）
```

关键设计：**MCP 进程不直接读文件**。它只把工具调用转成一条带 token 的 TCP 请求，
由已经打开的 Electron 应用在渲染层执行。这样：

- 文件锁、写队列、授权、执行引擎都复用应用现有实现；
- AI 不需要知道内部存储格式；
- 应用没打开时 MCP 会明确报错，而不是并发写坏数据。

---

## 2. 组件职责

### 2.1 `utils/mcp-stdio.js`（stdio MCP Server）

- 由 AI 客户端启动，`ELECTRON_RUN_AS_NODE=1` 让 Electron 可执行文件以 Node 模式运行。
- 参数：`--config <userData>/offline-data-local/settings/mcp_config.json`。
- 只实现 MCP 最小协议：
  - `initialize` → 返回 `protocolVersion`（回显客户端版本，默认 `2024-11-05`）、`capabilities.tools.listChanged=false`、`serverInfo {name:"apipost-offline", version:"1.0.0"}`。
  - `tools/list` → 返回静态工具清单（30 个）。
  - `tools/call` → 转发到主进程，把结果包成 `content:[{type:"text", text: JSON.stringify(result,null,2)}]`。
  - 其他方法 → `-32601 Method not found`。
- 没有实现 `resources` / `prompts` / `notifications`。
- 每次工具调用都**重新读取配置文件**（因此主进程改端口/token 后，下一次调用立即生效）。
- 与主进程的桥接协议：
  - 连接 `127.0.0.1:<config.port>`
  - 发送一行：`{"token":"...","method":"apipost_xxx","params":{...}}\n`
  - 读取一行：`{...结果...}` 或 `{"error":"..."}`。
- 超时：socket `120000ms`；错误直接作为 `isError:true` 的文本返回。

### 2.2 `utils/mcpService.js`（主进程桥）

- 配置路径：`<userData>/offline-data-local/settings/mcp_config.json`。
- 默认配置：

```json
{
  "enabled": false,
  "allow_write": false,
  "allow_execute": false,
  "allowed_project_ids": [],
  "token": "<24 字节随机数的 base64url>",
  "port": 0,
  "last_connected_at": "",
  "updated_at": "ISO 时间"
}
```

- `start()`：`net.createServer` 监听 `127.0.0.1:0`（随机端口），把实际端口写回配置。
- `handleSocket`：按 `\n` 拆行、逐行解析、逐行响应（简单的行协议，不是 JSON-RPC）。
- `handleBridgeLine`：
  - 校验 `enabled` 与 `token`；
  - 更新 `last_connected_at`；
  - 调 `forwardToRenderer(method, params)`。
- `forwardToRenderer`：
  - 生成 `requestId = uuid()`；
  - `webContents.send("mcp:request", {requestId, method, params})`；
  - 等待渲染层 `mcp:response`，超时 120 秒。
- IPC：
  - `mcp:getConfig` → `publicConfig()`（**不返回 token**，只返回 `has_token`）
  - `mcp:updateConfig` → 启停 + 写权限 + 项目白名单
  - `mcp:regenerateToken` → 换新 token
  - `mcp:getClientConfig` → 生成各客户端配置片段
  - `mcp:response` → 渲染层回包
- `getClientConfig()` 生成 6 种客户端配置：

| 客户端 | 格式 |
|---|---|
| Cursor | `{"mcpServers":{"apipost-offline":{"command":...,"args":[...],"env":{"ELECTRON_RUN_AS_NODE":"1"}}}}` |
| Claude Code | 同上 |
| VSCode | `{"servers":{"apipost-offline":{"type":"stdio",...}}}` |
| WorkBuddy | 同 Cursor |
| Trae | 同 Cursor |
| Codex | `[mcp_servers.apipost-offline]` TOML |

`command` = `process.execPath`（Electron 可执行文件），`args = [mcp-stdio.js, "--config", configPath]`。

### 2.3 Renderer `1550` chunk（业务实现）

- 应用外壳挂载时注册一次：

```js
window.app.mcp.onRequest(async (req) => {
  try {
    const result = await dispatch(req); // 30 个对外工具 + draft 分支（共 31 支）
    window.app.mcp.respond({ requestId: req.requestId, result });
  } catch (e) {
    window.app.mcp.respond({ requestId: req.requestId, error: e.message });
  }
});
```

- 写操作串行化：`si(fn) = (chain = chain.then(fn, fn))`，避免并发写文件。
- 执行完成后派发事件：
  - `apipost:mcp-execution-activity`（正在执行/完成/失败）
  - `apipost:execution-runs-changed`
  - `apipost:execution-flows-changed`
  - `apipost:mcp-sync-completed`（OpenAPI 同步有变更时）
  - `apipost:mcp-config-changed`

---

## 3. 权限模型（三层）

每个工具在进入业务逻辑前都会走 `xr(projectId, needWrite, needExecute)`：

| 检查 | 条件 | 错误信息 |
|---|---|---|
| MCP 开关 | `enabled === true` | `Apipost MCP 未启用` |
| 项目白名单 | `allowed_project_ids.includes(projectId)` | `该项目未授权给 MCP 访问` |
| 写权限 | 需要写时 `allow_write === true` | `Apipost MCP 未开启写入权限` |
| 执行权限 | 需要执行时 `allow_execute === true` | `Apipost MCP 未开启接口执行权限` |

创建项目例外：走 `_r()`，只要求 `enabled + allow_write`（还没有 project_id）。
新建项目成功后，会**自动把新项目加入 allowed_project_ids**。

### 3.1 各工具权限要求

| 工具组 | enabled | write | execute |
|---|---|---|---|
| `list_projects` / `list_apis` / `get_api_detail` / `list_environments` / `switch_environment` / `list_environment_servers` / `get_environment_variables` / `get_global_variables` / `list_execution_flows` / `get_execution_flow` / `list_execution_runs` / `get_execution_result` | ✓ | | |
| `sync_openapi` / `delete_apis` / 环境增删改 / 服务增删改 / 变量增删改 / **`delete_execution_flow`** / `create_project` | ✓ | ✓ | |
| `execute_api` / `execute_flow` / **`create_execution_flow` / `update_execution_flow`** | ✓ | | ✓ |

> 【事实】流程的三个写操作权限并不一致：
> `create/update_execution_flow` 只检查 `allow_execute`（不查 write），
> 而 `delete_execution_flow` 检查 `allow_write`（不查 execute）。
> 旧版把“流程增删改”整体放在 write 行、又把 create/update 放进 execute 行，
> 自相矛盾，已按源码拆开。复刻时建议统一为 `write + execute`。

---

## 4. 工具清单（30 个）

### 4.1 项目

| 工具 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `apipost_list_projects` | 无 | `{projects:[{project_id,name,intro}]}` | 只返回已授权项目 |
| `apipost_create_project` | `name`(≤64), `description`(≤1024), `storage_path?` | `{project_id,name,description,storage_path,authorized}` | 自动授权；不切换当前 UI 项目 |

### 4.2 接口

| 工具 | 入参 | 返回 |
|---|---|---|
| `apipost_list_apis` | `project_id`, `parent_id?`, `keyword?` | `{apis:[{target_id,parent_id,target_type,name,method,url,sort}]}` |
| `apipost_get_api_detail` | `project_id`, `target_id` | `{api:{...完整实体, builtin_pre_scripts, builtin_post_scripts}}` |
| `apipost_sync_openapi` | `project_id`, `openapi`, `folder_id?`, `api_cover_mode?`, `base_path?`, `host_path?`, `api_scripts?` | `{project_id,folder_id,api_cover_mode,created,updated,skipped,deleted,sync_items}` |
| `apipost_delete_apis` | `project_id`, `target_ids[]`, `confirm:true` | `{project_id,deleted,target_ids}`；`deleted` 是请求删除数，不保证全部已删 |

`get_api_detail` 的 `builtin_pre_scripts` / `builtin_post_scripts`：
从接口 `request.pre_tasks` / `post_tasks` 中提取 `type === "customScript" && enabled !== -1` 的 `data` 字符串。

### 4.3 执行

| 工具 | 入参 | 返回 |
|---|---|---|
| `apipost_execute_api` | `project_id`, `target_id`, `environment_id?`, `input?` | `{run_id,project_id,status,scope,elapsed_ms,total,passed,failed[]}` |
| `apipost_list_execution_runs` | `project_id`, `scope?`, `source?`, `status?`, `flow_id?`, `limit?`(1~50，默认 20) | `{total,records:[摘要]}` |
| `apipost_get_execution_result` | `project_id`, `run_id` | `{run: 完整执行记录}` |

`input` 支持 `query / path / headers / cookies / body / auth`。
**只能覆盖接口已定义的参数**，不能传 URL 或 curl。

### 4.4 业务流程

| 工具 | 入参 | 返回 |
|---|---|---|
| `apipost_create_execution_flow` | `project_id`, `name`, `description?`, `environment_id?`, `steps[]` | `{flow_id,name,message}` |
| `apipost_update_execution_flow` | `project_id`, `flow_id`, `name?`, `description?`, `environment_id?`, `steps?` | `{flow_id,name,message}` |
| `apipost_list_execution_flows` | `project_id` | `{flows:[摘要]}` |
| `apipost_get_execution_flow` | `project_id`, `flow_id` | `{flow: 完整计划 + mcp_name/mcp_description/mcp_environment_id}` |
| `apipost_delete_execution_flow` | `project_id`, `flow_id`, `confirm:true` | `{deleted,flow_id}` |
| `apipost_execute_flow` | `project_id`, `flow_id`, `environment_id?` | 同 `execute_api` 的摘要 |

> 另有 `apipost_create_execution_flow_draft`：渲染层分发 switch 中有分支，
> 但 **stdio 工具清单未暴露**，因此不计入对外 30 个工具。

> 【事实】流程保存时还会额外写入
> `mcp_name / mcp_description / mcp_environment_id`，并删除
> `status / ignored_differences`（`analysis/pretty/mcp-exec.js:1378`）。
> UI 用这些字段判断“MCP 是否改过流程”，复刻时不要漏。

`steps[]` 每项：

```json
{
  "step_id": "更新已有步骤时传入；新增不传",
  "target_id": "当前项目中的 HTTP 接口",
  "input": { "query": {}, "path": {}, "headers": {}, "cookies": {}, "body": {}, "auth": {} },
  "pre_script": "可选 JS",
  "post_script": "可选 JS"
}
```

### 4.5 环境

| 工具 | 入参 | 返回 |
|---|---|---|
| `apipost_list_environments` | `project_id` | `{current_env_id, environments:[{env_id,name,is_current,base_url}]}` |
| `apipost_switch_environment` | `project_id`, `environment_id` | `{current_env_id,name}` |
| `apipost_create_environment` | `project_id`, `name`, `base_url?` | `{environment}` |
| `apipost_update_environment` | `project_id`, `environment_id`, `name?`, `base_url?` | `{environment}` |
| `apipost_delete_environment` | `project_id`, `environment_id`, `confirm:true` | `{deleted}` |
| `apipost_list_environment_servers` | `project_id`, `environment_id?` | `{environment_id,servers:[...]}` |
| `apipost_create_environment_server` | `project_id`, `name`, `environment_id?`, `base_url?` | 服务 |
| `apipost_update_environment_server` | `project_id`, `server_id`, `name?`, `environment_id?`, `base_url?` | 服务 |
| `apipost_delete_environment_server` | `project_id`, `server_id`, `confirm:true` | `{deleted}` |

环境行为细节：

- `base_url` 实际写入 `server_list` 中 `server_id === "1"` 的 `uri`。
- 【事实】**执行**时未传 `environment_id` 的默认环境：直接取全局
  `envDetailKeys`，**不读** `preferenceEnv[projectId]`
  （`analysis/pretty/mcp-exec.js:1073`）。因此跨项目调用时可能沿用 UI
  当前打开项目的环境，存在取错环境的风险。
- **UI 切换/展示**时的解析顺序：
  1. 若项目是 UI 当前项目 → `envDetailKeys`
  2. 否则 → `preferenceEnv[projectId]`
  3. 否则 → 第一个环境
- 切换环境会：
  - 若项目正在 UI 中打开 → 同步更新 `envDetailKeys`
  - 记录 `preferenceEnv[projectId]`，供下次打开使用
  - 不影响已保存执行计划的 `environment_id`

### 4.6 变量

| 工具 | 入参 | 返回 |
|---|---|---|
| `apipost_get_environment_variables` | `project_id`, `environment_id` | `{environment_id,variables:[{key,value,current_value,description}]}` |
| `apipost_upsert_environment_variable` | `project_id`, `environment_id`, `key`, `value?`, `current_value?`, `description?` | `{variable}` |
| `apipost_delete_environment_variable` | `project_id`, `environment_id`, `key`, `confirm:true` | `{deleted}` |
| `apipost_get_global_variables` | `project_id` | `{variables:[...]}` |
| `apipost_upsert_global_variable` | `project_id`, `key`, `value?`, `current_value?`, `description?` | `{variable}` |
| `apipost_delete_global_variable` | `project_id`, `key`, `confirm:true` | `{deleted}` |

变量是**双存储**：

- `value`：默认值（环境/全局变量定义）
- `current_value`：运行时值（执行时脚本写入的值）

读取时合并两者，返回 `value + current_value`；写入时同时更新两处。

---

## 5. 执行实现（最关键）

### 5.1 `apipost_execute_api`

```
权限检查
  → qe._T({
      project_id, target_ids:[target_id],
      environment_id?, source:"mcp", scope:"api",
      inputs: { [target_id]: input }
    })
  → 返回 run 记录
  → Er(run) 生成摘要
```

### 5.2 `apipost_execute_flow`

```
权限检查
  → qe.v6(project, flow_id) 取流程
  → 校验 steps 的 api_snapshot 都存在且属于当前项目的 HTTP 接口
  → 加运行锁 P.add("project:flow")
  → qe.M8 / _e 串行执行
       for each step:
         re(project, target_id, input, env_id, {pre_script,post_script}, api_snapshot, isFlow=true, step_id)
  → finally 释放锁
```

**运行锁**：同一项目同一流程不能并发执行；执行中不能修改/删除流程。

### 5.3 单步执行 `re(...)`

```
1. 取接口实体（优先用传入的 api_snapshot）
   若没有或 project 不匹配 → 从本地重新读取
2. 校验 target_type === "api"（一期只支持 HTTP）
3. B(api, input)：应用参数覆盖
4. 若 isFlow：清空接口自带 pre_tasks / post_tasks（业务流忽略 builtin 脚本）
5. 追加步骤级 pre_script / post_script 为 customScript
6. BK(api, envId)：构建执行参数
     - 注入系统请求头
     - 组装 collection（含目录继承）
     - 解析环境/全局变量/数据库配置
     - 生成 { option, test_events:[{type:"api",data:{...}}] }
7. kY(params)：POST /proxy/v2/http（即 postman-runtime）
8. GF(...)：把运行时结果整理成 UI 兼容结构（request/response/assertions/console/...）
9. 判定：
     - error 存在 → failed
     - 任一断言 !passed && !skipped → failed
     - 状态码 !== 200 → failed（错误信息：接口返回状态码 X，期望 200）
     - 否则 passed
10. 返回步骤记录（敏感字段打码）
```

### 5.4 参数覆盖规则 `B(api, input)`

| 覆盖项 | 规则 |
|---|---|
| `query` | 按 `key` 匹配接口已定义参数，只改已存在的项；未知 key 忽略；**接口没有 `query.parameter` 组时直接抛错** |
| `path` | 同上（restful 参数） |
| `headers` | 同上 |
| `cookies` | 同上 |
| `body` | 输入不是 JSON 对象且接口 `body` 带 `parameter` 组 → 按 key 覆盖已有 parameter（源码判定 `mode !== "json" && body.parameter`，不存在 `parameter` 模式）；`mode=json` → 整体替换 `raw` 为 `JSON.stringify(input.body, null, 2)`；`xml/javascript/plain/html` → 只接受字符串替换 `raw`；`mode=none` **仅在传了 body 时**报错 |
| `auth` | 整体替换 `request.auth` |

> 重要：覆盖不会新增参数，也不会删除参数；必须是接口里已经定义的 key。
> 参数组缺失不是“静默忽略”，而是抛错（`analysis/pretty/mcp-exec.js:232`）。
> 业务流步骤快照保存的是「执行时固化」的接口副本，后续修改 APIs 不会自动影响已保存步骤。

### 5.5 结果摘要 `Er(run)`

```json
{
  "run_id": "...",
  "project_id": "...",
  "status": "passed | failed",
  "scope": "api | flow",
  "elapsed_ms": 123,
  "total": 3,
  "passed": 2,
  "failed": [
    {
      "step_id": "...",
      "target_id": "...",
      "name": "...",
      "method": "POST",
      "url": "...",
      "status_code": 500,
      "error": "步骤自身的 error；为空时统一为 '断言失败'"
    }
  ]
}
```

完整结果用 `apipost_get_execution_result` 取。

---

## 6. MCP 新增的本地存储

### 6.1 执行记录（runs）

```
<project>/executions/
├── runs/
│   ├── index.json          # { version:2, updated_at, records:[summary...] }
│   └── <run_id>.json       # 完整 run
└── index.json              # 旧版索引（写入时删除）
```

- 最多保留 **50** 条；超出时删除最旧的详情文件。
- `records[]` 摘要包含 `detail_file` 指向详情。
- 删除单条：`ue`（删索引项 + 详情文件）。
- 清空：`se`（删所有详情 + 重置索引）。
- 【事实】并发写入不安全：`_T` 未串行化，`te` 对 `index.json` 做
  “读-改-写”（`analysis/pretty/mcp-exec.js:1242`），两个执行同时完成时
  可能丢记录。运行锁只保护 `project:flow`，不保护 run 索引。
  复刻时应给索引加真正的串行/文件锁。

完整 run：

```json
{
  "run_id": "run_175..._ab12cd34",
  "project_id": "...",
  "source": "mcp | manual",
  "scope": "api | flow",
  "target_ids": ["..."],
  "flow_id": "...",
  "flow_name": "...",
  "environment_id": "1",
  "status": "passed | failed",
  "started_at": "ISO",
  "finished_at": "ISO",
  "elapsed_ms": 1234,
  "steps": [
    {
      "step_id": "...",
      "target_id": "...",
      "name": "...",
      "method": "POST",
      "url": "...",
      "status": "passed | failed",
      "status_code": 200,
      "network_elapsed_ms": 120,
      "elapsed_ms": 150,
      "input": {},
      "request": { "...": "..." },
      "response": { "...": "..." },
      "auth": {},
      "cookies": [],
      "body_mode": "json",
      "body_binary": { "file_name": "...", "file_path": "..." },
      "assertions": [],
      "console": [],
      "variables": { "environment": {}, "globals": {} },
      "error": null
    }
  ]
}
```

### 6.2 业务流程（flows）

```
<project>/executions/flows/
├── index.json          # { version:2, updated_at, records:[summary...] }
└── <flow_id>.json      # 完整流程
```

流程详情：

```json
{
  "flow_id": "flow_175..._xy12",
  "project_id": "...",
  "name": "...",
  "description": "...",
  "environment_id": "1",
  "source": "mcp",
  "created_at": "ISO",
  "updated_at": "ISO",
  "steps": [
    {
      "step_id": "mcp_flow_step_...",
      "target_id": "...",
      "input": { "query": {...}, "body": {...} },
      "mcp_input": { "body": { "onlyChangedKeys": true } },
      "mcp_deleted_body_keys": ["oldKey"],
      "pre_script": "...",
      "post_script": "...",
      "api_snapshot": { "完整接口实体副本" }
    }
  ]
}
```

流程索引摘要：

```json
{
  "flow_id": "...",
  "project_id": "...",
  "name": "...",
  "description": "...",
  "environment_id": "...",
  "source": "mcp",
  "step_count": 3,
  "created_at": "ISO",
  "updated_at": "ISO"
}
```

### 6.3 步骤快照语义

- 新增步骤：`api_snapshot = cloneDeep(最新接口实体)`。
- 更新已有步骤：保留原 `api_snapshot`；可以改 `input` / 脚本；**不能改 `target_id`**。
- 想换接口：删除步骤后重新添加。
- JSON body 的特殊处理：
  - 若接口 body 是 json 且未传 `input.body`，会把 `api_snapshot.request.body.raw` 解析后放入 `input.body`（作为默认值参考）。
  - 若传了 `input.body`，只保存与快照默认值**不同的 key** 到 `mcp_input.body`，并记录被删除的 key 到 `mcp_deleted_body_keys`。
  - 执行时：`input.body` 会完整替换 raw，不做 merge。

### 6.4 敏感字段打码

写入 run 记录前，对 `input / auth / cookies / assertions / console / response` 等做递归打码：

```
key 匹配 /authorization|cookie|token|secret|password|api[-_]?key/i → 值替换为 "***"
```

> 【事实】打码**不完整**，存在敏感信息落盘/入 git 风险：
>
> - `request` **完全没有过打码函数**（`analysis/pretty/mcp-exec.js:875`），
>   Authorization / Cookie 会原样写入 run 文件。
> - `variables` 也没有打码（`:911`）。
> - 打码只按 key 名匹配；`{key,value}` 数组的值不会被命中，
>   `body_binary`、`arrCookies` 同样可能漏。
>
> 复刻时至少要对 `request.headers`、`variables`、二进制引用和
> `{key,value}` 结构做值级/结构级脱敏。

---

## 7. OpenAPI 同步（`apipost_sync_openapi`）

### 7.1 入参

```json
{
  "project_id": "...",
  "openapi": { "openapi": "3.0.0", "paths": {...}, "components": {...} },
  "folder_id": "0",
  "api_cover_mode": "url_and_folder | url | ignore | both | clear",
  "base_path": true,
  "host_path": false,
  "api_scripts": [
    { "method": "POST", "url": "/login", "pre_script": "...", "post_script": "..." }
  ]
}
```

### 7.2 行为

- 只支持 OpenAPI 3（3.0 / 3.1）JSON；不是 YAML。
- `folder_id` 必须是项目内已存在的目录；默认根目录 `"0"`。
- 覆盖模式：
  - `url_and_folder`：按 method + url + 目录覆盖（默认）
  - `url`：按 method + url 覆盖
  - `ignore`：跳过相同 method + url
  - `both`：保留两份
  - `clear`：清空后导入（指定目录时只清空该目录内容，保留目录本身；未指定时**只清空接口/目录树**，不删数据模型、环境、变量——旧版写“整个项目”是错的）
- 数据模型按名称匹配更新；`$ref` 会重写为新的 `model_id`。
- 可选 `api_scripts[]`：按 method + url 给导入的接口附加前后置脚本。
- 返回 `sync_items[]`，每项可能带 `sync_status`，前端据此提示冲突/变更。

---

## 8. UI 侧集成

MCP 配置页（在主窗口设置中）提供：

- 启用开关 `enabled`
- 写入权限 `allow_write`
- 执行权限 `allow_execute`
- 项目授权列表（多选）
- 重新生成 Token
- 客户端配置片段（Cursor / Claude Code / VSCode / WorkBuddy / Trae / Codex）一键复制
- 显示运行中的 MCP 执行活动（`apipost:mcp-execution-activity`）

渲染层监听 `mcp:request` 的位置：应用外壳挂载时注册一次，生命周期与应用一致。

---

## 9. 安全评估

### 9.1 做得好的地方

1. **默认关闭**，且需要显式 token。
2. **只监听 127.0.0.1**，不接受外部网络连接。
3. **三层权限**：开关 / 项目白名单 / 写/执行权限。
4. **删除类操作强制 `confirm: true`**。
5. **运行锁**：同一流程不能并发执行，执行中不能改/删。
6. **结果脱敏（部分）**：只按 key 名打码，`request` / `variables` /
   `{key,value}` 数组未覆盖，不能视为完整脱敏。
7. **应用未打开时无法执行**：桥接失败通常是 `ECONNREFUSED`，不是显式的
   “拒绝执行”错误；但确实避免了并发写文件。
8. **120 秒超时**：只结束等待，服务端流程不会因此中止，也没有
   `notifications/cancelled`。

### 9.2 需要注意的点（复刻时应改进）

1. **token 明文存储**在 `mcp_config.json`，且 stdio 进程每次读取。
   - 建议：OS Keychain / 加密存储；或至少文件权限 0600。
2. **stdio → 主进程的桥是明文 TCP**。
   - 回环地址风险较低，但仍可能被本机其他进程嗅探/连接（有 token 保护）。
   - 建议：Unix Domain Socket + 0600 权限。
3. **stdio 不校验调用方身份**，任何能启动该命令的本地程序都能读配置并连接。
4. **配置每次调用重读**：换 token 后，正在运行的客户端会立即失败，需要重新加载配置。
5. **`create_execution_flow` / `update_execution_flow` 只检查 `allow_execute`**，不检查 `allow_write`；复刻时建议要求 `write + execute`。
6. **响应体/文件路径**：`get_execution_result` 可能返回二进制流引用；注意大响应落盘与访问控制。
7. **AI 误操作**：`clear` 模式会清空接口/目录树（不含模型/环境），
   且**不需要 `confirm`**（`analysis/pretty/mcp-renderer.js:4545-4565`）。
   复刻时必须加二次确认或限制 `allow_write`。
8. **并发写 run 索引**：`te` 的读-改-写没有锁，可能丢记录（见 6.1）。

---

## 10. 复刻方案

### 10.1 推荐架构（更简单）

你不需要照搬「stdio → TCP → IPC → 渲染层」的四段式。两种可选：

**方案 A：单进程 MCP + 直接读文件（推荐用于自研）**

```
MCP stdio server (Node)
  ├─ 读取 <project>/*.json（加文件锁）
  ├─ 调用你的请求执行模块（直接 require）
  └─ 写入 executions/*
```

优点：链路短、无 UI 依赖、可 headless 运行。
缺点：需要自己处理文件锁与「应用同时打开」的并发。

**方案 B：双进程 + 本地 RPC（与 Apipost 一致）**

```
MCP stdio ↔ 本地 socket ↔ 桌面应用主进程 → 业务层
```

优点：复用应用状态与执行引擎，行为一致。
缺点：应用必须打开，链路复杂。

### 10.2 最小工具集（11 个，旧版标题误写 10）

1. `list_projects`
2. `list_apis`
3. `get_api_detail`
4. `execute_api`
5. `get_execution_result`
6. `list_execution_runs`
7. `list_environments`
8. `get_environment_variables`
9. `upsert_environment_variable`
10. `create_execution_flow` + `execute_flow`（业务流核心）

先不做 OpenAPI 同步、项目管理、服务管理。

### 10.3 工具实现模板

```ts
server.tool(
  "execute_api",
  { project_id: z.string(), target_id: z.string(), environment_id: z.string().optional(), input: z.object({...}).optional() },
  async (args) => {
    await assertPermission(args.project_id, { execute: true });
    const run = await executeTargets({
      projectId: args.project_id,
      targets: [{ targetId: args.target_id, input: args.input || {} }],
      environmentId: args.environment_id,
      source: "mcp",
    });
    return jsonContent(summarizeRun(run));
  }
);
```

### 10.4 安全清单

- [ ] 默认关闭，显式启用
- [ ] token / 密钥存 Keychain，文件 0600
- [ ] 仅回环监听（或 Unix Socket）
- [ ] 项目白名单
- [ ] 写/执行分离授权
- [ ] 删除/清空必须 `confirm:true`
- [ ] 结果敏感字段打码
- [ ] 运行锁 + 超时
- [ ] 大响应落盘 + 访问控制
- [ ] 审计日志（谁、何时、对哪个项目、执行了什么）

---

## 11. 关键坑

| 坑 | 说明 | 建议 |
|---|---|---|
| 应用必须打开 | 渲染层实现业务，应用关闭时 MCP 不可用 | headless 方案可直接读文件 |
| 端口每次变化 | `listen(0)` 随机端口，写入配置 | stdio 每次重读配置 |
| token 轮换 | 正在运行的客户端不会自动刷新 | 重连或重启 MCP 客户端 |
| 120 秒超时 | 长流程可能超时 | 异步 run + 轮询结果，或提高超时 |
| 快照不更新 | 流程步骤固化 `api_snapshot` | 明确告知用户；提供「刷新快照」工具 |
| body 覆盖是全量替换 | 不是 merge | 文档写清楚；或提供 patch 语义 |
| 参数覆盖不新增 | 只改已定义 key | 避免 AI 幻觉参数 |
| 状态码判定 200 | 只认 200，201/204 也失败 | 复刻时改成 2xx |
| 断言失败即失败 | 任一断言失败整体 failed | 与产品确认 |
| 主进程/渲染层并发写 | 只有配置写走 `si` 串行；run 索引仍是读-改-写 | 复刻必须给索引加锁 |
| 配置明文 token | 本机其他程序可读 | Keychain / 0600 |
| 敏感字段打码不完整 | 只按 key 名匹配 | 结合值模式（Bearer、AK/SK） |

---

## 12. 复刻验收标准

1. AI 能列出授权项目、接口、环境。
2. AI 能按 `target_id` 执行接口，并拿到 `run_id`。
3. AI 能读取执行结果，看到 request/response/assertions/console。
4. AI 能创建含 3 个步骤的业务流：登录 → 提取 token → 查询并断言。
5. 未授权项目、未开写/执行权限时，工具明确报错。
6. 删除类操作必须 `confirm:true`；**复刻时 `clear` 也要加确认**
   （原应用没有）。
7. 同一流程并发执行被拒绝。
8. 敏感 key 在结果中替换为 `***`；**复刻时还要覆盖原应用漏掉的**
   `request`、`variables`、`{key,value}` 数组与二进制引用。
9. 应用重启后，历史执行记录与流程仍在。
10. 配置 token 轮换后，旧客户端立即失效。

---

## 13. 证据索引

| 结论 | 证据 |
|---|---|
| stdio JSON-RPC + tools/list/call | `utils/mcp-stdio.js` |
| TCP 桥 + token + 120s | `utils/mcpService.js` |
| 配置字段与客户端片段 | `mcpService.js` 的 `config` / `getClientConfig` |
| 30 个工具定义 | `mcp-stdio.js` 的 `tools` 数组 |
| 权限检查 | `analysis/pretty/mcp-renderer.js` 的 `xr` / `_r` |
| 工具分发（31 支） | `mcp-renderer.js` 的 `ui`（switch） |
| 执行引擎 | `analysis/pretty/mcp-exec.js` |
| 运行/流程存储 | `executions/runs`、`executions/flows` 常量与 `te` / `pe` |
| run 索引读-改-写 | `analysis/pretty/mcp-exec.js:1242` |
| 流程保存字段/删除字段 | `analysis/pretty/mcp-exec.js:1378` |
| 参数覆盖抛错 | `analysis/pretty/mcp-exec.js:232` |
| 执行默认环境取 `envDetailKeys` | `analysis/pretty/mcp-exec.js:1073` |
| `request` 未打码 | `analysis/pretty/mcp-exec.js:875` |
| `variables` 未打码 | `analysis/pretty/mcp-exec.js:911` |
| 流程 create/update 走 execute | `analysis/pretty/mcp-renderer.js:5982/6063` |
| 流程 delete 走 write | `analysis/pretty/mcp-renderer.js:7384` |
| clear 无需 confirm | `analysis/pretty/mcp-renderer.js:4545-4565` |
| OpenAPI 同步 | `wr` 函数 |
| 环境/变量语义 | `Fr` / `Vr` / `Wr` / `Yr` |

未确认：`$ref` 重写的逐行实现、`GF` 产出的完整结构、响应二进制落盘字段、
`M8` 是否检查 run 状态（目前只看到运行锁）。
