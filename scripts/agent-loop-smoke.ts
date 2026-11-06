/**
 * Stage 1 seam: the public agent commands drive a continuous read-only tool loop.
 * The loopback model chooses the next tool from the previous tool result, never
 * from injected definitions. Both OpenAI-compatible protocols are exercised.
 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as storage from '../src/main/storage/store'
import { agentCommands, onAgentEvent } from '../src/main/agent/service'
import { agentRoot, writeLocal } from '../src/main/agent/store'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
import type { AgentProtocol } from '../src/shared/agent'

const protocol: AgentProtocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
const secret = 'stage-one-env-secret-value'
const key = 'stage-one-model-key-value'
let requests = 0
let cancelledRequests = 0

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-loop-')))
  await app.whenReady()
  const project = storage.ensureDefaultProject()
  const pid = project.project_id
  const target = storage.createTargetInProject(pid, '0', 'api')
  target.name = '订单接口'
  target.description = '不应注入的说明'
  target.url = 'http://user:pass@example.com/orders'
  target.method = 'POST'
  target.request = {
    auth: { type: 'bearer', bearer: { key: 'stage-one-bearer-secret' } },
    header: { parameter: [{ param_id: 'h1', key: 'X-Trace', value: 'trace-value', is_checked: 1 }] },
    query: { parameter: [] }, restful: { parameter: [] }, cookie: { parameter: [] },
    body: { mode: 'json', raw: '{"amount":1}' }, pre_tasks: [], post_tasks: []
  }
  target.cases = [{ case_id: 'case-1', name: '正常下单', is_enabled: 1, override: {}, assertions: [] }]
  storage.saveTarget(pid, target)
  const env = storage.listEnvironments(pid)[0]
  env.name = '本地环境'
  env.env_var_list = { token: { current_value: secret, initial_value: secret, description: '访问令牌', is_checked: 1 } }
  storage.saveEnvironment(pid, env)
  storage.saveGlobalVars(pid, { project_id: pid, vars: { global_secret: { current_value: secret, initial_value: secret, description: '全局变量说明' } }, updated_at: new Date().toISOString() })
  storage.saveFlow(pid, {
    flow_id: 'flow-stage-one', project_id: pid, name: '下单流程', description: '流程说明', env_id: env.env_id,
    events: [
      { event_id: 'e1', type: 'request', name: '创建订单', enabled: true, method: 'POST', url: 'http://user:pass@example.com/orders' },
      { event_id: 'e2', type: 'wait', name: '等待', enabled: true, wait_ms: 10 }
    ], created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  })
  storage.addSendRecord(pid, {
    record_id: 'run-1', project_id: pid, target_id: target.target_id, target_name: target.name, method: 'POST', url: target.url!,
    created_at: Date.now(), status: 'passed', request: { name: target.name, project_id: pid, target_id: target.target_id, method: 'POST', url: target.url!, headers: [], query: [], body: '', auth: { type: 'bearer', bearer: { key: 'stage-one-bearer-secret' } } },
    response: null, assertions: [], console: [], error: null
  } as any)

  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const decoded = decodeModelRequest(req, body, protocol)
    const tools: string[] = (decoded.tools ?? []).map((tool: any) => tool.function.name)
    const goal = decoded.messages.filter((message: any) => message.role === 'user').map((message: any) => String(message.content ?? '')).join(' ')
    if (!tools.length) {
      respondModel(res, protocol, !!body.stream, { content: 'OK' })
      return
    }
    if (tools.includes('kindra_capability_probe')) {
      respondModel(res, protocol, !!body.stream, { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] })
      return
    }
    assert(tools.includes('list_apis'), 'the read-only registry is offered to the model')
    assert(!tools.includes('propose_task_plan'), 'the legacy planning tool is not part of the continuous loop')
    if (goal.includes('取消测试')) {
      cancelledRequests++
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': waiting\n\n')
      return
    }
    requests++
    const toolResults = decoded.messages.filter((message: any) => message.role === 'tool')
    let message: any
    if (!toolResults.length) {
      const first = JSON.stringify(decoded.messages)
      assert(!first.includes(secret), 'environment values are never injected into the context')
      assert(!first.includes('不应注入的说明'), 'definitions are not injected into the context')
      assert(!first.includes('example.com'), 'URLs are not injected into the context')
      message = { tool_calls: [{ id: `call-list`, type: 'function', function: { name: 'list_apis', arguments: '{"limit":20}' } }] }
    } else if (toolResults.length === 1) {
      const catalog = String(toolResults[0].content)
      assert(!catalog.includes('不应注入的说明') && !catalog.includes('example.com'), 'the catalog contains only id/name/method/type')
      assert(!catalog.includes(secret), 'catalog results stay redacted')
      message = { tool_calls: [{ id: `call-get-1`, type: 'function', function: { name: 'get_api', arguments: JSON.stringify({ target_id: target.target_id, section: 'summary' }) } }] }
    } else if (toolResults.length === 2) {
      message = { tool_calls: [{ id: `call-get-2`, type: 'function', function: { name: 'get_api', arguments: JSON.stringify({ target_id: target.target_id, section: 'request' }) } }] }
    } else {
      const requestResult = String(toolResults[2].content)
      assert(requestResult.includes('X-Trace'), 'the request section is read on demand')
      assert(!requestResult.includes('stage-one-bearer-secret'), 'definition credentials are redacted')
      message = { content: '已按需读取订单接口并完成回答。' }
    }
    respondModel(res, protocol, !!body.stream, message)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await agentCommands.saveConnection({ name: '回环模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'loop-model', protocol, api_key: key })
    assert.equal((await agentCommands.testConnection()).capability, 'tools')

    const conversation = agentCommands.createConversation(pid)
    const events: string[] = []
    const off = onAgentEvent(event => events.push(JSON.stringify(event)))
    await agentCommands.sendMessage(pid, conversation.conversation_id, '读取订单接口并总结')
    const done = await waitForStatus(pid, conversation.conversation_id, 'idle')
    off()
    assert.equal(requests, 4, 'three tool turns and one final answer')
    assert.equal(done.messages.at(-1)?.content, '已按需读取订单接口并完成回答。')
    assert.equal(done.messages.at(-1)?.status, 'complete')
    const activities = done.activities ?? []
    assert.equal(activities.length, 3, 'every executed tool is recorded')
    assert.deepEqual(activities.map(item => item.tool), ['list_apis', 'get_api', 'get_api'])
    assert(activities.every(item => item.status === 'succeeded'))
    assert(activities.every(item => item.turn_id === done.messages.find(message => message.role === 'user')?.turn_id))
    const ledger = done.ledger ?? []
    const calls = ledger.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? [])
    assert.deepEqual(calls.map(call => call.function.name), ['list_apis', 'get_api', 'get_api'])
    for (const call of calls) assert(ledger.some(message => message.role === 'tool' && message.tool_call_id === call.id), 'each assistant tool_call has a tool result')
    const persisted = JSON.stringify(done)
    assert(!persisted.includes(secret) && !persisted.includes(key) && !persisted.includes('stage-one-bearer-secret'))
    assert(events.every(event => !event.includes(secret) && !event.includes(key)), 'streaming events never expose credentials')

    // Cancellation: the loop is aborted, running activities are closed, and the
    // turn is never re-sent by reading the conversation again.
    const cancelled = agentCommands.createConversation(pid)
    await agentCommands.sendMessage(pid, cancelled.conversation_id, '取消测试')
    await waitFor(() => agentCommands.getConversation(pid, cancelled.conversation_id).status === 'running')
    const beforeCancel = cancelledRequests
    agentCommands.cancelMessage(pid, cancelled.conversation_id)
    const stopped = await waitForStatus(pid, cancelled.conversation_id, 'interrupted')
    assert((stopped.activities ?? []).every(item => item.status !== 'running'))
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(cancelledRequests, beforeCancel, 'reading the conversation does not replay a cancelled turn')
    assert.equal(agentCommands.getConversation(pid, cancelled.conversation_id).status, 'interrupted')
    await agentCommands.prepareQuit()
    assert.equal(cancelledRequests, beforeCancel, 'quitting does not replay an interrupted turn')

    // Restart recovery: an orphaned tool_call gets a synthetic error result and
    // is never executed again.
    const orphanId = 'restart-conversation'
    const now = new Date().toISOString()
    const turnId = 'restart-turn'
    const dir = path.join(agentRoot(), 'projects', pid, 'conversations')
    writeLocal(path.join(dir, `${orphanId}.json`), {
      conversation_id: orphanId, project_id: pid, title: '重启会话', created_at: now, updated_at: now, status: 'running',
      messages: [
        { message_id: 'u', role: 'user', content: '继续读取', status: 'complete', created_at: now, turn_id: turnId },
        { message_id: 'a', role: 'assistant', content: '', status: 'streaming', created_at: now, turn_id: turnId }
      ],
      activities: [{ activity_id: 'act-1', turn_id: turnId, call_id: 'orphan-call', tool: 'get_api', risk: 'read', status: 'running', summary: '读取接口', created_at: now }],
      ledger: [
        { role: 'user', content: '继续读取' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'orphan-call', type: 'function', function: { name: 'get_api', arguments: '{"target_id":"x"}' } }] }
      ]
    })
    const resumed = agentCommands.getConversation(pid, orphanId)
    assert.equal(resumed.status, 'interrupted')
    assert.equal(resumed.messages.at(-1)?.status, 'interrupted')
    assert.equal(resumed.activities?.[0]?.status, 'cancelled')
    const orphanResult = resumed.ledger?.find(message => message.role === 'tool' && message.tool_call_id === 'orphan-call')
    assert(orphanResult && /不会自动重放/.test(orphanResult.content), 'the unfinished tool_call gets an error result')
    assert.equal(requests, 4, 'restart recovery executes no tool')

    console.log(`PASS continuous read-only loop (${protocol}): multi-turn tools, ledger, paging catalog, redaction, cancel and restart`)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert(check(), 'timed out waiting for the agent command')
}
async function waitForStatus(pid: string, id: string, status: string): Promise<any> {
  let last: any
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    last = agentCommands.getConversation(pid, id)
    if (last.status === status) return last
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(last?.status, status, `expected ${status}, got ${last?.status}: ${last?.error ?? ''}`)
  return last
}

main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
