# 04: 主进程到渲染层的 MQTT 事件通道

**What to build:** 用推送通道替代轮询，把连接状态、CONNACK、SUBACK、消息通知、发布结果与错误送到渲染层；事件带自增 `seq`，每个会话保留环形缓冲并支持按 `afterSeq` 重放。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] 主进程通过 `webContents.send('mqtt:event', event)` 推送事件
- [ ] 事件结构：`{ connectionId, sessionId, seq, type, at, payload }`，`seq` 每个会话单调递增
- [ ] 事件类型至少覆盖：`state`、`connack`、`suback`、`message`、`publish-result`、`error`
- [ ] `message` 事件只含元数据与截断预览；完整 payload 通过 `mqtt:messages:get` 获取
- [ ] 每个会话保留最近 1000 条事件；超出后丢弃最旧记录
- [ ] 新增 IPC `mqtt:replay(connectionId, afterSeq)`，返回缓冲内 `seq > afterSeq` 的事件
- [ ] preload 暴露 `mqtt.onEvent(cb)`（返回取消函数）与 `mqtt.replay(...)`
- [ ] 渲染层切换到某 Profile 时先订阅事件，再调用 replay，避免漏事件
- [ ] 多个 BrowserWindow 都能收到事件；窗口关闭后取消监听，不泄漏
- [ ] 事件解析失败或未知类型被忽略并记录，不导致渲染层崩溃
- [ ] typecheck 通过
- [ ] smoke 覆盖：事件顺序、seq 连续性、replay 补齐、取消监听后不再收到事件
