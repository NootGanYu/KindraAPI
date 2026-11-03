import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'
import { decodeModelRequest, respondModel } from './agent-model-fixture'
import type { ApiCase } from '../src/shared/types'
const protocol = process.argv.includes('--responses') ? 'responses' : 'chat-completions'
async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-case-edit-'))); await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const target = store.createTargetInProject(pid, '0', 'api')
  const initial: ApiCase = { case_id: 'stable-case', name: '原用例', is_enabled: 1, override: { url: 'https://example.invalid/old' }, assertions: [{ assertion_id: 'status', kind: 'status', op: 'equals', expected: '200', is_enabled: 1 }] }
  target.name = '用例接口'; target.description = '明确业务用途'; target.url = 'https://example.invalid/api'; target.cases = [initial]; store.saveTarget(pid, target)
  let patch: unknown = { cases: [{ ...initial, override: { url: 'https://example.invalid/new' }, assertions: [{ ...initial.assertions[0], expected: '201' }] }] }
  let save = false, saveOnly = false
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol)
    const probe = body.tools?.[0]?.function.name === 'kindra_capability_probe'
    const calls = probe ? [{ name: 'kindra_capability_probe', args: { token: 'kindra-probe' } }] : [
      ...(!saveOnly ? [{ name: 'propose_api_change', args: { project_id: pid, target_id: target.target_id, step_id: 'edit', patch, depends_on: [] } }] : []),
      ...(save ? [{ name: 'save_api', args: { project_id: pid, target_id: target.target_id, step_id: 'save', depends_on: saveOnly ? [] : ['edit'] } }] : [])
    ]
    respondModel(res, protocol, body.stream, body.tools ? { tool_calls: calls.map((call, index) => ({ id: `call-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { content: '用例步骤已处理，按工具结果审阅。' })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await commands.saveConnection({ name: '用例模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'case', protocol }); await commands.testConnection()
    const plan = await commands.proposeEditPlan(pid, { goal: '修改用例覆盖和断言', targetId: target.target_id })
    assert.equal(plan.status, 'pending', plan.error)
    assert.equal((await commands.approvePlan(pid, plan.plan_id)).status, 'completed')
    const candidate = commands.listCandidates(pid, target.target_id)[0]
    assert.equal(candidate.proposal.cases![0].override.url, 'https://example.invalid/new')
    assert.equal(candidate.proposal.cases![0].assertions[0].expected, '201')
    assert.deepEqual(store.getTarget(pid, target.target_id)!.cases, [initial], 'no save keeps formal cases unchanged')
    const human = structuredClone(target); human.cases![0].name = '人工重命名'; commands.syncEditorDraft(pid, human)
    assert.equal(commands.applyCandidate(pid, candidate.candidate_id).status, 'applied')
    const merged = commands.getDraft(pid, target.target_id).target.cases![0]
    assert.equal(merged.case_id, 'stable-case'); assert.equal(merged.name, '人工重命名'); assert.equal(merged.assertions[0].expected, '201')
    save = true; saveOnly = true
    const savePlan = await commands.proposeSavePlan(pid, { goal: '保存已审阅用例', targetId: target.target_id })
    assert.equal((await commands.approvePlan(pid, savePlan.plan_id)).status, 'completed')
    assert.equal(store.getTarget(pid, target.target_id)!.cases![0].name, '人工重命名')
    assert(commands.listCandidates(pid, target.target_id)[0].saved_version)
    save = false; saveOnly = false
    const two = store.getTarget(pid, target.target_id)!
    two.cases![0].assertions.push({ assertion_id: 'duration', kind: 'duration', op: 'lt', expected: '100', is_enabled: 1 })
    store.saveTarget(pid, two); commands.releaseEditorDraft(pid, target.target_id)
    const proposed = structuredClone(two.cases!); proposed[0].assertions[0].expected = '202'
    patch = { cases: proposed }
    const independent = await commands.proposeEditPlan(pid, { goal: '只改状态断言', targetId: target.target_id }); await commands.approvePlan(pid, independent.plan_id)
    const pending = commands.listCandidates(pid, target.target_id)[0]
    const manual = structuredClone(two); manual.cases![0].assertions[1].expected = '75'; commands.syncEditorDraft(pid, manual)
    assert.equal(commands.applyCandidate(pid, pending.candidate_id).status, 'applied', 'independent stable assertions in one case merge')
    assert.deepEqual(commands.getDraft(pid, target.target_id).target.cases![0].assertions.map(a => a.expected), ['202', '75'])
    save = true; saveOnly = true
    const saveIndependent = await commands.proposeSavePlan(pid, { goal: '保存独立断言修改', targetId: target.target_id }); await commands.approvePlan(pid, saveIndependent.plan_id)
    const revision = store.readTargetSnapshot(pid, target.target_id).revision
    const versions = store.listTargetVersions(pid, target.target_id).length
    const run = { ran_at: '2026-11-03T00:00:00.000Z', status: 'passed' as const, http_status: 201, duration_ms: 14 }
    store.saveCaseRun(pid, target.target_id, initial.case_id, run)
    store.saveTarget(pid, store.getTarget(pid, target.target_id)!)
    assert.equal(store.listTargetVersions(pid, target.target_id).length, versions, 'runtime-only case results cannot manufacture definition versions on next save')
    assert.equal(store.readTargetSnapshot(pid, target.target_id).revision, revision)
    const complete = store.getTarget(pid, target.target_id)!
    delete complete.server_id
    complete.custom_attributes = { owner: '历史负责人' }; complete.tags = ['历史标签']; complete.mark_id = 'history-mark'; complete.design = { errors: [{ code: 'E1', message: '历史错误', description: '已知业务错误' }] }
    store.saveTarget(pid, complete)
    const originalVersion = store.listTargetVersions(pid, target.target_id)[0]
    const newer = structuredClone(complete)
    newer.cases![0].assertions[0].expected = '500'; newer.cases![0].name = '后续用例'; newer.custom_attributes = { owner: '新负责人', newField: '应被移除' }; newer.tags = ['当前标签']; delete newer.design
    newer.server_id = 'new-server'; newer.sort += 100
    store.saveTarget(pid, newer)
    const currentRun = { ...run, ran_at: '2026-11-03T00:10:00.000Z', status: 'failed' as const, http_status: 500 }
    store.saveCaseRun(pid, target.target_id, initial.case_id, currentRun)
    const restored = store.restoreTargetVersion(pid, target.target_id, originalVersion.version_id)
    assert.equal(restored.cases![0].name, '人工重命名', 'complete version restore includes cases')
    assert.equal(restored.cases![0].assertions[0].expected, '202')
    assert.deepEqual(restored.custom_attributes, { owner: '历史负责人' })
    assert.deepEqual(restored.design, complete.design); assert.deepEqual(restored.tags, ['历史标签']); assert.equal(restored.mark_id, 'history-mark')
    assert.equal(restored.server_id, undefined, 'fields absent from the old version are removed')
    assert.equal(restored.sort, complete.sort); assert.equal(restored.target_id, target.target_id); assert.equal(restored.project_id, pid); assert.equal(restored.created_at, target.created_at)
    assert.deepEqual(restored.cases![0].last_run, currentRun, 'restore preserves current runtime rather than historical last_run')
    const countBeforeSort = store.listTargetVersions(pid, target.target_id).length
    store.saveTarget(pid, { ...restored, sort: restored.sort + 100 })
    assert.equal(store.listTargetVersions(pid, target.target_id).length, countBeforeSort + 1, 'sort participates in both revision and version')
    commands.releaseEditorDraft(pid, target.target_id)
    const current = store.getTarget(pid, target.target_id)!
    const editableCases = current.cases!.map(({ last_run, ...item }) => item)
    save = false; saveOnly = false
    patch = { cases: editableCases.map(c => ({ ...c, override: { ...c.override, url: 'https://example.invalid/agent-conflict' } })) }
    const conflictPlan = await commands.proposeEditPlan(pid, { goal: '修改用例覆盖地址', targetId: target.target_id }); await commands.approvePlan(pid, conflictPlan.plan_id)
    const conflictCandidate = commands.listCandidates(pid, target.target_id)[0]
    const concurrent = structuredClone(current); concurrent.cases![0].override.url = 'https://example.invalid/human-conflict'; commands.syncEditorDraft(pid, concurrent)
    const conflicted = commands.applyCandidate(pid, conflictCandidate.candidate_id)
    assert.equal(conflicted.status, 'conflict'); assert.match(conflicted.merge!.conflicts[0].path, /case_id=stable-case.*override.*url/)
    assert.throws(() => store.saveTarget(pid, commands.getDraft(pid, target.target_id).target), /冲突/)
    commands.resolveCandidate(pid, conflicted.candidate_id, conflicted.merge!.review_id, Object.fromEntries(conflicted.merge!.conflicts.map(c => [c.id, 'agent' as const])))
    assert.equal(commands.getDraft(pid, target.target_id).target.cases![0].override.url, 'https://example.invalid/agent-conflict')
    for (const cases of [null, [{ ...initial, override: null }], [{ ...initial, override: { query: {} } }], [{ ...initial, assertions: [{}] }], [initial, initial], [{ ...initial, assertions: [initial.assertions[0], initial.assertions[0]] }], [{ ...initial, last_run: run }], [{ ...initial, assertions: [{ ...initial.assertions[0], expected: 201 }] }]]) {
      patch = { cases }
      const invalid = await commands.proposeEditPlan(pid, { goal: '无效用例结构不能进入候选', targetId: target.target_id })
      assert.equal(invalid.status, 'paused', JSON.stringify(cases))
    }
    save = true; saveOnly = false
    patch = { description: '', cases: editableCases }
    const badDocs = await commands.proposeSavePlan(pid, { goal: '用例修改仍遵守接口文档门槛', targetId: target.target_id })
    const blocked = await commands.approvePlan(pid, badDocs.plan_id)
    assert.equal(blocked.status, 'paused'); assert.match(blocked.error!, /description/)
    assert.equal(store.getTarget(pid, target.target_id)!.description, '明确业务用途')
    console.log(`PASS ${protocol}: case override/assertion candidates, stable-ID merge and explicit save`)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
