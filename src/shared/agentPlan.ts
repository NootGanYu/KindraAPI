import type { Target } from './types'

export interface ReadPlanInput {
  goal: string
  targetId: string
  environmentId?: string
  /** An unsaved editor snapshot, never a request to persist the definition. */
  draft?: Target
}
export interface AgentPlanStep {
  step_id: string
  operation: 'read_api'
  target_id: string
  depends_on: string[]
  status: 'pending' | 'running' | 'succeeded' | 'paused'
  result?: unknown
}
export interface AgentPlan {
  plan_id: string
  project_id: string
  project_name: string
  target_id: string
  target_name: string
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
