import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App as AntApp, Button, Drawer, Input, Space, Table, Tag, Tooltip } from 'antd'
import { ClearOutlined, DeleteOutlined, ExportOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import type { SendRecord, SendRecordSummary } from '@shared/types'
import { useApp } from '../store'
import ResponsePanel from '../components/ResponsePanel'

export default function HistoryPage(): JSX.Element {
  const { message, modal } = AntApp.useApp()
  const navigate = useNavigate()
  const project = useApp((s) => s.project)
  const openTarget = useApp((s) => s.openTarget)
  const [records, setRecords] = useState<SendRecordSummary[]>([])
  const [keyword, setKeyword] = useState('')
  const [detail, setDetail] = useState<SendRecord | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!project) return
    setLoading(true)
    try {
      const result = await window.api.history.list(project.project_id)
      if (result.ok) setRecords(result.data)
      else message.error(result.error)
    } finally {
      setLoading(false)
    }
  }, [project, message])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (recordId: string): Promise<void> => {
    if (!project) return
    const result = await window.api.history.get(project.project_id, recordId)
    if (result.ok && result.data) setDetail(result.data)
    else if (!result.ok) message.error(result.error)
  }

  const removeRecord = (recordId: string): void => {
    if (!project) return
    void (async () => {
      const result = await window.api.history.delete(project.project_id, recordId)
      if (result.ok) {
        message.success('已删除')
        await load()
      } else message.error(result.error)
    })()
  }

  const clearAll = (): void => {
    if (!project) return
    modal.confirm({
      title: '清空发送历史？',
      content: '将删除所有发送记录与最近使用列表，接口本身不受影响。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.api.history.clear(project.project_id)
        if (result.ok) {
          message.success('已清空')
          await load()
        } else message.error(result.error)
      }
    })
  }

  const filtered = records.filter((record) => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return true
    return (
      record.target_name.toLowerCase().includes(kw) ||
      record.url.toLowerCase().includes(kw) ||
      record.method.toLowerCase().includes(kw)
    )
  })

  const columns = [
    {
      title: '方法',
      dataIndex: 'method',
      width: 70,
      render: (method: string) => <span className={`method-tag ${method}`}>{method}</span>
    },
    { title: '接口', dataIndex: 'target_name', width: 180 },
    {
      title: 'URL',
      dataIndex: 'url',
      ellipsis: true,
      render: (url: string) => <span className="mono" style={{ fontSize: 12 }}>{url}</span>
    },
    {
      title: '结果',
      dataIndex: 'status',
      width: 110,
      render: (status: string, row: SendRecordSummary) => (
        <Space size={4}>
          <Tag color={status === 'passed' ? 'success' : 'error'}>{status}</Tag>
          <span className="muted">{row.status_code ?? '-'}</span>
        </Space>
      )
    },
    {
      title: '耗时',
      dataIndex: 'response_time',
      width: 90,
      render: (value: number | null) => (value == null ? '-' : `${value} ms`)
    },
    {
      title: '发送时间',
      dataIndex: 'created_at',
      width: 170,
      render: (value: number) => new Date(value).toLocaleString()
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, row: SendRecordSummary) => (
        <Space size={0} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="打开接口">
            <Button
              size="small"
              type="text"
              icon={<ExportOutlined />}
              onClick={() => {
                void openTarget(row.target_id)
                navigate('/apis')
              }}
            />
          </Tooltip>
          <Tooltip title="删除记录">
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => removeRecord(row.record_id)}
            />
          </Tooltip>
        </Space>
      )
    }
  ]

  return (
    <div style={{ height: '100%', padding: 12, display: 'flex', flexDirection: 'column' }}>
      <div className="panel-card" style={{ padding: 10 }}>
        <Space style={{ marginBottom: 8 }}>
          <Input
            size="small"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索接口或 URL"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 260 }}
          />
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          <Button size="small" danger icon={<ClearOutlined />} onClick={clearAll}>
            清空
          </Button>
          <span className="muted">共 {filtered.length} 条，最多保留 100 条</span>
        </Space>
        <Table
          size="small"
          rowKey="record_id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          onRow={(row) => ({
            onClick: () => void openDetail(row.record_id),
            style: { cursor: 'pointer' }
          })}
        />
      </div>

      <Drawer
        width="72%"
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.method} ${detail.target_name}` : '发送详情'}
        destroyOnClose
      >
        {detail ? <ResponsePanel record={detail} /> : null}
      </Drawer>
    </div>
  )
}
