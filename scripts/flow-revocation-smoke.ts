import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import * as store from '../src/main/storage/store'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import { registerIpc } from '../src/main/ipc'
import { callTool, listToolInfos } from '../src/main/mcp/tools'
import { startMcpServer, stopMcpServer } from '../src/main/mcp/server'
import type { FlowRun, Result } from '../src/shared/types'

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-revocation-'))
  app.setPath('userData', dir)
  await app.whenReady()
  const hits: string[] = []
  let arrived!: () => void
  let arrival = new Promise<void>(resolve => { arrived = resolve })
  let release!: () => void
  const httpServer = http.createServer((req, res) => {
    hits.push(req.url!)
    if (req.url === '/hold') { release = () => res.end('{}'); arrived() }
    else res.end('{}')
  })
  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(httpServer.address() as net.AddressInfo).port}`
  const reservation = net.createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = (reservation.address() as net.AddressInfo).port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  const projectId = store.ensureDefaultProject().project_id
  const config = store.saveMcpConfig({ ...store.getMcpConfig(), enabled: true, allow_execute: true, allow_write: true, allowed_project_ids: [projectId], port })
  assert((await startMcpServer()).running)
  const tcp = (tool: string, args: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.write(JSON.stringify({ id: 'test', token: config.token, tool, args: { project_id: projectId, ...args } }) + '\n'))
    let buffer = ''
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('MCP timeout')) })
    socket.on('error', reject)
    socket.on('data', chunk => { buffer += chunk; if (buffer.includes('\n')) { socket.end(); resolve(JSON.parse(buffer.split('\n')[0])) } })
  })
  registerIpc()
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
  await window.loadURL('about:blank')
  const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => window.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`)
  const read = async (id: string) => { const result = await invoke<FlowRun>('flow:run:get', projectId, id); assert(result.ok); return result.data }
  const until = async (id: string, status: string) => {
    const deadline = Date.now() + 3000
    for (;;) { const run = await read(id); if (run.status === status) return run; assert(Date.now() < deadline, `expected ${status}, got ${run.status}`); await new Promise(resolve => setTimeout(resolve, 5)) }
  }
  try {
    const flow = createFlow(projectId, 'MCP 撤权')
    flow.events = [createFlowEvent('request', { url: `${origin}/hold` }), createFlowEvent('request', { url: `${origin}/forbidden` })]
    store.saveFlow(projectId, flow)
    const started = await tcp('start_flow_run', { flow_id: flow.flow_id, request_id: 'revoked' })
    assert(started.ok)
    const id = started.result.run_id
    await arrival
    store.saveMcpConfig({ ...config, allow_execute: false })
    release()
    const revoked = await until(id, 'permission_revoked')
    assert.deepEqual(hits, ['/hold'])
    assert.match(revoked.error!, /权限/)
    assert.equal(revoked.events[0].status, 'passed')
    assert((await tcp('get_flow_run', { run_id: id })).ok, 'query only needs read access')
    assert(!(await tcp('pause_flow_run', { run_id: id })).ok, 'bridge must not use cached execute permission')
    assert(!(await callTool('cancel_flow_run', { project_id: projectId, run_id: id }, config)).ok, 'stale adapter config cannot bypass live policy')
    assert(!(await invoke('flow:run:resume', projectId, id)).ok, 'UI resume revalidates MCP issuer policy')
    const cancelled = await invoke<FlowRun>('flow:run:cancel', projectId, id)
    assert(cancelled.ok && cancelled.data.status === 'cancelled', 'UI stop still works')
    assert.deepEqual(hits, ['/hold'])
    assert(!listToolInfos().some(tool => /resume.*flow|continue.*flow/.test(tool.name)))
    console.log('PASS actual TCP revocation stops subsequent requests; query and UI stop retain their own policy')

    for (const [name, revokedConfig] of [
      ['disabled', { ...config, enabled: false }],
      ['project-removed', { ...config, allowed_project_ids: [] }]
    ] as const) {
      store.saveMcpConfig(config)
      arrival = new Promise<void>(resolve => { arrived = resolve })
      const start = await tcp('start_flow_run', { flow_id: flow.flow_id, request_id: name })
      assert(start.ok)
      await arrival
      store.saveMcpConfig(revokedConfig)
      release()
      await until(start.result.run_id, 'permission_revoked')
      assert(!(await tcp('get_flow_run', { run_id: start.result.run_id })).ok, 'query requires enabled and project access')
      assert(!(await invoke('flow:run:resume', projectId, start.result.run_id)).ok)
      store.saveMcpConfig(config)
      assert.equal((await read(start.result.run_id)).status, 'permission_revoked', 'restoring permission must not auto-resume')
      assert((await invoke('flow:run:resume', projectId, start.result.run_id)).ok)
      assert((await invoke('flow:run:resume', projectId, start.result.run_id)).ok)
      await until(start.result.run_id, 'passed')
    }
    assert.equal(hits.filter(item => item === '/forbidden').length, 2, 'only manually continued restored runs send next request')
    console.log('PASS enabled and allowlist are live; restoring access requires manual idempotent continue')

    arrival = new Promise<void>(resolve => { arrived = resolve })
    const pausedStart = await tcp('start_flow_run', { flow_id: flow.flow_id, request_id: 'paused-revoke' })
    await arrival
    assert((await tcp('pause_flow_run', { run_id: pausedStart.result.run_id })).ok)
    release()
    await until(pausedStart.result.run_id, 'paused')
    store.saveMcpConfig({ ...config, allow_execute: false })
    assert(!(await invoke('flow:run:resume', projectId, pausedStart.result.run_id)).ok)
    assert((await invoke('flow:run:cancel', projectId, pausedStart.result.run_id)).ok)
    store.saveMcpConfig({ ...config, enabled: false, allow_execute: false })
    const uiFlow = createFlow(projectId, 'UI 独立身份')
    uiFlow.events = [createFlowEvent('request', { url: `${origin}/ui` })]
    store.saveFlow(projectId, uiFlow)
    const ui = await invoke<FlowRun>('flow:run:start', projectId, uiFlow.flow_id, '', 'ui-independent')
    assert(ui.ok)
    assert.equal((await until(ui.data.run_id, 'passed')).source, 'ui')
    console.log('PASS paused MCP Run cannot resume after revocation; UI source remains independent')

    store.saveMcpConfig({ ...config, allow_write: false })
    assert(!(await tcp('create_execution_flow', { name: 'denied', events: [] })).ok)
    assert(!(await tcp('update_execution_flow', { flow_id: flow.flow_id, name: 'denied' })).ok)
    assert((await tcp('get_flow_run', { run_id: id })).ok)
    store.saveMcpConfig(config)
    const limited = await callTool('list_projects', {}, { ...config, allowed_project_ids: [] })
    assert(limited.ok && (limited.result as { projects: unknown[] }).projects.length === 0, 'adapter scope cannot expand through current settings')
    const legacy = await tcp('execute_flow', { flow_id: uiFlow.flow_id })
    assert(legacy.ok && legacy.result.status === 'passed')
    arrival = new Promise<void>(resolve => { arrived = resolve })
    const pendingLegacy = tcp('execute_flow', { flow_id: flow.flow_id })
    await arrival
    store.saveMcpConfig({ ...config, allow_execute: false })
    release()
    const legacyRevoked = await pendingLegacy
    assert(legacyRevoked.ok && legacyRevoked.result.status === 'permission_revoked')
    assert((await invoke('flow:run:cancel', projectId, legacyRevoked.result.run_id)).ok)
    console.log('PASS write restrictions and legacy summary remain; legacy wait wakes on revocation')
  } finally {
    release?.(); window.destroy(); await stopMcpServer(); httpServer.closeAllConnections()
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
