import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import * as store from '../src/main/storage/store'
import { createFlow, createFlowEvent, createRequest } from '../src/shared/factories'
import { runSavedFlow, getFlowRun, startFlowRun, pauseFlowRun, cancelFlowRun, resumeFlowRun, previewFlowRunRefresh, applyFlowRunRefresh } from '../src/main/flow/service'

async function until<T>(read: () => T, accepts: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 8000
  while (true) {
    const value = read()
    if (accepts(value)) return value
    assert(Date.now() < deadline, 'expected Run state was not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-review-'))
  app.setPath('userData', dir)
  await app.whenReady()
  const hits: string[] = []
  let responseBody = '{}'
  let hold: ((res: http.ServerResponse) => void) | undefined
  const received: http.IncomingHttpHeaders[] = []
  const server = http.createServer((req, res) => { hits.push(req.url!); received.push(req.headers); if (hold) hold(res); else res.end(responseBody) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  try {
    const projectId = store.ensureDefaultProject().project_id
    for (const independent of [false, true]) {
      hits.length = 0
      const flow = createFlow(projectId, '循环逻辑组准入')
      flow.events = [createFlowEvent('loop', { loop_count: 2, children: [
        createFlowEvent('script', { logical_step_id: 'group', script: '', ...(independent ? { depends_on: [] } : {}) }),
        createFlowEvent('request', { logical_step_id: 'group', method: 'POST', url: `${origin}/write?iteration={{loop_index}}` }),
        createFlowEvent('script', { script: 'throw new Error("required step failed")' })
      ] })]
      store.saveFlow(projectId, flow)
      const run = await runSavedFlow(projectId, flow.flow_id)
      assert.deepEqual(hits, independent ? ['/write?iteration=0', '/write?iteration=1'] : ['/write?iteration=0'])
      assert.deepEqual(run.events[0].children?.map(event => event.status), independent
        ? ['passed', 'passed', 'failed', 'passed', 'passed', 'blocked']
        : ['passed', 'passed', 'failed', 'blocked', 'blocked', 'blocked'])
    }
    console.log('PASS loop group admission is per iteration; explicit independence still works')
    const separated = createFlow(projectId, '非相邻逻辑组不能跳过失败')
    separated.events = [
      createFlowEvent('script', { logical_step_id: 'reused', script: '' }),
      createFlowEvent('script', { script: 'throw new Error("intervening failure")' }),
      createFlowEvent('request', { logical_step_id: 'reused', method: 'POST', url: `${origin}/must-not-write` })
    ]
    store.saveFlow(projectId, separated)
    const separatedRun = await runSavedFlow(projectId, separated.flow_id)
    assert.equal(separatedRun.events[2].status, 'blocked')
    assert(!hits.includes('/must-not-write'))
    for (const admitted of [false, true]) {
      const disabled = createFlow(projectId, '跳过事件不等于逻辑组成功准入')
      disabled.events = [
        createFlowEvent('script', { script: 'throw new Error("earlier failure")' }),
        ...(admitted ? [createFlowEvent('script', { logical_step_id: 'group', depends_on: [], script: '' })] : []),
        createFlowEvent('script', { logical_step_id: 'group', enabled: false }),
        createFlowEvent('request', { logical_step_id: 'group', method: 'POST', url: `${origin}/disabled-pre` })
      ]
      store.saveFlow(projectId, disabled)
      const run = await runSavedFlow(projectId, disabled.flow_id)
      assert.equal(run.events.at(-1)!.status, admitted ? 'passed' : 'blocked')
    }


    for (const secret of ['passed', 'request']) {
      responseBody = JSON.stringify({ token: secret, status: secret, type: secret, run_id: secret, ordinary: 'safe-data' })
      const flow = createFlow(projectId, '协议元数据保持真实')
      flow.events = [createFlowEvent('request', { event_id: secret, name: '获取token', url: origin })]
      store.saveFlow(projectId, flow)
      const run = await runSavedFlow(projectId, flow.flow_id)
      for (const evidence of [run, getFlowRun(projectId, run.run_id)!]) {
        assert.equal(evidence.status, 'passed')
        assert.equal(evidence.events[0].status, 'passed')
        assert.equal(evidence.events[0].type, 'request')
        assert.equal(evidence.events[0].event_id, secret)
        assert(!Object.hasOwn(evidence.events[0], 'value'))
        assert.deepEqual(JSON.parse(evidence.events[0].response!.body), {
          token: '[REDACTED]', status: '[REDACTED]', type: '[REDACTED]', run_id: '[REDACTED]', ordinary: 'safe-data'
        })
      }
      const history = store.getSendRecord(projectId, store.listSendRecords(projectId)[0].record_id)!
      assert.equal(history.status, 'passed')
    }
    responseBody = '{}'
    console.log('PASS protocol status/type/IDs survive secret collisions; payload metadata names remain redacted')
    const credential = 'demo&value space'
    for (const location of ['header', 'query'] as const) {
      const folder = store.createTargetInProject(projectId, '0', 'folder')
      folder.request = createRequest()
      folder.request.auth = { type: 'kv', kv: { key: 'X-Access', value: '{{unusual}}', in: location } }
      store.saveTarget(projectId, folder)
      const api = store.createTargetInProject(projectId, folder.target_id, 'api')
      api.url = origin
      api.request!.auth = { type: 'inherit' }
      api.request!.pre_script = `pm.variables.set("unusual", ${JSON.stringify(credential)}); console.log(pm.variables.get("unusual"))`
      api.request!.test = 'console.log(pm.variables.get("unusual")); pm.variables.set("unusual", "changed-after-dispatch")'
      store.saveTarget(projectId, api)
      const flow = createFlow(projectId, '自定义继承认证')
      flow.events = [createFlowEvent('api', { target_id: api.target_id })]
      store.saveFlow(projectId, flow)
      const run = await runSavedFlow(projectId, flow.flow_id)
      assert.equal(run.status, 'passed')
      if (location === 'header') assert.equal(received.at(-1)!['x-access'], credential)
      else assert.equal(new URL(hits.at(-1)!, origin).searchParams.get('X-Access'), credential)
      for (const evidence of [run, getFlowRun(projectId, run.run_id), store.getSendRecord(projectId, store.listSendRecords(projectId)[0].record_id)]) {
        for (const secret of [credential, encodeURIComponent(credential), new URLSearchParams({ v: credential }).toString().slice(2)]) {
          assert(!JSON.stringify(evidence).includes(secret), `${location} authentication must not appear in any evidence`)
        }
      }
    }
    console.log('PASS inherited custom header/query auth with script-resolved values is sent but absent from all evidence')
    const basic = store.createTargetInProject(projectId, '0', 'api')
    basic.url = origin
    basic.request!.auth = { type: 'basic', basic: { username: 'visible-user-243', password: 'private-pass-365' } }
    basic.request!.pre_script = 'console.log("visible-user-243", "private-pass-365")'
    store.saveTarget(projectId, basic)
    const basicFlow = createFlow(projectId, 'Basic 认证')
    basicFlow.events = [createFlowEvent('api', { target_id: basic.target_id })]
    store.saveFlow(projectId, basicFlow)
    const basicRun = await runSavedFlow(projectId, basicFlow.flow_id)
    const encoded = Buffer.from('visible-user-243:private-pass-365').toString('base64')
    assert.equal(received.at(-1)!.authorization, `Basic ${encoded}`)
    for (const value of ['visible-user-243', 'private-pass-365', encoded]) assert(!JSON.stringify(basicRun).includes(value))

    const oldKey = 'old-auth&value 471'
    const newKey = 'new-auth&value 592'
    const api = store.createTargetInProject(projectId, '0', 'api')
    api.url = `${origin}/?mirror=${encodeURIComponent(oldKey)}`
    api.request!.auth = { type: 'kv', kv: { key: 'X-Access', value: oldKey, in: 'header' } }
    store.saveTarget(projectId, api)
    const refreshed = createFlow(projectId, '认证变更保持旧证据脱敏')
    refreshed.events = [createFlowEvent('api', { target_id: api.target_id }), createFlowEvent('api', { target_id: api.target_id })]
    store.saveFlow(projectId, refreshed)
    let release: (() => void) | undefined
    hold = response => { release = () => response.end('{}') }
    const started = startFlowRun(projectId, refreshed.flow_id, undefined, 'auth-refresh')
    await until(() => release, Boolean)
    pauseFlowRun(projectId, started.run_id)
    release!()
    const read = () => getFlowRun(projectId, started.run_id)!
    await until(read, run => run.status === 'paused')
    api.url = `${origin}/?mirror=${encodeURIComponent(newKey)}`
    api.request!.auth = { type: 'kv', kv: { key: 'X-Access', value: newKey, in: 'header' } }
    store.saveTarget(projectId, api)
    const preview = previewFlowRunRefresh(projectId, started.run_id)
    assert.equal(preview.references.length, 1)
    applyFlowRunRefresh(projectId, started.run_id, preview.preview_id)
    release = undefined
    resumeFlowRun(projectId, started.run_id)
    await until(() => release, Boolean)
    for (const evidence of [preview, read(), store.getFlowRun(projectId, started.run_id)]) {
      for (const value of [oldKey, newKey, encodeURIComponent(oldKey), encodeURIComponent(newKey)]) assert(!JSON.stringify(evidence).includes(value))
    }
    release!()
    const finished = await until(read, run => run.status === 'passed')
    for (const value of [oldKey, newKey, encodeURIComponent(oldKey), encodeURIComponent(newKey)]) assert(!JSON.stringify(finished).includes(value))
    assert.deepEqual(received.slice(-2).map(headers => headers['x-access']), [oldKey, newKey])
    hold = undefined
    console.log('PASS Basic credentials and refresh old/new credentials stay hidden in preview/progress/version switches/final evidence')

    const nested = createFlow(projectId, '外层逻辑组暂停')
    nested.events = [
      createFlowEvent('script', { logical_step_id: 'outer', script: 'pm.variables.set("before", "done")' }),
      createFlowEvent('begin', { logical_step_id: 'outer', children: [createFlowEvent('request', { method: 'POST', url: origin })] }),
      createFlowEvent('script', { logical_step_id: 'outer', script: 'pm.variables.set("after", "done"); pm.test("post completed", () => pm.expect(1).to.eql(1))' }),
      createFlowEvent('request', { url: `${origin}/after-outer` })
    ]
    store.saveFlow(projectId, nested)
    release = undefined
    hold = response => { release = () => response.end('{}') }
    const nestedRun = startFlowRun(projectId, nested.flow_id, undefined, 'nested')
    try {
      await until(() => release, Boolean)
      pauseFlowRun(projectId, nestedRun.run_id)
      release!()
      const paused = await until(() => getFlowRun(projectId, nestedRun.run_id)!, run => run.status === 'paused')
      assert.equal(paused.variables.after, 'done')
      assert.equal(paused.events[1].status, 'passed')
      assert.equal(paused.events[2].assertions?.[0].passed, true)
      assert(!hits.includes('/after-outer'))
    } finally { await cancelFlowRun(projectId, nestedRun.run_id) }
    hold = undefined
    console.log('PASS nested container waits for outer logical step post script and assertions before pausing')


  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
