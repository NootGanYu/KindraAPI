import type { SendRecord } from '@shared/types'
import type { ExecutionSnapshot } from '../execution'
import type { FlowExecutionSnapshot } from '../flowExecution'

export interface CapturedResponse {
  target_id: string
  run_id: string
  response: NonNullable<SendRecord['response']>
}
export type PreparedExecution =
  | { kind: 'api'; snapshot: ExecutionSnapshot }
  | { kind: 'flow'; snapshot: FlowExecutionSnapshot }

/**
 * Per-turn, main-process-only execution memory. It is deliberately not written
 * to the conversation: unknown outcomes and captured response bodies cannot be
 * replayed or approved from a later user turn.
 */
export interface TurnExecutionState {
  /** Execution keys whose remote outcome is unknown this turn. */
  unknown: Set<string>
  /** Successful 2xx responses captured by an approved execute_api this turn. */
  responses: Map<string, CapturedResponse>
  /** Snapshots prepared for the approval card, reused by the handler after approval. */
  prepared: Map<string, PreparedExecution>
}
export function createTurnExecutionState(): TurnExecutionState {
  return { unknown: new Set(), responses: new Map(), prepared: new Map() }
}
export function executionKey(kind: 'api' | 'case' | 'flow', id: string, environmentId?: string): string {
  return `${kind}:${id}:${environmentId ?? 'default'}`
}
