import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'
import { createFlow, createFlowEvent, createRequest } from '../src/shared/factories'
import { runFlow } from '../src/main/flow/engine'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-19-'))); await app.whenReady()
  const pid = store.ensureDefaultProject().project_id, env = store.listEnvironments(pid)[0]
  env.env_var_list.token = { current_value: 'initial-secret', initial_value: '', is_checked: 1 }; store.saveEnvironment(pid, env)
  const hits: Array<{ url?: string; auth?: string; body: string; parent?: string | string[]; global?: string | string[] }> = []
  let afterHit: (() => void) | undefined
  const api = http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; hits.push({ url: req.url, auth: req.headers.authorization, body, parent: req.headers['x-parent'], global: req.headers['x-global'] }); afterHit?.(); if (req.url === '/drop') { req.socket.destroy(); return } if (req.url === '/hang') return; res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}') })
  await new Promise<void>(r => api.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${(api.address() as any).port}`
  const a = store.createTargetInProject(pid, '0', 'api'), b = store.createTargetInProject(pid, '0', 'api')
  a.url = `${base}/first`; a.request!.test = "pm.environment.set('token', 'flow-token-secret')"; store.saveTarget(pid, a)
  b.url = `${base}/second`; b.request!.auth = { type: 'bearer', bearer: { key: '{{token}}' } }; store.saveTarget(pid, b)
  const flow = createFlow(pid, '跨接口草稿'); flow.env_id = 'ignored-flow-env'; flow.events = [a, b].map(t => ({ ...createFlowEvent('api'), target_id: t.target_id })); store.saveFlow(pid, flow)
  const models: unknown[] = []
  let forcedCalls: Array<{ name: string; args: unknown }> | undefined
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol); models.push(body)
    const name = body.tools?.find((t: any) => t.function.name === 'execute_flow')?.function.name ?? body.tools?.[0]?.function.name
    if (forcedCalls && name && name !== 'kindra_capability_probe') { respondModel(res, protocol, body.stream, { tool_calls: forcedCalls.map((c, i) => ({ id: `call-${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }); return }
    respondModel(res, protocol, body.stream, name ? { tool_calls: [{ id: 'call1', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, flow_id: flow.flow_id, depends_on: [] }) } }] } : { content: '完成Flow' })
  }); await new Promise<void>(r => model.listen(0, '127.0.0.1', r))
  try {
    await commands.saveConnection({ name: 'flow', base_url: `http://127.0.0.1:${(model.address() as any).port}/v1`, model: 'flow', protocol }); await commands.testConnection()
    const plan = await commands.proposeExecutePlan(pid, { goal: '跨接口执行', targetId: '', flowIds: [flow.flow_id], environmentId: env.env_id })
    assert.equal(plan.status, 'pending'); assert.equal(hits.length, 0)
    assert(JSON.stringify(plan.steps[0].execution).includes('后置脚本 SHA256'))
    const done = await commands.approvePlan(pid, plan.plan_id)
    assert.equal(done.status, 'completed', JSON.stringify(done)); assert.deepEqual(hits.map(h => h.url), ['/first', '/second']); assert.equal(hits[1].auth, 'Bearer flow-token-secret')
    assert.equal((done.steps[0].result as any).env_id, env.env_id)
    assert.equal(store.listEnvironments(pid)[0].env_var_list.token.current_value, 'initial-secret')
    assert.equal(store.listFlowRuns(pid).length, 0)
    for (const secret of ['initial-secret', 'flow-token-secret']) { assert(!JSON.stringify(models).includes(secret)); assert(!JSON.stringify(commands.listPlans(pid)).includes(secret)) }
    const parent = store.createTargetInProject(pid, '0', 'folder'); parent.request = createRequest()
    parent.request.header.parameter = [{ param_id: 'parent', key: 'X-Parent', value: 'original-parent', is_checked: 1 }]; store.saveTarget(pid, parent)
    const defaults = store.getGlobalParams(pid); defaults.header.parameter = [{ param_id: 'global', key: 'X-Global', value: 'original-global', is_checked: 1 }]; store.saveGlobalParams(pid, defaults)
    const dataModel = store.createModelInProject(pid, '0', 'model'); dataModel.data.schema = { type: 'object', properties: { phase: { type: 'string', example: 'original-model' } } }; store.saveModel(pid, dataModel)
    b.parent_id = parent.target_id; b.method = 'POST'; b.request!.body = { mode: 'json', model_id: dataModel.model_id, raw: 'stale preview' }; store.saveTarget(pid, b)
    const draft = structuredClone(flow); draft.events[0].name = '未保存草稿节点'; draft.events[1].input = { query: { stage: 'approved' } }; commands.syncFlowEditorDraft(pid, draft)
    const propose = (execution = {}) => commands.proposeExecutePlan(pid, { goal: '执行固定草稿', targetId: '', flowIds: [flow.flow_id], environmentId: env.env_id, execution })
    const frozen = await propose()
    let changed = false
    afterHit = () => { if (changed) return; changed = true; dataModel.data.schema.properties!.phase.example = 'changed-model'; store.saveModel(pid, dataModel); parent.request!.header.parameter[0].value = 'changed-parent'; store.saveTarget(pid, parent); defaults.header.parameter[0].value = 'changed-global'; store.saveGlobalParams(pid, defaults) }
    const settings = store.getSettings(); store.saveSettings({ ...settings, send_timeout: 1 })
    assert.equal((await commands.approvePlan(pid, frozen.plan_id)).status, 'completed'); store.saveSettings(settings); afterHit = undefined
    assert.equal(hits.at(-1)!.url, '/second?stage=approved'); assert.equal(hits.at(-1)!.parent, 'original-parent'); assert.equal(hits.at(-1)!.global, 'original-global'); assert.deepEqual(JSON.parse(hits.at(-1)!.body), { phase: 'original-model' })
    const fresh = await propose(); assert.equal((await commands.approvePlan(pid, fresh.plan_id)).status, 'completed'); assert.deepEqual(JSON.parse(hits.at(-1)!.body), { phase: 'changed-model' }); assert.equal(hits.at(-1)!.parent, 'changed-parent')
    assert.equal(store.getTarget(pid, b.target_id)!.request!.body.model_id, dataModel.model_id); assert.equal(store.getFlow(pid, flow.flow_id)!.events[0].name, flow.events[0].name)
    const write = await propose({ writeVariables: true }); assert.equal((await commands.approvePlan(pid, write.plan_id)).status, 'completed'); assert.equal(store.listEnvironments(pid)[0].env_var_list.token.current_value, 'flow-token-secret')
    env.env_var_list.token.current_value = 'before-conflict'; store.saveEnvironment(pid, env)
    const conflict = await propose({ writeVariables: true }); afterHit = () => { const current = store.listEnvironments(pid)[0]; current.env_var_list.token.current_value = 'manual-change'; store.saveEnvironment(pid, current) }
    const conflictDone = await commands.approvePlan(pid, conflict.plan_id); afterHit = undefined
    assert.equal(conflictDone.steps[0].status, 'paused'); assert.match(conflictDone.steps[0].error!, /外部修改/); assert.equal(store.listEnvironments(pid)[0].env_var_list.token.current_value, 'manual-change')
    for (const secret of ['initial-secret', 'flow-token-secret', 'manual-change', 'before-conflict']) { assert(!JSON.stringify(models).includes(secret)); assert(!JSON.stringify(commands.listPlans(pid)).includes(secret)) }
    const reset = () => { commands.syncFlowEditorDraft(pid, draft); store.saveTarget(pid, a); store.saveTarget(pid, b); store.saveEnvironment(pid, env) }
    reset()
    const deleting = await propose(); const deleteCount = hits.length
    afterHit = () => store.deleteEnvironment(pid, env.env_id)
    const deleted = await commands.approvePlan(pid, deleting.plan_id); afterHit = undefined
    assert.equal(deleted.steps[0].status, 'paused'); assert.equal(hits.length, deleteCount + 1)
    reset()
    const mutated = await propose(); const mutationCount = hits.length
    afterHit = () => { const changed = structuredClone(b); changed.request!.pre_script = "pm.sendRequest('http://127.0.0.1:1/forbidden')"; store.saveTarget(pid, changed) }
    const mutationDone = await commands.approvePlan(pid, mutated.plan_id); afterHit = undefined
    assert.equal(mutationDone.steps[0].status, 'paused'); assert.equal(hits.length, mutationCount + 1)
    reset()
    const failing = structuredClone(draft); failing.events[0].assertions = [{ assert_id: 'wrong-status', type: 'status', expected: 201 }]; commands.syncFlowEditorDraft(pid, failing)
    const failedPlan = await propose(); const failedCount = hits.length; const failed = await commands.approvePlan(pid, failedPlan.plan_id)
    assert.equal(failed.steps[0].status, 'failed'); assert.equal(hits.length, failedCount + 1); assert.equal((failed.steps[0].result as any).events[1].status, 'paused')
    reset(); const dropped = structuredClone(a); dropped.url = `${base}/drop`; store.saveTarget(pid, dropped)
    const dropPlan = await propose(); const dropCount = hits.length; const drop = await commands.approvePlan(pid, dropPlan.plan_id)
    assert.equal(drop.steps[0].status, 'unknown'); assert.equal(hits.length, dropCount + 1); assert.equal((drop.steps[0].result as any).events[1].status, 'paused')
    await assert.rejects(commands.approvePlan(pid, dropPlan.plan_id)); assert.equal(hits.length, dropCount + 1)
    reset(); const hanging = structuredClone(a); hanging.url = `${base}/hang`; store.saveTarget(pid, hanging)
    const hangPlan = await propose(); afterHit = () => commands.cancelPlan(pid, hangPlan.plan_id)
    const hangCount = hits.length; const hang = await commands.approvePlan(pid, hangPlan.plan_id); afterHit = undefined
    assert.equal(hang.steps[0].status, 'unknown'); assert.equal(hits.length, hangCount + 1)
    reset(); const waiting = structuredClone(draft); waiting.events.unshift({ ...createFlowEvent('wait'), wait_ms: 30000 }); commands.syncFlowEditorDraft(pid, waiting)
    const waitPlan = await propose(), waitCount = hits.length; const waitRun = commands.approvePlan(pid, waitPlan.plan_id); commands.cancelPlan(pid, waitPlan.plan_id)
    const cancelled = await waitRun; assert.equal(cancelled.steps[0].status, 'cancelled'); assert.equal(hits.length, waitCount)
    reset()
    for (const type of ['if', 'script'] as const) {
      const unsafe = structuredClone(draft); unsafe.events.unshift({ ...createFlowEvent(type), script: "this.constructor.constructor('return typeof process')()", condition: "Boolean.constructor('return typeof process')()" }); commands.syncFlowEditorDraft(pid, unsafe)
      const unsafeCount = hits.length, unsafePlan = await propose(); assert.equal((await commands.approvePlan(pid, unsafePlan.plan_id)).steps[0].status, 'failed'); assert.equal(hits.length, unsafeCount)
    }
    reset(); const manual = createFlow(pid, '手动报告'); manual.events = [{ ...createFlowEvent('wait'), wait_ms: 0 }]; await runFlow(pid, manual)
    assert.equal(store.listFlowRuns(pid).length, 1); const local = await propose(); await commands.approvePlan(pid, local.plan_id); assert.equal(store.listFlowRuns(pid).length, 1)
    reset()
    const inline = structuredClone(draft); inline.events = [{ ...createFlowEvent('request'), method: 'POST', url: `${base}/inline`, body: 'approved-body', input: { query: { mode: 'snapshot' } } }, ...draft.events]
    commands.syncFlowEditorDraft(pid, inline); const inlinePlan = await propose(); const inlineCount = hits.length
    assert.equal((await commands.approvePlan(pid, inlinePlan.plan_id)).status, 'completed'); assert.equal(hits[inlineCount].url, '/inline?mode=snapshot'); assert.equal(hits[inlineCount].body, 'approved-body')
    reset(); const changedFlow = await propose(); commands.syncFlowEditorDraft(pid, inline); const flowCount = hits.length
    const changedFlowDone = await commands.approvePlan(pid, changedFlow.plan_id); assert.equal(changedFlowDone.steps[0].status, 'paused'); assert.equal(hits.length, flowCount)
    reset(); const scripted = structuredClone(a); scripted.request!.pre_script = `pm.sendRequest('${base}/extra')`; store.saveTarget(pid, scripted)
    const deniedExtra = await propose(); const deniedCount = hits.length; const deniedExtraDone = await commands.approvePlan(pid, deniedExtra.plan_id)
    assert.equal(deniedExtraDone.steps[0].status, 'paused'); assert.equal(hits.length, deniedCount)
    const allowedExtra = await propose({ requests: [{ method: 'GET', url: `${base}/extra`, maxCalls: 1 }] }); const extraCount = hits.length
    assert.equal((await commands.approvePlan(pid, allowedExtra.plan_id)).status, 'completed'); assert.deepEqual(hits.slice(extraCount).map(h => h.url), ['/extra', '/first', '/second?stage=approved'])
    reset(); const upload = path.join(app.getPath('userData'), 'flow-upload.txt'); fs.writeFileSync(upload, 'approved-upload')
    const uploading = structuredClone(b); uploading.request!.body = { mode: 'binary', binary: { file_path: upload, file_name: 'flow-upload.txt', content_type: 'text/plain' } }; store.saveTarget(pid, uploading)
    const uploadPlan = await propose(); assert(JSON.stringify(uploadPlan.steps[0].execution).includes('flow-upload.txt')); assert.equal((await commands.approvePlan(pid, uploadPlan.plan_id)).status, 'completed'); assert.equal(hits.at(-1)!.body, 'approved-upload')
    const changedFile = await propose(); fs.writeFileSync(upload, 'changed-upload'); const fileCount = hits.length; const changedFileDone = await commands.approvePlan(pid, changedFile.plan_id)
    assert.equal(changedFileDone.steps[0].status, 'paused'); assert.equal(hits.length, fileCount + 1)
    reset(); commands.syncFlowEditorDraft(pid, failing)
    const independent = store.createTargetInProject(pid, '0', 'api'); independent.url = `${base}/independent`; store.saveTarget(pid, independent)
    forcedCalls = [{ name: 'execute_flow', args: { project_id: pid, flow_id: flow.flow_id, step_id: 'flow', depends_on: [] } }, { name: 'execute_api', args: { project_id: pid, target_id: independent.target_id, step_id: 'independent', depends_on: [] } }, { name: 'execute_flow', args: { project_id: pid, flow_id: flow.flow_id, step_id: 'dependent', depends_on: ['flow'] } }]
    const mixed = await commands.proposeExecutePlan(pid, { goal: '失败后独立计划步骤继续', targetId: independent.target_id, flowIds: [flow.flow_id], environmentId: env.env_id }); const mixedCount = hits.length
    const mixedDone = await commands.approvePlan(pid, mixed.plan_id); forcedCalls = undefined
    assert.deepEqual(mixedDone.steps.map(s => s.status), ['failed', 'succeeded', 'paused']); assert.deepEqual(hits.slice(mixedCount).map(h => h.url), ['/first', '/independent'])
    const files = fs.readdirSync(path.join(store.getPaths().projectRoot, pid), { recursive: true }) as string[]
    assert(!files.some(name => name.includes('agent') || name.includes(mixed.plan_id)), 'Agent plans and reports stay outside project directory')
    reset(); const queryAuth = structuredClone(b); queryAuth.request!.auth = { type: 'kv', kv: { in: 'query', key: 'opaque', value: 'flow-auth-secret' } }; store.saveTarget(pid, queryAuth)
    const secretPlan = await propose(); assert(!JSON.stringify(secretPlan).includes('flow-auth-secret'), 'Flow node credentials must be redacted from approval and disk')
    const secretDone = await commands.approvePlan(pid, secretPlan.plan_id); assert.equal(secretDone.status, 'completed'); assert(hits.at(-1)!.url!.includes('opaque=flow-auth-secret')); assert(!JSON.stringify(secretDone).includes('flow-auth-secret')); assert(!JSON.stringify(models).includes('flow-auth-secret'))
    console.log(protocol, 'PASS Flow approved execution, same environment, variable evolution, local-only reports')
  } finally { model.closeAllConnections(); api.closeAllConnections(); await Promise.all([new Promise<void>(r => model.close(() => r())), new Promise<void>(r => api.close(() => r()))]) }
}
main().then(() => app.exit(0)).catch(e => { console.error(e); app.exit(1) })
