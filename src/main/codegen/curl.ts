import type { CurlResult, Param } from '@shared/types'
import type { EffectiveRequest } from '../request/executor'

/** POSIX shell 单引号转义（bash/zsh）。 */
function quote(value: string): string {
  return `'${String(value ?? '').replace(/'/g, "'\\''")}'`
}

function activeParams(params?: Param[]): Param[] {
  return (params ?? []).filter(
    (item) => item.key.trim() !== '' && (item.is_checked > 0 || (item.is_system ?? -1) > 0)
  )
}

function hasHeader(headers: Array<{ key: string; value: string }>, name: string): boolean {
  return headers.some((item) => item.key.toLowerCase() === name.toLowerCase())
}

/**
 * 根据已完成环境替换的请求生成 curl 片段。
 * 只生成文本，不执行命令。
 */
export function generateCurl(effective: EffectiveRequest): CurlResult {
  const warnings: string[] = []
  const headers = [...effective.headers].filter((item) => item.key.trim() !== '')
  let url = effective.url || 'http://'
  const auth = effective.authModel

  if (auth?.type === 'bearer' && auth.bearer?.key && !hasHeader(headers, 'Authorization')) {
    headers.push({ key: 'Authorization', value: `Bearer ${auth.bearer.key}` })
  }
  if (auth?.type === 'kv' && auth.kv?.key) {
    if (auth.kv.in === 'query') {
      const pair = `${encodeURIComponent(auth.kv.key)}=${encodeURIComponent(auth.kv.value ?? '')}`
      url += (url.includes('?') ? '&' : '?') + pair
    } else if (!hasHeader(headers, auth.kv.key)) {
      headers.push({ key: auth.kv.key, value: auth.kv.value ?? '' })
    }
  }
  if (auth?.type === 'basic' && auth.basic) {
    // basic 通过 --user 传参，避免把口令拼进 Header。
  } else if (auth && !['noauth', 'none', 'inherit', 'bearer', 'kv', 'basic'].includes(auth.type)) {
    warnings.push(`认证类型 ${auth.type} 未在 curl 中展开`)
  }

  const lines: string[] = [`curl --request ${effective.method}`, `  --url ${quote(url)}`]
  for (const header of headers) {
    lines.push(`  --header ${quote(`${header.key}: ${header.value}`)}`)
  }

  const body = effective.bodyModel
  const mode = effective.bodyMode
  if (body && mode !== 'none') {
    if (mode === 'raw' || mode === 'json') {
      const content = body.raw ?? body.json ?? ''
      if (content) lines.push(`  --data-raw ${quote(content)}`)
    } else if (mode === 'urlencoded') {
      for (const item of activeParams(body.urlencoded)) {
        lines.push(`  --data-urlencode ${quote(`${item.key}=${item.value ?? ''}`)}`)
      }
    } else if (mode === 'formdata') {
      for (const item of activeParams(body.formdata)) {
        const value = String(item.value ?? '')
        lines.push(`  --form ${quote(`${item.key}=${value}`)}`)
      }
    } else if (mode === 'binary') {
      if (body.binary?.file_path) {
        lines.push(`  --data-binary ${quote(`@${body.binary.file_path}`)}`)
      } else if (body.binary?.data_url) {
        warnings.push('binary 使用 data URL，curl 片段未内联该内容')
      }
    } else if (mode !== 'none') {
      warnings.push(`Body 模式 ${mode} 未在 curl 中展开`)
    }
  }

  if (auth?.type === 'basic' && auth.basic) {
    lines.push(`  --user ${quote(`${auth.basic.username}:${auth.basic.password}`)}`)
  }

  return { script: lines.join(' \\\n'), warnings }
}
