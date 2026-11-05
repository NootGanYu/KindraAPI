/** Postman history: set→console.log→unset inside one script must not reach projections. */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'
import { onPlanEvent } from '../src/main/agent/plans'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import { decodeModelRequest, respondModel } from './agent-model-fixture'

const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
const transient = 'postman-temporary-value'
const script = `pm.variables.set('z', ['postman', 'temporary', 'value'].join('-')); console.log(pm.variables.get('z')); pm.variables.unset('z')`

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-postman-history-')))
  await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const hits: string[] = []
  const api = http.createServer((req, res) => { hits.push(req.url!); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}') })
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(api.address() as any).port}`
  const target = store.createTargetInProject(pid, '0', 'api')
  target.url = `${origin}/api`
  target.request!.test = script
  target.cases = [{ case_id: 'case-history', name: '历史变量用例', is_enabled: 1, override: {}, assertions: [] }]
  store.saveTarget(pid, target)
  const flow = createFlow(pid, '历史变量 Flow')
  flow.events = [{ ...createFlowEvent('api'), target_id: target.target_id }]
  store.saveFlow(pid, flow)
  const models: unknown[] = [], events: unknown[] = []
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol)
    models.push(body)
    const name = body.tools?.find((tool: any) => ['execute_api', 'execute_api_case', 'execute_flow'].includes(tool.function.name))?.function.name ?? body.tools?.[0]?.function.name
    if (name === 'kindra_capability_probe') { respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'probe', type: 'function', function: { name, arguments: '{"token":"kindra-probe"}' } }] }); return }
    if (name) {
      const args = name === 'execute_flow' ? { project_id: pid, flow_id: flow.flow_id, step_id: 'flow', depends_on: [] }
        : name === 'execute_api_case' ? { project_id: pid, target_id: target.target_id, case_id: 'case-history', step_id: 'case', depends_on: [] }
          : { project_id: pid, target_id: target.target_id, step_id: 'api', depends_on: [] }
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
      return
    }
    respondModel(res, protocol, body.stream, { content: '已完成实际执行并使用脱敏报告。' })
  })
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))
  const off = onPlanEvent(event => events.push(event))
  try {
    await commands.saveConnection({ name: 'history', base_url: `http://127.0.0.1:${(model.address() as any).port}/v1`, model: 'history', protocol })
    await commands.testConnection()
    const plans = [
      await commands.proposeExecutePlan(pid, { goal: '执行接口', targetId: target.target_id }),
      await commands.proposeExecuteCasePlan(pid, { goal: '执行用例', targetId: target.target_id, caseIds: { [target.target_id]: ['case-history'] } }),
      await commands.proposeExecutePlan(pid, { goal: '执行 Flow', targetId: '', flowIds: [flow.flow_id] })
    ]
    for (const plan of plans) {
      assert.equal(plan.status, 'pending', JSON.stringify(plan))
      const done = await commands.approvePlan(pid, plan.plan_id)
      assert.equal(done.status, 'completed', JSON.stringify(done))
    }
    assert.deepEqual(hits, ['/api', '/api', '/api'])
    const projection = JSON.stringify({ models, events, plans: commands.listPlans(pid) })
    assert(!projection.includes(transient), 'Postman same-script set/log/unset historical value still leaks')
    console.log(protocol, 'PASS Postman historical set/log/unset stays out of model, plan, report and console projections for API, Case and Flow')
  } finally { off(); api.closeAllConnections(); model.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); await new Promise<void>(resolve => model.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
