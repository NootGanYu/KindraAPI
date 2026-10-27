# 03: 主进程 MQTT 会话管理器

**What to build:** 引入 `mqtt` 依赖，在主进程实现单例会话管理器：按 `connection_id` 建立、断开、重连与状态机；同一 Profile 全局单会话、并发上限 8、切换项目断开；实现指数退避与自动重订阅。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] `package.json` 新增 `mqtt` 依赖，主进程可 `require`/`import` 并成功连接真实 broker
- [ ] 新增 `src/main/mqtt/sessionManager.ts`（或等价模块），单例持有全部会话
- [ ] 会话键为 `connection_id`；同一 Profile 已有会话时，新的 UI/MCP 连接请求返回明确冲突错误
- [ ] 会话带 `owner: 'ui' | 'mcp'`，状态包含 connecting / connected / reconnecting / closed
- [ ] 全局并发上限 8，超出返回可读错误
- [ ] 连接使用 Profile 的协议版本、clientId、凭据、TLS、Will、keepalive、clean session 与 connect_timeout_ms
- [ ] 支持 TCP/TLS/WS/WSS；WS 使用 `ws_path`
- [ ] CONNACK 成功/失败均产生一条 `kind: 'connect'` 的 Connection Attempt（写入逻辑见 05）
- [ ] 断线后按 1s→2s→4s→8s→16s→30s 封顶指数退避重连，直到手动断开
- [ ] 重连成功后自动重订阅 Profile 中保存的 Topic Filter
- [ ] 手动断开、切换项目调用 `mqtt:disconnectAll(projectId)`、应用退出时清理全部会话与定时器
- [ ] 「测试连接」使用临时会话，不注册进持久会话表，结束后关闭
- [ ] 错误映射到 spec 的分类（dns/tcp/tls/auth/acl/protocol/invalid/timeout/unknown），保留原始错误与建议
- [ ] IPC：`mqtt:connect`、`mqtt:disconnect`、`mqtt:disconnectAll`、`mqtt:sessions:list`
- [ ] typecheck 与 build 通过
- [ ] smoke 用 `aedes` 覆盖：连接成功、认证失败、协议版本不兼容、单 Profile 冲突、并发上限、断线重连与自动重订阅、切换项目断开
