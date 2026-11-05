import { useState } from 'react'
import { Button, Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, StopOutlined } from '@ant-design/icons'
import type { AgentActivity, AgentToolRisk } from '@shared/agent'

const riskLabels: Record<AgentToolRisk, string> = {
  read: '只读',
  'local-write': '本地写',
  'network-write': '网络执行',
  irreversible: '不可逆'
}
const riskColors: Record<AgentToolRisk, string | undefined> = {
  read: 'default',
  'local-write': 'blue',
  'network-write': 'orange',
  irreversible: 'red'
}
const previewLength = 1_200

function StatusIcon({ status }: { status: AgentActivity['status'] }): JSX.Element {
  if (status === 'running') return <LoadingOutlined spin aria-label="运行中" />
  if (status === 'succeeded') return <CheckCircleOutlined style={{ color: '#389e0d' }} aria-label="成功" />
  if (status === 'cancelled') return <StopOutlined aria-label="已取消" />
  return <CloseCircleOutlined style={{ color: '#cf1322' }} aria-label="失败" />
}
function statusLabel(status: AgentActivity['status']): string {
  return { running: '运行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }[status]
}

/** One redacted tool call in the turn timeline. Large results expand on demand. */
export default function AgentToolCard({ activity }: { activity: AgentActivity }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const display = activity.display ?? ''
  const truncatedPreview = display.length > previewLength

  return <div className={`agent-tool-card ${activity.status}`} data-tool={activity.tool}>
    <div className="agent-tool-card-head">
      <Space size={6} wrap>
        <StatusIcon status={activity.status} />
        <Typography.Text strong>{activity.tool}</Typography.Text>
        <Tag color={riskColors[activity.risk]}>{riskLabels[activity.risk]}</Tag>
        <Typography.Text type="secondary">{statusLabel(activity.status)}</Typography.Text>
      </Space>
    </div>
    <div className="agent-tool-summary">{activity.summary}</div>
    {activity.error && <Typography.Text type="danger" className="agent-tool-error">{activity.error}</Typography.Text>}
    {display && <pre className="agent-tool-output">{expanded || !truncatedPreview ? display : `${display.slice(0, previewLength)}…`}</pre>}
    <Space size={8} wrap>
      {truncatedPreview && <Button size="small" type="link" onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '查看更多'}</Button>}
      {activity.cursor && <Typography.Text type="secondary" className="agent-tool-cursor">结果已分页，可让 Agent 用 cursor 继续读取（{activity.cursor.slice(0, 24)}）</Typography.Text>}
    </Space>
  </div>
}
