# 全局框架

- 路由：`/global`
- 用途：顶栏、左侧导航、状态栏、项目菜单与全局 Tooltip。
- 采集状态：3 个；DOM/AX 元素合计：5
- 主要源码：`src/renderer/src/App.tsx`、`src/renderer/src/components/TopBar.tsx`、`src/renderer/src/components/LeftNav.tsx`、`src/renderer/src/components/StatusBar.tsx`

## 状态截图

| 状态 | 类型 | 视口 | 元素数 | 截图 |
| --- | --- | --- | --- | --- |
| `chrome-project-menu` | menu | 1180×760 | 3 | [WebP](../screenshots/webp/chrome-project-menu.webp) |
| `chrome-tooltip-git` | tooltip | 1180×760 | 1 | [WebP](../screenshots/webp/chrome-tooltip-git.webp) |
| `chrome-tooltip-trash` | tooltip | 1180×760 | 1 | [WebP](../screenshots/webp/chrome-tooltip-trash.webp) |

## 布局区域（1180×760 基准）

| 区域 | x | y | width | height |
| --- | --- | --- | --- | --- |
| `topbar` | 0 | 0 | 1180 | 44 |
| `rail` | 0 | 44 | 50 | 716 |
| `main` | 50 | 44 | 1130 | 716 |

## 控件全量清单

| 区块 | 控件文案 / aria / icon | 类型 | 状态 | 位置 | 来源状态 |
| --- | --- | --- | --- | --- | --- |
| 页面 | 默认项目 | `li/menuitem` | disabled | 473,37 · 154×30 | `chrome-project-menu` |
| 页面 | 新建项目 | `li/menuitem` | — | 473,76 · 154×30 | `chrome-project-menu` |
| 页面 | 导入项目（后续支持） | `li/menuitem` | — | 473,106 · 154×30 | `chrome-project-menu` |
| 页面 | Git 版本管理 | `div/tooltip` | — | 0,358 · 90×33 | `chrome-tooltip-git` |
| 页面 | 回收站（后续支持） | `div/tooltip` | — | 0,669 · 133×33 | `chrome-tooltip-trash` |

## 菜单 / 下拉项（运行态）

| 所在区域 | 菜单文案 | 类型 | 状态 | 选择器 |
| --- | --- | --- | --- | --- |
| 菜单 | 默认项目 | `li` | disabled | `div:nth-of-type(2) > div.ant-dropdown.css-dzyqf7 > ul.ant-dropdown-menu.ant-dropdown-menu-root > li.ant-dropdown-menu-item.ant-dropdown-menu-item-disabled:nth-of-type(1)` |
| 菜单 | 新建项目 | `li` | — | `div:nth-of-type(2) > div.ant-dropdown.css-dzyqf7 > ul.ant-dropdown-menu.ant-dropdown-menu-root > li.ant-dropdown-menu-item.ant-dropdown-menu-item-only-child:nth-of-type(3)` |
| 菜单 | 导入项目（后续支持） | `li` | — | `div:nth-of-type(2) > div.ant-dropdown.css-dzyqf7 > ul.ant-dropdown-menu.ant-dropdown-menu-root > li.ant-dropdown-menu-item.ant-dropdown-menu-item-only-child:nth-of-type(4)` |

## 提示、空态与错误

**可见 Tooltip**

- Git 版本管理
- 回收站（后续支持）

## 源码静态清单（含 file:line）

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 保存后关闭 | loading=saving | `src/renderer/src/App.tsx`:88 |
| Button | 取消 |  | `src/renderer/src/App.tsx`:95 |
| Button | 放弃并关闭 | danger=true | `src/renderer/src/App.tsx`:96 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `(error as Error).message` | `src/renderer/src/App.tsx`:68 |
| `message.info` | `回收站将在后续里程碑支持` | `src/renderer/src/components/LeftNav.tsx`:62 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/TopBar.tsx`:45 |
| `message.warning` | `请输入项目名称` | `src/renderer/src/components/TopBar.tsx`:52 |
| `message.success` | `项目已创建` | `src/renderer/src/components/TopBar.tsx`:59 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/TopBar.tsx`:61 |
| `message.info` | `导入项目将在后续里程碑支持` | `src/renderer/src/components/TopBar.tsx`:97 |
| `message.error` | `error.message` | `src/renderer/src/components/TopBar.tsx`:98 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `最近` | `` | — | `src/renderer/src/components/LeftNav.tsx`:15 |
| `APIs` | `` | — | `src/renderer/src/components/LeftNav.tsx`:16 |
| `文档` | `` | — | `src/renderer/src/components/LeftNav.tsx`:17 |
| `字典` | `` | — | `src/renderer/src/components/LeftNav.tsx`:18 |
| `MQTT` | `` | — | `src/renderer/src/components/LeftNav.tsx`:19 |
| `item.name` | `item.project_id` | `item.project_id === project?.project_id` | `src/renderer/src/components/TopBar.tsx`:66 |
| `新建项目` | `__new` | — | `src/renderer/src/components/TopBar.tsx`:72 |
| `导入项目（后续支持）` | `__import` | — | `src/renderer/src/components/TopBar.tsx`:73 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `Git 版本管理` | `src/renderer/src/components/LeftNav.tsx`:38 |
| `回收站（后续支持）` | `src/renderer/src/components/LeftNav.tsx`:59 |
| `刷新项目` | `src/renderer/src/components/TopBar.tsx`:110 |
| `mcpStatus?.error ? \`MCP：${mcpStatus.error}\` : mcpStatus?.running ? \`MCP 运行中 · ${mcpStatus.host}:${mc` | `src/renderer/src/components/TopBar.tsx`:121 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `项目名称` | `src/renderer/src/components/TopBar.tsx`:154 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.app.onRequestClose` | `() => { const dirty = useApp.getState().tabs.filter((tab) => tab.dirty) if (dirty.length === 0) {` | `src/renderer/src/App.tsx`:51 |
| `window.api.app.confirmClose` | `` | `src/renderer/src/App.tsx`:54 |
| `window.api.app.confirmClose` | `` | `src/renderer/src/App.tsx`:66 |
| `window.api.app.confirmClose` | `` | `src/renderer/src/App.tsx`:99 |
| `window.api.app.openPath` | `paths.projectRoot` | `src/renderer/src/components/TopBar.tsx`:33 |

> 返回 [总索引](../README.md)
