import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import type { DictionaryEntry, DictionaryEntryView, DictionarySettings } from '@shared/types'
import { invalidateDictionaryCache } from './DictionarySuggest'

const TYPE_COLORS: Record<string, string> = {
  string: 'default',
  number: 'blue',
  integer: 'geekblue',
  boolean: 'purple',
  object: 'gold',
  array: 'cyan'
}

const TYPE_OPTIONS = ['string', 'number', 'integer', 'boolean', 'object', 'array'].map((value) => ({
  value,
  label: value
}))

interface Props {
  projectId: string
  actionToken?: number
}

export default function DictionaryPanel({ projectId, actionToken = 0 }: Props): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const [entries, setEntries] = useState<DictionaryEntryView[]>([])
  const [settings, setSettings] = useState<DictionarySettings>({ builtin_enabled: true })
  const [source, setSource] = useState<'custom' | 'builtin'>('custom')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<DictionaryEntry | null>(null)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm<DictionaryEntry>()

  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      const [list, current] = await Promise.all([
        window.api.dictionary.list(projectId),
        window.api.dictionary.getSettings(projectId)
      ])
      if (!list.ok) throw new Error(list.error)
      if (!current.ok) throw new Error(current.error)
      setEntries(list.data)
      setSettings(current.data)
    } catch (error) {
      message.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (actionToken > 0) openCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionToken])

  const openCreate = (): void => {
    setSource('custom')
    setEditing(null)
    form.setFieldsValue({
      key: '',
      field_type: 'string',
      description: '',
      remarks: '',
      default_value: ''
    })
    setOpen(true)
  }

  const openEdit = (entry: DictionaryEntryView): void => {
    setEditing(entry)
    form.setFieldsValue({
      key: entry.key,
      field_type: entry.field_type,
      description: entry.description,
      remarks: entry.remarks ?? '',
      default_value: entry.default_value ?? ''
    })
    setOpen(true)
  }

  const filtered = useMemo(() => {
    const current = source === 'custom' ? 'custom' : 'builtin'
    const text = keyword.trim().toLowerCase()
    return entries
      .filter((entry) => entry.source === current)
      .filter(
        (entry) =>
          !text ||
          entry.key.toLowerCase().includes(text) ||
          entry.description.toLowerCase().includes(text)
      )
  }, [entries, source, keyword])

  const doSave = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      const result = await window.api.dictionary.save(projectId, {
        ...(editing ?? {}),
        ...values,
        id: editing?.id ?? '',
        project_id: projectId
      } as DictionaryEntry)
      if (!result.ok) throw new Error(result.error)
      invalidateDictionaryCache(projectId)
      setOpen(false)
      await reload()
      message.success(editing ? '已更新' : '已新建')
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return
      message.error((error as Error).message)
    }
  }

  const submit = async (): Promise<void> => {
    let values: DictionaryEntry
    try {
      values = (await form.validateFields()) as DictionaryEntry
    } catch {
      return
    }
    const duplicate = entries.find(
      (entry) =>
        entry.source === 'custom' &&
        entry.key.trim() === String(values.key).trim() &&
        entry.id !== editing?.id
    )
    if (duplicate) {
      modal.confirm({
        title: '已存在同名条目',
        content: `自定义字典中已有「${duplicate.key}」，仍要保存吗？`,
        okText: '仍然保存',
        cancelText: '取消',
        onOk: () => void doSave()
      })
      return
    }
    await doSave()
  }

  const remove = (entry: DictionaryEntryView): void => {
    modal.confirm({
      title: `删除自定义描述「${entry.key}」？`,
      content: '删除后联想与列表会同步更新，此操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.api.dictionary.delete(projectId, entry.id)
        if (!result.ok) {
          message.error(result.error)
          return
        }
        invalidateDictionaryCache(projectId)
        await reload()
        message.success('已删除')
      }
    })
  }

  const toggleBuiltin = async (checked: boolean): Promise<void> => {
    const result = await window.api.dictionary.saveSettings(projectId, { builtin_enabled: checked })
    if (!result.ok) {
      message.error(result.error)
      return
    }
    invalidateDictionaryCache(projectId)
    setSettings({ builtin_enabled: checked })
    message.success(checked ? '已开启系统内置描述联想' : '已关闭系统内置描述联想')
  }

  const columns = [
    {
      title: '参数名称',
      dataIndex: 'key',
      key: 'key',
      width: 260,
      render: (value: string, entry: DictionaryEntryView) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontWeight: 500 }}>
            {value}
          </span>
          <Tag bordered={false} color={TYPE_COLORS[entry.field_type] ?? 'default'}>
            {entry.field_type}
          </Tag>
        </div>
      )
    },
    {
      title: '参数描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    },
    {
      title: '备注',
      dataIndex: 'remarks',
      key: 'remarks',
      width: 180,
      ellipsis: true,
      render: (value?: string) => value || <span className="muted">—</span>
    },
    {
      title: '默认值',
      dataIndex: 'default_value',
      key: 'default_value',
      width: 140,
      ellipsis: true,
      render: (value?: string) => value || <span className="muted">—</span>
    },
    ...(source === 'custom'
      ? [
          {
            title: '操作',
            key: 'actions',
            width: 100,
            render: (_: unknown, entry: DictionaryEntryView) => (
              <div style={{ display: 'flex', gap: 4 }}>
                <Tooltip title="编辑">
                  <button className="icon-btn" onClick={() => openEdit(entry)}>
                    <EditOutlined />
                  </button>
                </Tooltip>
                <Tooltip title="删除">
                  <button className="icon-btn" onClick={() => remove(entry)}>
                    <DeleteOutlined />
                  </button>
                </Tooltip>
              </div>
            )
          }
        ]
      : [])
  ]

  return (
    <div className="dict-panel">
      <div className="dict-head">
        <div className="segmented">
          <button className={source === 'custom' ? 'active' : ''} onClick={() => { setSource('custom'); setPage(1) }}>
            自定义
          </button>
          <button className={source === 'builtin' ? 'active' : ''} onClick={() => { setSource('builtin'); setPage(1) }}>
            系统内置
          </button>
        </div>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#a2967f' }} />}
          placeholder="搜索参数名称或参数描述"
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value)
            setPage(1)
          }}
          style={{ width: 300 }}
        />
        <span style={{ flex: 1 }} />
        {source === 'builtin' ? (
          <span className="dict-switch">
            <span className="muted">开启系统内置描述</span>
            <Switch
              size="small"
              checked={settings.builtin_enabled}
              onChange={(checked) => void toggleBuiltin(checked)}
            />
          </span>
        ) : (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建字段描述
          </Button>
        )}
      </div>

      <div className="dict-note">
        {source === 'custom'
          ? '自定义描述参与所有参数与模型字段的联想。'
          : '系统内置描述为只读常量；关闭开关后仅停止联想，仍可在此查看。'}
      </div>

      <Table<DictionaryEntryView>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        pagination={{
          current: page,
          pageSize: 10,
          total: filtered.length,
          showSizeChanger: false,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (next) => setPage(next)
        }}
        scroll={{ y: 'calc(100vh - 330px)' }}
      />

      <Modal
        title={editing ? '编辑字段描述' : '新建字段描述'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText={editing ? '保存' : '新建'}
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="key"
            label="参数名称"
            rules={[{ required: true, message: '请输入参数名称' }]}
          >
            <Input placeholder="例如 user_id" />
          </Form.Item>
          <Form.Item name="field_type" label="类型" rules={[{ required: true }]}>
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
            rules={[{ required: true, message: '请输入参数描述' }]}
          >
            <Input placeholder="例如 用户 ID" />
          </Form.Item>
          <Form.Item name="remarks" label="备注">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="default_value" label="默认值">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
