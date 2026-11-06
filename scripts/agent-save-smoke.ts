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
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-save-')))
  await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  let target = store.createTargetInProject(pid, '0', 'api')
  target.description = '原说明'; target.url = 'https://example.invalid/api'; store.saveTarget(pid, target)
  let patch: unknown = { description: '获批保存的说明' }
  let save = false
  let saveOnly = false
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol)
    const probe = body.tools?.[0]?.function.name === 'kindra_capability_probe'
    const calls = probe ? [{ name: 'kindra_capability_probe', args: { token: 'kindra-probe' } }] : [
      ...(!saveOnly ? [{ name: 'propose_api_change', args: { project_id: pid, target_id: target.target_id, step_id: 'edit', patch, depends_on: [] } }] : []),
      ...(save ? [{ name: 'save_api', args: { project_id: pid, target_id: target.target_id, step_id: 'save', depends_on: saveOnly ? [] : ['edit'] } }] : [])
    ]
    respondModel(res, protocol, body.stream, body.tools ? { tool_calls: calls.map((call, index) => ({ id: `call-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { content: '已按步骤处理；以工具结果为准。' })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await commands.saveConnection({ name: '保存模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'save', protocol }); await commands.testConnection()
    const editOnly = await commands.proposeEditPlan(pid, { goal: '仅修改说明', targetId: target.target_id })
    await commands.approvePlan(pid, editOnly.plan_id)
    const untouched = commands.listCandidates(pid, target.target_id)[0]
    assert.equal(store.getTarget(pid, target.target_id)!.description, '原说明')
    save = true
    const plan = await commands.proposeSavePlan(pid, { goal: '修改并保存说明', targetId: target.target_id })
    assert.equal(plan.status, 'pending'); assert.deepEqual(plan.steps.map((step: any) => step.operation), ['propose_api_change', 'save_api'])
    assert.equal(store.getTarget(pid, target.target_id)!.description, '原说明')
    const completed = await commands.approvePlan(pid, plan.plan_id)
    assert.equal(completed.status, 'completed', completed.error)
    assert.equal(store.getTarget(pid, target.target_id)!.description, '获批保存的说明', 'one approval adopts the candidate and saves without manual apply')
    const candidate = commands.listCandidates(pid, target.target_id).find(c => c.plan_id === plan.plan_id)!
    assert.equal(candidate.status, 'applied'); assert.equal(candidate.saved_version!.version, store.getTarget(pid, target.target_id)!.version)
    assert.equal(commands.listCandidates(pid, target.target_id).find(c => c.candidate_id === untouched.candidate_id)!.status, 'pending')
    assert.equal(commands.getDraft(pid, target.target_id).agent_owned, false)
    const beforeInvalid = store.readTargetSnapshot(pid, target.target_id)
    patch = { request: { query: { parameter: [{ param_id: 'new-field', key: 'businessCode', value: 'A', is_checked: 1, field_type: 'string' }] } } }
    const missingDocs = await commands.proposeSavePlan(pid, { goal: '新增字段并保存，未知规则不能猜测', targetId: target.target_id })
    const blocked = await commands.approvePlan(pid, missingDocs.plan_id)
    assert.equal(blocked.status, 'paused', 'explicitly submitted parameter without business rules must not save')
    assert.match(blocked.error!, /businessCode.*缺少/s)
    assert.equal(store.readTargetSnapshot(pid, target.target_id).revision, beforeInvalid.revision)
    saveOnly = true
    const retryMissing = await commands.proposeSavePlan(pid, { goal: '直接保存草稿也不能绕过字段门槛', targetId: target.target_id })
    assert.equal((await commands.approvePlan(pid, retryMissing.plan_id)).status, 'paused')
    saveOnly = false
    patch = { request: { header: null } }
    const malformed = await commands.proposeSavePlan(pid, { goal: '结构错误不可批准', targetId: target.target_id })
    assert.equal(malformed.status, 'paused', 'nested request groups cannot become null')
    patch = { request: { query: { parameter: [{ param_id: 'new-field', key: 'businessCode', value: 'A', is_checked: 1, field_type: 'string', description: '用户确认的业务分类编码', required: true, nullable: false, enum: null }] } } }
    const clarified = await commands.proposeSavePlan(pid, { goal: '使用用户明确提供的业务规则', targetId: target.target_id })
    assert.equal((await commands.approvePlan(pid, clarified.plan_id)).status, 'completed')
    assert(commands.listCandidates(pid, target.target_id).find(c => c.plan_id === missingDocs.plan_id)!.saved_version, 'the applied earlier candidate chain is linked too')
    assert.equal(store.getTarget(pid, target.target_id)!.request!.query.parameter[0].description, '用户确认的业务分类编码')
    // A save-only plan must retain intent from an existing applied candidate.
    save = false; patch = { description: '先采纳后单独保存' }
    const staged = await commands.proposeEditPlan(pid, { goal: '先改草稿', targetId: target.target_id })
    await commands.approvePlan(pid, staged.plan_id)
    const stagedCandidate = commands.listCandidates(pid, target.target_id).find(c => c.plan_id === staged.plan_id)!
    commands.applyCandidate(pid, stagedCandidate.candidate_id)
    save = true; saveOnly = true
    const saveDraft = await commands.proposeSavePlan(pid, { goal: '保存当前草稿', targetId: target.target_id })
    assert.equal((await commands.approvePlan(pid, saveDraft.plan_id)).status, 'completed')
    assert(commands.listCandidates(pid, target.target_id).find(c => c.candidate_id === stagedCandidate.candidate_id)!.saved_version)
    saveOnly = false
    // New raw fields also require documentation, even without explicit field_docs.
    patch = { request: { body: { mode: 'json', raw: '{"region":"north"}' } } }
    const rawPlan = await commands.proposeSavePlan(pid, { goal: '新增请求体字段', targetId: target.target_id })
    const rawBlocked = await commands.approvePlan(pid, rawPlan.plan_id)
    assert.equal(rawBlocked.status, 'paused'); assert.match(rawBlocked.error!, /body.region/)
    assert.notEqual(store.getTarget(pid, target.target_id)!.request!.body.mode, 'json')
    const fresh = (): void => {
      target = store.createTargetInProject(pid, '0', 'api')
      target.description = '基线'; target.url = 'https://example.invalid/fresh'; store.saveTarget(pid, target)
    }
    fresh(); patch = { request: { header: { parameter: [{ param_id: 'spoofed', key: 'business', value: 'A', is_checked: 1, is_system: 1 }] } } }
    const spoof = await commands.proposeSavePlan(pid, { goal: '不能伪装系统字段绕过文档校验', targetId: target.target_id })
    assert.equal((await commands.approvePlan(pid, spoof.plan_id)).status, 'paused')
    fresh(); patch = { request: { body: { mode: 'json', raw: '{invalid' } } }
    const invalidJson = await commands.proposeSavePlan(pid, { goal: '无效 JSON 不写入', targetId: target.target_id })
    assert.equal((await commands.approvePlan(pid, invalidJson.plan_id)).status, 'paused')
    fresh(); patch = { description: 'Agent 版本' }
    const concurrent = await commands.proposeSavePlan(pid, { goal: '修改说明并保存', targetId: target.target_id })
    commands.syncEditorDraft(pid, { ...target, description: '人工并发版本' }, store.readTargetSnapshot(pid, target.target_id).revision)
    const conflict = await commands.approvePlan(pid, concurrent.plan_id)
    assert.equal(conflict.status, 'paused'); assert.equal(store.getTarget(pid, target.target_id)!.description, '基线')
    assert.equal(commands.listCandidates(pid, target.target_id)[0].status, 'conflict')
    assert.throws(() => store.saveTarget(pid, target), /未解决/)
    fresh()
    const external = await commands.proposeSavePlan(pid, { goal: '正式并发更新不覆盖', targetId: target.target_id })
    store.saveTarget(pid, { ...target, url: 'https://example.invalid/external' })
    assert.equal((await commands.approvePlan(pid, external.plan_id)).status, 'paused')
    assert.equal(store.getTarget(pid, target.target_id)!.url, 'https://example.invalid/external')
    fresh()
    const savedRevision = store.readTargetSnapshot(pid, target.target_id).revision!
    commands.syncEditorDraft(pid, { ...target, name: '真实旧基线草稿' }, 'old-revision')
    const staleDraft = await commands.proposeSavePlan(pid, { goal: '旧草稿不能绑定新正式版本', targetId: target.target_id })
    assert.equal((await commands.approvePlan(pid, staleDraft.plan_id)).status, 'paused')
    assert.equal(store.readTargetSnapshot(pid, target.target_id).revision, savedRevision)
    console.log(`PASS ${protocol}: explicit save automatically adopts its candidate, links a formal version and preserves other proposals`)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
