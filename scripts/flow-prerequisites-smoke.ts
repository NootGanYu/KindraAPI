import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import * as service from '../src/main/flow/service'
import { createFlow, createFlowEvent } from '../src/shared/factories'
import type { FlowEvent } from '../src/shared/types'

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-prerequisites-'))
  app.setPath('userData', dir)
  await app.whenReady()
  let release!: () => void, entered!: () => void
  const hits: string[] = []
  const server = http.createServer((req, res) => {
    hits.push(req.url!)
    if (req.url === '/hold') { release = () => res.end('{}'); entered() }
    else res.end('{"token":"produced-token"}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const pid = store.ensureDefaultProject().project_id
  async function paused(events: FlowEvent[]) {
    const flow = createFlow(pid, '恢复前置条件')
    flow.events = [createFlowEvent('request', { url: origin + '/hold' }), ...events]
    store.saveFlow(pid, flow)
    const arrival = new Promise<void>(resolve => { entered = resolve })
    const run = service.startFlowRun(pid, flow.flow_id, '', flow.flow_id)
    await arrival
    service.pauseFlowRun(pid, run.run_id)
    release()
    const deadline = Date.now() + 5000
    while (service.getFlowRun(pid, run.run_id)?.status !== 'paused') {
      assert(Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    return run
  }
  function target(url: string, pre = '') {
    const target = store.createTargetInProject(pid, '0', 'api')
    target.url = origin + url
    target.request!.pre_script = pre
    store.saveTarget(pid, target)
    return target
  }
  try {
    const missing = target('/missing?value={{missing_output}}')
    const missingRun = await paused([createFlowEvent('api', { target_id: missing.target_id })])
    assert.throws(() => service.resumeFlowRun(pid, missingRun.run_id), /缺少运行变量 missing_output/)
    assert.equal(service.getFlowRun(pid, missingRun.run_id)?.status, 'paused')
    assert.deepEqual(hits, ['/hold'])
    await service.cancelFlowRun(pid, missingRun.run_id)
    console.log('PASS unchanged snapshot rejects missing completed output before resuming')

    const future = target('/future?value={{future_token}}')
    const producer = target('/producer')
    producer.request!.test = 'pm.environment.set("future_token", pm.response.json().token)'
    store.saveTarget(pid, producer)
    const futureRun = await paused([createFlowEvent('api', { target_id: producer.target_id }), createFlowEvent('api', { target_id: future.target_id })])
    future.url = origin + '/reviewed-future?value={{future_token}}'
    store.saveTarget(pid, future)
    const preview = service.previewFlowRunRefresh(pid, futureRun.run_id)
    service.applyFlowRunRefresh(pid, futureRun.run_id, preview.preview_id)
    service.resumeFlowRun(pid, futureRun.run_id)
    assert.equal((await service.waitForFlowRun(pid, futureRun.run_id)).status, 'passed')
    assert(hits.includes('/reviewed-future?value=produced-token'))
    console.log('PASS pending request producer can provide a future refreshed request variable')

    for (const source of ['step', 'api'] as const) {
      const code = 'pm.environment.set("generated_value", "ready")'
      const next = target('/' + source + '?value={{generated_value}}', source === 'api' ? code : '')
      const events = [createFlowEvent('api', { target_id: next.target_id })]
      if (source === 'step') events.unshift(createFlowEvent('script', { script: code }))
      const run = await paused(events)
      service.resumeFlowRun(pid, run.run_id)
      assert.equal((await service.waitForFlowRun(pid, run.run_id)).status, 'passed')
      assert(hits.includes('/' + source + '?value=ready'))
    }
    console.log('PASS step and API pre-scripts produce variables before dispatch validation')

    const bad = target('/unsafe?value={{absent}}', 'console.log("no output")')
    const badRun = await paused([createFlowEvent('api', { target_id: bad.target_id })])
    service.resumeFlowRun(pid, badRun.run_id)
    assert.equal((await service.waitForFlowRun(pid, badRun.run_id)).status, 'failed')
    assert(!hits.some(hit => hit.startsWith('/unsafe')))
    assert.match(service.getFlowRun(pid, badRun.run_id)!.events[1].error!, /缺少运行变量 absent/)
    console.log('PASS dispatch withholds unresolved variables after an unproductive pre-script')
  } finally {
    release?.()
    for (const run of service.getActiveFlowRuns()) await service.cancelFlowRun(pid, run.run_id)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
