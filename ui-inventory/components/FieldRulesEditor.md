# 组件：FieldRulesEditor.tsx

- 源码：`src/renderer/src/components/FieldRulesEditor.tsx`
- 行数：64
- 静态统计：JSX 21 / 提示 0 / 菜单 7 / Tooltip 0 / Placeholder 1 / IPC 0

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Select` | — | value=draft[key] === undefined ? 'unknown' : String(draft[key]) options=[{ value: 'unknown', label: '待补充' }, { value: 'true', label: '是' }, { value: 'false', la | `src/renderer/src/components/FieldRulesEditor.tsx`:42 |
| `Button` | 规则 | size=small type=text disabled=disabled | `src/renderer/src/components/FieldRulesEditor.tsx`:47 |
| `Modal` | 字段说明与规则 | title=字段说明与规则 open=open okText=保存 cancelText=取消 | `src/renderer/src/components/FieldRulesEditor.tsx`:48 |
| `Select` | — | value=draft.type ?? 'unknown' options=FIELD_TYPES.map(type => ({ value: type, label: type })) | `src/renderer/src/components/FieldRulesEditor.tsx`:50 |
| `Input.TextArea` | — | value=draft.description ?? '' | `src/renderer/src/components/FieldRulesEditor.tsx`:53 |
| `Select` | — | value=enumMode options=[{ value: 'unknown', label: '待补充' }, { value: 'none', label: '没有枚举限制' }, { value: 'values', label: '指定枚举值' }] | `src/renderer/src/components/FieldRulesEditor.tsx`:54 |
| `Input.TextArea` | — | value=enumText | `src/renderer/src/components/FieldRulesEditor.tsx`:55 |
| `Input.TextArea` | — | value=meanings | `src/renderer/src/components/FieldRulesEditor.tsx`:56 |
| `Input` | '例如 0、false、"默认名称"' | value=defaultText placeholder='例如 0、false、"默认名称"' | `src/renderer/src/components/FieldRulesEditor.tsx`:57 |
| `Input` | — | value=exampleText | `src/renderer/src/components/FieldRulesEditor.tsx`:58 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 规则 | size=small type=text disabled=disabled | `src/renderer/src/components/FieldRulesEditor.tsx`:47 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `待补充` | `` | — | `src/renderer/src/components/FieldRulesEditor.tsx`:44 |
| `是` | `` | — | `src/renderer/src/components/FieldRulesEditor.tsx`:44 |
| `否` | `` | — | `src/renderer/src/components/FieldRulesEditor.tsx`:44 |
| `type` | `` | — | `src/renderer/src/components/FieldRulesEditor.tsx`:50 |
| `待补充` | `` | — | `src/renderer/src/components/FieldRulesEditor.tsx`:54 |
| `没有枚举限制` | `` | — | `src/renderer/src/components/FieldRulesEditor.tsx`:54 |
| `指定枚举值` | `` | — | `src/renderer/src/components/FieldRulesEditor.tsx`:54 |

### 源码中的提示文案

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `'例如 0、false、"默认名称"'` | `src/renderer/src/components/FieldRulesEditor.tsx`:57 |

> 返回 [组件索引](README.md)
