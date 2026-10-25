import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Dropdown, Empty, Input, Select, Table, Tooltip } from 'antd'
import { SearchOutlined, SettingOutlined } from '@ant-design/icons'
import type { DataModel, ModelSummary } from '@shared/types'

interface Props {
  projectId: string
  models: DataModel[]
  summaries: ModelSummary[]
  onOpen: (modelId: string) => void
}

interface ColumnSetting {
  key: string
  label: string
  visible: boolean
}

const DEFAULT_COLUMNS: ColumnSetting[] = [
  { key: 'name', label: '名称', visible: true },
  { key: 'alias', label: '别名', visible: true },
  { key: 'created_by', label: '创建人', visible: true },
  { key: 'created_time', label: '创建时间', visible: true },
  { key: 'updated_by', label: '最后修改人', visible: true },
  { key: 'updated_time', label: '修改时间', visible: true },
  { key: 'folder', label: '目录', visible: true }
]

function storageKey(projectId: string): string {
  return `kindraapi.modelColumns.${projectId}`
}

function loadColumns(projectId: string): ColumnSetting[] {
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return DEFAULT_COLUMNS
    const saved = JSON.parse(raw) as ColumnSetting[]
    return DEFAULT_COLUMNS.map((column) => {
      const found = saved.find((item) => item.key === column.key)
      return found ? { ...column, visible: found.visible !== false } : column
    })
  } catch {
    return DEFAULT_COLUMNS
  }
}

function formatTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (input: number): string => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

export default function ModelsListPanel({
  projectId,
  models,
  summaries,
  onOpen
}: Props): JSX.Element {
  const [keyword, setKeyword] = useState('')
  const [folderId, setFolderId] = useState('all')
  const [columns, setColumns] = useState<ColumnSetting[]>(() => loadColumns(projectId))

  useEffect(() => {
    setColumns(loadColumns(projectId))
  }, [projectId])

  const folders = useMemo(
    () => summaries.filter((item) => item.model_type === 'folder'),
    [summaries]
  )
  const folderNames = useMemo(
    () => new Map(folders.map((folder) => [folder.model_id, folder.name])),
    [folders]
  )

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return models
      .filter((model) => model.model_type === 'model')
      .filter((model) => folderId === 'all' || model.parent_id === folderId)
      .filter(
        (model) =>
          !text ||
          model.name.toLowerCase().includes(text) ||
          (model.alias ?? '').toLowerCase().includes(text)
      )
  }, [models, keyword, folderId])

  const toggleColumn = (key: string, visible: boolean): void => {
    const next = columns.map((column) =>
      column.key === key ? { ...column, visible } : column
    )
    setColumns(next)
    localStorage.setItem(storageKey(projectId), JSON.stringify(next))
  }

  const allColumns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (value: string, model: DataModel) => (
        <span style={{ fontWeight: 500 }}>{value}</span>
      )
    },
    {
      title: '别名',
      dataIndex: 'alias',
      key: 'alias',
      render: (value?: string) => value || <span className="muted">—</span>
    },
    {
      title: '创建人',
      dataIndex: 'created_by',
      key: 'created_by',
      width: 110,
      render: (value?: string) => value || '本地'
    },
    {
      title: '创建时间',
      dataIndex: 'created_time',
      key: 'created_time',
      width: 150,
      render: (value: string) => formatTime(value)
    },
    {
      title: '最后修改人',
      dataIndex: 'updated_by',
      key: 'updated_by',
      width: 120,
      render: (value?: string) => value || '本地'
    },
    {
      title: '修改时间',
      dataIndex: 'updated_time',
      key: 'updated_time',
      width: 150,
      render: (value: string) => formatTime(value)
    },
    {
      title: '目录',
      key: 'folder',
      width: 150,
      render: (_: unknown, model: DataModel) =>
        model.parent_id === '0' ? (
          <span className="muted">根目录</span>
        ) : (
          folderNames.get(model.parent_id) ?? <span className="muted">未知目录</span>
        )
    }
  ]
  const visibleKeys = new Set(columns.filter((column) => column.visible).map((column) => column.key))

  return (
    <div className="dict-panel">
      <div className="dict-head">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#a2967f' }} />}
          placeholder="搜索模型名称或别名"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          style={{ width: 280 }}
        />
        <Select
          value={folderId}
          style={{ width: 180 }}
          onChange={setFolderId}
          options={[
            { value: 'all', label: '全部目录' },
            { value: '0', label: '根目录' },
            ...folders.map((folder) => ({ value: folder.model_id, label: folder.name }))
          ]}
        />
        <span style={{ flex: 1 }} />
        <span className="muted">共 {filtered.length} 个模型</span>
        <Dropdown
          trigger={['click']}
          dropdownRender={() => (
            <div className="column-settings">
              <div className="muted" style={{ marginBottom: 6 }}>显示列</div>
              {columns.map((column) => (
                <label key={column.key} className="column-setting-row">
                  <Checkbox
                    checked={column.visible}
                    onChange={(event) => toggleColumn(column.key, event.target.checked)}
                  >
                    {column.label}
                  </Checkbox>
                </label>
              ))}
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setColumns(DEFAULT_COLUMNS)
                  localStorage.removeItem(storageKey(projectId))
                }}
              >
                恢复默认
              </Button>
            </div>
          )}
        >
          <Tooltip title="列设置">
            <Button icon={<SettingOutlined />} />
          </Tooltip>
        </Dropdown>
      </div>

      <Table<DataModel>
        rowKey="model_id"
        size="small"
        columns={allColumns.filter((column) => visibleKeys.has(String(column.key)))}
        dataSource={filtered}
        pagination={{ pageSize: 12, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
        onRow={(model) => ({
          onClick: () => onOpen(model.model_id),
          style: { cursor: 'pointer' }
        })}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无数据，先在左侧新建数据模型"
            />
          )
        }}
      />
    </div>
  )
}
