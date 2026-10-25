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
  Switch,
  Tooltip
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined
} from '@ant-design/icons'
import type { DocServiceStatus, DocShare, DocShareSummary } from '@shared/types'
import { useApp } from '../store'
import DocShareDialog, { type DocShareInitial } from '../components/DocShareDialog'
import DocShareLinkDialog, { type DocShareLinkInfo } from '../components/DocShareLinkDialog'

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

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
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
  const [editor, setEditor] = useState<{ open: boolean; initial?: DocShareInitial }>({
    open: false
  })
  const [link, setLink] = useState<DocShareLinkInfo | null>(null)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [serviceForm, setServiceForm] = useState({ enabled: true, port: 30999 })
  const [serviceSaving, setServiceSaving] = useState(false)

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
    setEditor({ open: false })
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
    setEditor({
      open: true,
      initial: { name: fallbackName, scope: 'project', targetIds: [] }
    })
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
    setEditor({
      open: true,
      initial: {
        shareId: share.share_id,
        name: share.name,
        scope: share.scope,
        targetIds: share.target_ids,
        settings: share.settings
      }
    })
  }

  const handleSaved = async (share: DocShare): Promise<void> => {
    setEditor({ open: false })
    setLink({
      shareId: share.share_id,
      name: share.name,
      openapi: share.settings.openapi
    })
    await reload()
    message.success('分享已保存')
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

  const selectedAllVisible =
    filtered.length > 0 && filtered.every((s) => selected.includes(s.share_id))

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

      <DocShareDialog
        open={editor.open}
        projectId={project?.project_id ?? ''}
        projectName={project?.name ?? ''}
        targets={targets}
        initial={editor.initial}
        onClose={() => setEditor({ open: false })}
        onSaved={(share) => void handleSaved(share)}
      />

      <DocShareLinkDialog share={link} onClose={() => setLink(null)} />

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
