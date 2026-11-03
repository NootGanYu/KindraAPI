import { useMemo, useState } from 'react'
import { App, Button, Checkbox, Input, Modal, Popover, Segmented, Select, Tooltip } from 'antd'
import { CopyOutlined, DeleteOutlined, MoreOutlined } from '@ant-design/icons'
import type { DictFieldType, Param } from '@shared/types'
import { DICT_FIELD_TYPES } from '@shared/types'
import { rulesToSchema } from '@shared/fieldRules'
import { createParam } from '@shared/factories'
import FieldRulesEditor from './FieldRulesEditor'
import DictionarySuggest from './schemas/DictionarySuggest'
import ParamDescriptionInput from './ParamDescriptionInput'
import { jsonTypeClass } from './jsonTypeStyles'
import { useApp } from '../store'
import { invalidateDictionaryCache } from './schemas/dictionarySuggestions'

interface Props {
  params: Param[]
  onChange: (params: Param[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  title?: string
  mode?: string
  allowFile?: boolean
  path?: boolean
  omitEmptyEquals?: boolean
  onChangeEmptyEquals?: (value: boolean) => void
  requiredLabel?: '必填' | '必有'
}
const types = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null', 'unknown']

export default function DesignParamTable({ params, onChange, keyPlaceholder = '参数名', valuePlaceholder = '参数值', allowFile, path, omitEmptyEquals, onChangeEmptyEquals, requiredLabel = '必填' }: Props): JSX.Element {
  const projectId = useApp(state => state.project?.project_id ?? '')
  const { message } = App.useApp()
  const [tail, setTail] = useState(() => createParam())
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [showType, setShowType] = useState(true)
  const [showDescription, setShowDescription] = useState(true)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkMode, setBulkMode] = useState('Key-Value格式')
  const [bulkText, setBulkText] = useState('')
  const bulkResult = useMemo(() => {
    try {
      let entries: Array<Partial<Param> & { key: string; value: string }> = []
      if (bulkMode === '带描述') {
        const rows = JSON.parse(bulkText || '[]')
        if (!Array.isArray(rows)) throw Error('请输入参数对象数组')
        entries = rows.map(row => {
          if (!row || typeof row.key !== 'string' || !row.key.trim()) throw Error('每项必须包含非空 key')
          return { key: row.key, value: typeof row.value === 'string' ? row.value : JSON.stringify(row.value ?? ''),
            description: typeof row.description === 'string' ? row.description : undefined,
            field_type: typeof row.field_type === 'string' ? row.field_type : 'string',
            is_checked: typeof row.is_checked === 'number' ? row.is_checked : 1,
            ...(typeof row.required === 'boolean' ? { required: row.required } : {}),
            ...(typeof row.nullable === 'boolean' ? { nullable: row.nullable } : {}) }
        })
      } else if (bulkMode === 'Raw-Json格式') {
        const object = JSON.parse(bulkText || '{}')
        if (!object || Array.isArray(object) || typeof object !== 'object') throw Error('请输入 JSON 对象')
        entries = Object.entries(object).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) }))
      } else {
        entries = bulkText.split('\n').filter(line => line.trim()).map(line => {
          const index = line.search(/[:=]/)
          if (index < 1) throw Error('每行使用 参数名:参数值 格式')
          return { key: line.slice(0, index).trim(), value: line.slice(index + 1).trim() }
        })
      }
      return { entries, error: '' }
    } catch (error) { return { entries: [], error: (error as Error).message } }
  }, [bulkText, bulkMode])
  const mergeBulkEntries = (): Param[] => {
    const remaining = params.slice()
    return bulkResult.entries.map(entry => {
      const index = remaining.findIndex(param => param.key === entry.key)
      return { ...(index < 0 ? createParam() : remaining.splice(index, 1)[0]), ...entry }
    })
  }
  const openBulk = (): void => {
    setBulkMode('Key-Value格式')
    setBulkText(params.filter(param => param.key).map(param => `${param.key}:${param.value}`).join('\n'))
    setBulkOpen(true)
  }
  const update = (param: Param, patch: Partial<Param>): void => {
    if (param.param_id === tail.param_id) {
      onChange([...params, { ...tail, ...patch }])
      setTail(createParam())
    } else onChange(params.map(item => item.param_id === param.param_id ? { ...item, ...patch } : item))
  }
  const applyFiles = (param: Param, files: Array<{ path: string; size: number }>): void => {
    if (!files.length) return
    const rows = files.map((file, index) => ({ ...param, param_id: index ? createParam().param_id : param.param_id, value: file.path, file_size: file.size, field_type: 'file' }))
    if (param.param_id === tail.param_id) {
      onChange([...params, ...rows])
      setTail(createParam())
    } else onChange([...params.map(item => item.param_id === param.param_id ? rows[0] : item), ...rows.slice(1)])
  }
  const all = params.length === 0 || params.every(param => param.is_checked > 0 || (param.is_system ?? 0) > 0)
  const some = params.some(param => param.is_checked > 0 || (param.is_system ?? 0) > 0)
  const rows = path ? params : [...params, tail]
  return <><div data-hide-type={!showType} data-hide-description={!showDescription} className={`design-param-table${path ? ' is-path' : ''}${allowFile ? ' is-formdata' : ''}`}>
    {!path && <div className={`design-param-toolbar${columnsOpen ? ' is-open' : ''}`}>
      <button onClick={openBulk}>批量编辑</button>
      <Popover trigger="click" open={columnsOpen} onOpenChange={setColumnsOpen} content={<div className="design-column-options">
        <Checkbox checked={showType} onChange={event => setShowType(event.target.checked)}>参数类型/{requiredLabel}</Checkbox>
        <Checkbox checked={showDescription} onChange={event => setShowDescription(event.target.checked)}>参数描述</Checkbox>
      </div>}><button aria-label="展示列"><MoreOutlined /></button></Popover>
    </div>}
    <div className="design-param-row design-param-head">
      <div className="design-param-key">
        {!path && <Checkbox aria-label="启用全部参数" checked={all} indeterminate={!all && some}
          onChange={event => onChange(params.map(param => ({ ...param, is_system: -1, is_checked: event.target.checked ? 1 : -1 })))} />}
        <span>参数名</span>
        {onChangeEmptyEquals && <Tooltip title={omitEmptyEquals ? '当参数值为空时，不添加等于号' : '当参数值为空时，添加等于号'}>
          <button className="query-equals field-flag" aria-label="空参数等号" aria-pressed={!omitEmptyEquals} onClick={() => onChangeEmptyEquals(!omitEmptyEquals)}>{omitEmptyEquals ? '≠' : '='}</button>
        </Tooltip>}
      </div>
      <div>参数值</div>{allowFile && <div>内容类型</div>}<div className="design-param-description-head">描述</div>
    </div>
    {rows.map(param => {
      const empty = param.param_id === tail.param_id
      return <div className={`design-param-row${empty ? ' is-tail' : ''}`} key={param.param_id} onBlur={event => {
        if (event.currentTarget.contains(event.relatedTarget as Node) || !param.key.trim() || !param.description?.trim()) return
        const type = DICT_FIELD_TYPES.includes(param.field_type as DictFieldType) ? param.field_type as DictFieldType : 'string'
        void window.api.dictionary.stage(projectId, { id: '', project_id: projectId, key: param.key, description: param.description, field_type: type,
          schema: { ...rulesToSchema(param), type }, created_at: '', updated_at: '' }).then(result => {
          if (result.ok && result.data) invalidateDictionaryCache(projectId)
        })
      }}>
        <div className="design-param-key">
          {!path && <Checkbox aria-label={`启用参数 ${param.key || '新参数'}`} disabled={empty}
            checked={param.is_checked > 0 || (param.is_system ?? 0) > 0}
            onChange={event => update(param, { is_system: -1, is_checked: event.target.checked ? 1 : -1 })} />}
          {path ? <span className="design-path-key">{param.key}</span> : <DictionarySuggest projectId={projectId}
            className="design-param-name" variant="borderless" ariaLabel="参数名" placeholder={keyPlaceholder} lookupField="key"
            value={param.key} onChange={key => update(param, { key })}
            onSelectEntry={entry => update(param, { key: entry.key, description: entry.description, field_type: entry.field_type, value: entry.default_value ?? '' })} />}
          <Select aria-label={`参数类型 ${param.key || '新参数'}`} className="design-param-type" size="small" variant="borderless" suffixIcon={null}
            value={param.field_type || 'string'} options={[...types, ...(allowFile ? ['file'] : [])].map(value => ({ value, label: <span className={jsonTypeClass(value)}>{value === 'unknown' ? 'any' : value}</span> }))}
            onChange={field_type => update(param, { field_type })} />
          <Tooltip title={`${requiredLabel}：${param.required === undefined ? '待补充' : param.required ? '是' : '否'}`}>
            <button className={`field-flag${param.required ? ' active' : ''}`} aria-label={`${requiredLabel} ${param.key || '新参数'}`}
              aria-pressed={param.required === undefined ? 'mixed' : param.required}
              onClick={() => update(param, { required: param.required === undefined ? true : !param.required })}>*</button>
          </Tooltip>
        </div>
        <div className="design-param-value" onDragOver={event => { if (allowFile) event.preventDefault() }} onDrop={event => {
          if (!allowFile) return
          event.preventDefault()
          applyFiles(param, Array.from(event.dataTransfer.files).map(file => ({ path: window.api.files.getPathForFile(file), size: file.size })).filter(file => file.path))
        }}>
          {allowFile && param.field_type === 'file' ? <button className="design-file-pick" title={param.value} onClick={async () => {
            const result = await window.api.dialog.openFiles()
            if (!result.ok) { message.error(result.error); return }
            applyFiles(param, result.data)
          }}>{param.value ? param.value.split(/[\\/]/).pop() : '请上传文件'}</button> : <Input variant="borderless" aria-label={`参数值 ${param.key || '新参数'}`} placeholder={valuePlaceholder}
            value={param.value} onChange={event => update(param, { value: event.target.value })} />}
        </div>
        {allowFile && <div className="design-param-content-type"><Select size="small" variant="borderless" aria-label={`内容类型 ${param.key || '新参数'}`}
          placeholder="自动（content-type）" value={param.content_type} allowClear showSearch
          options={['application/json', 'text/plain', 'application/octet-stream', 'application/xml', 'text/html', 'image/png', 'image/jpeg'].map(value => ({ value, label: value }))}
          onChange={content_type => update(param, { content_type })} /></div>}
        <ParamDescriptionInput projectId={projectId} parameterName={param.key} value={param.description ?? ''} onChange={description => update(param, { description })}>
          {!empty && <>
            <FieldRulesEditor compact value={{ ...param, type: param.field_type }}
              onChange={({ type, ...rules }) => update(param, { ...rules, field_type: type })} />
            {!path && <button aria-label={`复制参数 ${param.key}`} onClick={() => onChange([...params, createParam({ ...param, param_id: createParam().param_id })])}><CopyOutlined /></button>}
            {!path && <button aria-label={`删除参数 ${param.key}`} onClick={() => onChange(params.filter(item => item.param_id !== param.param_id))}><DeleteOutlined /></button>}
          </>}
        </ParamDescriptionInput>
      </div>
    })}
    {path && params.length === 0 && <div className="design-path-empty">在 URL 中使用 {'{参数名}'} 定义路径参数</div>}
  </div>
    <Modal title="批量编辑" open={bulkOpen} width={800} onCancel={() => setBulkOpen(false)} okText="确定" cancelText="取消"
      okButtonProps={{ disabled: Boolean(bulkResult.error) }} onOk={() => {
        onChange(mergeBulkEntries())
        setBulkOpen(false)
      }}>
      <Segmented value={bulkMode} options={['Key-Value格式', 'Raw-Json格式', '带描述']} onChange={mode => {
        setBulkMode(mode)
        if (!bulkResult.error) setBulkText(mode === '带描述' ? JSON.stringify(mergeBulkEntries(), null, 2) : mode === 'Raw-Json格式' ? JSON.stringify(Object.fromEntries(bulkResult.entries.map(entry => [entry.key, entry.value])), null, 2)
          : bulkResult.entries.map(entry => `${entry.key}:${entry.value}`).join('\n'))
      }} />
      <div className="design-bulk-edit">
        <Input.TextArea aria-label="批量参数" value={bulkText} onChange={event => setBulkText(event.target.value)} rows={12} spellCheck={false} />
        <div className="design-bulk-preview">{bulkResult.error ? <div role="alert">{bulkResult.error}</div> : <table className="simple-table"><thead><tr><th>参数名</th><th>参数值</th></tr></thead><tbody>{bulkResult.entries.map((entry, index) => <tr key={index}><td>{entry.key}</td><td>{entry.value}</td></tr>)}</tbody></table>}</div>
      </div>
      <Button size="small" onClick={async () => { const result = await window.api.app.copyText(bulkText); result.ok ? message.success('已复制') : message.error(result.error) }}>复制</Button>
    </Modal>
  </>
}
