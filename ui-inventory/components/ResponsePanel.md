# 组件：ResponsePanel.tsx

- 源码：`src/renderer/src/components/ResponsePanel.tsx`
- 行数：884
- 静态统计：JSX 136 / 提示 9 / 菜单 1 / Tooltip 1 / Placeholder 0 / IPC 5

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `JsonFieldTable` | — | — | `src/renderer/src/components/ResponsePanel.tsx`:267 |
| `Tag` | 模型已删除 | — | `src/renderer/src/components/ResponsePanel.tsx`:278 |
| `Tag` | 模型 · referencedModel?.name | — | `src/renderer/src/components/ResponsePanel.tsx`:280 |
| `Tooltip` | 解除引用后保留当前 JSON | title=解除引用后保留当前 JSON | `src/renderer/src/components/ResponsePanel.tsx`:284 |
| `Input.TextArea` | 响应示例 JSON | aria-label=响应示例 JSON value=raw | `src/renderer/src/components/ResponsePanel.tsx`:332 |
| `HeaderTable` | — | — | `src/renderer/src/components/ResponsePanel.tsx`:357 |
| `HeaderTable` | — | — | `src/renderer/src/components/ResponsePanel.tsx`:372 |
| `HeaderTable` | — | — | `src/renderer/src/components/ResponsePanel.tsx`:391 |
| `Select` | 选择响应示例 | aria-label=选择响应示例 value=example?.example_id options=(examples ?? []).map(item => ({ value: item.example_id, label: (item.expect?.name ?? '成功') + ' · ' + (item.e | `src/renderer/src/components/ResponsePanel.tsx`:527 |
| `ModelPickerModal` | 选择响应示例模型 | open=pickerOpen title=选择响应示例模型 | `src/renderer/src/components/ResponsePanel.tsx`:532 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.success` | `响应体已复制` | `src/renderer/src/components/ResponsePanel.tsx`:115 |
| `message.success` | `响应体已复制` | `src/renderer/src/components/ResponsePanel.tsx`:119 |
| `message.error` | `复制失败` | `src/renderer/src/components/ResponsePanel.tsx`:121 |
| `message.error` | `error.message` | `src/renderer/src/components/ResponsePanel.tsx`:177 |
| `message.error` | `result.error` | `src/renderer/src/components/ResponsePanel.tsx`:181 |
| `message.warning` | `result.data.warnings[0].message` | `src/renderer/src/components/ResponsePanel.tsx`:184 |
| `modal.confirm` | `title=编辑将解除模型引用; content=解除后保留当前生成的示例 JSON，可继续手动维护。; okText=解除并编辑; cancelText=取消` | `src/renderer/src/components/ResponsePanel.tsx`:230 |
| `message.warning` | `当前仅维护成功响应` | `src/renderer/src/components/ResponsePanel.tsx`:250 |
| `message.warning` | `请先解除模型引用，再更新示例` | `src/renderer/src/components/ResponsePanel.tsx`:251 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `(item.expect?.name ?? '成功') + ' · ' + (item.expect?.code ?? 200)` | `` | — | `src/renderer/src/components/ResponsePanel.tsx`:527 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `解除引用后保留当前 JSON` | `src/renderer/src/components/ResponsePanel.tsx`:284 |

### 快捷键 / 键盘处理

| 表达式 | 位置 |
| --- | --- |
| `event.key === 'Enter'` | `src/renderer/src/components/ResponsePanel.tsx`:829 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.app.copyText` | `text` | `src/renderer/src/components/ResponsePanel.tsx`:113 |
| `window.api.models
      .list(projectId)
      .then((result) => {
        if (active && result.ok) setModels(result.data)
      })
      .catch` | `() => undefined` | `src/renderer/src/components/ResponsePanel.tsx`:135 |
| `window.api.models
      .list(projectId)
      .then` | `(result) => { if (active && result.ok) setModels(result.data) }` | `src/renderer/src/components/ResponsePanel.tsx`:135 |
| `window.api.models
      .list` | `projectId` | `src/renderer/src/components/ResponsePanel.tsx`:135 |
| `window.api.models.generateExample` | `projectId, model.model_id` | `src/renderer/src/components/ResponsePanel.tsx`:179 |

> 返回 [组件索引](README.md)
