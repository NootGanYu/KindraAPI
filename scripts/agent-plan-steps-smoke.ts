import { decodeModelRequest, respondModel } from './agent-model-fixture'
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands } from '../src/main/agent/service'
import { onPlanEvent } from '../src/main/agent/plans'

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-steps-')))
  await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const targets = ['用户资料', '订单详情', '统计报表'].map(name => {
    const target = store.createTargetInProject(pid, '0', 'api')
    target.name = name; target.description = `${name}已保存内容`; store.saveTarget(pid, target); return target
  })
  let calls = targets.map((target, index) => ({ id: `call-${index}`, type: 'function', function: { name: 'read_api', arguments: JSON.stringify({ project_id: pid, target_id: target.target_id, step_id: `s${index}`, depends_on: index ? [`s${index-1}`] : [] }) } }))
  const inputs: any[] = []
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol); inputs.push(body)
    const probe = body.tools?.[0]?.function.name === 'kindra_capability_probe'
    const message = probe ? { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }
      : body.tools ? { tool_calls: calls } : { content: body.messages.some((m: any) => m.role === 'tool') ? '按已批准步骤完成读取汇总。' : 'OK' }
    respondModel(res, protocol, body.stream, message)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const connection = await agentCommands.createConnection({ name: '多步骤模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'steps', protocol })
    agentCommands.setProjectConnection(pid, connection.connection_id); await agentCommands.testConnection(connection.connection_id)
    const draft = structuredClone(targets[1]); draft.description = '订单未保存草稿'
    const plan = await agentCommands.proposeReadPlan(pid, { goal: '按顺序解释三个接口', targetId: targets[0].target_id, targetIds: targets.map(t => t.target_id), drafts: { [draft.target_id]: draft } })
    assert.equal(plan.status, 'pending'); assert.equal(plan.steps.length, 3)
    assert.deepEqual(plan.steps.map(step => step.depends_on), [[], ['s0'], ['s1']])
    assert(!JSON.stringify(inputs).includes('已保存内容'))
    const order: string[] = []
    const off = onPlanEvent(event => { for (const step of event.plan?.steps ?? []) if (step.status === 'running') order.push(step.step_id) })
    const result = await agentCommands.approvePlan(pid, plan.plan_id); off()
    assert.equal(result.status, 'completed')
    assert.deepEqual(order, ['s0', 's1', 's2'])
    assert(result.steps.every(step => step.status === 'succeeded'))
    assert.equal(result.explanation, '按已批准步骤完成读取汇总。')
    const returned = inputs.flatMap(body => body.messages).filter((message: any) => message.role === 'tool')
    assert.equal(returned.length, 3)
    assert(returned[1].content.includes('订单未保存草稿'))
    assert.equal(store.getTarget(pid, draft.target_id)!.description, '订单详情已保存内容')
    await assert.rejects(() => agentCommands.approvePlan(pid, plan.plan_id), /批准/)
    assert.equal(inputs.flatMap(body => body.messages).filter((message: any) => message.role === 'tool').length, 3)
    console.log('PASS one approval executes ordered reads and returns draft-aware summary without replay or saving')
    calls = [
      { step_id: 'failed', target_id: targets[0].target_id, depends_on: [] },
      { step_id: 'dependent', target_id: targets[1].target_id, depends_on: ['failed'] },
      { step_id: 'independent', target_id: targets[2].target_id, depends_on: [] },
      { step_id: 'unknown', target_id: targets[1].target_id },
      { step_id: 'missing', target_id: targets[1].target_id, depends_on: ['not-declared'] },
      { step_id: 'cycle-a', target_id: targets[1].target_id, depends_on: ['cycle-b'] },
      { step_id: 'cycle-b', target_id: targets[1].target_id, depends_on: ['cycle-a'] }
    ].map((step, index) => ({ id: `failure-call-${index}`, type: 'function', function: { name: 'read_api', arguments: JSON.stringify({ project_id: pid, ...step }) } }))
    const partial = await agentCommands.proposeReadPlan(pid, { goal: '读取并汇总', targetId: targets[0].target_id, targetIds: targets.map(t => t.target_id) })
    assert.equal(partial.status, 'pending')
    assert.equal(partial.steps[3].dependencies_explicit, false)
    store.deleteTarget(pid, targets[0].target_id)
    const outcome = await agentCommands.approvePlan(pid, partial.plan_id)
    assert.equal(outcome.status, 'paused')
    assert.deepEqual(outcome.steps.map(step => step.status), ['failed', 'paused', 'succeeded', 'paused', 'paused', 'paused', 'paused'])
    assert.equal((outcome.steps[2].result as any).api.name, '统计报表')
    assert(outcome.steps[1].error!.includes('依赖'))
    assert(outcome.steps[4].error!.includes('未知'))
    assert(outcome.steps[5].error!.includes('循环'))
    assert.equal(outcome.explanation, '按已批准步骤完成读取汇总。')
    await assert.rejects(() => agentCommands.approvePlan(pid, partial.plan_id), /批准/)
    assert.equal(agentCommands.getPlan(pid, partial.plan_id).steps[2].status, 'succeeded')
    console.log('PASS failed objects and dependencies pause; explicit independent read survives; omitted/missing/cyclic dependencies fail closed')
    const remaining = targets.slice(1).map(target => target.target_id)
    calls = [
      { step_id: 'later', target_id: remaining[0], depends_on: ['first'] },
      { step_id: 'first', target_id: remaining[1], depends_on: [] }
    ].map((step, index) => ({ id: `order-${index}`, type: 'function', function: { name: 'read_api', arguments: JSON.stringify({ project_id: pid, ...step }) } }))
    const topological = await agentCommands.proposeReadPlan(pid, { goal: '按照依赖读取', targetId: remaining[0], targetIds: remaining })
    const actualOrder: string[] = []
    const stop = onPlanEvent(event => { for (const step of event.plan?.steps ?? []) if (step.status === 'running') actualOrder.push(step.step_id) })
    assert.equal((await agentCommands.approvePlan(pid, topological.plan_id)).status, 'completed'); stop()
    assert.deepEqual(actualOrder, ['first', 'later'])
    calls = [{ id: 'escape', type: 'function', function: { name: 'read_api', arguments: JSON.stringify({ project_id: pid, target_id: 'unapproved-object', step_id: 'escape', depends_on: [] }) } }]
    const escaped = await agentCommands.proposeReadPlan(pid, { goal: '不得扩展范围', targetId: remaining[0], targetIds: remaining })
    assert.equal(escaped.status, 'paused'); assert.match(escaped.error!, /超出/)
    await assert.rejects(() => agentCommands.approvePlan(pid, escaped.plan_id), /批准/)
    console.log('PASS graph order follows dependencies and expanded objects require a new approval')


  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
