# 重构观察（observations）

> 本文件是“重构观察”，与事实清单分离。清单本身不包含主观判断；这里的每条判断尽量附证据。

## 总览指标

| 指标 | 数值 |
| --- | --- |
| 采集状态数 | 101 |
| DOM/AX 元素条目 | 15630 |
| 源码提示/确认框 | 303 |
| 源码 Tooltip | 49 |
| 源码 Placeholder | 136 |
| 源码 Empty | 25 |
| 源码 IPC 调用 | 233 |
| 内联 style={{}} | 379 |
| 硬编码颜色（十六进制） | 94 |
| 图标按钮缺 aria-label | 25 |

## 值得在重构中优先处理

| 观察 | 说明 | 证据 |
| --- | --- | --- |
| 模式占位与真实功能混在一起 | APIs 的「设计 / 一键压测 / Mock」当前是 `ModePlaceholder` 说明页，界面却与「调试」并列为主 Tab，重构时容易让用户误以为功能完整。 | `src/renderer/src/pages/ApisPage.tsx:803` |
| 请求编辑器 Tab 中英混用 | `Header / Query / Path / Body` 与 `认证 / Cookie / 预执行操作 / 后执行操作` 混排，重构时可统一为中文或统一为英文。 | `src/renderer/src/components/RequestEditor.tsx:35` |
| 文档分享服务启动失败 | 本次采集中 Docs 页显示「分享服务 异常」，分享服务弹窗提示启动失败；重构前需要先确认端口/权限/防火墙策略。 | `screenshots/webp/docs-list-1180x760.webp · docs-dialog-share-service.webp` |
| 数据库凭据明文存储 | 数据库管理页明确提示“凭据明文存储，不会同步给团队”；重构 UI 时建议把风险提示做成更显眼的警示块，而不是普通说明文字。 | `src/renderer/src/components/schemas/DatabasePanel.tsx:292` |
| 大量“后续里程碑”占位 | 回收站、导入项目、复制/粘贴、msgpack、部分接口模式等仍是占位提示；重构时应统一占位样式与文案，避免看起来像坏掉的按钮。 | `src/renderer/src/components/LeftNav.tsx / TopBar.tsx / RequestEditor.tsx` |
| 颜色来源有两套 | `theme.ts` 的 palette 与 `global.css` 的 CSS 变量并存，且组件里仍有硬编码色值（如 `#2f8f62`、`#1f9e7c`、`#ff583e`）。重构设计系统时应收敛为单一 token 源。 | `src/renderer/src/theme.ts · src/renderer/src/styles/global.css · src/renderer/src/App.tsx` |
| 图标按钮可访问性不足 | 检测到 25 处 Button 既无文本也无 aria-label/title；纯图标工具栏在键盘与读屏下难以识别。 | `见下方“图标按钮缺 aria-label”` |
| 提示文案分散 | 源码中 303 条 message/Modal 文案、49 个 Tooltip、136 个 Placeholder 分散在各组件，缺少统一 copy 层，重构时容易漏改。 | `见 components/*.md` |
| 高密度页面 | APIs 调试工作台单状态 500+ 个 DOM/AX 条目，重构时建议拆分面板与延迟渲染，降低一次渲染的控件数量。 | `apis-response-tab-field-docs(725) apis-request-tab-header(534) apis-editor-debug-1180x760(527) ` |
| 真实数据截图含敏感信息 | 截图来自主项目真实数据，包含接口名、URL、项目 ID、请求体等；如需对外分享，请先脱敏或改用空数据/演示数据模式重跑。 | `ui-inventory/screenshots/webp/` |

## 图标按钮缺 aria-label

| 文件 | 行号 | 属性 |
| --- | --- | --- |
| `src/renderer/src/components/ApiTree.tsx` | 357 | `size=small type=text` |
| `src/renderer/src/components/ApiTree.tsx` | 366 | `size=small type=text` |
| `src/renderer/src/components/CasesEditor.tsx` | 456 | `size=small type=text danger=true` |
| `src/renderer/src/components/DesignEditor.tsx` | 71 | `size=small type=text danger=true` |
| `src/renderer/src/components/EnvironmentModal.tsx` | 434 | `type=text` |
| `src/renderer/src/components/EnvironmentModal.tsx` | 513 | `type=text` |
| `src/renderer/src/components/EnvironmentModal.tsx` | 597 | `type=text` |
| `src/renderer/src/components/EnvironmentModal.tsx` | 876 | `type=text danger=true` |
| `src/renderer/src/components/mqtt/AttemptsPanel.tsx` | 207 | `size=small` |
| `src/renderer/src/components/mqtt/MessagesPanel.tsx` | 298 | `size=small` |
| `src/renderer/src/components/mqtt/ProfileEditor.tsx` | 566 | `type=text danger=true` |
| `src/renderer/src/components/mqtt/UserPropertiesEditor.tsx` | 53 | `size=small type=text danger=true` |
| `src/renderer/src/components/schemas/ModelsListPanel.tsx` | 210 | `—` |
| `src/renderer/src/pages/AutomationPage.tsx` | 273 | `size=small type=text` |
| `src/renderer/src/pages/AutomationPage.tsx` | 352 | `danger=true type=text` |
| `src/renderer/src/pages/AutomationPage.tsx` | 548 | `size=small type=text` |
| `src/renderer/src/pages/AutomationPage.tsx` | 552 | `size=small type=text danger=true` |
| `src/renderer/src/pages/AutomationPage.tsx` | 743 | `size=small type=text danger=true` |
| `src/renderer/src/pages/GitPage.tsx` | 959 | `size=small danger=true` |
| `src/renderer/src/pages/GitPage.tsx` | 1007 | `danger=true` |
| `src/renderer/src/pages/HistoryPage.tsx` | 125 | `size=small type=text` |
| `src/renderer/src/pages/HistoryPage.tsx` | 136 | `size=small type=text danger=true` |
| `src/renderer/src/pages/MqttPage.tsx` | 483 | `size=small type=text` |
| `src/renderer/src/pages/SettingsPage.tsx` | 428 | `—` |
| `src/renderer/src/pages/SettingsPage.tsx` | 699 | `size=small type=text` |

## 小尺寸控件（高度 < 24px）

| 状态 | 标签 | 文案 | 高度 |
| --- | --- | --- | --- |
| `history-list-1180x760` | `input` | 搜索接口或 URL | 21px |
| `history-list-1180x760` | `button` | 刷新 | 23px |
| `history-list-1180x760` | `button` | 清空 | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-export | 23px |
| `history-list-1180x760` | `button` | anticon-delete | 23px |
| `history-list-1180x760` | `button` | anticon-left | 23px |
| `history-list-1180x760` | `button` | anticon-right | 23px |
| `history-list-1440x900` | `input` | 搜索接口或 URL | 21px |
| `history-list-1440x900` | `button` | 刷新 | 23px |
| `history-list-1440x900` | `button` | 清空 | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |
| `history-list-1440x900` | `button` | anticon-export | 23px |
| `history-list-1440x900` | `button` | anticon-delete | 23px |

## 无标签输入框

| 状态 | 类型 | 选择器 |
| --- | --- | --- |
| `apis-editor-debug-1180x760` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-editor-debug-1440x900` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-mode-design` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-mode-cases` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-mode-stress` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-mode-mock` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-request-tab-header` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-request-tab-query` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-request-tab-path` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-request-tab-body` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-request-tab-auth` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-request-tab-cookie` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-request-tab-pre-request` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-request-tab-post-request` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-response-tab-response` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-response-tab-headers` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-response-tab-example` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-response-tab-field-docs` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-response-tab-field-docs` | `text` | `div.json-field-panel > div.json-field-table:nth-of-type(2) > div.json-field-row:nth-of-type(2) > div.json-field-cell.json-field-value:nth-of-type(2) > div > input.ant-input.css-dzyqf7` |
| `apis-response-tab-field-docs` | `text` | `div.json-field-panel > div.json-field-table:nth-of-type(2) > div.json-field-row:nth-of-type(3) > div.json-field-cell.json-field-value:nth-of-type(2) > div > input.ant-input.css-dzyqf7` |
| `apis-response-tab-field-docs` | `text` | `div.json-field-panel > div.json-field-table:nth-of-type(2) > div.json-field-row:nth-of-type(19) > div.json-field-cell.json-field-value:nth-of-type(2) > div > input.ant-input.css-dzyqf7` |
| `apis-response-tab-field-docs` | `text` | `div.json-field-panel > div.json-field-table:nth-of-type(2) > div.json-field-row:nth-of-type(20) > div.json-field-cell.json-field-value:nth-of-type(2) > div > input.ant-input.css-dzyqf7` |
| `apis-response-tab-field-docs` | `text` | `div.json-field-panel > div.json-field-table:nth-of-type(2) > div.json-field-row:nth-of-type(21) > div.json-field-cell.json-field-value:nth-of-type(2) > div > input.ant-input.css-dzyqf7` |
| `apis-response-tab-field-docs` | `text` | `div.json-field-panel > div.json-field-table:nth-of-type(2) > div.json-field-row:nth-of-type(22) > div.json-field-cell.json-field-value:nth-of-type(2) > div > input.ant-input.css-dzyqf7` |
| `apis-response-tab-field-docs` | `text` | `div.json-field-panel > div.json-field-table:nth-of-type(2) > div.json-field-row:nth-of-type(25) > div.json-field-cell.json-field-value:nth-of-type(2) > div > input.ant-input.css-dzyqf7` |
| `apis-response-tab-actual-request` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-response-tab-console` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `apis-empty-search` | `text` | `div.api-workspace > div.surface:nth-of-type(2) > div.mode-row:nth-of-type(1) > div.api-meta:nth-of-type(2) > span.api-name:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `docs-new-share-tab-folder` | `search` | `input#rc_select_33` |
| `docs-new-share-tab-api` | `search` | `input#rc_select_33` |
| `docs-dialog-share-service` | `—` | `div.ant-modal-body:nth-of-type(2) > div.docs-form > div.docs-field:nth-of-type(2) > div.ant-input-number.css-dzyqf7:nth-of-type(1) > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `schemas-model-add-field` | `search` | `input#rc_select_39` |
| `schemas-model-add-field` | `search` | `input#rc_select_41` |
| `mqtt-profile-editor-1180x760` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(1) > input.ant-input.css-dzyqf7` |
| `mqtt-profile-editor-1180x760` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-profile-editor-1180x760` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(7) > input.ant-input.css-dzyqf7` |
| `mqtt-profile-editor-1180x760` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(8) > input.ant-input.css-dzyqf7` |
| `mqtt-profile-editor-1180x760` | `password` | `div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(9) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-profile-editor-1180x760` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(10) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-profile-editor-1180x760` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(11) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-profile-editor-1180x760` | `password` | `div.ant-collapse-content-box > div.mqtt-collapse-body > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-profile-editor-1440x900` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(1) > input.ant-input.css-dzyqf7` |
| `mqtt-profile-editor-1440x900` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-profile-editor-1440x900` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(7) > input.ant-input.css-dzyqf7` |
| `mqtt-profile-editor-1440x900` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(8) > input.ant-input.css-dzyqf7` |
| `mqtt-profile-editor-1440x900` | `password` | `div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(9) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-profile-editor-1440x900` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(10) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-profile-editor-1440x900` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(11) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-profile-editor-1440x900` | `password` | `div.ant-collapse-content-box > div.mqtt-collapse-body > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-messages` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(1) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-messages` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-messages` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(7) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-messages` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(8) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-messages` | `password` | `div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(9) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-messages` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(10) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-messages` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(11) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-messages` | `password` | `div.ant-collapse-content-box > div.mqtt-collapse-body > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-publish` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(1) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-publish` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-publish` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(7) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-publish` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(8) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-publish` | `password` | `div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(9) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-publish` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(10) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-publish` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(11) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-publish` | `password` | `div.ant-collapse-content-box > div.mqtt-collapse-body > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-publish` | `—` | `div.mqtt-loop-row:nth-of-type(2) > div.ant-input-number-group-wrapper.ant-input-number-group-wrapper-outlined:nth-of-type(1) > div.ant-input-number-wrapper.ant-input-number-group > div.ant-input-number.css-dzyqf7:nth-of-type(1) > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-publish` | `—` | `div.mqtt-loop-row:nth-of-type(2) > div.ant-input-number-group-wrapper.ant-input-number-group-wrapper-outlined:nth-of-type(3) > div.ant-input-number-wrapper.ant-input-number-group > div.ant-input-number.css-dzyqf7:nth-of-type(1) > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-attempts` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(1) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-attempts` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-attempts` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(7) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-attempts` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(8) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-attempts` | `password` | `div.mqtt-editor-body:nth-of-type(2) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(9) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-tab-attempts` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(10) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-attempts` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(11) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-tab-attempts` | `password` | `div.ant-collapse-content-box > div.mqtt-collapse-body > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |
| `mqtt-subscription-row` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(3) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(1) > input.ant-input.css-dzyqf7` |
| `mqtt-subscription-row` | `—` | `section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(4) > div.ant-input-number.css-dzyqf7 > div.ant-input-number-input-wrap:nth-of-type(2) > input.ant-input-number-input` |
| `mqtt-subscription-row` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(3) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(7) > input.ant-input.css-dzyqf7` |
| `mqtt-subscription-row` | `text` | `div.mqtt-editor > div.mqtt-editor-body:nth-of-type(3) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(8) > input.ant-input.css-dzyqf7` |
| `mqtt-subscription-row` | `password` | `div.mqtt-editor-body:nth-of-type(3) > section.mqtt-section:nth-of-type(1) > div.mqtt-form-grid:nth-of-type(2) > label.mqtt-field:nth-of-type(9) > span.ant-input-affix-wrapper.css-dzyqf7:nth-of-type(2) > input.ant-input.css-dzyqf7` |

## 重复按钮文案（跨文件）

| 文案 | 出现文件数 | 文件 |
| --- | --- | --- |
| 刷新 | 6 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`<br>`src/renderer/src/components/mqtt/PublishPanel.tsx`<br>`src/renderer/src/components/mqtt/VersionDrawer.tsx`<br>`src/renderer/src/components/schemas/DatabasePanel.tsx`<br>`src/renderer/src/pages/GitPage.tsx`<br>`src/renderer/src/pages/HistoryPage.tsx` |
| 保存 | 5 | `src/renderer/src/components/EnvironmentModal.tsx`<br>`src/renderer/src/components/mqtt/ProfileEditor.tsx`<br>`src/renderer/src/components/schemas/ModelEditor.tsx`<br>`src/renderer/src/pages/AutomationPage.tsx`<br>`src/renderer/src/pages/GitPage.tsx` |
| 关闭 | 4 | `src/renderer/src/components/DocShareLinkDialog.tsx`<br>`src/renderer/src/components/mqtt/MessagesPanel.tsx`<br>`src/renderer/src/components/mqtt/VersionDrawer.tsx`<br>`src/renderer/src/components/schemas/DatabasePanel.tsx` |
| 取消 | 3 | `src/renderer/src/App.tsx`<br>`src/renderer/src/components/schemas/DatabasePanel.tsx`<br>`src/renderer/src/pages/ApisPage.tsx` |
| 复制 | 3 | `src/renderer/src/components/CasesEditor.tsx`<br>`src/renderer/src/components/mqtt/ProfileEditor.tsx`<br>`src/renderer/src/pages/SettingsPage.tsx` |
| 清空 | 3 | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`<br>`src/renderer/src/components/mqtt/MessagesPanel.tsx`<br>`src/renderer/src/pages/HistoryPage.tsx` |
| 保存后关闭 | 2 | `src/renderer/src/App.tsx`<br>`src/renderer/src/pages/ApisPage.tsx` |
| 放弃并关闭 | 2 | `src/renderer/src/App.tsx`<br>`src/renderer/src/pages/ApisPage.tsx` |
| 新建 | 2 | `src/renderer/src/components/CasesEditor.tsx`<br>`src/renderer/src/components/schemas/DatabasePanel.tsx` |
| 删除 | 2 | `src/renderer/src/components/CasesEditor.tsx`<br>`src/renderer/src/components/schemas/ModelEditor.tsx` |
| 运行 | 2 | `src/renderer/src/components/CasesEditor.tsx`<br>`src/renderer/src/pages/AutomationPage.tsx` |
| 添加断言 | 2 | `src/renderer/src/components/CasesEditor.tsx`<br>`src/renderer/src/pages/AutomationPage.tsx` |
| 添加变量 | 2 | `src/renderer/src/components/EnvironmentModal.tsx`<br>`src/renderer/src/pages/SettingsPage.tsx` |
| 另存为新接口 | 2 | `src/renderer/src/components/TargetSyncGuard.tsx`<br>`src/renderer/src/pages/ApisPage.tsx` |
| 恢复 | 2 | `src/renderer/src/components/TargetVersionDrawer.tsx`<br>`src/renderer/src/components/mqtt/VersionDrawer.tsx` |
| 导出 | 2 | `src/renderer/src/components/mqtt/AttemptsPanel.tsx`<br>`src/renderer/src/components/mqtt/MessagesPanel.tsx` |
| 测试连接 | 2 | `src/renderer/src/components/mqtt/ProfileEditor.tsx`<br>`src/renderer/src/components/schemas/DatabasePanel.tsx` |
| 新建连接 | 2 | `src/renderer/src/components/mqtt/ProfileList.tsx`<br>`src/renderer/src/pages/MqttPage.tsx` |
| 重新生成 | 2 | `src/renderer/src/components/schemas/ModelEditor.tsx`<br>`src/renderer/src/pages/SettingsPage.tsx` |

## 元素最多的状态

| 状态 | 路由 | 元素数 | 截图 |
| --- | --- | --- | --- |
| `apis-response-tab-field-docs` | `/apis` | 725 | [WebP](screenshots/webp/apis-response-tab-field-docs.webp) |
| `apis-request-tab-header` | `/apis` | 534 | [WebP](screenshots/webp/apis-request-tab-header.webp) |
| `apis-editor-debug-1180x760` | `/apis` | 527 | [WebP](screenshots/webp/apis-editor-debug-1180x760.webp) |
| `apis-editor-debug-1440x900` | `/apis` | 527 | [WebP](screenshots/webp/apis-editor-debug-1440x900.webp) |
| `apis-mode-design` | `/apis` | 527 | [WebP](screenshots/webp/apis-mode-design.webp) |
| `apis-request-tab-body` | `/apis` | 527 | [WebP](screenshots/webp/apis-request-tab-body.webp) |
| `apis-response-tab-example` | `/apis` | 526 | [WebP](screenshots/webp/apis-response-tab-example.webp) |
| `apis-request-tab-query` | `/apis` | 520 | [WebP](screenshots/webp/apis-request-tab-query.webp) |
| `apis-request-tab-path` | `/apis` | 520 | [WebP](screenshots/webp/apis-request-tab-path.webp) |
| `apis-request-tab-cookie` | `/apis` | 520 | [WebP](screenshots/webp/apis-request-tab-cookie.webp) |
| `apis-request-tab-auth` | `/apis` | 517 | [WebP](screenshots/webp/apis-request-tab-auth.webp) |
| `apis-request-tab-pre-request` | `/apis` | 515 | [WebP](screenshots/webp/apis-request-tab-pre-request.webp) |

## 硬编码颜色（前 120 条）

| 文件 | 行号 | 颜色 | 代码片段 |
| --- | --- | --- | --- |
| `src/renderer/src/App.tsx` | 89 | `#2f8f62` | style={{ background: '#2f8f62', borderColor: '#2f8f62', color: '#fff' }} |
| `src/renderer/src/App.tsx` | 89 | `#2f8f62` | style={{ background: '#2f8f62', borderColor: '#2f8f62', color: '#fff' }} |
| `src/renderer/src/App.tsx` | 89 | `#fff` | style={{ background: '#2f8f62', borderColor: '#2f8f62', color: '#fff' }} |
| `src/renderer/src/App.tsx` | 121 | `#ff583e` | return <div style={{ padding: 32, color: '#ff583e' }}>初始化失败：{error}</div> |
| `src/renderer/src/components/ApiTree.tsx` | 61 | `#ff6b6b` | { key: 'http', label: 'HTTP', color: '#ff6b6b', icon: <ApiOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 62 | `#5f80e9` | { key: 'event-stream', label: 'Event Stream Request', color: '#5f80e9', icon: <ThunderboltOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 63 | `#ffb400` | { key: 'websocket', label: 'WebSocket', color: '#ffb400', icon: <SwapOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 64 | `#26cea4` | { key: 'socketio', label: 'Socket.IO', color: '#26cea4', icon: <LinkOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 65 | `#fa8c16` | { key: 'grpc', label: 'gRPC', color: '#fa8c16', icon: <CloudServerOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 66 | `#e2578d` | { key: 'graphql', label: 'GraphQL', color: '#e2578d', icon: <DeploymentUnitOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 67 | `#5bbfd4` | { key: 'tcp', label: 'TCP 客户端', color: '#5bbfd4', icon: <DesktopOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 68 | `#4971a6` | { key: 'markdown', label: 'Markdown', color: '#4971a6', icon: <FileMarkdownOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 69 | `#b083f0` | { key: 'folder', label: '目录', color: '#b083f0', icon: <FolderOutlined />, wide: true } |
| `src/renderer/src/components/ApiTree.tsx` | 78 | `#8e8069` | { key: 'curl', label: 'cURL 导入', color: '#8e8069', icon: <CodeOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 79 | `#8e8069` | { key: 'paste', label: '粘贴接口/文本', color: '#8e8069', icon: <SnippetsOutlined /> }, |
| `src/renderer/src/components/ApiTree.tsx` | 80 | `#8e8069` | { key: 'file', label: '其他文件导入', color: '#8e8069', icon: <ImportOutlined />, wide: true } |
| `src/renderer/src/components/ApiTree.tsx` | 349 | `#a58a58` | <FolderOutlined style={{ color: '#a58a58', fontSize: 14 }} /> |
| `src/renderer/src/components/CasesEditor.tsx` | 182 | `#e8e2d7` | borderRight: '1px solid var(--line, #e8e2d7)', |
| `src/renderer/src/components/CasesEditor.tsx` | 492 | `#e8e2d7` | border: '1px solid var(--line, #e8e2d7)', |
| `src/renderer/src/components/CasesEditor.tsx` | 508 | `#c9463a` | <div style={{ color: 'var(--red, #c9463a)', marginTop: 6, fontSize: 12 }}> |
| `src/renderer/src/components/DesignEditor.tsx` | 32 | `#e8e2d7` | <div style={{ height: 380, border: '1px solid var(--line, #e8e2d7)', borderRadius: 8, overflow: 'hidden' }}> |
| `src/renderer/src/components/FieldRulesEditor.tsx` | 59 | `#c9463a` | {error && <div role="alert" style={{ color: '#c9463a' }}>{error}</div>} |
| `src/renderer/src/components/JsonFieldTable.tsx` | 483 | `#c08a2e` | <WarningOutlined style={{ color: '#c08a2e', fontSize: 12 }} /> |
| `src/renderer/src/components/RequestEditor.tsx` | 77 | `#c9bfa9` | stroke="#c9bfa9" |
| `src/renderer/src/components/ResponsePanel.tsx` | 47 | `#c9bfa9` | stroke="#c9bfa9" |
| `src/renderer/src/components/ResponsePanel.tsx` | 320 | `#a47400` | <div className="muted" style={{ color: '#a47400', marginBottom: 8, fontSize: 11 }}> |
| `src/renderer/src/components/ResponsePanel.tsx` | 443 | `#2f7d4f` | <span className={ok ? 'status-code' : 'status-code'} style={{ color: ok ? '#2f7d4f' : '#d94a34' }}> |
| `src/renderer/src/components/ResponsePanel.tsx` | 443 | `#d94a34` | <span className={ok ? 'status-code' : 'status-code'} style={{ color: ok ? '#2f7d4f' : '#d94a34' }}> |
| `src/renderer/src/components/ResponsePanel.tsx` | 451 | `#d94a34` | <span style={{ color: '#d94a34' }}>请求失败</span> |
| `src/renderer/src/components/ResponsePanel.tsx` | 453 | `#d94a34` | {record.error ? <span style={{ color: '#d94a34' }}>{record.error.message}</span> : null} |
| `src/renderer/src/components/ResponsePanel.tsx` | 708 | `#fffdf8` | body { margin:0; padding:22px 24px; background:#fffdf8; color:#3e3324; |
| `src/renderer/src/components/ResponsePanel.tsx` | 708 | `#3e3324` | body { margin:0; padding:22px 24px; background:#fffdf8; color:#3e3324; |
| `src/renderer/src/components/ResponsePanel.tsx` | 710 | `#2c2214` | h1,h2,h3,h4,h5,h6 { color:#2c2214; margin:18px 0 8px; line-height:1.35; } |
| `src/renderer/src/components/ResponsePanel.tsx` | 713 | `#f3ead8` | code { background:#f3ead8; color:#7a5c30; padding:1px 5px; border-radius:3px; |
| `src/renderer/src/components/ResponsePanel.tsx` | 713 | `#7a5c30` | code { background:#f3ead8; color:#7a5c30; padding:1px 5px; border-radius:3px; |
| `src/renderer/src/components/ResponsePanel.tsx` | 715 | `#faf5ea` | pre { background:#faf5ea; border:1px solid #e6dcc8; border-radius:5px; padding:12px; |
| `src/renderer/src/components/ResponsePanel.tsx` | 715 | `#e6dcc8` | pre { background:#faf5ea; border:1px solid #e6dcc8; border-radius:5px; padding:12px; |
| `src/renderer/src/components/ResponsePanel.tsx` | 717 | `#3d352a` | pre code { background:transparent; padding:0; color:#3d352a; } |
| `src/renderer/src/components/ResponsePanel.tsx` | 718 | `#c8a25e` | blockquote { margin:10px 0; padding:8px 12px; border-left:3px solid #c8a25e; |
| `src/renderer/src/components/ResponsePanel.tsx` | 719 | `#faf5ea` | background:#faf5ea; color:#6b5d48; } |
| `src/renderer/src/components/ResponsePanel.tsx` | 719 | `#6b5d48` | background:#faf5ea; color:#6b5d48; } |
| `src/renderer/src/components/ResponsePanel.tsx` | 721 | `#faf5ea` | th { text-align:left; background:#faf5ea; color:#8e8069; padding:7px 8px; |
| `src/renderer/src/components/ResponsePanel.tsx` | 721 | `#8e8069` | th { text-align:left; background:#faf5ea; color:#8e8069; padding:7px 8px; |
| `src/renderer/src/components/ResponsePanel.tsx` | 722 | `#e6dcc8` | border-bottom:1px solid #e6dcc8; } |
| `src/renderer/src/components/ResponsePanel.tsx` | 723 | `#f3ecdd` | td { padding:7px 8px; border-bottom:1px solid #f3ecdd; } |
| `src/renderer/src/components/ResponsePanel.tsx` | 724 | `#e6dcc8` | hr { border:none; border-top:1px solid #e6dcc8; margin:16px 0; } |
| `src/renderer/src/components/ResponsePanel.tsx` | 725 | `#8a6b3b` | a { color:#8a6b3b; } |
| `src/renderer/src/components/TopBar.tsx` | 133 | `#c9bfa9` | style={{ background: mcpStatus?.running ? 'var(--green-2)' : '#c9bfa9' }} |
| `src/renderer/src/components/mqtt/MessagesPanel.tsx` | 269 | `#a2967f` | prefix={<SearchOutlined style={{ color: '#a2967f' }} />} |
| `src/renderer/src/components/mqtt/ProfileList.tsx` | 144 | `#a2967f` | prefix={<SearchOutlined style={{ color: '#a2967f' }} />} |
| `src/renderer/src/components/schemas/DictionaryPanel.tsx` | 269 | `#a2967f` | prefix={<SearchOutlined style={{ color: '#a2967f' }} />} |
| `src/renderer/src/components/schemas/DictionarySuggest.tsx` | 78 | `#8a6b3b` | <span className="mono" style={{ fontSize: 11, color: '#8a6b3b', flex: 'none' }}> |
| `src/renderer/src/components/schemas/ModelPickerModal.tsx` | 64 | `#a2967f` | prefix={<SearchOutlined style={{ color: '#a2967f' }} />} |
| `src/renderer/src/components/schemas/ModelPickerModal.tsx` | 87 | `#8a6b3b` | <TableOutlined style={{ color: '#8a6b3b' }} /> |
| `src/renderer/src/components/schemas/ModelsListPanel.tsx` | 163 | `#a2967f` | prefix={<SearchOutlined style={{ color: '#a2967f' }} />} |
| `src/renderer/src/pages/ApisPage.tsx` | 53 | `#ff6b6b` | { label: 'HTTP', color: '#ff6b6b', icon: <ApiOutlined /> }, |
| `src/renderer/src/pages/ApisPage.tsx` | 54 | `#5f80e9` | { label: 'Event Stream', color: '#5f80e9', icon: <ApiOutlined /> }, |
| `src/renderer/src/pages/ApisPage.tsx` | 55 | `#ffb400` | { label: 'WebSocket', color: '#ffb400', icon: <ApiOutlined /> }, |
| `src/renderer/src/pages/ApisPage.tsx` | 56 | `#26cea4` | { label: 'Socket.IO', color: '#26cea4', icon: <ApiOutlined /> }, |
| `src/renderer/src/pages/ApisPage.tsx` | 57 | `#e2578d` | { label: 'GraphQL', color: '#e2578d', icon: <ApiOutlined /> }, |
| `src/renderer/src/pages/ApisPage.tsx` | 58 | `#5bbfd4` | { label: 'TCP 客户端', color: '#5bbfd4', icon: <ApiOutlined /> }, |
| `src/renderer/src/pages/ApisPage.tsx` | 59 | `#4971a6` | { label: 'Markdown', color: '#4971a6', icon: <ApiOutlined /> }, |
| `src/renderer/src/pages/ApisPage.tsx` | 60 | `#fa8c16` | { label: '导入项目', color: '#fa8c16', icon: <FolderAddOutlined /> } |
| `src/renderer/src/pages/ApisPage.tsx` | 419 | `#a58a58` | <FolderOutlined style={{ fontSize: 12, color: '#a58a58' }} /> |
| `src/renderer/src/pages/ApisPage.tsx` | 726 | `#2f8f62` | style={{ background: '#2f8f62', borderColor: '#2f8f62', color: '#fff' }} |
| `src/renderer/src/pages/ApisPage.tsx` | 726 | `#2f8f62` | style={{ background: '#2f8f62', borderColor: '#2f8f62', color: '#fff' }} |
| `src/renderer/src/pages/ApisPage.tsx` | 726 | `#fff` | style={{ background: '#2f8f62', borderColor: '#2f8f62', color: '#fff' }} |
| `src/renderer/src/pages/DocsPage.tsx` | 324 | `#d9d1c3` | stroke="#d9d1c3" |
| `src/renderer/src/pages/DocsPage.tsx` | 327 | `#d9d1c3` | <path d="M50 13.5V26h12" stroke="#d9d1c3" strokeWidth="1.4" /> |
| `src/renderer/src/pages/DocsPage.tsx` | 328 | `#e3ddd2` | <path d="M30 37h24M30 46h24M30 55h16" stroke="#e3ddd2" strokeWidth="1.6" /> |
| `src/renderer/src/pages/DocsPage.tsx` | 360 | `#c7bda9` | <Avatar size={20} icon={<UserOutlined />} style={{ background: '#c7bda9' }} /> |
| `src/renderer/src/pages/SchemasPage.tsx` | 462 | `#a58a58` | <FolderOutlined style={{ color: '#a58a58', fontSize: 12 }} /> |
| `src/renderer/src/pages/SchemasPage.tsx` | 464 | `#8a6b3b` | <TableOutlined style={{ color: '#8a6b3b', fontSize: 12 }} /> |
| `src/renderer/src/pages/SchemasPage.tsx` | 525 | `#f3ead8` | <span className="schemas-card-icon" style={{ background: '#f3ead8', color: '#8a6b3b' }}> |
| `src/renderer/src/pages/SchemasPage.tsx` | 525 | `#8a6b3b` | <span className="schemas-card-icon" style={{ background: '#f3ead8', color: '#8a6b3b' }}> |
| `src/renderer/src/pages/SchemasPage.tsx` | 532 | `#097bed` | <span className="schemas-card-icon" style={{ background: 'rgba(9,123,237,.09)', color: '#097bed' }}> |
| `src/renderer/src/pages/SchemasPage.tsx` | 539 | `#1f9e7c` | <span className="schemas-card-icon" style={{ background: 'rgba(38,206,164,.12)', color: '#1f9e7c' }}> |
| `src/renderer/src/pages/SchemasPage.tsx` | 563 | `#a2967f` | prefix={<SearchOutlined style={{ color: '#a2967f' }} />} |
| `src/renderer/src/pages/SchemasPage.tsx` | 644 | `#8a6b3b` | <TableOutlined style={{ fontSize: 11, color: '#8a6b3b' }} /> |
| `src/renderer/src/pages/SchemasPage.tsx` | 646 | `#8a6b3b` | <FileTextOutlined style={{ fontSize: 11, color: '#8a6b3b' }} /> |
| `src/renderer/src/pages/SchemasPage.tsx` | 648 | `#1f9e7c` | <DatabaseOutlined style={{ fontSize: 11, color: '#1f9e7c' }} /> |
| `src/renderer/src/pages/SchemasPage.tsx` | 650 | `#a58a58` | <FolderOpenOutlined style={{ fontSize: 11, color: '#a58a58' }} /> |
| `src/renderer/src/theme.ts` | 4 | `#8A6B3B` | primary: '#8A6B3B', |
| `src/renderer/src/theme.ts` | 5 | `#715830` | primaryActive: '#715830', |
| `src/renderer/src/theme.ts` | 7 | `#FAF5EA` | pageBg: '#FAF5EA', |
| `src/renderer/src/theme.ts` | 8 | `#FFFFFF` | panelBg: '#FFFFFF', |
| `src/renderer/src/theme.ts` | 9 | `#F3EAD8` | folderBg: '#F3EAD8', |
| `src/renderer/src/theme.ts` | 11 | `#F4EDDF` | headerBg: '#F4EDDF', |
| `src/renderer/src/theme.ts` | 14 | `#2C2214` | text: '#2C2214', |
| `src/renderer/src/theme.ts` | 15 | `#6B5D48` | textSecondary: '#6B5D48', |
| `src/renderer/src/theme.ts` | 16 | `#9C9080` | textMuted: '#9C9080', |
| `src/renderer/src/theme.ts` | 17 | `#26CEA4` | success: '#26CEA4', |
| `src/renderer/src/theme.ts` | 18 | `#ff583e` | error: '#ff583e', |
| `src/renderer/src/theme.ts` | 19 | `#ffb400` | warning: '#ffb400' |

## 内联样式（前 80 条）

| 文件 | 行号 | 代码片段 |
| --- | --- | --- |
| `src/renderer/src/App.tsx` | 87 | <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}> |
| `src/renderer/src/App.tsx` | 89 | style={{ background: '#2f8f62', borderColor: '#2f8f62', color: '#fff' }} |
| `src/renderer/src/App.tsx` | 121 | return <div style={{ padding: 32, color: '#ff583e' }}>初始化失败：{error}</div> |
| `src/renderer/src/App.tsx` | 126 | <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}> |
| `src/renderer/src/components/ApiDescriptionDialog.tsx` | 189 | <span style={{ flex: 1 }} /> |
| `src/renderer/src/components/ApiDescriptionDialog.tsx` | 211 | <span style={{ flex: 1 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 186 | <span className="menu-icon" style={{ background: entry.color }}> |
| `src/renderer/src/components/ApiTree.tsx` | 349 | <FolderOutlined style={{ color: '#a58a58', fontSize: 14 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 390 | <span className="new-menu-icon" style={{ background: entry.color }}> |
| `src/renderer/src/components/ApiTree.tsx` | 406 | <span className="new-menu-icon" style={{ background: entry.color }}> |
| `src/renderer/src/components/ApiTree.tsx` | 420 | <SearchOutlined style={{ fontSize: 14, flex: 'none' }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 439 | {filterLabel} <DownOutlined style={{ fontSize: 9 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 453 | <PlusOutlined style={{ fontSize: 14 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 459 | <FolderOpenOutlined style={{ fontSize: 14 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 461 | <span style={{ flex: 1 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 464 | <ReloadOutlined style={{ fontSize: 13 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 470 | <SortAscendingOutlined style={{ fontSize: 13 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 472 | <SortDescendingOutlined style={{ fontSize: 13 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 479 | <ArrowsAltOutlined style={{ fontSize: 13 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 481 | <ShrinkOutlined style={{ fontSize: 13 }} /> |
| `src/renderer/src/components/ApiTree.tsx` | 489 | <div className="muted" style={{ padding: 12, fontSize: 12 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 177 | <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 179 | style={{ |
| `src/renderer/src/components/CasesEditor.tsx` | 187 | <div style={{ display: 'flex', gap: 6, padding: 10 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 200 | <div style={{ overflow: 'auto', flex: 1, padding: '0 8px 12px' }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 208 | style={{ |
| `src/renderer/src/components/CasesEditor.tsx` | 216 | <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 217 | <span style={{ flex: 1, fontSize: 13 }}>{item.name}</span> |
| `src/renderer/src/components/CasesEditor.tsx` | 224 | <div className="muted" style={{ fontSize: 11, marginTop: 2 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 232 | <div style={{ flex: 1, overflow: 'auto', padding: 16 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 236 | <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 237 | <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 241 | style={{ width: 260 }} |
| `src/renderer/src/components/CasesEditor.tsx` | 264 | <span style={{ flex: 1 }} /> |
| `src/renderer/src/components/CasesEditor.tsx` | 287 | <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 291 | style={{ width: 130 }} |
| `src/renderer/src/components/CasesEditor.tsx` | 320 | <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 321 | <span className="muted" style={{ fontSize: 12 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 327 | style={{ width: 200 }} |
| `src/renderer/src/components/CasesEditor.tsx` | 342 | style={{ flex: 1 }} |
| `src/renderer/src/components/CasesEditor.tsx` | 374 | <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 378 | style={{ display: 'flex', gap: 8, alignItems: 'center' }} |
| `src/renderer/src/components/CasesEditor.tsx` | 394 | style={{ width: 120 }} |
| `src/renderer/src/components/CasesEditor.tsx` | 409 | style={{ width: 110 }} |
| `src/renderer/src/components/CasesEditor.tsx` | 441 | style={{ width: 160 }} |
| `src/renderer/src/components/CasesEditor.tsx` | 491 | style={{ |
| `src/renderer/src/components/CasesEditor.tsx` | 497 | <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 501 | <span className="muted" style={{ fontSize: 12 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 508 | <div style={{ color: 'var(--red, #c9463a)', marginTop: 6, fontSize: 12 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 512 | <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}> |
| `src/renderer/src/components/CasesEditor.tsx` | 518 | <div key={item.assertion_id} style={{ fontSize: 12 }}> |
| `src/renderer/src/components/CodeGenDialog.tsx` | 97 | <span style={{ flex: 1 }} /> |
| `src/renderer/src/components/DesignEditor.tsx` | 25 | <div style={{ height: '100%', overflow: 'auto', padding: '0 16px 32px' }}> |
| `src/renderer/src/components/DesignEditor.tsx` | 29 | <div className="section-title" style={{ marginTop: 8 }}> |
| `src/renderer/src/components/DesignEditor.tsx` | 32 | <div style={{ height: 380, border: '1px solid var(--line, #e8e2d7)', borderRadius: 8, overflow: 'hidden' }}> |
| `src/renderer/src/components/DesignEditor.tsx` | 44 | <div className="section-title" style={{ marginTop: 20 }}> |
| `src/renderer/src/components/DesignEditor.tsx` | 47 | <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}> |
| `src/renderer/src/components/DesignEditor.tsx` | 49 | <div className="muted" style={{ fontSize: 12 }}> |
| `src/renderer/src/components/DesignEditor.tsx` | 54 | <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}> |
| `src/renderer/src/components/DesignEditor.tsx` | 56 | style={{ width: 130 }} |
| `src/renderer/src/components/DocShareDialog.tsx` | 294 | <div className="docs-hint" style={{ marginTop: 0 }}> |
| `src/renderer/src/components/DocShareDialog.tsx` | 338 | style={{ width: '100%' }} |
| `src/renderer/src/components/DocShareDialog.tsx` | 373 | style={{ width: 126 }} |
| `src/renderer/src/components/DocShareDialog.tsx` | 456 | <label style={{ margin: 0 }}>允许 OpenAPI 导出</label> |
| `src/renderer/src/components/DocShareLinkDialog.tsx` | 67 | style={{ marginBottom: 12 }} |
| `src/renderer/src/components/EnvironmentModal.tsx` | 450 | style={{ width: 220 }} |
| `src/renderer/src/components/EnvironmentModal.tsx` | 552 | style={{ marginBottom: 10 }} |
| `src/renderer/src/components/EnvironmentModal.tsx` | 671 | style={{ marginTop: 8 }} |
| `src/renderer/src/components/EnvironmentModal.tsx` | 675 | <div style={{ marginTop: 8 }}> |
| `src/renderer/src/components/EnvironmentModal.tsx` | 689 | <div style={{ marginTop: 8 }}> |
| `src/renderer/src/components/EnvironmentModal.tsx` | 708 | style={{ width: 160 }} |
| `src/renderer/src/components/EnvironmentModal.tsx` | 720 | style={{ flex: 1 }} |
| `src/renderer/src/components/EnvironmentModal.tsx` | 805 | style={{ width: 110 }} |
| `src/renderer/src/components/EnvironmentModal.tsx` | 864 | style={{ marginTop: 60 }} |
| `src/renderer/src/components/EnvironmentModal.tsx` | 875 | <span style={{ flex: 1 }} /> |
| `src/renderer/src/components/FieldRulesEditor.tsx` | 42 | const booleanEditor = (key: 'required' \| 'nullable'): JSX.Element => <Select style={{ width: '100%' }} |
| `src/renderer/src/components/FieldRulesEditor.tsx` | 59 | {error && <div role="alert" style={{ color: '#c9463a' }}>{error}</div>} |
| `src/renderer/src/components/JsonFieldTable.tsx` | 398 | <span className="muted" style={{ fontSize: 11 }}> |
| `src/renderer/src/components/JsonFieldTable.tsx` | 401 | <span style={{ flex: 1 }} /> |
| `src/renderer/src/components/JsonFieldTable.tsx` | 440 | <span style={{ paddingLeft: row.depth * 16, display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}> |
