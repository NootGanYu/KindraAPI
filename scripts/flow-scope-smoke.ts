import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import * as service from '../src/main/flow/service'
import { createFlow, createFlowEvent, createTarget, createParam } from '../src/shared/factories'
const api = service as typeof service & { approveFlowRunScope: Function }
async function until(project: string, id: string, status: string) {
  for (let i = 0; i < 1000; i++) {
    const run = service.getFlowRun(project, id)!
    if (run.status === status) return run
    await new Promise(r => setTimeout(r, 5))
  }
  throw Error(`timeout ${status}`)
}
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-scope-'))
  app.setPath('userData', dir); await app.whenReady()
  let arrived!: () => void, release!: () => void
  let arrival: Promise<void>
  const hits: string[] = []
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    if (req.url === '/hold') { release = () => res.end('{}'); arrived() } else res.end('{}')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    const pid = store.ensureDefaultProject().project_id
    async function paused(input?: any) {
      const target = createTarget(pid, 'api'); target.url = origin + '/api'; store.saveTarget(pid, target)
      const flow = createFlow(pid, '范围审阅')
      flow.events = [createFlowEvent('request', { url: origin + '/hold' }), createFlowEvent('api', { target_id: target.target_id, input })]
      store.saveFlow(pid, flow); arrival = new Promise<void>(r => arrived = r)
      const run = service.startFlowRun(pid, flow.flow_id, '', flow.flow_id)
      await arrival; service.pauseFlowRun(pid, run.run_id); release(); await until(pid, run.run_id, 'paused')
      return { target, flow, run }
    }
    const changed = await paused()
    changed.target.method = 'POST'; store.saveTarget(pid, changed.target)
    const preview = service.previewFlowRunRefresh(pid, changed.run.run_id)
    assert(preview.references[0].scope_changes.some(s => s.includes('method')))
    assert.throws(() => service.applyFlowRunRefresh(pid, changed.run.run_id, preview.preview_id), /范围/)
    const before = hits.length
    const approved = api.approveFlowRunScope(pid, changed.run.run_id, preview.preview_id)
    assert.equal(approved.status, 'paused'); assert.equal(hits.length, before)
    assert.equal(approved.refresh_preview.scope_approval.preview_id, preview.preview_id)
    assert.throws(() => service.resumeFlowRun(pid, changed.run.run_id), /采用/)
    service.applyFlowRunRefresh(pid, changed.run.run_id, preview.preview_id)
    assert.equal(hits.length, before)
    service.resumeFlowRun(pid, changed.run.run_id)
    const done = await until(pid, changed.run.run_id, 'passed')
    assert.equal(hits.at(-1), 'POST /api')
    assert.equal(done.version_switches?.[0].scope_approval?.preview_id, preview.preview_id)
    console.log('PASS exact scope approval remains paused and recorded after separate adopt/manual continue')
  } finally {
    release?.(); for (const run of service.getActiveFlowRuns()) await service.cancelFlowRun(run.project_id, run.run_id)
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(e => { console.error(e); app.exit(1) })
