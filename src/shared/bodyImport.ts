import type { FieldDoc, JsonFieldType } from './types'
import {
  applyFieldMocks,
  buildFieldSchema,
  collectJsonPaths,
  fieldDocsFromSchema,
  mergeFieldDocs,
  pathToPointer,
  typeOfValue
} from './jsonFields'
import { exampleFromJsonSchema, expandSchemaRefs } from './schemaExample'

export type BodyImportFormat = 'json' | 'schema' | 'lines'

export interface BodyImportResult {
  ok: boolean
  format: BodyImportFormat | null
  raw: string
  fieldDocs: FieldDoc[]
  warnings: string[]
  error?: string
  fieldCount: number
}

const SCHEMA_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  'definitions',
  '$ref',
  'type',
  'properties',
  'items',
  'prefixItems',
  'required',
  'additionalProperties',
  'patternProperties',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'enum',
  'const',
  'default',
  'example',
  'description',
  'format',
  'nullable'
])

const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function looksLikeJsonSchema(value: unknown): boolean {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (
    keys.some((key) =>
      ['$schema', '$defs', 'definitions', 'properties', 'items', 'prefixItems', 'allOf', 'anyOf', 'oneOf', 'patternProperties'].includes(key)
    )
  ) {
    return true
  }
  const type = value.type
  if (typeof type === 'string' && SCHEMA_TYPES.has(type)) {
    return keys.every((key) => SCHEMA_KEYWORDS.has(key) || key.startsWith('x-'))
  }
  return false
}

function parseCompactJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    return { ok: false }
  }
}

function splitLine(line: string): { key: string; value: string; description?: string } | null {
  let body = line.trim().replace(/^[-*+]\s+/, '')
  if (!body || body.startsWith('#') || body.startsWith('//')) return null
  const separators = [':', '：', '=']
  let index = -1
  for (const separator of separators) {
    const found = body.indexOf(separator)
    if (found > 0 && (index < 0 || found < index)) index = found
  }
  if (index < 0) return null
  const key = body.slice(0, index).trim()
  let rest = body.slice(index + 1).trim()
  if (!key) return null

  let description: string | undefined
  const pipe = rest.indexOf('|')
  if (pipe >= 0) {
    description = rest.slice(pipe + 1).trim() || undefined
    rest = rest.slice(0, pipe).trim()
  } else {
    const hash = rest.indexOf(' #')
    if (hash >= 0) {
      description = rest.slice(hash + 1).trim() || undefined
      rest = rest.slice(0, hash).trim()
    }
  }
  return { key, value: rest, description }
}

function parseLineValue(text: string): { value: unknown; type: JsonFieldType } {
  const trimmed = text.trim()
  if (!trimmed) return { value: '', type: 'string' }
  const parsed = parseCompactJson(trimmed)
  if (parsed.ok) {
    return { value: parsed.value, type: typeOfValue(parsed.value) }
  }
  return { value: trimQuotes(trimmed), type: 'string' }
}

function trimQuotes(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return text.slice(1, -1)
  }
  return text
}

function setNested(
  root: Record<string, unknown>,
  parts: string[],
  value: unknown
): boolean {
  let current: Record<string, unknown> = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]
    const next = current[key]
    if (next === undefined) {
      current[key] = {}
    } else if (!isRecord(next)) {
      return false
    }
    current = current[key] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
  return true
}

function importLines(text: string, existingDocs: FieldDoc[]): BodyImportResult {
  const warnings: string[] = []
  const docs: FieldDoc[] = []
  const root: Record<string, unknown> = {}
  const lines = text.split(/\r?\n/)
  let skipped = 0

  for (const line of lines) {
    const entry = splitLine(line)
    if (!entry) continue
    if (entry.key.includes('[') || entry.key.includes(']')) {
      warnings.push(`键值行暂不支持数组路径，已跳过：${entry.key}`)
      skipped += 1
      continue
    }
    const pointer = pathToPointer(entry.key)
    if (!pointer) {
      warnings.push(`无法识别的字段路径，已跳过：${entry.key}`)
      skipped += 1
      continue
    }
    const parts = pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    const parsed = parseLineValue(entry.value)
    if (!setNested(root, parts, parsed.value)) {
      warnings.push(`字段路径冲突，已跳过：${entry.key}`)
      skipped += 1
      continue
    }
    if (!docs.some((doc) => doc.pointer === pointer)) {
      docs.push({
        pointer,
        type: parsed.type,
        description: entry.description,
        source: 'manual'
      })
    }
  }

  if (docs.length === 0) {
    return {
      ok: false,
      format: 'lines',
      raw: '',
      fieldDocs: existingDocs,
      warnings,
      error: '没有识别到有效的 key: value 行',
      fieldCount: 0
    }
  }
  if (skipped > 0) warnings.push(`跳过 ${skipped} 行无法解析的内容`)

  return {
    ok: true,
    format: 'lines',
    raw: JSON.stringify(root, null, 2),
    fieldDocs: mergeFieldDocs(existingDocs, docs),
    warnings,
    fieldCount: docs.length
  }
}

function importSchema(schema: unknown, existingDocs: FieldDoc[]): BodyImportResult {
  const expanded = expandSchemaRefs(schema)
  const example = exampleFromJsonSchema(expanded.schema)
  const raw = example.value === undefined ? '' : JSON.stringify(example.value, null, 2)
  const docs = fieldDocsFromSchema(expanded.schema, example.value)
  const warnings = [...expanded.warnings, ...example.warnings]
  if (!raw) warnings.push('未能从 Schema 生成示例值')
  return {
    ok: true,
    format: 'schema',
    raw,
    fieldDocs: mergeFieldDocs(existingDocs, docs),
    warnings,
    fieldCount: docs.length
  }
}

function importJsonSample(value: unknown, existingDocs: FieldDoc[]): BodyImportResult {
  const warnings: string[] = []
  if (value === null || typeof value !== 'object') {
    warnings.push('JSON 样例不是对象或数组，字段表可能为空')
  }
  let fieldCount = 0
  if (value !== null && typeof value === 'object') {
    try {
      fieldCount = collectJsonPaths(value).size
    } catch {
      fieldCount = 0
    }
  }
  return {
    ok: true,
    format: 'json',
    raw: JSON.stringify(value, null, 2),
    fieldDocs: mergeFieldDocs(existingDocs, []),
    warnings,
    fieldCount
  }
}

/**
 * 智能导入：自动识别 JSON 样例 / JSON Schema / key: value 行。
 * `format` 可强制指定格式，用于消解歧义。
 */
export function smartImportBody(
  text: string,
  options: { format?: 'auto' | BodyImportFormat; existingDocs?: FieldDoc[] } = {}
): BodyImportResult {
  const input = text.replace(/^\uFEFF/, '').trim()
  const existingDocs = options.existingDocs ?? []
  if (!input) {
    return {
      ok: false,
      format: null,
      raw: '',
      fieldDocs: existingDocs,
      warnings: [],
      error: '请输入要导入的内容',
      fieldCount: 0
    }
  }

  const format = options.format ?? 'auto'
  const parsed = parseCompactJson(input)
  if (format === 'schema' || format === 'json') {
    if (!parsed.ok) {
      return {
        ok: false,
        format,
        raw: '',
        fieldDocs: existingDocs,
        warnings: [],
        error: format === 'schema' ? '无法解析 JSON Schema' : '无法解析 JSON',
        fieldCount: 0
      }
    }
    if (format === 'schema') return importSchema(parsed.value, existingDocs)
    return importJsonSample(parsed.value, existingDocs)
  }
  if (format === 'lines') return importLines(input, existingDocs)

  if (parsed.ok) {
    if (looksLikeJsonSchema(parsed.value)) return importSchema(parsed.value, existingDocs)
    return importJsonSample(parsed.value, existingDocs)
  }

  const lines = importLines(input, existingDocs)
  if (lines.ok) return lines
  return {
    ok: false,
    format: null,
    raw: '',
    fieldDocs: existingDocs,
    warnings: lines.warnings,
    error: '无法识别输入格式：请提供 JSON 样例、JSON Schema 或 key: value 行',
    fieldCount: 0
  }
}

function mergeMissingExample(target: unknown, generated: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(generated)) {
    const length = Math.min(target.length, generated.length)
    for (let index = 0; index < length; index += 1) {
      target[index] = mergeMissingExample(target[index], generated[index])
    }
    return target
  }
  if (isRecord(target) && isRecord(generated)) {
    for (const [key, value] of Object.entries(generated)) {
      if (!Object.hasOwn(target, key)) target[key] = value
      else target[key] = mergeMissingExample(target[key], value)
    }
    return target
  }
  return target
}

/** 生成设计页「示例」视图内容；Mock 值只影响展示，不回写 raw。 */
export function buildBodyExample(
  raw: string,
  docs: FieldDoc[]
): { text: string; error?: string } {
  const text = raw ?? ''
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text)
      let value = applyFieldMocks(parsed, docs)
      if (docs.some((doc) => doc.doc_only)) {
        const built = buildFieldSchema(text, docs)
        if (built.ok && built.hasFields) {
          const generated = exampleFromJsonSchema(built.schema)
          const clone = JSON.parse(JSON.stringify(value))
          value = mergeMissingExample(clone, generated.value)
        }
      }
      return { text: JSON.stringify(value, null, 2) }
    } catch (error) {
      return { text, error: (error as Error).message }
    }
  }
  if (docs.length > 0) {
    const result = buildFieldSchema('', docs)
    if (result.ok) {
      if (result.hasFields) {
        const example = exampleFromJsonSchema(result.schema)
        return { text: JSON.stringify(applyFieldMocks(example.value, docs), null, 2) }
      }
      if (result.rootValue !== undefined) {
        return { text: JSON.stringify(applyFieldMocks(result.rootValue, docs), null, 2) }
      }
    }
  }
  return { text: '' }
}
