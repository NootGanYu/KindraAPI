/** A single projection for local evidence and every public Run response. Execution keeps raw values in memory. */
const HIDDEN = '[REDACTED]'
const sensitive = /(?:authorization|cookie|token|password|passwd|secret|api[_-]?key|credential|session)/i

export function redactEvidence<T>(value: T, seeds: unknown[] = []): T {
  const secrets = new Set<string>()
  const remember = (value: unknown): void => {
    if (typeof value === 'string' && value && value !== HIDDEN) {
      secrets.add(value)
      const bearer = value.match(/^(?:Bearer|Basic)\s+(.+)$/i)
      if (bearer) secrets.add(bearer[1])
      for (const part of value.split(';')) {
        const match = part.trim().match(/^[\w-]+=([^;]+)$/)
        if (match) secrets.add(match[1])
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(remember)
  }
  const collect = (value: unknown, key = ''): void => {
    if (sensitive.test(key)) remember(value)
    if (typeof value === 'string') {
      try { collect(JSON.parse(value)); } catch { /* plain text */ }
      for (const match of value.matchAll(/(?:[?&]|\b)(?:token|password|secret|api_key|access_token)=([^&\s]+)/gi)) {
        try { remember(decodeURIComponent(match[1])) } catch { remember(match[1]) }
      }
    } else if (Array.isArray(value)) {
      value.forEach(item => {
        if (item && typeof item === 'object' && sensitive.test(String(item.key ?? item.name ?? ''))) remember(item.value)
        collect(item)
      })
    } else if (value && typeof value === 'object') Object.entries(value).forEach(([k,v]) => collect(v,k))
  }
  collect(value); seeds.forEach(seed => collect(seed))
  const ordered = [...secrets].sort((a,b) => b.length-a.length)
  const hide = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(hide)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, hide(v)]))
    return typeof value === 'string' ? HIDDEN : value
  }
  const project = (value: unknown, key = ''): unknown => {
    if (key === 'body_base64') return undefined
    if (sensitive.test(key) && value !== undefined && value !== null) return hide(value)
    // Script source can contain inline credentials. Keep definition revisions, not executable source, in evidence.
    if (/^(script|pre_script|post_script)$/.test(key) && typeof value === 'string' && value) return HIDDEN
    if (typeof value === 'string') {
      // These opaque identifiers are needed to query and deduplicate the same Run.
      if (/^(?:run_id|project_id|flow_id|event_id|instance_id|after_instance_id|parent_event_id|step_id|logical_step_id|target_id|env_id|environment_id|request_id|request_environment_id|preview_id|instance_id|after_instance_id|revision|previous_revision|next_revision|api_revision|flow_revision|sha256)$/.test(key)) return value
      try {
        const decoded: unknown = JSON.parse(value)
        if (decoded && typeof decoded === 'object') return JSON.stringify(project(decoded))
      } catch { /* plain text */ }
      let text = value
      for (const secret of ordered) text = text.split(secret).join(HIDDEN)
      return text.replace(/((?:token|password|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi, `$1${HIDDEN}`)
    }
    if (Array.isArray(value)) return value.map(item => {
      if (item && typeof item === 'object' && sensitive.test(String(item.key ?? item.name ?? ''))) return { ...project(item) as object, value: HIDDEN }
      return project(item)
    })
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,project(v,k)]))
    return value
  }
  return project(value) as T
}
