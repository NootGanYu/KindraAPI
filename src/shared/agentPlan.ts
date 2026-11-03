import type { Target } from './types'

export interface ReadPlanInput {
  goal: string
  connectionId?: string
  targetId: string
  targetIds?: string[]
  drafts?: Record<string, Target>
  /** Saved revisions from the editor sessions that produced these drafts. */
  draftRevisions?: Record<string, string | null>
  environmentId?: string
  /** An unsaved editor snapshot, never a request to persist the definition. */
  draft?: Target
}
export interface AgentPlanStep {
  step_id: string
  operation: 'read_api' | 'propose_api_change' | 'execute_api'
  execution?: { method: string; url: string; effects: string[] }
  changes?: unknown
  target_name?: string
  source?: 'draft' | 'saved'
  dependencies_explicit?: boolean
  error?: string
  target_id: string
  depends_on: string[]
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'paused' | 'unknown' | 'cancelled'
  result?: unknown
}
export interface AgentPlan {
  plan_id: string
  project_id: string
  project_name: string
  target_id: string
  target_name: string
  target_ids?: string[]
  targets?: Array<{ target_id: string; name: string; source: 'draft' | 'saved' }>
  environment_id: string | null
  environment_name: string
  goal: string
  connection_id: string
  model: string
  source: 'draft' | 'saved'
  status: 'generating' | 'pending' | 'running' | 'completed' | 'rejected' | 'paused' | 'interrupted'
  explanation?: string
  error?: string
  steps: AgentPlanStep[]
  created_at: string
}
export interface AgentPlanEvent { project_id: string; plan_id: string; plan: AgentPlan | null }
