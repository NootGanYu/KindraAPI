import type { ModelSchema } from '@shared/types'
import * as store from '../storage/store'

export const MODEL_REF_PREFIX = 'openpost://model/'
export const MAX_REF_DEPTH = 8

export type ExampleWarningCode =
  | 'cycle'
  | 'missing-model'
  | 'invalid-ref'
  | 'depth-limit'

export interface ExampleWarning {
  code: ExampleWarningCode
  message: string
  ref?: string
  /** 生成路径，例如 `data.items` */
  path?: string
}

export interface GeneratedExample {
  value: unknown
  warnings: ExampleWarning[]
}

export type ModelSchemaResolver = (modelId: string) => ModelSchema | null

export function isModelRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MODEL_REF_PREFIX)
}

export function modelIdFromRef(ref: string): string | null {
  if (!isModelRef(ref)) return null
  const id = ref.slice(MODEL_REF_PREFIX.length).trim()
  return id || null
}

export function modelRefOf(modelId: string): string {
  return `${MODEL_REF_PREFIX}${modelId}`
}

interface GenerateContext {
  resolve?: ModelSchemaResolver
  warnings: ExampleWarning[]
  seen: Set<string>
}

function atPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`
  return path ? `${path}.${key}` : key
}

function orderedKeys(schema: ModelSchema): string[] {
  const properties = schema.properties ?? {}
  const order = Array.isArray(schema['x-schema-orders']) ? schema['x-schema-orders'] : []
  const result: string[] = []
  for (const key of order) {
    if (typeof key === 'string' && key in properties && !result.includes(key)) result.push(key)
  }
  for (const key of Object.keys(properties)) {
    if (!result.includes(key)) result.push(key)
  }
  return result
}

function generate(schema: ModelSchema | undefined | null, depth: number, path: string, ctx: GenerateContext): unknown {
  if (!schema || typeof schema !== 'object') return null

  // 显式取值优先于 $ref：example → default → enum[0]
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]

  if (schema.$ref !== undefined) {
    const ref = schema.$ref
    const modelId = modelIdFromRef(ref)
    if (!modelId) {
      ctx.warnings.push({
        code: 'invalid-ref',
        ref: String(ref),
        path,
        message: `无法识别的模型引用：${String(ref)}`
      })
      return null
    }
    if (depth >= MAX_REF_DEPTH) {
      ctx.warnings.push({
        code: 'depth-limit',
        ref,
        path,
        message: `模型引用层级超过 ${MAX_REF_DEPTH} 层，已停止生成`
      })
      return null
    }
    if (ctx.seen.has(modelId)) {
      ctx.warnings.push({
        code: 'cycle',
        ref,
        path,
        message: `检测到模型循环引用：${modelId}`
      })
      return null
    }
    if (!ctx.resolve) {
      ctx.warnings.push({
        code: 'missing-model',
        ref,
        path,
        message: `模型引用无法解析：${modelId}`
      })
      return null
    }
    const resolved = ctx.resolve(modelId)
    if (!resolved) {
      ctx.warnings.push({
        code: 'missing-model',
        ref,
        path,
        message: `模型不存在或已删除：${modelId}`
      })
      return null
    }
    ctx.seen.add(modelId)
    try {
      return generate(resolved, depth + 1, path, ctx)
    } finally {
      ctx.seen.delete(modelId)
    }
  }

  if (schema.type === 'object' || schema.properties) {
    const result: Record<string, unknown> = {}
    for (const key of orderedKeys(schema)) {
      result[key] = generate(schema.properties?.[key], depth + 1, atPath(path, key), ctx)
    }
    return result
  }

  if (schema.type === 'array') {
    if (!schema.items) return []
    return [generate(schema.items, depth + 1, atPath(path, 0), ctx)]
  }

  switch (schema.type) {
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'string':
      return ''
    case 'null':
      return null
    default:
      return null
  }
}

/**
 * 按 example → default → enum[0] → 类型占位的优先级生成示例。
 * $ref 通过 resolver 解析；循环与失效引用返回 warning 并保留其余结果。
 */
export function generateSchemaExample(
  schema: ModelSchema | null | undefined,
  resolve?: ModelSchemaResolver
): GeneratedExample {
  const ctx: GenerateContext = { resolve, warnings: [], seen: new Set<string>() }
  const value = generate(schema, 0, '', ctx)
  return { value, warnings: ctx.warnings }
}

function projectResolver(projectId: string): ModelSchemaResolver {
  return (modelId) => {
    const model = store.getModel(projectId, modelId)
    return model ? model.data.schema : null
  }
}

export function generateFromSchema(
  projectId: string,
  schema: ModelSchema | null | undefined
): GeneratedExample {
  return generateSchemaExample(schema, projectResolver(projectId))
}

export function generateModelExample(projectId: string, modelId: string): GeneratedExample {
  const model = store.getModel(projectId, modelId)
  if (!model) {
    return {
      value: null,
      warnings: [
        {
          code: 'missing-model',
          ref: modelRefOf(modelId),
          message: '模型不存在或已删除'
        }
      ]
    }
  }
  const ctx: GenerateContext = { resolve: projectResolver(projectId), warnings: [], seen: new Set([modelId]) }
  const value = generate(model.data.schema, 0, '', ctx)
  return { value, warnings: ctx.warnings }
}

/**
 * 展开 schema 中的所有模型引用，返回一份不含 $ref 的副本与 warning。
 * 用于 Raw 校验与持久化前的结构检查。
 */
export function resolveModelRefs(
  projectId: string,
  schema: ModelSchema
): { schema: ModelSchema; warnings: ExampleWarning[] } {
  const resolve = projectResolver(projectId)
  const warnings: ExampleWarning[] = []

  const walk = (node: ModelSchema, depth: number, seen: Set<string>, path: string): ModelSchema => {
    if (!node || typeof node !== 'object') return node
    if (isModelRef(node.$ref)) {
      const modelId = modelIdFromRef(node.$ref)
      if (!modelId) {
        warnings.push({ code: 'invalid-ref', ref: node.$ref, path, message: `无法识别的模型引用：${node.$ref}` })
        return { ...node }
      }
      if (depth >= MAX_REF_DEPTH) {
        warnings.push({ code: 'depth-limit', ref: node.$ref, path, message: '模型引用层级过深' })
        return { ...node }
      }
      if (seen.has(modelId)) {
        warnings.push({ code: 'cycle', ref: node.$ref, path, message: `检测到模型循环引用：${modelId}` })
        return { ...node }
      }
      const target = resolve(modelId)
      if (!target) {
        warnings.push({ code: 'missing-model', ref: node.$ref, path, message: `模型不存在或已删除：${modelId}` })
        return { ...node }
      }
      const nextSeen = new Set(seen)
      nextSeen.add(modelId)
      return walk(target, depth + 1, nextSeen, path)
    }

    const next: ModelSchema = { ...node }
    if (node.properties) {
      next.properties = {}
      for (const [key, child] of Object.entries(node.properties)) {
        next.properties[key] = walk(child, depth + 1, seen, atPath(path, key))
      }
    }
    if (node.items) next.items = walk(node.items, depth + 1, seen, atPath(path, 'items'))
    return next
  }

  return { schema: walk(schema, 0, new Set<string>(), ''), warnings }
}
