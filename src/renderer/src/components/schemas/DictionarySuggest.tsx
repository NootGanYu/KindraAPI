import { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Input, Tag } from 'antd'
import type { DictionaryEntryView } from '@shared/types'

interface CacheEntry {
  entries: DictionaryEntryView[]
  promise: Promise<DictionaryEntryView[]> | null
}

const cache = new Map<string, CacheEntry>()

export function invalidateDictionaryCache(projectId?: string): void {
  if (projectId) cache.delete(projectId)
  else cache.clear()
}

async function loadSuggestions(projectId: string): Promise<DictionaryEntryView[]> {
  const existing = cache.get(projectId)
  if (existing?.entries?.length) return existing.entries
  if (existing?.promise) return existing.promise
  const promise = window.api.dictionary.suggestions(projectId).then((result) => {
    if (!result.ok) throw new Error(result.error)
    const entry = cache.get(projectId) ?? { entries: [], promise: null }
    entry.entries = result.data
    entry.promise = null
    cache.set(projectId, entry)
    return result.data
  })
  cache.set(projectId, { entries: existing?.entries ?? [], promise })
  return promise
}

interface Props {
  projectId: string
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  size?: 'small' | 'middle' | 'large'
  disabled?: boolean
}

export default function DictionarySuggest({
  projectId,
  value,
  onChange,
  placeholder = '描述',
  size,
  disabled
}: Props): JSX.Element {
  const [entries, setEntries] = useState<DictionaryEntryView[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    loadSuggestions(projectId)
      .then((list) => {
        if (active) setEntries(list)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [projectId])

  const options = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const filtered = keyword
      ? entries.filter(
          (entry) =>
            entry.key.toLowerCase().includes(keyword) ||
            entry.description.toLowerCase().includes(keyword)
        )
      : entries
    return filtered.slice(0, 40).map((entry) => ({
      value: entry.description,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span className="mono" style={{ fontSize: 11, color: '#8a6b3b', flex: 'none' }}>
            {entry.key}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.description}
          </span>
          <span style={{ flex: 1 }} />
          <Tag
            bordered={false}
            color={entry.source === 'builtin' ? 'default' : 'gold'}
            style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}
          >
            {entry.source === 'builtin' ? '内置' : '自定义'}
          </Tag>
        </div>
      )
    }))
  }, [entries, query])

  return (
    <AutoComplete
      value={value}
      options={options}
      onChange={(next) => onChange?.(next)}
      onSearch={(next) => setQuery(next)}
      style={{ width: '100%' }}
      disabled={disabled}
      popupMatchSelectWidth={360}
      placeholder={placeholder}
    >
      <Input size={size} placeholder={placeholder} />
    </AutoComplete>
  )
}
