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
  status: 'pending' | 'applied' | 'conflict' | 'rejected'
  error?: string
}
export interface AgentDraftEvent {
  project_id: string
  target_id: string
  draft?: AgentDraft
  previous?: Target
}
