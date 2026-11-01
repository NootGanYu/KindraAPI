import type { BodyModel, FieldDoc, FieldRules, Param, ResponseExample, Target } from '@shared/types'
import { createId, createParam, createRequest, createTarget } from '@shared/factories'
import { buildFieldRows, normalizeFieldDocs, splitPointer, withDisplayPath } from '@shared/jsonFields'
import { FIELD_TYPES, RULE_KEYS, validateRules } from '@shared/fieldRules'
import * as store from '../storage/store'
import { assertModelDocumentation, modelDocumentationWarnings, resolveDocumentedTarget, responseDocs } from '../docs/definition'

type Obj = Record<string, unknown>
const object = (value: unknown, path: string): Obj => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: 必须是对象`)
  return value as Obj
}
const string = (value: unknown, path: string): string => {
  if (typeof value !== 'string') throw new Error(`${path}: 必须是字符串`)
  return value
}
function checkKeys(value: Obj, keys: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${path}.${key}: 未知属性，请按工具 schema 提交`)
}
const properties = {
  type: { type: 'string', enum: FIELD_TYPES },
  description: { type: 'string', description: '业务含义；未知可省略，不能从示例猜测' },
  required: { type: 'boolean', description: '请求必填/响应必有，省略为未知' },
  nullable: { type: 'boolean', description: '是否允许 null；与必填分别表达' },
  enum: { type: ['array', 'null'], items: {}, description: '非空枚举列表；null 明确无限制；省略未知' },
  enum_descriptions: { type: 'array', items: { type: 'string' }, description: '与 enum 逐项对应的业务含义' },
  default: { description: '默认值，保留 JSON 类型' },
  example: { description: '字段示例值，保留 JSON 类型' },
  remove: { type: 'boolean', description: 'true 显式删除字段定义及子字段' },
  unset: { type: 'array', items: { type: 'string', enum: RULE_KEYS }, description: '显式清除指定规则，恢复待补充' }
}
export const fieldDocsSchema = { type: 'array', description: '按路径增量合并；省略保留，remove 显式删除。无需 raw 中存在。', items: {
  type: 'object', properties: { ...properties, path: { type: 'string', description: '如 data.items[].id' }, pointer: { type: 'string', description: '或 JSON Pointer，如 /data/items/*/id' } }, additionalProperties: false
} }
export const paramsSchema = { type: 'array', description: '按 key 增量合并；未提交参数保留，remove:true 删除', items: {
  type: 'object', properties: { ...properties, key: { type: 'string' }, value: { type: 'string' }, checked: { type: 'boolean' }, field_type: { type: 'string', enum: [...FIELD_TYPES, 'file'] } }, required: ['key'], additionalProperties: false
} }
export const bodySchema = { type: 'object', properties: {
  mode: { type: 'string', enum: ['none', 'raw', 'json', 'urlencoded', 'formdata', 'binary'] }, raw: { type: 'string' },
  field_docs: fieldDocsSchema, parameters: paramsSchema,
  model_id: { type: ['string', 'null'], description: '引用模型；null 解除引用并保留完整定义' }
}, additionalProperties: false }
export const successSchema = { type: 'object', properties: {
  example_id: { type: 'string', description: '可选，精确更新已有成功示例；省略使用默认成功响应' },
  name: { type: 'string' }, code: { type: ['number', 'string'], description: '成功响应 HTTP 状态码，默认 200' },
  content_type: { type: 'string' }, raw: { description: '可选响应示例；对象或 JSON 字符串' },
  field_docs: fieldDocsSchema, model_id: { type: ['string', 'null'] }
}, additionalProperties: false }
export const apiDocumentationProperties = {
  project_id: { type: 'string' }, target_id: { type: 'string', description: '更新已有接口的 ID' },
  source_key: { type: 'string', description: '项目内稳定且唯一的代码标识，如 OrderController.detail；重复调用更新同一接口。新建必需。' },
  name: { type: 'string' }, method: { type: 'string' }, url: { type: 'string' }, description: { type: 'string' }, parent_id: { type: 'string' },
  headers: paramsSchema, query: paramsSchema, paths: paramsSchema, cookies: paramsSchema,
  body: bodySchema, success_response: successSchema,
  auth: { type: 'object', description: '认证配置；省略保留' }
}

function patchRules(previous: FieldRules, patch: Obj, path: string): FieldRules {
  const next = { ...previous }
  for (const key of RULE_KEYS) if (Object.hasOwn(patch, key)) (next as Obj)[key] = patch[key]
  if (patch.unset !== undefined) {
    if (!Array.isArray(patch.unset)) throw new Error(`${path}.unset: 必须是数组`)
    for (const key of patch.unset) {
      if (!RULE_KEYS.includes(key as typeof RULE_KEYS[number])) {
        throw new Error(`${path}.unset: 不支持 ${key}`)
      }
      const writable = next as Obj
      writable[String(key)] = undefined
    }
  }
  if (next.enum == null && patch.enum_descriptions === undefined) next.enum_descriptions = undefined
  return next
}

export function patchFieldDocs(previous: FieldDoc[] = [], input: unknown, path: string): FieldDoc[] {
  if (!Array.isArray(input)) throw new Error(`${path}: 必须是数组`)
  let docs: FieldDoc[] = previous.map(doc => ({ ...doc, doc_only: true }))
  for (const entry of input) {
    const patch = object(entry, path)
    checkKeys(patch, [...RULE_KEYS, 'pointer', 'path', 'type', 'source', 'doc_only', 'remove', 'unset'], path)
    if (patch.remove !== undefined && typeof patch.remove !== 'boolean') throw new Error(`${path}.remove: 必须是 boolean`)
    const normalized = normalizeFieldDocs([patch])?.[0]
    if (!normalized) throw new Error(`${path}: 无效字段路径 ${patch.pointer ?? patch.path ?? ''}`)
    const pointer = normalized.pointer
    if (patch.remove === true) { docs = docs.filter(d => d.pointer !== pointer && !d.pointer.startsWith(pointer + '/')); continue }
    if (patch.type !== undefined && !FIELD_TYPES.includes(patch.type as any)) throw new Error(`${path}${pointer}: 无效类型`)
    const old: FieldDoc = docs.find(d => d.pointer === pointer) ?? { pointer }
    const next: FieldDoc = { ...old, ...patchRules(old, patch, path + pointer), pointer, doc_only: true }
    if (patch.type !== undefined) next.type = patch.type as FieldDoc['type']
    const errors = validateRules(next, next.type, path + pointer)
    if (errors.length) throw new Error(errors.join('\n'))
    docs = docs.filter(d => d.pointer !== pointer)
    docs.push(next)
  }
  return docs
}

export function patchParams(previous: Param[], input: unknown, path: string): Param[] {
  if (!Array.isArray(input)) throw new Error(`${path}: 必须是数组`)
  let params = previous.map(p => ({ ...p }))
  for (const entry of input) {
    const patch = object(entry, path)
    checkKeys(patch, [...RULE_KEYS, 'key', 'value', 'type', 'field_type', 'param_id', 'checked', 'is_checked', 'is_system', 'schema', 'file_size', 'remove', 'unset'], path)
    const key = string(patch.key, `${path}.key`)
    if (!key.trim()) throw new Error(`${path}: 参数名不能为空`)
    if (patch.remove !== undefined && typeof patch.remove !== 'boolean') throw new Error(`${path}.remove: 必须是 boolean`)
    if (patch.remove === true) { params = params.filter(p => p.key !== key); continue }
    const old = params.find(p => p.key === key) ?? createParam({ key })
    const next: Param = { ...old, ...patchRules(old, patch, path + '.' + key) }
    if (patch.value !== undefined) next.value = string(patch.value, `${path}.${key}.value`)
    if (patch.checked !== undefined) {
      if (typeof patch.checked !== 'boolean') throw new Error(`${path}.${key}.checked: 必须是 boolean`)
      next.is_checked = patch.checked ? 1 : -1
    }
    if (patch.is_checked !== undefined) next.is_checked = Number(patch.is_checked)
    if (patch.type !== undefined || patch.field_type !== undefined) next.field_type = String(patch.type ?? patch.field_type)
    if (next.field_type && ![...FIELD_TYPES, 'file'].includes(next.field_type as any)) throw new Error(`${path}.${key}: 无效类型`)
    const errors = validateRules(next, next.field_type, `${path}.${key}`)
    if (errors.length) throw new Error(errors.join('\n'))
    const index = params.findIndex(p => p.key === key)
    if (index < 0) params.push(next); else params[index] = next
  }
  return params
}

function removeFieldsFromExample(raw: string | undefined, input: unknown): string | undefined {
  if (!raw || !Array.isArray(input)) return raw
  const removals = input.filter(item => item?.remove === true)
  if (!removals.length) return raw
  let value: unknown
  try { value = JSON.parse(raw) } catch { return raw }
  const remove = (node: unknown, parts: string[]): void => {
    if (!node || typeof node !== 'object' || !parts.length) return
    const [key, ...rest] = parts
    if (key === '*' && Array.isArray(node)) {
      if (!rest.length) node.splice(0)
      else for (const item of node) remove(item, rest)
    } else if (Object.hasOwn(node, key)) {
      if (rest.length) remove((node as Obj)[key], rest)
      else delete (node as Obj)[key]
    }
  }
  for (const entry of removals) {
    const doc = normalizeFieldDocs([entry])?.[0]
    if (doc) remove(value, splitPointer(doc.pointer))
  }
  return JSON.stringify(value, null, 2)
}

function validateFieldExamples(raw: string | undefined, docs: FieldDoc[], scope: string): void {
  const byPath = new Map(docs.map(doc => [doc.pointer, doc]))
  for (const doc of docs) {
    const parts = doc.pointer.split('/')
    for (let i = 2; i < parts.length; i++) {
      const parent = byPath.get(parts.slice(0, i).join('/'))
      const expected = parts[i] === '*' ? 'array' : 'object'
      if (parent?.type && parent.type !== 'unknown' && parent.type !== expected) throw new Error(`${scope}${parent.pointer}: 子字段要求父节点为 ${expected}`)
    }
  }
  if (!raw?.trim()) return
  let root: unknown
  try { root = JSON.parse(raw) } catch { return }
  const values = (node: unknown, parts: string[]): unknown[] => {
    if (!parts.length) return [node]
    if (!node || typeof node !== 'object') return []
    const [key, ...rest] = parts
    if (key === '*' && Array.isArray(node)) return node.flatMap(item => values(item, rest))
    return Object.hasOwn(node, key) ? values((node as Obj)[key], rest) : []
  }
  for (const doc of docs) for (const value of values(root, splitPointer(doc.pointer))) {
    const errors = validateRules({ ...doc, example: value }, doc.type, scope + doc.pointer)
    if (errors.length) throw new Error(errors.join('\n'))
  }
}

export function patchBody(target: Target, patch: Obj): void {
  checkKeys(patch, ['mode', 'raw', 'field_docs', 'parameters', 'model_id', 'parameter', 'urlencoded', 'formdata', 'binary', 'json'], 'body')
  const body = target.request!.body
  if (patch.model_id !== undefined && patch.model_id !== null && typeof patch.model_id !== 'string') throw new Error('body.model_id: 必须是字符串或 null')
  if (patch.model_id === null && body.model_id) {
    assertModelDocumentation(target.project_id, body.model_id)
    Object.assign(body, resolveDocumentedTarget(target).request!.body)
    delete body.model_id
  } else if (typeof patch.model_id === 'string') {
    if (!store.getModel(target.project_id, patch.model_id)) throw new Error('body.model_id: 模型不存在')
    assertModelDocumentation(target.project_id, patch.model_id)
    body.model_id = patch.model_id
  }
  if (body.model_id && (patch.field_docs !== undefined || patch.raw !== undefined)) throw new Error('body: 引用模型时不能覆盖字段或示例，请先 model_id:null 解除引用')
  if (patch.mode !== undefined) {
    if (!['none', 'raw', 'json', 'urlencoded', 'formdata', 'binary'].includes(String(patch.mode))) throw new Error('body.mode 无效')
    body.mode = patch.mode as BodyModel['mode']
  }
  if (patch.raw !== undefined) body.raw = string(patch.raw, 'body.raw')
  if (patch.json !== undefined) body.json = string(patch.json, 'body.json')
  if (patch.binary !== undefined) body.binary = { ...body.binary, ...object(patch.binary, 'body.binary') }
  if (patch.field_docs !== undefined) {
    body.field_docs = patchFieldDocs(body.field_docs, patch.field_docs, 'body')
    body.raw = removeFieldsFromExample(body.raw, patch.field_docs)
    if (body.mode === 'none') body.mode = 'json'
  }
  if (body.mode === 'json' && body.raw?.trim()) { try { JSON.parse(body.raw) } catch { throw new Error('body.raw: 无效 JSON') } }
  if (body.mode === 'json') validateFieldExamples(body.raw, body.field_docs ?? [], 'body')
  if (patch.parameters !== undefined) {
    if (body.mode !== 'formdata' && body.mode !== 'urlencoded') throw new Error('body.parameters: 需要 formdata 或 urlencoded 模式')
    body[body.mode] = patchParams(body[body.mode] ?? [], patch.parameters, 'body.parameters')
  }
}

export function patchSuccessResponse(target: Target, patch: Obj): void {
  checkKeys(patch, ['example_id', 'name', 'code', 'content_type', 'raw', 'field_docs', 'model_id', 'is_default', 'schema', 'verify_type'], 'success_response')
  target.response ??= { example: [] }
  const examples = target.response.example ?? []
  const index = patch.example_id !== undefined
    ? examples.findIndex(e => e.example_id === patch.example_id)
    : examples.findIndex(e => /^2\d\d$/.test(String(e.expect?.code ?? 200)))
  if (patch.example_id !== undefined && index < 0) throw new Error('success_response.example_id: 示例不存在')
  const previous = index < 0 ? undefined : examples[index]
  const next: ResponseExample = structuredClone(previous ?? { example_id: createId('ex'), expect: { name: '成功', code: 200, content_type: 'application/json', is_default: 1 } })
  next.expect ??= {}
  if (patch.model_id !== undefined && patch.model_id !== null && typeof patch.model_id !== 'string') throw new Error('success_response.model_id: 必须是字符串或 null')
  next.field_docs = responseDocs(next)
  delete next.expect.schema
  if (patch.model_id === null && next.expect.model_id) {
    assertModelDocumentation(target.project_id, next.expect.model_id)
    const resolved = resolveDocumentedTarget(target).response?.example?.[index]
    if (resolved) { next.raw = resolved.raw; next.field_docs = resolved.field_docs }
    delete next.expect.model_id
  } else if (typeof patch.model_id === 'string') {
    if (!store.getModel(target.project_id, patch.model_id)) throw new Error('success_response.model_id: 模型不存在')
    assertModelDocumentation(target.project_id, patch.model_id)
    next.expect.model_id = patch.model_id
  }
  if (next.expect.model_id && (patch.raw !== undefined || patch.field_docs !== undefined)) throw new Error('success_response: 先解除模型引用后才能单独编辑')
  for (const key of ['name', 'content_type'] as const) if (patch[key] !== undefined) next.expect[key] = string(patch[key], `success_response.${key}`)
  if (patch.code !== undefined) {
    if (!/^2\d\d$/.test(String(patch.code))) throw new Error('success_response.code: 本期支持 2xx 成功响应')
    next.expect.code = patch.code as number | string
  }
  if (patch.raw !== undefined) next.raw = typeof patch.raw === 'string' ? patch.raw : JSON.stringify(patch.raw, null, 2)
  if ((next.expect.content_type ?? 'application/json').includes('json') && next.raw?.trim()) { try { JSON.parse(next.raw) } catch { throw new Error('success_response.raw: 无效 JSON') } }
  if (patch.field_docs !== undefined) {
    next.field_docs = patchFieldDocs(next.field_docs, patch.field_docs, 'success_response')
    next.raw = removeFieldsFromExample(next.raw, patch.field_docs)
  }
  validateFieldExamples(next.raw, next.field_docs ?? [], 'success_response')
  if (index < 0) examples.push(next); else examples[index] = next
  target.response.example = examples
}

export function documentationIssues(target: Target): Array<{ path: string; missing: string[] }> {
  const result: Array<{ path: string; missing: string[] }> = []
  const inspect = (path: string, rules: FieldRules, type?: string): void => {
    const missing: string[] = []
    if (!type || type === 'unknown') missing.push('type')
    if (!rules.description?.trim()) missing.push('description')
    if (rules.required === undefined) missing.push('required')
    if (rules.nullable === undefined) missing.push('nullable')
    if (rules.enum === undefined) missing.push('enum')
    if (Array.isArray(rules.enum) && rules.enum.some((_, i) => !rules.enum_descriptions?.[i]?.trim())) missing.push('enum_descriptions')
    if (missing.length) result.push({ path, missing })
  }
  const resolved = resolveDocumentedTarget(target)
  for (const warning of modelDocumentationWarnings(target)) result.push({ path: warning.path, missing: [warning.message] })
  for (const slot of ['header', 'query', 'restful', 'cookie'] as const) for (const p of resolved.request?.[slot].parameter ?? []) inspect(`${slot}.${p.key}`, p, p.field_type)
  const body = resolved.request?.body
  if (body?.mode === 'formdata' || body?.mode === 'urlencoded') for (const p of body[body.mode] ?? []) inspect(`body.${p.key}`, p, p.field_type)
  if (body?.mode === 'json') for (const row of buildFieldRows(body.raw ?? '', body.field_docs ?? []).exportedRows) inspect('body.' + row.path, row.doc ?? {}, row.type)
  for (const example of resolved.response?.example ?? []) for (const row of buildFieldRows(example.raw ?? '', example.field_docs ?? []).exportedRows) inspect('response.' + row.path, row.doc ?? {}, row.type)
  return result
}

export function writeApiDocumentation(args: Obj, allowNew = false): unknown {
  checkKeys(args, [...Object.keys(apiDocumentationProperties), 'response_example'], 'api')
  const projectId = string(args.project_id, 'project_id')
  let existing: Target | null = null
  if (args.target_id) {
    existing = store.getTarget(projectId, string(args.target_id, 'target_id'))
    if (!existing || existing.target_type !== 'api') throw new Error('接口不存在')
  }
  if (args.source_key !== undefined) {
    const key = string(args.source_key, 'source_key').trim()
    if (!key) throw new Error('source_key 不能为空')
    const matches = store.listTargets(projectId).map(t => store.getTarget(projectId, t.target_id)).filter(t => t?.source_key === key)
    if (matches.length > 1 || (existing && matches.some(t => t?.target_id !== existing!.target_id))) throw new Error('source_key 存在冲突，请指定唯一标识')
    existing ??= matches[0] ?? null
  }
  if (!existing && !allowNew && !args.source_key) throw new Error('新建需要稳定 source_key；更新可使用 target_id')
  const target = structuredClone(existing ?? createTarget(projectId, String(args.parent_id ?? '0'), 'api'))
  if (!existing && (!args.name || !args.url)) throw new Error('新建需要 name 和 url')
  if (args.parent_id !== undefined && args.parent_id !== '0') {
    const parent = store.getTarget(projectId, string(args.parent_id, 'parent_id'))
    if (!parent || parent.target_type !== 'folder') throw new Error('父目录不存在')
  }
  for (const key of ['name', 'url', 'description', 'parent_id', 'source_key'] as const) if (args[key] !== undefined) target[key] = string(args[key], key)
  if (target.source_key) target.source_key = target.source_key.trim()
  if (args.method !== undefined) {
    const method = string(args.method, 'method').toUpperCase()
    if (!/^[A-Z]+$/.test(method)) throw new Error('method 无效')
    target.method = method
  }
  target.request ??= createRequest()
  for (const [key, slot] of [['headers', 'header'], ['query', 'query'], ['paths', 'restful'], ['cookies', 'cookie']] as const) if (args[key] !== undefined) target.request[slot].parameter = patchParams(target.request[slot].parameter, args[key], key)
  if (args.auth !== undefined) target.request.auth = { ...target.request.auth, ...object(args.auth, 'auth') }
  if (args.body !== undefined) patchBody(target, object(args.body, 'body'))
  if (args.success_response !== undefined || args.response_example !== undefined) patchSuccessResponse(target, object(args.success_response ?? args.response_example, 'success_response'))
  const issues = documentationIssues(target)
  const saved = store.saveTarget(projectId, target)
  const api = structuredClone(saved)
  if (api.request?.body.field_docs) api.request.body.field_docs = api.request.body.field_docs.map(withDisplayPath)
  for (const example of api.response?.example ?? []) if (example.field_docs) example.field_docs = example.field_docs.map(withDisplayPath)
  return { api, target_id: api.target_id, created: !existing, documentation: { complete: issues.length === 0, issues } }
}
