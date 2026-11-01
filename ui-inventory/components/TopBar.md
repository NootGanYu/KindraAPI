# 组件：TopBar.tsx

- 源码：`src/renderer/src/components/TopBar.tsx`
- 行数：166
- 静态统计：JSX 28 / 提示 6 / 菜单 3 / Tooltip 2 / Placeholder 1 / IPC 1

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Dropdown` | — | — | `src/renderer/src/components/TopBar.tsx`:91 |
| `Tooltip` | 刷新项目 | title=刷新项目 | `src/renderer/src/components/TopBar.tsx`:110 |
| `Tooltip` | mcpStatus?.error ? `MCP：${mcpStatus.error}` : mcpStatus?.running ? `MCP 运行中 · ${mcpStatus.host}:${mc | title=mcpStatus?.error ? `MCP：${mcpStatus.error}` : mcpStatus?.running ? `MCP 运行中 · ${mcpStatus.host}:${mcpStatus.port}` : 'MCP 未启动' | `src/renderer/src/components/TopBar.tsx`:121 |
| `Modal` | 新建项目 | title=新建项目 open=projectModal okText=创建 cancelText=取消 | `src/renderer/src/components/TopBar.tsx`:143 |
| `Input` | 项目名称 | placeholder=项目名称 value=newName | `src/renderer/src/components/TopBar.tsx`:152 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/TopBar.tsx`:45 |
| `message.warning` | `请输入项目名称` | `src/renderer/src/components/TopBar.tsx`:52 |
| `message.success` | `项目已创建` | `src/renderer/src/components/TopBar.tsx`:59 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/TopBar.tsx`:61 |
| `message.info` | `导入项目将在后续里程碑支持` | `src/renderer/src/components/TopBar.tsx`:97 |
| `message.error` | `error.message` | `src/renderer/src/components/TopBar.tsx`:98 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `item.name` | `item.project_id` | `item.project_id === project?.project_id` | `src/renderer/src/components/TopBar.tsx`:66 |
| `新建项目` | `__new` | — | `src/renderer/src/components/TopBar.tsx`:72 |
| `导入项目（后续支持）` | `__import` | — | `src/renderer/src/components/TopBar.tsx`:73 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `刷新项目` | `src/renderer/src/components/TopBar.tsx`:110 |
| `mcpStatus?.error ? \`MCP：${mcpStatus.error}\` : mcpStatus?.running ? \`MCP 运行中 · ${mcpStatus.host}:${mc` | `src/renderer/src/components/TopBar.tsx`:121 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `项目名称` | `src/renderer/src/components/TopBar.tsx`:154 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.app.openPath` | `paths.projectRoot` | `src/renderer/src/components/TopBar.tsx`:33 |

> 返回 [组件索引](README.md)
