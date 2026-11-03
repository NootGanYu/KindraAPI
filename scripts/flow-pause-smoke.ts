import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import * as store from '../src/main/storage/store'
import { createFlow, createFlowEvent, createTarget } from '../src/shared/factories'
import { callTool, listToolInfos } from '../src/main/mcp/tools'
import { registerIpc } from '../src/main/ipc'
import type { FlowRun, Result } from '../src/shared/types'

async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 8_000
  while (true) {
    const value = await read()
    if (accepts(value)) return value
    assert(Date.now() < deadline, 'expected Run state was not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function main(): Promise<void> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-pause-'))
  app.setPath('userData', userData)
  await app.whenReady()
  const hits: string[] = []
  let release: (() => void) | undefined
  let arrived!: () => void
  let arrival = new Promise<void>(resolve => { arrived = resolve })
  const server = http.createServer((request, response) => {
    hits.push(request.url!)
    response.setHeader('content-type', 'application/json')
    if (request.url?.startsWith('/first')) {
      release = () => response.end('{"object_id":"42"}')
      arrived()
    } else response.end('{"ok":true}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  let window: BrowserWindow | undefined
  try {
    const projectId = store.ensureDefaultProject().project_id
    const config = { ...store.getMcpConfig(), enabled: true, allow_execute: true, allowed_project_ids: [projectId] }
    store.saveMcpConfig(config)
    const api = createTarget(projectId, 'api')
    api.url = `${origin}/first?phase={{phase}}`
    api.request.pre_script = 'pm.environment.set("phase", pm.environment.get("phase") + "-api-pre");'
    api.request.test = 'pm.environment.set("object_id", pm.response.json().object_id); pm.environment.set("phase", pm.environment.get("phase") + "-api-post");'
    store.saveTarget(projectId, api)
    const flow = createFlow(projectId, '完整步骤暂停')
    flow.events = [
      createFlowEvent('script', { logical_step_id: 'first-step', script: 'pm.environment.set("phase", "step-pre");' }),
      createFlowEvent('api', { logical_step_id: 'first-step', target_id: api.target_id }),
      createFlowEvent('script', { logical_step_id: 'first-step', script: 'pm.environment.set("phase", pm.environment.get("phase") + "-step-post"); pm.test("post phase", () => pm.expect(pm.environment.get("phase")).to.eql("step-pre-api-pre-api-post-step-post"));' }),
      createFlowEvent('request', { url: `${origin}/second?id={{object_id}}&phase={{phase}}`, method: 'GET' })
    ]
    store.saveFlow(projectId, flow)
    registerIpc()
    window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
    await window.loadURL('about:blank')
    const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => window!.webContents.executeJavaScript(
      `require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`
    )
    const started = await invoke<FlowRun>('flow:run:start', projectId, flow.flow_id, '', 'pause-first')
    assert(started.ok)
    const runId = started.data.run_id
    const read = async (): Promise<FlowRun> => {
      const result = await callTool('get_flow_run', { project_id: projectId, run_id: runId }, config)
      assert(result.ok)
      return result.result as FlowRun
    }
    await arrival
    const pause = await callTool('pause_flow_run', { project_id: projectId, run_id: runId }, config)
    assert(pause.ok, pause.ok ? '' : pause.error)
    assert.equal((pause.result as FlowRun).status, 'pausing')
    assert.equal(hits.length, 1)
    release!()
    await until(read, run => run.status === 'paused')
    assert.equal(hits.length, 1)
    assert(!(await callTool('start_flow_run', { project_id: projectId, flow_id: flow.flow_id, request_id: 'conflict' }, config)).ok)
    api.url = `${origin}/edited`
    store.saveTarget(projectId, api)
    assert.equal((await read()).status, 'paused', 'saving never resumes')
    assert(!listToolInfos().some(tool => /resume|continue/.test(tool.name)), 'MCP must not expose resume')
    const resumed = await Promise.all([invoke<FlowRun>('flow:run:resume', projectId, runId), invoke<FlowRun>('flow:run:resume', projectId, runId)])
    assert(resumed.every(result => result.ok))
    const finished = await until(read, run => run.status === 'passed' || run.status === 'failed')
    assert.equal(finished.status, 'passed')
    assert.deepEqual(hits, ['/first?phase=step-pre-api-pre', '/second?id=42&phase=step-pre-api-pre-api-post-step-post'])
    assert.equal(finished.events[2].assertions?.[0].passed, true)
    console.log('PASS complete logical step pause, original snapshot UI resume, variables and idempotency')

    const legacyFlow = createFlow(projectId, '旧同步暂停')
    legacyFlow.events = [createFlowEvent('request', { url: `${origin}/first-legacy` }), createFlowEvent('request', { url: `${origin}/legacy-after` })]
    store.saveFlow(projectId, legacyFlow)
    arrival = new Promise<void>(resolve => { arrived = resolve })
    const legacyPromise = callTool('execute_flow', { project_id: projectId, flow_id: legacyFlow.flow_id }, config)
    await arrival
    const listed = await invoke<import('../src/shared/types').FlowRunSummary[]>('flow:runs', projectId)
    assert(listed.ok)
    const legacyId = listed.data.find(run => run.flow_id === legacyFlow.flow_id)!.run_id
    const uiPause = await invoke<FlowRun>('flow:run:pause', projectId, legacyId)
    assert(uiPause.ok && uiPause.data.status === 'pausing')
    let timeout: ReturnType<typeof setTimeout> | undefined
    const legacy = await Promise.race([legacyPromise, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('legacy call did not return promptly on pause')), 1000) })]).finally(() => clearTimeout(timeout))
    assert(legacy.ok && (legacy.result as FlowRun).status === 'pausing')
    const premature = await invoke<FlowRun>('flow:run:resume', projectId, legacyId)
    assert(!premature.ok && premature.error.includes('尚未结束'))
    release!()
    const readLegacy = async (): Promise<FlowRun> => {
      const result = await invoke<FlowRun>('flow:run:get', projectId, legacyId)
      assert(result.ok)
      return result.data
    }
    await until(readLegacy, run => run.status === 'paused')
    assert(!(await callTool('pause_flow_run', { project_id: projectId, run_id: legacyId }, { ...config, allow_execute: false })).ok)
    const wrong = await invoke<FlowRun>('flow:run:resume', 'wrong-project', legacyId)
    assert(!wrong.ok)
    assert((await invoke<FlowRun>('flow:run:resume', projectId, legacyId)).ok)
    await until(readLegacy, run => run.status === 'passed')
    assert.equal(hits.filter(hit => hit === '/legacy-after').length, 1)
    console.log('PASS real UI pause and legacy MCP returns pausing immediately; permissions and project binding')

    const loop = createFlow(projectId, '循环支持步骤边界暂停')
    loop.events = [createFlowEvent('loop', { loop_count: 1, children: [createFlowEvent('request', { url: `${origin}/first-loop` })] })]
    store.saveFlow(projectId, loop)
    arrival = new Promise<void>(resolve => { arrived = resolve })
    const loopStart = await invoke<FlowRun>('flow:run:start', projectId, loop.flow_id, '', 'loop')
    assert(loopStart.ok)
    await arrival
    const loopPause = await callTool('pause_flow_run', { project_id: projectId, run_id: loopStart.data.run_id }, config)
    assert(loopPause.ok && (loopPause.result as FlowRun).status === 'pausing')
    const stillRunning = await invoke<FlowRun>('flow:run:get', projectId, loopStart.data.run_id)
    assert(stillRunning.ok && stillRunning.data.status === 'pausing')
    release!()
    await until(async () => {
      const result = await invoke<FlowRun>('flow:run:get', projectId, loopStart.data.run_id)
      assert(result.ok)
      return result.data
    }, run => run.status === 'paused')
    assert((await invoke<FlowRun>('flow:run:resume', projectId, loopStart.data.run_id)).ok)
    await until(async () => {
      const result = await invoke<FlowRun>('flow:run:get', projectId, loopStart.data.run_id)
      assert(result.ok)
      return result.data
    }, run => run.status === 'passed')
    console.log('PASS loop pause waits for complete step and UI resume finishes')

  } finally {
    release?.()
    window?.destroy()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(userData, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
