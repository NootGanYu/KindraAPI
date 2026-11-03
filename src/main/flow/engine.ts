import vm from 'node:vm'
import type {
  AssertionResult,
  ConsoleEntry,
  Environment,
  Flow,
  FlowAssertion,
  FlowEvent,
  FlowEventResult,
  FlowRequestInput,
  FlowResponseSnapshot,
  FlowRun,
  GlobalVars,
  Param,
  RequestModel,
  Target
} from '@shared/types'
import { createId, createParam, createRequest, createTarget } from '@shared/factories'
import * as store from '../storage/store'
import { sendRequest } from '../request/executor'

const MAX_LOOP = 50
const MAX_WAIT_MS = 60_000
const SCRIPT_TIMEOUT_MS = 3_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getPath(input: unknown, path?: string): unknown {
  if (!path) return input
  const parts = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  let current: unknown = input
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function describeAssertion(assertion: FlowAssertion): string {
  if (assertion.type === 'status') return `状态码 = ${assertion.expected}`
  if (assertion.type === 'time') return `耗时 ≤ ${assertion.expected}ms`
  if (assertion.type === 'bodyContains') return `响应体包含「${assertion.expected}」`
  const op =
    assertion.op === 'length_gt'
      ? '长度 >'
      : assertion.op === 'exists'
        ? '存在'
        : assertion.op === 'contains'
          ? '包含'
          : '='
  return `JSON ${assertion.path ?? ''} ${op} ${assertion.expected ?? ''}`.trim()
}

function equalValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true
  if (actual === null || actual === undefined) return false
  if (typeof actual === 'object' || typeof expected === 'object') {
    try {
      return JSON.stringify(actual) === JSON.stringify(expected)
    } catch {
      return false
    }
  }
  return String(actual) === String(expected)
}

function evalAssertion(
  assertion: FlowAssertion,
  response: FlowResponseSnapshot | null
): AssertionResult {
  const name = describeAssertion(assertion)
  if (!response) return { name, passed: false, error: '没有可断言的响应' }
  try {
    if (assertion.type === 'status') {
      return { name, passed: response.code === Number(assertion.expected) }
    }
    if (assertion.type === 'time') {
      return { name, passed: response.response_time <= Number(assertion.expected) }
    }
    if (assertion.type === 'bodyContains') {
      return { name, passed: response.body.includes(String(assertion.expected ?? '')) }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(response.body)
    } catch {
      return { name, passed: false, error: '响应体不是合法 JSON' }
    }
    const value = getPath(parsed, assertion.path)
    if (assertion.op === 'exists') {
      return { name, passed: value !== undefined && value !== null }
    }
    if (assertion.op === 'length_gt') {
      const length =
        typeof value === 'string' || Array.isArray(value)
          ? value.length
          : value !== null && typeof value === 'object'
            ? Object.keys(value as Record<string, unknown>).length
            : -1
      return { name, passed: length > Number(assertion.expected) }
    }
    if (assertion.op === 'contains') {
      const expected = String(assertion.expected ?? '')
      const passed =
        typeof value === 'string'
          ? value.includes(expected)
          : Array.isArray(value)
            ? value.some((item) => equalValue(item, assertion.expected))
            : JSON.stringify(value ?? '').includes(expected)
      return { name, passed }
    }
    return { name, passed: equalValue(value, assertion.expected) }
  } catch (error) {
    return { name, passed: false, error: (error as Error).message }
  }
}

class FlowRuntime {
  readonly projectId: string
  env: Environment | null
  globals: GlobalVars
  envValues: Record<string, string>
  globalValues: Record<string, string>
  localValues: Record<string, string> = {}
  consoleEntries: ConsoleEntry[] = []
  lastResponse: FlowResponseSnapshot | null = null
  private envDirty = false
  private globalsDirty = false

  constructor(projectId: string, env: Environment | null, globals: GlobalVars) {
    this.projectId = projectId
    this.env = env
    this.globals = globals
    this.envValues = {}
    this.globalValues = {}
    if (env) {
      for (const [key, value] of Object.entries(env.env_var_list)) {
        this.envValues[key] = value.current_value || value.initial_value || ''
      }
    }
    for (const [key, value] of Object.entries(globals.vars)) {
      this.globalValues[key] = value.current_value || value.initial_value || ''
    }
  }

  get(key: string): string | undefined {
    if (this.localValues[key] !== undefined) return this.localValues[key]
    if (this.envValues[key] !== undefined) return this.envValues[key]
    return this.globalValues[key]
  }

  setEnv(key: string, value: string): void {
    this.envValues[key] = value
    this.envDirty = true
  }

  setGlobal(key: string, value: string): void {
    this.globalValues[key] = value
    this.globalsDirty = true
  }

  setLocal(key: string, value: string): void {
    this.localValues[key] = value
  }

  unsetLocal(key: string): void {
    delete this.localValues[key]
  }

  log(level: string, args: unknown[]): void {
    this.consoleEntries.push({
      time: Date.now(),
      level,
      args: args.map((arg) => {
        try {
          return typeof arg === 'string' ? arg : JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      })
    })
  }

  persist(): void {
    if (this.env && this.envDirty) {
      for (const [key, value] of Object.entries(this.envValues)) {
        const existing = this.env.env_var_list[key]
        if (existing) {
          existing.current_value = value
          existing.is_checked = existing.is_checked > 0 ? existing.is_checked : 1
        } else {
          this.env.env_var_list[key] = {
            current_value: value,
            initial_value: '',
            description: '',
            is_checked: 1
          }
        }
      }
      store.saveEnvironment(this.projectId, this.env)
      this.envDirty = false
    }
    if (this.globalsDirty) {
      for (const [key, value] of Object.entries(this.globalValues)) {
        const existing = this.globals.vars[key]
        if (existing) existing.current_value = value
        else
          this.globals.vars[key] = {
            current_value: value,
            initial_value: '',
            description: ''
          }
      }
      store.saveGlobalVars(this.projectId, this.globals)
      this.globalsDirty = false
    }
  }
}

/* ---------------------------------------------------------------------------
   Minimal pm.* shim
   --------------------------------------------------------------------------- */

function makeExpect(actual: unknown): Record<string, unknown> {
  const fail = (message: string): never => {
    throw new Error(message)
  }
  const compare = (op: string, expected?: unknown): void => {
    let passed = false
    if (op === 'eql') passed = equalValue(actual, expected)
    else if (op === 'equal') passed = actual == expected // eslint-disable-line eqeqeq
    else if (op === 'above') passed = Number(actual) > Number(expected)
    else if (op === 'below') passed = Number(actual) < Number(expected)
    else if (op === 'atLeast') passed = Number(actual) >= Number(expected)
    else if (op === 'atMost') passed = Number(actual) <= Number(expected)
    else if (op === 'include') {
      passed =
        typeof actual === 'string'
          ? actual.includes(String(expected))
          : Array.isArray(actual)
            ? actual.some((item) => equalValue(item, expected))
            : false
    } else if (op === 'a') passed = typeof actual === String(expected)
    else if (op === 'match') passed = new RegExp(String(expected)).test(String(actual))
    else if (op === 'length') {
      const length =
        typeof actual === 'string' || Array.isArray(actual)
          ? actual.length
          : actual !== null && typeof actual === 'object'
            ? Object.keys(actual as Record<string, unknown>).length
            : -1
      passed = length === Number(expected)
    }
    if (!passed) {
      fail(`期望 ${op} ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
    }
  }

  const positive: Record<string, (expected?: unknown) => void> = {
    eql: (expected) => compare('eql', expected),
    equals: (expected) => compare('eql', expected),
    equal: (expected) => compare('equal', expected),
    above: (expected) => compare('above', expected),
    below: (expected) => compare('below', expected),
    least: (expected) => compare('atLeast', expected),
    most: (expected) => compare('atMost', expected),
    include: (expected) => compare('include', expected),
    contains: (expected) => compare('include', expected),
    a: (expected) => compare('a', expected),
    match: (expected) => compare('match', expected)
  }
  const boolean = (name: string, expected: boolean): (() => void) => {
    const assert = (): void => {
      if (actual !== expected) fail(`期望 ${name}，实际 ${JSON.stringify(actual)}`)
    }
    assert()
    return assert
  }
  Object.defineProperties(positive, {
    true: { get: () => boolean('true', true) },
    false: { get: () => boolean('false', false) },
    ok: {
      get: () => {
        if (!actual) fail(`期望 truthy，实际 ${JSON.stringify(actual)}`)
        return () => undefined
      }
    },
    exist: {
      get: () => {
        if (actual === undefined || actual === null)
          fail(`期望存在，实际 ${JSON.stringify(actual)}`)
        return () => undefined
      }
    }
  })
  const have = {
    length: (expected: unknown) => compare('length', expected)
  }
  const to: Record<string, unknown> = {
    ...positive,
    be: { ...positive, ...have },
    have
  }
  const notTo: Record<string, unknown> = {}
  for (const [key, fn] of Object.entries(positive)) {
    notTo[key] = (...args: unknown[]) => {
      try {
        ;(fn as (...a: unknown[]) => void)(...args)
      } catch {
        return
      }
      fail(`not.${key} 断言失败`)
    }
  }
  const chain: Record<string, unknown> = { to }
  chain.and = chain
  chain.not = { to: notTo }
  return chain
}

interface ScriptRunResult {
  assertions: AssertionResult[]
  error?: string
}

function runScript(runtime: FlowRuntime, code: string): ScriptRunResult {
  const assertions: AssertionResult[] = []
  const response = runtime.lastResponse
  const pmResponse = response
    ? {
        code: response.code,
        status: response.status,
        text: (): string => response.body,
        json: (): unknown => JSON.parse(response.body),
        headers: {
          get: (name: string): string | undefined => {
            const target = name.toLowerCase()
            const key = Object.keys(response.headers).find((item) => item.toLowerCase() === target)
            return key ? response.headers[key] : undefined
          }
        }
      }
    : undefined

  const pm = {
    environment: {
      get: (key: string): string | undefined =>
        runtime.envValues[key] !== undefined
          ? runtime.envValues[key]
          : runtime.env?.env_var_list[key]?.initial_value,
      set: (key: string, value: unknown): void => runtime.setEnv(key, String(value ?? '')),
      unset: (key: string): void => {
        delete runtime.envValues[key]
        if (runtime.env?.env_var_list[key]) runtime.env.env_var_list[key].current_value = ''
      }
    },
    globals: {
      get: (key: string): string | undefined =>
        runtime.globalValues[key] !== undefined
          ? runtime.globalValues[key]
          : runtime.globals.vars[key]?.initial_value,
      set: (key: string, value: unknown): void => runtime.setGlobal(key, String(value ?? '')),
      unset: (key: string): void => {
        delete runtime.globalValues[key]
      }
    },
    variables: {
      get: (key: string): string | undefined => runtime.get(key),
      set: (key: string, value: unknown): void => runtime.setLocal(key, String(value ?? ''))
    },
    response: pmResponse,
    test: (name: string, fn: () => void): void => {
      try {
        fn()
        assertions.push({ name, passed: true })
      } catch (error) {
        assertions.push({ name, passed: false, error: (error as Error).message })
      }
    },
    expect: (actual: unknown): Record<string, unknown> => makeExpect(actual),
    info: (...args: unknown[]): void => runtime.log('info', args)
  }

  const consoleShim = {
    log: (...args: unknown[]): void => runtime.log('log', args),
    info: (...args: unknown[]): void => runtime.log('info', args),
    warn: (...args: unknown[]): void => runtime.log('warn', args),
    error: (...args: unknown[]): void => runtime.log('error', args)
  }

  const sandbox: Record<string, unknown> = {
    pm,
    console: consoleShim,
    JSON,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent
  }

  try {
    vm.runInNewContext(code, sandbox, { timeout: SCRIPT_TIMEOUT_MS, filename: 'flow-script.js' })
    return { assertions }
  } catch (error) {
    runtime.log('error', [(error as Error).message])
    return { assertions, error: (error as Error).message }
  }
}

/* ---------------------------------------------------------------------------
   Request resolution
   --------------------------------------------------------------------------- */

function mergeParams(
  params: Param[],
  input: Record<string, string> | undefined,
  caseInsensitive = false
): Param[] {
  if (!input) return params
  for (const [key, value] of Object.entries(input)) {
    const keyOf = (candidate: string): string =>
      caseInsensitive ? candidate.toLowerCase() : candidate
    const existing = params.find((param) => keyOf(param.key) === keyOf(key))
    if (existing) {
      existing.value = value
      existing.is_checked = 1
    } else {
      params.push(createParam({ key, value }))
    }
  }
  return params
}

export function applyRequestInput(target: Target, input?: FlowRequestInput): Target {
  const copy = clone(target)
  const request: RequestModel = copy.request ?? createRequest()
  if (input) {
    request.query.parameter = mergeParams(request.query.parameter ?? [], input.query)
    request.header.parameter = mergeParams(request.header.parameter ?? [], input.headers, true)
    request.restful.parameter = mergeParams(request.restful.parameter ?? [], input.path)
    request.cookie.parameter = mergeParams(request.cookie.parameter ?? [], input.cookies)
    if (input.body !== undefined) {
      request.body = { ...(request.body ?? {}), mode: 'raw', raw: input.body }
    }
  }
  copy.request = request
  return copy
}

function inlineTarget(projectId: string, event: FlowEvent): Target {
  const target = createTarget(projectId, '0', 'api', event.name)
  target.method = (event.method || 'GET').toUpperCase()
  target.url = event.url || ''
  const request = createRequest()
  request.header.parameter = (event.headers ?? [])
    .filter((header) => header.key.trim() !== '')
    .map((header) => createParam({ key: header.key, value: header.value }))
  if (event.body) {
    request.body = { ...request.body, mode: 'raw', raw: event.body }
  }
  target.request = request
  return target
}

function toFlowResponse(record: Awaited<ReturnType<typeof sendRequest>>): FlowResponseSnapshot | null {
  if (!record.response) return null
  return {
    code: record.response.code,
    status: record.response.status,
    headers: record.response.headers,
    body: record.response.body,
    size: record.response.size,
    response_time: record.response.response_time
  }
}

/* ---------------------------------------------------------------------------
   Event execution
   --------------------------------------------------------------------------- */

function result(
  event: FlowEvent,
  status: FlowEventResult['status'],
  startedAt: number,
  extra: Partial<FlowEventResult> = {}
): FlowEventResult {
  return {
    event_id: event.event_id,
    name: event.name,
    type: event.type,
    status,
    started_at: startedAt,
    elapsed_ms: Date.now() - startedAt,
    ...extra
  }
}

function skipped(events: FlowEvent[] | undefined, detail: string): FlowEventResult[] {
  if (!events?.length) return []
  return events.map((event) => ({
    event_id: event.event_id,
    name: event.name,
    type: event.type,
    status: 'skipped' as const,
    started_at: Date.now(),
    elapsed_ms: 0,
    detail,
    children: skipped(event.children, detail)
  }))
}

function hasFailure(events: FlowEventResult[]): boolean {
  return events.some((event) => event.status === 'failed' || hasFailure(event.children ?? []))
}

function countFailed(events: FlowEventResult[]): number {
  return events.reduce(
    (sum, event) => sum + (event.status === 'failed' ? 1 : 0) + countFailed(event.children ?? []),
    0
  )
}

function evalCondition(
  runtime: FlowRuntime,
  condition: string
): { ok: boolean; error?: string } {
  const text = (condition || '').trim()
  if (!text) return { ok: false, error: '条件为空' }
  const templateOnly = text.match(/^\{\{\s*([^}]+?)\s*\}\}$/)
  if (templateOnly) {
    const value = runtime.get(templateOnly[1].trim())
    return { ok: value !== undefined && value !== null && value !== '' }
  }
  const expanded = text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) =>
    JSON.stringify(runtime.get(key.trim()) ?? '')
  )
  try {
    const sandbox = {
      env: { ...runtime.envValues },
      globals: { ...runtime.globalValues },
      vars: { ...runtime.localValues },
      response: runtime.lastResponse,
      Boolean,
      JSON,
      Number,
      String,
      Date,
      parseInt,
      parseFloat,
      isNaN
    }
    const value = vm.runInNewContext(`Boolean(${expanded})`, sandbox, {
      timeout: 500,
      filename: 'flow-condition.js'
    })
    return { ok: Boolean(value) }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

async function runRequestEvent(
  projectId: string,
  event: FlowEvent,
  runtime: FlowRuntime,
  flow: Flow
): Promise<FlowEventResult> {
  const startedAt = Date.now()
  let target: Target | null = null
  if (event.type === 'api') {
    if (!event.target_id) return result(event, 'failed', startedAt, { error: '未选择接口' })
    target = store.getTarget(projectId, event.target_id)
    if (!target) return result(event, 'failed', startedAt, { error: '接口不存在或已删除' })
  } else {
    target = inlineTarget(projectId, event)
  }

  const prepared = applyRequestInput(target, event.input)
  runtime.persist()
  try {
    const record = await sendRequest(projectId, prepared, flow.env_id || undefined)
    store.addSendRecord(projectId, record)
    runtime.lastResponse = toFlowResponse(record)
    for (const entry of record.console) runtime.consoleEntries.push(entry)

    const assertions = (event.assertions ?? []).map((assertion) =>
      evalAssertion(assertion, runtime.lastResponse)
    )
    const failed = assertions.some((assertion) => !assertion.passed)
    const status: FlowEventResult['status'] = record.error || !record.response || failed ? 'failed' : 'passed'
    const detail = record.error
      ? record.error.message
      : record.response
        ? `${record.response.code} ${record.response.status} · ${record.response.response_time} ms`
        : '没有响应'

    return result(event, status, startedAt, {
      detail,
      request: {
        method: record.request.method,
        url: record.request.url,
        headers: record.request.headers,
        body:
          typeof record.request.body === 'string'
            ? record.request.body
            : record.request.body
              ? JSON.stringify(record.request.body)
              : undefined
      },
      response: runtime.lastResponse ?? undefined,
      assertions,
      error: record.error?.message
    })
  } catch (error) {
    return result(event, 'failed', startedAt, { error: (error as Error).message })
  }
}

async function runEvent(
  projectId: string,
  event: FlowEvent,
  runtime: FlowRuntime,
  flow: Flow
): Promise<FlowEventResult> {
  const startedAt = Date.now()
  if (!event.enabled) {
    return result(event, 'skipped', startedAt, {
      detail: '事件已禁用',
      children: skipped(event.children, '父事件已禁用')
    })
  }

  try {
    if (event.type === 'api' || event.type === 'request') {
      return await runRequestEvent(projectId, event, runtime, flow)
    }

    if (event.type === 'script') {
      const scriptResult = runScript(runtime, event.script ?? '')
      runtime.persist()
      const failed = Boolean(scriptResult.error) || scriptResult.assertions.some((a) => !a.passed)
      const passedCount = scriptResult.assertions.filter((a) => a.passed).length
      const detail = scriptResult.error
        ? scriptResult.error
        : scriptResult.assertions.length
          ? `脚本断言 ${passedCount}/${scriptResult.assertions.length} 通过`
          : '脚本执行完成'
      return result(event, failed ? 'failed' : 'passed', startedAt, {
        detail,
        assertions: scriptResult.assertions,
        error: scriptResult.error
      })
    }

    if (event.type === 'assert') {
      const assertions = (event.assertions ?? []).map((assertion) =>
        evalAssertion(assertion, runtime.lastResponse)
      )
      const passedCount = assertions.filter((assertion) => assertion.passed).length
      const failed = assertions.length === 0 || assertions.some((assertion) => !assertion.passed)
      return result(event, failed ? 'failed' : 'passed', startedAt, {
        detail:
          assertions.length === 0
            ? '没有配置断言'
            : `断言 ${passedCount}/${assertions.length} 通过`,
        assertions
      })
    }

    if (event.type === 'wait') {
      const ms = Math.min(Math.max(Number(event.wait_ms ?? 500), 0), MAX_WAIT_MS)
      await sleep(ms)
      return result(event, 'passed', startedAt, { detail: `等待 ${ms} ms` })
    }

    if (event.type === 'if') {
      const condition = evalCondition(runtime, event.condition ?? '')
      if (condition.error) {
        return result(event, 'failed', startedAt, {
          detail: `条件求值失败：${condition.error}`,
          error: condition.error,
          children: skipped(event.children, '条件求值失败')
        })
      }
      if (!condition.ok) {
        return result(event, 'skipped', startedAt, {
          detail: `条件不成立：${event.condition ?? ''}`,
          children: skipped(event.children, '条件不成立')
        })
      }
      const children = await runEvents(projectId, event.children ?? [], runtime, flow)
      const failed = hasFailure(children)
      return result(event, failed ? 'failed' : 'passed', startedAt, {
        detail: `条件成立：${event.condition ?? ''}`,
        children
      })
    }

    if (event.type === 'begin') {
      const children = await runEvents(projectId, event.children ?? [], runtime, flow)
      return result(event, hasFailure(children) ? 'failed' : 'passed', startedAt, {
        detail: `分组 ${children.length} 个事件`,
        children
      })
    }

    if (event.type === 'loop') {
      const count = Math.min(Math.max(Number(event.loop_count ?? 1), 1), MAX_LOOP)
      const children: FlowEventResult[] = []
      for (let index = 0; index < count; index += 1) {
        runtime.setLocal('loop_index', String(index))
        const iterationResults = await runEvents(projectId, event.children ?? [], runtime, flow)
        children.push(...iterationResults.map((item) => ({ ...item, iteration: index })))
      }
      runtime.unsetLocal('loop_index')
      return result(event, hasFailure(children) ? 'failed' : 'passed', startedAt, {
        detail: `循环 ${count} 轮`,
        children
      })
    }

    return result(event, 'failed', startedAt, { error: `未知事件类型：${event.type}` })
  } catch (error) {
    return result(event, 'failed', startedAt, { error: (error as Error).message })
  }
}

async function runEvents(
  projectId: string,
  events: FlowEvent[],
  runtime: FlowRuntime,
  flow: Flow
): Promise<FlowEventResult[]> {
  const results: FlowEventResult[] = []
  for (const event of events) {
    results.push(await runEvent(projectId, event, runtime, flow))
  }
  return results
}

export async function runFlow(
  projectId: string,
  flow: Flow,
  environmentId?: string,
  options: { runId?: string; startedAt?: number } = {}
): Promise<FlowRun> {
  const envs = store.listEnvironments(projectId)
  const settings = store.getSettings()
  const preferredEnvId = environmentId || flow.env_id || settings.environment_id
  const env = envs.find((item) => item.env_id === preferredEnvId) ?? envs[0] ?? null
  const globals = store.getGlobalVars(projectId)
  const runtime = new FlowRuntime(projectId, env, globals)
  const startedAt = options.startedAt ?? Date.now()
  const events = await runEvents(projectId, flow.events, runtime, flow)
  runtime.persist()
  const finishedAt = Date.now()
  const run: FlowRun = {
    run_id: options.runId ?? createId('run'),
    project_id: projectId,
    flow_id: flow.flow_id,
    flow_name: flow.name,
    env_id: env?.env_id ?? '',
    started_at: startedAt,
    finished_at: finishedAt,
    status: hasFailure(events) ? 'failed' : 'passed',
    elapsed_ms: finishedAt - startedAt,
    variables: { ...runtime.envValues },
    events,
    console: runtime.consoleEntries
  }
  store.saveFlowRun(projectId, run)
  return run
}

export function flowRunFailureCount(run: FlowRun): number {
  return countFailed(run.events)
}
