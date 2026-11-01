# 组件：DocShareLinkDialog.tsx

- 源码：`src/renderer/src/components/DocShareLinkDialog.tsx`
- 行数：117
- 静态统计：JSX 17 / 提示 4 / 菜单 0 / Tooltip 0 / Placeholder 0 / IPC 4

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Modal` | share ? ( <div className="docs-link-box"> <div className="docs-link-name">{share.name}</div> {status | title=分享链接 open=Boolean(share) | `src/renderer/src/components/DocShareLinkDialog.tsx`:52 |
| `Button` | 关闭 | — | `src/renderer/src/components/DocShareLinkDialog.tsx`:56 |
| `Alert` | — | type=warning message=status.error \|\| '分享服务未启动，链接暂时无法访问' | `src/renderer/src/components/DocShareLinkDialog.tsx`:63 |
| `Input` | — | value=url | `src/renderer/src/components/DocShareLinkDialog.tsx`:70 |
| `Button` | 打开链接 | type=primary disabled=!url | `src/renderer/src/components/DocShareLinkDialog.tsx`:80 |
| `Button` | Markdown | disabled=!url | `src/renderer/src/components/DocShareLinkDialog.tsx`:88 |
| `Button` | HTML | disabled=!url | `src/renderer/src/components/DocShareLinkDialog.tsx`:95 |
| `Button` | OpenAPI | disabled=!url | `src/renderer/src/components/DocShareLinkDialog.tsx`:103 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 关闭 |  | `src/renderer/src/components/DocShareLinkDialog.tsx`:56 |
| Button | 打开链接 | type=primary disabled=!url | `src/renderer/src/components/DocShareLinkDialog.tsx`:80 |
| Button | Markdown | disabled=!url | `src/renderer/src/components/DocShareLinkDialog.tsx`:88 |
| Button | HTML | disabled=!url | `src/renderer/src/components/DocShareLinkDialog.tsx`:95 |
| Button | OpenAPI | disabled=!url | `src/renderer/src/components/DocShareLinkDialog.tsx`:103 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.success` | `链接已复制` | `src/renderer/src/components/DocShareLinkDialog.tsx`:37 |
| `message.error` | `result.error` | `src/renderer/src/components/DocShareLinkDialog.tsx`:38 |
| `message.warning` | `分享服务未启动，请先在「分享服务」中启用` | `src/renderer/src/components/DocShareLinkDialog.tsx`:44 |
| `message.error` | `result.error` | `src/renderer/src/components/DocShareLinkDialog.tsx`:48 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.docs.serviceStatus().then` | `(result) => { if (alive && result.ok) setStatus(result.data) }` | `src/renderer/src/components/DocShareLinkDialog.tsx`:24 |
| `window.api.docs.serviceStatus` | `` | `src/renderer/src/components/DocShareLinkDialog.tsx`:24 |
| `window.api.app.copyText` | `url` | `src/renderer/src/components/DocShareLinkDialog.tsx`:36 |
| `window.api.app.openExternal` | `target` | `src/renderer/src/components/DocShareLinkDialog.tsx`:47 |

> 返回 [组件索引](README.md)
