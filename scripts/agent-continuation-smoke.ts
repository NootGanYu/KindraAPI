/** Approved read→derive→apply→execute continuation through application commands. */
import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'
import { onPlanEvent } from '../src/main/agent/plans'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
import { createFlow, createFlowEvent, createRequest } from '../src/shared/factories'

const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
const steps = (targets: { a: string; b: string; bParam: string }) => [
  { step_id: 'read-a', operation: 'read_api', binding: 'static', target_id: targets.a, depends_on: [] },
  { step_id: 'read-b', operation: 'read_api', binding: 'static', target_id: targets.b, depends_on: [] },
  { step_id: 'derive-b', operation: 'propose_api_change', binding: 'deferred', target_id: targets.b, depends_on: ['read-a', 'read-b'], source_steps: ['read-a', 'read-b'], intent: '把 A 的 tag 值加 -checked 写入 B', allowed_changes: [`request.query.parameter[param_id=${targets.bParam}].value`] },
  { step_id: 'apply-b', operation: 'apply_candidate', kind: 'api', binding: 'static', target_id: targets.b, depends_on: ['derive-b'], source_steps: ['derive-b'] },
  { step_id: 'test-b', operation: 'execute_api', binding: 'static', target_id: targets.b, depends_on: ['apply-b'], source_steps: ['apply-b'] }
]

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-continuation-')))
  await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const env = store.listEnvironments(pid)[0]
  const aValue = `aval-${randomUUID()}`.replace(/-/g, '').slice(0, 18)
  const tagA = `tagA-${randomUUID().slice(0, 8)}`
  const tagB = `tagB-${randomUUID().slice(0, 8)}`
  let scenario: 'core' | 'expansion' | 'scope' | 'unknown' | 'saveResponse' | 'frozen' | 'live' | 'conflict' | 'save' = 'core'
  let planSteps: any[] = []
  let scenarioA = ''
  let scenarioB = ''
  let scenarioTagB = ''
  const hits: Array<{ url: string; tag: string | null; body: string; parent: string | undefined }> = []
  let scenarioParent = ''
  let scenarioModelId = ''
  const api = http.createServer((req, res) => {
    const parsed = new URL(req.url!, 'http://127.0.0.1')
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      hits.push({ url: parsed.pathname, tag: parsed.searchParams.get('tag'), body, parent: req.headers['x-parent'] as string | undefined })
      if (parsed.pathname === '/drop') { req.socket.destroy(); return }
      res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}')
    })
  })
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(api.address() as any).port}`
  const a = store.createTargetInProject(pid, '0', 'api')
  a.name = '来源 A'; a.url = `${origin}/a`
  a.request!.query.parameter.push({ param_id: tagA, key: 'tag', value: aValue, is_checked: 1 } as any)
  store.saveTarget(pid, a)
  const b = store.createTargetInProject(pid, '0', 'api')
  b.name = '目标 B'; b.url = `${origin}/b`
  b.request!.query.parameter.push({ param_id: tagB, key: 'tag', value: 'base-b', is_checked: 1 } as any)
  const secretParam = `token-${randomUUID().slice(0, 8)}`
  b.request!.query.parameter.push({ param_id: secretParam, key: 'token', value: 'sensitive-sibling-value', is_checked: 1 } as any)
  store.saveTarget(pid, b)
  const revisionA = store.readTargetSnapshot(pid, a.target_id).revision
  const revisionB = store.readTargetSnapshot(pid, b.target_id).revision
  let projectedPlanRequest = false
  const models: any[] = []
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol); models.push(body)
    const tools: string[] = (body.tools ?? []).map((tool: any) => tool.function.name)
    if (tools.includes('kindra_capability_probe')) { respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'kindra_capability_probe', arguments: '{"token":"kindra-probe"}' } }] }); return }
    if (tools.includes('propose_task_plan')) {
      projectedPlanRequest = true
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify({ steps: planSteps }) } }] })
      return
    }
    if (scenario === 'frozen' || scenario === 'live') {
      if (scenario === 'frozen') {
        const schema = store.getModel(pid, scenarioModelId)
        if (schema) { schema.data.schema.properties!.phase.example = 'model-new'; store.saveModel(pid, schema) }
        const parent = store.getTarget(pid, scenarioParent)
        if (parent?.request) { parent.request.header.parameter[0].value = 'changed-parent'; store.saveTarget(pid, parent) }
      }
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'run-frozen', type: 'function', function: { name: 'execute_api', arguments: JSON.stringify({ project_id: pid, target_id: scenarioB, step_id: 'run-b', depends_on: ['read-b'] }) } }] })
      return
    }
    if (scenario === 'save') {
      const toolMessage = body.messages.filter((message: any) => message.role === 'tool').map((message: any) => { try { return JSON.parse(message.content) } catch { return null } }).filter(Boolean).find((value: any) => Array.isArray(value.tool_results))
      const results = toolMessage?.tool_results ?? []
      const readA = results.find((item: any) => item.step_id === 'read-a')?.result?.api
      const readB = results.find((item: any) => item.step_id === 'read-b')?.result?.api
      const aTag = readA.request.query.parameter.find((param: any) => param.key === 'tag')
      const bTag = readB.request.query.parameter.find((param: any) => param.key === 'tag')
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'derive', type: 'function', function: { name: 'propose_api_change', arguments: JSON.stringify({ project_id: pid, target_id: scenarioB, step_id: 'derive-b', depends_on: ['read-a', 'read-b'], patch: { request: { query: { parameter: [{ param_id: bTag.param_id, value: `${aTag.value}-saved` }] } } } }) } }] })
      return
    }
    if (scenario === 'unknown') {
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'run-unknown', type: 'function', function: { name: 'execute_api', arguments: JSON.stringify({ project_id: pid, target_id: scenarioB, step_id: 'run-b', depends_on: ['read-b'] }) } }] })
      return
    }
    if (scenario === 'saveResponse') {
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'run-save', type: 'function', function: { name: 'execute_api', arguments: JSON.stringify({ project_id: pid, target_id: scenarioB, step_id: 'run-b', depends_on: [] }) } }] })
      return
    }
    if (tools.includes('propose_api_change')) {
      const toolMessage = body.messages.filter((message: any) => message.role === 'tool').map((message: any) => { try { return JSON.parse(message.content) } catch { return null } }).filter(Boolean).find((value: any) => Array.isArray(value.tool_results))
      const results = toolMessage?.tool_results ?? []
      const readA = results.find((item: any) => item.step_id === 'read-a')?.result?.api
      const readB = results.find((item: any) => item.step_id === 'read-b')?.result?.api
      assert(readA && readB, 'model can only derive from approved read results')
      const aTag = readA.request.query.parameter.find((param: any) => param.key === 'tag')
      const bTag = readB.request.query.parameter.find((param: any) => param.key === 'tag')
      assert(aTag && bTag)
      if (scenario === 'conflict') {
        const draft = commands.getDraft(pid, scenarioB).target
        const param = draft.request!.query.parameter.find(item => item.key === 'tag')
        if (param) param.value = 'human-value'
        commands.syncEditorDraft(pid, draft)
      }
      const derive = { id: 'derive', type: 'function', function: { name: 'propose_api_change', arguments: JSON.stringify({ project_id: pid, target_id: scenarioB, step_id: 'derive-b', depends_on: ['read-a', 'read-b'], patch: scenario === 'scope' ? { url: `${origin}/forbidden`, request: { query: { parameter: [{ param_id: bTag.param_id, value: `${aTag.value}-checked` }] } } } : { request: { query: { parameter: [{ param_id: bTag.param_id, value: `${aTag.value}-checked` }] } } } }) } }
      const extra = { id: 'extra-exec', type: 'function', function: { name: 'execute_api', arguments: JSON.stringify({ project_id: pid, target_id: scenarioA, step_id: 'extra-exec-a', depends_on: [] }) } }
      respondModel(res, protocol, body.stream, { tool_calls: scenario === 'expansion' ? [derive, extra] : [derive] })
      return
    }
    respondModel(res, protocol, body.stream, { content: '已完成 A→B 派生、采纳到草稿并真实执行一次；未保存正式定义。' })
  })
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))
  const events: any[] = []
  const off = onPlanEvent(event => events.push(event))
  try {
    await commands.saveConnection({ name: 'continuation', base_url: `http://127.0.0.1:${(model.address() as any).port}/v1`, model: 'continuation', protocol })
    await commands.testConnection()
    scenario = 'core'; scenarioA = a.target_id; scenarioB = b.target_id; scenarioTagB = tagB; planSteps = steps({ a: a.target_id, b: b.target_id, bParam: tagB })
    const plan = await commands.proposeTaskPlan(pid, { goal: '读取 A/B，把 A 的 tag 值加 -checked 复制给 B 并测试一次，不保存', targetIds: [a.target_id, b.target_id], environmentId: env.env_id })
    assert.equal(plan.status, 'pending', JSON.stringify(plan))
    assert.equal(plan.continuation, true)
    assert.deepEqual(plan.steps.map(step => step.binding), ['static', 'static', 'deferred', 'static', 'static'])
    assert.equal(hits.length, 0, 'no target HTTP before approval')
    const planningRequest = JSON.stringify(models.find((body: any) => (body.tools ?? []).some((tool: any) => tool.function.name === 'propose_task_plan')))
    assert(projectedPlanRequest)
    for (const value of [aValue, tagA, tagB, 'base-b']) assert(!planningRequest.includes(value), `planning input must not include ${value}`)
    assert(!planningRequest.includes('"query"'))
    const done = await commands.approvePlan(pid, plan.plan_id, plan.approval_revision ?? 1)
    assert.equal(done.status, 'completed', JSON.stringify(done.steps.map(step => ({ id: step.step_id, status: step.status, error: step.error }))))
    assert(done.steps.every(step => step.status === 'succeeded'))
    assert.deepEqual(hits.map(hit => hit.url), ['/b'])
    assert.equal(hits[0].tag, `${aValue}-checked`)
    const bDraft = commands.getDraft(pid, b.target_id).target
    assert.equal(bDraft.request!.query.parameter.find(param => param.param_id === tagB)!.value, `${aValue}-checked`)
    assert.equal(bDraft.request!.query.parameter.find(param => param.param_id === secretParam)!.value, 'sensitive-sibling-value', 'hidden sibling value survives a stable-ID partial patch')
    const readProjection = JSON.stringify(models)
    assert(!readProjection.includes('sensitive-sibling-value'))
    assert(readProjection.includes(`[已隐藏]`))
    assert.equal(store.readTargetSnapshot(pid, a.target_id).revision, revisionA)
    assert.equal(store.readTargetSnapshot(pid, b.target_id).revision, revisionB)
    assert.equal(store.getTarget(pid, b.target_id)!.request!.query.parameter.find(param => param.param_id === tagB)!.value, 'base-b')
    assert.match(done.explanation ?? '', /派生/)
    assert.equal(events.filter(event => event.plan?.steps?.some((step: any) => step.status === 'succeeded')).length > 0, true)
    console.log(protocol, 'PASS approved read→derive→apply→execute uses read results, one real B request, drafts only')

    const makeApi = (name: string, url: string, param?: { id: string; value: string }) => {
      const target = store.createTargetInProject(pid, '0', 'api')
      target.name = name; target.url = url
      if (param) target.request!.query.parameter.push({ param_id: param.id, key: 'tag', value: param.value, is_checked: 1 } as any)
      store.saveTarget(pid, target)
      return target
    }
    // Expansion: the same batch asks for an extra execute outside the approved slots. It must not
    // run before a new revision is approved, and success/read steps must not be replayed after.
    scenario = 'expansion'
    const c = makeApi('来源 C', `${origin}/c`, { id: `tagC-${randomUUID().slice(0, 8)}`, value: 'value-c' })
    const tagD = `tagD-${randomUUID().slice(0, 8)}`
    const d = makeApi('目标 D', `${origin}/d`, { id: tagD, value: 'base-d' })
    scenarioA = c.target_id; scenarioB = d.target_id
    planSteps = steps({ a: c.target_id, b: d.target_id, bParam: tagD })
    const hitsBeforeExpansion = hits.length
    const expansion = await commands.proposeTaskPlan(pid, { goal: '派生 D 但不要执行未批准接口', targetIds: [c.target_id, d.target_id], environmentId: env.env_id })
    const expansionDone = await commands.approvePlan(pid, expansion.plan_id, expansion.approval_revision ?? 1)
    assert.equal(expansionDone.status, 'paused')
    assert.equal(hits.length, hitsBeforeExpansion, 'unapproved extra execute has zero side effects')
    const pausedExpansion = commands.getPlan(pid, expansion.plan_id)
    assert(pausedExpansion.steps.some(step => step.status === 'awaiting_approval'))
    assert.equal(pausedExpansion.approval_revision, 2)
    await assert.rejects(() => commands.approvePlan(pid, expansion.plan_id, 1), /过期/)
    const reapproved = await commands.approvePlan(pid, expansion.plan_id, 2)
    assert.equal(reapproved.status, 'completed', JSON.stringify(reapproved.steps.map(step => ({ id: step.step_id, status: step.status, error: step.error }))))
    assert.deepEqual(hits.slice(hitsBeforeExpansion).map(hit => hit.url).sort(), ['/c', '/d'])
    assert.equal(hits.find(hit => hit.url === '/d')!.tag, 'value-c-checked')
    assert.equal(hits.filter(hit => hit.url === '/c').length, 1, 'the newly approved extra step runs once')
    console.log(protocol, 'PASS unapproved extra execute stays paused; stale approval rejected; reapproval runs only remaining work')

    // Scope change: a deferred patch that changes the URL is not covered by allowed_changes.
    scenario = 'scope'
    const e = makeApi('来源 E', `${origin}/e`, { id: `tagE-${randomUUID().slice(0, 8)}`, value: 'value-e' })
    const tagF = `tagF-${randomUUID().slice(0, 8)}`
    const f = makeApi('目标 F', `${origin}/f`, { id: tagF, value: 'base-f' })
    scenarioA = e.target_id; scenarioB = f.target_id
    planSteps = steps({ a: e.target_id, b: f.target_id, bParam: tagF })
    const hitsBeforeScope = hits.length
    const scoped = await commands.proposeTaskPlan(pid, { goal: '派生但改变目标', targetIds: [e.target_id, f.target_id], environmentId: env.env_id })
    const scopedDone = await commands.approvePlan(pid, scoped.plan_id, scoped.approval_revision ?? 1)
    assert.equal(scopedDone.status, 'paused')
    assert.equal(hits.length, hitsBeforeScope, 'a scope-expanding patch never sends a request')
    const pausedScope = commands.getPlan(pid, scoped.plan_id)
    assert.equal(pausedScope.approval_revision, 2)
    assert(pausedScope.steps.some(step => step.status === 'awaiting_approval' && JSON.stringify(step.changes).includes('/forbidden')))
    await assert.rejects(() => commands.approvePlan(pid, scoped.plan_id, 1), /过期/)
    console.log(protocol, 'PASS URL/scope expansion pauses before send and invalidates the previous approval revision')

    // Remote result unknown: no automatic replay through repeated approve/resume.
    scenario = 'unknown'
    const g = makeApi('未知目标 G', `${origin}/drop`, { id: `tagG-${randomUUID().slice(0, 8)}`, value: 'value-g' })
    scenarioB = g.target_id
    planSteps = [
      { step_id: 'read-b', operation: 'read_api', binding: 'static', target_id: g.target_id, depends_on: [] },
      { step_id: 'run-b', operation: 'execute_api', binding: 'deferred', target_id: g.target_id, depends_on: ['read-b'], source_steps: [] }
    ]
    const unknownPlan = await commands.proposeTaskPlan(pid, { goal: '执行后断连', targetIds: [g.target_id], environmentId: env.env_id })
    const unknownDone = await commands.approvePlan(pid, unknownPlan.plan_id, unknownPlan.approval_revision ?? 1)
    assert.equal(unknownDone.status, 'paused')
    assert.equal(unknownDone.steps.find(step => step.step_id === 'run-b')!.status, 'unknown')
    const drops = hits.filter(hit => hit.url === '/drop').length
    assert.equal(drops, 1)
    await assert.rejects(() => commands.approvePlan(pid, unknownPlan.plan_id))
    assert.throws(() => commands.resumePlan(pid, unknownPlan.plan_id, ['run-b']))
    assert.equal(hits.filter(hit => hit.url === '/drop').length, 1, 'unknown is never replayed')
    console.log(protocol, 'PASS remote unknown is retained and repeated approve/resume do not resend')

    // responseOnly save: only the captured response example is persisted; other dirty draft fields stay local.
    scenario = 'saveResponse'
    const h = makeApi('响应保存 H', `${origin}/ok`, { id: `tagH-${randomUUID().slice(0, 8)}`, value: 'value-h' })
    h.description = 'saved-h'
    h.response = { example: [{ example_id: 'response-contract', expect: { name: '成功', code: 200, content_type: 'application/json' }, raw: '{"ok":false}', field_docs: [{ pointer: '/ok', description: '操作是否成功', type: 'boolean', required: true, nullable: false, enum: null }] }] }
    store.saveTarget(pid, h)
    commands.syncEditorDraft(pid, { ...h, description: 'dirty-h' })
    scenarioB = h.target_id
    planSteps = [
      { step_id: 'run-b', operation: 'execute_api', binding: 'deferred', target_id: h.target_id, depends_on: [], source_steps: [] },
      { step_id: 'save-response', operation: 'save_api_response', binding: 'static', target_id: h.target_id, depends_on: ['run-b'], source_steps: ['run-b'] }
    ]
    const savePlan = await commands.proposeTaskPlan(pid, { goal: '执行并仅保存响应示例', targetIds: [h.target_id], environmentId: env.env_id, execution: { saveResponse: true } })
    const saveDone = await commands.approvePlan(pid, savePlan.plan_id, savePlan.approval_revision ?? 1)
    assert.equal(saveDone.status, 'completed', JSON.stringify(saveDone.steps.map(step => ({ id: step.step_id, status: step.status, error: step.error }))))
    assert.equal(store.getTarget(pid, h.target_id)!.description, 'saved-h', 'response-only save must not persist other dirty draft fields')
    assert.equal(commands.getDraft(pid, h.target_id).target.description, 'dirty-h')
    assert.equal((store.getTarget(pid, h.target_id)!.response?.example ?? []).length, 1)
    console.log(protocol, 'PASS response-only save persists one captured example without other drafts')

    // Frozen dependencies: after approval, model/ancestor changes must not alter this turn;
    // a new plan resolves the now-current model and ancestor default.
    const dataModel = store.createModelInProject(pid, '0', 'model')
    dataModel.data.schema = { type: 'object', properties: { phase: { type: 'string', example: 'model-old' } } }
    store.saveModel(pid, dataModel)
    const parent = store.createTargetInProject(pid, '0', 'folder')
    parent.request = createRequest()
    parent.request.header.parameter = [{ param_id: 'parent-h', key: 'X-Parent', value: 'frozen-parent', is_checked: 1 } as any]
    store.saveTarget(pid, parent)
    const frozenTarget = store.createTargetInProject(pid, '0', 'api')
    frozenTarget.name = '冻结依赖'; frozenTarget.parent_id = parent.target_id; frozenTarget.url = `${origin}/frozen`; frozenTarget.method = 'POST'
    frozenTarget.request!.body.mode = 'json'; frozenTarget.request!.body.raw = ''; frozenTarget.request!.body.model_id = dataModel.model_id
    store.saveTarget(pid, frozenTarget)
    scenarioParent = parent.target_id; scenarioModelId = dataModel.model_id; scenarioB = frozenTarget.target_id
    planSteps = [
      { step_id: 'read-b', operation: 'read_api', binding: 'static', target_id: frozenTarget.target_id, depends_on: [] },
      { step_id: 'run-b', operation: 'execute_api', binding: 'deferred', target_id: frozenTarget.target_id, depends_on: ['read-b'], source_steps: [] }
    ]
    scenario = 'frozen'
    const frozenPlan = await commands.proposeTaskPlan(pid, { goal: '冻结本轮模型与祖先默认值', targetIds: [frozenTarget.target_id], environmentId: env.env_id })
    const frozenDone = await commands.approvePlan(pid, frozenPlan.plan_id, frozenPlan.approval_revision ?? 1)
    assert.equal(frozenDone.status, 'completed', JSON.stringify(frozenDone.steps.map(step => ({ id: step.step_id, status: step.status, error: step.error }))))
    const frozenHit = hits.filter(hit => hit.url === '/frozen').at(-1)!
    assert.match(frozenHit.body, /model-old/)
    assert.equal(frozenHit.parent, 'frozen-parent', 'a mid-turn ancestor edit must not change this execution')
    scenario = 'live'
    const livePlan = await commands.proposeTaskPlan(pid, { goal: '下一轮读取最新模型', targetIds: [frozenTarget.target_id], environmentId: env.env_id })
    const liveDone = await commands.approvePlan(pid, livePlan.plan_id, livePlan.approval_revision ?? 1)
    assert.equal(liveDone.status, 'completed')
    const liveHit = hits.filter(hit => hit.url === '/frozen').at(-1)!
    assert.match(liveHit.body, /model-new/, 'a later turn must resolve the current model reference')
    assert.equal(liveHit.parent, 'changed-parent')
    console.log(protocol, 'PASS continuation uses frozen model/ancestor snapshots while a later turn reads current definitions')

    // Same-field conflict pauses apply/execute instead of overwriting the human edit.
    scenario = 'conflict'
    const k = makeApi('来源 K', `${origin}/k`, { id: `tagK-${randomUUID().slice(0, 8)}`, value: 'value-k' })
    const tagL = `tagL-${randomUUID().slice(0, 8)}`
    const l = makeApi('目标 L', `${origin}/l`, { id: tagL, value: 'base-l' })
    scenarioA = k.target_id; scenarioB = l.target_id
    planSteps = steps({ a: k.target_id, b: l.target_id, bParam: tagL })
    const hitsBeforeConflict = hits.length
    const conflictPlan = await commands.proposeTaskPlan(pid, { goal: '同字段冲突', targetIds: [k.target_id, l.target_id], environmentId: env.env_id })
    const conflictDone = await commands.approvePlan(pid, conflictPlan.plan_id, conflictPlan.approval_revision ?? 1)
    assert.equal(conflictDone.status, 'paused')
    assert.equal(hits.length, hitsBeforeConflict)
    const conflictApply = conflictDone.steps.find(step => step.step_id === 'apply-b')!
    assert.equal(conflictApply.status, 'failed')
    assert.match(conflictApply.error ?? '', /冲突/)
    assert.equal(commands.getDraft(pid, l.target_id).target.request!.query.parameter.find(param => param.param_id === tagL)!.value, 'human-value')
    console.log(protocol, 'PASS same-field conflict pauses apply and execute without overwriting the human edit')

    // Independent save slot: one approval persists exactly one formal version and keeps the
    // candidate chain; no second confirmation is requested.
    scenario = 'save'
    const m = makeApi('来源 M', `${origin}/m`, { id: `tagM-${randomUUID().slice(0, 8)}`, value: 'value-m' })
    const tagN = `tagN-${randomUUID().slice(0, 8)}`
    const n = makeApi('目标 N', `${origin}/n`, { id: tagN, value: 'base-n' })
    const nParam = n.request!.query.parameter.find(param => param.param_id === tagN)!
    nParam.description = '用户确认的标签值'; nParam.field_type = 'string'; nParam.required = true; nParam.nullable = false; nParam.enum = null
    store.saveTarget(pid, n)
    scenarioA = m.target_id; scenarioB = n.target_id
    planSteps = [
      { step_id: 'read-a', operation: 'read_api', binding: 'static', target_id: m.target_id, depends_on: [] },
      { step_id: 'read-b', operation: 'read_api', binding: 'static', target_id: n.target_id, depends_on: [] },
      { step_id: 'derive-b', operation: 'propose_api_change', binding: 'deferred', target_id: n.target_id, depends_on: ['read-a', 'read-b'], source_steps: ['read-a', 'read-b'], allowed_changes: [`request.query.parameter[param_id=${tagN}].value`] },
      { step_id: 'save-b', operation: 'save_api', binding: 'static', target_id: n.target_id, depends_on: ['derive-b'], source_steps: ['derive-b'] }
    ]
    const versionsBefore = store.listTargetVersions(pid, n.target_id).length
    const saveIndependent = await commands.proposeTaskPlan(pid, { goal: '派生并独立保存一次', targetIds: [m.target_id, n.target_id], environmentId: env.env_id })
    const savedDone = await commands.approvePlan(pid, saveIndependent.plan_id, saveIndependent.approval_revision ?? 1)
    assert.equal(savedDone.status, 'completed', JSON.stringify(savedDone.steps.map(step => ({ id: step.step_id, status: step.status, error: step.error }))))
    assert.equal(store.getTarget(pid, n.target_id)!.request!.query.parameter.find(param => param.param_id === tagN)!.value, 'value-m-saved')
    assert.equal(store.listTargetVersions(pid, n.target_id).length, versionsBefore + 1, 'one approved save creates one formal version')
    assert(commands.listCandidates(pid, n.target_id).some(candidate => candidate.step_id === 'derive-b' && candidate.saved_version), 'saved candidate stays linked')
    console.log(protocol, 'PASS independent save slot persists one version without extra approval')

    // read_flow uses the approved frozen Flow snapshot.
    scenario = 'core'
    const flow = createFlow(pid, '连续读取 Flow')
    flow.events = [{ ...createFlowEvent('wait'), name: '等待节点', wait_ms: 5 }]
    store.saveFlow(pid, flow)
    planSteps = [{ step_id: 'read-flow', operation: 'read_flow', binding: 'static', flow_id: flow.flow_id, depends_on: [] }]
    const flowPlan = await commands.proposeTaskPlan(pid, { goal: '读取 Flow 快照', targetIds: [], flowIds: [flow.flow_id], environmentId: env.env_id })
    const flowDone = await commands.approvePlan(pid, flowPlan.plan_id, flowPlan.approval_revision ?? 1)
    assert.equal(flowDone.status, 'completed', JSON.stringify(flowDone.steps.map(step => ({ id: step.step_id, status: step.status, error: step.error }))))
    assert.equal((flowDone.steps[0].result as any).flow.events[0].name, '等待节点')
    console.log(protocol, 'PASS read_flow returns the approved frozen Flow snapshot')
  } finally { off(); api.closeAllConnections(); model.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); await new Promise<void>(resolve => model.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
