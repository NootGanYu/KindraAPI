import { useMemo, useState } from 'react'
import { App as AntApp, Button, Dropdown, Input, Modal, Popover, Tooltip, Tree } from 'antd'
import type { DataNode } from 'antd/es/tree'
import type { MenuProps } from 'antd'
import {
  ApiOutlined,
  ArrowsAltOutlined,
  CloudServerOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  DesktopOutlined,
  DownOutlined,
  DragOutlined,
  EditOutlined,
  FileMarkdownOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  ImportOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShareAltOutlined,
  ShrinkOutlined,
  SnippetsOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  SwapOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import type { TargetSummary, TargetTransferMode } from '@shared/types'
import { methodColor, methodLabel } from '@shared/httpMethods'
import { useApp } from '../store'
import { useRefreshFeedback } from '../useRefreshFeedback'
import ApiDescriptionDialog from './ApiDescriptionDialog'

interface Props {
  onCreate: (parentId: string, type: 'folder' | 'api') => Promise<void>
  onDelete: (id: string) => Promise<void>
  onShare: (item: TargetSummary) => void
  onTransfer: (item: TargetSummary, mode: TargetTransferMode) => void
}

interface TreeNode extends DataNode {
  item?: TargetSummary
}

type Filter = 'all' | 'api' | 'folder'

interface NewEntry {
  key: string
  label: string
  color: string
  icon: React.ReactNode
  beta?: boolean
  wide?: boolean
}

const NEW_ENTRIES: NewEntry[] = [
  { key: 'http', label: 'HTTP', color: '#ff6b6b', icon: <ApiOutlined /> },
  { key: 'event-stream', label: 'Event Stream Request', color: '#5f80e9', icon: <ThunderboltOutlined /> },
  { key: 'websocket', label: 'WebSocket', color: '#ffb400', icon: <SwapOutlined /> },
  { key: 'socketio', label: 'Socket.IO', color: '#26cea4', icon: <LinkOutlined /> },
  { key: 'grpc', label: 'gRPC', color: '#fa8c16', icon: <CloudServerOutlined /> },
  { key: 'graphql', label: 'GraphQL', color: '#e2578d', icon: <DeploymentUnitOutlined /> },
  { key: 'tcp', label: 'TCP 客户端', color: '#5bbfd4', icon: <DesktopOutlined /> },
  { key: 'markdown', label: 'Markdown', color: '#4971a6', icon: <FileMarkdownOutlined /> },
  { key: 'folder', label: '目录', color: '#b083f0', icon: <FolderOutlined />, wide: true }
]

const CARD_ENTRIES: NewEntry[] = NEW_ENTRIES.map((entry) => ({
  ...entry,
  beta: entry.key === 'grpc' || entry.key === 'graphql'
}))

const IMPORT_ENTRIES: NewEntry[] = [
  { key: 'curl', label: 'cURL 导入', color: '#8e8069', icon: <CodeOutlined /> },
  { key: 'paste', label: '粘贴接口/文本', color: '#8e8069', icon: <SnippetsOutlined /> },
  { key: 'file', label: '其他文件导入', color: '#8e8069', icon: <ImportOutlined />, wide: true }
]

function buildTree(items: TargetSummary[], ascending: boolean): TreeNode[] {
  const childrenMap = new Map<string, TargetSummary[]>()
  for (const item of items) {
    const list = childrenMap.get(item.parent_id) ?? []
    list.push(item)
    childrenMap.set(item.parent_id, list)
  }
  for (const list of childrenMap.values()) {
    list.sort((a, b) => (ascending ? a.sort - b.sort : b.sort - a.sort))
  }

  const build = (parentId: string): TreeNode[] =>
    (childrenMap.get(parentId) ?? []).map((item) => ({
      key: item.target_id,
      item,
      children: item.target_type === 'folder' ? build(item.target_id) : undefined
    }))

  return build('0')
}

export default function ApiTree({ onCreate, onDelete, onShare, onTransfer }: Props): JSX.Element {
  const { modal, message } = AntApp.useApp()
  const targets = useApp((s) => s.targets)
  const activeId = useApp((s) => s.activeId)
  const openTarget = useApp((s) => s.openTarget)
  const reloadTargets = useApp((s) => s.reloadTargets)
  const renameTarget = useApp((s) => s.renameTarget)
  const describeTarget = useApp((s) => s.describeTarget)
  const reorderTargets = useApp((s) => s.reorderTargets)
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [ascending, setAscending] = useState(true)
  const { refreshing, run: runRefreshFeedback } = useRefreshFeedback()

  const refreshTree = (): void => {
    void runRefreshFeedback(() => reloadTargets())
  }
  const [expanded, setExpanded] = useState<React.Key[] | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [renaming, setRenaming] = useState<TargetSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [describing, setDescribing] = useState<TargetSummary | null>(null)

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    let list = targets
    if (filter === 'api') list = list.filter((item) => item.target_type === 'api')
    if (filter === 'folder') list = list.filter((item) => item.target_type === 'folder')
    if (!kw) return list
    const keep = new Set<string>()
    const byId = new Map(list.map((item) => [item.target_id, item]))
    for (const item of list) {
      if (
        item.name.toLowerCase().includes(kw) ||
        (item.url ?? '').toLowerCase().includes(kw) ||
        (item.method ?? '').toLowerCase().includes(kw)
      ) {
        keep.add(item.target_id)
        let parent = byId.get(item.parent_id)
        while (parent) {
          keep.add(parent.target_id)
          parent = byId.get(parent.parent_id)
        }
      }
    }
    return list.filter((item) => keep.has(item.target_id))
  }, [targets, keyword, filter])

  const treeData = useMemo(() => buildTree(filtered, ascending), [filtered, ascending])

  const selectedItem = targets.find((item) => item.target_id === activeId)
  const preferredParent =
    selectedItem?.target_type === 'folder' ? selectedItem.target_id : selectedItem?.parent_id ?? '0'

  const allFolderKeys = useMemo(() => collectFolderKeys(treeData), [treeData])
  const allCollapsed = expanded !== null && expanded.length === 0
  const expandedKeys = keyword ? allFolderKeys : expanded === null ? allFolderKeys : expanded

  const handleCreate = async (parentId: string, type: 'folder' | 'api'): Promise<void> => {
    await onCreate(parentId, type)
    if (parentId !== '0' && expanded !== null) {
      setExpanded((keys) => [...new Set([...(keys ?? []), parentId])])
    }
  }

  const handleNewEntry = async (entry: NewEntry, parentId: string): Promise<void> => {
    if (entry.key === 'http') {
      await handleCreate(parentId, 'api')
      return
    }
    if (entry.key === 'folder') {
      await handleCreate(parentId, 'folder')
      return
    }
    message.info(`${entry.label} 将在后续里程碑支持`)
  }

  const handleCardEntry = async (entry: NewEntry): Promise<void> => {
    setNewOpen(false)
    await handleNewEntry(entry, preferredParent)
  }

  const newMenuItems = (parentId: string): MenuProps['items'] =>
    NEW_ENTRIES.map((entry) => ({
      key: entry.key,
      label: entry.label,
      icon: (
        <span className="menu-icon" style={{ background: entry.color }}>
          {entry.icon}
        </span>
      ),
      onClick: () => void handleNewEntry(entry, parentId)
    }))

  const handleDelete = (item: TargetSummary): void => {
    modal.confirm({
      title: '删除确认',
      content: `确定删除「${item.name}」${
        item.target_type === 'folder' ? '及其下所有内容' : ''
      }？此操作不可撤销。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => onDelete(item.target_id)
    })
  }

  const openRename = (item: TargetSummary): void => {
    setRenaming(item)
    setRenameValue(item.name)
  }

  const submitRename = async (): Promise<void> => {
    if (!renaming) return
    const name = renameValue.trim()
    if (!name) {
      message.warning('名称不能为空')
      return
    }
    try {
      await renameTarget(renaming.target_id, name)
      setRenaming(null)
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const toggleCollapse = (): void => {
    setExpanded(allCollapsed ? null : [])
  }

  const moveNode = async (
    dragId: string,
    dropId: string,
    toGap: boolean,
    relative: number
  ): Promise<void> => {
    if (dragId === dropId) return
    const byId = new Map(targets.map((item) => [item.target_id, item]))
    const drag = byId.get(dragId)
    const drop = byId.get(dropId)
    if (!drag || !drop) return

    const isInside = (nodeId: string, ancestorId: string): boolean => {
      let current = byId.get(nodeId)
      while (current) {
        if (current.parent_id === ancestorId) return true
        current = byId.get(current.parent_id)
      }
      return false
    }

    let parentId: string
    let insertAt: number
    if (!toGap && drop.target_type === 'folder') {
      if (isInside(drop.target_id, dragId)) return
      parentId = drop.target_id
      insertAt = targets.filter((item) => item.parent_id === parentId).length
    } else {
      parentId = drop.parent_id
      if (parentId === dragId || isInside(parentId, dragId)) return
      const siblings = targets
        .filter((item) => item.parent_id === parentId && item.target_id !== dragId)
        .sort((a, b) => (ascending ? a.sort - b.sort : b.sort - a.sort))
      const index = siblings.findIndex((item) => item.target_id === dropId)
      if (index < 0) return
      insertAt = toGap ? index + (relative > 0 ? 1 : 0) : index
    }

    const display = targets
      .filter((item) => item.parent_id === parentId && item.target_id !== dragId)
      .sort((a, b) => (ascending ? a.sort - b.sort : b.sort - a.sort))
    display.splice(insertAt, 0, drag)
    const orderedIds = display.map((item) => item.target_id)
    if (!ascending) orderedIds.reverse()
    try {
      await reorderTargets(parentId, orderedIds)
    } catch (error) {
      message.error((error as Error).message)
    }
  }

  const rowMenu = (item: TargetSummary): MenuProps['items'] => {
    if (item.target_type === 'folder') {
      return [
        {
          key: 'new',
          label: '新建',
          icon: <FolderAddOutlined />,
          children: newMenuItems(item.target_id)
        },
        {
          key: 'paste',
          label: '粘贴接口/文本',
          icon: <SnippetsOutlined />,
          onClick: () => message.info('粘贴接口/文本将在后续里程碑支持')
        },
        { type: 'divider' as const },
        {
          key: 'share',
          label: '分享',
          icon: <ShareAltOutlined />,
          onClick: () => onShare(item)
        },
        { type: 'divider' as const },
        {
          key: 'move',
          label: '移动到项目…',
          icon: <DragOutlined />,
          onClick: () => onTransfer(item, 'move')
        },
        {
          key: 'copy',
          label: '复制到项目…',
          icon: <CopyOutlined />,
          onClick: () => onTransfer(item, 'copy')
        },
        { key: 'edit', label: '编辑', icon: <EditOutlined />, onClick: () => openRename(item) },
        {
          key: 'describe',
          label: '编辑说明',
          icon: <FileMarkdownOutlined />,
          onClick: () => setDescribing(item)
        },
        { type: 'divider' as const },
        { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => handleDelete(item) }
      ]
    }
    return [
      {
        key: 'share',
        label: '分享',
        icon: <ShareAltOutlined />,
        onClick: () => onShare(item)
      },
      { type: 'divider' as const },
      {
        key: 'move',
        label: '移动到项目…',
        icon: <DragOutlined />,
        onClick: () => onTransfer(item, 'move')
      },
      {
        key: 'copy',
        label: '复制到项目…',
        icon: <CopyOutlined />,
        onClick: () => onTransfer(item, 'copy')
      },
      { key: 'edit', label: '编辑', icon: <EditOutlined />, onClick: () => openRename(item) },
      { type: 'divider' as const },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => handleDelete(item) }
    ]
  }

  const titleRender = (node: TreeNode): React.ReactNode => {
    const item = node.item
    if (!item) return null
    return (
      <div className="tree-node" onDoubleClick={() => openRename(item)}>
        {item.target_type === 'folder' ? (
          <FolderOutlined style={{ color: '#a58a58', fontSize: 14 }} />
        ) : (
          <span className="method-text" style={{ color: methodColor(item.method) }}>{methodLabel(item.method, true)}</span>
        )}
        <span className="tree-node-name" title={item.name}>{item.name}</span>
        <span className="tree-node-actions">
          {item.target_type === 'folder' ? (
            <Dropdown menu={{ items: newMenuItems(item.target_id) }} trigger={['click']}>
              <Button
                size="small"
                type="text"
                icon={<PlusOutlined />}
                onClick={(event) => event.stopPropagation()}
              />
            </Dropdown>
          ) : null}
          <Dropdown menu={{ items: rowMenu(item) }} trigger={['click']}>
            <Button
              size="small"
              type="text"
              icon={<MoreOutlined />}
              onClick={(event) => event.stopPropagation()}
            />
          </Dropdown>
        </span>
      </div>
    )
  }

  const filterLabel = filter === 'all' ? '全部' : filter === 'api' ? '仅接口' : '仅目录'

  const newMenuCard = (
    <div className="new-menu-card">
      <div className="new-menu-section">新建</div>
      <div className="new-menu-grid">
        {CARD_ENTRIES.map((entry) => (
          <button
            key={entry.key}
            className={`new-menu-item${entry.wide ? ' wide' : ''}`}
            onClick={() => void handleCardEntry(entry)}
          >
            <span className="new-menu-icon" style={{ background: entry.color }}>
              {entry.icon}
            </span>
            <span>{entry.label}</span>
            {entry.beta ? <span className="new-menu-beta">Beta</span> : null}
          </button>
        ))}
      </div>
      <div className="new-menu-section">导入</div>
      <div className="new-menu-grid">
        {IMPORT_ENTRIES.map((entry) => (
          <button
            key={entry.key}
            className={`new-menu-item${entry.wide ? ' wide' : ''}`}
            onClick={() => void handleCardEntry(entry)}
          >
            <span className="new-menu-icon" style={{ background: entry.color }}>
              {entry.icon}
            </span>
            <span>{entry.label}</span>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="tree-panel">
      <div className="tree-search-row">
        <div className="tree-search">
          <SearchOutlined style={{ fontSize: 14, flex: 'none' }} />
          <Input
            variant="borderless"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="关键字/URL"
          />
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'all', label: '全部' },
                { key: 'api', label: '仅接口' },
                { key: 'folder', label: '仅目录' }
              ],
              onClick: ({ key }) => setFilter(key as Filter)
            }}
          >
            <span className="tree-search-filter">
              {filterLabel} <DownOutlined style={{ fontSize: 9 }} />
            </span>
          </Dropdown>
        </div>
        <Popover
          content={newMenuCard}
          trigger="click"
          placement="bottomLeft"
          arrow={false}
          open={newOpen}
          onOpenChange={setNewOpen}
          rootClassName="new-menu-popover"
        >
          <button className="tree-plus" title="新建">
            <PlusOutlined style={{ fontSize: 14 }} />
          </button>
        </Popover>
      </div>

      <div className="tree-all">
        <FolderOpenOutlined style={{ fontSize: 14 }} />
        <span>全部接口</span>
        <span style={{ flex: 1 }} />
        <Tooltip title="刷新">
          <button
            className={`mini${refreshing ? ' is-refreshing' : ''}`}
            aria-label="刷新接口树"
            aria-busy={refreshing}
            disabled={refreshing}
            onClick={refreshTree}
          >
            <ReloadOutlined style={{ fontSize: 13 }} />
          </button>
        </Tooltip>
        <Tooltip title={ascending ? '倒序排列' : '正序排列'}>
          <button className="mini" onClick={() => setAscending((value) => !value)}>
            {ascending ? (
              <SortAscendingOutlined style={{ fontSize: 13 }} />
            ) : (
              <SortDescendingOutlined style={{ fontSize: 13 }} />
            )}
          </button>
        </Tooltip>
        <Tooltip title={allCollapsed ? '展开全部' : '折叠全部'}>
          <button className="mini" onClick={toggleCollapse}>
            {allCollapsed ? (
              <ArrowsAltOutlined style={{ fontSize: 13 }} />
            ) : (
              <ShrinkOutlined style={{ fontSize: 13 }} />
            )}
          </button>
        </Tooltip>
      </div>

      <div className="tree-scroll">
        {treeData.length === 0 ? (
          <div className="muted" style={{ padding: 12, fontSize: 12 }}>
            暂无接口，点击上方按钮新建。
          </div>
        ) : (
          <Tree
            blockNode
            showIcon={false}
            draggable
            treeData={treeData}
            titleRender={titleRender as (node: DataNode) => React.ReactNode}
            selectedKeys={activeId ? [activeId] : []}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpanded(keys)}
            onDrop={(info) => {
              const dropPos = info.node.pos.split('-')
              const relative = info.dropPosition - Number(dropPos[dropPos.length - 1])
              void moveNode(
                String(info.dragNode.key),
                String(info.node.key),
                info.dropToGap,
                relative
              )
            }}
            onSelect={(keys) => {
              const id = String(keys[0] ?? '')
              if (id) void openTarget(id)
            }}
          />
        )}
      </div>

      <ApiDescriptionDialog
        open={describing !== null}
        value={describing?.description ?? ''}
        onClose={() => setDescribing(null)}
        onCommit={(html) => {
          if (!describing) return
          const id = describing.target_id
          setDescribing(null)
          void describeTarget(id, html).catch((error: Error) => message.error(error.message))
        }}
      />

      <Modal
        title="编辑"
        open={renaming !== null}
        okText="确定"
        cancelText="取消"
        onOk={() => void submitRename()}
        onCancel={() => setRenaming(null)}
        destroyOnClose
      >
        <Input
          autoFocus
          value={renameValue}
          placeholder="名称"
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void submitRename()}
        />
      </Modal>
    </div>
  )
}

function collectFolderKeys(nodes: TreeNode[]): React.Key[] {
  const keys: React.Key[] = []
  const walk = (list: TreeNode[]): void => {
    for (const node of list) {
      if (node.children && node.children.length > 0) {
        keys.push(node.key)
        walk(node.children as TreeNode[])
      }
    }
  }
  walk(nodes)
  return keys
}
