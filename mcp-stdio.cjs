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

/**
 * 本机默认值全部来自 MCP 客户端配置的环境变量，安装包本身不内置任何项目信息。
 * KINDRA_DEFAULT_PROJECT_ID / KINDRA_DEFAULT_ENVIRONMENT_ID / KINDRA_DEFAULT_FOLDER_ID
 * KINDRA_DEFAULT_HOST_PATH / KINDRA_DEFAULT_BASE_PATH
 */
function bridgeDefaults() {
  return {
    projectId: process.env.KINDRA_DEFAULT_PROJECT_ID || '',
    environmentId: process.env.KINDRA_DEFAULT_ENVIRONMENT_ID || '',
    folderId: process.env.KINDRA_DEFAULT_FOLDER_ID || '',
    hostPath: process.env.KINDRA_DEFAULT_HOST_PATH || '',
    basePath: process.env.KINDRA_DEFAULT_BASE_PATH || ''
  }
}

const CORE_INSTRUCTIONS = [
  'KindraAPI 本地 MCP：接口文档协作与实测工作台。写操作、执行操作需在桌面端「配置 → MCP」显式开启；权限不足或失败时如实报告，绝不声称已写入。',
  '',
  '文档要求（服务端硬性校验）',
  '1. 新建接口必须填写接口说明 description，并为每个已知的请求参数、请求体字段和响应字段填写业务含义 description。',
  '2. 每个已知字段必须明确 type、required、nullable 和 enum（无限制时显式传 null）；有枚举时必须提供逐项对应的 enum_descriptions。缺少任一项，服务端会拒绝写入且不保存。',
  '3. 创建目录时必须填写目录说明 description；创建或更新数据模型时，同样填写模型说明与每个 schema 字段的 description。',
  '4. 不要根据字段名或示例值猜测业务含义；无法确定时先向用户确认，再写入。更新接口只校验本次显式提交的字段，未提交字段保持原样。',
  '5. 接口 URL 必须填写完整的 http:// 或 https:// 地址，包含主机名与路径；使用 {{baseUrl}}/path 时必须确保 baseUrl 会解析为完整地址。',
  '',
  '一、默认工作流（按此顺序选择工具）',
  '1. 新建接口：list_apis 确认目标目录 → upsert_api 一次提交完整文档（旧版本没有 upsert_api 时用 create_api）→ execute_api(save_response=true) → get_execution_result 核对业务结果。',
  '2. 从 OpenAPI 导入：sync_openapi 一次只导入一个 path（整份大文档会被截断导致 JSON 解析失败）→ 用 update_api/upsert_api 回填 Header、参数与请求示例 → 重新执行并保存真实响应。',
  '3. 修改已有接口：改完整文档用 upsert_api；只改说明/错误码用 update_api_design；改 Header/参数/示例用 update_api（按 key 增量合并，未提交项保留）。',
  '',
  '二、每个接口的交付硬性要求（Header、请求示例、响应示例缺一不可）',
  '1. 接口说明：写清用途、调用方式、参数业务含义、状态口径、错误码与串联关系；不要只写“查询列表”这类空话。',
  '2. Header：至少 Authorization: Bearer <token>；JSON 接口加 Content-Type: application/json 与 Accept: application/json；上传用 multipart/form-data；下载用 Accept: application/octet-stream。不能只用 Kindra 的 auth 配置代替 Header 展示；显式写 Authorization 时把 auth.type 设为 none，避免重复。',
  '3. 请求示例：Query/Path/Body/Form 每个字段都要有真实、可执行的取值，禁止留空、{} 或 "xxx" 占位；Long 类型 ID 一律用字符串（避免精度丢失）；execute_api 中的数值参数也用字符串传入。',
  '4. 响应示例：必须是 execute_api + save_response=true 实测保存的真实响应，禁止手写或沿用旧响应；响应结构变化后必须重新执行并保存。',
  '5. 接口 URL 必须是完整 http(s)://host/path，或确保 {{baseUrl}} 能解析为完整地址；不要只写 /path。',
  '',
  '三、执行与业务判定',
  '1. execute_api 返回的 status / status_code 只代表 HTTP 层完成，不代表业务成功。',
  '2. 必须用 get_execution_result(run_id) 读取响应体，确认 code（成功通常为 0，也可能为 200）、message、data。',
  '3. 负向、越权、重复操作等测试一律 save_response=false，避免覆盖成功响应示例。',
  '4. 切换 token 或账号测试后立即恢复 Header，保证响应示例与 Header 属于同一账号、同一环境。',
  '5. 本地与线上 token 不通用；返回 401 / 40001 表示 token 过期，重新登录后再测。',
  '',
  '四、常见坑（务必避免）',
  '1. sync_openapi（尤其 cover 模式）会重置 Header/Query/Body 的值和响应示例，导入后必须重新回填并执行。',
  '2. update_api 的 headers/query/paths/cookies 按 key 增量合并，未提交的项保留；删除参数用 remove: true。修改接口说明请用 update_api_design 或 upsert_api。',
  '3. 目录不存在时先用 create_folder 创建；不要凭记忆填写 folder_id / target_id，始终用 list_apis 确认。',
  '4. get_api_detail / upsert_api 返回 documentation.complete=false 时，issues 中列出的缺项必须在交付前补齐；确实无法确定的，在最终回复中逐项说明原因。',
  '5. 服务冷启动时首次执行可能超时，重试即可，不要据此判断接口逻辑错误。',
  '',
  '五、记录与安全',
  '在任务交付记录中登记 project_id、目录 folder_id、接口 target_id、run_id 与测试结论；不要把真实 token、密码、线上凭据写入代码仓库或交付文档。'
]

function buildInstructions() {
  const defaults = bridgeDefaults()
  const lines = CORE_INSTRUCTIONS.slice()
  const known = []
  if (defaults.projectId) known.push(`- project_id：${defaults.projectId}（调用工具时可省略，桥会自动补全）`)
  if (defaults.environmentId) known.push(`- environment_id：${defaults.environmentId}（执行、流程、环境与变量的读写类工具可省略；删除类工具仍须显式传入）`)
  if (defaults.folderId) known.push(`- folder_id：${defaults.folderId}（sync_openapi 导入、create_api/create_folder 新建时自动补全；upsert_api 新建请显式传 parent_id）`)
  if (defaults.hostPath) known.push(`- host_path：${defaults.hostPath}（sync_openapi 自动补全）`)
  if (defaults.basePath) known.push(`- base_path：${defaults.basePath}（sync_openapi 自动补全）`)
  if (known.length) {
    lines.push('', '本机通过 MCP 客户端环境变量配置的默认值：', ...known)
  }
  return lines.join('\n')
}

/**
 * 接受 environment_id 且允许用 KINDRA_DEFAULT_ENVIRONMENT_ID 补全的工具。
 * 删除类工具故意不在名单内：删除环境、删除环境服务、删除环境变量必须显式指定目标。
 */
const ENV_DEFAULT_TOOLS = new Set([
  'execute_api',
  'create_execution_flow',
  'update_execution_flow',
  'execute_flow',
  'switch_environment',
  'update_environment',
  'list_environment_servers',
  'create_environment_server',
  'update_environment_server',
  'get_environment_variables',
  'upsert_environment_variable'
])

/** 用环境变量补全省略的参数；不覆盖调用方显式传入的值。 */
function applyDefaults(tool, args) {
  const defaults = bridgeDefaults()
  const next = { ...(args || {}) }
  if (defaults.projectId && next.project_id === undefined) next.project_id = defaults.projectId
  if (defaults.environmentId && ENV_DEFAULT_TOOLS.has(tool) && next.environment_id === undefined) {
    next.environment_id = defaults.environmentId
  }
  if (defaults.folderId) {
    if (tool === 'sync_openapi' && next.folder_id === undefined) next.folder_id = defaults.folderId
    if (['create_api', 'create_folder'].includes(tool) && next.parent_id === undefined) {
      next.parent_id = defaults.folderId
    }
  }
  if (tool === 'sync_openapi') {
    if (defaults.hostPath && next.host_path === undefined) next.host_path = defaults.hostPath
    if (defaults.basePath && next.base_path === undefined) next.base_path = defaults.basePath
  }
  return next
}

/** 已由环境变量补全的必填项不再要求客户端传入，避免 schema 校验先于补全失败。 */
function relaxSchema(tool, inputSchema) {
  const defaults = bridgeDefaults()
  const next = JSON.parse(JSON.stringify(inputSchema || { type: 'object', properties: {} }))
  if (Array.isArray(next.required)) {
    if (defaults.projectId) next.required = next.required.filter((key) => key !== 'project_id')
    if (defaults.environmentId && ENV_DEFAULT_TOOLS.has(tool)) {
      next.required = next.required.filter((key) => key !== 'environment_id')
    }
  }
  if (!next.properties) next.properties = {}
  if (defaults.projectId && next.properties.project_id) {
    next.properties.project_id.description = `${next.properties.project_id.description || '项目 ID'}；本机已配置默认项目，可省略`
  }
  if (defaults.environmentId && ENV_DEFAULT_TOOLS.has(tool) && next.properties.environment_id) {
    next.properties.environment_id.description = `${next.properties.environment_id.description || '环境 env_id'}；本机已配置默认环境，可省略`
  }
  return next
}

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
      serverInfo: { name: 'KindraAPI', version: '1.1.0' },
      instructions: buildInstructions()
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
        inputSchema: relaxSchema(tool.name, tool.input_schema)
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
      const result = await callBridge(name, applyDefaults(name, params.arguments))
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
