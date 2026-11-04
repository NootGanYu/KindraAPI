import type { Target, Flow, TargetVersion } from './types'
import type { FlowVersion } from './flowSync'
import type { AgentDraft } from './agentDraft'
import type { AgentFlowDraft } from './agentFlowDraft'
export type DeletedObject = {
  deletion_id: string
  sequence: number
  project_id: string
  entity_id: string
  deleted_at: string
  revision: string
} & ({ kind: 'api'; snapshot: Target; draft?: AgentDraft; versions: TargetVersion[] } | { kind: 'flow'; snapshot: Flow; draft?: AgentFlowDraft; versions: FlowVersion[] })
