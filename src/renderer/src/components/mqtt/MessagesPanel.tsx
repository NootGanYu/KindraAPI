import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  Tooltip
} from 'antd'
import type { MenuProps } from 'antd'
import {
  ClearOutlined,
  CopyOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type {
  MqttMessageRecord,
  MqttMessageSummary,
  MqttPublishInput,
  MqttPayloadView
} from '@shared/mqtt'
import { renderPayload } from '@shared/mqtt'
import {
  PAYLOAD_VIEW_OPTIONS,
  copyText,
  errorMessage,
  formatBytes,
  formatTime,
  previewPayload,
  unwrap,
  useMqttEvent
} from './mqttUtils'

interface Props {
  projectId: string
  connectionId: string
  connected: boolean
  onResend: (input: MqttPublishInput) => void
}

function mergeMessages(
  current: MqttMessageSummary[],
  incoming: MqttMessageSummary[]
): MqttMessageSummary[] {
  const map = new Map<number, MqttMessageSummary>()
  for (const message of current) map.set(message.seq, message)
  for (const message of incoming) map.set(message.seq, message)
  return [...map.values()].sort((a, b) => a.seq - b.seq).slice(-2000)
}

export default function MessagesPanel({
  projectId,
  connectionId,
  connected,
  onResend
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [messages, setMessages] = useState<MqttMessageSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [topicFilter, setTopicFilter] = useState('')
  const [search, setSearch] = useState('')
  const [paused, setPaused] = useState(false)
  const [view, setView] = useState<MqttPayloadView>('plain')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<MqttMessageRecord | null>(null)
  const [errorNote, setErrorNote] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  useMqttEvent(
    projectId && connectionId ? `mqtt-messages-${projectId}-${connectionId}` : null,
    (event) => {
      if (event.connectionId !== connectionId) return
      if (event.type === 'message') {
        const summary = event.payload as MqttMessageSummary
        if (!summary || typeof summary.seq !== 'number') return
        setMessages((current) => mergeMessages(current, [summary]))
        return
      }
      if (event.type === 'error') {
        const payload = event.payload as { message?: string; truncated?: boolean }
        const text = payload?.message ?? ''
        if (payload?.truncated || text.includes('1MB')) {
          setErrorNote(text || 'payload 超过 1MB，已拒收')
          message.warning(text || 'payload 超过 1MB，已拒收')
        }
      }
    }
  )

  useEffect(() => {
    if (!projectId || !connectionId) {
      setMessages([])
      return
    }
    let alive = true
    setMessages([])
    setErrorNote('')
    setDetail(null)
    setLoading(true)
    void (async () => {
      try {
        const list = unwrap(
          await window.api.mqtt.messages.list(projectId, connectionId, { limit: 300 })
        )
        if (!alive) return
        setMessages((current) => mergeMessages(current, list))
      } catch (error) {
        if (alive) message.error(errorMessage(error))
      } finally {
        if (alive) setLoading(false)
      }
      try {
        const events = unwrap(await window.api.mqtt.replay(connectionId, 0))
        if (!alive) return
        const replayed = events
          .filter((event) => event.type === 'message')
          .map((event) => event.payload as MqttMessageSummary)
          .filter((item) => item && typeof item.seq === 'number')
        if (replayed.length) {
          setMessages((current) => mergeMessages(current, replayed))
        }
      } catch {
        // 没有活动会话时 replay 返回空/失败，忽略。
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, connectionId])

  const filtered = useMemo(() => {
    const topic = topicFilter.trim()
    const text = search.trim().toLowerCase()
    return messages.filter((item) => {
      if (topic && !item.topic.includes(topic)) return false
      if (!text) return true
      return `${item.topic}\n${item.preview}`.toLowerCase().includes(text)
    })
  }, [messages, topicFilter, search])

  useEffect(() => {
    if (paused) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [filtered.length, paused])

  const openDetail = async (summary: MqttMessageSummary): Promise<void> => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    try {
      const record = unwrap(
        await window.api.mqtt.messages.get(projectId, connectionId, summary.seq)
      )
      if (!record) {
        message.warning('消息已不在本地缓存中')
        setDetailOpen(false)
        return
      }
      setDetail(record)
    } catch (error) {
      message.error(errorMessage(error))
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const resend = async (summary: MqttMessageSummary): Promise<void> => {
    try {
      const record = unwrap(
        await window.api.mqtt.messages.get(projectId, connectionId, summary.seq)
      )
      if (!record) {
        message.warning('消息已不在本地缓存中')
        return
      }
      onResend({
        topic: record.topic,
        payload: record.payload,
        payload_view: record.payload_encoding === 'base64' ? 'base64' : 'plain',
        qos: record.qos,
        retain: record.retain
      })
      message.info('已填入发布面板，确认后再发送')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const copyPayload = async (record: MqttMessageRecord): Promise<void> => {
    try {
      await copyText(renderPayload(record, view))
      message.success('已复制完整 payload')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const clearMessages = (): void => {
    modal.confirm({
      title: '清空当前连接的消息记录？',
      content: '会删除该连接在本地保存的全部消息，此操作不可撤销。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          unwrap(await window.api.mqtt.messages.clear(projectId, connectionId))
          setMessages([])
          setDetail(null)
          setDetailOpen(false)
          message.success('已清空')
        } catch (error) {
          message.error(errorMessage(error))
        }
      }
    })
  }

  const doExport = async (format: 'jsonl' | 'csv'): Promise<void> => {
    try {
      const result = unwrap(
        await window.api.mqtt.messages.export(projectId, {
          connection_ids: [connectionId],
          format
        })
      )
      if (result.canceled) {
        message.info('已取消导出')
        return
      }
      message.success(
        `已导出 ${result.count ?? 0} 条消息${result.path ? ` → ${result.path}` : ''}`
      )
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const exportMenu: MenuProps = {
    items: [
      { key: 'jsonl', label: '导出 JSONL' },
      { key: 'csv', label: '导出 CSV' }
    ],
    onClick: ({ key }) => void doExport(key === 'csv' ? 'csv' : 'jsonl')
  }

  const emptyText = !connected
    ? '未连接，连接后将接收已订阅主题的消息'
    : '暂无消息，连接并订阅主题后会实时显示'

  return (
    <div className="mqtt-messages">
      <div className="mqtt-panel-toolbar">
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined style={{ color: '#a2967f' }} />}
          placeholder="过滤 topic"
          value={topicFilter}
          onChange={(event) => setTopicFilter(event.target.value)}
          style={{ width: 160 }}
        />
        <Input
          allowClear
          size="small"
          placeholder="搜索 topic / 内容"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ width: 180 }}
        />
        <Select
          size="small"
          value={view}
          options={PAYLOAD_VIEW_OPTIONS}
          onChange={(value: MqttPayloadView) => setView(value)}
          style={{ width: 96 }}
        />
        <Checkbox checked={paused} onChange={(event) => setPaused(event.target.checked)}>
          暂停自动滚动
        </Checkbox>
        <span style={{ flex: 1 }} />
        <span className="muted">
          已加载 {messages.length} 条 · 显示 {filtered.length} 条
        </span>
        <Tooltip title="重新加载当前连接消息">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={async () => {
              setLoading(true)
              try {
                const list = unwrap(
                  await window.api.mqtt.messages.list(projectId, connectionId, {
                    limit: 300
                  })
                )
                setMessages(list)
              } catch (error) {
                message.error(errorMessage(error))
              } finally {
                setLoading(false)
              }
            }}
          />
        </Tooltip>
        <Dropdown menu={exportMenu} trigger={['click']}>
          <Button size="small" icon={<DownloadOutlined />}>
            导出
          </Button>
        </Dropdown>
        <Button
          size="small"
          danger
          icon={<ClearOutlined />}
          onClick={clearMessages}
          disabled={messages.length === 0}
        >
          清空
        </Button>
      </div>

      {errorNote ? (
        <Alert
          className="mqtt-message-alert"
          type="warning"
          showIcon
          closable
          message={errorNote}
          onClose={() => setErrorNote('')}
        />
      ) : null}

      <div className="mqtt-msg-head">
        <span>时间</span>
        <span>方向</span>
        <span>Topic</span>
        <span>QoS</span>
        <span>大小</span>
        <span>Payload</span>
        <span />
      </div>
      <div className="mqtt-msg-scroll" ref={listRef}>
        {loading ? (
          <div className="mqtt-panel-loading">
            <Spin size="small" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="mqtt-panel-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
          </div>
        ) : (
          filtered.map((item) => (
            <div
              className="mqtt-msg-row"
              key={item.seq}
              role="button"
              tabIndex={0}
              onClick={() => void openDetail(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void openDetail(item)
              }}
            >
              <span className="mqtt-msg-time">{formatTime(item.received_at)}</span>
              <span>
                <Tag color={item.direction === 'in' ? 'blue' : 'green'}>
                  {item.direction === 'in' ? '收' : '发'}
                </Tag>
              </span>
              <span className="mqtt-msg-topic" title={item.topic}>
                {item.topic}
              </span>
              <span className="mqtt-msg-qos">
                {item.qos}
                {item.retain ? <Tag color="orange">retain</Tag> : null}
              </span>
              <span className="mqtt-msg-bytes">{formatBytes(item.payload_bytes)}</span>
              <span className="mqtt-msg-preview">
                {previewPayload(item.preview, item.payload_encoding, view)}
              </span>
              <span>
                <Button
                  size="small"
                  type="link"
                  onClick={(event) => {
                    event.stopPropagation()
                    void resend(item)
                  }}
                >
                  重发
                </Button>
              </span>
            </div>
          ))
        )}
      </div>

      <Modal
        open={detailOpen}
        width={760}
        title={
          <span>
            消息详情
            <Tag color="default" style={{ marginLeft: 8 }}>
              #{detail?.seq ?? '—'}
            </Tag>
          </span>
        }
        onCancel={() => setDetailOpen(false)}
        footer={
          <div className="mqtt-modal-footer">
            <Button
              icon={<CopyOutlined />}
              disabled={!detail}
              onClick={() => detail && void copyPayload(detail)}
            >
              复制完整 payload
            </Button>
            <Button
              disabled={!detail}
              onClick={() => {
                if (!detail) return
                onResend({
                  topic: detail.topic,
                  payload: detail.payload,
                  payload_view: detail.payload_encoding === 'base64' ? 'base64' : 'plain',
                  qos: detail.qos,
                  retain: detail.retain
                })
                message.info('已填入发布面板，确认后再发送')
                setDetailOpen(false)
              }}
            >
              重发
            </Button>
            <Button type="primary" onClick={() => setDetailOpen(false)}>
              关闭
            </Button>
          </div>
        }
      >
        {detailLoading ? (
          <div className="mqtt-panel-loading">
            <Spin />
          </div>
        ) : detail ? (
          <div className="mqtt-detail">
            <div className="mqtt-kv-grid">
              <div className="mqtt-kv">
                <span>Topic</span>
                <strong className="mono">{detail.topic}</strong>
              </div>
              <div className="mqtt-kv">
                <span>方向</span>
                <strong>{detail.direction === 'in' ? '接收' : '发送'}</strong>
              </div>
              <div className="mqtt-kv">
                <span>QoS / Retain</span>
                <strong>
                  QoS {detail.qos} · {detail.retain ? 'retain' : '非 retain'}
                </strong>
              </div>
              <div className="mqtt-kv">
                <span>时间</span>
                <strong>{formatTime(detail.received_at, true)}</strong>
              </div>
              <div className="mqtt-kv">
                <span>大小</span>
                <strong>{formatBytes(detail.payload_bytes)}</strong>
              </div>
              <div className="mqtt-kv">
                <span>编码</span>
                <strong>{detail.payload_encoding}</strong>
              </div>
            </div>
            <div className="mqtt-detail-toolbar">
              <span className="mqtt-section-title" style={{ margin: 0 }}>
                Payload
              </span>
              <Select
                size="small"
                value={view}
                options={PAYLOAD_VIEW_OPTIONS}
                onChange={(value: MqttPayloadView) => setView(value)}
                style={{ width: 100 }}
              />
            </div>
            <pre className="mqtt-payload">{renderPayload(detail, view)}</pre>
            {detail.properties ? (
              <>
                <div className="mqtt-section-title" style={{ marginTop: 12 }}>
                  Properties
                </div>
                <pre className="mqtt-payload">
                  {JSON.stringify(detail.properties, null, 2)}
                </pre>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
