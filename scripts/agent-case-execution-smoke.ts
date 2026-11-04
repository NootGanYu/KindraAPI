import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'
import { onPlanEvent } from '../src/main/agent/plans'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
import type { ApiCase } from '../src/shared/types'
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-case-execution-')))
  await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const target = store.createTargetInProject(pid, '0', 'api')
  const hits: any[] = [], received: any[] = [], events: any[] = []
  let calls: any[] = [], closed = false
  const api = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    hits.push({ url: req.url, method: req.method, body, auth: req.headers.authorization })
    if (req.url === '/drop') { req.socket.destroy(); return }
    if (req.url === '/hang') { res.once('close', () => { closed = true }); return }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, token: 'case-response-secret', auth: req.headers.authorization }))
  })
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(api.address() as any).port}`
  target.url = `${origin}/base`
  const apiCase: ApiCase = { case_id: 'case-one', name: '覆盖请求与断言', is_enabled: 1, override: { method: 'POST', url: `${origin}/case`, body_mode: 'raw', body: 'saved body' }, assertions: [{ assertion_id: 'ok', kind: 'json', path: '$.ok', op: 'equals', expected: 'true', is_enabled: 1 }] }
  target.cases = [apiCase]; store.saveTarget(pid, target)
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol); received.push(body)
    const name = body.tools?.[0]?.function.name
    respondModel(res, protocol, body.stream, name ? { tool_calls: (name === 'kindra_capability_probe' ? [{ token: 'kindra-probe' }] : calls).map((args, i) => ({ id: `call-${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } : { content: '用例断言与实际结果已分析。' })
  })
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))
  const off = onPlanEvent(event => events.push(event))
  try {
    await commands.saveConnection({ name: 'Case', base_url: `http://127.0.0.1:${(model.address() as any).port}/v1`, model: 'case', protocol }); await commands.testConnection()
    calls = [{ project_id: pid, target_id: target.target_id, case_id: apiCase.case_id, step_id: 'case', depends_on: [] }]
    const draft = structuredClone(target); draft.cases![0].override.body = 'draft body'; draft.request!.auth = { type: 'bearer', bearer: { key: 'case-auth-secret' } }
    const before = store.readTargetSnapshot(pid, target.target_id)
    const plan = await commands.proposeExecuteCasePlan(pid, { targetId: target.target_id, caseIds: { [target.target_id]: [apiCase.case_id] }, draft, goal: '执行草稿用例并分析' })
    assert.equal(plan.status, 'pending'); assert.equal(hits.length, 0)
    assert.equal(plan.steps[0].operation, 'execute_api_case'); assert.equal(plan.steps[0].case_id, apiCase.case_id)
    assert.equal(plan.steps[0].execution!.method, 'POST'); assert.equal(plan.steps[0].execution!.url, `${origin}/case`)
    draft.cases![0].override.body = 'later body'
    const done = await commands.approvePlan(pid, plan.plan_id)
    assert.equal(done.status, 'completed'); assert.equal(done.steps[0].status, 'succeeded')
    assert.equal((done.steps[0].result as any).case_result.status, 'passed'); assert.equal((done.steps[0].result as any).case_result.assertions[0].passed, true)
    assert.deepEqual(hits, [{ url: '/case', method: 'POST', body: 'draft body', auth: 'Bearer case-auth-secret' }])
    assert.deepEqual(store.readTargetSnapshot(pid, target.target_id), before)
    for (const secret of ['case-auth-secret', 'case-response-secret']) assert(!JSON.stringify([received, events, commands.listPlans(pid)]).includes(secret))
    await assert.rejects(() => commands.approvePlan(pid, plan.plan_id), /批准/); assert.equal(hits.length, 1)
    console.log('PASS case override approval, frozen draft, real assertions, redaction and unchanged formal definition')

    const propose = (draft = commands.getDraft(pid, target.target_id).target, environmentId?: string, execution?: any) => commands.proposeExecuteCasePlan(pid, { goal: '运行所选用例', targetId: target.target_id, caseIds: { [target.target_id]: calls.map(call => call.case_id) }, draft, environmentId, execution })
    const managed = structuredClone(target)
    const env = store.listEnvironments(pid)[0]
    env.env_var_list = { credential: { current_value: 'original-case-token', initial_value: '', is_checked: 1 } }; store.saveEnvironment(pid, env)
    managed.request!.auth = { type: 'bearer', bearer: { key: '{{credential}}' } }
    managed.request!.test = "if (pm.request.url.toString().includes('/login')) pm.environment.set('credential', 'evolved-case-token')"
    managed.cases = ['login', 'fail', 'blocked', 'independent'].map(name => ({ ...structuredClone(apiCase), case_id: name, name, override: { url: `${origin}/${name}` } }))
    managed.cases[1].assertions[0].expected = 'false'
    commands.syncEditorDraft(pid, managed)
    const editorBefore = commands.getDraft(pid, target.target_id)
    calls = managed.cases.map((item, i) => ({ project_id: pid, target_id: target.target_id, case_id: item.case_id, step_id: item.case_id, depends_on: i === 1 ? ['login'] : i === 2 ? ['fail'] : [] }))
    const variablePlan = await propose(managed, env.env_id)
    env.env_var_list.credential.current_value = 'changed-disk-token'; store.saveEnvironment(pid, env)
    const offset = hits.length
    const variableDone = await commands.approvePlan(pid, variablePlan.plan_id)
    assert.deepEqual(variableDone.steps.map(step => step.status), ['succeeded', 'failed', 'paused', 'succeeded'])
    assert.deepEqual(hits.slice(offset).map(hit => [hit.url, hit.auth]), [['/login', 'Bearer original-case-token'], ['/fail', 'Bearer evolved-case-token'], ['/independent', 'Bearer evolved-case-token']])
    assert.equal(store.listEnvironments(pid)[0].env_var_list.credential.current_value, 'changed-disk-token')
    assert.equal((variableDone.steps[1].result as any).case_result.assertions[0].passed, false)
    const analysis = received.at(-1).messages.filter((m: any) => m.role === 'tool')
    assert(analysis.some((message: any) => message.content.includes('case_result') && message.content.includes('false')))
    assert.deepEqual(commands.getDraft(pid, target.target_id), editorBefore)
    assert.deepEqual(store.readTargetSnapshot(pid, target.target_id), before)
    console.log('PASS frozen environment, evolving variables, failed assertion analysis, dependency pause and unchanged editor dirty state')

    calls = [{ project_id: pid, target_id: target.target_id, case_id: 'fail', step_id: 'fail', depends_on: [] }]
    managed.request!.test = "pm.environment.set('credential', 'must-not-persist')"; commands.syncEditorDraft(pid, managed)
    const failureWrite = await propose(managed, env.env_id, { writeVariables: true })
    assert.equal((await commands.approvePlan(pid, failureWrite.plan_id)).steps[0].status, 'failed')
    assert.equal(store.listEnvironments(pid)[0].env_var_list.credential.current_value, 'changed-disk-token')
    managed.request!.test = ''; commands.syncEditorDraft(pid, managed)
    calls = [{ project_id: pid, target_id: target.target_id, case_id: 'login', step_id: 'run', depends_on: [] }]
    const changedScope = await propose(managed, env.env_id)
    managed.cases![0].override.url = `${origin}/unapproved`; commands.syncEditorDraft(pid, managed)
    const beforeScope = hits.length
    const scopeDone = await commands.approvePlan(pid, changedScope.plan_id)
    assert.equal(scopeDone.status, 'paused'); assert.equal(hits.length, beforeScope)
    managed.cases![0].override.url = `${origin}/login`; commands.syncEditorDraft(pid, managed)
    const deletedEnv = await propose(managed, env.env_id); store.deleteEnvironment(pid, env.env_id)
    assert.equal((await commands.approvePlan(pid, deletedEnv.plan_id)).status, 'paused'); assert.equal(hits.length, beforeScope)
    console.log('PASS failed assertions never persist variables; changed case scope and deleted environment send no request')

    managed.request!.auth = { type: 'noauth' }; managed.cases![0].override.url = `${origin}/drop`; commands.syncEditorDraft(pid, managed)
    const dropped = await propose(managed)
    const unknown = await commands.approvePlan(pid, dropped.plan_id)
    assert.equal(unknown.steps[0].status, 'unknown'); assert.match(unknown.steps[0].error!, /禁止自动重发/)
    assert.equal((unknown.steps[0].result as any).case_result.status, 'error')
    await assert.rejects(() => commands.approvePlan(pid, dropped.plan_id), /批准/)
    assert.equal(hits.filter(hit => hit.url === '/drop').length, 1)
    managed.cases![0].override.url = `${origin}/hang`; commands.syncEditorDraft(pid, managed)
    const hanging = await propose(managed), running = commands.approvePlan(pid, hanging.plan_id)
    for (let n = 0; n < 200 && !hits.some(hit => hit.url === '/hang'); n++) await new Promise(resolve => setTimeout(resolve, 10))
    assert(hits.some(hit => hit.url === '/hang')); commands.cancelPlan(pid, hanging.plan_id)
    const cancelled = await running; assert.equal(cancelled.steps[0].status, 'unknown')
    for (let n = 0; n < 100 && !closed; n++) await new Promise(resolve => setTimeout(resolve, 10))
    assert(closed); await assert.rejects(() => commands.approvePlan(pid, hanging.plan_id), /批准/)
    assert.equal(hits.filter(hit => hit.url === '/hang').length, 1)
    console.log('PASS unknown and cancellation close transport without replay; successful cases remain single dispatch')

    managed.cases![0].override.url = `${origin}/script-fail`
    managed.request!.test = "pm.test('script assertion', () => pm.expect(false).to.equal(true))"
    commands.syncEditorDraft(pid, managed)
    const scriptFail = await propose(managed)
    const scriptDone = await commands.approvePlan(pid, scriptFail.plan_id)
    assert.equal(scriptDone.steps[0].status, 'failed')
    assert.equal((scriptDone.steps[0].result as any).case_result.status, 'failed', 'case result must not contradict failed script assertions')

    managed.request!.test = ''; commands.syncEditorDraft(pid, managed)
    const disabledPlan = await propose(managed)
    managed.cases![0].is_enabled = 0; commands.syncEditorDraft(pid, managed)
    const beforeDisabled = hits.length
    assert.equal((await commands.approvePlan(pid, disabledPlan.plan_id)).status, 'paused')
    assert.equal(hits.length, beforeDisabled)

    managed.cases![0].is_enabled = 1
    const upload = path.join(app.getPath('userData'), 'case-upload.txt'); fs.writeFileSync(upload, 'case-file-contents')
    managed.cases![0].override = { url: `${origin}/upload`, method: 'POST', body_mode: 'formdata', formdata: [{ param_id: 'upload', key: 'file', value: upload, field_type: 'file', is_checked: 1 }] }
    managed.request!.pre_script = `pm.sendRequest('${origin}/extra', () => {})`
    commands.syncEditorDraft(pid, managed)
    const approvedEffects = { requests: [{ method: 'GET', url: `${origin}/extra`, maxCalls: 1 }] }
    const effectsPlan = await propose(managed, undefined, approvedEffects)
    assert(effectsPlan.steps[0].execution!.effects.some(effect => effect.includes('case-upload.txt')))
    assert(effectsPlan.steps[0].execution!.effects.some(effect => effect.includes('前置脚本 SHA256')))
    assert.equal((await commands.approvePlan(pid, effectsPlan.plan_id)).status, 'completed')
    assert(hits.at(-1).body.includes('case-file-contents')); assert.equal(hits.filter(hit => hit.url === '/extra').length, 1)
    const changedFile = await propose(managed, undefined, approvedEffects)
    fs.writeFileSync(upload, 'unapproved-file-contents'); const beforeFile = hits.length
    assert.equal((await commands.approvePlan(pid, changedFile.plan_id)).status, 'paused'); assert.equal(hits.length, beforeFile)
    const extraDenied = await propose(managed)
    assert.equal((await commands.approvePlan(pid, extraDenied.plan_id)).status, 'paused'); assert.equal(hits.length, beforeFile)
    managed.request!.pre_script = ''
    managed.cases![0].override = { url: `${origin}/body-freeze`, method: 'POST', body_mode: 'raw', body: 'snapshot ordinary body' }
    commands.syncEditorDraft(pid, managed)
    const frozenBodyPlan = await propose(managed)
    managed.cases![0].override.body = 'later ordinary body'; managed.cases![0].assertions[0].expected = 'false'
    commands.syncEditorDraft(pid, managed)
    assert.equal((await commands.approvePlan(pid, frozenBodyPlan.plan_id)).status, 'completed', 'ordinary editor changes must not replace the approved case snapshot')
    assert.equal(hits.at(-1).body, 'snapshot ordinary body')
    const extraCase = { ...structuredClone(apiCase), case_id: 'new-draft-case', override: { url: `${origin}/new-draft-case` } }
    managed.cases!.push(extraCase); commands.syncEditorDraft(pid, managed)
    calls = [{ project_id: pid, target_id: target.target_id, case_id: extraCase.case_id, step_id: 'new', depends_on: [] }]
    assert.equal((await commands.approvePlan(pid, (await propose(managed)).plan_id)).status, 'completed')
    assert(!store.getTarget(pid, target.target_id)!.cases!.some(item => item.case_id === extraCase.case_id))
    await assert.rejects(() => propose(managed, undefined, { saveResponse: true }), /保存响应/)
    const outside = await commands.proposeExecuteCasePlan(pid, { targetId: target.target_id, draft: managed, caseIds: { [target.target_id]: ['login'] }, goal: '不能扩大用例范围' })
    assert.equal(outside.status, 'paused'); assert.match(outside.error!, /范围/)
    for (const secret of ['case-auth-secret', 'case-response-secret', 'original-case-token', 'evolved-case-token', 'must-not-persist']) assert(!JSON.stringify([received, events, commands.listPlans(pid)]).includes(secret))
    console.log('PASS script failures, disabled cases, case uploads, explicit extra requests, changed-file denial and unsaved case execution')
  } finally { off(); for (const server of [model, api]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
