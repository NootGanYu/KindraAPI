import type { FieldDoc, JsonFieldType } from './types'

const JSON_FIELD_TYPES: JsonFieldType[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'null',
  'object',
  'array',
  'unknown'
]

const SIMPLE_KEY = /^[^.[\]"'\s]+$/

export function isJsonFieldType(value: unknown): value is JsonFieldType {
  return typeof value === 'string' && (JSON_FIELD_TYPES as string[]).includes(value)
}

// ---------------------------------------------------------------------------
// JSON Pointer / 展示路径
// ---------------------------------------------------------------------------

export function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

export function joinPointer(parts: string[]): string {
  if (parts.length === 0) return ''
  return `/${parts.map(escapePointerToken).join('/')}`
}

export function splitPointer(pointer: string): string[] {
  if (!pointer) return []
  if (!pointer.startsWith('/')) return []
  return pointer.slice(1).split('/').map(unescapePointerToken)
}

export function pointerToPath(pointer: string): string {
  const parts = splitPointer(pointer)
  let out = ''
  for (const part of parts) {
    if (part === '*') {
      out += '[]'
      continue
    }
    const simple = SIMPLE_KEY.test(part)
    if (!out) {
      out = simple ? part : JSON.stringify(part)
      continue
    }
    out += simple ? `.${part}` : `[${JSON.stringify(part)}]`
  }
  return out
}

function closingBracket(text: string, start: number): number {
  let index = start + 1
  while (index < text.length && /\s/.test(text[index])) index += 1
  if (text[index] === ']') return index
  if (text[index] !== '"') return -1
  index += 1
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] === '"') break
    index += 1
  }
  if (index >= text.length) return -1
  index += 1
  while (index < text.length && /\s/.test(text[index])) index += 1
  return text[index] === ']' ? index : -1
}

/** 把 `a.b`、`items[].id`、`a["x.y"]` 解析为内部 JSON Pointer。非法返回 null。 */
export function pathToPointer(input: string): string | null {
  const text = input.trim()
  if (!text) return ''
  const parts: string[] = []
  let index = 0
  let expectKey = true
  while (index < text.length) {
    if (text[index] === '.') {
      if (expectKey) return null
      index += 1
      expectKey = true
      continue
    }
    if (text[index] === '[') {
      const end = closingBracket(text, index)
      if (end < 0) return null
      const literal = text.slice(index + 1, end).trim()
      if (!literal) {
        parts.push('*')
      } else {
        try {
          const key = JSON.parse(literal)
          if (typeof key !== 'string') return null
          parts.push(key)
        } catch {
          return null
        }
      }
      index = end + 1
      expectKey = false
      continue
    }
    if (!expectKey) return null
    const start = index
    while (index < text.length && text[index] !== '.' && text[index] !== '[') index += 1
    const key = text.slice(start, index)
    if (!key) return null
    parts.push(key)
    expectKey = false
  }
  if (expectKey) return null
  return joinPointer(parts)
}

function parentPointer(pointer: string): string | null {
  const parts = splitPointer(pointer)
  if (parts.length <= 1) return null
  return joinPointer(parts.slice(0, -1))
}

export function canonicalPointer(pointer: string): string | null {
  if (pointer === '') return ''
  if (!pointer.startsWith('/')) return null
  return joinPointer(splitPointer(pointer))
}

// ---------------------------------------------------------------------------
// 类型推断
// ---------------------------------------------------------------------------

export function typeOfValue(value: unknown): JsonFieldType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  return 'unknown'
}

export function isTemplateString(value: unknown): boolean {
  return typeof value === 'string' && /\{\{[^{}]+\}\}/.test(value)
}

export function inferType(value: unknown): JsonFieldType {
  return isTemplateString(value) ? 'unknown' : typeOfValue(value)
}

export interface EffectiveType {
  type: JsonFieldType
  nullable: boolean
  mixed: boolean
}

export function effectiveType(
  types: Set<JsonFieldType>,
  override?: JsonFieldType
): EffectiveType {
  const nullable = types.has('null')
  if (override) return { type: override, nullable, mixed: false }
  const set = new Set(types)
  set.delete('null')
  if (set.size === 0) return { type: 'null', nullable: true, mixed: false }
  if (set.has('unknown')) return { type: 'unknown', nullable, mixed: set.size > 1 }
  if (set.has('number')) set.delete('integer')
  if (set.size === 1) return { type: [...set][0], nullable, mixed: false }
  return { type: 'unknown', nullable, mixed: true }
}

export function typeMatches(declared: JsonFieldType | undefined, inferred: JsonFieldType): boolean {
  if (!declared) return true
  if (declared === inferred) return true
  if (declared === 'unknown' || inferred === 'unknown') return true
  if (declared === 'number' && inferred === 'integer') return true
  return false
}

// ---------------------------------------------------------------------------
// 收集路径
// ---------------------------------------------------------------------------

export interface JsonPathEntry {
  pointer: string
  parts: string[]
  types: Set<JsonFieldType>
  firstValue: unknown
  sameValue: boolean
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function collectJsonPaths(root: unknown): Map<string, JsonPathEntry> {
  const result = new Map<string, JsonPathEntry>()
  const visit = (value: unknown, parts: string[]): void => {
    const pointer = joinPointer(parts)
    const type = inferType(value)
    const existing = result.get(pointer)
    if (existing) {
      existing.types.add(type)
      if (existing.sameValue && !sameJsonValue(existing.firstValue, value)) {
        existing.sameValue = false
      }
    } else {
      result.set(pointer, {
        pointer,
        parts,
        types: new Set([type]),
        firstValue: value,
        sameValue: true
      })
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, [...parts, '*'])
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, [...parts, key])
      }
    }
  }
  visit(root, [])
  return result
}

// ---------------------------------------------------------------------------
// 行模型
// ---------------------------------------------------------------------------

export interface JsonFieldRow {
  pointer: string
  path: string
  name: string
  depth: number
  parent: string | null
  hasChildren: boolean
  present: boolean
  docOnly: boolean
  orphan: boolean
  synthetic: boolean
  inferred: JsonFieldType
  type: JsonFieldType
  typeOverridden: boolean
  typeMismatch: boolean
  nullable: boolean
  mixed: boolean
  required: boolean
  effectiveRequired: boolean
  description: string
  value: unknown
  valueText: string
  valueEditable: boolean
  wildcard: boolean
  sameValue: boolean
}

interface FieldNode {
  pointer: string
  parts: string[]
  token: string
  parent: string | null
  order: number
  present: boolean
  doc?: FieldDoc
  docOnly: boolean
  orphan: boolean
  synthetic: boolean
  entry?: JsonPathEntry
  childMap: Map<string, FieldNode>
  inferred: JsonFieldType
  nullable: boolean
  mixed: boolean
  type: JsonFieldType
  typeOverridden: boolean
  typeMismatch: boolean
  description: string
  required: boolean
  effectiveRequired: boolean
  value: unknown
  sameValue: boolean
  wildcard: boolean
}

export interface FieldRowsResult {
  ok: boolean
  error?: string
  rootKind: 'object' | 'array' | 'primitive' | 'empty' | 'invalid'
  rows: JsonFieldRow[]
  exportedRows: JsonFieldRow[]
  totalPaths: number
  maxDepth: number
  aggregated: boolean
  orphanCount: number
  docOnlyCount: number
  hasDocs: boolean
}

interface FieldModel extends FieldRowsResult {
  rootValue: unknown
  rootNode: FieldNode | null
  nodes: Map<string, FieldNode>
  rootChildren: FieldNode[]
}

function valueToText(value: unknown, type: JsonFieldType): string {
  if (value === null) return 'null'
  if (type === 'object' || type === 'array') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  return String(value)
}

function buildFieldModel(raw: string, docsInput: FieldDoc[]): FieldModel {
  const docs = (docsInput ?? []).filter((doc) => doc && doc.pointer !== undefined)
  const docMap = new Map<string, FieldDoc>()
  for (const doc of docs) {
    if (doc.pointer === '') continue
    docMap.set(doc.pointer, doc)
  }

  let rootValue: unknown
  let rootKind: FieldModel['rootKind']
  const text = raw ?? ''
  const docsAreRootArray =
    docMap.size > 0 && [...docMap.keys()].every((pointer) => splitPointer(pointer)[0] === '*')
  if (!text.trim()) {
    rootValue = docMap.size > 0 ? (docsAreRootArray ? [] : {}) : null
    rootKind = 'empty'
  } else {
    try {
      rootValue = JSON.parse(text)
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
        rootKind: 'invalid',
        rows: [],
        exportedRows: [],
        totalPaths: 0,
        maxDepth: 0,
        aggregated: false,
        orphanCount: 0,
        docOnlyCount: 0,
        hasDocs: docMap.size > 0,
        rootValue: undefined,
        rootNode: null,
        nodes: new Map(),
        rootChildren: []
      }
    }
    if (Array.isArray(rootValue)) rootKind = 'array'
    else if (rootValue !== null && typeof rootValue === 'object') rootKind = 'object'
    else rootKind = 'primitive'
  }

  if (rootKind === 'primitive') {
    return {
      ok: true,
      rootKind,
      rows: [],
      exportedRows: [],
      totalPaths: 0,
      maxDepth: 0,
      aggregated: false,
      orphanCount: 0,
      docOnlyCount: docs.filter((doc) => doc.doc_only).length,
      hasDocs: docMap.size > 0,
      rootValue,
      rootNode: null,
      nodes: new Map(),
      rootChildren: []
    }
  }

  const rawEntries = collectJsonPaths(rootValue)
  const orderMap = new Map<string, number>()
  let order = 0
  const addOrder = (pointer: string): void => {
    if (pointer === '') return
    if (!orderMap.has(pointer)) orderMap.set(pointer, order++)
  }
  for (const pointer of rawEntries.keys()) addOrder(pointer)
  for (const pointer of docMap.keys()) {
    const parts = splitPointer(pointer)
    addOrder(pointer)
    for (let i = 1; i < parts.length; i += 1) addOrder(joinPointer(parts.slice(0, i)))
  }

  const nodes = new Map<string, FieldNode>()
  for (const pointer of orderMap.keys()) {
    const parts = splitPointer(pointer)
    nodes.set(pointer, {
      pointer,
      parts,
      token: parts[parts.length - 1] ?? '',
      parent: parentPointer(pointer),
      order: orderMap.get(pointer) ?? 0,
      present: false,
      docOnly: false,
      orphan: false,
      synthetic: false,
      childMap: new Map(),
      inferred: 'unknown',
      nullable: false,
      mixed: false,
      type: 'unknown',
      typeOverridden: false,
      typeMismatch: false,
      description: '',
      required: false,
      effectiveRequired: false,
      value: undefined,
      sameValue: true,
      wildcard: parts.includes('*')
    })
  }

  const rootNode: FieldNode = {
    pointer: '',
    parts: [],
    token: '',
    parent: null,
    order: -1,
    present: rootKind === 'object' || rootKind === 'array',
    docOnly: false,
    orphan: false,
    synthetic: false,
    childMap: new Map(),
    inferred: rootKind === 'array' || docsAreRootArray ? 'array' : 'object',
    nullable: false,
    mixed: false,
    type: rootKind === 'array' || docsAreRootArray ? 'array' : 'object',
    typeOverridden: false,
    typeMismatch: false,
    description: '',
    required: false,
    effectiveRequired: false,
    value: rootValue,
    sameValue: true,
    wildcard: false
  }

  const rootChildren: FieldNode[] = []
  for (const node of nodes.values()) {
    if (!node.parent) {
      rootChildren.push(node)
      rootNode.childMap.set(node.token, node)
    } else {
      const parent = nodes.get(node.parent)
      if (parent) parent.childMap.set(node.token, node)
    }
  }

  for (const node of nodes.values()) {
    const entry = rawEntries.get(node.pointer)
    const doc = docMap.get(node.pointer)
    node.entry = entry
    node.doc = doc
    node.present = Boolean(entry)
    node.docOnly = !node.present && Boolean(doc?.doc_only)
    node.orphan = !node.present && Boolean(doc) && !doc?.doc_only
    node.synthetic = !node.present && !doc
    node.description = doc?.description ?? ''
    node.required = Boolean(doc?.required)
    node.value = entry?.firstValue
    node.sameValue = entry?.sameValue ?? true

    const inferred: EffectiveType = entry
      ? effectiveType(entry.types)
      : {
          type:
            doc?.type ??
            (node.childMap.has('*') ? 'array' : node.childMap.size > 0 ? 'object' : 'unknown'),
          nullable: false,
          mixed: false
        }
    node.inferred = inferred.type
    node.nullable = inferred.nullable
    node.mixed = inferred.mixed
    node.typeOverridden = Boolean(doc?.type)
    node.typeMismatch = Boolean(doc?.type && entry && !typeMatches(doc.type, inferred.type))
    node.type = doc?.type ?? inferred.type
  }

  for (const node of nodes.values()) {
    node.effectiveRequired = node.required
  }
  for (const node of nodes.values()) {
    if (!node.required) continue
    let parent = node.parent
    while (parent) {
      const parentNode = nodes.get(parent)
      if (parentNode) parentNode.effectiveRequired = true
      parent = parentPointer(parent)
    }
  }

  const rows: JsonFieldRow[] = []
  const walk = (children: FieldNode[], depth: number): void => {
    const sorted = [...children].sort((left, right) => left.order - right.order)
    for (const node of sorted) {
      rows.push({
        pointer: node.pointer,
        path: pointerToPath(node.pointer),
        name: node.token === '*' ? '[]' : node.token,
        depth,
        parent: node.parent,
        hasChildren: node.childMap.size > 0,
        present: node.present,
        docOnly: node.docOnly,
        orphan: node.orphan,
        synthetic: node.synthetic,
        inferred: node.inferred,
        type: node.type,
        typeOverridden: node.typeOverridden,
        typeMismatch: node.typeMismatch,
        nullable: node.nullable,
        mixed: node.mixed,
        required: node.required,
        effectiveRequired: node.effectiveRequired,
        description: node.description,
        value: node.value,
        valueText: valueToText(node.value, node.type),
        valueEditable: node.present && !node.wildcard,
        wildcard: node.wildcard,
        sameValue: node.sameValue
      })
      walk([...node.childMap.values()], depth + 1)
    }
  }
  walk(rootChildren, 0)

  const maxDepth = rows.reduce((max, row) => Math.max(max, row.depth + 1), 0)
  const totalPaths = Math.max(0, rawEntries.size - 1)
  const hasDocs = docMap.size > 0
  const orphanCount = rows.filter((row) => row.orphan).length
  const docOnlyCount = docs.filter((doc) => doc.doc_only).length
  const exportedRows = selectExportRows(rows)

  return {
    ok: true,
    rootKind,
    rows,
    exportedRows,
    totalPaths,
    maxDepth,
    aggregated: totalPaths > 2000 || maxDepth > 20,
    orphanCount,
    docOnlyCount,
    hasDocs,
    rootValue,
    rootNode,
    nodes,
    rootChildren
  }
}

function selectExportRows(rows: JsonFieldRow[]): JsonFieldRow[] {
  const selected = new Set<string>()
  const byPointer = new Map(rows.map((row) => [row.pointer, row]))
  for (const row of rows) {
    if (row.orphan) continue
    if (!row.description.trim()) continue
    if (!(row.present || row.docOnly || row.synthetic)) continue
    selected.add(row.pointer)
    let parent = row.parent
    while (parent) {
      selected.add(parent)
      parent = byPointer.get(parent)?.parent ?? null
    }
  }
  return rows
    .filter((row) => selected.has(row.pointer))
    .map((row) => (row.orphan ? { ...row, description: '' } : row))
}

export function buildFieldRows(raw: string, docs: FieldDoc[]): FieldRowsResult {
  const model = buildFieldModel(raw, docs)
  return {
    ok: model.ok,
    error: model.error,
    rootKind: model.rootKind,
    rows: model.rows,
    exportedRows: model.exportedRows,
    totalPaths: model.totalPaths,
    maxDepth: model.maxDepth,
    aggregated: model.aggregated,
    orphanCount: model.orphanCount,
    docOnlyCount: model.docOnlyCount,
    hasDocs: model.hasDocs
  }
}

// ---------------------------------------------------------------------------
// 编辑 helpers
// ---------------------------------------------------------------------------

export function setValueAtPointer(root: unknown, pointer: string, value: unknown): boolean {
  const parts = splitPointer(pointer)
  if (parts.length === 0) return false
  if (parts.includes('*')) return false
  let current = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (current === null || typeof current !== 'object') return false
    current = (current as Record<string, unknown>)[parts[index]]
  }
  if (current === null || typeof current !== 'object') return false
  ;(current as Record<string, unknown>)[parts[parts.length - 1]] = value
  return true
}

export function deleteValueAtPointer(root: unknown, pointer: string): boolean {
  const parts = splitPointer(pointer)
  if (parts.length === 0) return false
  if (parts.includes('*')) return false
  let current = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (current === null || typeof current !== 'object') return false
    current = (current as Record<string, unknown>)[parts[index]]
  }
  if (current === null || typeof current !== 'object') return false
  return delete (current as Record<string, unknown>)[parts[parts.length - 1]]
}

export type ParsedValue =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

export function parseValueText(text: string, type: JsonFieldType): ParsedValue {
  if (type === 'string' || type === 'unknown') return { ok: true, value: text }
  if (type === 'integer') {
    if (!text.trim()) return { ok: false, error: '请输入整数' }
    const value = Number(text)
    if (!Number.isInteger(value)) return { ok: false, error: '请输入整数' }
    return { ok: true, value }
  }
  if (type === 'number') {
    if (!text.trim()) return { ok: false, error: '请输入数字' }
    const value = Number(text)
    if (Number.isNaN(value)) return { ok: false, error: '请输入数字' }
    return { ok: true, value }
  }
  if (type === 'boolean') {
    if (text === 'true') return { ok: true, value: true }
    if (text === 'false') return { ok: true, value: false }
    return { ok: false, error: '请输入 true 或 false' }
  }
  if (type === 'null') return { ok: true, value: null }
  if (type === 'object' || type === 'array') {
    try {
      const value = JSON.parse(text)
      if (type === 'array' && !Array.isArray(value)) {
        return { ok: false, error: '请输入 JSON 数组' }
      }
      if (type === 'object' && (value === null || Array.isArray(value) || typeof value !== 'object')) {
        return { ok: false, error: '请输入 JSON 对象' }
      }
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }
  return { ok: true, value: text }
}

// ---------------------------------------------------------------------------
// FieldDoc 归一化 / 合并
// ---------------------------------------------------------------------------

export function normalizeFieldDocs(value: unknown): FieldDoc[] | null {
  if (!Array.isArray(value)) return null
  const map = new Map<string, FieldDoc>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    let pointer: string | null = null
    if (typeof source.pointer === 'string') {
      pointer = source.pointer.startsWith('/')
        ? canonicalPointer(source.pointer)
        : pathToPointer(source.pointer)
    } else if (typeof source.path === 'string') {
      pointer = pathToPointer(source.path)
    }
    if (!pointer) continue
    const doc: FieldDoc = { pointer }
    if (isJsonFieldType(source.type)) doc.type = source.type
    if (typeof source.required === 'boolean') doc.required = source.required
    if (typeof source.description === 'string') doc.description = source.description
    if (typeof source.doc_only === 'boolean') doc.doc_only = source.doc_only
    if (source.source === 'openapi' || source.source === 'manual') doc.source = source.source
    map.set(pointer, doc)
  }
  return [...map.values()]
}

export function mergeFieldDocs(
  existing: FieldDoc[] | undefined,
  incoming: FieldDoc[] | undefined
): FieldDoc[] {
  const map = new Map<string, FieldDoc>()
  for (const doc of existing ?? []) {
    if (!doc?.pointer || doc.pointer === '') continue
    map.set(doc.pointer, { ...doc })
  }
  for (const doc of incoming ?? []) {
    if (!doc?.pointer || doc.pointer === '') continue
    const previous = map.get(doc.pointer)
    if (!previous) {
      map.set(doc.pointer, { ...doc })
      continue
    }
    const description = doc.description && doc.description.trim() ? doc.description : previous.description
    map.set(doc.pointer, {
      ...previous,
      ...doc,
      description,
      type: doc.type ?? previous.type,
      required: doc.required ?? previous.required,
      doc_only: doc.doc_only ?? previous.doc_only,
      source: doc.source ?? previous.source
    })
  }
  return [...map.values()]
}

export function withDisplayPath(doc: FieldDoc): FieldDoc & { path: string } {
  return { ...doc, path: pointerToPath(doc.pointer) }
}

// ---------------------------------------------------------------------------
// OpenAPI schema
// ---------------------------------------------------------------------------

function normalizeSchemaType(schema: Record<string, unknown>): JsonFieldType | undefined {
  const type = schema.type
  if (typeof type === 'string') {
    if (type === 'array' || type === 'object' || type === 'string' || type === 'boolean') {
      return type
    }
    if (type === 'integer' || type === 'number') return type
    if (type === 'null') return 'null'
    return 'unknown'
  }
  if (Array.isArray(type)) {
    const first = type.find((item) => item !== 'null')
    if (typeof first === 'string' && isJsonFieldType(first)) return first
    return 'null'
  }
  if (schema.properties && typeof schema.properties === 'object') return 'object'
  if (schema.items) return 'array'
  return undefined
}

/** 把 OpenAPI / JSON Schema 转成 FieldDoc[]；example 用于标记 raw 中不存在的字段。 */
export function fieldDocsFromSchema(schema: unknown, example?: unknown): FieldDoc[] {
  const byPointer = new Map<string, FieldDoc>()
  const rawPaths = example === undefined ? null : collectJsonPaths(example)
  const ensure = (pointer: string): FieldDoc => {
    let doc = byPointer.get(pointer)
    if (!doc) {
      doc = { pointer, source: 'openapi' }
      byPointer.set(pointer, doc)
    }
    return doc
  }
  const seen = new Set<string>()
  const walk = (node: unknown, parts: string[]): void => {
    if (!node || typeof node !== 'object') return
    const pointer = joinPointer(parts)
    if (parts.length > 0) {
      if (seen.has(pointer)) return
      seen.add(pointer)
      const source = node as Record<string, unknown>
      const doc = ensure(pointer)
      const type = normalizeSchemaType(source)
      if (type) doc.type = type
      if (typeof source.description === 'string' && source.description.trim()) {
        doc.description = source.description.trim()
      }
      if (rawPaths && !rawPaths.has(pointer)) doc.doc_only = true
    }
    const source = node as Record<string, unknown>
    const properties = source.properties
    if (properties && typeof properties === 'object') {
      const required = new Set(
        Array.isArray(source.required) ? source.required.map((item) => String(item)) : []
      )
      for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
        const childParts = [...parts, key]
        const childPointer = joinPointer(childParts)
        if (required.has(key)) {
          const childDoc = ensure(childPointer)
          childDoc.required = true
          if (rawPaths && !rawPaths.has(childPointer)) childDoc.doc_only = true
        }
        walk(child, childParts)
      }
    }
    if (source.items) walk(source.items, [...parts, '*'])
    if (Array.isArray(source.allOf)) {
      for (const child of source.allOf) walk(child, parts)
    }
    if (Array.isArray(source.anyOf)) {
      for (const child of source.anyOf) walk(child, parts)
    }
    if (Array.isArray(source.oneOf)) {
      for (const child of source.oneOf) walk(child, parts)
    }
  }
  walk(schema, [])
  return [...byPointer.values()].filter(
    (doc) => doc.type || doc.required || doc.description || doc.doc_only
  )
}

function scalarVariant(type: JsonFieldType): Record<string, unknown> {
  if (type === 'null') return { nullable: true }
  if (type === 'unknown') return {}
  return { type }
}

function schemaForNode(node: FieldNode, requiredSet: Set<string>): Record<string, unknown> {
  const propertyChildren = [...node.childMap.values()].filter(
    (child) => child.token !== '*' && !child.orphan
  )
  const itemChild = node.childMap.get('*')
  const types = new Set(node.entry?.types ?? [])
  if (types.size === 0) types.add(node.inferred)
  const declared = node.doc?.type
  const nullable = types.has('null')

  const objectVariant = (): Record<string, unknown> => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const child of propertyChildren) {
      properties[child.token] = schemaForNode(child, requiredSet)
      if (requiredSet.has(child.pointer)) required.push(child.token)
    }
    const schema: Record<string, unknown> = { type: 'object' }
    if (Object.keys(properties).length > 0) schema.properties = properties
    if (required.length > 0) schema.required = required
    return schema
  }
  const arrayVariant = (): Record<string, unknown> => {
    const items =
      itemChild && !itemChild.orphan ? schemaForNode(itemChild, requiredSet) : ({} as Record<string, unknown>)
    return { type: 'array', items }
  }

  let variants: Record<string, unknown>[] = []
  if (declared) {
    if (declared === 'object') variants = [objectVariant()]
    else if (declared === 'array') variants = [arrayVariant()]
    else variants = [scalarVariant(declared)]
  } else if (types.has('unknown')) {
    variants = [{}]
  } else {
    const hasObject = types.has('object') || propertyChildren.length > 0
    const hasArray = types.has('array') || Boolean(itemChild)
    const scalarTypes = new Set(types)
    scalarTypes.delete('object')
    scalarTypes.delete('array')
    scalarTypes.delete('null')
    scalarTypes.delete('unknown')
    if (scalarTypes.has('number')) scalarTypes.delete('integer')
    if (hasObject) variants.push(objectVariant())
    if (hasArray) variants.push(arrayVariant())
    for (const type of scalarTypes) variants.push(scalarVariant(type))
    if (variants.length === 0) {
      variants = types.has('null') ? [{ nullable: true }] : [{}]
    }
  }

  let schema: Record<string, unknown>
  if (variants.length === 1) schema = variants[0]
  else schema = { anyOf: variants }
  if (nullable && !('nullable' in schema)) schema.nullable = true
  if (node.doc?.description?.trim()) schema.description = node.doc.description
  return schema
}

export interface FieldSchemaResult {
  ok: boolean
  schema: Record<string, unknown>
  rootValue: unknown
  hasFields: boolean
}

export function buildFieldSchema(raw: string, docs: FieldDoc[]): FieldSchemaResult {
  const model = buildFieldModel(raw, docs)
  if (!model.ok) return { ok: false, schema: {}, rootValue: undefined, hasFields: false }
  if (model.rootKind === 'primitive') {
    return {
      ok: true,
      schema: scalarVariant(typeOfValue(model.rootValue)),
      rootValue: model.rootValue,
      hasFields: false
    }
  }
  if (!model.rootNode) {
    return { ok: true, schema: {}, rootValue: model.rootValue, hasFields: false }
  }

  const requiredSet = new Set<string>()
  for (const node of model.nodes.values()) {
    if (node.orphan || !node.required) continue
    requiredSet.add(node.pointer)
    let parent = node.parent
    while (parent) {
      requiredSet.add(parent)
      parent = parentPointer(parent)
    }
  }
  const schema = schemaForNode(model.rootNode, requiredSet)
  const hasFields = [...model.nodes.values()].some((node) => !node.orphan)
  return { ok: true, schema, rootValue: model.rootValue, hasFields }
}

export function typeLabel(row: Pick<JsonFieldRow, 'type' | 'mixed' | 'nullable'>): string {
  const base = row.mixed ? 'mixed' : row.type
  return row.nullable && base !== 'null' ? `${base} | null` : base
}
