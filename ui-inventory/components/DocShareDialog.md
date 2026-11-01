# 组件：DocShareDialog.tsx

- 源码：`src/renderer/src/components/DocShareDialog.tsx`
- 行数：468
- 静态统计：JSX 49 / 提示 5 / 菜单 6 / Tooltip 0 / Placeholder 3 / IPC 2

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Modal` | draft.shareId ? '编辑分享' : '新建分享' | title=draft.shareId ? '编辑分享' : '新建分享' open=open width=600 okText=保存 cancelText=取消 | `src/renderer/src/components/DocShareDialog.tsx`:270 |
| `Input` | 请输入分享名称 | value=draft.name placeholder=请输入分享名称 | `src/renderer/src/components/DocShareDialog.tsx`:284 |
| `Radio.Group` | — | value=draft.scope size=small | `src/renderer/src/components/DocShareDialog.tsx`:302 |
| `Radio.Button` | 项目 | value=project | `src/renderer/src/components/DocShareDialog.tsx`:309 |
| `Radio.Button` | 目录 | value=folder | `src/renderer/src/components/DocShareDialog.tsx`:310 |
| `Radio.Button` | 接口 | value=api | `src/renderer/src/components/DocShareDialog.tsx`:311 |
| `Radio.Button` | 自定义 | value=custom | `src/renderer/src/components/DocShareDialog.tsx`:312 |
| `Tree` | — | — | `src/renderer/src/components/DocShareDialog.tsx`:323 |
| `TreeSelect` | draft.scope === 'folder' ? '请选择目录' : '请选择接口' | placeholder=draft.scope === 'folder' ? '请选择目录' : '请选择接口' value=draft.targetIds[0] | `src/renderer/src/components/DocShareDialog.tsx`:337 |
| `Radio.Group` | — | value=draft.passwordEnabled ? 'password' : 'public' size=small | `src/renderer/src/components/DocShareDialog.tsx`:357 |
| `Radio` | 公开访问 | value=public | `src/renderer/src/components/DocShareDialog.tsx`:364 |
| `Radio` | 密码访问 | value=password | `src/renderer/src/components/DocShareDialog.tsx`:365 |
| `Select` | — | value=draft.expireMode options=[ { value: 'permanent', label: '永久有效' }, { value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: 'custom', label:  | `src/renderer/src/components/DocShareDialog.tsx`:371 |
| `InputNumber` | — | value=draft.customDays | `src/renderer/src/components/DocShareDialog.tsx`:383 |
| `Input.Password` | 访问者需要输入此密码 | value=draft.password placeholder=访问者需要输入此密码 | `src/renderer/src/components/DocShareDialog.tsx`:398 |
| `Checkbox` | 请求参数 | checked=draft.showRequest | `src/renderer/src/components/DocShareDialog.tsx`:409 |
| `Checkbox` | 请求体 | checked=draft.showBody | `src/renderer/src/components/DocShareDialog.tsx`:415 |
| `Checkbox` | 响应示例 | checked=draft.showResponse | `src/renderer/src/components/DocShareDialog.tsx`:421 |
| `Checkbox` | 响应头 / Cookie | checked=draft.showHeaders | `src/renderer/src/components/DocShareDialog.tsx`:427 |
| `Checkbox` | 前后脚本 | checked=draft.showScripts | `src/renderer/src/components/DocShareDialog.tsx`:433 |
| `Checkbox` | 接口设计 | checked=draft.showDesign | `src/renderer/src/components/DocShareDialog.tsx`:439 |
| `Checkbox` | 接口用例 | checked=draft.showCases | `src/renderer/src/components/DocShareDialog.tsx`:445 |
| `Switch` | — | checked=draft.openapi | `src/renderer/src/components/DocShareDialog.tsx`:459 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Radio.Button | 项目 | value=project | `src/renderer/src/components/DocShareDialog.tsx`:309 |
| Radio.Button | 目录 | value=folder | `src/renderer/src/components/DocShareDialog.tsx`:310 |
| Radio.Button | 接口 | value=api | `src/renderer/src/components/DocShareDialog.tsx`:311 |
| Radio.Button | 自定义 | value=custom | `src/renderer/src/components/DocShareDialog.tsx`:312 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `项目未就绪` | `src/renderer/src/components/DocShareDialog.tsx`:217 |
| `message.warning` | `请输入分享名称` | `src/renderer/src/components/DocShareDialog.tsx`:224 |
| `message.warning` | `scope === 'folder' ? '请选择要分享的目录' : '请选择要分享的接口'` | `src/renderer/src/components/DocShareDialog.tsx`:228 |
| `message.warning` | `请输入访问密码` | `src/renderer/src/components/DocShareDialog.tsx`:232 |
| `message.error` | `result.error` | `src/renderer/src/components/DocShareDialog.tsx`:260 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `target.name` | `target.target_id` | — | `src/renderer/src/components/DocShareDialog.tsx`:91 |
| `node.title` | `node.key` | — | `src/renderer/src/components/DocShareDialog.tsx`:110 |
| `永久有效` | `` | — | `src/renderer/src/components/DocShareDialog.tsx`:376 |
| `7 天` | `` | — | `src/renderer/src/components/DocShareDialog.tsx`:377 |
| `30 天` | `` | — | `src/renderer/src/components/DocShareDialog.tsx`:378 |
| `自定义` | `` | — | `src/renderer/src/components/DocShareDialog.tsx`:379 |

### 源码中的提示文案

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `请输入分享名称` | `src/renderer/src/components/DocShareDialog.tsx`:286 |
| `draft.scope === 'folder' ? '请选择目录' : '请选择接口'` | `src/renderer/src/components/DocShareDialog.tsx`:339 |
| `访问者需要输入此密码` | `src/renderer/src/components/DocShareDialog.tsx`:400 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.docs.update` | `projectId, draft.shareId, input` | `src/renderer/src/components/DocShareDialog.tsx`:257 |
| `window.api.docs.create` | `projectId, input` | `src/renderer/src/components/DocShareDialog.tsx`:258 |

> 返回 [组件索引](README.md)
