/**
 * Stage 3 seam: network-write execution through the continuous loop.
 * Approval matrix, explicit effects, unknown non-replay and scope revalidation
 * are exercised against a real loopback HTTP target.
 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as storage from '../src/main/storage/store'
import { agentCommands } from '../src/main/agent/service'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
import type { AgentProtocol } from '../src/shared/agent'

const protocol: AgentProtocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
let pid = ''
let base = ''
let extraUrl = ''
let environmentId = ''
let targets: Record<string, string> = {}
let caseId = ''
let flowId = ''
const hits: Record<string, number> = {}
const recent = (route: string): number => hits[route] ?? 0

function lastUser(messages: any[]): string {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') return String(messages[index].content ?? '')
  return ''
}
function resultsSince(messages: any[]): any[] {
  let start = -1
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') { start = index; break }
  return messages.slice(start + 1).filter(message => message.role === 'tool')
}
function call(id: string, name: string, args: Record<string, unknown>): any {
  return { tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
function apiArgs(targetId: string, extra = false, capture = false): Record<string, unknown> {
  return {
    target_id: targetId,
    ...(extra ? { environment_id: environmentId, save_response: capture, write_variables: true, extra_requests: [{ method: 'GET', url: extraUrl, max_calls: 1 }] } : {})
  }
}

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-execute-loop-')))
  await app.whenReady()
  pid = storage.ensureDefaultProject().project_id
  environmentId = storage.listEnvironments(pid)[0].env_id
  const env = storage.listEnvironments(pid)[0]
  env.env_var_list = { writeback: { current_value: 'old', initial_value: 'old', description: '写回测试', is_checked: 1 } }
  storage.saveEnvironment(pid, env)

  const targetServer = http.createServer((req, res) => {
    const route = (req.url ?? '/').split('?')[0]
    hits[route] = (hits[route] ?? 0) + 1
    if (route === '/disconnect') { req.socket.destroy(); return }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ route, secret: 'response-body-secret', ok: true }))
  })
  await new Promise<void>(resolve => targetServer.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(targetServer.address() as any).port}`
  extraUrl = `${base}/extra`

  for (const [key, route] of [['ok', '/ok'], ['deny', '/denied'], ['auto', '/auto'], ['bypass', '/bypass'], ['unknown', '/disconnect'], ['scope', '/scope'], ['case', '/case']] as const) {
    const target = storage.createTargetInProject(pid, '0', 'api')
    target.name = `执行-${key}`
    target.description = `执行目标 ${key}`
    target.url = `${base}${route}`
    target.method = 'GET'
    if (key === 'ok') {
      target.request!.pre_script = `pm.environment.set('writeback','new'); pm.sendRequest('${extraUrl}', function () {})`
      target.request!.pre_script_enabled = true
    }
    if (key === 'case') {
      caseId = 'case-one'
      target.cases = [{ case_id: caseId, name: '执行用例', is_enabled: 1, override: {}, assertions: [] }]
    }
    storage.saveTarget(pid, target)
    targets[key] = target.target_id
  }
  const flow = {
    flow_id: 'flow-execute', project_id: pid, name: '执行 Flow', description: '', env_id: environmentId,
    events: [{ event_id: 'event-one', type: 'request' as const, name: '内联请求', enabled: true, method: 'GET', url: `${base}/flow`, headers: [], body: '' }],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
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
    const results = resultsSince(decoded.messages)
    let message: any
    if (goal.includes('审批通过')) {
      if (!results.length) message = call('exec-allow', 'execute_api', apiArgs(targets.ok, true, true))
      else message = { content: '执行审批完成' }
    } else if (goal.includes('执行拒绝')) {
      if (!results.length) message = call('exec-deny', 'execute_api', apiArgs(targets.deny))
      else message = { content: '执行已拒绝' }
    } else if (goal.includes('执行自动')) {
      if (!results.length) message = call('exec-auto', 'execute_api', apiArgs(targets.auto))
      else message = { content: '自动执行完成' }
    } else if (goal.includes('执行跳过')) {
      if (!results.length) message = call('exec-bypass', 'execute_api', apiArgs(targets.bypass))
      else message = { content: '跳过权限执行完成' }
    } else if (goal.includes('执行未知')) {
      if (results.length < 2) message = call(`exec-unknown-${results.length}`, 'execute_api', apiArgs(targets.unknown))
      else message = { content: '结果未知，已阻止重发' }
    } else if (goal.includes('新轮重试未知')) {
      if (!results.length) message = call('exec-retry-next-turn', 'execute_api', apiArgs(targets.unknown))
      else message = { content: '新轮重试完成' }
    } else if (goal.includes('范围变化')) {
      if (!results.length) message = call('exec-scope', 'execute_api', apiArgs(targets.scope))
      else message = { content: '范围变化已阻止' }
    } else if (goal.includes('执行用例')) {
      if (!results.length) message = call('exec-case', 'execute_case', { target_id: targets.case, case_id: caseId })
      else message = { content: '用例执行完成' }
    } else if (goal.includes('Flow执行')) {
      if (!results.length) message = call('exec-flow', 'execute_flow', { flow_id: flowId, environment_id: environmentId })
      else message = { content: 'Flow 执行完成' }
    } else message = { content: '完成' }
    respondModel(res, protocol, !!body.stream, message)
  })
  await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
  try {
    await agentCommands.saveConnection({ name: '执行模型', base_url: `http://127.0.0.1:${(modelServer.address() as any).port}/v1`, model: 'execute-model', protocol })
    assert.equal((await agentCommands.testConnection()).capability, 'tools')

    // ask allow: approval card shows scope/effects, then one main and one extra request.
    const allow = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, allow.conversation_id, '执行审批通过', undefined, { permissionMode: 'ask' })
    const pending = await waitPending(allow.conversation_id)
    assert.match(pending.summary, /执行/)
    assert.match(pending.display ?? '', /方法：GET/)
    assert.match(pending.display ?? '', new RegExp(escapeRegExp(extraUrl)))
    assert.match(pending.display ?? '', /变量写回：允许/)
    assert.match(pending.display ?? '', /保存响应：允许/)
    agentCommands.respondToolApproval(pid, allow.conversation_id, pending.activity_id, 'approved')
    const allowState = await waitIdle(allow.conversation_id)
    assert.equal(recent('/ok'), 1)
    assert.equal(recent('/extra'), 1)
    assert.equal(storage.listEnvironments(pid)[0].env_var_list.writeback.current_value, 'new')
    assert(!JSON.stringify(allowState).includes('response-body-secret'), 'execution bodies never enter the conversation')
    assert.match(JSON.stringify(allowState.activities ?? []), /执行/)
    console.log('PASS ask execution approval, extra request, variable writeback and summarized result')

    // deny: no request is sent.
    const deny = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, deny.conversation_id, '执行拒绝', undefined, { permissionMode: 'ask' })
    await waitPending(deny.conversation_id)
    assert.equal(recent('/denied'), 0)
    const denyPending = await currentPending(deny.conversation_id)
    agentCommands.respondToolApproval(pid, deny.conversation_id, denyPending.activity_id, 'denied')
    await waitIdle(deny.conversation_id)
    assert.equal(recent('/denied'), 0)
    console.log('PASS denied execution sends no request')

    // auto still pauses for network-write; bypass runs without a pending card.
    const auto = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, auto.conversation_id, '执行自动', undefined, { permissionMode: 'auto' })
    await waitPending(auto.conversation_id)
    const autoPending = await currentPending(auto.conversation_id)
    agentCommands.respondToolApproval(pid, auto.conversation_id, autoPending.activity_id, 'approved')
    await waitIdle(auto.conversation_id)
    assert.equal(recent('/auto'), 1)
    const bypass = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, bypass.conversation_id, '执行跳过', undefined, { permissionMode: 'bypass' })
    const bypassState = await waitIdle(bypass.conversation_id)
    assert.equal(recent('/bypass'), 1)
    assert((bypassState.activities ?? []).every(item => item.approval !== 'pending'))
    console.log('PASS auto pauses for network-write while bypass executes with risk shown')

    // unknown: a second call with a new call_id in the same turn is blocked.
    const unknown = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, unknown.conversation_id, '执行未知', undefined, { permissionMode: 'bypass' })
    const unknownState = await waitIdle(unknown.conversation_id)
    assert.equal(recent('/disconnect'), 1, 'unknown executes once')
    assert.match(JSON.stringify(unknownState.activities ?? []), /结果未知/)
    assert.match(JSON.stringify(unknownState.activities ?? []), /禁止自动重发/)
    assert.match(unknownState.messages.at(-1)?.content ?? '', /阻止重发/)
    // A new user turn resets only the per-turn unknown state.
    await agentCommands.sendMessage(pid, unknown.conversation_id, '新轮重试未知', undefined, { permissionMode: 'bypass' })
    await waitIdle(unknown.conversation_id)
    assert.equal(recent('/disconnect'), 2, 'a new user turn may retry after unknown')
    console.log('PASS unknown result blocks same-turn replay and allows an explicit new turn')

    // scope change during approval: no request is dispatched.
    const scope = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, scope.conversation_id, '范围变化', undefined, { permissionMode: 'ask' })
    const scopePending = await waitPending(scope.conversation_id)
    const changed = storage.getTarget(pid, targets.scope)!
    changed.url = `${base}/scope-changed`
    storage.saveTarget(pid, changed)
    agentCommands.respondToolApproval(pid, scope.conversation_id, scopePending.activity_id, 'approved')
    const scopeState = await waitIdle(scope.conversation_id)
    assert.equal(recent('/scope'), 0)
    assert.equal(recent('/scope-changed'), 0)
    assert.match(JSON.stringify(scopeState.activities ?? []), /改变|范围/)
    console.log('PASS execution revalidates scope after approval and dispatches nothing')

    const caseRun = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, caseRun.conversation_id, '执行用例', undefined, { permissionMode: 'bypass' })
    const caseState = await waitIdle(caseRun.conversation_id)
    assert.equal(recent('/case'), 1)
    assert.match(JSON.stringify(caseState.activities ?? []), /用例/)
    const flowRun = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, flowRun.conversation_id, 'Flow执行', undefined, { permissionMode: 'bypass' })
    const flowState = await waitIdle(flowRun.conversation_id)
    assert.equal(recent('/flow'), 1)
    assert.match(JSON.stringify(flowState.activities ?? []), /节点|通过/)
    console.log(`PASS execute_case and execute_flow summaries (${protocol})`)

    console.log(`PASS stage-3 execution loop (${protocol})`)
  } finally { await agentCommands.prepareQuit(); targetServer.closeAllConnections(); await new Promise<void>(resolve => targetServer.close(() => resolve())); modelServer.closeAllConnections(); await new Promise<void>(resolve => modelServer.close(() => resolve())) }
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
async function currentPending(conversationId: string): Promise<any> {
  const conversation = agentCommands.getConversation(pid, conversationId)
  return conversation.activities?.find(activity => activity.approval === 'pending')
}
async function waitPending(conversationId: string): Promise<any> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const pending = await currentPending(conversationId)
    if (pending) return pending
    if (agentCommands.getConversation(pid, conversationId).status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`timed out waiting for approval: ${JSON.stringify(agentCommands.getConversation(pid, conversationId).error ?? '')}`)
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
