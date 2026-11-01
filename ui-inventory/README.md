# KindraAPI 前端 UI 全量清单

- 生成时间：2026-11-01T07:07:38.405Z
- 应用：KindraAPI v0.2.4
- 主项目：默认项目（`1a175dca3b49a64930001`）
- 采集驱动：playwright-core _electron；视口：1180x760 / 1440x900；主题：light
- 规模：101 个状态，15630 条 DOM/AX 元素记录，31 个弹窗/抽屉/菜单状态
- 浏览截图：[index.html](index.html)（按页面分组，可搜索筛选）

## 这份清单包含什么

- 8 个路由页 + 全局框架（TopBar / LeftNav / StatusBar）的全部可见控件。
- 每个按钮、菜单项、Tab、输入框、Tooltip、placeholder、空态、警告、表单校验、Toast/确认框。
- 每个控件的运行态选择器、尺寸位置、禁用/选中状态，以及对应源码 `file:line`。
- 双视口截图（1180×760 / 1440×900）与弹窗/抽屉裁切图。
- 可重构前后对比的基线（截图哈希、布局区域、设计令牌）。
- `inventory.json` 只保留控件/提示/树节点；完整原始 DOM/AX 转储在 `tools/.cache/inventory.raw.json`（本地，未入库）。

## 目录

```
ui-inventory/
├── README.md               ← 本文件
├── inventory.json          ← 机读清单（控件/提示/树节点；原始全量在 tools/.cache/inventory.raw.json）
├── observations.md         ← 重构观察（硬编码、重复、可访问性、风险）
├── pages/                  ← 8 个路由页的详细清单
├── components/             ← 每个组件的源码级控件/提示/IPC 清单
├── flows/                  ← 每个弹窗/抽屉/菜单状态的截图与控件
├── screenshots/
│   ├── webp/               ← 入库截图
│   └── png/                ← 本地原图（.gitignore）
├── baseline/               ← 重构对比基线
└── tools/                  ← 采集、静态扫描、文档生成脚本
```

## 页面索引

| 页面 | 路由 | 状态数 | 元素数 | 用途 |
| --- | --- | --- | --- | --- |
| [APIs 接口工作台](pages/apis.md) | `/apis` | 29 | 12197 | 接口树、请求编辑器、响应面板、环境选择、接口用例与版本管理。 |
| [最近 / 发送历史](pages/history.md) | `/history` | 11 | 270 | 最近发送记录、历史列表、响应详情抽屉与搜索/清空。 |
| [文档分享](pages/docs.md) | `/docs` | 10 | 734 | 分享列表、分享范围（项目/目录/接口/自定义）、分享服务配置。 |
| [字典 / 数据模型 / 数据库](pages/schemas.md) | `/schemas` | 16 | 744 | 数据字典、数据模型编辑器、MySQL 连接与表结构导入。 |
| [MQTT 模块](pages/mqtt.md) | `/mqtt` | 13 | 997 | 连接配置、消息、发布、运行记录、版本历史、TLS/Will/MQTT5 属性。 |
| [流程自动化](pages/automation.md) | `/automation` | 7 | 122 | 流程列表、事件编排、运行结果与历史运行。 |
| [Git 版本管理](pages/git.md) | `/git` | 4 | 115 | 工作区变更/未跟踪、差异、提交、分支、远程与同步。 |
| [设置](pages/settings.md) | `/settings` | 8 | 446 | 环境与请求前缀、全局变量、发送设置、MCP 服务、调试设置。 |

## 全局框架

| 状态 | 类型 | 截图 |
| --- | --- | --- |
| `chrome-project-menu` | menu | [WebP](screenshots/webp/chrome-project-menu.webp) |
| `chrome-tooltip-git` | tooltip | [WebP](screenshots/webp/chrome-tooltip-git.webp) |
| `chrome-tooltip-trash` | tooltip | [WebP](screenshots/webp/chrome-tooltip-trash.webp) |

- 页面文档：[全局框架](pages/global.md)
- 源码：`src/renderer/src/App.tsx`、`src/renderer/src/components/TopBar.tsx`、`src/renderer/src/components/LeftNav.tsx`、`src/renderer/src/components/StatusBar.tsx`
- 组件文档：[TopBar.tsx](components/TopBar.md)、[LeftNav.tsx](components/LeftNav.md)、[StatusBar.tsx](components/StatusBar.md)

## 组件索引

| 组件 | 源码 | 控件 | 提示 | 菜单 | IPC |
| --- | --- | --- | --- | --- | --- |
| [ApiDescriptionDialog.tsx](components/ApiDescriptionDialog.md) | `src/renderer/src/components/ApiDescriptionDialog.tsx` | 34 | 0 | 4 | 0 |
| [ApiTree.tsx](components/ApiTree.md) | `src/renderer/src/components/ApiTree.tsx` | 81 | 11 | 29 | 0 |
| [CasesEditor.tsx](components/CasesEditor.md) | `src/renderer/src/components/CasesEditor.tsx` | 64 | 5 | 16 | 2 |
| [CodeGenDialog.tsx](components/CodeGenDialog.md) | `src/renderer/src/components/CodeGenDialog.tsx` | 18 | 3 | 17 | 4 |
| [DesignEditor.tsx](components/DesignEditor.md) | `src/renderer/src/components/DesignEditor.tsx` | 18 | 0 | 0 | 0 |
| [DocShareDialog.tsx](components/DocShareDialog.md) | `src/renderer/src/components/DocShareDialog.tsx` | 49 | 5 | 6 | 2 |
| [DocShareLinkDialog.tsx](components/DocShareLinkDialog.md) | `src/renderer/src/components/DocShareLinkDialog.tsx` | 17 | 4 | 0 | 4 |
| [EnvironmentModal.tsx](components/EnvironmentModal.md) | `src/renderer/src/components/EnvironmentModal.tsx` | 124 | 18 | 10 | 11 |
| [FieldRulesEditor.tsx](components/FieldRulesEditor.md) | `src/renderer/src/components/FieldRulesEditor.tsx` | 21 | 0 | 7 | 0 |
| [JsonFieldTable.tsx](components/JsonFieldTable.md) | `src/renderer/src/components/JsonFieldTable.tsx` | 77 | 5 | 15 | 0 |
| [LeftNav.tsx](components/LeftNav.md) | `src/renderer/src/components/LeftNav.tsx` | 24 | 1 | 5 | 0 |
| [ParamTable.tsx](components/ParamTable.md) | `src/renderer/src/components/ParamTable.tsx` | 39 | 1 | 2 | 2 |
| [RequestEditor.tsx](components/RequestEditor.md) | `src/renderer/src/components/RequestEditor.tsx` | 100 | 14 | 23 | 6 |
| [ResponsePanel.tsx](components/ResponsePanel.md) | `src/renderer/src/components/ResponsePanel.tsx` | 136 | 9 | 1 | 5 |
| [StatusBar.tsx](components/StatusBar.md) | `src/renderer/src/components/StatusBar.tsx` | 9 | 0 | 0 | 0 |
| [TargetEditScope.tsx](components/TargetEditScope.md) | `src/renderer/src/components/TargetEditScope.tsx` | 1 | 0 | 0 | 0 |
| [TargetSyncGuard.tsx](components/TargetSyncGuard.md) | `src/renderer/src/components/TargetSyncGuard.tsx` | 7 | 1 | 0 | 0 |
| [TargetVersionDrawer.tsx](components/TargetVersionDrawer.md) | `src/renderer/src/components/TargetVersionDrawer.tsx` | 27 | 6 | 0 | 3 |
| [TopBar.tsx](components/TopBar.md) | `src/renderer/src/components/TopBar.tsx` | 28 | 6 | 3 | 1 |
| [AttemptsPanel.tsx](components/mqtt-AttemptsPanel.md) | `src/renderer/src/components/mqtt/AttemptsPanel.tsx` | 18 | 7 | 3 | 3 |
| [MessagesPanel.tsx](components/mqtt-MessagesPanel.md) | `src/renderer/src/components/mqtt/MessagesPanel.tsx` | 78 | 17 | 2 | 7 |
| [ProfileEditor.tsx](components/mqtt-ProfileEditor.md) | `src/renderer/src/components/mqtt/ProfileEditor.tsx` | 207 | 5 | 16 | 2 |
| [ProfileList.tsx](components/mqtt-ProfileList.md) | `src/renderer/src/components/mqtt/ProfileList.tsx` | 37 | 3 | 4 | 0 |
| [PublishPanel.tsx](components/mqtt-PublishPanel.md) | `src/renderer/src/components/mqtt/PublishPanel.tsx` | 64 | 15 | 3 | 18 |
| [UserPropertiesEditor.tsx](components/mqtt-UserPropertiesEditor.md) | `src/renderer/src/components/mqtt/UserPropertiesEditor.tsx` | 12 | 0 | 1 | 0 |
| [VersionDrawer.tsx](components/mqtt-VersionDrawer.md) | `src/renderer/src/components/mqtt/VersionDrawer.tsx` | 39 | 6 | 0 | 3 |
| [mqttUtils.ts](components/mqtt-mqttUtils.md) | `src/renderer/src/components/mqtt/mqttUtils.ts` | 0 | 0 | 4 | 2 |
| [DatabasePanel.tsx](components/schemas-DatabasePanel.md) | `src/renderer/src/components/schemas/DatabasePanel.tsx` | 104 | 11 | 15 | 7 |
| [DictionaryPanel.tsx](components/schemas-DictionaryPanel.md) | `src/renderer/src/components/schemas/DictionaryPanel.tsx` | 39 | 9 | 6 | 5 |
| [DictionarySuggest.tsx](components/schemas-DictionarySuggest.md) | `src/renderer/src/components/schemas/DictionarySuggest.tsx` | 7 | 0 | 1 | 2 |
| [ModelEditor.tsx](components/schemas-ModelEditor.md) | `src/renderer/src/components/schemas/ModelEditor.tsx` | 61 | 12 | 0 | 5 |
| [ModelPickerModal.tsx](components/schemas-ModelPickerModal.md) | `src/renderer/src/components/schemas/ModelPickerModal.tsx` | 13 | 1 | 0 | 4 |
| [ModelsListPanel.tsx](components/schemas-ModelsListPanel.md) | `src/renderer/src/components/schemas/ModelsListPanel.tsx` | 22 | 0 | 17 | 0 |
| [SchemaFieldEditor.tsx](components/schemas-SchemaFieldEditor.md) | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx` | 65 | 0 | 11 | 0 |
| [modelDocumentation.ts](components/schemas-modelDocumentation.md) | `src/renderer/src/components/schemas/modelDocumentation.ts` | 0 | 0 | 0 | 2 |
| [modelUtils.ts](components/schemas-modelUtils.md) | `src/renderer/src/components/schemas/modelUtils.ts` | 0 | 0 | 0 | 0 |

## 交互流索引

### APIs 接口工作台

- [apis-more-menu](flows/apis-more-menu.md)（menu，1180×760）
- [apis-dialog-codegen](flows/apis-dialog-codegen.md)（dialog，1180×760）
- [apis-drawer-versions](flows/apis-drawer-versions.md)（drawer，1180×760）
- [apis-dialog-description](flows/apis-dialog-description.md)（dialog，1180×760）
- [apis-dialog-share](flows/apis-dialog-share.md)（dialog，1180×760）

### 最近 / 发送历史

- [history-detail-drawer](flows/history-detail-drawer.md)（drawer，1180×760）
- [history-drawer-tab-headers](flows/history-drawer-tab-headers.md)（drawer-tab，1180×760）
- [history-drawer-tab-cookie](flows/history-drawer-tab-cookie.md)（drawer-tab，1180×760）
- [history-drawer-tab-example](flows/history-drawer-tab-example.md)（drawer-tab，1180×760）
- [history-drawer-tab-field-docs](flows/history-drawer-tab-field-docs.md)（drawer-tab，1180×760）
- [history-drawer-tab-actual-request](flows/history-drawer-tab-actual-request.md)（drawer-tab，1180×760）
- [history-drawer-tab-console](flows/history-drawer-tab-console.md)（drawer-tab，1180×760）
- [history-confirm-clear](flows/history-confirm-clear.md)（confirm，1180×760）

### 文档分享

- [docs-dialog-new-share](flows/docs-dialog-new-share.md)（dialog，1180×760）
- [docs-new-share-tab-project](flows/docs-new-share-tab-project.md)（dialog-tab，1180×760）
- [docs-new-share-tab-folder](flows/docs-new-share-tab-folder.md)（dialog-tab，1180×760）
- [docs-new-share-tab-api](flows/docs-new-share-tab-api.md)（dialog-tab，1180×760）
- [docs-new-share-tab-custom](flows/docs-new-share-tab-custom.md)（dialog-tab，1180×760）
- [docs-dialog-share-service](flows/docs-dialog-share-service.md)（dialog，1180×760）

### 字典 / 数据模型 / 数据库

- [schemas-dictionary-new-field](flows/schemas-dictionary-new-field.md)（dialog，1180×760）
- [schemas-dialog-db-connection](flows/schemas-dialog-db-connection.md)（dialog，1180×760）
- [schemas-dialog-db-connection-filled](flows/schemas-dialog-db-connection-filled.md)（dialog，1180×760）
- [schemas-dialog-import-tables](flows/schemas-dialog-import-tables.md)（dialog，1180×760）

### MQTT 模块

- [mqtt-more-menu](flows/mqtt-more-menu.md)（menu，1180×760）
- [mqtt-drawer-versions](flows/mqtt-drawer-versions.md)（drawer，1180×760）

### 流程自动化

- [automation-event-menu](flows/automation-event-menu.md)（menu，1180×760）

### Git 版本管理

- [git-dialog-branches](flows/git-dialog-branches.md)（dialog，1180×760）
- [git-dialog-remotes](flows/git-dialog-remotes.md)（dialog，1180×760）

### 全局框架

- [chrome-project-menu](flows/chrome-project-menu.md)（menu，1180×760）
- [chrome-tooltip-git](flows/chrome-tooltip-git.md)（tooltip，1180×760）
- [chrome-tooltip-trash](flows/chrome-tooltip-trash.md)（tooltip，1180×760）

## 重构观察与基线

- [observations.md](observations.md)：硬编码颜色、内联样式、图标按钮可访问性、重复文案、高密度页面。
- [baseline/README.md](baseline/README.md)：截图哈希、布局区域、设计令牌对比方法。

## 如何重跑

```bash
npm run build
cp ui-inventory/tools/.env.example ui-inventory/.env.local   # 填 MySQL 只读连接
npm run ui:inventory                # 全量采集 + WebP + inventory.json
node ui-inventory/tools/generate-docs.mjs   # 重新生成本目录
```

可选参数：`--only=apis`、`--merge`、`--no-webp`、`--max-screens=20`。

## 安全与数据说明

- 采集使用 `KINDRAAPI_USER_DATA` 指向 `ui-inventory/.user-data/` 的临时副本；真实 userData 目录只读复制，未被写入。
- 临时副本会关闭固定 CDP 端口（避开你正在运行的 9222 实例），并重写 `offline-projects.json` 只指向副本。
- 截图来自主项目真实数据，可能包含接口名、URL、项目 ID、请求体等内容；对外分享前请先脱敏或改用空数据重跑。
- MySQL 仅做表结构 introspection 与 SELECT；连接参数放在 `ui-inventory/.env.local`（已在 `.gitignore`）。

## REA 说明

- REA `capture-electron-scenario` 的动作只有 `click / wait / renderer-reload / renderer-crash / deep-link`，输出 IPC 时间线，不产出截图，因此截图与 DOM/AX 由 Playwright Electron 驱动完成。
- 详细 IPC 证据见 [rea-ipc-evidence.md](rea-ipc-evidence.md)（原始 JSON 在 `baseline/rea/`）。
