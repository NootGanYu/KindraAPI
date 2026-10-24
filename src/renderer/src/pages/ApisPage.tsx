import { useEffect, useState } from 'react'
import {
  App as AntApp,
  Checkbox,
  Dropdown,
  Input,
  Tag,
  Tooltip
} from 'antd'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  ApiOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  FilterOutlined,
  FolderAddOutlined,
  FolderOutlined,
  LayoutOutlined,
  MoreOutlined,
  PlusOutlined,
  SaveOutlined,
  ShareAltOutlined
} from '@ant-design/icons'
import type { Target } from '@shared/types'
import { useApp } from '../store'
import ApiTree from '../components/ApiTree'
import RequestEditor from '../components/RequestEditor'
import ResponsePanel from '../components/ResponsePanel'

const ENTRIES = [
  { label: 'HTTP', color: '#ff6b6b', icon: <ApiOutlined /> },
  { label: 'Event Stream', color: '#5f80e9', icon: <ApiOutlined /> },
  { label: 'WebSocket', color: '#ffb400', icon: <ApiOutlined /> },
  { label: 'Socket.IO', color: '#26cea4', icon: <ApiOutlined /> },
  { label: 'GraphQL', color: '#e2578d', icon: <ApiOutlined /> },
  { label: 'TCP 客户端', color: '#5bbfd4', icon: <ApiOutlined /> },
  { label: 'Markdown', color: '#4971a6', icon: <ApiOutlined /> },
  { label: '导入项目', color: '#fa8c16', icon: <FolderAddOutlined /> }
]

const MODES = ['设计', '调试', '接口用例', '一键压测', 'Mock'] as const
type Mode = (typeof MODES)[number]
type SplitDir = 'vertical' | 'horizontal'

export default function ApisPage(): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const targets = useApp((s) => s.targets)
  const drafts = useApp((s) => s.drafts)
  const records = useApp((s) => s.records)
  const sendingId = useApp((s) => s.sendingId)
  const setActive = useApp((s) => s.setActive)
  const closeTab = useApp((s) => s.closeTab)
  const createTarget = useApp((s) => s.createTarget)
  const deleteTarget = useApp((s) => s.deleteTarget)
  const patchDraft = useApp((s) => s.patchDraft)
  const saveTarget = useApp((s) => s.saveTarget)
  const environments = useApp((s) => s.environments)
  const currentEnvId = useApp((s) => s.currentEnvId)
  const setEnv = useApp((s) => s.setEnv)
  const reloadTargets = useApp((s) => s.reloadTargets)

  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState<Mode>('调试')
  const [splitDir, setSplitDir] = useState<SplitDir>('vertical')

  const active = activeId ? drafts[activeId] : undefined
  const record = activeId ? records[activeId] ?? null : null

  const handleCreate = async (parentId: string, type: 'folder' | 'api'): Promise<void> => {
    if (creating) return
    setCreating(true)
    try {
      await createTarget(parentId, type)
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await deleteTarget(id)
      message.success('已删除')
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const handleClose = (id: string, dirty: boolean): void => {
    if (!dirty) {
      closeTab(id)
      return
    }
    modal.confirm({
      title: '放弃未保存的修改？',
      content: '该标签页有未保存的修改，关闭后将丢失。',
      okText: '放弃并关闭',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => closeTab(id)
    })
  }

  const saveActive = async (): Promise<void> => {
    if (!active) return
    try {
      await saveTarget(active.target_id)
      message.success('已保存')
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const commitName = async (): Promise<void> => {
    if (!active) return
    const summary = targets.find((item) => item.target_id === active.target_id)
    const name = active.name.trim()
    if (!name) {
      if (summary) patchDraft(active.target_id, { name: summary.name })
      return
    }
    if (!summary || summary.name === name) return
    try {
      await saveTarget(active.target_id)
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const deleteActive = (): void => {
    if (!active) return
    modal.confirm({
      title: `删除接口「${active.name}」？`,
      content: '删除后不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => void handleDelete(active.target_id)
    })
  }

  const envName = environments.find((item) => item.env_id === currentEnvId)?.name ?? '无环境'

  return (
    <div className="page">
      <PanelGroup direction="horizontal" autoSaveId="workbench-apis-layout-v2">
        <Panel defaultSize={22.5} minSize={18} maxSize={32}>
          <ApiTree onCreate={handleCreate} onDelete={handleDelete} />
        </Panel>
        <PanelResizeHandle className="resize-handle resize-handle-v" />
        <Panel minSize={40}>
          <div className="api-workspace">
            <div className="tabbar">
              {tabs.map((tab) => {
                const draft = drafts[tab.id]
                const isFolder = draft?.target_type === 'folder'
                return (
                  <div
                    key={tab.id}
                    className={`filetab${tab.id === activeId ? ' active' : ''}`}
                    onClick={() => setActive(tab.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setActive(tab.id)
                    }}
                  >
                    {tab.dirty ? <span className="red-dot" /> : null}
                    {isFolder ? (
                      <FolderOutlined style={{ fontSize: 12, color: '#a58a58' }} />
                    ) : (
                      <span className="method-text">{(draft?.method || 'GET').toUpperCase()}</span>
                    )}
                    <span className="tab-name">{tab.name}</span>
                    <span
                      className="tab-x"
                      role="button"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleClose(tab.id, tab.dirty)
                      }}
                    >
                      <CloseOutlined style={{ fontSize: 10 }} />
                    </span>
                  </div>
                )
              })}
              <button className="tab-add" onClick={() => void handleCreate('0', 'api')}>
                <PlusOutlined style={{ fontSize: 13 }} />
              </button>
              <button className="tab-more">
                <MoreOutlined style={{ fontSize: 13 }} />
              </button>
              <span style={{ flex: 1 }} />
              <Dropdown
                trigger={['click']}
                menu={{
                  items: environments.map((env) => ({
                    key: env.env_id,
                    label: env.name,
                    disabled: env.env_id === currentEnvId
                  })),
                  onClick: ({ key }) => void setEnv(key)
                }}
              >
                <button className="env-pill">
                  <span style={{ color: 'var(--blue-2)', display: 'flex' }}>
                    <ApiOutlined style={{ fontSize: 12 }} />
                  </span>
                  {envName} <DownOutlined style={{ fontSize: 9 }} />
                </button>
              </Dropdown>
              <Tooltip title="更多">
                <button
                  className="icon-btn"
                  onClick={() => void reloadTargets()}
                  style={{ marginBottom: 4 }}
                >
                  <MoreOutlined style={{ fontSize: 14 }} />
                </button>
              </Tooltip>
            </div>

            {!active ? (
              <Welcome onCreate={() => void handleCreate('0', 'api')} />
            ) : active.target_type === 'folder' ? (
              <FolderInfo target={active} />
            ) : (
              <div className="surface">
                <div className="mode-row">
                  <div className="segmented">
                    {MODES.map((item) => (
                      <button
                        key={item}
                        className={mode === item ? 'active' : ''}
                        onClick={() => setMode(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="api-meta">
                    <span className="dev-state">
                      <i /> 开发中 <DownOutlined style={{ fontSize: 9 }} />
                    </span>
                    <span className="api-name">
                      <Input
                        value={active.name}
                        onChange={(event) =>
                          patchDraft(active.target_id, { name: event.target.value })
                        }
                        onBlur={() => void commitName()}
                        onPressEnter={(event) => {
                          void commitName()
                          event.currentTarget.blur()
                        }}
                      />
                    </span>
                    <Tooltip title="筛选（后续支持）">
                      <button className="mini">
                        <FilterOutlined style={{ fontSize: 14 }} />
                      </button>
                    </Tooltip>
                    <button
                      className="share-btn"
                      onClick={() => message.info('分享将在后续里程碑支持')}
                    >
                      <ShareAltOutlined style={{ fontSize: 13 }} /> 分享
                    </button>
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          { key: 'save', label: '保存', icon: <SaveOutlined /> },
                          { key: 'delete', label: '删除接口', icon: <DeleteOutlined />, danger: true }
                        ],
                        onClick: ({ key }) => {
                          if (key === 'save') void saveActive()
                          if (key === 'delete') deleteActive()
                        }
                      }}
                    >
                      <button className="mini">
                        <MoreOutlined style={{ fontSize: 14 }} />
                      </button>
                    </Dropdown>
                  </div>
                </div>

                {mode === '调试' ? (
                  <PanelGroup
                    key={splitDir}
                    direction={splitDir}
                    autoSaveId={`workbench-editor-split-${splitDir}-v2`}
                  >
                    <Panel
                      defaultSize={splitDir === 'vertical' ? 52 : 55}
                      minSize={22}
                    >
                      <RequestEditor
                        draft={active}
                        onChange={(patch) => patchDraft(active.target_id, patch)}
                      />
                    </Panel>
                    <PanelResizeHandle
                      className={`resize-handle ${
                        splitDir === 'vertical' ? 'resize-handle-h' : 'resize-handle-v'
                      }`}
                    />
                    <Panel defaultSize={splitDir === 'vertical' ? 48 : 45} minSize={20}>
                      <div className="response-pane">
                        <ResponsePanel
                          record={record}
                          examples={active.response?.example}
                          loading={sendingId === active.target_id}
                        />
                        <Tooltip
                          title={
                            splitDir === 'vertical' ? '切换为左右分屏' : '切换为上下分屏'
                          }
                        >
                          <button
                            className="split-toggle"
                            onClick={() =>
                              setSplitDir((dir) =>
                                dir === 'vertical' ? 'horizontal' : 'vertical'
                              )
                            }
                          >
                            <LayoutOutlined style={{ fontSize: 15 }} />
                          </button>
                        </Tooltip>
                      </div>
                    </Panel>
                  </PanelGroup>
                ) : (
                  <ModePlaceholder mode={mode} draft={active} />
                )}
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}

function ModePlaceholder({ mode, draft }: { mode: Exclude<Mode, '调试'>; draft: Target }): JSX.Element {
  const text: Record<Exclude<Mode, '调试'>, { title: string; desc: string }> = {
    设计: {
      title: '设计',
      desc: `接口「${draft.name}」的设计契约视图将在下一迭代补齐；当前调试图已可完整发送并记录响应。`
    },
    接口用例: {
      title: '接口用例',
      desc: '流程与断言编排在顶栏「AI 执行计划」中已可用；这里将补齐针对单接口的用例集合。'
    },
    一键压测: {
      title: '一键压测',
      desc: '压测属于后续里程碑：并发数、时长、TPS 与响应时间趋势。'
    },
    Mock: {
      title: 'Mock',
      desc: '本地 Mock 服务属于后续里程碑：端口 30999、期望响应与数据结构。'
    }
  }
  const item = text[mode]
  return (
    <div className="mode-empty">
      <div className="mode-empty-inner">
        <Tag color="default">{mode}</Tag>
        <h3>{item.title}</h3>
        <div>{item.desc}</div>
      </div>
    </div>
  )
}

function Welcome({ onCreate }: { onCreate: () => void }): JSX.Element {
  const { message } = AntApp.useApp()
  return (
    <div className="surface welcome">
      <div className="welcome-inner">
        <div className="brand">
          <span className="brand-logo">o</span>
          <span>openPost</span>
        </div>
        <div className="welcome-title">真正重要的创意，不该经过任何一朵云。</div>
        <div className="welcome-sub">新建接口，或从左侧目录开始整理你的 API。</div>
        <div className="entry-grid">
          {ENTRIES.map((entry) => (
            <div
              key={entry.label}
              className="entry"
              onClick={() =>
                entry.label === 'HTTP'
                  ? onCreate()
                  : message.info(`${entry.label} 将在后续里程碑支持`)
              }
            >
              <span className="entry-icon" style={{ background: entry.color }}>
                {entry.icon}
              </span>
              <span>{entry.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FolderInfo({ target }: { target: Target }): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const targets = useApp((s) => s.targets)
  const openTarget = useApp((s) => s.openTarget)
  const renameTarget = useApp((s) => s.renameTarget)
  const deleteTargets = useApp((s) => s.deleteTargets)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(target.name)
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    setSelected([])
    setEditing(false)
    setName(target.name)
  }, [target.target_id])

  const children = targets
    .filter((item) => item.parent_id === target.target_id)
    .sort((a, b) => a.sort - b.sort)

  const apiIds = children
    .filter((item) => item.target_type === 'api')
    .map((item) => item.target_id)
  const checkedIds = selected.filter((id) => apiIds.includes(id))

  const toggleOne = (id: string, checked: boolean): void => {
    setSelected((ids) => (checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id)))
  }

  const deleteSelected = (): void => {
    if (checkedIds.length === 0) return
    modal.confirm({
      title: `删除选中的 ${checkedIds.length} 个接口？`,
      content: '只删除列表内选中的接口，目录本身不会删除。此操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteTargets(checkedIds)
          setSelected([])
          message.success('已删除')
        } catch (error) {
          message.error((error as Error).message)
        }
      }
    })
  }

  const startRename = (): void => {
    setName(target.name)
    setEditing(true)
  }

  const commitRename = async (): Promise<void> => {
    const next = name.trim()
    if (!next) {
      setName(target.name)
      setEditing(false)
      return
    }
    if (next !== target.name) {
      try {
        await renameTarget(target.target_id, next)
      } catch (error) {
        message.error((error as Error).message)
      }
    }
    setEditing(false)
  }

  return (
    <div className="surface">
      <div className="folder-pane">
        <div className="folder-head">
          {editing ? (
            <Input
              autoFocus
              className="folder-name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void commitRename()}
              onPressEnter={() => void commitRename()}
            />
          ) : (
            <span className="folder-name" title="点击重命名" onClick={startRename}>
              {target.name}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <Tooltip title={checkedIds.length ? '删除选中的接口' : '请先勾选要删除的接口'}>
            <button
              className="folder-delete"
              onClick={deleteSelected}
              disabled={checkedIds.length === 0}
            >
              删除{checkedIds.length > 0 ? ` (${checkedIds.length})` : ''}
            </button>
          </Tooltip>
        </div>

        {children.length === 0 ? (
          <div className="folder-empty">此目录为空</div>
        ) : (
          <div className="folder-list">
            {children.map((item) => (
              <div
                key={item.target_id}
                className="folder-row"
                role="button"
                tabIndex={0}
                onClick={() => void openTarget(item.target_id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void openTarget(item.target_id)
                }}
              >
                {item.target_type === 'api' ? (
                  <Checkbox
                    checked={selected.includes(item.target_id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleOne(item.target_id, event.target.checked)}
                  />
                ) : (
                  <span className="folder-row-check" />
                )}
                {item.target_type === 'folder' ? (
                  <FolderOutlined className="folder-row-icon" />
                ) : (
                  <span className="method-text">{(item.method || 'GET').toUpperCase()}</span>
                )}
                <span className="folder-row-name">{item.name}</span>
                <span className="folder-row-url">{item.url}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
