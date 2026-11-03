import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import * as store from '../src/main/storage/store'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import { callTool } from '../src/main/mcp/tools'
import { registerIpc } from '../src/main/ipc'
import { startMcpServer, stopMcpServer } from '../src/main/mcp/server'
import type { FlowRun, Result } from '../src/shared/types'

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    assert(Date.now() < deadline, 'condition did not become true')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
async function waitForRun(projectId: string, runId: string, config: ReturnType<typeof store.getMcpConfig>): Promise<FlowRun> {
  let run: FlowRun | undefined
  await waitUntil(() => {
    run = store.getFlowRun(projectId, runId) ?? undefined
    return Boolean(run && run.status !== 'running')
  })
  const query = await callTool('get_flow_run', { project_id: projectId, run_id: runId }, config)
  assert(query.ok)
  return query.result as FlowRun
}

async function main(): Promise<void> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-async-'))
  app.setPath('userData', userData)
  await app.whenReady()
  let received!: () => void
  const arrived = new Promise<void>(resolve => { received = resolve })
  let release!: () => void
  let requestCount = 0
  const server = http.createServer((_request, response) => {
    requestCount++
    release = () => response.end('{"ok":true}')
    received()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let window: BrowserWindow | undefined
  try {
    const projectId = store.ensureDefaultProject().project_id
    const flow = createFlow(projectId, '异步运行')
    const port = (server.address() as import('node:net').AddressInfo).port
    flow.events = [createFlowEvent('request', { url: `http://127.0.0.1:${port}/hold`, method: 'GET' })]
    store.saveFlow(projectId, flow)
    const config = { ...store.getMcpConfig(), enabled: true, allow_execute: true, allowed_project_ids: [projectId] }
    store.saveMcpConfig(config)
    const args = { project_id: projectId, flow_id: flow.flow_id, environment_id: '', request_id: 'first-request' }
    const started = await callTool('start_flow_run', args, config)
    assert(started.ok, started.ok ? '' : started.error)
    const run = started.result as FlowRun
    assert.equal(run.status, 'running')
    assert(run.run_id)
    await arrived
    const query = await callTool('get_flow_run', { project_id: projectId, run_id: run.run_id }, config)
    assert(query.ok)
    assert.equal((query.result as FlowRun).status, 'running')
    const duplicate = await callTool('start_flow_run', args, config)
    assert(duplicate.ok)
    assert.equal((duplicate.result as FlowRun).run_id, run.run_id)
    const changed = await callTool('start_flow_run', { ...args, environment_id: 'different' }, config)
    assert(!changed.ok && changed.error.includes('request_id'))
    const conflict = await callTool('start_flow_run', { ...args, request_id: 'second-request' }, config)
    assert(!conflict.ok && conflict.error.includes('活动运行'))
    const readonly = { ...config, allow_execute: false }
    assert(!(await callTool('start_flow_run', { ...args, request_id: 'denied' }, readonly)).ok)
    assert((await callTool('get_flow_run', { project_id: projectId, run_id: run.run_id }, readonly)).ok)
    const otherProject = store.createProjectWithDefaults('另一个项目')
    const wrongProject = await callTool('get_flow_run', { project_id: otherProject.project_id, run_id: run.run_id }, { ...config, allowed_project_ids: [] })
    assert(!wrongProject.ok)
    assert.equal(requestCount, 1)
    release()
    const finished = await waitForRun(projectId, run.run_id, config)
    assert.equal(finished.status, 'passed')
    assert.equal(finished.events[0].response?.code, 200)
    assert.equal(finished.request_id, args.request_id)
    const persisted = store.getFlowRun(projectId, run.run_id)!
    assert(fs.existsSync(path.join(store.getPaths().localRoot, 'projects', projectId, 'executions', 'runs', `${run.run_id}.json`)))
    assert.equal(persisted.status, 'passed')
    const after = await callTool('start_flow_run', args, config)
    assert(after.ok)
    assert.equal((after.result as FlowRun).run_id, run.run_id)
    assert.equal(requestCount, 1)
    console.log('PASS async identity, active lock, scoped query, permission and persistent idempotency')

    registerIpc()
    window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
    await window.loadURL('about:blank')
    const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => window!.webContents.executeJavaScript(
      `require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`
    )
    const ui = await invoke<FlowRun>('flow:run:start', projectId, flow.flow_id, '', 'ui-run')
    assert(ui.ok)
    assert.equal(ui.data.status, 'running')
    const uiQuery = await invoke<FlowRun>('flow:run:get', projectId, ui.data.run_id)
    assert(uiQuery.ok && uiQuery.data.status === 'running')
    await waitUntil(() => requestCount === 2)
    release()
    await waitForRun(projectId, ui.data.run_id, config)
    console.log('PASS actual UI IPC starts, queries and completes an independent Run')

    const quick = createFlow(projectId, '旧同步合同')
    quick.events = [createFlowEvent('script', { script: 'pm.test("ok", () => pm.expect(1).to.eql(1));' })]
    store.saveFlow(projectId, quick)
    const legacy = await callTool('execute_flow', { project_id: projectId, flow_id: quick.flow_id }, config)
    assert(legacy.ok)
    assert.equal((legacy.result as any).status, 'passed')
    assert.equal((legacy.result as any).scope, 'flow')
    assert.equal(typeof (legacy.result as any).elapsed_ms, 'number')
    console.log('PASS legacy execute_flow returns the original completed summary')

    const legacyStarted = Date.now()
    const slow = await callTool('execute_flow', { project_id: projectId, flow_id: flow.flow_id }, config)
    const elapsed = Date.now() - legacyStarted
    assert(slow.ok)
    assert.equal((slow.result as any).status, 'running')
    assert(elapsed >= 19_500 && elapsed < 23_000, `bounded legacy wait took ${elapsed}ms`)
    assert.equal(requestCount, 3)
    release()
    await waitForRun(projectId, (slow.result as any).run_id, config)
    console.log('PASS execute_flow returns a queryable active run after its 20 second bound')

    const reservation = net.createServer()
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const bridgePort = (reservation.address() as net.AddressInfo).port
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    const bridgeConfig = store.saveMcpConfig({ ...config, port: bridgePort })
    assert((await startMcpServer()).running)
    const disconnectedArgs = { ...args, request_id: 'disconnected-run' }
    const tcpRun = await new Promise<FlowRun>((resolve, reject) => {
      const socket = net.connect(bridgePort, '127.0.0.1', () => {
        socket.write(JSON.stringify({ id: 'start', token: bridgeConfig.token, tool: 'start_flow_run', args: disconnectedArgs }) + '\n')
      })
      let data = ''
      socket.setEncoding('utf8')
      socket.on('error', reject)
      socket.on('data', chunk => {
        data += chunk
        if (!data.includes('\n')) return
        const message = JSON.parse(data.split('\n')[0])
        socket.destroy()
        if (!message.ok) reject(new Error(message.error))
        else resolve(message.result)
      })
    })
    await waitUntil(() => requestCount === 4)
    const reconnected = await callTool('start_flow_run', disconnectedArgs, bridgeConfig)
    assert(reconnected.ok && (reconnected.result as FlowRun).run_id === tcpRun.run_id)
    release()
    await waitForRun(projectId, tcpRun.run_id, config)
    assert.equal(requestCount, 4)
    console.log('PASS real TCP MCP disconnect preserves Run and retry does not replay HTTP')
  } finally {
    release?.()
    await stopMcpServer()
    window?.destroy()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(userData, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
