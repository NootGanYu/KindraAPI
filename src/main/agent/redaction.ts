import * as store from '../storage/store'

const sensitive = /authorization|cookie|token|secret|password|passwd|api[_-]?key|credential|session|access[_-]?key/i
const hidden = '[已隐藏]'
/** A per-turn redactor: credentials stay in memory and never become model context. */
export interface ProjectRedactor { <T>(value: T): T; stream(text: string): string }
export function projectRedactor(projectId: string, extra: string[] = [], objects: unknown[] = []): ProjectRedactor {
  const secrets = new Set(extra.filter(Boolean))
  function collect(value: unknown, secret = false): void {
    if (typeof value === 'string') { if (secret && value) { secrets.add(value); if (/^Bearer\s+/i.test(value)) secrets.add(value.replace(/^Bearer\s+/i, '')) }; return }
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { for (const item of value) collect(item, secret); return }
    const record = value as Record<string, unknown>
    const secretParam = typeof record.key === 'string' && sensitive.test(record.key)
    for (const [key, item] of Object.entries(record)) collect(item, secret || sensitive.test(key) || key === 'auth' || (secretParam && ['value', 'current_value', 'initial_value'].includes(key)))
  }
  for (const environment of store.listEnvironments(projectId)) for (const variable of Object.values(environment.env_var_list)) { collect(variable.current_value, true); collect(variable.initial_value, true) }
  for (const variable of Object.values(store.getGlobalVars(projectId).vars)) { collect(variable.current_value, true); collect(variable.initial_value, true) }
  collect(store.getCookieJar(projectId), true)
  collect(store.getGlobalParams(projectId))
  objects.forEach(object => collect(object))
  const sorted = [...secrets].sort((a, b) => b.length - a.length)
  function text(value: string): string {
    let result = value
    for (const secret of sorted) result = result.split(secret).join(hidden)
    return result.replace(/(Bearer\s+)[^\s"'<>,;]+/gi, `$1${hidden}`)
      .replace(/((?:api[_-]?key|token|password|secret|authorization|cookie)\s*[:=]\s*)[^\s"'&,;]+/gi, `$1${hidden}`)
  }
  function visit(value: unknown, key = ''): unknown {
    if (typeof value === 'string') return sensitive.test(key) && value ? hidden : text(value)
    if (Array.isArray(value)) return value.map(item => visit(item, key))
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      return Object.fromEntries(Object.entries(record).map(([name, item]) => [name,
        (key === 'auth' || key === 'cookie' || sensitive.test(name) || (typeof record.key === 'string' && sensitive.test(record.key) && name === 'value')) ? hidden : visit(item, name)]))
    }
    return value
  }
  const redact = <T>(value: T): T => visit(value) as T
  redact.stream = (value: string): string => {
    let tail = 0
    for (const secret of sorted) for (let length = Math.min(secret.length - 1, value.length); length > tail; length--) {
      if (value.endsWith(secret.slice(0, length))) { tail = length; break }
    }
    return text(tail ? value.slice(0, -tail) : value)
  }
  return redact
}
