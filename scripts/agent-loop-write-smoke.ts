/**
 * Stage 2 seam: continuous read -> local candidate -> apply, with the approval
 * gate, documentation gate, conflict handling, Flow drafts and turn undo.
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
let existingFlowId = ''
let conflictMutated = false

function lastUserIndex(messages: any[]): number {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') return index
  return -1
}
function toolResultsSince(messages: any[]): any[] {
  const start = lastUserIndex(messages)
  return messages.slice(start + 1).filter(message => message.role === 'tool')
}
function parsed(message: any): any {
  try { return JSON.parse(String(message.content ?? '')).result ?? {} } catch { return {} }
}
function call(id: string, name: string, args: Record<string, unknown>): any {
  return { tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
function next(goal: string, results: any[], decoded: any): any {
  const baseRevision = results[0] ? parsed(results[0]).base_revision : null
  if (goal.includes('审批允许')) {
    if (!results.length) return call('allow-read', 'get_api', { target_id: targets.allow, section: 'summary' })
    if (results.length === 1) return call('allow-update', 'update_api_draft', { target_id: targets.allow, patch: { description: '审批后说明' }, base_revision: baseRevision, allowed_changes: ['description'] })
    if (results.length === 2) return call('allow-apply', 'apply_api_candidate', { candidate_id: parsed(results[1]).candidate_id })
    if (results.length === 3) return call('allow-verify', 'get_api', { target_id: targets.allow, section: 'summary' })
    return { content: '审批允许完成：审批后说明' }
  }
  if (goal.includes('审批拒绝')) {
    if (!results.length) return call('deny-read', 'get_api', { target_id: targets.deny, section: 'summary' })
    if (results.length <= 2) return call(`deny-update-${results.length}`, 'update_api_draft', { target_id: targets.deny, patch: { description: '不应写入' }, base_revision: baseRevision, allowed_changes: ['description'] })
    return { content: '拒绝后未执行' }
  }
  if (goal.includes('自动模式')) {
    if (!results.length) return call('auto-read', 'get_api', { target_id: targets.auto, section: 'summary' })
    if (results.length === 1) return call('auto-update', 'update_api_draft', { target_id: targets.auto, patch: { description: '自动说明' }, base_revision: baseRevision, allowed_changes: ['description'] })
    if (results.length === 2) return call('auto-apply', 'apply_api_candidate', { candidate_id: parsed(results[1]).candidate_id })
    if (results.length === 3) return call('auto-verify', 'get_api', { target_id: targets.auto, section: 'summary' })
    return { content: '自动完成：自动说明' }
  }
  if (goal.includes('文档门禁')) {
    if (!results.length) return call('doc-read', 'get_api', { target_id: targets.doc, section: 'summary' })
    if (results.length === 1) return call('doc-update', 'update_api_draft', { target_id: targets.doc, patch: { description: '' }, base_revision: baseRevision, allowed_changes: ['description'] })
    return { content: '文档门禁已拒绝写入' }
  }
  if (goal.includes('冲突')) {
    if (!results.length) return call('conflict-read', 'get_api', { target_id: targets.conflict, section: 'summary' })
    if (results.length === 1) return call('conflict-update', 'update_api_draft', { target_id: targets.conflict, patch: { description: '冲突说明' }, base_revision: baseRevision, allowed_changes: ['description'] })
    if (results.length === 2) {
      if (!conflictMutated) {
        conflictMutated = true
        const target = storage.getTarget(pid, targets.conflict)!
        target.description = '并发修改'
        storage.saveTarget(pid, target)
      }
      return call('conflict-apply', 'apply_api_candidate', { candidate_id: parsed(results[1]).candidate_id })
    }
    return { content: '冲突已阻止' }
  }
  if (goal.includes('删除用例')) {
    if (!results.length) return call('delete-case-read', 'get_api', { target_id: targets.caseDelete, section: 'summary' })
    if (results.length === 1) return call('delete-case-get', 'get_case', { target_id: targets.caseDelete, case_id: 'case-del' })
    if (results.length === 2) return call('delete-case-update', 'delete_case_draft', { target_id: targets.caseDelete, case_id: 'case-del', base_revision: baseRevision })
    if (results.length === 3) return call('delete-case-apply', 'apply_api_candidate', { candidate_id: parsed(results[2]).candidate_id })
    if (results.length === 4) return call('delete-case-verify', 'get_api', { target_id: targets.caseDelete, section: 'cases' })
    return { content: '用例删除候选已应用' }
  }
  if (goal.includes('创建接口')) {
    if (!results.length) return call('create-api', 'create_api_draft', { name: 'Agent 新建接口', url: 'https://example.com/created', description: '新建接口说明' })
    if (results.length === 1) return call('create-api-read', 'get_api', { target_id: parsed(results[0]).target_id, section: 'summary' })
    return { content: '创建接口完成' }
  }
  if (goal.includes('用例候选')) {
    if (!results.length) return call('case-read', 'get_api', { target_id: targets.case, section: 'summary' })
    if (results.length === 1) return call('case-get', 'get_case', { target_id: targets.case, case_id: 'case-one' })
    if (results.length === 2) return call('case-update', 'update_case_draft', { target_id: targets.case, case_id: 'case-one', patch: { name: 'Agent 用例' }, base_revision: baseRevision, allowed_changes: ['name'] })
    if (results.length === 3) return call('case-apply', 'apply_api_candidate', { candidate_id: parsed(results[2]).candidate_id })
    if (results.length === 4) return call('case-verify', 'get_case', { target_id: targets.case, case_id: 'case-one' })
    return { content: '用例候选已应用' }
  }
  if (goal.includes('Flow创建')) {
    if (!results.length) return call('flow-create', 'create_flow_draft', { name: 'Agent 新流程', description: '新流程说明', events: [{ type: 'wait', name: '等待', enabled: true, wait_ms: 10 }] })
    if (results.length === 1) return call('flow-create-apply', 'apply_flow_candidate', { candidate_id: parsed(results[0]).candidate_id })
    if (results.length === 2) return call('flow-create-read', 'get_flow', { flow_id: parsed(results[0]).flow_id })
    return { content: 'Flow 创建完成' }
  }
  if (goal.includes('Flow更新')) {
    if (!results.length) return call('flow-read', 'get_flow', { flow_id: existingFlowId })
    if (results.length === 1) return call('flow-update', 'update_flow_draft', { flow_id: existingFlowId, patch: { name: 'Agent 流程更新' }, base_revision: baseRevision, allowed_changes: ['name'] })
    if (results.length === 2) return call('flow-apply', 'apply_flow_candidate', { candidate_id: parsed(results[1]).candidate_id })
    if (results.length === 3) return call('flow-verify', 'get_flow', { flow_id: existingFlowId })
    return { content: 'Flow 更新完成' }
  }
  return { content: decoded.messages.at(-1)?.content ?? '完成' }
}

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-loop-write-')))
  await app.whenReady()
  const project = storage.ensureDefaultProject()
  pid = project.project_id
  for (const [key, name, description] of [
    ['allow', '审批允许接口', '原始说明'],
    ['deny', '审批拒绝接口', '拒绝原说明'],
    ['auto', '自动模式接口', '自动原说明'],
    ['doc', '文档门禁接口', '文档原说明'],
    ['conflict', '冲突接口', '冲突原说明'],
    ['case', '用例接口', '用例原说明'],
    ['caseDelete', '删除用例接口', '删除原说明']
  ] as const) {
    const target = storage.createTargetInProject(pid, '0', 'api')
    target.name = name
    target.description = description
    target.url = `https://example.com/${key}`
    target.method = 'GET'
    target.cases = key === 'case' ? [{ case_id: 'case-one', name: '原用例', is_enabled: 1, override: {}, assertions: [] }] : key === 'caseDelete' ? [{ case_id: 'case-del', name: '待删除用例', is_enabled: 1, override: {}, assertions: [] }] : []
    storage.saveTarget(pid, target)
    targets[key] = target.target_id
  }
  const existingFlow = {
    flow_id: 'flow-existing', project_id: pid, name: '原流程', description: '', env_id: storage.listEnvironments(pid)[0]?.env_id ?? '',
    events: [{ event_id: 'event-one', type: 'wait' as const, name: '等待', enabled: true, wait_ms: 10 }],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }
  storage.saveFlow(pid, existingFlow)
  existingFlowId = existingFlow.flow_id

  const server = http.createServer(async (req, res) => {
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
    assert(tools.includes('update_api_draft') && tools.includes('apply_api_candidate'), 'local-write tools are offered')
    const goal = decoded.messages.filter((message: any) => message.role === 'user').map((message: any) => String(message.content ?? '')).join(' ')
    const results = toolResultsSince(decoded.messages)
    respondModel(res, protocol, !!body.stream, next(goal, results, decoded))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await agentCommands.saveConnection({ name: '写入模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'write-model', protocol })
    assert.equal((await agentCommands.testConnection()).capability, 'tools')

    // ask + allow: two approvals, candidate applied to draft, formal untouched.
    const allow = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, allow.conversation_id, '审批允许更新接口', undefined, { permissionMode: 'ask' })
    const allowState = await driveApprovals(allow.conversation_id, 'approved')
    assert.equal(getDraft(pid, targets.allow).target.description, '审批后说明')
    assert.equal(storage.getTarget(pid, targets.allow)!.description, '原始说明')
    assert((allowState.activities ?? []).filter(item => item.risk === 'local-write').every(item => item.approval === 'approved'))
    assert.equal(allowState.activities?.filter(item => item.tool === 'update_api_draft').length, 1)
    const allowCandidate = listCandidates(pid, targets.allow)[0]
    assert.equal(allowCandidate.status, 'applied')
    assert.equal(allowCandidate.plan_id, allowState.messages.find(message => message.role === 'user')?.turn_id)
    assert.match(allowState.messages.at(-1)?.content ?? '', /审批允许完成/)
    console.log('PASS ask approval allows local candidate and preserves the formal definition')

    // A duplicate response cannot win after the gate consumed the nonce.
    const approvedActivity = allowState.activities?.find(item => item.tool === 'update_api_draft')
    assert(approvedActivity)
    assert.throws(() => agentCommands.respondToolApproval(pid, allow.conversation_id, approvedActivity!.activity_id, 'approved'), /失效|处理/)

    // ask + deny: no candidate, no draft or formal change, and the retried call is not executed.
    const deny = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, deny.conversation_id, '审批拒绝更新接口', undefined, { permissionMode: 'ask' })
    const denyState = await driveApprovals(deny.conversation_id, 'denied')
    assert.equal(getDraft(pid, targets.deny).target.description, '拒绝原说明')
    assert.equal(storage.getTarget(pid, targets.deny)!.description, '拒绝原说明')
    assert.equal(listCandidates(pid, targets.deny).length, 0)
    assert((denyState.activities ?? []).some(item => item.approval === 'denied'))
    assert.match(denyState.messages.at(-1)?.content ?? '', /拒绝后未执行/)
    console.log('PASS ask denial blocks the tool and repeated identical calls without side effects')

    // auto: local writes run without a pending approval.
    const auto = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, auto.conversation_id, '自动模式更新接口', undefined, { permissionMode: 'auto' })
    const autoState = await waitIdle(auto.conversation_id)
    assert.equal(getDraft(pid, targets.auto).target.description, '自动说明')
    assert.equal(storage.getTarget(pid, targets.auto)!.description, '自动原说明')
    assert((autoState.activities ?? []).every(item => item.approval !== 'pending'))
    console.log('PASS auto mode executes local writes without pausing')

    // Documentation gate rejects a malformed update before a candidate exists.
    const doc = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, doc.conversation_id, '文档门禁更新接口', undefined, { permissionMode: 'auto' })
    const docState = await waitIdle(doc.conversation_id)
    assert.equal(getDraft(pid, targets.doc).target.description, '文档原说明')
    assert.equal(listCandidates(pid, targets.doc).length, 0)
    assert.match(JSON.stringify(docState.activities ?? []), /文档/)
    console.log('PASS documentation gate rejects malformed patches before a candidate is written')

    // Conflict: formal definition changes between candidate creation and apply.
    const conflict = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, conflict.conversation_id, '冲突更新接口', undefined, { permissionMode: 'auto' })
    const conflictState = await waitIdle(conflict.conversation_id)
    const conflictDraft = getDraft(pid, targets.conflict)
    assert.equal(conflictDraft.agent_owned, false, 'a conflicted candidate must not create or overwrite a draft')
    assert.equal(conflictDraft.target.description, '并发修改')
    assert.equal(storage.getTarget(pid, targets.conflict)!.description, '并发修改')
    const conflicted = listCandidates(pid, targets.conflict)[0]
    assert.equal(conflicted.status, 'conflict')
    assert.match(JSON.stringify(conflictState.activities ?? []), /冲突/)
    console.log('PASS apply stops on conflict without overwriting draft or formal definition')

    // Case candidate: create -> apply -> read the draft.
    const cases = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, cases.conversation_id, '用例候选更新', undefined, { permissionMode: 'auto' })
    await waitIdle(cases.conversation_id)
    assert.equal(getDraft(pid, targets.case).target.cases?.find(item => item.case_id === 'case-one')?.name, 'Agent 用例')
    assert.equal(storage.getTarget(pid, targets.case)!.cases?.find(item => item.case_id === 'case-one')?.name, '原用例')
    console.log('PASS case update candidate applies to the draft only')

    // Case delete candidate follows the same stable case_id path.
    const deleteCase = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, deleteCase.conversation_id, '删除用例候选', undefined, { permissionMode: 'auto' })
    await waitIdle(deleteCase.conversation_id)
    assert.equal(getDraft(pid, targets.caseDelete).target.cases?.some(item => item.case_id === 'case-del'), false)
    assert.equal(storage.getTarget(pid, targets.caseDelete)!.cases?.some(item => item.case_id === 'case-del'), true)
    console.log('PASS case delete candidate applies to the draft only')

    // New API draft: local draft only, readable through get_api, never store.saveTarget.
    const createApi = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, createApi.conversation_id, '创建接口草稿', undefined, { permissionMode: 'auto' })
    await waitIdle(createApi.conversation_id)
    const createdCandidate = listCandidates(pid).find(item => item.proposal.name === 'Agent 新建接口')
    assert(createdCandidate && createdCandidate.status === 'applied')
    const createdDraft = getDraft(pid, createdCandidate.target_id)
    assert.equal(createdDraft.new_object, true)
    assert.equal(createdDraft.target.description, '新建接口说明')
    assert.equal(storage.getTarget(pid, createdCandidate.target_id), null)
    console.log('PASS new API draft is local-only and readable through get_api')

    // Flow create candidate -> apply -> read the draft; formal store has no such Flow.
    const createFlow = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, createFlow.conversation_id, 'Flow创建新流程', undefined, { permissionMode: 'auto' })
    await waitIdle(createFlow.conversation_id)
    const newFlowCandidate = listFlowCandidates(pid).find(item => item.proposal.name === 'Agent 新流程')
    assert(newFlowCandidate)
    assert.equal(newFlowCandidate.status, 'applied')
    const newFlowDraft = getFlowDraft(pid, newFlowCandidate.flow_id)
    assert.equal(newFlowDraft.flow.name, 'Agent 新流程')
    assert.equal(newFlowDraft.new_object, true)
    assert.equal(storage.getFlow(pid, newFlowCandidate.flow_id), null)
    console.log('PASS Flow create -> apply writes only a local draft')

    // Flow update candidate -> apply -> read the draft; formal Flow unchanged.
    const updateFlow = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, updateFlow.conversation_id, 'Flow更新已有流程', undefined, { permissionMode: 'auto' })
    await waitIdle(updateFlow.conversation_id)
    assert.equal(getFlowDraft(pid, existingFlowId).flow.name, 'Agent 流程更新')
    assert.equal(storage.getFlow(pid, existingFlowId)!.name, '原流程')
    console.log('PASS Flow update candidate applies to the draft only')

    // Turn undo: native turn ids are used as candidate plan ids and are listed with a readable name.
    const autoTurnId = autoState.messages.find(message => message.role === 'user')?.turn_id
    assert(autoTurnId)
    const turns = agentCommands.listUndoTurns(pid)
    const autoTurn = turns.find(turn => turn.plan_id === autoTurnId)
    assert(autoTurn && autoTurn.name !== autoTurnId && autoTurn.name.includes('自动'))
    const preview = agentCommands.previewTurnUndo(pid, autoTurnId)
    agentCommands.applyTurnUndo(pid, preview.undo_id, preview.review_id, {})
    assert.equal(getDraft(pid, targets.auto).target.description, '自动原说明')
    assert.equal(storage.getTarget(pid, targets.auto)!.description, '自动原说明')
    console.log(`PASS turn undo by native turn id (${protocol}): draft reverted, formal definition unchanged`)

    console.log(`PASS stage-2 write loop (${protocol})`)
  } finally { await agentCommands.prepareQuit(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}

async function driveApprovals(conversationId: string, decision: 'approved' | 'denied'): Promise<any> {
  const answered = new Set<string>()
  const deadline = Date.now() + 15_000
  let conversation = agentCommands.getConversation(pid, conversationId)
  while (Date.now() < deadline) {
    conversation = agentCommands.getConversation(pid, conversationId)
    const pending = conversation.activities?.find(activity => activity.approval === 'pending' && !answered.has(activity.activity_id))
    if (pending) {
      answered.add(pending.activity_id)
      agentCommands.respondToolApproval(pid, conversationId, pending.activity_id, decision)
    } else if (conversation.status !== 'running') return conversation
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`timed out waiting for approval/idle: ${conversation?.error ?? conversation?.status}`)
}
async function waitIdle(conversationId: string): Promise<any> {
  const deadline = Date.now() + 15_000
  let conversation = agentCommands.getConversation(pid, conversationId)
  while (conversation.status === 'running' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
    conversation = agentCommands.getConversation(pid, conversationId)
  }
  assert.equal(conversation.status, 'idle', conversation.error ?? conversation.status)
  return conversation
}

main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
