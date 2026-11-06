import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import * as store from '../src/main/storage/store'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import { callTool } from '../src/main/mcp/tools'
import { registerIpc } from '../src/main/ipc'
import type { FlowEventResult, FlowRun, Result } from '../src/shared/types'

async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 8000
  while (true) {
    const value = await read()
    if (accepts(value)) return value
    assert(Date.now() < deadline, 'expected state not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
const flatten = (events: FlowEventResult[]): FlowEventResult[] => events.flatMap(event => [event, ...flatten(event.children ?? [])])

async function main(): Promise<void> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-loop-resume-'))
  app.setPath('userData', userData)
  await app.whenReady()
  const hits: string[] = []
  const held = new Map<string, () => void>()
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    hits.push(req.url!)
    res.setHeader('content-type', 'application/json')
    const finish = () => res.end(JSON.stringify({ token: 'loop-secret', object_id: '42' }))
    if (url.pathname === '/item' && url.searchParams.get('inner') === '0') held.set(url.searchParams.get('outer')!, finish)
    else finish()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  let window: BrowserWindow | undefined
  try {
    const projectId = store.ensureDefaultProject().project_id
    const config = { ...store.getMcpConfig(), enabled: true, allow_execute: true, allowed_project_ids: [projectId] }
    store.saveMcpConfig(config)
    const request = createFlowEvent('request', { event_id: 'item-request', logical_step_id: 'item-step', url: `${origin}/item?outer={{outer}}&inner={{loop_index}}` })
    const post = createFlowEvent('script', { event_id: 'item-post', logical_step_id: 'item-step', script: 'pm.environment.set("token", pm.response.json().token); pm.variables.set("object_id", pm.response.json().object_id); pm.variables.set("post_done", "yes"); pm.test("完整步骤", () => pm.expect(pm.variables.get("phase")).to.eql("pre"));' })
    const group = createFlowEvent('begin', { event_id: 'group', children: [
      createFlowEvent('script', { event_id: 'item-pre', logical_step_id: 'item-step', script: 'pm.variables.set("phase", "pre"); pm.variables.set("post_done", "no");' }), request, post,
      createFlowEvent('request', { event_id: 'follow-request', url: `${origin}/follow?outer={{outer}}&inner={{loop_index}}&id={{object_id}}&token={{token}}` })
    ] })
    const conditional = createFlowEvent('if', { event_id: 'condition', condition: 'true', children: [group] })
    const inner = createFlowEvent('loop', { event_id: 'inner-loop', loop_count: 2, children: [conditional] })
    const outer = createFlowEvent('loop', { event_id: 'outer-loop', loop_count: 2, children: [
      createFlowEvent('script', { event_id: 'outer-index', script: 'pm.variables.set("outer", pm.variables.get("loop_index"));' }), inner,
      createFlowEvent('request', { event_id: 'after-inner', url: `${origin}/after?outer={{outer}}&index={{loop_index}}` })
    ] })
    const flow = createFlow(projectId, '嵌套恢复')
    flow.events = [createFlowEvent('script', { script: 'pm.variables.set("loop_index", "before-loop");' }), outer,
      createFlowEvent('request', { event_id: 'after-outer', url: `${origin}/done?index={{loop_index}}` })]
    store.saveFlow(projectId, flow)
    registerIpc()
    window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
    await window.loadURL('about:blank')
    const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => window!.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`)
    const start = await invoke<FlowRun>('flow:run:start', projectId, flow.flow_id, '', 'nested')
    assert(start.ok)
    const runId = start.data.run_id
    const read = async () => {
      const result = await callTool('get_flow_run', { project_id: projectId, run_id: runId }, config)
      assert(result.ok)
      return result.result as FlowRun
    }
    let firstInstance: FlowEventResult | undefined
    for (const outerIndex of ['0', '1']) {
      await until(async () => held.has(outerIndex), Boolean)
      const pause = outerIndex === '0'
        ? await callTool('pause_flow_run', { project_id: projectId, run_id: runId }, config)
        : await invoke<FlowRun>('flow:run:pause', projectId, runId)
      assert(pause.ok, JSON.stringify(pause))
      assert.equal((await read()).status, 'pausing')
      held.get(outerIndex)!()
      const paused = await until(read, run => run.status === 'paused')
      assert.equal(paused.variables.post_done, 'yes', 'post script must finish before pausing')
      assert.equal(paused.variables.object_id, '42')
      assert.equal(hits.at(-1), `/item?outer=${outerIndex}&inner=0`)
      const requestResults = flatten(paused.events).filter(event => event.event_id === 'item-request')
      const current = requestResults.at(-1)!
      assert.deepEqual(current.iteration_path, [{ event_id: 'outer-loop', iteration: Number(outerIndex) }, { event_id: 'inner-loop', iteration: 0 }])
      assert(current.instance_id)
      const cursor = paused.cursor!
      assert(cursor, 'paused Run exposes its nested continuation cursor')
      assert.deepEqual(cursor.stack, [
        { next_event_index: 1 },
        { parent_event_id: 'outer-loop', next_event_index: 1, iteration: Number(outerIndex) },
        { parent_event_id: 'inner-loop', next_event_index: 0, iteration: 0 },
        { parent_event_id: 'condition', next_event_index: 0 },
        { parent_event_id: 'group', next_event_index: 3 }
      ])
      assert.equal(cursor.after_instance_id, flatten(paused.events).filter(event => event.event_id === 'item-post').at(-1)!.instance_id)
      if (firstInstance) assert.deepEqual(requestResults[0], firstInstance, 'completed iteration remains immutable across resume')
      else firstInstance = current
      const persisted = store.getFlowRun(projectId, runId)!
      assert.deepEqual(persisted.cursor, cursor)
      const count = hits.length
      const resumes = await Promise.all([invoke<FlowRun>('flow:run:resume', projectId, runId), invoke<FlowRun>('flow:run:resume', projectId, runId)])
      assert(resumes.every(result => result.ok))
      assert.equal(hits.slice(0, count).filter(hit => hit === `/item?outer=${outerIndex}&inner=0`).length, 1)
    }
    const finished = await until(read, run => !['running', 'pausing', 'paused'].includes(run.status))
    assert.equal(finished.status, 'passed', JSON.stringify(finished.events))
    assert.deepEqual(hits, [
      '/item?outer=0&inner=0', '/follow?outer=0&inner=0&id=42&token=loop-secret',
      '/item?outer=0&inner=1', '/follow?outer=0&inner=1&id=42&token=loop-secret', '/after?outer=0&index=0',
      '/item?outer=1&inner=0', '/follow?outer=1&inner=0&id=42&token=loop-secret',
      '/item?outer=1&inner=1', '/follow?outer=1&inner=1&id=42&token=loop-secret', '/after?outer=1&index=1', '/done?index=before-loop'
    ])
    assert.equal(flatten(finished.events).filter(event => event.event_id === 'item-post').length, 4)
    const itemResults = flatten(finished.events).filter(event => event.event_id === 'item-request')
    assert.equal(new Set(itemResults.map(event => event.instance_id)).size, 4, 'full nested iteration identity must not collide')
    assert.deepEqual(itemResults.map(event => event.iteration_path?.map(item => item.iteration)), [[0, 0], [0, 1], [1, 0], [1, 1]])
    console.log('PASS nested loops/conditions/groups pause at complete step, resume preserves variables and loop index, no duplicate requests')
  } finally {
    held.forEach(release => release())
    window?.destroy()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(userData, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
