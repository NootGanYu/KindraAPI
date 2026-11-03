import { useEffect, useState } from 'react'
import { Checkbox, Tag, Tooltip } from 'antd'
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'
import { runtimeDefaultHeaders } from '@shared/requestDefaults'
import { createParam, createRequest } from '@shared/factories'
import type { Param, Target } from '@shared/types'
import { useApp } from '../store'

type Location = 'header' | 'query' | 'restful'
interface Entry { param: Param; source: string }
export default function InheritedRequestParams({ draft, location, onChange }: {
  draft: Target; location: Location; onChange: (params: Param[]) => void
}): JSX.Element | null {
  const projectId = useApp(state => state.project?.project_id)
  const targets = useApp(state => state.targets)
  const [entries, setEntries] = useState<Entry[]>([])
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const keyOf = (key: string): string => location === 'header' ? key.trim().toLowerCase() : key
  useEffect(() => {
    if (!projectId) return
    let active = true
    const load = async (): Promise<void> => {
      const defaults = await window.api.globalParams.get(projectId)
      if (!defaults.ok) throw Error(defaults.error)
      const map = new Map<string, Entry>()
      const merge = (params: Param[], source: string): void => {
        for (const param of params) {
          if (!param.key) continue
          if (param.is_checked > 0 || (param.is_system ?? 0) > 0) map.set(keyOf(param.key), { param, source })
          else map.delete(keyOf(param.key))
        }
      }
      if (location === 'header') merge(runtimeDefaultHeaders, '全局')
      merge((defaults.data ?? createRequest())[location]?.parameter ?? [], '全局')
      const parents: Target[] = []
      const seen = new Set<string>([draft.target_id])
      let id = draft.parent_id
      while (id && id !== '0' && !seen.has(id)) {
        seen.add(id)
        const result = await window.api.targets.get(projectId, id)
        if (!result.ok) throw Error(result.error)
        if (!result.data) break
        parents.unshift(result.data)
        id = result.data.parent_id
      }
      for (const parent of parents) merge(parent.request?.[location]?.parameter ?? [], parent.name)
      if (active) { setEntries([...map.values()]); setError('') }
    }
    void load().catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [projectId, draft.target_id, draft.parent_id, location, targets])
  if (error) return <div role="alert" className="muted">公共参数读取失败：{error}</div>
  if (!entries.length) return null
  const local = draft.request?.[location]?.parameter ?? []
  const label = location === 'header' ? 'Header' : location === 'query' ? 'Query' : 'Path'
  return <div className="inherited-params">
    <button className="inherited-params-toggle" aria-expanded={!hidden} onClick={() => setHidden(!hidden)}>
      {hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />} 公共参数（{label}）
    </button>
    {!hidden && <div className="inherited-params-table">{entries.map(({ param, source }) => {
      const override = local.find(item => keyOf(item.key) === keyOf(param.key))
      const enabled = override ? override.is_checked > 0 || (override.is_system ?? 0) > 0 : true
      return <div className="inherited-param-row" key={keyOf(param.key)}>
        <Checkbox aria-label={`继承参数 ${param.key}`} checked={enabled} onChange={event => {
          if (override?.inherited_override && event.target.checked) onChange(local.filter(item => item !== override))
          else if (override) onChange(local.map(item => item === override ? { ...item, is_system: -1, is_checked: event.target.checked ? 1 : -1 } : item))
          else if (!event.target.checked) onChange([...local, createParam({ key: param.key, value: param.value, is_checked: -1, inherited_override: true })])
        }} />
        <span>{param.key}</span><span>{param.field_type || 'string'}</span>
        <Tooltip title={param.required === undefined ? '必填规则待补充' : param.required ? '必填' : '非必填'}><span className="field-flag">*</span></Tooltip>
        <span className="inherited-param-value" title={override?.value ?? param.value}>{override?.value ?? param.value}</span>
        <Tag color="blue">{source}</Tag>
      </div>
    })}</div>}
  </div>
}
