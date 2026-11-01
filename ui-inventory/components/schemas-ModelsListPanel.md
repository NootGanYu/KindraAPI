# 组件：ModelsListPanel.tsx

- 源码：`src/renderer/src/components/schemas/ModelsListPanel.tsx`
- 行数：237
- 静态统计：JSX 22 / 提示 0 / 菜单 17 / Tooltip 1 / Placeholder 1 / IPC 0

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Input` | 搜索模型名称或别名 | placeholder=搜索模型名称或别名 value=keyword | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:161 |
| `Select` | — | value=folderId options=[ { value: 'all', label: '全部目录' }, { value: '0', label: '根目录' }, ...folders.map((folder) => ({ value: folder.model_id, label: folder.name | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:169 |
| `Dropdown` | — | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:181 |
| `Checkbox` | column.label | checked=column.visible | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:188 |
| `Button` | 恢复默认 | size=small type=link | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:196 |
| `Tooltip` | 列设置 | title=列设置 | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:209 |
| `Button` | — | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:210 |
| `Table` | — | size=small | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:215 |
| `Empty` | — | description=暂无数据，先在左侧新建数据模型 | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:227 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 恢复默认 | size=small type=link | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:196 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `名称` | `name` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:20 |
| `别名` | `alias` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:21 |
| `创建人` | `created_by` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:22 |
| `创建时间` | `created_time` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:23 |
| `最后修改人` | `updated_by` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:24 |
| `修改时间` | `updated_time` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:25 |
| `目录` | `folder` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:26 |
| `名称` | `name` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:102 |
| `别名` | `alias` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:110 |
| `创建人` | `created_by` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:116 |
| `创建时间` | `created_time` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:123 |
| `最后修改人` | `updated_by` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:130 |
| `修改时间` | `updated_time` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:137 |
| `目录` | `folder` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:144 |
| `全部目录` | `` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:174 |
| `根目录` | `` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:175 |
| `folder.name` | `` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:176 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `列设置` | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:209 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `搜索模型名称或别名` | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:164 |

**Empty**

| 文案 | 位置 |
| --- | --- |
| `暂无数据，先在左侧新建数据模型` | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:227 |

> 返回 [组件索引](README.md)
