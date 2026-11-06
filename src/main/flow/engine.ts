import vm from 'node:vm'
import crypto from 'node:crypto'
import { FlowFileChangedError, verifiedFileResolver } from '../request/files'
import { isolatedScript } from './isolatedScript'
import type { ExecutionVariables } from '../request/variables'
import type {
  AssertionResult,
  ConsoleEntry,
  Environment,
  Flow,
  FlowAssertion,
  FlowEvent,
  FlowEventResult,
  FlowExecutionCursor,
  FlowExecutionSnapshot,
  FlowRequestInput,
  FlowResponseSnapshot,
  FlowRun,
  GlobalVars,
  Param,
  RequestModel,
  Target,
  SendRecord
} from '@shared/types'
import { createId, createParam, createRequest, createTarget } from '@shared/factories'
import * as store from '../storage/store'
import { captureRequestDefinition, sendRequest, type RequestExecutionDefinition } from '../request/executor'
import { authenticationSecrets, redactEvidence } from './evidence'
import { FlowDependencies } from './dependencies'
import { selectFlowEnvironment } from './environment'
import { FlowRefreshController, definitionRevision } from './refresh'

const MAX_LOOP = 50
const MAX_WAIT_MS = 60_000
const SCRIPT_TIMEOUT_MS = 3_000
const loopBound = (event: FlowEvent): number => Math.min(Math.max(Number(event.loop_count ?? 1), 1), MAX_LOOP)

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, ms)
    if (signal?.aborted) finish()
    else signal?.addEventListener('abort', finish, { once: true })
  })
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function stringValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value ?? '')]))
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

export interface FlowExecutionProgress {
  /** All observed values, including overwritten/unset values, for report redaction. */
  secrets: Set<string>
  results: Map<string, FlowEventResult>
  conditions: Map<string, boolean>
  lastResponse: FlowResponseSnapshot | null
}
export interface FlowExecutionPolicy {
  progress: FlowExecutionProgress
  variables: ExecutionVariables['values']
  environment: Environment | null
  globals: GlobalVars
  signal: AbortSignal
  checkScope(): void
  executeRequest(event: FlowEvent): Promise<{ record: SendRecord; report?: SendRecord; status: 'succeeded' | 'failed' | 'unknown' | 'cancelled'; error?: string; retryable: boolean }>
}

class FlowRuntime {
  policy?: FlowExecutionPolicy
  readonly projectId: string
  env: Environment | null
  globals: GlobalVars
  envValues: Record<string, unknown>
  globalValues: Record<string, unknown>
  localValues: Record<string, unknown> = {}
  consoleEntries: ConsoleEntry[] = []
  lastResponse: FlowResponseSnapshot | null = null
  progressRoot: FlowEventResult[] = []
  resultStack: FlowEventResult[] = []
  frames: FlowExecutionCursor['stack'] = []
  cursor: FlowExecutionCursor = { stack: [] }
  onProgress?: () => void
  logicalStepDepth = 0
  requestInFlight = false
  remoteUnknown = false
  dependencies!: FlowDependencies
  refresh!: FlowRefreshController
  private readonly authSecrets = new Set<string>()
  rememberAuth(auth: unknown): void {
    const variables = stringValues({ ...this.globalValues, ...this.envValues, ...this.localValues })
    for (const secret of authenticationSecrets(auth, variables)) this.authSecrets.add(secret)
  }
  evidenceSeeds(): unknown[] {
    for (const definition of this.definitions.values()) this.rememberAuth(definition.resolved.auth)
    return [this.globalValues, this.envValues, this.localValues, { credential: [...this.authSecrets] }]
  }
  readonly definitions = new Map<string, RequestExecutionDefinition>()
  readonly settings = store.getSettings()
  onReviewRequired?: (message: string) => Promise<void>
  signal?: AbortSignal
  onBeforeStep?: () => Promise<void>
  onStepBoundary?: () => Promise<void>


  constructor(projectId: string, env: Environment | null, globals: GlobalVars) {
    this.projectId = projectId
    this.env = env
    this.globals = globals
    this.envValues = {}
    this.globalValues = {}
    if (env) {
      for (const [key, value] of Object.entries(env.env_var_list)) {
        if (value.is_checked > 0) this.envValues[key] = value.current_value ?? value.initial_value ?? ''
      }
    }
    for (const [key, value] of Object.entries(globals.vars)) {
      this.globalValues[key] = value.current_value ?? value.initial_value ?? ''
    }
  }

  get(key: string): unknown {
    if (this.localValues[key] !== undefined) return this.localValues[key]
    if (this.envValues[key] !== undefined) return this.envValues[key]
    return this.globalValues[key]
  }

  setEnv(key: string, value: string): void {
    this.envValues[key] = value
  }

  setGlobal(key: string, value: string): void {
    this.globalValues[key] = value
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
  if (runtime.policy) {
    const output = isolatedScript({ environment: runtime.envValues, globals: runtime.globalValues, local: runtime.localValues, response: runtime.lastResponse }, code)
    runtime.envValues = runtime.policy.variables.environment = output.environment
    runtime.globalValues = runtime.policy.variables.globals = output.globals
    runtime.localValues = runtime.policy.variables.local = output.local
    for (const value of output.observed) if (value) runtime.policy.progress.secrets.add(value)
    runtime.consoleEntries.push(...output.console)
    return { assertions: output.assertions, error: output.error }
  }
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
      get: (key: string): unknown =>
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
      get: (key: string): unknown =>
        runtime.globalValues[key] !== undefined
          ? runtime.globalValues[key]
          : runtime.globals.vars[key]?.initial_value,
      set: (key: string, value: unknown): void => runtime.setGlobal(key, String(value ?? '')),
      unset: (key: string): void => {
        delete runtime.globalValues[key]
      }
    },
    variables: {
      get: (key: string): unknown => runtime.get(key),
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
      params.push(createParam({ param_id: `flow-input:${keyOf(key)}`, key, value }))
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

export function inlineTarget(projectId: string, event: FlowEvent): Target {
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

function skipped(events: FlowEvent[] | undefined, detail: string, status: 'skipped' | 'paused' = 'skipped'): FlowEventResult[] {
  if (!events?.length) return []
  return events.map((event) => ({
    event_id: event.event_id,
    name: event.name,
    type: event.type,
    status,
    retryable: status === 'paused',
    started_at: Date.now(),
    elapsed_ms: 0,
    detail,
    children: skipped(event.children, detail, status)
  }))
}

function blockedChildren(events: FlowEvent[] | undefined, detail: string): FlowEventResult[] {
  return (events ?? []).map(event => result(event, 'blocked', Date.now(), { detail, children: blockedChildren(event.children, detail) }))
}

function hasFailure(events: FlowEventResult[]): boolean {
  return events.some((event) => !['passed', 'skipped'].includes(event.status) || hasFailure(event.children ?? []))
}

function anyStatus(events: FlowEventResult[], status: FlowEventResult['status']): boolean {
  return events.some((event) => event.status === status || anyStatus(event.children ?? [], status))
}

function hasBlocked(events: FlowEventResult[]): boolean {
  return events.some(event => event.status === 'blocked' || hasBlocked(event.children ?? []))
}

function completedStatus(events: FlowEventResult[]): 'blocked' | 'failed' | 'passed' {
  return hasBlocked(events) ? 'blocked' : hasFailure(events) ? 'failed' : 'passed'
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
  if (runtime.policy) {
    const output = isolatedScript({ environment: runtime.envValues, globals: runtime.globalValues, local: runtime.localValues, response: runtime.lastResponse }, expanded, true)
    return { ok: !!output.ok, error: output.error }
  }
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
  if (runtime.policy) {
    // Target resolution and all dependencies were captured before approval.
  } else if (event.type === 'api') {
    if (!event.target_id) return result(event, 'failed', startedAt, { error: '未选择接口' })
    target = runtime.definitions.get(event.event_id)?.target ?? null
    if (!target) return result(event, 'failed', startedAt, { error: '接口不存在或已删除' })
  } else {
    target = inlineTarget(projectId, event)
  }

  const prepared = target ? applyRequestInput(target, event.input) : null
  let dispatched = false
  try {
    let record: SendRecord
    let execution: Awaited<ReturnType<FlowExecutionPolicy['executeRequest']>> | null = null
    if (runtime.policy) {
      execution = await runtime.policy.executeRequest(event)
      runtime.envValues = runtime.policy.variables.environment
      runtime.globalValues = runtime.policy.variables.globals
      runtime.localValues = runtime.policy.variables.local ??= {}
      record = execution.record
    } else {
      record = await sendRequest(projectId, prepared!, runtime.env?.env_id || undefined, {
        signal: runtime.signal,
        requireResolvedVariables: runtime.refresh.validateDispatch,
        onRequestStart: auth => { runtime.rememberAuth(auth); dispatched = true; runtime.requestInFlight = true; runtime.onProgress?.() },
        definition: runtime.definitions.get(event.event_id), settings: runtime.settings,
        scopes: { environment: runtime.envValues, globals: runtime.globalValues, local: runtime.localValues }
      })
      runtime.requestInFlight = false
      if (dispatched && record.error && record.error.type !== 'file-changed' && !record.response) runtime.remoteUnknown = true
      store.addSendRecord(projectId, redactEvidence(record, runtime.evidenceSeeds(), 'send'))
    }
    runtime.lastResponse = toFlowResponse(record)
    // Agent reports are already redacted; never copy raw console/request projections from the
    // main-process record into a model-facing Flow result.
    const projected = runtime.policy && execution?.report ? execution.report : record
    for (const entry of projected.console) runtime.consoleEntries.push(entry)

    const assertions = [...record.assertions, ...(event.assertions ?? []).map((assertion) =>
      evalAssertion(assertion, runtime.lastResponse)
    )]
    const failed = assertions.some((assertion) => !assertion.passed && !assertion.skipped)
    const status: FlowEventResult['status'] = runtime.policy && execution && execution.status !== 'succeeded'
      ? execution.status === 'failed' && record.error?.type === 'authorization' ? 'paused' : execution.status
      : record.error?.type === 'cancelled' ? 'cancelled'
        : record.error || !record.response || failed ? 'failed' : 'passed'
    const detail = record.error
      ? record.error.message
      : record.response
        ? `${record.response.code} ${record.response.status} · ${record.response.response_time} ms`
        : '没有响应'

    return result(event, status, startedAt, {
      detail,
      definition_revision: runtime.definitions.has(event.event_id) ? definitionRevision(runtime.definitions.get(event.event_id)!) : undefined,
      request: {
        method: projected.request.method,
        url: projected.request.url,
        headers: projected.request.headers,
        body:
          typeof projected.request.body === 'string'
            ? projected.request.body
            : projected.request.body
              ? JSON.stringify(projected.request.body)
              : undefined
      },
      response: (runtime.policy && execution?.report ? projected.response : runtime.lastResponse) ?? undefined,
      assertions,
      retryable: execution?.retryable,
      error: execution?.error ?? record.error?.message
    })
  } catch (error) {
    if (!runtime.policy && error instanceof FlowFileChangedError && runtime.onReviewRequired) {
      await runtime.onReviewRequired(error.message)
      if (runtime.signal?.aborted) return result(event, 'cancelled', startedAt)
      // Verification happens before API scripts or dispatch, so only this unsent request continues.
      return runRequestEvent(projectId, event, runtime, flow)
    }
    if (runtime.requestInFlight) runtime.remoteUnknown = true
    runtime.requestInFlight = false
    return result(event, runtime.policy ? (runtime.policy.signal.aborted ? 'cancelled' : 'paused') : 'failed', startedAt, { error: (error as Error).message, retryable: false })
  }
}

async function runEvent(
  projectId: string,
  event: FlowEvent,
  runtime: FlowRuntime,
  flow: Flow,
  address: string
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
      const signal = runtime.policy?.signal ?? runtime.signal
      await sleep(ms, signal)
      return result(event, signal?.aborted ? 'cancelled' : 'passed', startedAt, {
        detail: signal?.aborted ? '等待已取消' : `等待 ${ms} ms`,
        // A wait has no external effect, so a cancelled wait is a safe resume boundary.
        retryable: signal?.aborted ? true : undefined
      })
    }

    if (event.type === 'if') {
      const previous = runtime.policy?.progress.conditions.get(address)
      const condition = previous === undefined ? evalCondition(runtime, event.condition ?? '') : { ok: previous }
      if (!condition.error) runtime.policy?.progress.conditions.set(address, condition.ok)
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
      const children = runtime.resultStack.at(-1)!.children = []
      await runEvents(projectId, event.children ?? [], runtime, flow, children)
      return result(event, completedStatus(children), startedAt, {
        detail: `条件成立：${event.condition ?? ''}`,
        children
      })
    }

    if (event.type === 'begin') {
      const children = runtime.resultStack.at(-1)!.children = []
      await runEvents(projectId, event.children ?? [], runtime, flow, children)
      return result(event, completedStatus(children), startedAt, {
        detail: `分组 ${children.length} 个事件`,
        children
      })
    }

    if (event.type === 'loop') {
      const count = loopBound(event)
      const children: FlowEventResult[] = runtime.resultStack.at(-1)!.children = []
      const previousIndex = runtime.localValues.loop_index
      let iterations = 0
      try {
        for (let index = 0; index < count; index += 1) {
          if (runtime.signal?.aborted && !runtime.policy) break
          runtime.setLocal('loop_index', String(index))
          await runEvents(projectId, event.children ?? [], runtime, flow, children, index)
          iterations += 1
          if (runtime.policy && hasFailure(children)) break
        }
      } finally {
        if (previousIndex === undefined) runtime.unsetLocal('loop_index')
        else runtime.setLocal('loop_index', String(previousIndex))
      }
      return result(event, completedStatus(children), startedAt, {
        detail: runtime.policy
          ? `循环计划 ${count} 轮，已运行 ${iterations} 轮${hasFailure(children) ? '，后续轮次已暂停' : ''}`
          : `循环 ${count} 轮`,
        children
      })
    }

    return result(event, 'failed', startedAt, { error: `未知事件类型：${event.type}` })
  } catch (error) {
    if (runtime.requestInFlight) runtime.remoteUnknown = true
    runtime.requestInFlight = false
    return result(event, runtime.policy ? (runtime.policy.signal.aborted ? 'cancelled' : 'paused') : 'failed', startedAt, { error: (error as Error).message, retryable: !!runtime.policy })
  }
}

function rememberVariables(runtime: FlowRuntime): void {
  if (!runtime.policy) return
  for (const scope of [runtime.policy.variables.environment, runtime.policy.variables.globals, runtime.policy.variables.local ?? {}]) {
    for (const value of Object.values(scope)) if (value !== undefined && value !== null && String(value)) runtime.policy.progress.secrets.add(String(value))
  }
}

async function runEvents(
  projectId: string,
  events: FlowEvent[],
  runtime: FlowRuntime,
  flow: Flow,
  results: FlowEventResult[] = runtime.progressRoot,
  iteration?: number
): Promise<FlowEventResult[]> {
  const frame: FlowExecutionCursor['stack'][number] = {
    parent_event_id: runtime.resultStack.at(-1)?.event_id, next_event_index: 0, iteration
  }
  runtime.frames.push(frame)
  const iterationPath = runtime.frames
    .filter(item => item.iteration !== undefined && item.parent_event_id)
    .map(item => ({ event_id: item.parent_event_id!, iteration: item.iteration! }))
  const identify = (item: FlowEventResult): FlowEventResult => {
    item.iteration_path ??= clone(iterationPath)
    item.instance_id ??= JSON.stringify([item.event_id, item.iteration_path])
    for (const child of item.children ?? []) identify(child)
    return item
  }
  const addressOf = (item: FlowEvent): string => JSON.stringify([item.event_id, iterationPath])
  const updateCursor = (afterInstanceId = runtime.cursor.after_instance_id): void => {
    runtime.cursor = { stack: clone(runtime.frames), after_instance_id: afterInstanceId }
  }
  try {
    for (const [index, event] of events.entries()) {
      if (runtime.signal?.aborted && !runtime.policy) break
      frame.next_event_index = index
      updateCursor()
      const address = addressOf(event)
      const completed = runtime.policy?.progress.results.get(address)
      if (completed) {
        const replayed = identify(structuredClone(completed))
        results.push(replayed)
        runtime.dependencies.record(replayed)
        if (hasFailure([replayed])) { results.push(...skipped(events.slice(index + 1), '前置节点未成功，停止依赖执行', 'paused')); break }
        continue
      }
      if (runtime.policy) {
        try {
          if (runtime.policy.signal.aborted) throw new Error('执行已取消')
          runtime.policy.checkScope()
        } catch (error) {
          results.push(identify(result(event, runtime.policy.signal.aborted ? 'cancelled' : 'paused', Date.now(), { iteration, error: (error as Error).message, retryable: true })))
          results.push(...skipped(events.slice(index + 1), '前置节点未成功，停止依赖执行', 'paused'))
          break
        }
        runtime.envValues = runtime.policy.variables.environment
        runtime.globalValues = runtime.policy.variables.globals
        runtime.localValues = runtime.policy.variables.local ??= {}
      }
      rememberVariables(runtime)
      const logicalId = (item: FlowEvent): string => item.logical_step_id ?? item.step_id ?? item.event_id
      if (!index || logicalId(events[index - 1]) !== logicalId(event)) {
        await runtime.onBeforeStep?.()
        // Check the whole logical step before its first script. A later file change is
        // checked again by sendRequest before its own scripts, without replaying this group.
        for (const pending of events.slice(index)) {
          if (logicalId(pending) !== logicalId(event)) break
          if (!pending.enabled) continue
          while (!runtime.signal?.aborted) {
            try { verifiedFileResolver(runtime.definitions.get(pending.event_id)?.files ?? []); break }
            catch (error) {
              if (!(error instanceof FlowFileChangedError) || !runtime.onReviewRequired) throw error
              runtime.onProgress?.()
              await runtime.onReviewRequired(error.message)
            }
          }
        }
      }
      if (runtime.signal?.aborted && !runtime.policy) break
      let current: FlowEventResult
      {
        const reason = runtime.dependencies.blockedReason(event, results, iterationPath)
        if (reason) {
          current = identify(result(event, 'blocked', Date.now(), { iteration, detail: reason, children: blockedChildren(event.children, reason) }))
          results.push(current)
          runtime.dependencies.record(current)
        } else {
          current = identify(result(event, 'running', Date.now(), { iteration }))
          results.push(current)
          runtime.resultStack.push(current)
          runtime.onProgress?.()
          // A container that belongs to a surrounding multi-member logical step
          // cannot publish a child pause boundary before that outer step finishes.
          const groupedContainer = Boolean(event.children && (event.logical_step_id || event.step_id) &&
            ((index > 0 && logicalId(events[index - 1]) === logicalId(event)) ||
              (events[index + 1] && logicalId(events[index + 1]) === logicalId(event))))
          if (groupedContainer) runtime.logicalStepDepth++
          try { Object.assign(current, await runEvent(projectId, event, runtime, flow, address)) }
          finally { if (groupedContainer) runtime.logicalStepDepth-- }
          // Policy execution already reports its own unknown/cancelled/paused outcome;
          // never downgrade an unknown remote result to a local cancellation.
          if (runtime.signal?.aborted && !runtime.policy) current.status = 'cancelled'
          identify(current)
          runtime.dependencies.record(current)
          runtime.resultStack.pop()
        }
      }
      rememberVariables(runtime)
      // Containers with incomplete children are revisited; terminal leaves are never replayed.
      if (runtime.policy && (['passed', 'skipped'].includes(current.status) || !['if', 'begin', 'loop'].includes(event.type) && !current.retryable)) {
        runtime.policy.progress.results.set(address, structuredClone(current))
      }
      frame.next_event_index = index + 1
      updateCursor(current.instance_id)
      runtime.onProgress?.()
      const next = events[index + 1]
      if (!runtime.signal?.aborted && runtime.logicalStepDepth === 0 && (!next || logicalId(event) !== logicalId(next))) await runtime.onStepBoundary?.()
      if (runtime.policy && hasFailure([current])) {
        results.push(...skipped(events.slice(index + 1), '前置节点未成功，停止依赖执行', 'paused'))
        break
      }
    }
  } finally {
    runtime.frames.pop()
    updateCursor()
  }
  return results
}

export async function runFlow(
  projectId: string,
  flow: Flow,
  environmentId?: string,
  options: {
    signal?: AbortSignal
    runId?: string
    startedAt?: number
    onProgress?: (run: FlowRun) => void
    onSnapshot?: (snapshot: FlowExecutionSnapshot) => void
    onStepBoundary?: () => Promise<void>
    onBeforeStep?: () => Promise<void>
    onReviewRequired?: (message: string) => Promise<void>
    onControl?: (controller: FlowRefreshController) => void
    progress?: FlowExecutionProgress
    variables?: ExecutionVariables['values']
    environment?: Environment | null
    globals?: GlobalVars
    checkScope?: () => void
    executeRequest?: FlowExecutionPolicy['executeRequest']
  } = {}
): Promise<FlowRun> {
  const policy: FlowExecutionPolicy | undefined =
    options.progress && options.variables && options.checkScope && options.executeRequest
      ? {
          progress: options.progress,
          variables: options.variables,
          environment: options.environment ?? null,
          globals: options.globals ?? store.getGlobalVars(projectId),
          signal: options.signal ?? new AbortController().signal,
          checkScope: options.checkScope,
          executeRequest: options.executeRequest
        }
      : undefined
  const env = policy ? policy.environment : selectFlowEnvironment(projectId, flow, environmentId)
  const globals = policy ? policy.globals : store.getGlobalVars(projectId)
  flow = clone(flow)
  const runtime = new FlowRuntime(projectId, env, globals)
  runtime.policy = policy
  runtime.lastResponse = policy?.progress.lastResponse ?? null
  runtime.dependencies = new FlowDependencies(flow.events)
  runtime.signal = options.signal
  runtime.onStepBoundary = options.onStepBoundary
  runtime.onBeforeStep = options.onBeforeStep
  runtime.onReviewRequired = options.onReviewRequired
  let snapshot: FlowExecutionSnapshot | undefined
  if (!policy) {
  const capture = (events: FlowEvent[]): void => {
    for (const event of events) {
      const target = event.type === 'api' && event.target_id
        ? store.getTarget(projectId, event.target_id)
        : event.type === 'request' ? inlineTarget(projectId, event) : null
      if (target) {
        runtime.definitions.set(event.event_id,
          captureRequestDefinition(projectId, applyRequestInput(target, event.input), env))
      }
      capture(event.children ?? [])
    }
  }
  capture(flow.events)
  const byId = new Map<string, FlowEvent>()
  const indexEvents = (events: FlowEvent[]): void => { for (const event of events) { byId.set(event.event_id, event); indexEvents(event.children ?? []) } }
  indexEvents(flow.events)
  const continuationAt = (index: number): { events: FlowEvent[]; suffix: FlowEvent[]; remainingIterations: number } => {
    const frame = runtime.frames[index]
    const parent = frame.parent_event_id ? byId.get(frame.parent_event_id) : undefined
    const events = parent?.children ?? flow.events
    // Ancestors still point at the active child; the deepest frame already advanced.
    const offset = frame.next_event_index + (index < runtime.frames.length - 1 ? 1 : 0)
    return { events, suffix: events.slice(offset),
      remainingIterations: parent?.type === 'loop' ? loopBound(parent) - (frame.iteration ?? 0) - 1 : 0 }
  }
  const remaining = (): Array<{ event: FlowEvent; count: number }> => {
    const pending = new Map<string, { event: FlowEvent; count: number }>()
    const add = (events: FlowEvent[], count = 1): void => { for (const event of events) {
      if (!event.enabled || count < 1) continue
      if (event.type === 'api' || event.type === 'request') pending.set(event.event_id, { event, count: count + (pending.get(event.event_id)?.count ?? 0) })
      add(event.children ?? [], count * (event.type === 'loop' ? loopBound(event) : 1))
    } }
    if (!runtime.frames.length) add(flow.events)
    runtime.frames.forEach((_frame, index) => {
      const { events, suffix, remainingIterations } = continuationAt(index)
      add(suffix)
      add(events, remainingIterations)
    })
    return [...pending.values()]
  }
  const nextEvent = (): FlowEvent | undefined => {
    // The deepest frame is the continuation position; walk outward if its sequence ended.
    for (let index = runtime.frames.length - 1; index >= 0; index--) {
      const { events, suffix, remainingIterations } = continuationAt(index)
      const next = suffix.find(event => event.enabled)
      if (next) return next
      if (remainingIterations > 0) return events.find(event => event.enabled)
    }
    return undefined
  }
  runtime.refresh = new FlowRefreshController(projectId, env, runtime.definitions, remaining, applyRequestInput,
    () => stringValues({ ...runtime.globalValues, ...runtime.envValues, ...runtime.localValues }), flow.events, () => runtime.cursor.after_instance_id, nextEvent, () => runtime.evidenceSeeds())
  options.onControl?.(runtime.refresh)
  snapshot = {
    flow_revision: flow.revision ?? crypto.createHash('sha256').update(JSON.stringify(flow)).digest('hex'),
    captured_at: Date.now(),
    environment_id: env?.env_id ?? '',
    requests: [...runtime.definitions].map(([event_id, definition]) => ({
      event_id,
      target_id: definition.target.target_id,
      files: definition.files,
      revision: crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex')
    }))
  }
  options.onSnapshot?.(snapshot)
  }

  const startedAt = options.startedAt ?? Date.now()
  const runId = options.runId ?? createId('run')
  runtime.onProgress = () => options.onProgress?.(redactEvidence({
    run_id: runId, project_id: projectId, flow_id: flow.flow_id, flow_name: flow.name,
    env_id: env?.env_id ?? '', started_at: startedAt, finished_at: 0, status: 'running',
    elapsed_ms: Date.now() - startedAt, variables: stringValues({ ...runtime.globalValues, ...runtime.envValues, ...runtime.localValues }),
    cursor: runtime.cursor, events: runtime.progressRoot, console: runtime.consoleEntries, request_in_flight: runtime.requestInFlight,
    remote_outcome: runtime.remoteUnknown ? 'unknown' : undefined
  }, runtime.evidenceSeeds(), 'run'))
  const events = await runEvents(projectId, flow.events, runtime, flow)
  if (policy) policy.progress.lastResponse = runtime.lastResponse
  const finishedAt = Date.now()
  const run: FlowRun = {
    cursor: runtime.cursor,
    snapshot,
    run_id: runId,
    project_id: projectId,
    flow_id: flow.flow_id,
    flow_name: flow.name,
    env_id: env?.env_id ?? '',
    started_at: startedAt,
    finished_at: finishedAt,
    status: runtime.signal?.aborted
      ? 'cancelled'
      : runtime.remoteUnknown
        ? 'unknown'
        : anyStatus(events, 'unknown')
          ? 'unknown'
          : anyStatus(events, 'cancelled')
            ? 'cancelled'
            : anyStatus(events, 'paused')
              ? 'paused'
              : completedStatus(events),
    elapsed_ms: finishedAt - startedAt,
    variables: stringValues({ ...runtime.globalValues, ...runtime.envValues, ...runtime.localValues }),
    request_in_flight: false,
    remote_outcome: runtime.remoteUnknown ? 'unknown' : undefined,
    error: runtime.signal?.aborted ? (runtime.remoteUnknown ? '运行已取消；已发送请求的远端结果未知，不保证回滚，不会自动重试' : '运行已取消，不会自动重试') : undefined,
    events,
    console: runtime.consoleEntries
  }
  const evidence = redactEvidence(run, runtime.evidenceSeeds(), 'run')
  if (!policy && !options.onProgress) store.saveFlowRun(projectId, evidence)
  return evidence
}

export function flowRunFailureCount(run: FlowRun): number {
  return countFailed(run.events)
}
