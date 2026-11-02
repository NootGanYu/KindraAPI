import { useEffect, useState } from 'react'
import { Input, InputNumber, Select } from 'antd'
import type { CustomAttribute, Target } from '@shared/types'

type AttributeValue = NonNullable<Target['custom_attributes']>[string]

interface Props {
  projectId?: string
  value?: Target['custom_attributes']
  onChange: (next: Record<string, AttributeValue>) => void
}

export default function CustomAttributeFields({
  projectId,
  value,
  onChange
}: Props): JSX.Element | null {
  const [attributes, setAttributes] = useState<CustomAttribute[]>([])

  useEffect(() => {
    if (!projectId) return
    let active = true
    void window.api.attributes.list(projectId).then((result) => {
      if (active && result.ok) setAttributes(result.data.filter((item) => item.enable))
    })
    return () => {
      active = false
    }
  }, [projectId])

  if (!attributes.length) return null

  const current = value ?? {}
  const patch = (attributeId: string, next: AttributeValue): void => {
    onChange({ ...current, [attributeId]: next })
  }

  return (
    <>
      <div className="section-title" style={{ marginTop: 20 }}>
        接口属性
      </div>
      <div>
      {attributes.map((attribute) => {
        const raw = current[attribute.attribute_id]
        const field = (() => {
          switch (attribute.field_type) {
            case 'number':
              return (
                <InputNumber
                  style={{ width: '100%' }}
                  value={typeof raw === 'number' ? raw : undefined}
                  onChange={(next) => patch(attribute.attribute_id, next ?? null)}
                />
              )
            case 'radio':
              return (
                <Select
                  allowClear
                  style={{ width: '100%' }}
                  value={typeof raw === 'string' && raw ? raw : undefined}
                  placeholder="请选择"
                  options={attribute.extra.map((option) => ({
                    value: option.value || option.label,
                    label: option.label || option.value
                  }))}
                  onChange={(next) => patch(attribute.attribute_id, next ?? null)}
                />
              )
            case 'checkbox':
              return (
                <Select
                  mode="multiple"
                  allowClear
                  style={{ width: '100%' }}
                  value={Array.isArray(raw) ? raw : []}
                  placeholder="请选择"
                  options={attribute.extra.map((option) => ({
                    value: option.value || option.label,
                    label: option.label || option.value
                  }))}
                  onChange={(next) => patch(attribute.attribute_id, next)}
                />
              )
            case 'date':
              return (
                <Input
                  type="date"
                  value={typeof raw === 'string' ? raw : ''}
                  onChange={(event) => patch(attribute.attribute_id, event.target.value || null)}
                />
              )
            case 'email':
            case 'link':
            case 'text':
            default:
              return (
                <Input
                  value={typeof raw === 'string' ? raw : ''}
                  placeholder={attribute.field_type === 'link' ? 'https://' : ''}
                  onChange={(event) => patch(attribute.attribute_id, event.target.value || null)}
                />
              )
          }
        })()

        return (
          <div
            key={attribute.attribute_id}
            style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}
          >
            <div style={{ width: 120, color: 'var(--muted, #8a7a5e)', fontSize: 12 }}>
              {attribute.field_name}
            </div>
            <div style={{ flex: 1 }}>{field}</div>
          </div>
        )
      })}
      </div>
    </>
  )
}
