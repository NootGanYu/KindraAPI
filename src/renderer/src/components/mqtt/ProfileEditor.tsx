import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Collapse,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import type {
  MqttAttempt,
  MqttConnectionProfile,
  MqttMqtt5Config,
  MqttProtocolVersion,
  MqttQos,
  MqttRetention,
  MqttSessionState,
  MqttSubscription,
  MqttTlsConfig,
  MqttTransport,
  MqttUserProperty,
  MqttWill
} from '@shared/mqtt'
import {
  MQTT_TRANSPORT_PORTS,
  isSharedSubscription,
  isValidTopicFilter,
  mqttErrorHint,
  mqttReasonText,
  sharedSubscriptionGroup,
  validateMqttProfile
} from '@shared/mqtt'
import VersionDrawer from './VersionDrawer'
import UserPropertiesEditor from './UserPropertiesEditor'
import {
  errorMessage,
  formatDateTime,
  protocolLabel,
  unwrap,
  useMqttEvent
} from './mqttUtils'

interface Props {
  projectId: string
  profile: MqttConnectionProfile
  session: MqttSessionState | null
  saving: boolean
  connecting: boolean
  onChange: (next: MqttConnectionProfile) => void
  onSave: () => Promise<boolean>
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onClone: () => Promise<void>
  onRestored: (profile: MqttConnectionProfile) => void
}

const QOS_OPTIONS = [
  { value: 0, label: 'QoS 0' },
  { value: 1, label: 'QoS 1' },
  { value: 2, label: 'QoS 2' }
]

const TRANSPORT_OPTIONS: Array<{ value: MqttTransport; label: string }> = [
  { value: 'tcp', label: 'TCP (mqtt)' },
  { value: 'tls', label: 'TLS (mqtts)' },
  { value: 'ws', label: 'WebSocket (ws)' },
  { value: 'wss', label: 'WebSocket TLS (wss)' }
]

function issueClass(has: boolean): string {
  return has ? ' mqtt-field-invalid' : ''
}

function mergeAttempts(current: MqttAttempt[], incoming: MqttAttempt[]): MqttAttempt[] {
  const map = new Map<string, MqttAttempt>()
  for (const attempt of [...incoming, ...current]) {
    if (!map.has(attempt.attempt_id)) map.set(attempt.attempt_id, attempt)
  }
  return [...map.values()]
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    .slice(0, 20)
}

export default function ProfileEditor({
  projectId,
  profile,
  session,
  saving,
  connecting,
  onChange,
  onSave,
  onConnect,
  onDisconnect,
  onClone,
  onRestored
}: Props): JSX.Element {
  const { message } = AntApp.useApp()
  const [portTouched, setPortTouched] = useState(
    profile.port !== MQTT_TRANSPORT_PORTS[profile.transport]
  )
  const [roundTrip, setRoundTrip] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<MqttAttempt | null>(null)
  const [attempts, setAttempts] = useState<MqttAttempt[]>([])
  const [versionOpen, setVersionOpen] = useState(false)

  useEffect(() => {
    setPortTouched(profile.port !== MQTT_TRANSPORT_PORTS[profile.transport])
    setTestResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.connection_id])

  const issues = useMemo(() => validateMqttProfile(profile), [profile])
  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message

  const loadAttempts = async (): Promise<void> => {
    if (!projectId || !profile.connection_id) return
    try {
      const list = unwrap(
        await window.api.mqtt.attempts.list(projectId, profile.connection_id, 20)
      )
      setAttempts(list)
    } catch {
      // 运行记录读取失败不阻塞编辑器。
    }
  }

  useEffect(() => {
    void loadAttempts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, profile.connection_id])

  useMqttEvent(
    projectId && profile.connection_id ? `mqtt-attempt-${profile.connection_id}` : null,
    (event) => {
      if (event.type !== 'attempt' || event.connectionId !== profile.connection_id) return
      const attempt = event.payload as MqttAttempt
      if (!attempt?.attempt_id) return
      setAttempts((current) => mergeAttempts(current, [attempt]))
    }
  )

  const patch = (next: Partial<MqttConnectionProfile>): void => {
    onChange({ ...profile, ...next })
  }

  const tls: MqttTlsConfig = profile.tls ?? { reject_unauthorized: true }
  const patchTls = (next: Partial<MqttTlsConfig>): void => {
    patch({ tls: { ...tls, ...next } })
  }

  const will = profile.will
  const patchWill = (next: Partial<MqttWill>): void => {
    patch({
      will: {
        topic: will?.topic ?? '',
        payload: will?.payload ?? '',
        qos: will?.qos ?? 0,
        retain: will?.retain ?? false,
        delay_interval_s: will?.delay_interval_s,
        user_properties: will?.user_properties,
        ...next
      }
    })
  }

  const mqtt5: MqttMqtt5Config = profile.mqtt5 ?? {}
  const patchMqtt5 = (next: Partial<MqttMqtt5Config>): void => {
    patch({ mqtt5: { ...mqtt5, ...next } })
  }

  const patchRetention = (next: Partial<MqttRetention>): void => {
    patch({ retention: { ...(profile.retention ?? {}), ...next } })
  }

  const updateSubscription = (index: number, next: Partial<MqttSubscription>): void => {
    patch({
      subscriptions: profile.subscriptions.map((sub, i) =>
        i === index ? { ...sub, ...next } : sub
      )
    })
  }

  const removeSubscription = (index: number): void => {
    patch({ subscriptions: profile.subscriptions.filter((_, i) => i !== index) })
  }

  const addSubscription = (): void => {
    patch({ subscriptions: [...profile.subscriptions, { filter: '', qos: 0 }] })
  }

  const handleSave = async (): Promise<void> => {
    if (issues.length > 0) {
      message.error(issues.map((issue) => issue.message).join('；'))
      return
    }
    await onSave()
  }

  const handleConnect = async (): Promise<void> => {
    if (issues.length > 0) {
      message.error(issues.map((issue) => issue.message).join('；'))
      return
    }
    await onConnect()
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    try {
      const attempt = unwrap(
        await window.api.mqtt.test(projectId, profile, { round_trip: roundTrip })
      )
      setTestResult(attempt)
      if (attempt.success) message.success('连接测试成功')
      else message.error(attempt.error?.message ?? '连接测试失败')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setTesting(false)
    }
  }

  const sessionActive = Boolean(
    session && session.state !== 'closed'
  )
  const protocolVersion = profile.protocol_version

  const reasonCode = testResult?.connack?.reason_code ?? testResult?.connack?.return_code
  const testErrorHint = testResult?.error
    ? testResult.error.hint ?? mqttErrorHint(testResult.error.category)
    : ''

  const collapseItems = [
    {
      key: 'tls',
      label: (
        <span className="mqtt-collapse-label">
          TLS
          <Tag color={tls.reject_unauthorized ? 'default' : 'orange'}>
            {tls.reject_unauthorized ? '校验证书' : '跳过校验'}
          </Tag>
        </span>
      ),
      children: (
        <div className="mqtt-collapse-body">
          <div className="mqtt-field-hint">
            当前仅保存证书/私钥路径，测试或连接时再读取文件内容。
          </div>
          <div className="mqtt-form-grid">
            <label className="mqtt-field">
              <span>CA 证书路径</span>
              <Input
                value={tls.ca_path ?? ''}
                placeholder="/path/to/ca.pem"
                onChange={(event) => patchTls({ ca_path: event.target.value || undefined })}
              />
            </label>
            <label className="mqtt-field">
              <span>客户端证书路径</span>
              <Input
                value={tls.cert_path ?? ''}
                placeholder="/path/to/client.crt"
                onChange={(event) => patchTls({ cert_path: event.target.value || undefined })}
              />
            </label>
            <label className="mqtt-field">
              <span>客户端私钥路径</span>
              <Input
                value={tls.key_path ?? ''}
                placeholder="/path/to/client.key"
                onChange={(event) => patchTls({ key_path: event.target.value || undefined })}
              />
            </label>
            <label className="mqtt-field">
              <span>私钥口令</span>
              <Input.Password
                value={tls.passphrase ?? ''}
                onChange={(event) => patchTls({ passphrase: event.target.value || undefined })}
              />
            </label>
            <label className="mqtt-field">
              <span>SNI / servername</span>
              <Input
                value={tls.servername ?? ''}
                placeholder="broker.example.com"
                onChange={(event) => patchTls({ servername: event.target.value || undefined })}
              />
            </label>
            <label className="mqtt-field">
              <span>最低 TLS 版本</span>
              <Select
                allowClear
                value={tls.min_version}
                placeholder="默认"
                options={[
                  { value: 'TLSv1.2', label: 'TLSv1.2' },
                  { value: 'TLSv1.3', label: 'TLSv1.3' }
                ]}
                onChange={(value?: string) => patchTls({ min_version: value })}
              />
            </label>
            <label className="mqtt-field mqtt-field-wide">
              <span>ALPN（逗号分隔）</span>
              <Input
                value={(tls.alpn ?? []).join(', ')}
                placeholder="mqtt, h2"
                onChange={(event) =>
                  patchTls({
                    alpn: event.target.value
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean)
                  })
                }
              />
            </label>
            <label className="mqtt-field mqtt-field-switch">
              <span>校验服务端证书</span>
              <Switch
                checked={tls.reject_unauthorized}
                onChange={(checked) => patchTls({ reject_unauthorized: checked })}
              />
            </label>
          </div>
          {!tls.reject_unauthorized ? (
            <Alert
              type="warning"
              showIcon
              message="已关闭证书校验，连接可能遭受中间人攻击，仅建议用于本地或自签名环境。"
            />
          ) : null}
        </div>
      )
    },
    {
      key: 'will',
      label: (
        <span className="mqtt-collapse-label">
          遗嘱 Will
          {will ? <Tag color="blue">已启用</Tag> : null}
        </span>
      ),
      children: (
        <div className="mqtt-collapse-body">
          <div className="mqtt-field mqtt-field-switch" style={{ marginBottom: 12 }}>
            <span>启用遗嘱消息</span>
            <Switch
              checked={Boolean(will)}
              onChange={(checked) =>
                patch({
                  will: checked
                    ? { topic: '', payload: '', qos: 0, retain: false }
                    : undefined
                })
              }
            />
          </div>
          {will ? (
            <>
              <div className="mqtt-form-grid">
                <label className="mqtt-field">
                  <span>遗嘱主题</span>
                  <Input
                    value={will.topic}
                    placeholder="devices/client/status"
                    onChange={(event) => patchWill({ topic: event.target.value })}
                  />
                </label>
                <label className="mqtt-field">
                  <span>QoS</span>
                  <Select
                    value={will.qos}
                    options={QOS_OPTIONS}
                    onChange={(value: MqttQos) => patchWill({ qos: value })}
                  />
                </label>
                <label className="mqtt-field mqtt-field-wide">
                  <span>遗嘱内容</span>
                  <Input.TextArea
                    rows={2}
                    value={will.payload}
                    onChange={(event) => patchWill({ payload: event.target.value })}
                  />
                </label>
                <label className="mqtt-field mqtt-field-switch">
                  <span>Retain</span>
                  <Switch
                    checked={will.retain}
                    onChange={(checked) => patchWill({ retain: checked })}
                  />
                </label>
                {protocolVersion === 5 ? (
                  <label className="mqtt-field">
                    <span>延迟发布（秒）</span>
                    <InputNumber
                      min={0}
                      style={{ width: '100%' }}
                      value={will.delay_interval_s ?? null}
                      placeholder="0"
                      onChange={(value) =>
                        patchWill({
                          delay_interval_s:
                            value === null || value === undefined ? undefined : Number(value)
                        })
                      }
                    />
                  </label>
                ) : null}
              </div>
              {protocolVersion === 5 ? (
                <div className="mqtt-subsection">
                  <div className="mqtt-subsection-title">Will User Properties</div>
                  <UserPropertiesEditor
                    value={will.user_properties}
                    onChange={(next: MqttUserProperty[]) =>
                      patchWill({ user_properties: next })
                    }
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="mqtt-field-hint">未启用遗嘱消息。</div>
          )}
        </div>
      )
    },
    {
      key: 'mqtt5',
      label: (
        <span className="mqtt-collapse-label">
          MQTT 5 属性
          {protocolVersion === 4 ? <Tag color="default">3.1.1 不支持</Tag> : null}
        </span>
      ),
      children: (
        <div className="mqtt-collapse-body">
          {protocolVersion === 4 ? (
            <Alert
              type="info"
              showIcon
              message="当前协议为 MQTT 3.1.1，以下 MQTT 5 连接属性不会生效。"
              style={{ marginBottom: 12 }}
            />
          ) : null}
          <div className="mqtt-form-grid">
            <label className="mqtt-field">
              <span>会话过期（秒）</span>
              <InputNumber
                min={0}
                disabled={protocolVersion === 4}
                style={{ width: '100%' }}
                value={mqtt5.session_expiry_interval_s ?? null}
                placeholder="默认"
                onChange={(value) =>
                  patchMqtt5({
                    session_expiry_interval_s:
                      value === null || value === undefined ? undefined : Number(value)
                  })
                }
              />
            </label>
            <label className="mqtt-field">
              <span>Receive Maximum</span>
              <InputNumber
                min={1}
                disabled={protocolVersion === 4}
                style={{ width: '100%' }}
                value={mqtt5.receive_maximum ?? null}
                placeholder="默认"
                onChange={(value) =>
                  patchMqtt5({
                    receive_maximum:
                      value === null || value === undefined ? undefined : Number(value)
                  })
                }
              />
            </label>
            <label className="mqtt-field">
              <span>Topic Alias Maximum</span>
              <InputNumber
                min={0}
                disabled={protocolVersion === 4}
                style={{ width: '100%' }}
                value={mqtt5.topic_alias_maximum ?? null}
                placeholder="默认"
                onChange={(value) =>
                  patchMqtt5({
                    topic_alias_maximum:
                      value === null || value === undefined ? undefined : Number(value)
                  })
                }
              />
            </label>
          </div>
          <div className="mqtt-subsection">
            <div className="mqtt-subsection-title">连接 User Properties</div>
            <UserPropertiesEditor
              value={mqtt5.user_properties}
              disabled={protocolVersion === 4}
              onChange={(next: MqttUserProperty[]) => patchMqtt5({ user_properties: next })}
            />
          </div>
        </div>
      )
    },
    {
      key: 'subscriptions',
      label: (
        <span className="mqtt-collapse-label">
          订阅
          <Tag color="blue">{profile.subscriptions.length}</Tag>
        </span>
      ),
      children: (
        <div className="mqtt-collapse-body">
          {profile.subscriptions.length === 0 ? (
            <div className="mqtt-field-hint">暂无订阅；连接后不会自动订阅任何主题。</div>
          ) : (
            <div className="mqtt-sub-list">
              {profile.subscriptions.map((sub, index) => {
                const valid = isValidTopicFilter(sub.filter)
                const shared = isSharedSubscription(sub.filter)
                return (
                  <div className="mqtt-sub-row" key={index}>
                    <div className="mqtt-sub-filter">
                      <Input
                        status={valid ? undefined : 'error'}
                        value={sub.filter}
                        placeholder="sensors/+/temperature 或 $share/group/topic"
                        onChange={(event) =>
                          updateSubscription(index, { filter: event.target.value })
                        }
                      />
                      {shared ? (
                        <Tag color="blue" className="mqtt-shared-tag">
                          共享 {sharedSubscriptionGroup(sub.filter) ?? '?'}
                        </Tag>
                      ) : null}
                    </div>
                    <Select
                      value={sub.qos}
                      options={QOS_OPTIONS}
                      style={{ width: 92 }}
                      onChange={(value: MqttQos) => updateSubscription(index, { qos: value })}
                    />
                    <Tooltip title="删除订阅">
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeSubscription(index)}
                      />
                    </Tooltip>
                  </div>
                )
              })}
            </div>
          )}
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addSubscription}
          >
            添加订阅
          </Button>
        </div>
      )
    },
    {
      key: 'retention',
      label: (
        <span className="mqtt-collapse-label">
          保留策略
          <Tag color="default">本地</Tag>
        </span>
      ),
      children: (
        <div className="mqtt-collapse-body">
          <div className="mqtt-field-hint">留空表示使用默认值（10000 条 / 50 MB / 7 天）。</div>
          <div className="mqtt-form-grid">
            <label className="mqtt-field">
              <span>最大消息数</span>
              <InputNumber
                min={1}
                style={{ width: '100%' }}
                value={profile.retention?.max_messages ?? null}
                placeholder="10000"
                onChange={(value) =>
                  patchRetention({
                    max_messages:
                      value === null || value === undefined ? undefined : Number(value)
                  })
                }
              />
            </label>
            <label className="mqtt-field">
              <span>最大字节数</span>
              <InputNumber
                min={1024}
                step={1024}
                style={{ width: '100%' }}
                value={profile.retention?.max_bytes ?? null}
                placeholder="52428800"
                onChange={(value) =>
                  patchRetention({
                    max_bytes: value === null || value === undefined ? undefined : Number(value)
                  })
                }
              />
            </label>
            <label className="mqtt-field">
              <span>最大保留天数</span>
              <InputNumber
                min={1}
                style={{ width: '100%' }}
                value={profile.retention?.max_age_days ?? null}
                placeholder="7"
                onChange={(value) =>
                  patchRetention({
                    max_age_days:
                      value === null || value === undefined ? undefined : Number(value)
                  })
                }
              />
            </label>
          </div>
        </div>
      )
    }
  ]

  return (
    <div className="mqtt-editor">
      <div className="mqtt-editor-head">
        <div>
          <div className="mqtt-editor-title">
            {profile.name || '未命名连接'}
            <Tag color="default">{protocolLabel(protocolVersion)}</Tag>
          </div>
          <div className="mqtt-editor-sub">
            {profile.transport.toUpperCase()} · {profile.host || '—'}:{profile.port}
          </div>
        </div>
        <Space wrap>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={() => void handleSave()}
          >
            保存
          </Button>
          <Space size={4}>
            <Button
              icon={<ThunderboltOutlined />}
              loading={testing}
              onClick={() => void runTest()}
            >
              测试连接
            </Button>
            <Checkbox
              checked={roundTrip}
              onChange={(event) => setRoundTrip(event.target.checked)}
            >
              往返验证
            </Checkbox>
          </Space>
          {sessionActive ? (
            <Button
              danger
              icon={<DisconnectOutlined />}
              loading={connecting}
              onClick={() => void onDisconnect()}
            >
              断开
            </Button>
          ) : (
            <Button
              icon={<PlayCircleOutlined />}
              loading={connecting}
              onClick={() => void handleConnect()}
            >
              连接
            </Button>
          )}
          <Button icon={<CopyOutlined />} onClick={() => void onClone()}>
            复制
          </Button>
          <Button icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>
            版本历史
          </Button>
        </Space>
      </div>

      {issues.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          className="mqtt-issues"
          message="请先修正以下字段"
          description={issues.map((issue) => issue.message).join('；')}
        />
      ) : null}

      <div className="mqtt-editor-body">
        <section className="mqtt-section">
          <div className="mqtt-section-title">连接信息</div>
          <div className="mqtt-form-grid">
            <label className={`mqtt-field${issueClass(Boolean(issueFor('name')))}`}>
              <span>名称</span>
              <Input
                value={profile.name}
                status={issueFor('name') ? 'error' : undefined}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>
            <label className="mqtt-field">
              <span>分组</span>
              <Input
                value={profile.group ?? ''}
                placeholder="未分组"
                onChange={(event) => patch({ group: event.target.value || undefined })}
              />
            </label>
            <label className={`mqtt-field${issueClass(Boolean(issueFor('host')))}`}>
              <span>主机</span>
              <Input
                value={profile.host}
                status={issueFor('host') ? 'error' : undefined}
                placeholder="localhost"
                onChange={(event) => patch({ host: event.target.value })}
              />
            </label>
            <label className={`mqtt-field${issueClass(Boolean(issueFor('port')))}`}>
              <span>端口</span>
              <InputNumber
                min={1}
                max={65535}
                style={{ width: '100%' }}
                status={issueFor('port') ? 'error' : undefined}
                value={profile.port}
                onChange={(value) => {
                  setPortTouched(true)
                  patch({ port: value === null || value === undefined ? 0 : Number(value) })
                }}
              />
            </label>
            <label className="mqtt-field">
              <span>传输方式</span>
              <Select
                value={profile.transport}
                options={TRANSPORT_OPTIONS}
                onChange={(value: MqttTransport) =>
                  patch({
                    transport: value,
                    port: portTouched ? profile.port : MQTT_TRANSPORT_PORTS[value]
                  })
                }
              />
            </label>
            {profile.transport === 'ws' || profile.transport === 'wss' ? (
              <label className={`mqtt-field${issueClass(Boolean(issueFor('ws_path')))}`}>
                <span>WebSocket 路径</span>
                <Input
                  value={profile.ws_path ?? ''}
                  status={issueFor('ws_path') ? 'error' : undefined}
                  placeholder="/mqtt"
                  onChange={(event) => patch({ ws_path: event.target.value || undefined })}
                />
              </label>
            ) : null}
            <label className="mqtt-field">
              <span>协议版本</span>
              <Select
                value={protocolVersion}
                options={[
                  { value: 4, label: 'MQTT 3.1.1 (v4)' },
                  { value: 5, label: 'MQTT 5.0 (v5)' }
                ]}
                onChange={(value: MqttProtocolVersion) => patch({ protocol_version: value })}
              />
            </label>
            <label className={`mqtt-field${issueClass(Boolean(issueFor('client_id')))}`}>
              <span>Client ID</span>
              <Input
                value={profile.client_id}
                status={issueFor('client_id') ? 'error' : undefined}
                onChange={(event) => patch({ client_id: event.target.value })}
              />
            </label>
            <label className="mqtt-field">
              <span>用户名</span>
              <Input
                value={profile.username ?? ''}
                onChange={(event) => patch({ username: event.target.value })}
              />
            </label>
            <label className="mqtt-field">
              <span>密码</span>
              <Input.Password
                value={profile.password ?? ''}
                onChange={(event) => patch({ password: event.target.value })}
                visibilityToggle
              />
            </label>
            <label className={`mqtt-field${issueClass(Boolean(issueFor('keepalive')))}`}>
              <span>Keepalive（秒）</span>
              <InputNumber
                min={0}
                max={65535}
                style={{ width: '100%' }}
                status={issueFor('keepalive') ? 'error' : undefined}
                value={profile.keepalive}
                onChange={(value) =>
                  patch({ keepalive: value === null || value === undefined ? 0 : Number(value) })
                }
              />
            </label>
            <label className="mqtt-field">
              <span>连接超时（毫秒）</span>
              <InputNumber
                min={500}
                max={120000}
                step={500}
                style={{ width: '100%' }}
                status={issueFor('connect_timeout_ms') ? 'error' : undefined}
                value={profile.connect_timeout_ms}
                onChange={(value) =>
                  patch({
                    connect_timeout_ms:
                      value === null || value === undefined ? 500 : Number(value)
                  })
                }
              />
            </label>
            <label className="mqtt-field mqtt-field-switch">
              <span title="MQTT 5 中对应 Clean Start">Clean Session / Start</span>
              <Switch
                checked={profile.clean_session}
                onChange={(checked) => patch({ clean_session: checked })}
              />
            </label>
          </div>
        </section>

        {testResult ? (
          <section className={`mqtt-test-result ${testResult.success ? 'ok' : 'fail'}`}>
            <div className="mqtt-section-title">
              测试结果
              <Tag color={testResult.success ? 'green' : 'red'}>
                {testResult.success ? '成功' : '失败'}
              </Tag>
            </div>
            <div className="mqtt-kv-grid">
              <div className="mqtt-kv">
                <span>协议</span>
                <strong>
                  {protocolLabel(testResult.connack?.protocol_version ?? protocolVersion)}
                </strong>
              </div>
              <div className="mqtt-kv">
                <span>耗时</span>
                <strong>{testResult.duration_ms} ms</strong>
              </div>
              {reasonCode !== undefined ? (
                <div className="mqtt-kv">
                  <span>CONNACK</span>
                  <strong>
                    {mqttReasonText(reasonCode, 'connack', protocolVersion)}
                  </strong>
                </div>
              ) : null}
              <div className="mqtt-kv">
                <span>Session Present</span>
                <strong>{testResult.connack?.session_present ? '是' : '否'}</strong>
              </div>
              <div className="mqtt-kv">
                <span>Client ID</span>
                <strong className="mono">{testResult.connack?.client_id ?? '—'}</strong>
              </div>
              {testResult.round_trip?.enabled ? (
                <div className="mqtt-kv">
                  <span>往返验证</span>
                  <strong>
                    {testResult.round_trip.success ? '成功' : '失败'}
                    {testResult.round_trip.latency_ms !== undefined
                      ? ` · ${testResult.round_trip.latency_ms} ms`
                      : ''}
                  </strong>
                </div>
              ) : null}
            </div>
            {testResult.round_trip?.error ? (
              <div className="mqtt-test-error">
                往返错误：{testResult.round_trip.error}
              </div>
            ) : null}
            {testResult.error ? (
              <div className="mqtt-test-error">
                <div>
                  <Tag color="red">{testResult.error.category}</Tag>
                  {testResult.error.message}
                </div>
                {testErrorHint ? <div className="mqtt-field-hint">{testErrorHint}</div> : null}
              </div>
            ) : null}
          </section>
        ) : null}

        <Collapse
          className="mqtt-collapse"
          defaultActiveKey={['subscriptions', 'tls']}
          items={collapseItems}
        />

        <section className="mqtt-section">
          <div className="mqtt-section-title">
            最近 Attempt
            <Button size="small" type="link" onClick={() => void loadAttempts()}>
              刷新
            </Button>
          </div>
          {attempts.length === 0 ? (
            <div className="mqtt-field-hint">暂无测试或连接记录。</div>
          ) : (
            <div className="mqtt-attempt-list">
              {attempts.map((attempt) => (
                <div className="mqtt-attempt-row" key={attempt.attempt_id}>
                  <span className="mqtt-attempt-time">{formatDateTime(attempt.started_at)}</span>
                  <Tag color={attempt.kind === 'test' ? 'blue' : 'purple'}>
                    {attempt.kind === 'test' ? '测试' : '连接'}
                  </Tag>
                  <Tag color={attempt.success ? 'green' : 'red'}>
                    {attempt.success ? '成功' : '失败'}
                  </Tag>
                  <span className="mqtt-attempt-duration">{attempt.duration_ms} ms</span>
                  <span className="mqtt-attempt-detail" title={attempt.error?.message}>
                    {attempt.error
                      ? `[${attempt.error.category}] ${attempt.error.message}`
                      : attempt.connack?.reason_code !== undefined
                        ? mqttReasonText(
                            attempt.connack.reason_code,
                            'connack',
                            protocolVersion
                          )
                        : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <VersionDrawer
        open={versionOpen}
        projectId={projectId}
        connectionId={profile.connection_id}
        onClose={() => setVersionOpen(false)}
        onRestored={(restored: MqttConnectionProfile) => {
          onRestored(restored)
          setVersionOpen(false)
        }}
      />
    </div>
  )
}
