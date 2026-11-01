# 组件：ApiTree.tsx

- 源码：`src/renderer/src/components/ApiTree.tsx`
- 行数：566
- 静态统计：JSX 81 / 提示 11 / 菜单 29 / Tooltip 3 / Placeholder 2 / IPC 0

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Dropdown` | — | — | `src/renderer/src/components/ApiTree.tsx`:356 |
| `Button` | — | size=small type=text | `src/renderer/src/components/ApiTree.tsx`:357 |
| `Dropdown` | — | — | `src/renderer/src/components/ApiTree.tsx`:365 |
| `Button` | — | size=small type=text | `src/renderer/src/components/ApiTree.tsx`:366 |
| `Input` | 关键字/URL | value=keyword placeholder=关键字/URL | `src/renderer/src/components/ApiTree.tsx`:421 |
| `Dropdown` | — | — | `src/renderer/src/components/ApiTree.tsx`:427 |
| `Popover` | — | placement=bottomLeft open=newOpen | `src/renderer/src/components/ApiTree.tsx`:443 |
| `Tooltip` | 刷新 | title=刷新 | `src/renderer/src/components/ApiTree.tsx`:462 |
| `Tooltip` | ascending ? '倒序排列' : '正序排列' | title=ascending ? '倒序排列' : '正序排列' | `src/renderer/src/components/ApiTree.tsx`:467 |
| `Tooltip` | allCollapsed ? '展开全部' : '折叠全部' | title=allCollapsed ? '展开全部' : '折叠全部' | `src/renderer/src/components/ApiTree.tsx`:476 |
| `Tree` | — | — | `src/renderer/src/components/ApiTree.tsx`:493 |
| `Modal` | 编辑 | title=编辑 open=renaming !== null okText=确定 cancelText=取消 | `src/renderer/src/components/ApiTree.tsx`:532 |
| `Input` | 名称 | value=renameValue placeholder=名称 | `src/renderer/src/components/ApiTree.tsx`:541 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.info` | `\`${entry.label} 将在后续里程碑支持\`` | `src/renderer/src/components/ApiTree.tsx`:173 |
| `modal.confirm` | `title=删除确认; content=\`确定删除「${item.name}」${ item.target_type === 'folder' ? '及其下所有内容' : '' }？此操作不可撤销。\`; okText=删除; cancelText=取消` | `src/renderer/src/components/ApiTree.tsx`:194 |
| `message.warning` | `名称不能为空` | `src/renderer/src/components/ApiTree.tsx`:215 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/ApiTree.tsx`:222 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/ApiTree.tsx`:277 |
| `message.info` | `粘贴接口/文本将在后续里程碑支持` | `src/renderer/src/components/ApiTree.tsx`:294 |
| `message.info` | `可直接拖动节点调整位置` | `src/renderer/src/components/ApiTree.tsx`:308 |
| `message.info` | `复制将在后续里程碑支持` | `src/renderer/src/components/ApiTree.tsx`:310 |
| `message.info` | `可直接拖动节点调整位置` | `src/renderer/src/components/ApiTree.tsx`:334 |
| `message.info` | `复制将在后续里程碑支持` | `src/renderer/src/components/ApiTree.tsx`:336 |
| `message.error` | `error.message` | `src/renderer/src/components/ApiTree.tsx`:528 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `HTTP` | `http` | — | `src/renderer/src/components/ApiTree.tsx`:61 |
| `Event Stream Request` | `event-stream` | — | `src/renderer/src/components/ApiTree.tsx`:62 |
| `WebSocket` | `websocket` | — | `src/renderer/src/components/ApiTree.tsx`:63 |
| `Socket.IO` | `socketio` | — | `src/renderer/src/components/ApiTree.tsx`:64 |
| `gRPC` | `grpc` | — | `src/renderer/src/components/ApiTree.tsx`:65 |
| `GraphQL` | `graphql` | — | `src/renderer/src/components/ApiTree.tsx`:66 |
| `TCP 客户端` | `tcp` | — | `src/renderer/src/components/ApiTree.tsx`:67 |
| `Markdown` | `markdown` | — | `src/renderer/src/components/ApiTree.tsx`:68 |
| `目录` | `folder` | — | `src/renderer/src/components/ApiTree.tsx`:69 |
| `cURL 导入` | `curl` | — | `src/renderer/src/components/ApiTree.tsx`:78 |
| `粘贴接口/文本` | `paste` | — | `src/renderer/src/components/ApiTree.tsx`:79 |
| `其他文件导入` | `file` | — | `src/renderer/src/components/ApiTree.tsx`:80 |
| `entry.label` | `entry.key` | — | `src/renderer/src/components/ApiTree.tsx`:182 |
| `新建` | `new` | — | `src/renderer/src/components/ApiTree.tsx`:284 |
| `粘贴接口/文本` | `paste` | — | `src/renderer/src/components/ApiTree.tsx`:290 |
| `分享` | `share` | — | `src/renderer/src/components/ApiTree.tsx`:297 |
| `移动至` | `move` | — | `src/renderer/src/components/ApiTree.tsx`:304 |
| `复制` | `copy` | — | `src/renderer/src/components/ApiTree.tsx`:310 |
| `编辑` | `edit` | — | `src/renderer/src/components/ApiTree.tsx`:311 |
| `编辑说明` | `describe` | — | `src/renderer/src/components/ApiTree.tsx`:312 |
| `删除` | `delete` | — | `src/renderer/src/components/ApiTree.tsx`:319 |
| `分享` | `share` | — | `src/renderer/src/components/ApiTree.tsx`:323 |
| `移动至` | `move` | — | `src/renderer/src/components/ApiTree.tsx`:330 |
| `复制` | `copy` | — | `src/renderer/src/components/ApiTree.tsx`:336 |
| `编辑` | `edit` | — | `src/renderer/src/components/ApiTree.tsx`:337 |
| `删除` | `delete` | — | `src/renderer/src/components/ApiTree.tsx`:339 |
| `全部` | `all` | — | `src/renderer/src/components/ApiTree.tsx`:431 |
| `仅接口` | `api` | — | `src/renderer/src/components/ApiTree.tsx`:432 |
| `仅目录` | `folder` | — | `src/renderer/src/components/ApiTree.tsx`:433 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `刷新` | `src/renderer/src/components/ApiTree.tsx`:462 |
| `ascending ? '倒序排列' : '正序排列'` | `src/renderer/src/components/ApiTree.tsx`:467 |
| `allCollapsed ? '展开全部' : '折叠全部'` | `src/renderer/src/components/ApiTree.tsx`:476 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `关键字/URL` | `src/renderer/src/components/ApiTree.tsx`:425 |
| `名称` | `src/renderer/src/components/ApiTree.tsx`:544 |

> 返回 [组件索引](README.md)
