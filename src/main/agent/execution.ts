import { withTransportIntegrity } from '../request/transport'
import type { Target } from '@shared/types'
import { captureRequestContext, sendRequest, type RequestExecutionContext } from '../request/executor'
import { projectRedactor } from './redaction'
const { VariableScope, Url } = require('postman-collection') as any

export interface ExecutionSnapshot {
  context: RequestExecutionContext
  method: string
  url: string
  effects: string[]
}
/** The same snapshot supplies the approval display and the eventual runtime. */
export function prepareExecution(projectId: string, target: Target, environmentId?: string): ExecutionSnapshot {
  const context = captureRequestContext(projectId, target, environmentId)
  for (const dependency of context.dependencies) {
    const request = 'target_id' in dependency ? dependency.request : dependency
    if (!request) continue
    if ((request.pre_script_enabled !== false && request.pre_script?.trim()) || (request.test_enabled !== false && request.test?.trim())) throw new Error('本阶段不支持脚本、额外请求或变量写回副作用，请移除脚本后重新生成执行计划')
  }
  const body = context.resolved.bodyModel
  if (context.resolved.bodyMode === 'binary' || (context.resolved.bodyMode === 'formdata' && (body?.formdata ?? body?.parameter ?? []).some(p => p.field_type === 'file' && (p.is_checked > 0 || (p.is_system ?? -1) > 0)))) throw new Error('本阶段不支持文件上传副作用，请移除文件后重新生成执行计划')
  const values = Object.fromEntries(Object.entries(context.globals.vars).map(([k, v]) => [k, v.current_value ?? v.initial_value]))
  for (const [key, variable] of Object.entries(context.env?.env_var_list ?? {})) if (variable.is_checked > 0) values[key] = variable.current_value ?? variable.initial_value
  if (values.baseUrl === undefined) values.baseUrl = context.resolved.baseUrl
  const scope = new VariableScope({ values: Object.entries(values).map(([key, value]) => ({ key, value })) })
  const approvedUrl = new Url(scope.replaceIn(context.resolved.url))
  const auth = context.resolved.authModel
  if (auth?.type === 'kv' && auth.kv?.in === 'query') approvedUrl.query.upsert({ key: scope.replaceIn(auth.kv.key), value: scope.replaceIn(auth.kv.value) })
  const url = approvedUrl.toString()
  if (/\{\{/.test(url) || /\{\{\s*\$/.test(context.resolved.url)) throw new Error('执行目标包含未解析或动态变量，请使用固定目标重新生成计划')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('执行仅支持 HTTP(S) 目标')
  return { context, method: context.resolved.method, url, effects: ['发送一次 HTTP 请求，可能产生远端业务副作用', '不跟随重定向；不执行脚本、读取上传文件或写回变量', '仅保存脱敏的本机报告；不保存接口定义'] }
}
export async function executeSnapshot(snapshot: ExecutionSnapshot, signal: AbortSignal): Promise<{ status: 'succeeded' | 'failed' | 'unknown' | 'cancelled'; report: unknown; error?: string }> {
  let dispatched = false
  const { context } = snapshot
  const { value: record, complete } = await withTransportIntegrity(() => sendRequest(context.projectId, context.target, context.env?.env_id, {
    context, signal, policy: {
      followRedirects: false, persistVariables: false,
      // Pre-send helpers can read before beforeRequest, so file access is denied independently.
      fileResolver: { readFile: (_path: unknown, ...args: any[]) => args.at(-1)(new Error('Agent 文件读取未授权')), createReadStream: () => { throw new Error('Agent 文件读取未授权') } },
      beforeRequest: request => {
        if (signal.aborted) throw new Error('请求已取消，尚未发送')
        if (dispatched || request.method !== snapshot.method || request.url.toString() !== snapshot.url) throw new Error('实际网络请求超出获批方法或目标范围')
        dispatched = true
      }
    }
  }))
  if (dispatched && (!record.response || !complete)) {
    record.error = { type: 'transport', message: '响应传输未完整结束，远端结果未知' }; record.status = 'failed'
  }
  // Encoded response bodies could bypass ordinary string redaction. Keep only the text projection.
  if (record.response) delete record.response.body_base64
  const status = record.error ? dispatched ? 'unknown' : signal.aborted ? 'cancelled' : 'failed' : 'succeeded'
  const error = status === 'unknown' ? '远端结果未知：请求可能已到达服务，禁止自动重发；请先人工核实。' : record.error?.message
  const redact = projectRedactor(context.projectId, [], [context, record])
  return { status, report: redact({ ...record, outcome: status, error: error ? { type: status, message: error } : null }), error: error ? redact(error) : undefined }
}
