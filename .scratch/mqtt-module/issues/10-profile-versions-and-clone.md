# 10: Profile 版本与克隆

**What to build:** 在 MQTT 模块内实现轻量版本快照与克隆，仅覆盖 Connection Profile，与 Target 版本机制无关。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] 每次保存 Connection Profile 时自动生成版本快照
- [ ] 每个 Profile 保留最近 20 个版本，超出删除最旧
- [ ] 版本列表展示创建时间与名称摘要
- [ ] 支持查看某个版本的关键字段并恢复到当前配置
- [ ] 恢复前要求确认，恢复后自动生成一个新版本（不覆盖历史）
- [ ] 支持「克隆」Connection Profile，生成新 `connection_id` 与名称后缀
- [ ] 克隆包含订阅、TLS、Will、MQTT 5 属性与保留策略
- [ ] 版本存储位于 `offline-data/<project_id>/mqtt/versions/<connection_id>/`
- [ ] 删除 Profile 时一并删除其版本目录
- [ ] IPC：`mqtt:profiles:versions:list/get/restore`
- [ ] typecheck 通过
- [ ] smoke 覆盖：自动快照、20 条上限、恢复、恢复后新快照、克隆、删除级联
