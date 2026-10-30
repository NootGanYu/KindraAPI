import { useEffect, useRef, useState } from 'react'
import {
  App as AntApp,
  Button,
  Checkbox,
  Dropdown,
  Input,
  Modal,
  Popover,
  Tag,
  Tooltip
} from 'antd'
import type { MenuProps } from 'antd'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  ApiOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  FolderOutlined,
  HistoryOutlined,
  LayoutOutlined,
  LeftOutlined,
  MoreOutlined,
  PlusOutlined,
  RightOutlined,
  SaveOutlined,
  SearchOutlined,
  ShareAltOutlined
} from '@ant-design/icons'
import type { Target } from '@shared/types'
import { useApp } from '../store'
import ApiTree from '../components/ApiTree'
import RequestEditor from '../components/RequestEditor'
import ResponsePanel from '../components/ResponsePanel'
import DesignEditor from '../components/DesignEditor'
import CasesEditor from '../components/CasesEditor'
import DocShareDialog from '../components/DocShareDialog'
import DocShareLinkDialog, {
  type DocShareLinkInfo
} from '../components/DocShareLinkDialog'
import ApiDescriptionDialog from '../components/ApiDescriptionDialog'
import TargetVersionDrawer from '../components/TargetVersionDrawer'
import CodeGenDialog from '../components/CodeGenDialog'
import EnvironmentModal from '../components/EnvironmentModal'

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
  const projectId = useApp((s) => s.project?.project_id)
  const projectName = useApp((s) => s.project?.name ?? '')
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
  const cloneTarget = useApp((s) => s.cloneTarget)
  const replaceDraft = useApp((s) => s.replaceDraft)
  const addEnvironment = useApp((s) => s.addEnvironment)

  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState<Mode>('调试')
  const [splitDir, setSplitDir] = useState<SplitDir>('vertical')
  const tabScrollRef = useRef<HTMLDivElement | null>(null)
  const [tabOverflow, setTabOverflow] = useState(false)
  const [tabEdges, setTabEdges] = useState({ left: false, right: false })
  const [shareTarget, setShareTarget] = useState<{
    id: string
    name: string
    scope: 'api' | 'folder'
  } | null>(null)
  const [shareLink, setShareLink] = useState<DocShareLinkInfo | null>(null)
  const [descOpen, setDescOpen] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [envMenuOpen, setEnvMenuOpen] = useState(false)
  const [envSearch, setEnvSearch] = useState('')
  const [envModalOpen, setEnvModalOpen] = useState(false)
  const [envModalInitial, setEnvModalInitial] = useState<string | undefined>(undefined)
  const [closeRequest, setCloseRequest] = useState<{
    ids: string[]
    dirtyIds: string[]
  } | null>(null)
  const [closing, setClosing] = useState(false)

  const updateTabScroll = (): void => {
    const el = tabScrollRef.current
    if (!el) return
    setTabOverflow(el.scrollWidth > el.clientWidth + 4)
    setTabEdges({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    })
  }

  useEffect(() => {
    if (!activeId || !tabScrollRef.current) return
    const node = Array.from(
      tabScrollRef.current.querySelectorAll<HTMLElement>('.filetab')
    ).find((item) => item.dataset.tabId === activeId)
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    updateTabScroll()
  }, [activeId, tabs.length])

  useEffect(() => {
    const onResize = (): void => updateTabScroll()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  const performClose = (ids: string[]): void => {
    for (const id of ids) closeTab(id)
    setCloseRequest(null)
  }

  const requestClose = (ids: string[]): void => {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return
    const dirtyIds = unique.filter(
      (id) => tabs.find((tab) => tab.id === id)?.dirty
    )
    if (dirtyIds.length === 0) {
      performClose(unique)
      return
    }
    setCloseRequest({ ids: unique, dirtyIds })
  }

  const saveAndClose = async (): Promise<void> => {
    if (!closeRequest) return
    setClosing(true)
    try {
      for (const id of closeRequest.dirtyIds) await saveTarget(id)
      performClose(closeRequest.ids)
      message.success('已保存并关闭')
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setClosing(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!activeId) return
      const isF4 = event.key === 'F4' && event.ctrlKey && !event.metaKey
      const isCmdW =
        event.key.toLowerCase() === 'w' && event.metaKey && !event.ctrlKey && !event.altKey
      if (!isF4 && !isCmdW) return
      event.preventDefault()
      requestClose([activeId])
    }
    window.addEventListener('keydown', onKey)
    const offShortcut = window.api.app.onCloseTabShortcut(() => {
      const id = useApp.getState().activeId
      if (id) requestClose([id])
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      offShortcut()
    }
  }, [activeId, tabs])

  const tabMenuItems = (tab: (typeof tabs)[number]): MenuProps['items'] => {
    const index = tabs.findIndex((item) => item.id === tab.id)
    const others = tabs.filter((item) => item.id !== tab.id)
    const unmodified = others.filter((item) => !item.dirty)
    return [
      { key: 'close', label: '关闭 (Ctrl+F4)', onClick: () => requestClose([tab.id]) },
      {
        key: 'closeOthers',
        label: '关闭其他标签页',
        disabled: others.length === 0,
        onClick: () => requestClose(others.map((item) => item.id))
      },
      {
        key: 'closeAll',
        label: '关闭所有标签页',
        onClick: () => requestClose(tabs.map((item) => item.id))
      },
      {
        key: 'closeUnmodified',
        label: '关闭未修改标签页',
        disabled: unmodified.length === 0,
        onClick: () => requestClose(unmodified.map((item) => item.id))
      },
      { type: 'divider' as const },
      {
        key: 'closeLeft',
        label: '关闭左侧标签页',
        disabled: index <= 0,
        onClick: () => requestClose(tabs.slice(0, index).map((item) => item.id))
      },
      {
        key: 'closeRight',
        label: '关闭右侧标签页',
        disabled: index >= tabs.length - 1,
        onClick: () => requestClose(tabs.slice(index + 1).map((item) => item.id))
      }
    ]
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

  const openShare = async (): Promise<void> => {
    if (!active || active.target_type === 'folder' || !projectId) return
    const tab = tabs.find((item) => item.id === active.target_id)
    try {
      // 有未保存修改时先落盘，保证分享内容与当前界面一致。
      if (tab?.dirty) await saveTarget(active.target_id)
      const freshName =
        useApp.getState().drafts[active.target_id]?.name ?? active.name
      setShareTarget({ id: active.target_id, name: freshName, scope: 'api' })
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
  const filteredEnvs = environments.filter((env) =>
    env.name.toLowerCase().includes(envSearch.trim().toLowerCase())
  )

  const openEnvModal = (envId?: string): void => {
    setEnvModalInitial(envId)
    setEnvModalOpen(true)
  }

  const createEnvironmentFromMenu = async (): Promise<void> => {
    try {
      const env = await addEnvironment('新环境')
      openEnvModal(env.env_id)
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const cloneActive = async (): Promise<void> => {
    if (!active) return
    try {
      await cloneTarget(active.target_id)
      message.success('已克隆接口')
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const openShareNode = async (item: (typeof targets)[number]): Promise<void> => {
    if (!projectId) return
    try {
      const tab = tabs.find((entry) => entry.id === item.target_id)
      // 有未保存修改时先落盘，保证分享内容与当前界面一致。
      if (tab?.dirty) await saveTarget(item.target_id)
      const freshName =
        useApp.getState().drafts[item.target_id]?.name ?? item.name
      setShareTarget({
        id: item.target_id,
        name: freshName,
        scope: item.target_type === 'folder' ? 'folder' : 'api'
      })
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const commitDescription = (html: string): void => {
    if (!active) return
    patchDraft(active.target_id, { description: html })
    void saveTarget(active.target_id)
      .then(() => message.success('接口说明已保存'))
      .catch((error) => message.error((error as Error).message))
  }

  return (
    <div className="page">
      <PanelGroup direction="horizontal" autoSaveId="workbench-apis-layout-v2">
        <Panel defaultSize={22.5} minSize={18} maxSize={32}>
          <ApiTree
            onCreate={handleCreate}
            onDelete={handleDelete}
            onShare={(item) => void openShareNode(item)}
          />
        </Panel>
        <PanelResizeHandle className="resize-handle resize-handle-v" />
        <Panel minSize={40}>
          <div className="api-workspace">
            <div className="tabbar">
              <div
                className="tab-scroll"
                ref={tabScrollRef}
                onScroll={updateTabScroll}
                onWheel={(event) => {
                  const el = tabScrollRef.current
                  if (!el) return
                  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                    el.scrollLeft += event.deltaY
                  }
                }}
              >
                {tabs.map((tab) => {
                  const draft = drafts[tab.id]
                  const isFolder = draft?.target_type === 'folder'
                  return (
                    <Dropdown
                      key={tab.id}
                      trigger={['contextMenu']}
                      menu={{ items: tabMenuItems(tab) }}
                    >
                      <div
                        data-tab-id={tab.id}
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
                          <span className="method-text">
                            {(draft?.method || 'GET').toUpperCase()}
                          </span>
                        )}
                        <span className="tab-name">{tab.name}</span>
                        <span
                          className="tab-x"
                          role="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation()
                            requestClose([tab.id])
                          }}
                        >
                          <CloseOutlined style={{ fontSize: 10 }} />
                        </span>
                      </div>
                    </Dropdown>
                  )
                })}
              </div>
              {tabOverflow ? (
                <>
                  <button
                    className="tab-arrow"
                    disabled={!tabEdges.left}
                    title="向左滚动"
                    onClick={() =>
                      tabScrollRef.current?.scrollBy({ left: -220, behavior: 'smooth' })
                    }
                  >
                    <LeftOutlined style={{ fontSize: 10 }} />
                  </button>
                  <button
                    className="tab-arrow"
                    disabled={!tabEdges.right}
                    title="向右滚动"
                    onClick={() =>
                      tabScrollRef.current?.scrollBy({ left: 220, behavior: 'smooth' })
                    }
                  >
                    <RightOutlined style={{ fontSize: 10 }} />
                  </button>
                </>
              ) : null}
              <button className="tab-add" onClick={() => void handleCreate('0', 'api')}>
                <PlusOutlined style={{ fontSize: 13 }} />
              </button>
              <Popover
                trigger="click"
                placement="bottomRight"
                open={envMenuOpen}
                onOpenChange={(next) => {
                  setEnvMenuOpen(next)
                  if (!next) setEnvSearch('')
                }}
                content={
                  <div className="env-menu">
                    <Input
                      allowClear
                      autoFocus
                      prefix={<SearchOutlined />}
                      placeholder="请输入环境名称"
                      value={envSearch}
                      onChange={(event) => setEnvSearch(event.target.value)}
                    />
                    <div className="env-menu-list">
                      {filteredEnvs.map((env) => (
                        <button
                          key={env.env_id}
                          type="button"
                          className={`env-menu-row${
                            env.env_id === currentEnvId ? ' active' : ''
                          }`}
                          onClick={() => {
                            void setEnv(env.env_id)
                            setEnvMenuOpen(false)
                          }}
                        >
                          <span className="env-badge">默</span>
                          <span className="env-menu-name">{env.name}</span>
                        </button>
                      ))}
                      {filteredEnvs.length === 0 ? (
                        <div className="env-menu-empty">无匹配环境</div>
                      ) : null}
                    </div>
                    <div className="env-menu-divider" />
                    <button
                      type="button"
                      className="env-menu-row add"
                      onClick={() => {
                        setEnvMenuOpen(false)
                        void createEnvironmentFromMenu()
                      }}
                    >
                      <PlusOutlined /> 新建环境
                    </button>
                  </div>
                }
              >
                <button className="env-pill">
                  <span style={{ color: 'var(--blue-2)', display: 'flex' }}>
                    <ApiOutlined style={{ fontSize: 12 }} />
                  </span>
                  {envName} <DownOutlined style={{ fontSize: 9 }} />
                </button>
              </Popover>
              <Tooltip title="环境管理">
                <button
                  className="icon-btn"
                  onClick={() => openEnvModal(currentEnvId)}
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
                    <Tooltip title="接口说明">
                      <button className="mini" onClick={() => setDescOpen(true)}>
                        <FileTextOutlined style={{ fontSize: 14 }} />
                      </button>
                    </Tooltip>
                    <button className="share-btn" onClick={() => void openShare()}>
                      <ShareAltOutlined style={{ fontSize: 13 }} /> 分享
                    </button>
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          {
                            key: 'versions',
                            label: '版本管理',
                            icon: <HistoryOutlined />
                          },
                          { key: 'code', label: '生成代码', icon: <CodeOutlined /> },
                          { key: 'clone', label: '克隆', icon: <CopyOutlined /> },
                          { type: 'divider' },
                          { key: 'save', label: '保存', icon: <SaveOutlined /> },
                          {
                            key: 'delete',
                            label: '删除接口',
                            icon: <DeleteOutlined />,
                            danger: true
                          }
                        ],
                        onClick: ({ key }) => {
                          if (key === 'versions') setVersionOpen(true)
                          if (key === 'code') setCodeOpen(true)
                          if (key === 'clone') void cloneActive()
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
                          projectId={projectId}
                          onChangeExamples={(examples) =>
                            patchDraft(active.target_id, {
                              response: { ...(active.response ?? {}), example: examples }
                            })
                          }
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
                ) : mode === '设计' ? (
                  <DesignEditor
                    draft={active}
                    projectId={projectId}
                    onChange={(patch) => patchDraft(active.target_id, patch)}
                  />
                ) : mode === '接口用例' ? (
                  <CasesEditor
                    draft={active}
                    projectId={projectId}
                    environmentId={currentEnvId}
                    onChange={(patch) => patchDraft(active.target_id, patch)}
                  />
                ) : (
                  <ModePlaceholder mode={mode} draft={active} />
                )}
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>

      <Modal
        open={closeRequest !== null}
        title="放弃未保存的修改？"
        closable={false}
        maskClosable={false}
        footer={null}
      >
        <p>
          {closeRequest && closeRequest.dirtyIds.length > 1
            ? `有 ${closeRequest.dirtyIds.length} 个标签页存在未保存的修改，关闭后将丢失。`
            : '该标签页有未保存的修改，关闭后将丢失。'}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button
            style={{ background: '#2f8f62', borderColor: '#2f8f62', color: '#fff' }}
            loading={closing}
            onClick={() => void saveAndClose()}
          >
            保存后关闭
          </Button>
          <Button onClick={() => setCloseRequest(null)}>取消</Button>
          <Button
            danger
            onClick={() => {
              if (closeRequest) performClose(closeRequest.ids)
            }}
          >
            放弃并关闭
          </Button>
        </div>
      </Modal>

      <DocShareDialog
        open={Boolean(shareTarget)}
        projectId={projectId ?? ''}
        projectName={projectName}
        targets={targets}
        initial={
          shareTarget
            ? {
                name: shareTarget.name,
                scope: shareTarget.scope,
                targetIds: [shareTarget.id]
              }
            : undefined
        }
        lockScope={shareTarget?.scope ?? 'api'}
        lockTarget={shareTarget?.id}
        lockTargetName={shareTarget?.name}
        onClose={() => setShareTarget(null)}
        onSaved={(share) => {
          setShareTarget(null)
          setShareLink({
            shareId: share.share_id,
            name: share.name,
            openapi: share.settings.openapi
          })
        }}
      />
      <DocShareLinkDialog share={shareLink} onClose={() => setShareLink(null)} />

      <ApiDescriptionDialog
        open={descOpen}
        value={active?.description ?? ''}
        onClose={() => setDescOpen(false)}
        onCommit={commitDescription}
      />
      <TargetVersionDrawer
        open={versionOpen}
        projectId={projectId ?? ''}
        targetId={active?.target_id ?? ''}
        targetName={active?.name ?? ''}
        onClose={() => setVersionOpen(false)}
        onRestored={(target) => {
          replaceDraft(target)
          message.success('已恢复版本')
        }}
      />
      <CodeGenDialog
        open={codeOpen}
        projectId={projectId ?? ''}
        target={active ?? null}
        environmentId={currentEnvId}
        onClose={() => setCodeOpen(false)}
      />
      <EnvironmentModal
        open={envModalOpen}
        initialEnvId={envModalInitial}
        onClose={() => {
          setEnvModalOpen(false)
          setEnvModalInitial(undefined)
        }}
      />
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
          <span className="brand-logo">K</span>
          <span>KindraAPI</span>
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
