import type { AgentToolRisk } from '@shared/agent'
import type { ModelTool } from '../model'
import type { ProjectRedactor } from '../redaction'

export interface AgentToolContext {
  projectId: string
  /** Handlers that pre-serialize a large section redact it before stringifying. */
  redact?: ProjectRedactor
}
export interface AgentToolResult {
  output: unknown
  /** Human-facing redacted summary for the timeline. */
  summary?: string
  /** Continuation cursor when the result is paged or truncated. */
  cursor?: string
}
export interface AgentToolExecution extends AgentToolResult {
  isError: boolean
}
export interface AgentToolDefinition {
  /** Globally unique across the registry. */
  name: string
  description: string
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>
  risk: AgentToolRisk
  readOnly: boolean
  handler: (args: Record<string, unknown>, context: AgentToolContext) => AgentToolResult | Promise<AgentToolResult>
  /** Optional domain projection applied before redaction. */
  projection?: (value: unknown) => unknown
}

export class AgentToolRegistry {
  private readonly definitions = new Map<string, AgentToolDefinition>()

  register(definition: AgentToolDefinition): this {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(definition.name)) throw new Error(`工具名无效：${definition.name}`)
    if (this.definitions.has(definition.name)) throw new Error(`工具名重复：${definition.name}`)
    if (definition.readOnly !== (definition.risk === 'read')) throw new Error(`工具风险与只读标记不一致：${definition.name}`)
    this.definitions.set(definition.name, definition)
    return this
  }

  registerAll(definitions: readonly AgentToolDefinition[]): this {
    for (const definition of definitions) this.register(definition)
    return this
  }

  get(name: string): AgentToolDefinition | undefined {
    return this.definitions.get(name)
  }

  list(): AgentToolDefinition[] {
    return [...this.definitions.values()]
  }

  modelTools(): ModelTool[] {
    return this.list().map(definition => ({
      type: 'function',
      function: { name: definition.name, description: definition.description, parameters: definition.parameters }
    }))
  }

  async execute(name: string, args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolExecution> {
    const definition = this.definitions.get(name)
    if (!definition) return { isError: true, output: { error: `未知工具：${name}` }, summary: `未知工具 ${name}` }
    try {
      const result = await definition.handler(args, context)
      return {
        isError: false,
        output: definition.projection ? definition.projection(result.output) : result.output,
        summary: result.summary,
        cursor: result.cursor
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '工具执行失败'
      return { isError: true, output: { error: message }, summary: `${definition.name} 失败：${message}` }
    }
  }
}

// ---------------------------------------------------------------------------
// Paging helpers shared by the read-only skills
// ---------------------------------------------------------------------------

export function cursorNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return 0
}

export function limitNumber(value: unknown, fallback = 20, max = 100): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

export interface PagedItems<T> {
  items: T[]
  next_cursor: string | null
  total: number
}

export function pageItems<T>(items: readonly T[], cursor: unknown, limit: unknown, fallback = 20, max = 100): PagedItems<T> {
  const start = cursorNumber(cursor)
  const size = limitNumber(limit, fallback, max)
  const slice = items.slice(start, start + size)
  return { items: slice, next_cursor: start + slice.length < items.length ? String(start + slice.length) : null, total: items.length }
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
export function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args[key])
  if (!value) throw new Error(`缺少参数 ${key}`)
  return value
}
