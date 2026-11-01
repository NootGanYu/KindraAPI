# 组件：MessagesPanel.tsx

- 源码：`src/renderer/src/components/mqtt/MessagesPanel.tsx`
- 行数：516
- 静态统计：JSX 78 / 提示 17 / 菜单 2 / Tooltip 1 / Placeholder 2 / IPC 7

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Input` | 过滤 topic | size=small placeholder=过滤 topic value=topicFilter | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:266 |
| `Input` | 搜索 topic / 内容 | size=small placeholder=搜索 topic / 内容 value=search | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:275 |
| `Select` | — | size=small value=view options=PAYLOAD_VIEW_OPTIONS | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:283 |
| `Checkbox` | 暂停自动滚动 | checked=paused | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:290 |
| `Tooltip` | 重新加载当前连接消息 | title=重新加载当前连接消息 | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:297 |
| `Button` | — | size=small | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:298 |
| `Dropdown` | — | — | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:318 |
| `Button` | 导出 | size=small | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:319 |
| `Button` | 清空 | size=small danger=true disabled=messages.length === 0 | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:323 |
| `Alert` | — | type=warning closable=true message=errorNote | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:335 |
| `Empty` | — | description=emptyText | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:361 |
| `Tag` | item.direction === 'in' ? '收' : '发' | — | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:377 |
| `Tag` | retain | — | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:386 |
| `Button` | 重发 | size=small type=link | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:393 |
| `Modal` | detailLoading ? ( <div className="mqtt-panel-loading"> <Spin /> </div> ) : detail ? ( <div className | open=detailOpen width=760 title=<span> 消息详情 <Tag color="default" style={{ marginLeft: 8 }}> #{detail?.seq ?? '—'} </Tag> </span> | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:409 |
| `Tag` | # detail?.seq ?? '—' | — | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:415 |
| `Button` | 复制完整 payload | disabled=!detail | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:423 |
| `Button` | 重发 | disabled=!detail | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:430 |
| `Button` | 关闭 | type=primary | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:447 |
| `Select` | — | size=small value=view options=PAYLOAD_VIEW_OPTIONS | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:491 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 导出 | size=small | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:319 |
| Button | 清空 | size=small danger=true disabled=messages.length === 0 | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:323 |
| Button | 重发 | size=small type=link | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:393 |
| Button | 复制完整 payload | disabled=!detail | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:423 |
| Button | 重发 | disabled=!detail | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:430 |
| Button | 关闭 | type=primary | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:447 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.warning` | `text \|\| 'payload 超过 1MB，已拒收'` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:93 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:117 |
| `message.warning` | `消息已不在本地缓存中` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:166 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:172 |
| `message.warning` | `消息已不在本地缓存中` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:185 |
| `message.info` | `已填入发布面板，确认后再发送` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:195 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:197 |
| `message.success` | `已复制完整 payload` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:204 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:206 |
| `modal.confirm` | `title=清空当前连接的消息记录？; content=会删除该连接在本地保存的全部消息，此操作不可撤销。; okText=清空; cancelText=取消` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:211 |
| `message.success` | `已清空` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:223 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:225 |
| `message.info` | `已取消导出` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:240 |
| `message.success` | `\`已导出 ${result.count ?? 0} 条消息${result.path ? \` → ${result.path}\` : ''}\`` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:243 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:247 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:311 |
| `message.info` | `已填入发布面板，确认后再发送` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:441 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `导出 JSONL` | `jsonl` | — | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:253 |
| `导出 CSV` | `csv` | — | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:254 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `重新加载当前连接消息` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:297 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `过滤 topic` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:270 |
| `搜索 topic / 内容` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:278 |

**Empty**

| 文案 | 位置 |
| --- | --- |
| `emptyText` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:361 |

### 快捷键 / 键盘处理

| 表达式 | 位置 |
| --- | --- |
| `event.key === 'Enter'` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:372 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.mqtt.messages.list` | `projectId, connectionId, { limit: 300 }` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:112 |
| `window.api.mqtt.replay` | `connectionId, 0` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:122 |
| `window.api.mqtt.messages.get` | `projectId, connectionId, summary.seq` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:163 |
| `window.api.mqtt.messages.get` | `projectId, connectionId, summary.seq` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:182 |
| `window.api.mqtt.messages.clear` | `projectId, connectionId` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:219 |
| `window.api.mqtt.messages.export` | `projectId, { connection_ids: [connectionId], format }` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:234 |
| `window.api.mqtt.messages.list` | `projectId, connectionId, { limit: 300 }` | `src/renderer/src/components/mqtt/MessagesPanel.tsx`:305 |

> 返回 [组件索引](README.md)
