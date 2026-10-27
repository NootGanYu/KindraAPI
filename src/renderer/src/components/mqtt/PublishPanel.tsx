import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Input,
  InputNumber,
  Radio,
  Select,
  Spin,
  Switch,
  Tag
} from 'antd'
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  SendOutlined
} from '@ant-design/icons'
import type {
  MqttLoopState,
  MqttPayloadView,
  MqttProtocolVersion,
  MqttPublishHistoryEntry,
  MqttPublishInput,
  MqttPublishResult,
  MqttQos
} from '@shared/mqtt'
import { encodePayloadInput, isValidTopicName } from '@shared/mqtt'
import UserPropertiesEditor from './UserPropertiesEditor'
import {
  PAYLOAD_VIEW_OPTIONS,
  errorMessage,
  formatBytes,
  formatTime,
  unwrap,
  useMqttEvent
} from './mqttUtils'

interface Prefill {
  input: MqttPublishInput
  nonce: number
}

interface Props {
  projectId: string
  connectionId: string
  protocolVersion: MqttProtocolVersion
  connected: boolean
  prefill: Prefill | null
}

const QOS_OPTIONS = [
  { value: 0, label: 'QoS 0' },
  { value: 1, label: 'QoS 1' },
  { value: 2, label: 'QoS 2' }
]

export default function PublishPanel({
  projectId,
  connectionId,
  protocolVersion,
  connected,
  prefill
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [topic, setTopic] = useState('')
  const [payload, setPayload] = useState('')
  const [view, setView] = useState<MqttPayloadView>('json')
  const [qos, setQos] = useState<MqttQos>(0)
  const [retain, setRetain] = useState(false)
  const [userProperties, setUserProperties] = useState<
    NonNullable<MqttPublishInput['user_properties']>
  >([])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<MqttPublishResult | null>(null)
  const [history, setHistory] = useState<MqttPublishHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loop, setLoop] = useState<MqttLoopState | null>(null)
  const [intervalMs, setIntervalMs] = useState(1000)
  const [stopMode, setStopMode] = useState<'count' | 'duration'>('count')
  const [loopCount, setLoopCount] = useState(10)
  const [durationS, setDurationS] = useState(10)
  const [plannedTotal, setPlannedTotal] = useState<number | undefined>(undefined)
  const [starting, setStarting] = useState(false)
  const loopRef = useRef<MqttLoopState | null>(null)
  loopRef.current = loop

  const encoded = useMemo(() => {
    try {
      return { data: encodePayloadInput(payload, view), error: '' }
    } catch (error) {
      return { data: null, error: errorMessage(error) }
    }
  }, [payload, view])

  const topicError = !topic.trim()
    ? '请输入 Topic'
    : isValidTopicName(topic)
      ? ''
      : 'Topic 不能包含通配符 + 或 #'

  const payloadBytes = encoded.data?.bytes ?? 0
  const tooLarge = payloadBytes > 1024 * 1024
  const canSend =
    connected && !sending && !encoded.error && !topicError && !tooLarge

  useMqttEvent(
    projectId && connectionId ? `mqtt-publish-${projectId}-${connectionId}` : null,
    (event) => {
      if (event.connectionId !== connectionId) return
      if (event.type === 'publish-result') {
        const payload = event.payload as MqttPublishResult & { loop?: boolean }
        if (payload.loop) {
          void window.api.mqtt.publish
            .loopState(projectId, connectionId)
            .then((state) => {
              if (state.ok) setLoop(state.data)
            })
            .catch(() => undefined)
        }
      }
    }
  )

  const loadHistory = async (): Promise<void> => {
    if (!projectId) return
    setHistoryLoading(true)
    try {
      setHistory(unwrap(await window.api.mqtt.publish.history(projectId)).slice(0, 50))
    } catch {
      // 历史读取失败不影响发布。
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    void loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!projectId || !connectionId) return
    let alive = true
    void window.api.mqtt.publish
      .loopState(projectId, connectionId)
      .then((state) => {
        if (alive && state.ok) setLoop(state.data.running ? state.data : null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      // 切换连接或项目 / 组件卸载时，确保本界面启动的循环发布停止。
      if (loopRef.current?.running) {
        void window.api.mqtt.publish
          .stopLoop(projectId, connectionId)
          .catch(() => undefined)
      }
    }
  }, [projectId, connectionId])

  useEffect(() => {
    if (!loop?.running || !projectId || !connectionId) return
    let alive = true
    const timer = setInterval(() => {
      void window.api.mqtt.publish
        .loopState(projectId, connectionId)
        .then((state) => {
          if (!alive) return
          if (state.ok) setLoop(state.data.running ? state.data : null)
        })
        .catch(() => undefined)
    }, 500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [loop?.running, projectId, connectionId])

  useEffect(() => {
    if (!connected && loop?.running) {
      void window.api.mqtt.publish
        .stopLoop(projectId, connectionId)
        .then((state) => {
          if (state.ok) setLoop(null)
        })
        .catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  useEffect(() => {
    if (!prefill) return
    setTopic(prefill.input.topic)
    setPayload(prefill.input.payload)
    setView(prefill.input.payload_view)
    setQos(prefill.input.qos)
    setRetain(prefill.input.retain)
    setUserProperties(prefill.input.user_properties ?? [])
    setResult(null)
  }, [prefill])

  const buildInput = (): MqttPublishInput => ({
    topic: topic.trim(),
    payload,
    payload_view: view,
    qos,
    retain,
    user_properties: userProperties.filter((item) => item.key.trim() || item.value)
  })

  const send = async (): Promise<void> => {
    if (!canSend) return
    setSending(true)
    try {
      const publishResult = unwrap(
        await window.api.mqtt.publish.send(projectId, connectionId, buildInput())
      )
      setResult(publishResult)
      if (publishResult.ok) {
        message.success(`发布成功：${publishResult.reason_text ?? '已发送'}`)
        void loadHistory()
      } else {
        message.error(`发布失败：${publishResult.reason_text ?? publishResult.error ?? '未知错误'}`)
      }
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  const startLoop = (): void => {
    if (!connected) {
      message.error('请先连接 MQTT')
      return
    }
    if (encoded.error) {
      message.error(encoded.error)
      return
    }
    if (topicError) {
      message.error(topicError)
      return
    }
    if (tooLarge) {
      message.error('payload 超过 1MB 限制，无法发送')
      return
    }
    const interval = Math.max(100, Math.floor(intervalMs) || 100)
    if (stopMode === 'count' && (!Number.isFinite(loopCount) || loopCount < 1)) {
      message.error('发送次数必须大于 0')
      return
    }
    if (stopMode === 'duration' && (!Number.isFinite(durationS) || durationS < 1)) {
      message.error('持续时间必须大于 0 秒')
      return
    }
    const durationMs = Math.max(1, Math.floor(durationS)) * 1000
    const estimated =
      stopMode === 'count' ? Math.floor(loopCount) : Math.max(1, Math.floor(durationMs / interval))
    modal.confirm({
      title: '启动循环发布？',
      content: `按 ${interval} ms 间隔发送，预计 ${estimated} 条。运行中可随时停止。`,
      okText: '启动',
      cancelText: '取消',
      onOk: async () => {
        setStarting(true)
        try {
          const options =
            stopMode === 'count'
              ? { interval_ms: interval, count: Math.floor(loopCount) }
              : { interval_ms: interval, duration_ms: durationMs }
          const state = unwrap(
            await window.api.mqtt.publish.startLoop(
              projectId,
              connectionId,
              buildInput(),
              options
            )
          )
          setLoop(state)
          setPlannedTotal(estimated)
          message.success('循环发布已启动')
        } catch (error) {
          message.error(errorMessage(error))
        } finally {
          setStarting(false)
        }
      }
    })
  }

  const stopLoop = async (): Promise<void> => {
    try {
      const state = unwrap(await window.api.mqtt.publish.stopLoop(projectId, connectionId))
      setLoop(state.running ? state : null)
      setPlannedTotal(undefined)
      message.success('已停止循环发布')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const fillFromHistory = (entry: MqttPublishHistoryEntry): void => {
    setTopic(entry.topic)
    setPayload(entry.payload)
    setView(entry.payload_view)
    setQos(entry.qos)
    setRetain(entry.retain)
    setUserProperties(entry.user_properties ?? [])
    setResult(null)
    message.info('已回填发布历史')
  }

  const loopRunning = Boolean(loop?.running)

  return (
    <div className="mqtt-publish">
      <div className="mqtt-publish-grid">
        <div className="mqtt-publish-main">
          {!connected ? (
            <Alert
              type="info"
              showIcon
              message="当前连接未建立，连接后才能发布消息。"
              style={{ marginBottom: 10 }}
            />
          ) : null}

          <div className="mqtt-form-grid">
            <label className="mqtt-field mqtt-field-wide">
              <span>Topic</span>
              <Input
                value={topic}
                status={topicError ? 'error' : undefined}
                placeholder="devices/client/command"
                onChange={(event) => setTopic(event.target.value)}
              />
              {topicError ? <span className="mqtt-field-error">{topicError}</span> : null}
            </label>
            <label className="mqtt-field">
              <span>视图</span>
              <Select
                value={view}
                options={PAYLOAD_VIEW_OPTIONS}
                onChange={(value: MqttPayloadView) => setView(value)}
              />
            </label>
            <label className="mqtt-field">
              <span>QoS</span>
              <Select
                value={qos}
                options={QOS_OPTIONS}
                onChange={(value: MqttQos) => setQos(value)}
              />
            </label>
            <label className="mqtt-field mqtt-field-switch">
              <span>Retain</span>
              <Switch checked={retain} onChange={setRetain} />
            </label>
          </div>

          <label className="mqtt-field mqtt-field-wide">
            <span>Payload</span>
            <Input.TextArea
              className="mqtt-payload-input"
              rows={7}
              value={payload}
              placeholder={view === 'json' ? '{\n  "command": "ping"\n}' : 'payload'}
              onChange={(event) => setPayload(event.target.value)}
            />
          </label>
          <div className="mqtt-publish-meta">
            <span className="muted">
              {encoded.error ? (
                <span className="mqtt-field-error">{encoded.error}</span>
              ) : (
                `${formatBytes(payloadBytes)}${tooLarge ? ' · 超过 1MB 限制' : ''}`
              )}
            </span>
            <span style={{ flex: 1 }} />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={sending}
              disabled={!canSend}
              onClick={() => void send()}
            >
              发送
            </Button>
          </div>

          {result ? (
            <Alert
              style={{ marginTop: 10 }}
              type={result.ok ? 'success' : 'error'}
              showIcon
              message={
                <span>
                  {result.ok ? '发布成功' : '发布失败'}
                  {result.reason_text ? ` · ${result.reason_text}` : ''}
                  {result.reason_code !== undefined ? (
                    <Tag color="default" style={{ marginLeft: 8 }}>
                      {`0x${result.reason_code.toString(16).padStart(2, '0')}`}
                    </Tag>
                  ) : null}
                </span>
              }
              description={!result.ok && result.error ? result.error : undefined}
            />
          ) : null}

          <div className="mqtt-subsection">
            <div className="mqtt-subsection-title">User Properties</div>
            <UserPropertiesEditor
              value={userProperties}
              onChange={setUserProperties}
              disabled={protocolVersion === 4}
              hint={
                protocolVersion === 4
                  ? 'MQTT 3.1.1 不支持 User Properties。'
                  : '仅 MQTT 5 会随消息发送。'
              }
            />
          </div>

          <div className="mqtt-loop">
            <div className="mqtt-subsection-title">
              定时 / 循环发布
              {loopRunning ? <Tag color="processing">运行中</Tag> : null}
            </div>
            <div className="mqtt-loop-row">
              <span className="mqtt-loop-label">间隔</span>
              <InputNumber
                min={100}
                step={100}
                value={intervalMs}
                onChange={(value) => setIntervalMs(Number(value ?? 100))}
                style={{ width: 120 }}
                addonAfter="ms"
              />
              <Radio.Group
                value={stopMode}
                onChange={(event) => setStopMode(event.target.value as 'count' | 'duration')}
                size="small"
              >
                <Radio.Button value="count">按次数</Radio.Button>
                <Radio.Button value="duration">按时长</Radio.Button>
              </Radio.Group>
              {stopMode === 'count' ? (
                <InputNumber
                  min={1}
                  value={loopCount}
                  onChange={(value) => setLoopCount(Number(value ?? 1))}
                  style={{ width: 110 }}
                  addonAfter="次"
                />
              ) : (
                <InputNumber
                  min={1}
                  value={durationS}
                  onChange={(value) => setDurationS(Number(value ?? 1))}
                  style={{ width: 110 }}
                  addonAfter="秒"
                />
              )}
              {loopRunning ? (
                <Button
                  danger
                  icon={<PauseCircleOutlined />}
                  onClick={() => void stopLoop()}
                >
                  停止
                </Button>
              ) : (
                <Button
                  icon={<PlayCircleOutlined />}
                  loading={starting}
                  onClick={startLoop}
                >
                  启动循环
                </Button>
              )}
            </div>
            {loopRunning ? (
              <div className="mqtt-loop-status">
                已发送 {loop?.sent ?? 0} / {loop?.total ?? plannedTotal ?? '∞'} 条
              </div>
            ) : (
              <div className="mqtt-field-hint">
                间隔最小 100 ms；发布次数与持续时间二选一。
              </div>
            )}
          </div>
        </div>

        <div className="mqtt-history">
          <div className="mqtt-section-title">
            发布历史
            <Button
              size="small"
              type="link"
              onClick={() => void loadHistory()}
              loading={historyLoading}
            >
              刷新
            </Button>
          </div>
          <div className="mqtt-history-list">
            {historyLoading && history.length === 0 ? (
              <div className="mqtt-panel-loading">
                <Spin size="small" />
              </div>
            ) : history.length === 0 ? (
              <div className="mqtt-field-hint">暂无发布历史。</div>
            ) : (
              history.map((entry) => (
                <button
                  type="button"
                  className="mqtt-history-row"
                  key={entry.history_id}
                  onClick={() => fillFromHistory(entry)}
                  title="点击回填"
                >
                  <div className="mqtt-history-head">
                    <Tag color={entry.ok ? 'green' : 'red'}>
                      {entry.ok ? '成功' : '失败'}
                    </Tag>
                    <span className="mqtt-history-topic">{entry.topic}</span>
                    <span className="mqtt-history-time">{formatTime(entry.at)}</span>
                  </div>
                  <div className="mqtt-history-sub">
                    QoS {entry.qos}
                    {entry.retain ? ' · retain' : ''} · {entry.payload_view} ·{' '}
                    {formatBytes(encodeBytes(entry))}
                  </div>
                  <div className="mqtt-history-preview">{entry.payload.slice(0, 140)}</div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function encodeBytes(entry: MqttPublishHistoryEntry): number {
  try {
    return encodePayloadInput(entry.payload, entry.payload_view).bytes
  } catch {
    return 0
  }
}
