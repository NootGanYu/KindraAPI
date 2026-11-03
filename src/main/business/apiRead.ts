import type { Target } from '@shared/types'
import { withDisplayPath } from '@shared/jsonFields'
import { resolveDocumentedTarget } from '../docs/definition'
import { getTarget } from '../storage/store'

/** Business projection shared by callers; each entry point owns its authorization policy. */
export function withDisplayFieldDocs(target: Target): Target {
  const next = resolveDocumentedTarget(target)
  if (next.request?.body.field_docs) next.request.body.field_docs = next.request.body.field_docs.map(withDisplayPath)
  for (const example of next.response?.example ?? []) if (example.field_docs) example.field_docs = example.field_docs.map(withDisplayPath)
  return next
}
export function readApiDetail(projectId: string, targetId: string, draft?: Target): { api: Target } {
  const saved = getTarget(projectId, targetId)
  if (!saved) throw new Error('接口不存在')
  const target = draft ?? saved
  if (target.project_id !== projectId || target.target_id !== targetId) throw new Error('接口不属于所选项目')
  return { api: withDisplayFieldDocs(structuredClone(target)) }
}
