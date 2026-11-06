import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import * as store from '../src/main/storage/store'
import { createEnvironment, createFlow, createFlowEvent, createParam, createRequest } from '../src/shared/factories'
import { runSavedFlow, startFlowRun, waitForFlowRun, getFlowRun, previewFlowRunRefresh, approveFlowRunScope, applyFlowRunRefresh, resumeFlowRun, cancelFlowRun } from '../src/main/flow/service'
import { sendRequest } from '../src/main/request/executor'
import { callTool } from '../src/main/mcp/tools'

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-snapshot-'))
  app.setPath('userData', dir)
  await app.whenReady()
  const requests: Array<{ server: string; url: string; body: string; headers: http.IncomingHttpHeaders }> = []
  let onRequest: ((response: http.ServerResponse) => void) | undefined
  const servers = ['A', 'B'].map(name => http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      requests.push({ server: name, url: req.url!, body, headers: req.headers })
      res.setHeader('Content-Type', 'application/json')
      if (onRequest) { const handler = onRequest; onRequest = undefined; handler(res) }
      else res.end('{"token":"session-token","id":42}')
    })
  }))
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))))
  try {
    const project = store.ensureDefaultProject()
    const pid = project.project_id
    const envs = servers.map((server, index) => {
      const env = createEnvironment(pid, ['A', 'B'][index])
      env.server_list[0].uri = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
      env.env_var_list.chosen = { current_value: ['A', 'B'][index], initial_value: '', is_checked: 1 }
      return store.saveEnvironment(pid, env)
    })
    const api = store.createTargetInProject(pid, '0', 'api')
    api.url = '/first?env={{chosen}}'
    api.request!.pre_script = 'pm.request.headers.add({key:"X-Script-Env",value:pm.environment.get("chosen")});'
    store.saveTarget(pid, api)
    const flow = createFlow(pid, '环境快照', envs[0].env_id)
    flow.events = [createFlowEvent('api', { target_id: api.target_id })]
    store.saveFlow(pid, flow)
    const run = await runSavedFlow(pid, flow.flow_id, envs[1].env_id)
    assert.equal(run.status, 'passed')
    assert.equal(run.env_id, envs[1].env_id)
    assert.deepEqual(requests.map(r => [r.server, r.url, r.headers['x-script-env']]), [['B', '/first?env=B', 'B']])
    console.log('PASS selected environment binds request and API script')
    envs[1].env_var_list.disabled = { current_value: 'DISABLED-CREDENTIAL', initial_value: 'DISABLED-INITIAL', is_checked: 0 }
    envs[1].env_var_list.empty = { current_value: '', initial_value: 'NOT-CURRENT', is_checked: 1 }
    store.saveEnvironment(pid, envs[1])
    const parity = store.createTargetInProject(pid, '0', 'api')
    parity.url = '/parity?disabled={{disabled}}&empty={{empty}}'
    parity.request!.pre_script = 'pm.test("disabled stays absent", () => pm.expect(pm.environment.get("disabled")).to.eql(undefined));'
    store.saveTarget(pid, parity)
    const parityFlow = createFlow(pid, '环境变量发送兼容')
    parityFlow.events = [createFlowEvent('api', { target_id: parity.target_id })]
    store.saveFlow(pid, parityFlow)
    requests.length = 0
    const ordinary = await sendRequest(pid, parity, envs[1].env_id)
    const parityRun = await runSavedFlow(pid, parityFlow.flow_id, envs[1].env_id)
    assert.equal(ordinary.assertions[0].passed, true)
    assert.equal(parityRun.status, 'passed')
    assert.deepEqual(requests.map(r => r.url), ['/parity?disabled=%7B%7Bdisabled%7D%7D&empty=', '/parity?disabled=%7B%7Bdisabled%7D%7D&empty='])
    console.log('PASS unchecked and empty environment variables match ordinary sends')

    const globals = store.getGlobalVars(pid)
    globals.vars.flag = { current_value: 'old', initial_value: '' }
    store.saveGlobalVars(pid, globals)
    const folder = store.createTargetInProject(pid, '0', 'folder')
    folder.request ??= createRequest()
    folder.request!.header.parameter = [createParam({ key: 'X-Inherited', value: 'old-folder' })]
    store.saveTarget(pid, folder)
    const next = store.createTargetInProject(pid, folder.target_id, 'api')
    next.url = '/next?flag={{flag}}&token={{token}}&id={{objectId}}'
    next.request!.test = 'pm.test("API sees token", () => pm.expect(pm.environment.get("token")).to.eql("session-token"));'
    store.saveTarget(pid, next)
    api.request!.test = 'pm.environment.set("token", pm.response.json().token); pm.variables.set("objectId", String(pm.response.json().id));'
    store.saveTarget(pid, api)
    flow.events = [createFlowEvent('api', { target_id: api.target_id }), createFlowEvent('api', { target_id: next.target_id }), createFlowEvent('script', { script: 'pm.test("flow sees API output", () => pm.expect(pm.environment.get("token")).to.eql("session-token"));' })]
    store.saveFlow(pid, flow)
    requests.length = 0
    let release!: () => void
    const entered = new Promise<void>(resolve => { onRequest = res => { release = () => res.end('{"token":"session-token","id":42}'); resolve() } })
    const pending = runSavedFlow(pid, flow.flow_id, envs[1].env_id)
    await entered
    next.url = '/edited?flag={{flag}}&token={{token}}&id={{objectId}}'
    store.saveTarget(pid, next)
    folder.request!.header.parameter[0].value = 'new-folder'
    store.saveTarget(pid, folder)
    globals.vars.flag.current_value = 'new'
    store.saveGlobalVars(pid, globals)
    release()
    const isolated = await pending
    assert.equal(isolated.status, 'passed')
    assert.equal(requests[1].url, '/next?flag=old&token=session-token&id=42')
    assert.equal(requests[1].headers['x-inherited'], 'old-folder')
    assert.equal(store.getGlobalVars(pid).vars.flag.current_value, 'new')
    assert.equal(store.listEnvironments(pid).find(e => e.env_id === envs[1].env_id)!.env_var_list.token, undefined)
    const config = { ...store.getMcpConfig(), enabled: true, allow_execute: true, allowed_project_ids: [pid] }
    store.saveMcpConfig(config)
    requests.length = 0
    const mcp = await callTool('execute_flow', { project_id: pid, flow_id: flow.flow_id, environment_id: envs[1].env_id }, config)
    assert(mcp.ok)
    assert.equal(requests[1].url, '/edited?flag=new&token=session-token&id=42')
    assert.equal(requests[1].headers['x-inherited'], 'new-folder')
    console.log('PASS snapshot isolates API, inheritance, globals and propagates API/flow scopes; next MCP run adopts saves')
    const model = store.createModelInProject(pid, '0', 'model')
    model.data.schema = { type: 'object', properties: { version: { type: 'string', example: 'before' } } }
    store.saveModel(pid, model)
    next.method = 'POST'
    next.request!.body = { mode: 'json', model_id: model.model_id, raw: 'original-cache' }
    store.saveTarget(pid, next)
    const modelEntered = new Promise<void>(resolve => { onRequest = res => { release = () => res.end('{"token":"session-token","id":42}'); resolve() } })
    requests.length = 0
    const modelPending = runSavedFlow(pid, flow.flow_id, envs[1].env_id)
    await modelEntered
    model.data.schema.properties!.version.example = 'after'
    store.saveModel(pid, model)
    release()
    await modelPending
    assert.deepEqual(JSON.parse(requests[1].body), { version: 'before' })
    assert.equal(store.getTarget(pid, next.target_id)!.request!.body.raw, 'original-cache')
    assert.equal(store.getTarget(pid, next.target_id)!.request!.body.model_id, model.model_id)
    requests.length = 0
    await runSavedFlow(pid, flow.flow_id, envs[1].env_id)
    assert.deepEqual(JSON.parse(requests[1].body), { version: 'after' })
    requests.length = 0
    await sendRequest(pid, store.getTarget(pid, next.target_id)!, envs[1].env_id)
    assert.deepEqual(JSON.parse(requests[0].body), { version: 'after' })
    console.log('PASS model is generated for the Run without rewriting persistent API references')
    const file = path.join(dir, 'upload.txt')
    fs.writeFileSync(file, 'original-file')
    next.request!.body = { mode: 'binary', binary: { file_path: file } }
    next.request!.pre_script = 'pm.variables.set("upload_api_runs", String(Number(pm.variables.get("upload_api_runs") || 0) + 1));'
    store.saveTarget(pid, next)
    flow.events = [createFlowEvent('api', { target_id: api.target_id }), createFlowEvent('script', { logical_step_id: 'upload', script: 'pm.variables.set("upload_step_runs", String(Number(pm.variables.get("upload_step_runs") || 0) + 1));' }), createFlowEvent('api', { logical_step_id: 'upload', target_id: next.target_id }), createFlowEvent('api', { target_id: api.target_id })]
    store.saveFlow(pid, flow)
    const fileEntered = new Promise<void>(resolve => { onRequest = res => { release = () => res.end('{"token":"session-token","id":42}'); resolve() } })
    requests.length = 0
    const filePending = startFlowRun(pid, flow.flow_id, envs[1].env_id, 'file-review')
    await fileEntered
    fs.writeFileSync(file, 'changed-file')
    release()
    const deadline = Date.now() + 5000
    while (getFlowRun(pid, filePending.run_id)?.status === 'running') {
      assert(Date.now() < deadline, 'file review did not pause')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const fileRun = getFlowRun(pid, filePending.run_id)!
    assert.equal(fileRun.status, 'paused')
    assert.match(fileRun.error!, /文件.*审查/)
    assert.equal(requests.length, 1)
    assert.equal(fileRun.events[0].status, 'passed')
    assert.equal(fileRun.variables.upload_step_runs, undefined, 'changed file pauses before logical step pre-script')
    assert.equal(fileRun.variables.upload_api_runs, undefined)
    assert.equal(fileRun.cursor!.stack.at(-1)!.next_event_index, 1)
    assert.equal(fileRun.snapshot!.requests[1].files[0].sha256!.length, 64)
    assert.throws(() => startFlowRun(pid, flow.flow_id, envs[1].env_id, 'locked'), /活动/)
    assert.throws(() => resumeFlowRun(pid, fileRun.run_id), /文件/)
    const preview = previewFlowRunRefresh(pid, fileRun.run_id)
    assert.equal(preview.references.length, 1)
    assert(preview.references[0].scope_changes.some(change => change.includes('文件')))
    approveFlowRunScope(pid, fileRun.run_id, preview.preview_id)
    applyFlowRunRefresh(pid, fileRun.run_id, preview.preview_id)
    assert.equal(getFlowRun(pid, fileRun.run_id)!.status, 'paused')
    resumeFlowRun(pid, fileRun.run_id)
    const continued = await waitForFlowRun(pid, fileRun.run_id)
    assert.equal(continued.status, 'passed')
    assert.equal(continued.run_id, fileRun.run_id)
    assert.equal(continued.variables.upload_step_runs, '1')
    assert.equal(continued.variables.upload_api_runs, '1')
    assert.equal(continued.events[0].instance_id, fileRun.events[0].instance_id)
    assert.equal(requests.length, 3)
    assert.equal(requests[1].body, 'changed-file')
    console.log('PASS changed file retains active Run; explicit review and manual continuation do not replay completed requests')
    const cancelEntered = new Promise<void>(resolve => { onRequest = res => { release = () => res.end('{"token":"session-token","id":42}'); resolve() } })
    const cancelRun = startFlowRun(pid, flow.flow_id, envs[1].env_id, 'file-cancel')
    await cancelEntered
    fs.writeFileSync(file, 'changed-again')
    release()
    await waitForFlowRun(pid, cancelRun.run_id)
    assert.equal(getFlowRun(pid, cancelRun.run_id)!.status, 'paused')
    const beforeCancel = requests.length
    assert.equal((await cancelFlowRun(pid, cancelRun.run_id)).status, 'cancelled')
    assert.equal(requests.length, beforeCancel)
    console.log('PASS cancellation exits external-file review without dispatch')
    requests.length = 0
    const fileNext = await runSavedFlow(pid, flow.flow_id, envs[1].env_id)
    assert.equal(fileNext.status, 'passed')
    assert.equal(requests[1].body, 'changed-again')
    console.log('PASS a new Run captures current file bytes and dispatches them')
    const captured = startFlowRun(pid, flow.flow_id, envs[1].env_id, 'snapshot-evidence')
    assert.equal(captured.snapshot!.flow_revision, store.getFlow(pid, flow.flow_id)!.revision)
    assert.equal(captured.snapshot!.environment_id, envs[1].env_id)
    assert.equal(captured.snapshot!.requests.length, 3)
    await waitForFlowRun(pid, captured.run_id)
    console.log('PASS async start exposes the captured saved revision before completion')

  } finally {
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
