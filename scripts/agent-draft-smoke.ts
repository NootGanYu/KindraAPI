import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { agentCommands as commands } from '../src/main/agent/service'

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-draft-')))
  await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const target = store.createTargetInProject(pid, '0', 'api')
  target.description = '原说明'; target.request!.header.parameter.push({ param_id: 'secret', key: 'Authorization', value: 'Bearer local-token', is_checked: 1 } as any)
  store.saveTarget(pid, target)
  const received: unknown[] = []
  let patch: unknown = { description: 'Agent 新说明' }
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); received.push(body)
    const name = body.tools?.[0]?.function.name
    const message = name ? { tool_calls: [{ id: 'call1', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, target_id: target.target_id, patch, depends_on: [] }) } }] } : { content: '已创建待确认候选' }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await commands.saveConnection({ name: '草稿模型', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'draft', protocol: 'chat-completions' })
    await commands.testConnection()
    const plan = await commands.proposeEditPlan(pid, { goal: '修改说明', targetId: target.target_id })
    assert.equal(plan.status, 'pending')
    assert.equal(commands.listCandidates(pid, target.target_id).length, 0)
    const completed = await commands.approvePlan(pid, plan.plan_id)
    assert.equal(completed.status, 'completed')
    const candidate = commands.listCandidates(pid, target.target_id)[0]
    assert.equal(candidate.number, 'P1')
    assert.equal(candidate.status, 'pending')
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '原说明', 'proposal is not the draft')
    assert.equal(store.getTarget(pid, target.target_id)!.description, '原说明')
    const applied = commands.applyCandidate(pid, candidate.candidate_id)
    assert.equal(applied.status, 'applied')
    assert.equal(await commands.saveManualDraftOnQuit(pid, target, store.readTargetSnapshot(pid, target.target_id).revision!), false, 'quit auto-save must recheck ownership in main process')
    assert.equal(commands.getDraft(pid, target.target_id).target.description, 'Agent 新说明')
    assert.equal(commands.getDraft(pid, target.target_id).target.request!.header.parameter.find(p => p.key === 'Authorization')!.value, 'Bearer local-token')
    assert.equal(store.getTarget(pid, target.target_id)!.description, '原说明')
    assert(!JSON.stringify(received).includes('local-token'))
    const count = commands.listCandidates(pid, target.target_id).length
    commands.stashAgentDrafts(); commands.stashAgentDrafts()
    assert.equal(commands.listCandidates(pid, target.target_id).length, count, 'exit deduplicates existing snapshot')
    const second = await commands.proposeEditPlan(pid, { goal: '修改', targetId: target.target_id })
    await commands.approvePlan(pid, second.plan_id)
    const pending = commands.listCandidates(pid, target.target_id).find(c => c.status === 'pending')!
    const manual = structuredClone(commands.getDraft(pid, target.target_id).target); manual.description = '后续人工内容'
    commands.syncEditorDraft(pid, manual)
    assert.equal(commands.applyCandidate(pid, pending.candidate_id).status, 'conflict')
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '后续人工内容')
    assert.deepEqual(commands.listCandidates(pid, target.target_id).find(c => c.candidate_id === candidate.candidate_id)!.proposal, candidate.proposal)
    const third = await commands.proposeEditPlan(pid, { goal: '修改', targetId: target.target_id })
    await commands.approvePlan(pid, third.plan_id)
    const revisionCandidate = commands.listCandidates(pid, target.target_id).find(c => c.status === 'pending')!
    store.saveTarget(pid, { ...target, description: '外部更新' })
    assert.equal(commands.applyCandidate(pid, revisionCandidate.candidate_id).status, 'conflict')
    const beforeRejected = commands.listCandidates(pid, target.target_id).length
    patch = { request: { auth: { bearer: { key: '[已隐藏]' } } } }
    const masked = await commands.proposeEditPlan(pid, { goal: '检查占位符', targetId: target.target_id })
    assert.equal(masked.status, 'paused')
    assert.equal(commands.listCandidates(pid, target.target_id).length, beforeRejected)
    patch = { description: '独立的待确认说明' }
    const versionsBefore = store.listTargetVersions(pid, target.target_id).length
    for (let index = 0; index < 102; index++) {
      const next = await commands.proposeEditPlan(pid, { goal: `候选 ${index}`, targetId: target.target_id })
      await commands.approvePlan(pid, next.plan_id)
    }
    assert.equal(commands.listCandidates(pid, target.target_id).filter(c => c.status === 'pending').length, 102)
    assert.equal(store.listTargetVersions(pid, target.target_id).length, versionsBefore)
    const projectFiles = fs.readdirSync(path.join(store.getPaths().projectRoot, pid), { recursive: true }).filter(name => typeof name === 'string') as string[]
    for (const name of projectFiles) {
      const file = path.join(store.getPaths().projectRoot, pid, name)
      if (fs.statSync(file).isFile()) assert(!fs.readFileSync(file, 'utf8').includes(candidate.candidate_id), 'Agent candidate must not appear in project Git files')
    }
    console.log('PASS approved proposal, immutable candidate, draft-only application, secrets, concurrent edits, revision, quit guard, no trimming beyond 100, Git boundary and exit deduplication')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
