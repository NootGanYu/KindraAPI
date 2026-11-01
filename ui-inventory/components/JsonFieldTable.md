# 组件：JsonFieldTable.tsx

- 源码：`src/renderer/src/components/JsonFieldTable.tsx`
- 行数：588
- 静态统计：JSX 77 / 提示 5 / 菜单 15 / Tooltip 2 / Placeholder 3 / IPC 0

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Select` | — | size=small value=row.value === true ? 'true' : 'false' options=[ { value: 'true', label: 'true' }, { value: 'false', label: 'false' } ] | `src/renderer/src/components/JsonFieldTable.tsx`:114 |
| `Input.TextArea` | — | value=text status=error ? 'error' : undefined | `src/renderer/src/components/JsonFieldTable.tsx`:140 |
| `Input` | — | value=text status=error ? 'error' : undefined | `src/renderer/src/components/JsonFieldTable.tsx`:156 |
| `Tooltip` | 新增 raw 中不存在的仅文档字段 | title=新增 raw 中不存在的仅文档字段 | `src/renderer/src/components/JsonFieldTable.tsx`:402 |
| `Button` | 仅文档字段 | size=small | `src/renderer/src/components/JsonFieldTable.tsx`:403 |
| `Tag` | 孤立 | — | `src/renderer/src/components/JsonFieldTable.tsx`:455 |
| `Tag` | 仅文档 | — | `src/renderer/src/components/JsonFieldTable.tsx`:456 |
| `Tag` | 数组元素 | — | `src/renderer/src/components/JsonFieldTable.tsx`:457 |
| `Select` | — | size=small value=row.typeOverridden ? row.type : '__auto__' disabled=valuesReadOnly && row.present options=TYPE_OPTIONS.map((option) => option.value === '__auto | `src/renderer/src/components/JsonFieldTable.tsx`:464 |
| `Tooltip` | 声明的类型与当前值不一致 | title=声明的类型与当前值不一致 | `src/renderer/src/components/JsonFieldTable.tsx`:482 |
| `Checkbox` | — | disabled=valuesReadOnly checked=row.required | `src/renderer/src/components/JsonFieldTable.tsx`:488 |
| `Input.TextArea` | 字段含义 | disabled=valuesReadOnly value=row.description placeholder=字段含义 | `src/renderer/src/components/JsonFieldTable.tsx`:496 |
| `Dropdown` | — | — | `src/renderer/src/components/JsonFieldTable.tsx`:508 |
| `Modal` | 新增仅文档字段 | title=新增仅文档字段 open=addOpen okText=添加 cancelText=取消 | `src/renderer/src/components/JsonFieldTable.tsx`:532 |
| `Input` | user.name 或 items[].id | value=addPath placeholder=user.name 或 items[].id | `src/renderer/src/components/JsonFieldTable.tsx`:542 |
| `Select` | — | value=addType options=TYPE_OPTIONS.filter((option) => option.value !== '__auto__') | `src/renderer/src/components/JsonFieldTable.tsx`:548 |
| `Checkbox` | 该字段必填 | checked=addRequired | `src/renderer/src/components/JsonFieldTable.tsx`:554 |
| `Input.TextArea` | — | value=addDescription | `src/renderer/src/components/JsonFieldTable.tsx`:558 |
| `Modal` | 重新映射说明 | title=重新映射说明 open=Boolean(remapPointer) okText=保存 cancelText=取消 | `src/renderer/src/components/JsonFieldTable.tsx`:567 |
| `Input` | user.name 或 items[].id | value=remapPath placeholder=user.name 或 items[].id | `src/renderer/src/components/JsonFieldTable.tsx`:577 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 仅文档字段 | size=small | `src/renderer/src/components/JsonFieldTable.tsx`:403 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `当前 JSON 无效，无法写回字段值` | `src/renderer/src/components/JsonFieldTable.tsx`:245 |
| `message.error` | `无法在该路径写入值` | `src/renderer/src/components/JsonFieldTable.tsx`:249 |
| `modal.confirm` | `title=从请求体中删除字段？; content=\`将删除 ${row.path}，并移除其下所有字段说明。\`; okText=删除; cancelText=取消` | `src/renderer/src/components/JsonFieldTable.tsx`:334 |
| `message.error` | `当前 JSON 无效，无法删除字段` | `src/renderer/src/components/JsonFieldTable.tsx`:345 |
| `message.error` | `无法删除该字段` | `src/renderer/src/components/JsonFieldTable.tsx`:349 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `自动推断` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:36 |
| `string` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:37 |
| `number` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:38 |
| `integer` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:39 |
| `boolean` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:40 |
| `null` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:41 |
| `object` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:42 |
| `array` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:43 |
| `unknown` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:44 |
| `true` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:119 |
| `false` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:120 |
| `重新映射` | `remap` | — | `src/renderer/src/components/JsonFieldTable.tsx`:360 |
| `row.docOnly ? '删除文档行' : '清除说明'` | `remove-doc` | — | `src/renderer/src/components/JsonFieldTable.tsx`:362 |
| `从请求体删除` | `remove-raw` | — | `src/renderer/src/components/JsonFieldTable.tsx`:365 |
| `\`自动（${row.inferred}${row.mixed ? '/mixed' : ''}）\`` | `` | — | `src/renderer/src/components/JsonFieldTable.tsx`:472 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `新增 raw 中不存在的仅文档字段` | `src/renderer/src/components/JsonFieldTable.tsx`:402 |
| `声明的类型与当前值不一致` | `src/renderer/src/components/JsonFieldTable.tsx`:482 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `字段含义` | `src/renderer/src/components/JsonFieldTable.tsx`:501 |
| `user.name 或 items[].id` | `src/renderer/src/components/JsonFieldTable.tsx`:544 |
| `user.name 或 items[].id` | `src/renderer/src/components/JsonFieldTable.tsx`:579 |

> 返回 [组件索引](README.md)
