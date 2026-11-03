import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import * as store from '../src/main/storage/store'
import { callTool } from '../src/main/mcp/tools'
import { registerIpc } from '../src/main/ipc'
import { runSavedFlow } from '../src/main/flow/service'
import { createTarget } from '../src/shared/factories'
import type { Flow } from '../src/shared/types'

async function main(): Promise<void> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-dependency-'))
  app.setPath('userData', temp)
  await app.whenReady()
  const projectId = store.ensureDefaultProject().project_id
  const config = { ...store.getMcpConfig(), enabled: true, allow_write: true, allow_execute: true, allowed_project_ids: [projectId] }
  store.saveMcpConfig(config)
  const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const result = await callTool(name, { project_id: projectId, ...args }, config)
    assert(result.ok, result.ok ? '' : result.error)
    return result.result
  }
  const create = async (events: unknown[]): Promise<Flow> => {
    const created = await call('create_execution_flow', { name: '依赖流程', events })
    return (await call('get_execution_flow', { flow_id: created.flow_id })).flow
  }
  const script = (event_id: string, extra: Record<string, unknown> = {}) => ({ event_id, type: 'script', name: event_id, enabled: true, script: '', ...extra })
  try {
    const flow = await create([script('first'), script('second', { depends_on: ['first'] }), script('independent', { depends_on: [] })])
    assert.deepEqual(flow.events[1].depends_on, ['first'])
    assert.deepEqual(flow.events[2].depends_on, [])
    for (const [events, pattern] of [
      [[script('first', { depends_on: ['missing'] })], /不存在/],
      [[script('first', { depends_on: ['second'] }), script('second', { depends_on: ['first'] })], /环/],
      [[script('first', { depends_on: 'second' })], /数组/]
    ] as const) {
      const response = await callTool('update_execution_flow', { project_id: projectId, flow_id: flow.flow_id, events, expected_revision: flow.revision }, config)
      assert.equal(response.ok, false, 'invalid dependency must be rejected before writing')
      assert.match((response as { error: string }).error, pattern)
      assert.deepEqual((await call('get_execution_flow', { flow_id: flow.flow_id })).flow, flow)
    }
    console.log('PASS dependency definitions round trip and invalid references/cycles never write')
    const requests: string[] = []
    const server = http.createServer((request, response) => {
      requests.push(request.url!)
      if (request.url === '/network-error') { request.socket.destroy(); return }
      response.writeHead(201, { 'content-type': 'application/json' })
      response.end('{"created":true}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    const request = (id: string, extra: Record<string, unknown> = {}) => ({ event_id: id, type: 'request', name: id, enabled: true, method: 'POST', url: `${origin}/${id}`, ...extra })
    try {
      const failureFlow = await create([
        script('fail', { script: 'throw new Error("前置失败")', logical_step_id: 'group' }),
        request('same-group', { logical_step_id: 'group', depends_on: [] }),
        request('dependent', { depends_on: ['fail'] }),
        request('implicit'),
        request('independent', { depends_on: [], assertions: [{ assert_id: 'created', type: 'status', expected: 201 }] }),
        request('still-conservative'),
        request('known-good', { depends_on: ['independent'] })
      ])
      const run = await runSavedFlow(projectId, failureFlow.flow_id)
      assert.deepEqual(requests, ['/independent', '/known-good'], 'failure only permits proven independent work; grouped pre failure cannot be bypassed')
      assert.equal(run.status, 'blocked')
      assert.deepEqual(run.events.map(event => event.status), ['failed', 'blocked', 'blocked', 'blocked', 'passed', 'blocked', 'passed'])
      const queried = await call('get_flow_run', { run_id: run.run_id })
      assert.equal(queried.status, 'blocked')
      assert.equal(queried.events[1].status, 'blocked')
      console.log('PASS conservative dependency blocking, grouped pre-script failure and explicit independent 201 success')
      const api = createTarget(projectId, '0', 'api', '接口断言')
      api.url = `${origin}/api`
      api.request!.test = 'pm.test("应返回200", () => pm.expect(pm.response.code).to.eql(200))'
      api.request!.test_enabled = true
      store.saveTarget(projectId, api)
      const assertionFlow = await create([
        { event_id: 'api', type: 'api', enabled: true, name: '接口断言失败', target_id: api.target_id },
        request('after-api'),
        script('step-assert', { depends_on: [], script: 'pm.test("步骤断言失败", () => pm.expect(1).to.eql(2))' }),
        request('after-step-assert')
      ])
      requests.length = 0
      const assertionRun = await runSavedFlow(projectId, assertionFlow.flow_id)
      assert.deepEqual(requests, ['/api'])
      assert.deepEqual(assertionRun.events.map(event => event.status), ['failed', 'blocked', 'failed', 'blocked'])
      assert.equal(assertionRun.events[0].assertions?.[0].passed, false)
      console.log('PASS API and step assertions both fail dependent steps')
      const grouped = await create([
        script('earlier-failure', { script: 'throw new Error("失败")' }),
        script('independent-pre', { logical_step_id: 'independent-group', depends_on: [] }),
        request('independent-api', { logical_step_id: 'independent-group' }),
        script('independent-post', { logical_step_id: 'independent-group', script: 'throw new Error("后置失败")' }),
        request('depends-whole-step', { depends_on: ['independent-api'] })
      ])
      requests.length = 0
      const groupedRun = await runSavedFlow(projectId, grouped.flow_id)
      assert.deepEqual(requests, ['/independent-api'], 'independent group keeps its whole pre/API/post sequence, then propagates post failure')
      assert.equal(groupedRun.events[3].status, 'failed')
      assert.equal(groupedRun.events[4].status, 'blocked')

      for (const phase of ['pre_script', 'test'] as const) {
        api.request!.test = ''
        api.request!.pre_script = ''
        api.request![phase] = 'throw new Error("接口脚本错误")'
        api.request!.pre_script_enabled = true
        store.saveTarget(projectId, api)
        const scriptFailure = await create([
          { event_id: 'script-api', type: 'api', enabled: true, name: '接口脚本错误', target_id: api.target_id },
          request('after-api-error')
        ])
        requests.length = 0
        const scriptRun = await runSavedFlow(projectId, scriptFailure.flow_id)
        assert.equal(scriptRun.events[0].status, 'failed', `${phase} exceptions fail the step`)
        assert.equal(scriptRun.events[1].status, 'blocked')
        assert(!requests.includes('/after-api-error'))
      }
      const nested = await create([{ event_id: 'loop', type: 'loop', name: '循环', enabled: true, loop_count: 2, children: [
        { event_id: 'condition', type: 'if', name: '条件', enabled: true, condition: 'true', children: [request('nested')] },
        script('after-nested', { depends_on: ['nested'] })
      ] }])
      requests.length = 0
      const nestedRun = await runSavedFlow(projectId, nested.flow_id)
      assert.equal(nestedRun.status, 'passed')
      assert.deepEqual(requests, ['/nested', '/nested'])
      const skipped = await create([{ event_id: 'false', type: 'if', name: '不成立条件', enabled: true, condition: 'false', children: [request('never')] }, request('after-false'), request('needs-never', { depends_on: ['never'] })])
      requests.length = 0
      const skippedRun = await runSavedFlow(projectId, skipped.flow_id)
      assert.deepEqual(requests, ['/after-false'])
      assert.equal(skippedRun.events[2].status, 'blocked', 'an explicitly required skipped event has no output')
      const networkFailure = await create([request('network-error'), request('after-network-error')])
      requests.length = 0
      const networkRun = await runSavedFlow(projectId, networkFailure.flow_id)
      assert.equal(networkRun.events[1].status, 'blocked')
      assert.deepEqual(requests, ['/network-error'], 'network failure never retries or dispatches dependent requests')
      console.log('PASS API script errors, nested condition/loop compatibility, unavailable dependencies and network failure without retry')
      registerIpc()
      const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
      try {
        await window.loadURL('data:text/html,<title>flow dependency IPC smoke</title>')
        const invoke = (channel: string, ...args: unknown[]): Promise<any> => window.webContents.executeJavaScript(
          `require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`)
        const ui = await invoke('flow:get', projectId, flow.flow_id)
        assert.deepEqual(ui.data.events[1].depends_on, ['first'])
        const invalid = { ...ui.data, events: [script('bad', { depends_on: ['missing'] })] }
        const rejected = await invoke('flow:save', projectId, invalid, ui.data.revision)
        assert.equal(rejected.ok, false)
        const saved = await invoke('flow:save', projectId, { ...ui.data, events: [script('independent', { depends_on: [] })] }, ui.data.revision)
        assert(saved.ok, saved.error)
        assert.deepEqual((await call('get_execution_flow', { flow_id: flow.flow_id })).flow.events[0].depends_on, [])
        const uiRun = await invoke('flow:run', projectId, failureFlow.flow_id)
        assert(uiRun.ok, uiRun.error)
        assert.equal(uiRun.data.status, 'blocked')
        console.log('PASS real UI IPC checked save, invalid dependency rejection and blocked run result')
      } finally { window.destroy() }


    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }

  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
