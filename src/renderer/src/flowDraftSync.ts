import type { Flow } from '@shared/types'
let pending: Promise<void> = Promise.resolve()
export function syncFlowDraft(projectId: string, flow: Flow): Promise<void> {
  pending = pending.catch(() => {}).then(async () => {
    const result = await window.api.agent.syncFlowEditorDraft(projectId, flow)
    if (!result.ok) throw new Error(result.error)
  })
  return pending
}
export async function flushFlowDrafts(): Promise<void> { await pending }
