import { randomUUID } from 'node:crypto'
import type { AgentActivity, AgentActivityStatus } from '@shared/agent'
import { completeModel, type ModelConnection, type ModelMessage, type ModelReply, type ModelTool } from '../model'
import type { ProjectRedactor } from '../redaction'
import type { AgentToolDefinition, AgentToolExecution } from './registry'

export const DEFAULT_MAX_TURNS = 100
/** One tool result that reaches the model is capped at 24 KB. */
export const MAX_TOOL_RESULT_BYTES = 24 * 1024
/** Older history is folded once it exceeds 256 KB; the recent tail keeps 96 KB. */
export const MAX_HISTORY_BYTES = 256 * 1024
export const KEEP_RECENT_BYTES = 96 * 1024
const MAX_IDENTICAL_TURNS = 3
const MAX_ALL_ERROR_TURNS = 3
const MAX_INPUT_FAILURE_TURNS = 3
const MAX_REPEATED_READS = 3
const FINALIZE_NOTE = '[系统] 已达到本轮工具调用上限。不要继续调用工具，请基于已经读取到的信息直接回答；如果任务未完成，说明已完成部分与剩余部分。'
const CANCELED_RESULT = '本轮已被用户取消，该工具未执行；不会自动重放。'

export interface AgentLoopOptions {
  model: ModelConnection
  projectId: string
  /** Groups activities with the persisted user/assistant messages of this turn. */
  turnId?: string
  system: string
  /** Per-run catalog/active-object summary appended to the system prompt. */
  context?: string
  history?: ModelMessage[]
  userMessage: string
  tools: AgentToolDefinition[]
  maxTurns?: number
  signal?: AbortSignal
  /** Redacts tool results before they enter the ledger or timeline. */
  redact?: ProjectRedactor
  onText?: (text: string) => void
  /** Called once when an activity starts and again when it settles. */
  onActivity?: (activity: AgentActivity) => void
}
export type AgentLoopStatus = 'completed' | 'turn-limit' | 'cancelled' | 'error'
export interface AgentLoopResult {
  status: AgentLoopStatus
  /** Final assistant text. Empty for an interrupted or failed run. */
  text: string
  messages: ModelMessage[]
  activities: AgentActivity[]
  error?: string
  /** True when the user can safely re-send the request to retry. */
  retryable: boolean
}

function utf8Size(text: string): number {
  let size = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : 3
  }
  return size
}
function truncateBytes(text: string, maxBytes: number): string {
  let size = 0
  let index = 0
  for (; index < text.length; index++) {
    const code = text.charCodeAt(index)
    const next = size + (code < 0x80 ? 1 : code < 0x800 ? 2 : 3)
    if (next > maxBytes) break
    size = next
  }
  return text.slice(0, index)
}
function messageSize(message: ModelMessage): number {
  let size = utf8Size(message.content)
  for (const call of message.tool_calls ?? []) size += utf8Size(call.function.arguments) + 40
  return size
}
function historySize(messages: readonly ModelMessage[]): number {
  return messages.reduce((total, message) => total + messageSize(message), 0)
}
function mechanicalSummary(messages: readonly ModelMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    if (message.role === 'user' && !message.content.startsWith('[较早对话摘要]')) lines.push(`- 用户：${message.content.slice(0, 200)}`)
    else if (message.role === 'assistant' && message.content) lines.push(`- 助手：${message.content.slice(0, 200)}`)
    else if (message.role === 'tool' && message.content) lines.push(`  · 工具结果：${message.content.slice(0, 160)}`)
  }
  return lines.join('\n').slice(0, 4_000) || '(较早对话已省略)'
}
/** Keep tool_use/tool_result pairs intact by cutting at a user boundary. */
function compactHistory(messages: ModelMessage[]): ModelMessage[] {
  if (historySize(messages) <= MAX_HISTORY_BYTES) return messages
  let kept = 0
  let cut = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    kept += messageSize(messages[index])
    if (kept > KEEP_RECENT_BYTES && cut >= 0) break
    if (messages[index].role === 'user') cut = index
  }
  if (cut <= 0) return messages
  return [
    { role: 'user', content: `[较早对话摘要（自动压缩）]\n${mechanicalSummary(messages.slice(0, cut))}` },
    { role: 'assistant', content: '已了解，继续。' },
    ...messages.slice(cut)
  ]
}
function dedupeKey(name: string, input: Record<string, unknown>): string {
  const ordered = Object.fromEntries(Object.keys(input).sort().map(key => [key, input[key]]))
  return `${name}\0${JSON.stringify(ordered)}`
}
function missingRequired(tool: AgentToolDefinition, input: Record<string, unknown>): string[] {
  const required = tool.parameters.required
  if (!Array.isArray(required)) return []
  return required.filter(field => typeof field === 'string' && (input[field] === undefined || input[field] === null))
}
function parseArguments(call: ModelReply['toolCalls'][number]): { input: Record<string, unknown> } | { error: string } {
  const raw = typeof call.arguments === 'string' ? call.arguments.trim() : ''
  if (!raw) return { input: {} }
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '工具参数必须是 JSON 对象' }
    return { input: value as Record<string, unknown> }
  } catch {
    return { error: '工具参数不是合法 JSON（可能被截断）；请拆分操作并重新调用。' }
  }
}
function redactStream(redact: ProjectRedactor | undefined, text: string): string {
  return redact ? redact.stream(text) : text
}
function redactValue<T>(redact: ProjectRedactor | undefined, value: T): T {
  return redact ? redact(value) : value
}
function resultContent(execution: AgentToolExecution, redact: ProjectRedactor | undefined): string {
  const output = redactValue(redact, execution.output)
  const payload = execution.isError
    ? { ok: false, error: output }
    : { ok: true, result: output, ...(execution.cursor ? { next_cursor: execution.cursor } : {}) }
  const content = redactStream(redact, JSON.stringify(payload))
  if (utf8Size(content) <= MAX_TOOL_RESULT_BYTES) return content
  return redactStream(redact, JSON.stringify({
    ok: payload.ok,
    truncated: true,
    note: '单条工具结果超过 24KB；请使用 cursor/limit 分页继续读取，不要假设未返回部分。',
    ...(execution.cursor ? { next_cursor: execution.cursor } : {}),
    preview: truncateBytes(content, MAX_TOOL_RESULT_BYTES - 500)
  }))
}
function displayContent(execution: AgentToolExecution, redact: ProjectRedactor | undefined): string | undefined {
  if (execution.output === undefined) return undefined
  const output = redactValue(redact, execution.output)
  const value = execution.isError ? { error: output } : output
  return truncateBytes(redactStream(redact, JSON.stringify(value, null, 2)), MAX_TOOL_RESULT_BYTES)
}
function executionError(execution: AgentToolExecution): string {
  const output = execution.output
  if (output && typeof output === 'object' && 'error' in output) return String((output as { error: unknown }).error)
  return execution.summary ?? '工具执行失败'
}
async function executeDefinition(definition: AgentToolDefinition, args: Record<string, unknown>, projectId: string, redact?: ProjectRedactor): Promise<AgentToolExecution> {
  try {
    const result = await definition.handler(args, { projectId, redact })
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
function startActivity(turnId: string, callId: string, toolName: string, definition: AgentToolDefinition | undefined, onActivity?: (activity: AgentActivity) => void): AgentActivity {
  const activity: AgentActivity = {
    activity_id: randomUUID(),
    turn_id: turnId,
    call_id: callId,
    tool: toolName,
    risk: definition?.risk ?? 'read',
    status: 'running',
    summary: `正在执行 ${toolName}`,
    created_at: new Date().toISOString()
  }
  onActivity?.(activity)
  return activity
}
function finishActivity(activity: AgentActivity, status: AgentActivityStatus, execution: AgentToolExecution, redact: ProjectRedactor | undefined, onActivity?: (activity: AgentActivity) => void): void {
  activity.status = status
  activity.finished_at = new Date().toISOString()
  if (!execution.isError && execution.summary) activity.summary = redactStream(redact, execution.summary)
  else if (status === 'failed') activity.summary = `工具 ${activity.tool} 执行失败`
  if (execution.isError) activity.error = redactStream(redact, executionError(execution))
  if (execution.cursor) activity.cursor = execution.cursor
  const display = displayContent(execution, redact)
  if (display) activity.display = display
  onActivity?.(activity)
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { model, signal, redact } = options
  const maxTurns = Math.max(1, options.maxTurns ?? DEFAULT_MAX_TURNS)
  const modelTools: ModelTool[] = options.tools.map(definition => ({
    type: 'function',
    function: { name: definition.name, description: definition.description, parameters: definition.parameters }
  }))
  let ledger: ModelMessage[] = (options.history ?? []).map(message => ({ ...message }))
  if (options.userMessage) ledger.push({ role: 'user', content: options.userMessage })
  const activities: AgentActivity[] = []
  const system = options.context ? `${options.system}\n\n${options.context}` : options.system
  let turns = 0
  let finalizing = false
  let lastTurnSignature = ''
  let identicalTurns = 0
  let allErrorTurns = 0
  let inputFailureTurns = 0
  const readCounts = new Map<string, number>()

  const cancelled = (): AgentLoopResult => ({ status: 'cancelled', text: '', messages: ledger, activities, retryable: true })
  const failure = (error: string, retryable = true): AgentLoopResult => ({ status: 'error', text: '', messages: ledger, activities, error, retryable })

  while (true) {
    if (signal?.aborted) return cancelled()
    ledger = compactHistory(ledger)
    if (turns >= maxTurns && !finalizing) {
      finalizing = true
      ledger.push({ role: 'user', content: FINALIZE_NOTE })
    }
    const requestMessages: ModelMessage[] = [{ role: 'system', content: system }, ...ledger]
    let reply: ModelReply
    try {
      reply = await completeModel(model, requestMessages, {
        signal,
        tools: finalizing ? [] : modelTools,
        toolChoice: finalizing ? 'none' : 'auto',
        onText: options.onText
      })
    } catch (error) {
      if (signal?.aborted) return cancelled()
      return failure(redactStream(redact, error instanceof Error ? error.message : '模型请求失败'))
    }
    if (signal?.aborted) return cancelled()
    if (!reply.toolCalls.length || finalizing) {
      const text = reply.text.trim()
      if (!text) return failure(finalizing ? '已达到工具调用轮数上限，但模型没有给出最终回答；可重新发送以继续。' : '模型返回了空响应，可重新发送以继续。')
      const safeText = redactStream(redact, reply.text)
      ledger.push({ role: 'assistant', content: safeText })
      return { status: finalizing ? 'turn-limit' : 'completed', text: safeText, messages: ledger, activities, retryable: finalizing }
    }

    ledger.push({
      role: 'assistant',
      content: redactStream(redact, reply.text),
      tool_calls: reply.toolCalls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: redactStream(redact, call.arguments) } }))
    })
    const turnId = options.turnId ?? randomUUID()
    let executedInTurn = false
    let unusableInTurn = false
    let allFailed = true
    const turnOutputs: string[] = []
    const turnInputs: Array<[string, Record<string, unknown>]> = []
    let guardError = ''

    for (const [index, call] of reply.toolCalls.entries()) {
      if (signal?.aborted) return cancelledWithPending(ledger, reply.toolCalls, index, activities)
      const definition = options.tools.find(tool => tool.name === call.name)
      const activity = startActivity(turnId, call.id, call.name, definition, options.onActivity)
      const parsed = parseArguments(call)
      if ('error' in parsed) {
        unusableInTurn = true
        const execution: AgentToolExecution = { isError: true, output: { error: parsed.error } }
        finishActivity(activity, 'failed', execution, redact, options.onActivity)
        const content = resultContent(execution, redact)
        ledger.push({ role: 'tool', tool_call_id: call.id, content })
        turnOutputs.push(content)
        continue
      }
      if (!definition) {
        unusableInTurn = true
        const execution: AgentToolExecution = { isError: true, output: { error: `未知工具：${call.name}` } }
        finishActivity(activity, 'failed', execution, redact, options.onActivity)
        const content = resultContent(execution, redact)
        ledger.push({ role: 'tool', tool_call_id: call.id, content })
        turnOutputs.push(content)
        continue
      }
      const missing = missingRequired(definition, parsed.input)
      if (missing.length) {
        unusableInTurn = true
        const execution: AgentToolExecution = { isError: true, output: { error: `缺少必需参数：${missing.join('、')}` } }
        finishActivity(activity, 'failed', execution, redact, options.onActivity)
        const content = resultContent(execution, redact)
        ledger.push({ role: 'tool', tool_call_id: call.id, content })
        turnOutputs.push(content)
        continue
      }
      if (definition.readOnly) {
        const key = dedupeKey(definition.name, parsed.input)
        const count = (readCounts.get(key) ?? 0) + 1
        readCounts.set(key, count)
        if (count >= MAX_REPEATED_READS) {
          const execution: AgentToolExecution = { isError: true, output: { error: '同一对象与相同参数已重复读取 3 次，已停止以避免循环。' } }
          finishActivity(activity, 'failed', execution, redact, options.onActivity)
          const content = resultContent(execution, redact)
          ledger.push({ role: 'tool', tool_call_id: call.id, content })
          turnOutputs.push(content)
          guardError = '同一对象与相同参数重复读取达到 3 次，任务已停止；可重新发送以继续。'
          for (let rest = index + 1; rest < reply.toolCalls.length; rest++) ledger.push({ role: 'tool', tool_call_id: reply.toolCalls[rest].id, content: '因重复读取守卫停止，未执行。' })
          break
        }
      }
      executedInTurn = true
      turnInputs.push([call.name, parsed.input])
      const execution = await executeDefinition(definition, parsed.input, options.projectId, redact)
      if (signal?.aborted) {
        finishActivity(activity, 'cancelled', execution, redact, options.onActivity)
        return cancelledWithPending(ledger, reply.toolCalls, index, activities)
      }
      const content = resultContent(execution, redact)
      ledger.push({ role: 'tool', tool_call_id: call.id, content })
      turnOutputs.push(content)
      if (!execution.isError) allFailed = false
      finishActivity(activity, execution.isError ? 'failed' : 'succeeded', execution, redact, options.onActivity)
    }

    if (guardError) return { ...failure(guardError), activities }
    if (signal?.aborted) return cancelled()

    if (executedInTurn) inputFailureTurns = 0
    else if (unusableInTurn) inputFailureTurns++
    if (inputFailureTurns >= MAX_INPUT_FAILURE_TURNS) return failure('工具参数连续 3 轮不可用（JSON 截断或缺少必需参数），已停止；可重新发送以继续。')
    allErrorTurns = allFailed ? allErrorTurns + 1 : 0
    if (allErrorTurns >= MAX_ALL_ERROR_TURNS) return failure('连续 3 轮的工具调用全部失败，已停止；可重新发送以继续。')

    const signature = JSON.stringify([reply.text, turnInputs, turnOutputs])
    identicalTurns = signature === lastTurnSignature ? identicalTurns + 1 : 1
    lastTurnSignature = signature
    if (identicalTurns >= MAX_IDENTICAL_TURNS) return failure('模型连续 3 轮重复完全相同的工具调用与结果，已停止；可重新发送以继续。')
    turns++
  }
}

/**
 * A cancel between calls must still leave a valid tool_use/tool_result pair for
 * every announced call; the ones not started are recorded as cancelled.
 */
function cancelledWithPending(ledger: ModelMessage[], calls: ModelReply['toolCalls'], start: number, activities: AgentActivity[]): AgentLoopResult {
  for (let index = start; index < calls.length; index++) {
    ledger.push({ role: 'tool', tool_call_id: calls[index].id, content: CANCELED_RESULT })
  }
  return { status: 'cancelled', text: '', messages: ledger, activities, retryable: true }
}
