export type AgentConfigAuditKind = 'environment' | 'global_vars'
export type AgentConfigAuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'upsert_variable'
  | 'delete_variable'
  | 'upsert_server'
  | 'delete_server'

/** Metadata only. Sensitive before/after payloads stay encrypted in the local audit file. */
export interface AgentConfigAudit {
  audit_id: string
  project_id: string
  turn_id: string
  kind: AgentConfigAuditKind
  action: AgentConfigAuditAction
  entity_id: string
  key?: string
  /** Human-readable masked summary; never contains a variable value. */
  masked: string
  created_at: string
  before_signature: string | null
  after_signature: string | null
  encrypted: true
  undone_at?: string
  undo_status?: 'undone'
}
