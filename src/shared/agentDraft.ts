import type { Target } from './types'
export interface AgentDraft {
  project_id: string
  target_id: string
  target: Target
  base_revision: string | null
  agent_owned: boolean
  updated_at: string
}
export interface AgentCandidate {
  candidate_id: string
  number: string
  project_id: string
  target_id: string
  plan_id: string
  step_id: string
  base_revision: string | null
  base: Target
  proposal: Target
  created_at: string
  status: 'pending' | 'applied' | 'conflict' | 'rejected' | 'undone'
  error?: string
  merge?: AgentCandidateMerge
  application?: { before: Target; after: Target; undone?: boolean }
}
export interface AgentDraftEvent {
  project_id: string
  target_id: string
  draft?: AgentDraft
  previous?: Target
}
export type AgentConflictChoice = 'base' | 'current' | 'agent'
export interface AgentFieldConflict {
  id: string
  path: string
  base?: unknown
  current?: unknown
  agent?: unknown
  base_present: boolean
  current_present: boolean
  agent_present: boolean
  reason: 'value' | 'order'
}
export interface AgentCandidateMerge {
  operation?: 'apply' | 'restore' | 'undo'
  base?: Target
  proposal?: Target
  review_id: string
  current: Target
  result: Target
  draft_signature: string
  saved_revision: string | null
  conflicts: AgentFieldConflict[]
  choices: Record<string, AgentConflictChoice>
}
