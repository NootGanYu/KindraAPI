import type {
  ApiCase,
  BodyModel,
  CaseRunResult,
  CaseRunSummary,
  Param,
  Target
} from '@shared/types'
import { caseStatus, evaluateCaseAssertions, summarizeCaseRuns } from '@shared/cases'
import { sendRequest } from './executor'
import * as store from '../storage/store'

function mergeParams(base?: Param[], incoming?: Param[]): Param[] {
  const map = new Map<string, Param>()
  for (const param of base ?? []) {
    if (param.is_checked === 0 || !param.key) continue
    map.set(param.key, { ...param, is_checked: 1 })
  }
  for (const param of incoming ?? []) {
    if (!param.key) continue
    if (param.is_checked === 0) {
      map.delete(param.key)
      continue
    }
    map.set(param.key, { ...param, is_checked: 1 })
  }
  return [...map.values()]
}

function applyBody(base: BodyModel | undefined, apiCase: ApiCase): BodyModel | undefined {
  const override = apiCase.override
  if (
    !override.body_mode &&
    override.body === undefined &&
    !override.formdata &&
    !override.urlencoded
  ) {
    return base
  }
  const mode = override.body_mode ?? base?.mode ?? 'raw'
  const next: BodyModel = { ...(base ?? { mode }), mode }
  if (override.body !== undefined) {
    next.raw = override.body
    if (mode === 'json') next.json = override.body
  }
  if (override.formdata) next.formdata = override.formdata
  if (override.urlencoded) next.urlencoded = override.urlencoded
  return next
}

/** 按 key 合并用例覆盖到接口定义，返回可直接发送的克隆。 */
export function applyCaseOverride(target: Target, apiCase: ApiCase): Target {
  const clone = JSON.parse(JSON.stringify(target)) as Target
  const request = clone.request
  if (!request) return clone
  const override = apiCase.override

  if (override.method) clone.method = override.method
  if (override.url !== undefined && override.url.trim()) clone.url = override.url.trim()

  request.header.parameter = mergeParams(
    request.header.parameter,
    override.headers
  )
  request.query.parameter = mergeParams(request.query.parameter, override.query)
  request.restful.parameter = mergeParams(request.restful.parameter, override.restful)

  const body = applyBody(request.body, apiCase)
  if (body) request.body = body

  return clone
}

function now(): string {
  return new Date().toISOString()
}

export async function runApiCase(
  projectId: string,
  target: Target,
  apiCase: ApiCase,
  environmentId?: string
): Promise<CaseRunResult> {
  const prepared = applyCaseOverride(target, apiCase)
  const startedAt = Date.now()
  let record
  try {
    record = await sendRequest(projectId, prepared, environmentId)
  } catch (error) {
    const result: CaseRunResult = {
      ran_at: now(),
      status: 'error',
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      assertions: []
    }
    store.saveCaseRun(projectId, target.target_id, apiCase.case_id, result)
    return result
  }

  const httpStatus = record.response?.code
  const duration = record.response?.response_time ?? Date.now() - startedAt
  if (record.error) {
    const result: CaseRunResult = {
      ran_at: now(),
      status: 'error',
      http_status: httpStatus,
      duration_ms: duration,
      error: record.error.message,
      assertions: []
    }
    store.saveCaseRun(projectId, target.target_id, apiCase.case_id, result)
    return result
  }

  const assertions = evaluateCaseAssertions(apiCase.assertions, {
    status: httpStatus,
    body: record.response?.body ?? '',
    durationMs: duration
  })
  const result: CaseRunResult = {
    ran_at: now(),
    status: caseStatus(assertions, { status: httpStatus }),
    http_status: httpStatus,
    duration_ms: duration,
    assertions
  }
  store.saveCaseRun(projectId, target.target_id, apiCase.case_id, result)
  return result
}

export async function runApiCases(
  projectId: string,
  target: Target,
  environmentId?: string
): Promise<CaseRunSummary> {
  const enabled = (target.cases ?? []).filter((item) => item.is_enabled !== 0)
  const results: Array<{ case_id: string; result: CaseRunResult }> = []
  for (const apiCase of enabled) {
    const result = await runApiCase(projectId, target, apiCase, environmentId)
    results.push({ case_id: apiCase.case_id, result })
  }
  return summarizeCaseRuns(results)
}
