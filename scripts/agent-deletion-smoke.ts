import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { flowSignature } from '../src/shared/flowSync'
import { stableJson, targetDefinition } from '../src/shared/targetSync'
import { runFlow } from '../src/main/flow/engine'
import { callTool } from '../src/main/mcp/tools'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'

async function main(): Promise<void> {
  if (process.argv[2] === '--restart') {
    app.setPath('userData', process.argv[3]); await app.whenReady()
    const [pid, targetId, flowId] = process.argv.slice(4)
    assert.equal(commands.listProjectCandidates(pid).filter(i => i.lifecycle === 'deleted').length, 2)
    assert.equal(commands.getDeletedObject(pid, 'api', targetId)!.snapshot.description, '删除前定义')
    assert.equal(commands.getDraft(pid, targetId).target.description, '删除后人工编辑')
    assert.equal(commands.getFlowDraft(pid, flowId).flow.description, '人工流程说明')
    assert.equal(commands.listCandidates(pid, targetId)[0].status, 'undone')
    assert.equal(store.getTarget(pid, targetId), null); assert.equal(store.getFlow(pid, flowId), null)
    console.log('PASS fresh process recovers deleted summaries, tombstones, review history and drafts without formal recreation')
    return
  }
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-deleted-'))); await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const folder = store.createTargetInProject(pid, '0', 'folder')
  const target = store.createTargetInProject(pid, folder.target_id, 'api')
  target.description = '删除前定义'; store.saveTarget(pid, target)
  const flow = createFlow(pid, '删除的流程'); flow.events = [createFlowEvent('wait')]; store.saveFlow(pid, flow)
  const run = await runFlow(pid, { ...flow, events: [] }), originalRun = store.getFlowRun(pid, run.run_id)
  const projectRoot = store.resolveProjectDir(pid)
  execFileSync('git', ['-C', projectRoot, 'init'], { stdio: 'pipe' }); execFileSync('git', ['-C', projectRoot, 'add', '.'], { stdio: 'pipe' })
  const versionsBefore = store.listTargetVersions(pid, target.target_id)
  let flowMode = false, apiPatch: unknown = { description: '候选说明' }
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), name = body.tools?.[0]?.function.name === 'kindra_capability_probe' ? 'kindra_capability_probe' : body.tools ? flowMode ? 'propose_flow_change' : 'propose_api_change' : undefined
    const message = name ? { tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, ...(flowMode ? { flow_id: flow.flow_id } : { target_id: target.target_id }), patch: flowMode ? { description: '候选说明' } : apiPatch }) } }] } : { content: '完成' }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await commands.saveConnection({ name: '删除恢复', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'deletion', protocol: 'chat-completions' }); await commands.testConnection()
    const plan = await commands.proposeEditPlan(pid, { goal: '修改说明', targetId: target.target_id }); await commands.approvePlan(pid, plan.plan_id)
    const candidate = commands.listCandidates(pid, target.target_id)[0]
    const config = { ...store.getMcpConfig(), enabled: true, allow_write: true, allowed_project_ids: [pid] }
    await callTool('delete_apis', { project_id: pid, target_ids: [folder.target_id], confirm: true }, config)
    const summary = commands.listProjectCandidates(pid).find(item => item.entity_id === target.target_id)!
    assert.equal(summary.lifecycle, 'deleted', 'recursive folder deletion retains an explicit deletion tombstone')
    assert.equal(commands.listCandidates(pid, target.target_id)[0].proposal.description, '候选说明')
    console.log('PASS folder deletion retains candidate and tombstone')
    commands.rejectCandidate(pid, candidate.candidate_id)
    const restored = commands.restoreCandidate(pid, candidate.candidate_id)
    assert.equal(restored.status, 'applied')
    assert.equal(store.getTarget(pid, target.target_id), null, 'restoring never writes a formal definition')
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '候选说明')
    const later = commands.getDraft(pid, target.target_id).target
    later.description = '删除后人工编辑'; commands.syncEditorDraft(pid, later)
    const conflict = commands.undoCandidate(pid, candidate.candidate_id)
    assert.equal(conflict.status, 'conflict'); assert.equal(conflict.merge!.operation, 'undo')
    commands.resolveCandidateUndo(pid, candidate.candidate_id, conflict.merge!.review_id, Object.fromEntries(conflict.merge!.conflicts.map(c => [c.id, 'current' as const])))
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '删除后人工编辑')
    console.log('PASS deleted API candidate restores and undoes with later-edit conflict checks')
    flowMode = true
    const fp = await commands.proposeEditPlan(pid, { goal: '修改流程说明', targetId: '', flowIds: [flow.flow_id] }); await commands.approvePlan(pid, fp.plan_id)
    const fc = commands.listFlowCandidates(pid, flow.flow_id)[0]
    commands.applyFlowCandidate(pid, fc.candidate_id)
    const laterFlow = commands.getFlowDraft(pid, flow.flow_id).flow; laterFlow.description = '人工流程说明'; commands.syncFlowEditorDraft(pid, laterFlow)
    await callTool('delete_execution_flow', { project_id: pid, flow_id: flow.flow_id, confirm: true }, config)
    assert.equal(commands.listProjectCandidates(pid).find(i => i.entity_id === flow.flow_id)!.lifecycle, 'deleted')
    commands.rejectFlowCandidate(pid, fc.candidate_id)
    const restoredFlow = commands.restoreFlowCandidate(pid, fc.candidate_id)
    assert.equal(restoredFlow.status, 'conflict')
    assert.equal(store.getFlow(pid, flow.flow_id), null)
    commands.resolveFlowCandidate(pid, fc.candidate_id, restoredFlow.merge!.review_id, Object.fromEntries(restoredFlow.merge!.conflicts.map(c => [c.id, 'current' as const])))
    assert.equal(commands.getFlowDraft(pid, flow.flow_id).flow.description, '人工流程说明')
    console.log('PASS MCP Flow deletion retains candidate history and restores with conflict review')
    assert.deepEqual(commands.getDeletedObject(pid, 'api', target.target_id)!.versions.map(v => v.version_id), versionsBefore.map(v => v.version_id))
    assert.equal(commands.listFlowVersions(pid, flow.flow_id).length, 1)
    assert.deepEqual(store.getFlowRun(pid, run.run_id), originalRun)
    const restarted = execFileSync(process.execPath, [__filename, '--restart', app.getPath('userData'), pid, target.target_id, flow.flow_id], { encoding: 'utf8' })
    process.stdout.write(restarted)
    assert.equal(execFileSync('git', ['-C', projectRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim(), '', 'local review and recovery records must not enter project Git')
    const changes = execFileSync('git', ['-C', projectRoot, 'diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n')
    assert(changes.every(name => name.startsWith('apis/') || name === 'target_index.json' || name.startsWith('executions/flows/')), changes.join(','))
    const deletionId = summary.deletion_id!
    const signature = stableJson(targetDefinition(commands.getDraft(pid, target.target_id).target))
    const edited = commands.getDraft(pid, target.target_id).target; edited.name = '审阅后人工改名'; commands.syncEditorDraft(pid, edited)
    await assert.rejects(commands.saveDeletedApiDraft(pid, target.target_id, deletionId, signature), /变化/)
    const saved = await commands.saveDeletedApiDraft(pid, target.target_id, deletionId, stableJson(targetDefinition(edited)))
    assert.equal(saved.target.parent_id, '0'); assert.equal(saved.target.description, '删除后人工编辑')
    assert.equal(commands.listProjectCandidates(pid).find(i => i.entity_id === target.target_id)!.lifecycle, 'saved')
    assert(store.listTargetVersions(pid, target.target_id).some(v => v.version_id === versionsBefore[0].version_id))
    const flowDeletion = commands.getDeletedObject(pid, 'flow', flow.flow_id)!
    store.saveFlow(pid, { ...flow, name: '其他来源重建的流程' })
    assert.throws(() => commands.restoreFlowCandidate(pid, fc.candidate_id), /变化/)
    assert.throws(() => commands.saveDeletedFlowDraft(pid, flow.flow_id, flowDeletion.deletion_id, flowSignature(commands.getFlowDraft(pid, flow.flow_id).flow)), /已存在/)
    assert.equal(store.getFlow(pid, flow.flow_id)!.name, '其他来源重建的流程')
    store.deleteFlow(pid, flow.flow_id)
    const secondDeletion = commands.getDeletedObject(pid, 'flow', flow.flow_id)!
    assert.notEqual(secondDeletion.deletion_id, flowDeletion.deletion_id)
    assert.throws(() => commands.restoreDeletedFlowDraft(pid, flow.flow_id, flowDeletion.deletion_id), /变化/)
    const flowRecovery = commands.restoreDeletedFlowDraft(pid, flow.flow_id, secondDeletion.deletion_id)
    commands.saveDeletedFlowDraft(pid, flow.flow_id, secondDeletion.deletion_id, flowSignature(flowRecovery.flow))
    assert.equal(store.getFlow(pid, flow.flow_id)!.description, '人工流程说明')
    assert.deepEqual(store.getFlowRun(pid, run.run_id), originalRun)
    assert(commands.listFlowCandidates(pid, flow.flow_id).some(c => c.candidate_id === fc.candidate_id))
    assert.equal(store.getFlow(pid, flow.flow_id)!.name, '其他来源重建的流程', 'recovery merges later formal edits instead of discarding them')
    console.log('PASS explicit recovery saves retain history, reject stale reviews/recreated identities, and preserve manual Flow runs and Git boundary')
    flowMode = false; apiPatch = { request: { body: { mode: 'json', raw: '{"unknown_rule":42}' } } }
    const missingDocs = await commands.proposeEditPlan(pid, { goal: '新增未知字段', targetId: target.target_id }); await commands.approvePlan(pid, missingDocs.plan_id)
    const missingCandidate = commands.listCandidates(pid, target.target_id)[0]; commands.applyCandidate(pid, missingCandidate.candidate_id)
    const externalSaved = store.getTarget(pid, target.target_id)!; externalSaved.name = '外部保存的名字'; store.saveTarget(pid, externalSaved)
    const currentDraft = commands.getDraft(pid, target.target_id).target; currentDraft.name = '未保存的人工名字'; commands.syncEditorDraft(pid, currentDraft)
    store.deleteTarget(pid, target.target_id)
    const missingDeletion = commands.getDeletedObject(pid, 'api', target.target_id)!
    const missingDraft = commands.restoreDeletedApiDraft(pid, target.target_id, missingDeletion.deletion_id)
    const recoveryConflict = commands.listCandidates(pid, target.target_id).find(c => c.status === 'conflict' && c.merge?.conflicts.some(f => f.path === '/name'))
    assert(recoveryConflict, 'deletion must not silently erase later external formal edits behind an old draft')
    commands.resolveCandidate(pid, recoveryConflict.candidate_id, recoveryConflict.merge!.review_id, Object.fromEntries(recoveryConflict.merge!.conflicts.map(c => [c.id, 'current' as const])))
    missingDraft.target = commands.getDraft(pid, target.target_id).target
    assert.equal(missingDraft.target.name, '外部保存的名字')
    await assert.rejects(commands.saveDeletedApiDraft(pid, target.target_id, missingDeletion.deletion_id, stableJson(targetDefinition(missingDraft.target))), /文档|字段|业务依据/)
    assert.equal(store.getTarget(pid, target.target_id), null)
    console.log('PASS deletion recovery cannot bypass incremental Agent field documentation validation')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
