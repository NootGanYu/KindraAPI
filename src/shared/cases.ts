import type {
  CaseAssertion,
  CaseRunAssertion,
  CaseRunResult,
  CaseRunSummary
} from './types'

/**
 * 断言求值，供主进程运行用例与前端预览共用。
 *
 * JSONPath 只支持子集：`$`、`.key`、`["key"]`、`[0]`。
 */

type JsonPathToken = { type: 'key'; key: string } | { type: 'index'; index: number }

export function parseJsonPath(raw: string | undefined): JsonPathToken[] | null {
  const path = (raw ?? '').trim()
  if (!path) return null
  if (path === '$') return []
  if (!path.startsWith('$')) return null

  const tokens: JsonPathToken[] = []
  let index = 1
  while (index < path.length) {
    const char = path[index]
    if (char === '.') {
      index += 1
      const start = index
      while (index < path.length && /[A-Za-z0-9_$-]/.test(path[index])) index += 1
      if (index === start) return null
      tokens.push({ type: 'key', key: path.slice(start, index) })
      continue
    }
    if (char === '[') {
      index += 1
      const quote = path[index]
      if (quote === "'" || quote === '"') {
        index += 1
        const start = index
        while (index < path.length && path[index] !== quote) index += 1
        if (index >= path.length) return null
        const key = path.slice(start, index)
        index += 1
        if (path[index] !== ']') return null
        index += 1
        tokens.push({ type: 'key', key })
        continue
      }
      const start = index
      while (index < path.length && path[index] !== ']') index += 1
      const num = Number(path.slice(start, index))
      if (!Number.isInteger(num) || num < 0) return null
      index += 1
      tokens.push({ type: 'index', index: num })
      continue
    }
    return null
  }
  return tokens
}

export function getJsonPath(
  value: unknown,
  raw: string | undefined
): { found: boolean; value?: unknown } {
  const tokens = parseJsonPath(raw)
  if (!tokens) return { found: false }
  let current: unknown = value
  for (const token of tokens) {
    if (token.type === 'key') {
      if (
        current &&
        typeof current === 'object' &&
        !Array.isArray(current) &&
        Object.prototype.hasOwnProperty.call(current, token.key)
      ) {
        current = (current as Record<string, unknown>)[token.key]
      } else {
        return { found: false }
      }
    } else {
      if (Array.isArray(current) && token.index < current.length) {
        current = current[token.index]
      } else {
        return { found: false }
      }
    }
  }
  return { found: true, value: current }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function looseEqual(actual: unknown, expected: string): boolean {
  if (typeof actual === 'object' && actual !== null) {
    return textOf(actual) === expected
  }
  return String(actual) === expected
}

function compareNumber(actual: unknown, expected: string): number | null {
  const left = Number(actual)
  const right = Number(expected)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  return left - right
}

function applyOp(
  actual: { found: boolean; value?: unknown },
  assertion: CaseAssertion
): { passed: boolean; message?: string } {
  const expected = assertion.expected ?? ''
  if (assertion.op === 'exists') {
    return actual.found
      ? { passed: true }
      : { passed: false, message: '路径不存在' }
  }
  if (!actual.found) {
    return { passed: false, message: '路径不存在' }
  }
  switch (assertion.op) {
    case 'equals':
      return { passed: looseEqual(actual.value, expected) }
    case 'not_equals':
      return { passed: !looseEqual(actual.value, expected) }
    case 'contains':
      if (Array.isArray(actual.value)) {
        return {
          passed: actual.value.some((item) => looseEqual(item, expected))
        }
      }
      return { passed: textOf(actual.value).includes(expected) }
    case 'gt': {
      const diff = compareNumber(actual.value, expected)
      return diff === null
        ? { passed: false, message: '无法转换为数字' }
        : { passed: diff > 0 }
    }
    case 'lt': {
      const diff = compareNumber(actual.value, expected)
      return diff === null
        ? { passed: false, message: '无法转换为数字' }
        : { passed: diff < 0 }
    }
    default:
      return { passed: false, message: '不支持的断言操作符' }
  }
}

export interface CaseAssertionInput {
  status?: number
  body?: string
  durationMs?: number
}

export function evaluateCaseAssertions(
  assertions: CaseAssertion[] | undefined,
  input: CaseAssertionInput
): CaseRunAssertion[] {
  const enabled = (assertions ?? []).filter((item) => item.is_enabled !== 0)
  let parsedJson: { ok: boolean; value?: unknown } | null = null
  const json = (): { ok: boolean; value?: unknown } => {
    if (parsedJson) return parsedJson
    try {
      parsedJson = { ok: true, value: JSON.parse(input.body ?? '') }
    } catch {
      parsedJson = { ok: false }
    }
    return parsedJson
  }

  return enabled.map((assertion) => {
    let actual: { found: boolean; value?: unknown }
    if (assertion.kind === 'status') {
      actual = { found: input.status !== undefined, value: input.status }
    } else if (assertion.kind === 'duration') {
      actual = { found: input.durationMs !== undefined, value: input.durationMs }
    } else {
      const body = json()
      actual = body.ok
        ? getJsonPath(body.value, assertion.path)
        : { found: false }
    }
    const outcome = applyOp(actual, assertion)
    return {
      assertion_id: assertion.assertion_id,
      passed: outcome.passed,
      actual: actual.found ? textOf(actual.value) : undefined,
      message:
        outcome.message ??
        (assertion.kind === 'json' && !json().ok && assertion.op !== 'exists'
          ? '响应不是合法 JSON'
          : undefined)
    }
  })
}

export function caseStatus(
  assertions: CaseRunAssertion[],
  input: CaseAssertionInput
): 'passed' | 'failed' {
  if (assertions.some((item) => !item.passed)) return 'failed'
  if (assertions.length === 0) {
    return input.status !== undefined && input.status < 400 ? 'passed' : 'failed'
  }
  return 'passed'
}

export function summarizeCaseRuns(
  results: Array<{ case_id: string; result: CaseRunResult }>
): CaseRunSummary {
  return {
    total: results.length,
    passed: results.filter((item) => item.result.status === 'passed').length,
    failed: results.filter((item) => item.result.status === 'failed').length,
    error: results.filter((item) => item.result.status === 'error').length,
    results
  }
}
