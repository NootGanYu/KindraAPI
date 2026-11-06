/** Three server-enforced permission modes across read, draft, execute, effects, save and create operations. */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'
import { decodeModelRequest, respondModel } from './agent-model-fixture'

const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
type Mode = 'ask' | 'auto' | 'bypass'
type Scenario = 'read' | 'propose' | 'apply' | 'execute' | 'effects' | 'save' | 'create' | 'scope'
let pid = '', aId = '', bId = '', origin = ''
let scenario: Scenario = 'read'
let mode: Mode = 'ask'
let hits: string[] = []
const planningBodies: any[] = []

function planFor(modeName: Mode): any {
  const readA = { step_id: 'read-a', operation: 'read_api', binding: 'static', target_id: aId, depends_on: [] }
  if (scenario === 'read') return { selected_objects: [{ kind: 'api', id: aId }], steps: [readA] }
  if (scenario === 'scope') return { selected_objects: [{ kind: 'api', id: aId }], steps: [{ step_id: 'read-b', operation: 'read_api', target_id: bId, depends_on: [] }] }
  if (scenario === 'execute') return { selected_objects: [{ kind: 'api', id: aId }], steps: [{ step_id: 'run-a', operation: 'execute_api', binding: 'static', target_id: aId, depends_on: [] }] }
  if (scenario === 'effects') return {
    selected_objects: [{ kind: 'api', id: aId }],
    proposed_effects: { extra_requests: [{ method: 'GET', url: `${origin}/login`, maxCalls: 1 }], write_variables: false, save_response: false },
    steps: [{ step_id: 'run-a', operation: 'execute_api', binding: 'static', target_id: aId, depends_on: [] }]
  }
  if (scenario === 'propose') return { selected_objects: [{ kind: 'api', id: aId }], steps: [{ step_id: 'derive', operation: 'propose_api_change', binding: 'deferred', target_id: aId, depends_on: [], intent: '修改说明', allowed_changes: ['description'] }] }
  if (scenario === 'apply') return {
    selected_objects: [{ kind: 'api', id: aId }],
    steps: [
      { step_id: 'derive', operation: 'propose_api_change', binding: 'deferred', target_id: aId, depends_on: [], intent: '修改说明', allowed_changes: ['description'] },
      { step_id: 'apply', operation: 'apply_candidate', binding: 'static', kind: 'api', target_id: aId, depends_on: ['derive'], source_steps: ['derive'] }
    ]
  }
  if (scenario === 'save') return {
    selected_objects: [{ kind: 'api', id: aId }],
    proposed_effects: { save_definitions: true },
    steps: [
      { step_id: 'derive', operation: 'propose_api_change', binding: 'deferred', target_id: aId, depends_on: [], intent: '修改说明', allowed_changes: ['description'] },
      { step_id: 'save', operation: 'save_api', binding: 'static', target_id: aId, depends_on: ['derive'] }
    ]
  }
  return {
    selected_objects: [],
    new_objects: [{ temp_id: 'new-api', name: '权限新接口', parent_id: '0', intent: '创建草稿' }],
    proposed_effects: { save_definitions: true },
    steps: [
      { step_id: 'create', operation: 'create_api', binding: 'deferred', target_id: 'new-api', depends_on: [] },
      { step_id: 'save', operation: 'save_api', binding: 'static', target_id: 'new-api', depends_on: ['create'] }
    ]
  }
}

function approvedSlots(body: any): any[] {
  const message = body.messages.map((item: any) => { try { return JSON.parse(item.content) } catch { return null } }).filter(Boolean).find((value: any) => Array.isArray(value.approved_slots))
  return message?.approved_slots ?? []
}

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-permissions-')))
  await app.whenReady()
  pid = store.ensureDefaultProject().project_id
  const api = http.createServer((req, res) => { hits.push(req.url!); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}') })
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(api.address() as any).port}`
  const a = store.createTargetInProject(pid, '0', 'api'); a.name = '权限接口'; a.url = `${origin}/api`; store.saveTarget(pid, a)
  const b = store.createTargetInProject(pid, '0', 'api'); b.name = '范围外接口'; b.url = `${origin}/other`; store.saveTarget(pid, b)
  aId = a.target_id; bId = b.target_id
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol)
    const tools: string[] = (body.tools ?? []).map((tool: any) => tool.function.name)
    if (tools.includes('kindra_capability_probe')) { respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }); return }
    if (tools.includes('propose_task_plan')) {
      planningBodies.push(body)
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify(planFor(mode)) } }] })
      return
    }
    const slots = approvedSlots(body)
    const createSlot = slots.find(slot => slot.operation === 'create_api')
    if (createSlot && tools.includes('create_api')) {
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'create-call', type: 'function', function: { name: 'create_api', arguments: JSON.stringify({ project_id: pid, target_id: createSlot.target_id, step_id: createSlot.step_id, depends_on: [], patch: { name: '权限新接口', description: '权限测试创建', method: 'GET', url: `${origin}/created` } }) } }] })
      return
    }
    const deriveSlot = slots.find(slot => slot.operation === 'propose_api_change')
    if (deriveSlot && tools.includes('propose_api_change')) {
      const calls: any[] = [{ id: 'derive-call', type: 'function', function: { name: 'propose_api_change', arguments: JSON.stringify({ project_id: pid, target_id: deriveSlot.target_id, step_id: deriveSlot.step_id, depends_on: deriveSlot.depends_on, patch: { description: `权限模式 ${mode}` } }) } }]
      const applySlot = slots.find(slot => slot.operation === 'apply_candidate')
      if (applySlot) calls.push({ id: 'apply-call', type: 'function', function: { name: 'apply_candidate', arguments: JSON.stringify({ project_id: pid, step_id: applySlot.step_id, kind: 'api', target_id: applySlot.target_id, source_step: applySlot.source_steps[0], depends_on: applySlot.depends_on }) } })
      respondModel(res, protocol, body.stream, { tool_calls: calls })
      return
    }
    respondModel(res, protocol, body.stream, { content: `权限模式 ${mode} 已处理。` })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const connection = await commands.createConnection({ name: '权限模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'permissions', protocol })
    await commands.setProjectConnection(pid, connection.connection_id)
    await commands.testConnection(connection.connection_id)

    async function run(modeName: Mode, scenarioName: Scenario): Promise<{ status: string; error?: string; planId: string }> {
      mode = modeName; scenario = scenarioName; hits = []
      const current = commands.getDraft(pid, aId).target
      current.request!.pre_script = scenarioName === 'effects' ? `pm.sendRequest('${origin}/login', () => {});` : ''
      commands.syncEditorDraft(pid, current)
      const plan = await commands.proposeTaskPlan(pid, { goal: `${modeName} ${scenarioName}`, selection: 'auto', permission_mode: modeName })
      assert.equal(plan.permission_mode, modeName)
      return { status: plan.status, error: plan.error, planId: plan.plan_id }
    }

    for (const scenarioName of ['propose', 'apply', 'execute', 'effects', 'save', 'create'] as const) {
      const ask = await run('ask', scenarioName)
      assert.equal(ask.status, 'pending', `ask/${scenarioName} must wait for approval: ${ask.error ?? ''}`)
      assert.equal(hits.length, 0, `ask/${scenarioName} must not send HTTP before approval`)
    }
    const askRead = await run('ask', 'read')
    assert.equal(askRead.status, 'completed', askRead.error)
    console.log('PASS ask mode auto-runs reads and pauses every write/execute/effect/save/create plan')

    const autoPropose = await run('auto', 'propose'); assert.equal(autoPropose.status, 'completed', autoPropose.error)
    const autoApply = await run('auto', 'apply'); assert.equal(autoApply.status, 'completed', autoApply.error)
    assert.equal(commands.getDraft(pid, aId).target.description, '权限模式 auto', 'auto mode applies approved candidate drafts')
    for (const scenarioName of ['execute', 'effects', 'save', 'create'] as const) {
      const result = await run('auto', scenarioName)
      assert.equal(result.status, 'pending', `auto/${scenarioName} must wait for approval: ${result.error ?? ''}`)
    }
    assert.equal(hits.length, 0, 'auto mode never sends real network requests or saves')
    console.log('PASS auto mode auto-runs reads/proposals/local candidate application and pauses execute/effects/save/create')

    const bypassRead = await run('bypass', 'read'); assert.equal(bypassRead.status, 'completed', bypassRead.error)
    const bypassPropose = await run('bypass', 'propose'); assert.equal(bypassPropose.status, 'completed', bypassPropose.error)
    const bypassApply = await run('bypass', 'apply'); assert.equal(bypassApply.status, 'completed', bypassApply.error)
    const bypassExecute = await run('bypass', 'execute'); assert.equal(bypassExecute.status, 'completed', bypassExecute.error)
    assert(hits.includes('/api'), 'bypass mode executes the approved target once')
    const bypassEffects = await run('bypass', 'effects'); assert.equal(bypassEffects.status, 'completed', bypassEffects.error)
    assert(hits.includes('/login'), 'bypass mode authorizes proposed extra requests')
    const bypassSave = await run('bypass', 'save'); assert.equal(bypassSave.status, 'completed', bypassSave.error)
    assert.equal(store.getTarget(pid, aId)!.description, '权限模式 bypass', 'bypass mode formally saves approved changes')
    const bypassCreate = await run('bypass', 'create'); assert.equal(bypassCreate.status, 'completed', bypassCreate.error)
    assert(store.listTargets(pid).some(target => target.name === '权限新接口'), 'bypass mode creates and saves the proposed object')
    console.log('PASS bypass mode auto-runs read/draft/apply/execute/effects/save/create through the normal approval path')

    const scope = await run('bypass', 'scope')
    assert.equal(scope.status, 'paused')
    assert.match(scope.error ?? '', /超出|选择/)
    assert(!hits.includes('/other'), 'bypass still rejects targets outside the selected scope')
    const planning = JSON.stringify(planningBodies)
    assert(!planning.includes(`${origin}/api`) && !planning.includes(`${origin}/other`), 'all modes keep definitions and URLs out of the planning directory')
    console.log('PASS bypass keeps project/object scope and redaction guarantees')
  } finally { server.closeAllConnections(); api.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await new Promise<void>(resolve => api.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
