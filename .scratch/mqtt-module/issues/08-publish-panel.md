# 08: 发布面板与定时/循环发布

**What to build:** 发布主题、payload、QoS、retain 与 MQTT 5 User Properties；展示发布结果；保存最近 50 条发布历史；提供有护栏的定时/循环发布。

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] 发布面板包含 topic、payload 编辑器、QoS 0/1/2、retain 与 User Properties
- [ ] payload 支持 JSON / Plain / Hex / Base64 四种输入与校验；JSON 非法时禁止发送并提示
- [ ] 发送后展示 PUBACK/PUBREC/PUBCOMP 结果或失败原因；ACL 拒绝归类为 `acl`
- [ ] 发布历史保存在 `offline-data-local/projects/<project_id>/mqtt/publish-history.json`，最近 50 条
- [ ] 发布历史可一键回填 topic、payload、QoS、retain
- [ ] 定时/循环发布：间隔 ≥100ms；支持按次数或时长停止；启动前二次确认并展示预计条数
- [ ] 运行中显示已发送条数与剩余量，提供停止按钮；停止后立即取消定时器
- [ ] 关闭页面或切换项目时停止该项目的定时发布任务
- [ ] 发布结果与失败写入事件通道，UI 可实时看到
- [ ] IPC：`mqtt:publish`、`mqtt:publish:history`、`mqtt:publish:startLoop`、`mqtt:publish:stopLoop`
- [ ] typecheck 通过
- [ ] smoke 覆盖：QoS 0/1/2 发布、retain、ACL 拒绝、历史回填、循环发布的次数/时长/停止与下限校验
