import { Button, Input, Select, Tooltip } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { MqttUserProperty } from '@shared/mqtt'

interface Props {
  value: MqttUserProperty[] | undefined
  onChange: (next: MqttUserProperty[]) => void
  disabled?: boolean
  hint?: string
}

export default function UserPropertiesEditor({
  value,
  onChange,
  disabled,
  hint
}: Props): JSX.Element {
  const list = value ?? []
  const update = (index: number, patch: Partial<MqttUserProperty>): void => {
    onChange(list.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  return (
    <div className="mqtt-user-props">
      {hint ? <div className="mqtt-field-hint">{hint}</div> : null}
      {list.length === 0 ? <div className="mqtt-field-hint">暂无 User Property</div> : null}
      {list.map((item, index) => (
        <div className="mqtt-user-prop-row" key={index}>
          <Input
            size="small"
            placeholder="key"
            value={item.key}
            disabled={disabled}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <Input
            size="small"
            placeholder="value"
            value={item.value}
            disabled={disabled}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          {disabled ? (
            <Select
              size="small"
              value="disabled"
              disabled
              options={[{ value: 'disabled', label: '禁用' }]}
              style={{ width: 74 }}
            />
          ) : (
            <Tooltip title="删除">
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => onChange(list.filter((_, i) => i !== index))}
              />
            </Tooltip>
          )}
        </div>
      ))}
      <Button
        size="small"
        type="dashed"
        icon={<PlusOutlined />}
        disabled={disabled}
        onClick={() => onChange([...list, { key: '', value: '' }])}
      >
        添加属性
      </Button>
    </div>
  )
}
