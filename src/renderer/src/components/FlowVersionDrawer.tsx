import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Drawer, Space, Tag } from 'antd'
import type { AgentFlowCandidate } from '@shared/agentFlowDraft'
import { flowDefinition } from '@shared/flowSync'
import { flushFlowDrafts } from '../flowDraftSync'
import SnapshotDiff from './SnapshotDiff'
import AgentConflictReview from './AgentConflictReview'
export default function FlowVersionDrawer({ projectId, flowId }: { projectId: string; flowId: string }): JSX.Element {
  const [open, setOpen] = useState(false), [items, setItems] = useState<AgentFlowCandidate[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState('')
  const load = useCallback(async () => {
    const result = await window.api.agent.listFlowCandidates(projectId, flowId)
    if (result.ok) setItems(result.data)
    else setError(result.error)
  }, [projectId, flowId])
  useEffect(() => { void load(); return window.api.agent.onFlowDraftChanged(event => { if (event.project_id === projectId && event.flow_id === flowId) void load() }) }, [load, projectId, flowId])
  const pending = items.filter(c => ['pending','conflict'].includes(c.status)).length
  const candidate = items.find(c => c.candidate_id === selected)
  async function act(item: AgentFlowCandidate, action: 'applyFlowCandidate' | 'rejectFlowCandidate'): Promise<void> {
    try {
      await flushFlowDrafts()
      const result = await window.api.agent[action](projectId, item.candidate_id)
      if (!result.ok) throw new Error(result.error)
      setSelected(item.candidate_id); setError(result.data.error ?? ''); await load()
    } catch (error) { setError((error as Error).message) }
  }
  return <>
    <Button size="small" onClick={() => setOpen(true)}>Flow 版本{pending ? ` · ${pending} 个待确认` : ''}</Button>
    <Drawer title="Flow 版本" width={1100} open={open} onClose={() => setOpen(false)}>
      <Alert type="info" message="候选只保存在本机。应用只修改草稿，退出仅暂存；正式保存需主动点击保存。" />
      {error && <Alert type="warning" message={error} />}
      {!items.length && <p>暂无 Agent 候选版本</p>}
      {items.map(item => <div key={item.candidate_id} style={{ padding: '12px 0' }}><Space><strong>{item.number}</strong><Tag color={item.status === 'conflict' ? 'error' : item.status === 'pending' ? 'warning' : undefined}>{({ pending: '待确认', conflict: '冲突候选', applied: '已应用草稿', rejected: '未采纳', undone: '已撤销' })[item.status]}</Tag>
        <Button onClick={() => setSelected(item.candidate_id)}>查看差异</Button>
        {['pending','conflict'].includes(item.status) && <Button onClick={() => void act(item, 'applyFlowCandidate')}>{item.status === 'conflict' ? '重新检查冲突' : '应用到草稿'}</Button>}
        {item.status !== 'rejected' && <Button onClick={() => void act(item, 'rejectFlowCandidate')}>不采纳</Button>}
      </Space></div>)}
      {candidate && <><AgentConflictReview candidate={candidate} onUpdated={load} onError={setError} /><SnapshotDiff before={flowDefinition(candidate.base)} after={flowDefinition(candidate.proposal)} /></>}
    </Drawer>
  </>
}
