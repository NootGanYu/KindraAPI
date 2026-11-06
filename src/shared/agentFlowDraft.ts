import type { Flow } from './types'
import type { AgentCandidate, AgentCandidateMerge } from './agentDraft'
export interface AgentFlowDraft {
  project_id: string
  flow_id: string
  flow: Flow
  base_revision: string | null
  /** A Flow that exists only as a local draft; no formal Flow has been written. */
  new_object?: boolean
  agent_owned: boolean
  deleted_object?: string
  candidate_ids?: string[]
  updated_at: string
  /** Computed on read: the draft differs from the saved definition (or is Agent-owned). */
  dirty?: boolean
}
export interface AgentFlowCandidate extends Omit<AgentCandidate, 'patch' | 'target_id' | 'base' | 'proposal' | 'merge' | 'application'> {
  kind: 'flow'
  flow_id: string
  base: Flow
  proposal: Flow
  merge?: Omit<AgentCandidateMerge, 'base' | 'proposal' | 'current' | 'result'> & { base?: Flow; proposal?: Flow; current: Flow; result: Flow }
  application?: { before: Flow; after: Flow; undone?: boolean; order?: number }
}
export interface AgentFlowDraftEvent { records_deleted?: boolean; project_id: string; flow_id: string; draft?: AgentFlowDraft; previous?: Flow; saved_revision?: string }
