# MQTT 做成独立模块，不接入 Target / API 体系

## Status

accepted（2026-10-27）

## Context

产品需要集成 MQTT 连接测试，参照实现为 MQTTX。最初的方案是把 MQTT 做成 `target_type: 'mqtt'` 的项目树 Target，以复用现有的目录、版本、克隆与文档能力。讨论后确认：MQTT 的运行时模型（长连接、订阅、消息流）与 HTTP 请求差异过大，硬接入 Target 会污染接口树、版本快照、DocShare、OpenAPI 导出与 Send Record 的语义。

## Decision

1. MQTT 是一个**与 API 页面平行的项目级独立模块**，数据存于 `offline-data/<project_id>/mqtt/`。
2. 不使用 `target_type`，不进入 ApisPage 树，不复用 Target 的版本、克隆、文档分享与 OpenAPI 导出。
3. 模块内自建轻量 `Profile Version`（仅覆盖 Connection Profile）与克隆能力。
4. 不复用 Environment 变量替换；Connection Profile 的字段完全自包含。
5. 拥有独立的导出：Connection Profile JSON、消息 JSONL/CSV、Connection Attempt JSONL，三者分开导出。
6. 拥有独立的 MCP 工具面（全量会话工具，消息用游标拉取），与现有接口执行工具互不依赖。
7. 一期不做 Flow 自动化节点；二期以独立事件节点接入。

## Considered Options

- **`target_type: 'mqtt'` 并复用 Target 基础设施**：开发量小，但 Target 的语义（API 请求定义、响应示例、HTTP 历史）与 MQTT 不匹配，且会迫使 DocShare / OpenAPI 处理无法表达的数据。
- **应用全局连接库**：适合跨项目共享 broker，但破坏现有的项目隔离、备份与清理模型。
- **把 MQTT 包装成 HTTP 请求**：语义错误，无法表达长连接、订阅与消息流。

## Consequences

- 模块会重复实现一部分列表、版本与导出模式，这是为语义清晰付出的成本。
- MQTT 数据必须纳入项目的备份、清理与容量统计流程，否则会成为孤立目录。
- 现有接口相关代码不需要为 MQTT 增加分支，降低了回归风险。
- 未来若要把 MQTT 并入统一 Target 体系，需要一次数据迁移。
