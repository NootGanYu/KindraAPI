import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import * as service from '../src/main/flow/service'
import { createFlow, createFlowEvent, createTarget, createParam, createEnvironment, createRequest } from '../src/shared/factories'
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
    async function paused(input?: any, environmentId?: string, setup?: (target: ReturnType<typeof createTarget>) => void) {
      const target = createTarget(pid, 'api'); target.url = origin + '/api'; setup?.(target); store.saveTarget(pid, target)
      const flow = createFlow(pid, '范围审阅')
      flow.events = [createFlowEvent('request', { url: origin + '/hold' }), createFlowEvent('api', { target_id: target.target_id, input })]
      store.saveFlow(pid, flow); arrival = new Promise<void>(r => arrived = r)
      const run = service.startFlowRun(pid, flow.flow_id, environmentId ?? '', flow.flow_id)
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
    const unchanged = await paused()
    unchanged.target.url = origin + '/same-origin'; store.saveTarget(pid, unchanged.target)
    const safe = service.previewFlowRunRefresh(pid, unchanged.run.run_id)
    assert.equal(safe.references[0].scope_changes.length, 0)
    service.applyFlowRunRefresh(pid, unchanged.run.run_id, safe.preview_id)
    service.resumeFlowRun(pid, unchanged.run.run_id); await until(pid, unchanged.run.run_id, 'passed')
    const raced = await paused()
    raced.target.method = 'PUT'; store.saveTarget(pid, raced.target)
    const racePreview = service.previewFlowRunRefresh(pid, raced.run.run_id)
    api.approveFlowRunScope(pid, raced.run.run_id, racePreview.preview_id)
    service.applyFlowRunRefresh(pid, raced.run.run_id, racePreview.preview_id)
    raced.target.method = 'DELETE'; store.saveTarget(pid, raced.target)
    assert.throws(() => service.resumeFlowRun(pid, raced.run.run_id), /revision/)
    const fresh = service.previewFlowRunRefresh(pid, raced.run.run_id)
    assert(!fresh.scope_approval)
    assert.throws(() => service.applyFlowRunRefresh(pid, raced.run.run_id, fresh.preview_id), /范围/)
    assert.throws(() => api.approveFlowRunScope(pid, raced.run.run_id, racePreview.preview_id), /失效/)
    const mixed = await paused({ body: 'step-body' })
    mixed.target.method = 'POST'; mixed.target.request!.body.raw = 'new-api-body'; store.saveTarget(pid, mixed.target)
    const mixedPreview = service.previewFlowRunRefresh(pid, mixed.run.run_id)
    api.approveFlowRunScope(pid, mixed.run.run_id, mixedPreview.preview_id)
    assert.throws(() => service.applyFlowRunRefresh(pid, mixed.run.run_id, mixedPreview.preview_id), /覆盖冲突/)
    assert.throws(() => service.resumeFlowRun(pid, mixed.run.run_id), /覆盖冲突/)
    const added = await paused()
    const file = path.join(dir, 'upload.txt'); fs.writeFileSync(file, 'approved bytes')
    added.target.url = origin.replace('127.0.0.1', 'localhost') + '/scope'
    added.target.request!.pre_script = 'pm.variables.set("scope_check", "yes")'
    added.target.request!.test = 'pm.test("passed", () => pm.expect(true).to.eql(true))'
    added.target.request!.body = { mode: 'binary', binary: { file_path: file } }; store.saveTarget(pid, added.target)
    const expansion = service.previewFlowRunRefresh(pid, added.run.run_id)
    const changes = expansion.references[0].scope_changes.join(';')
    for (const kind of ['origin', '接口前脚本', '接口后脚本', '文件']) assert(changes.includes(kind))
    api.approveFlowRunScope(pid, added.run.run_id, expansion.preview_id)
    fs.writeFileSync(file, 'changed after approval')
    assert.throws(() => service.applyFlowRunRefresh(pid, added.run.run_id, expansion.preview_id), /文件/)
    console.log('PASS no extra approval for same scope; races and files invalidate; scope approval never bypasses conflicts')
    const env = createEnvironment(pid, '固定环境'); env.server_list[0].uri = origin; store.saveEnvironment(pid, env)
    const bound = await paused(undefined, env.env_id, target => { target.url = '/bound-before' })
    env.server_list[0].uri = 'http://127.0.0.1:1'; store.saveEnvironment(pid, env)
    bound.target.url = '/bound-after'; store.saveTarget(pid, bound.target)
    const boundPreview = service.previewFlowRunRefresh(pid, bound.run.run_id)
    assert.equal(boundPreview.references[0].effective_request.url, origin + '/bound-after')
    assert.equal(boundPreview.references[0].scope_changes.length, 0)
    service.applyFlowRunRefresh(pid, bound.run.run_id, boundPreview.preview_id)
    service.resumeFlowRun(pid, bound.run.run_id); const boundDone = await until(pid, bound.run.run_id, 'passed')
    assert.equal(boundDone.env_id, env.env_id)
    const folder = store.createTargetInProject(pid, '0', 'folder')
    const inherited = await paused(undefined, undefined, target => { target.parent_id = folder.target_id })
    folder.request = createRequest(); folder.request.body = { mode: 'binary', binary: { file_path: file } }; store.saveTarget(pid, folder)
    const inheritedPreview = service.previewFlowRunRefresh(pid, inherited.run.run_id)
    assert(inheritedPreview.references[0].scope_changes.some(change => change.includes('文件')))
    api.approveFlowRunScope(pid, inherited.run.run_id, inheritedPreview.preview_id)
    folder.request!.body = { mode: 'raw', raw: 'changed parent' }; store.saveTarget(pid, folder)
    assert.throws(() => service.applyFlowRunRefresh(pid, inherited.run.run_id, inheritedPreview.preview_id), /继承/)
    const disabled = await paused(undefined, undefined, target => { target.request!.pre_script = 'pm.variables.set("value", "yes")' })
    disabled.target.request!.pre_script_enabled = false; store.saveTarget(pid, disabled.target)
    const smaller = service.previewFlowRunRefresh(pid, disabled.run.run_id)
    assert.equal(smaller.references[0].scope_changes.length, 0)
    console.log('PASS fixed environment stays bound; inherited file scope reviewed; disabling scripts does not expand scope')


  } finally {
    release?.(); for (const run of service.getActiveFlowRuns()) await service.cancelFlowRun(run.project_id, run.run_id)
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(e => { console.error(e); app.exit(1) })
