# 01: MQTT 模块骨架与 Connection Profile 存储

**What to build:** 新增独立一级导航「MQTT」与路由 `/mqtt`；实现项目级 Connection Profile 的增删改查、分组与搜索，以及 `offline-data/<project_id>/mqtt/` 的原子存储与 IPC/preload 命名空间。

**Blocked by:** none

**Status:** ready-for-agent

- [ ] 左侧导航新增「MQTT」入口，路由 `/mqtt` 可访问，刷新后停留在该页
- [ ] 无连接时显示空态与「新建连接」入口
- [ ] 左侧连接列表跟随当前项目，切换项目后显示对应项目的连接
- [ ] 支持新建、编辑、删除、复制 Connection Profile；删除有确认
- [ ] Connection Profile 支持 `name`、`group`、搜索与按 group 分组折叠
- [ ] 存储目录为 `offline-data/<project_id>/mqtt/`，包含 `index.json` 与 `connections/<connection_id>.json`
- [ ] 写入使用临时文件 + rename 的原子写；项目 ID 与 connection_id 经过现有 ID 校验
- [ ] 旧项目缺少 `mqtt/` 目录时返回空列表，不报错、不自动创建无关文件
- [ ] 新增 IPC 通道 `mqtt:profiles:list/get/create/save/delete/clone`，统一返回 `Result<T>`
- [ ] preload 暴露 `mqtt.profiles.*`，渲染层类型完整
- [ ] typecheck 通过
- [ ] smoke 覆盖 Profile CRUD、项目隔离、删除确认与空目录读取
