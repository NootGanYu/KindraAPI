import type { ModelSchema } from '@shared/types'

export const MODEL_REF_PREFIX = 'openpost://model/'

export const SCHEMA_TYPES: Array<NonNullable<ModelSchema['type']>> = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null'
]

export function cloneSchema<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function orderedKeys(schema: ModelSchema): string[] {
  const properties = schema.properties ?? {}
  const order = Array.isArray(schema['x-schema-orders']) ? schema['x-schema-orders'] : []
  const keys: string[] = []
  for (const key of order) {
    if (typeof key === 'string' && key in properties && !keys.includes(key)) keys.push(key)
  }
  for (const key of Object.keys(properties)) {
    if (!keys.includes(key)) keys.push(key)
  }
  return keys
}

export function schemaTypeOf(schema: ModelSchema): string {
  if (schema.$ref) return 'ref'
  if (schema.type) return schema.type
  if (schema.properties) return 'object'
  if (schema.items) return 'array'
  return 'string'
}

export function uniqueFieldKey(schema: ModelSchema, base = 'field'): string {
  const keys = Object.keys(schema.properties ?? {})
  if (!keys.includes(base)) return base
  let index = 2
  while (keys.includes(`${base}${index}`)) index += 1
  return `${base}${index}`
}

export function validateSchema(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'JSON Schema 必须是对象'
  }
  const walk = (node: unknown, path: string): string | null => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return `${path || 'root'} 必须是对象`
    }
    const schema = node as ModelSchema
    if (schema.$ref !== undefined) {
      if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith(MODEL_REF_PREFIX)) {
        return `${path || 'root'} 的 $ref 必须以 ${MODEL_REF_PREFIX} 开头`
      }
    }
    if (schema.type !== undefined && !SCHEMA_TYPES.includes(schema.type)) {
      return `${path || 'root'} 的 type 不受支持：${String(schema.type)}`
    }
    if (schema.properties !== undefined) {
      if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
        return `${path || 'root'}.properties 必须是对象`
      }
      for (const [key, child] of Object.entries(schema.properties)) {
        const error = walk(child, path ? `${path}.${key}` : key)
        if (error) return error
      }
    }
    if (schema.items !== undefined) {
      const error = walk(schema.items, `${path || 'root'}.items`)
      if (error) return error
    }
    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== 'string')) {
        return `${path || 'root'}.required 必须是字符串数组`
      }
    }
    if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
      return `${path || 'root'}.enum 必须是数组`
    }
    if (schema['x-schema-orders'] !== undefined) {
      if (
        !Array.isArray(schema['x-schema-orders']) ||
        schema['x-schema-orders'].some((item) => typeof item !== 'string')
      ) {
        return `${path || 'root'} 的 x-schema-orders 必须是字符串数组`
      }
    }
    return null
  }
  return walk(value, '')
}

export function parseDefaultValue(raw: string, type: string | undefined): unknown {
  if (raw === '') return undefined
  if (type === 'boolean') return raw === 'true'
  if (type === 'integer' || type === 'number') {
    const numeric = Number(raw)
    return Number.isFinite(numeric) ? numeric : raw
  }
  return raw
}

export function defaultValueText(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export function childPath(parent: string, key: string | number): string {
  return typeof key === 'number' ? `${parent}[${key}]` : parent ? `${parent}.${key}` : key
}
