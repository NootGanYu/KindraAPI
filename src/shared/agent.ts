/** Public Agent application-command contracts. Secrets are never part of read models. */
export type AgentProtocol = 'chat-completions' | 'responses'
export type AgentCapability = 'unchecked' | 'text-only' | 'tools'
export interface AgentConnection {
  connection_id: string
  revision: string
  name: string
  base_url: string
  model: string
  protocol: AgentProtocol
  has_key: boolean
  capability: AgentCapability
}
export interface AgentConnectionInput {
  name: string
  base_url: string
  model: string
  protocol: AgentProtocol
  /** Omitted preserves the current key; empty explicitly removes it. */
  api_key?: string
}
export interface AgentMessage {
  message_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  status: 'complete' | 'streaming' | 'interrupted' | 'error'
  /** Groups the user message, activity cards and final answer of one turn. */
  turn_id?: string
}
export type AgentToolRisk = 'read' | 'local-write' | 'network-write' | 'irreversible'
export type AgentActivityStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'
/** A redacted, UI-oriented record of one executed tool call. Full results stay local. */
export interface AgentActivity {
  activity_id: string
  turn_id: string
  call_id: string
  tool: string
  risk: AgentToolRisk
  status: AgentActivityStatus
  /** Short redacted human summary shown on the card. */
  summary: string
  /** Redacted result excerpt for the timeline; omitted for empty results. */
  display?: string
  /** Tool-specific continuation cursor when the result was paged or truncated. */
  cursor?: string
  created_at: string
  finished_at?: string
  error?: string
}
/** Chat Completions / Responses compatible ledger entry persisted locally. */
export interface AgentLedgerMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}
export interface AgentConversation {
  conversation_id: string
  project_id: string
  title: string
  created_at: string
  updated_at: string
  status: 'idle' | 'running' | 'interrupted' | 'error'
  messages: AgentMessage[]
  /** Redacted tool timeline for the conversation. */
  activities?: AgentActivity[]
  /** Redacted multi-turn tool ledger; used for follow-up turns, never replayed on restart. */
  ledger?: AgentLedgerMessage[]
  /** Configuration used by the last turn; never contains the credential. */
  connection?: AgentConnection
  error?: string
}
export interface AgentEvent {
  records_deleted?: boolean
  project_id: string
  conversation_id: string
  conversation: AgentConversation | null
}
export interface AgentConnectionTest {
  capability: Exclude<AgentCapability, 'unchecked'>
  message: string
}
