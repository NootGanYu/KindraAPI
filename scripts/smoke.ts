/**
 * Throwaway runtime smoke test.
 * Run with: node_modules/.bin/esbuild scripts/smoke.ts --bundle --platform=node \
 *   --format=cjs --external:electron --external:postman-runtime \
 *   --external:postman-collection --outfile=scripts/.smoke.cjs && \
 *   node_modules/.bin/electron scripts/.smoke.cjs
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {
  createModelInProject,
  createTargetInProject,
  deleteDbConnection,
  deleteDictionaryEntry,
  deleteModel,
  ensureDefaultProject,
  findModelReferences,
  getModel,
  listDbConnections,
  listDictionaryEntries,
  listDictionarySuggestions,
  listModels,
  moveModel,
  redactDbConnection,
  saveDbConnection,
  saveDictionaryEntry,
  saveDictionarySettings,
  saveEnvironment,
  saveFlow,
  saveMcpConfig,
  saveModel,
  saveSettings,
  saveTarget,
  copyModel,
  getMcpConfig,
  getSettings,
  mcpInfoPath
} from '../src/main/storage/store'
import {
  createDbConnection,
  createEnvironment,
  createFlow,
  createFlowEvent,
  createParam
} from '../src/shared/factories'
import { runFlow } from '../src/main/flow/engine'
import { startMcpServer, stopMcpServer } from '../src/main/mcp/server'
import {
  generateFromSchema,
  generateModelExample,
  generateSchemaExample
} from '../src/main/schema/example'
import { importDbTables, listDbTables, mapMysqlType, testDbConnection } from '../src/main/db/mysql'

function assert(condition: unknown, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
}

function bridgeCall(
  port: number,
  token: string,
  tool: string,
  args: Record<string, unknown>
): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    let buffer = ''
    let settled = false
    const finish = (error: Error | null, value?: unknown): void => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    socket.setEncoding('utf8')
    socket.setTimeout(15000)
    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: 1, tool, args, token }) + '\n')
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const index = buffer.indexOf('\n')
      if (index < 0) return
      try {
        finish(null, JSON.parse(buffer.slice(0, index)))
      } catch (error) {
        finish(new Error('invalid bridge response'))
      }
    })
    socket.on('timeout', () => finish(new Error('bridge timeout')))
    socket.on('error', (error) => finish(error))
  })
}

async function main(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openpost-smoke-'))
  app.setPath('userData', tmp)
  ;(app as unknown as { dock?: { hide(): void } }).dock?.hide()
  await app.whenReady()

  const httpServer = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const send = (code: number, value: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      if (req.url === '/login') return send(200, { token: 'smoke-token' })
      if (req.url === '/ping') return send(200, { ok: true })
      if (req.url === '/orders') {
        if (req.headers.authorization !== 'Bearer smoke-token') {
          return send(401, { error: 'unauthorized' })
        }
        return send(200, { orders: [{ id: 1 }, { id: 2 }] })
      }
      return send(404, { error: 'not found' })
    })
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()))
  const httpPort = (httpServer.address() as net.AddressInfo).port

  const project = ensureDefaultProject()
  const env = createEnvironment(project.project_id, 'smoke')
  env.server_list[0].uri = `http://127.0.0.1:${httpPort}`
  saveEnvironment(project.project_id, env)
  saveSettings({ ...getSettings(), environment_id: env.env_id })

  const login = createTargetInProject(project.project_id, '0', 'api')
  login.name = '登录'
  login.method = 'POST'
  login.url = '{{baseUrl}}/login'
  login.request!.body = { mode: 'raw', raw: '{"username":"ada","password":"secret"}' }
  saveTarget(project.project_id, login)

  const orders = createTargetInProject(project.project_id, '0', 'api')
  orders.name = '查询订单'
  orders.method = 'GET'
  orders.url = '{{baseUrl}}/orders'
  orders.request!.header.parameter = [
    createParam({ key: 'Authorization', value: 'Bearer {{token}}' })
  ]
  saveTarget(project.project_id, orders)

  const flow = createFlow(project.project_id, 'smoke flow', env.env_id)
  flow.events = [
    createFlowEvent('api', { name: '登录', target_id: login.target_id }),
    createFlowEvent('script', {
      name: '保存 token',
      script:
        'pm.environment.set("token", pm.response.json().token);\npm.test("login 200", () => pm.expect(pm.response.code).to.eql(200));'
    }),
    createFlowEvent('assert', {
      name: 'token 存在',
      assertions: [{ assert_id: 'a1', type: 'json', path: 'token', op: 'exists' }]
    }),
    createFlowEvent('if', {
      name: '有 token 时查订单',
      condition: 'env.token !== undefined',
      children: [
        createFlowEvent('api', { name: '查询订单', target_id: orders.target_id }),
        createFlowEvent('assert', {
          name: '订单数 > 0',
          assertions: [
            { assert_id: 'a2', type: 'json', path: 'orders', op: 'length_gt', expected: 0 }
          ]
        })
      ]
    })
  ]
  saveFlow(project.project_id, flow)

  const run = await runFlow(project.project_id, flow, env.env_id)
  assert(run.status === 'passed', 'flow run passed')
  assert(run.variables.token === 'smoke-token', 'token propagated')

  // -------------------------------------------------------------------------
  // Issue 01 · shared schema example generation
  // -------------------------------------------------------------------------
  const pid = project.project_id
  assert(generateSchemaExample({ type: 'string', example: 'e', default: 'd', enum: ['x'] }).value === 'e', 'example priority')
  assert(generateSchemaExample({ type: 'string', default: 'd', enum: ['x'] }).value === 'd', 'default priority')
  assert(generateSchemaExample({ type: 'string', enum: ['x'] }).value === 'x', 'enum priority')
  const ordered = generateSchemaExample({
    type: 'object',
    'x-schema-orders': ['b', 'a'],
    properties: {
      a: { type: 'string' },
      b: { type: 'array', items: { type: 'integer' } }
    }
  })
  assert(JSON.stringify(ordered.value) === '{"b":[0],"a":""}', 'x-schema-orders and arrays')

  // -------------------------------------------------------------------------
  // Issues 03-04 · dictionary
  // -------------------------------------------------------------------------
  const allEntries = listDictionaryEntries(pid)
  assert(allEntries.filter((entry) => entry.source === 'builtin').length === 19, 'builtin dictionary 19')
  assert(allEntries.find((entry) => entry.key === 'page')?.field_type === 'number', 'page is number')
  assert(allEntries.find((entry) => entry.key === 'price')?.field_type === 'number', 'price is number')
  assert(allEntries.find((entry) => entry.key === 'token')?.field_type === 'string', 'token is string')
  const customEntry = saveDictionaryEntry(pid, {
    id: '',
    project_id: pid,
    key: 'order_no',
    field_type: 'string',
    description: '订单编号',
    remarks: '',
    default_value: '',
    created_at: '',
    updated_at: ''
  })
  assert(customEntry.id, 'custom dictionary saved')
  assert(listDictionarySuggestions(pid).some((entry) => entry.id === customEntry.id), 'custom suggestion present')
  saveDictionarySettings(pid, { builtin_enabled: false })
  assert(
    !listDictionarySuggestions(pid).some((entry) => entry.source === 'builtin'),
    'builtin suggestions disabled'
  )
  assert(listDictionaryEntries(pid).some((entry) => entry.source === 'builtin'), 'builtin still visible')
  saveDictionarySettings(pid, { builtin_enabled: true })
  deleteDictionaryEntry(pid, customEntry.id)
  assert(!listDictionaryEntries(pid).some((entry) => entry.id === customEntry.id), 'custom dictionary deleted')

  // -------------------------------------------------------------------------
  // Issues 05-08 · models, references, cycles
  // -------------------------------------------------------------------------
  const folder = createModelInProject(pid, '0', 'folder')
  folder.name = '业务模型'
  saveModel(pid, folder)

  const product = createModelInProject(pid, '0', 'model')
  product.name = 'Product'
  product.alias = '商品'
  product.data = {
    description: '商品模型',
    schema: {
      type: 'object',
      'x-schema-orders': ['id', 'price', 'status', 'tags', 'profile'],
      required: ['id'],
      properties: {
        id: { type: 'integer', example: 7 },
        price: { type: 'number', default: 9.9 },
        status: { type: 'string', enum: ['on', 'off'] },
        tags: { type: 'array', items: { type: 'string' } },
        profile: {
          type: 'object',
          'x-schema-orders': ['nickname'],
          properties: { nickname: { type: 'string' } }
        }
      }
    }
  }
  saveModel(pid, product)
  const productExample = generateModelExample(pid, product.model_id)
  const productValue = productExample.value as Record<string, unknown>
  assert(productValue.id === 7, 'model example uses example')
  assert(productValue.price === 9.9, 'model example uses default')
  assert(productValue.status === 'on', 'model example uses enum')
  assert(Array.isArray(productValue.tags) && (productValue.tags as unknown[]).length === 1, 'array one element')
  assert(
    JSON.stringify(Object.keys(productValue)) ===
      JSON.stringify(['id', 'price', 'status', 'tags', 'profile']),
    'model field order preserved'
  )

  const nested = createModelInProject(pid, folder.model_id, 'model')
  nested.name = 'Nested'
  nested.data = { description: '', schema: { type: 'object', properties: { name: { type: 'string' } } } }
  saveModel(pid, nested)
  const copied = copyModel(pid, nested.model_id, '0')
  assert(copied.model_id !== nested.model_id && copied.name.includes('副本'), 'copy model')
  moveModel(pid, copied.model_id, folder.model_id)
  assert(getModel(pid, copied.model_id)?.parent_id === folder.model_id, 'move model')

  const refTarget = createTargetInProject(pid, '0', 'api')
  refTarget.name = '商品接口'
  refTarget.request!.body = { mode: 'json', raw: '{}', model_id: product.model_id }
  refTarget.response = {
    example: [
      {
        example_id: 'ex_smoke',
        expect: { is_default: 1, model_id: product.model_id, code: 200 },
        raw: '{}'
      }
    ]
  }
  saveTarget(pid, refTarget)
  const references = findModelReferences(pid, product.model_id)
  assert(references.length === 2, 'model references found')
  assert(references.some((reference) => reference.kind === 'request-body'), 'request body reference')
  assert(references.some((reference) => reference.kind === 'response-example'), 'response reference')

  const cycleA = createModelInProject(pid, '0', 'model')
  cycleA.name = 'CycleA'
  const cycleB = createModelInProject(pid, '0', 'model')
  cycleB.name = 'CycleB'
  cycleA.data = {
    description: '',
    schema: { type: 'object', properties: { b: { $ref: `openpost://model/${cycleB.model_id}` } } }
  }
  cycleB.data = {
    description: '',
    schema: { type: 'object', properties: { a: { $ref: `openpost://model/${cycleA.model_id}` } } }
  }
  saveModel(pid, cycleA)
  saveModel(pid, cycleB)
  const cycle = generateModelExample(pid, cycleA.model_id)
  assert(cycle.warnings.some((warning) => warning.code === 'cycle'), 'cycle warning')

  const missing = generateFromSchema(pid, {
    type: 'object',
    properties: {
      ok: { type: 'string' },
      lost: { $ref: 'openpost://model/not-exists' }
    }
  })
  assert((missing.value as Record<string, unknown>).ok === '', 'partial result kept')
  assert(missing.warnings.some((warning) => warning.code === 'missing-model'), 'missing ref warning')

  const cascade = createModelInProject(pid, '0', 'folder')
  cascade.name = '级联目录'
  saveModel(pid, cascade)
  const childModel = createModelInProject(pid, cascade.model_id, 'model')
  childModel.name = 'Child'
  saveModel(pid, childModel)
  deleteModel(pid, cascade.model_id)
  assert(getModel(pid, childModel.model_id) === null, 'folder delete cascades')
  deleteModel(pid, copied.model_id)

  // -------------------------------------------------------------------------
  // Issues 10-11 · DB connection storage and type mapping
  // -------------------------------------------------------------------------
  assert(mapMysqlType('tinyint', 'tinyint(1)').type === 'boolean', 'tinyint(1) mapping')
  assert(mapMysqlType('bigint', 'bigint').type === 'integer', 'bigint mapping')
  assert(mapMysqlType('decimal', 'decimal(10,2)').type === 'number', 'decimal mapping')
  assert(mapMysqlType('json', 'json').type === 'object', 'json mapping')
  assert(mapMysqlType('varchar', 'varchar(32)').type === 'string', 'varchar mapping')

  const dbDraft = createDbConnection(pid)
  dbDraft.name = 'smoke mysql'
  dbDraft.config.default = {
    host: '127.0.0.1',
    port: 3306,
    user: 'smoke',
    password: 'secret-password',
    database: 'smoke'
  }
  dbDraft.ssh.password = 'ssh-secret'
  dbDraft.ssh.private_key = 'private-key'
  const savedDb = saveDbConnection(pid, dbDraft)
  assert(listDbConnections(pid).length === 1, 'db connection saved')
  const redacted = redactDbConnection(savedDb) as unknown as Record<string, unknown>
  const redactedText = JSON.stringify(redacted)
  assert(!redactedText.includes('secret-password'), 'db password redacted')
  assert(!redactedText.includes('ssh-secret'), 'ssh password redacted')
  assert(!redactedText.includes('private-key'), 'private key redacted')

  const sshDraft = createDbConnection(pid)
  sshDraft.name = 'ssh connection'
  sshDraft.ssh.enable = 1
  const sshSaved = saveDbConnection(pid, sshDraft)
  const sshTest = await testDbConnection(sshSaved.config.default, sshSaved.ssh)
  assert(!sshTest.ok && sshTest.message.includes('SSH 隧道后续支持'), 'ssh test not supported')
  let sshTablesError = ''
  try {
    await listDbTables(sshSaved.config.default, sshSaved.ssh)
  } catch (error) {
    sshTablesError = (error as Error).message
  }
  assert(sshTablesError.includes('SSH 隧道后续支持'), 'ssh table read not supported')
  deleteDbConnection(pid, sshSaved.db_id)

  const config = getMcpConfig()
  const port = 39199
  saveMcpConfig({
    ...config,
    enabled: true,
    allow_write: true,
    allow_execute: true,
    allowed_project_ids: [project.project_id],
    port,
    token: 'smoke-token-123'
  })
  const status = await startMcpServer()
  assert(status.running, 'mcp server running')

  const tools = await bridgeCall(port, 'smoke-token-123', '__tools', {})
  assert(tools.ok && tools.result.tools.length === 46, 'mcp tool list')

  const projects = await bridgeCall(port, 'smoke-token-123', 'list_projects', {})
  assert(projects.ok && projects.result.projects.length === 1, 'mcp list projects')

  const exec = await bridgeCall(port, 'smoke-token-123', 'execute_api', {
    project_id: project.project_id,
    target_id: login.target_id
  })
  assert(exec.ok && exec.result.status === 'passed', 'mcp execute api')

  const servers = await bridgeCall(port, 'smoke-token-123', 'list_environment_servers', {
    project_id: project.project_id
  })
  assert(servers.ok && servers.result.servers.length >= 1, 'mcp list environment servers')
  const createdServer = await bridgeCall(
    port,
    'smoke-token-123',
    'create_environment_server',
    { project_id: project.project_id, name: 'extra', base_url: 'http://127.0.0.1:9999' }
  )
  assert(createdServer.ok, 'mcp create environment server')
  const serverId = createdServer.result.server.server_id
  const updatedServer = await bridgeCall(
    port,
    'smoke-token-123',
    'update_environment_server',
    { project_id: project.project_id, server_id: serverId, name: 'extra-2' }
  )
  assert(updatedServer.ok && updatedServer.result.server.name === 'extra-2', 'mcp update server')
  const deletedServer = await bridgeCall(
    port,
    'smoke-token-123',
    'delete_environment_server',
    { project_id: project.project_id, server_id: serverId, confirm: true }
  )
  assert(deletedServer.ok, 'mcp delete environment server')

  const sync = await bridgeCall(port, 'smoke-token-123', 'sync_openapi', {
    project_id: project.project_id,
    host_path: `http://127.0.0.1:${httpPort}`,
    openapi: {
      openapi: '3.0.0',
      paths: {
        '/ping': {
          get: {
            summary: 'Ping',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { ok: { type: 'boolean' } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  })
  assert(sync.ok && sync.result.created === 1, 'mcp sync openapi')
  const syncedApis = await bridgeCall(port, 'smoke-token-123', 'list_apis', {
    project_id: project.project_id,
    keyword: 'Ping'
  })
  assert(syncedApis.ok && syncedApis.result.apis.length === 1, 'mcp synced api visible')

  // -------------------------------------------------------------------------
  // Issues 12-13 · MCP dictionary / model / database tools
  // -------------------------------------------------------------------------
  const builtinList = await bridgeCall(port, 'smoke-token-123', 'list_dictionary_entries', {
    project_id: pid,
    source: 'builtin'
  })
  assert(builtinList.ok && builtinList.result.total === 19, 'mcp builtin dictionary')
  const mcpDict = await bridgeCall(port, 'smoke-token-123', 'create_dictionary_entry', {
    project_id: pid,
    key: 'trace_id',
    field_type: 'string',
    description: '链路追踪 ID'
  })
  assert(mcpDict.ok && mcpDict.result.entry.id, 'mcp create dictionary')
  const mcpDictId = mcpDict.result.entry.id as string
  const mcpDictUpdated = await bridgeCall(port, 'smoke-token-123', 'update_dictionary_entry', {
    project_id: pid,
    id: mcpDictId,
    description: '链路追踪标识'
  })
  assert(mcpDictUpdated.ok && mcpDictUpdated.result.entry.description === '链路追踪标识', 'mcp update dictionary')
  const mcpBuiltinDelete = await bridgeCall(port, 'smoke-token-123', 'delete_dictionary_entry', {
    project_id: pid,
    id: 'builtin_page',
    confirm: true
  })
  assert(mcpBuiltinDelete.ok === false, 'mcp builtin delete rejected')

  const mcpModel = await bridgeCall(port, 'smoke-token-123', 'create_data_model', {
    project_id: pid,
    name: 'McpModel',
    schema: { type: 'object', properties: { id: { type: 'integer' } } }
  })
  assert(mcpModel.ok && mcpModel.result.model.model_id, 'mcp create model')
  const mcpModelId = mcpModel.result.model.model_id as string
  const mcpModelGet = await bridgeCall(port, 'smoke-token-123', 'get_data_model', {
    project_id: pid,
    model_id: mcpModelId
  })
  assert(mcpModelGet.ok && mcpModelGet.result.model.name === 'McpModel', 'mcp get model')
  const mcpModelUpdate = await bridgeCall(port, 'smoke-token-123', 'update_data_model', {
    project_id: pid,
    model_id: mcpModelId,
    alias: 'MCP'
  })
  assert(mcpModelUpdate.ok && mcpModelUpdate.result.model.alias === 'MCP', 'mcp update model')
  const mcpModelNoConfirm = await bridgeCall(port, 'smoke-token-123', 'delete_data_model', {
    project_id: pid,
    model_id: mcpModelId
  })
  assert(mcpModelNoConfirm.ok === false, 'mcp delete model requires confirm')
  const mcpModelDeleted = await bridgeCall(port, 'smoke-token-123', 'delete_data_model', {
    project_id: pid,
    model_id: mcpModelId,
    confirm: true
  })
  assert(mcpModelDeleted.ok && mcpModelDeleted.result.deleted, 'mcp delete model')
  const mcpDictDeleted = await bridgeCall(port, 'smoke-token-123', 'delete_dictionary_entry', {
    project_id: pid,
    id: mcpDictId,
    confirm: true
  })
  assert(mcpDictDeleted.ok, 'mcp delete dictionary')

  const mcpDb = await bridgeCall(port, 'smoke-token-123', 'create_db_connection', {
    project_id: pid,
    name: 'mcp mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'mcp',
    password: 'mcp-secret',
    database: 'mcp_db'
  })
  assert(mcpDb.ok && mcpDb.result.connection.db_id, 'mcp create db connection')
  assert(!JSON.stringify(mcpDb.result).includes('mcp-secret'), 'mcp create db redacted')
  const mcpDbId = mcpDb.result.connection.db_id as string
  const mcpDbUpdate = await bridgeCall(port, 'smoke-token-123', 'update_db_connection', {
    project_id: pid,
    db_id: mcpDbId,
    name: 'mcp mysql 2'
  })
  assert(mcpDbUpdate.ok && mcpDbUpdate.result.connection.name === 'mcp mysql 2', 'mcp update db')
  assert(!JSON.stringify(mcpDbUpdate.result).includes('mcp-secret'), 'mcp update db redacted')
  const mcpDbList = await bridgeCall(port, 'smoke-token-123', 'list_db_connections', {
    project_id: pid
  })
  assert(mcpDbList.ok, 'mcp list db')
  assert(!JSON.stringify(mcpDbList.result).includes('mcp-secret'), 'mcp list db redacted')
  const mcpDbNoConfirm = await bridgeCall(port, 'smoke-token-123', 'delete_db_connection', {
    project_id: pid,
    db_id: mcpDbId
  })
  assert(mcpDbNoConfirm.ok === false, 'mcp delete db requires confirm')
  const mcpDbDeleted = await bridgeCall(port, 'smoke-token-123', 'delete_db_connection', {
    project_id: pid,
    db_id: mcpDbId,
    confirm: true
  })
  assert(mcpDbDeleted.ok, 'mcp delete db')

  const mcpSsh = await bridgeCall(port, 'smoke-token-123', 'create_db_connection', {
    project_id: pid,
    name: 'mcp ssh',
    host: '127.0.0.1',
    user: 'root',
    database: 'x',
    ssh: { enable: 1, host: '127.0.0.1', port: 22, username: 'root' }
  })
  assert(mcpSsh.ok, 'mcp create ssh db')
  const mcpSshTest = await bridgeCall(port, 'smoke-token-123', 'test_db_connection', {
    project_id: pid,
    db_id: mcpSsh.result.connection.db_id
  })
  assert(
    mcpSshTest.ok === false && String(mcpSshTest.error).includes('SSH 隧道后续支持'),
    'mcp ssh test not supported'
  )
  const mcpSshDeleted = await bridgeCall(port, 'smoke-token-123', 'delete_db_connection', {
    project_id: pid,
    db_id: mcpSsh.result.connection.db_id,
    confirm: true
  })
  assert(mcpSshDeleted.ok, 'mcp delete ssh db')

  // Real MySQL integration (opt-in via env, set up by scripts/mysql-smoke.cjs)
  const mysqlHost = process.env.OPENPOST_SMOKE_MYSQL_HOST
  let mysqlSummary: Record<string, unknown> | null = null
  if (mysqlHost) {
    const mysqlConfig = {
      host: mysqlHost,
      port: Number(process.env.OPENPOST_SMOKE_MYSQL_PORT ?? 3307),
      user: process.env.OPENPOST_SMOKE_MYSQL_USER ?? 'root',
      password: process.env.OPENPOST_SMOKE_MYSQL_PASSWORD ?? '',
      database: process.env.OPENPOST_SMOKE_MYSQL_DATABASE ?? 'openpost_dict_test'
    }
    const mysqlTest = await testDbConnection(mysqlConfig, undefined)
    assert(mysqlTest.ok, `mysql test connection: ${mysqlTest.message}`)
    const mysqlConn = createDbConnection(pid)
    mysqlConn.name = 'real mysql'
    mysqlConn.config.default = mysqlConfig
    const mysqlSaved = saveDbConnection(pid, mysqlConn)
    const mysqlTables = await listDbTables(mysqlConfig, undefined)
    assert(mysqlTables.some((table) => table.name === 'smoke_types'), 'mysql tables read')
    const imported = await importDbTables(pid, mysqlSaved.db_id, {
      tables: ['smoke_types'],
      target_parent_id: '0',
      conflict: 'update'
    })
    assert(imported.created + imported.updated === 1, 'mysql import')
    const skippedImport = await importDbTables(pid, mysqlSaved.db_id, {
      tables: ['smoke_types'],
      target_parent_id: '0',
      conflict: 'skip'
    })
    assert(skippedImport.skipped === 1, 'mysql import skip strategy')
    const copiedImport = await importDbTables(pid, mysqlSaved.db_id, {
      tables: ['smoke_types'],
      target_parent_id: '0',
      conflict: 'copy'
    })
    assert(copiedImport.copied === 1, 'mysql import copy strategy')
    const updatedImport = await importDbTables(pid, mysqlSaved.db_id, {
      tables: ['smoke_types'],
      target_parent_id: '0',
      conflict: 'update'
    })
    assert(updatedImport.updated === 1, 'mysql import update strategy')
    const importedModel = listModels(pid).find((model) => model.name === 'smoke_types')
    assert(importedModel, 'mysql imported model visible')
    const importedDetail = getModel(pid, importedModel!.model_id)!
    const schema = importedDetail.data.schema
    const properties = schema.properties ?? {}
    assert(properties.flag?.type === 'boolean', 'mysql tinyint(1) -> boolean')
    assert(properties.amount?.type === 'number', 'mysql decimal -> number')
    assert(properties.payload?.type === 'object', 'mysql json -> object')
    assert(properties.title?.type === 'string', 'mysql varchar -> string')
    assert(
      (schema.required ?? []).includes('title') && !(schema.required ?? []).includes('note'),
      'mysql nullable -> required'
    )
    assert(properties.flag?.description === '启用标记', 'mysql column comment preserved')
    const mcpImport = await bridgeCall(port, 'smoke-token-123', 'import_db_schema', {
      project_id: pid,
      db_id: mysqlSaved.db_id,
      tables: ['smoke_types'],
      conflict: 'update'
    })
    assert(
      mcpImport.ok && mcpImport.result.updated === 1 && mcpImport.result.items.length === 1,
      'mcp import summary'
    )
    mysqlSummary = {
      server_version: mysqlTest.server_version,
      tables: mysqlTables.length,
      imported: imported.created + imported.updated,
      mcp_import: mcpImport.result.updated
    }
    deleteDbConnection(pid, mysqlSaved.db_id)
    for (const model of listModels(pid).filter((item) => item.name.startsWith('smoke_types'))) {
      deleteModel(pid, model.model_id)
    }
  }

  // Permission checks
  saveMcpConfig({
    ...getMcpConfig(),
    allow_write: false,
    allow_execute: false
  })
  await startMcpServer()
  const deniedWrite = await bridgeCall(port, 'smoke-token-123', 'create_dictionary_entry', {
    project_id: pid,
    key: 'denied',
    description: 'denied'
  })
  assert(deniedWrite.ok === false, 'mcp write denied without allow_write')
  const deniedExecute = await bridgeCall(port, 'smoke-token-123', 'test_db_connection', {
    project_id: pid,
    db_id: savedDb.db_id
  })
  assert(deniedExecute.ok === false, 'mcp execute denied without allow_execute')
  const deniedRead = await bridgeCall(port, 'smoke-token-123', 'list_data_models', {
    project_id: pid
  })
  assert(deniedRead.ok, 'mcp read allowed without write')

  const denied = await bridgeCall(port, 'wrong-token', 'list_projects', {})
  assert(denied.ok === false, 'mcp token rejected')

  const child = spawn(process.execPath, [path.join(process.cwd(), 'mcp-stdio.cjs')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPENPOST_MCP_INFO: mcpInfoPath()
    },
    stdio: ['pipe', 'pipe', 'inherit']
  })
  const pending = new Map<number, (value: any) => void>()
  let stdoutBuffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    let index = stdoutBuffer.indexOf('\n')
    while (index >= 0) {
      const line = stdoutBuffer.slice(0, index)
      stdoutBuffer = stdoutBuffer.slice(index + 1)
      index = stdoutBuffer.indexOf('\n')
      if (!line.trim()) continue
      try {
        const message = JSON.parse(line)
        const resolve = pending.get(message.id)
        if (resolve) {
          pending.delete(message.id)
          resolve(message)
        }
      } catch {
        // ignore non-JSON output
      }
    }
  })
  const rpc = (id: number, method: string, params: Record<string, unknown>): Promise<any> =>
    new Promise((resolve) => {
      pending.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  const init = await rpc(1, 'initialize', { protocolVersion: '2024-11-05' })
  assert(init.result?.serverInfo?.name === 'openPost', 'stdio initialize')
  const stdioTools = await rpc(2, 'tools/list', {})
  assert(stdioTools.result?.tools?.length === 46, 'stdio tools/list')
  const stdioCall = await rpc(3, 'tools/call', {
    name: 'list_projects',
    arguments: {}
  })
  const parsed = JSON.parse(stdioCall.result.content[0].text)
  assert(parsed.projects.length === 1, 'stdio tools/call')
  child.kill()

  await stopMcpServer()
  httpServer.close()

  process.stdout.write(
    JSON.stringify(
      {
        project_id: project.project_id,
        flow_status: run.status,
        flow_events: run.events.map((event) => `${event.name}:${event.status}`),
        variables: run.variables,
        mcp_status: status,
        mcp_tools: tools.result.tools.length,
        mcp_execute: exec.result.status,
        mcp_sync_created: sync.result.created,
        mcp_synced_api: syncedApis.result.apis[0]?.name,
        mcp_dictionary_builtin: builtinList.result.total,
        mcp_model_created: Boolean(mcpModelId),
        mcp_db_redacted: !JSON.stringify(mcpDbList.result).includes('mcp-secret'),
        mcp_permission_denied: deniedWrite.ok === false && deniedExecute.ok === false,
        mysql: mysqlSummary,
        stdio_tools: stdioTools.result.tools.length,
        stdio_call_projects: parsed.projects.length
      },
      null,
      2
    ) + '\n'
  )
  app.exit(0)
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).stack ?? error}\n`)
  app.exit(1)
})
