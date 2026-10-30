# 编辑器交互改进 Spec

Status: ready-for-agent
Date: 2026-10-30
Feature: editor-ux

## Problem Statement

接口标签页有三类体验缺口：

1. 关闭有未保存改动的标签时只有二选一（放弃/取消），无法“保存后关闭”；批量关闭、关闭窗口没有统一守卫，未保存内容可能静默丢失。
2. 标签没有右键菜单，也没有关闭快捷键，批量整理标签只能逐个点。
3. multipart/form-data 的 file 行只能手填文件路径，没有文件选择器、类型切换、文件名/大小展示；binary body 同样要手填路径。

本 spec 只处理编辑器交互，不改动分享、设计与用例。

## Solution

- 统一的标签关闭守卫：所有关闭路径走同一套三选提示，批量关闭聚合一次。
- 标签右键菜单按图实现六项，不可用项置灰；补 Ctrl+F4 与 macOS Cmd+W。
- multipart 每行增加 text/file 类型，file 行用系统文件对话框选择（支持多选、拖拽），仅存绝对路径；binary body 复用同一选择器。

## User Stories

1. 作为用户，关闭有未保存改动的标签时，可以选择“保存后关闭 / 取消 / 放弃并关闭”。
2. 作为用户，保存失败时标签保留并看到错误，不会丢内容。
3. 作为用户，一次关闭多个未保存标签时只看到一次聚合提示。
4. 作为用户，关闭应用窗口时同样被拦截，避免丢失改动。
5. 作为用户，我右键标签看到：关闭、关闭其他、关闭所有、关闭未修改、关闭左侧、关闭右侧。
6. 作为用户，不可用的菜单项是置灰的，而不是隐藏。
7. 作为用户，Ctrl+F4（macOS 还可 Cmd+W）关闭当前标签。
8. 作为用户，我在 form-data 行切换 text/file 类型，并用文件对话框选择文件。
9. 作为用户，我一次选多个文件，得到多行同 key 的文件项。
10. 作为用户，我看到文件名与大小，并能清除某一行的文件。
11. 作为用户，我把文件拖到行上即可填入路径。
12. 作为用户，binary body 也用同一个文件选择器。

## Implementation Decisions

### 未保存关闭守卫

- 新增渲染层 hook/utils `useTabCloseGuard`（或 `closeTabsWithGuard(ids)`），由 ApisPage 与标签菜单共用。
- 单标签 dirty：Ant Design `Modal.confirm`，按钮为「保存后关闭」（主按钮/绿色语义）、「取消」、「放弃并关闭」（危险色），文案与截图一致。
- 批量：统计 dirty 数量，一次提示「N 个标签有未保存的修改」；按钮为「全部保存并关闭」「取消」「全部放弃并关闭」。
- `保存后关闭`：逐条 `saveTarget`；任一失败则中止后续保存、保留全部标签并显示错误。
- 非 dirty 标签直接关闭。
- 应用退出：main 的 `BrowserWindow 'close'` 拦截 → IPC 询问渲染层是否有 dirty → 渲染层弹同一提示 → 用户确认后 `win.destroy()`；无 dirty 直接关闭。
- 删除接口不弹保存提示（删除即明确丢弃未保存改动），沿用现有删除确认。
- `store.closeTab` 保持无守卫的纯状态操作，守卫只在 UI 层，避免主进程/批量路径被阻塞。

### 标签右键菜单与快捷键

- `Tab` 上使用 AntD `Dropdown trigger={['contextMenu']}`。
- 菜单项：关闭、关闭其他标签页、关闭所有标签页、关闭未修改标签页、关闭左侧标签页、关闭右侧标签页。
- 禁用规则：只有一个标签时「关闭其他/所有/未修改」禁用；左侧/右侧无标签时禁用；没有未修改标签时「关闭未修改」禁用。
- 「关闭未修改」关闭除当前外的所有 `dirty === false` 标签（当前保留）。
- 快捷键：Ctrl+F4 关闭当前；macOS 额外 Cmd+W；在窗口级 keydown 监听，忽略输入框/富文本编辑器的原生行为冲突。
- 关闭操作全部走关闭守卫。

### multipart 文件选择

- 新增 IPC `dialog:open-files`：`dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })`，返回 `{ path, name, size }[]`。
- preload 暴露 `window.api.dialog.openFiles()`。
- `ParamTable` 在 formdata 模式下增加类型列（text/file）：
  - file 行显示文件名 + 大小（由 path 解析），提供「选择文件」「清除」。
  - 值仍存绝对路径；类型写 `field_type = 'file'`（executor 已支持）。
  - 多选时每个文件追加一行，key 复用当前行的 key。
- 拖拽：通过 preload 暴露 `webUtils.getPathForFile(file)`，`onDrop` 读取路径并填入/新增行。
- binary body：复用 `dialog:open-files`（单选模式或取第一个），写 `body.binary.file_path` 与 `file_name`。
- urlencoded/raw/json 不显示类型列。
- 分享页只显示文件名，不显示绝对路径。
- 不复制文件进项目、不打包进 ZIP。

## Testing Decisions

- 单元：路径 → 文件名/大小格式化；类型列仅 formdata 出现；多选生成行。
- 集成（smoke/ui-smoke）：关闭三选按钮行为（保存成功/失败/放弃/取消）；批量聚合文案与计数；六菜单项禁用规则；Ctrl+F4/Cmd+W；文件选择后 executor 能读到路径。
- 应用退出拦截在 ui-smoke 中以模拟事件覆盖。

## Out of Scope

- 自动保存、撤销/重做。
- 文件复制进项目或上传缓存目录。
- 目录选择（只选文件）。

## Further Notes

- Electron 版本需支持 `webUtils`（>= 32）；当前 ^45 可用。
- 键盘监听放在 tabs 容器，避免全局劫持其他页面的 Cmd+W。
