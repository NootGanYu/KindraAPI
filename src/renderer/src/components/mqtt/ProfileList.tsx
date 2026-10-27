import { useMemo, useState } from 'react'
import { App as AntApp, Button, Dropdown, Empty, Input, Spin, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ExportOutlined,
  MoreOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { MqttProfileSummary, MqttSessionState } from '@shared/mqtt'
import {
  errorMessage,
  protocolLabel,
  statusLabel,
  statusTone
} from './mqttUtils'

interface Props {
  profiles: MqttProfileSummary[]
  sessions: Record<string, MqttSessionState | undefined>
  selectedId: string | null
  loading: boolean
  onSelect: (connectionId: string) => void
  onNew: () => Promise<void>
  onClone: (connectionId: string) => Promise<void>
  onDelete: (connectionId: string) => Promise<void>
  onExport: (connectionId: string) => Promise<void>
}

const UNGROUPED = '未分组'

function groupName(profile: MqttProfileSummary): string {
  return profile.group?.trim() || UNGROUPED
}

export default function ProfileList({
  profiles,
  sessions,
  selectedId,
  loading,
  onSelect,
  onNew,
  onClone,
  onDelete,
  onExport
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const groups = useMemo(() => {
    const text = query.trim().toLowerCase()
    const filtered = profiles.filter(
      (profile) =>
        !text ||
        profile.name.toLowerCase().includes(text) ||
        profile.host.toLowerCase().includes(text)
    )
    const map = new Map<string, MqttProfileSummary[]>()
    for (const profile of filtered) {
      const name = groupName(profile)
      const list = map.get(name) ?? []
      list.push(profile)
      map.set(name, list)
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === UNGROUPED) return 1
      if (b === UNGROUPED) return -1
      return a.localeCompare(b, 'zh-CN')
    })
  }, [profiles, query])

  const toggleGroup = (name: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = (profile: MqttProfileSummary): void => {
    modal.confirm({
      title: `删除连接「${profile.name}」？`,
      content: '连接配置、版本历史与本地消息记录都会被删除，此操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => runAction(() => onDelete(profile.connection_id))
    })
  }

  const confirmExport = (profile: MqttProfileSummary): void => {
    modal.confirm({
      title: '导出连接配置？',
      content: '该文件包含明文凭据（用户名、密码、TLS 私钥口令等），请妥善保管。',
      okText: '继续导出',
      cancelText: '取消',
      onOk: () => runAction(() => onExport(profile.connection_id))
    })
  }

  const menuFor = (profile: MqttProfileSummary): MenuProps => ({
    items: [
      { key: 'edit', label: '编辑', icon: <EditOutlined /> },
      { key: 'clone', label: '复制', icon: <CopyOutlined /> },
      { key: 'export', label: '导出', icon: <ExportOutlined /> },
      { type: 'divider' },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true }
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      if (key === 'edit') onSelect(profile.connection_id)
      if (key === 'clone') void runAction(() => onClone(profile.connection_id))
      if (key === 'export') confirmExport(profile)
      if (key === 'delete') confirmDelete(profile)
    }
  })

  return (
    <aside className="mqtt-side">
      <div className="mqtt-side-search">
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined style={{ color: '#a2967f' }} />}
          placeholder="搜索名称或主机"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="mqtt-side-scroll">
        {loading ? (
          <div className="mqtt-side-loading">
            <Spin size="small" />
          </div>
        ) : profiles.length === 0 ? (
          <div className="mqtt-side-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="muted">还没有 MQTT 连接，先新建一个</span>
              }
            />
            <Button type="primary" size="small" onClick={() => void runAction(onNew)}>
              新建连接
            </Button>
          </div>
        ) : (
          groups.map(([name, items]) => {
            const isCollapsed = !query.trim() && collapsed.has(name)
            return (
              <div className="mqtt-group" key={name}>
                <button
                  type="button"
                  className="mqtt-group-head"
                  onClick={() => toggleGroup(name)}
                >
                  <span className="mqtt-group-toggle">
                    {isCollapsed ? <RightOutlined /> : <DownOutlined />}
                  </span>
                  <span className="mqtt-group-name">{name}</span>
                  <span className="mqtt-group-count">{items.length}</span>
                </button>
                {isCollapsed
                  ? null
                  : items.map((profile) => {
                      const session = sessions[profile.connection_id]
                      const tone = statusTone(session?.state)
                      const active = profile.connection_id === selectedId
                      return (
                        <Dropdown
                          key={profile.connection_id}
                          trigger={['contextMenu']}
                          menu={menuFor(profile)}
                        >
                          <div
                            className={`mqtt-profile-row${active ? ' active' : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelect(profile.connection_id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') onSelect(profile.connection_id)
                            }}
                          >
                            <span className={`mqtt-dot ${tone}`} title={statusLabel(session?.state)} />
                            <div className="mqtt-profile-main">
                              <div className="mqtt-profile-title">
                                <span className="mqtt-profile-name" title={profile.name}>
                                  {profile.name}
                                </span>
                                <Dropdown
                                  trigger={['click']}
                                  menu={menuFor(profile)}
                                >
                                  <button
                                    type="button"
                                    className="mqtt-profile-more"
                                    title="更多操作"
                                    aria-label="更多操作"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <MoreOutlined />
                                  </button>
                                </Dropdown>
                              </div>
                              <div className="mqtt-profile-sub" title={`${profile.host}:${profile.port}`}>
                                {profile.host}:{profile.port}
                                <span className="mqtt-profile-proto">
                                  {protocolLabel(profile.protocol_version)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </Dropdown>
                      )
                    })}
              </div>
            )
          })
        )}
      </div>

      <div className="mqtt-side-foot">
        <Tooltip title="新建 MQTT 连接">
          <Button
            block
            type="primary"
            icon={<PlusOutlined />}
            loading={busy}
            onClick={() => void runAction(onNew)}
          >
            新建连接
          </Button>
        </Tooltip>
      </div>
    </aside>
  )
}
