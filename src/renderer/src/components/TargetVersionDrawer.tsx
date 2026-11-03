import { useCallback, useEffect, useRef, useState } from 'react'
import { methodColor } from '@shared/httpMethods'
import { App as AntApp, Button, Drawer, Empty, Input, Spin, Tag } from 'antd'
import { HistoryOutlined, TagOutlined } from '@ant-design/icons'
import type { Target, TargetVersionSummary } from '@shared/types'

interface Props {
  open: boolean
  projectId: string
  targetId: string
  targetName: string
  onClose: () => void
  onRestored: (target: Target) => void
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export default function TargetVersionDrawer({
  open,
  projectId,
  targetId,
  targetName,
  onClose,
  onRestored
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [tab, setTab] = useState<'history' | 'tags'>('history')
  const [versions, setVersions] = useState<TargetVersionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const cancelEdit = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    if (!projectId || !targetId) return
    setLoading(true)
    try {
      const result = await window.api.targets.versions.list(projectId, targetId)
      if (result.ok) setVersions(result.data)
      else message.error(result.error)
    } finally {
      setLoading(false)
    }
  }, [message, projectId, targetId])

  useEffect(() => {
    if (!open) return
    setTab('history')
    setVersions([])
    void load()
  }, [open, load])

  const restore = (version: TargetVersionSummary): void => {
    modal.confirm({
      title: `恢复到 v${version.version}？`,
      content: '当前未保存的内容会被该版本覆盖，并生成一条新的恢复记录。',
      okText: '恢复',
      cancelText: '取消',
      onOk: async () => {
        const result = await window.api.targets.versions.restore(
          projectId,
          targetId,
          version.version_id
        )
        if (!result.ok) {
          message.error(result.error)
          return
        }
        onRestored(result.data)
        message.success(`已恢复到 v${version.version}`)
        await load()
      }
    })
  }

  const beginTag = (version: TargetVersionSummary): void => {
    cancelEdit.current = false
    setEditingId(version.version_id)
    setTagDraft(version.label ?? '')
  }

  const closeTag = (): void => {
    setEditingId(null)
    setTagDraft('')
  }

  const saveTag = async (version: TargetVersionSummary): Promise<void> => {
    if (cancelEdit.current) {
      cancelEdit.current = false
      return
    }
    if (editingId !== version.version_id) return
    const label = tagDraft.trim()
    if (label === (version.label ?? '')) {
      closeTag()
      return
    }
    const result = await window.api.targets.versions.tag(
      projectId,
      targetId,
      version.version_id,
      label
    )
    if (!result.ok) {
      message.error(result.error)
      return
    }
    closeTag()
    message.success(label ? 'Tag 已保存' : 'Tag 已移除')
    await load()
  }

  const shown = tab === 'tags' ? versions.filter((item) => item.label) : versions

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      title={`版本管理${targetName ? ` · ${targetName}` : ''}`}
      destroyOnClose
      className="version-drawer"
    >
      <div className="version-tabs">
        <button
          type="button"
          className={tab === 'history' ? 'active' : ''}
          onClick={() => setTab('history')}
        >
          <HistoryOutlined /> 历史记录
          <span className="git-count">{versions.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'tags' ? 'active' : ''}
          onClick={() => setTab('tags')}
        >
          <TagOutlined /> Tag版本
          <span className="git-count">{versions.filter((item) => item.label).length}</span>
        </button>
      </div>

      <div className="version-list">
        {loading ? (
          <div className="version-loading">
            <Spin />
          </div>
        ) : shown.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              tab === 'tags'
                ? '暂无 Tag 版本，可在历史记录中为版本打 Tag'
                : '暂无版本记录，保存接口后会自动生成'
            }
          />
        ) : (
          shown.map((item) => (
            <div className="version-row" key={item.version_id}>
              <div className="version-main">
                <div className="version-head">
                  <span className="version-no">v{item.version}</span>
                  {editingId === item.version_id ? (
                    <Input
                      size="small"
                      autoFocus
                      className="version-tag-input"
                      value={tagDraft}
                      maxLength={60}
                      placeholder="输入 Tag，留空移除"
                      onChange={(event) => setTagDraft(event.target.value)}
                      onPressEnter={() => void saveTag(item)}
                      onBlur={() => void saveTag(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelEdit.current = true
                          closeTag()
                        }
                      }}
                    />
                  ) : item.label ? (
                    <Tag
                      color="gold"
                      className="version-tag-editable"
                      title="点击修改 Tag"
                      onClick={() => beginTag(item)}
                    >
                      {item.label}
                    </Tag>
                  ) : null}
                  <span className="version-time">{formatTime(item.created_at)}</span>
                </div>
                <div className="version-sub">
                  <span className="method-text" style={{ color: methodColor(item.method) }}>{item.method || 'GET'}</span>
                  <span className="version-name">{item.name || '未命名接口'}</span>
                  <span className="version-url">{item.url || '（未设置 URL）'}</span>
                </div>
              </div>
              <div className="version-actions">
                {!item.label && editingId !== item.version_id ? (
                  <Button size="small" onClick={() => beginTag(item)}>
                    标记 Tag
                  </Button>
                ) : null}
                <Button size="small" type="primary" ghost onClick={() => restore(item)}>
                  恢复
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

    </Drawer>
  )
}
