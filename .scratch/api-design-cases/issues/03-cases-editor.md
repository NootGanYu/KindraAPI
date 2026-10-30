# 03: 用例编辑器

**What to build:** 「用例」模式的列表与编辑 UI，包含请求覆盖和断言表。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 左侧用例列表：新增、复制、删除、启用/禁用、选中
- [ ] 右侧编辑：名称、说明
- [ ] 请求覆盖：method、url、headers、query、restful、body（继承/覆盖切换）
- [ ] 断言表：kind/op/path/expected、启用开关、删除、添加
- [ ] 编辑走 `patchDraft`；用例删除/新增即时反映在草稿
- [ ] 最近结果只读展示（状态、HTTP、耗时、断言明细）
- [ ] typecheck 通过；ui-smoke 覆盖新增/编辑/复制/删除
