import { DICT_FIELD_TYPES } from '@shared/types'
import type { DictFieldType, FieldRules, Target } from '@shared/types'
import type { DictionaryField } from '@shared/dictionaryImport'
import { buildFieldRows } from '@shared/jsonFields'
import { rulesToSchema } from '@shared/fieldRules'
import { resolveDocumentedTarget } from '../docs/definition'

const text = (value: unknown): string => value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)

/** Extract documented metadata only. Runtime examples must not become defaults or descriptions. */
export function dictionaryFieldsFromTarget(input: Target): DictionaryField[] {
  const target = resolveDocumentedTarget(input)
  const fields: DictionaryField[] = []
  const add = (key: string, type: string | undefined, rules: FieldRules): void => {
    if (!key || key === '*') return
    const field_type = DICT_FIELD_TYPES.includes(type as DictFieldType) ? type as DictFieldType : 'string'
    fields.push({ key, field_type, description: rules.description ?? '', default_value: text(rules.default), schema: { type: field_type, ...rulesToSchema(rules) } })
  }
  const request = target.request
  if (request) {
    for (const param of [...request.header.parameter, ...request.query.parameter, ...request.restful.parameter, ...request.cookie.parameter, ...(request.body.parameter ?? []), ...(request.body.formdata ?? []), ...(request.body.urlencoded ?? [])]) add(param.key, param.field_type, param)
    for (const row of buildFieldRows(request.body.raw ?? '', request.body.field_docs ?? []).exportedRows) add(row.name, row.type, row.doc ?? {})
  }
  for (const example of target.response?.example ?? []) {
    for (const row of buildFieldRows(example.raw ?? '', example.field_docs ?? []).exportedRows) add(row.name, row.type, row.doc ?? {})
    for (const header of example.headers ?? []) add(header.key, header.field_type, header)
  }
  const seen = new Set<string>()
  return fields.filter(field => { const identity = JSON.stringify(field); if (seen.has(identity)) return false; seen.add(identity); return true })
}
