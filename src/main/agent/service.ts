import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentConversation, AgentEvent, AgentConnectionTest } from '@shared/agent'
import { getProject } from '../storage/store'
import { agentRoot, getConnection, saveConnection, createConnection, listConnections, deleteConnection, getProjectConnection, setProjectConnection, connectionSnapshot, recordCapability, readLocal, writeLocal } from './store'
import { completeModel, redactKey, redactStreamingKey } from './model'

const active = new Map<string, AbortController>()
const listeners = new Set<(event: AgentEvent) => void>()
export function onAgentEvent(listener: (event: AgentEvent) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function emit(conversation: AgentConversation): void {
  const event: AgentEvent = { project_id: conversation.project_id, conversation_id: conversation.conversation_id, conversation: structuredClone(conversation) }
  for (const listener of listeners) listener(event)
}
function projectDir(projectId: string): string {
  if (!/^[\w-]+$/.test(projectId) || !getProject(projectId)) throw new Error('项目不存在')
  return path.join(agentRoot(), 'projects', projectId, 'conversations')
}
function conversationFile(projectId: string, id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error('会话不存在')
  return path.join(projectDir(projectId), `${id}.json`)
}
function persist(conversation: AgentConversation): void {
  conversation.updated_at = new Date().toISOString()
  writeLocal(conversationFile(conversation.project_id, conversation.conversation_id), conversation)
  emit(conversation)
}
function getConversation(projectId: string, id: string): AgentConversation {
  const conversation = readLocal<AgentConversation | null>(conversationFile(projectId, id), null)
  if (!conversation || conversation.project_id !== projectId) throw new Error('会话不存在')
  if (conversation.status === 'running' && !active.has(id)) {
    conversation.status = 'interrupted'
    for (const message of conversation.messages) if (message.status === 'streaming') message.status = 'interrupted'
    persist(conversation)
  }
  return conversation
}
function listConversations(projectId: string): AgentConversation[] {
  const dir = projectDir(projectId)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(file => file.endsWith('.json')).map(file => getConversation(projectId, file.slice(0, -5))).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}
function createConversation(projectId: string): AgentConversation {
  projectDir(projectId)
  const now = new Date().toISOString()
  const conversation: AgentConversation = { conversation_id: randomUUID(), project_id: projectId, title: '新会话', created_at: now, updated_at: now, status: 'idle', messages: [] }
  persist(conversation)
  return conversation
}
function deleteConversation(projectId: string, id: string): boolean {
  getConversation(projectId, id)
  if (active.has(id)) throw new Error('请先停止正在进行的对话')
  fs.unlinkSync(conversationFile(projectId, id))
  for (const listener of listeners) listener({ project_id: projectId, conversation_id: id, conversation: null })
  return true
}
async function testConnection(connectionId?: string): Promise<AgentConnectionTest> {
  const snapshot = await connectionSnapshot(connectionId)
  await completeModel(snapshot, [{ role: 'user', content: 'Reply briefly with OK.' }])
  let capability: AgentConnectionTest['capability'] = 'text-only'
  try {
    const probe = await completeModel(snapshot, [{ role: 'user', content: 'Call kindra_capability_probe with token kindra-probe.' }], { probeTools: true })
    if (probe.toolCalls.some(call => call.name === 'kindra_capability_probe' && JSON.parse(call.arguments)?.token === 'kindra-probe')) capability = 'tools'
  } catch { /* A text-capable endpoint may reject tools; it remains usable for chat. */ }
  recordCapability(snapshot, capability)
  return { capability, message: capability === 'tools' ? '连接成功，支持文本和工具调用' : '连接成功，仅文本对话；连续工具操作不可用' }
}
async function sendMessage(projectId: string, id: string, content: string, connectionId?: string): Promise<AgentConversation> {
  if (typeof content !== 'string' || !content.trim() || content.length > 100_000) throw new Error('消息不能为空且不能超过 100000 字符')
  const conversation = getConversation(projectId, id)
  if (active.has(id)) throw new Error('当前会话仍在回复中')
  const controller = new AbortController()
  active.set(id, controller)
  try {
    const snapshot = await connectionSnapshot(connectionId, projectId)
    const { api_key: _secret, ...publicSnapshot } = snapshot
    conversation.connection = publicSnapshot
    const now = new Date().toISOString()
    const userText = redactKey(content.trim(), snapshot.api_key)
    if (!conversation.messages.length) conversation.title = userText.slice(0, 40)
    conversation.messages.push({ message_id: randomUUID(), role: 'user', content: userText, status: 'complete', created_at: now })
    const modelMessages = conversation.messages.filter(message => message.status === 'complete').map(({ role, content }) => ({ role, content }))
    const reply = { message_id: randomUUID(), role: 'assistant' as const, content: '', status: 'streaming' as const, created_at: now }
    conversation.messages.push(reply)
    conversation.status = 'running'; delete conversation.error
    persist(conversation)
    void (async () => {
      try {
        await completeModel(snapshot, [{ role: 'system', content: '你是 Kindra 项目内的助手。当前只提供文本对话，不具备读取项目、修改或执行接口的工具。不要声称已经执行操作。' }, ...modelMessages], {
          signal: controller.signal,
          onText: text => {
            conversation.messages[conversation.messages.length - 1].content = redactStreamingKey(text, snapshot.api_key)
            emit(conversation)
          }
        }).then(result => { conversation.messages[conversation.messages.length - 1].content = redactKey(result.text, snapshot.api_key) })
        conversation.status = 'idle'
        conversation.messages[conversation.messages.length - 1].status = 'complete'
      } catch (error) {
        conversation.status = controller.signal.aborted ? 'interrupted' : 'error'
        conversation.messages[conversation.messages.length - 1].status = controller.signal.aborted ? 'interrupted' : 'error'
        conversation.error = redactKey(error instanceof Error ? error.message : '模型请求失败', snapshot.api_key)
      } finally { active.delete(id); persist(conversation) }
    })()
    return conversation
  } catch (error) { active.delete(id); throw error }
}
function cancelMessage(projectId: string, id: string): boolean {
  getConversation(projectId, id)
  active.get(id)?.abort()
  return true
}
export function shutdownAgent(): void { for (const controller of active.values()) controller.abort() }
/** The application commands called by IPC and integration tests. */
export const agentCommands = { getConnection, saveConnection, createConnection, listConnections, deleteConnection, getProjectConnection, setProjectConnection, testConnection, createConversation, listConversations, getConversation, deleteConversation, sendMessage, cancelMessage }
