import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-undo-'))); await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const target = store.createTargetInProject(pid, '0', 'api')
  delete target.custom_attributes
  target.description = '原始说明'; target.url = 'https://example.invalid/base'; store.saveTarget(pid, target)
  let patch: unknown = { description: '候选说明', custom_attributes: { owner: 'Agent' } }
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), name = body.tools?.[0]?.function.name
    const message = name ? { tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, target_id: target.target_id, patch }) } }] } : { content: '候选已创建' }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await commands.saveConnection({ name: '撤销测试', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'undo', protocol: 'chat-completions' }); await commands.testConnection()
    const propose = async () => { const plan = await commands.proposeEditPlan(pid, { goal: '修改草稿', targetId: target.target_id }); await commands.approvePlan(pid, plan.plan_id); return commands.listCandidates(pid, target.target_id)[0] }
    const first = await propose()
    const rejected = commands.rejectCandidate(pid, first.candidate_id)
    assert.equal(rejected.status, 'rejected')
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '原始说明')
    assert.deepEqual(rejected.proposal, first.proposal)
    const restored = commands.restoreCandidate(pid, first.candidate_id)
    assert.equal(restored.status, 'applied')
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '候选说明')
    assert.equal(store.getTarget(pid, target.target_id)!.description, '原始说明')
    assert.equal(commands.listCandidates(pid, target.target_id).length, 1)
    console.log('PASS reject retains candidate history; restore changes draft only')
    patch = { url: 'https://example.invalid/chain-two' }
    const second = await propose(); commands.applyCandidate(pid, second.candidate_id)
    const manual = commands.getDraft(pid, target.target_id).target
    manual.name = '后续人工名称'; commands.syncEditorDraft(pid, manual)
    const undone = commands.undoCandidate(pid, first.candidate_id)
    assert.equal(undone.status, 'undone')
    const remaining = commands.getDraft(pid, target.target_id).target
    assert.equal(remaining.custom_attributes, undefined, 'undo removes a field added by this candidate')
    assert.equal(remaining.description, '原始说明'); assert.equal(remaining.name, '后续人工名称')
    assert.equal(remaining.url, 'https://example.invalid/chain-two')
    assert.equal(commands.listCandidates(pid, target.target_id).find(c => c.candidate_id === second.candidate_id)!.status, 'applied')
    assert.deepEqual(undone.proposal, first.proposal)
    assert.throws(() => commands.undoCandidate(pid, first.candidate_id), /已撤销|没有已应用/)
    commands.restoreCandidate(pid, first.candidate_id)
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '候选说明')
    console.log('PASS inverse merge retains unrelated human edits and other candidate chains; restore remains available')
    const later = commands.getDraft(pid, target.target_id).target
    later.description = '后续人工说明'; commands.syncEditorDraft(pid, later)
    const conflict = commands.undoCandidate(pid, first.candidate_id)
    assert.equal(conflict.status, 'conflict'); assert.equal(conflict.merge!.operation, 'undo')
    assert.equal(conflict.merge!.conflicts[0].path, '/description')
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '后续人工说明')
    assert.throws(() => store.saveTarget(pid, commands.getDraft(pid, target.target_id).target), /冲突/)
    assert.throws(() => commands.resolveCandidateUndo(pid, first.candidate_id, conflict.merge!.review_id, {}), /明确选择/)
    assert.throws(() => commands.resolveCandidate(pid, first.candidate_id, conflict.merge!.review_id, {}), /撤销/)
    const editedDuringReview = commands.getDraft(pid, target.target_id).target
    editedDuringReview.name = '审阅期间的新名字'; commands.syncEditorDraft(pid, editedDuringReview)
    const stale = commands.resolveCandidateUndo(pid, first.candidate_id, conflict.merge!.review_id, { '/description': 'agent' })
    assert.equal(stale.status, 'conflict'); assert.notEqual(stale.merge!.review_id, conflict.merge!.review_id)
    const chosen = commands.resolveCandidateUndo(pid, first.candidate_id, stale.merge!.review_id, Object.fromEntries(stale.merge!.conflicts.map(c => [c.id, 'current' as const])))
    assert.equal(chosen.status, 'undone')
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '后续人工说明')
    assert.equal(commands.getDraft(pid, target.target_id).target.name, '审阅期间的新名字')
    assert.equal(store.getTarget(pid, target.target_id)!.description, '原始说明')
    console.log('PASS undo conflicts preserve current draft, reject stale choices, and require explicit decisions')
    commands.rejectCandidate(pid, second.candidate_id)
    commands.restoreCandidate(pid, second.candidate_id)
    commands.undoCandidate(pid, second.candidate_id)
    assert.equal(commands.getDraft(pid, target.target_id).target.url, 'https://example.invalid/base')
    assert.equal(commands.getDraft(pid, target.target_id).target.name, '审阅期间的新名字')
    patch = { description: '第三候选说明', url: 'https://example.invalid/third' }
    const third = await propose()
    const human = commands.getDraft(pid, target.target_id).target; human.description = '同字段人工'; commands.syncEditorDraft(pid, human)
    const partial = commands.applyCandidate(pid, third.candidate_id)
    assert.equal(partial.status, 'conflict')
    const reviewEdit = commands.getDraft(pid, target.target_id).target; reviewEdit.name = '不能被撤销的名字'; commands.syncEditorDraft(pid, reviewEdit)
    const updated = commands.resolveCandidate(pid, third.candidate_id, partial.merge!.review_id, Object.fromEntries(partial.merge!.conflicts.map(c => [c.id, 'agent' as const])))
    commands.resolveCandidate(pid, third.candidate_id, updated.merge!.review_id, Object.fromEntries(updated.merge!.conflicts.map(c => [c.id, 'agent' as const])))
    commands.undoCandidate(pid, third.candidate_id)
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '同字段人工')
    assert.equal(commands.getDraft(pid, target.target_id).target.name, '不能被撤销的名字')
    assert.equal(commands.getDraft(pid, target.target_id).target.url, 'https://example.invalid/base')
    console.log('PASS actual application snapshot survives review decisions and preserves edits made during conflict review')
    const restoreManual = commands.getDraft(pid, target.target_id).target; restoreManual.description = '恢复时人工说明'; commands.syncEditorDraft(pid, restoreManual)
    const restoring = commands.restoreCandidate(pid, third.candidate_id)
    assert.equal(restoring.status, 'conflict')
    const restoreReviewEdit = commands.getDraft(pid, target.target_id).target; restoreReviewEdit.name = '恢复审阅期间名称'; commands.syncEditorDraft(pid, restoreReviewEdit)
    const restoreStale = commands.resolveCandidate(pid, third.candidate_id, restoring.merge!.review_id, Object.fromEntries(restoring.merge!.conflicts.map(c => [c.id, 'agent' as const])))
    assert.equal(restoreStale.status, 'conflict', 'stale restore retains the original intended snapshot')
    assert.equal(restoreStale.merge!.conflicts.find(c => c.path === '/description')!.agent, '第三候选说明')
    commands.resolveCandidate(pid, third.candidate_id, restoreStale.merge!.review_id, Object.fromEntries(restoreStale.merge!.conflicts.map(c => [c.id, 'agent' as const])))
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '第三候选说明')
    commands.undoCandidate(pid, third.candidate_id)
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '恢复时人工说明')
    assert.equal(commands.getDraft(pid, target.target_id).target.name, '恢复审阅期间名称')
    console.log('PASS restore conflict rechecks preserve the original snapshot across later manual edits')

    patch = { description: '新一轮候选' }
    const fourth = await propose(); commands.applyCandidate(pid, fourth.candidate_id)
    const external = store.getTarget(pid, target.target_id)!; external.url = 'https://example.invalid/external'; store.saveTarget(pid, external)
    const beforeBlocked = commands.getDraft(pid, target.target_id).target
    assert.throws(() => commands.undoCandidate(pid, fourth.candidate_id), /正式定义已变化/)
    assert.throws(() => commands.restoreCandidate(pid, first.candidate_id), /正式定义已变化/)
    assert.deepEqual(commands.getDraft(pid, target.target_id).target, beforeBlocked)
    assert.equal(store.getTarget(pid, target.target_id)!.url, 'https://example.invalid/external')
    console.log('PASS official revision changes cannot be silently accepted while restoring or undoing stale drafts')




  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
