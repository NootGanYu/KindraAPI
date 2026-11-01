# 组件：ParamTable.tsx

- 源码：`src/renderer/src/components/ParamTable.tsx`
- 行数：286
- 静态统计：JSX 39 / 提示 1 / 菜单 2 / Tooltip 2 / Placeholder 4 / IPC 2

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Tooltip` | 添加参数 | title=添加参数 | `src/renderer/src/components/ParamTable.tsx`:130 |
| `Checkbox` | — | checked=allChecked | `src/renderer/src/components/ParamTable.tsx`:141 |
| `Checkbox` | — | checked=param.is_checked > 0 | `src/renderer/src/components/ParamTable.tsx`:155 |
| `Select` | — | size=small value=param.field_type === 'file' ? 'file' : 'text' options=[ { value: 'text', label: '文本' }, { value: 'file', label: '文件' } ] | `src/renderer/src/components/ParamTable.tsx`:165 |
| `Input` | keyPlaceholder | value=param.key placeholder=keyPlaceholder | `src/renderer/src/components/ParamTable.tsx`:182 |
| `Button` | 选择 | size=small type=link | `src/renderer/src/components/ParamTable.tsx`:218 |
| `Button` | 清除 | size=small type=text | `src/renderer/src/components/ParamTable.tsx`:222 |
| `Input` | valuePlaceholder | value=param.value placeholder=valuePlaceholder | `src/renderer/src/components/ParamTable.tsx`:232 |
| `Input` | 描述 | value=param.description ?? '' placeholder=描述 | `src/renderer/src/components/ParamTable.tsx`:254 |
| `Tooltip` | 删除 | title=删除 | `src/renderer/src/components/ParamTable.tsx`:264 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 选择 | size=small type=link | `src/renderer/src/components/ParamTable.tsx`:218 |
| Button | 清除 | size=small type=text | `src/renderer/src/components/ParamTable.tsx`:222 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `result.error` | `src/renderer/src/components/ParamTable.tsx`:90 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `文本` | `` | — | `src/renderer/src/components/ParamTable.tsx`:171 |
| `文件` | `` | — | `src/renderer/src/components/ParamTable.tsx`:172 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `添加参数` | `src/renderer/src/components/ParamTable.tsx`:130 |
| `删除` | `src/renderer/src/components/ParamTable.tsx`:264 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `keyPlaceholder` | `src/renderer/src/components/ParamTable.tsx`:185 |
| `valuePlaceholder` | `src/renderer/src/components/ParamTable.tsx`:235 |
| `描述` | `src/renderer/src/components/ParamTable.tsx`:249 |
| `描述` | `src/renderer/src/components/ParamTable.tsx`:257 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.dialog.openFiles` | `` | `src/renderer/src/components/ParamTable.tsx`:88 |
| `window.api.files.getPathForFile` | `file` | `src/renderer/src/components/ParamTable.tsx`:99 |

> 返回 [组件索引](README.md)
