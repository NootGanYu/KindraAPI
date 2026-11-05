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
  const hits: Array<{ url: string; tag: string | null }> = []
  const api = http.createServer((req, res) => {
    const parsed = new URL(req.url!, 'http://127.0.0.1')
    hits.push({ url: parsed.pathname, tag: parsed.searchParams.get('tag') })
    res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}')
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
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'plan', type: 'function', function: { name: 'propose_task_plan', arguments: JSON.stringify({ steps: steps({ a: a.target_id, b: b.target_id, bParam: tagB }) }) } }] })
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
      respondModel(res, protocol, body.stream, { tool_calls: [{ id: 'derive', type: 'function', function: { name: 'propose_api_change', arguments: JSON.stringify({ project_id: pid, target_id: b.target_id, step_id: 'derive-b', depends_on: ['read-a', 'read-b'], patch: { request: { query: { parameter: [{ param_id: bTag.param_id, value: `${aTag.value}-checked` }] } } } }) } }] })
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
  } finally { off(); api.closeAllConnections(); model.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); await new Promise<void>(resolve => model.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
