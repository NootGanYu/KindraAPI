import { Empty } from 'antd'

export default function PlaceholderPage({
  title,
  description
}: {
  title: string
  description: string
}): JSX.Element {
  return (
    <div style={{ height: '100%', padding: 18 }}>
      <div className="panel-card" style={{ padding: 28 }}>
        <div className="section-title">{title}</div>
        <div className="muted" style={{ marginBottom: 24 }}>
          {description}
        </div>
        <Empty description="后续里程碑补齐" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    </div>
  )
}
