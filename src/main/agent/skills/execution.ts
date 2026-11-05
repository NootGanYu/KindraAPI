import type { AgentExecutionPermissions } from '@shared/agentPlan'
import type { ApiCase, SendRecord, Target } from '@shared/types'
import * as store from '../../storage/store'
import { getDraft } from '../drafts'
import { readFlowDraftIfPresent } from '../flowDrafts'
import { prepareExecution, executeSnapshot, type ExecutionSnapshot } from '../execution'
import { prepareFlowExecution, executeFlowSnapshot, type FlowExecutionSnapshot } from '../flowExecution'
import type { AgentToolApprovalDetails, AgentToolContext, AgentToolDefinition, AgentToolResult } from '../core/registry'
import { optionalString, requiredString } from '../core/registry'
import { executionKey, type PreparedExecution } from '../core/runState'

const MAX_EXTRA_REQUESTS = 32
const EXTRA_PROPERTIES = {
  type: 'object',
  properties: {
    method: { type: 'string', description: '额外请求方法，例如 GET/POST' },
    url: { type: 'string', description: '完整 http(s) URL；不得包含账号密码或未解析变量' },
    max_calls: { type: 'integer', minimum: 1, maximum: 100, description: '本次执行最多发出的次数' }
  },
  required: ['method', 'url', 'max_calls'],
  additionalProperties: false
} as const

interface ParsedPermissions {
  permissions: AgentExecutionPermissions
  saveResponse: boolean
  writeVariables: boolean
  extra: Array<{ method: string; url: string; max_calls: number }>
}
function parsePermissions(args: Record<string, unknown>): ParsedPermissions {
  const raw = args.extra_requests
  if (raw !== undefined && (!Array.isArray(raw) || raw.length > MAX_EXTRA_REQUESTS)) throw new Error(`额外请求必须是最多 ${MAX_EXTRA_REQUESTS} 条数组`)
  const extra = (raw ?? []).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`额外请求 ${index + 1} 结构无效`)
    const value = entry as Record<string, unknown>
    if (typeof value.method !== 'string' || !/^[A-Za-z]+$/.test(value.method)) throw new Error(`额外请求 ${index + 1} 方法无效`)
    if (typeof value.url !== 'string' || !value.url) throw new Error(`额外请求 ${index + 1} URL 无效`)
    if (!Number.isInteger(value.max_calls) || (value.max_calls as number) < 1 || (value.max_calls as number) > 100) throw new Error(`额外请求 ${index + 1} 次数必须为 1-100`)
    return { method: value.method.toUpperCase(), url: value.url, max_calls: value.max_calls as number }
  })
  if (args.save_response !== undefined && typeof args.save_response !== 'boolean') throw new Error('save_response 必须是布尔值')
  if (args.write_variables !== undefined && typeof args.write_variables !== 'boolean') throw new Error('write_variables 必须是布尔值')
  return {
    permissions: { requests: extra.map(item => ({ method: item.method, url: item.url, maxCalls: item.max_calls })), saveResponse: args.save_response === true, writeVariables: args.write_variables === true },
    saveResponse: args.save_response === true,
    writeVariables: args.write_variables === true,
    extra
  }
}
function environmentFor(projectId: string, requested?: string, fallback?: string): string | undefined {
  const id = requested ?? fallback
  if (!id) return undefined
  if (!store.listEnvironments(projectId).some(item => item.env_id === id)) throw new Error('环境不存在，请重新读取环境目录')
  return id
}
function assertNotUnknown(context: AgentToolContext, key: string): void {
  if (context.state.unknown.has(key)) throw new Error('该目标本轮执行结果未知，禁止自动重发；请在新的用户请求中明确要求重试。')
}
function targetForExecution(projectId: string, targetId: string): Target {
  const draft = getDraft(projectId, targetId)
  return draft.target
}
function apiDetails(context: AgentToolContext, snapshot: ExecutionSnapshot, parsed: ParsedPermissions): AgentToolApprovalDetails {
  const lines = [
    '网络执行可能产生远端业务副作用；不跟随重定向。',
    `方法：${snapshot.method}`,
    `URL：${snapshot.url}`,
    `Host：${snapshot.host}`,
    ...snapshot.effects,
    `额外请求：${parsed.extra.length ? parsed.extra.map(item => `${item.method} ${item.url} ×${item.max_calls}`).join('；') : '无'}`,
    `变量写回：${parsed.writeVariables ? '允许（冲突时暂停）' : '不允许'}`,
    `保存响应：${parsed.saveResponse ? '允许捕获本轮成功响应，后续仍需单独保存' : '不允许'}`,
    '结果未知时禁止自动重发。'
  ]
  const safe = context.redact ? context.redact(lines) : lines
  return { summary: `执行 ${snapshot.method} ${snapshot.url}`, display: safe.join('\n') }
}
function flowDetails(context: AgentToolContext, snapshot: FlowExecutionSnapshot): AgentToolApprovalDetails {
  const lines = [
    'Flow 执行可能产生多次远端副作用；不跟随重定向，失败或未知后停止依赖。',
    ...snapshot.effects,
    '结果未知时禁止自动重发。'
  ]
  const safe = context.redact ? context.redact(lines) : lines
  return { summary: `执行 Flow：${snapshot.flow.name}`, display: safe.join('\n') }
}
function preparedApi(context: AgentToolContext, prepare: () => ExecutionSnapshot): ExecutionSnapshot {
  const cached = context.state.prepared.get(context.stepId)
  if (cached?.kind === 'api') return cached.snapshot
  const snapshot = prepare()
  context.state.prepared.set(context.stepId, { kind: 'api', snapshot } satisfies PreparedExecution)
  return snapshot
}
function preparedFlow(context: AgentToolContext, prepare: () => FlowExecutionSnapshot): FlowExecutionSnapshot {
  const cached = context.state.prepared.get(context.stepId)
  if (cached?.kind === 'flow') return cached.snapshot
  const snapshot = prepare()
  context.state.prepared.set(context.stepId, { kind: 'flow', snapshot } satisfies PreparedExecution)
  return snapshot
}
function counts(assertions: SendRecord['assertions']): { total: number; failed: number } {
  return { total: assertions.length, failed: assertions.filter(item => !item.passed && !item.skipped).length }
}
function capturedApiResult(
  context: AgentToolContext,
  result: Awaited<ReturnType<typeof executeSnapshot>>,
  targetId: string,
  parsed: ParsedPermissions,
  caseResult?: CaseSummary
): AgentToolResult {
  const record = result.record
  const code = record.response?.code ?? null
  if (parsed.saveResponse && result.status === 'succeeded' && result.response && code !== null && code >= 200 && code < 300) {
    context.state.responses.set(targetId, { target_id: targetId, run_id: record.record_id, response: result.response })
  }
  const report = result.report as { network_attempts?: unknown } | null
  const assertion = counts(record.assertions ?? [])
  const output = {
    outcome: result.status,
    method: record.method,
    url: record.url,
    status_code: code,
    duration_ms: record.response?.response_time ?? null,
    assertion_total: assertion.total,
    assertion_failed: assertion.failed,
    network_attempts: report?.network_attempts ?? [],
    run_id: record.record_id,
    captured_response: parsed.saveResponse && result.status === 'succeeded' && code !== null && code >= 200 && code < 300,
    retryable: result.retryable,
    unknown: result.status === 'unknown',
    ...(caseResult ? { case: caseResult } : {}),
    ...(result.error ? { error: result.error } : {})
  }
  const warning = result.status === 'unknown' ? '执行结果未知：请求可能已到达服务，禁止自动重发。' : ''
  const lines = [
    ...(warning ? [warning] : []),
    '风险：网络执行，可能产生远端副作用；结果未知不自动重发。',
    `结果：${result.status}${code !== null ? ` · HTTP ${code}` : ''}`,
    `请求：${record.method} ${record.url}`,
    `耗时：${record.response?.response_time ?? '-'} ms`,
    `断言：${assertion.total} 项，失败 ${assertion.failed} 项`,
    `额外请求：${parsed.extra.length} 条`,
    `变量写回：${parsed.writeVariables ? '已请求' : '未请求'}`,
    `响应捕获：${output.captured_response ? `已捕获（${record.record_id}）` : '未捕获'}`,
    ...(caseResult ? [`用例：${caseResult.name} · ${caseResult.status}`] : []),
    ...(result.error ? [`错误：${result.error}`] : [])
  ]
  const safe = context.redact ? context.redact(lines) : lines
  return {
    isError: result.status !== 'succeeded',
    output,
    summary: result.status === 'unknown' ? `执行结果未知：${record.method} ${record.url}` : `执行 ${record.method} ${record.url} · ${result.status}`,
    display: safe.join('\n')
  }
}
interface CaseSummary { case_id: string; name: string; status: string; http_status?: number; duration_ms?: number; assertion_failed: number; error?: string }
function caseSummary(report: unknown, fallback: ApiCase): CaseSummary {
  const value = (report as { case_result?: Record<string, unknown> } | null)?.case_result
  return {
    case_id: fallback.case_id,
    name: fallback.name,
    status: String(value?.status ?? 'unknown'),
    http_status: typeof value?.http_status === 'number' ? value.http_status : undefined,
    duration_ms: typeof value?.duration_ms === 'number' ? value.duration_ms : undefined,
    assertion_failed: Array.isArray(value?.assertions) ? (value.assertions as Array<{ passed?: boolean }>).filter(item => item.passed === false).length : 0,
    ...(typeof value?.error === 'string' ? { error: value.error } : {})
  }
}
function flowResult(context: AgentToolContext, result: Awaited<ReturnType<typeof executeFlowSnapshot>>): AgentToolResult {
  const report = result.report as { events?: Array<Record<string, unknown>>; snapshot_sha256?: string } | null
  const flat = (events: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> => events.flatMap(event => [event, ...flat(Array.isArray(event.children) ? event.children as Array<Record<string, unknown>> : [])])
  const events = flat(report?.events)
  const counts = { passed: 0, failed: 0, skipped: 0, unknown: 0, cancelled: 0 }
  for (const event of events) {
    const status = String(event.status ?? 'skipped')
    if (status === 'passed') counts.passed++
    else if (status === 'failed') counts.failed++
    else if (status === 'unknown') counts.unknown++
    else if (status === 'cancelled') counts.cancelled++
    else counts.skipped++
  }
  const summaryEvents = events.map(event => ({
    event_id: typeof event.event_id === 'string' ? event.event_id : '',
    name: typeof event.name === 'string' ? event.name : '',
    type: typeof event.type === 'string' ? event.type : '',
    status: String(event.status ?? ''),
    elapsed_ms: typeof event.elapsed_ms === 'number' ? event.elapsed_ms : undefined,
    ...(event.error ? { error: String(event.error) } : {})
  }))
  const warning = result.status === 'unknown' ? 'Flow 执行结果未知：部分请求可能已到达服务，禁止自动重发。' : ''
  const output = { outcome: result.status, counts, events: summaryEvents, snapshot_sha256: report?.snapshot_sha256, retryable: result.retryable, unknown: result.status === 'unknown', ...(result.error ? { error: result.error } : {}) }
  const lines = [
    ...(warning ? [warning] : []),
    '风险：网络执行，可能产生远端副作用；结果未知不自动重发。',
    `结果：${result.status}`,
    `节点：通过 ${counts.passed} · 失败 ${counts.failed} · 跳过 ${counts.skipped} · 未知 ${counts.unknown} · 取消 ${counts.cancelled}`,
    ...summaryEvents.slice(0, 40).map(event => `- ${event.name || event.event_id}（${event.type}）：${event.status}${event.elapsed_ms !== undefined ? ` · ${event.elapsed_ms}ms` : ''}${event.error ? ` · ${event.error}` : ''}`),
    ...(result.error ? [`错误：${result.error}`] : [])
  ]
  const safe = context.redact ? context.redact(lines) : lines
  return {
    isError: result.status !== 'succeeded',
    output,
    summary: result.status === 'unknown' ? 'Flow 执行结果未知，禁止自动重发' : `Flow 执行 · ${result.status}`,
    display: safe.join('\n')
  }
}

export const executionTools: AgentToolDefinition[] = [
  {
    name: 'execute_api',
    description: '执行一个接口（使用本机草稿）并返回脱敏摘要。额外请求、变量写回与响应捕获必须显式提出，且会出现在审批卡片中。结果未知时本轮禁止重发。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        environment_id: { type: 'string' },
        save_response: { type: 'boolean', description: '允许捕获本次成功 2xx 响应，供本轮 save_api_response 使用' },
        extra_requests: { type: 'array', maxItems: MAX_EXTRA_REQUESTS, items: EXTRA_PROPERTIES },
        write_variables: { type: 'boolean', description: '允许脚本变量差量写回环境或全局变量' }
      },
      required: ['target_id'],
      additionalProperties: false
    },
    risk: 'network-write',
    readOnly: false,
    describeForApproval: (args, context) => {
      const targetId = requiredString(args, 'target_id')
      const parsed = parsePermissions(args)
      const target = targetForExecution(context.projectId, targetId)
      const environmentId = environmentFor(context.projectId, optionalString(args.environment_id))
      const key = executionKey('api', targetId, environmentId)
      assertNotUnknown(context, key)
      const snapshot = preparedApi(context, () => prepareExecution(context.projectId, target, environmentId, parsed.permissions))
      return apiDetails(context, snapshot, parsed)
    },
    handler: (args, context) => {
      const targetId = requiredString(args, 'target_id')
      const parsed = parsePermissions(args)
      const target = targetForExecution(context.projectId, targetId)
      const environmentId = environmentFor(context.projectId, optionalString(args.environment_id))
      const key = executionKey('api', targetId, environmentId)
      assertNotUnknown(context, key)
      const snapshot = preparedApi(context, () => prepareExecution(context.projectId, target, environmentId, parsed.permissions))
      try {
        return executeSnapshot(snapshot, context.signal ?? new AbortController().signal).then(result => {
          if (result.status === 'unknown') context.state.unknown.add(key)
          return capturedApiResult(context, result, targetId, parsed)
        })
      } finally {
        context.state.prepared.delete(context.stepId)
      }
    }
  },
  {
    name: 'execute_case',
    description: '执行一个接口用例（使用本机草稿），返回用例与断言摘要。额外请求、变量写回与响应捕获必须显式提出。结果未知时本轮禁止重发。',
    parameters: {
      type: 'object',
      properties: {
        target_id: { type: 'string' },
        case_id: { type: 'string' },
        environment_id: { type: 'string' },
        save_response: { type: 'boolean' },
        extra_requests: { type: 'array', maxItems: MAX_EXTRA_REQUESTS, items: EXTRA_PROPERTIES },
        write_variables: { type: 'boolean' }
      },
      required: ['target_id', 'case_id'],
      additionalProperties: false
    },
    risk: 'network-write',
    readOnly: false,
    describeForApproval: (args, context) => {
      const targetId = requiredString(args, 'target_id')
      const caseId = requiredString(args, 'case_id')
      const parsed = parsePermissions(args)
      const target = targetForExecution(context.projectId, targetId)
      const apiCase = target.cases?.find(item => item.case_id === caseId)
      if (!apiCase) throw new Error('用例不存在')
      const environmentId = environmentFor(context.projectId, optionalString(args.environment_id))
      // An unknown outcome is per target/environment, regardless of which case caused it.
      const key = executionKey('api', targetId, environmentId)
      assertNotUnknown(context, key)
      const snapshot = preparedApi(context, () => prepareExecution(context.projectId, target, environmentId, parsed.permissions, apiCase))
      return apiDetails(context, snapshot, parsed)
    },
    handler: (args, context) => {
      const targetId = requiredString(args, 'target_id')
      const caseId = requiredString(args, 'case_id')
      const parsed = parsePermissions(args)
      const target = targetForExecution(context.projectId, targetId)
      const apiCase = target.cases?.find(item => item.case_id === caseId)
      if (!apiCase) throw new Error('用例不存在')
      const environmentId = environmentFor(context.projectId, optionalString(args.environment_id))
      // An unknown outcome is per target/environment, regardless of which case caused it.
      const key = executionKey('api', targetId, environmentId)
      assertNotUnknown(context, key)
      const snapshot = preparedApi(context, () => prepareExecution(context.projectId, target, environmentId, parsed.permissions, apiCase))
      return executeSnapshot(snapshot, context.signal ?? new AbortController().signal).then(result => {
        if (result.status === 'unknown') context.state.unknown.add(key)
        return capturedApiResult(context, result, targetId, parsed, caseSummary(result.report, apiCase))
      }).finally(() => context.state.prepared.delete(context.stepId))
    }
  },
  {
    name: 'execute_flow',
    description: '执行一个已正式存在的 Flow（使用本机 Flow 草稿），返回脱敏的节点结果汇总。结果未知时本轮禁止重发。',
    parameters: {
      type: 'object',
      properties: { flow_id: { type: 'string' }, environment_id: { type: 'string' } },
      required: ['flow_id'],
      additionalProperties: false
    },
    risk: 'network-write',
    readOnly: false,
    describeForApproval: (args, context) => {
      const flowId = requiredString(args, 'flow_id')
      const flow = flowForExecution(context.projectId, flowId)
      const environmentId = environmentFor(context.projectId, optionalString(args.environment_id), flow.env_id)
      const key = executionKey('flow', flowId, environmentId)
      assertNotUnknown(context, key)
      const snapshot = preparedFlow(context, () => prepareFlowExecution(context.projectId, flow, environmentId, {}))
      return flowDetails(context, snapshot)
    },
    handler: (args, context) => {
      const flowId = requiredString(args, 'flow_id')
      const flow = flowForExecution(context.projectId, flowId)
      const environmentId = environmentFor(context.projectId, optionalString(args.environment_id), flow.env_id)
      const key = executionKey('flow', flowId, environmentId)
      assertNotUnknown(context, key)
      const snapshot = preparedFlow(context, () => prepareFlowExecution(context.projectId, flow, environmentId, {}))
      return executeFlowSnapshot(snapshot, context.signal ?? new AbortController().signal).then(result => {
        if (result.status === 'unknown') context.state.unknown.add(key)
        return flowResult(context, result)
      }).finally(() => context.state.prepared.delete(context.stepId))
    }
  }
]

function flowForExecution(projectId: string, flowId: string) {
  const saved = store.getFlow(projectId, flowId)
  if (!saved) throw new Error('Flow 尚未正式存在，不能执行；请先完成 Flow 草稿并正式保存')
  const draft = readFlowDraftIfPresent(projectId, flowId)
  return draft?.flow ?? saved
}
