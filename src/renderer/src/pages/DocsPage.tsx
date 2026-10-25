import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
  Tooltip,
  Tree,
  TreeSelect
} from 'antd'
import type { DataNode } from 'antd/es/tree'
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined
} from '@ant-design/icons'
import type {
  DocScope,
  DocServiceStatus,
  DocSettings,
  DocShareInput,
  DocShareSummary,
  TargetSummary
} from '@shared/types'
import { createDocSettings } from '@shared/factories'
import { useApp } from '../store'

const FILTERS = [
  '全部',
  '自定义',
  '目录',
  'HTTP',
  'SSE',
  'MD',
  'gRPC',
  'TCP',
  'Websocket',
  'Socket.IO',
  'GraphQL'
] as const

type Filter = (typeof FILTERS)[number]
type ExpireMode = 'permanent' | '7' | '30' | 'custom'

interface EditorState {
  open: boolean
  shareId?: string
  saving: boolean
  name: string
  scope: DocScope
  targetIds: string[]
  passwordEnabled: boolean
  password: string
  expireMode: ExpireMode
  customDays: number
  showRequest: boolean
  showBody: boolean
  showResponse: boolean
  showHeaders: boolean
  showScripts: boolean
  openapi: boolean
}

interface DocTreeNode {
  key: string
  title: string
  targetType: 'folder' | 'api'
  method?: string
  children: DocTreeNode[]
}

interface LinkState {
  shareId: string
  name: string
  openapi: boolean
}

function defaultEditor(): EditorState {
  return {
    open: false,
    saving: false,
    name: '',
    scope: 'project',
    targetIds: [],
    passwordEnabled: false,
    password: '',
    expireMode: 'permanent',
    customDays: 7,
    showRequest: true,
    showBody: true,
    showResponse: true,
    showHeaders: true,
    showScripts: false,
    openapi: false
  }
}

function buildTree(targets: TargetSummary[]): DocTreeNode[] {
  const byParent = new Map<string, TargetSummary[]>()
  for (const target of targets) {
    const list = byParent.get(target.parent_id) ?? []
    list.push(target)
    byParent.set(target.parent_id, list)
  }
  const walk = (parentId: string): DocTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hans-CN'))
      .map((target) => ({
        key: target.target_id,
        title: target.name,
        targetType: target.target_type,
        method: target.method,
        children: target.target_type === 'folder' ? walk(target.target_id) : []
      }))
  return walk('0')
}

interface SelectNode {
  value: string
  title: string
  disabled?: boolean
  children?: SelectNode[]
}

function toSelectData(nodes: DocTreeNode[], selectable: 'folder' | 'api'): SelectNode[] {
  return nodes.map((node) => ({
    value: node.key,
    title: node.title,
    disabled: node.targetType !== selectable,
    children: node.children.length ? toSelectData(node.children, selectable) : undefined
  }))
}

function toCheckData(nodes: DocTreeNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.key,
    title: node.title,
    children: node.children.length ? toCheckData(node.children) : undefined
  }))
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function expireModeOf(days: number): ExpireMode {
  if (days === -1) return 'permanent'
  if (days === 7) return '7'
  if (days === 30) return '30'
  return 'custom'
}

function expireDaysOf(editor: EditorState): number {
  if (editor.expireMode === 'permanent') return -1
  if (editor.expireMode === '7') return 7
  if (editor.expireMode === '30') return 30
  return Math.max(1, Math.min(3650, Math.round(editor.customDays || 1)))
}

export default function DocsPage(): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const project = useApp((s) => s.project)
  const targets = useApp((s) => s.targets)

  const [shares, setShares] = useState<DocShareSummary[]>([])
  const [status, setStatus] = useState<DocServiceStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('全部')
  const [selected, setSelected] = useState<string[]>([])
  const [editor, setEditor] = useState<EditorState>(defaultEditor)
  const [link, setLink] = useState<LinkState | null>(null)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [serviceForm, setServiceForm] = useState({ enabled: true, port: 30999 })
  const [serviceSaving, setServiceSaving] = useState(false)

  const tree = useMemo(() => buildTree(targets), [targets])
  const apiCount = useMemo(
    () => targets.filter((target) => target.target_type === 'api').length,
    [targets]
  )

  const reload = useCallback(async (): Promise<void> => {
    if (!project) return
    setLoading(true)
    try {
      const [listResult, statusResult] = await Promise.all([
        window.api.docs.list(project.project_id),
        window.api.docs.serviceStatus()
      ])
      if (listResult.ok) {
        setShares(listResult.data)
        setSelected((current) =>
          current.filter((id) => listResult.data.some((item) => item.share_id === id))
        )
      } else {
        message.error(listResult.error)
      }
      if (statusResult.ok) setStatus(statusResult.data)
    } finally {
      setLoading(false)
    }
  }, [project, message])

  useEffect(() => {
    setSelected([])
    setLink(null)
    setEditor(defaultEditor())
    if (project) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.project_id])

  useEffect(() => {
    if (status) setServiceForm({ enabled: status.enabled, port: status.port })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.port, status?.enabled])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return shares.filter((share) => {
      if (keyword && !share.name.toLowerCase().includes(keyword)) return false
      if (filter === '全部') return true
      if (filter === '自定义') return share.scope === 'custom'
      if (filter === '目录') return share.scope === 'folder'
      return share.type_label === filter
    })
  }, [shares, query, filter])

  const shareUrl = (shareId: string): string =>
    status ? `${status.base_url}/share/${shareId}` : ''

  const copyUrl = async (shareId: string): Promise<void> => {
    const url = shareUrl(shareId)
    if (!url) {
      message.warning('分享服务尚未初始化')
      return
    }
    const result = await window.api.app.copyText(url)
    if (result.ok) message.success('链接已复制')
    else message.error(result.error)
  }

  const openUrl = async (url: string): Promise<void> => {
    if (!url) return
    if (!status?.running) {
      message.warning('分享服务未启动，请先在「分享服务」中启用')
      return
    }
    const result = await window.api.app.openExternal(url)
    if (!result.ok) message.error(result.error)
  }

  const openCreate = (): void => {
    const fallbackName = project ? `${project.name} 接口文档` : '接口文档'
    setEditor({ ...defaultEditor(), open: true, name: fallbackName })
  }

  const openEdit = async (shareId: string): Promise<void> => {
    if (!project) return
    const result = await window.api.docs.get(project.project_id, shareId)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    const share = result.data
    if (!share) {
      message.error('分享不存在')
      return
    }
    const settings = createDocSettings(share.settings)
    setEditor({
      open: true,
      shareId: share.share_id,
      saving: false,
      name: share.name,
      scope: share.scope,
      targetIds: share.target_ids,
      passwordEnabled: Boolean(settings.password),
      password: settings.password,
      expireMode: expireModeOf(settings.expire_days),
      customDays: settings.expire_days > 0 ? settings.expire_days : 7,
      showRequest: settings.show_request,
      showBody: settings.show_body,
      showResponse: settings.show_response,
      showHeaders: settings.show_headers,
      showScripts: settings.show_scripts,
      openapi: settings.openapi
    })
  }

  const patchEditor = (patch: Partial<EditorState>): void => {
    setEditor((current) => ({ ...current, ...patch }))
  }

  const changeScope = (scope: DocScope): void => {
    const fallbackName =
      scope === 'folder' || scope === 'api'
        ? editor.name
        : project
          ? `${project.name} 接口文档`
          : editor.name
    patchEditor({ scope, targetIds: [], name: editor.name.trim() ? editor.name : fallbackName })
  }

  const saveShare = async (): Promise<void> => {
    if (!project) return
    const name = editor.name.trim()
    if (!name) {
      message.warning('请输入分享名称')
      return
    }
    if (editor.scope !== 'project' && editor.targetIds.length === 0) {
      message.warning(editor.scope === 'folder' ? '请选择要分享的目录' : '请选择要分享的接口')
      return
    }
    if (editor.passwordEnabled && !editor.password) {
      message.warning('请输入访问密码')
      return
    }

    const settings: DocSettings = {
      password: editor.passwordEnabled ? editor.password : '',
      expire_days: expireDaysOf(editor),
      show_request: editor.showRequest,
      show_body: editor.showBody,
      show_response: editor.showResponse,
      show_headers: editor.showHeaders,
      show_scripts: editor.showScripts,
      openapi: editor.openapi
    }
    const input: DocShareInput = {
      name,
      scope: editor.scope,
      target_ids: editor.scope === 'project' ? [] : editor.targetIds,
      settings
    }

    patchEditor({ saving: true })
    try {
      const result = editor.shareId
        ? await window.api.docs.update(project.project_id, editor.shareId, input)
        : await window.api.docs.create(project.project_id, input)
      if (!result.ok) {
        message.error(result.error)
        return
      }
      setEditor(defaultEditor())
      setLink({
        shareId: result.data.share_id,
        name: result.data.name,
        openapi: result.data.settings.openapi
      })
      await reload()
      message.success(editor.shareId ? '分享已更新' : '分享已创建')
    } finally {
      setEditor((current) => ({ ...current, saving: false }))
    }
  }

  const deleteShares = (ids: string[]): void => {
    if (!project || ids.length === 0) return
    modal.confirm({
      title: ids.length === 1 ? '删除该分享？' : `删除选中的 ${ids.length} 个分享？`,
      content: '删除后分享链接将立即失效，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.api.docs.remove(project.project_id, ids)
        if (!result.ok) {
          message.error(result.error)
          return
        }
        setSelected([])
        await reload()
        message.success('已删除')
      }
    })
  }

  const saveService = async (): Promise<void> => {
    setServiceSaving(true)
    try {
      const result = await window.api.docs.saveService(serviceForm)
      if (!result.ok) {
        message.error(result.error)
        return
      }
      setStatus(result.data)
      if (result.data.error) message.error(result.data.error)
      else message.success(result.data.running ? '分享服务已启动' : '分享服务已关闭')
      if (!result.data.error) setServiceOpen(false)
    } finally {
      setServiceSaving(false)
    }
  }

  const selectedAllVisible = filtered.length > 0 && filtered.every((s) => selected.includes(s.share_id))

  const toggleAll = (checked: boolean): void => {
    if (checked) setSelected(filtered.map((item) => item.share_id))
    else setSelected([])
  }

  return (
    <div className="docs-page">
      <div className="docs-head">
        <Input
          className="docs-search"
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--muted-2)' }} />}
          placeholder="请输入名称"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span style={{ flex: 1 }} />
        <Tooltip
          title={
            status?.error
              ? status.error
              : status
                ? `${status.base_url}${status.running ? '' : '（未启动）'}`
                : '分享服务状态未知'
          }
        >
          <button
            className={`docs-service${status?.running ? ' on' : ''}`}
            onClick={() => setServiceOpen(true)}
          >
            <span className="dot" />
            分享服务
            {status?.running ? ` :${status.port}` : status?.error ? ' 异常' : ' 未启动'}
            <SettingOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          className="docs-new"
          onClick={openCreate}
        >
          新建分享
        </Button>
      </div>

      <div className="docs-filter-row">
        <div className="docs-filters">
          {FILTERS.map((item) => (
            <button
              key={item}
              className={`docs-filter${filter === item ? ' active' : ''}`}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {selected.length > 0 ? (
          <div className="docs-bulk">
            <span>已选 {selected.length} 项</span>
            <button className="docs-bulk-del" onClick={() => deleteShares(selected)}>
              删除
            </button>
            <button className="docs-bulk-clear" onClick={() => setSelected([])}>
              取消
            </button>
          </div>
        ) : (
          <label className="docs-select-all">
            <Checkbox
              checked={selectedAllVisible}
              indeterminate={selected.length > 0 && !selectedAllVisible}
              onChange={(event) => toggleAll(event.target.checked)}
              disabled={filtered.length === 0}
            />
            全选
          </label>
        )}
        <Tooltip title="刷新">
          <button className="icon-btn" onClick={() => void reload()}>
            <ReloadOutlined style={{ fontSize: 13 }} />
          </button>
        </Tooltip>
      </div>

      <div className="docs-list">
        {loading && shares.length === 0 ? (
          <div className="docs-empty">正在加载…</div>
        ) : filtered.length === 0 ? (
          <div className="docs-empty">
            <svg width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden>
              <path
                d="M22 13.5h28l12 12V70a2.5 2.5 0 0 1-2.5 2.5h-37A2.5 2.5 0 0 1 20 70V16a2.5 2.5 0 0 1 2-2.45Z"
                stroke="#d9d1c3"
                strokeWidth="1.4"
              />
              <path d="M50 13.5V26h12" stroke="#d9d1c3" strokeWidth="1.4" />
              <path d="M30 37h24M30 46h24M30 55h16" stroke="#e3ddd2" strokeWidth="1.6" />
            </svg>
            <span>暂无数据</span>
          </div>
        ) : (
          filtered.map((share) => (
            <div
              key={share.share_id}
              className={`docs-row${selected.includes(share.share_id) ? ' selected' : ''}`}
            >
              <Checkbox
                checked={selected.includes(share.share_id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...new Set([...current, share.share_id])]
                      : current.filter((id) => id !== share.share_id)
                  )
                }
              />
              <span className="docs-kind">
                <FileTextOutlined />
              </span>
              <span className={`docs-vis ${share.visibility}`}>
                {share.visibility === 'password' ? '密码' : '公开'}
              </span>
              <span className="docs-type">{share.type_label}</span>
              <span className="docs-name" title={share.name}>
                {share.name}
                <span className="docs-count">{share.target_count} 个接口</span>
              </span>
              <span className="docs-who">
                <Avatar size={20} icon={<UserOutlined />} style={{ background: '#c7bda9' }} />
                <span className="docs-owner">{share.owner}</span>
                <span className="docs-time">最后更新于：{formatTime(share.updated_at)}</span>
              </span>
              <span className={`docs-expire${share.expired ? ' expired' : ''}`}>
                {share.expire_label}
              </span>
              <span className="docs-actions">
                <Tooltip title="打开链接">
                  <button className="mini" onClick={() => void openUrl(shareUrl(share.share_id))}>
                    <LinkOutlined style={{ fontSize: 14 }} />
                  </button>
                </Tooltip>
                <Tooltip title="复制链接">
                  <button className="mini" onClick={() => void copyUrl(share.share_id)}>
                    <CopyOutlined style={{ fontSize: 14 }} />
                  </button>
                </Tooltip>
                <Tooltip title="编辑">
                  <button className="mini" onClick={() => void openEdit(share.share_id)}>
                    <EditOutlined style={{ fontSize: 14 }} />
                  </button>
                </Tooltip>
                <Tooltip title="删除">
                  <button className="mini danger" onClick={() => deleteShares([share.share_id])}>
                    <DeleteOutlined style={{ fontSize: 14 }} />
                  </button>
                </Tooltip>
              </span>
            </div>
          ))
        )}
      </div>

      <Modal
        title={editor.shareId ? '编辑分享' : '新建分享'}
        open={editor.open}
        width={600}
        okText="保存"
        cancelText="取消"
        confirmLoading={editor.saving}
        onOk={() => void saveShare()}
        onCancel={() => setEditor(defaultEditor())}
        destroyOnClose
      >
        <div className="docs-form">
          <div className="docs-field">
            <label>分享名称</label>
            <Input
              value={editor.name}
              placeholder="请输入分享名称"
              onChange={(event) => patchEditor({ name: event.target.value })}
            />
          </div>

          <div className="docs-field">
            <label>分享范围</label>
            <Radio.Group
              value={editor.scope}
              size="small"
              optionType="button"
              buttonStyle="solid"
              onChange={(event) => changeScope(event.target.value as DocScope)}
            >
              <Radio.Button value="project">项目</Radio.Button>
              <Radio.Button value="folder">目录</Radio.Button>
              <Radio.Button value="api">接口</Radio.Button>
              <Radio.Button value="custom">自定义</Radio.Button>
            </Radio.Group>
          </div>

          <div className="docs-field docs-target-picker">
            {editor.scope === 'project' ? (
              <div className="docs-hint">
                将分享「{project?.name ?? '当前项目'}」内全部接口，共 {apiCount} 个。
              </div>
            ) : editor.scope === 'custom' ? (
              <>
                <Tree
                  checkable
                  selectable={false}
                  defaultExpandAll
                  treeData={toCheckData(tree)}
                  checkedKeys={editor.targetIds}
                  onCheck={(keys) => {
                    const list = Array.isArray(keys) ? keys : keys.checked
                    patchEditor({ targetIds: list.map(String) })
                  }}
                />
                <div className="docs-hint">勾选目录会包含其下全部接口。</div>
              </>
            ) : (
              <TreeSelect
                style={{ width: '100%' }}
                placeholder={editor.scope === 'folder' ? '请选择目录' : '请选择接口'}
                value={editor.targetIds[0]}
                treeData={toSelectData(tree, editor.scope === 'folder' ? 'folder' : 'api')}
                treeDefaultExpandAll
                showSearch
                treeNodeFilterProp="title"
                onChange={(value) =>
                  patchEditor({ targetIds: value ? [String(value)] : [] })
                }
              />
            )}
          </div>

          <div className="docs-field-row">
            <div className="docs-field">
              <label>访问方式</label>
              <Radio.Group
                value={editor.passwordEnabled ? 'password' : 'public'}
                size="small"
                onChange={(event) =>
                  patchEditor({ passwordEnabled: event.target.value === 'password' })
                }
              >
                <Radio value="public">公开访问</Radio>
                <Radio value="password">密码访问</Radio>
              </Radio.Group>
            </div>
            <div className="docs-field">
              <label>有效期</label>
              <div className="docs-inline">
                <Select
                  value={editor.expireMode}
                  style={{ width: 126 }}
                  onChange={(value) => patchEditor({ expireMode: value as ExpireMode })}
                  options={[
                    { value: 'permanent', label: '永久有效' },
                    { value: '7', label: '7 天' },
                    { value: '30', label: '30 天' },
                    { value: 'custom', label: '自定义' }
                  ]}
                />
                {editor.expireMode === 'custom' ? (
                  <InputNumber
                    min={1}
                    max={3650}
                    value={editor.customDays}
                    addonAfter="天"
                    onChange={(value) =>
                      patchEditor({ customDays: Number(value ?? 1) })
                    }
                  />
                ) : null}
              </div>
            </div>
          </div>

          {editor.passwordEnabled ? (
            <div className="docs-field">
              <label>访问密码</label>
              <Input.Password
                value={editor.password}
                placeholder="访问者需要输入此密码"
                onChange={(event) => patchEditor({ password: event.target.value })}
              />
            </div>
          ) : null}

          <div className="docs-field">
            <label>字段展示</label>
            <div className="docs-checks">
              <Checkbox
                checked={editor.showRequest}
                onChange={(event) => patchEditor({ showRequest: event.target.checked })}
              >
                请求参数
              </Checkbox>
              <Checkbox
                checked={editor.showBody}
                onChange={(event) => patchEditor({ showBody: event.target.checked })}
              >
                请求体
              </Checkbox>
              <Checkbox
                checked={editor.showResponse}
                onChange={(event) => patchEditor({ showResponse: event.target.checked })}
              >
                响应示例
              </Checkbox>
              <Checkbox
                checked={editor.showHeaders}
                onChange={(event) => patchEditor({ showHeaders: event.target.checked })}
              >
                响应头 / Cookie
              </Checkbox>
              <Checkbox
                checked={editor.showScripts}
                onChange={(event) => patchEditor({ showScripts: event.target.checked })}
              >
                前后脚本
              </Checkbox>
            </div>
          </div>

          <div className="docs-field docs-switch-row">
            <div>
              <label style={{ margin: 0 }}>允许 OpenAPI 导出</label>
              <div className="docs-hint">开启后访问者可下载 OpenAPI 3.0 文档。</div>
            </div>
            <Switch
              checked={editor.openapi}
              onChange={(checked) => patchEditor({ openapi: checked })}
            />
          </div>
        </div>
      </Modal>

      <Modal
        title="分享链接"
        open={Boolean(link)}
        onCancel={() => setLink(null)}
        footer={
          <Button onClick={() => setLink(null)}>关闭</Button>
        }
        destroyOnClose
      >
        {link ? (
          <div className="docs-link-box">
            <div className="docs-link-name">{link.name}</div>
            {!status?.running ? (
              <Alert
                type="warning"
                showIcon
                message="分享服务未启动，链接暂时无法访问"
                style={{ marginBottom: 12 }}
              />
            ) : null}
            <Input
              readOnly
              value={shareUrl(link.shareId)}
              addonAfter={
                <button
                  className="docs-link-copy"
                  onClick={() => void copyUrl(link.shareId)}
                >
                  <CopyOutlined /> 复制
                </button>
              }
            />
            <div className="docs-link-actions">
              <Button
                type="primary"
                icon={<LinkOutlined />}
                onClick={() => void openUrl(shareUrl(link.shareId))}
              >
                打开链接
              </Button>
              <Button
                icon={<DownloadOutlined />}
                onClick={() =>
                  void openUrl(`${shareUrl(link.shareId)}/download?format=md`)
                }
              >
                Markdown
              </Button>
              <Button
                icon={<DownloadOutlined />}
                onClick={() =>
                  void openUrl(`${shareUrl(link.shareId)}/download?format=html`)
                }
              >
                HTML
              </Button>
              {link.openapi ? (
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() =>
                    void openUrl(`${shareUrl(link.shareId)}/download?format=openapi`)
                  }
                >
                  OpenAPI
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="分享服务"
        open={serviceOpen}
        okText="保存并重启"
        cancelText="取消"
        confirmLoading={serviceSaving}
        onOk={() => void saveService()}
        onCancel={() => setServiceOpen(false)}
        destroyOnClose
      >
        <div className="docs-form">
          <div className="docs-switch-row">
            <div>
              <label style={{ margin: 0 }}>启用本地分享服务</label>
              <div className="docs-hint">关闭后所有分享链接暂时不可访问。</div>
            </div>
            <Switch
              checked={serviceForm.enabled}
              onChange={(checked) =>
                setServiceForm((current) => ({ ...current, enabled: checked }))
              }
            />
          </div>
          <div className="docs-field">
            <label>服务端口</label>
            <InputNumber
              min={1024}
              max={65535}
              value={serviceForm.port}
              style={{ width: 160 }}
              onChange={(value) =>
                setServiceForm((current) => ({ ...current, port: Number(value ?? 30999) }))
              }
            />
            <div className="docs-hint">端口变更后，已复制的旧链接会失效。</div>
          </div>
          <div className="docs-service-state">
            <span className={`docs-service-dot${status?.running ? ' on' : ''}`} />
            {status?.running ? '运行中' : status?.error ? '启动失败' : '未启动'}
            {status ? <span className="mono">{status.base_url}</span> : null}
          </div>
          {status?.error ? <Alert type="error" showIcon message={status.error} /> : null}
          <Alert
            type="info"
            showIcon
            message="服务默认监听局域网地址，同一网络下的同事可直接打开分享链接。"
          />
        </div>
      </Modal>
    </div>
  )
}
