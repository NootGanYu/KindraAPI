# 组件：TargetSyncGuard.tsx

- 源码：`src/renderer/src/components/TargetSyncGuard.tsx`
- 行数：29
- 静态统计：JSX 7 / 提示 1 / 菜单 0 / Tooltip 0 / Placeholder 0 / IPC 0

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Modal` | deleted ? '接口已被删除' : '接口已更新，保存前请选择' | open=!!conflict title=deleted ? '接口已被删除' : '接口已更新，保存前请选择' closable=!busy maskClosable=false | `src/renderer/src/components/TargetSyncGuard.tsx`:14 |
| `Button` | 保留草稿 | disabled=busy | `src/renderer/src/components/TargetSyncGuard.tsx`:18 |
| `Button` | 另存为新接口 | type=primary loading=busy | `src/renderer/src/components/TargetSyncGuard.tsx`:19 |
| `Button` | 放弃本地修改，加载最新版 | disabled=busy | `src/renderer/src/components/TargetSyncGuard.tsx`:23 |
| `Button` | 确认用本地内容覆盖最新版 | danger=true loading=busy | `src/renderer/src/components/TargetSyncGuard.tsx`:24 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 保留草稿 | disabled=busy | `src/renderer/src/components/TargetSyncGuard.tsx`:18 |
| Button | 另存为新接口 | type=primary loading=busy | `src/renderer/src/components/TargetSyncGuard.tsx`:19 |
| Button | 放弃本地修改，加载最新版 | disabled=busy | `src/renderer/src/components/TargetSyncGuard.tsx`:23 |
| Button | 确认用本地内容覆盖最新版 | danger=true loading=busy | `src/renderer/src/components/TargetSyncGuard.tsx`:24 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/TargetSyncGuard.tsx`:12 |

> 返回 [组件索引](README.md)
