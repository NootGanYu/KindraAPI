import AgentConflictReview from './AgentConflictReview'
import { candidateDiff } from './candidateDiff'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Space, Tag } from 'antd'
import type { AgentCandidate } from '@shared/agentDraft'
import { targetDefinition } from '@shared/targetSync'
import { flushAgentDrafts } from '../agentDraftSync'

function useCandidates(projectId: string, targetId: string): [AgentCandidate[], () => Promise<void>] {
  const [items, setItems] = useState<AgentCandidate[]>([])
  const load = useCallback(async () => {
    if (!projectId || !targetId) return
    const result = await window.api.agent.listCandidates(projectId, targetId)
    if (result.ok) setItems(result.data)
  }, [projectId, targetId])
  useEffect(() => { void load(); return window.api.agent.onDraftChanged(event => { if (event.project_id === projectId && event.target_id === targetId) void load() }) }, [load, projectId, targetId])
  return [items, load]
}
export function AgentCandidateNotice({ projectId, targetId, onReview }: { projectId: string; targetId: string; onReview: () => void }): JSX.Element | null {
  const [items] = useCandidates(projectId, targetId)
  const pending = items.filter(item => item.status === 'pending' || item.status === 'conflict').length
  if (!items.length) return null
  return <div className="target-sync-banner" role="status"><span>{pending ? `${pending} 个 Agent 待确认候选` : 'Agent 修改记录 · 草稿退出仅暂存'}</span><Button size="small" onClick={onReview}>审阅 Agent 版本</Button></div>
}
export default function AgentCandidates({ projectId, targetId }: { projectId: string; targetId: string }): JSX.Element | null {
  const [items, load] = useCandidates(projectId, targetId)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const candidate = items.find(item => item.candidate_id === selected)
  async function apply(item: AgentCandidate, action: 'applyCandidate' | 'restoreCandidate' | 'rejectCandidate' | 'undoCandidate' = 'applyCandidate'): Promise<void> {
    try {
      await flushAgentDrafts()
      const result = await window.api.agent[action](projectId, item.candidate_id)
      if (!result.ok) throw new Error(result.error)
      setError('')
      if (result.data.error) { setError(result.data.error); setSelected(item.candidate_id) }
      await load()
    } catch (error) { setError((error as Error).message) }
  }
  if (!items.length) return null
  const before = candidate ? JSON.stringify(targetDefinition(candidate.base), null, 2).split('\n') : []
  const after = candidate ? JSON.stringify(targetDefinition(candidate.proposal), null, 2).split('\n') : []
  const rows = candidateDiff(before, after)
  return <section aria-label="Agent 候选版本" style={{ marginBottom: 20 }}>
    <h3>Agent 候选版本</h3>
    <Alert type="info" message="候选不会自动保存定义。应用、恢复和撤销只改变本机草稿；不采纳保留历史且不撤回已应用内容。退出时仅暂存。" />
    {error && <Alert type="warning" message={error} closable onClose={() => setError('')} />}
    {items.map(item => <div key={item.candidate_id} style={{ padding: '12px 0', borderBottom: '1px solid #ddd' }}>
      <Space wrap><strong>{item.number}</strong><Tag color={item.status === 'conflict' ? 'error' : item.status === 'pending' ? 'warning' : 'default'}>{item.status === 'conflict' && item.merge?.operation === 'undo' ? '撤销冲突' : ({ pending: '待确认', conflict: '冲突候选', applied: '已应用草稿', rejected: '未采纳', undone: '已撤销' })[item.status]}</Tag>
        <Button size="small" onClick={() => setSelected(item.candidate_id)}>查看差异</Button>
        {item.status === 'conflict' && <Button size="small" onClick={() => { setSelected(item.candidate_id); void apply(item, item.merge?.operation === 'undo' ? 'undoCandidate' : item.merge?.operation === 'restore' ? 'restoreCandidate' : 'applyCandidate') }}>重新检查冲突</Button>}
        {item.status === 'pending' && <Button size="small" type="primary" onClick={() => void apply(item)}>应用到草稿</Button>}
        {(['rejected', 'undone'].includes(item.status) || (item.status === 'conflict' && !item.merge)) && <Button size="small" onClick={() => void apply(item, 'restoreCandidate')}>恢复到草稿</Button>}
        {item.status !== 'rejected' && item.status !== 'undone' && <Button size="small" onClick={() => void apply(item, 'rejectCandidate')}>不采纳</Button>}
        {item.application && !item.application.undone && item.merge?.operation !== 'undo' && <Button size="small" onClick={() => void apply(item, 'undoCandidate')}>撤销已应用修改</Button>}
      </Space>{item.error && <p>{item.error}</p>}
    </div>)}
    {candidate && <AgentConflictReview key={candidate.merge?.review_id ?? candidate.candidate_id} candidate={candidate} onUpdated={load} onError={setError} />}
    {candidate && <div aria-label="候选双栏差异" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8, marginTop: 16 }}>
      {(['before', 'after'] as const).map(side => <div key={side}><strong>{side === 'before' ? '基线' : 'Agent 提案'}</strong><pre style={{ overflow: 'auto', maxHeight: 420, fontSize: 12, background: '#fafafa', padding: 8 }}>{rows.map((row, index) => <div key={index} data-diff={row.changed && row[side] !== undefined ? (side === 'before' ? 'removed' : 'added') : 'same'} style={{ minHeight: '1.5em', background: row.changed && row[side] !== undefined ? (side === 'before' ? '#fff0ef' : '#edfaef') : undefined }}><span style={{ opacity: .4 }}>{String(row[side === 'before' ? 'beforeNumber' : 'afterNumber'] ?? '').padStart(3)} </span>{row.changed && row[side] !== undefined ? (side === 'before' ? '- ' : '+ ') : '  '}{row[side] ?? ' '}</div>)}</pre></div>)}
    </div>}
  </section>
}
