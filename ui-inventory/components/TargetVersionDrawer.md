# 组件：TargetVersionDrawer.tsx

- 源码：`src/renderer/src/components/TargetVersionDrawer.tsx`
- 行数：193
- 静态统计：JSX 27 / 提示 6 / 菜单 0 / Tooltip 0 / Placeholder 1 / IPC 3

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Drawer` | `版本管理${targetName ? ` · ${targetName}` : ''}` | open=open width=480 title=`版本管理${targetName ? ` · ${targetName}` : ''}` | `src/renderer/src/components/TargetVersionDrawer.tsx`:103 |
| `TagOutlined` | — | — | `src/renderer/src/components/TargetVersionDrawer.tsx`:125 |
| `Empty` | — | description=tab === 'tags' ? '暂无 Tag 版本，可在历史记录中为版本打 Tag' : '暂无版本记录，保存接口后会自动生成' | `src/renderer/src/components/TargetVersionDrawer.tsx`:136 |
| `Tag` | item.label | — | `src/renderer/src/components/TargetVersionDrawer.tsx`:150 |
| `Button` | item.label ? '改 Tag' : '标记 Tag' | size=small | `src/renderer/src/components/TargetVersionDrawer.tsx`:160 |
| `Button` | 恢复 | size=small type=primary | `src/renderer/src/components/TargetVersionDrawer.tsx`:163 |
| `Modal` | tagging?.label ? '修改 Tag' : '标记 Tag 版本' | open=Boolean(tagging) title=tagging?.label ? '修改 Tag' : '标记 Tag 版本' okText=保存 cancelText=取消 | `src/renderer/src/components/TargetVersionDrawer.tsx`:172 |
| `Input` | 例如：v1.0 发布候选（留空则移除 Tag） | value=tagLabel placeholder=例如：v1.0 发布候选（留空则移除 Tag） | `src/renderer/src/components/TargetVersionDrawer.tsx`:181 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | item.label ? '改 Tag' : '标记 Tag' | size=small | `src/renderer/src/components/TargetVersionDrawer.tsx`:160 |
| Button | 恢复 | size=small type=primary | `src/renderer/src/components/TargetVersionDrawer.tsx`:163 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `result.error` | `src/renderer/src/components/TargetVersionDrawer.tsx`:42 |
| `modal.confirm` | `title=\`恢复到 v${version.version}？\`; content=当前未保存的内容会被该版本覆盖，并生成一条新的恢复记录。; okText=恢复; cancelText=取消` | `src/renderer/src/components/TargetVersionDrawer.tsx`:56 |
| `message.error` | `result.error` | `src/renderer/src/components/TargetVersionDrawer.tsx`:68 |
| `message.success` | `\`已恢复到 v${version.version}\`` | `src/renderer/src/components/TargetVersionDrawer.tsx`:72 |
| `message.error` | `result.error` | `src/renderer/src/components/TargetVersionDrawer.tsx`:92 |
| `message.success` | `tagLabel.trim() ? 'Tag 已保存' : 'Tag 已移除'` | `src/renderer/src/components/TargetVersionDrawer.tsx`:96 |

### 源码中的提示文案

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `例如：v1.0 发布候选（留空则移除 Tag）` | `src/renderer/src/components/TargetVersionDrawer.tsx`:185 |

**Empty**

| 文案 | 位置 |
| --- | --- |
| `tab === 'tags' ? '暂无 Tag 版本，可在历史记录中为版本打 Tag' : '暂无版本记录，保存接口后会自动生成'` | `src/renderer/src/components/TargetVersionDrawer.tsx`:136 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.targets.versions.list` | `projectId, targetId` | `src/renderer/src/components/TargetVersionDrawer.tsx`:40 |
| `window.api.targets.versions.restore` | `projectId, targetId, version.version_id` | `src/renderer/src/components/TargetVersionDrawer.tsx`:62 |
| `window.api.targets.versions.tag` | `projectId, targetId, tagging.version_id, tagLabel.trim()` | `src/renderer/src/components/TargetVersionDrawer.tsx`:85 |

> 返回 [组件索引](README.md)
