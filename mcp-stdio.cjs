#!/usr/bin/env node
/*
 * KindraAPI MCP stdio bridge.
 *
 * An MCP client launches this file. It reads the local bridge descriptor
 * (host / port / token) written by the desktop app, forwards tool calls over
 * a loopback TCP connection, and speaks newline-delimited JSON-RPC on stdio.
 *
 * The desktop app must be running with MCP enabled.
 */
'use strict'

const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const DEFAULT_PROTOCOL = '2024-11-05'

function infoCandidates() {
  if (process.platform === 'darwin') {
    const base = path.join(os.homedir(), 'Library', 'Application Support')
    return [path.join(base, 'KindraAPI', 'mcp_info.json'), path.join(base, 'api-workbench', 'mcp_info.json')]
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || ''
    return [path.join(base, 'KindraAPI', 'mcp_info.json'), path.join(base, 'api-workbench', 'mcp_info.json')]
  }
  const base = path.join(os.homedir(), '.config')
  return [path.join(base, 'KindraAPI', 'mcp_info.json'), path.join(base, 'api-workbench', 'mcp_info.json')]
}

function defaultInfoPath() {
  const candidates = infoCandidates()
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

function infoPath() {
  return (
    process.env.KINDRAAPI_MCP_INFO ||
    process.env.API_WORKBENCH_MCP_INFO ||
    defaultInfoPath()
  )
}

function loadInfo() {
  const host = process.env.KINDRAAPI_MCP_HOST || process.env.API_WORKBENCH_MCP_HOST
  const port = Number(process.env.KINDRAAPI_MCP_PORT || process.env.API_WORKBENCH_MCP_PORT)
  const token = process.env.KINDRAAPI_MCP_TOKEN || process.env.API_WORKBENCH_MCP_TOKEN
  if (host && port && token) return { host, port, token }
  const file = infoPath()
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { host: raw.host || '127.0.0.1', port: Number(raw.port), token: raw.token || '' }
  } catch (error) {
    throw new Error(
      `无法读取 MCP 描述文件 ${file}。请先启动 KindraAPI 并在「配置 → MCP」中开启服务。`
    )
  }
}

function callBridge(tool, args) {
  let info
  try {
    info = loadInfo()
  } catch (error) {
    return Promise.reject(error)
  }
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: info.host, port: info.port })
    let settled = false
    let buffer = ''
    const finish = (error, value) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    socket.setEncoding('utf8')
    socket.setTimeout(30000)
    socket.on('connect', () => {
      socket.write(
        JSON.stringify({ id: 1, tool, args: args || {}, token: info.token }) + '\n'
      )
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const index = buffer.indexOf('\n')
      if (index < 0) return
      const line = buffer.slice(0, index)
      try {
        finish(null, JSON.parse(line))
      } catch (error) {
        finish(new Error('MCP 桥返回了无效 JSON'))
      }
    })
    socket.on('timeout', () => finish(new Error('连接 KindraAPI 超时')))
    socket.on('error', (error) =>
      finish(
        new Error(
          `无法连接 KindraAPI（${info.host}:${info.port}）：${error.message}。请确认应用正在运行且 MCP 已开启。`
        )
      )
    )
  })
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function reply(id, result) {
  write({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(message) {
  const id = message.id
  const method = message.method
  const params = message.params || {}

  if (message.id === undefined) {
    // Notification (e.g. notifications/initialized): no response.
    return
  }

  if (method === 'initialize') {
    reply(id, {
      protocolVersion: params.protocolVersion || DEFAULT_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'KindraAPI', version: '1.0.0' },
      instructions:
        'KindraAPI 本地 MCP。写操作与执行操作需要在桌面端「配置 → MCP」中显式开启。\n\n' +
        '文档要求（所有 Agent 必须遵守）：\n' +
        '1. 创建或更新接口时，必须填写接口说明 description，并为每个已知的请求参数、请求体字段和响应字段填写业务含义 description；优先使用 upsert_api 一次提交完整文档。\n' +
        '2. 创建目录时必须填写目录说明 description；补充已有目录或接口说明时，可使用 move_target 的 description。\n' +
        '3. 字段应尽量明确 type、required、nullable、enum 及 enum_descriptions。不要根据字段名或示例值猜测业务含义；无法确定时保留未知并向用户说明待补充。\n' +
        '4. 写入后检查返回的 documentation.complete 与 documentation.issues，补齐能从现有信息确定的项；仍有未知项时在最终回复中逐项列出。\n' +
        '5. 创建或更新数据模型时，同样填写模型说明与每个 schema 字段的 description。'
    })
    return
  }

  if (method === 'ping') {
    reply(id, {})
    return
  }

  if (method === 'tools/list') {
    try {
      const result = await callBridge('__tools', {})
      if (!result.ok) throw new Error(result.error || '无法获取工具列表')
      const tools = (result.result.tools || []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema || { type: 'object', properties: {} }
      }))
      reply(id, { tools })
    } catch (error) {
      replyError(id, -32603, error.message)
    }
    return
  }

  if (method === 'tools/call') {
    const name = params.name
    if (!name) {
      replyError(id, -32602, 'tools/call 缺少 name')
      return
    }
    try {
      const result = await callBridge(name, params.arguments || {})
      if (!result.ok) {
        reply(id, {
          content: [{ type: 'text', text: result.error || '工具调用失败' }],
          isError: true
        })
        return
      }
      reply(id, {
        content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }],
        isError: false
      })
    } catch (error) {
      reply(id, {
        content: [{ type: 'text', text: error.message }],
        isError: true
      })
    }
    return
  }

  if (method === 'shutdown') {
    reply(id, {})
    setTimeout(() => process.exit(0), 10)
    return
  }

  replyError(id, -32601, `不支持的方法：${method}`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    index = buffer.indexOf('\n')
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      replyError(null, -32700, '无效的 JSON')
      continue
    }
    void handle(message).catch((error) => {
      if (message && message.id !== undefined) replyError(message.id, -32603, error.message)
    })
  }
})

process.stdin.on('end', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
