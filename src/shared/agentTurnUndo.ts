import type { Target, Flow } from './types'
import type { AgentFieldConflict, AgentConflictChoice } from './agentDraft'
export interface TurnUndoEntry {
  key: string
  kind: 'api' | 'flow'
  entity_id: string
  name: string
  candidate_ids: string[]
  current: Target | Flow
  result: Target | Flow
  conflicts: AgentFieldConflict[]
  choices: Record<string, AgentConflictChoice>
  signature: string
  revision: string | null
  deletion_id?: string
  new_object?: boolean
  source_signature: string
  status: 'ready' | 'conflict' | 'blocked' | 'completed'
  error?: string
}
export interface AgentTurnUndo {
  undo_id: string
  review_id: string
  project_id: string
  plan_id: string
  created_at: string
  updated_at: string
  status: 'review' | 'partial' | 'completed' | 'cancelled'
  pending_candidate_ids: string[]
  entries: TurnUndoEntry[]
}
export interface AgentTurnSummary { plan_id: string; name: string; applied_count: number }
