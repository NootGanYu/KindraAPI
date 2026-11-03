import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as storage from '../src/main/storage/store'
import { callTool } from '../src/main/mcp/tools'
import { onTargetChanges, withTargetChanges } from '../src/main/storage/changes'
import { useApp, hasLocalEdits } from '../src/renderer/src/store'
import { createApiCase } from '../src/shared/factories'
import type { TargetChangeEvent, TargetSnapshot } from '../src/shared/targetSync'

const ui = (): ReturnType<typeof useApp.getState> => useApp.getState()
const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

async function main(): Promise<void> {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-client-sync-')))
  await app.whenReady()
  const project = storage.ensureDefaultProject(), projectId = project.project_id
  const config = { ...storage.getMcpConfig(), enabled: true, allow_write: true, allow_execute: true, allowed_project_ids: [projectId] }
  storage.saveMcpConfig(config)
  const events: TargetChangeEvent[] = [], pending = new Set<Promise<void>>()
  const failures: unknown[] = []
  const read = async (pid: string, id: string) => ({ ok: true as const, data: storage.readTargetSnapshot(pid, id) })
  const api = { targets: {
    read,
    list: async (pid: string) => ({ ok: true as const, data: storage.listTargets(pid) }),
    saveChecked: async (pid: string, target: any, revision: string, op: string) => ({ ok: true as const,
      data: await withTargetChanges('ui', op, () => storage.saveTargetChecked(pid, target, revision)) }),
    reorder: async (pid: string, parentId: string, orderedIds: string[]) => ({ ok: true as const,
      data: await withTargetChanges('ui', undefined, () => storage.reorderTargets(pid, parentId, orderedIds)) }),
    saveCopy: async (pid: string, draft: any) => ({ ok: true as const,
      data: await withTargetChanges('ui', undefined, () => storage.saveTargetCopy(pid, draft)) })
  } }
  ;(globalThis as any).window = { api }
  useApp.setState({ project, ready: true, tabs: [], drafts: {}, baselines: {}, pendingUpdates: {}, editLocks: {}, activeId: null })
  const off = onTargetChanges(event => {
    events.push(event)
    const task = ui().syncTargets(event)
    pending.add(task)
    void task.catch(error => failures.push(error)).finally(() => pending.delete(task))
  })
  const settle = async (): Promise<void> => {
    do { await Promise.all([...pending]); await pause() } while (pending.size)
    if (failures.length) throw failures.shift()
  }
  const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const result = await callTool(name, { project_id: projectId, ...args }, config)
    assert(result.ok, result.ok ? '' : result.error)
    await settle()
    return result.result
  }
  const create = async (name: string): Promise<string> => (await call('upsert_api', {
    source_key: name, name, method: 'GET', url: 'https://example.invalid/before', description: `${name} 接口`, body: { mode: 'none' }
  })).target_id
  try {
    const id = await create('sync-main'), other = await create('sync-background')
    await ui().openTarget(id); await ui().openTarget(other)
    await call('upsert_api', { target_id: id, name: 'MCP 最新名称', url: 'https://example.invalid/after',
      query: [{ key: 'id', type: 'string', required: false, nullable: true, enum: null, description: '新的查询说明' }],
      success_response: { raw: { state: 1 }, field_docs: [{ path: 'state', description: '新的响应说明', type: 'integer', required: true, nullable: false, enum: null }] } })
    assert.equal(ui().drafts[id].name, 'MCP 最新名称')
    assert.equal(ui().tabs.find(tab => tab.id === id)!.name, 'MCP 最新名称')
    assert.equal(ui().drafts[id].request!.query.parameter[0].description, '新的查询说明')
    assert.equal(ui().drafts[id].response!.example![0].field_docs![0].description, '新的响应说明')
    assert.equal(ui().tabs.find(tab => tab.id === id)!.dirty, false)
    assert.equal(ui().tabs.find(tab => tab.id === id)!.syncedBy, 'MCP')
    assert.equal(ui().activeId, other, 'background update must not select the tab')
    console.log('PASS MCP persisted changes refresh open clean tabs, definitions, title and feedback')

    ui().patchDraft(id, { description: '本地未保存内容' })
    await call('upsert_api', { target_id: id, description: 'MCP 修改' })
    assert.equal(ui().drafts[id].description, '本地未保存内容')
    assert.equal(ui().pendingUpdates[id].target!.description, 'MCP 修改')
    await assert.rejects(ui().saveTarget(id), /保存冲突/)
    const confirmed = ui().saveConflict!.snapshot.revision!
    await call('upsert_api', { target_id: id, description: '确认期间又修改' })
    await assert.rejects(ui().saveTarget(id, confirmed), /保存冲突/)
    assert.equal(storage.getTarget(projectId, id)!.description, '确认期间又修改')
    await ui().saveTarget(id, ui().saveConflict!.snapshot.revision!)
    await settle()
    assert.equal(storage.getTarget(projectId, id)!.description, '本地未保存内容')
    assert.equal(ui().tabs.find(tab => tab.id === id)!.dirty, false)
    assert.equal(ui().pendingUpdates[id], undefined)
    console.log('PASS draft protection, stale-save rejection, repeated conflict and explicit overwrite')

    ui().lockEditing(id, 1)
    assert(hasLocalEdits(id))
    await call('upsert_api', { target_id: id, description: '弹窗期间的 MCP 更新' })
    assert.notEqual(ui().drafts[id].description, '弹窗期间的 MCP 更新')
    assert(ui().pendingUpdates[id])
    ui().lockEditing(id, -1)
    await settle()
    assert.equal(ui().drafts[id].description, '弹窗期间的 MCP 更新')
    assert(!hasLocalEdits(id))
    ui().patchDraft(id, {})
    assert(!hasLocalEdits(id), 'no-op updates must not create false dirty state')
    console.log('PASS unsubmitted-editor locks and cancel-to-apply pending update')

    const runTarget = storage.getTarget(projectId, id)!
    const apiCase = createApiCase({ name: 'runtime-preservation' })
    runTarget.cases = [apiCase]
    storage.saveTarget(projectId, runTarget); await settle()
    const revision = ui().baselines[id].revision
    ui().patchDraft(id, { description: '运行期间继续编辑' })
    storage.saveCaseRun(projectId, id, apiCase.case_id, { status: 'passed', ran_at: '2026-11-01T00:00:00Z' })
    await settle()
    assert.equal(ui().drafts[id].description, '运行期间继续编辑')
    assert.equal(ui().drafts[id].cases![0].last_run!.status, 'passed')
    assert.equal(storage.readTargetSnapshot(projectId, id).revision, revision)
    await ui().saveTarget(id); await settle()
    assert.equal(storage.getTarget(projectId, id)!.cases![0].last_run!.status, 'passed')
    console.log('PASS runtime-only updates preserve local edits and do not cause definition conflicts')

    ui().patchDraft(id, { description: '拖拽后保留本地编辑' })
    await ui().reorderTargets('0', [id, other])
    await settle()
    assert.equal(ui().tabs.find(tab => tab.id === id)!.externalSource, undefined)
    assert.equal(ui().pendingUpdates[id], undefined)
    assert.equal(ui().tabs.find(tab => tab.id === id)!.dirty, true)
    await ui().saveTarget(id)
    await settle()
    assert.equal(ui().tabs.find(tab => tab.id === id)!.dirty, false)
    console.log('PASS UI reorder refreshes the baseline without false external updates')

    const originalRead = api.targets.read
    let release: (() => void) | undefined
    let capture: TargetSnapshot | undefined
    api.targets.read = async (pid, targetId) => {
      if (targetId !== id || capture) return originalRead(pid, targetId)
      capture = storage.readTargetSnapshot(pid, targetId)
      await new Promise<void>(resolve => { release = resolve })
      return { ok: true, data: capture! }
    }
    const first = ui().syncTargets()
    await pause()
    ui().patchDraft(id, { description: '读取期间开始输入' })
    release!(); await first
    assert.equal(ui().drafts[id].description, '读取期间开始输入')
    api.targets.read = originalRead
    await ui().loadLatest(id)
    console.log('PASS edits started during an asynchronous refresh are not overwritten')

    const start = events.length
    await call('create_api', { name: 'legacy-create', url: 'http://localhost/legacy', description: '客户端同步测试接口' })
    assert.equal(events.slice(start).filter(event => event.source === 'mcp').length, 1)
    const partialStart = events.length
    await assert.rejects(withTargetChanges('mcp', 'partial-batch', () => {
      const target = storage.getTarget(projectId, id)!
      storage.saveTarget(projectId, { ...target, description: '部分写入已完成' })
      throw new Error('later failure')
    }), /later failure/)
    await settle()
    assert(events.slice(partialStart).some(event => event.operationId === 'partial-batch'))
    assert.equal(ui().drafts[id].description, '部分写入已完成')
    console.log('PASS multiple saves coalesce and partial batch failures still publish committed changes')

    const caseId = ui().drafts[id].cases?.[0]?.case_id
    assert(caseId)
    const originalSaveChecked = api.targets.saveChecked
    api.targets.saveChecked = async (pid, target, revision, op) => {
      const result = await originalSaveChecked(pid, target, revision, op)
      storage.saveCaseRun(pid, target.target_id, caseId, { status: 'passed', ran_at: '2026-11-01T00:00:01Z' })
      await settle()
      return result
    }
    try {
      ui().patchDraft(id, { description: '保存期间运行用例' })
      await ui().saveTarget(id)
    } finally {
      api.targets.saveChecked = originalSaveChecked
    }
    assert.equal(ui().tabs.find(tab => tab.id === id)!.dirty, false)
    assert.equal(ui().drafts[id].cases![0].last_run!.status, 'passed')
    console.log('PASS runtime updates during a save do not mark the tab dirty')

    ui().patchDraft(id, { description: '删除后保留我' })
    await call('upsert_api', { target_id: id, description: '删除前的 MCP 更新' })
    await assert.rejects(ui().saveTarget(id), /保存冲突/)
    assert(ui().saveConflict)
    await call('delete_apis', { target_ids: [id], confirm: true })
    assert(ui().tabs.some(tab => tab.id === id))
    assert.equal(ui().pendingUpdates[id].target, null)
    assert.equal(ui().saveConflict?.snapshot.target, null)
    await ui().loadLatest(id)
    assert(ui().tabs.some(tab => tab.id === id), 'loadLatest must not discard a deleted draft')
    assert.equal(ui().drafts[id].description, '删除后保留我')
    assert.equal(ui().saveConflict?.snapshot.target, null)
    await assert.rejects(ui().saveTarget(id), /已被删除/)
    assert.equal(storage.getTarget(projectId, id), null)
    const beforeCopy = new Set(ui().tabs.map(tab => tab.id))
    await ui().saveCopy(id)
    const copyId = ui().tabs.map(tab => tab.id).find(tabId => !beforeCopy.has(tabId))
    assert(copyId)
    assert.equal(storage.getTarget(projectId, copyId!)!.description, '删除后保留我')
    await call('delete_apis', { target_ids: [other], confirm: true })
    assert(!ui().tabs.some(tab => tab.id === other))
    assert(ui().syncNotice.includes('删除'))
    console.log('PASS deletion closes clean tabs, retains dirty drafts and prevents resurrection')
    console.log('CLIENT SYNC SMOKE PASSED')
  } finally { off() }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
