import { turnUndoCommands } from './turnUndo'
import { flowDraftCommands, stashAgentFlowDrafts, listAgentFlowDrafts, forgetProjectAgentFlowDrafts, retainManualFlowDrafts } from './flowDrafts'
import { draftCommands, stashAgentDrafts, listAgentDrafts, forgetProjectAgentDrafts } from './drafts'
import { activePlanCount, clearProjectPlanContexts, hasActivePlanOperations, planCommands, shutdownPlans } from './plans'
import { projectRedactor } from './redaction'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentConversation, AgentEvent, AgentConnectionTest } from '@shared/agent'
import { getProject } from '../storage/store'
import { agentRoot, getConnection, saveConnection, createConnection, listConnections, deleteConnection, getProjectConnection, setProjectConnection, connectionSnapshot, recordCapability, readLocal, writeLocal } from './store'
import { completeModel } from './model'

const active = new Map<string, AbortController>()
const tasks = new Set<Promise<void>>()
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
  let finish!: () => void
  let fail!: (error: unknown) => void
  const task = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
  void task.catch(() => {})
  tasks.add(task)
  try {
    const snapshot = await connectionSnapshot(connectionId, projectId)
    const { api_key: _secret, ...publicSnapshot } = snapshot
    conversation.connection = publicSnapshot
    const now = new Date().toISOString()
    const redact = projectRedactor(projectId, [snapshot.api_key])
    const userText = redact(content.trim())
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
            conversation.messages[conversation.messages.length - 1].content = redact.stream(text)
            emit(conversation)
          }
        }).then(result => { conversation.messages[conversation.messages.length - 1].content = redact(result.text) })
        conversation.status = 'idle'
        conversation.messages[conversation.messages.length - 1].status = 'complete'
      } catch (error) {
        conversation.status = controller.signal.aborted ? 'interrupted' : 'error'
        conversation.messages[conversation.messages.length - 1].status = controller.signal.aborted ? 'interrupted' : 'error'
        conversation.error = redact(error instanceof Error ? error.message : '模型请求失败')
      } finally {
        active.delete(id)
        try { persist(conversation); finish() } catch (error) { fail(error) }
        finally { tasks.delete(task) }
      }
    })()
    return conversation
  } catch (error) { active.delete(id); tasks.delete(task); finish(); throw error }
}
function cancelMessage(projectId: string, id: string): boolean {
  getConversation(projectId, id)
  active.get(id)?.abort()
  return true
}
export async function shutdownAgent(): Promise<void> {
  for (const controller of active.values()) controller.abort()
  await Promise.all([shutdownPlans(), ...tasks])
}
function assertIdle(): void {
  if (active.size || tasks.size || activePlanCount() || hasActivePlanOperations()) throw new Error('请先停止或结束活动会话和计划后再操作 Agent 记录')
}
function deleteProjectAgentRecords(pid: string): boolean {
  assertIdle()
  projectDir(pid)
  const apiIds = listAgentDrafts(pid).map(d=>d.target_id), flowIds = listAgentFlowDrafts(pid).map(d=>d.flow_id)
  const retainManual = retainManualFlowDrafts(pid)
  const conversations = listConversations(pid), plans = planCommands.listPlans(pid)
  for (const plan of plans) planCommands.deletePlan(pid, plan.plan_id)
  clearProjectPlanContexts(pid)
  fs.rmSync(path.join(agentRoot(), 'projects', pid), { recursive: true, force: true })
  retainManual()
  forgetProjectAgentDrafts(pid, apiIds); forgetProjectAgentFlowDrafts(pid, flowIds)
  for (const conversation of conversations) for (const listener of listeners) listener({ project_id: pid, conversation_id: conversation.conversation_id, conversation: null })
  for (const listener of listeners) listener({ project_id: pid, conversation_id: '', conversation: null, records_deleted: true })
  return true
}
/** The application commands called by IPC and integration tests. */
export const agentCommands = { ...turnUndoCommands, previewTurnUndo: (...args: Parameters<typeof turnUndoCommands.previewTurnUndo>) => { assertIdle(); return turnUndoCommands.previewTurnUndo(...args) }, applyTurnUndo: (...args: Parameters<typeof turnUndoCommands.applyTurnUndo>) => { assertIdle(); return turnUndoCommands.applyTurnUndo(...args) }, deleteProjectAgentRecords, ...flowDraftCommands, ...draftCommands, getActivity: () => ({ running: active.size + activePlanCount() }), prepareQuit: async () => { await shutdownAgent(); stashAgentDrafts(); stashAgentFlowDrafts(); return true }, ...planCommands, getConnection, saveConnection, createConnection, listConnections, deleteConnection, getProjectConnection, setProjectConnection, testConnection, createConversation, listConversations, getConversation, deleteConversation, sendMessage, cancelMessage }
