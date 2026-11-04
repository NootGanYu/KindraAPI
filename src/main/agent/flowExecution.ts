import { createHash } from 'node:crypto'
import type { Flow, FlowEvent, FlowEventResult } from '@shared/types'
import type { AgentExecutionPermissions } from '@shared/agentPlan'
import { flowSignature } from '@shared/flowSync'
import * as store from '../storage/store'
import { applyRequestInput, inlineTarget, runFlow } from '../flow/engine'
import { createExecutionVariables, persistExecutionVariables, type ExecutionVariables } from '../request/variables'
import { getDraft } from './drafts'
import { getFlowDraft, listFlowCandidates, validateFlowPatch } from './flowDrafts'
import { executeSnapshot, prepareExecution, type ExecutionSnapshot } from './execution'
import { projectRedactor } from './redaction'

export interface FlowExecutionSnapshot {
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
  const visit = (events: FlowEvent[]): void => {
    for (const event of events) {
      if (!event.enabled) continue
      if (!['api', 'request', 'assert', 'wait', 'begin'].includes(event.type)) throw new Error(`Flow 节点 ${event.name} 暂不支持 ${event.type}；条件、循环及独立脚本需要安全执行策略`)
      if (event.type === 'api' || event.type === 'request') {
        const inline = event.type === 'request' ? inlineTarget(projectId, event) : null
        const currentTarget = event.type === 'api' ? () => {
          if (!store.getTarget(projectId, event.target_id!)) throw new Error('Flow 引用接口已删除')
          return getDraft(projectId, event.target_id!).target
        } : () => inline!
        const target = currentTarget()
        if (target.target_type !== 'api') throw new Error('Flow 节点必须引用 HTTP 接口')
        const snapshot = prepareExecution(projectId, applyRequestInput(target, event.input), environmentId, { ...permissions, writeVariables: false }, undefined, { currentTarget, checkScope })
        if (!requests.size) variables = snapshot.variables
        snapshot.variables = variables; snapshot.context.variables = variables.values
        requests.set(event.event_id, snapshot)
        effects.push(`节点 ${event.name} (${event.event_id})：${snapshot.method} ${snapshot.url}`, ...snapshot.effects.map(effect => `${event.name}：${effect}`))
      } else effects.push(`节点 ${event.name}：${event.type}`)
      if (event.type === 'begin') visit(event.children ?? [])
    }
  }
  visit(flow.events)
  effects.push('节点按直线顺序执行；失败、暂停或未知后停止后续依赖；不自动重发', permissions.writeVariables ? 'Flow 全部成功后允许变量差量写回，冲突暂停' : 'Flow 变量只在本轮内存演进，不写回')
  return { projectId, flow: structuredClone(flow), fingerprint: createHash('sha256').update(signature).digest('hex'), requests, variables, permissions: structuredClone(permissions), effects, checkScope }
}
export async function executeFlowSnapshot(snapshot: FlowExecutionSnapshot, signal: AbortSignal): Promise<{ status: 'succeeded' | 'failed' | 'unknown' | 'cancelled' | 'paused'; report: unknown; error?: string }> {
  const { projectId, variables } = snapshot
  const run = await runFlow(projectId, snapshot.flow, variables.environment?.env_id, {
    environment: variables.environment, globals: variables.globals, signal, checkScope: snapshot.checkScope,
    executeRequest: event => executeSnapshot(snapshot.requests.get(event.event_id)!, signal)
  })
  const flatten = (events: FlowEventResult[]): FlowEventResult[] => events.flatMap(event => [event, ...flatten(event.children ?? [])])
  const events = flatten(run.events)
  let status: 'succeeded' | 'failed' | 'unknown' | 'cancelled' | 'paused' = events.some(e => e.status === 'unknown') ? 'unknown' : events.some(e => e.status === 'cancelled') ? 'cancelled' : events.some(e => e.status === 'paused') ? 'paused' : run.status === 'passed' ? 'succeeded' : 'failed'
  let error = events.find(e => e.status === status)?.error ?? (status === 'failed' ? 'Flow 节点或断言失败，已停止后续依赖' : undefined)
  if (status === 'succeeded') {
    try { snapshot.checkScope(); if (signal.aborted) { status = 'cancelled'; error = '执行已取消' } else if (snapshot.permissions.writeVariables) persistExecutionVariables(projectId, variables) }
    catch (e) { status = 'paused'; error = (e as Error).message }
  }
  const redact = projectRedactor(projectId, [...Object.values(variables.values.environment), ...Object.values(variables.values.globals)].map(String), [snapshot.flow, ...[...snapshot.requests.values()].map(r => r.context), run])
  // flowSignature is stable JSON (possibly sensitive), so expose only its digest.
  return { status, error: error ? redact(error) : undefined, report: redact({ ...run, variables: variables.values.environment, outcome: status, error, snapshot_sha256: snapshot.fingerprint }) }
}
