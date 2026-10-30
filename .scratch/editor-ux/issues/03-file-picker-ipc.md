# 03: 文件选择 IPC 与 preload

**What to build:** 新增系统文件选择与拖拽路径解析的 IPC 能力。

**Blocked by:** 无

**Status:** ready-for-agent

- [ ] IPC `dialog:open-files`：openFile + multiSelections，返回 `{ path, name, size }[]`
- [ ] 取消选择返回空数组
- [ ] preload 暴露 `window.api.dialog.openFiles()` 与 `webUtils.getPathForFile`
- [ ] 更新 `preload/types.d.ts` 与 renderer env 类型
- [ ] 仅允许本地文件，不返回目录
- [ ] typecheck 通过；smoke 覆盖取消与多选
