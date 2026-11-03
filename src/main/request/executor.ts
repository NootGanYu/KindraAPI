import { encodePreservingVars, withoutQueryKeys, withQueryParams } from '@shared/requestUrl'
import fs from 'node:fs'
import type {
  AssertionResult,
  AuthModel,
  BodyModel,
  ConsoleEntry,
  Environment,
  Param,
  RequestModel,
  SendRecord,
  Target
} from '@shared/types'
import { createId } from '@shared/factories'
import * as store from '../storage/store'
import { generateModelExample } from '../schema/example'
import { mergeScriptVariables, requestScript } from './scripts'

const runtime = require('postman-runtime') as any
const { Collection, VariableScope } = require('postman-collection') as any

const MAX_BODY_BYTES = 2 * 1024 * 1024

interface ResolvedRequest {
  disabledSystemHeaders: Record<string, boolean>
  url: string
  method: string
  headers: Array<{ key: string; value: string }>
  body: unknown
  auth: unknown
  bodyMode: string
  bodyModel?: BodyModel
  authModel?: AuthModel
  querys: Record<string, string>
  paths: Record<string, string>
  cookies: Record<string, string>
  protocolVersion: 'http1' | 'auto' | 'http2'
  baseUrl: string
}

/** 供代码生成复用的有效请求描述（已完成环境变量/服务前缀替换）。 */
export interface EffectiveRequest {
  url: string
  method: string
  headers: Array<{ key: string; value: string }>
  bodyMode: string
  bodyModel?: BodyModel
  authModel?: AuthModel
  warnings: string[]
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase()
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase()
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target)
  return key ? headers[key] : undefined
}

function mergeParams(base: Param[], incoming: Param[], caseInsensitive = false, multiple = false): Param[] {
  if (multiple) {
    // 同层 Query 允许重名；下层按名称覆盖上层，未勾选的行也能屏蔽继承值。
    const incomingKeys = new Set(incoming.map(param => param.key))
    return [...base.filter(param => !incomingKeys.has(param.key)), ...incoming]
      .filter(param => param.is_checked > 0 || (param.is_system ?? -1) > 0)
      .map(param => ({ ...param }))
  }
  const map = new Map<string, Param>()
  const keyOf = (key: string): string => (caseInsensitive ? normalizeKey(key) : key)
  for (const p of base) {
    if (p.is_checked > 0 || (p.is_system ?? -1) > 0) map.set(keyOf(p.key), { ...p })
  }
  for (const p of incoming) {
    if (!(p.is_checked > 0 || (p.is_system ?? -1) > 0)) {
      map.delete(keyOf(p.key))
      continue
    }
    map.set(keyOf(p.key), { ...p })
  }
  return [...map.values()]
}

function getChain(projectId: string, target: Target): Target[] {
  const chain: Target[] = [target]
  const seen = new Set<string>([target.target_id])
  let parentId = target.parent_id
  while (parentId && parentId !== '0') {
    if (seen.has(parentId)) break
    const parent = store.getTarget(projectId, parentId)
    if (!parent) break
    chain.push(parent)
    seen.add(parent.target_id)
    parentId = parent.parent_id
  }
  return chain
}

function resolveRequest(projectId: string, target: Target, env: Environment | null): ResolvedRequest {
  const chain = getChain(projectId, target) // nearest -> root
  const root = store.readProjectRequestDefaults(projectId)

  const disabledSystemHeaders: Record<string, boolean> = {}
  for (const request of [root, ...[...chain].reverse().map(node => node.request)]) {
    for (const param of request?.header?.parameter ?? []) {
      const key = normalizeKey(param.key)
      if (param.is_checked > 0 || (param.is_system ?? -1) > 0) delete disabledSystemHeaders[key]
      else disabledSystemHeaders[key] = true
    }
  }
  let header = mergeParams(root.header?.parameter ?? [], [], true)
  let query = mergeParams(root.query?.parameter ?? [], [], false, true)
  let restful = mergeParams(root.restful?.parameter ?? [], [])
  let cookie = mergeParams(root.cookie?.parameter ?? [], [])
  let bodyMode = root.body?.mode ?? 'none'
  let body = root.body
  let auth = root.auth

  for (const node of [...chain].reverse()) {
    const req = node.request
    if (!req) continue
    header = mergeParams(header, req.header?.parameter ?? [], true)
    query = mergeParams(query, req.query?.parameter ?? [], false, true)
    restful = mergeParams(restful, req.restful?.parameter ?? [])
    cookie = mergeParams(cookie, req.cookie?.parameter ?? [])
    if (req.auth && req.auth.type !== 'inherit') auth = req.auth
    if (req.body && (req.body.mode !== 'none' || (req.body.raw ?? '').length > 0)) {
      bodyMode = req.body.mode
      body = req.body
    }
  }

  // 引用了数据模型时，发送前按模型实时重新生成，忽略手改的 raw。
  // 模型失效时保留最近一次生成的 raw，避免发送 "null"。
  if (body?.model_id) {
    const generated = generateModelExample(projectId, body.model_id)
    const broken = generated.warnings.some(
      (warning) => warning.code === 'missing-model' || warning.code === 'invalid-ref'
    )
    if (!broken) {
      body = {
        ...body,
        mode: body.mode === 'none' ? 'json' : body.mode,
        raw: JSON.stringify(generated.value, null, 2)
      }
      if (bodyMode === 'none') bodyMode = 'json'
    }
  }

  // Env server prefix resolution: nearest explicit server_id wins.
  const explicit = chain.find((n) => n.server_id && n.server_id !== '0')
  const serverId = explicit?.server_id ?? '0'
  const server = env?.server_list?.find((s) => s.server_id === serverId) ?? env?.server_list?.[0]
  let prefix = server?.uri?.trim() ?? ''
  if (prefix && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(prefix)) {
    prefix = `http://${prefix}`
  }

  const envBase = env?.env_var_list?.baseUrl
  const explicitBase = envBase ? (envBase.current_value || envBase.initial_value || '').trim() : ''
  const baseUrl = (explicitBase || prefix || '').replace(/\/+$/, '')

  let url = (target.url ?? '').trim()
  if (baseUrl) {
    url = url.replace(/\{\{\s*baseUrl\s*\}\}/gi, baseUrl)
  }
  const paths: Record<string, string> = {}
  for (const p of restful) {
    if (!p.key) continue
    const token = `{${p.key}}`
    if (url.includes(token)) {
      url = url.split(token).join(encodePreservingVars(p.value ?? ''))
      paths[p.key] = p.value ?? ''
    }
  }

  if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    if (prefix) {
      url = `${prefix.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
    } else {
      url = `http://${url.replace(/^\/+/, '')}`
    }
  }

  const querys: Record<string, string> = {}
  const activeQuery = query.filter((p) => p.key.trim() !== '')
  for (const param of activeQuery) querys[param.key] = param.value ?? ''
  const queryKeys = [root, ...chain.map(node => node.request)].flatMap(request => (request?.query?.parameter ?? []).map(param => param.key))
  url = withQueryParams(withoutQueryKeys(url, queryKeys), activeQuery, target.request?.query?.omit_empty_equals ?? false)

  const headers = header
    .filter((p) => p.key.trim() !== '')
    .map((p) => ({ key: p.key.trim(), value: p.value ?? '' }))

  const cookies = cookie
    .filter((p) => p.key.trim() !== '')
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.key] = p.value
      return acc
    }, {})

  // Cookie 优先级：全局 jar < 请求 Cookie 参数 < 显式 Cookie 头。
  const mergedCookies: Record<string, string> = {
    ...store.getCookieJarForUrl(projectId, url)
  }
  for (const [key, value] of Object.entries(cookies)) mergedCookies[key] = value
  const explicitCookieHeaders = headers.filter(
    (item) => item.key.toLowerCase() === 'cookie'
  )
  for (const header of explicitCookieHeaders) {
    for (const [key, value] of parseCookieHeader(header.value)) mergedCookies[key] = value
  }
  if (explicitCookieHeaders.length > 0) {
    for (let i = headers.length - 1; i >= 0; i -= 1) {
      if (headers[i].key.toLowerCase() === 'cookie') headers.splice(i, 1)
    }
  }
  const cookieHeader = Object.entries(mergedCookies)
    .map(([key, value]) => `${stripHeaderBreaks(key)}=${stripHeaderBreaks(value)}`)
    .filter((pair) => !pair.startsWith('='))
    .join('; ')
  if (cookieHeader) headers.push({ key: 'Cookie', value: cookieHeader })

  if (bodyMode === 'json' && !disabledSystemHeaders['content-type'] && !headers.some((h) => h.key.toLowerCase() === 'content-type')) {
    headers.push({ key: 'Content-Type', value: 'application/json' })
  }

  const raw = target.protocol || 'http/1.1'
  const protocolVersion: 'http1' | 'auto' | 'http2' =
    raw === 'auto' ? 'auto' : raw === 'http/1.1' || raw === 'http1' || !raw ? 'http1' : 'http2'

  return {
    disabledSystemHeaders,
    url,
    method: (target.method || 'GET').toUpperCase(),
    headers,
    body: toPostmanBody(bodyMode, body),
    auth: toPostmanAuth(auth),
    bodyMode,
    bodyModel: body,
    authModel: auth,
    querys,
    paths,
    cookies,
    protocolVersion,
    baseUrl
  }
}

function stripHeaderBreaks(value: string): string {
  return String(value ?? '').replace(/[\r\n]/g, '')
}

function parseCookieHeader(value: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const part of String(value ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    const cookieValue = part.slice(index + 1).trim()
    if (key) pairs.push([key, cookieValue])
  }
  return pairs
}

function loadScopes(
  projectId: string,
  environmentId?: string
): { env: Environment | null; globals: ReturnType<typeof store.getGlobalVars> } {
  const envs = store.listEnvironments(projectId)
  const settings = store.getSettings()
  const preferredEnvId = environmentId || settings.environment_id
  const env = envs.find((e) => e.env_id === preferredEnvId) ?? envs[0] ?? null
  return { env, globals: store.getGlobalVars(projectId) }
}

/** 为代码生成等场景提供已完成环境替换与 Cookie 合并的请求。 */
export function resolveEffectiveRequest(
  projectId: string,
  target: Target,
  environmentId?: string
): EffectiveRequest {
  const { env } = loadScopes(projectId, environmentId)
  const resolved = resolveRequest(projectId, target, env)
  return {
    url: resolved.url,
    method: resolved.method,
    headers: resolved.headers,
    bodyMode: resolved.bodyMode,
    bodyModel: resolved.bodyModel,
    authModel: resolved.authModel,
    warnings: []
  }
}

function toPostmanBody(mode: string, body: any): unknown {
  if (!body || mode === 'none') return undefined
  if (mode === 'raw' || mode === 'json') {
    return {
      mode: 'raw',
      raw: body.raw ?? body.json ?? '',
      options: { raw: { language: mode === 'json' ? 'json' : 'text' } }
    }
  }
  if (mode === 'urlencoded') {
    return {
      mode: 'urlencoded',
      urlencoded: (body.urlencoded ?? body.parameter ?? [])
        .filter((p: Param) => p.key && (p.is_checked > 0 || (p.is_system ?? -1) > 0))
        .map((p: Param) => ({ key: p.key, value: p.value ?? '', type: 'text' }))
    }
  }
  if (mode === 'formdata') {
    return {
      mode: 'formdata',
      formdata: (body.formdata ?? body.parameter ?? [])
        .filter((p: Param) => p.key && (p.is_checked > 0 || (p.is_system ?? -1) > 0))
        .map((p: Param) =>
          p.field_type === 'file'
            ? { key: p.key, type: 'file', src: p.value, contentType: p.content_type }
            : { key: p.key, value: p.value ?? '', type: 'text', contentType: p.content_type }
        )
    }
  }
  if (mode === 'binary') {
    return { mode: 'file', file: { src: body.binary?.file_path ?? '' } }
  }
  return undefined
}

function toPostmanAuth(auth: any): unknown {
  if (!auth || auth.type === 'inherit' || auth.type === 'noauth') return { type: 'noauth' }
  if (auth.type === 'bearer') {
    return { type: 'bearer', bearer: [{ key: 'token', value: auth.bearer?.key ?? '', type: 'string' }] }
  }
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: auth.basic?.username ?? '', type: 'string' },
        { key: 'password', value: auth.basic?.password ?? '', type: 'string' }
      ]
    }
  }
  if (auth.type === 'kv') {
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: auth.kv?.key ?? '', type: 'string' },
        { key: 'value', value: auth.kv?.value ?? '', type: 'string' },
        { key: 'in', value: auth.kv?.in ?? 'header', type: 'string' }
      ]
    }
  }
  return { type: 'noauth' }
}

function toValues(list: Record<string, { current_value?: string; value?: string }>): Array<{
  key: string
  value: string
}> {
  return Object.entries(list).map(([key, v]) => ({
    key,
    value: String(v.current_value ?? v.value ?? '')
  }))
}

function headersToObject(headers: any): Record<string, string> {
  if (!headers) return {}
  if (typeof headers.toObject === 'function') {
    const obj = headers.toObject()
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]))
  }
  return {}
}

function bufferToText(buffer: Buffer, charset = 'utf-8'): { text: string; truncated: boolean } {
  if (!buffer) return { text: '', truncated: false }
  const bytes = buffer.subarray(0, MAX_BODY_BYTES)
  let text: string
  try { text = new TextDecoder(charset).decode(bytes) } catch { text = bytes.toString('utf8') }
  return { text, truncated: buffer.length > MAX_BODY_BYTES }
}

export async function sendRequest(
  projectId: string,
  target: Target,
  environmentId?: string,
  options: { signal?: AbortSignal } = {}
): Promise<SendRecord> {
  const settings = store.getSettings()
  const { env, globals } = loadScopes(projectId, environmentId)
  const resolved = resolveRequest(projectId, target, env)

  const environmentValues: Record<string, { current_value?: string; value?: string }> = env
    ? Object.fromEntries(
        Object.entries(env.env_var_list)
          .filter(([, v]) => v.is_checked > 0)
          .map(([k, v]) => [k, { current_value: v.current_value, value: v.initial_value }])
      )
    : {}
  if (resolved.baseUrl && environmentValues.baseUrl === undefined) {
    environmentValues.baseUrl = {
      current_value: resolved.baseUrl,
      value: resolved.baseUrl
    }
  }
  const globalValues = Object.fromEntries(
    Object.entries(globals.vars).map(([k, v]) => [
      k,
      { current_value: v.current_value, value: v.initial_value }
    ])
  )

  const collection = new Collection({
    info: {
      name: target.name || 'request',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: [
      {
        name: target.name || 'request',
        event: [
          { listen: 'prerequest', script: { type: 'text/javascript', exec: requestScript(target.request?.pre_script, target.request?.pre_script_enabled) } },
          { listen: 'test', script: { type: 'text/javascript', exec: requestScript(target.request?.test, target.request?.test_enabled) } }
        ],
        protocolProfileBehavior: { disabledSystemHeaders: resolved.disabledSystemHeaders },
        request: {
          url: resolved.url,
          method: resolved.method,
          header: resolved.headers,
          body: resolved.body,
          auth: resolved.auth
        }
      }
    ]
  })

  const assertions: AssertionResult[] = []
  const consoleEntries: ConsoleEntry[] = []
  const startedAt = Date.now()
  let timingOffsets: Record<string, number> | null = null
  let networkInfo: Record<string, unknown> | null = null
  const environmentScope = new VariableScope({ values: toValues(environmentValues) })
  const globalScope = new VariableScope({ values: toValues(globalValues) })
  const environmentBefore = environmentScope.toObject()
  const globalsBefore = globalScope.toObject()

  const result = await new Promise<{
    error: { type: string; message: string } | null
    response: any
    request: any
  }>((resolve) => {
    let settled = false
    let runtimeRun: any
    let requestRef: any = null
    const activeRequests = new Map<string, { abort: () => void }>()
    const abort = (): void => {
      // run.abort 只清后续队列，正在等待网络/脚本时还需中止实际资源。
      runtimeRun?.abort()
      for (const request of activeRequests.values()) request.abort()
      runtimeRun?.host?.dispose()
      finish({ error: { type: 'cancelled', message: '请求已取消' }, response: null, request: requestRef })
    }
    const finish = (payload: {
      error: { type: string; message: string } | null
      response: any
      request: any
    }): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      resolve(payload)
    }
    if (options.signal?.aborted) { abort(); return }
    options.signal?.addEventListener('abort', abort, { once: true })

    const runner = new runtime.Runner()
    runner.run(
      collection,
      {
        requester: {
          strictSSL: !(settings.ignore_tls > 0),
          followRedirects: settings.auto_redirect > 0,
          maxRedirects: Math.max(settings.max_redirect_time, 5),
          followOriginalHttpMethod: settings.follow_original_method > 0,
          protocolVersion: resolved.protocolVersion,
          timings: true,
          verbose: false
        },
        timeout: {
          request: settings.send_timeout > 0 ? settings.send_timeout : 0,
          script: 10000,
          global: 0
        },
        abortOnError: true,
        stopOnScriptError: true,
        iterationCount: 1,
        fileResolver: fs,
        environment: environmentScope,
        globals: globalScope,
        localVariables: new VariableScope({ values: [] })
      },
      (err: Error | null, run: any) => {
        if (err) {
          finish({ error: { type: 'runtime', message: err.message }, response: null, request: null })
          return
        }
        runtimeRun = run
        if (options.signal?.aborted) { abort(); return }
        let responseRef: any = null
        let responseError: Error | null = null
        run.start({
          beforeRequest: (_error: unknown, _cursor: unknown, request: unknown, _item: unknown, controls: { httpRequestId: string; abort: () => void }) => {
            requestRef = request
            activeRequests.set(controls.httpRequestId, controls)
            if (options.signal?.aborted) controls.abort()
          },
          response: (
            error: Error | null,
            _cursor: unknown,
            response: any,
            request: any,
            _item: unknown,
            _cookies: unknown,
            history: any
          ) => {
            if (settled) return
            if (error) responseError = error
            responseRef = response
            requestRef = request
            const execution = history?.execution?.data?.[0]
            if (execution?.timings?.offset) timingOffsets = execution.timings.offset
            if (execution) {
              networkInfo = {
                requestHttpVersion: execution.request?.httpVersion,
                responseHttpVersion: execution.response?.httpVersion,
                sessionReused: execution.session?.reused,
                downloadedBytes: execution.response?.downloadedBytes
              }
            }
          },
          assertion: (_cursor: unknown, results: any[]) => {
            for (const item of results ?? []) {
              const errorText = item.error
                ? String(item.error.message ?? item.error)
                : undefined
              assertions.push({
                name: String(item.name ?? item.assertion ?? ''),
                passed: item.passed === undefined ? !item.error : Number(item.passed) > 0,
                skipped: Number(item.skipped ?? 0) > 0,
                error: errorText
              })
            }
          },
          exception: (_cursor: unknown, error: Error) => {
            responseError = error
          },
          console: (_cursor: unknown, level: string, ...args: unknown[]) => {
            consoleEntries.push({
              time: Date.now(),
              level,
              args: args.map((a) => {
                try {
                  return typeof a === 'string' ? a : JSON.stringify(a)
                } catch {
                  return String(a)
                }
              })
            })
          },
          done: (doneError: Error | null) => {
            if (options.signal?.aborted) {
              finish({ error: { type: 'cancelled', message: '请求已取消' }, response: null, request: requestRef })
              return
            }
            const finalError = doneError || responseError
            finish({
              error: finalError ? { type: 'request', message: finalError.message } : null,
              response: responseRef,
              request: requestRef
            })
          }
        })
      }
    )
  })

  const finishedAt = Date.now()
  if (result.error?.type !== 'cancelled') {
    if (env) {
      const current = store.listEnvironments(projectId).find(item => item.env_id === env.env_id)
      if (current) {
        const values = mergeScriptVariables(env.env_var_list, current.env_var_list, environmentBefore, environmentScope.toObject(), value => ({ current_value: value, initial_value: '', is_checked: 1 }))
        if (values) store.saveEnvironment(projectId, { ...current, env_var_list: values })
      }
    }
    const current = store.getGlobalVars(projectId)
    const values = mergeScriptVariables(globals.vars, current.vars, globalsBefore, globalScope.toObject(), value => ({ current_value: value, initial_value: '' }))
    if (values) store.saveGlobalVars(projectId, { ...current, vars: values })
  }
  const runtimeRequest = result.request
  const runtimeResponse = result.response

  const requestHeaders = runtimeRequest ? headersToObject(runtimeRequest.headers) : {}
  const runtimeUrl = runtimeRequest?.url?.toString?.() ?? resolved.url
  const method = runtimeRequest?.method ?? resolved.method
  const requestBody =
    !runtimeRequest?.body?.mode ? undefined : runtimeRequest.body.mode === 'raw' ? runtimeRequest.body.raw : runtimeRequest.body.toJSON?.()

  let responseSnapshot: SendRecord['response'] = null
  if (runtimeResponse) {
    const buffer: Buffer = Buffer.isBuffer(runtimeResponse.stream)
      ? runtimeResponse.stream
      : Buffer.from(runtimeResponse.stream ?? '')
    const headers = headersToObject(runtimeResponse.headers)
    const contentType = String(getHeader(headers, 'content-type') ?? '')
    const mimeType = contentType.split(';')[0].trim()
    let charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1].toLowerCase() ?? 'utf-8'
    try { new TextDecoder(charset) } catch { charset = 'utf-8' }
    const { text, truncated } = bufferToText(buffer, charset)
    const extension = mimeType.includes('json')
      ? 'json'
      : mimeType.includes('xml')
        ? 'xml'
        : mimeType.includes('html')
          ? 'html'
          : mimeType.startsWith('image/')
            ? 'image'
            : mimeType
              ? 'text'
              : 'text'
    const timings: Record<string, number> = {}
    for (const [key, value] of Object.entries(
      timingOffsets ?? runtimeResponse.timings ?? {}
    )) {
      if (typeof value === 'number') timings[key] = value
    }
    const cookies: Array<Record<string, unknown>> = (
      runtimeResponse.cookies?.members ?? []
    ).map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure)
    }))
    if (cookies.length === 0) {
      const setCookie = Object.entries(headers)
        .filter(([key]) => key.toLowerCase() === 'set-cookie')
        .flatMap(([, value]) => String(value).split(/,(?=\s*[^;=\s]+=)/))
      for (const rawCookie of setCookie) {
        const pair = rawCookie.split(';')[0]
        const index = pair.indexOf('=')
        if (index <= 0) continue
        const name = pair.slice(0, index).trim()
        if (!name) continue
        const cookie: Record<string, unknown> = { name, value: pair.slice(index + 1).trim(), httpOnly: false, secure: false }
        for (const attr of rawCookie.split(';').slice(1)) {
          const index = attr.indexOf('=')
          const key = (index < 0 ? attr : attr.slice(0, index)).trim().toLowerCase()
          const value = index < 0 ? '' : attr.slice(index + 1).trim()
          if (['domain', 'path', 'expires'].includes(key)) cookie[key] = value
          else if (key === 'httponly') cookie.httpOnly = true
          else if (key === 'secure') cookie.secure = true
        }
        cookies.push(cookie)
      }
    }
    responseSnapshot = {
      code: Number(runtimeResponse.code ?? 0),
      status: String(runtimeResponse.status ?? ''),
      headers,
      body: text,
      body_truncated: truncated || undefined,
      body_base64: buffer.subarray(0, MAX_BODY_BYTES).toString('base64'),
      charset,
      mime: { ext: extension, mime: mimeType || 'text/plain' },
      size: Number(runtimeResponse.responseSize ?? buffer.length),
      response_time: Number(runtimeResponse.responseTime ?? finishedAt - startedAt),
      timings,
      cookies,
      network: networkInfo ?? undefined
    }
  }

  const failedAssertion = assertions.some((a) => !a.passed && !a.skipped)
  const status = result.error || !responseSnapshot || failedAssertion ? 'failed' : 'passed'

  const record: SendRecord = {
    record_id: createId('h'),
    project_id: projectId,
    target_id: target.target_id,
    target_name: target.name,
    method,
    url: runtimeUrl,
    created_at: startedAt,
    status,
    request: {
      name: target.name,
      project_id: projectId,
      target_id: target.target_id,
      method,
      url: runtimeUrl,
      headers: requestHeaders,
      querys: resolved.querys,
      paths: resolved.paths,
      cookies: resolved.cookies,
      body: requestBody,
      mode: (runtimeRequest?.body?.mode as string) ?? (resolved.body ? 'raw' : 'none')
    },
    response: responseSnapshot,
    assertions,
    console: consoleEntries,
    error: result.error
  }

  return record
}
