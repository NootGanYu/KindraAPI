import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import * as store from '../src/main/storage/store'
import { createDocSettings } from '../src/shared/factories'
import { startMcpServer, stopMcpServer } from '../src/main/mcp/server'
import { startDocServer, stopDocServer } from '../src/main/docs/server'

async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as net.AddressInfo).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  return port
}

async function main(): Promise<void> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kindra-docs-'))
  app.setPath('userData', userData)
  await app.whenReady()
  const project = store.ensureDefaultProject()
  const config = { ...store.getMcpConfig(), enabled: true, port: await freePort(), allow_write: true, allow_execute: true, allowed_project_ids: [project.project_id] }
  store.saveMcpConfig(config)
  await startMcpServer()
  const child = spawn(process.execPath, [path.resolve('mcp-stdio.cjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', KINDRAAPI_MCP_INFO: store.mcpInfoPath() }, stdio: ['pipe', 'pipe', 'pipe']
  })
  let sequence = 0
  const pending = new Map<number, (value: any) => void>()
  let buffer = ''
  child.stdout.setEncoding('utf8').on('data', chunk => {
    buffer += chunk
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      const value = JSON.parse(line)
      pending.get(value.id)?.(value)
    }
  })
  const rpc = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)) }, 15000)
    pending.set(id, value => { clearTimeout(timer); pending.delete(id); resolve(value) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const response = await rpc('tools/call', { name, arguments: { project_id: project.project_id, ...args } })
    if (response.result?.isError || response.error) throw new Error(JSON.stringify(response.result ?? response.error))
    return JSON.parse(response.result.content[0].text)
  }
  try {
    const initialized = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'documentation-smoke', version: '1' } })
    assert(initialized.result.instructions.includes('必须填写接口说明'))
    assert(initialized.result.instructions.includes('目录说明'))
    assert(initialized.result.instructions.includes('完整的 http:// 或 https:// 地址'))
    assert(initialized.result.instructions.includes('拒绝写入'))
    const tools = await rpc('tools/list', {})
    assert(tools.result.tools.some((t: any) => t.name === 'upsert_api' && t.inputSchema.properties.success_response.properties.field_docs.items.properties.enum_descriptions))
    assert(tools.result.tools.some((t: any) => t.name === 'upsert_api' && t.description.includes('每个已知')))
    assert(tools.result.tools.some((t: any) => t.name === 'create_folder' && t.inputSchema.properties.description))
    assert(tools.result.tools.some((t: any) => t.name === 'create_api' && t.inputSchema.properties.url.description.includes('主机名')))
    const folder = await call('create_folder', { name: '文档目录', description: '订单相关接口' })
    assert.equal(folder.folder.description, '订单相关接口')
    const moved = await call('move_target', { target_id: folder.folder.target_id, description: '订单与支付接口' })
    assert.equal(moved.target.description, '订单与支付接口')
    const state = { path: 'data.items[].state', type: 'integer', required: true, nullable: false, description: '订单状态', enum: [0, 1, 2], enum_descriptions: ['待审核', '通过', '驳回'], default: 0, example: 1 }
    const created = await call('upsert_api', {
      source_key: 'smoke.order.detail', name: 'MCP 文档验证', method: 'GET', url: 'http://localhost/orders/detail?id=order_001',
      description: '订单详情接口',
      query: [
        { key: 'id', value: 'order_001', type: 'string', checked: true, required: true, nullable: false, description: '订单标识', enum: null },
        { key: 'disabled', value: 'x', type: 'string', checked: false, required: false, nullable: false, description: '未启用也应显示', enum: null }
      ],
      body: { mode: 'none' },
      success_response: { raw: { data: { items: [{ state: 1 }] } }, field_docs: [
        { path: 'data', type: 'object', required: false, nullable: false, enum: null, description: '响应数据' },
        { path: 'data.items', type: 'array', required: false, nullable: false, enum: null, description: '订单列表' },
        { path: 'data.items[]', type: 'object', required: false, nullable: false, enum: null, description: '订单项' },
        state,
        { path: 'data.note', type: 'string', required: false, description: '不在示例中的字段', nullable: true, enum: null }
      ] }
    })
    const id = created.target_id
    assert(created.created)
    assert(created.documentation.complete, JSON.stringify(created.documentation.issues))
    assert(!created.documentation.issues.some((issue: any) => issue.path === 'query.id'))
    const update = await call('upsert_api', { source_key: 'smoke.order.detail', success_response: { field_docs: [{ path: state.path, description: '新的状态说明' }] } })
    assert.equal(update.target_id, id)
    assert(!update.created)
    assert.equal(store.listTargets(project.project_id).filter(t => t.target_type === 'api').length, 1)
    assert.deepEqual(update.api.response.example[0].field_docs.find((d: any) => d.pointer.endsWith('/state')).enum, [0, 1, 2])
    const before = JSON.stringify(store.getTarget(project.project_id, id))
    await assert.rejects(() => call('upsert_api', { target_id: id, name: '必须回滚', success_response: { field_docs: [{ path: state.path, enum: ['wrong'] }] } }))
    assert.equal(JSON.stringify(store.getTarget(project.project_id, id)), before)
    await assert.rejects(() => call('upsert_api', { target_id: id, success_response: { raw: { data: { items: [{ state: 1 }, { state: 'wrong' }] } } } }))
    assert.equal(JSON.stringify(store.getTarget(project.project_id, id)), before)
    await assert.rejects(() => call('upsert_api', { source_key: 'bad.create', name: '非法接口', url: '/bad', body: { mode: 'json', raw: '{' } }))
    assert.equal(store.listTargets(project.project_id).filter(t => t.target_type === 'api').length, 1)
    const legacy = await call('update_api', { target_id: id, response_example: { raw: { data: { items: [] } } } })
    assert(legacy.api.response.example[0].field_docs.some((d: any) => d.description === '新的状态说明'))

    const docPort = await freePort()
    store.saveDocServiceConfig({ enabled: true, port: docPort })
    await startDocServer()
    const share = store.createDocShare(project.project_id, { name: '文档验证', scope: 'project', target_ids: [], settings: createDocSettings({ openapi: true }) })
    const base = `http://127.0.0.1:${docPort}/share/${share.share_id}`
    const html = await (await fetch(`${base}/a/${id}`)).text()
    for (const text of ['响应字段说明', '新的状态说明', '待审核', '不在示例中的字段', '未启用也应显示', 'Query 参数', 'order_001', '无请求体', '可为 null', '待补充']) assert(html.includes(text), text)
    const markdown = await (await fetch(`${base}/download?format=md`)).text()
    assert(markdown.includes('新的状态说明') && markdown.includes('待审核'))
    const openapi: any = await (await fetch(`${base}/download?format=openapi`)).json()
    const operation = openapi.paths['/orders/detail'].get
    const schema = operation.responses['200'].content['application/json'].schema
    const importedState = schema.properties.data.properties.items.items.properties.state
    assert.deepEqual(importedState.enum, [0, 1, 2])
    assert.deepEqual(importedState['x-enum-descriptions'], ['待审核', '通过', '驳回'])
    assert.equal(importedState.nullable, false)
    assert.equal(importedState.default, 0)
    assert(!schema.required?.includes('data'), 'child requirement must not make optional ancestor required')
    assert(operation.parameters.some((p: any) => p.name === 'id'))
    assert(operation.parameters.some((p: any) => p.name === 'disabled' && p.required === false))
    assert(!operation.requestBody)
    const other = store.createProjectWithDefaults('round-trip')
    store.saveMcpConfig({ ...config, allowed_project_ids: [project.project_id, other.project_id] })
    // The running server holds its config; restart after extending this isolated test's allow list.
    await startMcpServer()
    await call('sync_openapi', { project_id: other.project_id, openapi })
    const imported = store.getTarget(other.project_id, store.listTargets(other.project_id).find(t => t.target_type === 'api')!.target_id)!
    assert.deepEqual(imported.response!.example![0].field_docs!.find(d => d.pointer.endsWith('/state'))!.enum_descriptions, ['待审核', '通过', '驳回'])
    assert.equal(imported.request!.query.parameter.find(p => p.key === 'id')!.required, true, 'documented required survives OpenAPI')
    assert.equal(imported.request!.query.parameter.find(p => p.key === 'disabled')!.required, false, 'explicit optional survives OpenAPI')
    const unknownKey = await rpc('tools/call', { name: 'upsert_api', arguments: { project_id: project.project_id, target_id: id, success_response: { field_docs: [{ path: state.path, enum_description: ['typo'] }] } } })
    assert(unknownKey.result.isError, 'unknown field metadata must not silently disappear')
    const noSample = await call('upsert_api', { source_key: 'smoke.no-sample', name: '尚未运行', url: 'http://localhost/no-sample', description: '尚未执行过的接口', body: { field_docs: [{ path: 'user.id', type: 'string', description: '用户标识', required: true, nullable: false, enum: null }] }, success_response: { field_docs: [{ path: 'ok', type: 'boolean', description: '成功标识', required: true, nullable: false, enum: null }] } })
    const noSampleHtml = await (await fetch(`${base}/a/${noSample.target_id}`)).text()
    assert(noSampleHtml.includes('用户标识') && noSampleHtml.includes('成功标识'), 'no raw/record required')
    const model = await call('create_data_model', { name: '状态模型', schema: { type: 'object', required: ['state'], properties: { state: { type: 'integer', description: '共享状态', enum: [0, 1], 'x-enum-descriptions': ['待处理', '完成'], example: 1 } } } })
    const linked = await call('upsert_api', { source_key: 'smoke.model', name: '引用模型', url: 'http://localhost/model', description: '引用数据模型的接口', body: { mode: 'json', model_id: model.model.model_id }, success_response: { model_id: model.model.model_id } })
    let modelHtml = await (await fetch(`${base}/a/${linked.target_id}`)).text()
    assert(modelHtml.includes('共享状态') && modelHtml.includes('待处理'))
    await call('update_data_model', { model_id: model.model.model_id, schema: { type: 'object', required: ['state'], properties: { state: { type: 'integer', description: '修改后的共享状态', enum: [0, 1], 'x-enum-descriptions': ['未完成', '已完成'], example: 1 } } } })
    modelHtml = await (await fetch(`${base}/a/${linked.target_id}`)).text()
    assert(modelHtml.includes('修改后的共享状态') && modelHtml.includes('已完成'), 'model documentation is live')
    const detached = await call('upsert_api', { target_id: linked.target_id, body: { model_id: null }, success_response: { model_id: null } })
    assert.equal(detached.api.request.body.field_docs[0].description, '修改后的共享状态')
    assert.deepEqual(detached.api.response.example[0].field_docs[0].enum_descriptions, ['未完成', '已完成'])
    const clone = store.cloneTarget(project.project_id, linked.target_id)
    assert.equal(clone.source_key, undefined)
    const multiple = store.getTarget(project.project_id, id)!
    multiple.response!.example!.push({ example_id: 'created-example', expect: { code: 201, name: '创建成功' }, raw: '{"id":1}' })
    store.saveTarget(project.project_id, multiple)
    const exact = await call('update_api_design', { target_id: id, response: { example: [{ example_id: 'created-example', expect: { name: '精确修改' }, field_docs: [{ path: 'id', description: '创建的标识' }] }] } })
    assert.equal(exact.response.example[0].expect.name, multiple.response!.example![0].expect!.name)
    assert.equal(exact.response.example[1].expect.name, '精确修改')
    let responseStatus = 200
    const endpoint = http.createServer((_request, response) => { response.writeHead(responseStatus, { 'content-type': 'application/json' }); response.end('{}') })
    await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve))
    try {
      const captured = await call('upsert_api', { source_key: 'smoke.capture', name: '显式保存响应', url: `http://127.0.0.1:${(endpoint.address() as net.AddressInfo).port}/capture`, description: '显式保存响应示例', success_response: { raw: { optional: 'example' }, field_docs: [{ path: 'optional', type: 'string', required: false, nullable: true, enum: null, description: '可选字段' }] } })
      const legacyDefinition = store.getTarget(project.project_id, captured.target_id)!
      legacyDefinition.response!.example![0].field_docs = [{ pointer: '/optional', type: 'string', description: '旧字段说明', required: false }]
      store.saveTarget(project.project_id, legacyDefinition)
      const savedCapture = await call('execute_api', { target_id: captured.target_id, save_response: true })
      assert(savedCapture.response_saved)
      const capturedHtml = await (await fetch(`${base}/a/${captured.target_id}`)).text()
      assert(capturedHtml.includes('旧字段说明'), 'a capture missing an optional field must retain its definition')
      const beforeError = JSON.stringify(store.getTarget(project.project_id, captured.target_id))
      responseStatus = 500
      const failedCapture = await call('execute_api', { target_id: captured.target_id, save_response: true })
      assert.equal(failedCapture.response_saved, false)
      assert.equal(JSON.stringify(store.getTarget(project.project_id, captured.target_id)), beforeError)
    } finally {
      endpoint.closeAllConnections()
      await new Promise<void>(resolve => endpoint.close(() => resolve()))
    }
    await call('upsert_api', { target_id: linked.target_id, body: { model_id: model.model.model_id } })
    await call('update_data_model', { model_id: model.model.model_id, schema: { type: 'object', properties: { known: { type: 'string', description: '保留字段' }, missing: { $ref: 'kindraapi://model/absent' } } } })
    const beforeDetach = JSON.stringify(store.getTarget(project.project_id, linked.target_id))
    await assert.rejects(() => call('upsert_api', { target_id: linked.target_id, body: { model_id: null } }))
    assert.equal(JSON.stringify(store.getTarget(project.project_id, linked.target_id)), beforeDetach, 'broken nested reference cannot silently lose definitions on detach')
    assert((await (await fetch(`${base}/a/${linked.target_id}`)).text()).includes('模型定义待修复'))
    const form = await call('upsert_api', { source_key: 'smoke.form', name: '表单', url: 'http://localhost/form', description: '表单接口', body: { mode: 'urlencoded', parameters: [{ key: 'state', type: 'integer', value: '1', enum: [0, 1], enum_descriptions: ['等待', '完成'], required: true, nullable: false, description: '表单状态' }] } })
    assert(!form.documentation.issues.some((issue: any) => issue.path.startsWith('body.')))
    const formBefore = JSON.stringify(store.getTarget(project.project_id, form.target_id))
    await assert.rejects(() => call('upsert_api', { target_id: form.target_id, body: { parameters: [{ key: 'note', value: '' }] } }))
    assert.equal(JSON.stringify(store.getTarget(project.project_id, form.target_id)), formBefore, 'incomplete field update must not be saved')
    const formDoc: any = await (await fetch(`${base}/download?format=openapi`)).json()
    await call('sync_openapi', { project_id: other.project_id, openapi: { ...formDoc, paths: { '/form': formDoc.paths['/form'] } } })
    const importedFormSummary = store.listTargets(other.project_id).find(t => t.url?.endsWith('/form'))!
    const importedForm = store.getTarget(other.project_id, importedFormSummary.target_id)!
    assert.deepEqual(importedForm.request!.body.urlencoded![0].enum_descriptions, ['等待', '完成'])
    const beforeCover = store.getTarget(other.project_id, imported.target_id)!
    await call('sync_openapi', { project_id: other.project_id, api_cover_mode: 'cover', openapi: { ...openapi, paths: { '/orders/detail': { get: { summary: '增量导入', parameters: [{ in: 'query', name: 'new', schema: { type: 'string' } }] } } } } })
    const afterCover = store.getTarget(other.project_id, imported.target_id)!
    assert.equal(afterCover.request!.query.parameter.length, beforeCover.request!.query.parameter.length + 1)
    assert.deepEqual(afterCover.response, beforeCover.response, 'omitted success definitions survive cover import')
    const invalidOperation = structuredClone(operation)
    invalidOperation.responses['200'].content['application/json'].schema = { type: 'object', properties: { state: { type: 'integer', enum: ['bad'] } } }
    const invalidImport = { openapi: '3.0.3', paths: { '/invalid-import': { get: invalidOperation } } }
    const countBeforeInvalid = store.listTargets(project.project_id).length
    await assert.rejects(() => call('sync_openapi', { openapi: invalidImport }))
    assert.equal(store.listTargets(project.project_id).length, countBeforeInvalid, 'invalid import leaves no empty API')
    const invalidRequest = {
      openapi: '3.0.3',
      paths: {
        '/invalid-request': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { type: 'object', properties: { state: { type: 'integer', enum: ['bad'] } } } } }
            }
          }
        }
      }
    }
    await assert.rejects(() => call('sync_openapi', { openapi: invalidRequest }))
    assert.equal(store.listTargets(project.project_id).length, countBeforeInvalid)
    const removed = await call('upsert_api', { target_id: id, success_response: { field_docs: [{ path: 'data.note', remove: true }, { path: state.path, unset: ['default'], enum: null, unset_dummy: undefined }] } })
    assert(!removed.api.response.example[0].field_docs.some((d: any) => d.pointer === '/data/note'))
    assert.equal(removed.api.response.example[0].field_docs.find((d: any) => d.pointer.endsWith('/state')).default, undefined)
    console.log(JSON.stringify({ ok: true, transport: 'stdio', checks: ['one-call authoring', 'idempotency', 'incremental merge', 'atomic rejection', 'legacy preservation', 'HTML/Markdown/OpenAPI', 'OpenAPI round trip', 'explicit removal', 'live models and safe detach', 'exact response update', 'form rules'], userData }))
  } finally {
    child.kill()
    await stopMcpServer()
    await stopDocServer()
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
