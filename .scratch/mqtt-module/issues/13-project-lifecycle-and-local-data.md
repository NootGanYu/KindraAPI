# 13: 项目生命周期与本地数据边界

**What to build:** 明确 MQTT 数据的两种归属并接入项目生命周期：Connection Profile 与版本进入项目目录；消息、Attempt 与发布历史进入本地目录，避免高频数据进入项目 Git 仓库。

**Blocked by:** 01, 07

**Status:** ready-for-agent

- [ ] Connection Profile 与 Profile Version 位于 `offline-data/<project_id>/mqtt/`
- [ ] 消息、Attempt、发布历史位于 `offline-data-local/projects/<project_id>/mqtt/`
- [ ] 所有目录按需创建；读取不存在的目录返回空集合，不抛错
- [ ] 清空消息只删除本地消息分片与索引，不影响 Profile 与版本
- [ ] 清空 Attempt 只删除本地 Attempt 文件与摘要
- [ ] 删除 Profile 时级联删除其版本目录、本地消息目录与 Attempt JSONL，并有确认
- [ ] 切换项目时停止该项目的定时发布任务并断开该项目的会话
- [ ] 项目 Git 模块的改动范围不包含 `offline-data-local` 下的 MQTT 数据
- [ ] README 或模块文档说明「消息是本地数据，不随项目 Git 版本管理」
- [ ] typecheck 通过
- [ ] smoke 覆盖：清空消息、清空 Attempt、删除 Profile 级联、目录缺失读取、项目切换清理
