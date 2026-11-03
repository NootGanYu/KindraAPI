import { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Input, Tag } from 'antd'
import type { InputProps } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import type { DictionaryEntryView } from '@shared/types'
import { loadSuggestions } from './dictionarySuggestions'
import DictionaryManager from './DictionaryManager'

interface Props {
  projectId: string
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  size?: 'small' | 'middle' | 'large'
  disabled?: boolean
  lookupField?: 'key' | 'description'
  onSelectEntry?: (entry: DictionaryEntryView) => void
  ariaLabel?: string
  variant?: InputProps['variant']
  className?: string
}

export default function DictionarySuggest({
  projectId,
  value,
  onChange,
  placeholder = '描述',
  size,
  disabled,
  lookupField = 'description',
  onSelectEntry,
  ariaLabel,
  variant,
  className
}: Props): JSX.Element {
  const [managerOpen, setManagerOpen] = useState(false)
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
  }, [projectId, managerOpen])

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
      key: `${entry.source}:${entry.id}`,
      value: `kindra-dictionary:${entry.source}:${entry.id}`,
      entry,
      label: (
        <div data-dictionary-id={`${entry.source}:${entry.id}`} className={lookupField === 'key' ? 'param-name-suggestion' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span className="mono" style={{ fontSize: 11, color: '#8a6b3b', flex: 'none' }}>
            {entry.key}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.description}
          </span>
          <span style={{ flex: 1 }} />
          {lookupField !== 'key' && <Tag
            bordered={false}
            color={entry.source === 'builtin' ? 'default' : 'gold'}
            style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}
          >
            {entry.source === 'builtin' ? '内置' : '自定义'}
          </Tag>}
        </div>
      )
    }))
  }, [entries, query, lookupField])

  return <>
    <AutoComplete
      value={value}
      options={options}
      className={className}
      onChange={(next) => onChange?.(options.find(option => option.value === next)?.entry[lookupField] ?? next)}
      onSearch={(next) => setQuery(next)}
      onFocus={() => { setQuery(value ?? ''); void loadSuggestions(projectId).then(setEntries).catch(() => undefined) }}
      onSelect={(_value, option) => onSelectEntry?.(option.entry)}
      style={{ width: '100%' }}
      disabled={disabled}
      popupMatchSelectWidth={lookupField === 'key' ? 320 : 360}
      classNames={{ popup: { root: lookupField === 'key' ? 'param-name-suggestions' : '' } }}
      popupRender={lookupField === 'key' ? menu => <>{menu}<button className="param-dictionary-link" onMouseDown={event => event.preventDefault()} onClick={() => setManagerOpen(true)}><MenuOutlined /> 字典库</button></> : undefined}
    >
      <Input size={size} placeholder={placeholder} aria-label={ariaLabel} variant={variant} />
    </AutoComplete>
    <DictionaryManager projectId={projectId} open={managerOpen} onClose={() => setManagerOpen(false)} />
  </>
}
