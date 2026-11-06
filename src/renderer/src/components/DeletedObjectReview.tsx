import { useState } from 'react'
import { Alert, Button, Space } from 'antd'
import type { DeletedObject } from '@shared/agentDeletion'
import type { AgentDraft, ProjectCandidateSummary } from '@shared/agentDraft'
import type { AgentFlowDraft } from '@shared/agentFlowDraft'
import { targetDefinition, stableJson } from '@shared/targetSync'
import { flowDefinition, flowSignature } from '@shared/flowSync'
import { flushAgentDrafts } from '../agentDraftSync'
import { flushFlowDrafts } from '../flowDraftSync'
import SnapshotDiff from './SnapshotDiff'
export default function DeletedObjectReview({ projectId, item, onSaved }: { projectId: string; item: ProjectCandidateSummary; onSaved: () => Promise<void> }): JSX.Element {
  const [record, setRecord] = useState<DeletedObject | null>(null), [draft, setDraft] = useState<AgentDraft | AgentFlowDraft | null>(null), [error, setError] = useState('')
  async function review(restore: boolean): Promise<void> {
    try {
      await flushAgentDrafts(); await flushFlowDrafts()
      const result = await window.api.agent.getDeletedObject(projectId, item.kind, item.entity_id)
      if (!result.ok) throw new Error(result.error)
      if (!result.data) throw new Error('删除记录不存在')
      setRecord(result.data); setError('')
      if (restore) {
        const recovered = await window.api.agent[item.kind === 'api' ? 'restoreDeletedApiDraft' : 'restoreDeletedFlowDraft'](projectId, item.entity_id, result.data.deletion_id)
        if (!recovered.ok) throw new Error(recovered.error)
        setDraft(recovered.data)
      }
    } catch (error) { setError((error as Error).message) }
  }
  async function save(): Promise<void> {
    if (!draft || !record) return
    try {
      await flushAgentDrafts(); await flushFlowDrafts()
      const signature = 'target' in draft ? stableJson(targetDefinition(draft.target)) : flowSignature(draft.flow)
      const result = await window.api.agent[item.kind === 'api' ? 'saveDeletedApiDraft' : 'saveDeletedFlowDraft'](projectId, item.entity_id, record.deletion_id, signature)
      if (!result.ok) throw new Error(result.error)
      await onSaved()
    } catch (error) { setError((error as Error).message) }
  }
  const before = record ? record.kind === 'api' ? targetDefinition(record.snapshot) : flowDefinition(record.snapshot) : null
  const after = draft ? 'target' in draft ? targetDefinition(draft.target) : flowDefinition(draft.flow) : before
  return <section aria-label="删除对象恢复" style={{ marginTop: 12 }}>
    <p>删除于 {item.deleted_at}。候选、删除前定义和版本证据仍可审阅。恢复保留对象编号；原目录已删除时恢复到项目根目录。</p>
    <Space><Button onClick={() => void review(false)}>查看删除墓碑</Button><Button onClick={() => void review(true)}>恢复删除前草稿</Button>{draft && <Button type="primary" onClick={() => void save()}>正式保存恢复草稿</Button>}</Space>
    {error && <Alert type="warning" message={error} />}
    {draft && <Alert type="info" message="已恢复到本机草稿，尚未正式保存。候选恢复或后续编辑后，请重新点击恢复删除前草稿刷新审阅，再正式保存。" />}
    {record && <SnapshotDiff beforeLabel="删除前已保存定义" afterLabel={draft ? '恢复草稿' : '删除墓碑'} before={before} after={after} />}
  </section>
}
