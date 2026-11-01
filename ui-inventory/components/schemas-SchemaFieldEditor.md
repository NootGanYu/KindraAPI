# 组件：SchemaFieldEditor.tsx

- 源码：`src/renderer/src/components/schemas/SchemaFieldEditor.tsx`
- 行数：564
- 静态统计：JSX 65 / 提示 0 / 菜单 11 / Tooltip 1 / Placeholder 10 / IPC 0

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Tag` | object | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:70 |
| `Input` | 字段名 | size=small value=name disabled=disabled placeholder=字段名 | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:286 |
| `Select` | — | size=small value=type disabled=disabled options=modelOptions.length === 0 ? TYPE_OPTIONS.filter((item) => item.value !== 'ref') : TYPE_OPTIONS | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:300 |
| `Checkbox` | — | checked=required disabled=disabled | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:317 |
| `Tooltip` | 允许为 null | title=允许为 null | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:325 |
| `Checkbox` | — | checked=Boolean(schema['x-nullable']) disabled=disabled | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:326 |
| `Input` | — | size=small value= disabled=true placeholder=— | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:340 |
| `Select` | — | size=small value=schema.default === undefined ? '' : String(schema.default) disabled=disabled options=[ { value: '', label: '未设置' }, { value: 'true', label: 'tr | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:342 |
| `InputNumber` | 未设置 | size=small value=typeof schema.default === 'number' ? schema.default : undefined disabled=disabled placeholder=未设置 | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:355 |
| `Input` | 未设置 | size=small value=defaultValueText(schema.default) disabled=disabled placeholder=未设置 | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:369 |
| `Input` | — | size=small value= disabled=true placeholder=— | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:380 |
| `Select` | 回车添加 | size=small mode=tags value=enumValues disabled=disabled placeholder=回车添加 | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:382 |
| `Input.TextArea` | 每个枚举值的含义，每行一条 | aria-label=枚举值含义 placeholder=每个枚举值的含义，每行一条 disabled=disabled value=Array.isArray(schema['x-enum-descriptions']) ? schema['x-enum-descriptions'].join('\n') : '' | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:393 |
| `Select` | 不引用 | size=small placeholder=不引用 value=schema.$ref ? schema.$ref.split('/').pop() : undefined disabled=disabled \|\| modelOptions.length === 0 options=modelOptions.ma | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:412 |
| `Input` | — | size=small value= disabled=true placeholder=— | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:440 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `string` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:22 |
| `number` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:23 |
| `integer` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:24 |
| `boolean` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:25 |
| `object` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:26 |
| `array` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:27 |
| `引用模型` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:28 |
| `未设置` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:349 |
| `true` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:350 |
| `false` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:351 |
| `model.name` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:431 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `允许为 null` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:325 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `模型根节点描述` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:77 |
| `字段名` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:295 |
| `—` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:340 |
| `未设置` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:366 |
| `未设置` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:374 |
| `—` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:380 |
| `回车添加` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:389 |
| `每个枚举值的含义，每行一条` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:395 |
| `不引用` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:416 |
| `—` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:440 |

> 返回 [组件索引](README.md)
