import * as store from '../storage/store'

const sensitive = /authorization|cookie|token|secret|password|passwd|api[_-]?key|credential|session|access[_-]?key/i
const hidden = '[已隐藏]'
// Stable identifiers are application-generated and are the only contract by which the model
// can address rows in a later patch. They are projected verbatim even when a short environment
// value (for example "1") happens to occur as a substring. Actual sensitive values continue to
// be redacted by their own field names and content.
const stableIdKeys = new Set([
  'param_id', 'case_id', 'assertion_id', 'example_id', 'event_id', 'field_id',
  'target_id', 'flow_id', 'project_id', 'parent_id', 'folder_id', 'model_id',
  'mark_id', 'version_id', 'deletion_id', 'candidate_id', 'plan_id', 'step_id',
  'conversation_id', 'connection_id', 'env_id', 'status_id', 'attribute_id',
  'scene_id', 'schema_id', 'record_id', 'run_id', 'undo_id', 'review_id'
])
/** A per-turn redactor: credentials stay in memory and never become model context. */
export interface ProjectRedactor { <T>(value: T): T; stream(text: string): string }
export function projectRedactor(projectId: string, extra: string[] = [], objects: unknown[] = []): ProjectRedactor {
  const secrets = new Set(extra.filter(Boolean))
  function collect(value: unknown, secret = false): void {
    if (typeof value === 'string') {
      // URL userinfo is credential material even when stored in an ordinary url/description field.
      for (const match of value.matchAll(/\b[a-z][a-z\d+.-]*:\/\/([^/\s?#@]+)@/gi)) {
        const userinfo = match[1]
        const colon = userinfo.indexOf(':')
        const components = colon < 0 ? [userinfo] : [userinfo.slice(0, colon), userinfo.slice(colon + 1)]
        const decoded = components.map(part => { try { return decodeURIComponent(part) } catch { return part } })
        for (const part of [userinfo, ...components, ...decoded]) if (part) secrets.add(part)
        if (colon >= 0) secrets.add(Buffer.from(decoded.join(':')).toString('base64'))
      }

      if (secret && value) {
        secrets.add(value)
        if (/^(Bearer|Basic)\s+/i.test(value)) secrets.add(value.replace(/^(Bearer|Basic)\s+/i, ''))
      } else if (/^\s*[\[{]/.test(value)) {
        try { collect(JSON.parse(value)) } catch { /* Plain text is sanitized separately. */ }
      }
      return
    }
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { for (const item of value) collect(item, secret); return }
    const record = value as Record<string, unknown>
    const secretParam = typeof record.key === 'string' && sensitive.test(record.key)
    for (const [key, item] of Object.entries(record)) collect(item, secret || sensitive.test(key) || key === 'auth' || (secretParam && ['value', 'current_value', 'initial_value'].includes(key)))
  }
  for (const environment of store.listEnvironments(projectId)) for (const variable of Object.values(environment.env_var_list)) { collect(variable.current_value, true); collect(variable.initial_value, true) }
  for (const variable of Object.values(store.getGlobalVars(projectId).vars)) { collect(variable.current_value, true); collect(variable.initial_value, true) }
  // Only cookie payloads are secret. Collecting the whole jar also treated project_id
  // (and timestamps) as secrets, which corrupted stable revision strings shown to the model.
  for (const domain of store.getCookieJar(projectId).domains) collect(domain.cookies, true)
  collect(store.getGlobalParams(projectId))
  objects.forEach(object => collect(object))
  const sorted = [...secrets].sort((a, b) => b.length - a.length)
  function text(value: string): string {
    let result = value.replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^/\s?#@]+@/gi, '$1')
    for (const secret of sorted) result = result.split(secret).join(hidden)
    return result.replace(/((?:Bearer|Basic)\s+)[^\s"'<>,;]+/gi, `$1${hidden}`)
      .replace(/((?:api[_-]?key|token|password|secret|authorization|cookie)\s*[:=]\s*)[^\s"'&,;]+/gi, `$1${hidden}`)
  }
  function visit(value: unknown, key = ''): unknown {
    if (typeof value === 'string') {
      if (stableIdKeys.has(key)) return value
      return sensitive.test(key) && value ? hidden : text(value)
    }
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
