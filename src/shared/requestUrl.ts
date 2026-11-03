import type { Param } from './types'

export function encodePreservingVars(value: string): string {
  // Keep environment placeholders editable; the runtime resolves them later.
  return value.split(/(\{\{[^{}]+\}\})/g).map(part => part.startsWith('{{') && part.endsWith('}}') ? part : encodeURIComponent(part)).join('')
}
export function withoutQueryKeys(url: string, keys: string[]): string {
  const hashIndex = url.indexOf('#')
  const hash = hashIndex < 0 ? '' : url.slice(hashIndex)
  const base = hashIndex < 0 ? url : url.slice(0, hashIndex)
  const queryIndex = base.indexOf('?')
  if (queryIndex < 0) return url
  const query = base.slice(queryIndex + 1).split('&').filter(part => {
    const key = part.split('=')[0]
    try { return !keys.includes(decodeURIComponent(key.replace(/\+/g, ' '))) } catch { return !keys.includes(key) }
  }).filter(Boolean).join('&')
  return base.slice(0, queryIndex) + (query ? `?${query}` : '') + hash
}
export function withQueryParams(url: string, params: Param[], omitEmptyEquals = false): string {
  const clean = withoutQueryKeys(url, params.map(param => param.key))
  const parts = params.filter(param => param.key.trim() && (param.is_checked > 0 || (param.is_system ?? 0) > 0)).map(param => {
    const key = encodePreservingVars(param.key)
    return omitEmptyEquals && !param.value ? key : `${key}=${encodePreservingVars(param.value ?? '')}`
  })
  if (!parts.length) return clean
  const hashIndex = clean.indexOf('#')
  const hash = hashIndex < 0 ? '' : clean.slice(hashIndex)
  const base = hashIndex < 0 ? clean : clean.slice(0, hashIndex)
  return base + (base.includes('?') ? '&' : '?') + parts.join('&') + hash
}
