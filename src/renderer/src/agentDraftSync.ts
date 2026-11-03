import { flushFlowDrafts } from './flowDraftSync'
import { stableJson, targetDefinition } from '@shared/targetSync'
import type { Result } from '@shared/types'
import { useApp } from './store'

let pending: Promise<unknown> = Promise.resolve()
function enqueue(operation: () => Promise<Result<unknown>>): void {
  pending = pending.catch(() => {}).then(async () => {
    const result = await operation()
    if (!result.ok) throw new Error(result.error)
  }).catch(error => { useApp.setState({ syncNotice: `Agent 草稿暂存失败：${error.message}` }); throw error })
  void pending.catch(() => {})
}
/** Main-process drafts survive tabs/project navigation; synchronous editor mutations are queued in order. */
export function connectAgentDraftSync(): () => void {
  let projectingMain = false
  const off = useApp.subscribe((state, previous) => {
    if (projectingMain) return
    const projectChanged = state.project?.project_id !== previous.project?.project_id
    if (!projectChanged && state.drafts === previous.drafts) return
    if (previous.project) for (const [id, draft] of Object.entries(previous.drafts)) {
      if (draft.target_type === 'api' && (projectChanged || !state.drafts[id])) {
        const projectId = previous.project.project_id
        enqueue(() => window.api.agent.releaseEditorDraft(projectId, id))
      }
    }
    if (!state.project) return
    for (const [id, draft] of Object.entries(state.drafts)) {
      if (draft.target_type !== 'api' || (!projectChanged && draft === previous.drafts[id])) continue
      const projectId = state.project.project_id
      const baseRevision = state.baselines[id]?.revision
      enqueue(() => window.api.agent.syncEditorDraft(projectId, draft, baseRevision))
    }
  })
  const offEvent = window.api.agent.onDraftChanged(event => {
    const state = useApp.getState()
    if (!event.draft || event.project_id !== state.project?.project_id || !state.drafts[event.target_id]) return
    const current = state.drafts[event.target_id]
    if (event.previous && stableJson(targetDefinition(current)) !== stableJson(targetDefinition(event.previous))) {
      useApp.setState({ syncNotice: 'Agent 应用期间出现新的人工编辑，已保留人工内容，请重新审阅候选。' })
      return
    }
    projectingMain = true
    try {
      const savedTarget = event.saved_target ?? event.draft.target
      const remainsDirty = !event.saved_revision || stableJson(targetDefinition(event.draft.target)) !== stableJson(targetDefinition(savedTarget))
      const pendingUpdates = { ...state.pendingUpdates }
      if (event.saved_revision) delete pendingUpdates[event.target_id]
      useApp.setState({
        drafts: { ...state.drafts, [event.target_id]: event.draft.target },
        ...(event.saved_revision ? { baselines: { ...state.baselines, [event.target_id]: { target: savedTarget, revision: event.saved_revision } }, pendingUpdates } : {}),
        tabs: state.tabs.map(tab => tab.id === event.target_id ? { ...tab, name: event.draft!.target.name, dirty: remainsDirty, resetKey: (tab.resetKey ?? 0) + 1 } : tab),
        syncNotice: event.saved_revision && remainsDirty ? 'Agent 获批范围已保存；仍有其他未保存草稿。' : event.saved_revision ? 'Agent 获批保存已完成，候选已关联正式版本。' : 'Agent 候选已应用到草稿；正式定义尚未保存。'
      })
    } finally { projectingMain = false }
  })
  return () => { off(); offEvent() }
}
export async function flushAgentDrafts(): Promise<void> {
  await pending
  await flushFlowDrafts()
  const state = useApp.getState()
  if (!state.project) return
  for (const draft of Object.values(state.drafts)) {
    if (draft.target_type !== 'api') continue
    const result = await window.api.agent.syncEditorDraft(state.project.project_id, draft, state.baselines[draft.target_id]?.revision)
    if (!result.ok) throw new Error(result.error)
  }
}
