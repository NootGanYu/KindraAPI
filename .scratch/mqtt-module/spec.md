# MQTT 模块 Spec

Status: ready-for-agent
Date: 2026-10-27
Feature: mqtt-module

## Problem Statement

KindraAPI 目前只能调试 HTTP 请求。用户需要在本机直接连接 MQTT broker，验证连接参数、订阅主题、收发消息并排查 ACL/TLS 认证问题。参照实现为 MQTTX，但本模块必须与现有 API 页面保持独立：它不使用 Target 树、Environment 变量、DocShare、OpenAPI 或 Send Record。

本 spec 交付一个项目级、独立入口的 MQTT 客户端：连接配置管理、连接测试、持久会话、多订阅、消息收件箱、发布面板、MQTT 5 常用特性、配置版本/克隆、三类导出，以及 MCP 会话工具。不含 Payload 脚本、压测与 CLI。

## Solution

新增独立一级模块「MQTT」：

- 左侧为项目内 Connection Profile 列表（搜索 + 分组），右侧上下分栏：上方连接配置与订阅，下方消息收件箱与发布面板。
- 主进程持有会话，渲染层通过推送事件接收连接状态与消息通知。
- 「测试连接」与持久「连接」是两个动作，均写入 Connection Attempt 记录。
- 收到的消息默认落盘，分片存储并按条数/大小/天数轮转。
- 发布支持 QoS、retain、MQTT 5 属性、最近历史与有护栏的定时/循环。
- 通过 MCP 暴露全量会话工具，消息以游标拉取。

## User Stories

### 模块与导航

1. 作为一个用户，我希望左侧导航有独立的「MQTT」入口，以便与 API 页面分开使用。
2. 作为一个用户，我希望 MQTT 模块跟随当前项目，切换项目时看到该项目自己的连接与消息。
3. 作为一个用户，我希望没有连接时看到空态与「新建连接」入口，以便快速开始。
4. 作为一个用户，我希望左侧连接列表支持搜索与按分组折叠，以便在大量 broker 中定位。
5. 作为一个用户，我希望新建、编辑、删除、复制 Connection Profile，以便管理多套环境。

### Connection Profile

6. 作为一个用户，我希望配置地址、端口、传输（TCP/TLS/WS/WSS）、协议版本（3.1.1/5.0）、clientId、账号密码、keepalive、clean session 与连接超时。
7. 作为一个用户，我希望配置 TLS 的 CA、客户端证书、私钥、passphrase、跳过证书校验、SNI、ALPN 与最低 TLS 版本。
8. 作为一个用户，我希望配置 Will 的主题、payload、QoS、retain；MQTT 5 下还能配置延迟与 User Properties。
9. 作为一个用户，我希望新建配置时预填合理默认值，以便不填也能连上常见 broker。
10. 作为一个用户，我希望密码支持显示/隐藏，以免在录屏或共享屏幕时泄漏。
11. 作为一个用户，我希望 TLS 证书默认只记录文件路径，导出时可选择内嵌 PEM，以便配置可移植。
12. 作为一个用户，我希望地址、clientId 等字段有即时校验，以便在连接前发现明显错误。

### 连接、重连与测试

13. 作为一个用户，我希望「测试连接」快速返回成功/失败、CONNACK 码与各阶段耗时，而不留下持久会话。
14. 作为一个用户，我希望「连接」建立持久会话，可手动断开与重连。
15. 作为一个用户，我希望可选的往返验证：发布到唯一测试主题并回收，以确认发布、订阅与 ACL 都可用。
16. 作为一个用户，我希望失败时看到分类错误（DNS/TCP/TLS/认证/ACL/协议版本/参数）以及原始错误与修复建议。
17. 作为一个用户，我希望断线后自动指数退避重连（1s→2s→4s→8s→16s→30s 封顶），并在 UI 看到重试次数与下次时间。
18. 作为一个用户，我希望重连成功后自动重新订阅已保存的主题。
19. 作为一个用户，我希望应用重启后不自动连接，只恢复页面与选中的配置，以免开机即外连。
20. 作为一个用户，我希望同一 Connection Profile 同时只存在一个会话；UI 与 MCP 冲突时明确报错。
21. 作为一个用户，我希望不同 Profile 可并发连接，最多 8 个；切换项目时自动断开当前项目全部会话。

### 订阅

22. 作为一个用户，我希望一个会话可以添加多个 Topic Filter，每个独立 QoS。
23. 作为一个用户，我希望订阅列表保存在 Profile 中，重连后自动重订阅。
24. 作为一个用户，我希望订阅/取消订阅返回 SUBACK 码，失败时显示 ACL 或协议错误。
25. 作为一个用户，我希望看到 `$share/<group>/` 形式的共享订阅被识别并标注。

### 消息收件箱

26. 作为一个用户，我希望消息列表显示主题、方向、QoS、retain、时间与 payload 预览。
27. 作为一个用户，我希望按主题过滤、暂停自动滚动、清空消息，以便在高频主题下稳定排查。
28. 作为一个用户，我希望在 JSON、Plain、Hex、Base64 之间切换 payload 视图。
29. 作为一个用户，我希望打开单条消息详情并复制完整 payload。
30. 作为一个用户，我希望搜索当前已加载的消息（payload 与主题），而不是全量历史索引。
31. 作为一个用户，我希望把消息导出为 JSONL 或 CSV，以便离线分析。
32. 作为一个用户，我希望对消息点「重发」时，发布面板被预填且需要手动确认，避免误发生产。
33. 作为一个用户，我希望单条 payload 超过 1MB 时被拒收并标注；预览截断但完整内容落盘。
34. 作为一个用户，我希望二进制 payload 以 Hex/Base64 展示且不损坏。
35. 作为一个用户，我希望消息默认持久化，重启后仍可查看，并按条数/大小/天数自动轮转。

### 发布

36. 作为一个用户，我希望填写主题、payload、QoS 与 retain 后发送，并看到 PUBACK/PUBREC 结果。
37. 作为一个用户，我希望 payload 支持 JSON、Plain、Hex、Base64 四种输入视图。
38. 作为一个用户，我希望查看最近发布历史并一键复用。
39. 作为一个用户，我希望配置定时/循环发布（间隔 ≥100ms，次数或时长上限），启动前二次确认，并可随时停止。

### MQTT 5 与 TLS

40. 作为一个用户，我希望 MQTT 5 下看到原因码与可读解释，而不是裸数字。
41. 作为一个用户，我希望编辑连接、发布、遗嘱与订阅的 User Properties。
42. 作为一个用户，我希望配置 Session Expiry、Receive Maximum 与 Topic Alias Maximum。
43. 作为一个用户，我希望 TLS 证书错误与认证失败被明确区分，并给出下一步建议。

### 版本、克隆与导出

44. 作为一个用户，我希望保存 Connection Profile 时自动生成轻量版本快照，并可回滚。
45. 作为一个用户，我希望复制一份 Connection Profile 作为变体。
46. 作为一个用户，我希望分别导出 Connection Profile JSON、消息 JSONL/CSV、Connection Attempt JSONL。
47. 作为一个用户，我希望导出 Connection Profile 时被告知该文件包含明文凭据。

### MCP

48. 作为一个 AI agent，我希望列出项目内的 Connection Profile 与当前会话。
49. 作为一个 AI agent，我希望测试连接、连接、订阅、取消订阅、发布与断开。
50. 作为一个 AI agent，我希望用游标拉取订阅期间收到的消息，而不是阻塞等待。
51. 作为一个运维者，我希望会话类工具受 `allow_execute` 控制，且 MCP 会话空闲 5 分钟后自动回收。

### 持久化与质量

52. 作为一个用户，我希望 MQTT 数据按项目隔离，写入是原子的，旧项目缺少目录时返回空集合而不是报错。
53. 作为一个 QA 工程师，我希望 smoke 覆盖 Profile、连接、订阅、发布、消息、Attempt、MCP 与错误分类。
54. 作为一个 QA 工程师，我希望关键 UI 流程有自动化覆盖。
55. 作为一个开发者，我希望 typecheck 与 build 通过。

## Implementation Decisions

### 模块边界

- MQTT 是独立模块（ADR-0003）：不新增 `target_type`，不进入 ApisPage 树，不复用 Target 版本、克隆、DocShare、OpenAPI 与 Send Record。
- 不接 Environment 变量替换；Connection Profile 字段完全自包含。
- 新增一级导航「MQTT」与路由 `/mqtt`。
- 一期不做 Flow 自动化节点；二期以独立事件节点接入。

### 存储布局

可移植的项目数据（可能随项目 Git 仓库管理）：

```
offline-data/<project_id>/mqtt/
  index.json                         # Connection Profile 摘要列表
  connections/<connection_id>.json   # 完整 Connection Profile
  versions/<connection_id>/index.json
  versions/<connection_id>/<version_id>.json
```

本地高容量数据（不进项目 Git 仓库，沿用 `offline-data-local` 的先例）：

```
offline-data-local/projects/<project_id>/mqtt/
  attempts/index.json                # 最近 500 条摘要
  attempts/<connection_id>.jsonl     # 追加写，2000 行或 10MB 轮转
  messages/<connection_id>/index.json    # 分片元数据
  messages/<connection_id>/<shard_id>.jsonl
  publish-history.json               # 最近 50 条发布记录
```

- JSON 使用现有原子写（临时文件 + rename）；JSONL 使用追加写，读取时跳过最后一行不完整记录。
- 消息分片默认 2000 条 / 8MB 一片；分片索引记录 `seq` 范围、条数、字节数与时间范围。

### 数据契约

```ts
type MqttTransport = 'tcp' | 'tls' | 'ws' | 'wss'
type MqttProtocolVersion = 4 | 5   // 4 = 3.1.1, 5 = 5.0
type MqttQos = 0 | 1 | 2

interface MqttConnectionProfile {
  connection_id: string
  project_id: string
  name: string
  group?: string
  host: string
  port: number
  transport: MqttTransport
  ws_path?: string
  protocol_version: MqttProtocolVersion
  client_id: string
  username?: string
  password?: string
  keepalive: number
  clean_session: boolean
  connect_timeout_ms: number
  tls?: {
    ca_path?: string
    cert_path?: string
    key_path?: string
    passphrase?: string
    reject_unauthorized: boolean
    servername?: string
    alpn?: string[]
    min_version?: string
    inline?: { ca?: string; cert?: string; key?: string }
  }
  will?: {
    topic: string
    payload: string
    qos: MqttQos
    retain: boolean
    delay_interval_s?: number
    user_properties?: Array<{ key: string; value: string }>
  }
  subscriptions: Array<{ filter: string; qos: MqttQos }>
  mqtt5?: {
    session_expiry_interval_s?: number
    receive_maximum?: number
    topic_alias_maximum?: number
    user_properties?: Array<{ key: string; value: string }>
  }
  retention?: { max_messages?: number; max_bytes?: number; max_age_days?: number }
  created_at: string
  updated_at: string
}

interface MqttAttempt {
  attempt_id: string
  connection_id: string
  project_id: string
  kind: 'test' | 'connect'
  started_at: string
  duration_ms: number
  success: boolean
  connack?: {
    return_code?: number
    reason_code?: number
    session_present?: boolean
    protocol_version?: number
    client_id?: string
  }
  round_trip?: {
    enabled: boolean
    topic?: string
    success?: boolean
    latency_ms?: number
    error?: string
  }
  error?: {
    category: 'dns' | 'tcp' | 'tls' | 'auth' | 'acl' | 'protocol' | 'invalid' | 'timeout' | 'unknown'
    message: string
    hint?: string
  }
}

interface MqttMessageRecord {
  seq: number
  connection_id: string
  session_id: string
  direction: 'in' | 'out'
  topic: string
  payload_encoding: 'utf8' | 'base64'
  payload: string
  payload_bytes: number
  qos: MqttQos
  retain: boolean
  received_at: string
  properties?: Record<string, unknown>
  truncated?: boolean
}

interface MqttSessionState {
  connection_id: string
  session_id: string
  owner: 'ui' | 'mcp'
  state: 'connecting' | 'connected' | 'reconnecting' | 'closed'
  retry_count?: number
  next_retry_at?: string
  connected_at?: string
}
```

### 默认值

- 协议版本：MQTT 5.0。
- clientId：`kindraapi-<8 位小写十六进制>`，用户可改。
- keepalive：60 秒；clean session：true；连接超时：10 秒。
- 传输：TCP；端口 1883（TCP）/ 8883（TLS）/ 8083（WS）/ 8084（WSS）随传输切换预填。
- 测试模式不自动重连；持久会话开启指数退避重连。
- Round-trip Check：默认关闭；开启时主题为 `kindraapi/test/<session_id>`，QoS 0，retain false，3 秒超时，payload 含时间戳。

### 会话模型与事件

- 主进程单例 `MqttSessionManager`，键为 `connection_id`；全局最多 8 个会话。
- 同一 Profile 全局只允许一个会话；UI 与 MCP 冲突时返回明确错误，不复用、不自动改 clientId。
- 会话带 `owner: 'ui' | 'mcp'`；MCP 会话空闲 5 分钟自动断开；UI 会话持续到手动断开或切换项目。
- 切换项目时调用 `mqtt:disconnectAll(projectId)`；应用退出时断开全部。
- 事件通过 `webContents.send('mqtt:event', { connectionId, sessionId, seq, type, at, payload })` 推送；每个会话保留最近 1000 条事件的环形缓冲，渲染层可用 `mqtt:replay(connectionId, afterSeq)` 补齐。
- `message` 事件只带元数据与截断预览；完整 payload 通过 `mqtt:messages:get` 读取，避免大 payload 走事件通道。
- 「测试连接」使用临时会话，不注册进持久会话表；结束后关闭并写入 Attempt。
- 「连接」在 CONNACK 成功/失败时写入 Attempt；断线重连不重复写 Attempt。

### 订阅与消息

- 订阅列表保存在 Connection Profile；重连成功后自动重订阅。
- 收到消息时分配会话内单调递增 `seq`，先写消息存储再发事件（保证事件到达时可按 seq 取回）。
- 单条 payload 上限 1MB；超出则拒收并记录 `truncated` 事件。
- 预览最多 64KB；完整内容落盘。
- 保留策略默认 10000 条 / 50MB / 7 天，Profile 可覆盖；轮转在写入后按分片检查执行。
- 搜索只针对已加载到内存的消息（含按需加载的分片），不建持久索引。

### 发布与定时

- 发布支持 QoS 0/1/2、retain、MQTT 5 User Properties 与 payload 视图（JSON/Plain/Hex/Base64）。
- 发布历史保存最近 50 条（项目级 `publish-history.json`），可一键回填。
- 定时/循环：间隔 ≥100ms；次数或时长上限；启动前二次确认并展示预计条数；提供停止按钮；不提供无限高速循环。

### 错误分类

统一映射到 `MqttAttempt.error.category`：

- `dns`：`ENOTFOUND` / `EAI_AGAIN`
- `tcp`：`ECONNREFUSED` / `ECONNRESET` / 网络不可达
- `tls`：证书校验、协议版本、ALPN、私钥错误
- `auth`：CONNACK 4/5（3.1.1）或 0x86/0x87（5.0）等认证类原因码
- `acl`：发布/订阅的 Not authorized 原因码（0x87）
- `protocol`：Unsupported Protocol Version（0x84）、协议错误
- `invalid`：字段校验失败
- `timeout`：连接超时
- 未知错误归 `unknown`。所有分类都保留原始错误文本与建议。

### MCP

新增工具（名称不带前缀，与现有工具一致）：

- `mqtt_list_profiles`（读取）
- `mqtt_create_profile`（写入）
- `mqtt_update_profile`（写入）
- `mqtt_delete_profile`（写入）
- `mqtt_test_connection`（执行）
- `mqtt_connect`（执行）
- `mqtt_subscribe`（执行）
- `mqtt_unsubscribe`（执行）
- `mqtt_publish`（执行）
- `mqtt_drain_messages`（读取，游标）
- `mqtt_list_sessions`（读取）
- `mqtt_disconnect`（执行）

权限沿用现有模型：连接/测试/订阅/发布/断开要求 `allow_execute`；Profile 创建/更新/删除要求 `allow_write`；列表与拉取不受限。`mqtt_drain_messages(session_id, cursor, limit)` 返回 `{ messages, nextCursor }`。

按 ADR-0004，`mqtt_list_profiles` 返回完整配置（含明文凭据）。

### UI

- 左侧连接列表：搜索、按 `group` 分组折叠、状态点（未连接/连接中/已连接/重连中）。
- 右上：连接参数表单、TLS/Will/MQTT 5 折叠面板、订阅列表、「测试连接」「连接/断开」按钮。
- 右下：消息收件箱（过滤、暂停、清空、视图切换、搜索、导出、重发）与发布面板（含定时/循环）分标签。
- 使用现有 `react-resizable-panels` 实现上下/左右可拖拽布局。
- 连接列表项右键菜单：编辑、复制、删除、导出。
- 导出 Connection Profile 前显示「包含明文凭据」确认框。

### 安全与边界

- 凭据按 ADR-0004 明文保存；配置导出包含凭据并提示。
- MQTT 数据不进入 DocShare、OpenAPI 与 Send Record。
- 旧项目缺少 `mqtt/` 目录时返回空集合，不迁移、不报错。
- 目标目录不存在、证书文件不可读、私钥与证书不匹配、主题非法、payload 超限、并发超限、Profile 冲突都要给出可读错误。

## Testing Decisions

### 什么算好测试

- 只验证外部可观察行为：IPC、MCP、存储 API 与 UI 操作的结果，不断言内部文件布局细节。
- 使用真实 MQTT 协议栈；测试 broker 用纯 JS 的 `aedes` 起在随机端口，不用 mock 连接。
- 正负用例同等覆盖：认证失败、ACL 拒绝、协议版本不兼容、超时、payload 超限、会话冲突。

### 测试缝

1. **现有 Electron smoke（首选）**：扩展 `scripts/smoke.ts`，在进程内启动 `aedes` broker，覆盖 Profile CRUD、测试连接、持久连接、订阅/发布、消息落盘与轮转、Attempt、MCP 工具、权限拒绝。`aedes` 作为 devDependency 引入。
2. **UI 自动化（沿用现有缝）**：扩展 `scripts/ui-smoke.cjs`，覆盖导航、Profile 表单、测试连接、订阅、收件箱视图切换与发布。
3. **TLS 负向用例**：使用不可信证书或关闭 `reject_unauthorized` 的配置验证分类；不引入完整证书链测试。

### 被测试的模块

- Profile 存储：项目隔离、原子写、旧目录空集合、版本快照。
- 会话管理：单 Profile 单会话、并发上限、冲突报错、退避重连、自动重订阅、项目切换断开。
- 测试连接：CONNACK 元信息、错误分类、Round-trip Check。
- 订阅：多主题、QoS、SUBACK 失败、共享订阅识别。
- 消息：落盘、分片轮转、1MB 限制、预览截断、二进制、导出、搜索。
- 发布：QoS/retain、发布历史、定时/循环护栏。
- MCP：工具参数、`allow_execute`、空闲回收、游标拉取。

### 明确不测

- 不测内部 JSONL 行格式的字段顺序。
- 不对消息 UI 做像素级快照。
- 不做大规模压测或吞吐基准（已明确不在范围内）。

## Out of Scope

- Payload 脚本变换、压测/基准、CLI。
- MQTT 3.1（仅支持 3.1.1 与 5.0）。
- HTTP/SOCKS 代理。
- Flow 自动化节点（二期）。
- 导入 MQTTX 配置或通用配置导入。
- `safeStorage` 凭据加密。
- 全量历史消息的持久化搜索索引。
- 多窗口会话同步、云同步、团队协作。
- Broker 侧的 ACL/会话管理、保留消息浏览器（只展示收到的消息）。

## Further Notes

- 术语见 `GLOSSARY.md` 的 MQTT 分组。
- 关键决策：ADR-0003（独立模块）、ADR-0004（明文凭据且导出包含）。
- 实现顺序按 tickets 编号；01 与 02 可并行，03 是其余运行时 ticket 的前置。
- MQTT 消息与 Attempt 放在 `offline-data-local`，避免项目 Git 仓库被高频消息撑大；Connection Profile 与版本放在项目目录，便于搬迁。
