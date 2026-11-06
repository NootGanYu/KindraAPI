import { createHash } from 'node:crypto'
import type { Flow, FlowEvent, FlowEventResult, SendRecord } from '@shared/types'
import type { AgentExecutionPermissions } from '@shared/agentPlan'
import { flowSignature } from '@shared/flowSync'
import * as store from '../storage/store'
import { applyRequestInput, inlineTarget, runFlow, type FlowExecutionProgress } from '../flow/engine'
import { createExecutionVariables, persistExecutionVariables, type ExecutionVariables } from '../request/variables'
import { getDraft } from './drafts'
import { getFlowDraft, listFlowCandidates, validateFlowPatch } from './flowDrafts'
import { executeSnapshot, prepareExecution, type ExecutionSnapshot } from './execution'
import { projectRedactor } from './redaction'

export interface FlowExecutionSnapshot {
  progress: FlowExecutionProgress
  projectId: string
  flow: Flow
  fingerprint: string
  requests: Map<string, ExecutionSnapshot>
  variables: ExecutionVariables
  permissions: AgentExecutionPermissions
  effects: string[]
  checkScope(): void
}
export function prepareFlowExecution(projectId: string, flow: Flow, environmentId?: string, permissions: AgentExecutionPermissions = {}): FlowExecutionSnapshot {
  validateFlowPatch({ events: flow.events })
  if (permissions.saveResponse) throw new Error('Flow 执行不支持隐式保存节点响应；请单独批准接口响应保存步骤')
  const signature = flowSignature(flow)
  const checkScope = (): void => {
    if (!store.getFlow(projectId, flow.flow_id) || signature !== flowSignature(getFlowDraft(projectId, flow.flow_id).flow)) throw new Error('Flow 范围已改变或删除，请重新确认计划')
    if (listFlowCandidates(projectId, flow.flow_id).some(c => c.status === 'conflict')) throw new Error('Flow 存在未解决冲突，请重新确认')
    if (environmentId && !store.listEnvironments(projectId).some(e => e.env_id === environmentId)) throw new Error('获批环境已删除')
  }
  checkScope()
  const environment = environmentId ? store.listEnvironments(projectId).find(e => e.env_id === environmentId) ?? null : null
  const requests = new Map<string, ExecutionSnapshot>(), effects: string[] = []
  let variables = createExecutionVariables(environment, store.getGlobalVars(projectId))
  const visit = (events: FlowEvent[], multiplier = 1): void => {
    for (const event of events) {
      if (!event.enabled) continue

      if (event.type === 'api' || event.type === 'request') {
        const inline = event.type === 'request' ? inlineTarget(projectId, event) : null
        const currentTarget = event.type === 'api' ? () => {
          if (!store.getTarget(projectId, event.target_id!)) throw new Error('Flow 引用接口已删除')
          return getDraft(projectId, event.target_id!).target
        } : () => inline!
        const target = currentTarget()
        if (target.target_type !== 'api') throw new Error('Flow 节点必须引用 HTTP 接口')
        const snapshot = prepareExecution(projectId, applyRequestInput(target, event.input), environmentId, { ...permissions, writeVariables: false }, undefined, { currentTarget, checkScope, variableQuery: true })
        if (!requests.size) variables = snapshot.variables
        snapshot.variables = variables; snapshot.context.variables = variables.values
        requests.set(event.event_id, snapshot)
        effects.push(`节点 ${event.name} (${event.event_id})，最多 ${multiplier} 次：${snapshot.method} ${snapshot.url}`, ...snapshot.effects.map(effect => `${event.name} 每次节点运行：${effect}`))
        effects.push(...snapshot.requests.map(r => `${event.name}：额外请求 ${r.method} ${r.url}，所有循环累计最多 ${multiplier * r.maxCalls} 次`))
      } else effects.push(`节点 ${event.name}：${event.type}`)
      if (event.type === 'script') effects.push(`${event.name}：独立脚本 SHA256 ${createHash('sha256').update(event.script ?? '').digest('hex')}；仅变量、响应、断言；无网络/文件/shell能力`)
      if (event.type === 'if') effects.push(`${event.name}：条件 SHA256 ${createHash('sha256').update(event.condition ?? '').digest('hex')}；读取本轮变量`)
      if (event.type === 'loop') {
        const count = event.loop_count ?? 1
        if (!Number.isInteger(count) || count < 1 || count > 50 || multiplier * count > 1000) throw new Error('Flow 循环须为1至50的整数，嵌套展开最多1000轮')
        effects.push(`${event.name}：循环 ${count} 轮（嵌套最多 ${multiplier * count} 轮）；失败立即停止`)
        visit(event.children ?? [], multiplier * count)
      } else if (['begin', 'if'].includes(event.type)) visit(event.children ?? [], multiplier)
    }
  }
  visit(flow.events)
  effects.push('节点顺序执行；失败、暂停或未知后停止后续依赖与循环；保留已成功结果，不自动重发，不回滚远端副作用', permissions.writeVariables ? 'Flow 全部成功后允许变量差量写回，冲突暂停' : 'Flow 变量只在本轮内存演进，不写回')
  return { progress: { secrets: new Set(), results: new Map(), conditions: new Map(), lastResponse: null }, projectId, flow: structuredClone(flow), fingerprint: createHash('sha256').update(signature).digest('hex'), requests, variables, permissions: structuredClone(permissions), effects, checkScope }
}
export async function executeFlowSnapshot(snapshot: FlowExecutionSnapshot, signal: AbortSignal): Promise<{ status: 'succeeded' | 'failed' | 'unknown' | 'cancelled' | 'paused'; report: unknown; error?: string; retryable: boolean }> {
  const { projectId, variables } = snapshot
  const run = await runFlow(projectId, snapshot.flow, variables.environment?.env_id, {
    progress: snapshot.progress, variables: variables.values, environment: variables.environment, globals: variables.globals, signal, checkScope: snapshot.checkScope,
    executeRequest: async event => { const result = await executeSnapshot(snapshot.requests.get(event.event_id)!, signal); return { ...result, report: result.report as SendRecord } }
  })
  const flatten = (events: FlowEventResult[]): FlowEventResult[] => events.flatMap(event => [event, ...flatten(event.children ?? [])])
  const events = flatten(run.events)
  let status: 'succeeded' | 'failed' | 'unknown' | 'cancelled' | 'paused' = events.some(e => e.status === 'unknown') ? 'unknown' : events.some(e => e.status === 'cancelled') ? 'cancelled' : events.some(e => e.status === 'paused' && e.error) ? 'paused' : run.status === 'passed' ? 'succeeded' : 'failed'
  let error = events.find(e => e.status === status)?.error ?? (status === 'failed' ? 'Flow 节点或断言失败，已停止后续依赖' : undefined)
  if (status === 'succeeded') {
    try { snapshot.checkScope(); if (signal.aborted) { status = 'cancelled'; error = '执行已取消' } else if (snapshot.permissions.writeVariables) persistExecutionVariables(projectId, variables) }
    catch (e) { status = 'paused'; error = (e as Error).message }
  }
  const redact = projectRedactor(projectId, [...snapshot.progress.secrets, ...Object.values(variables.values.environment), ...Object.values(variables.values.globals), ...Object.values(variables.values.local ?? {})].map(String), [snapshot.flow, ...[...snapshot.requests.values()].map(r => r.context), run])
  // flowSignature is stable JSON (possibly sensitive), so expose only its digest.
  const retryable = status !== 'succeeded' && status !== 'unknown' && events.some(e => e.retryable) && !events.some(e => (e.status === 'failed' && !e.children?.length && !e.retryable) || (e.status === 'paused' && e.request && !e.retryable))
  return { status, retryable, error: error ? redact(error) : undefined, report: redact({ ...run, variables: variables.values.environment, outcome: status, error, snapshot_sha256: snapshot.fingerprint }) }
}
