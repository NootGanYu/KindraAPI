import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Drawer, Empty, Space, Tag } from 'antd'
import type { ProjectCandidateSummary } from '@shared/agentDraft'
import AgentCandidates from './AgentCandidates'

export default function AgentProjectCandidates({ projectId }: { projectId: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ProjectCandidateSummary[]>([])
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const result = await window.api.agent.listProjectCandidates(projectId)
    if (result.ok) setItems(result.data); else setError(result.error)
  }, [projectId])
  useEffect(() => { void load(); return window.api.agent.onDraftChanged(event => { if (event.project_id === projectId) void load() }) }, [load, projectId])
  return <><Button onClick={() => { setOpen(true); void load() }}>项目候选汇总</Button>
    <Drawer title="项目候选汇总" width={1000} open={open} onClose={() => setOpen(false)}>
      <Alert type="info" message="尚未正式创建的接口仅在本机保留草稿和候选。审阅、恢复与正式保存分别进行。" />
      {error && <Alert type="error" message={error} />}
      {!items.length && <Empty description="暂无候选" />}
      <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>{items.map(item => <Card key={`${item.kind}:${item.entity_id}`} size="small" title={item.name}>
        <Space wrap><Tag>{item.kind === 'api' ? '接口' : '执行流程'}</Tag><Tag>{({ uncreated: '尚未正式创建', saved: '已正式保存', unavailable: '对象不可用' })[item.lifecycle]}</Tag><span>{item.candidate_count} 个候选</span><Button onClick={() => setSelected(item.entity_id)}>审阅候选</Button></Space>
        {selected === item.entity_id && item.kind === 'api' && <AgentCandidates projectId={projectId} targetId={item.entity_id} />}
      </Card>)}</Space>
    </Drawer></>
}
