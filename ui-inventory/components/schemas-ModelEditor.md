# 组件：ModelEditor.tsx

- 源码：`src/renderer/src/components/schemas/ModelEditor.tsx`
- 行数：372
- 静态统计：JSX 61 / 提示 12 / 菜单 0 / Tooltip 2 / Placeholder 4 / IPC 5

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Input` | 目录名称 | size=large value=draft.name placeholder=目录名称 | `src/renderer/src/components/schemas/ModelEditor.tsx`:209 |
| `Button` | 删除 | danger=true | `src/renderer/src/components/schemas/ModelEditor.tsx`:218 |
| `Button` | 保存 | type=primary loading=saving | `src/renderer/src/components/schemas/ModelEditor.tsx`:221 |
| `Alert` | — | type=info message=模型目录 description=目录用于组织数据模型；保存名称后可在左侧树中拖拽调整顺序或移动。 | `src/renderer/src/components/schemas/ModelEditor.tsx`:226 |
| `Input` | 输入模型名称，建议使用代码模型名称或其同义词 | size=large value=draft.name placeholder=输入模型名称，建议使用代码模型名称或其同义词 | `src/renderer/src/components/schemas/ModelEditor.tsx`:241 |
| `Input` | 别名（可选） | size=small value=draft.alias ?? '' placeholder=别名（可选） | `src/renderer/src/components/schemas/ModelEditor.tsx`:250 |
| `Input` | 模型描述（可选） | size=small value=draft.data.description placeholder=模型描述（可选） | `src/renderer/src/components/schemas/ModelEditor.tsx`:258 |
| `Button` | 删除 | danger=true | `src/renderer/src/components/schemas/ModelEditor.tsx`:268 |
| `Button` | 保存 | type=primary loading=saving | `src/renderer/src/components/schemas/ModelEditor.tsx`:271 |
| `TableOutlined` | — | — | `src/renderer/src/components/schemas/ModelEditor.tsx`:279 |
| `Tooltip` | 后续支持 | title=后续支持 | `src/renderer/src/components/schemas/ModelEditor.tsx`:288 |
| `Tooltip` | 后续支持 | title=后续支持 | `src/renderer/src/components/schemas/ModelEditor.tsx`:293 |
| `Tag` | draft.model_id | — | `src/renderer/src/components/schemas/ModelEditor.tsx`:299 |
| `Button` | 重置 | size=small | `src/renderer/src/components/schemas/ModelEditor.tsx`:319 |
| `Button` | 应用 | size=small type=primary | `src/renderer/src/components/schemas/ModelEditor.tsx`:322 |
| `Input.TextArea` | — | value=rawText | `src/renderer/src/components/schemas/ModelEditor.tsx`:332 |
| `Alert` | — | type=error message=rawError | `src/renderer/src/components/schemas/ModelEditor.tsx`:342 |
| `Button` | 重新生成 | size=small | `src/renderer/src/components/schemas/ModelEditor.tsx`:347 |
| `Alert` | — | type=warning message=生成警告 description=preview.warnings.map((warning) => ( <div key={`${warning.code}-${warning.path ?? ''}-${warning.ref ?? ''}`}> · {warning.me | `src/renderer/src/components/schemas/ModelEditor.tsx`:353 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 删除 | danger=true | `src/renderer/src/components/schemas/ModelEditor.tsx`:218 |
| Button | 保存 | type=primary loading=saving | `src/renderer/src/components/schemas/ModelEditor.tsx`:221 |
| Button | 删除 | danger=true | `src/renderer/src/components/schemas/ModelEditor.tsx`:268 |
| Button | 保存 | type=primary loading=saving | `src/renderer/src/components/schemas/ModelEditor.tsx`:271 |
| Button | 重置 | size=small | `src/renderer/src/components/schemas/ModelEditor.tsx`:319 |
| Button | 应用 | size=small type=primary | `src/renderer/src/components/schemas/ModelEditor.tsx`:322 |
| Button | 重新生成 | size=small | `src/renderer/src/components/schemas/ModelEditor.tsx`:347 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/ModelEditor.tsx`:78 |
| `message.error` | `请输入模型名称` | `src/renderer/src/components/schemas/ModelEditor.tsx`:113 |
| `message.error` | `problem` | `src/renderer/src/components/schemas/ModelEditor.tsx`:119 |
| `message.warning` | `已存在同名模型，请确认是否符合预期` | `src/renderer/src/components/schemas/ModelEditor.tsx`:129 |
| `message.warning` | `generated.data.warnings[0].message` | `src/renderer/src/components/schemas/ModelEditor.tsx`:132 |
| `message.success` | `已保存` | `src/renderer/src/components/schemas/ModelEditor.tsx`:147 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/ModelEditor.tsx`:149 |
| `message.error` | `references.error` | `src/renderer/src/components/schemas/ModelEditor.tsx`:158 |
| `modal.confirm` | `title=\`删除${isFolder ? '目录' : '模型'}「${draft.name}」？\`; content=( <div> {isFolder ? ( <p>目录下的模型会一并删除，且不可撤销。</p> ) : null} {list.length > 0 ? ( <> <p>以下接口仍引用该模型，删除后` | `src/renderer/src/components/schemas/ModelEditor.tsx`:162 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/ModelEditor.tsx`:196 |
| `message.success` | `已删除` | `src/renderer/src/components/schemas/ModelEditor.tsx`:200 |
| `message.success` | `已应用，可切回可视化` | `src/renderer/src/components/schemas/ModelEditor.tsx`:326 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `后续支持` | `src/renderer/src/components/schemas/ModelEditor.tsx`:288 |
| `后续支持` | `src/renderer/src/components/schemas/ModelEditor.tsx`:293 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `目录名称` | `src/renderer/src/components/schemas/ModelEditor.tsx`:214 |
| `输入模型名称，建议使用代码模型名称或其同义词` | `src/renderer/src/components/schemas/ModelEditor.tsx`:246 |
| `别名（可选）` | `src/renderer/src/components/schemas/ModelEditor.tsx`:255 |
| `模型描述（可选）` | `src/renderer/src/components/schemas/ModelEditor.tsx`:263 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.models.generateFromSchema` | `projectId, schema` | `src/renderer/src/components/schemas/ModelEditor.tsx`:76 |
| `window.api.models.generateFromSchema` | `projectId, draft.data.schema` | `src/renderer/src/components/schemas/ModelEditor.tsx`:130 |
| `window.api.models.save` | `projectId, { ...draft, name, updated_by: '本地' }` | `src/renderer/src/components/schemas/ModelEditor.tsx`:137 |
| `window.api.models.references` | `projectId, draft.model_id` | `src/renderer/src/components/schemas/ModelEditor.tsx`:156 |
| `window.api.models.delete` | `projectId, draft.model_id` | `src/renderer/src/components/schemas/ModelEditor.tsx`:194 |

> 返回 [组件索引](README.md)
