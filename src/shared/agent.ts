/** Public Agent application-command contracts. Secrets are never part of read models. */
export type AgentProtocol = 'chat-completions' | 'responses'
export type AgentCapability = 'unchecked' | 'text-only' | 'tools'
export interface AgentConnection {
  connection_id: string
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
}
export interface AgentConversation {
  conversation_id: string
  project_id: string
  title: string
  created_at: string
  updated_at: string
  status: 'idle' | 'running' | 'interrupted' | 'error'
  messages: AgentMessage[]
  error?: string
}
export interface AgentEvent {
  project_id: string
  conversation_id: string
  conversation: AgentConversation | null
}
export interface AgentConnectionTest {
  capability: Exclude<AgentCapability, 'unchecked'>
  message: string
}
