import { useMemo } from 'react'
import { Checkbox, Input, InputNumber, Select, Tag, Tooltip } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  PlusSquareOutlined
} from '@ant-design/icons'
import type { ModelSchema, ModelSummary } from '@shared/types'
import DictionarySuggest from './DictionarySuggest'
import {
  MODEL_REF_PREFIX,
  defaultValueText,
  orderedKeys,
  parseDefaultValue,
  schemaTypeOf,
  uniqueFieldKey
} from './modelUtils'

const TYPE_OPTIONS = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'integer', label: 'integer' },
  { value: 'boolean', label: 'boolean' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'array' },
  { value: 'ref', label: '引用模型' }
]

const MAX_DEPTH = 10

interface Props {
  projectId: string
  schema: ModelSchema
  models: ModelSummary[]
  onChange: (schema: ModelSchema) => void
  disabled?: boolean
}

export default function SchemaFieldEditor({
  projectId,
  schema,
  models,
  onChange,
  disabled
}: Props): JSX.Element {
  const updateRoot = (patch: Partial<ModelSchema>): void => {
    onChange({ ...schema, type: 'object', ...patch })
  }

  const addChild = (): void => {
    const key = uniqueFieldKey(schema, `field${Object.keys(schema.properties ?? {}).length + 1}`)
    const properties: Record<string, ModelSchema> = {
      ...(schema.properties ?? {}),
      [key]: { type: 'string' }
    }
    const orders = [...orderedKeys(schema), key]
    onChange({
      ...schema,
      type: 'object',
      properties,
      'x-schema-orders': orders
    })
  }

  return (
    <div className="schema-editor">
      <div className="schema-root-row">
        <Tag bordered={false} color="gold">object</Tag>
        <span className="mono schema-root-name">root</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <DictionarySuggest
            projectId={projectId}
            value={schema.description ?? ''}
            onChange={(value) => updateRoot({ description: value })}
            placeholder="模型根节点描述"
            size="small"
            disabled={disabled}
          />
        </div>
        <button className="schema-add-btn" onClick={addChild} disabled={disabled}>
          <PlusOutlined /> 添加字段
        </button>
      </div>

      <div className="schema-field-head">
        <span style={{ width: 170 }}>字段名</span>
        <span style={{ width: 120 }}>类型</span>
        <span style={{ width: 54, textAlign: 'center' }}>必填</span>
        <span style={{ width: 76, textAlign: 'center' }}>可空</span>
        <span style={{ width: 130 }}>默认值</span>
        <span style={{ width: 170 }}>枚举</span>
        <span style={{ flex: 1, minWidth: 160 }}>描述</span>
        <span style={{ width: 170 }}>引用模型</span>
        <span style={{ width: 54 }}>Mock</span>
        <span style={{ width: 74 }} />
      </div>

      {orderedKeys(schema).length === 0 ? (
        <div className="schema-empty">还没有字段，点击右上角「添加字段」开始定义结构。</div>
      ) : (
        orderedKeys(schema).map((key, index) => (
          <NodeRow
            key={index}
            projectId={projectId}
            name={key}
            schema={schema.properties?.[key] ?? { type: 'string' }}
            required={(schema.required ?? []).includes(key)}
            models={models}
            depth={0}
            disabled={disabled}
            canMoveUp={index > 0}
            canMoveDown={index < orderedKeys(schema).length - 1}
            onChange={(next, nextRequired) => {
              const properties = { ...(schema.properties ?? {}), [key]: next }
              const required = new Set(schema.required ?? [])
              if (nextRequired) required.add(key)
              else required.delete(key)
              onChange({ ...schema, type: 'object', properties, required: [...required] })
            }}
            onRename={(nextName) => {
              if (nextName !== key && (schema.properties ?? {})[nextName]) return
              const properties: Record<string, ModelSchema> = {}
              for (const [name, value] of Object.entries(schema.properties ?? {})) {
                properties[name === key ? nextName : name] = value
              }
              const orders = orderedKeys(schema).map((item) => (item === key ? nextName : item))
              const required = (schema.required ?? []).map((item) => (item === key ? nextName : item))
              onChange({ ...schema, type: 'object', properties, required, 'x-schema-orders': orders })
            }}
            onRemove={() => {
              const properties = { ...(schema.properties ?? {}) }
              delete properties[key]
              const required = (schema.required ?? []).filter((item) => item !== key)
              const orders = orderedKeys(schema).filter((item) => item !== key)
              onChange({ ...schema, type: 'object', properties, required, 'x-schema-orders': orders })
            }}
            onMove={(delta) => {
              const orders = [...orderedKeys(schema)]
              const position = orders.indexOf(key)
              const target = position + delta
              if (position < 0 || target < 0 || target >= orders.length) return
              ;[orders[position], orders[target]] = [orders[target], orders[position]]
              onChange({ ...schema, 'x-schema-orders': orders })
            }}
          />
        ))
      )}
    </div>
  )
}

interface NodeRowProps {
  projectId: string
  name: string
  schema: ModelSchema
  required: boolean
  models: ModelSummary[]
  depth: number
  disabled?: boolean
  hideName?: boolean
  hideRequired?: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  onChange: (schema: ModelSchema, required: boolean) => void
  onRename?: (name: string) => void
  onRemove?: () => void
  onMove?: (delta: number) => void
}

function NodeRow({
  projectId,
  name,
  schema,
  required,
  models,
  depth,
  disabled,
  hideName,
  hideRequired,
  canMoveUp,
  canMoveDown,
  onChange,
  onRename,
  onRemove,
  onMove
}: NodeRowProps): JSX.Element {
  const type = schemaTypeOf(schema)
  const indent = Math.min(depth, MAX_DEPTH) * 16

  const modelOptions = useMemo(
    () => models.filter((model) => model.model_type === 'model'),
    [models]
  )

  const patch = (next: Partial<ModelSchema>): void => {
    onChange({ ...schema, ...next }, required)
  }

  const changeType = (nextType: string): void => {
    if (nextType === 'ref') {
      if (modelOptions.length === 0) return
      onChange(
        {
          description: schema.description ?? '',
          $ref: `${MODEL_REF_PREFIX}${modelOptions[0].model_id}`
        },
        required
      )
      return
    }
    const base: ModelSchema = {
      description: schema.description ?? '',
      type: nextType as ModelSchema['type']
    }
    if (schema.example !== undefined) base.example = schema.example
    if (nextType === 'object') {
      base.properties = schema.properties ?? {}
      base['x-schema-orders'] = orderedKeys(schema)
      if (schema.required?.length) base.required = schema.required
    }
    if (nextType === 'array') {
      base.items = schema.items ?? { type: 'string' }
    }
    if (['string', 'number', 'integer', 'boolean'].includes(nextType)) {
      if (schema.default !== undefined) base.default = schema.default
      if (schema.enum !== undefined) base.enum = schema.enum
    }
    if (schema['x-nullable']) base['x-nullable'] = true
    onChange(base, required)
  }

  const setDefault = (raw: string): void => {
    const next = { ...schema }
    const parsed = parseDefaultValue(raw, schema.type)
    if (parsed === undefined) delete next.default
    else next.default = parsed
    onChange(next, required)
  }

  const setEnum = (values: string[]): void => {
    const next = { ...schema }
    if (values.length === 0) delete next.enum
    else {
      next.enum =
        schema.type === 'number' || schema.type === 'integer'
          ? values.map((value) => {
              const numeric = Number(value)
              return Number.isFinite(numeric) ? numeric : value
            })
          : values
    }
    onChange(next, required)
  }

  const children = orderedKeys(schema)

  const addChild = (): void => {
    const key = uniqueFieldKey(schema, `field${children.length + 1}`)
    const properties: Record<string, ModelSchema> = {
      ...(schema.properties ?? {}),
      [key]: { type: 'string' }
    }
    onChange(
      {
        ...schema,
        type: 'object',
        properties,
        'x-schema-orders': [...children, key]
      },
      required
    )
  }

  const enumValues = (schema.enum ?? []).map((value) => String(value))
  const isNumeric = schema.type === 'number' || schema.type === 'integer'

  return (
    <div className="schema-node">
      <div className="schema-field-row" style={{ paddingLeft: indent }}>
        <span className="schema-col-name" style={{ width: 170 }}>
          {hideName ? (
            <span className="mono muted">{name}</span>
          ) : (
            <Input
              size="small"
              value={name}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value.trim()
                if (!next) return
                onRename?.(next)
              }}
              placeholder="字段名"
            />
          )}
        </span>
        <span style={{ width: 120 }}>
          <Select
            size="small"
            value={type}
            disabled={disabled}
            onChange={changeType}
            style={{ width: '100%' }}
            options={
              modelOptions.length === 0
                ? TYPE_OPTIONS.filter((item) => item.value !== 'ref')
                : TYPE_OPTIONS
            }
          />
        </span>
        <span style={{ width: 54, display: 'grid', placeItems: 'center' }}>
          {hideRequired ? (
            <span className="muted">—</span>
          ) : (
            <Checkbox
              checked={required}
              disabled={disabled}
              onChange={(event) => onChange({ ...schema }, event.target.checked)}
            />
          )}
        </span>
        <span style={{ width: 76, display: 'grid', placeItems: 'center' }}>
          <Tooltip title="允许为 null">
            <Checkbox
              checked={Boolean(schema['x-nullable'])}
              disabled={disabled}
              onChange={(event) => {
                const next = { ...schema }
                if (event.target.checked) next['x-nullable'] = true
                else delete next['x-nullable']
                onChange(next, required)
              }}
            />
          </Tooltip>
        </span>
        <span style={{ width: 130 }}>
          {type === 'object' || type === 'array' ? (
            <Input size="small" value="" disabled placeholder="—" />
          ) : type === 'boolean' ? (
            <Select
              size="small"
              style={{ width: '100%' }}
              value={schema.default === undefined ? '' : String(schema.default)}
              disabled={disabled}
              onChange={(value) => setDefault(value)}
              options={[
                { value: '', label: '未设置' },
                { value: 'true', label: 'true' },
                { value: 'false', label: 'false' }
              ]}
            />
          ) : isNumeric ? (
            <InputNumber
              size="small"
              style={{ width: '100%' }}
              value={typeof schema.default === 'number' ? schema.default : undefined}
              disabled={disabled}
              onChange={(value) => {
                const next = { ...schema }
                if (value === null || value === undefined) delete next.default
                else next.default = value
                onChange(next, required)
              }}
              placeholder="未设置"
            />
          ) : (
            <Input
              size="small"
              value={defaultValueText(schema.default)}
              disabled={disabled}
              onChange={(event) => setDefault(event.target.value)}
              placeholder="未设置"
            />
          )}
        </span>
        <span style={{ width: 170 }}>
          {type === 'object' || type === 'array' ? (
            <Input size="small" value="" disabled placeholder="—" />
          ) : (
            <Select
              size="small"
              mode="tags"
              style={{ width: '100%' }}
              value={enumValues}
              disabled={disabled}
              onChange={setEnum}
              placeholder="回车添加"
              maxTagCount={1}
            />
          )}
        </span>
        <span style={{ flex: 1, minWidth: 160 }}>
          <DictionarySuggest
            projectId={projectId}
            value={schema.description ?? ''}
            onChange={(value) => patch({ description: value })}
            size="small"
            disabled={disabled}
          />
        </span>
        <span style={{ width: 170 }}>
          <Select
            size="small"
            allowClear
            style={{ width: '100%' }}
            placeholder="不引用"
            value={schema.$ref ? schema.$ref.split('/').pop() : undefined}
            disabled={disabled || modelOptions.length === 0}
            onChange={(value?: string) => {
              const next = { ...schema }
              if (!value) {
                delete next.$ref
                next.type = 'object'
                next.properties = {}
                next['x-schema-orders'] = []
              } else {
                next.$ref = `${MODEL_REF_PREFIX}${value}`
              }
              onChange(next, required)
            }}
            options={modelOptions.map((model) => ({
              value: model.model_id,
              label: model.name
            }))}
            showSearch
            optionFilterProp="label"
          />
        </span>
        <span style={{ width: 54, display: 'grid', placeItems: 'center' }}>
          <Input size="small" value="" disabled placeholder="—" />
        </span>
        <span style={{ width: 74, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          {onMove ? (
            <>
              <button
                className="icon-btn"
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
                title="上移"
              >
                <ArrowUpOutlined />
              </button>
              <button
                className="icon-btn"
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
                title="下移"
              >
                <ArrowDownOutlined />
              </button>
            </>
          ) : null}
          {onRemove ? (
            <button className="icon-btn" onClick={onRemove} title="删除字段" disabled={disabled}>
              <DeleteOutlined />
            </button>
          ) : null}
        </span>
      </div>

      {depth >= MAX_DEPTH && (type === 'object' || type === 'array') ? (
        <div className="schema-depth-warning" style={{ paddingLeft: indent + 12 }}>
          嵌套层级过深，已停止展开
        </div>
      ) : null}

      {type === 'array' && depth < MAX_DEPTH ? (
        <div className="schema-array-items" style={{ paddingLeft: indent + 12 }}>
          <span className="muted" style={{ fontSize: 11 }}>数组元素</span>
          <NodeRow
            projectId={projectId}
            name="items"
            schema={schema.items ?? { type: 'string' }}
            required={false}
            models={models}
            depth={depth + 1}
            disabled={disabled}
            hideName
            hideRequired
            onChange={(next) => onChange({ ...schema, items: next }, required)}
          />
        </div>
      ) : null}

      {type === 'object' && depth < MAX_DEPTH ? (
        <div>
          {children.map((key, index) => (
            <NodeRow
              key={index}
              projectId={projectId}
              name={key}
              schema={schema.properties?.[key] ?? { type: 'string' }}
              required={(schema.required ?? []).includes(key)}
              models={models}
              depth={depth + 1}
              disabled={disabled}
              canMoveUp={index > 0}
              canMoveDown={index < children.length - 1}
              onChange={(next, nextRequired) => {
                const properties = { ...(schema.properties ?? {}), [key]: next }
                const requiredList = new Set(schema.required ?? [])
                if (nextRequired) requiredList.add(key)
                else requiredList.delete(key)
                onChange({ ...schema, properties, required: [...requiredList] }, required)
              }}
              onRename={(nextName) => {
                if (nextName !== key && (schema.properties ?? {})[nextName]) return
                const properties: Record<string, ModelSchema> = {}
                for (const [fieldName, field] of Object.entries(schema.properties ?? {})) {
                  properties[fieldName === key ? nextName : fieldName] = field
                }
                const orders = children.map((item) => (item === key ? nextName : item))
                const requiredList = (schema.required ?? []).map((item) =>
                  item === key ? nextName : item
                )
                onChange(
                  { ...schema, properties, required: requiredList, 'x-schema-orders': orders },
                  required
                )
              }}
              onRemove={() => {
                const properties = { ...(schema.properties ?? {}) }
                delete properties[key]
                onChange(
                  {
                    ...schema,
                    properties,
                    required: (schema.required ?? []).filter((item) => item !== key),
                    'x-schema-orders': children.filter((item) => item !== key)
                  },
                  required
                )
              }}
              onMove={(delta) => {
                const orders = [...children]
                const position = orders.indexOf(key)
                const target = position + delta
                if (position < 0 || target < 0 || target >= orders.length) return
                ;[orders[position], orders[target]] = [orders[target], orders[position]]
                onChange({ ...schema, 'x-schema-orders': orders }, required)
              }}
            />
          ))}
          <div className="schema-child-add" style={{ paddingLeft: indent + 16 }}>
            <button className="schema-add-btn" onClick={addChild} disabled={disabled}>
              <PlusSquareOutlined /> 添加子字段
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
