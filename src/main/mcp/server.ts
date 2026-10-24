import crypto from 'node:crypto'
import net from 'node:net'
import type { McpConfig, McpStatus } from '@shared/types'
import * as store from '../storage/store'
import { callTool, listToolInfos } from './tools'

const MAX_LINE_BYTES = 1024 * 1024

let server: net.Server | null = null
let currentConfig: McpConfig | null = null
let status: McpStatus = { running: false, host: '127.0.0.1', port: 0 }
const sockets = new Set<net.Socket>()

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

async function dispatch(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const tool = typeof payload.tool === 'string' ? payload.tool : ''
  const args = (payload.args ?? {}) as Record<string, unknown>
  if (tool === '__ping') return { ok: true, result: { pong: true, pid: process.pid } }
  if (!currentConfig) return { ok: false, error: 'MCP 服务未初始化' }
  if (!safeEqual(String(payload.token ?? ''), currentConfig.token)) {
    return { ok: false, error: 'token 无效' }
  }
  if (tool === '__tools') return { ok: true, result: { tools: listToolInfos() } }
  if (!tool) return { ok: false, error: '缺少 tool' }
  return callTool(tool, args, currentConfig)
}

function handleConnection(socket: net.Socket): void {
  sockets.add(socket)
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', (chunk: string) => {
    buffer += chunk
    if (buffer.length > MAX_LINE_BYTES) {
      socket.destroy()
      return
    }
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) void handleLine(line, socket)
      index = buffer.indexOf('\n')
    }
  })
  socket.on('close', () => sockets.delete(socket))
  socket.on('error', () => sockets.delete(socket))
}

async function handleLine(line: string, socket: net.Socket): Promise<void> {
  let payload: Record<string, unknown>
  let id: unknown = null
  try {
    payload = JSON.parse(line) as Record<string, unknown>
    id = payload.id ?? null
  } catch {
    socket.write(`${JSON.stringify({ id: null, ok: false, error: '无效的 JSON 请求' })}\n`)
    return
  }
  try {
    const result = await dispatch(payload)
    socket.write(`${JSON.stringify({ id, ...result })}\n`)
  } catch (error) {
    socket.write(
      `${JSON.stringify({ id, ok: false, error: (error as Error).message })}\n`
    )
  }
}

export function getMcpStatus(): McpStatus {
  return status
}

export async function stopMcpServer(): Promise<void> {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve())
      server = null
    })
  }
  status = {
    running: false,
    host: currentConfig?.host ?? '127.0.0.1',
    port: currentConfig?.port ?? store.MCP_DEFAULT_PORT
  }
}

export async function startMcpServer(): Promise<McpStatus> {
  await stopMcpServer()
  const config = store.getMcpConfig()
  currentConfig = config
  store.writeMcpInfo(config)

  if (!config.enabled) {
    status = { running: false, host: config.host, port: config.port }
    return status
  }

  return new Promise<McpStatus>((resolve) => {
    let settled = false
    const finish = (next: McpStatus): void => {
      if (settled) return
      settled = true
      status = next
      resolve(next)
    }
    const srv = net.createServer(handleConnection)
    srv.once('error', (error: NodeJS.ErrnoException) => {
      server = null
      finish({
        running: false,
        host: config.host,
        port: config.port,
        error:
          error.code === 'EADDRINUSE'
            ? `端口 ${config.port} 已被占用`
            : error.message
      })
    })
    srv.listen(config.port, config.host, () => {
      server = srv
      finish({ running: true, host: config.host, port: config.port })
    })
  })
}

export async function restartMcpServer(): Promise<McpStatus> {
  return startMcpServer()
}

export async function shutdownMcp(): Promise<void> {
  await stopMcpServer()
  store.writeMcpInfo(store.getMcpConfig())
}
