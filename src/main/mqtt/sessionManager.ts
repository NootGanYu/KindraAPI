import fs from 'node:fs'
import { connect as mqttConnect } from 'mqtt'
import type {
  IClientOptions,
  IClientPublishOptions,
  IConnackPacket,
  IPublishPacket,
  ISubscriptionGrant,
  MqttClient,
  Packet
} from 'mqtt'
import type {
  MqttAttempt,
  MqttConnectionProfile,
  MqttConnackInfo,
  MqttErrorCategory,
  MqttEvent,
  MqttEventType,
  MqttLoopOptions,
  MqttLoopState,
  MqttMessageRecord,
  MqttMessageSummary,
  MqttPublishInput,
  MqttPublishResult,
  MqttRoundTrip,
  MqttSessionOwner,
  MqttSessionState,
  MqttSessionStateName,
  MqttSessionSubscription,
  MqttSubscribeResult,
  MqttSubscription,
  MqttTestOptions,
  MqttUserProperty
} from '@shared/mqtt'
import {
  MQTT_EVENT_BUFFER,
  MQTT_MAX_PAYLOAD_BYTES,
  MQTT_MAX_SESSIONS,
  assertValidMqttProfile,
  encodePayloadInput,
  isValidTopicFilter,
  isValidTopicName,
  mqttErrorHint,
  mqttReasonText,
  validateMqttProfile
} from '@shared/mqtt'
import { createId } from '@shared/factories'
import * as store from './store'
import { broadcastMqttEvent } from './events'

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]
const MCP_IDLE_MS = 5 * 60 * 1000

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    if (typeof timer.unref === 'function') timer.unref()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

interface LoopRuntime {
  timer: NodeJS.Timeout
  sent: number
  total?: number
  startedAt: number
  deadline?: number
  input: MqttPublishInput
  inFlight: boolean
  stopped: boolean
}

interface SessionRuntime {
  connectionId: string
  projectId: string
  sessionId: string
  owner: MqttSessionOwner
  profile: MqttConnectionProfile
  client: MqttClient | null
  state: MqttSessionStateName
  retryCount: number
  retryTimer: NodeJS.Timeout | null
  nextRetryAt?: string
  connectedAt?: string
  manualClose: boolean
  stopped: boolean
  attemptWritten: boolean
  wasConnected: boolean
  connectStartedAt: number
  connack?: MqttConnackInfo
  lastError?: { category: MqttErrorCategory; message: string; hint?: string }
  subscriptions: MqttSessionSubscription[]
  seq: number
  eventSeq: number
  events: MqttEvent[]
  lastActivity: number
  loop?: LoopRuntime
  loopSnapshot?: { sent: number; total?: number; startedAt: number }
  ready?: Deferred<MqttSessionState>
}

const sessions = new Map<string, SessionRuntime>()
let reaper: NodeJS.Timeout | null = null

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function emit(session: SessionRuntime, type: MqttEventType, payload: unknown): void {
  session.eventSeq += 1
  const event: MqttEvent = {
    connectionId: session.connectionId,
    sessionId: session.sessionId,
    seq: session.eventSeq,
    type,
    at: new Date().toISOString(),
    payload
  }
  session.events.push(event)
  if (session.events.length > MQTT_EVENT_BUFFER) {
    session.events.splice(0, session.events.length - MQTT_EVENT_BUFFER)
  }
  broadcastMqttEvent(event)
}

function toState(session: SessionRuntime): MqttSessionState {
  return {
    connection_id: session.connectionId,
    session_id: session.sessionId,
    project_id: session.projectId,
    owner: session.owner,
    state: session.state,
    retry_count: session.retryCount,
    next_retry_at: session.nextRetryAt,
    connected_at: session.connectedAt,
    subscriptions: session.subscriptions
  }
}

function requireSession(connectionId: string, projectId: string): SessionRuntime {
  const session = sessions.get(connectionId)
  if (!session) throw new Error('会话不存在或已关闭')
  if (session.projectId !== projectId) throw new Error('项目不匹配')
  return session
}

function requireConnectedSession(projectId: string, connectionId: string): SessionRuntime {
  const session = requireSession(connectionId, projectId)
  if (!session.client || session.state !== 'connected') {
    throw new Error('会话未连接')
  }
  return session
}

export function findSessionBySessionId(
  sessionId: string
): { session: SessionRuntime } | null {
  for (const session of sessions.values()) {
    if (session.sessionId === sessionId) return { session }
  }
  return null
}

function buildUrl(profile: MqttConnectionProfile): string {
  const scheme =
    profile.transport === 'tcp'
      ? 'mqtt'
      : profile.transport === 'tls'
        ? 'mqtts'
        : profile.transport
  const host =
    profile.host.includes(':') && !profile.host.startsWith('[')
      ? `[${profile.host}]`
      : profile.host
  const wsPath =
    (profile.transport === 'ws' || profile.transport === 'wss') && profile.ws_path
      ? profile.ws_path
      : ''
  return `${scheme}://${host}:${profile.port}${wsPath}`
}

function readPem(file: string | undefined, label: string): Buffer | undefined {
  if (!file) return undefined
  try {
    return fs.readFileSync(file)
  } catch {
    const error = new Error(`${label}不可读：${file}`)
    ;(error as NodeJS.ErrnoException).code = 'TLS_CONFIG'
    throw error
  }
}

function tlsOptions(profile: MqttConnectionProfile): Record<string, unknown> {
  const tls = profile.tls
  if (!tls) return { rejectUnauthorized: true }
  const out: Record<string, unknown> = { rejectUnauthorized: tls.reject_unauthorized }
  const ca = tls.inline?.ca ?? readPem(tls.ca_path, 'CA 证书')
  const cert = tls.inline?.cert ?? readPem(tls.cert_path, '客户端证书')
  const key = tls.inline?.key ?? readPem(tls.key_path, '客户端私钥')
  if (ca) out.ca = ca
  if (cert) out.cert = cert
  if (key) out.key = key
  if (tls.passphrase) out.passphrase = tls.passphrase
  if (tls.servername) out.servername = tls.servername
  if (tls.alpn?.length) out.ALPNProtocols = tls.alpn
  if (tls.min_version) out.minVersion = tls.min_version
  return out
}

function toUserProperties(
  list: MqttUserProperty[] | undefined
): Record<string, string | string[]> | undefined {
  if (!list?.length) return undefined
  const out: Record<string, string | string[]> = {}
  for (const item of list) {
    if (!item.key) continue
    if (out[item.key] === undefined) out[item.key] = item.value
    else if (Array.isArray(out[item.key])) (out[item.key] as string[]).push(item.value)
    else out[item.key] = [out[item.key] as string, item.value]
  }
  return Object.keys(out).length ? out : undefined
}

function buildOptions(profile: MqttConnectionProfile): IClientOptions {
  const options: IClientOptions = {
    protocolVersion: profile.protocol_version,
    clientId: profile.client_id,
    keepalive: profile.keepalive,
    clean: profile.clean_session,
    connectTimeout: profile.connect_timeout_ms,
    reconnectPeriod: 0,
    resubscribe: false
  }
  if (profile.username) options.username = profile.username
  if (profile.password) options.password = profile.password

  if (profile.protocol_version === 5) {
    const m = profile.mqtt5 ?? {}
    const properties: Record<string, unknown> = {}
    if (m.session_expiry_interval_s !== undefined) {
      properties.sessionExpiryInterval = m.session_expiry_interval_s
    }
    if (m.receive_maximum !== undefined) properties.receiveMaximum = m.receive_maximum
    if (m.topic_alias_maximum !== undefined) {
      properties.topicAliasMaximum = m.topic_alias_maximum
    }
    const userProperties = toUserProperties(m.user_properties)
    if (userProperties) properties.userProperties = userProperties
    if (Object.keys(properties).length) {
      options.properties = properties as IClientOptions['properties']
    }
  }

  if (profile.transport === 'tls' || profile.transport === 'wss') {
    Object.assign(options as Record<string, unknown>, tlsOptions(profile))
  }

  if (profile.will) {
    const properties: Record<string, unknown> = {}
    if (profile.protocol_version === 5 && profile.will.delay_interval_s !== undefined) {
      properties.willDelayInterval = profile.will.delay_interval_s
    }
    const userProperties = toUserProperties(profile.will.user_properties)
    if (userProperties) properties.userProperties = userProperties
    options.will = {
      topic: profile.will.topic,
      payload: Buffer.from(profile.will.payload, 'utf8'),
      qos: profile.will.qos,
      retain: profile.will.retain,
      ...(Object.keys(properties).length
        ? { properties: properties as NonNullable<IClientOptions['will']>['properties'] }
        : {})
    }
  }
  return options
}

// ---------------------------------------------------------------------------
// 错误分类
// ---------------------------------------------------------------------------

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN'])
const TCP_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNABORTED',
  'EPIPE'
])
const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'EPROTO',
  'TLS_CONFIG'
])

export function classifyError(
  error: unknown,
  protocolVersion: number,
  connack?: MqttConnackInfo,
  context: 'connect' | 'publish' | 'subscribe' = 'connect'
): { category: MqttErrorCategory; message: string; hint?: string } {
  const err = error as { code?: string | number; message?: string } | undefined
  const message = err?.message ? String(err.message) : String(error)
  let code: string | number | undefined = err?.code

  const connackCode = connack?.reason_code ?? connack?.return_code
  if (connackCode !== undefined && connackCode !== 0 && (!code || typeof code === 'number')) {
    code = connackCode
  }

  const finish = (category: MqttErrorCategory): { category: MqttErrorCategory; message: string; hint?: string } => ({
    category,
    message,
    hint: mqttErrorHint(category)
  })

  if (typeof code === 'number') {
    // 部分 broker/库在 5.0 下仍回传 3.1.1 的 4/5，按上下文解释。
    if (code === 4 || code === 5) {
      return finish(context === 'connect' ? 'auth' : 'acl')
    }
    if (code === 1 && context === 'connect') return finish('protocol')
    if (protocolVersion === 4) {
      if (code === 1) return finish('protocol')
      if (code === 2) return finish('invalid')
      if (code === 4 || code === 5) return finish('auth')
      if (code === 3) return finish('tcp')
    } else {
      if (code === 0x84) return finish('protocol')
      if (code === 0x85) return finish('invalid')
      if (code === 0x86) return finish('auth')
      if (code === 0x87) return finish(context === 'connect' ? 'auth' : 'acl')
      if (code === 0x88 || code === 0x89) return finish('tcp')
      if (code === 0x9b || code === 0x9c) return finish('tcp')
    }
  }

  const codeText = typeof code === 'string' ? code : ''
  if (DNS_CODES.has(codeText)) return finish('dns')
  if (TCP_CODES.has(codeText)) return finish('tcp')
  if (TLS_CODES.has(codeText)) return finish('tls')
  if (codeText === 'ETIMEDOUT') return finish('timeout')

  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return finish('dns')
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(message)) return finish('tcp')
  if (/certificate|self[- ]signed|handshake|TLS|SSL|ALPN|altname/i.test(message)) {
    return finish('tls')
  }
  if (/timed? ?out|connect timeout/i.test(message)) return finish('timeout')
  if (/unacceptable protocol|unsupported protocol|protocol version/i.test(message)) {
    return finish('protocol')
  }
  if (/not authori[sz]ed|权限|ACL/i.test(message)) return finish('acl')
  if (/bad username|bad password|not authori[sz]ed|认证/i.test(message)) return finish('auth')
  return finish('unknown')
}

// ---------------------------------------------------------------------------
// 会话生命周期
// ---------------------------------------------------------------------------

function writeAttemptOnce(
  session: SessionRuntime,
  success: boolean,
  error?: { category: MqttErrorCategory; message: string; hint?: string }
): void {
  if (session.attemptWritten) return
  session.attemptWritten = true
  const attempt: MqttAttempt = {
    attempt_id: createId('ma'),
    connection_id: session.connectionId,
    project_id: session.projectId,
    kind: 'connect',
    started_at: new Date(session.connectStartedAt).toISOString(),
    duration_ms: Date.now() - session.connectStartedAt,
    success,
    connack: session.connack,
    error
  }
  try {
    store.appendAttempt(session.projectId, attempt)
  } catch {
    // Attempt 落盘失败不应中断会话。
  }
  emit(session, 'attempt', attempt)
}

function scheduleRetry(session: SessionRuntime): void {
  if (session.manualClose || session.stopped || session.retryTimer) return
  const delay = RETRY_DELAYS[Math.min(session.retryCount, RETRY_DELAYS.length - 1)]
  session.retryCount += 1
  session.nextRetryAt = new Date(Date.now() + delay).toISOString()
  session.retryTimer = setTimeout(() => {
    session.retryTimer = null
    if (session.manualClose || session.stopped) return
    openClient(session)
  }, delay)
  if (typeof session.retryTimer.unref === 'function') session.retryTimer.unref()
}

function handleError(session: SessionRuntime, error: unknown): void {
  if (session.manualClose || session.stopped) return
  const info = classifyError(
    error,
    session.profile.protocol_version,
    session.connack,
    'connect'
  )
  session.lastError = info
  emit(session, 'error', info)
  if (!session.wasConnected) {
    writeAttemptOnce(session, false, info)
    session.ready?.reject(new Error(info.message))
  }
}

function handleConnected(session: SessionRuntime, packet: IConnackPacket): void {
  if (session.manualClose || session.stopped) return
  const info: MqttConnackInfo = {
    return_code: packet.returnCode,
    reason_code: packet.reasonCode,
    session_present: packet.sessionPresent,
    protocol_version: session.profile.protocol_version,
    client_id:
      packet.properties?.assignedClientIdentifier ?? session.profile.client_id
  }
  session.connack = info
  session.state = 'connected'
  session.wasConnected = true
  session.retryCount = 0
  session.nextRetryAt = undefined
  session.connectedAt = new Date().toISOString()
  session.lastError = undefined
  session.lastActivity = Date.now()
  if (session.retryTimer) {
    clearTimeout(session.retryTimer)
    session.retryTimer = null
  }
  emit(session, 'connack', info)
  emit(session, 'state', toState(session))
  writeAttemptOnce(session, true)
  session.ready?.resolve(toState(session))
  void subscribeInternal(
    session,
    session.profile.subscriptions.map((sub) => ({ filter: sub.filter, qos: sub.qos })),
    false
  ).catch(() => undefined)
}

function handleClose(session: SessionRuntime): void {
  session.client = null
  if (session.manualClose || session.stopped) {
    session.state = 'closed'
    return
  }
  if (!session.wasConnected && !session.attemptWritten) {
    const info =
      session.lastError ??
      classifyError(new Error('连接已关闭'), session.profile.protocol_version, session.connack)
    session.lastError = info
    writeAttemptOnce(session, false, info)
    session.ready?.reject(new Error(info.message))
  }
  session.state = 'reconnecting'
  emit(session, 'state', toState(session))
  scheduleRetry(session)
}

function decodeIncoming(payload: Buffer): {
  payload: string
  payload_encoding: 'utf8' | 'base64'
} {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(payload)
    return { payload: text, payload_encoding: 'utf8' }
  } catch {
    return { payload: payload.toString('base64'), payload_encoding: 'base64' }
  }
}

function sanitizeProperties(
  properties: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!properties) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue
    out[key] = Buffer.isBuffer(value) ? value.toString('base64') : value
  }
  return Object.keys(out).length ? out : undefined
}

function allocateSeq(session: SessionRuntime): number {
  const base = store.nextMessageSeq(session.projectId, session.connectionId)
  const seq = Math.max(session.seq, base)
  session.seq = seq + 1
  return seq
}

function recordMessage(
  session: SessionRuntime,
  direction: 'in' | 'out',
  topic: string,
  payload: string,
  payloadEncoding: 'utf8' | 'base64',
  payloadBytes: number,
  qos: 0 | 1 | 2,
  retain: boolean,
  properties?: Record<string, unknown>
): void {
  const record: MqttMessageRecord = {
    seq: allocateSeq(session),
    connection_id: session.connectionId,
    session_id: session.sessionId,
    direction,
    topic,
    payload_encoding: payloadEncoding,
    payload,
    payload_bytes: payloadBytes,
    qos,
    retain,
    received_at: new Date().toISOString(),
    properties
  }
  try {
    store.appendMessage(session.projectId, record, session.profile.retention)
  } catch {
    // 落盘失败时仍然把消息送到前端，避免完全丢失可观察性。
  }
  emit(session, 'message', store.toMessageSummary(record))
}

function handleIncoming(
  session: SessionRuntime,
  topic: string,
  payload: Buffer,
  packet: IPublishPacket
): void {
  if (session.manualClose || session.stopped) return
  if (payload.length > MQTT_MAX_PAYLOAD_BYTES) {
    emit(session, 'error', {
      category: 'invalid',
      message: '消息 payload 超过 1MB，已拒收',
      hint: '请减小 broker 侧的消息体积。',
      topic,
      truncated: true
    })
    return
  }
  const decoded = decodeIncoming(payload)
  recordMessage(
    session,
    'in',
    topic,
    decoded.payload,
    decoded.payload_encoding,
    payload.length,
    packet.qos as 0 | 1 | 2,
    Boolean(packet.retain),
    sanitizeProperties(packet.properties as Record<string, unknown> | undefined)
  )
}

function openClient(session: SessionRuntime): void {
  if (session.manualClose || session.stopped) return
  let client: MqttClient
  try {
    client = mqttConnect(buildUrl(session.profile), buildOptions(session.profile))
  } catch (error) {
    const info = classifyError(
      error,
      session.profile.protocol_version,
      session.connack,
      'connect'
    )
    session.lastError = info
    emit(session, 'error', info)
    writeAttemptOnce(session, false, info)
    session.ready?.reject(new Error(info.message))
    session.state = 'reconnecting'
    emit(session, 'state', toState(session))
    scheduleRetry(session)
    return
  }

  session.client = client
  client.on('packetreceive', (packet: Packet) => {
    if (packet.cmd !== 'connack') return
    const connack = packet as IConnackPacket
    session.connack = {
      return_code: connack.returnCode,
      reason_code: connack.reasonCode,
      session_present: connack.sessionPresent,
      protocol_version: session.profile.protocol_version,
      client_id:
        connack.properties?.assignedClientIdentifier ?? session.profile.client_id
    }
  })
  client.on('connect', (packet: IConnackPacket) => handleConnected(session, packet))
  client.on('message', (topic: string, payload: Buffer, packet: IPublishPacket) =>
    handleIncoming(session, topic, payload, packet)
  )
  client.on('error', (error: Error) => handleError(session, error))
  client.on('close', () => handleClose(session))
}

export function listSessions(projectId?: string): MqttSessionState[] {
  return [...sessions.values()]
    .filter((session) => !projectId || session.projectId === projectId)
    .map(toState)
}

export function startSession(
  projectId: string,
  connectionId: string,
  owner: MqttSessionOwner,
  waitForReady = false
): { state: MqttSessionState; ready: Promise<MqttSessionState> } {
  const existing = sessions.get(connectionId)
  if (existing && existing.state !== 'closed') {
    throw new Error(
      `该 Connection Profile 已存在会话（${existing.owner === 'ui' ? '界面' : 'MCP'}），请先断开`
    )
  }
  if (existing) sessions.delete(connectionId)
  if (sessions.size >= MQTT_MAX_SESSIONS) {
    throw new Error(`同时最多连接 ${MQTT_MAX_SESSIONS} 个 Connection Profile`)
  }
  const profile = store.getProfile(projectId, connectionId)
  if (!profile) throw new Error('Connection Profile 不存在')
  assertValidMqttProfile(profile)

  const ready = deferred<MqttSessionState>()
  const session: SessionRuntime = {
    connectionId,
    projectId,
    sessionId: createId('ms'),
    owner,
    profile,
    client: null,
    state: 'connecting',
    retryCount: 0,
    retryTimer: null,
    manualClose: false,
    stopped: false,
    attemptWritten: false,
    wasConnected: false,
    connectStartedAt: Date.now(),
    subscriptions: profile.subscriptions.map((sub) => ({
      filter: sub.filter,
      qos: sub.qos,
      state: 'pending'
    })),
    seq: store.nextMessageSeq(projectId, connectionId),
    eventSeq: 0,
    events: [],
    lastActivity: Date.now(),
    ready
  }
  sessions.set(connectionId, session)
  emit(session, 'state', toState(session))
  openClient(session)
  ensureReaper()
  if (!waitForReady) ready.promise.catch(() => undefined)
  return { state: toState(session), ready: ready.promise }
}

export async function connectSession(
  projectId: string,
  connectionId: string,
  owner: MqttSessionOwner
): Promise<MqttSessionState> {
  const { ready } = startSession(projectId, connectionId, owner, true)
  return ready
}

export function disconnect(
  projectId: string,
  connectionId: string,
  owner?: MqttSessionOwner
): void {
  const session = sessions.get(connectionId)
  if (!session) return
  if (session.projectId !== projectId) throw new Error('项目不匹配')
  if (owner && session.owner !== owner) {
    throw new Error(
      `会话由${session.owner === 'ui' ? '界面' : 'MCP'}持有，无法从当前入口断开`
    )
  }
  stopLoopInternal(session)
  session.manualClose = true
  session.stopped = true
  if (session.retryTimer) {
    clearTimeout(session.retryTimer)
    session.retryTimer = null
  }
  session.state = 'closed'
  const client = session.client
  session.client = null
  emit(session, 'state', toState(session))
  sessions.delete(connectionId)
  session.ready?.reject(new Error('会话已关闭'))
  if (client) {
    try {
      client.end(true)
    } catch {
      // 忽略关闭时的错误。
    }
  }
}

export function disconnectAll(projectId: string): void {
  for (const session of [...sessions.values()]) {
    if (session.projectId !== projectId) continue
    stopLoopInternal(session)
    session.manualClose = true
    session.stopped = true
    if (session.retryTimer) clearTimeout(session.retryTimer)
    const client = session.client
    session.client = null
    sessions.delete(session.connectionId)
    session.ready?.reject(new Error('会话已关闭'))
    if (client) {
      try {
        client.end(true)
      } catch {
        // ignore
      }
    }
  }
}

export function replay(connectionId: string, afterSeq: number): MqttEvent[] {
  const session = sessions.get(connectionId)
  if (!session) return []
  const seq = Number.isFinite(afterSeq) ? afterSeq : 0
  return session.events.filter((event) => event.seq > seq)
}

export function touchSession(connectionId: string): void {
  const session = sessions.get(connectionId)
  if (session) session.lastActivity = Date.now()
}

// ---------------------------------------------------------------------------
// 订阅
// ---------------------------------------------------------------------------

function persistSubscriptions(session: SessionRuntime): void {
  try {
    const profile = store.getProfile(session.projectId, session.connectionId)
    if (!profile) return
    profile.subscriptions = session.subscriptions
      .filter((sub) => sub.state !== 'error')
      .map((sub) => ({ filter: sub.filter, qos: sub.qos }))
    // 同步会话快照，确保重连后能重新订阅手动添加的主题。
    session.profile = { ...session.profile, subscriptions: profile.subscriptions }
    // 订阅是会话内动作，不需要每次生成 Profile 版本快照。
    store.saveProfile(session.projectId, profile, false)
  } catch {
    // 持久化订阅失败不影响当前会话。
  }
}

async function subscribeInternal(
  session: SessionRuntime,
  subscriptions: MqttSubscription[],
  persist: boolean
): Promise<MqttSubscribeResult[]> {
  if (!subscriptions.length) return []
  const client = session.client
  if (!client || session.state !== 'connected') throw new Error('会话未连接')

  const map: Record<string, { qos: 0 | 1 | 2 }> = {}
  for (const sub of subscriptions) {
    if (!isValidTopicFilter(sub.filter)) {
      throw new Error(`非法 Topic Filter：${sub.filter}`)
    }
    map[sub.filter] = { qos: sub.qos }
  }

  let grants: ISubscriptionGrant[] = []
  let failure: unknown
  try {
    grants = await withTimeout(
      new Promise<ISubscriptionGrant[]>((resolve, reject) => {
        client.subscribe(map, {}, (error, granted) => {
          if (error) reject(error)
          else resolve(granted ?? [])
        })
      }),
      15000,
      '订阅超时'
    )
  } catch (error) {
    failure = error
  }

  const results: MqttSubscribeResult[] = subscriptions.map((sub) => {
    if (failure) {
      const info = classifyError(
        failure,
        session.profile.protocol_version,
        session.connack,
        'subscribe'
      )
      return {
        filter: sub.filter,
        qos: sub.qos,
        ok: false,
        error: info.message,
        reason_text: info.message
      }
    }
    const grant = grants.find((item) => item.topic === sub.filter)
    const ok = grant !== undefined && grant.qos !== 128
    return {
      filter: sub.filter,
      qos: sub.qos,
      ok,
      granted_qos: ok ? (grant?.qos as number) : undefined,
      reason_code: ok ? undefined : 0x80,
      reason_text: ok
        ? `授予 QoS ${grant?.qos}`
        : mqttReasonText(0x80, 'suback', session.profile.protocol_version),
      error: ok ? undefined : '订阅被拒绝'
    }
  })

  for (const result of results) {
    const existing = session.subscriptions.find(
      (item) => item.filter === result.filter
    )
    const next: MqttSessionSubscription = {
      filter: result.filter,
      qos: result.qos,
      state: result.ok ? 'subscribed' : 'error',
      granted_qos: result.granted_qos,
      reason_code: result.reason_code,
      error: result.error
    }
    if (existing) Object.assign(existing, next)
    else session.subscriptions.push(next)
  }
  if (persist) persistSubscriptions(session)
  emit(session, 'suback', results)
  return results
}

export async function subscribe(
  projectId: string,
  connectionId: string,
  subscriptions: MqttSubscription[],
  persist = true
): Promise<MqttSubscribeResult[]> {
  const session = requireConnectedSession(projectId, connectionId)
  session.lastActivity = Date.now()
  return subscribeInternal(session, subscriptions, persist)
}

export async function unsubscribe(
  projectId: string,
  connectionId: string,
  filters: string[],
  persist = true
): Promise<boolean> {
  const session = requireConnectedSession(projectId, connectionId)
  const client = session.client!
  if (!filters.length) return true
  for (const filter of filters) {
    if (!isValidTopicFilter(filter)) throw new Error(`非法 Topic Filter：${filter}`)
  }
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      client.unsubscribe(filters, {}, (error) => {
        if (error) reject(error)
        else resolve()
      })
    }),
    15000,
    '取消订阅超时'
  )
  session.subscriptions = session.subscriptions.filter(
    (item) => !filters.includes(item.filter)
  )
  if (persist) persistSubscriptions(session)
  session.lastActivity = Date.now()
  emit(session, 'suback', { unsubscribed: filters })
  return true
}

// ---------------------------------------------------------------------------
// 发布
// ---------------------------------------------------------------------------

export async function publish(
  projectId: string,
  connectionId: string,
  input: MqttPublishInput,
  options: {
    persistHistory?: boolean
    loop?: { sent: number; total?: number }
  } = {}
): Promise<MqttPublishResult> {
  const session = requireConnectedSession(projectId, connectionId)
  const client = session.client!
  if (!isValidTopicName(input.topic)) throw new Error('Topic 非法：不能包含通配符')
  const encoded = encodePayloadInput(input.payload, input.payload_view)
  if (encoded.bytes > MQTT_MAX_PAYLOAD_BYTES) {
    throw new Error('payload 超过 1MB 限制，已拒绝发送')
  }
  const buffer =
    encoded.payload_encoding === 'base64'
      ? Buffer.from(encoded.payload, 'base64')
      : Buffer.from(encoded.payload, 'utf8')

  const publishOptions: IClientPublishOptions = {
    qos: input.qos,
    retain: input.retain
  }
  if (session.profile.protocol_version === 5) {
    const userProperties = toUserProperties(input.user_properties)
    if (userProperties) publishOptions.properties = { userProperties }
  }

  const at = new Date().toISOString()
  let packet: Packet | undefined
  try {
    packet = await withTimeout(
      new Promise<Packet | undefined>((resolve, reject) => {
        client.publish(input.topic, buffer, publishOptions, (error, pkt) => {
          if (error) reject(error)
          else resolve(pkt)
        })
      }),
      15000,
      '发布超时'
    )
  } catch (error) {
    const info = classifyError(
      error,
      session.profile.protocol_version,
      session.connack,
      'publish'
    )
    const result: MqttPublishResult = {
      ok: false,
      topic: input.topic,
      qos: input.qos,
      retain: input.retain,
      at,
      reason_text: info.message,
      error: info.message
    }
    emit(session, 'publish-result', { ...result, loop: options.loop })
    return result
  }

  const reasonCode = (packet as { reasonCode?: number } | undefined)?.reasonCode
  const result: MqttPublishResult = {
    ok: true,
    topic: input.topic,
    qos: input.qos,
    retain: input.retain,
    at,
    reason_code: reasonCode,
    reason_text:
      reasonCode !== undefined
        ? mqttReasonText(reasonCode, 'puback', session.profile.protocol_version)
        : `已发送（QoS ${input.qos}）`
  }
  session.lastActivity = Date.now()
  recordMessage(
    session,
    'out',
    input.topic,
    encoded.payload,
    encoded.payload_encoding,
    encoded.bytes,
    input.qos,
    input.retain,
    session.profile.protocol_version === 5 && input.user_properties?.length
      ? { userProperties: toUserProperties(input.user_properties) }
      : undefined
  )
  if (options.persistHistory !== false) {
    try {
      store.addPublishHistory(projectId, {
        ...input,
        history_id: createId('mh'),
        at,
        ok: true
      })
    } catch {
      // 历史失败不影响发送。
    }
  }
  emit(session, 'publish-result', { ...result, loop: options.loop })
  return result
}

// ---------------------------------------------------------------------------
// 定时 / 循环发布
// ---------------------------------------------------------------------------

function loopState(session: SessionRuntime): MqttLoopState {
  const loop = session.loop
  const snapshot = loop
    ? { sent: loop.sent, total: loop.total, startedAt: loop.startedAt }
    : session.loopSnapshot
  return {
    running: Boolean(loop && !loop.stopped),
    connection_id: session.connectionId,
    sent: snapshot?.sent ?? 0,
    total: snapshot?.total,
    started_at: snapshot ? new Date(snapshot.startedAt).toISOString() : undefined
  }
}

function stopLoopInternal(session: SessionRuntime): void {
  const loop = session.loop
  if (!loop) return
  loop.stopped = true
  clearInterval(loop.timer)
  session.loopSnapshot = { sent: loop.sent, total: loop.total, startedAt: loop.startedAt }
  session.loop = undefined
}

export function startLoop(
  projectId: string,
  connectionId: string,
  input: MqttPublishInput,
  options: MqttLoopOptions
): MqttLoopState {
  const session = requireConnectedSession(projectId, connectionId)
  if (session.loop) throw new Error('已有定时发布任务在运行')
  if (!Number.isFinite(options.interval_ms) || options.interval_ms < 100) {
    throw new Error('循环间隔不能小于 100ms')
  }
  const hasCount = options.count !== undefined
  const hasDuration = options.duration_ms !== undefined
  if (hasCount === hasDuration) throw new Error('循环发布必须按次数或时长二选一')
  if (hasCount) {
    if (!Number.isInteger(options.count) || options.count! < 1 || options.count! > 100000) {
      throw new Error('循环次数必须在 1-100000 之间')
    }
  }
  if (hasDuration) {
    if (
      !Number.isFinite(options.duration_ms) ||
      options.duration_ms! < 100 ||
      options.duration_ms! > 24 * 60 * 60 * 1000
    ) {
      throw new Error('循环时长必须在 100ms-24h 之间')
    }
  }
  // 先校验 payload，避免启动后才失败。
  encodePayloadInput(input.payload, input.payload_view)
  if (!isValidTopicName(input.topic)) throw new Error('Topic 非法：不能包含通配符')

  const loop: LoopRuntime = {
    timer: setInterval(() => undefined, 2 ** 30),
    sent: 0,
    total: options.count,
    startedAt: Date.now(),
    deadline:
      options.duration_ms !== undefined ? Date.now() + options.duration_ms : undefined,
    input,
    inFlight: false,
    stopped: false
  }
  clearInterval(loop.timer)
  loop.timer = setInterval(() => {
    void tickLoop(session, loop)
  }, options.interval_ms)
  if (typeof loop.timer.unref === 'function') loop.timer.unref()
  session.loop = loop
  void tickLoop(session, loop)
  return loopState(session)
}

async function tickLoop(session: SessionRuntime, loop: LoopRuntime): Promise<void> {
  if (loop.stopped || session.loop !== loop) return
  if (loop.inFlight) return
  if (loop.total !== undefined && loop.sent >= loop.total) {
    stopLoopInternal(session)
    return
  }
  if (loop.deadline !== undefined && Date.now() >= loop.deadline) {
    stopLoopInternal(session)
    return
  }
  loop.inFlight = true
  try {
    await publish(session.projectId, session.connectionId, loop.input, {
      persistHistory: false,
      loop: { sent: loop.sent + 1, total: loop.total }
    })
  } catch {
    // publish 的 broker 级失败会以 ok:false 返回；这里吞掉异常继续循环。
  }
  loop.inFlight = false
  loop.sent += 1
  if (loop.total !== undefined && loop.sent >= loop.total) stopLoopInternal(session)
}

export function stopLoop(projectId: string, connectionId: string): MqttLoopState {
  const session = requireSession(connectionId, projectId)
  const state = loopState(session)
  stopLoopInternal(session)
  return { ...state, running: false }
}

export function getLoopState(projectId: string, connectionId: string): MqttLoopState {
  const session = requireSession(connectionId, projectId)
  return loopState(session)
}

export function stopAllLoops(projectId: string): void {
  for (const session of sessions.values()) {
    if (session.projectId === projectId) stopLoopInternal(session)
  }
}

// ---------------------------------------------------------------------------
// 测试连接
// ---------------------------------------------------------------------------

function roundTripBaseTopic(sessionId: string): string {
  return `kindraapi/test/${sessionId}`
}

async function runRoundTrip(client: MqttClient, sessionId: string): Promise<MqttRoundTrip> {
  const topic = roundTripBaseTopic(sessionId)
  const started = Date.now()
  const payload = `kindraapi ${new Date().toISOString()}`
  try {
    await new Promise<void>((resolve, reject) => {
      client.subscribe(topic, { qos: 0 }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.removeListener('message', handler)
        reject(new Error('3 秒内未收到测试消息'))
      }, 3000)
      const handler = (receivedTopic: string): void => {
        if (receivedTopic !== topic) return
        clearTimeout(timer)
        client.removeListener('message', handler)
        resolve()
      }
      client.on('message', handler)
      client.publish(topic, payload, { qos: 0, retain: false }, (error) => {
        if (!error) return
        clearTimeout(timer)
        client.removeListener('message', handler)
        reject(error)
      })
    })
    return {
      enabled: true,
      topic,
      success: true,
      latency_ms: Date.now() - started
    }
  } catch (error) {
    return {
      enabled: true,
      topic,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function testConnection(
  projectId: string,
  profile: MqttConnectionProfile,
  options: MqttTestOptions = {}
): Promise<MqttAttempt> {
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const sessionId = createId('ms')
  const base = {
    attempt_id: createId('ma'),
    connection_id: profile.connection_id,
    project_id: projectId,
    kind: 'test' as const,
    started_at: startedAt
  }

  const issues = validateMqttProfile(profile)
  if (issues.length) {
    const attempt: MqttAttempt = {
      ...base,
      duration_ms: Date.now() - started,
      success: false,
      error: {
        category: 'invalid',
        message: issues.map((issue) => issue.message).join('；'),
        hint: mqttErrorHint('invalid')
      }
    }
    store.appendAttempt(projectId, attempt)
    broadcastMqttEvent({
      connectionId: profile.connection_id,
      sessionId,
      seq: 1,
      type: 'attempt',
      at: attempt.started_at,
      payload: attempt
    })
    return attempt
  }

  let client: MqttClient | null = null
  let connack: MqttConnackInfo | undefined
  try {
    client = mqttConnect(buildUrl(profile), buildOptions(profile))
    client.on('packetreceive', (packet: Packet) => {
      if (packet.cmd !== 'connack') return
      const connackPacket = packet as IConnackPacket
      connack = {
        return_code: connackPacket.returnCode,
        reason_code: connackPacket.reasonCode,
        session_present: connackPacket.sessionPresent,
        protocol_version: profile.protocol_version,
        client_id:
          connackPacket.properties?.assignedClientIdentifier ?? profile.client_id
      }
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Object.assign(new Error('连接超时'), { code: 'ETIMEDOUT' }))
      }, profile.connect_timeout_ms + 500)
      client!.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })
      client!.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    const roundTrip = options.round_trip
      ? await runRoundTrip(client, sessionId)
      : undefined
    const attempt: MqttAttempt = {
      ...base,
      duration_ms: Date.now() - started,
      success: true,
      connack: connack ?? {
        protocol_version: profile.protocol_version,
        client_id: profile.client_id
      },
      round_trip: roundTrip
    }
    store.appendAttempt(projectId, attempt)
    broadcastMqttEvent({
      connectionId: profile.connection_id,
      sessionId,
      seq: 1,
      type: 'attempt',
      at: attempt.started_at,
      payload: attempt
    })
    return attempt
  } catch (error) {
    const info = classifyError(error, profile.protocol_version, connack, 'connect')
    const attempt: MqttAttempt = {
      ...base,
      duration_ms: Date.now() - started,
      success: false,
      connack,
      error: info
    }
    store.appendAttempt(projectId, attempt)
    broadcastMqttEvent({
      connectionId: profile.connection_id,
      sessionId,
      seq: 1,
      type: 'attempt',
      at: attempt.started_at,
      payload: attempt
    })
    return attempt
  } finally {
    if (client) {
      try {
        client.end(true)
      } catch {
        // ignore
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MCP 游标拉取 / 空闲回收 / 退出
// ---------------------------------------------------------------------------

export function drainMessages(
  projectId: string,
  sessionId: string,
  cursor: number,
  limit: number
): { messages: MqttMessageSummary[]; nextCursor: number } {
  const found = findSessionBySessionId(sessionId)
  if (!found) throw new Error('会话不存在或已关闭')
  const session = found.session
  if (session.projectId !== projectId) throw new Error('项目不匹配')
  const start = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0
  const size = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 100, 500))
  const messages = store.listMessagesAfter(
    projectId,
    session.connectionId,
    start,
    size
  )
  const nextCursor = messages.length ? messages[messages.length - 1].seq : start
  session.lastActivity = Date.now()
  return { messages, nextCursor }
}

function ensureReaper(): void {
  if (reaper) return
  reaper = setInterval(() => {
    const now = Date.now()
    for (const session of [...sessions.values()]) {
      if (session.owner !== 'mcp') continue
      if (now - session.lastActivity <= MCP_IDLE_MS) continue
      try {
        disconnect(session.projectId, session.connectionId)
      } catch {
        // ignore
      }
    }
    if (sessions.size === 0 && reaper) {
      clearInterval(reaper)
      reaper = null
    }
  }, 30000)
  if (typeof reaper.unref === 'function') reaper.unref()
}

export function shutdownMqtt(): void {
  for (const session of [...sessions.values()]) {
    stopLoopInternal(session)
    session.manualClose = true
    session.stopped = true
    if (session.retryTimer) clearTimeout(session.retryTimer)
    const client = session.client
    session.client = null
    if (client) {
      try {
        client.end(true)
      } catch {
        // ignore
      }
    }
  }
  sessions.clear()
  if (reaper) {
    clearInterval(reaper)
    reaper = null
  }
}
