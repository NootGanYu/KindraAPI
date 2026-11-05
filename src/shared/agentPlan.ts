import type { Target } from './types'

export interface AgentExecutionPermissions {
  /** Exact additional HTTP methods/URLs, supplied by the user, never by model arguments. */
  requests?: Array<{ method: string; url: string; maxCalls?: number }>
  writeVariables?: boolean
  saveResponse?: boolean
}
export interface ReadPlanInput {
  caseIds?: Record<string, string[]>
  execution?: AgentExecutionPermissions
  goal: string
  connectionId?: string
  targetId: string
  targetIds?: string[]
  flowIds?: string[]
  drafts?: Record<string, Target>
  /** Saved revisions from the editor sessions that produced these drafts. */
  draftRevisions?: Record<string, string | null>
  environmentId?: string
  /** An unsaved editor snapshot, never a request to persist the definition. */
  draft?: Target
}
export type AgentPlanOperation = 'read_api' | 'read_flow' | 'propose_api_change' | 'execute_api' | 'execute_api_case' | 'execute_flow' | 'save_api' | 'save_api_response' | 'save_flow' | 'create_api' | 'propose_flow_change' | 'apply_candidate'
/** Whether an operation was fully specified before approval or is bound after approved reads. */
export type AgentPlanBinding = 'static' | 'deferred'
export interface AgentPlanStep {
  retryable?: boolean
  binding?: AgentPlanBinding
  /** Human-readable intent fixed before approval; actual values may be read-derived. */
  intent?: string
  /** Field selectors the deferred patch may touch, matched against actual merged changes. */
  allowed_changes?: string[]
  /** Approval slots whose successful output supplies this step's input. */
  source_steps?: string[]
  case_id?: string
  case_name?: string
  kind?: 'api' | 'flow'
  flow_id?: string
  step_id: string
  operation: AgentPlanOperation
  execution?: { method: string; url: string; effects: string[] }
  changes?: unknown
  target_name?: string
  source?: 'draft' | 'saved'
  dependencies_explicit?: boolean
  error?: string
  target_id: string
  depends_on: string[]
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'paused' | 'unknown' | 'cancelled' | 'awaiting_approval'
  result?: unknown
}
export type AgentPermissionMode = 'ask' | 'auto' | 'bypass'
export type AgentSelectionSource = 'auto' | 'explicit'
export interface AgentProposedEffects {
  extra_requests?: Array<{ method: string; url: string; maxCalls?: number }>
  write_variables?: boolean
  save_response?: boolean
  save_definitions?: boolean
}
export interface AgentSelectedObject {
  kind: 'api' | 'flow' | 'case'
  id: string
  case_id?: string
}
export interface AgentPlan {
  can_resume?: boolean
  /** Entry preset used for legacy static plans; never a runtime dispatch gate. */
  mode?: string
  /** Continuation plans bind read-derived values after approval. */
  continuation?: boolean
  /** How the objects included in this plan were chosen. */
  selection_source?: AgentSelectionSource
  /** Server-enforced permission mode selected for this turn. */
  permission_mode?: AgentPermissionMode
  /** Side effects proposed by the model and authorized by plan approval. */
  proposed_effects?: AgentProposedEffects
  /** Incremented whenever unapproved scope is requested; stale approvals are rejected. */
  approval_revision?: number
  plan_id: string
  project_id: string
  project_name: string
  target_id: string
  target_name: string
  target_ids?: string[]
  flow_ids?: string[]
  flows?: Array<{ flow_id: string; name: string }>
  targets?: Array<{ target_id: string; name: string; source: 'draft' | 'saved'; new_object?: boolean }>
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

export interface TaskPlanInput {
  goal: string
  connectionId?: string
  /** Explicit selection remains supported; auto selection asks the model to choose from the directory. */
  targetIds?: string[]
  flowIds?: string[]
  selection?: AgentSelectionSource
  permission_mode?: AgentPermissionMode
  allowCreate?: boolean
  /** Currently open object, provided only as an id; never a definition. */
  activeTargetId?: string
  environmentId?: string
  execution?: AgentExecutionPermissions
  drafts?: Record<string, Target>
  draftRevisions?: Record<string, string | null>
  caseIds?: Record<string, string[]>
}
export interface CreateApiPlanInput {
  goal: string
  parentId?: string
  save?: boolean
  connectionId?: string
}
