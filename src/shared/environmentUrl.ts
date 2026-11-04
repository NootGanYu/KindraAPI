import type { Environment } from './types'

export interface EnvironmentUrlParts {
  /** 是否已绑定环境前置地址 */
  bound: boolean
  /** 只读展示的前置地址（已补协议、去掉末尾斜杠） */
  prefix: string
  /** 写回 URL 时使用的前缀占位符；null 表示保持相对路径 */
  prefixToken: string | null
  /** 用户可编辑的路径部分（含 query 与 hash） */
  path: string
  /** 原 URL 的形态，absolute 需要在发送/保存前改绑环境 */
  source: 'baseUrl' | 'absolute' | 'relative' | 'empty' | 'none'
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//
const BASE_URL_TOKEN = /^\{\{\s*baseUrl\s*\}\}/i

function hasScheme(value: string): boolean {
  return SCHEME.test(value)
}

function withLeadingSlash(value: string): string {
  if (!value) return ''
  return value.startsWith('/') ? value : `/${value}`
}

/** 去掉绝对地址的协议与域名，只保留 path/query/hash。 */
function stripOrigin(value: string): string {
  const rest = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/, '')
  if (!rest) return '/'
  return withLeadingSlash(rest)
}

/** 校验服务前置 URL：允许空值，允许省略协议；不允许空白、占位符和非 http(s)。 */
export function isValidServerUri(uri: string): boolean {
  const value = (uri ?? '').trim()
  if (!value) return true
  if (/\s/.test(value) || /\{\{|\}\}/.test(value)) return false
  try {
    const parsed = new URL(hasScheme(value) ? value : `http://${value}`)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

export function normalizeServerPrefix(uri: string): string {
  const value = (uri ?? '').trim()
  if (!value) return ''
  const withScheme = hasScheme(value) ? value : `http://${value}`
  return withScheme.replace(/\/+$/, '')
}

export function environmentServerPrefix(env?: Environment | null, serverId = '0'): string {
  const id = serverId && serverId !== '0' ? serverId : '0'
  const server = env?.server_list?.find((item) => item.server_id === id) ?? env?.server_list?.[0]
  return normalizeServerPrefix(server?.uri ?? '')
}

/** 与发送端一致：环境变量 baseUrl 优先于服务前置 URL。 */
export function environmentBaseUrl(env?: Environment | null, serverId = '0'): string {
  const variable = env?.env_var_list?.baseUrl
  const explicit = variable ? (variable.current_value || variable.initial_value || '').trim() : ''
  if (explicit) return explicit.replace(/\/+$/, '')
  return environmentServerPrefix(env, serverId)
}

export function splitEnvironmentUrl(
  url: string,
  env?: Environment | null,
  serverId = '0'
): EnvironmentUrlParts {
  const raw = (url ?? '').trim()
  const base = environmentBaseUrl(env, serverId)
  const serverPrefix = environmentServerPrefix(env, serverId)
  const token = BASE_URL_TOKEN.exec(raw)

  if (token && base) {
    return {
      bound: true,
      prefix: base,
      prefixToken: token[0],
      path: withLeadingSlash(raw.slice(token[0].length)),
      source: 'baseUrl'
    }
  }

  if (hasScheme(raw)) {
    if (!base) return { bound: false, prefix: '', prefixToken: null, path: raw, source: 'none' }
    return {
      bound: true,
      prefix: base,
      prefixToken: '{{baseUrl}}',
      path: stripOrigin(raw),
      source: 'absolute'
    }
  }

  if (serverPrefix) {
    return {
      bound: true,
      prefix: serverPrefix,
      prefixToken: null,
      path: withLeadingSlash(raw),
      source: raw ? 'relative' : 'empty'
    }
  }

  if (base) {
    return {
      bound: true,
      prefix: base,
      prefixToken: '{{baseUrl}}',
      path: withLeadingSlash(raw),
      source: raw ? 'relative' : 'empty'
    }
  }

  return { bound: false, prefix: '', prefixToken: null, path: raw, source: 'none' }
}

/** 把编辑后的路径拼回存储格式；未绑定环境时保持用户输入原样。 */
export function joinEnvironmentUrl(parts: EnvironmentUrlParts, path: string): string {
  const value = parts.bound ? withLeadingSlash(path) : path
  if (!parts.bound || !parts.prefixToken) return value
  return `${parts.prefixToken}${value}`
}

/** 编辑时若用户粘贴了完整地址，只保留其中的路径部分。 */
export function editableEnvironmentPath(
  parts: EnvironmentUrlParts,
  value: string,
  env?: Environment | null,
  serverId = '0'
): string {
  if (!parts.bound) return value
  return splitEnvironmentUrl(value, env, serverId).path
}
