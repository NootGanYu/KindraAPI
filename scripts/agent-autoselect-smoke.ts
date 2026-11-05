/** Natural-language object selection, validation boundaries and create_api in continuous tasks. */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createFlow, createFlowEvent, createRequest } from '../src/shared/factories'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'
import { decodeModelRequest, respondModel } from './agent-model-fixture'

const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
let pid = '', aId = '', bId = '', flowId = '', createId = ''
let scenario: 'read' | 'unknown' | 'wrong-type' | 'empty' | 'chat' | 'limit' | 'step-outside' | 'create' | 'create-forbidden' = 'read'
let patch: any = { name: '自然语言新接口', description: '用户明确要求的健康检查接口', method: 'GET', url: 'https://example.invalid/health' }
const planningBodies: any[] = []

function malformed(scenarioName: typeof scenario): any {
  if (scenarioName === 'unknown') return { selected_objects: [{ kind: 'api', id: 'outside-project' }], steps: [{ step_id: 'read-x', operation: 'read_api', target_id: 'outside-project', depends_on: [] }] }
  if (scenarioName === 'wrong-type') return { selected_objects: [{ kind: 'api', id: flowId }], steps: [{ step_id: 'read-x', operation: 'read_api', target_id: flowId, depends_on: [] }] }
  if (scenarioName === 'empty') return { selected_objects: [], steps: [] }
  if (scenarioName === 'limit') return { selected_objects: Array.from({ length: 33 }, (_, index) => ({ kind: 'api', id: `fake-${index}` })), steps: [{ step_id: 'read-x', operation: 'read_api', target_id: 'fake-0', depends_on: [] }] }
  if (scenarioName === 'step-outside') return { selected_objects: [{ kind: 'api', id: aId }], steps: [{ step_id: 'read-b', operation: 'read_api', target_id: bId, depends_on: [] }] }
  return {
    selected_objects: [{ kind: 'api', id: aId }, { kind: 'api', id: bId }],
    steps: [
      { step_id: 'read-a', operation: 'read_api', target_id: aId, depends_on: [] },
      { step_id: 'read-b', operation: 'read_api', target_id: bId, depends_on: [] }
    ]
  }
}

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-autoselect-')))
  await app.whenReady()
  pid = store.ensureDefaultProject().project_id
  const env = store.listEnvironments(pid)[0]
  const a = store.createTargetInProject(pid, '0', 'api'); a.name = '自动来源'; a.url = 'https://example.invalid/secret-a'; a.description = '不应发送的定义描述 A'; store.saveTarget(pid, a)
  const b = store.createTargetInProject(pid, '0', 'api'); b.name = '自动目标'; b.url = 'https://example.invalid/secret-b'; b.description = '不应发送的定义描述 B'; store.saveTarget(pid, b)
  const flow = createFlow(pid, '自动流程'); flow.description = '不应发送的 Flow 描述'; flow.events = [{ ...createFlowEvent('api'), event_id: 'event-secret', name: '不应发送的事件' } as any]; store.saveFlow(pid, flow)
  aId = a.target_id; bId = b.target_id; flowId = flow.flow_id
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol)
    const tools: string[] = (body.tools ?? []).map((tool: any) => tool.function.name)
    if (tools.includes('kindra_capability_probe')) { respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }); return }
    if (tools.includes('propose_task_plan')) {
      planningBodies.push(body)
      let planned: any
      if (scenario === 'chat') {
        planned = { answer: '你好！我可以帮你读取、修改和测试接口与 Flow。', steps: [] }
      } else if (scenario === 'create' || scenario === 'create-forbidden') {
        planned = {
          selected_objects: [],
          new_objects: [{ temp_id: 'new-api', name: '自然语言新接口', parent_id: '0', intent: '创建健康检查接口草稿' }],
          steps: [
            { step_id: 'create', operation: 'create_api', binding: 'deferred', target_id: 'new-api', intent: '创建健康检查接口草稿', depends_on: [] }
          ]
        }
      } else planned = malformed(scenario)
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify(planned) } }] })
      return
    }
    if (tools.includes('create_api') && (scenario === 'create' || scenario === 'create-forbidden')) {
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'create-call', type: 'function', function: { name: 'create_api', arguments: JSON.stringify({ project_id: pid, target_id: createId, step_id: 'create', depends_on: [], patch }) } }] })
      return
    }
    respondModel(res, protocol, body.stream, { content: '已按选择结果完成。' })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const connection = await commands.createConnection({ name: '自动选择模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'autoselect', protocol })
    await commands.setProjectConnection(pid, connection.connection_id)
    await commands.testConnection(connection.connection_id)

    const plan = await commands.proposeTaskPlan(pid, { goal: '解释自动来源和自动目标', selection: 'auto', permission_mode: 'ask', activeTargetId: aId, environmentId: env.env_id })
    assert.equal(plan.status, 'completed', plan.error)
    assert.equal(plan.selection_source, 'auto')
    assert.equal(plan.permission_mode, 'ask')
    assert.deepEqual(plan.target_ids?.sort(), [aId, bId].sort())
    assert.equal(plan.approval_revision, 1, 'server approval still uses the normal approval revision')
    const planning = JSON.stringify(planningBodies[0])
    assert(!planning.includes('secret-a') && !planning.includes('secret-b'), 'planning directory must not contain target URLs')
    assert(!planning.includes('不应发送的定义描述'), 'planning directory must not contain descriptions')
    assert(!planning.includes('不应发送的 Flow 描述') && !planning.includes('不应发送的事件'), 'planning directory must not contain flow events or descriptions')
    assert(planning.includes('自动来源') && planning.includes(aId), `directory carries only ids, names, methods and types: ${planning.slice(0, 2500)}`)
    assert(planning.includes(env.env_id) && planning.includes(env.name), 'environment metadata is available for selection')
    assert(planning.includes('active_target_id'), 'active object is part of the planning contract')
    console.log('PASS auto selection uses a redacted project directory and read-only ask plans auto-execute')

    for (const [name, message] of [
      ['unknown', /不存在|不属于|项目/],
      ['wrong-type', /不存在|类型|接口/],
      ['empty', /选择|对象/],
      ['limit', /32|选择/],
      ['step-outside', /超出|选择/]
    ] as const) {
      scenario = name
      const failed = await commands.proposeTaskPlan(pid, { goal: '越界测试', selection: 'auto', permission_mode: 'ask' })
      assert.equal(failed.status, 'paused', `${name} must pause without executing`)
      assert.match(failed.error ?? '', message, `${name} error must explain the rejected selection`)
      assert.equal(failed.steps.length, 0, `${name} must not execute or materialize steps`)
      assert.equal(commands.listCandidates(pid).length, 0, `${name} must not create candidates`)
    }
    console.log('PASS unknown, wrong-type, empty, oversized and step-outside selections pause with zero side effects')

    scenario = 'chat'
    const chat = await commands.proposeTaskPlan(pid, { goal: '你好', selection: 'auto', permission_mode: 'ask' })
    assert.equal(chat.status, 'completed', chat.error)
    assert.equal(chat.steps.length, 0, 'a conversational turn must not invent slots')
    assert.match(chat.explanation ?? '', /你好/)
    assert.equal(commands.listCandidates(pid).length, 0, 'a conversational answer has no side effects')
    console.log('PASS conversational turn answers directly without inventing slots')

    scenario = 'create'
    const created = await commands.proposeTaskPlan(pid, { goal: '新建一个健康检查接口并保存', selection: 'auto', permission_mode: 'ask', allowCreate: true })
    assert.equal(created.status, 'pending', created.error)
    assert.equal(created.selection_source, 'auto')
    assert(created.targets?.some(target => target.new_object === true))
    createId = created.targets!.find(target => target.new_object)!.target_id
    assert.equal(store.getTarget(pid, createId), null)
    assert.equal(commands.listCandidates(pid).length, 0, 'creating a plan has no side effect before approval')
    const approved = await commands.approvePlan(pid, created.plan_id, created.approval_revision)
    assert.equal(approved.status, 'completed', approved.error)
    assert.equal(store.getTarget(pid, createId), null, 'create_api only creates a local draft')
    assert.equal(commands.getDraft(pid, createId).target.name, patch.name)
    assert(commands.listCandidates(pid).some(candidate => candidate.target_id === createId))
    console.log('PASS create_api is planned, approved and executed as a recoverable local draft')

    scenario = 'create-forbidden'
    const forbidden = await commands.proposeTaskPlan(pid, { goal: '新建接口', selection: 'auto', permission_mode: 'ask', allowCreate: false })
    assert.equal(forbidden.status, 'paused')
    assert.match(forbidden.error ?? '', /新建|创建|允许/)
    assert.equal(commands.listCandidates(pid).length, 1, 'forbidden creation performs no additional side effect')
    console.log('PASS create_api is rejected when the caller disallows new objects')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
