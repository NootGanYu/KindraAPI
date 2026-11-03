import type { Target } from '@shared/types'
import { FIELD_TYPES, validateRules } from '@shared/fieldRules'

type Obj = Record<string, any>
type Check = (value: any, path: string) => void
const fail = (path: string): never => { throw new Error(`提案字段类型无效：${path}`) }
const text: Check = (value, path) => { if (typeof value !== 'string') fail(path) }
const number: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path) }
const bool: Check = (value, path) => { if (typeof value !== 'boolean') fail(path) }
const json: Check = () => {}
const oneOf = (values: unknown[]): Check => (value, path) => { if (!values.includes(value)) fail(path) }
const array = (item: Check): Check => (value, path) => { if (!Array.isArray(value)) fail(path); value.forEach((entry: unknown, index: number) => item(entry, `${path}[${index}]`)) }
const object: Check = (value, path) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path) }
const shape = (fields: Record<string, Check>, required: string[] = []): Check => (value, path) => {
  object(value, path)
  for (const key of required) if (!(key in value)) fail(`${path}.${key}`)
  for (const [key, entry] of Object.entries(value)) { if (!fields[key]) fail(`${path}.${key}`); fields[key](entry, `${path}.${key}`) }
}
const rules = { description: text, required: bool, nullable: bool, enum: (value: unknown, path: string) => { if (value !== null) array(json)(value, path) }, enum_descriptions: array(text), default: json, example: json }
const paramShape = shape({ ...rules, param_id: text, key: text, value: text, field_type: oneOf([...FIELD_TYPES, 'file']), is_checked: number, is_system: number, inherited_override: bool, schema: json, file_size: number, content_type: text }, ['param_id', 'key', 'value', 'is_checked'])
const param: Check = (value, path) => { paramShape(value, path); const errors = validateRules(value, value.field_type, path); if (errors.length) throw new Error(errors.join('\n')) }
const docsShape = shape({ ...rules, pointer: text, order: number, type: oneOf(FIELD_TYPES), mock: text, doc_only: bool, source: oneOf(['manual', 'openapi']) }, ['pointer'])
const doc: Check = (value, path) => { docsShape(value, path); const errors = validateRules(value, value.type, path); if (errors.length) throw new Error(errors.join('\n')) }
const params: Check = (value, path) => {
  array(param)(value, path)
  const ids = value.map((item: Obj) => item.param_id)
  if (ids.some((id: string) => !id) || new Set(ids).size !== ids.length) throw new Error(`提案参数稳定 ID 缺失或重复：${path}`)
}
const body = shape({ mode: oneOf(['none', 'raw', 'json', 'urlencoded', 'formdata', 'binary']), raw: text, raw_language: oneOf(['json', 'xml', 'text', 'html', 'javascript']), parameter: params, urlencoded: params, formdata: params, binary: shape({ file_path: text, data_url: text, file_name: text }), json: text, field_docs: array(doc), model_id: text })
const group = shape({ parameter: params })
const request = shape({ auth: object, header: group, query: shape({ parameter: params, omit_empty_equals: bool }), restful: group, cookie: group, body, pre_tasks: array(json), post_tasks: array(json), pre_script: text, test: text, pre_script_enabled: bool, test_enabled: bool })
const example = shape({ example_id: text, field_docs: array(doc), expect: shape({ name: text, code: (value, path) => { if (typeof value !== 'string') number(value, path) }, content_type: text, is_default: number, schema: json, verify_type: text, sleep: number, model_id: text }), raw: text, raw_parameter: params, headers: params, cookies: params, request: shape({ body_mode: text, method: text, url: text, headers: params, body: text }) }, ['example_id'])
const response = shape({ example: array(example) })
const attributes: Check = (value, path) => { object(value, path); for (const [id, entry] of Object.entries(value)) if (entry !== null && typeof entry !== 'string' && typeof entry !== 'number') array(text)(entry, `${path}.${id}`) }
const stableId: Check = (value, path) => { text(value, path); if (!value.trim() || value.length > 200) fail(path) }
const identified = (item: Check, key: string): Check => (value, path) => {
  array(item)(value, path)
  if (new Set(value.map((entry: Obj) => entry[key])).size !== value.length) throw new Error(`提案稳定 ID 重复：${path}.${key}`)
}
const assertion = shape({ assertion_id: stableId, kind: oneOf(['status', 'duration', 'json']), op: oneOf(['equals', 'not_equals', 'contains', 'exists', 'gt', 'lt']), path: text, expected: text, is_enabled: oneOf([0, 1]) }, ['assertion_id', 'kind', 'op', 'is_enabled'])
const override = shape({ method: text, url: text, headers: params, query: params, restful: params, body_mode: oneOf(['none', 'raw', 'json', 'urlencoded', 'formdata', 'binary']), body: text, formdata: params, urlencoded: params })
const apiCase = shape({ case_id: stableId, name: text, description: text, is_enabled: oneOf([0, 1]), override, assertions: identified(assertion, 'assertion_id') }, ['case_id', 'name', 'is_enabled', 'override', 'assertions'])
const cases = identified(apiCase, 'case_id')
/** Runtime patch boundary: optional fields stay partial, supplied groups/rows retain their domain shape. */
export function validateNestedPatch(patch: Obj): void {
  shape({ name: text, description: text, method: text, url: text, mark_id: text, request, response, custom_attributes: attributes, cases })(patch, 'patch')
}

export function validateSystemParameterOrigins(previous: Target, next: Target): void {
  for (const slot of ['header', 'query', 'restful', 'cookie'] as const) for (const param of next.request?.[slot].parameter ?? []) {
    if ((param.is_system ?? 0) <= 0) continue
    const original = previous.request?.[slot].parameter.find(item => item.param_id === param.param_id)
    if (!original || original.key !== param.key || original.is_system !== param.is_system) throw new Error('不能将业务参数伪装为系统字段绕过文档校验')
  }
}
