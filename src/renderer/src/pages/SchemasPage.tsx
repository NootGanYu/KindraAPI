import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  Tooltip
} from 'antd'
import {
  CloseOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  TableOutlined
} from '@ant-design/icons'
import type { DataModel, ModelSummary } from '@shared/types'
import { useApp } from '../store'
import DictionaryPanel from '../components/schemas/DictionaryPanel'
import DatabasePanel from '../components/schemas/DatabasePanel'
import ModelsListPanel from '../components/schemas/ModelsListPanel'
import ModelEditor from '../components/schemas/ModelEditor'

type TabKind = 'dictionary' | 'database' | 'models' | 'model'

interface PageTab {
  id: string
  name: string
  kind: TabKind
  modelId?: string
}

interface TreeAction {
  kind: 'rename' | 'move' | 'copy'
  model: DataModel
}

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export default function SchemasPage(): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const project = useApp((state) => state.project)
  const projectId = project?.project_id ?? ''
  const [models, setModels] = useState<DataModel[]>([])
  const [loading, setLoading] = useState(true)
  const [tabs, setTabs] = useState<PageTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dictionaryToken, setDictionaryToken] = useState(0)
  const [databaseToken, setDatabaseToken] = useState(0)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [treeAction, setTreeAction] = useState<TreeAction | null>(null)
  const [actionName, setActionName] = useState('')
  const [actionParent, setActionParent] = useState('0')

  const summaries: ModelSummary[] = useMemo(
    () =>
      models
        .map((model) => ({
          model_id: model.model_id,
          parent_id: model.parent_id,
          model_type: model.model_type,
          name: model.name,
          alias: model.alias,
          sort: model.sort,
          created_by: model.created_by,
          created_time: model.created_time,
          updated_by: model.updated_by,
          updated_time: model.updated_time
        }))
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN')),
    [models]
  )

  const reloadModels = async (): Promise<void> => {
    if (!projectId) return
    try {
      const list = unwrap(await window.api.models.listAll(projectId))
      setModels(list)
      const ids = new Set(list.map((model) => model.model_id))
      setTabs((current) =>
        current.filter((tab) => tab.kind !== 'model' || (tab.modelId && ids.has(tab.modelId)))
      )
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  useEffect(() => {
    setLoading(true)
    reloadModels().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    const current = tabs.find((tab) => tab.id === activeId)
    if (!current) return
    if (current.kind === 'model' && current.modelId) {
      const model = models.find((item) => item.model_id === current.modelId)
      if (model && model.name !== current.name) {
        setTabs((list) =>
          list.map((tab) => (tab.id === current.id ? { ...tab, name: model.name } : tab))
        )
      }
    }
  }, [models, activeId, tabs])

  const openTab = (tab: PageTab): void => {
    setTabs((current) =>
      current.some((item) => item.id === tab.id) ? current : [...current, tab]
    )
    setActiveId(tab.id)
  }

  const openDictionary = (): void =>
    openTab({ id: 'dictionary', name: '数据字典', kind: 'dictionary' })
  const openDatabase = (): void =>
    openTab({ id: 'database', name: '数据库管理', kind: 'database' })
  const openModels = (): void => openTab({ id: 'models', name: '全部模型', kind: 'models' })

  const openModel = (modelId: string): void => {
    const model = models.find((item) => item.model_id === modelId)
    if (!model) return
    setSelectedId(modelId)
    openTab({ id: modelId, name: model.name, kind: 'model', modelId })
  }

  const closeTab = (id: string): void => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id)
      const next = current.filter((tab) => tab.id !== id)
      setActiveId((active) => {
        if (active !== id) return active
        return next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null
      })
      return next
    })
    setDirty((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const requestClose = (tab: PageTab): void => {
    if (tab.kind === 'model' && dirty[tab.id]) {
      modal.confirm({
        title: '放弃未保存的修改？',
        content: `模型「${tab.name}」还有未保存的修改，关闭后将丢失。`,
        okText: '放弃并关闭',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => closeTab(tab.id)
      })
      return
    }
    closeTab(tab.id)
  }

  const selectedFolder = useMemo(() => {
    const selected = models.find((model) => model.model_id === selectedId)
    if (!selected) return '0'
    return selected.model_type === 'folder' ? selected.model_id : selected.parent_id
  }, [models, selectedId])

  const createModel = async (kind: 'model' | 'folder'): Promise<void> => {
    try {
      const created = unwrap(
        await window.api.models.create(projectId, selectedFolder || '0', kind)
      )
      await reloadModels()
      setExpanded((current) => new Set([...current, created.parent_id]))
      setSelectedId(created.model_id)
      openTab({
        id: created.model_id,
        name: created.name,
        kind: 'model',
        modelId: created.model_id
      })
      message.success(kind === 'folder' ? '已新建模型目录' : '已新建数据模型')
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const createDictionaryEntry = (): void => {
    openDictionary()
    setDictionaryToken((value) => value + 1)
  }

  const createDatabase = (): void => {
    openDatabase()
    setDatabaseToken((value) => value + 1)
  }

  const newMenu = {
    items: [
      { key: 'model', label: '新建数据模型', icon: <TableOutlined /> },
      { key: 'folder', label: '新建模型目录', icon: <FolderOpenOutlined /> },
      { key: 'dictionary', label: '新建数据字段', icon: <FileTextOutlined /> },
      { key: 'database', label: '新建数据库连接', icon: <DatabaseOutlined /> }
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'model') void createModel('model')
      if (key === 'folder') void createModel('folder')
      if (key === 'dictionary') createDictionaryEntry()
      if (key === 'database') createDatabase()
    }
  }

  const folderOptions = useMemo(
    () => [
      { value: '0', label: '根目录' },
      ...summaries
        .filter((item) => item.model_type === 'folder')
        .map((item) => ({ value: item.model_id, label: item.name }))
    ],
    [summaries]
  )

  const performMove = async (modelId: string, destParentId: string, orderedIds?: string[]): Promise<void> => {
    if (modelId === destParentId) return
    try {
      unwrap(await window.api.models.move(projectId, modelId, destParentId, orderedIds))
      await reloadModels()
      setExpanded((current) => new Set([...current, destParentId]))
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const handleDrop = async (target: DataModel | null): Promise<void> => {
    const sourceId = draggingId
    setDraggingId(null)
    if (!sourceId) return
    const source = models.find((model) => model.model_id === sourceId)
    if (!source) return
    if (!target) {
      await performMove(sourceId, '0')
      return
    }
    if (target.model_id === sourceId) return
    if (target.model_type === 'folder') {
      if (source.model_type === 'folder') {
        const siblings = summaries
          .filter((item) => item.parent_id === target.parent_id && item.model_id !== sourceId)
        const position = siblings.findIndex((item) => item.model_id === target.model_id)
        const ordered = siblings.map((item) => item.model_id)
        ordered.splice(position < 0 ? ordered.length : position, 0, sourceId)
        await performMove(sourceId, target.parent_id, ordered)
      } else {
        await performMove(sourceId, target.model_id)
      }
      return
    }
    const siblings = summaries
      .filter((item) => item.parent_id === target.parent_id && item.model_id !== sourceId)
    const position = siblings.findIndex((item) => item.model_id === target.model_id)
    const ordered = siblings.map((item) => item.model_id)
    ordered.splice(position < 0 ? ordered.length : position, 0, sourceId)
    await performMove(sourceId, target.parent_id, ordered)
  }

  const copyNode = async (model: DataModel, destParentId: string): Promise<void> => {
    try {
      unwrap(await window.api.models.copy(projectId, model.model_id, destParentId))
      await reloadModels()
      setExpanded((current) => new Set([...current, destParentId]))
      message.success('已复制')
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const deleteNode = async (model: DataModel): Promise<void> => {
    try {
      if (model.model_type === 'model') {
        const references = unwrap(await window.api.models.references(projectId, model.model_id))
        modal.confirm({
          title: `删除数据模型「${model.name}」？`,
          width: 500,
          content:
            references.length > 0 ? (
              <div>
                <p>以下接口仍引用该模型，删除后引用会保留为失效引用：</p>
                <ul style={{ paddingLeft: 18, maxHeight: 160, overflow: 'auto' }}>
                  {references.map((reference) => (
                    <li key={`${reference.target_id}-${reference.kind}`}>
                      {reference.target_name} ·{' '}
                      {reference.kind === 'request-body' ? '请求 Body' : '响应示例'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="muted">没有接口引用该模型。</p>
            ),
          okText: '删除',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: async () => {
            unwrap(await window.api.models.delete(projectId, model.model_id))
            await reloadModels()
            setTabs((current) =>
              current.filter((tab) => tab.modelId !== model.model_id)
            )
            message.success('已删除')
          }
        })
        return
      }
      modal.confirm({
        title: `删除模型目录「${model.name}」？`,
        content: '目录下的模型会一并删除，此操作不可撤销。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          unwrap(await window.api.models.delete(projectId, model.model_id))
          await reloadModels()
          message.success('已删除')
        }
      })
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const startAction = (kind: TreeAction['kind'], model: DataModel): void => {
    setTreeAction({ kind, model })
    setActionName(model.name)
    setActionParent(model.parent_id || '0')
  }

  const submitAction = async (): Promise<void> => {
    if (!treeAction) return
    const model = treeAction.model
    if (treeAction.kind === 'rename') {
      const name = actionName.trim()
      if (!name) {
        message.error('名称不能为空')
        return
      }
      try {
        unwrap(await window.api.models.save(projectId, { ...model, name, updated_by: '本地' }))
        await reloadModels()
        setTreeAction(null)
        message.success('已重命名')
      } catch (error) {
        message.error((error as Error).message)
      }
      return
    }
    if (treeAction.kind === 'copy') {
      await copyNode(model, actionParent)
      setTreeAction(null)
      return
    }
    await performMove(model.model_id, actionParent)
    setTreeAction(null)
  }

  const matchesQuery = (model: DataModel): boolean => {
    const text = query.trim().toLowerCase()
    if (!text) return true
    return (
      model.name.toLowerCase().includes(text) ||
      (model.alias ?? '').toLowerCase().includes(text)
    )
  }

  const visibleIds = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return null
    const visible = new Set<string>()
    const byId = new Map(models.map((model) => [model.model_id, model]))
    for (const model of models) {
      if (!matchesQuery(model)) continue
      let current: DataModel | undefined = model
      const seen = new Set<string>()
      while (current && !seen.has(current.model_id)) {
        seen.add(current.model_id)
        visible.add(current.model_id)
        current = current.parent_id !== '0' ? byId.get(current.parent_id) : undefined
      }
    }
    return visible
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, query])

  const rootChildren = (parentId: string): DataModel[] =>
    summaries
      .filter((summary) => summary.parent_id === parentId)
      .map((summary) => models.find((model) => model.model_id === summary.model_id))
      .filter((model): model is DataModel => Boolean(model))
      .filter((model) => !visibleIds || visibleIds.has(model.model_id))

  const renderTreeRow = (model: DataModel, depth: number): JSX.Element => {
    const children = model.model_type === 'folder' ? rootChildren(model.model_id) : []
    const isExpanded = expanded.has(model.model_id)
    return (
      <div key={model.model_id}>
        <div
          className={`schema-tree-row${selectedId === model.model_id ? ' selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable
          onDragStart={(event) => {
            setDraggingId(model.model_id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', model.model_id)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void handleDrop(model)
          }}
          onClick={() => {
            setSelectedId(model.model_id)
            openModel(model.model_id)
          }}
        >
          {model.model_type === 'folder' ? (
            <button
              className="schema-tree-toggle"
              onClick={(event) => {
                event.stopPropagation()
                setExpanded((current) => {
                  const next = new Set(current)
                  if (next.has(model.model_id)) next.delete(model.model_id)
                  else next.add(model.model_id)
                  return next
                })
              }}
            >
              {isExpanded ? <DownOutlined /> : <RightOutlined />}
            </button>
          ) : (
            <span className="schema-tree-toggle" />
          )}
          {model.model_type === 'folder' ? (
            <FolderOutlined style={{ color: '#a58a58', fontSize: 12 }} />
          ) : (
            <TableOutlined style={{ color: '#8a6b3b', fontSize: 12 }} />
          )}
          <span className="schema-tree-name" title={model.name}>
            {model.name}
          </span>
          {model.alias ? <span className="schema-tree-alias">{model.alias}</span> : null}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'open', label: '打开' },
                { key: 'rename', label: '重命名', icon: <EditOutlined /> },
                ...(model.model_type === 'model'
                  ? [{ key: 'copy', label: '复制到…', icon: <CopyOutlined /> }]
                  : []),
                { key: 'move', label: '移动到…' },
                { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true }
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation()
                if (key === 'open') openModel(model.model_id)
                if (key === 'rename') startAction('rename', model)
                if (key === 'copy') startAction('copy', model)
                if (key === 'move') startAction('move', model)
                if (key === 'delete') void deleteNode(model)
              }
            }}
          >
            <button
              className="icon-btn schema-tree-more"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreOutlined />
            </button>
          </Dropdown>
        </div>
        {model.model_type === 'folder' && isExpanded
          ? children.map((child) => renderTreeRow(child, depth + 1))
          : null}
      </div>
    )
  }

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null
  const activeModel =
    activeTab?.kind === 'model' && activeTab.modelId
      ? models.find((model) => model.model_id === activeTab.modelId)
      : null

  const setTabDirty = (tabId: string, value: boolean): void => {
    setDirty((current) => (current[tabId] === value ? current : { ...current, [tabId]: value }))
  }

  const renderEmpty = (): JSX.Element => (
    <div className="schemas-empty">
      <div className="schemas-empty-title">数据字典与模型</div>
      <div className="schemas-empty-sub">
        集中维护字段描述、数据模型与数据库连接，并让接口直接引用模型。
      </div>
      <div className="schemas-card-grid">
        <button className="schemas-card" onClick={openDictionary}>
          <span className="schemas-card-icon" style={{ background: '#f3ead8', color: '#8a6b3b' }}>
            <FileTextOutlined />
          </span>
          <span className="schemas-card-title">数据字典管理</span>
          <span className="schemas-card-desc">维护自定义与系统内置字段描述，支持参数联想。</span>
        </button>
        <button className="schemas-card" onClick={() => void createModel('model')}>
          <span className="schemas-card-icon" style={{ background: 'rgba(9,123,237,.09)', color: '#097bed' }}>
            <TableOutlined />
          </span>
          <span className="schemas-card-title">新建数据模型</span>
          <span className="schemas-card-desc">用可视化字段树或 Raw JSON Schema 定义数据结构。</span>
        </button>
        <button className="schemas-card" onClick={openDatabase}>
          <span className="schemas-card-icon" style={{ background: 'rgba(38,206,164,.12)', color: '#1f9e7c' }}>
            <DatabaseOutlined />
          </span>
          <span className="schemas-card-title">数据库管理</span>
          <span className="schemas-card-desc">配置 MySQL 连接，读取表结构并导入为数据模型。</span>
        </button>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spin tip="正在加载字典模块…" />
      </div>
    )
  }

  return (
    <div className="page schemas-page">
      <aside className="schemas-side">
        <div className="schemas-search">
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#a2967f' }} />}
            placeholder="模型名/目录"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            size="small"
          />
          <Dropdown menu={newMenu} trigger={['click']}>
            <button className="tree-plus">
              <PlusOutlined />
            </button>
          </Dropdown>
        </div>

        <div className="schemas-side-scroll">
          <div
            className={`schema-nav-row${activeId === 'dictionary' ? ' active' : ''}`}
            onClick={openDictionary}
          >
            <FileTextOutlined /> 数据字典
          </div>
          <div
            className={`schema-nav-row${activeId === 'database' ? ' active' : ''}`}
            onClick={openDatabase}
          >
            <DatabaseOutlined /> 数据库管理
          </div>

          <div className="schema-section-head">
            <span>数据模型</span>
            <span style={{ flex: 1 }} />
            <Tooltip title="刷新">
              <button className="icon-btn" onClick={() => void reloadModels()}>
                <ReloadOutlined />
              </button>
            </Tooltip>
          </div>

          <div
            className={`schema-nav-row${activeId === 'models' ? ' active' : ''}`}
            onClick={openModels}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void handleDrop(null)
            }}
          >
            <FolderOpenOutlined /> 全部模型
            <span style={{ flex: 1 }} />
            <span className="muted">{summaries.filter((item) => item.model_type === 'model').length}</span>
          </div>

          <div className="schema-tree">
            {rootChildren('0').map((model) => renderTreeRow(model, 0))}
            {summaries.filter((item) => item.model_type === 'model').length === 0 ? (
              <div className="schema-tree-empty">暂未创建模型</div>
            ) : null}
          </div>
        </div>

        <Dropdown menu={newMenu} trigger={['click']} placement="topLeft">
          <button className="schemas-new">
            <PlusOutlined /> 新建
          </button>
        </Dropdown>
      </aside>

      <section className="schemas-main">
        <div className="tabbar">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`filetab${tab.id === activeId ? ' active' : ''}`}
              onClick={() => setActiveId(tab.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setActiveId(tab.id)
              }}
            >
              {dirty[tab.id] ? <span className="red-dot" /> : null}
              {tab.kind === 'model' ? (
                <TableOutlined style={{ fontSize: 11, color: '#8a6b3b' }} />
              ) : tab.kind === 'dictionary' ? (
                <FileTextOutlined style={{ fontSize: 11, color: '#8a6b3b' }} />
              ) : tab.kind === 'database' ? (
                <DatabaseOutlined style={{ fontSize: 11, color: '#1f9e7c' }} />
              ) : (
                <FolderOpenOutlined style={{ fontSize: 11, color: '#a58a58' }} />
              )}
              <span className="tab-name">{tab.name}</span>
              <span
                className="tab-x"
                role="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation()
                  requestClose(tab)
                }}
              >
                <CloseOutlined style={{ fontSize: 10 }} />
              </span>
            </div>
          ))}
          <Dropdown menu={newMenu} trigger={['click']}>
            <button className="tab-add">
              <PlusOutlined style={{ fontSize: 13 }} />
            </button>
          </Dropdown>
          <span style={{ flex: 1 }} />
        </div>

        <div className="schemas-content">
          {!activeTab ? renderEmpty() : null}
          {activeTab?.kind === 'dictionary' ? (
            <DictionaryPanel projectId={projectId} actionToken={dictionaryToken} />
          ) : null}
          {activeTab?.kind === 'database' ? (
            <DatabasePanel
              projectId={projectId}
              actionToken={databaseToken}
              onModelsChanged={() => void reloadModels()}
            />
          ) : null}
          {activeTab?.kind === 'models' ? (
            <ModelsListPanel
              projectId={projectId}
              models={models}
              summaries={summaries}
              onOpen={openModel}
            />
          ) : null}
          {tabs
            .filter((tab) => tab.kind === 'model')
            .map((tab) => {
              const tabModel = models.find((model) => model.model_id === tab.modelId)
              if (!tabModel) return null
              return (
                <div
                  key={tab.id}
                  className="schemas-editor-slot"
                  style={{ display: tab.id === activeId ? 'flex' : 'none' }}
                >
                  <ModelEditor
                    projectId={projectId}
                    model={tabModel}
                    models={summaries}
                    onSaved={() => void reloadModels()}
                    onDeleted={(modelId) => {
                      setTabs((current) => current.filter((item) => item.modelId !== modelId))
                      setActiveId((current) => (current === modelId ? null : current))
                      void reloadModels()
                    }}
                    onDirtyChange={(value) => setTabDirty(tabModel.model_id, value)}
                  />
                </div>
              )
            })}
          {activeTab?.kind === 'model' && !activeModel ? (
            <div style={{ padding: 30 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="模型已删除或不存在"
              />
              <div style={{ textAlign: 'center' }}>
                <Button onClick={() => closeTab(activeTab.id)}>关闭标签</Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <Modal
        open={Boolean(treeAction)}
        title={
          treeAction?.kind === 'rename'
            ? '重命名'
            : treeAction?.kind === 'copy'
              ? '复制到目录'
              : '移动到目录'
        }
        onCancel={() => setTreeAction(null)}
        onOk={() => void submitAction()}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
      >
        {treeAction?.kind === 'rename' ? (
          <Input
            autoFocus
            value={actionName}
            onChange={(event) => setActionName(event.target.value)}
            onPressEnter={() => void submitAction()}
          />
        ) : (
          <Select
            style={{ width: '100%' }}
            value={actionParent}
            onChange={setActionParent}
            options={folderOptions.filter((option) => option.value !== treeAction?.model.model_id)}
          />
        )}
      </Modal>
    </div>
  )
}
