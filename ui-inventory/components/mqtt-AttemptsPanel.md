# 组件：AttemptsPanel.tsx

- 源码：`src/renderer/src/components/mqtt/AttemptsPanel.tsx`
- 行数：239
- 静态统计：JSX 18 / 提示 7 / 菜单 3 / Tooltip 2 / Placeholder 0 / IPC 3

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Tag` | value === 'test' ? '测试' : '连接' | — | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:143 |
| `Tag` | value ? '成功' : '失败' | — | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:153 |
| `Tooltip` | attempt.error.hint | title=attempt.error.hint | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:168 |
| `Tag` | attempt.error.category | — | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:170 |
| `Select` | — | size=small value=filterId options=[ { value: 'all', label: '全部配置' }, ...profiles.map((profile) => ({ value: profile.connection_id, label: profile.name })) ] | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:191 |
| `Tooltip` | 刷新 | title=刷新 | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:206 |
| `Button` | — | size=small | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:207 |
| `Button` | 导出 | size=small disabled=attempts.length === 0 | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:209 |
| `Button` | 清空 | size=small danger=true disabled=attempts.length === 0 | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:217 |
| `Table` | — | size=small loading=loading | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:227 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 导出 | size=small disabled=attempts.length === 0 | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:209 |
| Button | 清空 | size=small danger=true disabled=attempts.length === 0 | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:217 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:52 |
| `modal.confirm` | `title=清空运行记录？; content=filterId === 'all' ? '将清空当前项目全部连接测试与连接记录，此操作不可撤销。' : \`将清空「${names.get(filterId) ?? filterId}」的运行记录，此操作不可撤销。\`; okText=清空; cancelText=取消` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:78 |
| `message.success` | `已清空` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:96 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:98 |
| `message.info` | `已取消导出` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:113 |
| `message.success` | `\`已导出 ${result.count ?? 0} 条记录${result.path ? \` → ${result.path}\` : ''}\`` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:116 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:120 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `详情` | `detail` | — | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:162 |
| `全部配置` | `` | — | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:197 |
| `profile.name` | `` | — | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:198 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `attempt.error.hint` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:168 |
| `刷新` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:206 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.mqtt.attempts.list` | `projectId, filterId === 'all' ? undefined : filterId, 200` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:44 |
| `window.api.mqtt.attempts.clear` | `projectId, filterId === 'all' ? undefined : filterId` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:90 |
| `window.api.mqtt.attempts.export` | `projectId, filterId === 'all' ? undefined : filterId` | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`:107 |

> 返回 [组件索引](README.md)
