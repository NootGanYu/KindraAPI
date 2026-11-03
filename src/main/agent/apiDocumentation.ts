import type { Target } from '@shared/types'
import { buildFieldRows, pointerToPath } from '@shared/jsonFields'
import { stableJson } from '@shared/targetSync'
import { assertModelDocumentation } from '../docs/definition'
import { assertDocumentationPaths, validateFieldExamples } from '../mcp/apiDocumentation'

type Obj = Record<string, any>
/** Keep explicit submission intent as well as actual draft deltas, including save-only plans. */
function changedFields(before: unknown, after: unknown): unknown {
  if (stableJson(before) === stableJson(after)) return undefined
  if (Array.isArray(after) && after.every(item => item && typeof item === 'object' && typeof item.example_id === 'string')) {
    return after.flatMap(item => {
      const diff = changedFields(Array.isArray(before) ? before.find(old => old.example_id === item.example_id) : undefined, item) as Obj | undefined
      return diff ? [{ ...diff, example_id: item.example_id }] : []
    })
  }
  if (!after || typeof after !== 'object' || Array.isArray(after)) return after
  return Object.fromEntries(Object.entries(after).flatMap(([key, value]) => {
    const next = changedFields((before as Obj | undefined)?.[key], value)
    return next === undefined ? [] : [[key, next]]
  }))
}
export function validateAgentApiDocumentation(target: Target, previous: Target | null, patches: Array<Partial<Target>>): void {
  const submitted = new Set<string>()
  const inspect = (patch: Obj): void => {
    if ('description' in patch) submitted.add('api.description')
    if ('url' in patch) submitted.add('api.url')
    for (const slot of ['header', 'query', 'restful', 'cookie'] as const) {
      for (const param of patch.request?.[slot]?.parameter ?? []) submitted.add(`${slot}.${param.key}`)
    }
    const body = patch.request?.body
    if (body) {
      const finalBody = target.request?.body
      if (finalBody?.model_id && ('raw' in body || 'field_docs' in body)) throw new Error('body: 先解除模型引用后才能单独编辑，不能将展开快照写入定义')
      if (finalBody?.mode === 'json' && finalBody.raw?.trim()) {
        try { JSON.parse(finalBody.raw) } catch { throw new Error('body.raw: 无效 JSON，正式定义未保存') }
      }
      if (finalBody?.mode === 'json' && !finalBody.model_id) validateFieldExamples(finalBody.raw, finalBody.field_docs ?? [], 'body')
      for (const doc of body.field_docs ?? []) if (doc.pointer) submitted.add(`body.${pointerToPath(doc.pointer)}`)
      for (const slot of ['formdata', 'urlencoded', 'parameter']) for (const param of body[slot] ?? []) submitted.add(`body.${param.key}`)
      // Raw data exposes known fields too; it cannot be used to omit required business rules.
      if ('raw' in body || 'mode' in body || 'model_id' in body) {
        const final = target.request?.body
        if (final?.mode === 'json') for (const row of buildFieldRows(final.raw ?? '', final.field_docs ?? []).exportedRows) if (!row.synthetic) submitted.add(`body.${row.path}`)
      }
      if (target.request?.body.model_id) assertModelDocumentation(target.project_id, target.request.body.model_id)
    }
    for (const example of patch.response?.example ?? []) {
      const final = target.response?.example?.find(item => item.example_id === example.example_id)
      if (final?.expect?.model_id && ('raw' in example || 'field_docs' in example)) throw new Error('response: 先解除模型引用后才能单独编辑')
      if (final && !final.expect?.model_id) {
        if ((final.expect?.content_type ?? 'application/json').includes('json') && final.raw?.trim()) {
          try { JSON.parse(final.raw) } catch { throw new Error('response.raw: 无效 JSON，正式定义未保存') }
        }
        validateFieldExamples(final.raw, final.field_docs ?? [], 'response')
      }
      for (const doc of example.field_docs ?? []) if (doc.pointer) submitted.add(`response.${pointerToPath(doc.pointer)}`)
      if (final) for (const row of buildFieldRows(final.raw ?? '', final.field_docs ?? []).exportedRows) if (!row.synthetic) submitted.add(`response.${row.path}`)
      if (final?.expect?.model_id) assertModelDocumentation(target.project_id, final.expect.model_id)
    }
  }
  for (const patch of [...patches, changedFields(previous, target) as Obj ?? {}]) inspect(patch)
  try { assertDocumentationPaths(target, previous ? submitted : null) }
  catch (error) { throw new Error(`${(error as Error).message}\n缺少业务依据时请先向用户澄清；草稿已保留，正式定义未保存。`) }
}
