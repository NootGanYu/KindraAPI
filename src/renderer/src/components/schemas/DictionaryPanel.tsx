import { useEffect, useMemo, useState } from 'react'
import { App as AntApp, Button, Input, Switch, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, EditOutlined, ImportOutlined, PlusOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons'
import type { DictionaryEntry, DictionaryEntryView, DictionarySettings } from '@shared/types'
import { invalidateDictionaryCache } from './dictionarySuggestions'
import DictionaryEntryEditor from './DictionaryEntryEditor'
import DictionaryImport from './DictionaryImport'

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
  const [selected, setSelected] = useState<React.Key[]>([])
  const [importOpen, setImportOpen] = useState(false)

  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      const [list, current] = await Promise.all([
        window.api.dictionary.list(projectId),
        window.api.dictionary.getSettings(projectId)
      ])
      if (!list.ok) throw new Error(list.error)
      if (!current.ok) throw new Error(current.error)
      invalidateDictionaryCache(projectId)
      setEntries(list.data)
      setSelected(keys => keys.filter(key => list.data.some(entry => entry.id === key)))
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
    setOpen(true)
  }

  const openEdit = (entry: DictionaryEntryView): void => {
    setEditing(entry)
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

  useEffect(() => { setPage(current => Math.min(current, Math.max(1, Math.ceil(filtered.length / 10)))) }, [filtered.length])

  const save = async (entry: DictionaryEntry): Promise<void> => {
    const result = await window.api.dictionary.save(projectId, entry)
    if (!result.ok) throw new Error(result.error)
    invalidateDictionaryCache(projectId)
    setOpen(false)
    await reload()
    message.success(editing ? '已更新' : '已新建')
  }

  const remove = (entry: DictionaryEntryView): void => {
    modal.confirm({
      title: '确定删除该条描述吗？',
      okText: '确定',
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

  const saveTemporary = async (ids?: string[]): Promise<void> => {
    const result = await window.api.dictionary.saveTemporary(projectId, ids)
    if (!result.ok) { message.error(result.error); return }
    invalidateDictionaryCache(projectId)
    await reload()
    message.success(result.data.length ? '保存成功' : '暂无临时数据')
  }

  const removeSelected = (): void => {
    modal.confirm({ title: '是否确定删除？', okText: '确定', cancelText: '取消', onOk: async () => {
      const result = await window.api.dictionary.deleteMany(projectId, selected.map(String))
      if (!result.ok) { message.error(result.error); throw Error(result.error) }
      invalidateDictionaryCache(projectId)
      await reload()
      message.success('已删除')
    } })
  }

  const columns: ColumnsType<DictionaryEntryView> = source === 'builtin' ? [
    { title: '参数名称', dataIndex: 'key', width: 260, render: (value: string, entry) => <div className="dict-builtin-name"><span>{value}</span><small>{entry.field_type}</small></div> },
    { title: '参数描述', dataIndex: 'description' }
  ] : [
    { title: '参数名称', dataIndex: 'key', width: 180, ellipsis: true },
    { title: '备注名', dataIndex: 'remarks', width: 140, ellipsis: true },
    { title: '字段类型', dataIndex: 'field_type', width: 100 },
    { title: '默认值', dataIndex: 'default_value', width: 130, ellipsis: true },
    { title: '示例值', dataIndex: 'example_value', width: 130, ellipsis: true },
    { title: 'Mock规则', dataIndex: 'mock', width: 140, ellipsis: true },
    { title: '参数描述', dataIndex: 'description', width: 200, ellipsis: true },
    { title: '状态', key: 'status', width: 90, render: (_, entry) => <span className={entry.temporary ? 'dict-temporary' : 'muted'}>{entry.temporary ? '临时' : '永久'}</span> },
    { title: '操作', key: 'actions', width: 112, fixed: 'right', render: (_, entry) => <div className="dict-actions">
      {entry.temporary && <Tooltip title="保存"><button aria-label={`保存 ${entry.key}`} className="icon-btn" onClick={() => void saveTemporary([entry.id])}><SaveOutlined /></button></Tooltip>}
      <Tooltip title="编辑"><button aria-label={`编辑 ${entry.key}`} className="icon-btn" onClick={() => openEdit(entry)}><EditOutlined /></button></Tooltip>
      <Tooltip title="删除"><button aria-label={`删除 ${entry.key}`} className="icon-btn" onClick={() => remove(entry)}><DeleteOutlined /></button></Tooltip>
    </div> }
  ]

  return (
    <div className="dict-panel">
      <div className="dict-tabs" role="tablist">
          <button role="tab" aria-selected={source === 'custom'} className={source === 'custom' ? 'active' : ''} onClick={() => { setSource('custom'); setPage(1) }}>
            自定义
          </button>
          <button role="tab" aria-selected={source === 'builtin'} className={source === 'builtin' ? 'active' : ''} onClick={() => { setSource('builtin'); setPage(1) }}>
            系统内置
          </button>
        </div>
      <div className="dict-head">
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
          <>{selected.length > 0 && <Button danger onClick={removeSelected}>批量删除</Button>}<Tooltip title="将所有临时数据保存为永久数据"><Button onClick={() => void saveTemporary()}>保存临时数据</Button></Tooltip><Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>导入</Button><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建</Button></>
        )}
      </div>

      <Table<DictionaryEntryView>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        rowSelection={source === 'custom' ? { selectedRowKeys: selected, onChange: setSelected, columnWidth: 40 } : undefined}
        pagination={{
          current: page,
          pageSize: 10,
          total: filtered.length,
          showSizeChanger: false,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (next) => setPage(next)
        }}
        scroll={{ x: source === 'custom' ? 1250 : undefined, y: 'calc(100vh - 330px)' }}
      />

      <DictionaryEntryEditor open={open} entry={editing} projectId={projectId} onClose={() => setOpen(false)} onSave={save} />
      <DictionaryImport open={importOpen} projectId={projectId} entries={entries} onClose={() => setImportOpen(false)} onImported={async () => { invalidateDictionaryCache(projectId); setPage(1); await reload() }} />
    </div>
  )
}
