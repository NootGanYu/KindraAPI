# 01: 实时范围解析与渲染管线

**What to build:** 用 `ResolvedShare` 替代 `share.snapshot` 驱动全部分享页渲染，实现 project/folder/api/custom 四种范围的动态解析。

**Blocked by:** 无

**Status:** ready-for-agent

- [ ] 新增 `resolveShareTargets(projectId, share)`，返回 `{ project_name, project_intro?, targets, generated_at }`
- [ ] `project` 取项目全部 target；`folder` 取根文件夹及全部后代；`api` 取单个接口；`custom` 固定 ids 并剔除已删除项
- [ ] `custom` 按 parent_id 重建森林，父不存在的挂到根
- [ ] folder/api 范围根目标不存在或类型不符时返回可渲染的 404
- [ ] `renderNav`、`renderDocPage`、`renderApi`、`buildMarkdown`、`buildOpenApi` 改为接收 `ResolvedShare`
- [ ] 分享列表 `target_count`、type_label 改为实时计算
- [ ] “最后更新”取范围内 target 最大 `updated_at`，空范围回退 `share.updated_at`
- [ ] 创建/更新分享时继续写入 `snapshot`（兼容），但读取路径全部改走 `resolveShareTargets`
- [ ] typecheck 通过；smoke 覆盖四种范围与删除/移动场景
