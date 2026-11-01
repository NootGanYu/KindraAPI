# 组件：DictionaryPanel.tsx

- 源码：`src/renderer/src/components/schemas/DictionaryPanel.tsx`
- 行数：356
- 静态统计：JSX 39 / 提示 9 / 菜单 6 / Tooltip 2 / Placeholder 5 / IPC 5

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Tag` | entry.field_type | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:203 |
| `Tooltip` | 编辑 | title=编辑 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:239 |
| `Tooltip` | 删除 | title=删除 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:244 |
| `Input` | 搜索参数名称或参数描述 | placeholder=搜索参数名称或参数描述 value=keyword | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:267 |
| `Switch` | — | size=small checked=settings.builtin_enabled | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:282 |
| `Button` | 新建字段描述 | type=primary | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:289 |
| `Table` | — | size=small loading=loading | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:301 |
| `Modal` | editing ? '编辑字段描述' : '新建字段描述' | title=editing ? '编辑字段描述' : '新建字段描述' open=open okText=editing ? '保存' : '新建' cancelText=取消 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:318 |
| `Form` | — | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:327 |
| `Form.Item` | 参数名称 | label=参数名称 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:328 |
| `Input` | 例如 user_id | placeholder=例如 user_id | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:333 |
| `Form.Item` | 类型 | label=类型 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:335 |
| `Select` | — | options=TYPE_OPTIONS | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:336 |
| `Form.Item` | 描述 | label=描述 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:338 |
| `Input` | 例如 用户 ID | placeholder=例如 用户 ID | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:343 |
| `Form.Item` | 备注 | label=备注 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:345 |
| `Input` | 可选 | placeholder=可选 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:346 |
| `Form.Item` | 默认值 | label=默认值 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:348 |
| `Input` | 可选 | placeholder=可选 | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:349 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 新建字段描述 | type=primary | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:289 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:61 |
| `message.success` | `editing ? '已更新' : '已新建'` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:128 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:131 |
| `modal.confirm` | `title=已存在同名条目; content=\`自定义字典中已有「${duplicate.key}」，仍要保存吗？\`; okText=仍然保存; cancelText=取消` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:149 |
| `modal.confirm` | `title=\`删除自定义描述「${entry.key}」？\`; content=删除后联想与列表会同步更新，此操作不可撤销。; okText=删除; cancelText=取消` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:162 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:171 |
| `message.success` | `已删除` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:176 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:184 |
| `message.success` | `checked ? '已开启系统内置描述联想' : '已关闭系统内置描述联想'` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:189 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `value` | `` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:27 |
| `参数名称` | `key` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:193 |
| `参数描述` | `description` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:209 |
| `备注` | `remarks` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:215 |
| `默认值` | `default_value` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:223 |
| `操作` | `actions` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:233 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `编辑` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:239 |
| `删除` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:244 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `搜索参数名称或参数描述` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:270 |
| `例如 user_id` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:333 |
| `例如 用户 ID` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:343 |
| `可选` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:346 |
| `可选` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:349 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.dictionary.list` | `projectId` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:53 |
| `window.api.dictionary.getSettings` | `projectId` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:54 |
| `window.api.dictionary.save` | `projectId, { ...(editing ?? {}), ...values, id: editing?.id ?? '', project_id: projectId` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:118 |
| `window.api.dictionary.delete` | `projectId, entry.id` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:169 |
| `window.api.dictionary.saveSettings` | `projectId, { builtin_enabled: checked }` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:182 |

> 返回 [组件索引](README.md)
