# REA IPC 取证

> 这一层补的是“控件 → 主进程 IPC”的运行期证据。REA 的 Electron 场景输出 IPC 时间线、窗口/进程与覆盖率，不产出截图；截图与 DOM/AX 由 Playwright 采集。

## 关键结论

| 操作 | 新增的 IPC 通道（相对打开接口基线） | 证据文件 |
| --- | --- | --- |
| 打开接口 | `target:read` | `baseline/rea/open-api.json` |
| 保存接口 | `target:save-checked`；主进程→渲染进程 `target:changed` | `baseline/rea/save-api.json` |
| 版本管理 | `target:versions:list` | `baseline/rea/versions.json` |
| 生成代码 | `target:codegen:curl` | `baseline/rea/codegen.json` |

所有场景共有的启动/加载 IPC：`project:list`、`project:ensureDefault`、`target:list`、`model:list`、`env:list`、`settings:get`、`app:paths`、`mcp:config:get`、`mcp:status`、`mcp:tools`。

## codegen

- 窗口：`file:///D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/out/renderer/index.html#/apis`
- 覆盖率：`partial_attach`；IPC 观测 14 条，丢弃 0 条

### 动作

| step_id | kind | status | elapsed_ms |
| --- | --- | --- | --- |
| `open-api` | click | completed | 878 |
| `settle` | wait | completed | 1210 |
| `more` | click | completed | 59 |
| `menu` | wait | completed | 408 |
| `code` | click | completed | 108 |
| `settle2` | wait | completed | 1413 |

### IPC 通道

| kind | channel | 次数 |
| --- | --- | --- |
| `main-handler-invocation` | `target:list` | 2 |
| `main-handler-invocation` | `model:list` | 2 |
| `main-handler-invocation` | `project:ensureDefault` | 1 |
| `main-handler-invocation` | `project:list` | 1 |
| `main-handler-invocation` | `env:list` | 1 |
| `main-handler-invocation` | `settings:get` | 1 |
| `main-handler-invocation` | `app:paths` | 1 |
| `main-handler-invocation` | `mcp:config:get` | 1 |
| `main-handler-invocation` | `mcp:status` | 1 |
| `main-handler-invocation` | `mcp:tools` | 1 |
| `main-handler-invocation` | `target:read` | 1 |
| `main-handler-invocation` | `target:codegen:curl` | 1 |

原始证据：[JSON](baseline/rea/codegen.json)

## open-api

- 窗口：`file:///D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/out/renderer/index.html#/apis`
- 覆盖率：`partial_attach`；IPC 观测 13 条，丢弃 0 条

### 动作

| step_id | kind | status | elapsed_ms |
| --- | --- | --- | --- |
| `open-api` | click | completed | 837 |
| `settle` | wait | completed | 1612 |

### IPC 通道

| kind | channel | 次数 |
| --- | --- | --- |
| `main-handler-invocation` | `target:list` | 2 |
| `main-handler-invocation` | `model:list` | 2 |
| `main-handler-invocation` | `project:ensureDefault` | 1 |
| `main-handler-invocation` | `project:list` | 1 |
| `main-handler-invocation` | `env:list` | 1 |
| `main-handler-invocation` | `settings:get` | 1 |
| `main-handler-invocation` | `app:paths` | 1 |
| `main-handler-invocation` | `mcp:config:get` | 1 |
| `main-handler-invocation` | `mcp:status` | 1 |
| `main-handler-invocation` | `mcp:tools` | 1 |
| `main-handler-invocation` | `target:read` | 1 |

原始证据：[JSON](baseline/rea/open-api.json)

## save-api

- 窗口：`file:///D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/out/renderer/index.html#/apis`
- 覆盖率：`partial_attach`；IPC 观测 17 条，丢弃 0 条

### 动作

| step_id | kind | status | elapsed_ms |
| --- | --- | --- | --- |
| `open-api` | click | completed | 862 |
| `settle` | wait | completed | 1213 |
| `save` | click | completed | 241 |
| `settle2` | wait | completed | 1416 |

### IPC 通道

| kind | channel | 次数 |
| --- | --- | --- |
| `main-handler-invocation` | `target:list` | 4 |
| `main-handler-invocation` | `model:list` | 2 |
| `main-handler-invocation` | `project:ensureDefault` | 1 |
| `main-handler-invocation` | `project:list` | 1 |
| `main-handler-invocation` | `env:list` | 1 |
| `main-handler-invocation` | `settings:get` | 1 |
| `main-handler-invocation` | `app:paths` | 1 |
| `main-handler-invocation` | `mcp:config:get` | 1 |
| `main-handler-invocation` | `mcp:status` | 1 |
| `main-handler-invocation` | `mcp:tools` | 1 |
| `main-handler-invocation` | `target:read` | 1 |
| `main-handler-invocation` | `target:save-checked` | 1 |
| `ipc-main-to-renderer` | `target:changed` | 1 |

原始证据：[JSON](baseline/rea/save-api.json)

## versions

- 窗口：`file:///D:/agent-workspace/963656544/KindraAPI/github/KindraAPI/out/renderer/index.html#/apis`
- 覆盖率：`partial_attach`；IPC 观测 14 条，丢弃 0 条

### 动作

| step_id | kind | status | elapsed_ms |
| --- | --- | --- | --- |
| `open-api` | click | completed | 812 |
| `settle` | wait | completed | 1216 |
| `more` | click | completed | 60 |
| `menu` | wait | completed | 404 |
| `versions` | click | completed | 118 |
| `settle2` | wait | completed | 1403 |

### IPC 通道

| kind | channel | 次数 |
| --- | --- | --- |
| `main-handler-invocation` | `target:list` | 2 |
| `main-handler-invocation` | `model:list` | 2 |
| `main-handler-invocation` | `project:ensureDefault` | 1 |
| `main-handler-invocation` | `project:list` | 1 |
| `main-handler-invocation` | `env:list` | 1 |
| `main-handler-invocation` | `settings:get` | 1 |
| `main-handler-invocation` | `app:paths` | 1 |
| `main-handler-invocation` | `mcp:config:get` | 1 |
| `main-handler-invocation` | `mcp:status` | 1 |
| `main-handler-invocation` | `mcp:tools` | 1 |
| `main-handler-invocation` | `target:read` | 1 |
| `main-handler-invocation` | `target:versions:list` | 1 |

原始证据：[JSON](baseline/rea/versions.json)

## 复现方式与限制

```bash
# REA 只传固定白名单环境变量，无法继承 KINDRAAPI_USER_DATA。
# 复现时临时把 out/main/index.js 的 userData 改成 ui-inventory/.user-data，跑完还原/重建。
npx -y rea-agents@6.7.0 capture-electron-scenario ui-inventory/tools/rea-scenarios/open-api.json --format json
```

REA 报告的限制：

- IPC payloads are represented by value shapes; payload values are never retained.
- IPC direction and sender/receiver identifiers are observed only where Electron exposes them at the hooked boundary.
- The runtime timeline records lifecycle, navigation, shell, permission, popup, download, protocol, preload, native-addon, process, and IPC events; activity before hook installation is unavailable.
- The preload and renderer process contexts are not instrumented by the main-process -r hook; preload configuration and contextBridge API-shape events are main-boundary observations, not proof of render
- Process metrics are an Electron API snapshot and do not prove hostile-local-user isolation.
- External shell opens, external navigation, permission grants, downloads, popup windows, updater relaunches, and OS integration are blocked and recorded by the active hook; other application filesystem
