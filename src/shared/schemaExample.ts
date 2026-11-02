export interface SchemaExampleResult {
  value: unknown
  warnings: string[]
}

const MAX_DEPTH = 12
const MAX_NODES = 2000

function cloneJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

function resolveRef(root: unknown, ref: string): Record<string, unknown> | null {
  if (!ref.startsWith('#/')) return null
  const parts = ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current: unknown = root
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[part]
  }
  return current && typeof current === 'object' ? (current as Record<string, unknown>) : null
}

function schemaType(schema: Record<string, unknown>): string | undefined {
  const type = schema.type
  if (typeof type === 'string') return type
  if (Array.isArray(type)) {
    const found = type.find((item) => typeof item === 'string' && item !== 'null')
    return typeof found === 'string' ? found : 'null'
  }
  if (schema.properties && typeof schema.properties === 'object') return 'object'
  if (schema.items) return 'array'
  return undefined
}

function placeholder(type: string | undefined): unknown {
  if (type === 'string') return 'string'
  if (type === 'integer') return 0
  if (type === 'number') return 0
  if (type === 'boolean') return true
  if (type === 'null') return null
  if (type === 'array') return []
  return null
}

/** 展开本地 `$ref`，供字段文档生成使用（exampleFromJsonSchema 自身也能解析引用）。 */
export function expandSchemaRefs(schema: unknown): { schema: unknown; warnings: string[] } {
  const warnings: string[] = []

  const walk = (node: unknown, depth: number, stack: Set<string>): unknown => {
    if (!node || typeof node !== 'object') return node
    if (depth > MAX_DEPTH) {
      warnings.push(`Schema 嵌套超过 ${MAX_DEPTH} 层，已截断`)
      return null
    }
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1, stack))
    const source = node as Record<string, unknown>
    if (typeof source.$ref === 'string') {
      const ref = source.$ref
      if (stack.has(ref)) {
        warnings.push(`检测到循环 $ref：${ref}`)
        return null
      }
      const target = resolveRef(schema, ref)
      if (!target) {
        warnings.push(`无法解析 $ref：${ref}`)
        return null
      }
      const nextStack = new Set(stack)
      nextStack.add(ref)
      const expandedTarget = walk(target, depth + 1, nextStack)
      const siblings = { ...source }
      delete siblings.$ref
      if (expandedTarget && typeof expandedTarget === 'object' && !Array.isArray(expandedTarget)) {
        return {
          ...(expandedTarget as Record<string, unknown>),
          ...(walk(siblings, depth + 1, stack) as Record<string, unknown>)
        }
      }
      return expandedTarget
    }
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source)) {
      result[key] = walk(value, depth + 1, stack)
    }
    return result
  }

  return { schema: walk(schema, 0, new Set()), warnings }
}

/**
 * 把 JSON Schema / OpenAPI schema 转换成一份可直接展示的示例值。
 * 只解析本地 `$ref`，外部引用会降级为 null 并记录 warning。
 */
export function exampleFromJsonSchema(schema: unknown): SchemaExampleResult {
  const warnings: string[] = []
  let nodeCount = 0

  const walk = (node: unknown, depth: number, refStack: Set<string>): unknown => {
    if (!node || typeof node !== 'object') return null
    if (depth > MAX_DEPTH) {
      warnings.push(`Schema 嵌套超过 ${MAX_DEPTH} 层，已截断`)
      return null
    }
    nodeCount += 1
    if (nodeCount > MAX_NODES) {
      warnings.push('Schema 节点过多，已截断')
      return null
    }

    let source = node as Record<string, unknown>
    if (typeof source.$ref === 'string') {
      const ref = source.$ref
      if (refStack.has(ref)) {
        warnings.push(`检测到循环 $ref：${ref}`)
        return null
      }
      const target = resolveRef(schema, ref)
      if (!target) {
        warnings.push(`无法解析 $ref：${ref}`)
        return null
      }
      const nextStack = new Set(refStack)
      nextStack.add(ref)
      source = { ...target, ...source }
      delete source.$ref
      return walk(source, depth + 1, nextStack)
    }

    if (Object.hasOwn(source, 'example')) return cloneJson(source.example)
    if (Object.hasOwn(source, 'default')) return cloneJson(source.default)
    if (Object.hasOwn(source, 'const')) return cloneJson(source.const)
    if (Array.isArray(source.enum) && source.enum.length > 0) return cloneJson(source.enum[0])

    if (Array.isArray(source.anyOf) && source.anyOf.length > 0) {
      return walk(source.anyOf[0], depth + 1, refStack)
    }
    if (Array.isArray(source.oneOf) && source.oneOf.length > 0) {
      return walk(source.oneOf[0], depth + 1, refStack)
    }

    const type = schemaType(source)
    if (type === 'object' || source.properties) {
      const result: Record<string, unknown> = {}
      if (Array.isArray(source.allOf)) {
        for (const child of source.allOf) {
          const value = walk(child, depth + 1, refStack)
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(result, value)
          }
        }
      }
      const properties = source.properties
      if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
        for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
          result[key] = walk(child, depth + 1, refStack)
        }
      }
      return result
    }

    if (type === 'array' || source.items) {
      const items = Array.isArray(source.items) ? source.items[0] : source.items
      return items ? [walk(items, depth + 1, refStack)] : []
    }

    return placeholder(type)
  }

  return { value: walk(schema, 0, new Set()), warnings }
}
