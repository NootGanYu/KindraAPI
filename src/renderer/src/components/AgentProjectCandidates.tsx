import DeletedObjectReview from './DeletedObjectReview'
import FlowVersionDrawer from './FlowVersionDrawer'
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
  useEffect(() => {
    void load()
    const changed = (event: { project_id: string }): void => { if (event.project_id === projectId) void load() }
    const off = window.api.agent.onDraftChanged(changed), offFlow = window.api.agent.onFlowDraftChanged(changed)
    return () => { off(); offFlow() }
  }, [load, projectId])
  return <><Button onClick={() => { setOpen(true); void load() }}>项目候选汇总</Button>
    <Drawer title="项目候选汇总" width={1000} open={open} onClose={() => setOpen(false)}>
      <Alert type="info" message="删除对象的候选和墓碑仍保留在本机。审阅、恢复草稿与正式保存分别进行。" />
      {error && <Alert type="error" message={error} />}
      {!items.length && <Empty description="暂无候选" />}
      <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>{items.map(item => <Card key={`${item.kind}:${item.entity_id}`} size="small" title={item.name}>
        <Space wrap><Tag>{item.kind === 'api' ? '接口' : '执行流程'}</Tag><Tag>{({ uncreated: '尚未正式创建', saved: '已正式保存', unavailable: '对象不可用', deleted: '对象已删除' })[item.lifecycle]}</Tag><span>{item.candidate_count} 个候选</span>{item.kind === 'api' ? <Button onClick={() => setSelected(item.entity_id)}>审阅候选</Button> : <FlowVersionDrawer projectId={projectId} flowId={item.entity_id} />}</Space>
        {item.lifecycle === 'deleted' && <DeletedObjectReview projectId={projectId} item={item} onSaved={load} />}
        {selected === item.entity_id && item.kind === 'api' && <AgentCandidates projectId={projectId} targetId={item.entity_id} deleted={item.lifecycle === 'deleted'} />}
      </Card>)}</Space>
    </Drawer></>
}
