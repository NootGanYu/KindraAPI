import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import * as store from '../src/main/storage/store'
import { createEnvironment, createFlow, createFlowEvent } from '../src/shared/factories'
import { runSavedFlow } from '../src/main/flow/service'
import { registerIpc } from '../src/main/ipc'
import { callTool } from '../src/main/mcp/tools'
import type { Flow, FlowRun, Result } from '../src/shared/types'

async function main(): Promise<void> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-entry-'))
  app.setPath('userData', userData)
  await app.whenReady()
  const requests: string[] = []
  const server = http.createServer((request, response) => {
    requests.push(request.url ?? '')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ token: 'flow-token', orderId: 17 }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let window: BrowserWindow | undefined
  try {
    const project = store.ensureDefaultProject()
    const address = server.address() as import('node:net').AddressInfo
    const target = store.createTargetInProject(project.project_id, '0', 'api')
    target.url = `http://127.0.0.1:${address.port}/login`
    store.saveTarget(project.project_id, target)
    const flow = createFlow(project.project_id, '共享入口')
    flow.events = [createFlowEvent('api', { target_id: target.target_id })]
    store.saveFlow(project.project_id, flow)
    const run = await runSavedFlow(project.project_id, flow.flow_id)
    assert.equal(run.status, 'passed')
    assert.equal(run.project_id, project.project_id)
    assert.equal(run.flow_id, flow.flow_id)
    assert.deepEqual(requests, ['/login'])
    const savedRun = store.getFlowRun(project.project_id, run.run_id)!
    assert.equal(savedRun.status, 'passed')
    assert.equal(savedRun.events[0].response?.code, 200)
    assert.equal(savedRun.events[0].response?.body, '{"token":"[REDACTED]","orderId":17}')
    console.log('PASS saved flow public entry sends a request and exposes its persisted result')

    registerIpc()
    window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
    await window.loadURL('about:blank')
    // Use real renderer IPC rather than invoking registered handlers or replacing storage.
    const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
      window!.webContents.executeJavaScript(
        `require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`
      )
    const unwrap = <T>(value: Result<T>): T => {
      assert(value.ok, value.ok ? '' : value.error)
      return value.data
    }
    const env = createEnvironment(project.project_id, '入口指定环境')
    env.env_var_list.entry = { current_value: 'chosen', initial_value: '', description: '', is_checked: 1 }
    store.saveEnvironment(project.project_id, env)
    const grouped = unwrap(await invoke<Flow>('flow:create', project.project_id, '所有既有事件'))
    grouped.env_id = env.env_id
    grouped.events = [
      createFlowEvent('script', { script: 'pm.environment.set("entry", "chosen");' }),
      createFlowEvent('begin', { children: [
        createFlowEvent('api', { target_id: target.target_id }),
        createFlowEvent('script', { script: 'pm.environment.set("token", pm.response.json().token); pm.test("token", () => pm.expect(pm.response.json().token).to.eql("flow-token"));' }),
        createFlowEvent('assert', { assertions: [{ assert_id: 'token', type: 'json', path: 'token', op: 'equals', expected: 'flow-token' }] })
      ] }),
      createFlowEvent('if', { condition: 'env.token === "flow-token"', children: [
        createFlowEvent('loop', { loop_count: 2, children: [
          createFlowEvent('request', { url: `http://127.0.0.1:${address.port}/orders?token={{token}}`, method: 'GET' }),
          createFlowEvent('wait', { wait_ms: 0 })
        ] })
      ] }),
      createFlowEvent('if', { condition: 'false', children: [createFlowEvent('api', { target_id: target.target_id })] }),
      createFlowEvent('api', { target_id: target.target_id, enabled: false })
    ]
    const saved = unwrap(await invoke<Flow>('flow:save', project.project_id, grouped, grouped.revision))
    requests.length = 0
    const uiRun = unwrap(await invoke<FlowRun>('flow:run', project.project_id, saved.flow_id, env.env_id))
    assert.equal(uiRun.status, 'passed')
    assert.equal(uiRun.env_id, env.env_id)
    assert.equal(uiRun.variables.token, '[REDACTED]')
    assert.equal(uiRun.events[3].status, 'skipped')
    assert.equal(uiRun.events[4].status, 'skipped')
    assert.deepEqual(uiRun.events[2].children![0].children!.map(event => event.iteration), [0, 0, 1, 1])
    assert.deepEqual(requests, ['/login', '/orders?token=flow-token', '/orders?token=flow-token'])
    assert.equal(unwrap(await invoke<FlowRun>('flow:run:get', project.project_id, uiRun.run_id)).status, 'passed')
    console.log('PASS real UI save/run/query IPC preserves scripts, assertions, conditions, groups, loops and disabled events')

    const config = { ...store.getMcpConfig(), enabled: true, allow_execute: true, allowed_project_ids: [project.project_id] }
    requests.length = 0
    const mcp = await callTool('execute_flow', { project_id: project.project_id, flow_id: saved.flow_id, environment_id: env.env_id }, config)
    assert(mcp.ok, mcp.ok ? '' : mcp.error)
    const summary = mcp.result as { run_id: string; project_id: string; flow_id: string; status: string; scope: string; elapsed_ms: number }
    assert.equal(summary.project_id, project.project_id)
    assert.equal(summary.flow_id, saved.flow_id)
    assert.equal(summary.status, 'passed')
    assert.equal(summary.scope, 'flow')
    assert.equal(typeof summary.elapsed_ms, 'number')
    assert.deepEqual(requests, ['/login', '/orders?token=flow-token', '/orders?token=flow-token'])
    const mcpRun = unwrap(await invoke<FlowRun>('flow:run:get', project.project_id, summary.run_id))
    assert.equal(mcpRun.variables.token, '[REDACTED]')
    assert.equal(mcpRun.env_id, env.env_id)
    assert.deepEqual(mcpRun.events.map(event => event.status), uiRun.events.map(event => event.status))
    console.log('PASS MCP execute_flow keeps its summary and UI-readable report with the same requests')

    // The explicit environment must reach the engine even if the saved flow selects another.
    const override = createFlow(project.project_id, '环境参数传递')
    override.events = [createFlowEvent('script', { script: 'pm.test("environment", () => pm.expect(pm.environment.get("entry")).to.eql("chosen"));' })]
    store.saveFlow(project.project_id, override)
    assert.equal(unwrap(await invoke<FlowRun>('flow:run', project.project_id, override.flow_id, env.env_id)).status, 'passed')
    const overrideMcp = await callTool('execute_flow', { project_id: project.project_id, flow_id: override.flow_id, environment_id: env.env_id }, config)
    assert(overrideMcp.ok && (overrideMcp.result as { status: string }).status === 'passed')
    const otherProject = store.createProjectWithDefaults('隔离项目')
    const wrongProject = await invoke<FlowRun>('flow:run', otherProject.project_id, saved.flow_id)
    assert(!wrongProject.ok && wrongProject.error.includes('流程不存在'))
    const denied = await callTool('execute_flow', { project_id: project.project_id, flow_id: saved.flow_id }, { ...config, allow_execute: false })
    assert(!denied.ok)
    const missing = await callTool('execute_flow', { project_id: project.project_id, flow_id: 'missing' }, config)
    assert(!missing.ok && missing.error.includes('流程不存在'))
    assert.deepEqual(requests, ['/login', '/orders?token=flow-token', '/orders?token=flow-token'])
    console.log('PASS explicit environment, project isolation, missing flow and existing MCP execute policy')
  } finally {
    window?.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(userData, { recursive: true, force: true })
  }
}

main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
