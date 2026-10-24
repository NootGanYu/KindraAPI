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
  createDocShare,
  createTargetInProject,
  deleteDocShares,
  ensureDefaultProject,
  getDocServiceConfig,
  saveDocServiceConfig,
  saveEnvironment,
  saveFlow,
  saveMcpConfig,
  saveSettings,
  saveTarget,
  getMcpConfig,
  getSettings,
  mcpInfoPath
} from '../src/main/storage/store'
import {
  createDocSettings,
  createEnvironment,
  createFlow,
  createFlowEvent,
  createParam
} from '../src/shared/factories'
import { runFlow } from '../src/main/flow/engine'
import { startMcpServer, stopMcpServer } from '../src/main/mcp/server'
import { startDocServer, stopDocServer } from '../src/main/docs/server'

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
  assert(tools.ok && tools.result.tools.length === 31, 'mcp tool list')

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
  assert(stdioTools.result?.tools?.length === 31, 'stdio tools/list')
  const stdioCall = await rpc(3, 'tools/call', {
    name: 'list_projects',
    arguments: {}
  })
  const parsed = JSON.parse(stdioCall.result.content[0].text)
  assert(parsed.projects.length === 1, 'stdio tools/call')
  child.kill()

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
  assert(cookie.startsWith('openpost_doc_token='), 'doc auth cookie')
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
        stdio_tools: stdioTools.result.tools.length,
        stdio_call_projects: parsed.projects.length,
        doc_status: docStatus,
        doc_markdown_bytes: mdText.length,
        doc_openapi_paths: Object.keys(spec.paths ?? {}).length
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
