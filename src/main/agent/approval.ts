import { createHash, randomUUID } from 'node:crypto'
import type { AgentPermissionMode } from '@shared/agentPlan'
import type { AgentToolRisk } from '@shared/agent'

export interface ApprovalRequestInput {
  activity_id: string
  call_id: string
  tool: string
  risk: AgentToolRisk
  args: Record<string, unknown>
}
export interface ApprovalDecision {
  decision: 'approved' | 'denied'
  reason?: string
}
export interface ApprovalGate {
  requires(risk: AgentToolRisk): boolean
  request(input: ApprovalRequestInput): Promise<ApprovalDecision>
  respond(projectId: string, conversationId: string, activityId: string, decision: ApprovalDecision['decision']): boolean
  dispose(): void
}
export interface ApprovalGateOptions {
  projectId: string
  conversationId: string
  turnId: string
  mode: AgentPermissionMode
  signal?: AbortSignal
  /** Re-checked when the user responds; a deleted project cannot be approved. */
  projectExists?: () => boolean
}

interface PendingApproval {
  nonce: string
  projectId: string
  conversationId: string
  turnId: string
  activityId: string
  tool: string
  risk: AgentToolRisk
  args: Record<string, unknown>
  argsHash: string
  createdAt: string
  resolve(decision: ApprovalDecision): void
}

/**
 * Approved permission matrix. Read tools never pause; local drafts pause only in
 * ask mode. Network and irreversible tools will keep pausing in auto mode when
 * those stages register them.
 */
export function requiresApproval(mode: AgentPermissionMode, risk: AgentToolRisk): boolean {
  if (risk === 'read') return false
  if (mode === 'bypass') return false
  if (mode === 'auto') return risk === 'network-write' || risk === 'irreversible'
  return true
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function hashArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(args)).digest('hex')
}

/**
 * In-memory approval boundary for one running turn. The pending entry owns a
 * one-time nonce and argument hash; a duplicate or cross-conversation response
 * can never resolve it. Tool handlers still re-check their own project/object
 * revision after approval.
 */
export function createApprovalGate(options: ApprovalGateOptions): ApprovalGate {
  const pending = new Map<string, PendingApproval>()
  let disposed = false

  const settleAll = (decision: ApprovalDecision): void => {
    for (const entry of pending.values()) entry.resolve(decision)
    pending.clear()
  }
  const onAbort = (): void => settleAll({ decision: 'denied', reason: '本轮已取消，未执行的工具不会自动重放。' })
  if (options.signal) {
    if (options.signal.aborted) settleAll({ decision: 'denied', reason: '本轮已取消。' })
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }

  return {
    requires(risk) {
      return requiresApproval(options.mode, risk)
    },
    request(input) {
      if (disposed || options.signal?.aborted) return Promise.resolve({ decision: 'denied', reason: '本轮已结束，工具未执行。' })
      if (!pending.has(input.activity_id)) {
        let resolve!: (decision: ApprovalDecision) => void
        const promise = new Promise<ApprovalDecision>(done => { resolve = done })
        pending.set(input.activity_id, {
          nonce: randomUUID(),
          projectId: options.projectId,
          conversationId: options.conversationId,
          turnId: options.turnId,
          activityId: input.activity_id,
          tool: input.tool,
          risk: input.risk,
          args: structuredClone(input.args),
          argsHash: hashArgs(input.args),
          createdAt: new Date().toISOString(),
          resolve
        })
        return promise
      }
      return Promise.resolve({ decision: 'denied', reason: '同一活动不能重复申请审批。' })
    },
    respond(projectId, conversationId, activityId, decision) {
      if (decision !== 'approved' && decision !== 'denied') throw new Error('审批决定无效')
      const entry = pending.get(activityId)
      if (!entry) throw new Error('审批已失效或已处理，请勿重复操作')
      if (entry.projectId !== projectId || entry.conversationId !== conversationId) throw new Error('审批不属于当前项目或会话')
      if (entry.turnId !== options.turnId || entry.activityId !== activityId) throw new Error('审批已失效')
      if (!entry.nonce || hashArgs(entry.args) !== entry.argsHash) throw new Error('审批参数已变化，请重新发起')
      if (options.projectExists && !options.projectExists()) throw new Error('项目已删除，审批已取消')
      // One-time nonce: remove before resolving so a second response cannot win.
      pending.delete(activityId)
      entry.resolve({ decision, ...(decision === 'denied' ? { reason: '用户拒绝此工具调用；不会执行。' } : {}) })
      return true
    },
    dispose() {
      disposed = true
      options.signal?.removeEventListener('abort', onAbort)
      settleAll({ decision: 'denied', reason: '本轮已结束，工具未执行。' })
    }
  }
}
