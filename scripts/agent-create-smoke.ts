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
async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-create-'))); await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  let save = false, existingId = '', saveOnly = false
  let patch: unknown = { name: '新建候选接口', description: '用户明确要求查询健康状态', method: 'GET', url: 'https://example.invalid/health' }
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol)
    const probe = body.tools?.[0]?.function.name === 'kindra_capability_probe'
    const request = JSON.parse(body.messages?.find((m: any) => m.role === 'user' && m.content.startsWith('{'))?.content ?? '{}')
    const id = existingId || request.target_id
    const calls = probe ? [{ name: 'kindra_capability_probe', args: { token: 'kindra-probe' } }] : [
      ...(!saveOnly ? [{ name: existingId ? 'propose_api_change' : 'create_api', args: { project_id: pid, target_id: id, step_id: 'create', patch, depends_on: [] } }] : []),
      ...(save ? [{ name: 'save_api', args: { project_id: pid, target_id: id, step_id: 'save', depends_on: saveOnly ? [] : ['create'] } }] : [])
    ]
    respondModel(res, protocol, body.stream, body.tools ? { tool_calls: calls.map((call, index) => ({ id: `call-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { content: '按实际工具结果说明草稿状态。' })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await commands.saveConnection({ name: '新建模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'create', protocol }); await commands.testConnection()
    const plan = await commands.proposeCreateApiPlan(pid, { goal: '新建健康状态查询接口，仅草稿' })
    assert.equal(plan.status, 'pending', plan.error)
    assert.equal(store.getTarget(pid, plan.target_id), null)
    assert.equal(commands.listCandidates(pid).length, 0)
    const approved = await commands.approvePlan(pid, plan.plan_id)
    assert.equal(approved.status, 'completed', approved.error)
    assert.equal(store.getTarget(pid, plan.target_id), null)
    assert.equal(commands.getDraft(pid, plan.target_id).target.name, '新建候选接口')
    const summary = commands.listProjectCandidates(pid)
    assert.equal(summary[0].kind, 'api'); assert.equal(summary[0].lifecycle, 'uncreated')
    const candidate = commands.listCandidates(pid)[0]
    commands.rejectCandidate(pid, candidate.candidate_id)
    assert.equal(commands.listCandidates(pid)[0].status, 'rejected')
    commands.restoreCandidate(pid, candidate.candidate_id)
    assert.equal(commands.listCandidates(pid)[0].status, 'applied')
    assert.equal(store.getTarget(pid, plan.target_id), null)
    console.log('PASS creation approval only creates a recoverable local draft and reviewable candidate')
    assert.throws(() => store.saveTarget(pid, commands.getDraft(pid, plan.target_id).target), /独立.*保存|获批/)
    save = true; saveOnly = true; existingId = plan.target_id
    const saveLater = await commands.proposeSavePlan(pid, { goal: '独立批准保存新接口草稿', targetId: existingId })
    assert.equal(saveLater.status, 'pending', saveLater.error)
    const saved = await commands.approvePlan(pid, saveLater.plan_id)
    assert.equal(saved.status, 'completed', saved.error)
    assert.equal(store.getTarget(pid, existingId)!.name, '新建候选接口')
    assert.equal(commands.listCandidates(pid)[0].saved_version!.version, store.getTarget(pid, existingId)!.version)
    assert.equal(commands.listProjectCandidates(pid)[0].lifecycle, 'saved')
    existingId = ''; saveOnly = false
    const combined = await commands.proposeCreateApiPlan(pid, { goal: '新建并独立保存', save: true })
    assert.deepEqual(combined.steps.map(step => step.operation), ['create_api', 'save_api'])
    assert.equal(store.getTarget(pid, combined.target_id), null)
    assert.equal((await commands.approvePlan(pid, combined.plan_id)).status, 'completed')
    assert(store.getTarget(pid, combined.target_id))
    patch = { name: '缺规则的新接口', description: '用户要求创建查询', url: 'https://example.invalid/new', request: { query: { parameter: [{ param_id: 'business', key: 'region', value: 'east', field_type: 'string', is_checked: 1 }] } } }
    const missing = await commands.proposeCreateApiPlan(pid, { goal: '根据示例新增region，未提供规则', save: true })
    const blocked = await commands.approvePlan(pid, missing.plan_id)
    assert.equal(blocked.status, 'paused'); assert.match(blocked.error!, /region.*缺少.*澄清/s)
    assert.equal(store.getTarget(pid, missing.target_id), null)
    assert.equal(commands.getDraft(pid, missing.target_id).target.request!.query.parameter[0].required, undefined)
    const blockedCandidate = commands.listCandidates(pid).find(c => c.target_id === missing.target_id)!
    assert.equal(blockedCandidate.status, 'applied')
    saveOnly = true; existingId = missing.target_id
    const stillMissing = await commands.proposeSavePlan(pid, { goal: '保存当前草稿', targetId: existingId })
    assert.equal((await commands.approvePlan(pid, stillMissing.plan_id)).status, 'paused')
    assert.equal(store.getTarget(pid, existingId), null)
    saveOnly = false
    patch = { request: { query: { parameter: [{ param_id: 'business', key: 'region', value: 'east', field_type: 'string', is_checked: 1, description: '用户明确地区编码', required: true, nullable: false, enum: null }] } } }
    const clarified = await commands.proposeSavePlan(pid, { goal: '用户确认region必填且不可空，不限制枚举', targetId: existingId })
    const final = await commands.approvePlan(pid, clarified.plan_id)
    assert.equal(final.status, 'completed', final.error)
    assert.equal(store.getTarget(pid, existingId)!.request!.query.parameter[0].required, true)
    console.log('PASS only an independent approved save creates the formal object; full new-object documentation gates remain on later save-only plans')

  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
