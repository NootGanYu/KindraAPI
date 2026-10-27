import { useCallback, useEffect, useRef, useState } from 'react'
import {
  App as AntApp,
  Button,
  Empty,
  Spin,
  Tabs,
  Tag,
  Tooltip
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type {
  MqttConnectionProfile,
  MqttProfileSummary,
  MqttPublishInput,
  MqttSessionState
} from '@shared/mqtt'
import { validateMqttProfile } from '@shared/mqtt'
import { useApp } from '../store'
import ProfileList from '../components/mqtt/ProfileList'
import ProfileEditor from '../components/mqtt/ProfileEditor'
import MessagesPanel from '../components/mqtt/MessagesPanel'
import PublishPanel from '../components/mqtt/PublishPanel'
import AttemptsPanel from '../components/mqtt/AttemptsPanel'
import {
  errorMessage,
  formatTime,
  protocolLabel,
  statusLabel,
  statusTone,
  unwrap,
  useMqttEvent
} from '../components/mqtt/mqttUtils'

type PublishPrefill = { input: MqttPublishInput; nonce: number }

export default function MqttPage(): JSX.Element {
  const { message } = AntApp.useApp()
  const project = useApp((state) => state.project)
  const projectId = project?.project_id ?? ''
  const projectRef = useRef(projectId)
  projectRef.current = projectId
  const messageRef = useRef(message)
  messageRef.current = message

  const [profiles, setProfiles] = useState<MqttProfileSummary[]>([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [profile, setProfile] = useState<MqttConnectionProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [sessions, setSessions] = useState<Record<string, MqttSessionState | undefined>>({})
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [lastError, setLastError] = useState('')
  const [publishPrefill, setPublishPrefill] = useState<PublishPrefill | null>(null)
  const [activeTab, setActiveTab] = useState('messages')

  const loadProfiles = useCallback(
    async (pid: string, preferred?: string | null): Promise<void> => {
      if (!pid) {
        setProfiles([])
        setSelectedId(null)
        return
      }
      setProfilesLoading(true)
      try {
        const list = unwrap(await window.api.mqtt.profiles.list(pid))
        if (projectRef.current !== pid) return
        setProfiles(list)
        setSelectedId((current) => {
          const target = preferred ?? current
          if (target && list.some((item) => item.connection_id === target)) return target
          return list[0]?.connection_id ?? null
        })
      } catch (error) {
        if (projectRef.current === pid) messageRef.current.error(errorMessage(error))
      } finally {
        if (projectRef.current === pid) setProfilesLoading(false)
      }
    },
    []
  )

  const reloadSessions = useCallback(
    async (pid: string): Promise<void> => {
      if (!pid) return
      try {
        const result = await window.api.mqtt.sessions.list(pid)
        if (!result.ok || projectRef.current !== pid) return
        const map: Record<string, MqttSessionState | undefined> = {}
        for (const session of result.data) map[session.connection_id] = session
        setSessions(map)
      } catch {
        // 会话列表读取失败不影响其他功能。
      }
    },
    []
  )

  // 项目切换：重置选择、加载配置与会话。
  useEffect(() => {
    setSelectedId(null)
    setProfile(null)
    setSessions({})
    setLastError('')
    setPublishPrefill(null)
    setActiveTab('messages')
    if (!projectId) {
      setProfiles([])
      return
    }
    void loadProfiles(projectId, null)
    void reloadSessions(projectId)
  }, [projectId, loadProfiles, reloadSessions])

  // 选中配置后加载完整 Profile。
  useEffect(() => {
    if (!projectId || !selectedId) {
      setProfile(null)
      return
    }
    let alive = true
    setProfileLoading(true)
    void window.api.mqtt.profiles
      .get(projectId, selectedId)
      .then((result) => {
        if (!alive || projectRef.current !== projectId) return
        if (!result.ok) {
          messageRef.current.error(result.error)
          return
        }
        if (!result.data) {
          messageRef.current.warning('连接配置不存在或已被删除')
          return
        }
        setProfile(result.data)
      })
      .catch((error) => {
        if (alive) messageRef.current.error(errorMessage(error))
      })
      .finally(() => {
        if (alive) setProfileLoading(false)
      })
    return () => {
      alive = false
    }
  }, [projectId, selectedId])

  // 选中配置变化时重新订阅事件。
  useMqttEvent(
    projectId && selectedId ? `mqtt-page-${projectId}-${selectedId}` : null,
    (event) => {
      if (event.type === 'state') {
        const state = event.payload as MqttSessionState
        if (!state?.connection_id) return
        setSessions((current) => {
          const next = { ...current }
          if (state.state === 'closed') delete next[state.connection_id]
          else next[state.connection_id] = state
          return next
        })
        if (
          state.connection_id === selectedId &&
          (state.state === 'connected' || state.state === 'closed')
        ) {
          setLastError('')
        }
        return
      }
      if (event.connectionId !== selectedId) return
      if (event.type === 'error') {
        const payload = event.payload as { message?: string; hint?: string }
        const text = payload?.message ?? '连接发生错误'
        setLastError(payload?.hint ? `${text}（${payload.hint}）` : text)
      }
      if (event.type === 'connack') setLastError('')
    }
  )

  const session = selectedId ? sessions[selectedId] ?? null : null
  const tone = statusTone(session?.state)

  const handleSelect = (connectionId: string): void => {
    setSelectedId(connectionId)
    setLastError('')
    setPublishPrefill(null)
  }

  const handleNew = async (): Promise<void> => {
    if (!projectId) return
    const created = unwrap(await window.api.mqtt.profiles.create(projectId))
    await loadProfiles(projectId, created.connection_id)
    setSelectedId(created.connection_id)
    setProfile(created)
    message.success('已新建连接')
  }

  const handleClone = async (connectionId: string): Promise<void> => {
    if (!projectId) return
    const cloned = unwrap(await window.api.mqtt.profiles.clone(projectId, connectionId))
    await loadProfiles(projectId, cloned.connection_id)
    setSelectedId(cloned.connection_id)
    setProfile(cloned)
    message.success('已复制连接配置')
  }

  const handleDelete = async (connectionId: string): Promise<void> => {
    if (!projectId) return
    if (sessions[connectionId]) {
      await window.api.mqtt.publish
        .stopLoop(projectId, connectionId)
        .catch(() => undefined)
      await window.api.mqtt.disconnect(projectId, connectionId).catch(() => undefined)
    }
    unwrap(await window.api.mqtt.profiles.remove(projectId, connectionId))
    setSessions((current) => {
      const next = { ...current }
      delete next[connectionId]
      return next
    })
    if (selectedId === connectionId) {
      setSelectedId(null)
      setProfile(null)
    }
    await loadProfiles(projectId, null)
    message.success('已删除连接')
  }

  const handleExport = async (connectionId: string): Promise<void> => {
    if (!projectId) return
    const result = unwrap(
      await window.api.mqtt.profiles.export(projectId, { connection_ids: [connectionId] })
    )
    if (result.canceled) {
      message.info('已取消导出')
      return
    }
    message.success(
      `已导出连接配置${result.path ? ` → ${result.path}` : ''}`
    )
  }

  const handleSave = async (): Promise<boolean> => {
    if (!projectId || !profile) return false
    const issues = validateMqttProfile(profile)
    if (issues.length > 0) {
      message.error(issues.map((issue) => issue.message).join('；'))
      return false
    }
    setSaving(true)
    try {
      const saved = unwrap(await window.api.mqtt.profiles.save(projectId, profile))
      setProfile(saved)
      const list = unwrap(await window.api.mqtt.profiles.list(projectId))
      if (projectRef.current === projectId) setProfiles(list)
      message.success('已保存')
      return true
    } catch (error) {
      message.error(errorMessage(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleConnect = async (): Promise<void> => {
    if (!projectId || !profile) return
    setConnecting(true)
    try {
      const saved = unwrap(await window.api.mqtt.profiles.save(projectId, profile))
      setProfile(saved)
      const state = unwrap(await window.api.mqtt.connect(projectId, saved.connection_id))
      setSessions((current) => ({ ...current, [state.connection_id]: state }))
      setLastError('')
      message.success(state.state === 'connected' ? '已连接' : '正在连接…')
    } catch (error) {
      const text = errorMessage(error)
      setLastError(text)
      message.error(text)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    if (!projectId || !selectedId) return
    setConnecting(true)
    try {
      await window.api.mqtt.publish.stopLoop(projectId, selectedId).catch(() => undefined)
      unwrap(await window.api.mqtt.disconnect(projectId, selectedId))
      setSessions((current) => {
        const next = { ...current }
        delete next[selectedId]
        return next
      })
      setLastError('')
      message.success('已断开')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setConnecting(false)
    }
  }

  const handleResend = (input: MqttPublishInput): void => {
    setPublishPrefill({ input, nonce: Date.now() })
    setActiveTab('publish')
  }

  const refreshAll = (): void => {
    if (!projectId) return
    void loadProfiles(projectId, selectedId)
    void reloadSessions(projectId)
  }

  if (!projectId) {
    return (
      <div className="page mqtt-page">
        <div className="mqtt-empty-page">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="请先在顶部选择一个项目"
          />
        </div>
      </div>
    )
  }

  const tabItems = [
    {
      key: 'messages',
      label: '消息',
      children: selectedId ? (
        <MessagesPanel
          key={`messages-${selectedId}`}
          projectId={projectId}
          connectionId={selectedId}
          connected={session?.state === 'connected'}
          onResend={handleResend}
        />
      ) : null
    },
    {
      key: 'publish',
      label: '发布',
      children:
        selectedId && profile ? (
          <PublishPanel
            key={`publish-${selectedId}`}
            projectId={projectId}
            connectionId={selectedId}
            protocolVersion={profile.protocol_version}
            connected={session?.state === 'connected'}
            prefill={publishPrefill}
          />
        ) : null
    },
    {
      key: 'attempts',
      label: '运行记录',
      children: <AttemptsPanel projectId={projectId} profiles={profiles} />
    }
  ]

  const renderMain = (): JSX.Element => {
    if (!selectedId) {
      return (
        <div className="mqtt-main-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              profiles.length === 0
                ? '新建一个 MQTT 连接开始调试'
                : '请从左侧选择一个连接'
            }
          />
          {profiles.length === 0 ? (
            <Button type="primary" onClick={() => void handleNew()}>
              新建连接
            </Button>
          ) : null}
        </div>
      )
    }
    if (profileLoading || !profile) {
      return (
        <div className="mqtt-main-empty">
          <Spin tip="正在加载连接配置…" />
        </div>
      )
    }
    return (
      <PanelGroup direction="vertical" autoSaveId="mqtt-right-layout-v1">
        <Panel defaultSize={55} minSize={24}>
          <div className="mqtt-top-scroll">
            <ProfileEditor
              key={profile.connection_id}
              projectId={projectId}
              profile={profile}
              session={session}
              saving={saving}
              connecting={connecting}
              onChange={setProfile}
              onSave={handleSave}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onClone={() => handleClone(profile.connection_id)}
              onRestored={(restored) => {
                setProfile(restored)
                void loadProfiles(projectId, restored.connection_id)
              }}
            />
          </div>
        </Panel>
        <PanelResizeHandle className="resize-handle resize-handle-h" />
        <Panel defaultSize={45} minSize={24}>
          <div className="mqtt-bottom">
            <Tabs
              className="mqtt-tabs"
              activeKey={activeTab}
              onChange={setActiveTab}
              items={tabItems}
            />
          </div>
        </Panel>
      </PanelGroup>
    )
  }

  return (
    <div className="page mqtt-page">
      <PanelGroup direction="horizontal" autoSaveId="mqtt-layout-v1">
        <Panel defaultSize={22} minSize={16} maxSize={34}>
          <ProfileList
            profiles={profiles}
            sessions={sessions}
            selectedId={selectedId}
            loading={profilesLoading}
            onSelect={handleSelect}
            onNew={handleNew}
            onClone={handleClone}
            onDelete={handleDelete}
            onExport={handleExport}
          />
        </Panel>
        <PanelResizeHandle className="resize-handle resize-handle-v" />
        <Panel minSize={42}>
          <div className="mqtt-main">
            <div className={`mqtt-status ${tone}`}>
              <span className={`mqtt-dot ${tone}`} />
              <strong>{statusLabel(session?.state)}</strong>
              {profile ? (
                <span className="mqtt-status-meta">
                  {profile.name} · {protocolLabel(profile.protocol_version)}
                </span>
              ) : null}
              {session?.state === 'reconnecting' ? (
                <span className="mqtt-status-meta warn">
                  第 {session.retry_count ?? 0} 次重试
                  {session.next_retry_at
                    ? ` · 下次 ${formatTime(session.next_retry_at)}`
                    : ''}
                </span>
              ) : null}
              {session?.state === 'connected' && session.connected_at ? (
                <span className="mqtt-status-meta">
                  连接于 {formatTime(session.connected_at)}
                </span>
              ) : null}
              {lastError ? (
                <Tooltip title={lastError}>
                  <span className="mqtt-status-error">{lastError}</span>
                </Tooltip>
              ) : null}
              <span style={{ flex: 1 }} />
              {session ? (
                <Tag color="default" className="mqtt-session-tag">
                  会话 {session.session_id}
                </Tag>
              ) : null}
              <Tooltip title="刷新项目连接与会话">
                <Button
                  size="small"
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={refreshAll}
                />
              </Tooltip>
            </div>
            <div className="mqtt-main-body">
              {profilesLoading && profiles.length === 0 ? (
                <div className="mqtt-main-empty">
                  <Spin tip="正在加载 MQTT 连接…" />
                </div>
              ) : (
                renderMain()
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
