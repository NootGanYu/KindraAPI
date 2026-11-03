import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as store from '../src/main/storage/store'
import { createTarget } from '../src/shared/factories'
import { callTool } from '../src/main/mcp/tools'
import { registerIpc } from '../src/main/ipc'
import type { Flow, FlowEvent } from '../src/shared/types'

async function main(): Promise<void> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-flow-definition-'))
  app.setPath('userData', temp)
  await app.whenReady()
  const project = store.ensureDefaultProject(), projectId = project.project_id
  const config = { ...store.getMcpConfig(), enabled: true, allow_write: true, allow_execute: true, allowed_project_ids: [projectId] }
  store.saveMcpConfig(config)
  const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const result = await callTool(name, { project_id: projectId, ...args }, config)
    assert(result.ok, result.ok ? '' : result.error)
    return result.result
  }
  const events: FlowEvent[] = [{ event_id: 'condition', type: 'if', name: '条件', enabled: true, condition: 'true', children: [
    { event_id: 'loop', type: 'loop', name: '循环', enabled: true, loop_count: 2, children: [
      { event_id: 'script', type: 'script', name: '脚本', enabled: true, script: 'env.value = "kept"' },
      { event_id: 'group', type: 'begin', name: '分组', enabled: true, children: [
        { event_id: 'request', type: 'request', name: '请求', enabled: true, method: 'POST', url: 'http://127.0.0.1/example', headers: [], body: '{}' },
        { event_id: 'wait', type: 'wait', name: '等待', enabled: false, wait_ms: 20 },
        { event_id: 'assert', type: 'assert', name: '断言', enabled: true, assertions: [
          { assert_id: 'a1', type: 'status', op: 'equals', expected: 201 }
        ] }
      ] }
    ] }
  ] }]
  try {
    const created = await call('create_execution_flow', { name: '完整事件树', events })
    const read = async (): Promise<Flow> => (await call('get_execution_flow', { flow_id: created.flow_id })).flow
    const flow = await read()
    assert.deepEqual(flow.events, events)
    assert.equal(typeof flow.revision, 'string')
    assert.equal(created.revision, flow.revision)
    console.log('PASS complete event tree and revision round trip through MCP and real storage')
    const api = createTarget(projectId, '0', 'api', '旧格式接口')
    store.saveTarget(projectId, api)
    const legacy = await call('create_execution_flow', { name: '旧步骤', steps: [{
      target_id: api.target_id, event_id: 'api-event', step_id: 'step-one', logical_step_id: 'logic-one',
      pre_script: 'env.before = "yes"', post_script: 'env.after = "yes"'
    }] })
    const legacyRead = async (): Promise<Flow> => (await call('get_execution_flow', { flow_id: legacy.flow_id })).flow
    const old = await legacyRead()
    assert.equal(old.events[1].event_id, 'api-event')
    assert(old.events.every(event => event.step_id === 'step-one' && event.logical_step_id === 'logic-one'))
    const renamed = await call('update_execution_flow', { flow_id: legacy.flow_id, name: '新名称' })
    assert.deepEqual((await legacyRead()).events, old.events, 'metadata update must preserve all IDs')
    assert.notEqual(renamed.revision, old.revision)
    const replaced = [{ target_id: api.target_id, pre_script: 'env.before = "yes"', post_script: 'env.after = "yes"' }]
    await call('update_execution_flow', { flow_id: legacy.flow_id, steps: replaced })
    const firstReplacement = await legacyRead()
    await call('update_execution_flow', { flow_id: legacy.flow_id, steps: replaced })
    const secondReplacement = await legacyRead()
    assert.notEqual(secondReplacement.events[1].event_id, firstReplacement.events[1].event_id)
    assert.notEqual(secondReplacement.events[1].step_id, firstReplacement.events[1].step_id)
    const identifiedSteps = [{ target_id: api.target_id, step_id: 'stable-step', pre_script: 'env.x = 1', post_script: 'env.y = 2' }]
    await call('update_execution_flow', { flow_id: legacy.flow_id, steps: identifiedSteps })
    const identified = await legacyRead()
    await call('update_execution_flow', { flow_id: legacy.flow_id, steps: identifiedSteps })
    assert.deepEqual((await legacyRead()).events, identified.events, 'explicit step identity preserves its generated event group')
    console.log('PASS legacy explicit replacement, stable logical grouping and supplied IDs')

    const reject = async (args: Record<string, unknown>, pattern: RegExp): Promise<void> => {
      const result = await callTool('update_execution_flow', { project_id: projectId, flow_id: created.flow_id, ...args }, config)
      assert(!result.ok)
      assert.match(result.error, pattern)
      assert.deepEqual((await read()).events, events)
    }
    await reject({ events }, /expected_revision/)
    await reject({ events, steps: [], expected_revision: flow.revision }, /互斥/)
    await reject({ events: [{ type: 'unknown' }], expected_revision: flow.revision }, /未知事件/)
    await reject({ events: [{ type: 'loop', children: [{ type: 'future-event' }] }], expected_revision: flow.revision }, /未知事件/)
    await reject({ events: [{ type: 'wait', event_id: 'same' }, { type: 'wait', event_id: 'same' }], expected_revision: flow.revision }, /重复 event_id/)
    await reject({ steps: [{ target_id: api.target_id }] }, /完整 events/)
    const concurrent = await Promise.all(['甲', '乙'].map(name => callTool('update_execution_flow', {
      project_id: projectId, flow_id: created.flow_id, name, events, expected_revision: flow.revision
    }, config)))
    assert.equal(concurrent.filter(result => result.ok).length, 1)
    assert.match((concurrent.find(result => !result.ok) as { error: string }).error, /冲突/)
    console.log('PASS rejected unknown/mutually-exclusive/legacy-overwrite inputs and compare-and-save race')

    registerIpc()
    const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
    try {
      await window.loadURL('data:text/html,<title>flow definition IPC smoke</title>')
      const invoke = (channel: string, ...args: unknown[]): Promise<any> => window.webContents.executeJavaScript(
        `require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`)
      const uiRead = await invoke('flow:get', projectId, created.flow_id)
      assert(uiRead.ok)
      assert.deepEqual(uiRead.data.events, events)
      const uiDraft = { ...uiRead.data, name: '界面修改' }
      await call('update_execution_flow', { flow_id: created.flow_id, description: 'MCP 并发修改', expected_revision: uiRead.data.revision })
      const stale = await invoke('flow:save', projectId, uiDraft, uiRead.data.revision)
      assert.equal(stale.ok, false, 'UI must not overwrite a newer MCP definition')
      assert.match(stale.error, /冲突/)
      const fresh = await invoke('flow:get', projectId, created.flow_id)
      const saved = await invoke('flow:save', projectId, { ...fresh.data, name: '界面确认后保存' }, fresh.data.revision)
      assert(saved.ok, saved.error)
      assert.equal((await read()).name, '界面确认后保存')
      assert.deepEqual((await read()).events, events)
      console.log('PASS real Electron IPC round trip, stale UI conflict and explicit fresh revision save')
    } finally { window.destroy() }

  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
