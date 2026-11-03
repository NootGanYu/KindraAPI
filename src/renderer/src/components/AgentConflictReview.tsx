import { useEffect, useState } from 'react'
import { Button, Radio, Space, Typography } from 'antd'
import type { AgentCandidate, AgentConflictChoice, AgentFieldConflict } from '@shared/agentDraft'
import { flushAgentDrafts } from '../agentDraftSync'

function valueText(conflict: AgentFieldConflict, side: AgentConflictChoice): string {
  if (!conflict[`${side}_present`]) return '（字段不存在 / 删除）'
  const value = conflict[side]
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}
export default function AgentConflictReview({ candidate, onUpdated, onError }: { candidate: AgentCandidate; onUpdated: () => Promise<void>; onError: (text: string) => void }): JSX.Element | null {
  const [choices, setChoices] = useState<Record<string, AgentConflictChoice>>({})
  const [busy, setBusy] = useState(false)
  const merge = candidate.merge
  useEffect(() => { setChoices({}) }, [merge?.review_id])
  if (!merge || candidate.status !== 'conflict') return null
  async function resolve(): Promise<void> {
    if (!merge) return
    setBusy(true)
    try {
      await flushAgentDrafts()
      const result = await window.api.agent.resolveCandidate(candidate.project_id, candidate.candidate_id, merge.review_id, choices)
      if (!result.ok) throw new Error(result.error)
      if (result.data.status === 'conflict') onError('审阅期间内容发生变化，已刷新冲突；请检查最新内容再选择。')
      else onError('')
      await onUpdated()
    } catch (error) { onError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <section aria-label="Agent 冲突审阅" style={{ marginTop: 20 }}>
    <Typography.Title level={4}>逐字段解决冲突</Typography.Title>
    <p>无冲突字段已合并到草稿。以下字段需要明确选择；保存已暂停。</p>
    {merge.conflicts.map(conflict => <section key={conflict.id} aria-label={`冲突 ${conflict.path}`} style={{ border: '1px solid #d8b3a9', marginBottom: 16, padding: 12 }}>
      <Typography.Text strong>{conflict.path}{conflict.reason === 'order' ? '（顺序冲突）' : ''}</Typography.Text>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
        {(['base', 'current', 'agent'] as const).map(side => <div key={side}><strong>{{ base: '基线', current: '当前内容', agent: 'Agent 内容' }[side]}</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflow: 'auto' }}>{valueText(conflict, side)}</pre></div>)}
        <div><strong>合并结果</strong><pre aria-label={`结果 ${conflict.path}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{choices[conflict.id] ? valueText(conflict, choices[conflict.id]) : '等待选择（草稿暂保留当前内容）'}</pre></div>
      </div>
      <Radio.Group aria-label={`选择 ${conflict.path}`} value={choices[conflict.id]} onChange={event => setChoices(previous => ({ ...previous, [conflict.id]: event.target.value }))}>
        <Space wrap><Radio value="current">保留当前</Radio><Radio value="agent">采用 Agent</Radio><Radio value="base">恢复基线</Radio></Space>
      </Radio.Group>
    </section>)}
    <Button type="primary" loading={busy} disabled={merge.conflicts.some(conflict => !choices[conflict.id])} onClick={() => void resolve()}>确认冲突选择并应用草稿</Button>
  </section>
}
