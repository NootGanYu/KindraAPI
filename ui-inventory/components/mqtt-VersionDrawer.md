# 组件：VersionDrawer.tsx

- 源码：`src/renderer/src/components/mqtt/VersionDrawer.tsx`
- 行数：240
- 静态统计：JSX 39 / 提示 6 / 菜单 0 / Tooltip 0 / Placeholder 0 / IPC 3

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Drawer` | loading ? ( <div className="mqtt-drawer-loading"> <Spin /> </div> ) : versions.length === 0 ? ( <Emp | title=<span> <HistoryOutlined /> 版本历史 </span> width=560 open=open | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:117 |
| `Button` | 刷新 | size=small loading=loading | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:127 |
| `Empty` | — | description=每次保存连接配置后会自动生成版本快照 | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:137 |
| `Button` | 查看 | size=small type=link | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:149 |
| `Button` | 恢复 | size=small type=link loading=restoring === version.version_id | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:157 |
| `Tag` | v | — | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:173 |
| `Modal` | detailLoading ? ( <Spin /> ) : snapshot ? ( <div className="mqtt-version-detail"> <div className="mq | open=Boolean(detail) title=版本详情 width=620 | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:189 |
| `Button` | 关闭 | — | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:194 |
| `Tag` | QoS sub.qos | — | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:229 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 刷新 | size=small loading=loading | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:127 |
| Button | 查看 | size=small type=link | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:149 |
| Button | 恢复 | size=small type=link loading=restoring === version.version_id | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:157 |
| Button | 关闭 |  | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:194 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:53 |
| `message.warning` | `版本不存在` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:72 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:77 |
| `modal.confirm` | `title=恢复该版本？; content=\`将使用「${version.name \|\| '未命名'}」${ version.created_at ? \`（${formatDateTime(version.created_at)}）\` : '' } 的内容覆盖当前配置，恢复后会生成一个新的版本快照。\`; okTex` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:84 |
| `message.success` | `已恢复版本` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:103 |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:105 |

### 源码中的提示文案

**Empty**

| 文案 | 位置 |
| --- | --- |
| `每次保存连接配置后会自动生成版本快照` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:137 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.mqtt.profiles.versions.list` | `projectId, connectionId` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:51 |
| `window.api.mqtt.profiles.versions.get` | `projectId, connectionId, versionId` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:69 |
| `window.api.mqtt.profiles.versions.restore` | `projectId, connectionId, version.version_id` | `src/renderer/src/components/mqtt/VersionDrawer.tsx`:95 |

> 返回 [组件索引](README.md)
