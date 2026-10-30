# 02: 标签右键菜单与快捷键

**What to build:** 按截图实现六项右键菜单与 Ctrl+F4 / Cmd+W。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Tab 上挂 AntD Dropdown contextMenu
- [ ] 六项：关闭 / 关闭其他 / 关闭所有 / 关闭未修改 / 关闭左侧 / 关闭右侧
- [ ] 「关闭未修改」= 除当前外 dirty=false 的标签；当前保留
- [ ] 禁用规则：无其他、无左侧、无右侧、无未修改时置灰
- [ ] 所有关闭项走 01 的守卫
- [ ] Ctrl+F4 关闭当前；macOS 额外 Cmd+W
- [ ] 监听范围限定在标签容器，避免与输入框/富文本冲突
- [ ] typecheck 通过；ui-smoke 覆盖每项结果与禁用状态
