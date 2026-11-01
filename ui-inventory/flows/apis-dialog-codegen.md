# 交互流：apis-dialog-codegen

- 路由：`/apis`
- 类型：dialog
- 视口：1180×760
- 说明：—
- 所属页面：[pages/apis.md](../pages/apis.md)

![apis-dialog-codegen](../screenshots/webp/apis-dialog-codegen.webp)

## 可见控件

| 区块 | 文案 / aria / icon | 类型 | 状态 | 选择器 |
| --- | --- | --- | --- | --- |
| modal:生成代码 | Close | `button` | — | `div.ant-modal-root.css-dzyqf7 > div.ant-modal-wrap:nth-of-type(2) > div.ant-modal.css-dzyqf7 > div:nth-of-type(1) > div.ant-modal-content > button.ant-modal-close` |
| modal:生成代码 | 关闭 | `span` | — | `div.ant-modal-wrap:nth-of-type(2) > div.ant-modal.css-dzyqf7 > div:nth-of-type(1) > div.ant-modal-content > button.ant-modal-close > span.ant-modal-close-x` |
| modal:生成代码 | 生成代码 | `div` | — | `div#:rj2:` |
| modal:生成代码 | shell(curl) | `button` | active | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang.active:nth-of-type(1)` |
| modal:生成代码 | shell(httpie) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(2)` |
| modal:生成代码 | shell(wget) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(3)` |
| modal:生成代码 | c(libcurl) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(4)` |
| modal:生成代码 | clojure(clj_http) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(5)` |
| modal:生成代码 | csharp(httpclient) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(6)` |
| modal:生成代码 | csharp(restsharp) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(7)` |
| modal:生成代码 | go(native) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(8)` |
| modal:生成代码 | HTTP(http/1.1) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(9)` |
| modal:生成代码 | java(asynchttp) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(10)` |
| modal:生成代码 | java(nethttp) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(11)` |
| modal:生成代码 | java(okhttp) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(12)` |
| modal:生成代码 | java(unirest) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(13)` |
| modal:生成代码 | javascript(axios) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(14)` |
| modal:生成代码 | javascript(fetch) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(15)` |
| modal:生成代码 | javascript(jquery) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(16)` |
| modal:生成代码 | javascript(xhr) 后续 | `button` | disabled | `div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-langs:nth-of-type(1) > button.codegen-lang:nth-of-type(17)` |
| modal:生成代码 | 复制代码 | `button` | — | `div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.codegen-body > div.codegen-main:nth-of-type(2) > div.codegen-toolbar:nth-of-type(1) > button.ant-btn.css-dzyqf7` |

## 提示文案

**title 属性**

- shell(curl)
- shell(httpie) 后续支持
- shell(wget) 后续支持
- c(libcurl) 后续支持
- clojure(clj_http) 后续支持
- csharp(httpclient) 后续支持
- csharp(restsharp) 后续支持
- go(native) 后续支持
- HTTP(http/1.1) 后续支持
- java(asynchttp) 后续支持
- java(nethttp) 后续支持
- java(okhttp) 后续支持
- java(unirest) 后续支持
- javascript(axios) 后续支持
- javascript(fetch) 后续支持
- javascript(jquery) 后续支持
- javascript(xhr) 后续支持

## 相关源码

- `src/renderer/src/components/ApiDescriptionDialog.tsx`：4 个菜单项
- `src/renderer/src/components/ApiDescriptionDialog.tsx`：1 个 Tooltip
- `src/renderer/src/components/ApiTree.tsx`：11 条提示
- `src/renderer/src/components/ApiTree.tsx`：29 个菜单项
- `src/renderer/src/components/ApiTree.tsx`：3 个 Tooltip
- `src/renderer/src/components/CasesEditor.tsx`：5 条提示
- `src/renderer/src/components/CasesEditor.tsx`：16 个菜单项
- `src/renderer/src/components/CasesEditor.tsx`：2 个 IPC 调用
- `src/renderer/src/components/CodeGenDialog.tsx`：3 条提示
- `src/renderer/src/components/CodeGenDialog.tsx`：17 个菜单项
- `src/renderer/src/components/CodeGenDialog.tsx`：4 个 IPC 调用
- `src/renderer/src/components/EnvironmentModal.tsx`：18 条提示
- `src/renderer/src/components/EnvironmentModal.tsx`：10 个菜单项
- `src/renderer/src/components/EnvironmentModal.tsx`：11 个 IPC 调用
- `src/renderer/src/components/FieldRulesEditor.tsx`：7 个菜单项
- `src/renderer/src/components/JsonFieldTable.tsx`：5 条提示
- `src/renderer/src/components/JsonFieldTable.tsx`：15 个菜单项
- `src/renderer/src/components/JsonFieldTable.tsx`：2 个 Tooltip
- `src/renderer/src/components/ParamTable.tsx`：1 条提示
- `src/renderer/src/components/ParamTable.tsx`：2 个菜单项
- `src/renderer/src/components/ParamTable.tsx`：2 个 Tooltip
- `src/renderer/src/components/ParamTable.tsx`：2 个 IPC 调用
- `src/renderer/src/components/RequestEditor.tsx`：14 条提示
- `src/renderer/src/components/RequestEditor.tsx`：23 个菜单项
- `src/renderer/src/components/RequestEditor.tsx`：1 个 Tooltip
- `src/renderer/src/components/RequestEditor.tsx`：6 个 IPC 调用
- `src/renderer/src/components/ResponsePanel.tsx`：9 条提示
- `src/renderer/src/components/ResponsePanel.tsx`：1 个菜单项
- `src/renderer/src/components/ResponsePanel.tsx`：1 个 Tooltip
- `src/renderer/src/components/ResponsePanel.tsx`：5 个 IPC 调用
- `src/renderer/src/components/TargetSyncGuard.tsx`：1 条提示
- `src/renderer/src/components/TargetVersionDrawer.tsx`：6 条提示
- `src/renderer/src/components/TargetVersionDrawer.tsx`：3 个 IPC 调用
- `src/renderer/src/pages/ApisPage.tsx`：25 条提示
- `src/renderer/src/pages/ApisPage.tsx`：19 个菜单项
- `src/renderer/src/pages/ApisPage.tsx`：4 个 Tooltip
- `src/renderer/src/pages/ApisPage.tsx`：2 个 IPC 调用

> 返回 [交互流索引](README.md)
