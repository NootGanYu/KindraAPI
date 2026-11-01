# 组件：ProfileList.tsx

- 源码：`src/renderer/src/components/mqtt/ProfileList.tsx`
- 行数：259
- 静态统计：JSX 37 / 提示 3 / 菜单 4 / Tooltip 1 / Placeholder 1 / IPC 0

## JSX 控件（含行号）

| 标签 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| `Input` | 搜索名称或主机 | size=small placeholder=搜索名称或主机 value=query | `src/renderer/src/components/mqtt/ProfileList.tsx`:141 |
| `Empty` | — | description=<span className="muted">还没有 MQTT 连接，先新建一个</span> | `src/renderer/src/components/mqtt/ProfileList.tsx`:158 |
| `Button` | 新建连接 | type=primary size=small | `src/renderer/src/components/mqtt/ProfileList.tsx`:164 |
| `Dropdown` | — | — | `src/renderer/src/components/mqtt/ProfileList.tsx`:191 |
| `Dropdown` | — | — | `src/renderer/src/components/mqtt/ProfileList.tsx`:211 |
| `Tooltip` | 新建 MQTT 连接 | title=新建 MQTT 连接 | `src/renderer/src/components/mqtt/ProfileList.tsx`:244 |
| `Button` | 新建连接 | type=primary loading=busy | `src/renderer/src/components/mqtt/ProfileList.tsx`:245 |

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 新建连接 | type=primary size=small | `src/renderer/src/components/mqtt/ProfileList.tsx`:164 |
| Button | 新建连接 | type=primary loading=busy | `src/renderer/src/components/mqtt/ProfileList.tsx`:245 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `errorMessage(error)` | `src/renderer/src/components/mqtt/ProfileList.tsx`:94 |
| `modal.confirm` | `title=\`删除连接「${profile.name}」？\`; content=连接配置、版本历史与本地消息记录都会被删除，此操作不可撤销。; okText=删除; cancelText=取消` | `src/renderer/src/components/mqtt/ProfileList.tsx`:101 |
| `modal.confirm` | `title=导出连接配置？; content=该文件包含明文凭据（用户名、密码、TLS 私钥口令等），请妥善保管。; okText=继续导出; cancelText=取消` | `src/renderer/src/components/mqtt/ProfileList.tsx`:112 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `编辑` | `edit` | — | `src/renderer/src/components/mqtt/ProfileList.tsx`:123 |
| `复制` | `clone` | — | `src/renderer/src/components/mqtt/ProfileList.tsx`:124 |
| `导出` | `export` | — | `src/renderer/src/components/mqtt/ProfileList.tsx`:125 |
| `删除` | `delete` | — | `src/renderer/src/components/mqtt/ProfileList.tsx`:127 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `新建 MQTT 连接` | `src/renderer/src/components/mqtt/ProfileList.tsx`:244 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `搜索名称或主机` | `src/renderer/src/components/mqtt/ProfileList.tsx`:145 |

**Empty**

| 文案 | 位置 |
| --- | --- |
| `<span className="muted">还没有 MQTT 连接，先新建一个</span>` | `src/renderer/src/components/mqtt/ProfileList.tsx`:158 |

### 快捷键 / 键盘处理

| 表达式 | 位置 |
| --- | --- |
| `event.key === 'Enter'` | `src/renderer/src/components/mqtt/ProfileList.tsx`:202 |

> 返回 [组件索引](README.md)
