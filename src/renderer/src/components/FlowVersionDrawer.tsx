import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Drawer, Space, Tag } from 'antd'
import type { AgentFlowCandidate } from '@shared/agentFlowDraft'
import { flowDefinition, flowSignature, type FlowVersion } from '@shared/flowSync'
import { flushFlowDrafts } from '../flowDraftSync'
import SnapshotDiff from './SnapshotDiff'
import AgentConflictReview from './AgentConflictReview'
export default function FlowVersionDrawer({ projectId, flowId }: { projectId: string; flowId: string }): JSX.Element {
  const [open, setOpen] = useState(false), [items, setItems] = useState<AgentFlowCandidate[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState('')
  const [versions, setVersions] = useState<FlowVersion[]>([]), [versionId, setVersionId] = useState('')
  const load = useCallback(async () => {
    const [result, history] = await Promise.all([window.api.agent.listFlowCandidates(projectId, flowId), window.api.agent.listFlowVersions(projectId, flowId)])
    if (result.ok) setItems(result.data); else setError(result.error)
    if (history.ok) setVersions(history.data); else setError(history.error)
  }, [projectId, flowId])
  useEffect(() => { void load(); return window.api.agent.onFlowDraftChanged(event => { if (event.project_id === projectId && event.flow_id === flowId) void load() }) }, [load, projectId, flowId])
  const pending = items.filter(c => ['pending','conflict'].includes(c.status)).length
  const candidate = items.find(c => c.candidate_id === selected), version = versions.find(v => v.version_id === versionId)
  async function act(item: AgentFlowCandidate, action: 'applyFlowCandidate' | 'rejectFlowCandidate' | 'restoreFlowCandidate'): Promise<void> {
    try {
      await flushFlowDrafts()
      const result = await window.api.agent[action](projectId, item.candidate_id)
      if (!result.ok) throw new Error(result.error)
      setSelected(item.candidate_id); setVersionId(''); setError(result.data.error ?? ''); await load()
    } catch (error) { setError((error as Error).message) }
  }
  async function restoreVersion(item: FlowVersion): Promise<void> {
    try {
      await flushFlowDrafts()
      const result = await window.api.agent.restoreFlowVersionDraft(projectId, flowId, item.version_id)
      if (!result.ok) throw new Error(result.error)
      setSelected(result.data.candidate_id); setVersionId(''); setError(result.data.error ?? '版本已恢复到草稿，尚未正式保存。'); await load()
    } catch (error) { setError((error as Error).message) }
  }
  async function reload(): Promise<void> {
    try {
      await flushFlowDrafts()
      const current = await window.api.agent.getFlowDraft(projectId, flowId)
      if (!current.ok) throw new Error(current.error)
      const result = await window.api.agent.reloadFlowDraft(projectId, flowId, flowSignature(current.data.flow))
      if (!result.ok) throw new Error(result.error)
      setError('已载入最新定义；候选历史仍保留，可重新恢复并审阅。'); await load()
    } catch (error) { setError((error as Error).message) }
  }
  return <>
    <Button size="small" onClick={() => { setOpen(true); void load() }}>Flow 版本{pending ? ` · ${pending} 个待确认` : ''}</Button>
    <Drawer title="Flow 版本" width={1100} open={open} onClose={() => setOpen(false)}>
      <Alert type="info" message="v 为已保存版本，P 为本机候选。恢复只改变草稿；主动保存或批准独立保存计划后才写入正式定义。" />
      {error && <Alert type="warning" message={error} />}
      <h3>已保存版本</h3>
      <Button onClick={() => void reload()}>放弃当前草稿并载入最新定义</Button>
      {!versions.length && <p>暂无正式版本历史</p>}
      {versions.map(item => <div key={item.version_id} style={{ padding: '12px 0' }}><Space><strong>v{item.version}</strong><Tag>已保存</Tag><span>{item.flow.name}</span>
        <Button onClick={() => { setVersionId(item.version_id); setSelected('') }}>查看 v{item.version}</Button>
        <Button onClick={() => void restoreVersion(item)}>恢复 v{item.version} 到草稿</Button>
      </Space></div>)}
      {version && <SnapshotDiff beforeLabel="当前已保存定义" afterLabel={`v${version.version}`} before={flowDefinition(versions[0].flow)} after={flowDefinition(version.flow)} />}
      <h3>Agent 候选版本</h3>
      {!items.length && <p>暂无 Agent 候选版本</p>}
      {items.map(item => <div key={item.candidate_id} style={{ padding: '12px 0' }}><Space><strong>{item.number}</strong><Tag color={item.status === 'conflict' ? 'error' : item.status === 'pending' ? 'warning' : undefined}>{({ pending: '待确认', conflict: '冲突候选', applied: '已应用草稿', rejected: '未采纳', undone: '已撤销' })[item.status]}</Tag>
        {item.saved_version && <Tag color="success">已关联 v{item.saved_version.version}</Tag>}
        <Button onClick={() => { setSelected(item.candidate_id); setVersionId('') }}>查看差异</Button>
        {['pending','conflict'].includes(item.status) && <Button onClick={() => void act(item, 'applyFlowCandidate')}>{item.status === 'conflict' ? '重新检查冲突' : '应用到草稿'}</Button>}
        <Button onClick={() => void act(item, 'restoreFlowCandidate')}>恢复候选到草稿</Button>
        {item.status !== 'rejected' && <Button onClick={() => void act(item, 'rejectFlowCandidate')}>不采纳</Button>}
      </Space></div>)}
      {candidate && <><AgentConflictReview candidate={candidate} onUpdated={load} onError={setError} /><SnapshotDiff before={flowDefinition(candidate.base)} after={flowDefinition(candidate.proposal)} /></>}
    </Drawer>
  </>
}
