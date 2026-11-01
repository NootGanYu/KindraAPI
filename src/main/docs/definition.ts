import type { BodyModel, FieldDoc, ResponseExample, Target } from '@shared/types'
import { fieldDocsFromSchema, mergeFieldDocs } from '@shared/jsonFields'
import { documentedQuery } from '@shared/fieldRules'
import { generateFromSchema, resolveModelRefs } from '../schema/example'

export function documentedRequestExample(target: Target): string {
  let url = target.url ?? ''
  const query = (target.request?.query.parameter ?? []).filter(p => p.key && (p.is_checked > 0 || (p.is_system ?? 0) > 0))
  if (query.length) url += (url.includes('?') ? '&' : '?') + query.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
  for (const p of target.request?.restful.parameter ?? []) if (p.key && p.is_checked > 0) {
    url = url.replace(`:${p.key}`, encodeURIComponent(p.value)).replace(`{${p.key}}`, encodeURIComponent(p.value))
  }
  return `${target.method || 'GET'} ${url}`
}

export function responseDocs(example: ResponseExample): FieldDoc[] {
  return mergeFieldDocs(fieldDocsFromSchema(example.expect?.schema), example.field_docs).map(doc => ({ ...doc, doc_only: true }))
}

export function modelDocumentationWarnings(target: Target): Array<{ path: string; message: string }> {
  const references = [
    { path: 'body.model_id', id: target.request?.body.model_id },
    ...(target.response?.example ?? []).map(example => ({ path: `response.${example.example_id}.model_id`, id: example.expect?.model_id }))
  ]
  return references.flatMap(ref => ref.id ? resolveModelRefs(target.project_id, { $ref: `kindraapi://model/${ref.id}` }).warnings.map(warning => ({ path: ref.path, message: warning.message })) : [])
}

export function assertModelDocumentation(projectId: string, modelId: string): void {
  const result = resolveModelRefs(projectId, { $ref: `kindraapi://model/${modelId}` })
  if (result.warnings.length) throw new Error('无法保留完整模型定义：' + result.warnings.map(warning => warning.message).join('；'))
}

export function resolveDocumentedTarget(target: Target): Target {
  const result = structuredClone(target)
  const resolveBody = (body: BodyModel): BodyModel => {
    const documented = { ...body, field_docs: body.field_docs?.map(doc => ({ ...doc, doc_only: true })) }
    if (!body.model_id) return documented
    const resolved = resolveModelRefs(target.project_id, { $ref: `kindraapi://model/${body.model_id}` })
    if (resolved.warnings.length) return documented
    const generated = generateFromSchema(target.project_id, resolved.schema)
    return { ...body, raw: JSON.stringify(generated.value, null, 2), field_docs: fieldDocsFromSchema(resolved.schema) }
  }
  if (result.request) {
    result.request.query.parameter = documentedQuery(result.url ?? '', result.request.query.parameter)
    result.request.body = resolveBody(result.request.body)
  }
  if (result.response) {
    result.response.example = (result.response.example ?? []).map(example => {
      const body = resolveBody({ mode: 'json', raw: example.raw, model_id: example.expect?.model_id, field_docs: responseDocs(example) })
      return { ...example, raw: body.raw, field_docs: body.field_docs }
    })
  }
  return result
}
