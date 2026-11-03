import { isActiveFlowRunStatus } from '@shared/flow'
import { projectPermissionError } from '../mcp/permissions'
import type { FlowRun } from '@shared/types'
import { createId } from '@shared/factories'
import * as store from '../storage/store'
import { runFlow } from './engine'
import { redactEvidence } from './evidence'
import type { FlowRefreshController } from './refresh'
import type { FlowRefreshPreview } from '@shared/types'

interface ActiveRun {
  run: FlowRun
  completion?: Promise<FlowRun>
  refresh?: FlowRefreshController
  abortController: AbortController
  resume?: () => void
  stateListeners: Set<(run: FlowRun) => void>
}
const activeRuns = new Map<string, ActiveRun>()
const keyOf = (projectId: string, flowId: string): string => JSON.stringify([projectId, flowId])
const copy = (run: FlowRun): FlowRun => JSON.parse(JSON.stringify(redactEvidence(run))) as FlowRun

/** Allocates identity and the flow lock before any request can be dispatched. */
export function startFlowRun(
  projectId: string,
  flowId: string,
  environmentId: string | undefined,
  requestId: string,
  source: 'ui' | 'mcp' = 'ui'
): FlowRun {
  if (source === 'mcp') {
    const denied = projectPermissionError(store.getMcpConfig(), projectId, { execute: true })
    if (denied) throw new Error(denied)
  }
  recoverFlowRuns(projectId)
  if (!requestId.trim()) throw new Error('request_id 不能为空')
  const previous = store.readFlowRuns(projectId).find(run => run.request_id === requestId)
  if (previous) {
    if (previous.flow_id !== flowId || previous.request_environment_id !== (environmentId ?? '')) {
      throw new Error('request_id 已用于不同的运行输入')
    }
    return getFlowRun(projectId, previous.run_id)!
  }
  const flow = store.getFlow(projectId, flowId)
  if (!flow) throw new Error('流程不存在')
  const key = keyOf(projectId, flowId)
  if (activeRuns.has(key)) throw new Error('此流程已有活动运行，请先查看当前 Run')
  const environments = store.listEnvironments(projectId)
  const preferred = environmentId || flow.env_id || store.getSettings().environment_id
  const env = environments.find(item => item.env_id === preferred) ?? environments[0]
  const run: FlowRun = {
    run_id: createId('run'), project_id: projectId, flow_id: flowId, flow_name: flow.name,
    env_id: env?.env_id ?? '', started_at: Date.now(), finished_at: 0, elapsed_ms: 0,
    status: 'running', events: [], variables: {}, console: [], request_id: requestId,
    request_environment_id: environmentId ?? '', source
  }
  store.saveFlowRun(projectId, run)
  const active: ActiveRun = { run, abortController: new AbortController(), stateListeners: new Set() }
  activeRuns.set(key, active)
  active.completion = runFlow(projectId, flow, environmentId, {
    runId: run.run_id, startedAt: run.started_at, signal: active.abortController.signal,
    onBeforeStep: async () => {
      const denied = runPermissionError(active)
      if (!denied || active.abortController.signal.aborted) return
      await new Promise<void>(resolve => {
        active.resume = resolve
        active.run.error = `MCP 运行权限已撤销：${denied}；后续步骤已停止，请恢复权限后手动继续或取消`
        updateState(active, 'permission_revoked')
      })
    },
    onControl: controller => { active.refresh = controller },
    onReviewRequired: async message => {
      if (active.abortController.signal.aborted) return
      await new Promise<void>(resolve => {
        active.resume = resolve
        active.run.error = message
        updateState(active, 'paused')
      })
    },
    onStepBoundary: async () => {
      if (active.run.status !== 'pausing') return
      await new Promise<void>(resolve => {
        active.resume = resolve
        updateState(active, 'paused')
      })
    },
    onProgress: partial => {
      active.run = { ...active.run, ...copy(partial), status: active.run.status }
      store.saveFlowRun(projectId, active.run)
    },
    onSnapshot: snapshot => {
      run.snapshot = snapshot
      store.saveFlowRun(projectId, run)
    }
  })
    .then(result => {
      active.run = { ...active.run, ...result }
      store.saveFlowRun(projectId, active.run)
      return active.run
    }, error => {
      const finishedAt = Date.now()
      active.run = { ...active.run, status: active.run.request_in_flight ? 'unknown' : 'failed', error: (error as Error).message, finished_at: finishedAt, elapsed_ms: finishedAt - run.started_at }
      store.saveFlowRun(projectId, active.run)
      return active.run
    })
    .finally(() => activeRuns.delete(key))
  // The caller receives a detached record, never the live execution state.
  return copy(run)
}

export function getFlowRun(projectId: string, runId: string): FlowRun | null {
  for (const active of activeRuns.values()) {
    if (active.run.project_id === projectId && active.run.run_id === runId) return copy(active.run)
  }
  recoverFlowRuns(projectId)
  return store.getFlowRun(projectId, runId)
}

function runPermissionError(active: ActiveRun): string | null {
  return active.run.source === 'mcp'
    ? projectPermissionError(store.getMcpConfig(), active.run.project_id, { execute: true })
    : null
}

function updateState(active: ActiveRun, status: FlowRun['status']): void {
  active.run.status = status
  active.run.elapsed_ms = Date.now() - active.run.started_at
  store.saveFlowRun(active.run.project_id, active.run)
  for (const listener of active.stateListeners) listener(active.run)
}

function findActive(projectId: string, runId: string): ActiveRun | undefined {
  return [...activeRuns.values()].find(active => active.run.project_id === projectId && active.run.run_id === runId)
}

export function pauseFlowRun(projectId: string, runId: string): FlowRun {
  const active = findActive(projectId, runId)
  if (!active) {
    const run = getFlowRun(projectId, runId)
    if (!run) throw new Error('运行记录不存在')
    return run
  }
  if (active.run.status === 'running') updateState(active, 'pausing')
  return copy(active.run)
}

/** Stops local advancement; already dispatched remote effects cannot be rolled back. */
export async function cancelFlowRun(projectId: string, runId: string): Promise<FlowRun> {
  const active = findActive(projectId, runId)
  if (!active) {
    const run = getFlowRun(projectId, runId)
    if (!run) throw new Error('运行记录不存在')
    return run
  }
  if (!active.abortController.signal.aborted) {
    updateState(active, 'cancelling')
    active.abortController.abort()
    const resume = active.resume
    active.resume = undefined
    resume?.()
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([active.completion, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000) })])
    return copy(active.run)
  } finally { if (timer) clearTimeout(timer) }
}

/** Called only by the user-facing IPC surface; no MCP tool exposes this action. */
export function resumeFlowRun(projectId: string, runId: string): FlowRun {
  const active = findActive(projectId, runId)
  if (!active) {
    const run = getFlowRun(projectId, runId)
    if (!run) throw new Error('运行记录不存在')
    return run
  }
  if (active.run.status === 'pausing') throw new Error('当前完整步骤尚未结束，请等待暂停后继续')
  const denied = runPermissionError(active)
  if (denied) throw new Error(`MCP 运行权限不足：${denied}`)
  if (active.run.status === 'paused' || active.run.status === 'permission_revoked') {
    // Restored access re-enters the paused review flow if definitions need attention.
    if (active.run.status === 'permission_revoked') updateState(active, 'paused')
    active.refresh?.validateResume()
    active.run.error = undefined
    const resume = active.resume
    active.resume = undefined
    updateState(active, 'running')
    resume?.()
  }
  return copy(active.run)
}

function refreshableRun(projectId: string, runId: string): ActiveRun {
  const active = findActive(projectId, runId)
  if (!active || active.run.status !== 'paused' || !active.refresh) throw new Error('仅可审阅已暂停的活动 Run')
  return active
}
export function previewFlowRunRefresh(projectId: string, runId: string): FlowRefreshPreview {
  const active = refreshableRun(projectId, runId)
  const preview = active.refresh!.preview()
  active.run.refresh_preview = preview
  store.saveFlowRun(projectId, active.run)
  return preview
}
/** User-only review operation; choices affect this Run, never the stored Flow. */
export function resolveFlowRunConflict(projectId: string, runId: string, previewId: string, eventId: string, field: string, choice: 'api' | 'override'): FlowRefreshPreview {
  const active = refreshableRun(projectId, runId)
  const preview = active.refresh!.resolveConflict(previewId, eventId, field, choice)
  active.run.refresh_preview = preview
  store.saveFlowRun(projectId, active.run)
  return preview
}
export function approveFlowRunScope(projectId: string, runId: string, previewId: string): FlowRun {
  const active = refreshableRun(projectId, runId)
  active.run.refresh_preview = active.refresh!.approveScope(previewId)
  store.saveFlowRun(projectId, active.run)
  return copy(active.run)
}
export function applyFlowRunRefresh(projectId: string, runId: string, previewId: string): FlowRun {
  const active = refreshableRun(projectId, runId)
  if (!active.run.version_switches?.some(item => item.preview_id === previewId)) {
    const change = active.refresh!.apply(previewId)
    active.run.version_switches = [...(active.run.version_switches ?? []), change]
    store.saveFlowRun(projectId, active.run)
  }
  return copy(active.run)
}

/** The compatibility wait is bounded independently of the lifetime of the Run. */
export async function waitForFlowRun(projectId: string, runId: string, timeoutMs = 20_000): Promise<FlowRun> {
  const run = getFlowRun(projectId, runId)
  if (!run) throw new Error('运行记录不存在')
  const active = activeRuns.get(keyOf(projectId, run.flow_id))
  if (!active || active.run.run_id !== runId || !active.completion || run.status !== 'running') return run
  let onState: ((run: FlowRun) => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return copy(await Promise.race([
      active.completion,
      new Promise<FlowRun>(resolve => {
        onState = changed => { if (changed.status !== 'running') resolve(changed) }
        active.stateListeners.add(onState)
      }),
      new Promise<FlowRun>(resolve => { timer = setTimeout(() => resolve(active.run), timeoutMs) })
    ]))
  } finally {
    if (timer) clearTimeout(timer)
    if (onState) active.stateListeners.delete(onState)
  }
}

/** UI and MCP share this saved-flow entry, while retaining their own authorization. */
export async function runSavedFlow(projectId: string, flowId: string, environmentId?: string): Promise<FlowRun> {
  const run = startFlowRun(projectId, flowId, environmentId, createId('request'))
  const active = activeRuns.get(keyOf(projectId, flowId))
  return copy(await (active?.completion ?? Promise.resolve(run)))
}

/** Recovery only records loss of the execution stack. It never recreates an executor. */
export function recoverFlowRuns(projectId: string): void {
  for (const run of store.readFlowRuns(projectId)) {
    if (!isActiveFlowRunStatus(run.status)) continue
    if (activeRuns.get(keyOf(projectId, run.flow_id))?.run.run_id === run.run_id) continue
    const now = Date.now()
    store.saveFlowRun(projectId, { ...run,
      status: run.request_in_flight || run.remote_outcome === 'unknown' ? 'unknown' : 'interrupted',
      remote_outcome: run.request_in_flight ? 'unknown' : run.remote_outcome,
      finished_at: now, elapsed_ms: now - run.started_at,
      error: run.request_in_flight ? '运行已中断；在途请求的远端结果未知，不会自动重试' : '运行已中断，不会自动续跑'
    })
  }
}

export function recoverAllFlowRuns(): void {
  for (const project of store.listProjects()) recoverFlowRuns(project.project_id)
}

export function listFlowRuns(projectId: string, limit?: number) {
  recoverFlowRuns(projectId)
  return store.listFlowRuns(projectId, limit)
}

export function getActiveFlowRuns(): FlowRun[] {
  return [...activeRuns.values()].filter(active => isActiveFlowRunStatus(active.run.status)).map(active => copy(active.run))
}
