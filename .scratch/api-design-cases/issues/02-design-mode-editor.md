# 02: 设计模式编辑器

**What to build:** 把 ApisPage「设计」占位替换为可编辑契约视图，与调试共享草稿。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 设计模式展示/编辑：方法、URL、说明、请求参数/Headers/Body、响应结构与示例
- [ ] 错误码表增删行：code、message、description
- [ ] 所有编辑走 `patchDraft`，切换模式不丢失
- [ ] 复用现有 RequestEditor/ResponsePanel/字典模型选择组件，不新增第二套编辑器
- [ ] 保存仍走现有 `saveTarget`；dirty 红点生效
- [ ] 无接口选中时显示空态
- [ ] typecheck 通过；ui-smoke 覆盖编辑后切回调试仍保留
