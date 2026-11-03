import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { callTool } from '../src/main/mcp/tools'
import { agentCommands as commands, } from '../src/main/agent/service'
import { onDraftEvent } from '../src/main/agent/drafts'
import { useApp } from '../src/renderer/src/store'
import { connectAgentDraftSync, flushAgentDrafts } from '../src/renderer/src/agentDraftSync'
async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-agent-editor-'))); await app.whenReady()
  const project = store.ensureDefaultProject(), pid = project.project_id
  let target = store.createTargetInProject(pid, '0', 'api'); target.description = '应当保留的正式说明'; target.url = 'https://example.invalid/original'; store.saveTarget(pid, target)
  const config = { ...store.getMcpConfig(), enabled: true, allow_write: true, allowed_project_ids: [pid] }
  const api = { agent: Object.fromEntries(Object.entries(commands).map(([name, command]) => [name, async (...args: any[]) => ({ ok: true, data: await (command as any)(...args) })])), targets: { read: async (pid: string, id: string) => ({ ok: true, data: store.readTargetSnapshot(pid, id) }) } }
  ;(api.agent as any).onDraftChanged = onDraftEvent
  ;(globalThis as any).window = { api }
  useApp.setState({ project, ready: true, drafts: {}, tabs: [], baselines: {}, activeId: null })
  const off = connectAgentDraftSync()
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), name = body.tools?.[0]?.function.name
    const message = name ? { tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, target_id: target.target_id, patch: { name: 'Agent 后续名称' } }) } }] } : { content: '候选已创建' }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await useApp.getState().openTarget(target.target_id)
    useApp.getState().patchDraft(target.target_id, { description: '已放弃的手工内容' })
    useApp.getState().closeTab(target.target_id); await flushAgentDrafts()
    assert.equal(commands.getDraft(pid, target.target_id).target.description, '应当保留的正式说明', 'discard-close must release the manual mirror')
    const external = await callTool('upsert_api', { project_id: pid, target_id: target.target_id, url: 'https://example.invalid/mcp-new' }, config); assert(external.ok)
    await commands.saveConnection({ name: '生命周期', base_url: `http://127.0.0.1:${(server.address() as any).port}/v1`, model: 'lifecycle', protocol: 'chat-completions' }); await commands.testConnection()
    const plan = await commands.proposeEditPlan(pid, { goal: '修改名称', targetId: target.target_id }); await commands.approvePlan(pid, plan.plan_id)
    const candidate = commands.listCandidates(pid, target.target_id)[0]
    assert.equal(candidate.base.description, '应当保留的正式说明'); assert.equal(candidate.base.url, 'https://example.invalid/mcp-new')
    assert.equal(commands.applyCandidate(pid, candidate.candidate_id).status, 'applied')
    assert.equal(commands.getDraft(pid, target.target_id).target.url, 'https://example.invalid/mcp-new')
    await useApp.getState().openTarget(target.target_id); useApp.getState().closeTab(target.target_id); await flushAgentDrafts()
    assert.equal(commands.getDraft(pid, target.target_id).target.name, 'Agent 后续名称', 'closing an Agent-owned draft must preserve it')
    console.log('PASS discarded manual draft never revives; later MCP fields survive; Agent-owned draft survives tab close')
    target = store.createTargetInProject(pid, '0', 'api'); target.url = 'https://example.invalid/baseline'; store.saveTarget(pid, target)
    await useApp.getState().openTarget(target.target_id)
    useApp.getState().patchDraft(target.target_id, { description: '仍在编辑的内容' }); await flushAgentDrafts()
    const originalRevision = useApp.getState().baselines[target.target_id].revision
    const changed = await callTool('upsert_api', { project_id: pid, target_id: target.target_id, url: 'https://example.invalid/new-revision' }, config); assert(changed.ok)
    const stalePlan = await commands.proposeEditPlan(pid, { goal: '修改名称', targetId: target.target_id, draft: useApp.getState().drafts[target.target_id] })
    await commands.approvePlan(pid, stalePlan.plan_id)
    const staleCandidate = commands.listCandidates(pid, target.target_id)[0]
    assert.equal(staleCandidate.base_revision, originalRevision, 'an active old draft cannot borrow the newest disk revision')
    assert.equal(commands.applyCandidate(pid, staleCandidate.candidate_id).status, 'conflict')
    assert.equal(store.getTarget(pid, target.target_id)!.url, 'https://example.invalid/new-revision')
    console.log('PASS an active manual draft keeps its real baseline revision after an external change')
    await flushAgentDrafts()
    target = store.createTargetInProject(pid, '0', 'api')
    const queuedRevision = store.readTargetSnapshot(pid, target.target_id).revision
    const sync = api.agent.syncEditorDraft
    let release!: () => void, arrived!: () => void
    const started = new Promise<void>(resolve => { arrived = resolve })
    api.agent.syncEditorDraft = (...args: any[]) => {
      api.agent.syncEditorDraft = sync
      return new Promise(resolve => { release = () => { void sync(...args).then(resolve) }; arrived() })
    }
    await useApp.getState().openTarget(target.target_id)
    await started
    const queuedExternal = await callTool('upsert_api', { project_id: pid, target_id: target.target_id, url: 'https://example.invalid/while-ipc-queued' }, config); assert(queuedExternal.ok)
    release(); await flushAgentDrafts()
    assert.equal(commands.getDraft(pid, target.target_id).base_revision, queuedRevision, 'IPC scheduling must not relabel an older editor snapshot with a new disk revision')
    useApp.getState().closeTab(target.target_id); await flushAgentDrafts()
    assert.equal(commands.getDraft(pid, target.target_id).target.url, 'https://example.invalid/while-ipc-queued')
    console.log('PASS queued editor synchronization carries its original revision; release cannot be undone by an older queued update')

  } finally { off(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
