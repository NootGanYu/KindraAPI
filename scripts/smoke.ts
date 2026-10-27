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
  copyModel,
  createDocShare,
  createModelInProject,
  createProjectWithDefaults,
  createTargetInProject,
  deleteDbConnection,
  deleteDictionaryEntry,
  deleteDocShares,
  deleteModel,
  ensureDefaultProject,
  findModelReferences,
  getDocServiceConfig,
  getMcpConfig,
  getModel,
  getPaths,
  getSettings,
  listDbConnections,
  listDictionaryEntries,
  listDictionarySuggestions,
  listModels,
  mcpInfoPath,
  moveModel,
  redactDbConnection,
  saveDbConnection,
  saveDictionaryEntry,
  saveDictionarySettings,
  saveDocServiceConfig,
  saveEnvironment,
  saveFlow,
  saveMcpConfig,
  saveModel,
  saveSettings,
  saveTarget
} from '../src/main/storage/store'
import {
  createDbConnection,
  createDocSettings,
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
import { startDocServer, stopDocServer } from '../src/main/docs/server'
import * as mqttStore from '../src/main/mqtt/store'
import * as mqttSessions from '../src/main/mqtt/sessionManager'
import {
  buildAttemptExport,
  buildMessageExport,
  buildProfileExport
} from '../src/main/mqtt/export'
import {
  createDefaultMqttProfile,
  isValidTopicFilter,
  mqttReasonText
} from '../src/shared/mqtt'

// aedes 是纯 JS devDependency，通过外部依赖在运行时加载。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createAedes = require('aedes') as () => any

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kindraapi-smoke-'))
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
    schema: { type: 'object', properties: { b: { $ref: `kindraapi://model/${cycleB.model_id}` } } }
  }
  cycleB.data = {
    description: '',
    schema: { type: 'object', properties: { a: { $ref: `kindraapi://model/${cycleA.model_id}` } } }
  }
  saveModel(pid, cycleA)
  saveModel(pid, cycleB)
  const cycle = generateModelExample(pid, cycleA.model_id)
  assert(cycle.warnings.some((warning) => warning.code === 'cycle'), 'cycle warning')

  const missing = generateFromSchema(pid, {
    type: 'object',
    properties: {
      ok: { type: 'string' },
      lost: { $ref: 'kindraapi://model/not-exists' }
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
  assert(tools.ok && tools.result.tools.length === 58, 'mcp tool list')

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
  const mysqlHost = process.env.KINDRAAPI_SMOKE_MYSQL_HOST
  let mysqlSummary: Record<string, unknown> | null = null
  if (mysqlHost) {
    const mysqlConfig = {
      host: mysqlHost,
      port: Number(process.env.KINDRAAPI_SMOKE_MYSQL_PORT ?? 3307),
      user: process.env.KINDRAAPI_SMOKE_MYSQL_USER ?? 'root',
      password: process.env.KINDRAAPI_SMOKE_MYSQL_PASSWORD ?? '',
      database: process.env.KINDRAAPI_SMOKE_MYSQL_DATABASE ?? 'kindraapi_dict_test'
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
      KINDRAAPI_MCP_INFO: mcpInfoPath()
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
  assert(init.result?.serverInfo?.name === 'KindraAPI', 'stdio initialize')
  const stdioTools = await rpc(2, 'tools/list', {})
  assert(stdioTools.result?.tools?.length === 58, 'stdio tools/list')
  const stdioCall = await rpc(3, 'tools/call', {
    name: 'list_projects',
    arguments: {}
  })
  const parsed = JSON.parse(stdioCall.result.content[0].text)
  assert(parsed.projects.length === 1, 'stdio tools/call')
  child.kill()

  // MQTT · 独立模块
  const mqttSummary = await runMqttSmoke(pid, port, 'smoke-token-123')

  // Docs · local share service
  const docPort = await new Promise<number>((resolve) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as net.AddressInfo).port
      probe.close(() => resolve(port))
    })
  })
  saveDocServiceConfig({ enabled: true, port: docPort })
  const docStatus = await startDocServer()
  assert(docStatus.running, 'doc server running')
  assert(docStatus.port === docPort, 'doc server port')
  const docBase = `http://127.0.0.1:${docPort}`

  const publicShare = createDocShare(project.project_id, {
    name: 'smoke 文档',
    scope: 'project',
    target_ids: [],
    settings: createDocSettings({ openapi: true, show_scripts: true })
  })
  const docPage = await fetch(`${docBase}/share/${publicShare.share_id}`)
  assert(docPage.status === 200, 'doc page 200')
  const docHtml = await docPage.text()
  assert(docHtml.includes('smoke 文档'), 'doc page contains name')
  assert(docHtml.includes('查询订单'), 'doc page contains api')

  const md = await fetch(`${docBase}/share/${publicShare.share_id}/download?format=md`)
  assert(md.status === 200, 'doc markdown 200')
  const mdText = await md.text()
  assert(mdText.includes('# smoke 文档') && mdText.includes('查询订单'), 'doc markdown content')

  const openapiResponse = await fetch(
    `${docBase}/share/${publicShare.share_id}/download?format=openapi`
  )
  assert(openapiResponse.status === 200, 'doc openapi 200')
  const spec = (await openapiResponse.json()) as { openapi?: string; paths?: Record<string, unknown> }
  assert(spec.openapi === '3.0.3' && Boolean(spec.paths?.['/orders']), 'doc openapi content')

  const passwordShare = createDocShare(project.project_id, {
    name: '密码文档',
    scope: 'api',
    target_ids: [orders.target_id],
    settings: createDocSettings({ password: 'secret' })
  })
  const locked = await fetch(`${docBase}/share/${passwordShare.share_id}`)
  assert(locked.status === 401, 'doc password required')
  const wrong = await fetch(`${docBase}/share/${passwordShare.share_id}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=wrong',
    redirect: 'manual'
  })
  assert(wrong.status === 302, 'doc wrong password redirect')
  const right = await fetch(`${docBase}/share/${passwordShare.share_id}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=secret',
    redirect: 'manual'
  })
  assert(right.status === 302, 'doc auth redirect')
  const cookie = (right.headers.get('set-cookie') ?? '').split(';')[0]
  assert(cookie.startsWith('kindraapi_doc_token='), 'doc auth cookie')
  const unlocked = await fetch(`${docBase}/share/${passwordShare.share_id}`, {
    headers: { cookie }
  })
  assert(unlocked.status === 200, 'doc password accepted')

  deleteDocShares(project.project_id, [publicShare.share_id, passwordShare.share_id])
  saveDocServiceConfig(getDocServiceConfig())
  await stopDocServer()
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
        stdio_call_projects: parsed.projects.length,
        doc_status: docStatus,
        doc_markdown_bytes: mdText.length,
        doc_openapi_paths: Object.keys(spec.paths ?? {}).length,
        mqtt: mqttSummary
      },
      null,
      2
    ) + '\n'
  )
  app.exit(0)
}

function mqttMark(label: string): void {
  process.stderr.write(`[mqtt-smoke] ${label}\n`)
}

async function waitUntil<T>(
  probe: () => T | undefined | null | false,
  timeoutMs: number,
  label: string
): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = probe()
    if (value) return value as T
    if (Date.now() - started > timeoutMs) throw new Error(`等待超时：${label}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function startMqttBroker(port = 0): Promise<{
  broker: any
  server: net.Server
  port: number
}> {
  const broker = createAedes()
  broker.authenticate = (
    _client: unknown,
    username: string,
    password: Buffer,
    done: (error: Error | null, success?: boolean) => void
  ): void => {
    if (username === 'tester' && password?.toString() === 'secret') {
      done(null, true)
      return
    }
    const error = Object.assign(new Error('bad username or password'), { returnCode: 4 })
    done(error, false)
  }
  broker.authorizePublish = (
    _client: unknown,
    packet: { topic: string },
    done: (error?: Error | null) => void
  ): void => {
    if (packet.topic.startsWith('denied/')) {
      done(Object.assign(new Error('not authorized'), { returnCode: 5 }))
      return
    }
    done(null)
  }
  broker.authorizeSubscribe = (
    _client: unknown,
    subscription: { topic: string },
    done: (error: Error | null, granted?: unknown) => void
  ): void => {
    if (subscription.topic.startsWith('denied/')) {
      done(Object.assign(new Error('not authorized'), { returnCode: 5 }), null)
      return
    }
    done(null, subscription)
  }
  const server = net.createServer(broker.handle)
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
  return {
    broker,
    server,
    port: (server.address() as net.AddressInfo).port
  }
}

function closeMqttBroker(handle: { broker: any; server: net.Server }): Promise<void> {
  return new Promise<void>((resolve) => {
    // 先断开会话，让 net.Server 的 close 回调不被既有连接阻塞。
    handle.broker.close(() => handle.server.close(() => resolve()))
  })
}

async function runMqttSmoke(
  pid: string,
  mcpPort: number,
  token: string
): Promise<Record<string, unknown>> {
  let brokerHandle = await startMqttBroker()
  const mqttPort = brokerHandle.port
  const summary: Record<string, unknown> = { port: mqttPort }

  // --- Connection Profile 存储 / 版本 / 克隆 / 导出 ---
  const profile = createDefaultMqttProfile(pid, {
    name: 'smoke-mqtt',
    host: '127.0.0.1',
    port: mqttPort,
    username: 'tester',
    password: 'secret',
    // aedes 0.51 不支持 MQTT 5；v5 的协议拒绝另做负向用例。
    protocol_version: 4,
    subscriptions: [{ filter: 'smoke/in', qos: 1 }]
  })
  const saved = mqttStore.createProfile(pid, profile)
  assert(mqttStore.listProfiles(pid).length === 1, 'mqtt profile create/list')
  assert(mqttStore.listProfiles('missing_project_id').length === 0, 'mqtt profile missing project empty')
  assert(mqttStore.listProfileVersions(pid, saved.connection_id).length === 1, 'mqtt auto version')
  const edited = mqttStore.saveProfile(pid, { ...saved, name: 'smoke-mqtt-edited' })
  assert(mqttStore.listProfileVersions(pid, saved.connection_id).length === 2, 'mqtt second version')
  const firstVersion = mqttStore
    .listProfileVersions(pid, saved.connection_id)
    .find((version) => version.name === 'smoke-mqtt')!
  const restored = mqttStore.restoreProfileVersion(pid, saved.connection_id, firstVersion.version_id)
  assert(restored.name === 'smoke-mqtt', 'mqtt version restore')
  assert(mqttStore.listProfileVersions(pid, saved.connection_id).length === 3, 'mqtt restore adds version')
  const cloned = mqttStore.cloneProfile(pid, saved.connection_id)
  assert(
    cloned.connection_id !== saved.connection_id && cloned.subscriptions.length === 1,
    'mqtt clone'
  )
  mqttStore.deleteProfile(pid, cloned.connection_id)
  assert(mqttStore.listProfiles(pid).length === 1, 'mqtt clone delete')
  // 版本上限：连续保存只保留最近 20 个。
  const versionProbe = mqttStore.createProfile(
    pid,
    createDefaultMqttProfile(pid, { name: 'version-probe' })
  )
  for (let index = 0; index < 24; index += 1) {
    mqttStore.saveProfile(pid, { ...versionProbe, name: `version-probe-${index}` })
  }
  assert(
    mqttStore.listProfileVersions(pid, versionProbe.connection_id).length === 20,
    'mqtt version limit'
  )
  mqttStore.deleteProfile(pid, versionProbe.connection_id)

  const profileExport = buildProfileExport(pid, { connection_ids: [saved.connection_id] })
  assert(profileExport.content.includes('"password": "secret"'), 'mqtt export credentials')
  assert(profileExport.content.includes('contains_plaintext_credentials'), 'mqtt export warning')
  const caFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mqtt-ca-')), 'ca.pem')
  fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nSMOKE\n-----END CERTIFICATE-----\n')
  mqttStore.saveProfile(pid, {
    ...restored,
    tls: { reject_unauthorized: true, ca_path: caFile }
  })
  const embedded = buildProfileExport(pid, {
    connection_ids: [saved.connection_id],
    embed_pem: true
  })
  assert(embedded.content.includes('SMOKE'), 'mqtt export embedded pem')
  mqttStore.saveProfile(pid, { ...restored, tls: { reject_unauthorized: true } })

  mqttMark('storage done')
  // --- 测试连接 / 错误分类 ---
  const working = mqttStore.getProfile(pid, saved.connection_id)!
  const okAttempt = await mqttSessions.testConnection(pid, working, { round_trip: true })
  assert(okAttempt.success, `mqtt test success: ${JSON.stringify(okAttempt)}`)
  assert(
    (okAttempt.connack?.return_code ?? okAttempt.connack?.reason_code) === 0,
    `mqtt connack reason: ${JSON.stringify(okAttempt.connack)}`
  )
  const v5Attempt = await mqttSessions.testConnection(pid, {
    ...working,
    protocol_version: 5
  })
  assert(
    !v5Attempt.success && v5Attempt.error?.category === 'protocol',
    `mqtt v5 protocol rejection: ${JSON.stringify(v5Attempt.error)}`
  )
  assert(okAttempt.round_trip?.success === true, 'mqtt round trip success')
  const badAuth = await mqttSessions.testConnection(pid, { ...working, password: 'wrong' })
  assert(!badAuth.success && badAuth.error?.category === 'auth', 'mqtt auth classification')
  const badDns = await mqttSessions.testConnection(pid, {
    ...working,
    host: 'kindraapi-does-not-exist.invalid',
    connect_timeout_ms: 1500
  })
  assert(!badDns.success, 'mqtt dns attempt failed')
  assert(
    ['dns', 'timeout'].includes(badDns.error?.category ?? ''),
    `mqtt dns/timeout classification: ${JSON.stringify(badDns.error)}`
  )
  assert(
    mqttSessions.classifyError(
      Object.assign(new Error('getaddrinfo ENOTFOUND host'), { code: 'ENOTFOUND' }),
      5
    ).category === 'dns',
    'mqtt dns classification'
  )

  const refusedPort = await new Promise<number>((resolve) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as net.AddressInfo).port
      probe.close(() => resolve(port))
    })
  })
  const refused = await mqttSessions.testConnection(pid, {
    ...working,
    port: refusedPort,
    connect_timeout_ms: 1500
  })
  assert(!refused.success && refused.error?.category === 'tcp', 'mqtt tcp classification')

  const blackhole = net.createServer(() => undefined)
  await new Promise<void>((resolve) => blackhole.listen(0, '127.0.0.1', () => resolve()))
  const blackholePort = (blackhole.address() as net.AddressInfo).port
  const timedOut = await mqttSessions.testConnection(pid, {
    ...working,
    port: blackholePort,
    connect_timeout_ms: 600
  })
  blackhole.close()
  assert(!timedOut.success && timedOut.error?.category === 'timeout', 'mqtt timeout classification')

  mqttMark('test connections done')
  // --- 会话 / 自动重订阅 / 冲突 ---
  const connected = await mqttSessions.connectSession(pid, saved.connection_id, 'ui')
  assert(connected.state === 'connected', 'mqtt connect')
  const liveAfterConnect = await waitUntil(
    () =>
      mqttSessions
        .listSessions(pid)
        .find(
          (session) =>
            session.connection_id === saved.connection_id &&
            session.subscriptions.some(
              (sub) => sub.filter === 'smoke/in' && sub.state === 'subscribed'
            )
        ),
    5000,
    'mqtt auto subscribe'
  )
  assert(Boolean(liveAfterConnect), 'mqtt auto subscribe')
  let conflict = ''
  try {
    mqttSessions.startSession(pid, saved.connection_id, 'mcp')
  } catch (error) {
    conflict = (error as Error).message
  }
  assert(conflict.includes('已存在会话'), 'mqtt profile conflict')

  const pub = await mqttSessions.publish(pid, saved.connection_id, {
    topic: 'smoke/in',
    payload: 'hello mqtt',
    payload_view: 'plain',
    qos: 1,
    retain: false
  })
  assert(pub.ok, 'mqtt publish qos1')
  await waitUntil(
    () =>
      mqttStore
        .listMessages(pid, saved.connection_id, { limit: 100 })
        .some((message) => message.direction === 'in' && message.topic === 'smoke/in'),
    5000,
    'mqtt inbound message'
  )

  const subscribed = await mqttSessions.subscribe(pid, saved.connection_id, [
    { filter: 'smoke/bin', qos: 0 },
    { filter: 'smoke/big', qos: 0 },
    { filter: 'smoke/manual', qos: 2 }
  ])
  assert(
    subscribed.every((result) => result.ok) &&
      subscribed.find((result) => result.filter === 'smoke/manual')?.granted_qos === 2,
    'mqtt subscribe qos'
  )
  mqttMark('basic publish/subscribe done')
  const deniedSub = await mqttSessions.subscribe(pid, saved.connection_id, [
    { filter: 'denied/topic', qos: 1 }
  ])
  assert(deniedSub[0].ok === false, 'mqtt acl subscribe denied')
  const waitConnected = (): Promise<unknown> =>
    waitUntil(
      () =>
        mqttSessions
          .listSessions(pid)
          .some(
            (session) =>
              session.connection_id === saved.connection_id &&
              session.state === 'connected'
          ),
      10000,
      'mqtt connected again'
    )
  await waitConnected()
  let deniedPub: { ok: boolean; error?: string } = { ok: true }
  try {
    deniedPub = await mqttSessions.publish(pid, saved.connection_id, {
      topic: 'denied/publish',
      payload: 'x',
      payload_view: 'plain',
      qos: 1,
      retain: false
    })
  } catch (error) {
    deniedPub = { ok: false, error: (error as Error).message }
  }
  assert(deniedPub.ok === false, 'mqtt acl publish denied')
  assert(
    mqttSessions.classifyError(
      Object.assign(new Error('Not authorized'), { code: 0x87 }),
      5,
      undefined,
      'publish'
    ).category === 'acl',
    'mqtt acl classification'
  )
  await waitConnected()
  try {
    await mqttSessions.unsubscribe(pid, saved.connection_id, ['smoke/manual'])
  } catch {
    // ACL 拒绝可能触发 broker 断开，取消订阅失败不阻塞后续用例。
  }

  mqttMark('acl checks done')
  // 等会话从可能的 ACL 断线中恢复
  await waitUntil(
    () =>
      mqttSessions
        .listSessions(pid)
        .some(
          (session) =>
            session.connection_id === saved.connection_id && session.state === 'connected'
        ),
    10000,
    'mqtt acl recovery'
  )

  // 二进制与超大 payload
  brokerHandle.broker.publish(
    {
      cmd: 'publish',
      topic: 'smoke/bin',
      payload: Buffer.from([0xff, 0x00, 0xfe]),
      qos: 0,
      retain: false
    },
    () => undefined
  )
  const binary = await waitUntil(
    () =>
      mqttStore
        .listMessages(pid, saved.connection_id, { limit: 100 })
        .find((message) => message.topic === 'smoke/bin'),
    5000,
    'mqtt binary message'
  )
  assert(binary.payload_encoding === 'base64', 'mqtt binary base64')
  const binaryRecord = mqttStore.getMessage(pid, saved.connection_id, binary.seq)!
  assert(Buffer.from(binaryRecord.payload, 'base64').length === 3, 'mqtt binary bytes')

  brokerHandle.broker.publish(
    {
      cmd: 'publish',
      topic: 'smoke/big',
      payload: Buffer.alloc(1024 * 1024 + 16, 1),
      qos: 0,
      retain: false
    },
    () => undefined
  )
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert(
    !mqttStore
      .listMessages(pid, saved.connection_id, { limit: 500 })
      .some((message) => message.topic === 'smoke/big'),
    'mqtt 1mb rejected'
  )
  const replayEvents = mqttSessions.replay(saved.connection_id, 0)
  assert(
    replayEvents.some(
      (event) =>
        event.type === 'error' && (event.payload as { truncated?: boolean }).truncated
    ),
    'mqtt 1mb error event'
  )
  assert(
    replayEvents.every((event, index) => index === 0 || event.seq > replayEvents[index - 1].seq),
    'mqtt event seq monotonic'
  )
  assert(
    mqttSessions.replay(saved.connection_id, replayEvents[replayEvents.length - 1].seq).length ===
      0,
    'mqtt replay after seq'
  )

  mqttMark('binary/oversize done')
  // 分片轮转与保留策略（直接写存储，避免刷屏 broker）
  const rotationId = 'mcrotationsmoke'
  for (let index = 1; index <= 2005; index += 1) {
    mqttStore.appendMessage(
      pid,
      {
        seq: index,
        connection_id: rotationId,
        session_id: 'msrotationsmoke',
        direction: 'in',
        topic: 'rotation/topic',
        payload_encoding: 'utf8',
        payload: 'x',
        payload_bytes: 1,
        qos: 0,
        retain: false,
        received_at: new Date().toISOString()
      },
      { max_messages: 100000, max_bytes: 100 * 1024 * 1024 }
    )
  }
  const rotatedStats = mqttStore.messageStats(pid, rotationId)
  assert(rotatedStats.shards >= 2, 'mqtt shard rotation')
  for (let index = 2006; index <= 2010; index += 1) {
    mqttStore.appendMessage(
      pid,
      {
        seq: index,
        connection_id: rotationId,
        session_id: 'msrotationsmoke',
        direction: 'in',
        topic: 'rotation/topic',
        payload_encoding: 'utf8',
        payload: 'x',
        payload_bytes: 1,
        qos: 0,
        retain: false,
        received_at: new Date().toISOString()
      },
      { max_messages: 500, max_bytes: 100 * 1024 * 1024 }
    )
  }
  assert(
    mqttStore.messageStats(pid, rotationId).count <= 500,
    'mqtt retention max messages'
  )
  mqttStore.clearMessages(pid, rotationId)

  mqttMark('rotation done')
  // 发布历史与循环发布
  const loopState = mqttSessions.startLoop(
    pid,
    saved.connection_id,
    {
      topic: 'smoke/in',
      payload: 'loop',
      payload_view: 'plain',
      qos: 0,
      retain: false
    },
    { interval_ms: 100, count: 3 }
  )
  assert(loopState.running, 'mqtt loop start')
  await waitUntil(
    () => mqttSessions.getLoopState(pid, saved.connection_id).sent >= 3,
    4000,
    'mqtt loop count'
  )
  await waitUntil(
    () => !mqttSessions.getLoopState(pid, saved.connection_id).running,
    2000,
    'mqtt loop auto stop'
  )
  let loopError = ''
  try {
    mqttSessions.startLoop(
      pid,
      saved.connection_id,
      { topic: 'smoke/in', payload: 'x', payload_view: 'plain', qos: 0, retain: false },
      { interval_ms: 50, count: 1 }
    )
  } catch (error) {
    loopError = (error as Error).message
  }
  assert(loopError.includes('100ms'), 'mqtt loop interval guard')

  // Attempt 持久化 / 导出 / 轮转
  const attempts = mqttStore.listAttempts(pid, saved.connection_id)
  assert(
    attempts.some((attempt) => attempt.success) &&
      attempts.some((attempt) => !attempt.success),
    'mqtt attempts'
  )
  assert(buildAttemptExport(pid, saved.connection_id).count >= 2, 'mqtt attempt export')
  const attemptsDir = path.join(
    getPaths().localRoot,
    'projects',
    pid,
    'mqtt',
    'attempts'
  )
  const activeAttemptLog = path.join(attemptsDir, `${saved.connection_id}.jsonl`)
  fs.mkdirSync(attemptsDir, { recursive: true })
  fs.writeFileSync(
    activeAttemptLog,
    Array.from({ length: 2005 }, () => JSON.stringify(attempts[0])).join('\n') + '\n'
  )
  mqttStore.appendAttempt(pid, attempts[0])
  assert(
    fs
      .readdirSync(attemptsDir)
      .filter((name) => name.startsWith(`${saved.connection_id}.`)).length >= 2,
    'mqtt attempt rotation'
  )

  // 消息导出
  const messageExport = buildMessageExport(pid, {
    connection_ids: [saved.connection_id],
    format: 'jsonl'
  })
  assert(messageExport.content.includes('smoke/in'), 'mqtt message jsonl export')
  const csvExport = buildMessageExport(pid, {
    connection_ids: [saved.connection_id],
    format: 'csv'
  })
  assert(csvExport.content.startsWith('seq,'), 'mqtt message csv export')

  mqttMark('loop/attempts done')
  // --- 断线重连与自动重订阅 ---
  await closeMqttBroker(brokerHandle)
  await waitUntil(
    () =>
      mqttSessions
        .listSessions(pid)
        .some(
          (session) =>
            session.connection_id === saved.connection_id && session.state === 'reconnecting'
        ),
    6000,
    'mqtt reconnecting'
  )
  brokerHandle = await startMqttBroker(mqttPort)
  await waitUntil(
    () =>
      mqttSessions
        .listSessions(pid)
        .some(
          (session) =>
            session.connection_id === saved.connection_id && session.state === 'connected'
        ),
    10000,
    'mqtt reconnected'
  )
  const reconnected = mqttSessions
    .listSessions(pid)
    .find((session) => session.connection_id === saved.connection_id)!
  assert(
    reconnected.subscriptions.some(
      (sub) => sub.filter === 'smoke/in' && sub.state === 'subscribed'
    ),
    'mqtt resubscribe after reconnect'
  )

  mqttMark('reconnect done')
  // --- 并发上限 ---
  const extraIds: string[] = []
  for (let index = 0; index < 7; index += 1) {
    const extra = mqttStore.createProfile(
      pid,
      createDefaultMqttProfile(pid, {
        name: `smoke-conc-${index}`,
        host: '127.0.0.1',
        port: mqttPort,
        username: 'tester',
        password: 'secret',
        protocol_version: 4
      })
    )
    extraIds.push(extra.connection_id)
    await mqttSessions.connectSession(pid, extra.connection_id, 'ui')
  }
  const ninth = mqttStore.createProfile(
    pid,
    createDefaultMqttProfile(pid, {
      name: 'smoke-conc-9',
      host: '127.0.0.1',
      port: mqttPort,
      username: 'tester',
      password: 'secret',
      protocol_version: 4
    })
  )
  let limitError = ''
  try {
    await mqttSessions.connectSession(pid, ninth.connection_id, 'ui')
  } catch (error) {
    limitError = (error as Error).message
  }
  assert(limitError.includes('最多连接 8'), 'mqtt concurrency limit')
  mqttSessions.disconnectAll(pid)
  assert(mqttSessions.listSessions(pid).length === 0, 'mqtt disconnectAll')
  for (const connectionId of [...extraIds, ninth.connection_id]) {
    mqttStore.deleteProfile(pid, connectionId)
  }

  mqttMark('concurrency done')
  // --- MCP 全量会话工具 ---
  saveMcpConfig({
    ...getMcpConfig(),
    enabled: true,
    allow_write: true,
    allow_execute: true,
    allowed_project_ids: [pid],
    port: mcpPort,
    token
  })
  await startMcpServer()

  const mcpCreated = await bridgeCall(mcpPort, token, 'mqtt_create_profile', {
    project_id: pid,
    name: 'mcp-created',
    host: '127.0.0.1',
    port: mqttPort,
    protocol_version: 4,
    username: 'tester',
    password: 'secret'
  })
  assert(mcpCreated.ok, `mcp mqtt create profile: ${JSON.stringify(mcpCreated)}`)
  const mcpCreatedId = mcpCreated.result.profile.connection_id as string
  const mcpUpdated = await bridgeCall(mcpPort, token, 'mqtt_update_profile', {
    project_id: pid,
    connection_id: mcpCreatedId,
    name: 'mcp-updated',
    subscriptions: [{ filter: 'smoke/mcp', qos: 1 }]
  })
  assert(
    mcpUpdated.ok && mcpUpdated.result.profile.name === 'mcp-updated',
    'mcp mqtt update profile'
  )
  const mcpTestCreated = await bridgeCall(mcpPort, token, 'mqtt_test_connection', {
    project_id: pid,
    connection_id: mcpCreatedId
  })
  assert(mcpTestCreated.ok && mcpTestCreated.result.success, 'mcp mqtt test created profile')
  const mcpDeleted = await bridgeCall(mcpPort, token, 'mqtt_delete_profile', {
    project_id: pid,
    connection_id: mcpCreatedId,
    confirm: true
  })
  assert(mcpDeleted.ok, 'mcp mqtt delete profile')
  assert(
    !mqttStore.listProfiles(pid).some((item) => item.connection_id === mcpCreatedId),
    'mcp mqtt delete verified'
  )

  const mcpProfiles = await bridgeCall(mcpPort, token, 'mqtt_list_profiles', {
    project_id: pid
  })
  assert(
    mcpProfiles.ok &&
      mcpProfiles.result.profiles.some(
        (item: { password?: string }) => item.password === 'secret'
      ),
    'mcp mqtt list profiles plaintext'
  )

  const mcpTest = await bridgeCall(mcpPort, token, 'mqtt_test_connection', {
    project_id: pid,
    connection_id: saved.connection_id
  })
  assert(mcpTest.ok && mcpTest.result.success, 'mcp mqtt test')

  const mcpConnect = await bridgeCall(mcpPort, token, 'mqtt_connect', {
    project_id: pid,
    connection_id: saved.connection_id
  })
  assert(mcpConnect.ok && mcpConnect.result.state === 'connected', 'mcp mqtt connect')
  const mcpSessionId = mcpConnect.result.session_id as string

  const mcpSubscribe = await bridgeCall(mcpPort, token, 'mqtt_subscribe', {
    project_id: pid,
    connection_id: saved.connection_id,
    filters: [{ filter: 'smoke/mcp', qos: 1 }]
  })
  assert(mcpSubscribe.ok && mcpSubscribe.result.results[0].ok, 'mcp mqtt subscribe')

  const mcpPublish = await bridgeCall(mcpPort, token, 'mqtt_publish', {
    project_id: pid,
    connection_id: saved.connection_id,
    topic: 'smoke/mcp',
    payload: 'mcp payload',
    qos: 1
  })
  assert(mcpPublish.ok && mcpPublish.result.ok, 'mcp mqtt publish')

  const drained = await bridgeCall(mcpPort, token, 'mqtt_drain_messages', {
    project_id: pid,
    session_id: mcpSessionId,
    cursor: 0,
    limit: 50
  })
  assert(
    drained.ok && drained.result.messages.length >= 1 && drained.result.nextCursor > 0,
    'mcp mqtt drain'
  )
  const drainedAgain = await bridgeCall(mcpPort, token, 'mqtt_drain_messages', {
    project_id: pid,
    session_id: mcpSessionId,
    cursor: drained.result.nextCursor
  })
  assert(
    drainedAgain.ok &&
      drainedAgain.result.messages.length === 0 &&
      drainedAgain.result.nextCursor === drained.result.nextCursor,
    'mcp mqtt drain empty'
  )

  const mcpUnsubscribe = await bridgeCall(mcpPort, token, 'mqtt_unsubscribe', {
    project_id: pid,
    connection_id: saved.connection_id,
    filters: ['smoke/mcp']
  })
  assert(mcpUnsubscribe.ok, 'mcp mqtt unsubscribe')

  const mcpSessions = await bridgeCall(mcpPort, token, 'mqtt_list_sessions', {
    project_id: pid
  })
  assert(mcpSessions.ok && mcpSessions.result.sessions.length >= 1, 'mcp mqtt list sessions')

  const mcpDisconnect = await bridgeCall(mcpPort, token, 'mqtt_disconnect', {
    project_id: pid,
    session_id: mcpSessionId
  })
  assert(mcpDisconnect.ok, 'mcp mqtt disconnect')
  const drainAfterClose = await bridgeCall(mcpPort, token, 'mqtt_drain_messages', {
    project_id: pid,
    session_id: mcpSessionId
  })
  assert(drainAfterClose.ok === false, 'mcp mqtt drain after close errors')

  saveMcpConfig({ ...getMcpConfig(), allow_write: false })
  await startMcpServer()
  const mcpWriteDenied = await bridgeCall(mcpPort, token, 'mqtt_create_profile', {
    project_id: pid,
    name: 'denied'
  })
  assert(
    mcpWriteDenied.ok === false && String(mcpWriteDenied.error).includes('allow_write'),
    'mcp mqtt allow_write'
  )

  saveMcpConfig({ ...getMcpConfig(), allow_execute: false })
  await startMcpServer()
  const mcpDenied = await bridgeCall(mcpPort, token, 'mqtt_connect', {
    project_id: pid,
    connection_id: saved.connection_id
  })
  assert(
    mcpDenied.ok === false && String(mcpDenied.error).includes('allow_execute'),
    'mcp mqtt allow_execute'
  )
  saveMcpConfig({ ...getMcpConfig(), allow_execute: true })
  await startMcpServer()

  mqttMark('mcp done')
  // --- 项目生命周期 / 级联删除 ---
  const other = createProjectWithDefaults('mqtt-other')
  assert(mqttStore.listProfiles(other.project_id).length === 0, 'mqtt project isolation')
  assert(
    mqttStore.listMessages(other.project_id, saved.connection_id, { limit: 10 }).length === 0,
    'mqtt missing local data empty'
  )
  const messagesDir = path.join(
    getPaths().localRoot,
    'projects',
    pid,
    'mqtt',
    'messages',
    saved.connection_id
  )
  mqttStore.deleteProfile(pid, saved.connection_id)
  assert(mqttStore.listProfiles(pid).length === 0, 'mqtt profile delete')
  assert(!fs.existsSync(messagesDir), 'mqtt delete cascades messages')
  assert(
    mqttStore.listProfileVersions(pid, saved.connection_id).length === 0,
    'mqtt delete cascades versions'
  )

  await closeMqttBroker(brokerHandle)

  summary.attempts = attempts.length
  summary.rotated_shards = rotatedStats.shards
  summary.export_bytes = messageExport.count
  summary.reason_text = mqttReasonText(0x87, 'connack', 5)
  summary.topic_filter_valid = isValidTopicFilter('$share/group/topic/+')
  return summary
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).stack ?? error}\n`)
  app.exit(1)
})
