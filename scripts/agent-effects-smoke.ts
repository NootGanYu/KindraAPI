import { callTool } from '../src/main/mcp/tools'
import { onDraftEvent } from '../src/main/agent/drafts'
import { useApp } from '../src/renderer/src/store'
import { connectAgentDraftSync, flushAgentDrafts } from '../src/renderer/src/agentDraftSync'
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-effects-')); app.setPath('userData', root); await app.whenReady()
  const pid = store.ensureDefaultProject().project_id
  const target = store.createTargetInProject(pid, '0', 'api'), env = store.listEnvironments(pid)[0]
  env.env_var_list = { token: { current_value: 'initial-secret', initial_value: '', is_checked: 1 } }; store.saveEnvironment(pid, env)
  let hangClosed = false, deleteEnvironmentDuring = false, requestedSave = false
  let plannedIds: string[] | undefined
  const hits: Array<{ path?: string; body: string; auth?: string }> = []
  const api = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    hits.push({ path: req.url, body, auth: req.headers.authorization })
    if (req.url === '/hang') { res.once('close', () => { hangClosed = true }); return }
    if (req.url === '/drop') { req.socket.destroy(); return }
    if (req.url === '/partial') { res.writeHead(200); res.write('partial'); setTimeout(() => res.destroy(), 10); return }
    if (req.url === '/login') { res.end(JSON.stringify({ token: 'script-login-secret' })); return }
    if (deleteEnvironmentDuring) store.deleteEnvironment(pid, env.env_id)
    res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}')
  })
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(api.address() as any).port}`
  target.url = `${base}/main`; target.request!.auth = { type: 'bearer', bearer: { key: '{{token}}' } }
  target.request!.pre_script = `pm.sendRequest('${base}/login', (err, res) => { pm.environment.set('token', res.json().token); });`
  target.request!.test = "pm.globals.set('fromResponse', 'local-result-secret');"
  store.saveTarget(pid, target)
  const models: unknown[] = []
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = decodeModelRequest(req, JSON.parse(raw), protocol); models.push(body)
    const name = body.tools?.[0]?.function.name
    if (name === 'execute_api' && plannedIds) { respondModel(res, protocol, body.stream, { tool_calls: plannedIds.map((id, index) => ({ id: `call-${index}`, type: 'function', function: { name, arguments: JSON.stringify({ project_id: pid, target_id: id, step_id: `step-${index}`, depends_on: index ? [`step-${index - 1}`] : [] }) } })) }); return }
    respondModel(res, protocol, body.stream, name ? { tool_calls: [{ id: 'call1', type: 'function', function: { name, arguments: JSON.stringify(name === 'kindra_capability_probe' ? { token: 'kindra-probe' } : { project_id: pid, target_id: target.target_id, depends_on: [], ...(requestedSave ? { save_response: true } : {}), ...(name === 'propose_api_change' ? { patch: { name: '未保存的Agent名称' } } : {}) }) } }] } : { content: '已完成脚本执行' })
  })
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))
  try {
    await commands.saveConnection({ name: '副作用验证', base_url: `http://127.0.0.1:${(model.address() as any).port}/v1`, model: 'effects', protocol }); await commands.testConnection()
    const plan = await commands.proposeExecutePlan(pid, { goal: '登录后执行，不写回变量', targetId: target.target_id, environmentId: env.env_id, execution: { requests: [{ method: 'GET', url: `${base}/login` }] } })
    assert.equal(plan.status, 'pending'); assert.equal(hits.length, 0)
    assert(JSON.stringify(plan.steps[0].execution).includes('脚本'))
    const done = await commands.approvePlan(pid, plan.plan_id)
    assert.equal(done.steps[0].status, 'succeeded', JSON.stringify(done.steps[0].error))
    assert.deepEqual(hits.map(h => h.path), ['/login', '/main']); assert.equal(hits[1].auth, 'Bearer script-login-secret')
    assert.equal(store.listEnvironments(pid)[0].env_var_list.token.current_value, 'initial-secret')
    assert.equal(store.getGlobalVars(pid).vars.fromResponse, undefined)
    for (const secret of ['initial-secret', 'script-login-secret', 'local-result-secret']) { assert(!JSON.stringify(models).includes(secret)); assert(!JSON.stringify(commands.listPlans(pid)).includes(secret)) }
    console.log('PASS approved pre/post scripts and extra request evolve runtime variables without implicit persistence or leaking credentials')
    const queryToken = structuredClone(target); queryToken.request!.auth = { type: 'kv', kv: { key: 'access_token', value: '{{token}}', in: 'query' } }
    const queryPlan = await commands.proposeExecutePlan(pid, { goal: '使用演进的查询认证变量', targetId: target.target_id, draft: queryToken, environmentId: env.env_id, execution: { requests: [{ method: 'GET', url: `${base}/login` }] } })
    assert.equal((await commands.approvePlan(pid, queryPlan.plan_id)).status, 'completed')
    assert.equal(hits.at(-1)!.path, '/main?access_token=script-login-secret')
    const write = await commands.proposeExecutePlan(pid, { goal: '获批写回变量', targetId: target.target_id, environmentId: env.env_id, execution: { requests: [{ method: 'GET', url: `${base}/login` }], writeVariables: true } })
    assert.equal((await commands.approvePlan(pid, write.plan_id)).steps[0].status, 'succeeded')
    assert.equal(store.listEnvironments(pid)[0].env_var_list.token.current_value, 'script-login-secret')
    assert.equal(store.getGlobalVars(pid).vars.fromResponse.current_value, 'local-result-secret')
    console.log('PASS explicit variable authorization commits script deltas')
    const second = store.createTargetInProject(pid, '0', 'api'); second.url = `${base}/second`; second.request!.auth = { type: 'bearer', bearer: { key: '{{token}}' } }; store.saveTarget(pid, second)
    const batchEnv = store.listEnvironments(pid)[0]; batchEnv.env_var_list.token.current_value = 'disk-before-batch'; store.saveEnvironment(pid, batchEnv)
    plannedIds = [target.target_id, second.target_id]
    const batch = await commands.proposeExecutePlan(pid, { goal: '同一轮变量演进', targetId: target.target_id, targetIds: plannedIds, environmentId: env.env_id, execution: { requests: [{ method: 'GET', url: `${base}/login` }] } })
    assert.equal((await commands.approvePlan(pid, batch.plan_id)).status, 'completed'); plannedIds = undefined
    assert.equal(hits.at(-1)!.auth, 'Bearer script-login-secret'); assert.equal(store.listEnvironments(pid)[0].env_var_list.token.current_value, 'disk-before-batch')
    requestedSave = true
    const deniedSave = await commands.proposeExecutePlan(pid, { goal: '模型不能授权保存', targetId: target.target_id })
    assert.equal(deniedSave.status, 'paused'); assert.match(deniedSave.error!, /独立保存授权/); requestedSave = false
    const deleting = await commands.proposeExecutePlan(pid, { goal: '执行中删除环境', targetId: target.target_id, environmentId: env.env_id, execution: { requests: [{ method: 'GET', url: `${base}/login` }], writeVariables: true } })
    deleteEnvironmentDuring = true
    const deleted = await commands.approvePlan(pid, deleting.plan_id)
    assert.equal(deleted.status, 'paused'); assert.match(deleted.error!, /环境已删除/)
    deleteEnvironmentDuring = false; store.saveEnvironment(pid, batchEnv)
    console.log('PASS variables evolve across approved steps; environment deletion pauses writeback and model arguments cannot grant save authorization')
    const propose = (draft: typeof target, execution: any = {}) => commands.proposeExecutePlan(pid, { goal: '执行副作用边界', targetId: target.target_id, draft, environmentId: env.env_id, execution })
    const forbidden = structuredClone(target)
    forbidden.request!.pre_script = `pm.sendRequest('${base}/forbidden', () => pm.sendRequest('${base}/later'));`
    const denied = await propose(forbidden); const deniedBefore = hits.length
    assert.equal((await commands.approvePlan(pid, denied.plan_id)).status, 'paused')
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(hits.length, deniedBefore)
    const concurrent = structuredClone(target); concurrent.request!.pre_script = `pm.sendRequest('${base}/hang', () => {}); setTimeout(() => pm.sendRequest('${base}/forbidden'), 100);`
    const concurrentPlan = await propose(concurrent, { requests: [{ method: 'GET', url: `${base}/hang` }] })
    assert.equal((await commands.approvePlan(pid, concurrentPlan.plan_id)).steps[0].status, 'unknown')
    for (let i = 0; !hangClosed && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert(hangClosed, 'scope rejection must abort already-active subrequest sockets')
    assert(!hits.some(hit => hit.path === '/forbidden'))
    for (const route of ['/drop', '/partial']) {
      const cut = structuredClone(target); cut.request!.pre_script = `pm.sendRequest('${base}${route}', () => {});`
      const cutPlan = await propose(cut, { requests: [{ method: 'GET', url: `${base}${route}` }] })
      const before = hits.length
      assert.equal((await commands.approvePlan(pid, cutPlan.plan_id)).steps[0].status, 'unknown')
      assert.equal(hits.slice(before).filter(h => h.path === route).length, 1)
      await assert.rejects(() => commands.approvePlan(pid, cutPlan.plan_id), /批准/)
    }
    const changeTarget = structuredClone(target); changeTarget.request!.pre_script = `pm.request.url = '${base}/changed-target'`
    const changedTarget = await propose(changeTarget); const beforeTarget = hits.length
    assert.equal((await commands.approvePlan(pid, changedTarget.plan_id)).status, 'paused'); assert.equal(hits.length, beforeTarget)
    const hostChange = structuredClone(target); hostChange.request!.pre_script = "pm.request.headers.upsert({key:'Host',value:'unapproved.invalid'})"
    const hostPlan = await propose(hostChange); const hostBefore = hits.length
    assert.equal((await commands.approvePlan(pid, hostPlan.plan_id)).status, 'paused'); assert.equal(hits.length, hostBefore)
    const noFile = path.join(root, 'not-authorized.txt'); fs.writeFileSync(noFile, 'must-never-upload')
    const newFile = structuredClone(target); newFile.method = 'POST'; newFile.request!.pre_script = `pm.request.body.update({mode:'file',file:{src:${JSON.stringify(noFile)}}});`
    const fileScope = await propose(newFile); const beforeFileScope = hits.length
    assert.equal((await commands.approvePlan(pid, fileScope.plan_id)).status, 'paused'); assert.equal(hits.length, beforeFileScope)
    const stale = await propose(target, { requests: [{ method: 'GET', url: `${base}/login` }] })
    const edited = structuredClone(target); edited.request!.test = 'pm.globals.set("changed", "yes")'
    commands.syncEditorDraft(pid, edited)
    const beforeEdited = hits.length; assert.equal((await commands.approvePlan(pid, stale.plan_id)).status, 'paused'); assert.equal(hits.length, beforeEdited)
    commands.syncEditorDraft(pid, target)
    const conflictDraft = structuredClone(target); conflictDraft.request!.test = "pm.globals.set('conflictingNew', 'must-not-save')"
    const beforeConflict = store.listEnvironments(pid)[0]; beforeConflict.env_var_list.token.current_value = 'before-script-secret'; store.saveEnvironment(pid, beforeConflict)
    const conflict = await propose(conflictDraft, { requests: [{ method: 'GET', url: `${base}/login` }], writeVariables: true })
    const external = store.listEnvironments(pid)[0]; external.env_var_list.token.current_value = 'manual-later-secret'; store.saveEnvironment(pid, external)
    const conflicted = await commands.approvePlan(pid, conflict.plan_id)
    assert.equal(conflicted.status, 'paused'); assert.match(conflicted.error!, /外部修改/)
    assert.equal(store.listEnvironments(pid)[0].env_var_list.token.current_value, 'manual-later-secret'); assert.equal(store.getGlobalVars(pid).vars.conflictingNew, undefined)
    console.log('PASS forbidden requests/files/target changes stop the real run; nested transport loss is unknown; variable conflicts preserve manual values atomically')
    const noWrite = { ...store.getMcpConfig(), enabled: true, allowed_project_ids: [pid], allow_execute: true, allow_write: false }
    const beforeMcp = hits.length
    assert.equal((await callTool('execute_api', { project_id: pid, target_id: target.target_id, save_response: true }, noWrite)).ok, false)
    assert.equal(hits.length, beforeMcp)
    target.response = { example: [{ example_id: 'response-contract', expect: { name: '成功', code: 200, content_type: 'application/json' }, raw: '{"ok":false}', field_docs: [{ pointer: '/ok', description: '操作是否成功', type: 'boolean', required: true, nullable: false, enum: null }] }] }
    store.saveTarget(pid, target)
    commands.releaseEditorDraft(pid, target.target_id)
    const edit = await commands.proposeEditPlan(pid, { goal: 'Agent名称草稿', targetId: target.target_id })
    await commands.approvePlan(pid, edit.plan_id)
    const unrelatedCandidate = commands.listCandidates(pid, target.target_id)[0]; commands.applyCandidate(pid, unrelatedCandidate.candidate_id)
    const apiBoundary = { agent: Object.fromEntries(Object.entries(commands).map(([name, command]) => [name, async (...args: any[]) => ({ ok: true, data: await (command as any)(...args) })])), targets: { read: async (p: string, id: string) => ({ ok: true, data: store.readTargetSnapshot(p, id) }) } }
    ;(apiBoundary.agent as any).onDraftChanged = onDraftEvent; (globalThis as any).window = { api: apiBoundary }
    useApp.setState({ project: store.getProject(pid), ready: true, drafts: {}, tabs: [], baselines: {}, activeId: null })
    const offSync = connectAgentDraftSync()
    await useApp.getState().openTarget(target.target_id)
    useApp.getState().patchDraft(target.target_id, { description: '仍未保存的人工说明', response: { example: [...target.response!.example!, { example_id: 'manual-unsaved', expect: { name: '人工草稿示例', code: 201, content_type: 'text/plain' }, raw: 'manual-only' }] } }); await flushAgentDrafts()
    const responsePlan = await commands.proposeExecutePlan(pid, { goal: '执行并保存响应示例', targetId: target.target_id, environmentId: env.env_id, execution: { requests: [{ method: 'GET', url: `${base}/login` }], saveResponse: true } })
    assert(responsePlan.steps.some(step => step.operation === 'save_api_response'))
    const responseDone = await commands.approvePlan(pid, responsePlan.plan_id)
    assert.equal(responseDone.status, 'completed', responseDone.error)
    assert.equal(store.getTarget(pid, target.target_id)!.response!.example![0].raw, '{"ok":true}')
    assert.equal(store.getTarget(pid, target.target_id)!.response!.example!.length, 1)
    assert.equal(commands.getDraft(pid, target.target_id).target.response!.example!.length, 2)
    assert.notEqual(store.getTarget(pid, target.target_id)!.description, '仍未保存的人工说明')
    assert.equal(useApp.getState().drafts[target.target_id].description, '仍未保存的人工说明')
    assert.equal(useApp.getState().tabs.find(t => t.id === target.target_id)!.dirty, true)
    assert.notEqual(useApp.getState().baselines[target.target_id].target.description, '仍未保存的人工说明')
    assert.equal(commands.listCandidates(pid, target.target_id).find(c => c.candidate_id === unrelatedCandidate.candidate_id)!.saved_version, undefined)
    assert.equal(commands.getDraft(pid, target.target_id).agent_owned, true)
    assert.notEqual(store.getTarget(pid, target.target_id)!.name, '未保存的Agent名称')
    offSync()
    console.log('PASS save_response has an independently visible save step and MCP requires write permission before any network')
    const file = path.join(root, 'approved.txt'); fs.writeFileSync(file, 'approved-upload-bytes')
    const upload = structuredClone(target); upload.request!.pre_script = ''; upload.request!.test = ''; upload.method = 'POST'; upload.request!.body = { mode: 'binary', binary: { file_path: file } }
    const filePlan = await commands.proposeExecutePlan(pid, { goal: '上传已配置文件', targetId: target.target_id, draft: upload })
    assert(JSON.stringify(filePlan.steps[0].execution).includes(file))
    assert.equal((await commands.approvePlan(pid, filePlan.plan_id)).steps[0].status, 'succeeded')
    assert.equal(hits.at(-1)!.body, 'approved-upload-bytes')
    const changedFile = await commands.proposeExecutePlan(pid, { goal: '文件变化', targetId: target.target_id, draft: upload })
    fs.writeFileSync(file, 'changed-upload-bytes'); const fileHits = hits.length
    assert.equal((await commands.approvePlan(pid, changedFile.plan_id)).status, 'paused'); assert.equal(hits.length, fileHits)
    fs.writeFileSync(file, 'multipart-approved-bytes')
    upload.request!.body = { mode: 'formdata', formdata: [{ param_id: 'upload', key: 'file', value: file, field_type: 'file', is_checked: 1 }] }
    const multipart = await commands.proposeExecutePlan(pid, { goal: '上传multipart文件', targetId: target.target_id, draft: upload })
    assert.equal((await commands.approvePlan(pid, multipart.plan_id)).status, 'completed')
    assert(hits.at(-1)!.body.includes('multipart-approved-bytes'))
    console.log('PASS configured upload is authorized and exact file changes pause before network')
  } finally { for (const server of [api, model]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
