/**
 * Stage 3 seam: formal save, response capture, conflict/document gates and
 * irreversible deletion/recovery through the continuous loop.
 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as storage from '../src/main/storage/store'
import { agentCommands } from '../src/main/agent/service'
import { getDraft, listCandidates } from '../src/main/agent/drafts'
import { getFlowDraft, listFlowCandidates } from '../src/main/agent/flowDrafts'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
import type { AgentProtocol } from '../src/shared/agent'

const protocol: AgentProtocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
let pid = ''
let targets: Record<string, string> = {}
let flowId = ''
let conflictMutated = false

function lastUser(messages: any[]): string {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') return String(messages[index].content ?? '')
  return ''
}
function resultsSince(messages: any[]): any[] {
  let start = -1
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') { start = index; break }
  return messages.slice(start + 1).filter(message => message.role === 'tool')
}
function parsed(message: any): any { try { return JSON.parse(String(message.content ?? '')).result ?? {} } catch { return {} } }
function call(id: string, name: string, args: Record<string, unknown>): any {
  return { tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
function baseRevision(results: any[]): string | null { return results[0] ? parsed(results[0]).base_revision ?? null : null }

function next(goal: string, results: any[]): any {
  if (goal.includes('文档门禁保存')) {
    if (!results.length) return call('doc-save-call', 'save_api', { target_id: targets.doc })
    return { content: '文档门禁已拒绝保存' }
  }
  if (goal.includes('保存冲突')) {
    if (!results.length) return call('conflict-save-read', 'get_api', { target_id: targets.conflict, section: 'summary' })
    if (results.length === 1) return call('conflict-save-update', 'update_api_draft', { target_id: targets.conflict, patch: { description: '冲突保存说明' }, base_revision: baseRevision(results), allowed_changes: ['description'] })
    if (results.length === 2) return call('conflict-save-apply', 'apply_api_candidate', { candidate_id: parsed(results[1]).candidate_id })
    if (results.length === 3) {
      if (!conflictMutated) {
        conflictMutated = true
        const target = storage.getTarget(pid, targets.conflict)!
        target.description = '并发保存修改'
        storage.saveTarget(pid, target)
      }
      return call('conflict-save-save', 'save_api', { target_id: targets.conflict })
    }
    return { content: '保存冲突已阻止' }
  }
  if (goal.includes('保存接口')) {
    if (!results.length) return call('save-read', 'get_api', { target_id: targets.save, section: 'summary' })
    if (results.length === 1) return call('save-update', 'update_api_draft', { target_id: targets.save, patch: { description: '保存后说明' }, base_revision: baseRevision(results), allowed_changes: ['description'] })
    if (results.length === 2) return call('save-apply', 'apply_api_candidate', { candidate_id: parsed(results[1]).candidate_id })
    if (results.length === 3) return call('save-save', 'save_api', { target_id: targets.save })
    return { content: '接口已保存' }
  }
  if (goal.includes('保存响应无捕获')) {
    if (!results.length) return call('response-no-capture', 'save_api_response', { target_id: targets.response })
    return { content: '没有可保存的响应' }
  }
  if (goal.includes('保存响应')) {
    if (!results.length) return call('response-execute', 'execute_api', { target_id: targets.response, save_response: true })
    if (results.length === 1) return call('response-save', 'save_api_response', { target_id: targets.response, run_id: parsed(results[0]).run_id })
    return { content: '响应已保存' }
  }
  if (goal.includes('保存新Flow')) {
    if (!results.length) return call('flow-create', 'create_flow_draft', { name: '保存的新 Flow', description: '新 Flow 说明' })
    if (results.length === 1) return call('flow-apply', 'apply_flow_candidate', { candidate_id: parsed(results[0]).candidate_id })
    if (results.length === 2) return call('flow-save', 'save_flow', { flow_id: parsed(results[0]).flow_id })
    return { content: 'Flow 已保存' }
  }
  if (goal.includes('删除未确认')) {
    if (!results.length) return call('delete-unconfirmed', 'delete_api', { target_id: targets.deleteApi, confirm: false })
    return { content: '删除需要确认' }
  }
  if (goal.includes('删除接口')) {
    if (!results.length) return call('delete-api', 'delete_api', { target_id: targets.deleteApi, confirm: true })
    return { content: '接口已删除' }
  }
  if (goal.includes('删除Flow')) {
    if (!results.length) return call('delete-flow', 'delete_flow', { flow_id: flowId, confirm: true })
    return { content: 'Flow 已删除' }
  }
  return { content: '完成' }
}

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-save-loop-')))
  await app.whenReady()
  pid = storage.ensureDefaultProject().project_id
  const targetServer = http.createServer((req, res) => {
    const isResponse = (req.url ?? '').includes('response')
    res.setHeader('Content-Type', isResponse ? 'text/plain' : 'application/json')
    res.end(isResponse ? 'ok-body' : '{"ok":true}')
  })
  await new Promise<void>(resolve => targetServer.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(targetServer.address() as any).port}`
  for (const [key, name, url] of [
    ['save', '保存接口', `${base}/save`],
    ['doc', '文档门禁接口', `${base}/doc`],
    ['conflict', '保存冲突接口', `${base}/conflict`],
    ['response', '响应保存接口', `${base}/response`],
    ['deleteApi', '待删除接口', `${base}/delete`]
  ] as const) {
    const target = storage.createTargetInProject(pid, '0', 'api')
    target.name = name
    target.description = `${name}原说明`
    target.url = url
    target.method = 'GET'
    storage.saveTarget(pid, target)
    targets[key] = target.target_id
  }
  const flow = {
    flow_id: 'flow-save-stage3', project_id: pid, name: '待删除 Flow', description: '', env_id: storage.listEnvironments(pid)[0]?.env_id ?? '',
    events: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }
  storage.saveFlow(pid, flow)
  flowId = flow.flow_id

  const modelServer = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const decoded = decodeModelRequest(req, body, protocol)
    const tools: string[] = (decoded.tools ?? []).map((tool: any) => tool.function.name)
    if (!tools.length) { respondModel(res, protocol, !!body.stream, { content: 'OK' }); return }
    if (tools.includes('kindra_capability_probe')) {
      respondModel(res, protocol, !!body.stream, { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] })
      return
    }
    const goal = lastUser(decoded.messages)
    respondModel(res, protocol, !!body.stream, next(goal, resultsSince(decoded.messages)))
  })
  await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
  try {
    await agentCommands.saveConnection({ name: '保存模型', base_url: `http://127.0.0.1:${(modelServer.address() as any).port}/v1`, model: 'save-model', protocol })
    assert.equal((await agentCommands.testConnection()).capability, 'tools')

    // update -> apply -> save_api
    const save = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, save.conversation_id, '保存接口', undefined, { permissionMode: 'auto' })
    const saveState = await approveAll(save.conversation_id)
    assert.equal(storage.getTarget(pid, targets.save)!.description, '保存后说明')
    assert.match(JSON.stringify(saveState.activities ?? []), /正式保存/)
    assert.match(JSON.stringify(saveState.activities ?? []), /保存后说明|v\d/)
    assert.equal(listCandidates(pid, targets.save).filter(candidate => candidate.status === 'applied').length, 1)
    console.log('PASS save_api writes the draft after approval and reports the saved version')

    // Document gate: a hand-edited incomplete draft must not be saved.
    const doc = storage.getTarget(pid, targets.doc)!
    const docDraft = structuredClone(doc)
    docDraft.request!.header.parameter = [{ param_id: 'bad-header', key: 'X-Bad', value: '1', is_checked: 1 }]
    agentCommands.syncEditorDraft(pid, docDraft)
    const docConversation = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, docConversation.conversation_id, '文档门禁保存', undefined, { permissionMode: 'auto' })
    const docState = await approveAll(docConversation.conversation_id)
    assert.equal(storage.getTarget(pid, targets.doc)!.request!.header.parameter.some(item => item.key === 'X-Bad'), false)
    assert.match(JSON.stringify(docState.activities ?? []), /文档/)
    console.log('PASS save_api honors the documentation gate before formal write')

    // revision conflict during save
    const conflict = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, conflict.conversation_id, '保存冲突', undefined, { permissionMode: 'auto' })
    const conflictState = await approveAll(conflict.conversation_id)
    assert.equal(storage.getTarget(pid, targets.conflict)!.description, '并发保存修改')
    assert.match(JSON.stringify(conflictState.activities ?? []), /revision|变化|冲突/)
    assert.equal(getDraft(pid, targets.conflict).target.description, '冲突保存说明')
    console.log('PASS save_api stops on a concurrent formal revision change')

    // Response-only save: a dirty draft field must not be written.
    const responseTarget = storage.getTarget(pid, targets.response)!
    const dirty = structuredClone(responseTarget)
    dirty.description = '不应随响应保存的脏说明'
    agentCommands.syncEditorDraft(pid, dirty)
    const response = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, response.conversation_id, '保存响应', undefined, { permissionMode: 'auto' })
    const responseState = await approveAll(response.conversation_id)
    const savedResponse = storage.getTarget(pid, targets.response)!
    assert.equal(savedResponse.description, '响应保存接口原说明')
    assert.equal(savedResponse.response?.example?.some(item => item.raw === 'ok-body'), true)
    assert.equal(getDraft(pid, targets.response).target.description, '不应随响应保存的脏说明')
    assert.match(JSON.stringify(responseState.activities ?? []), /响应示例/)
    console.log('PASS save_api_response saves only the captured 2xx response, not other dirty draft fields')

    // Missing captured response must not prompt or save.
    const noCapture = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, noCapture.conversation_id, '保存响应无捕获', undefined, { permissionMode: 'auto' })
    const noCaptureState = await waitIdle(noCapture.conversation_id)
    assert.match(JSON.stringify(noCaptureState.activities ?? []), /没有可保存|成功 2xx/)
    console.log('PASS save_api_response rejects a turn without a captured success response')

    // New Flow draft -> apply -> formal save.
    const flowSave = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, flowSave.conversation_id, '保存新Flow', undefined, { permissionMode: 'auto' })
    const flowState = await approveAll(flowSave.conversation_id)
    const newFlowCandidate = listFlowCandidates(pid).find(item => item.proposal.name === '保存的新 Flow')
    assert(newFlowCandidate)
    assert.equal(storage.getFlow(pid, newFlowCandidate.flow_id)?.name, '保存的新 Flow')
    assert.equal(getFlowDraft(pid, newFlowCandidate.flow_id).agent_owned, false)
    assert.equal(getFlowDraft(pid, newFlowCandidate.flow_id).new_object, false)
    assert.match(JSON.stringify(flowState.activities ?? []), /正式保存/)
    console.log('PASS save_flow formally creates a new Flow draft after approval')

    // Delete requires confirm and preserves a recoverable tombstone.
    const unconfirmed = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, unconfirmed.conversation_id, '删除未确认', undefined, { permissionMode: 'auto' })
    const unconfirmedState = await waitIdle(unconfirmed.conversation_id)
    assert(storage.getTarget(pid, targets.deleteApi))
    assert.match(JSON.stringify(unconfirmedState.activities ?? []), /confirm|确认/)
    const deletion = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, deletion.conversation_id, '删除接口', undefined, { permissionMode: 'auto' })
    await approveAll(deletion.conversation_id)
    assert.equal(storage.getTarget(pid, targets.deleteApi), null)
    const apiTombstone = storage.getDeletedObject(pid, 'api', targets.deleteApi)
    assert(apiTombstone)
    agentCommands.restoreDeletedApiDraft(pid, targets.deleteApi, apiTombstone!.deletion_id)
    assert.equal(getDraft(pid, targets.deleteApi).target.name, '待删除接口')
    const flowDeletion = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, flowDeletion.conversation_id, '删除Flow', undefined, { permissionMode: 'auto' })
    await approveAll(flowDeletion.conversation_id)
    assert.equal(storage.getFlow(pid, flowId), null)
    const flowTombstone = storage.getDeletedObject(pid, 'flow', flowId)
    assert(flowTombstone)
    agentCommands.restoreDeletedFlowDraft(pid, flowId, flowTombstone!.deletion_id)
    assert.equal(getFlowDraft(pid, flowId).flow.name, '待删除 Flow')
    console.log('PASS delete_api/delete_flow require confirm, leave tombstones and can be restored')

    console.log(`PASS stage-3 save loop (${protocol})`)
  } finally { await agentCommands.prepareQuit(); targetServer.closeAllConnections(); await new Promise<void>(resolve => targetServer.close(() => resolve())); modelServer.closeAllConnections(); await new Promise<void>(resolve => modelServer.close(() => resolve())) }
}

async function approveAll(conversationId: string): Promise<any> {
  const answered = new Set<string>()
  const deadline = Date.now() + 20_000
  let conversation = agentCommands.getConversation(pid, conversationId)
  while (Date.now() < deadline) {
    conversation = agentCommands.getConversation(pid, conversationId)
    const pending = conversation.activities?.find(activity => activity.approval === 'pending' && !answered.has(activity.activity_id))
    if (pending) {
      answered.add(pending.activity_id)
      agentCommands.respondToolApproval(pid, conversationId, pending.activity_id, 'approved')
    } else if (conversation.status !== 'running') return conversation
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`timed out waiting for save approvals: ${conversation.error ?? conversation.status}`)
}
async function waitIdle(conversationId: string): Promise<any> {
  const deadline = Date.now() + 20_000
  let conversation = agentCommands.getConversation(pid, conversationId)
  while (conversation.status === 'running' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
    conversation = agentCommands.getConversation(pid, conversationId)
  }
  assert.equal(conversation.status, 'idle', conversation.error ?? conversation.status)
  return conversation
}

main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
