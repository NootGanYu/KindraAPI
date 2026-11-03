import { useEffect, useState } from 'react'
import { Form, Input, InputNumber, Modal, Select, Switch } from 'antd'
import type { DictionaryEntry, DictFieldType } from '@shared/types'
import { DICT_FIELD_TYPES } from '@shared/types'

interface Values {
  key: string; remarks?: string; field_type: DictFieldType; description?: string
  mock?: string; example_values?: string[]; default_value?: string | number
  nullable: boolean; enum_enabled: boolean; enum_values?: string[]; const_enabled: boolean; const_text?: string | number
  format?: string; minLength?: number; maxLength?: number; pattern?: string
  minimum?: number; maximum?: number; multipleOf?: number; precision?: number
  minItems?: number; maxItems?: number; uniqueItems?: boolean
}
const asText = (value: unknown): string => value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
function typedValue(value: string, type: DictFieldType): unknown {
  if (type === 'string') return value
  const parsed: unknown = JSON.parse(value)
  if (['any', 'allOf', 'anyOf', 'oneOf'].includes(type)) return parsed
  if (type === 'null' ? parsed !== null : type === 'integer' ? !Number.isInteger(parsed) : type === 'array' ? !Array.isArray(parsed) : type === 'object' ? !parsed || typeof parsed !== 'object' || Array.isArray(parsed) : typeof parsed !== type) throw Error(`请输入符合 ${type} 类型的值`)
  return parsed
}

export default function DictionaryEntryEditor({ open, entry, projectId, onClose, onSave }: {
  open: boolean; entry: DictionaryEntry | null; projectId: string; onClose: () => void
  onSave: (entry: DictionaryEntry) => Promise<void>
}): JSX.Element {
  const [form] = Form.useForm<Values>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const type = Form.useWatch('field_type', form) ?? 'string'
  const enumEnabled = Form.useWatch('enum_enabled', form)
  const constEnabled = Form.useWatch('const_enabled', form)
  const numeric = ['number', 'integer'].includes(type)
  const scalar = type === 'string' || numeric
  useEffect(() => {
    if (!open) return
    const schema = entry?.schema ?? {}
    setError('')
    form.resetFields()
    form.setFieldsValue({ key: entry?.key ?? '', remarks: entry?.remarks ?? '', field_type: entry?.field_type ?? 'string', description: entry?.description ?? '',
      mock: entry?.mock ?? asText(schema['x-mock']), example_values: Array.isArray(schema.examples) ? schema.examples.map(asText) : entry?.example_value ? [entry.example_value] : schema.example !== undefined ? [asText(schema.example)] : [], default_value: entry?.default_value ?? asText(schema.default),
      nullable: ['null', 'any'].includes(entry?.field_type ?? '') || schema.nullable === true || schema['x-nullable'] === true,
      enum_enabled: Array.isArray(schema.enum), enum_values: Array.isArray(schema.enum) ? schema.enum.map(asText) : [],
      const_enabled: Object.hasOwn(schema, 'const'), const_text: asText(schema.const),
      format: typeof schema.format === 'string' ? schema.format : undefined,
      pattern: typeof schema.pattern === 'string' ? schema.pattern : undefined,
      ...Object.fromEntries(['minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'minItems', 'maxItems'].filter(key => typeof schema[key] === 'number').map(key => [key, schema[key]])),
      precision: typeof schema['x-precision'] === 'number' ? schema['x-precision'] : undefined, uniqueItems: schema.uniqueItems === true })
  }, [open, entry, form])
  const submit = async (): Promise<void> => {
    if (busy) return
    try {
      const values = await form.validateFields()
      const sameType = entry?.field_type === values.field_type
      const valueEditable = scalar || values.field_type === 'boolean'
      const schema: Record<string, unknown> = { ...entry?.schema, type: values.field_type, nullable: ['null', 'any'].includes(values.field_type) || values.nullable }
      if (['any', 'allOf', 'anyOf', 'oneOf'].includes(values.field_type)) delete schema.type
      const constraints = values.field_type === 'string' ? ['format', 'minLength', 'maxLength', 'pattern'] : numeric ? ['format', 'minimum', 'maximum', 'multipleOf'] : values.field_type === 'array' ? ['minItems', 'maxItems', 'uniqueItems'] : []
      const editableRules = [...constraints, ...(scalar ? ['enum', 'const', 'example', 'examples'] : []), ...(valueEditable ? ['default', 'x-mock'] : []), ...(values.field_type === 'number' ? ['x-precision'] : [])]
      // A description edit must not erase rules whose controls are hidden for this type.
      const clearedRules = sameType ? editableRules : ['enum', 'const', 'format', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems', 'default', 'example', 'examples', 'x-mock', 'x-precision']
      for (const key of clearedRules) delete schema[key]
      if (scalar && values.enum_enabled) {
        const rows = values.enum_values ?? []
        if (!rows.length) throw Error('请至少填写一个枚举值')
        schema.enum = rows.map(value => typedValue(value, values.field_type))
      }
      if (scalar && values.const_enabled) schema.const = typedValue(String(values.const_text ?? ''), values.field_type)
      if ((scalar || values.field_type === 'boolean') && String(values.default_value ?? '').trim()) schema.default = typedValue(String(values.default_value), values.field_type)
      if (scalar && values.example_values?.length) schema.examples = values.example_values.map(value => typedValue(value, values.field_type))
      if (numeric && values.precision !== undefined) schema['x-precision'] = values.precision
      if ((scalar || values.field_type === 'boolean') && values.mock) schema['x-mock'] = values.mock
      for (const key of constraints) if (values[key as keyof Values] !== undefined && values[key as keyof Values] !== '') schema[key] = values[key as keyof Values]
      for (const [min, max] of [['minLength', 'maxLength'], ['minimum', 'maximum'], ['minItems', 'maxItems']]) if (typeof schema[min] === 'number' && typeof schema[max] === 'number' && (schema[min] as number) > (schema[max] as number)) throw Error('最小值不能大于最大值')
      if (typeof schema.pattern === 'string') new RegExp(schema.pattern)
      schema.description = values.description ?? ''
      const originalRules = entry?.schema?.['x-kindra-rules']
      if (originalRules && typeof originalRules === 'object' && !Array.isArray(originalRules)) {
        const rules: Record<string, unknown> = { ...originalRules, description: schema.description, nullable: schema.nullable }
        for (const key of ['enum', 'default', 'example']) {
          if (sameType && !editableRules.includes(key)) continue
          if (Object.hasOwn(schema, key)) rules[key] = schema[key]
          else delete rules[key]
        }
        if (Array.isArray(schema.examples) && schema.examples.length) rules.example = schema.examples[0]
        schema['x-kindra-rules'] = rules
      }
      setBusy(true); setError('')
      await onSave({ ...entry, id: entry?.id ?? '', project_id: projectId, key: values.key.trim(), field_type: values.field_type,
        description: values.description ?? '', remarks: values.remarks ?? '',
        default_value: sameType && !valueEditable ? entry.default_value ?? asText(schema.default) : asText(schema.default),
        example_value: sameType && !scalar ? entry.example_value ?? asText(schema.example) : Array.isArray(schema.examples) ? schema.examples.map(asText).join(', ') : '',
        mock: sameType && !valueEditable ? entry.mock ?? asText(schema['x-mock']) : asText(schema['x-mock']), schema,
        created_at: entry?.created_at ?? '', updated_at: entry?.updated_at ?? '' })
    } catch (error) {
      if (!(error as { errorFields?: unknown }).errorFields) setError((error as Error).message)
    } finally { setBusy(false) }
  }
  const number = (name: keyof Values, label: string, min?: number): JSX.Element => <Form.Item name={name} label={label}><InputNumber aria-label={label} min={min} placeholder="0" style={{ width: '100%' }} /></Form.Item>
  return <Modal centered title={entry ? '编辑' : '新建'} width={600} open={open} onCancel={onClose} onOk={() => void submit()} okText="确定" cancelText="取消" confirmLoading={busy} className="dictionary-entry-modal" destroyOnHidden>
    <Form form={form} layout="vertical" preserve={false}>
      <div className="dictionary-form-grid"><Form.Item name="key" label="参数名称" rules={[{ required: true, whitespace: true, message: '请输入参数名' }]}><Input placeholder="参数名称" /></Form.Item><Form.Item name="remarks" label="备注名"><Input placeholder="备注名" /></Form.Item></div>
      <Form.Item name="field_type"><Select virtual={false} aria-label="字典字段类型" onChange={value => form.setFieldsValue({ nullable: ['null', 'any'].includes(value), default_value: undefined, enum_enabled: false, const_enabled: false, const_text: undefined, example_values: [], format: undefined })} options={DICT_FIELD_TYPES.map(value => ({ value }))} /></Form.Item>
      <Form.Item name="nullable" label="是否为空" valuePropName="checked" className="dictionary-inline-switch"><Switch size="small" aria-label="是否为空" disabled={['null', 'any', 'allOf', 'anyOf', 'oneOf'].includes(type)} /></Form.Item>
      {scalar && <>
        <div className="dictionary-rule-switches"><Form.Item name="enum_enabled" label="枚举" valuePropName="checked"><Switch size="small" aria-label="枚举" onChange={enabled => enabled && form.setFieldValue('const_enabled', false)} /></Form.Item><Form.Item name="const_enabled" label="常量" valuePropName="checked"><Switch size="small" aria-label="常量" onChange={enabled => enabled && form.setFieldValue('enum_enabled', false)} /></Form.Item></div>
        {enumEnabled && <Form.Item name="enum_values"><Select mode="tags" aria-label="枚举值" placeholder="输入枚举值后按回车" open={false} /></Form.Item>}
        {constEnabled && <Form.Item name="const_text">{numeric ? <InputNumber aria-label="常量值" style={{ width: '100%' }} /> : <Input aria-label="常量值" />}</Form.Item>}
        <Form.Item name="mock" label="Mock"><Input placeholder="Mock" /></Form.Item>
        <Form.Item name="example_values" label="示例值"><Select mode="tags" aria-label="示例值" open={false} /></Form.Item>
        <div className="dictionary-form-grid"><Form.Item name="default_value" label="默认值">{numeric ? <InputNumber aria-label="默认值" style={{ width: '100%' }} /> : <Input placeholder="default" />}</Form.Item><Form.Item name="format" label="Format"><Select allowClear aria-label="Format" placeholder="Please select" options={(numeric ? (type === 'integer' ? ['int32', 'int64'] : ['float', 'double', 'float32', 'float64']) : ['date', 'date-time', 'time', 'duration', 'idn-email', 'email', 'hostname', 'idn-hostname', 'ipv4', 'ipv6', 'uri', 'uri-reference', 'iri', 'iri-reference', 'uuid', 'json-pointer', 'regex', 'password', 'binary', 'byte', 'char']).map(value => ({ value }))} /></Form.Item></div>
        {type === 'string' && <><div className="dictionary-form-grid">{number('minLength', '最小长度', 0)}{number('maxLength', '最大长度', 0)}</div><Form.Item name="pattern" label="Pattern"><Input placeholder="Pattern" /></Form.Item></>}
        {numeric && <><div className="dictionary-form-grid dictionary-form-thirds">{number('minimum', '最小值')}{number('maximum', '最大值')}{number('multipleOf', '倍数', 0)}</div>{type === 'number' && number('precision', '保留小数位数', 0)}</>}
      </>}
      {type === 'boolean' && <><Form.Item name="default_value" label="默认值"><Select aria-label="默认值" allowClear options={['true', 'false'].map(value => ({ value }))} /></Form.Item><Form.Item name="mock" label="Mock"><Input placeholder="Mock" /></Form.Item></>}
      {type === 'array' && <><Form.Item name="uniqueItems" label="元素唯一" valuePropName="checked" className="dictionary-inline-switch"><Switch size="small" aria-label="元素唯一" /></Form.Item><div className="dictionary-form-grid">{number('minItems', '最小元素个数', 0)}{number('maxItems', '最大元素个数', 0)}</div></>}
      <Form.Item name="description" label="字段描述"><Input.TextArea rows={2} placeholder="字段描述" /></Form.Item>
      {error && <div role="alert" className="dictionary-editor-error">{error}</div>}
    </Form>
  </Modal>
}
