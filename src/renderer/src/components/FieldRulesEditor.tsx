import { useState } from 'react'
import { Button, Input, Modal, Select } from 'antd'
import type { FieldRules } from '@shared/types'
import { FIELD_TYPES, validateRules } from '@shared/fieldRules'
import { useTargetEditLock } from './TargetEditScope'

interface Props {
  value: FieldRules & { type?: string }
  onChange: (value: FieldRules & { type?: string }) => void
  disabled?: boolean
}
export default function FieldRulesEditor({ value, onChange, disabled }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  useTargetEditLock(open)
  const [draft, setDraft] = useState(value)
  const [enumMode, setEnumMode] = useState('unknown')
  const [enumText, setEnumText] = useState('')
  const [meanings, setMeanings] = useState('')
  const [defaultText, setDefaultText] = useState('')
  const [exampleText, setExampleText] = useState('')
  const [error, setError] = useState('')
  const begin = (): void => {
    setDraft({ ...value }); setError('')
    setEnumMode(value.enum === undefined ? 'unknown' : value.enum === null ? 'none' : 'values')
    setEnumText(JSON.stringify(value.enum ?? [], null, 2))
    setMeanings((value.enum_descriptions ?? []).join('\n'))
    setDefaultText(value.default === undefined ? '' : JSON.stringify(value.default))
    setExampleText(value.example === undefined ? '' : JSON.stringify(value.example))
    setOpen(true)
  }
  const save = (): void => {
    try {
      const next = { ...draft, enum: enumMode === 'unknown' ? undefined : enumMode === 'none' ? null : JSON.parse(enumText),
        enum_descriptions: enumMode === 'values' && meanings.trim() ? meanings.split('\n') : undefined,
        default: defaultText.trim() ? JSON.parse(defaultText) : undefined,
        example: exampleText.trim() ? JSON.parse(exampleText) : undefined }
      const errors = validateRules(next, next.type, '字段')
      if (errors.length) throw new Error(errors.join('；'))
      onChange(next); setOpen(false)
    } catch (e) { setError((e as Error).message) }
  }
  const booleanEditor = (key: 'required' | 'nullable'): JSX.Element => <Select style={{ width: '100%' }}
    value={draft[key] === undefined ? 'unknown' : String(draft[key])}
    options={[{ value: 'unknown', label: '待补充' }, { value: 'true', label: '是' }, { value: 'false', label: '否' }]}
    onChange={v => setDraft({ ...draft, [key]: v === 'unknown' ? undefined : v === 'true' })} />
  return <>
    <Button size="small" type="text" disabled={disabled} onClick={begin}>规则</Button>
    <Modal title="字段说明与规则" open={open} onCancel={() => setOpen(false)} onOk={save} okText="保存" cancelText="取消">
      <div className="field-form">
        <label>类型</label><Select value={draft.type ?? 'unknown'} options={FIELD_TYPES.map(type => ({ value: type, label: type }))} onChange={type => setDraft({ ...draft, type })} />
        <label>必填 / 必有（父对象存在时）</label>{booleanEditor('required')}
        <label>可为 null</label>{booleanEditor('nullable')}
        <label>字段含义</label><Input.TextArea value={draft.description ?? ''} onChange={e => setDraft({ ...draft, description: e.target.value })} />
        <label>枚举</label><Select value={enumMode} options={[{ value: 'unknown', label: '待补充' }, { value: 'none', label: '没有枚举限制' }, { value: 'values', label: '指定枚举值' }]} onChange={setEnumMode} />
        {enumMode === 'values' && <><label>枚举值（JSON 数组，如 [0,1,2]）</label><Input.TextArea value={enumText} onChange={e => setEnumText(e.target.value)} />
          <label>每个值的含义（依次填写，每行一条）</label><Input.TextArea value={meanings} onChange={e => setMeanings(e.target.value)} /></>}
        <label>默认值（JSON，留空为未设置）</label><Input value={defaultText} placeholder={'例如 0、false、"默认名称"'} onChange={e => setDefaultText(e.target.value)} />
        <label>示例值（JSON，留空为未设置）</label><Input value={exampleText} onChange={e => setExampleText(e.target.value)} />
        {error && <div role="alert" style={{ color: '#c9463a' }}>{error}</div>}
      </div>
    </Modal>
  </>
}
