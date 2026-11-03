import { useEffect, useMemo, useRef } from 'react'
import { App as AntApp, Select } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import type { Target, TargetSummary } from '@shared/types'
import { useApp } from '../store'
import RichTextEditor from './RichTextEditor'

interface Props {
  draft: Target
  onChange: (patch: Partial<Target>) => void
  onOpenDescription: () => void
}

const SAVE_DELAY = 900

function folderOptions(targets: TargetSummary[]): Array<{ value: string; label: string }> {
  const byId = new Map(targets.map((item) => [item.target_id, item]))
  const memo = new Map<string, string>()

  const pathOf = (id: string, guard: Set<string>): string => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (guard.has(id)) return ''
    guard.add(id)
    const item = byId.get(id)
    if (!item) return ''
    const parent = item.parent_id && item.parent_id !== '0' ? pathOf(item.parent_id, guard) : ''
    const label = parent ? `${parent} / ${item.name}` : item.name
    memo.set(id, label)
    return label
  }

  return targets
    .filter((item) => item.target_type === 'folder')
    .map((item) => ({ value: item.target_id, label: pathOf(item.target_id, new Set()) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

export default function DesignMetaBar({
  draft,
  onChange,
  onOpenDescription
}: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const targets = useApp((state) => state.targets)
  const tabs = useApp((state) => state.tabs)
  const drafts = useApp((state) => state.drafts)
  const timerRef = useRef<number | null>(null)

  const options = useMemo(
    () => [{ value: '0', label: '根目录' }, ...folderOptions(targets)],
    [targets]
  )

  const tagOptions = useMemo(() => {
    const values = new Set<string>(draft.tags ?? [])
    for (const target of Object.values(drafts)) {
      for (const tag of target.tags ?? []) values.add(tag)
    }
    return [...values]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((tag) => ({ value: tag, label: tag }))
  }, [drafts, draft.tags])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const moveTo = async (dest: string): Promise<void> => {
    if (dest === draft.parent_id) return
    const siblings = targets
      .filter((item) => item.parent_id === dest && item.target_id !== draft.target_id)
      .sort((a, b) => a.sort - b.sort)
    await useApp.getState().reorderTargets(dest, [
      ...siblings.map((item) => item.target_id),
      draft.target_id
    ])
    message.success('已移动到新目录')
  }

  const handleMove = (dest: string): void => {
    if (dest === draft.parent_id) return
    const tab = tabs.find((item) => item.id === draft.target_id)
    if (!tab?.dirty) {
      void moveTo(dest).catch((error) => message.error((error as Error).message))
      return
    }
    modal.confirm({
      title: '接口有未保存的修改',
      content: '移动前会先保存当前修改，避免版本冲突。',
      okText: '保存并移动',
      cancelText: '取消',
      onOk: async () => {
        try {
          await useApp.getState().saveTarget(draft.target_id)
          await moveTo(dest)
        } catch (error) {
          message.error((error as Error).message)
        }
      }
    })
  }

  const persistDescription = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      useApp
        .getState()
        .saveTarget(draft.target_id)
        .catch((error) => message.error((error as Error).message))
    }, SAVE_DELAY)
  }

  const handleDescription = (html: string): void => {
    onChange({ description: html })
    persistDescription()
  }

  const handleTags = (values: string[]): void => {
    const next = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    onChange({ tags: next })
  }

  return (
    <div className="design-meta">
      <div className="design-meta-row">
        <div className="design-meta-item">
          <span className="design-meta-label">目录</span>
          <Select
            size="small"
            style={{ width: 220 }}
            value={draft.parent_id || '0'}
            options={options}
            showSearch
            optionFilterProp="label"
            onChange={handleMove}
          />
        </div>
        <div className="design-meta-item">
          <span className="design-meta-label">标签</span>
          <Select
            size="small"
            mode="tags"
            style={{ minWidth: 260 }}
            value={draft.tags ?? []}
            options={tagOptions}
            tokenSeparators={[',', '，']}
            placeholder="请输入或选择标签"
            onChange={handleTags}
          />
        </div>
      </div>

      <div className="design-desc">
        <div className="design-desc-head">
          <FileTextOutlined />
          <span>详细说明</span>
        </div>
        <RichTextEditor
          value={draft.description ?? ''}
          onChange={handleDescription}
          onFullscreen={onOpenDescription}
          minHeight={160}
          maxHeight={360}
        />
      </div>
    </div>
  )
}
