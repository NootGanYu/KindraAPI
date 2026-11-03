import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import * as store from '../src/main/storage/store'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import { callTool } from '../src/main/mcp/tools'
import { registerIpc } from '../src/main/ipc'
import type { FlowRun } from '../src/shared/types'

async function waitUntil(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10000
  while (!check()) { assert(Date.now() < deadline, 'timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
}
async function main(): Promise<void> {
  const userData = process.env.PROGRESS_RESTART_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-progress-'))
  app.setPath('userData', userData)
  await app.whenReady()
  if (process.env.PROGRESS_RESTART_DIR) {
    const projectId = process.env.PROGRESS_PROJECT!
    const result = await callTool('get_flow_run', { project_id: projectId, run_id: process.env.PROGRESS_RUN! }, { ...store.getMcpConfig(), enabled: true, allowed_project_ids: [projectId] })
    assert(result.ok)
    const run = result.result as FlowRun
    assert.equal(run.status, 'unknown')
    assert.equal(run.events[0].children?.[0].status, 'passed')
    assert.match(run.error!, /中断/)
    return
  }
  let release: (() => void) | undefined
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    if (req.url === '/hold') release = () => res.end('{"ok":true}')
    else { res.setHeader('Set-Cookie', 'session=cookie-secret'); res.end('{"token":"token-secret","nested":{"password":"nested-secret"}}') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let window: BrowserWindow | undefined
  try {
    const projectId = store.ensureDefaultProject().project_id
    const port = (server.address() as import('node:net').AddressInfo).port
    const flow = createFlow(projectId, '逐步进度')
    flow.events = [createFlowEvent('begin', { children: [
      createFlowEvent('request', { url: `http://127.0.0.1:${port}/login`, method: 'GET', headers: [{ key: 'Authorization', value: 'Bearer header-secret' }] }),
      createFlowEvent('script', { script: 'console.log("token", "token-secret"); console.log({password:"nested-secret"});' }),
      createFlowEvent('request', { url: `http://127.0.0.1:${port}/hold`, method: 'GET' })
    ] })]
    store.saveFlow(projectId, flow)
    const config = { ...store.getMcpConfig(), enabled: true, allow_execute: true, allowed_project_ids: [projectId] }
    const start = await callTool('start_flow_run', { project_id: projectId, flow_id: flow.flow_id, request_id: 'progress' }, config)
    assert(start.ok, start.ok ? "" : start.error)
    const runId = (start.result as FlowRun).run_id
    await waitUntil(() => requests === 2)
    const query = await callTool('get_flow_run', { project_id: projectId, run_id: runId }, config)
    assert(query.ok)
    const partial = query.result as FlowRun
    assert.equal(partial.events[0]?.children?.[0].status, 'passed', 'completed nested request is visible while next request is in flight')
    assert.equal(partial.status, 'running')
    for (const secret of ['token-secret','cookie-secret','nested-secret','header-secret']) assert(!JSON.stringify(partial).includes(secret), `MCP leaked ${secret}`)
    assert.deepEqual(store.getFlowRun(projectId, runId), partial, 'same evidence persisted as queried')
    assert.throws(() => store.deleteFlow(projectId, flow.flow_id), /活动/)
    registerIpc()
    window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
    await window.loadURL('data:text/html,<html></html>')
    const ui = await window.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('flow:run:get', ${JSON.stringify(projectId)}, ${JSON.stringify(runId)})`)
    assert.deepEqual(ui.data, partial, 'UI and MCP share sanitized evidence')
    const local = path.join(store.getPaths().localRoot, 'projects', projectId, 'executions', 'runs', `${runId}.json`)
    for (const secret of ['token-secret','cookie-secret','nested-secret','header-secret']) assert(!fs.readFileSync(local,'utf8').includes(secret))
    console.log('PASS nested partial progress persisted and redacted identically for UI/MCP; active deletion refused')
    // A separate process has no execution stack: it reads existing evidence, never starts the flow.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [__filename], { env: { ...process.env, PROGRESS_RESTART_DIR: userData, PROGRESS_PROJECT: projectId, PROGRESS_RUN: runId }, stdio: 'inherit' })
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`restart check ${code}`)))
      child.on('error', reject)
    })
    assert.equal(requests, 2, 'restart cannot replay requests')
    release!()
    await waitUntil(() => store.getFlowRun(projectId, runId)?.status === 'passed')
    assert.equal(requests, 2)
    store.deleteFlow(projectId, flow.flow_id)
    console.log('PASS separate process marks interrupted in-flight run unknown without replay')
  } finally {
    release?.(); window?.destroy(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(userData, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
