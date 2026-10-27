# 07: 消息收件箱与持久化

**What to build:** 收到消息后先落盘再通知 UI；实现分片 JSONL 存储、多阈值轮转、1MB 限制、预览截断、二进制处理；提供过滤、暂停、清空、视图切换、搜索、导出与重发入口。

**Blocked by:** 03, 04, 06

**Status:** ready-for-agent

- [ ] 消息存储位于 `offline-data-local/projects/<project_id>/mqtt/messages/<connection_id>/`
- [ ] 每个分片为 JSONL，默认 2000 条 / 8MB；`index.json` 记录分片 seq 范围、条数、字节数与时间范围
- [ ] 写入顺序：分配 seq → 写分片 → 发 `message` 事件，保证事件到达时可取回完整消息
- [ ] 默认保留 10000 条 / 50MB / 7 天；Profile 的 `retention` 可覆盖；写入后触发轮转
- [ ] 单条 payload 超过 1MB 时拒收，并发出带 `truncated` 标记的事件
- [ ] 列表预览最多 64KB；完整 payload 通过 `mqtt:messages:get` 读取
- [ ] 收件箱显示主题、方向、QoS、retain、时间与 payload 预览
- [ ] 支持按主题过滤、暂停自动滚动、清空（有确认）
- [ ] 支持 JSON / Plain / Hex / Base64 视图切换；二进制 payload 无损展示
- [ ] 支持单条详情与复制完整 payload
- [ ] 搜索仅作用于当前已加载消息（主题与 payload），不建持久索引
- [ ] 导出 JSONL 与 CSV；二进制 payload 标注 base64
- [ ] 「重发」用原 topic/payload/QoS/retain 预填发布面板，不自动发送
- [ ] IPC：`mqtt:messages:list/get/clear/export`
- [ ] typecheck 通过
- [ ] smoke 覆盖：落盘、分片轮转、1MB 拒收、二进制、清空、导出、搜索、重发预填
