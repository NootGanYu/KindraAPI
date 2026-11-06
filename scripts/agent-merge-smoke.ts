import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-merge-'))); await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  let target = store.createTargetInProject(pid, '0', 'api')
  target.description = '基线说明'
  target.request!.query.parameter = [{ param_id: 'stable', key: 'before', value: '0', description: '基线参数', is_checked: 1 } as any]
  store.saveTarget(pid, target)
  let patch: unknown = { description: 'Agent 说明' }
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), name = body.tools?.[0]?.function.name
    const message = name ? { tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, target_id: target.target_id, patch }) } }] } : { content: '候选已创建' }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await commands.saveConnection({ name: '合并测试', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'merge', protocol: 'chat-completions' }); await commands.testConnection()
    const propose = async () => { const plan = await commands.proposeEditPlan(pid, { goal: '修改草稿', targetId: target.target_id }); await commands.approvePlan(pid, plan.plan_id); return commands.listCandidates(pid, target.target_id)[0] }
    const first = await propose()
    commands.syncEditorDraft(pid, { ...target, name: '人工名称' })
    assert.equal(commands.applyCandidate(pid, first.candidate_id).status, 'applied')
    let current = commands.getDraft(pid, target.target_id).target
    assert.equal(current.name, '人工名称'); assert.equal(current.description, 'Agent 说明')
    assert.equal(store.getTarget(pid, target.target_id)!.description, '基线说明')
    console.log('PASS independent fields merge without losing either edit or saving definition')
    patch = { description: 'Agent 第二说明', url: 'https://example.invalid/agent' }
    const second = await propose()
    commands.syncEditorDraft(pid, { ...current, description: '人工第二说明' })
    const conflict = commands.applyCandidate(pid, second.candidate_id)
    assert.equal(conflict.status, 'conflict')
    assert.equal(conflict.merge!.conflicts.length, 1)
    assert.equal(conflict.merge!.result.url, 'https://example.invalid/agent')
    assert.equal(conflict.merge!.result.description, '人工第二说明')
    assert.throws(() => store.saveTarget(pid, commands.getDraft(pid, target.target_id).target), /冲突/)
    const choices = { [conflict.merge!.conflicts[0].id]: 'agent' as const }
    const resolved = commands.resolveCandidate(pid, second.candidate_id, conflict.merge!.review_id, choices)
    assert.equal(resolved.status, 'applied')
    assert.equal(commands.getDraft(pid, target.target_id).target.description, 'Agent 第二说明')
    assert.deepEqual(resolved.proposal, second.proposal)
    console.log('PASS four-way conflict review blocks formal save and explicit choice applies only the conflict')
    current = commands.getDraft(pid, target.target_id).target
    patch = { request: { query: { parameter: [{ ...current.request!.query.parameter[0], description: 'Agent 参数说明' }] } } }
    const renamed = await propose()
    const manual = structuredClone(current); manual.request!.query.parameter[0].key = 'renamed'; commands.syncEditorDraft(pid, manual)
    assert.equal(commands.applyCandidate(pid, renamed.candidate_id).status, 'applied')
    const param = commands.getDraft(pid, target.target_id).target.request!.query.parameter[0]
    assert.equal(param.key, 'renamed'); assert.equal(param.description, 'Agent 参数说明'); assert.equal(param.param_id, 'stable')
    console.log('PASS stable parameter IDs preserve rename and merge independent fields')
    current = commands.getDraft(pid, target.target_id).target
    patch = { request: { body: { raw: '{"agent":1}' }, pre_script: 'agent();\nnext();' } }
    const strings = await propose()
    const edited = structuredClone(current); edited.request!.body.raw = '{"human":1}'; edited.request!.pre_script = 'human();\nnext();'; commands.syncEditorDraft(pid, edited)
    const atomic = commands.applyCandidate(pid, strings.candidate_id)
    assert.deepEqual(atomic.merge!.conflicts.map(c => c.path).sort(), ['/request/body/raw', '/request/pre_script'])
    const later = structuredClone(commands.getDraft(pid, target.target_id).target); later.name = '审阅期间人工名称'; commands.syncEditorDraft(pid, later)
    const stale = commands.resolveCandidate(pid, strings.candidate_id, atomic.merge!.review_id, Object.fromEntries(atomic.merge!.conflicts.map(c => [c.id, 'agent' as const])))
    assert.equal(stale.status, 'conflict'); assert.notEqual(stale.merge!.review_id, atomic.merge!.review_id)
    assert.equal(commands.getDraft(pid, target.target_id).target.name, '审阅期间人工名称')
    const chosen = commands.resolveCandidate(pid, strings.candidate_id, stale.merge!.review_id, Object.fromEntries(stale.merge!.conflicts.map(c => [c.id, c.path.endsWith('/raw') ? 'current' as const : 'agent' as const])))
    assert.equal(chosen.status, 'applied')
    assert.equal(chosen.merge!.result.request!.body.raw, '{"human":1}')
    assert.equal(chosen.merge!.result.request!.pre_script, 'agent();\nnext();')
    current = commands.getDraft(pid, target.target_id).target
    current.request!.query.parameter.push({ param_id: 'second', key: 'second', value: '2', is_checked: 1 } as any)
    commands.syncEditorDraft(pid, current)
    patch = { request: { query: { parameter: current.request!.query.parameter.map(p => p.param_id === 'stable' ? { ...p, value: 'agent-value' } : p) } } }
    const order = await propose()
    const reversed = structuredClone(current); reversed.request!.query.parameter.reverse(); commands.syncEditorDraft(pid, reversed)
    const orderConflict = commands.applyCandidate(pid, order.candidate_id)
    assert(orderConflict.merge!.conflicts.some(c => c.reason === 'order'))
    const ordered = commands.resolveCandidate(pid, order.candidate_id, orderConflict.merge!.review_id, Object.fromEntries(orderConflict.merge!.conflicts.map(c => [c.id, 'current' as const])))
    assert.deepEqual(ordered.merge!.result.request!.query.parameter.map(p => p.param_id), ['second', 'stable'])
    assert.equal(ordered.merge!.result.request!.query.parameter[1].value, 'agent-value')
    assert.doesNotThrow(() => store.saveTarget(pid, commands.getDraft(pid, target.target_id).target))
    console.log('PASS atomic raw/script choices, stale review rejection, conservative order conflict and save after resolution')

  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
