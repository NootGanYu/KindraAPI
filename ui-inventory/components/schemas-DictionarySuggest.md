# 组件：DictionarySuggest.tsx

- 源码：`src/renderer/src/components/schemas/DictionarySuggest.tsx`
- 行数：112
- 静态统计：JSX 7 / 提示 0 / 菜单 1 / Tooltip 0 / Placeholder 2 / IPC 2

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Tag` | entry.source === 'builtin' ? '内置' : '自定义' | — | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:85 |
| `AutoComplete` | placeholder | value=value options=options disabled=disabled placeholder=placeholder | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:98 |
| `Input` | placeholder | size=size placeholder=placeholder | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:108 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `( <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}> <` | `` | — | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:74 |

### 源码中的提示文案

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `placeholder` | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:106 |
| `placeholder` | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:108 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.dictionary.suggestions(projectId).then` | `(result) => { if (!result.ok) throw new Error(result.error) const entry = cache.get(projectId) ?? { ` | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:21 |
| `window.api.dictionary.suggestions` | `projectId` | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:21 |

> 返回 [组件索引](README.md)
