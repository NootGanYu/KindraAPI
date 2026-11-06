/** A single projection for local evidence and every public Run response. Execution keeps raw values in memory. */
const HIDDEN = '[REDACTED]'
const sensitive = /(?:authorization|cookie|token|password|passwd|secret|api[_-]?key|credential|session)/i

// Only these explicitly selected protocol projections preserve machine-owned fields.
// Data inside bodies, variables, headers and console arguments never inherits a schema.
const schemas = {
  data: { keys: [], children: {} },
  run: { keys: ['run_id', 'project_id', 'flow_id', 'env_id', 'status', 'remote_outcome', 'request_id', 'request_environment_id', 'source'], children: { events: 'event', cursor: 'cursor', snapshot: 'snapshot', refresh_preview: 'preview', version_switches: 'switch', console: 'console' } },
  event: { keys: ['event_id', 'instance_id', 'type', 'status', 'definition_revision'], children: { children: 'event', iteration_path: 'iteration', request: 'request' } },
  iteration: { keys: ['event_id'], children: {} },
  cursor: { keys: ['after_instance_id'], children: { stack: 'frame' } },
  frame: { keys: ['parent_event_id'], children: {} },
  snapshot: { keys: ['flow_revision', 'environment_id'], children: { requests: 'definition' } },
  definition: { keys: ['event_id', 'target_id', 'revision'], children: { files: 'file' } },
  file: { keys: ['sha256'], children: {} },
  preview: { keys: ['preview_id'], children: { references: 'reference', scope_approval: 'approval' } },
  switch: { keys: ['after_instance_id', 'preview_id'], children: { references: 'reference', scope_approval: 'approval' } },
  reference: { keys: ['event_id', 'target_id', 'previous_revision', 'next_revision', 'api_revision'], children: { effective_request: 'request', conflicts: 'conflict' } },
  conflict: { keys: ['event_id', 'field', 'reason', 'resolution'], children: {} },
  approval: { keys: ['preview_id', 'fingerprint', 'environment_id'], children: { references: 'reference' } },
  request: { keys: ['method'], children: {} },
  console: { keys: ['level'], children: {} },
  send: { keys: ['record_id', 'project_id', 'target_id', 'method', 'status'], children: { request: 'request', error: 'error', console: 'console' } },
  error: { keys: ['type'], children: {} }
} satisfies Record<string, { keys: string[]; children: Record<string, string> }>
type EvidenceProjection = keyof typeof schemas

export function redactEvidence<T>(value: T, seeds: unknown[] = [], projection: EvidenceProjection = 'data'): T {
  const secrets = new Set<string>()
  const remember = (value: unknown): void => {
    if ((typeof value === 'number' || typeof value === 'boolean')) {
      secrets.add(String(value))
    } else if (typeof value === 'string' && value && value !== HIDDEN) {
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
    } else if (value && typeof value === 'object') {
      const conflict = value as Record<string, unknown>
      if (typeof conflict.field === 'string' && sensitive.test(conflict.field)) {
        remember(conflict.old_value); remember(conflict.new_value); remember(conflict.override_value)
      }
      Object.entries(value).forEach(([k,v]) => collect(v,k))
    }
  }
  collect(value); seeds.forEach(seed => collect(seed))
  const ordered = [...secrets].sort((a,b) => b.length-a.length)
  const hide = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(hide)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, hide(v)]))
    return value === undefined || value === null ? value : HIDDEN
  }
  const project = (value: unknown, key = '', context: EvidenceProjection = 'data'): unknown => {
    if (key === 'body_base64') return undefined
    if (sensitive.test(key) && value !== undefined && value !== null) return hide(value)
    // Script source can contain inline credentials. Keep definition revisions, not executable source, in evidence.
    if (/^(script|pre_script|post_script)$/.test(key) && typeof value === 'string' && value) return HIDDEN
    if (typeof value === 'string') {
      try {
        const decoded: unknown = JSON.parse(value)
        if (decoded && typeof decoded === 'object') return JSON.stringify(project(decoded))
      } catch { /* plain text */ }
      let text = value
      for (const secret of ordered) text = text.split(secret).join(HIDDEN)
      return text.replace(/((?:token|password|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi, `$1${HIDDEN}`)
    }
    if (Array.isArray(value)) return value.map(item => {
      if (context === 'data' && item && typeof item === 'object' && Object.hasOwn(item, 'value') && sensitive.test(String(item.key ?? item.name ?? ''))) return { ...project(item) as object, value: HIDDEN }
      return project(item, '', context)
    })
    if (value && typeof value === 'object') {
      const schema: { keys: readonly string[]; children: Record<string, string> } = schemas[context]
      return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,
        schema.keys.includes(k) ? v : project(v, k, (schema.children[k] ?? 'data') as EvidenceProjection)
      ]))
    }
    return value
  }
  return project(value, '', projection) as T
}

/** Postman auth from the captured definition or the variable-resolved outgoing request. */
export function authenticationSecrets(auth: unknown, variables: Record<string, string> = {}): string[] {
  if (!auth || typeof auth !== 'object') return []
  const model = auth as { type?: string; bearer?: unknown; basic?: unknown; apikey?: unknown }
  const parameters = model.type === 'bearer' ? model.bearer : model.type === 'basic' ? model.basic : model.type === 'apikey' ? model.apikey : undefined
  if (!Array.isArray(parameters)) return []
  const values: Record<string, string> = {}
  for (const parameter of parameters) {
    if (!parameter || !['token', 'username', 'password', 'value'].includes(parameter.key)) continue
    let value = String(parameter.value ?? '')
    for (let pass = 0; pass < 10; pass++) {
      const resolved = value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key: string) => variables[key] ?? match)
      if (resolved === value) break
      value = resolved
    }
    if (value && !value.includes('{{')) values[parameter.key] = value
  }
  const secrets = Object.values(values)
  if (model.type === 'basic' && (values.username || values.password)) {
    secrets.push(Buffer.from(`${values.username ?? ''}:${values.password ?? ''}`).toString('base64'))
  }
  return secrets.flatMap(value => [value, encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2)])
}
