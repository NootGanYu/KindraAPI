/**
 * Stage 5 hardening seam: every loop guard, history compaction, restart repair
 * and size limits, through the public application commands.
 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createEnvironment } from '../src/shared/factories'
import * as storage from '../src/main/storage/store'
import { agentCommands } from '../src/main/agent/service'
import { agentRoot, writeLocal } from '../src/main/agent/store'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
import type { AgentProtocol } from '../src/shared/agent'

const protocol: AgentProtocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
const MAX_TOOL = 24 * 1024
const MAX_HISTORY = 256 * 1024
let pid = ''
let environmentId = ''
let received: any[] = []
let finalRequests = 0

function lastUser(messages: any[]): string {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') return String(messages[index].content ?? '')
  return ''
}
function resultsSince(messages: any[]): any[] {
  let start = -1
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') { start = index; break }
  return messages.slice(start + 1).filter(message => message.role === 'tool')
}
function toolCall(id: string, name: string, args: Record<string, unknown>): any {
  return { tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
function rawToolCall(id: string, name: string, argumentsText: string): any {
  return { tool_calls: [{ id, type: 'function', function: { name, arguments: argumentsText } }] }
}
function next(goal: string, results: any[]): any {
  if (goal.includes('空响应')) return {}
  if (goal.includes('非法参数')) return rawToolCall('bad-json', 'get_api', '{"target_id":')
  if (goal.includes('连续失败')) return toolCall(`fail-${results.length}`, 'get_api', { target_id: `missing-target-${results.length}` })
  if (goal.includes('重复读取')) return { tool_calls: [0, 1, 2].map(index => ({ id: `same-read-${index}`, type: 'function', function: { name: 'list_apis', arguments: '{}' } })) }
  if (goal.includes('完全相同轮次')) return toolCall(`same-write-${results.length}`, 'upsert_environment_variable', { environment_id: environmentId, key: 'token', value: 'same-value' })
  if (goal.includes('maxTurns')) {
    if (results.length === 0) return toolCall('limit-a', 'list_apis', { keyword: 'a' })
    if (results.length === 1) return toolCall('limit-b', 'list_apis', { keyword: 'b' })
    return { content: '收尾回答' }
  }
  if (goal.includes('取消补齐')) return { tool_calls: [0, 1].map(index => ({ id: `cancel-${index}`, type: 'function', function: { name: 'upsert_environment_variable', arguments: JSON.stringify({ environment_id: environmentId, key: `cancel_${index}`, value: 'cancel-value' }) } })) }
  if (goal.includes('压缩测试')) return { content: '压缩后的回答' }
  if (goal.includes('大小测试')) {
    if (!results.length) return toolCall('large-runs', 'list_runs', { limit: 100 })
    return { content: '大小测试完成' }
  }
  if (goal.includes('活动上限')) {
    if (!results.length) return toolCall('activity-cap', 'list_apis', {})
    return { content: '活动上限完成' }
  }
  return { content: '完成' }
}

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-hardening-')))
  await app.whenReady()
  pid = storage.ensureDefaultProject().project_id
  const env = createEnvironment(pid, '加固环境')
  env.env_var_list = { token: { current_value: 'pre', initial_value: 'pre', description: 'pre', is_checked: 1 } }
  storage.saveEnvironment(pid, env)
  environmentId = env.env_id
  const largeTarget = storage.createTargetInProject(pid, '0', 'api')
  largeTarget.name = '大记录接口'
  largeTarget.url = 'https://example.com/'
  storage.saveTarget(pid, largeTarget)
  for (let index = 0; index < 100; index++) {
    storage.addSendRecord(pid, {
      record_id: `hardening-run-${index}`, project_id: pid, target_id: largeTarget.target_id, target_name: largeTarget.name,
      method: 'GET', url: `https://example.com/${'x'.repeat(800)}/${index}`, created_at: Date.now() + index,
      status: 'passed', request: {} as any, response: null, assertions: [], console: [], error: null
    })
  }

  const modelServer = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const decoded = decodeModelRequest(req, body, protocol)
    received.push(decoded)
    const tools: string[] = (decoded.tools ?? []).map((tool: any) => tool.function.name)
    if (!tools.length) {
      const finalizing = lastUser(decoded.messages).includes('工具调用上限')
      if (finalizing) finalRequests++
      respondModel(res, protocol, !!body.stream, { content: finalizing ? '收尾回答' : 'OK' })
      return
    }
    if (tools.includes('kindra_capability_probe')) {
      respondModel(res, protocol, !!body.stream, { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] })
      return
    }
    respondModel(res, protocol, !!body.stream, next(lastUser(decoded.messages), resultsSince(decoded.messages)))
  })
  await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
  try {
    await agentCommands.saveConnection({ name: '加固模型', base_url: `http://127.0.0.1:${(modelServer.address() as any).port}/v1`, model: 'hardening', protocol })
    assert.equal((await agentCommands.testConnection()).capability, 'tools')
    received = []

    // Empty stream.
    const empty = await conversation('空响应')
    await agentCommands.sendMessage(pid, empty, '空响应', undefined, { permissionMode: 'bypass' })
    assert.match((await waitEnd(empty)).error ?? '', /空响应/)

    // Invalid/truncated tool arguments stop after three rounds, and the tool error is visible.
    const invalid = await conversation('非法参数')
    await agentCommands.sendMessage(pid, invalid, '非法参数', undefined, { permissionMode: 'bypass' })
    const invalidState = await waitEnd(invalid)
    assert.match(invalidState.error ?? '', /参数连续 3 轮/)
    assert.match(JSON.stringify(invalidState.activities ?? []), /不是合法 JSON|截断/)

    // Three consecutive turns whose valid tool call fails.
    const failed = await conversation('连续失败')
    await agentCommands.sendMessage(pid, failed, '连续失败', undefined, { permissionMode: 'bypass' })
    assert.match((await waitEnd(failed)).error ?? '', /连续 3 轮的工具调用全部失败/)

    // Same read (tool + args) three times in one turn.
    const repeated = await conversation('重复读取')
    await agentCommands.sendMessage(pid, repeated, '重复读取', undefined, { permissionMode: 'bypass' })
    const repeatedState = await waitEnd(repeated)
    assert.match(repeatedState.error ?? '', /重复读取/)
    assert.equal((repeatedState.activities ?? []).filter(item => item.tool === 'list_apis').length, 3)

    // Identical write turns (stable redacted output) hit the identical-turn guard.
    const identical = await conversation('完全相同轮次')
    await agentCommands.sendMessage(pid, identical, '完全相同轮次', undefined, { permissionMode: 'bypass' })
    assert.match((await waitEnd(identical)).error ?? '', /重复完全相同/)

    // maxTurns: the finalizing model request has no tools and returns a partial answer.
    finalRequests = 0
    const limit = await conversation('maxTurns')
    await agentCommands.sendMessage(pid, limit, 'maxTurns', undefined, { permissionMode: 'bypass', maxTurns: 2 })
    const limitState = await waitEnd(limit)
    assert.equal(limitState.messages.at(-1)?.content, '收尾回答')
    assert.match(limitState.error ?? '', /轮数上限/)
    assert(finalRequests >= 1)

    // Cancelling while the first of two calls waits for approval fills both tool results.
    const cancelled = await conversation('取消补齐')
    await agentCommands.sendMessage(pid, cancelled, '取消补齐', undefined, { permissionMode: 'ask' })
    await waitPending(cancelled)
    agentCommands.cancelMessage(pid, cancelled)
    const cancelledState = await waitEnd(cancelled)
    assert.equal(cancelledState.status, 'interrupted')
    const assistant = cancelledState.ledger?.find((message: any) => message.role === 'assistant' && message.tool_calls?.length)
    assert.equal(assistant.tool_calls.length, 2)
    for (const call of assistant.tool_calls) assert(cancelledState.ledger.some((message: any) => message.role === 'tool' && message.tool_call_id === call.id), `cancelled tool result missing for ${call.id}`)

    // Compaction: old 256KB+ history is folded; tool pairs stay paired and recent content survives.
    const compacted = await compactedConversation()
    const beforeCompact = received.length
    await agentCommands.sendMessage(pid, compacted, '压缩测试', undefined, { permissionMode: 'bypass' })
    const compactedState = await waitEnd(compacted)
    assert.equal(compactedState.messages.at(-1)?.content, '压缩后的回答')
    const compactRequest = received.slice(beforeCompact).find(body => body.messages.some((message: any) => String(message.content ?? '').startsWith('[较早对话摘要')))
    assert(compactRequest, 'a compacted request must contain the summary marker')
    assert(compactRequest.messages.some((message: any) => String(message.content ?? '').includes('OLD-19-END')), 'the recent tail must survive')
    assert(!compactRequest.messages.some((message: any) => String(message.content ?? '').includes('OLD-0-END')), 'the oldest tail must be folded')
    for (const message of compactRequest.messages) for (const call of message.tool_calls ?? []) assert(compactRequest.messages.some((entry: any) => entry.role === 'tool' && entry.tool_call_id === call.id), `compaction broke pair ${call.id}`)
    assert(historyBytes(compactRequest.messages) < MAX_HISTORY)
    assert(historyBytes(compactedState.ledger ?? []) < MAX_HISTORY)

    // Large tool result: model content and activity display both stay within 24KB.
    const large = await conversation('大小测试')
    await agentCommands.sendMessage(pid, large, '大小测试', undefined, { permissionMode: 'bypass' })
    const largeState = await waitEnd(large)
    const largeCall = (largeState.ledger ?? []).find((message: any) => message.role === 'assistant' && message.tool_calls?.length)?.tool_calls?.[0]
    const largeResult = (largeState.ledger ?? []).find((message: any) => message.role === 'tool' && message.tool_call_id === largeCall?.id)
    assert(largeResult && Buffer.byteLength(largeResult.content) <= MAX_TOOL, 'one tool result must stay <=24KB')
    const largeActivity = (largeState.activities ?? []).find(item => item.tool === 'list_runs')
    assert(largeActivity && Buffer.byteLength(largeActivity.display ?? '') <= MAX_TOOL, 'one activity display must stay <=24KB')
    assert(!JSON.stringify(largeState).includes('response-body-secret'))

    // Activity cap: 600 existing activities are trimmed to the last 500.
    const capped = await activityCapConversation()
    await agentCommands.sendMessage(pid, capped, '活动上限', undefined, { permissionMode: 'bypass' })
    const cappedState = await waitEnd(capped)
    assert((cappedState.activities ?? []).length <= 500)

    // Restart repair: pending approval becomes denied, streaming state becomes interrupted and the orphan call gets an error result.
    const pending = await pendingConversation()
    const repaired = agentCommands.getConversation(pid, pending)
    assert.equal(repaired.status, 'interrupted')
    assert.equal(repaired.messages.at(-1)?.status, 'interrupted')
    assert.equal(repaired.activities?.[0]?.status, 'cancelled')
    assert.equal(repaired.activities?.[0]?.approval, 'denied')
    assert(repaired.ledger?.some((message: any) => message.role === 'tool' && message.tool_call_id === 'orphan-approval' && /不会自动重放/.test(message.content)))

    console.log(`PASS stage-5 hardening loop (${protocol})`)
  } finally { await agentCommands.prepareQuit(); modelServer.closeAllConnections(); await new Promise<void>(resolve => modelServer.close(() => resolve())) }
}

function now(): string { return new Date().toISOString() }
async function conversation(title: string): Promise<string> {
  const created = agentCommands.createConversation(pid)
  agentCommands.renameConversation(pid, created.conversation_id, title)
  return created.conversation_id
}
function writeConversation(id: string, extra: Record<string, unknown>): void {
  const stamp = now()
  writeLocal(path.join(agentRoot(), 'projects', pid, 'conversations', `${id}.json`), {
    conversation_id: id, project_id: pid, title: id, created_at: stamp, updated_at: stamp, status: 'idle', messages: [], ...extra
  })
}
async function compactedConversation(): Promise<string> {
  const id = 'hardening-compact'
  const ledger: any[] = []
  for (let index = 0; index < 20; index++) {
    ledger.push({ role: 'user', content: `旧问题 ${index}` })
    ledger.push({ role: 'assistant', content: '', tool_calls: [{ id: `old-${index}`, type: 'function', function: { name: 'list_apis', arguments: '{}' } }] })
    ledger.push({ role: 'tool', tool_call_id: `old-${index}`, content: `${'x'.repeat(14_000)}OLD-${index}-END` })
  }
  writeConversation(id, { ledger })
  return id
}
function historyBytes(messages: any[]): number {
  return messages.reduce((total, message) => total + Buffer.byteLength(String(message.content ?? '')) + (message.tool_calls ?? []).reduce((sum: number, call: any) => sum + Buffer.byteLength(call.function.arguments), 0), 0)
}
async function activityCapConversation(): Promise<string> {
  const id = 'hardening-activity-cap'
  const stamp = now()
  const activities = Array.from({ length: 600 }, (_, index) => ({
    activity_id: `old-activity-${index}`, turn_id: `old-turn-${index}`, call_id: `old-call-${index}`,
    tool: 'get_api', risk: 'read', status: 'succeeded', summary: `旧活动 ${index}`, created_at: stamp
  }))
  writeConversation(id, { activities })
  return id
}
async function pendingConversation(): Promise<string> {
  const id = 'hardening-pending'
  const stamp = now()
  writeConversation(id, {
    status: 'running',
    messages: [
      { message_id: 'u', role: 'user', content: '继续配置', status: 'complete', created_at: stamp, turn_id: 'turn-pending' },
      { message_id: 'a', role: 'assistant', content: '', status: 'streaming', created_at: stamp, turn_id: 'turn-pending' }
    ],
    activities: [{ activity_id: 'pending-activity', turn_id: 'turn-pending', call_id: 'orphan-approval', tool: 'upsert_environment_variable', risk: 'local-write', status: 'running', approval: 'pending', summary: '等待审批', created_at: stamp }],
    ledger: [{ role: 'user', content: '继续配置' }, { role: 'assistant', content: '', tool_calls: [{ id: 'orphan-approval', type: 'function', function: { name: 'upsert_environment_variable', arguments: '{"environment_id":"x","key":"token","value":"***"}' } }] }]
  })
  return id
}
async function waitEnd(conversationId: string): Promise<any> {
  const deadline = Date.now() + 20_000
  let conversation = agentCommands.getConversation(pid, conversationId)
  while (conversation.status === 'running' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
    conversation = agentCommands.getConversation(pid, conversationId)
  }
  assert.notEqual(conversation.status, 'running', 'timed out waiting for the loop')
  return conversation
}
async function waitPending(conversationId: string): Promise<any> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const pending = agentCommands.getConversation(pid, conversationId).activities?.find(activity => activity.approval === 'pending')
    if (pending) return pending
    if (agentCommands.getConversation(pid, conversationId).status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('timed out waiting for the approval pause')
}

main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
