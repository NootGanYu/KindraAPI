import { useCallback, useEffect, useState } from 'react'
import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type { CustomAttribute, CustomAttributeOption, CustomAttributeType } from '@shared/types'
import { createCustomAttribute } from '@shared/factories'
import {
  CUSTOM_ATTRIBUTE_TYPES,
  CUSTOM_ATTRIBUTE_TYPE_LABELS
} from '@shared/customAttributes'

const TYPE_OPTIONS = CUSTOM_ATTRIBUTE_TYPES.map((value) => ({
  value,
  label: CUSTOM_ATTRIBUTE_TYPE_LABELS[value]
}))

const TYPE_LABEL = CUSTOM_ATTRIBUTE_TYPE_LABELS

interface FormValues {
  field_name: string
  field_type: CustomAttributeType
  extra?: CustomAttributeOption[]
}

interface Props {
  projectId?: string
}

export default function CustomAttributesPanel({ projectId }: Props): JSX.Element {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<FormValues>()
  const [items, setItems] = useState<CustomAttribute[]>([])
  const [editing, setEditing] = useState<CustomAttribute | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const fieldType = Form.useWatch('field_type', form)

  const reload = useCallback(async (): Promise<void> => {
    if (!projectId) return
    const result = await window.api.attributes.list(projectId)
    if (result.ok) setItems(result.data)
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  const openCreate = (): void => {
    setEditing(null)
    form.setFieldsValue({ field_name: '', field_type: 'text', extra: [] })
    setOpen(true)
  }

  const openEdit = (attribute: CustomAttribute): void => {
    setEditing(attribute)
    form.setFieldsValue({
      field_name: attribute.field_name,
      field_type: attribute.field_type,
      extra: attribute.extra.length ? attribute.extra : []
    })
    setOpen(true)
  }

  const save = async (): Promise<void> => {
    if (!projectId) return
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const base = editing ?? createCustomAttribute(projectId)
    const next: CustomAttribute = {
      ...base,
      field_name: values.field_name.trim(),
      field_type: values.field_type,
      extra: (values.extra ?? []).filter((option) => option?.label || option?.value)
    }
    setSaving(true)
    try {
      const result = await window.api.attributes.save(projectId, next)
      if (!result.ok) {
        message.error(result.error)
        return
      }
      message.success('属性已保存')
      setOpen(false)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  const toggleEnable = async (attribute: CustomAttribute, enable: boolean): Promise<void> => {
    if (!projectId) return
    const result = await window.api.attributes.save(projectId, { ...attribute, enable })
    if (!result.ok) message.error(result.error)
    await reload()
  }

  const remove = async (attribute: CustomAttribute): Promise<void> => {
    if (!projectId) return
    const result = await window.api.attributes.remove(projectId, attribute.attribute_id)
    if (!result.ok) message.error(result.error)
    else message.success('属性已删除')
    await reload()
  }

  const needsOptions = fieldType === 'radio' || fieldType === 'checkbox'

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12
        }}
      >
        <div>
          <div className="section-title" style={{ margin: 0 }}>
            接口属性
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            为接口补充负责人、优先级等业务字段；分享文档时可选择展示哪些属性。
          </div>
        </div>
        <Button size="small" icon={<PlusOutlined />} onClick={openCreate}>
          新建属性
        </Button>
      </div>
      <Table<CustomAttribute>
        size="small"
        rowKey="attribute_id"
        pagination={false}
        dataSource={items}
        locale={{ emptyText: '还没有接口属性' }}
        columns={[
          { title: '名称', dataIndex: 'field_name', width: 160 },
          {
            title: '类型',
            dataIndex: 'field_type',
            width: 110,
            render: (value: CustomAttributeType) => TYPE_LABEL[value] ?? value
          },
          ...(items.some((item) => item.field_type === 'radio' || item.field_type === 'checkbox')
            ? [
                {
                  title: '选项',
                  key: 'extra',
                  render: (_: unknown, record: CustomAttribute) =>
                    record.extra.length
                      ? record.extra.map((option) => option.label || option.value).join(' / ')
                      : '—'
                }
              ]
            : []),
          {
            title: '启用',
            dataIndex: 'enable',
            width: 80,
            render: (value: boolean, record: CustomAttribute) => (
              <Switch
                size="small"
                checked={value}
                onChange={(checked) => void toggleEnable(record, checked)}
              />
            )
          },
          {
            title: '操作',
            key: 'operation',
            width: 110,
            render: (_: unknown, record: CustomAttribute) => (
              <Space size={4}>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => openEdit(record)}
                />
                <Popconfirm
                  title="删除该属性？"
                  description="已填写该属性的接口值会保留但不再展示。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => void remove(record)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={editing ? '编辑属性' : '新建属性'}
        open={open}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="field_name"
            label="属性名称"
            rules={[{ required: true, message: '请输入属性名称' }]}
          >
            <Input maxLength={30} placeholder="例如：负责人" />
          </Form.Item>
          <Form.Item
            name="field_type"
            label="属性类型"
            rules={[{ required: true, message: '请选择属性类型' }]}
          >
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          {needsOptions ? (
            <Form.Item label="选项" required>
              <Form.List name="extra">
                {(fields, { add, remove: removeField }) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {fields.map((field) => (
                      <Space key={field.key} align="baseline">
                        <Form.Item
                          name={[field.name, 'label']}
                          rules={[{ required: true, message: '请输入选项名' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="显示名" style={{ width: 180 }} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'value']} style={{ marginBottom: 0 }}>
                          <Input placeholder="值（默认同显示名）" style={{ width: 180 }} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'key']} hidden>
                          <Input />
                        </Form.Item>
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => removeField(field.name)}
                        />
                      </Space>
                    ))}
                    <div>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => add({ label: '', value: '' })}>
                        添加选项
                      </Button>
                    </div>
                  </div>
                )}
              </Form.List>
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </div>
  )
}
