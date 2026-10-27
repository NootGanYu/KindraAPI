import { createId } from './factories'

// ---------------------------------------------------------------------------
// MQTT 模块数据契约
// 独立模块（ADR-0003）：不复用 Target / Environment / DocShare / SendRecord。
// ---------------------------------------------------------------------------

export type MqttTransport = 'tcp' | 'tls' | 'ws' | 'wss'
export type MqttProtocolVersion = 4 | 5
export type MqttQos = 0 | 1 | 2
export type MqttPayloadEncoding = 'utf8' | 'base64'
export type MqttPayloadView = 'json' | 'plain' | 'hex' | 'base64'
export type MqttErrorCategory =
  | 'dns'
  | 'tcp'
  | 'tls'
  | 'auth'
  | 'acl'
  | 'protocol'
  | 'invalid'
  | 'timeout'
  | 'unknown'

export interface MqttUserProperty {
  key: string
  value: string
}

export interface MqttTlsConfig {
  ca_path?: string
  cert_path?: string
  key_path?: string
  passphrase?: string
  reject_unauthorized: boolean
  servername?: string
  alpn?: string[]
  min_version?: string
  inline?: {
    ca?: string
    cert?: string
    key?: string
  }
}

export interface MqttWill {
  topic: string
  payload: string
  qos: MqttQos
  retain: boolean
  delay_interval_s?: number
  user_properties?: MqttUserProperty[]
}

export interface MqttSubscription {
  filter: string
  qos: MqttQos
}

export interface MqttMqtt5Config {
  session_expiry_interval_s?: number
  receive_maximum?: number
  topic_alias_maximum?: number
  user_properties?: MqttUserProperty[]
}

export interface MqttRetention {
  max_messages?: number
  max_bytes?: number
  max_age_days?: number
}

export interface MqttConnectionProfile {
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
  tls?: MqttTlsConfig
  will?: MqttWill
  subscriptions: MqttSubscription[]
  mqtt5?: MqttMqtt5Config
  retention?: MqttRetention
  created_at: string
  updated_at: string
}

export interface MqttProfileSummary {
  connection_id: string
  project_id: string
  name: string
  group?: string
  host: string
  port: number
  transport: MqttTransport
  protocol_version: MqttProtocolVersion
  client_id: string
  subscription_count: number
  created_at: string
  updated_at: string
}

export interface MqttProfileVersion {
  version_id: string
  connection_id: string
  created_at: string
  name: string
  snapshot: MqttConnectionProfile
}

export interface MqttProfileVersionSummary {
  version_id: string
  connection_id: string
  created_at: string
  name: string
  host: string
  port: number
  protocol_version: MqttProtocolVersion
  subscription_count: number
}

// ---------------------------------------------------------------------------
// Connection Attempt
// ---------------------------------------------------------------------------

export interface MqttConnackInfo {
  return_code?: number
  reason_code?: number
  session_present?: boolean
  protocol_version?: number
  client_id?: string
}

export interface MqttRoundTrip {
  enabled: boolean
  topic?: string
  success?: boolean
  latency_ms?: number
  error?: string
}

export interface MqttAttemptError {
  category: MqttErrorCategory
  message: string
  hint?: string
}

export interface MqttAttempt {
  attempt_id: string
  connection_id: string
  project_id: string
  kind: 'test' | 'connect'
  started_at: string
  duration_ms: number
  success: boolean
  connack?: MqttConnackInfo
  round_trip?: MqttRoundTrip
  error?: MqttAttemptError
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export type MqttMessageDirection = 'in' | 'out'

export interface MqttMessageRecord {
  seq: number
  connection_id: string
  session_id: string
  direction: MqttMessageDirection
  topic: string
  payload_encoding: MqttPayloadEncoding
  payload: string
  payload_bytes: number
  qos: MqttQos
  retain: boolean
  received_at: string
  properties?: Record<string, unknown>
  truncated?: boolean
}

export interface MqttMessageSummary {
  seq: number
  connection_id: string
  session_id: string
  direction: MqttMessageDirection
  topic: string
  payload_encoding: MqttPayloadEncoding
  preview: string
  payload_bytes: number
  qos: MqttQos
  retain: boolean
  received_at: string
  truncated?: boolean
}

// ---------------------------------------------------------------------------
// Session / event
// ---------------------------------------------------------------------------

export type MqttSessionStateName = 'connecting' | 'connected' | 'reconnecting' | 'closed'
export type MqttSessionOwner = 'ui' | 'mcp'
export type MqttSubscriptionState = 'pending' | 'subscribed' | 'error'

export interface MqttSessionSubscription {
  filter: string
  qos: MqttQos
  state: MqttSubscriptionState
  granted_qos?: number
  reason_code?: number
  error?: string
}

export interface MqttSessionState {
  connection_id: string
  session_id: string
  project_id: string
  owner: MqttSessionOwner
  state: MqttSessionStateName
  retry_count?: number
  next_retry_at?: string
  connected_at?: string
  subscriptions: MqttSessionSubscription[]
}

export type MqttEventType =
  | 'state'
  | 'connack'
  | 'suback'
  | 'message'
  | 'publish-result'
  | 'attempt'
  | 'error'

export interface MqttEvent {
  connectionId: string
  sessionId: string
  seq: number
  type: MqttEventType
  at: string
  payload: unknown
}

// ---------------------------------------------------------------------------
// 连接 / 订阅 / 发布
// ---------------------------------------------------------------------------

export interface MqttTestOptions {
  /** 往返验证：发布到唯一测试主题并回收。 */
  round_trip?: boolean
}

export interface MqttConnectResult {
  session: MqttSessionState
}

export interface MqttSubscribeResult {
  filter: string
  qos: MqttQos
  ok: boolean
  granted_qos?: number
  reason_code?: number
  reason_text?: string
  error?: string
}

export interface MqttPublishInput {
  topic: string
  payload: string
  payload_view: MqttPayloadView
  qos: MqttQos
  retain: boolean
  user_properties?: MqttUserProperty[]
}

export interface MqttPublishResult {
  ok: boolean
  topic: string
  qos: MqttQos
  retain: boolean
  at: string
  reason_code?: number
  reason_text?: string
  error?: string
}

export interface MqttPublishHistoryEntry extends MqttPublishInput {
  history_id: string
  at: string
  ok: boolean
}

export interface MqttLoopOptions {
  /** 最小 100ms。 */
  interval_ms: number
  /** 按次数停止。与 duration_ms 二选一。 */
  count?: number
  /** 按时长停止。 */
  duration_ms?: number
}

export interface MqttLoopState {
  running: boolean
  connection_id: string
  sent: number
  total?: number
  started_at?: string
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

export interface MqttExportResult {
  canceled: boolean
  path?: string
  bytes?: number
  count?: number
}

export interface MqttProfileExportOptions {
  connection_ids?: string[]
  /** 将证书/私钥文件内嵌为 PEM，或保留路径引用。 */
  embed_pem?: boolean
}

export interface MqttMessageExportOptions {
  connection_ids?: string[]
  format: 'jsonl' | 'csv'
}

// ---------------------------------------------------------------------------
// 默认值与校验
// ---------------------------------------------------------------------------

export const MQTT_TRANSPORT_PORTS: Record<MqttTransport, number> = {
  tcp: 1883,
  tls: 8883,
  ws: 8083,
  wss: 8084
}

export const MQTT_MAX_SESSIONS = 8
export const MQTT_MAX_PAYLOAD_BYTES = 1024 * 1024
export const MQTT_PREVIEW_BYTES = 64 * 1024
export const MQTT_EVENT_BUFFER = 1000
export const MQTT_ATTEMPT_INDEX_LIMIT = 500
export const MQTT_ATTEMPT_SHARD_LINES = 2000
export const MQTT_ATTEMPT_SHARD_BYTES = 10 * 1024 * 1024
export const MQTT_VERSION_LIMIT = 20
export const MQTT_PUBLISH_HISTORY_LIMIT = 50
export const MQTT_DEFAULT_SHARD_MESSAGES = 2000
export const MQTT_DEFAULT_SHARD_BYTES = 8 * 1024 * 1024
export const MQTT_DEFAULT_RETENTION: Required<MqttRetention> = {
  max_messages: 10000,
  max_bytes: 50 * 1024 * 1024,
  max_age_days: 7
}

function randomHex8(): string {
  let out = ''
  for (let i = 0; i < 8; i += 1) out += Math.floor(Math.random() * 16).toString(16)
  return out
}

export function createDefaultMqttProfile(
  projectId: string,
  partial: Partial<MqttConnectionProfile> = {}
): MqttConnectionProfile {
  const now = new Date().toISOString()
  const transport = partial.transport ?? 'tcp'
  return {
    connection_id: createId('mc'),
    project_id: projectId,
    name: '新连接',
    host: 'localhost',
    port: MQTT_TRANSPORT_PORTS[transport],
    transport,
    protocol_version: 5,
    client_id: `kindraapi-${randomHex8()}`,
    username: '',
    password: '',
    keepalive: 60,
    clean_session: true,
    connect_timeout_ms: 10000,
    tls: { reject_unauthorized: true },
    retention: {},
    created_at: now,
    updated_at: now,
    ...partial,
    subscriptions: partial.subscriptions ?? []
  }
}

export function toProfileSummary(profile: MqttConnectionProfile): MqttProfileSummary {
  return {
    connection_id: profile.connection_id,
    project_id: profile.project_id,
    name: profile.name,
    group: profile.group,
    host: profile.host,
    port: profile.port,
    transport: profile.transport,
    protocol_version: profile.protocol_version,
    client_id: profile.client_id,
    subscription_count: profile.subscriptions?.length ?? 0,
    created_at: profile.created_at,
    updated_at: profile.updated_at
  }
}

export function isSharedSubscription(filter: string): boolean {
  return filter.startsWith('$share/')
}

/** 返回共享订阅组名；非共享订阅返回 null。 */
export function sharedSubscriptionGroup(filter: string): string | null {
  if (!filter.startsWith('$share/')) return null
  const rest = filter.slice('$share/'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  return rest.slice(0, slash)
}

export function isValidTopicName(topic: string): boolean {
  if (!topic || topic.length > 65535) return false
  if (topic.includes('\u0000')) return false
  return !topic.includes('+') && !topic.includes('#')
}

export function isValidTopicFilter(filter: string): boolean {
  if (!filter || filter.length > 65535) return false
  if (/\s/.test(filter)) return false
  let body = filter
  if (isSharedSubscription(filter)) {
    const group = sharedSubscriptionGroup(filter)
    if (!group) return false
    body = filter.slice('$share/'.length + group.length + 1)
    if (!body) return false
  }
  const levels = body.split('/')
  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i]
    if (level.includes('#') && level !== '#') return false
    if (level === '#' && i !== levels.length - 1) return false
    if (level.includes('+') && level !== '+') return false
  }
  return true
}

export interface MqttValidationIssue {
  field: string
  message: string
}

export function validateMqttProfile(profile: MqttConnectionProfile): MqttValidationIssue[] {
  const issues: MqttValidationIssue[] = []
  if (!profile.name?.trim()) issues.push({ field: 'name', message: '名称不能为空' })
  if (!profile.host?.trim()) issues.push({ field: 'host', message: '地址不能为空' })
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
    issues.push({ field: 'port', message: '端口必须在 1-65535 之间' })
  }
  if (!profile.client_id?.trim()) issues.push({ field: 'client_id', message: 'clientId 不能为空' })
  if (profile.protocol_version !== 4 && profile.protocol_version !== 5) {
    issues.push({ field: 'protocol_version', message: '仅支持 MQTT 3.1.1 与 5.0' })
  }
  if (!Number.isFinite(profile.keepalive) || profile.keepalive < 0 || profile.keepalive > 65535) {
    issues.push({ field: 'keepalive', message: 'keepalive 必须在 0-65535 秒之间' })
  }
  if (
    !Number.isFinite(profile.connect_timeout_ms) ||
    profile.connect_timeout_ms < 500 ||
    profile.connect_timeout_ms > 120000
  ) {
    issues.push({ field: 'connect_timeout_ms', message: '连接超时必须在 0.5-120 秒之间' })
  }
  if ((profile.transport === 'ws' || profile.transport === 'wss') && profile.ws_path) {
    if (!profile.ws_path.startsWith('/')) {
      issues.push({ field: 'ws_path', message: 'WebSocket 路径必须以 / 开头' })
    }
  }
  const seen = new Set<string>()
  for (const sub of profile.subscriptions ?? []) {
    if (!isValidTopicFilter(sub.filter)) {
      issues.push({ field: 'subscriptions', message: `非法 Topic Filter：${sub.filter || '（空）'}` })
    } else if (seen.has(sub.filter)) {
      issues.push({ field: 'subscriptions', message: `重复 Topic Filter：${sub.filter}` })
    }
    seen.add(sub.filter)
    if (sub.qos !== 0 && sub.qos !== 1 && sub.qos !== 2) {
      issues.push({ field: 'subscriptions', message: `非法 QoS：${sub.qos}` })
    }
  }
  if (profile.will) {
    if (!isValidTopicName(profile.will.topic)) {
      issues.push({ field: 'will.topic', message: 'Will 主题非法' })
    }
    if (profile.will.qos !== 0 && profile.will.qos !== 1 && profile.will.qos !== 2) {
      issues.push({ field: 'will.qos', message: 'Will QoS 非法' })
    }
  }
  return issues
}

export function assertValidMqttProfile(profile: MqttConnectionProfile): void {
  const issues = validateMqttProfile(profile)
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join('；'))
  }
}

// ---------------------------------------------------------------------------
// payload 编解码（主进程与渲染层共用，避免依赖 Node Buffer）
// ---------------------------------------------------------------------------

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

export function hexToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '')
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error('Hex 内容非法：必须是偶数长度的十六进制字符')
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function payloadRecordBytes(record: Pick<MqttMessageRecord, 'payload' | 'payload_encoding'>): Uint8Array {
  return record.payload_encoding === 'base64'
    ? base64ToBytes(record.payload)
    : utf8ToBytes(record.payload)
}

/** 把用户输入按视图转换为可存储的 payload。 */
export function encodePayloadInput(
  input: string,
  view: MqttPayloadView
): { payload: string; payload_encoding: MqttPayloadEncoding; bytes: number } {
  switch (view) {
    case 'json': {
      const trimmed = input.trim()
      if (trimmed) {
        try {
          JSON.parse(trimmed)
        } catch {
          throw new Error('JSON 内容非法，无法发送')
        }
      }
      const bytes = utf8ToBytes(input)
      return { payload: input, payload_encoding: 'utf8', bytes: bytes.length }
    }
    case 'hex': {
      const bytes = hexToBytes(input)
      return { payload: bytesToBase64(bytes), payload_encoding: 'base64', bytes: bytes.length }
    }
    case 'base64': {
      let bytes: Uint8Array
      try {
        bytes = base64ToBytes(input.replace(/\s+/g, ''))
      } catch {
        throw new Error('Base64 内容非法')
      }
      return { payload: input.replace(/\s+/g, ''), payload_encoding: 'base64', bytes: bytes.length }
    }
    case 'plain':
    default: {
      const bytes = utf8ToBytes(input)
      return { payload: input, payload_encoding: 'utf8', bytes: bytes.length }
    }
  }
}

/** 把已存储的 payload 转换为展示文本。 */
export function renderPayload(
  record: Pick<MqttMessageRecord, 'payload' | 'payload_encoding'>,
  view: MqttPayloadView
): string {
  const bytes = payloadRecordBytes(record)
  switch (view) {
    case 'hex':
      return bytesToHex(bytes)
    case 'base64':
      return bytesToBase64(bytes)
    case 'json': {
      const text = bytesToUtf8(bytes)
      try {
        return JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        return text
      }
    }
    case 'plain':
    default:
      return bytesToUtf8(bytes)
  }
}

// ---------------------------------------------------------------------------
// MQTT 原因码
// ---------------------------------------------------------------------------

const MQTT5_REASON_TEXT: Record<number, string> = {
  0x00: '成功',
  0x01: '授予 QoS 1',
  0x02: '授予 QoS 2',
  0x04: '带遗嘱断开',
  0x10: '无匹配订阅者',
  0x80: '未指定错误',
  0x81: '报文格式错误',
  0x82: '协议错误',
  0x83: '实现特定错误',
  0x84: '不支持的协议版本',
  0x85: 'clientId 无效',
  0x86: '用户名或密码错误',
  0x87: '未授权',
  0x88: '服务不可用',
  0x89: '服务繁忙',
  0x8a: '已被封禁',
  0x8b: '认证方法不支持',
  0x8c: 'keepalive 超时',
  0x8d: '会话被接管',
  0x8e: 'Topic Filter 无效',
  0x8f: 'Topic Name 无效',
  0x90: '报文标识符已占用',
  0x91: '报文标识符不存在',
  0x92: '超出 Receive Maximum',
  0x93: 'Topic Alias 无效',
  0x94: '报文过大',
  0x95: '消息速率过高',
  0x96: '配额已用尽',
  0x97: '管理员操作',
  0x98: 'payload 格式无效',
  0x99: '不支持 retain',
  0x9a: '不支持该 QoS',
  0x9b: '请使用其他服务器',
  0x9c: '服务器已迁移',
  0x9d: '不支持共享订阅',
  0x9e: '连接速率过高',
  0x9f: '超过最大连接时间',
  0xa0: '不支持订阅标识符',
  0xa1: '不支持通配符订阅',
  0xa2: '不支持订阅标识符'
}

const MQTT311_CONNACK_TEXT: Record<number, string> = {
  0: '连接已接受',
  1: '不支持的协议版本',
  2: 'clientId 被拒绝',
  3: '服务不可用',
  4: '用户名或密码错误',
  5: '未授权'
}

export function mqttReasonText(
  code: number | null | undefined,
  kind: 'connack' | 'puback' | 'suback' | 'disconnect' = 'connack',
  protocolVersion: MqttProtocolVersion = 5
): string {
  if (code === null || code === undefined) return '未知'
  if (protocolVersion === 4 && kind === 'connack') {
    return MQTT311_CONNACK_TEXT[code] ?? `原因码 ${code}`
  }
  const text = MQTT5_REASON_TEXT[code]
  const hex = `0x${code.toString(16).padStart(2, '0')}`
  return text ? `${hex} ${text}` : hex
}

export function mqttErrorHint(category: MqttErrorCategory): string {
  switch (category) {
    case 'dns':
      return '检查主机名是否正确，以及本机 DNS / 网络是否可用。'
    case 'tcp':
      return '检查 broker 地址与端口、防火墙，以及服务是否已启动。'
    case 'tls':
      return '检查证书链、主机名、ALPN 与最低 TLS 版本；自签名环境可临时关闭证书校验。'
    case 'auth':
      return '检查用户名、密码与 broker 的认证配置。'
    case 'acl':
      return '当前账号无权执行该操作，请检查 broker 的 ACL 规则。'
    case 'protocol':
      return '检查协议版本与 broker 支持范围（本模块仅支持 3.1.1 与 5.0）。'
    case 'invalid':
      return '检查地址、端口、clientId 与 Topic 等字段格式。'
    case 'timeout':
      return '检查网络连通性，或适当增大连接超时时间。'
    default:
      return '请结合原始错误信息排查 broker 与网络状态。'
  }
}
