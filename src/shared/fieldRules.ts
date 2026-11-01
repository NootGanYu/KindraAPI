import type { FieldRules, JsonFieldType, Param } from './types'

export const RULE_KEYS = ['required', 'nullable', 'description', 'enum', 'enum_descriptions', 'default', 'example'] as const
export const unknownRule = '待补充'
export const ruleBoolean = (value: boolean | undefined): string => value === undefined ? unknownRule : value ? '是' : '否'
export const ruleValue = (value: unknown): string => value === undefined ? '未设置' : JSON.stringify(value)
export function enumText(rules: FieldRules): string {
  if (rules.enum === undefined) return unknownRule
  if (rules.enum === null) return '无限制'
  return rules.enum.map((value, index) => `${ruleValue(value)}：${rules.enum_descriptions?.[index] || unknownRule}`).join('；')
}

export function ruleCells(rules: FieldRules): string[] {
  return [ruleBoolean(rules.required), ruleBoolean(rules.nullable), rules.description?.trim() || unknownRule,
    enumText(rules), ruleValue(rules.default), ruleValue(rules.example)]
}

export function rulesToSchema(rules: FieldRules): Record<string, unknown> {
  const metadata = Object.fromEntries(RULE_KEYS.filter(key => rules[key] !== undefined).map(key => [key, rules[key]]))
  const result: Record<string, unknown> = { 'x-kindra-rules': metadata }
  if (rules.description !== undefined) result.description = rules.description
  if (rules.nullable !== undefined) result.nullable = rules.nullable
  if (Array.isArray(rules.enum)) result.enum = rules.enum
  if (rules.enum_descriptions) result['x-enum-descriptions'] = rules.enum_descriptions
  if (rules.default !== undefined) result.default = rules.default
  if (rules.example !== undefined) result.example = rules.example
  return result
}

export function rulesFromSchema(schema: Record<string, unknown>): FieldRules {
  const rules: FieldRules = {}
  for (const key of ['description', 'default', 'example'] as const) {
    if (Object.hasOwn(schema, key)) (rules as Record<string, unknown>)[key] = schema[key]
  }
  if (Array.isArray(schema.enum)) rules.enum = schema.enum
  else rules.enum = null
  if (Array.isArray(schema['x-enum-descriptions'])) rules.enum_descriptions = schema['x-enum-descriptions'] as string[]
  rules.nullable = schema.nullable === true || schema['x-nullable'] === true ||
    (Array.isArray(schema.type) && schema.type.includes('null')) || schema.type === 'null'
  // Our extension preserves unknown vs explicitly optional/unrestricted on a round trip.
  const original = schema['x-kindra-rules']
  if (original && typeof original === 'object' && !Array.isArray(original)) {
    return Object.fromEntries(RULE_KEYS.filter(key => Object.hasOwn(original, key)).map(key => [key, (original as FieldRules)[key]]))
  }
  return rules
}

export function validateRules(value: FieldRules, type: string | undefined, path: string): string[] {
  const errors: string[] = []
  if (type === 'null' && value.nullable === false) errors.push(`${path}: null 类型不能声明不可为 null`)
  for (const key of ['required', 'nullable'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') errors.push(`${path}.${key}: 必须是 boolean`)
  }
  if (value.description !== undefined && typeof value.description !== 'string') errors.push(`${path}.description: 必须是 string`)
  if (value.enum !== undefined && value.enum !== null && (!Array.isArray(value.enum) || !value.enum.length)) errors.push(`${path}.enum: 使用非空数组或 null（无限制）`)
  if (value.enum_descriptions !== undefined && (!Array.isArray(value.enum_descriptions) || value.enum_descriptions.some(x => typeof x !== 'string') || value.enum_descriptions.length !== value.enum?.length)) errors.push(`${path}.enum_descriptions: 必须与枚举值逐项对应`)
  const matches = (v: unknown): boolean => {
    if (v === null) return value.nullable !== false || type === 'null'
    if (!type || type === 'unknown' || type === 'file') return true
    if (type === 'integer') return typeof v === 'number' && Number.isInteger(v)
    if (type === 'array') return Array.isArray(v)
    if (type === 'object') return typeof v === 'object' && !Array.isArray(v)
    return typeof v === type
  }
  for (const v of [...(Array.isArray(value.enum) ? value.enum : []), ...(['default', 'example'] as const).filter(k => value[k] !== undefined).map(k => value[k])]) {
    if (!matches(v)) errors.push(`${path}: 值 ${ruleValue(v)} 不符合 ${type || '可空'} 规则`)
  }
  for (const key of ['default', 'example'] as const) {
    if (value[key] !== undefined && Array.isArray(value.enum) && !value.enum.some(v => JSON.stringify(v) === JSON.stringify(value[key]))) errors.push(`${path}.${key}: 不在枚举范围内`)
  }
  return errors
}

/** Only a document projection: never mutate the URL or outgoing query parameters. */
export function documentedQuery(url: string, params: Param[]): Param[] {
  const next = params.map(p => ({ ...p }))
  const index = url.indexOf('?')
  if (index < 0) return next
  const explicit = new Set(params.map(p => p.key))
  for (const [key, value] of new URLSearchParams(url.slice(index + 1).split('#')[0])) {
    if (!explicit.has(key)) next.push({ param_id: `url-${next.length}`, key, value, field_type: 'string', is_checked: 1 })
  }
  return next
}

export const FIELD_TYPES: JsonFieldType[] = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array', 'unknown']
