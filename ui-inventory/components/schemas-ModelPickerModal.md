# 组件：ModelPickerModal.tsx

- 源码：`src/renderer/src/components/schemas/ModelPickerModal.tsx`
- 行数：99
- 静态统计：JSX 13 / 提示 1 / 菜单 0 / Tooltip 0 / Placeholder 1 / IPC 4

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Modal` | loading ? ( <div style={{ padding: 24, textAlign: 'center' }}> <Spin /> </div> ) : filtered.length = | title=title open=open width=520 | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:61 |
| `Input` | 搜索模型名称或别名 | placeholder=搜索模型名称或别名 value=keyword | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:62 |
| `Empty` | — | description=还没有可引用的数据模型 | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:75 |
| `TableOutlined` | — | — | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:87 |
| `Tag` | 模型 | — | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:91 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `error.message` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:39 |

### 源码中的提示文案

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `搜索模型名称或别名` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:65 |

**Empty**

| 文案 | 位置 |
| --- | --- |
| `还没有可引用的数据模型` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:75 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.models
      .list(projectId)
      .then((result) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error)
        setModels(result.data)
      })
      .catch((error: Error) => active && message.error(error.message))
      .finally` | `() => active && setLoading(false)` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:32 |
| `window.api.models
      .list(projectId)
      .then((result) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error)
        setModels(result.data)
      })
      .catch` | `(error: Error) => active && message.error(error.message)` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:32 |
| `window.api.models
      .list(projectId)
      .then` | `(result) => { if (!active) return if (!result.ok) throw new Error(result.error) setModels(res` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:32 |
| `window.api.models
      .list` | `projectId` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:32 |

> 返回 [组件索引](README.md)
