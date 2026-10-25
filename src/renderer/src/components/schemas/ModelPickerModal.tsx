import { useEffect, useMemo, useState } from 'react'
import { App as AntApp, Empty, Input, Modal, Spin, Tag } from 'antd'
import { SearchOutlined, TableOutlined } from '@ant-design/icons'
import type { ModelSummary } from '@shared/types'

interface Props {
  open: boolean
  projectId: string
  title?: string
  excludeModelId?: string
  onCancel: () => void
  onSelect: (model: ModelSummary) => void
}

export default function ModelPickerModal({
  open,
  projectId,
  title = '选择数据模型',
  excludeModelId,
  onCancel,
  onSelect
}: Props): JSX.Element {
  const { message } = AntApp.useApp()
  const [models, setModels] = useState<ModelSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    if (!open || !projectId) return
    let active = true
    setLoading(true)
    window.api.models
      .list(projectId)
      .then((result) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error)
        setModels(result.data)
      })
      .catch((error: Error) => active && message.error(error.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId])

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return models
      .filter((model) => model.model_type === 'model')
      .filter((model) => model.model_id !== excludeModelId)
      .filter(
        (model) =>
          !text ||
          model.name.toLowerCase().includes(text) ||
          (model.alias ?? '').toLowerCase().includes(text)
      )
  }, [models, keyword, excludeModelId])

  return (
    <Modal title={title} open={open} onCancel={onCancel} footer={null} width={520} destroyOnHidden>
      <Input
        allowClear
        prefix={<SearchOutlined style={{ color: '#a2967f' }} />}
        placeholder="搜索模型名称或别名"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        style={{ marginBottom: 10 }}
      />
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : filtered.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有可引用的数据模型"
        />
      ) : (
        <div className="model-picker-list">
          {filtered.map((model) => (
            <button
              key={model.model_id}
              className="model-picker-row"
              onClick={() => onSelect(model)}
            >
              <TableOutlined style={{ color: '#8a6b3b' }} />
              <span className="model-picker-name">{model.name}</span>
              {model.alias ? <span className="muted">{model.alias}</span> : null}
              <span style={{ flex: 1 }} />
              <Tag bordered={false}>模型</Tag>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
