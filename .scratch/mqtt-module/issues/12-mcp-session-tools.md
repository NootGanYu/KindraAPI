# 12: MCP 全量会话工具

**What to build:** 通过 MCP 暴露项目内 MQTT 的会话工具：列 Profile、测试连接、连接、订阅、取消订阅、发布、游标拉取消息、列会话、断开；MCP 会话独立回收，冲突明确报错。

**Blocked by:** 03, 04, 06, 07, 08

**Status:** ready-for-agent

- [ ] 工具：`mqtt_list_profiles`、`mqtt_test_connection`、`mqtt_connect`、`mqtt_subscribe`、`mqtt_unsubscribe`、`mqtt_publish`、`mqtt_drain_messages`、`mqtt_list_sessions`、`mqtt_disconnect`
- [ ] 工具名不带前缀，参数与现有 MCP 工具风格一致
- [ ] `mqtt_drain_messages(session_id, cursor, limit)` 返回 `{ messages, nextCursor }`，无新消息时返回空数组与相同 cursor
- [ ] MCP 创建的会话带 `owner: 'mcp'`，空闲 5 分钟自动断开
- [ ] 同一 Profile 已被 UI 或其他 MCP 会话占用时返回明确冲突错误，不复用、不修改 clientId
- [ ] MCP 会话总数与 UI 会话共享全局上限 8
- [ ] 连接/测试/订阅/取消订阅/发布/断开要求 `allow_execute`；列表与拉取不受限
- [ ] `mqtt_list_profiles` 返回完整配置（含明文凭据，见 ADR-0004）
- [ ] 参数校验：未知 connection_id/session_id、非法 topic、非法 QoS、payload 超限均返回可读错误
- [ ] 删除或关闭会话后，再次操作该 session_id 返回明确错误
- [ ] typecheck 通过
- [ ] smoke 覆盖每个工具的成功路径、权限拒绝、冲突、空闲回收、游标拉取与参数错误
