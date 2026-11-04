import { applyCaseOverride, executeApiCase } from '../request/cases'
import { createExecutionVariables, persistExecutionVariables, type ExecutionVariables } from '../request/variables'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import * as store from '../storage/store'
import { getDraft } from './drafts'
import { createHash } from 'node:crypto'
import type { AgentExecutionPermissions } from '@shared/agentPlan'
import { withTransportIntegrity } from '../request/transport'
import type { Target, SendRecord, ApiCase, CaseRunResult } from '@shared/types'
import { captureRequestContext, requestDefinitionDependencies, sendRequest, type RequestExecutionContext } from '../request/executor'
import { projectRedactor } from './redaction'
const { VariableScope, Url } = require('postman-collection') as any

export interface ExecutionSnapshot {
  apiCase?: ApiCase
  /** Main-process-only scope guard; never included in model projections. */
  checkScope: () => void
  context: RequestExecutionContext
  method: string
  host: string
  url: string
  effects: string[]
  requests: Array<{ method: string; url: string; maxCalls: number }>
  permissions: AgentExecutionPermissions
  files: Array<{ path: string; realPath: string; hash: string; bytes: Buffer; mode: number }>
  scopeSignature: string
  variables: ExecutionVariables
}
function scopeSignature(projectId: string, target: Target, caseId?: string): string {
  const apiCase = caseId ? target.cases?.find(item => item.case_id === caseId) : undefined
  const dependencies = requestDefinitionDependencies(projectId, apiCase ? applyCaseOverride(target, apiCase) : target)
  return JSON.stringify([apiCase ? { case_id: apiCase.case_id, enabled: apiCase.is_enabled } : null, dependencies.map(d => { const r = 'target_id' in d ? d.request : d; return { identity: 'target_id' in d ? [d.target_id, d.parent_id, d.method, d.url] : 'global', pre: r?.pre_script, preEnabled: r?.pre_script_enabled, post: r?.test, postEnabled: r?.test_enabled, file: r?.body?.binary, formFiles: (r?.body?.formdata ?? r?.body?.parameter ?? []).filter(p => p.field_type === 'file') } })])
}
function fileHash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex') }
/** The same snapshot supplies the approval display and the eventual runtime. */
export function prepareExecution(projectId: string, target: Target, environmentId?: string, permissions: AgentExecutionPermissions = {}, apiCase?: ApiCase, source?: { currentTarget: () => Target; checkScope?: () => void; variableQuery?: boolean }): ExecutionSnapshot {
  if (permissions && (typeof permissions !== 'object' || Object.keys(permissions).some(k => !['requests', 'writeVariables', 'saveResponse'].includes(k)) || ['writeVariables', 'saveResponse'].some(k => (permissions as any)[k] !== undefined && typeof (permissions as any)[k] !== 'boolean') || (permissions.requests !== undefined && (!Array.isArray(permissions.requests) || permissions.requests.length > 32)))) throw new Error('执行授权参数无效')
  const context = captureRequestContext(projectId, apiCase ? applyCaseOverride(target, apiCase) : target, environmentId)
  const scripts = context.dependencies.flatMap(dependency => {
    const request = 'target_id' in dependency ? dependency.request : dependency
    return request ? [request] : []
  })
  const pre = [scripts[0], ...scripts.slice(1).reverse()].filter(Boolean).filter(r => r.pre_script_enabled !== false).map(r => r.pre_script ?? '').filter(Boolean).join('\n')
  const post = scripts.slice(1).concat(scripts[0]).filter(Boolean).filter(r => r.test_enabled !== false).map(r => r.test ?? '').filter(Boolean).join('\n')
  if (context.target.request) { context.target.request.pre_script = pre; context.target.request.test = post; context.target.request.pre_script_enabled = true; context.target.request.test_enabled = true }
  const body = context.resolved.bodyModel
  const paths = context.resolved.bodyMode === 'binary' ? [body?.binary?.file_path ?? ''] : context.resolved.bodyMode === 'formdata' ? (body?.formdata ?? body?.parameter ?? []).filter(p => p.field_type === 'file' && (p.is_checked > 0 || (p.is_system ?? -1) > 0)).map(p => p.value) : []
  const files = [...new Set(paths)].map(file => {
    if (!file || !path.isAbsolute(file)) throw new Error('上传文件必须是已配置的绝对路径')
    const realPath = fs.realpathSync(file), stat = fs.statSync(realPath)
    if (!stat.isFile()) throw new Error('上传文件须为普通文件')
    const bytes = fs.readFileSync(realPath)
    return { path: file, realPath, hash: fileHash(bytes), bytes, mode: stat.mode }
  })
  const values = Object.fromEntries(Object.entries(context.globals.vars).map(([k, v]) => [k, v.current_value ?? v.initial_value]))
  for (const [key, variable] of Object.entries(context.env?.env_var_list ?? {})) if (variable.is_checked > 0) values[key] = variable.current_value ?? variable.initial_value
  if (values.baseUrl === undefined) values.baseUrl = context.resolved.baseUrl
  const scope = new VariableScope({ values: Object.entries(values).map(([key, value]) => ({ key, value })) })
  const approvedUrl = new Url(scope.replaceIn(context.resolved.url))
  const auth = context.resolved.authModel
  if (auth?.type === 'kv' && auth.kv?.in === 'query') approvedUrl.query.upsert({ key: scope.replaceIn(auth.kv.key), value: scope.replaceIn(auth.kv.value) })
  if (source?.variableQuery) approvedUrl.query.each((param: { value?: string | null }) => { if (typeof param.value === 'string') param.value = param.value.replace(/\{\{[^}]+\}\}/g, '') })
  const url = approvedUrl.toString()
  if (/\{\{/.test(url) || /\{\{\s*\$/.test(context.resolved.url)) throw new Error('执行目标包含未解析或动态变量，请使用固定目标重新生成计划')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('执行仅支持 HTTP(S) 目标')
  const host = scope.replaceIn(context.resolved.headers.find(header => header.key.toLowerCase() === 'host')?.value ?? parsed.host)
  const requests = (permissions.requests ?? []).map(request => {
    const parsed = new URL(request.url)
    const method = request.method.toUpperCase(), maxCalls = request.maxCalls ?? 1
    if (!['http:', 'https:'].includes(parsed.protocol) || !/^[A-Z]+$/.test(method) || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 100) throw new Error('额外请求授权范围无效')
    return { method, url: new Url(request.url).toString(), maxCalls }
  })
  const effects = [`HTTP Host: ${host}`, '发送获批 HTTP 请求，可能产生远端业务副作用；不跟随重定向', '查询变量可按脚本演进；方法、主机、路径及查询字段名固定', ...files.map(f => `上传文件 ${f.path} (${f.bytes.length} bytes, SHA256 ${f.hash})`), ...requests.map(r => `额外请求 ${r.method} ${r.url}，最多 ${r.maxCalls} 次`), ...(pre ? [`前置脚本 SHA256 ${createHash('sha256').update(pre).digest('hex')}`] : []), ...(post ? [`后置脚本 SHA256 ${createHash('sha256').update(post).digest('hex')}`] : []), permissions.writeVariables ? '允许变量差量写回，冲突时暂停' : '脚本变量仅在本轮内存演进，不写回环境或全局变量', '仅保存脱敏本机报告']
  const variables = createExecutionVariables(context.env, context.globals, context.resolved.baseUrl)
  context.variables = variables.values
  const currentTarget = source?.currentTarget ?? (() => getDraft(projectId, target.target_id).target)
  const signature = scopeSignature(projectId, currentTarget(), apiCase?.case_id)
  const checkScope = (): void => {
    source?.checkScope?.()
    if (signature !== scopeSignature(projectId, currentTarget(), apiCase?.case_id)) throw new Error('脚本、目标或文件配置已改变，请重新确认执行计划')
  }
  return { apiCase: apiCase ? structuredClone(apiCase) : undefined, checkScope, variables, files, scopeSignature: signature, context, host, method: context.resolved.method, url, effects, requests, permissions: structuredClone(permissions) }

}
export async function executeSnapshot(snapshot: ExecutionSnapshot, signal: AbortSignal): Promise<{ status: 'succeeded' | 'failed' | 'unknown' | 'cancelled'; report: unknown; error?: string; response?: SendRecord['response']; record: SendRecord; retryable: boolean }> {
  snapshot.checkScope()
  for (const file of snapshot.files) {
    if (fs.realpathSync(file.path) !== file.realPath || fileHash(fs.readFileSync(file.path)) !== file.hash) throw new Error('获批文件已变化，请重新确认执行计划')
  }
  let scopeError: string | undefined
  const file = (source: unknown) => {
    const entry = snapshot.files.find(f => f.path === source)
    if (entry && (fs.realpathSync(entry.path) !== entry.realPath || fileHash(fs.readFileSync(entry.path)) !== entry.hash)) { scopeError = '获批文件已变化，请重新确认'; throw new Error(scopeError) }
    if (!entry) { scopeError = '实际文件读取超出获批范围'; throw new Error(scopeError) }
    return entry
  }
  let dispatched = 0
  const remaining = [{ method: snapshot.method, url: snapshot.url, maxCalls: 1 }, ...snapshot.requests].map(r => ({ ...r }))
  const { context } = snapshot
  let caseResult: CaseRunResult | undefined
  const options: NonNullable<Parameters<typeof sendRequest>[3]> = {
    context, signal, policy: {
      followRedirects: false, persistVariables: false,
      onVariables: values => { snapshot.variables.values.environment = values.environment; snapshot.variables.values.globals = values.globals; snapshot.variables.values.local = values.local },
      // Pre-send helpers can read before beforeRequest, so file access is denied independently.
      fileResolver: {
        stat: (source: unknown, callback: (error: unknown, stat?: unknown) => void) => { try { const f = file(source); callback(null, { isFile: () => true, mode: f.mode, size: f.bytes.length }) } catch (error) { callback(error) } },
        createReadStream: (source: unknown) => { const f = file(source); return Object.assign(Readable.from(f.bytes), { path: f.path, knownLength: f.bytes.length }) },
        readFile: (source: unknown, ...args: any[]) => { try { args.at(-1)(null, file(source).bytes) } catch (error) { args.at(-1)(error) } }
      },
      beforeRequest: (request, variables) => {
        if (scopeError) throw new Error(scopeError)
        snapshot.checkScope()
        if (context.env && !store.listEnvironments(context.projectId).some(e => e.env_id === context.env!.env_id)) throw new Error('获批环境已删除')
        if (signal.aborted) throw new Error('请求已取消，尚未发送')
        const currentScope = new VariableScope({ values: Object.entries({ ...variables.globals, ...variables.environment, ...variables.local }).map(([key, value]) => ({ key, value })) })
        const currentUrl = new Url(currentScope.replaceIn(context.resolved.url))
        const auth = context.resolved.authModel
        if (auth?.type === 'kv' && auth.kv?.in === 'query') currentUrl.query.upsert({ key: currentScope.replaceIn(auth.kv.key), value: currentScope.replaceIn(auth.kv.value) })
        const approved = new URL(snapshot.url), evolved = new URL(currentUrl.toString())
        const sameDestination = approved.origin === evolved.origin && approved.pathname === evolved.pathname && approved.username === evolved.username && approved.password === evolved.password && JSON.stringify([...approved.searchParams.keys()]) === JSON.stringify([...evolved.searchParams.keys()])
        const allowed = remaining.find((r, index) => r.maxCalls > 0 && r.method === request.method && (r.url === request.url.toString() || index === 0 && sameDestination && currentUrl.toString() === request.url.toString()))
        if (!allowed) throw new Error('实际网络请求超出获批方法、目标或次数范围')
        const requestHost = request.headers?.get('host')
        const approvedHost = allowed === remaining[0] ? snapshot.host : new URL(allowed.url).host
        if (requestHost && requestHost !== approvedHost) throw new Error('实际 Host 超出获批目标范围')
        allowed.maxCalls--; dispatched++
      }
    }
  }
  const { value: record, complete, started } = await withTransportIntegrity(async () => {
    if (!snapshot.apiCase) return sendRequest(context.projectId, context.target, context.env?.env_id, options)
    const run = await executeApiCase(context.projectId, context.target, snapshot.apiCase, context.env?.env_id, options)
    caseResult = run.result
    return run.record
  })
  const unknown = dispatched > 0 && (!complete || started !== dispatched)
  if (unknown) {
    record.error = { type: 'transport', message: '响应传输未完整结束，远端结果未知' }; record.status = 'failed'
  }
  const failedAssertion = record.assertions.find(assertion => !assertion.passed && !assertion.skipped)
  if (!record.error && failedAssertion) record.error = { type: 'assertion', message: `脚本断言失败：${failedAssertion.name}` }
  if (!record.response && !record.error) record.error = { type: 'request', message: '主请求未完成' }
  if (!record.error) {
    try {
      if (context.env && !store.listEnvironments(context.projectId).some(e => e.env_id === context.env!.env_id)) throw new Error('获批环境已删除')
      snapshot.checkScope()
      for (const approvedFile of snapshot.files) file(approvedFile.path)
    } catch (error) { record.error = { type: 'authorization', message: error instanceof Error ? error.message : '执行范围已变化' } }
  }
  if (!record.error && caseResult?.status === 'failed') record.error = { type: 'assertion', message: '用例断言失败' }
  if (!record.error && snapshot.permissions.writeVariables) {
    try { persistExecutionVariables(context.projectId, snapshot.variables) }
    catch (error) { record.error = { type: 'variables', message: error instanceof Error ? error.message : '变量写回暂停' } }
  }
  // Encoded response bodies could bypass ordinary string redaction. Keep only the text projection.
  if (record.response) delete record.response.body_base64
  if (record.error) record.status = 'failed'
  const status = record.error ? unknown ? 'unknown' : signal.aborted ? 'cancelled' : 'failed' : 'succeeded'
  const error = status === 'unknown' ? '远端结果未知：请求可能已到达服务，禁止自动重发；请先人工核实。' : record.error?.message
  const redact = projectRedactor(context.projectId, Object.values(context.variables?.environment ?? {}).concat(Object.values(context.variables?.globals ?? {}), Object.values(context.variables?.local ?? {})).map(String), [context, record, snapshot.requests])
  return { record, status, retryable: dispatched === 0 && started === 0 && status !== 'succeeded', response: status === 'succeeded' ? redact(record.response) : undefined, report: redact({ ...record, ...(caseResult ? { case_id: snapshot.apiCase!.case_id, case_name: snapshot.apiCase!.name, case_result: { ...caseResult, ...(record.error ? { status: record.error.type === 'assertion' ? 'failed' : 'error', error } : {}) } } : {}), network_attempts: remaining.map((request, index) => ({ method: request.method, url: request.url, count: (index === 0 ? 1 : snapshot.requests[index - 1].maxCalls) - request.maxCalls })), outcome: status, error: error ? { type: status, message: error } : null }), error: error ? redact(error) : undefined }
}
